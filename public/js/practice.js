/**
 * 연습 화면 — 라이브 악보 보기(필기 포함) · 송폼 · 메트로놈 · 시작음 · 함께.
 * church-app의 연습 화면(pv)을 참고해 구성 — 오른쪽 패널(5개 탭)이 왼쪽 악보 화면과 나란히 있고,
 * 같은 방(team+date)에 있는 모든 기기와 Socket.io로 곡 선택·악보·페이지·메트로놈·필기·큐가 실시간으로 오갑니다.
 * - 필기: 캔버스에 펜/형광펜/지우개로 그리기, 저장은 서버(악보필기 시트)에 "이 악보" 단위로, 그리는 즉시 같은 방 사람들에게도 중계
 * - 송폼: public/js/formb.js(YNForm)의 mountPlayer를 그대로 재사용 + 자주 쓰는 큐 버튼(Repeat Chorus 등, 방 전체에 알림)
 * - 메트로놈: 기존 그대로(모든 기기 공유 BPM)
 * - 시작음: 곡의 Key로 기준음을 들려주는 작은 신디사이저(church-app의 pitch.js 자리, 화성 코드 인식·OCR은 이번엔 제외)
 * - 함께: 지금 접속한 사람 · 페이지 컨트롤(내가 넘기면 "따라가기" 켠 사람 화면도 같이 넘어감) · 큐 받기/보내기
 */
