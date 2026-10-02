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
      '<button type="button" class="ph-btn pri" data-pkp="dl" disabled>다운로드</button>' +
      '<button type="button" class="ph-btn" data-pkp="print" disabled>인쇄</button>' +
      '<button type="button" class="pkp-close" data-pkp="close">닫기</button></div>' +
      '<div class="pkp-msg" role="status"></div><div class="pkp-pages"></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) return close();
      var t = e.target.closest('[data-pkp]'); if (!t) return;
      var a = t.getAttribute('data-pkp');
      if (a === 'close') close(); else if (a === 'dl') download(); else if (a === 'print') printIt();
    });
    $('[data-pkp="crop"]').addEventListener('change', function () { state.crop = this.checked; run(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && root.classList.contains('on')) close(); });
  }
  function msg(t, bad) { var m = $('.pkp-msg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); m.hidden = !t; }
  function close() { if (root) root.classList.remove('on'); document.body.classList.remove('pkp-open'); state.token++; }

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
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http'); state.name = nameFromHeaders(r); return r.blob(); })
      .then(function (blob) {
        if (my !== state.token) return;
        state.blob = blob;
        $('[data-pkp="dl"]').disabled = false; $('[data-pkp="print"]').disabled = false;
        msg('미리보는 중…');
        return Promise.all([loadPdfjs(), blob.arrayBuffer()]).then(function (v) { return v[0].getDocument({ data: new Uint8Array(v[1]) }).promise; })
          .then(function (doc) { return render(doc, my); });
      })
      .catch(function () { if (my === state.token) msg('PDF를 만들지 못했어요. 잠시 뒤 다시 해 주세요.', true); });
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
