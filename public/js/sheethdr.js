/* 악보 올리기 — "헤더 자동 추가" 체크 시 "자르기 조정" 버튼이 나타나고, 올릴 파일의 쪽마다 위 · 아래 · 왼쪽 · 오른쪽을 직접 끌어 맞출 수 있어요.
   여러 쪽짜리 PDF 는 "이전 쪽 / 다음 쪽" 으로 넘기며 쪽마다 따로 맞추고, "모든 쪽에 같게" 로 지금 쪽의 영역을 나머지 쪽에 복사할 수 있어요.
   자동 인식 영역(서버)에서 시작하며, 결과는 숨은 칸 crop 에 담겨 올리기와 함께 전송됩니다 — 파일마다 "l,t,r,b;l,t,r,b;…"(쪽 순서,
   손대지 않은 쪽은 비워 둠 = 서버가 자동으로 자름) 를 | 로 이음. 체크를 끄면 올린 그대로. */
(function () {
  if (window.__phSheetHdr) return; window.__phSheetHdr = true;
  var MIN = 0.08, MAX_PAGES = 20, root = null;

  function formOf(el) { return el.closest('form'); }
  function sync(form) {
    var chk = form.querySelector('[data-sheet-hdr]'), btn = form.querySelector('[data-sheet-hdr-crop]');
    var files = form.querySelector('input[type=file]');
    if (btn) btn.hidden = !(chk && chk.checked && files && files.files && files.files.length);
    if (!(chk && chk.checked)) { var h = form.querySelector('input[name=crop]'); if (h) h.value = ''; }
  }
  document.addEventListener('change', function (e) {
    var f = e.target.closest && e.target.closest('form');
    if (!f || !f.querySelector('[data-sheet-hdr]')) return;
    if (e.target.matches('input[type=file]')) { var h = f.querySelector('input[name=crop]'); if (h) h.value = ''; }
    sync(f);
  });

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = '/vendor/pdfjs/pdf.min.js';
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = function () { no(new Error('pdf.js')); }; document.head.appendChild(s);
    });
  }
  function pageCanvas(pg) {
    var vp0 = pg.getViewport({ scale: 1 }), sc = Math.min(1.6, 900 / vp0.width), vp = pg.getViewport({ scale: sc });
    var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    return pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () { return c; });
  }
  /* 파일의 쪽들 → { total(전체 쪽 수), canvases:[쪽 1부터, 최대 MAX_PAGES] } (PDF 는 pdf.js, 사진은 한 쪽) */
  function filePages(file) {
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      return loadPdfJs().then(function (lib) { return file.arrayBuffer().then(function (b) { return lib.getDocument({ data: b }).promise; }); })
        .then(function (doc) {
          var n = Math.min(doc.numPages, MAX_PAGES), jobs = [];
          for (var i = 1; i <= n; i++) jobs.push(doc.getPage(i).then(pageCanvas));
          return Promise.all(jobs).then(function (cs) { return { total: doc.numPages, canvases: cs }; });
        });
    }
    return new Promise(function (ok, no) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () { var s = Math.min(1, 1100 / img.width), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok({ total: 1, canvases: [c] }); };
      img.onerror = function () { no(new Error('img')); }; img.src = u;
    });
  }
  /* 서버가 자동으로 찾은 악보 영역 — 쪽마다 [{l,t,r,b}|null] */
  function autoBoxes(file, n) {
    var fd = new FormData(); fd.append('파일', file); fd.append('pages', String(n || 1));
    return fetch('/conti/sheets/detect', { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { return j && j.boxes && j.boxes.length ? j.boxes : (j && j.box ? [j.box] : []); }).catch(function () { return []; });
  }
  var FULL = { l: 0, t: 0, r: 1, b: 1 };
  function copy(c) { return { l: c.l, t: c.t, r: c.r, b: c.b }; }
  function isFull(c) { return c.l < 0.002 && c.t < 0.002 && c.r > 0.998 && c.b > 0.998; }
  function fmt(c) { return [c.l, c.t, c.r, c.b].map(function (v) { return v.toFixed(4); }).join(','); }

  function close() { if (root) { root.remove(); root = null; } }
  /* 파일 하나의 자르기 편집 — 완료되면 "l,t,r,b;…"(쪽마다, 손대지 않은 쪽은 빈칸) 로 resolve, 취소하면 null */
  function edit(file, idx, total) {
    return new Promise(function (done) {
      root = document.createElement('div'); root.className = 'ss-back on';
      root.innerHTML = '<div class="ss-box hdr-box"><div class="hdr-top"><b></b><span data-hint>모서리·변을 끌어 악보 영역을 맞추세요 (이 안만 남아요)</span></div>' +
        '<div class="hdr-nav" hidden><button type="button" class="ph-btn" data-a="prev" aria-label="이전 쪽">‹ 이전 쪽</button>' +
        '<span class="hdr-pg" data-pg aria-live="polite"></span>' +
        '<button type="button" class="ph-btn" data-a="next" aria-label="다음 쪽">다음 쪽 ›</button>' +
        '<button type="button" class="ph-btn hdr-same" data-a="same">모든 쪽에 같게</button></div>' +
        '<div class="hdr-stage"><div class="hdr-wrap"><div class="hdr-box-area"></div></div></div>' +
        '<div class="hdr-act"><button type="button" class="ph-btn" data-a="auto">자동 영역</button><button type="button" class="ph-btn" data-a="all">전체 쪽</button>' +
        '<span style="flex:1"></span><button type="button" class="ph-btn" data-a="x">취소</button><button type="button" class="ph-btn pri" data-a="ok">적용</button></div></div>';
      document.body.appendChild(root);
      var onResize = function () { fit(); };
      window.addEventListener('resize', onResize);
      var finish = function (v) { window.removeEventListener('resize', onResize); close(); done(v); };
      var title = (file.name || '악보') + (total > 1 ? '  (파일 ' + (idx + 1) + '/' + total + ')' : '');
      root.querySelector('.hdr-top b').textContent = title;
      var wrap = root.querySelector('.hdr-wrap'), area = root.querySelector('.hdr-box-area'), nav = root.querySelector('.hdr-nav'), pgLabel = root.querySelector('[data-pg]');
      // 쪽마다: crops[k] 지금 영역, autos[k] 자동 영역(없으면 null), touched[k] 사용자가 손댔는지 (손대지 않은 쪽은 서버가 자동으로 자름)
      var pages = [], crops = [FULL], autos = [], touched = [false], cur = copy(FULL), k = 0;
      function paint() {
        area.style.left = cur.l * 100 + '%'; area.style.top = cur.t * 100 + '%'; area.style.width = (cur.r - cur.l) * 100 + '%'; area.style.height = (cur.b - cur.t) * 100 + '%';
      }
      // 악보 한 쪽 전체(네 변 손잡이 모두)가 늘 화면 안에 보이도록 — 남은 높이에 맞춰 너비를 줄임 (키 큰 악보 · 휴대폰)
      function fit() {
        var c = pages[k], stage = root && root.querySelector('.hdr-stage'), box = root && root.querySelector('.hdr-box');
        if (!c || !stage || !box) return;
        var vh = window.innerHeight || document.documentElement.clientHeight;
        var others = box.offsetHeight - stage.offsetHeight;                       // 제목 · 쪽 넘기기 · 아래 버튼
        var cssMax = parseFloat(getComputedStyle(stage).maxHeight) || vh;
        var availH = Math.max(220, Math.min(cssMax, vh - 24 - others) - 12);      // 12 = stage 안쪽 여백
        var availW = stage.clientWidth - 12;
        var w = Math.min(availW, availH * c.width / c.height);
        wrap.style.width = Math.max(120, Math.floor(w)) + 'px';
      }
      function show(n) {
        crops[k] = copy(cur);
        k = Math.max(0, Math.min(pages.length - 1, n));
        var old = wrap.querySelector('canvas'); if (old) old.remove();
        if (pages[k]) { pages[k].style.cssText = 'display:block;width:100%;height:auto'; wrap.insertBefore(pages[k], area); fit(); }
        cur = copy(crops[k] || FULL); paint();
        if (pgLabel) pgLabel.textContent = (k + 1) + ' / ' + pages.length + '쪽' + (touched[k] ? ' · 조정함' : '');
        var pv = root.querySelector('[data-a=prev]'), nx = root.querySelector('[data-a=next]');
        if (pv) pv.disabled = k === 0; if (nx) nx.disabled = k >= pages.length - 1;
      }
      function mark() { touched[k] = true; if (pgLabel) pgLabel.textContent = (k + 1) + ' / ' + pages.length + '쪽 · 조정함'; }
      ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'].forEach(function (key) { var h = document.createElement('i'); h.className = 'hdr-h hdr-' + key; h.dataset.k = key; area.appendChild(h); });
      area.addEventListener('pointerdown', function (e) {
        var key = e.target.dataset && e.target.dataset.k; if (!key) return;
        e.preventDefault(); try { area.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
        var rect = wrap.getBoundingClientRect();
        function mv(ev) {
          var x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)), y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
          if (key.indexOf('l') >= 0) cur.l = Math.min(x, cur.r - MIN);
          if (key.indexOf('r') >= 0) cur.r = Math.max(x, cur.l + MIN);
          if (key.indexOf('t') >= 0) cur.t = Math.min(y, cur.b - MIN);
          if (key.indexOf('b') >= 0) cur.b = Math.max(y, cur.t + MIN);
          paint(); mark();
        }
        function up() { area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up); area.removeEventListener('pointercancel', up); }
        area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up); area.addEventListener('pointercancel', up);
      });
      root.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('[data-a]'); a = a && a.dataset.a; if (!a) return;
        if (a === 'x') finish(null);
        else if (a === 'prev') show(k - 1);
        else if (a === 'next') show(k + 1);
        else if (a === 'all') { cur = copy(FULL); paint(); mark(); }
        else if (a === 'auto') { if (autos[k]) cur = copy(autos[k]); else cur = copy(FULL); paint(); touched[k] = false; show(k); }
        else if (a === 'same') {                                       // 지금 쪽의 영역을 모든 쪽에
          crops[k] = copy(cur);
          for (var i = 0; i < pages.length; i++) { crops[i] = copy(cur); touched[i] = true; }
          show(k);
          var hint = root.querySelector('[data-hint]'); if (hint) hint.textContent = '모든 쪽(' + pages.length + '쪽)에 같은 영역을 적용했어요. 쪽마다 다시 고칠 수도 있어요.';
        }
        else if (a === 'ok') {
          crops[k] = copy(cur);
          var n = Math.max(1, pages.length), parts = [];
          for (var j = 0; j < n; j++) parts.push(touched[j] ? fmt(isFull(crops[j]) ? FULL : crops[j]) : '');
          finish(parts.join(';') + (n === 1 ? ';' : ''));           // 한 쪽이어도 ';' 를 붙여 새 형식으로 (서버가 "전체 쪽" 을 그대로 지킴)
        }
      });
      paint();
      filePages(file).then(function (r) {
        pages = r.canvases;
        crops = pages.map(function () { return copy(FULL); }); touched = pages.map(function () { return false; });
        if (pages.length > 1) {
          nav.hidden = false;
          root.querySelector('[data-hint]').textContent = '쪽마다 따로 맞출 수 있어요. 모서리·변을 끌어 악보 영역을 맞추세요 (이 안만 남아요)' + (r.total > pages.length ? ' — 앞의 ' + pages.length + '쪽만 조정할 수 있어요' : '');
        }
        k = 0; show(0);
        return autoBoxes(file, pages.length);
      }).then(function (bs) {
        autos = bs || [];
        crops = crops.map(function (c, i) { return touched[i] ? c : (autos[i] ? copy(autos[i]) : c); });
        if (!touched[k]) { cur = copy(crops[k]); paint(); }
      }).catch(function () { root && (root.querySelector('[data-hint]').textContent = '미리보기를 만들지 못했어요 — 그대로 올리면 자동으로 잘라요'); });
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sheet-hdr-crop]'); if (!b) return;
    var form = formOf(b), fi = form.querySelector('input[type=file]'), files = Array.prototype.slice.call(fi.files || []);
    if (!files.length) return;
    var vals = [], i = 0;
    (function next() {
      if (i >= files.length) { form.querySelector('input[name=crop]').value = vals.join('|'); b.textContent = '자르기 조정됨 ✓'; return; }
      edit(files[i], i, files.length).then(function (v) { if (v === null) return; vals.push(v); i++; next(); });
    })();
  });
})();