(function () {
  var DATA = window.PV_DATA || { room: '', team: '', date: '', memberName: '', songs: [], sheets: [], annoLoadUrl: '', annoSaveUrl: '' };

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function $(id) { return document.getElementById(id); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ============================================================ 공유 상태(Socket.io) */
  var room = { songIdx: 0, sheetId: null, page: 1, metro: { bpm: 80, running: false, startedAt: 0 } };
  var local = { songIdx: 0, sheetId: null, page: 1 }; // 내가 실제로 보고 있는 것(따라가기 꺼져 있으면 room과 다를 수 있음)
  var follow = lsGet('yn.pv.follow', '1') === '1';
  var sendCueToRoom = lsGet('yn.pv.cue.send', '1') === '1';
  var receiveCue = lsGet('yn.pv.cue.recv', '1') === '1';

  var socket = (typeof io === 'function') ? io() : null;
  var rosterNames = [];
  if (socket) {
    socket.on('connect', function () { socket.emit('join', { room: DATA.room, name: DATA.memberName }); });
    socket.on('state', function (s) {
      room = s;
      if (follow) { local.songIdx = room.songIdx; local.sheetId = room.sheetId; local.page = room.page || 1; }
      renderSongTabs(); renderSheetPicker(); renderStage();
      syncMetro();
      if (activeTab === 'metro') renderPanel();
      if (activeTab === 'together') renderPanel();
    });
    socket.on('roster', function (names) { rosterNames = names || []; if (activeTab === 'together') renderPanel(); });
    socket.on('cue', function (payload) {
      if (!receiveCue) return;
      showCueToast((payload && payload.by ? payload.by + ' — ' : '') + (payload && payload.text || ''));
    });
    socket.on('anno:stroke', function (stroke) { if (stroke && stroke.sheetId === local.sheetId) { addRemoteStroke(stroke); } });
  }
  function sendUpdate(patch) {
    Object.assign(room, patch, patch.metro ? { metro: Object.assign({}, room.metro, patch.metro) } : {});
    Object.assign(local, patch);
    if (socket) socket.emit('update', patch);
  }
  /** "내가 페이지 컨트롤 하기" — 지금 내가 보고 있는 걸 방의 공식 상태로 삼고, 나도 따라가기를 켬(내 조작과 안 어긋나게) */
  function takeControl() {
    follow = true; lsSet('yn.pv.follow', '1');
    sendUpdate({ songIdx: local.songIdx, sheetId: local.sheetId, page: local.page });
    if (activeTab === 'together') renderPanel();
  }

  function showCueToast(text) {
    var box = $('pv-cuetoast');
    if (!box) { box = document.createElement('div'); box.id = 'pv-cuetoast'; box.className = 'pv-cuetoast'; document.body.appendChild(box); }
    var el = document.createElement('div'); el.className = 'pv-cuetoast-item'; el.textContent = text;
    box.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 2600);
  }

  /* ============================================================ 곡 탭 + 악보 선택 */
  function currentSong() { return DATA.songs[local.songIdx] || null; }
  function currentSheet() { return local.sheetId ? DATA.sheets.filter(function (x) { return x.id === local.sheetId; })[0] : null; }

  function renderSongTabs() {
    var tabs = $('pv-songtabs');
    if (!tabs) return;
    if (!DATA.songs.length) { tabs.innerHTML = '<p class="ph-sub">오늘 등록된 곡이 없어요.</p>'; return; }
    tabs.innerHTML = DATA.songs.map(function (s, i) {
      return '<button type="button" class="pv-tab' + (i === local.songIdx ? ' on' : '') + '" data-i="' + i + '">' + esc(s.title) + '</button>';
    }).join('');
    Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
      b.onclick = function () {
        local.songIdx = Number(b.dataset.i); local.sheetId = null; local.page = 1;
        if (follow) sendUpdate({ songIdx: local.songIdx, sheetId: null, page: 1 }); else { renderSongTabs(); renderSheetPicker(); renderStage(); }
        if (activeTab === 'form') renderPanel();
        if (activeTab === 'pitch') renderPanel();
      };
    });
  }

  function renderSheetPicker() {
    var picker = $('pv-sheetpicker');
    if (!picker) return;
    picker.innerHTML = DATA.sheets.length
      ? '<div class="pv-sheetlist">' + DATA.sheets.map(function (s) {
        return '<button type="button" class="pv-sheetbtn' + (local.sheetId === s.id ? ' on' : '') + '" data-id="' + s.id + '">📄 ' + esc(s.title) + '</button>';
      }).join('') + (local.sheetId ? '<button type="button" class="pv-sheetbtn" id="pv-sheetclose">✕ 악보 닫기</button>' : '') + '</div>'
      : '<p class="ph-sub">이번 주에 올라온 악보가 없어요.</p>';
    Array.prototype.forEach.call(picker.querySelectorAll('.pv-sheetbtn[data-id]'), function (b) {
      b.onclick = function () {
        var id = b.dataset.id; local.sheetId = (local.sheetId === id) ? null : id; local.page = 1;
        if (follow) sendUpdate({ sheetId: local.sheetId, page: 1 }); else { renderSheetPicker(); renderStage(); }
      };
    });
    var closeBtn = $('pv-sheetclose');
    if (closeBtn) closeBtn.onclick = function () { local.sheetId = null; if (follow) sendUpdate({ sheetId: null }); else { renderSheetPicker(); renderStage(); } };
  }

  /* ============================================================ 무대(악보) — PDF.js 또는 사진, + 필기 캔버스 */
  var pdfLib = null, pdfDoc = null, pdfLoadedForSheet = null;
  function ensurePdfJs() {
    if (pdfLib) return Promise.resolve(pdfLib);
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      el.onload = function () {
        try {
          pdfLib = window.pdfjsLib;
          pdfLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
          resolve(pdfLib);
        } catch (e) { reject(e); }
      };
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }

  function pageCount() { return pdfDoc ? pdfDoc.numPages : 1; }

  function renderPageNav() {
    var nav = $('pv-pagenav');
    if (!nav) return;
    var sheet = currentSheet();
    if (!sheet || sheet.kind === 'image' || pageCount() <= 1) { nav.innerHTML = ''; return; }
    nav.innerHTML = '<button type="button" class="ph-icon-btn" id="pv-pageprev">‹</button>' +
      '<span class="pv-pagelabel">' + local.page + ' / ' + pageCount() + '</span>' +
      '<button type="button" class="ph-icon-btn" id="pv-pagenext">›</button>';
    $('pv-pageprev').onclick = function () { goPage(local.page - 1); };
    $('pv-pagenext').onclick = function () { goPage(local.page + 1); };
  }
  function goPage(n) {
    n = Math.max(1, Math.min(pageCount(), n));
    local.page = n;
    if (follow) sendUpdate({ page: n }); else { drawCurrentPage(); renderPageNav(); }
  }

  function fitAnnoCanvasTo(w, h) {
    var anno = $('pv-annocanvas');
    anno.width = w; anno.height = h;
    anno.style.width = w + 'px'; anno.style.height = h + 'px';
    redrawStrokes();
  }

  function drawCurrentPage() {
    var sheet = currentSheet();
    var pdfCv = $('pv-pdfcanvas'), img = $('pv-sheetimg'), info = $('pv-songinfo');
    if (!sheet) {
      pdfCv.style.display = 'none'; img.style.display = 'none';
      var s = currentSong();
      info.style.display = 'block';
      info.innerHTML = s
        ? '<div class="pv-songtitle">' + esc(s.title) + '</div>'
          + '<div class="pv-songmeta">' + [s.team, s.key && ('Key ' + s.key), s.bpm && (s.bpm + ' BPM')].filter(Boolean).map(esc).join(' · ') + '</div>'
          + (s.youtube ? '<a class="ph-li-link" href="' + esc(s.youtube) + '" target="_blank" rel="noopener">▶ 유튜브</a>' : '')
          + ((s.solo || []).length ? '<div class="ph-solo-badges">🎤 솔로 — ' + s.solo.map(function (x) { return esc(x.name) + (x.part ? '<em>' + esc(x.part) + '</em>' : ''); }).join(', ') + '</div>' : '')
          + (s.note ? '<div class="ph-li-note">' + esc(s.note) + '</div>' : '')
        : '<p class="ph-sub">곡을 추가하면 여기 보여요. 악보를 고르면 라이브 악보 + 필기가 열립니다.</p>';
      fitAnnoCanvasTo(0, 0);
      return;
    }
    info.style.display = 'none';
    var width = $('pv-pagebox').clientWidth || 900;

    if (sheet.kind === 'image') {
      pdfCv.style.display = 'none';
      img.style.display = 'block';
      if (img.getAttribute('data-src') !== sheet.proxyUrl) {
        img.setAttribute('data-src', sheet.proxyUrl);
        img.onload = function () { fitAnnoCanvasTo(img.clientWidth, img.clientHeight); loadAnno(); };
        img.src = sheet.proxyUrl;
      } else {
        fitAnnoCanvasTo(img.clientWidth, img.clientHeight);
      }
      renderPageNav();
      return;
    }

    // PDF(또는 모름 — PDF로 먼저 시도)
    img.style.display = 'none';
    pdfCv.style.display = 'block';
    ensurePdfJs().then(function (lib) {
      if (pdfLoadedForSheet !== sheet.id) {
        return lib.getDocument(sheet.proxyUrl).promise.then(function (doc) {
          pdfDoc = doc; pdfLoadedForSheet = sheet.id;
          return renderOnePage(width);
        });
      }
      return renderOnePage(width);
    }).catch(function () {
      pdfCv.style.display = 'none';
      function showOpenFallback() {
        img.style.display = 'none';
        info.style.display = 'block';
        info.innerHTML = '<p class="ph-sub">이 악보는 화면에 바로 띄울 수 없어요(인터넷 연결이 느리거나 막혀 있을 수 있어요).</p><a class="ph-btn pri" href="' + esc(sheet.openUrl) + '" target="_blank" rel="noopener">📄 원본 열기</a>';
      }
      if (sheet.kind === 'unknown') {
        // 확장자로 모르는 링크였을 수 있으니 사진으로 한 번 더 시도, 그래도 안 되면 "원본 열기"
        img.style.display = 'block';
        img.onload = function () { fitAnnoCanvasTo(img.clientWidth, img.clientHeight); loadAnno(); };
        img.onerror = showOpenFallback;
        img.src = sheet.proxyUrl;
      } else {
        // PDF로 확실한 링크인데 PDF.js 자체가 안 열린 경우(CDN 접속 실패 등) — 사진으로 시도해도 의미 없으니 바로 "원본 열기"
        showOpenFallback();
      }
    });
  }
  function renderOnePage(targetWidth) {
    local.page = Math.max(1, Math.min(pageCount(), local.page || 1));
    return pdfDoc.getPage(local.page).then(function (page) {
      var baseVp = page.getViewport({ scale: 1 });
      var scale = Math.max(0.3, Math.min(3, targetWidth / baseVp.width));
      var vp = page.getViewport({ scale: scale });
      var cv = $('pv-pdfcanvas'), ctx = cv.getContext('2d');
      cv.width = vp.width; cv.height = vp.height;
      cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        fitAnnoCanvasTo(vp.width, vp.height);
        renderPageNav();
        loadAnno();
      });
    });
  }
  function renderStage() { drawCurrentPage(); }
  window.addEventListener('resize', function () { if (currentSheet()) drawCurrentPage(); });

  /* ============================================================ 필기(필기 캔버스) */
  var annoState = { tool: 'pen', color: '#ff8a2a', showMine: true, showTeam: true, byAuthor: {}, undo: [] };
  function annoKey() { return local.sheetId; }

  function strokeColorFor(tool, color) { return tool === 'hl' ? color + '80' : color; }
  function drawStroke(ctx, stroke, w, h) {
    if (!stroke.points || stroke.points.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = strokeColorFor(stroke.tool, stroke.color || '#ff8a2a');
    ctx.lineWidth = (stroke.tool === 'hl' ? 14 : (stroke.tool === 'eraser' ? 22 : 3));
    if (stroke.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    stroke.points.forEach(function (p, i) {
      var x = p[0] * w, y = p[1] * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }
  function redrawStrokes() {
    var cv = $('pv-annocanvas');
    if (!cv || !cv.width) return;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    var me = DATA.memberName;
    Object.keys(annoState.byAuthor).forEach(function (author) {
      if (author === me && !annoState.showMine) return;
      if (author !== me && !annoState.showTeam) return;
      (annoState.byAuthor[author] || []).filter(function (s) { return (s.page || 1) === local.page; })
        .forEach(function (s) { drawStroke(ctx, s, cv.width, cv.height); });
    });
  }
  function addRemoteStroke(stroke) {
    var author = stroke.by || '(팀원)';
    annoState.byAuthor[author] = annoState.byAuthor[author] || [];
    annoState.byAuthor[author].push(stroke);
    redrawStrokes();
  }
  function loadAnno() {
    annoState.byAuthor = {};
    if (!local.sheetId || !DATA.annoLoadUrl) { redrawStrokes(); return; }
    fetch(DATA.annoLoadUrl + '&sheetId=' + encodeURIComponent(local.sheetId), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) { annoState.byAuthor = d.byAuthor || {}; redrawStrokes(); } })
      .catch(function () {});
  }
  var saveTimer = null;
  function saveAnnoDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!local.sheetId) return;
      var mine = annoState.byAuthor[DATA.memberName] || [];
      fetch(DATA.annoSaveUrl, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: DATA.team, sheetId: local.sheetId, strokes: mine, public: annoState.publicStrokes !== false }),
      }).catch(function () {});
    }, 500);
  }

  var drawing = null;
  function bindAnnoPointerEvents() {
    var cv = $('pv-annocanvas');
    if (!cv || cv.getAttribute('data-bound')) return;
    cv.setAttribute('data-bound', '1');
    function toNorm(ev) {
      var r = cv.getBoundingClientRect();
      return [(ev.clientX - r.left) / (r.width || 1), (ev.clientY - r.top) / (r.height || 1)];
    }
    cv.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType === 'touch' && ev.width > 28) return; // 넓게 닿은 손바닥으로 보이는 접촉은 무시
      if (annoState.tool === 'none') return;
      ev.preventDefault();
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      drawing = { tool: annoState.tool, color: annoState.color, page: local.page, points: [toNorm(ev)], by: DATA.memberName, sheetId: local.sheetId };
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!drawing) return;
      drawing.points.push(toNorm(ev));
      var ctx = cv.getContext('2d');
      var n = drawing.points.length;
      if (n >= 2) {
        var p1 = drawing.points[n - 2], p2 = drawing.points[n - 1];
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = strokeColorFor(drawing.tool, drawing.color);
        ctx.lineWidth = (drawing.tool === 'hl' ? 14 : (drawing.tool === 'eraser' ? 22 : 3));
        if (drawing.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.moveTo(p1[0] * cv.width, p1[1] * cv.height); ctx.lineTo(p2[0] * cv.width, p2[1] * cv.height); ctx.stroke();
        ctx.restore();
      }
    });
    function endStroke() {
      if (!drawing) return;
      if (drawing.points.length > 1) {
        annoState.undo.push({ author: DATA.memberName, removeLast: true });
        annoState.byAuthor[DATA.memberName] = annoState.byAuthor[DATA.memberName] || [];
        annoState.byAuthor[DATA.memberName].push(drawing);
        if (socket) socket.emit('anno:stroke', drawing);
        saveAnnoDebounced();
      }
      drawing = null;
    }
    cv.addEventListener('pointerup', endStroke);
    cv.addEventListener('pointercancel', endStroke);
    cv.addEventListener('pointerleave', function () { if (drawing) endStroke(); });
  }
  function annoUndo() {
    var mine = annoState.byAuthor[DATA.memberName] || [];
    if (!mine.length) return;
    mine.pop();
    redrawStrokes(); saveAnnoDebounced();
  }
  function annoClearPage() {
    var mine = annoState.byAuthor[DATA.memberName] || [];
    annoState.byAuthor[DATA.memberName] = mine.filter(function (s) { return (s.page || 1) !== local.page; });
    redrawStrokes(); saveAnnoDebounced();
  }
  function annoClearAll() {
    annoState.byAuthor[DATA.memberName] = [];
    redrawStrokes(); saveAnnoDebounced();
  }

  /* ============================================================ 오른쪽 패널 — 탭 5개 */
  var activeTab = 'anno';
  var PEN_COLORS = ['#ff8a2a', '#ff4d4d', '#4d94ff', '#5dff9a', '#f8f5f0'];

  function panelAnno() {
    bindAnnoPointerEvents();
    return '<div class="pv-annotools">' +
      '<div class="pv-annorow">' +
        '<button type="button" class="pv-toolbtn' + (annoState.tool === 'pen' ? ' on' : '') + '" data-anno-tool="pen">✏️ 펜</button>' +
        '<button type="button" class="pv-toolbtn' + (annoState.tool === 'hl' ? ' on' : '') + '" data-anno-tool="hl">🖍 형광펜</button>' +
        '<button type="button" class="pv-toolbtn' + (annoState.tool === 'eraser' ? ' on' : '') + '" data-anno-tool="eraser">🧹 지우개</button>' +
      '</div>' +
      '<div class="pv-annorow pv-colors">' + PEN_COLORS.map(function (c) { return '<button type="button" class="pv-colorbtn' + (annoState.color === c ? ' on' : '') + '" data-anno-color="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div>' +
      '<div class="pv-annorow">' +
        '<button type="button" class="ph-btn" data-anno-act="undo">되돌리기</button>' +
        '<button type="button" class="ph-btn" data-anno-act="clearpage">이 페이지 지우기</button>' +
        '<button type="button" class="ph-btn" data-anno-act="clearall">모두 지우기</button>' +
      '</div>' +
      '<div class="pv-annorow" style="margin-top:6px;">' +
        '<label class="pv-check"><input type="checkbox" id="pv-anno-mine"' + (annoState.showMine ? ' checked' : '') + '> 내 필기 보이기</label>' +
        '<label class="pv-check"><input type="checkbox" id="pv-anno-team"' + (annoState.showTeam ? ' checked' : '') + '> 팀 필기 보이기</label>' +
      '</div>' +
      '<label class="pv-check"><input type="checkbox" id="pv-anno-public"' + (annoState.publicStrokes !== false ? ' checked' : '') + '> 팀과 실시간 공유(끄면 나만 보기)</label>' +
      (local.sheetId ? '' : '<p class="ph-sub" style="margin-top:8px;">먼저 악보를 하나 골라주세요.</p>');
  }
  function wireAnno() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-anno-tool]'), function (b) { b.onclick = function () { annoState.tool = b.getAttribute('data-anno-tool'); renderPanel(); }; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-anno-color]'), function (b) { b.onclick = function () { annoState.color = b.getAttribute('data-anno-color'); renderPanel(); }; });
    var u = document.querySelector('[data-anno-act="undo"]'); if (u) u.onclick = annoUndo;
    var cp = document.querySelector('[data-anno-act="clearpage"]'); if (cp) cp.onclick = function () { if (confirm('이 페이지 필기를 지울까요?')) annoClearPage(); };
    var ca = document.querySelector('[data-anno-act="clearall"]'); if (ca) ca.onclick = function () { if (confirm('이 악보의 내 필기를 전부 지울까요?')) annoClearAll(); };
    var mine = $('pv-anno-mine'); if (mine) mine.onchange = function () { annoState.showMine = mine.checked; redrawStrokes(); };
    var team = $('pv-anno-team'); if (team) team.onchange = function () { annoState.showTeam = team.checked; redrawStrokes(); };
    var pub = $('pv-anno-public'); if (pub) pub.onchange = function () { annoState.publicStrokes = pub.checked; saveAnnoDebounced(); };
  }

  var CUE_BUTTONS = ['Repeat Chorus', 'Half Chorus', 'Tag the last line', 'Last line again', 'One more time', 'One more bar', 'Key Up', 'Prayer'];
  var formPlayer = null;
  function panelForm() {
    var s = currentSong();
    if (!s) return '<p class="ph-sub">곡을 먼저 골라주세요.</p>';
    var html = '<div class="pv-formsong">' + esc(s.title) + '</div>' +
      '<div class="pv-formmeta">' + [s.key && ('Key ' + s.key), s.bpm && (s.bpm + ' BPM')].filter(Boolean).map(esc).join(' · ') + '</div>' +
      '<p class="ph-sub" style="margin:4px 0 10px;">큐를 누르면 방 전체(연습화면을 연 모든 기기)에 알려집니다.</p>' +
      '<div class="pv-cuegrid">' + CUE_BUTTONS.map(function (c) { return '<button type="button" class="pv-cuebtn" data-cue="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
      '<div class="pv-formplayer" id="pv-formplayer"></div>';
    return html;
  }
  function wireForm() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-cue]'), function (b) {
      b.onclick = function () {
        var text = b.getAttribute('data-cue');
        showCueToast('나 — ' + text);
        if (sendCueToRoom && socket) socket.emit('cue', text);
      };
    });
    var host = $('pv-formplayer');
    var s = currentSong();
    if (host && s && window.YNForm) {
      formPlayer = window.YNForm.mountPlayer(host, { value: s.form || '', lang: 'ko' });
    }
  }

  function panelMetro() {
    return '<div class="pv-metrorow">' +
      '<button class="ph-icon-btn" id="pv-bpmdown" type="button">−</button>' +
      '<div class="pv-bpm"><span id="pv-bpmnum">' + (room.metro.bpm || 80) + '</span><span class="pv-bpmlabel">BPM</span></div>' +
      '<button class="ph-icon-btn" id="pv-bpmup" type="button">+</button>' +
      '<div class="pv-beat" id="pv-beat"></div>' +
      '</div>' +
      '<div class="pv-metrobtns">' +
      '<button class="ph-btn pri" id="pv-startstop" type="button">' + (room.metro.running ? '■ 정지' : '▶ 시작') + '</button>' +
      '<button class="ph-btn" id="pv-tap" type="button">탭으로 템포 맞추기</button>' +
      '</div>' +
      '<p class="ph-sub" style="margin-top:8px;">같은 링크를 연 모든 기기와 BPM · 재생이 함께 바뀝니다.</p>';
  }
  function wireMetro() {
    $('pv-bpmup').onclick = function () { sendUpdate({ metro: { bpm: Math.min(240, (room.metro.bpm || 80) + 1) } }); };
    $('pv-bpmdown').onclick = function () { sendUpdate({ metro: { bpm: Math.max(30, (room.metro.bpm || 80) - 1) } }); };
    $('pv-startstop').onclick = function () {
      if (room.metro.running) sendUpdate({ metro: { running: false } });
      else sendUpdate({ metro: { running: true, startedAt: Date.now() } });
    };
    var taps = [];
    $('pv-tap').onclick = function () {
      var now = Date.now();
      taps = taps.filter(function (t) { return now - t < 2000; });
      taps.push(now);
      if (taps.length >= 2) {
        var intervals = []; for (var i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
        var avg = intervals.reduce(function (a, b) { return a + b; }, 0) / intervals.length;
        sendUpdate({ metro: { bpm: Math.max(30, Math.min(240, Math.round(60000 / avg))) } });
      }
    };
  }
  /* ---------- 메트로놈 소리 + 박자 표시 (탭을 안 보고 있어도 계속 돌아감) ---------- */
  var audioCtx = null;
  function actx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
  function clickSound(strong) {
    var ac = actx();
    var o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = strong ? 1400 : 1000;
    o.connect(g); g.connect(ac.destination);
    var t = ac.currentTime;
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.start(t); o.stop(t + 0.08);
  }
  var beatTimer = null;
  function syncMetro() {
    if (beatTimer) { clearTimeout(beatTimer); clearInterval(beatTimer); beatTimer = null; }
    var beatEl = $('pv-beat');
    if (!room.metro.running || !room.metro.bpm) { if (beatEl) beatEl.classList.remove('on'); return; }
    var interval = 60000 / room.metro.bpm;
    var elapsed = Date.now() - room.metro.startedAt;
    var nextBeatIdx = Math.max(0, Math.ceil(elapsed / interval));
    function fire() {
      clickSound(nextBeatIdx % 4 === 0);
      var el = $('pv-beat'); if (el) { el.classList.add('on'); setTimeout(function () { el.classList.remove('on'); }, 90); }
      nextBeatIdx++;
    }
    var delay = Math.max(0, (nextBeatIdx * interval) - elapsed);
    beatTimer = setTimeout(function () { fire(); beatTimer = setInterval(fire, interval); }, delay);
  }

  /* ---------- 시작음 — 곡 Key로 기준음을 들려줌 (화성 자동인식 등은 이번 범위에서 뺌) ---------- */
  var NOTE_FREQ = { 'C': 261.63, 'C#': 277.18, 'Db': 277.18, 'D': 293.66, 'D#': 311.13, 'Eb': 311.13, 'E': 329.63, 'F': 349.23, 'F#': 369.99, 'Gb': 369.99, 'G': 392.00, 'G#': 415.30, 'Ab': 415.30, 'A': 440.00, 'A#': 466.16, 'Bb': 466.16, 'B': 493.88 };
  var pitchNote = null;
  function guessNote(key) {
    var m = /^([A-G][#b]?)/.exec(String(key || '').trim());
    return m ? m[1] : 'C';
  }
  function playPitch(note) {
    stopPitch();
    var freq = NOTE_FREQ[note] || NOTE_FREQ.C;
    var ac = actx();
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.05);
    o.start();
    pitchNote = { osc: o, gain: g };
  }
  function stopPitch() {
    if (!pitchNote) return;
    var ac = actx(), g = pitchNote.gain, o = pitchNote.osc;
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.15);
    setTimeout(function () { try { o.stop(); } catch (e) {} }, 180);
    pitchNote = null;
  }
  function panelPitch() {
    var s = currentSong();
    var note = guessNote(s && s.key);
    var notes = Object.keys(NOTE_FREQ).filter(function (n, i, arr) { return arr.indexOf(n) === i; });
    return '<p class="ph-sub">곡 Key(' + esc((s && s.key) || '?') + ')에 맞춘 기준음을 들려줍니다. 화음 자동 인식 등은 아직 없어요.</p>' +
      '<div class="pv-pitchgrid">' + ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(function (n) {
        return '<button type="button" class="pv-pitchbtn' + (n === note ? ' sug' : '') + '" data-note="' + n + '">' + n + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="ph-btn pri" id="pv-pitchplay" style="margin-top:10px;width:100%;">▶ 재생</button>' +
      '<button type="button" class="ph-btn" id="pv-pitchstop" style="margin-top:6px;width:100%;">■ 멈춤</button>';
  }
  function wirePitch() {
    var picked = guessNote((currentSong() || {}).key);
    Array.prototype.forEach.call(document.querySelectorAll('[data-note]'), function (b) {
      b.onclick = function () {
        picked = b.getAttribute('data-note');
        Array.prototype.forEach.call(document.querySelectorAll('[data-note]'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      };
    });
    $('pv-pitchplay').onclick = function () { playPitch(picked); };
    $('pv-pitchstop').onclick = stopPitch;
  }

  function panelTogether() {
    return '<div class="pv-togetherstatus"><span class="pv-dot' + (socket && socket.connected ? ' on' : '') + '"></span> ' + (socket && socket.connected ? '실시간 연결됨 — ' + rosterNames.length + '명 접속 중' : '연결 중…') + '</div>' +
      '<div class="pv-rosterlist">' + (rosterNames.length ? rosterNames.map(function (n) { return '<span class="pv-rosterchip">' + esc(n) + (n === DATA.memberName ? ' (나)' : '') + '</span>'; }).join('') : '<p class="ph-sub">아직 아무도 없어요.</p>') + '</div>' +
      '<button type="button" class="ph-btn pri" id="pv-takecontrol" style="margin-top:12px;width:100%;">📄 내가 페이지 컨트롤 하기</button>' +
      '<label class="pv-check" style="margin-top:10px;"><input type="checkbox" id="pv-follow"' + (follow ? ' checked' : '') + '> 페이지 컨트롤 따라가기</label>' +
      '<p class="ph-sub">켜 두면 다른 사람이 곡·악보·페이지를 넘길 때 내 화면도 같이 넘어갑니다. 메트로놈은 기기마다 따로 켜고 끕니다(팀과 맞추지 않음).</p>' +
      '<label class="pv-check"><input type="checkbox" id="pv-cuesend"' + (sendCueToRoom ? ' checked' : '') + '> 내 큐를 팀에 보내기</label>' +
      '<label class="pv-check"><input type="checkbox" id="pv-cuerecv"' + (receiveCue ? ' checked' : '') + '> 팀의 큐 받기</label>';
  }
  function wireTogether() {
    $('pv-takecontrol').onclick = takeControl;
    $('pv-follow').onchange = function (ev) { follow = ev.target.checked; lsSet('yn.pv.follow', follow ? '1' : '0'); if (follow) { local.songIdx = room.songIdx; local.sheetId = room.sheetId; local.page = room.page || 1; renderSongTabs(); renderSheetPicker(); renderStage(); } };
    $('pv-cuesend').onchange = function (ev) { sendCueToRoom = ev.target.checked; lsSet('yn.pv.cue.send', sendCueToRoom ? '1' : '0'); };
    $('pv-cuerecv').onchange = function (ev) { receiveCue = ev.target.checked; lsSet('yn.pv.cue.recv', receiveCue ? '1' : '0'); };
  }

  var PANELS = {
    anno: { html: panelAnno, wire: wireAnno },
    form: { html: panelForm, wire: wireForm },
    metro: { html: panelMetro, wire: wireMetro },
    pitch: { html: panelPitch, wire: wirePitch },
    together: { html: panelTogether, wire: wireTogether },
  };
  function renderPanel() {
    var body = $('pv-panelbody');
    if (!body) return;
    body.innerHTML = PANELS[activeTab].html();
    PANELS[activeTab].wire();
  }
  function bindTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-pvtab]'), function (b) {
      b.onclick = function () {
        activeTab = b.getAttribute('data-pvtab');
        Array.prototype.forEach.call(document.querySelectorAll('[data-pvtab]'), function (x) { x.classList.toggle('on', x === b); });
        renderPanel();
      };
    });
  }

  bindTabs();
  renderSongTabs();
  renderSheetPicker();
  renderStage();
  renderPanel();
})();
