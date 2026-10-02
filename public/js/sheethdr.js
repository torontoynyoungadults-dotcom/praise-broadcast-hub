/* 악보 올리기 — "헤더 자동 추가" 체크 시 "자르기 조정" 버튼이 나타나고, 올릴 파일의 첫 쪽에서 위 · 아래 · 왼쪽 · 오른쪽을 직접 끌어 맞출 수 있어요.
   자동 인식 영역(서버)에서 시작하며, 결과는 숨은 칸 crop("l,t,r,b" 를 파일 순서대로 | 로 이음)에 담겨 올리기와 함께 전송됩니다. 체크를 끄면 올린 그대로. */
(function () {
  if (window.__phSheetHdr) return; window.__phSheetHdr = true;
  var MIN = 0.08, root = null;

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
  /* 파일 첫 쪽 → canvas (PDF 는 pdf.js, 사진은 그대로) */
  function firstPage(file) {
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      return loadPdfJs().then(function (lib) { return file.arrayBuffer().then(function (b) { return lib.getDocument({ data: b }).promise; }); })
        .then(function (doc) { return doc.getPage(1); })
        .then(function (pg) {
          var vp0 = pg.getViewport({ scale: 1 }), sc = Math.min(1.6, 900 / vp0.width), vp = pg.getViewport({ scale: sc });
          var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          return pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () { return c; });
        });
    }
    return new Promise(function (ok, no) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () { var s = Math.min(1, 1100 / img.width), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c); };
      img.onerror = function () { no(new Error('img')); }; img.src = u;
    });
  }
  function autoBox(file) {
    var fd = new FormData(); fd.append('파일', file);
    return fetch('/conti/sheets/detect', { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { return j && j.box ? j.box : null; }).catch(function () { return null; });
  }

  function close() { if (root) { root.remove(); root = null; } }
  /* 파일 하나의 자르기 편집 — 완료되면 "l,t,r,b" (전체면 '') 로 resolve, 취소하면 null */
  function edit(file, idx, total) {
    return new Promise(function (done) {
      root = document.createElement('div'); root.className = 'ss-back on';
      root.innerHTML = '<div class="ss-box hdr-box"><div class="hdr-top"><b></b><span>모서리·변을 끌어 악보 영역을 맞추세요 (이 안만 남아요)</span></div>' +
        '<div class="hdr-stage"><div class="hdr-wrap"><div class="hdr-box-area"></div></div></div>' +
        '<div class="hdr-act"><button type="button" class="ph-btn" data-a="auto">자동 영역</button><button type="button" class="ph-btn" data-a="all">전체 쪽</button>' +
        '<span style="flex:1"></span><button type="button" class="ph-btn" data-a="x">취소</button><button type="button" class="ph-btn pri" data-a="ok">적용</button></div></div>';
      document.body.appendChild(root);
      root.querySelector('.hdr-top b').textContent = (file.name || '악보') + (total > 1 ? '  (' + (idx + 1) + '/' + total + ')' : '');
      var wrap = root.querySelector('.hdr-wrap'), area = root.querySelector('.hdr-box-area'), cur = { l: 0, t: 0, r: 1, b: 1 }, auto = null;
      function paint() {
        area.style.left = cur.l * 100 + '%'; area.style.top = cur.t * 100 + '%'; area.style.width = (cur.r - cur.l) * 100 + '%'; area.style.height = (cur.b - cur.t) * 100 + '%';
      }
      ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'].forEach(function (k) { var h = document.createElement('i'); h.className = 'hdr-h hdr-' + k; h.dataset.k = k; area.appendChild(h); });
      area.addEventListener('pointerdown', function (e) {
        var k = e.target.dataset && e.target.dataset.k; if (!k) return;
        e.preventDefault(); try { area.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
        var rect = wrap.getBoundingClientRect();
        function mv(ev) {
          var x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)), y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
          if (k.indexOf('l') >= 0) cur.l = Math.min(x, cur.r - MIN);
          if (k.indexOf('r') >= 0) cur.r = Math.max(x, cur.l + MIN);
          if (k.indexOf('t') >= 0) cur.t = Math.min(y, cur.b - MIN);
          if (k.indexOf('b') >= 0) cur.b = Math.max(y, cur.t + MIN);
          paint();
        }
        function up() { area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up); area.removeEventListener('pointercancel', up); }
        area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up); area.addEventListener('pointercancel', up);
      });
      root.addEventListener('click', function (e) {
        var a = e.target.dataset && e.target.dataset.a; if (!a) return;
        if (a === 'x') { close(); done(null); }
        else if (a === 'all') { cur = { l: 0, t: 0, r: 1, b: 1 }; paint(); }
        else if (a === 'auto') { if (auto) { cur = { l: auto.l, t: auto.t, r: auto.r, b: auto.b }; paint(); } }
        else if (a === 'ok') {
          var full = cur.l < 0.002 && cur.t < 0.002 && cur.r > 0.998 && cur.b > 0.998;
          close(); done(full ? 'all' : [cur.l, cur.t, cur.r, cur.b].map(function (v) { return v.toFixed(4); }).join(','));
        }
      });
      firstPage(file).then(function (c) {
        c.style.cssText = 'display:block;width:100%;height:auto'; wrap.insertBefore(c, area);
        return autoBox(file);
      }).then(function (b) { auto = b; if (b) cur = { l: b.l, t: b.t, r: b.r, b: b.b }; paint(); })
        .catch(function () { root && (root.querySelector('.hdr-top span').textContent = '미리보기를 만들지 못했어요 — 그대로 올리면 자동으로 잘라요'); });
      paint();
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sheet-hdr-crop]'); if (!b) return;
    var form = formOf(b), fi = form.querySelector('input[type=file]'), files = Array.prototype.slice.call(fi.files || []);
    if (!files.length) return;
    var vals = [], i = 0;
    (function next() {
      if (i >= files.length) { form.querySelector('input[name=crop]').value = vals.map(function (v) { return v === 'all' ? '0,0,1,1' : v; }).join('|'); b.textContent = '자르기 조정됨 ✓'; return; }
      edit(files[i], i, files.length).then(function (v) { if (v === null) return; vals.push(v); i++; next(); });
    })();
  });
})();
