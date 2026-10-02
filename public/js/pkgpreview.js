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
      '<button type="button" class="ph-btn" data-pkp="edit" hidden>수정하기</button>' +
      '<button type="button" class="ph-btn" data-pkp="confirm" hidden>확정하기</button>' +
      '<button type="button" class="ph-btn pri" data-pkp="dl" disabled>다운로드</button>' +
      '<button type="button" class="ph-btn" data-pkp="print" disabled>인쇄</button>' +
      '<button type="button" class="pkp-close" data-pkp="close">닫기</button></div>' +
      '<div class="pkp-sv" hidden></div><div class="pkp-msg" role="status"></div><div class="pkp-pages"></div><div class="pkp-ed" hidden></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) return close();
      var t = e.target.closest('[data-pkp]'); if (!t) return;
      var a = t.getAttribute('data-pkp');
      if (a === 'close') close(); else if (a === 'areas') openAreas(); else if (a === 'edit') askEdit(); else if (a === 'confirm') askConfirm(); else if (a === 'dl') download(); else if (a === 'print') printIt();
    });
    $('.pkp-sv').addEventListener('click', function (e) {
      var t = e.target.closest('[data-sv]'); if (!t) return; var a = t.getAttribute('data-sv');
      if (a === 'regen') { state.mode = 'fresh'; run(); } else if (a === 'ok') doConfirm(); else if (a === 'no') svShow();
    });
    $('[data-pkp="crop"]').addEventListener('change', function () { state.crop = this.checked; run(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && root.classList.contains('on')) close(); });
  }
  function msg(t, bad) { var m = $('.pkp-msg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); m.hidden = !t; }
  function close() { if (root) root.classList.remove('on'); document.body.classList.remove('pkp-open'); state.token++; }


  /* ---- 악보 영역 조정: 자동으로 제목이 안 잘린 악보만, 한 번 지정해 두면 다음부터 자동 ---- */
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function teamOf() { try { return new URL(state.href, location.href).searchParams.get('team') || ''; } catch (e) { return ''; } }
  function edShow(on) { $('.pkp-ed').hidden = !on; $('.pkp-pages').hidden = on; if (!on) { $('.pkp-box').classList.remove('editing'); $('.pkp-ed').classList.remove('edit'); } }
  function openAreas() {
    var ed = $('.pkp-ed'); edShow(true); $('.pkp-box').classList.remove('editing'); ed.classList.remove('edit'); ed.innerHTML = '<p class="pkp-edmsg">악보 목록을 불러오는 중…</p>';
    fetch(state.href.replace('/conti/package.pdf', '/conti/package/areas'), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      var list = (j && j.sheets) || [];
      if (!list.length) { ed.innerHTML = '<p class="pkp-edmsg">이 콘티에 연결된 악보가 없어요.</p><button type="button" class="ph-btn" data-ed="back">돌아가기</button>'; bindEd(); return; }
      ed.innerHTML = '<p class="pkp-edmsg">PDF에서 악보 위의 제목이 지워지지 않은 곡만 골라 주세요. 한 번 지정하면 다음부터는 자동으로 적용돼요.</p>' +
        list.map(function (x, i) { return '<button type="button" class="pkp-edrow" data-ed="pick" data-i="' + i + '"><b>' + esc(x.no) + '</b><span>' + esc(x.title || x.name) + (x.spec ? ' · ' + esc(x.spec) + '페이지' : '') + '</span><em>' + (x.crop ? '지정됨' : '자동') + '</em></button>'; }).join('') +
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
    var ed = $('.pkp-ed'), c = x.crop ? { l: x.crop.l, t: x.crop.t, r: x.crop.r, b: x.crop.b } : { l: 0.03, t: 0.12, r: 0.97, b: 0.97 };
    $('.pkp-box').classList.add('editing'); ed.classList.add('edit');
    var ZOOMS = [1, 1.5, 2, 3, 4], zi = (window.innerWidth < 700 ? 2 : 1), pdfPage = null;
    ed.innerHTML = '<p class="pkp-edmsg"><b>' + esc(x.title || x.name) + '</b> — 오렌지 <b>손잡이</b>를 끌어 악보만 감싸 주세요. 바깥은 인쇄에서 빠져요. <b>＋</b>로 확대해 정확히 맞추고, 손잡이 아닌 곳을 밀면 화면이 움직여요.</p>' +
      '<div class="pkp-edbtns pkp-edtop"><span class="pkp-zm"><button type="button" class="ph-btn" data-ed="zout" aria-label="축소">−</button><b class="pkp-zv"></b><button type="button" class="ph-btn" data-ed="zin" aria-label="확대">＋</button></span>' +
      '<button type="button" class="ph-btn pri" data-ed="save">저장</button><button type="button" class="ph-btn" data-ed="auto">자동으로</button><button type="button" class="ph-btn" data-ed="list">취소</button></div>' +
      '<div class="pkp-edscroll"><div class="pkp-edwrap"><canvas class="pkp-edcv"></canvas><div class="pkp-edbox">' +
      ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'].map(function (h) { return '<i class="hd hd-' + h + '" data-h="' + h + '"></i>'; }).join('') + '</div></div></div>';
    var scroller = ed.querySelector('.pkp-edscroll'), wrap = ed.querySelector('.pkp-edwrap'), cv = ed.querySelector('.pkp-edcv'), box = ed.querySelector('.pkp-edbox'), zv = ed.querySelector('.pkp-zv');
    function paint() {
      box.style.left = (c.l * 100) + '%'; box.style.top = (c.t * 100) + '%'; box.style.width = ((c.r - c.l) * 100) + '%'; box.style.height = ((c.b - c.t) * 100) + '%';
    }
    function renderPage() {
      if (!pdfPage) return;
      zv.textContent = Math.round(ZOOMS[zi] * 100) + '%';
      var vp0 = pdfPage.getViewport({ scale: 1 }), baseW = Math.max(240, scroller.clientWidth - 2), cssW = baseW * ZOOMS[zi], dpr = Math.min(window.devicePixelRatio || 1, 2);
      var vp = pdfPage.getViewport({ scale: cssW / vp0.width * dpr });
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      cv.style.width = Math.floor(vp.width / dpr) + 'px'; cv.style.height = Math.floor(vp.height / dpr) + 'px';
      wrap.style.width = cv.style.width; wrap.style.height = cv.style.height;
      return pdfPage.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
    paint(); zv.textContent = Math.round(ZOOMS[zi] * 100) + '%';
    var pageNo = (function () { var m = /\d+/.exec(x.spec || ''); return m ? +m[0] : 1; })();
    loadPdfjs().then(function (lib) { return lib.getDocument({ url: '/conti/sheets/raw?team=' + encodeURIComponent(teamOf()) + '&row=' + x.row }).promise; })
      .then(function (doc) { return doc.getPage(Math.min(pageNo, doc.numPages)); })
      .then(function (page) { pdfPage = page; return renderPage(); })
      .then(function () { scroller.scrollTop = Math.max(0, c.t * wrap.clientHeight - 40); })
      .catch(function () { scroller.insertAdjacentHTML('beforebegin', '<p class="pkp-edmsg bad">악보를 불러오지 못했어요.</p>'); });
    function zoomTo(n) {
      n = Math.max(0, Math.min(ZOOMS.length - 1, n)); if (n === zi) return;
      var cx = (scroller.scrollLeft + scroller.clientWidth / 2) / wrap.clientWidth, cy = (scroller.scrollTop + scroller.clientHeight / 2) / wrap.clientHeight;
      zi = n;
      Promise.resolve(renderPage()).then(function () { scroller.scrollLeft = cx * wrap.clientWidth - scroller.clientWidth / 2; scroller.scrollTop = cy * wrap.clientHeight - scroller.clientHeight / 2; });
    }
    // 손잡이(변 · 모서리)만 끌림 — 나머지 곳은 그대로 스크롤(밀어서 이동)
    var MIN = 0.06, drag = null;
    box.addEventListener('pointerdown', function (e) {
      var h = e.target.getAttribute && e.target.getAttribute('data-h'); if (!h) return;
      drag = { sides: h.split(''), el: e.target }; try { e.target.setPointerCapture(e.pointerId); } catch (er) {} e.preventDefault();
    });
    box.addEventListener('pointermove', function (e) {
      if (!drag) return; var r = wrap.getBoundingClientRect(), fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      drag.sides.forEach(function (k) {
        if (k === 'l') c.l = Math.min(fx, c.r - MIN); else if (k === 'r') c.r = Math.max(fx, c.l + MIN);
        else if (k === 't') c.t = Math.min(fy, c.b - MIN); else c.b = Math.max(fy, c.t + MIN);
      });
      paint();
      // 화면 가장자리에 닿으면 같이 스크롤
      var sr = scroller.getBoundingClientRect(), pad = 36;
      if (e.clientY > sr.bottom - pad) scroller.scrollTop += 14; else if (e.clientY < sr.top + pad) scroller.scrollTop -= 14;
      if (e.clientX > sr.right - pad) scroller.scrollLeft += 14; else if (e.clientX < sr.left + pad) scroller.scrollLeft -= 14;
    });
    function end() { drag = null; }
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    function save(v) {
      var body = new URLSearchParams({ team: teamOf(), __row: x.row, crop: v ? [c.l, c.t, c.r, c.b].map(function (n) { return n.toFixed(4); }).join(',') : '' });
      fetch('/conti/sheets/crop', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
        .then(function (r) { if (!r.ok) throw new Error('x'); edShow(false); run(); })
        .catch(function () { ed.insertAdjacentHTML('afterbegin', '<p class="pkp-edmsg bad">저장하지 못했어요. 다시 해 주세요.</p>'); });
    }
    ed.onclick = function (e) {
      var t = e.target.closest('[data-ed]'); if (!t) return; var a = t.getAttribute('data-ed');
      if (a === 'save') save(true); else if (a === 'auto') save(false); else if (a === 'list') openAreas(); else if (a === 'zin') zoomTo(zi + 1); else if (a === 'zout') zoomTo(zi - 1);
    };
  }

  function nameFromHeaders(r) {
    var cd = r.headers.get('content-disposition') || '', m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    try { return m ? decodeURIComponent(m[1]) : state.name; } catch (e) { return state.name; }
  }


  /* ---- 확정: 한 번 만들어 확정하면 다음부터는 만들지 않고 바로 내려받음 ---- */
  function baseQs() { var q = new URLSearchParams(state.href.replace(/^[^?]*\?/, '')); q.delete('crop'); return q; }
  function fmtAt(iso) { try { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } }
  function svHide() { var e = $('.pkp-sv'); e.hidden = true; e.innerHTML = ''; }
  // 지금 상태에 맞는 안내 줄 · 버튼
  function svShow() {
    var e = $('.pkp-sv'); e.hidden = false; e.className = 'pkp-sv';
    $('[data-pkp="edit"]').hidden = state.mode !== 'saved';
    $('[data-pkp="confirm"]').hidden = state.mode !== 'fresh';
    if (state.mode === 'saved') {
      var i = state.savedInfo || {};
      e.innerHTML = '<b>확정된 PDF</b> · ' + esc(i.by || '') + ' · ' + esc(fmtAt(i.at)) + (i.stale ? '<span class="warn">확정 이후 콘티 · 악보 · 편성이 바뀌었어요. “수정하기”로 다시 만들어 확정해 주세요.</span>' : '<span>바로 다운로드돼요.</span>');
      if (i.stale) e.classList.add('stale');
    } else if (state.mode === 'fresh') {
      e.innerHTML = '<span>미리보기예요. 확인한 뒤 <b>확정하기</b>를 누르면 다음부터는 만들지 않고 바로 다운로드돼요.</span>';
    } else svHide();
  }
  function askConfirm() {
    var e = $('.pkp-sv'); e.hidden = false; e.className = 'pkp-sv ask';
    e.innerHTML = '<span>이 PDF로 확정할까요? 확정하면 다음부터 바로 다운로드돼요. (콘티가 바뀌면 나중에 수정할 수 있어요)' + (state.savedInfo ? ' 기존 확정본은 이 PDF로 바뀌어요.' : '') + '</span><button type="button" class="ph-btn pri" data-sv="ok">확정</button><button type="button" class="ph-btn" data-sv="no">취소</button>';
  }
  function askEdit() {
    var e = $('.pkp-sv'); e.hidden = false; e.className = 'pkp-sv ask';
    e.innerHTML = '<span>수정하려면 PDF를 새로 만들어요. 새로 만든 뒤 <b>확정하기</b>를 눌러야 기존 확정본이 바뀌어요. 계속할까요?</span><button type="button" class="ph-btn pri" data-sv="regen">새로 만들기</button><button type="button" class="ph-btn" data-sv="no">취소</button>';
  }
  function doConfirm() {
    var e = $('.pkp-sv'); e.innerHTML = '<span>확정하는 중…</span>';
    var body = baseQs(); body.set('job', state.jobId || '');
    fetch('/conti/package/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, j: j }; }); })
      .then(function (v) {
        if (!v.ok) { svShow(); e.insertAdjacentHTML('beforeend', '<span class="warn">' + esc((v.j && v.j.msg) || '확정하지 못했어요.') + '</span>'); return; }
        state.mode = 'saved'; state.savedInfo = { by: v.j.by, at: v.j.at, stale: false }; svShow();
      }).catch(function () { svShow(); e.insertAdjacentHTML('beforeend', '<span class="warn">확정하지 못했어요. 다시 해 주세요.</span>'); });
  }
  function openFlow() {
    state.mode = ''; state.savedInfo = null; state.jobId = ''; svHide();
    $('[data-pkp="edit"]').hidden = true; $('[data-pkp="confirm"]').hidden = true;
    var my = ++state.token; setBar(4, '확정된 PDF가 있는지 확인하는 중'); $('.pkp-pages').innerHTML = '';
    fetch('/conti/package/saved?' + baseQs().toString(), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (my !== state.token) return;
      if (j && j.saved) return loadSaved(j, my);
      run();
    }).catch(function () { if (my === state.token) run(); });
  }
  function loadSaved(info, my) {
    state.mode = 'saved'; state.savedInfo = info; svShow(); setBar(40, '확정된 PDF를 불러오는 중');
    return fetch('/conti/package.pdf?saved=1&' + baseQs().toString(), { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('gone'); state.name = nameFromHeaders(r); return r.blob();
    }).then(function (blob) {
      if (my !== state.token) return;
      state.blob = blob; $('[data-pkp="dl"]').disabled = false; $('[data-pkp="print"]').disabled = false;
      msg('미리보는 중…');
      return Promise.all([loadPdfjs(), blob.arrayBuffer()]).then(function (v) { return v[0].getDocument({ data: new Uint8Array(v[1]) }).promise; }).then(function (doc) { return render(doc, my); });
    }).catch(function () { if (my !== state.token) return; state.mode = ''; state.savedInfo = null; svHide(); run(); });   // 확정본을 못 읽으면 새로 만듦
  }

  function setBar(pct, label) {
    var m = $('.pkp-msg'); m.hidden = false; m.classList.remove('bad');
    m.innerHTML = '<div class="pkp-prog"><div class="pkp-progbar"><i style="width:' + Math.max(3, pct) + '%"></i></div><div class="pkp-proginfo"><b>' + Math.round(pct) + '%</b><span>' + esc(label || '') + '</span></div></div>';
  }
  function fail() { msg('PDF를 만들지 못했어요. 잠시 뒤 다시 해 주세요. (계속 안 되면 "악보 위 제목 자르기"를 끄고 해 보세요)', true); }

  function run() {
    var my = ++state.token;
    $('[data-pkp="dl"]').disabled = true; $('[data-pkp="print"]').disabled = true;
    $('.pkp-pages').innerHTML = ''; state.blob = null; state.jobId = '';
    state.mode = ''; $('[data-pkp="edit"]').hidden = true; $('[data-pkp="confirm"]').hidden = true; svHide();
    setBar(2, '시작하는 중');
    var qs = state.href.replace(/^[^?]*\?/, '') + (state.crop ? '' : '&crop=0');
    var t0 = Date.now(), shown = 2;
    // 서버가 진행률을 알려 줘요. 화면의 숫자는 서버 값과 시간 경과 중 큰 쪽(작업 구간 사이에도 멈춘 것처럼 보이지 않게 조금씩 올라감)
    fetch('/conti/package/start?' + qs, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('start'); return r.json(); }).then(function (j) {
      var id = j.id, label = '준비 중', server = 0;
      return new Promise(function (ok, no) {
        var anim = setInterval(function () {
          if (my !== state.token) { clearInterval(anim); return; }
          var floor = Math.min(server + 6, 95), want = Math.max(server, Math.min(floor, shown + 0.6));
          if (want > shown) { shown = want; setBar(shown, label + ' · ' + Math.round((Date.now() - t0) / 1000) + '초'); }
        }, 400);
        (function poll() {
          if (my !== state.token) { clearInterval(anim); return ok(null); }
          if (Date.now() - t0 > 180000) { clearInterval(anim); return no(new Error('timeout')); }
          fetch('/conti/package/status?id=' + id, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('gone'); return r.json(); }).then(function (st) {
            if (st.err) { clearInterval(anim); return no(new Error('fail')); }
            server = Math.max(server, st.pct); label = st.label || label;
            if (server > shown) shown = server;
            setBar(shown, label + ' · ' + Math.round((Date.now() - t0) / 1000) + '초');
            if (st.done) { clearInterval(anim); return ok(id); }
            setTimeout(poll, 500);
          }).catch(function (e) { clearInterval(anim); no(e); });
        })();
      });
    }).then(function (id) {
      if (!id || my !== state.token) return;
      setBar(99, '불러오는 중'); state.jobId = id;
      return fetch('/conti/package.pdf?team=' + encodeURIComponent(teamOf()) + '&job=' + id, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('http'); state.name = nameFromHeaders(r); return r.blob();
      }).then(function (blob) {
        if (my !== state.token) return;
        state.blob = blob; state.mode = 'fresh'; svShow();
        $('[data-pkp="dl"]').disabled = false; $('[data-pkp="print"]').disabled = false;
        msg('미리보는 중…');
        return Promise.all([loadPdfjs(), blob.arrayBuffer()]).then(function (v) { return v[0].getDocument({ data: new Uint8Array(v[1]) }).promise; })
          .then(function (doc) { return render(doc, my); });
      });
    }).catch(function () { if (my === state.token) fail(); });
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
    openFlow();
  });
})();
