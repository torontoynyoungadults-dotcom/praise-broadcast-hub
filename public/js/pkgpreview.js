/* 인쇄용 PDF 패키지 — 버튼을 누르면 화면 안에서 "만드는 중…" → 미리보기(쪽마다) 를 보여 주고, 다운로드 · 인쇄 · 자르기 끄기/켜기를 할 수 있어요.
   (새 탭에 PDF 를 바로 열면 휴대폰 · 앱 브라우저에서 하얀 화면만 나오는 경우가 있어서 pdf.js 로 직접 그립니다.) */
(function () {
  if (window.__phPkgPreview) return; window.__phPkgPreview = true;
  var root = null, state = { href: '', crop: true, blob: null, name: 'worship-package.pdf', token: 0 };
  var pdfLoad = null;

  function loadPdfjs() {
    if (window.pdfjsLib) { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; } catch (e) {} return Promise.resolve(window.pdfjsLib); }
    if (pdfLoad) return pdfLoad;
    pdfLoad = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = '/vendor/pdfjs/pdf.min.js';
      s.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; ok(window.pdfjsLib); } catch (e) { no(e); } };
      s.onerror = function () { pdfLoad = null; no(new Error('load')); };
      document.head.appendChild(s);
    });
    return pdfLoad;
  }
  function $(sel) { return root.querySelector(sel); }

  function build() {
    root = document.createElement('div');
    root.className = 'pkp-back';
    root.innerHTML = '<div class="pkp-box" role="dialog" aria-modal="true" aria-label="인쇄용 PDF 패키지">' +
      '<div class="pkp-bar"><b class="pkp-ttl">인쇄용 PDF 패키지</b>' +
      '<label class="pkp-crop"><input type="checkbox" data-pkp="crop" checked> 악보 위 제목 자르기</label>' +
      '<button type="button" class="ph-btn" data-pkp="areas">악보 영역 조정</button>' +
      '<button type="button" class="ph-btn pri" data-pkp="dl" disabled>다운로드</button>' +
      '<button type="button" class="ph-btn" data-pkp="print" disabled>인쇄</button>' +
      '<button type="button" class="pkp-close" data-pkp="close">닫기</button></div>' +
      '<div class="pkp-msg" role="status"></div><div class="pkp-pages"></div><div class="pkp-ed" hidden></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) return close();
      var t = e.target.closest('[data-pkp]'); if (!t) return;
      var a = t.getAttribute('data-pkp');
      if (a === 'close') close(); else if (a === 'areas') openAreas(); else if (a === 'dl') download(); else if (a === 'print') printIt();
    });
    $('[data-pkp="crop"]').addEventListener('change', function () { state.crop = this.checked; run(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && root.classList.contains('on')) close(); });
  }
  function msg(t, bad) { var m = $('.pkp-msg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); m.hidden = !t; }
  function close() { if (root) root.classList.remove('on'); document.body.classList.remove('pkp-open'); state.token++; }


  /* ---- 악보 영역 조정: 자동으로 제목이 안 잘린 악보만, 한 번 지정해 두면 다음부터 자동 ---- */
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function teamOf() { try { return new URL(state.href, location.href).searchParams.get('team') || ''; } catch (e) { return ''; } }
  function edShow(on) { $('.pkp-ed').hidden = !on; $('.pkp-pages').hidden = on; }
  function openAreas() {
    var ed = $('.pkp-ed'); edShow(true); ed.innerHTML = '<p class="pkp-edmsg">악보 목록을 불러오는 중…</p>';
    fetch(state.href.replace('/conti/package.pdf', '/conti/package/areas'), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      var list = (j && j.sheets) || [];
      if (!list.length) { ed.innerHTML = '<p class="pkp-edmsg">이 콘티에 연결된 악보가 없어요.</p><button type="button" class="ph-btn" data-ed="back">돌아가기</button>'; bindEd(); return; }
      ed.innerHTML = '<p class="pkp-edmsg">PDF에서 악보 위의 제목이 지워지지 않은 곡만 골라 주세요. 한 번 지정하면 다음부터는 자동으로 적용돼요.</p>' +
        list.map(function (x, i) { return '<button type="button" class="pkp-edrow" data-ed="pick" data-i="' + i + '"><b>' + esc(x.no) + '</b><span>' + esc(x.title || x.name) + (x.spec ? ' · ' + esc(x.spec) + '페이지' : '') + '</span><em>' + (x.top ? '지정됨' : '자동') + '</em></button>'; }).join('') +
        '<button type="button" class="ph-btn" data-ed="back">돌아가기</button>';
      ed._list = list; bindEd();
    }).catch(function () { ed.innerHTML = '<p class="pkp-edmsg">목록을 불러오지 못했어요.</p><button type="button" class="ph-btn" data-ed="back">돌아가기</button>'; bindEd(); });
  }
  function bindEd() {
    var ed = $('.pkp-ed');
    ed.onclick = function (e) {
      var t = e.target.closest('[data-ed]'); if (!t) return;
      var a = t.getAttribute('data-ed');
      if (a === 'back') edShow(false); else if (a === 'pick') editOne(ed._list[+t.getAttribute('data-i')]);
      else if (a === 'list') openAreas();
    };
  }
  function editOne(x) {
    var ed = $('.pkp-ed'), top = x.top || 0;
    ed.innerHTML = '<p class="pkp-edmsg"><b>' + esc(x.title || x.name) + '</b> — 오렌지 선을 끌어서 <b>악보가 시작되는 곳</b>에 맞춰 주세요. 선 위쪽은 인쇄에서 빠져요.</p>' +
      '<div class="pkp-edwrap"><canvas class="pkp-edcv"></canvas><div class="pkp-edcut"></div><div class="pkp-edline" role="slider" aria-label="악보 시작 위치"><i></i></div></div>' +
      '<div class="pkp-edbtns"><button type="button" class="ph-btn pri" data-ed="save">저장하고 다시 만들기</button><button type="button" class="ph-btn" data-ed="auto">자동으로 되돌리기</button><button type="button" class="ph-btn" data-ed="list">취소</button></div>';
    var wrap = ed.querySelector('.pkp-edwrap'), cv = ed.querySelector('.pkp-edcv'), line = ed.querySelector('.pkp-edline'), cut = ed.querySelector('.pkp-edcut');
    function setTop(v) { top = Math.max(0, Math.min(0.85, v)); line.style.top = (top * 100) + '%'; cut.style.height = (top * 100) + '%'; line.classList.toggle('on', top > 0); }
    setTop(top || 0.12);
    var pageNo = (function () { var m = /\d+/.exec(x.spec || ''); return m ? +m[0] : 1; })();
    loadPdfjs().then(function (lib) { return lib.getDocument({ url: '/conti/sheets/raw?team=' + encodeURIComponent(teamOf()) + '&row=' + x.row }).promise; })
      .then(function (doc) { return doc.getPage(Math.min(pageNo, doc.numPages)); })
      .then(function (page) {
        var vp0 = page.getViewport({ scale: 1 }), cw = Math.min(wrap.clientWidth || 560, 720), dpr = Math.min(window.devicePixelRatio || 1, 2), vp = page.getViewport({ scale: cw / vp0.width * dpr });
        cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height); cv.style.width = Math.floor(vp.width / dpr) + 'px'; cv.style.height = Math.floor(vp.height / dpr) + 'px';
        return page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      }).catch(function () { wrap.insertAdjacentHTML('beforebegin', '<p class="pkp-edmsg bad">악보를 불러오지 못했어요.</p>'); });
    var drag = false;
    function at(e) { var r = wrap.getBoundingClientRect(); setTop((e.clientY - r.top) / r.height); }
    wrap.addEventListener('pointerdown', function (e) { drag = true; try { wrap.setPointerCapture(e.pointerId); } catch (er) {} at(e); e.preventDefault(); });
    wrap.addEventListener('pointermove', function (e) { if (drag) at(e); });
    wrap.addEventListener('pointerup', function () { drag = false; });
    wrap.addEventListener('pointercancel', function () { drag = false; });
    function save(v) {
      var body = new URLSearchParams({ team: teamOf(), __row: x.row, top: v ? v.toFixed(4) : '0' });
      fetch('/conti/sheets/crop', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
        .then(function (r) { if (!r.ok) throw new Error('x'); edShow(false); run(); })
        .catch(function () { ed.insertAdjacentHTML('afterbegin', '<p class="pkp-edmsg bad">저장하지 못했어요. 다시 해 주세요.</p>'); });
    }
    ed.onclick = function (e) {
      var t = e.target.closest('[data-ed]'); if (!t) return; var a = t.getAttribute('data-ed');
      if (a === 'save') save(top); else if (a === 'auto') save(0); else if (a === 'list') openAreas();
    };
  }

  function nameFromHeaders(r) {
    var cd = r.headers.get('content-disposition') || '', m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    try { return m ? decodeURIComponent(m[1]) : state.name; } catch (e) { return state.name; }
  }

  function run() {
    var my = ++state.token;
    $('[data-pkp="dl"]').disabled = true; $('[data-pkp="print"]').disabled = true;
    $('.pkp-pages').innerHTML = ''; state.blob = null;
    msg('PDF를 만드는 중이에요… (곡이 많으면 10~30초 걸려요)');
    var url = state.href + (state.crop ? '' : '&crop=0');
    var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 120000);
    var t0 = Date.now(), tick = setInterval(function () { if (my !== state.token) return clearInterval(tick); if ($('.pkp-msg').textContent.indexOf('만드는 중') === 0) msg('PDF를 만드는 중이에요… ' + Math.round((Date.now() - t0) / 1000) + '초 (곡이 많거나 악보가 크면 조금 걸려요)'); }, 1000);
    fetch(url, { credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(tm); clearInterval(tick); if (!r.ok) throw new Error('http'); state.name = nameFromHeaders(r); return r.blob(); })
      .then(function (blob) {
        if (my !== state.token) return;
        state.blob = blob;
        $('[data-pkp="dl"]').disabled = false; $('[data-pkp="print"]').disabled = false;
        msg('미리보는 중…');
        return Promise.all([loadPdfjs(), blob.arrayBuffer()]).then(function (v) { return v[0].getDocument({ data: new Uint8Array(v[1]) }).promise; })
          .then(function (doc) { return render(doc, my); });
      })
      .catch(function () { clearTimeout(tm); clearInterval(tick); if (my === state.token) msg('PDF를 만들지 못했어요. 잠시 뒤 다시 해 주세요. (계속 안 되면 "악보 위 제목 자르기"를 끄고 해 보세요)', true); });
  }

  function render(doc, my) {
    var host = $('.pkp-pages'); var n = doc.numPages, i = 1;
    var width = Math.min(host.clientWidth || 600, 820) - 4;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    function next() {
      if (my !== state.token) return;
      if (i > n) { msg(''); return; }
      msg('미리보기 ' + (i - 1) + ' / ' + n);
      return doc.getPage(i).then(function (page) {
        var vp0 = page.getViewport({ scale: 1 }), sc = width / vp0.width, vp = page.getViewport({ scale: sc * dpr });
        var wrap = document.createElement('div'); wrap.className = 'pkp-page';
        var c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        c.style.width = Math.floor(vp.width / dpr) + 'px'; c.style.height = Math.floor(vp.height / dpr) + 'px';
        var lab = document.createElement('small'); lab.textContent = i + ' / ' + n;
        wrap.appendChild(c); wrap.appendChild(lab); host.appendChild(wrap);
        return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }).then(function () { i++; return next(); });
    }
    return next();
  }

  function download() {
    if (!state.blob) return;
    var url = URL.createObjectURL(state.blob);
    var a = document.createElement('a'); a.href = url; a.download = /\.pdf$/i.test(state.name) ? state.name : state.name + '.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }
  function printIt() {
    if (!state.blob) return;
    var url = URL.createObjectURL(state.blob);
    var w = window.open(url, '_blank');
    if (!w) download();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-pkg-open]') : null;
    if (!b) return;
    e.preventDefault();
    if (!root) build();
    state.href = b.getAttribute('data-href'); state.crop = true;
    $('[data-pkp="crop"]').checked = true;
    $('.pkp-ttl').textContent = b.getAttribute('data-title') || '인쇄용 PDF 패키지';
    root.classList.add('on'); document.body.classList.add('pkp-open');
    run();
  });
})();
