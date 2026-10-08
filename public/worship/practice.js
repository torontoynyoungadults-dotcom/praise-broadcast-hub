/**
 * 세션 / 연습 — 찬양 악보를 크게 열어 필기 · 송폼 · 메트로놈 · 음정을 한 화면에서 쓰는 전체 화면 뷰어 (가사 도구는 허브 화면으로 옮김)
 * ------------------------------------------------------------
 *  YNPractice.open({ token, room, sheets:[{id,name}], songs:[{title,key,bpm,form}], start:악보ID, canEdit, callServer })
 *
 *  · 레이아웃: 📱 태블릿(큰 버튼 · 펜 우선 · 화면 가장자리 탭으로 넘김 · 도구 막대 떠 있음)  /  💻 컴퓨터(위 도구줄 · 오른쪽 패널 · 단축키)
 *  · 페이지 컨트롤(구 리더) - 팔로워: 페이지 컨트롤이 넘기는 악보 · 쪽 · 확대를 모두가 따라감. "따라가기" 스위치로 사람마다 끌 수 있음 (끄면 내 화면은 그대로)
 *  · 필기: anno.js (펜 · 형광펜 · 글자/코드 · 기호). 팀 공유는 rt.js(Socket.io)로 실시간, 나만 보기는 서버(구글 시트)에 저장
 *  · 패널(송폼 · 메트로놈 · 음정 · 함께)은 practice-panels.js 에 있습니다
 * 실시간 연결이 없어도(오프라인 · 서버 문제) 혼자 보기 · 나만 보기 필기는 그대로 동작합니다.
 */
(function (root) {
  'use strict';
  var doc = root.document;

  /* ------------------------------------------------------------ 작은 도구 */
  function ls(k, v) { try { if (v === undefined) return root.localStorage.getItem('yn.pv.' + k); root.localStorage.setItem('yn.pv.' + k, v); } catch (e) { /* 저장이 막힌 브라우저 */ } return null; }
  /* 기본값 정리 v11 — 예전 버전이 컴퓨터에서 "자동으로" 써 둔 오른쪽 패널 열림(side=1)을 기기마다 한 번만 지움 (tools/patch-live-defaults.js) */
  (function () { try { var s = root.localStorage; if (s.getItem('yn.pv.dv') === null) { if (s.getItem('yn.pv.side') === '1') s.removeItem('yn.pv.side'); s.setItem('yn.pv.dv', '11'); } } catch (e) { /* 저장이 막힌 브라우저 */ } }());
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function I(n, c) { return root.YNIcon ? root.YNIcon.get(n, c) : ''; }       // v8.3 — 직접 그린 아이콘 (icons.js)
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var scripts = {};
  function loadScript(src, ready) {
    if (ready && ready()) return Promise.resolve();
    if (scripts[src]) return scripts[src];
    return (scripts[src] = new Promise(function (res, rej) {
      var s = doc.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { delete scripts[src]; rej(new Error('필요한 도구를 불러오지 못했습니다 (' + src + ')')); };
      doc.head.appendChild(s);
    }));
  }
  function detectLayout() {
    var saved = ls('layout');
    if (saved === 'tablet' || saved === 'computer') return saved;
    var coarse = false; try { coarse = root.matchMedia('(pointer: coarse)').matches; } catch (e) {}
    return (coarse && root.innerWidth < 1400) || root.innerWidth < 900 ? 'tablet' : 'computer';
  }
  /** 송폼 칸(V1, C2 …)에서 메트로놈 큐 이름으로 */
  var CUE_MAP = { V: 'v1', V1: 'v1', V2: 'v2', V3: 'v3', V4: 'v4', 'C(Voice)': 'cvoice', C: 'c', C2: 'c2', C3: 'c3', PC: 'pc', PC2: 'pc2', B: 'b', B1: 'b', B2: 'b2', Intro: 'intro',   // V842 — C2 → Chorus 2 · Inst → Instrumental
    Itld: 'itld', Inst: 'inst', Out: 'end', End: 'end', Coda: 'end', Vamp: 'vamp', Turn: 'vamp', Solo: 'solo', Break: 'break', Prayer: 'prayer', KeyUp: 'keyup', Tag: 'tag',
    RepC: 'repc', HalfC: 'halfc', LastL: 'lastl', Once: 'once', OneBar: 'onebar', LastC: 'lastc', VOnly: 'vonly', Drums: 'drums', Build: 'build', Down: 'die', Ferm: 'ferm', Slow: 'slow', Hold: 'hold', BigEnd: 'bigend' };   // V838 — 송폼에 넣은 콜아웃 칸 (formb.js)
  /* 마디 수를 콜아웃에 붙이는 칸 — 간주 · 연주 ("Interlude 2 measures"). 메트로놈이 큐 id 뒤 "~m2" 를 읽어 이어서 부름 */
  var MEAS_CUES = { itld: 1, inst: 1 };
  function withBars(id, bars) { bars = Math.round(Number(bars)); return id && MEAS_CUES[id] && bars >= 1 && bars <= 16 ? id + '~m' + bars : id; }
  function cueIdFor(k, bars) { return withBars(CUE_MAP[k] || null, bars); }
  /** v7.3 — 송폼 창에서 칸을 눌렀을 때의 큐: V1 → v1(Verse 1) · V2 → v2 · 그냥 "V" 는 앞에서 몇 번째 V 인지로 (1절 → 2절 → 3절). 대소문자 무시 */
  function cueForToken(tokens, i) {
    var k = String((tokens[i] || {}).k || '').trim(); if (!k) return null;
    if (/^v$/i.test(k)) { var n = 1; for (var j = 0; j < i; j++) if (/^v$/i.test(String((tokens[j] || {}).k || '').trim())) n++; return 'v' + Math.min(n, 4); }   // 4절까지 (Verse 4)
    var m = k.match(/^v(\d)$/i); if (m) return +m[1] >= 1 && +m[1] <= 4 ? 'v' + m[1] : 'v4';
    var bars = (tokens[i] || {}).bars;                            // 반복(×2 · ×3 …)은 콜아웃에 넣지 않음 — 그 칸 이름만. 마디 수는 간주 · 연주에만
    if (CUE_MAP[k]) return withBars(CUE_MAP[k], bars);
    var low = k.toLowerCase(); for (var key in CUE_MAP) if (key.toLowerCase() === low) return withBars(CUE_MAP[key], bars);
    return null;
  }
  function normName(s) { return String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\s_\-\.\(\)\[\]·,]/g, ''); }
  /** 악보 파일 이름에서 어느 곡인지 짐작 (제목이 파일 이름에 들어 있으면) */
  function guessSong(name, songs) {
    var n = normName(name), best = -1, bl = 0;
    (songs || []).forEach(function (s, i) { var t = normName(s.title); if (t.length >= 2 && n.indexOf(t) >= 0 && t.length > bl) { best = i; bl = t.length; } });
    return best;
  }

  var TOOLS = [
    { t: 'none', ic: 'hand', n: '이동' }, { t: 'pen', ic: 'pen', n: '펜' }, { t: 'hl', ic: 'hl', n: '형광펜' }, { t: 'select', ic: 'select', n: '선택·이동' }, { t: 'text', ic: 'text', n: '글자' },
    { t: 'chord', ic: 'chord', n: '코드' }, { t: 'sym', ic: 'sharp', n: '기호' }, { t: 'note', ic: 'note', n: '음표' }, { t: 'fbox', ic: 'tag', n: '송폼 라벨' }, { t: 'eraser', ic: 'eraser', n: '지우개' }
  ];
  var current = null;

  /* ------------------------------------------------------------ 성능 (허브 v5)
     · 악보 파일 바이트를 화면(연습 창) 밖에서도 잠깐 기억합니다 — 허브 화면이 한가할 때 첫 악보를 미리 받아 두면(warm)
       "세션 / 연습 시작"을 눌렀을 때 내려받기를 기다리지 않습니다. 최근 BYTE_MAX 개만, 오래된 것부터 버림.
     · PDF 도구(pdf.js)도 한가할 때 미리 불러 둡니다 (처음 열 때 큰 스크립트를 읽느라 멈칫하던 부분)
     · 휴대폰으로 찍은 큰 사진 악보(예: 4000×3000)는 화면에 필요한 크기(긴 변 IMG_MAX)로 한 번만 줄여 둡니다.
       필기 좌표는 쪽 전체 기준(0~1)이라 줄여도 필기 위치 · 다른 사람 화면과의 동기화는 그대로입니다. */
  var BYTES = new Map(), BYTE_MAX = 4, IMG_MAX = 2800, PROG = {};
  function mbText(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB'; }
  function sheetBytes(id) {
    var hit = BYTES.get(id);
    if (hit) { BYTES.delete(id); BYTES.set(id, hit); return hit; }
    var p = root.fetch('/sheet/' + encodeURIComponent(id), { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? '이 악보를 찾을 수 없습니다 (삭제되었거나 권한이 없습니다).' : '악보를 불러오지 못했습니다 (오류 ' + r.status + ')');
      if (!r.body || !r.body.getReader) return r.arrayBuffer();
      // 받는 만큼 진행률을 알립니다 (악보를 불러오는 중… 42%) — 기다리는 이유(내려받기 · 그리기)가 눈에 보이도록
      var rd = r.body.getReader(), parts = [], got = 0, pr = PROG[id] = { got: 0, total: Number(r.headers.get('content-length') || 0) };
      return (function pump() {
        return rd.read().then(function (x) {
          if (x.done) { delete PROG[id]; var all = new Uint8Array(got), at = 0; parts.forEach(function (c) { all.set(c, at); at += c.length; }); return all.buffer; }
          parts.push(x.value); got += x.value.length; pr.got = got; return pump();
        });
      })();
    }, function () { throw new Error('악보를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.'); });
    p.catch(function () { delete PROG[id]; });
    p.catch(function () { if (BYTES.get(id) === p) BYTES.delete(id); });            // 실패한 것은 기억하지 않음 (다음에 다시 시도)
    BYTES.set(id, p);
    while (BYTES.size > BYTE_MAX) BYTES.delete(BYTES.keys().next().value);
    return p;
  }
  function isPdfBytes(u8) { return u8.length > 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46; }
  function warmPdfjs() {
    return loadScript('/vendor/pdfjs/pdf.min.js', function () { return !!root.pdfjsLib; }).then(function () {
      try { root.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; } catch (e) {}
      // PDF 작업자 파일(1MB+)도 지금 받아 둡니다 — 안 그러면 악보를 다 받은 뒤에야 받기 시작해서 그만큼 더 기다립니다
      if (!workerPrimed) { workerPrimed = true; try { root.fetch('/vendor/pdfjs/pdf.worker.min.js', { credentials: 'same-origin' }).catch(function () {}); } catch (e) {} }
    });
  }
  var workerPrimed = false;
  /** 허브 화면이 한가할 때 부릅니다: PDF 도구를 악보와 나란히 받고, 악보 바이트는 한 번에 하나씩 (대역폭을 나눠 쓰면 첫 악보가 늦어짐).
   *  pdf === false 이면 (사진 악보만 있을 때) PDF 도구는 받지 않습니다 */
  function warm(ids, pdf) {
    if (pdf !== false) warmPdfjs().catch(function () { /* 미리 받기는 덤 */ });
    (ids || []).slice(0, 2).reduce(function (p, id) {
      return p.then(function () { if (id) return sheetBytes(id).catch(function () { /* 덤 */ }); });
    }, Promise.resolve());
  }
  /** 그림 파일 머리에서 가로 · 세로만 읽습니다 (PNG · JPEG · GIF · WebP) — 모르면 null */
  function imgDims(u8) {
    try {
      if (u8[0] === 0x89 && u8[1] === 0x50) return { w: (u8[16] << 24 | u8[17] << 16 | u8[18] << 8 | u8[19]) >>> 0, h: (u8[20] << 24 | u8[21] << 16 | u8[22] << 8 | u8[23]) >>> 0 };
      if (u8[0] === 0x47 && u8[1] === 0x49) return { w: u8[6] | u8[7] << 8, h: u8[8] | u8[9] << 8 };
      if (u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57 && u8[12] === 0x56) {
        var tag = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
        if (tag === 'VP8X') return { w: 1 + (u8[24] | u8[25] << 8 | u8[26] << 16), h: 1 + (u8[27] | u8[28] << 8 | u8[29] << 16) };
        if (tag === 'VP8 ') return { w: (u8[26] | u8[27] << 8) & 0x3fff, h: (u8[28] | u8[29] << 8) & 0x3fff };
        if (tag === 'VP8L') { var b = u8[21] | u8[22] << 8 | u8[23] << 16 | u8[24] << 24; return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
        return null;
      }
      if (u8[0] === 0xff && u8[1] === 0xd8) {
        var i = 2;
        while (i + 9 < u8.length) {
          if (u8[i] !== 0xff) { i++; continue; }
          var m = u8[i + 1], len = u8[i + 2] << 8 | u8[i + 3];
          if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u8[i + 7] << 8 | u8[i + 8], h: u8[i + 5] << 8 | u8[i + 6] };
          if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
          i += 2 + len;
        }
      }
    } catch (e) {}
    return null;
  }
  /** 큰 사진을 줄여서 바로 풀기 — 브라우저가 화면 밖(다른 스레드)에서 풀면서 줄이므로 화면이 멈추지 않습니다. */
  function decodeScaled(blob, u8) {
    var d = imgDims(u8), big = d ? Math.max(d.w, d.h) : 0;
    if (!root.createImageBitmap) return Promise.reject(new Error('no bitmap'));
    if (!d || big <= IMG_MAX) return root.createImageBitmap(blob).then(prescale);
    var rw = Math.max(1, Math.round(d.w * IMG_MAX / big));
    // 가로만 정하면 세로는 비율대로 (사진 회전 정보가 있어도 모양이 찌그러지지 않음)
    return root.createImageBitmap(blob, { resizeWidth: rw, resizeQuality: 'high' }).then(function (bm) {
      if (Math.max(bm.width, bm.height) > IMG_MAX * 1.4) return prescale(bm);            // 줄이기 옵션을 모르는 브라우저
      return bm;
    }, function () { return root.createImageBitmap(blob).then(prescale); });
  }
  /** 큰 사진을 화면에 필요한 크기로 한 번만 줄입니다 (긴 변 IMG_MAX). 작으면 그대로 */
  function prescale(img) {
    var w = img.width || img.naturalWidth || 0, hh = img.height || img.naturalHeight || 0, big = Math.max(w, hh);
    if (!big || big <= IMG_MAX) return img;
    var k = IMG_MAX / big, cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(hh * k));
    try {
      var cv = doc.createElement('canvas'); cv.width = cw; cv.height = ch;
      var c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.fillStyle = '#fff'; c.fillRect(0, 0, cw, ch); c.drawImage(img, 0, 0, cw, ch);
      if (img.close) { try { img.close(); } catch (e) {} }                  // 원본 비트맵 메모리를 바로 돌려줌
      return cv;
    } catch (e) { return img; }
  }

  function open(opts) {
    opts = opts || {};
    if (current) { try { current.close(); } catch (e) {} }
    if (!doc || !doc.body) return null;
    var sheets = (opts.sheets || []).filter(function (s) { return s && s.id; });
    var songs = opts.songs || [];
    if (!sheets.length) { try { root.alert('열 수 있는 악보가 없습니다. 먼저 악보(PDF · 사진)를 올려주세요.'); } catch (e) {} return null; }

    var S = {
      layout: detectLayout(), hand: ls('hand') === 'left' ? 'left' : 'right', fit: null, zoom: 1, sheetIdx: 0, page: 1, pages: 1, songIdx: -1,
      doc: null, rid: 0, task: null, tab: '', layer: 'team', scope: 'song', follow: ls('fpage') !== '0', followM: false, prefTouched: false, prefT: 0, pendingNav: null, applying: false, navT: 0, dead: false,
      scopeOf: {}, unsent: {}, localMine: {}, delMine: {}, mineLoaded: {}, teamFrom: {}, annoId: 0, mineDirty: {}, mineT: 0, minePend: 0, savedAt: 0, msgT: 0, lang: ls('lang') === 'ko' ? 'ko' : 'en',
      recvCue: ls('recvcue') !== '0', sendCue: ls('sendcue') !== '0', loadId: 0, cache: {}, cacheOrder: []
    };
    S.fit = S.layout === 'tablet' ? 'page' : 'width';
    var startIdx = 0; sheets.forEach(function (s, i) { if (s.id === opts.start) startIdx = i; }); S.sheetIdx = startIdx;

    /* ------------------------------------------------------------ 화면 뼈대 */
    var el = doc.createElement('div');
    el.className = 'pv';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '라이브 악보');
    el.innerHTML =
      '<header class="pv-top">' +
        '<button class="pv-b" data-a="close" title="닫기 (Esc)" aria-label="닫기">' + I('close') + '</button>' +
        '<div class="pv-title"><select class="pv-sel pv-sheetsel" aria-label="악보 선택"></select><select class="pv-sel pv-songsel" style="display:none" aria-label="이 쪽의 곡 (자동으로 찾은 곡을 바꿀 수 있습니다)" title="이 쪽이 어느 곡인지 — 자동으로 찾은 곡이 틀리면 여기서 바꾸세요. 곡이 여러 쪽이면 다음 곡이 나올 때까지 같은 곡으로 봅니다."></select><span class="pv-songinfo"></span><button type="button" class="pv-ytbtn" style="display:none" title="이 곡의 유튜브 참고 영상 (앱 안에서 재생)" aria-label="유튜브 참고 영상 재생">▶ YouTube</button></div>' +
        '<div class="pv-grp pv-pager"><button class="pv-b" data-a="prev" title="이전 쪽 (←)" aria-label="이전 쪽">' + I('prev') + '</button><span class="pv-pg">1 / 1</span><button class="pv-b" data-a="next" title="다음 쪽 (→)" aria-label="다음 쪽">' + I('next') + '</button></div>' +
        '<div class="pv-grp pv-zoom"><button class="pv-b" data-a="zout" title="줄이기 (-)" aria-label="줄이기">' + I('minus') + '</button><button class="pv-b" data-a="zfit" title="화면에 맞춤">맞춤</button><button class="pv-b" data-a="zin" title="키우기 (+)" aria-label="키우기">' + I('plus') + '</button><button class="pv-b pv-cropbtn" data-a="crop" aria-pressed="true" title="여백 자동 맞춤 — 글자 · 음표가 있는 부분만 화면에 꽉 차게 키웁니다 (끄면 종이 전체)">' + I('crop') + ' 여백</button><button class="pv-b pv-spreadbtn" data-a="spread" aria-pressed="false" title="두 쪽 나란히 보기 (컴퓨터 화면)">' + I('spread') + ' 두 쪽</button></div>' +
        '<div class="pv-grp pv-seg pv-layoutseg" role="group" aria-label="화면 배치"><button data-layout="tablet" title="태블릿 화면" aria-label="태블릿 화면">' + I('tablet') + '<span class="pv-tx"> 태블릿</span></button><button data-layout="computer" title="컴퓨터 화면" aria-label="컴퓨터 화면">' + I('laptop') + '<span class="pv-tx"> 컴퓨터</span></button></div>' +
        '<div class="pv-grp pv-chips"><button type="button" class="pv-chip pv-conn" data-a="rtmenu" aria-haspopup="dialog" aria-expanded="false" title="실시간 — 눌러서 페이지 리드하기 · 따라가기 고르기">…</button><button class="pv-chip pv-lead" data-a="tab:together" title="페이지 컨트롤 · 함께 보기"></button><button class="pv-chip pv-click" data-a="tab:together" title="클릭 컨트롤(메트로놈) · 함께 보기"></button><button class="pv-chip pv-follow" data-a="follow" title="동기화 · 따라가기 켜기/끄기"></button></div>' +
        '<button class="pv-b pv-themebtn" data-a="theme" title="밝은 화면 / 어두운 화면" aria-label="밝은 화면 / 어두운 화면">' + I(doc.documentElement.getAttribute('data-theme') === 'light' ? 'moon' : 'sun') + '</button>' +
        '<button class="pv-b pv-fsbtn" data-a="fs" title="전체 화면 (악보만 크게)" aria-pressed="false" aria-label="전체 화면">' + I('fullscreen') + '</button><button class="pv-b pv-panelbtn" data-a="panel" title="패널 열기/닫기" aria-label="패널 열기/닫기">' + I('panel') + '</button>' +
        '<button type="button" class="pv-b pv-menubtn" aria-expanded="false" aria-controls="pvDrawer" aria-label="도구 메뉴 열기" title="도구 메뉴 열기 / 닫기"><span class="ic">' + I('sliders') + '</span><span class="nm">메뉴</span></button>' +
        '<button type="button" class="pv-b pv-morebtn" data-a="more" aria-expanded="false" aria-label="보기 메뉴 (확대 · 여백 · 화면 배치)" title="확대 · 여백 · 두 쪽 · 화면 배치">' + I('more') + '</button>' +
      '</header>' +
      '<div class="pv-morepop" role="group" aria-label="보기 메뉴"></div>' +
      '<div class="pv-rtpop" role="dialog" aria-label="실시간 메뉴" hidden></div>' +
      '<div class="pv-wifipop" role="dialog" aria-label="와이파이" hidden></div>' +
      '<div class="pv-main">' +
        '<div class="pv-tools" role="toolbar" aria-label="필기 도구"></div>' +
        '<div class="pv-stage"><div class="pv-pagebox"><canvas class="pv-pdf"></canvas><canvas class="pv-anno"></canvas></div>' +
          '<div class="pv-pagebox pv-pagebox2" style="display:none" title="오른쪽 쪽 (보기 전용) — 눌러서 왼쪽으로 가져오면 필기할 수 있습니다"><canvas class="pv-pdf2"></canvas></div>' +
          '<div class="pv-loading">악보를 불러오는 중…</div><div class="pv-toast" role="status" aria-live="polite"></div><div class="pv-sympop"></div></div>' +
        '<aside class="pv-side"><nav class="pv-tabs" role="tablist"></nav><div class="pv-panes"></div></aside>' +
        '<button type="button" class="pv-toolsbtn" aria-pressed="true" aria-label="필기 도구 숨기기" title="필기 도구 숨기기 / 보이기"><span class="ic">▴</span><span class="nm">도구</span></button>' +
      '</div>' +
      '<div class="pv-fsbar" role="toolbar" aria-label="전체 화면 메뉴"><button class="pv-b" data-a="fs" title="전체 화면 나가기 (Esc)">' + I('close') + ' 나가기</button><button class="pv-b" data-a="prev" title="이전 쪽" aria-label="이전 쪽">' + I('prev') + '</button><span class="pv-fspg">1 / 1</span><button class="pv-b" data-a="next" title="다음 쪽" aria-label="다음 쪽">' + I('next') + '</button><button class="pv-b" data-a="zfit" title="화면에 맞춤">맞춤</button><button class="pv-b" data-a="fs-tools" title="필기 도구 보이기/숨기기">' + I('pen') + ' 도구</button><button class="pv-b" data-a="fs-panel" title="메트로놈 · 송폼 패널">' + I('panel') + ' 패널</button></div><button type="button" class="pv-fshandle" data-a="fs-bar" aria-label="메뉴 보이기" title="메뉴 보이기"><span></span></button>' +
      '<div class="pv-dback" data-a="drawer-close"></div>' +
      '<aside class="pv-drawer" id="pvDrawer" role="dialog" aria-label="도구 메뉴" aria-hidden="true">' +
        '<div class="pv-dh"><b>' + I('sliders') + '도구 메뉴</b><button type="button" class="pv-dclose" data-a="drawer-close" aria-label="메뉴 닫기">' + I('close') + '</button></div>' +
        '<section class="pv-ds"><h5>보기</h5><div class="pv-dslot" data-slot="view"></div></section>' +
        '<section class="pv-ds"><h5>필기 도구</h5><div class="pv-dslot" data-slot="tools"></div></section>' +
        '<section class="pv-ds"><h5>저장</h5><div class="pv-dslot"><button type="button" class="pv-btn2" data-a="pdf">' + I('download') + ' 필기 포함 PDF 저장 (악보 전체 한 파일)</button></div></section>' +
        '<section class="pv-ds"><h5>패널</h5><div class="pv-dslot"><button type="button" class="pv-btn2 primary" data-a="drawer-panel">' + I('metronome') + ' 메트로놈 · 시작음 · 함께 (패널 열기)</button></div></section>' +
      '</aside>';
    doc.body.appendChild(el); doc.body.classList.add('pv-lock');
    function $(sel) { return el.querySelector(sel); }
    var stage = $('.pv-stage'), box = $('.pv-pagebox'), pdfCv = $('.pv-pdf'), annoCv = $('.pv-anno'), loading = $('.pv-loading'), toastEl = $('.pv-toast');
    var toolsEl = $('.pv-tools'), sideEl = $('.pv-side'), tabsEl = $('.pv-tabs'), panesEl = $('.pv-panes'), sheetSel = $('.pv-sheetsel');

    function toast(t, bad, ms) {
      toastEl.textContent = t || ''; toastEl.className = 'pv-toast' + (t ? ' show' : '') + (bad ? ' bad' : '');
      clearTimeout(S.msgT); if (t) S.msgT = setTimeout(function () { toastEl.className = 'pv-toast'; }, ms || (bad ? 5000 : 2200));
    }

    sheetSel.innerHTML = sheets.map(function (s, i) { return '<option value="' + i + '">' + h(s.name || ('악보 ' + (i + 1))) + '</option>'; }).join('');
    sheetSel.onchange = function () { loadSheet(+sheetSel.value, 1, true); };

    /* ------------------------------------------------------------ 레이아웃 */
    function applyLayout(l, save) {
      S.layout = l === 'tablet' ? 'tablet' : 'computer';
      if (save) { ls('layout', S.layout); S.fit = S.layout === 'tablet' ? 'page' : 'width'; S.zoom = 1; }
      el.classList.toggle('pv-tablet', S.layout === 'tablet'); el.classList.toggle('pv-computer', S.layout === 'computer');
      el.classList.toggle('pv-lefty', S.hand === 'left');
      el.classList.toggle('pv-sideopen', S.layout === 'computer' && !S.compact ? ls('side') === '1' : false);
      Array.prototype.forEach.call(el.querySelectorAll('[data-layout]'), function (b) { b.classList.toggle('on', b.getAttribute('data-layout') === S.layout); b.setAttribute('aria-pressed', b.getAttribute('data-layout') === S.layout ? 'true' : 'false'); });
      an && an.setPenMode(S.layout === 'tablet' ? (ls('penmode') || 'auto') : 'off');
      if (S.compact !== calcCompact()) setCompact(calcCompact());
      if (S.doc) renderSoon(30);
    }
    /* ------------------------------------------------------------ 좁은 화면 (아이폰 · 아이패드 세로 · 좁은 창)
       모든 도구(보기 · 필기 도구)를 "🛠 메뉴" 서랍 하나에 모읍니다. 서랍은 닫혀 있는 것이 기본이라 악보를 가리지 않고, 버튼 하나로 열고 닫습니다.
       화면 위 버튼을 서랍으로 "옮기기만" 하므로 (새로 만들지 않음) 필기 · 확대 · 화면 배치 · 실시간 동작은 그대로입니다. */
    var drawerEl = $('.pv-drawer'), menuBtn = $('.pv-menubtn'), holders = [];
    /* v6.1 — 아이패드 세로(768~1024px)는 더 이상 "좁은 화면(서랍)"이 아닙니다: 가로와 똑같이 떠 있는 도구 창을 씁니다.
       (예전에는 서랍이 열린 채 뒤 배경막이 악보를 덮어 손가락 필기가 막혔습니다.) 폰 · 아주 좁은 창만 서랍. */
    function calcCompact() { var w = root.innerWidth || 1200, hh = root.innerHeight || 800; return w < (S.layout === 'tablet' ? 700 : 900) || hh < 500; }
    function hold(node, slot) {                                       // 원래 자리를 표시해 두고 서랍으로 옮김
      var ph = doc.createComment('pv'); node.parentNode.insertBefore(ph, node); holders.push({ node: node, ph: ph }); slot.appendChild(node);
    }
    function setDrawer(open) {
      open = !!open && S.compact;
      el.classList.toggle('pv-drawopen', open); drawerEl.setAttribute('aria-hidden', open ? 'false' : 'true');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); menuBtn.setAttribute('aria-label', open ? '도구 메뉴 닫기' : '도구 메뉴 열기');
      menuBtn.querySelector('.ic').innerHTML = I(open ? 'close' : 'sliders'); menuBtn.querySelector('.nm').textContent = open ? '닫기' : '메뉴';
      if (open) { el.classList.remove('pv-sideopen'); try { drawerEl.querySelector('.pv-dclose').focus({ preventScroll: true }); } catch (e) {} }
    }
    function setCompact(on) {
      on = !!on; if (on === !!S.compact && holders.length === (on ? 4 : 0)) return;
      S.compact = on; el.classList.toggle('pv-compact', on);
      try { if (typeof paintShows === 'function' && typeof SHOWS !== 'undefined' && SHOWS) { paintShows(); if (on) requestAnimationFrame(function () { try { flPlace('metro'); } catch (e) {} }); } } catch (e) { /* 아직 떠 있는 창을 만들기 전 */ }
      if (on) {
        var v = drawerEl.querySelector('[data-slot="view"]'), t = drawerEl.querySelector('[data-slot="tools"]');
        [$('.pv-zoom'), $('.pv-layoutseg'), $('.pv-chips')].forEach(function (n) { if (n) hold(n, v); });
        hold(toolsEl, t);
        el.classList.remove('pv-sideopen');
      } else {
        setDrawer(false);
        holders.splice(0).forEach(function (x) { if (x.ph.parentNode) { x.ph.parentNode.insertBefore(x.node, x.ph); x.ph.remove(); } });
        if (S.layout === 'computer' && ls('side') === '1') el.classList.add('pv-sideopen');
      }
    }
    function autoFit() {                                              // 폰을 옆으로 눕히면 한 쪽이 너무 작아지므로 가로 폭에 맞춤. 사용자가 맞춤을 직접 바꿨다면 존중
      if (S.fitUser) return; var f = (S.compact && (root.innerWidth || 0) > (root.innerHeight || 0) && (root.innerHeight || 0) < 500) ? 'width' : 'page';   // 기본은 "한 쪽 맞춤" (Step 2.11) — 폰을 눕힌 낮은 화면만 가로 폭 맞춤
      if (f !== S.fit) { S.fit = f; S.zoom = 1; if (S.doc) renderPage(); }
    }
    /* v6.1 — 아이패드 세로처럼 폭이 1100px 보다 좁은 (서랍이 아닌) 화면: 위 막대를 한 줄로 — 확대 · 여백 · 두 쪽 · 화면 배치는 "⋯" 안으로 */
    var moreEl = $('.pv-morepop'), moreBtn = $('.pv-morebtn'), moreHold = [];
    function setNarrow() {
      var on = !S.compact && (root.innerWidth || 1200) < 1100;
      if (on === !!S.narrow && moreHold.length === (on ? 2 : 0)) return;
      S.narrow = on; el.classList.toggle('pv-narrow', on); setMore(false);
      if (on) [$('.pv-zoom'), $('.pv-layoutseg')].forEach(function (n) { if (n && n.parentNode) { var ph = doc.createComment('pvm'); n.parentNode.insertBefore(ph, n); moreHold.push({ node: n, ph: ph }); moreEl.appendChild(n); } });
      else moreHold.splice(0).forEach(function (x) { if (x.ph.parentNode) { x.ph.parentNode.insertBefore(x.node, x.ph); x.ph.remove(); } });
    }
    function setMore(open) { open = !!open && !!S.narrow; el.classList.toggle('pv-moreopen', open); moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    function moreOutside(e) { if (!el.classList.contains('pv-moreopen')) return; var tg = e.target; if (tg && tg.closest && (tg.closest('.pv-morepop') || tg.closest('.pv-morebtn'))) return; setMore(false); }
    doc.addEventListener('pointerdown', moreOutside, true);      // (닫을 때 떼기는 아래 P.on('close') 에서)
    function checkCompact() { var c = calcCompact(); if (c !== !!S.compact) { setCompact(c); if (S.doc) renderSoon(40); } setNarrow(); autoFit(); }
    menuBtn.onclick = function () { setDrawer(!el.classList.contains('pv-drawopen')); };
    var orT = 0; function onOrient() { clearTimeout(orT); orT = setTimeout(function () { if (!S.dead) checkCompact(); }, 200); }
    root.addEventListener('orientationchange', onOrient);

    /* 필기 도구 막대 접기/펴기 — 접으면 악보가 화면 전체 폭을 씁니다. 도구 막대는 그대로 두고 숨기기만 해서 필기 · 실시간 동기화에 영향이 없습니다 */
    var toolsBtn = $('.pv-toolsbtn');
    function setTools(show, save) {
      el.classList.toggle('pv-toolshide', !show);
      try { if (!show && typeof placePill === 'function') placePill(); else if (show && FL.tools) requestAnimationFrame(function () { flPlace('tools'); }); } catch (e) {}
      toolsBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
      toolsBtn.setAttribute('aria-label', show ? '필기 도구 숨기기' : '필기 도구 보이기');
      toolsBtn.querySelector('.ic').innerHTML = I(show ? 'up' : 'pen');
      toolsBtn.querySelector('.nm').textContent = show ? '도구' : '도구 열기';
      if (save) ls('tools', show ? '1' : '0');
      renderSoon(60);            // 넓어진(좁아진) 칸에 맞춰 악보를 다시 그림
    }
    toolsBtn.onclick = function () { if (S.pillMoved && Date.now() - S.pillMoved < 400) return; setTools(el.classList.contains('pv-toolshide'), true); };
    /* 태블릿 위 캡슐 도크 — 기본은 "도구 아이콘 + 되돌리기 + ⋯"만. ⋯ 를 누르면 색 · 굵기 · 글꼴 · 나만 보기가 펼쳐지고, ▴ 를 누르면 도크 전체가 작은 알약(✏️ 도구 열기)으로 접힙니다 */
    S.dockMore = ls('dockmore') === null ? S.layout === 'computer' : ls('dockmore') === '1'; el.classList.toggle('pv-dockmore', S.dockMore);   // v6 — 컴퓨터는 처음부터 펼침 (색 · 굵기 · 나만 보기), 태블릿은 접힘
    S.fbadge = ls('fbadge') !== '0';                                   // 악보 맨 위 송폼 배지 (기본 켬) — Step 2.15
    function setDockMore(on, save) {
      S.dockMore = !!on; el.classList.toggle('pv-dockmore', S.dockMore); if (save) ls('dockmore', S.dockMore ? '1' : '0');
      var b = toolsEl.querySelector('[data-a="dockmore"]'); if (b) { b.setAttribute('aria-pressed', S.dockMore ? 'true' : 'false'); b.setAttribute('aria-expanded', S.dockMore ? 'true' : 'false'); }
    }
    if (opts.readOnly) { el.classList.add('pv-ro'); setTools(false, false); }          // 방송팀 보기 링크 — 보기 전용 (필기 도구 없음)
    if (ls('tools') !== '1') setTools(false, false);                      // 기본은 접힘 (v11) — "도구 열기" 로 펴면 '1' 로 기억
    if (!(root.__YN_KEEP_TOOLS && ls('tools') === '1')) setTools(false, false);   // V838 — 라이브 악보를 열 때마다 도구는 늘 접힌 채로 시작 (열어 쓰는 동안만 펴짐). __YN_KEEP_TOOLS 는 옛 기본값으로 시험하는 시험 전용
    /* ------------------------------------------------------------ 전체 화면 (악보만 크게) — Step 2.11
       ⛶ 를 누르면 위 메뉴 · 필기 도구 · 패널이 모두 사라지고 악보가 화면을 꽉 채웁니다(브라우저 주소창도 가능한 곳에서는 숨김).
       악보를 한 번 톡 누르면 위쪽에 얇은 메뉴(나가기 · 쪽 · 맞춤 · 도구 · 패널)가 나타났다 5초 뒤 사라지고, 필기 중에는 위 가운데 작은 손잡이로 부릅니다. */
    S.fs = false; S.fsT = 0; S.fsSide = false; S.fsTools = true;
    function fsBar(on) {
      clearTimeout(S.fsT); el.classList.toggle('pv-fsbar-on', !!on);
      if (on) S.fsT = setTimeout(function () { if (!el.classList.contains('pv-sideopen') && !S.dead) el.classList.remove('pv-fsbar-on'); }, 5000);
    }
    function fsNative(on) {
      try {
        var d = root.document;
        if (on) { var de = d.documentElement; if (!d.fullscreenElement && de.requestFullscreen) { var r = de.requestFullscreen({ navigationUI: 'hide' }); if (r && r.catch) r.catch(function () { /* 아이폰 등: 브라우저 전체 화면이 없으면 화면 안에서만 */ }); } }
        else if (d.fullscreenElement && d.exitFullscreen) { var r2 = d.exitFullscreen(); if (r2 && r2.catch) r2.catch(function () {}); }
      } catch (e) { /* 전체 화면을 못 써도 화면 안 전체 보기는 동작 */ }
    }
    function setFs(on) {
      on = !!on; if (S.fs === on) return; S.fs = on;
      el.classList.toggle('pv-fs', on); el.querySelector('.pv-fsbtn').setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) { S.fsSide = el.classList.contains('pv-sideopen'); S.fsTools = !el.classList.contains('pv-toolshide'); toggleSide(false); setDrawer(false); setTools(false, false); fsBar(true); }
      else { clearTimeout(S.fsT); el.classList.remove('pv-fsbar-on'); setTools(S.fsTools, false); if (S.fsSide) toggleSide(true); }
      fsNative(on); renderSoon(120); P.emit('fs', on);
    }
    function onFsChange() { if (S.fs && !root.document.fullscreenElement && S.fsNativeOn) setFs(false); S.fsNativeOn = !!root.document.fullscreenElement; }   // 브라우저 Esc 로 나가면 화면 안 전체 보기도 함께 끝냄
    doc.addEventListener('fullscreenchange', onFsChange);
    var fsDown = null;
    function fsPointerDown(e) { fsDown = S.fs && S.tool === 'none' && e.pointerType !== 'pen' && !(e.target.closest && e.target.closest('button,select,input,a,.pv-fsbar,.pv-mq,.pv-side')) ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; }
    function fsPointerUp(e) {
      var d = fsDown; fsDown = null; if (!d || !S.fs) return;
      if (Math.abs(e.clientX - d.x) < 8 && Math.abs(e.clientY - d.y) < 8 && Date.now() - d.t < 450) fsBar(!el.classList.contains('pv-fsbar-on'));      // 톡 = 메뉴 켜기/끄기 (끌거나 확대하는 손짓은 제외)
    }
    stage.addEventListener('pointerdown', fsPointerDown); stage.addEventListener('pointerup', fsPointerUp);

    function toggleSide(force) {
      var on = force != null ? force : !el.classList.contains('pv-sideopen');
      if (on && S.compact) setDrawer(false);
      el.classList.toggle('pv-sideopen', on);
      if (S.layout === 'computer' && !S.compact) ls('side', on ? '1' : '0');
      if (on && !S.tab && P.tabs.length) showTab(P.tabs[0].id);
      renderSoon(260);
    }

    /* ------------------------------------------------------------ 악보 불러오기 · 그리기 */
    function ensurePdfjs() { return warmPdfjs(); }
    function fetchDoc(f) {
      var c = S.cache[f.id]; if (c) return Promise.resolve(c);
      if (/\.pdf$/i.test(f.name || '')) warmPdfjs().catch(function () { /* 아래에서 다시 시도하며 오류를 알립니다 */ });      // 악보를 받는 동안 PDF 도구도 나란히
      return sheetBytes(f.id).then(function (buf) {
        var u8 = new Uint8Array(buf), isPdf = isPdfBytes(u8);
        if (isPdf) {
          u8 = u8.slice();                                                      // pdf.js 는 받은 버퍼를 작업자에게 넘겨 버리므로, 기억해 둔 원본은 그대로 두고 복사본을 줌
          return ensurePdfjs().then(function () { return root.pdfjsLib.getDocument({ data: u8 }).promise; }).then(function (pdf) { return { pdf: pdf, n: pdf.numPages }; },
            function (e) { throw new Error(e && e.name === 'PasswordException' ? '암호가 걸린 PDF 는 열 수 없습니다.' : 'PDF 를 읽지 못했습니다 (파일이 손상되었을 수 있습니다).'); });
        }
        var type = /^\x89PNG/.test(String.fromCharCode.apply(null, u8.slice(0, 4))) ? 'image/png' : 'image/jpeg';
        var blob = new Blob([u8], { type: type });
        if (root.createImageBitmap) return decodeScaled(blob, u8).then(function (bm) { return { img: bm, n: 1 }; }, function () { throw new Error('사진 악보를 읽지 못했습니다.'); });
        return new Promise(function (res, rej) { var im = new root.Image(); im.decoding = 'async'; im.onload = function () { res({ img: prescale(im), n: 1 }); root.URL.revokeObjectURL(im.src); }; im.onerror = function () { rej(new Error('사진 악보를 읽지 못했습니다.')); }; im.src = root.URL.createObjectURL(blob); });
      }).then(function (d) {
        d.fid = f.id; S.cache[f.id] = d; S.cacheOrder.push(f.id);
        while (S.cacheOrder.length > 5) { var old = S.cacheOrder.shift(); if (S.cache[old] && S.cache[old] === S.doc && S.cacheOrder.length) { S.cacheOrder.push(old); continue; }      // 지금 보고 있는 악보는 지우지 않음
          if (S.cache[old] && S.cache[old].pdf && old !== f.id) { try { S.cache[old].pdf.destroy(); } catch (e) {} } delete S.cache[old]; }
        return d;
      });
    }
    function pageInfo(d, pg) {
      if (d.img) return Promise.resolve({ w: d.img.width || d.img.naturalWidth, h: d.img.height || d.img.naturalHeight, draw: function (cv, scale) { var c = cv.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(d.img, 0, 0, cv.width, cv.height); return { promise: Promise.resolve(), cancel: function () {} }; } });
      return d.pdf.getPage(pg).then(function (p) {
        var v1 = p.getViewport({ scale: 1 });
        return { w: v1.width, h: v1.height, draw: function (cv, scale) { var v = p.getViewport({ scale: scale }); var t = p.render({ canvasContext: cv.getContext('2d'), viewport: v }); return t; } };
      });
    }
    /** 어떤 쪽이든 canvas 에 그려 줍니다 (화면 · 내보내기 공용). scale = 원본 1 기준 배율 */
    function renderTo(cv, d, pg, scale) {
      return pageInfo(d, pg).then(function (info) {
        cv.width = Math.max(1, Math.round(info.w * scale)); cv.height = Math.max(1, Math.round(info.h * scale));
        var c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
        var t = info.draw(cv, scale); return t.promise.then(function () { return info; });
      });
    }
    /* ------------------------------------------------------------ 자동 여백 맞춤 (악보를 화면에 최대한 크게)
       쪽의 "글자 · 음표가 있는 부분"만 찾아(작은 그림으로 훑어서) 그 부분이 화면을 꽉 채우도록 확대하고, 스크롤 위치를 그 부분 시작점에 맞춥니다.
       여백을 자르지 않고 "확대 + 스크롤 위치"만 쓰기 때문에 필기 좌표(쪽 전체 기준 0~1)와 다른 사람 화면과의 동기화는 그대로입니다. 여백은 스크롤하면 보입니다. */
    S.crop = ls('crop') !== '0';
    var cropBtn = $('.pv-cropbtn');
    function syncCropUi() { cropBtn.classList.toggle('on', !!S.crop); cropBtn.setAttribute('aria-pressed', S.crop ? 'true' : 'false'); }
    syncCropUi();
    var CROP_PAD = 0.025, CROP_MAX_UP = 2.4, CROP_MIN_GAIN = 1.06;
    /** 작은 그림 데이터에서 잉크(어두운 점)가 있는 범위를 0~1 로. 없으면 null — 순수 계산이라 시험에서도 씁니다 */
    function inkBounds(data, w, h) {
      var rows = new Array(h).fill(0), cols = new Array(w).fill(0), i, x, y;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = (y * w + x) * 4; if (data[i + 3] > 40 && (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) < 225) { rows[y]++; cols[x]++; } }
      function span(a, n) { var lo = -1, hi = -1; for (var k = 0; k < a.length; k++) if (a[k] >= n) { if (lo < 0) lo = k; hi = k; } return lo < 0 ? null : [lo, hi + 1]; }
      var r = span(rows, 2), c = span(cols, 2); if (!r || !c) return null;
      return { x0: c[0] / w, x1: c[1] / w, y0: r[0] / h, y1: r[1] / h };
    }
    function cropOf(d, pg, info) {
      d.crops = d.crops || {}; if (d.crops[pg] !== undefined) return Promise.resolve(d.crops[pg]);
      var cv = doc.createElement('canvas'), sc = 280 / Math.max(1, info.w); cv.width = Math.max(8, Math.round(info.w * sc)); cv.height = Math.max(8, Math.round(info.h * sc));
      var c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
      var t; try { t = info.draw(cv, sc); } catch (e) { d.crops[pg] = null; return Promise.resolve(null); }
      return t.promise.then(function () {
        var b = null; try { b = inkBounds(c.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height); } catch (e) {}
        if (b) { b.x0 = Math.max(0, b.x0 - CROP_PAD); b.y0 = Math.max(0, b.y0 - CROP_PAD); b.x1 = Math.min(1, b.x1 + CROP_PAD); b.y1 = Math.min(1, b.y1 + CROP_PAD);
          if ((b.x1 - b.x0) > 0.94 && (b.y1 - b.y0) > 0.94) b = null; }                // 이미 꽉 찬 쪽은 그대로
        d.crops[pg] = b; return b;
      }, function () { d.crops[pg] = null; return null; });
    }
    /** 태블릿 위 캡슐 도크가 열려 있으면 그 밑에서부터 악보가 시작 (도크가 악보 윗부분을 가리지 않게) */
    function dockPad() { return 0; }                                   // v6 — 도구 도크는 악보 위에 떠 있고 옮길 수 있으므로 악보를 밀어내지 않습니다
    var DOCK_PAD = 54;
    function fitScale(info, cr) {
      var aw = Math.max(200, stage.clientWidth - (S.layout === 'computer' && !S.compact ? 24 : 8)), ah = Math.max(200, stage.clientHeight - 8 - dockPad());
      if (spreadOn()) aw = Math.max(150, (aw - 12) / 2);                 // 두 쪽 : 각 쪽이 가로 절반
      function one(w, h) { var fw = aw / w, fh = ah / h; return S.fit === 'page' ? Math.min(fw, fh) : fw; }
      var full = one(info.w, info.h); if (!cr) return full;
      var up = one(info.w * (cr.x1 - cr.x0), info.h * (cr.y1 - cr.y0));
      return up < full * CROP_MIN_GAIN ? full : Math.min(up, full * CROP_MAX_UP);
    }
    /* ------------------------------------------------------------ 두 쪽 나란히 (컴퓨터 화면)
       왼쪽 = 지금 쪽 (필기 · 실시간 동기화는 이 쪽에만 — 기존 그대로). 오른쪽 = 다음 쪽 (보기 전용, 눌러서 왼쪽으로 가져오면 필기 가능). */
    var box2 = $('.pv-pagebox2'), pdf2 = $('.pv-pdf2'), spreadBtn = $('.pv-spreadbtn');
    /* 허브 v5 — 아이패드를 가로로 눕힌 태블릿 화면(라이브 모드)에서도 두 쪽을 나란히 (넓은 가로 화면에서만) */
    function landscapeWide() { var w = root.innerWidth || 0, hh = root.innerHeight || 0; return w > hh && w >= 1000; }
    function spreadAllowed() { return S.layout === 'computer' || (S.layout === 'tablet' && landscapeWide()); }
    function spreadOn() { return !!S.spread && spreadAllowed() && stage.clientWidth >= 860; }
    function syncSpreadUi() {
      var on = spreadOn(), can = spreadAllowed();
      el.classList.toggle('pv-spread', on); spreadBtn.style.display = can ? '' : 'none';
      spreadBtn.classList.toggle('on', on); spreadBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (!on) box2.style.display = 'none';
    }
    function renderRight(id, pg, d, base, dpr) {
      syncSpreadUi();
      if (!spreadOn() || pg >= d.n) { box2.style.display = 'none'; return; }
      pageInfo(d, pg + 1).then(function (info) {
        if (id !== S.rid || !spreadOn()) return;
        var w = Math.max(50, Math.floor(info.w * base)), hh = Math.max(50, Math.floor(info.h * base));
        box2.style.display = ''; box2.style.width = w + 'px'; box2.style.height = hh + 'px';
        pdf2.style.width = w + 'px'; pdf2.style.height = hh + 'px'; pdf2.width = Math.round(w * dpr); pdf2.height = Math.round(hh * dpr);
        var c = pdf2.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, pdf2.width, pdf2.height);
        try { info.draw(pdf2, base * dpr); } catch (e) { box2.style.display = 'none'; }
      }, function () { box2.style.display = 'none'; });
    }
    box2.onclick = function () { if (S.page < S.pages) goPage(S.page + 1, true); toast('필기하려면 이 쪽이 왼쪽에 옵니다. 다음 쪽은 오른쪽에 보입니다.'); };
    S.spread = ls('spread') === '1' || (ls('spread') === null && S.layout === 'tablet' && landscapeWide());   // 태블릿 가로 화면은 처음에 두 쪽 (직접 끄면 기억)
    function toggleSpread() {
      if (!spreadAllowed() || stage.clientWidth < 860) { toast('두 쪽 보기는 넓은 화면(컴퓨터 · 가로로 눕힌 태블릿)에서만 됩니다.', true); return; }
      S.spread = !S.spread; ls('spread', S.spread ? '1' : '0'); S.zoom = 1; renderPage();
    }
    /* ------------------------------------------------------------ 그려 둔 쪽 그림 저장소
       쪽을 넘기거나 앞뒤로 되돌아갈 때, 또는 화면 크기가 그대로인 채 패널만 열고 닫을 때 PDF 를 처음부터 다시 그리지 않도록
       "이미 그려 둔 쪽 그림"을 메모리에 둡니다. 키 = 악보 + 쪽 + 화면 크기 + 화소 배율 (하나라도 다르면 새로 그림).
       · 메모리는 64MB · 10쪽까지만 (오래 안 쓴 것부터 버림) — 아이패드 같은 기기가 느려지지 않게
       · 지금 쪽을 그린 뒤 한가한 때 앞 · 뒤 쪽을 미리 그려 둡니다 (쪽 넘기기가 바로 됨) */
    S.pcache = new Map(); S.pcBytes = 0; S.pcCur = ''; S.drawnSig = null; S.drawnOk = false; S.pending = null;
    /* 폰 · 작은 태블릿은 화면 그림 자체가 메모리를 많이 쓰므로 저장소를 더 작게 (48MB), 컴퓨터는 96MB */
    var PHONE = (root.innerWidth || 1200) < 900 || (root.matchMedia && root.matchMedia('(pointer: coarse)').matches && (root.innerWidth || 1200) < 1100);
    var PC_MAX_BYTES = (PHONE ? 48 : 96) * 1024 * 1024, PC_ONE_MAX = (PHONE ? 22 : 40) * 1024 * 1024, PC_MAX_N = 10;
    function pcSig(d, pg, w, h, dpr) { return d.fid + '|' + pg + '|' + w + 'x' + h + '@' + dpr; }
    function pcGet(sig) { var e = S.pcache.get(sig); if (!e) return null; S.pcache.delete(sig); S.pcache.set(sig, e); return e; }      // 방금 쓴 것을 맨 뒤로 (가장 오래 안 쓴 것이 앞)
    function pcDrop(k) { var e = S.pcache.get(k); if (!e) return; S.pcache.delete(k); S.pcBytes -= e.bytes; try { e.cv.width = e.cv.height = 0; } catch (x) {} }
    function pcClear() { Array.from(S.pcache.keys()).forEach(pcDrop); S.pcBytes = 0; }
    /** bytes 가 들어갈 자리를 만듭니다 — 가장 오래 안 쓴 것부터 버리되 지금 보는 쪽(S.pcCur)은 지키고, 그래도 안 되면 false */
    function pcRoom(bytes) {
      var keys = Array.from(S.pcache.keys()), i = 0;
      while ((S.pcBytes + bytes > PC_MAX_BYTES || S.pcache.size >= PC_MAX_N) && i < keys.length) { var k = keys[i++]; if (k !== S.pcCur) pcDrop(k); }
      return S.pcBytes + bytes <= PC_MAX_BYTES && S.pcache.size < PC_MAX_N;
    }
    function pcAdd(sig, cv) {                                            // cv 를 저장소가 넘겨받습니다 (복사 없음). 자리가 없으면 저장하지 않고 버립니다
      var bytes = cv.width * cv.height * 4;
      if (bytes > PC_ONE_MAX || S.pcache.has(sig) || !pcRoom(bytes)) { try { cv.width = cv.height = 0; } catch (x) {} return; }
      S.pcache.set(sig, { cv: cv, bytes: bytes }); S.pcBytes += bytes;
    }
    function pcCopy(sig, src) {                                          // 화면 canvas 를 복사해 저장 (복사 한 번 — 화면에 그린 직후)
      var bytes = src.width * src.height * 4; if (bytes > PC_ONE_MAX || S.pcache.has(sig) || !pcRoom(bytes)) return;
      var c2 = doc.createElement('canvas'); c2.width = src.width; c2.height = src.height;
      try { c2.getContext('2d').drawImage(src, 0, 0); } catch (e) { return; }
      pcAdd(sig, c2);
    }
    /** 쪽 크기 · 화면 크기 · 배율에서 나오는 그림 크기 (그리기 · 미리 그리기 · 저장소 키가 같은 계산을 쓰도록 한 곳에) */
    function layoutOf(info, cr) {
      var base = fitScale(info, cr) * S.zoom, cssW = Math.max(50, Math.floor(info.w * base)), cssH = Math.max(50, Math.floor(info.h * base));
      var dpr = Math.min(2, root.devicePixelRatio || 1); while (cssW * cssH * dpr * dpr > 14e6 && dpr > 1) dpr -= 0.25;
      return { base: base, cssW: cssW, cssH: cssH, dpr: dpr };
    }
    function cropFor(d, pg, info) { return S.crop && !spreadOn() ? cropOf(d, pg, info) : Promise.resolve(null); }
    /** 지금 쪽 앞 · 뒤 한 쪽을 브라우저가 한가할 때 미리 그려 저장소에 둡니다 (화면 · 필기에는 손대지 않음) */
    function prefetch(d, pg0, id) {
      if (spreadOn() || S.dead) return;
      var run = function () {
        if (id !== S.rid || S.dead || S.doc !== d) return;
        [pg0 + 1, pg0 - 1].filter(function (n) { return n >= 1 && n <= d.n; }).reduce(function (p, n) {
          return p.then(function () {
            if (id !== S.rid || S.doc !== d) return;
            return pageInfo(d, n).then(function (info) {
              return cropFor(d, n, info).then(function (cr) {
                if (id !== S.rid || S.doc !== d) return;
                var L = layoutOf(info, cr), sig = pcSig(d, n, L.cssW, L.cssH, L.dpr);
                var pb = Math.round(L.cssW * L.dpr) * Math.round(L.cssH * L.dpr) * 4;
                if (S.pcache.has(sig) || pb > PC_ONE_MAX || !pcRoom(pb)) return;          // 자리가 없으면 미리 그리지 않음 (지금 쪽 그림은 지킴)
                var off = doc.createElement('canvas'); off.width = Math.round(L.cssW * L.dpr); off.height = Math.round(L.cssH * L.dpr);
                var c = off.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, off.width, off.height);
                var t = info.draw(off, L.base * L.dpr);
                return t.promise.then(function () { if (id === S.rid && S.doc === d && !S.dead) pcAdd(sig, off); else { off.width = off.height = 0; } }, function () { off.width = off.height = 0; });
              });
            });
          });
        }, Promise.resolve()).catch(function () { /* 미리 그리기는 실패해도 화면에 영향 없음 */ });
      };
      if (root.requestIdleCallback) root.requestIdleCallback(run, { timeout: 1500 }); else setTimeout(run, 250);
    }
    /** 지금 쪽을 화면에 그립니다.
     *   · 같은 쪽 · 같은 크기를 이미 그려 뒀으면 아무것도 하지 않음 (리사이즈 · 패널 열고 닫기 · 도구 막대 접기가 여러 번 불러도 한 번만 그림)
     *   · 같은 그림을 이미 그리는 중이면 그 작업을 그대로 이어받음
     *   · 저장소에 있으면 그림을 붙이기만 함 — 없으면 PDF 를 그리고 저장
     *   force=true 이면 무조건 다시 그림 */
    function renderPage(force) {
      if (!S.doc || S.dead) return Promise.resolve();
      var id = ++S.rid, pg = S.page, d = S.doc;
      return pageInfo(d, pg).then(function (info) {
        if (id !== S.rid) return;
        return cropFor(d, pg, info).then(function (cr) { return [info, cr]; });
      }).then(function (ic) {
        if (!ic || id !== S.rid) return; var info = ic[0], cr = ic[1], L = layoutOf(info, cr), cssW = L.cssW, cssH = L.cssH, dpr = L.dpr, base = L.base;
        var sig = pcSig(d, pg, cssW, cssH, dpr) + (spreadOn() ? '|s' : '');
        if (!force && S.drawnOk && S.drawnSig === sig) { S.anchor = null; S.cropNow = cr || null; loading.style.display = 'none'; S.rid = S.drawnId; syncTouch(); return; }      // (번호를 되돌려, 진행 중인 미리 그리기가 취소되지 않게)
        if (!force && S.pending && S.pending.sig === sig) { S.rid = S.pending.id; return S.pending.p; }              // 같은 그림을 이미 그리는 중
        if (S.task) { try { S.task.cancel(); } catch (e) {} S.task = null; }
        S.drawnOk = false; S.drawnSig = null;
        var pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
        box.style.width = cssW + 'px'; box.style.height = cssH + 'px';
        pdfCv.style.width = cssW + 'px'; pdfCv.style.height = cssH + 'px';
        if (pdfCv.width !== pw || pdfCv.height !== ph) { pdfCv.width = pw; pdfCv.height = ph; }
        var c = pdfCv.getContext('2d');
        an.resize(cssW, cssH); an.setPage(pg);
        S.cropNow = cr || null;
        if (S.zoom === 1) {                                                        // 자동 맞춤: 글자가 있는 부분의 시작점에 스크롤을 맞춤 (여백은 위 · 옆으로 스크롤하면 보임)
          stage.scrollLeft = cr && !spreadOn() ? Math.max(0, box.offsetLeft + cr.x0 * cssW - 4) : 0;
          stage.scrollTop = cr && !spreadOn() ? Math.max(0, box.offsetTop + cr.y0 * cssH - ((dockPad() ? DOCK_PAD : 4) + badgePad())) : 0;      // 글자 시작점이 (도크가 열려 있으면) 도크 바로 밑에 오게
        }
        if (S.anchor) {                                                            // 두 손가락 확대 직후: 손가락 사이 지점이 손가락 자리에 그대로 오도록
          var an0 = S.anchor; S.anchor = null;
          if (Date.now() - an0.t < 3000) {
            var sr = stage.getBoundingClientRect();
            stage.scrollLeft = Math.max(0, box.offsetLeft + an0.fx * cssW - (an0.cx - sr.left));
            stage.scrollTop = Math.max(0, box.offsetTop + an0.fy * cssH - (an0.cy - sr.top));
          }
        }
        var done = function () { if (id === S.rid) { S.task = null; S.pcCur = pcSig(d, pg, cssW, cssH, dpr); S.drawnSig = sig; S.drawnId = id; S.drawnOk = true; S.pending = null; loading.style.display = 'none'; syncTouch(); prefetch(d, pg, id); } };
        var hit = pcGet(pcSig(d, pg, cssW, cssH, dpr));
        if (hit) {                                                                 // 이미 그려 둔 그림 — 붙이기만
          c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(hit.cv, 0, 0); renderRight(id, pg, d, base, dpr); done(); return;
        }
        c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#fff'; c.fillRect(0, 0, pdfCv.width, pdfCv.height);
        var t = info.draw(pdfCv, base * dpr); S.task = t;
        renderRight(id, pg, d, base, dpr);
        var pr = t.promise.then(function () {
          if (id === S.rid) { pcCopy(pcSig(d, pg, cssW, cssH, dpr), pdfCv); done(); }
        }, function (e) {
          if (S.pending && S.pending.id === id) S.pending = null;
          if (e && e.name === 'RenderingCancelledException') return; loading.style.display = 'none'; toast('이 쪽을 그리지 못했습니다.', true);
        });
        S.pending = { sig: sig, id: id, p: pr };
        return pr;
      }, function () { loading.style.display = 'none'; toast('이 쪽을 읽지 못했습니다.', true); });
    }
    /** 여러 곳에서 "다시 그려라"가 몰려 와도 한 번만 (마지막 요청 기준) — 리사이즈 · 패널 · 도구 막대 접기 */
    function renderSoon(ms) {
      clearTimeout(S.rsT);
      S.rsT = setTimeout(function () { S.rsT = 0; if (S.doc && !S.dead) renderPage(); }, ms == null ? 120 : ms);
    }
    function pgLabel() { var t = S.page + ' / ' + S.pages; $('.pv-pg').textContent = t; var f = $('.pv-fspg'); if (f) f.textContent = t; }

    function loadSheet(idx, page, fromUser) {
      idx = clamp(idx | 0, 0, sheets.length - 1);
      var f = sheets[idx], lid = ++S.loadId;
      flushMine(); an.closeEditor();
      S.sheetIdx = idx; sheetSel.value = String(idx); loading.style.display = 'flex'; loading.textContent = '악보를 불러오는 중…';
      var g = guessSong(f.name, songs); if (g >= 0 && S.songIdx !== g && !S.applying) setSong(g, true);
      var pgT = root.setInterval(function () {                                        // 내려받는 동안 "악보를 불러오는 중… 42% (1.3MB / 3.0MB)"
        var pr = PROG[f.id];
        if (lid !== S.loadId || S.dead || !pr) { if (lid !== S.loadId || S.dead) root.clearInterval(pgT); return; }
        loading.textContent = '악보를 불러오는 중… ' + (pr.total ? Math.min(99, Math.round(pr.got / pr.total * 100)) + '% (' + mbText(pr.got) + ' / ' + mbText(pr.total) + ')' : mbText(pr.got));
      }, 150);
      return fetchDoc(f).then(function (d) {
        root.clearInterval(pgT);
        if (lid !== S.loadId || S.dead) return;
        loading.textContent = '악보를 그리는 중…';
        S.doc = d; S.pages = d.n; S.page = clamp(page || 1, 1, d.n); pgLabel();
        loadAnno(); P.emit('sheet', { file: f, doc: d });
        syncSongForPage(); scanTitles(d, f);
        return renderPage().then(function () { if (fromUser) sendNav(); preloadSheets(); });
      }).catch(function (e) {
        root.clearInterval(pgT);
        if (lid !== S.loadId) return;
        S.doc = null; loading.style.display = 'flex'; loading.textContent = (e && e.message) || '악보를 불러오지 못했습니다.'; toast(loading.textContent, true, 7000);
      });
    }
    /* v6.9 — 지금 악보를 그린 뒤, 한가할 때 나머지 악보(최대 4개)를 미리 받아 둡니다 → 페이지 컨트롤이 다른 악보로 넘겨도 내려받기를 기다리지 않음 (순서대로 하나씩 · 실패는 무시) */
    function preloadSheets() {
      if (S.preT || S.dead || sheets.length < 2) return;
      var order = []; for (var k = 1; k < sheets.length && order.length < 4; k++) { var j = (S.sheetIdx + k) % sheets.length; order.push(sheets[j]); }
      S.preT = setTimeout(function () {
        var i = 0, go = function () {
          if (S.dead || i >= order.length) { S.preT = 0; return; }
          var f = order[i++]; if (!f || S.cache[f.id]) return go();
          fetchDoc(f).then(function () { setTimeout(go, 150); }, function () { setTimeout(go, 150); });
        };
        go();
      }, 1200);
    }
    function goPage(n, fromUser) {
      if (!S.doc) return; n = clamp(n | 0, 1, S.pages); if (n === S.page) return;
      S.page = n; pgLabel(); stage.scrollTop = 0; an.closeEditor(); syncSongForPage(); renderPage(); P.emit('page', n);
      if (fromUser) sendNav();
    }
    function nextPage(user) {
      if (S.page < S.pages) goPage(S.page + (spreadOn() && S.page + 1 < S.pages ? 2 : 1), user);
      else if (S.sheetIdx < sheets.length - 1) loadSheet(S.sheetIdx + 1, 1, user);
    }
    function prevPage(user) {
      if (S.page > 1) goPage(S.page - (spreadOn() && S.page > 2 ? 2 : 1), user);
      else if (S.sheetIdx > 0) { var pi = S.sheetIdx - 1; loadSheet(pi, 9999, user); }
    }
    function setZoom(z, user) { S.zoom = clamp(z, 0.4, 5); renderPage(); if (user) sendNav(); }
    /** Ctrl+휠 · 트랙패드 핀치처럼 짧은 시간에 여러 번 오는 확대는, 화면은 CSS 로 바로 크기만 미리 보여 주고 실제 다시 그리기는 멈춘 뒤 한 번만 */
    var wz = { z: 0, t: 0 };
    function wheelZoom(factor) {
      var cur = wz.t ? wz.z : S.zoom; wz.z = clamp(cur * factor, 0.4, 4);
      pinchPreview(wz.z / S.zoom);
      clearTimeout(wz.t);
      wz.t = setTimeout(function () { wz.t = 0; if (S.dead) return; pinchPreview(1); if (Math.abs(wz.z - S.zoom) > 0.005) setZoom(wz.z, true); }, 140);
    }
    function scrollFrac() { var sh = stage.scrollHeight - stage.clientHeight; return sh > 4 ? clamp(stage.scrollTop / sh, 0, 1) : 0; }

    /* ------------------------------------------------------------ 쪽 ↔ 곡 연결
       PDF 한 파일에 여러 곡이 들어 있을 수 있으므로 BPM · 송폼은 "파일"이 아니라 "쪽"에 붙습니다.
       ① 쪽 위쪽 글자에서 곡 제목을 찾아 자동 연결 (제목이 없는 쪽은 앞 쪽의 곡이 이어짐)  ② 사진 악보 · 글자가 없는 PDF 는 파일 이름으로 짐작
       ③ 틀리면 위 드롭다운으로 그 쪽의 곡을 직접 고름 (기기에 기억) — 고친 쪽부터 다음 제목이 나올 때까지 이어집니다. */
    /* ------------------------------------------------------------ 설정 팀 공유 (Step 2.9)
       쪽↔곡 연결 · 곡별 메트로놈 · 곡 정보(BPM · 송폼 · 유튜브)를 서버(시트)에 저장하고 같은 방 사람들에게 실시간으로 나눕니다.
       · "나만 보기" 를 켜거나 팀장 · 인도자가 아니면 → 내 설정(mine)으로만 저장, 전달하지 않음
       · 팀 설정(team)은 팀장 · 인도자만 바꿀 수 있고, 저장되는 즉시 웹소켓으로 팀 화면에 반영됩니다
       · 내 설정이 팀 설정보다 우선합니다 (내가 "나만 보기" 로 바꿔 둔 것은 팀 값이 바뀌어도 그대로) */
    /* 따라가기는 두 스위치가 독립 — S.follow(페이지) · S.followM(메트로놈). "동기화 끄기(수동)" = 둘 다 끈 상태의 별칭.
       예전에 저장된 수동(manual=1)은 두 스위치를 모두 끈 것으로 옮겨 줍니다. */
    /* v6 — 메트로놈 따라가기는 없앴습니다 (메트로놈은 기기마다 따로). 따라가기 = 페이지만. "동기화 끄기(수동)" = 페이지 따라가기 끔 */
    if (ls('fpage') === null && ls('manual') === '1') { S.follow = false; ls('fpage', '0'); }
    Object.defineProperty(S, 'manual', { get: function () { return !S.follow; }, enumerable: true });
    S.cid = 'c' + Math.random().toString(36).slice(2, 10);
    S.cfg = { team: {}, mine: {} }; S.cfgLoaded = false;
    function ck(kind, key) { return kind + '|' + key; }
    function canTeam() { return !!(opts.canEdit || (rt && rt.me && rt.me.canEdit)); }
    function cfgLayer() { return S.layer === 'mine' || !canTeam() ? 'mine' : 'team'; }
    function cfgGet(kind, key) { var k = ck(kind, key); return S.cfg.mine[k] !== undefined ? S.cfg.mine[k] : S.cfg.team[k]; }
    function cfgSend(layer, kind, key, value, done) {
      if (!opts.callServer || !S.room) { if (done) done(false); return; }
      opts.callServer('worshipCfgSave', [opts.token, S.room, layer, kind, key, value == null ? null : value, S.cid],
        function (r) { if (done) done(true, r); },
        function (e) { toast('설정을 저장하지 못했습니다: ' + ((e && e.message) || ''), true); if (done) done(false, e); });
    }
    function cfgSet(kind, key, value) {
      var layer = cfgLayer(), k = ck(kind, key);
      if (kind === 'song') layer = 'mine';
      if (value == null) delete S.cfg[layer][k]; else S.cfg[layer][k] = value;
      if (layer === 'team' && S.cfg.mine[k] !== undefined) { delete S.cfg.mine[k]; cfgSend('mine', kind, key, null); }     // 팀에 저장하면 내 예전 개인 설정은 정리
      if (layer === 'mine' && !canTeam() && !S.warnedMine) { S.warnedMine = true; toast('팀 공유 설정은 팀장 · 인도자만 바꿀 수 있어서, 이번 설정은 내 기기 · 내 계정에만 저장됩니다.', false, 3200); }
      cfgSend(layer, kind, key, value);
      return layer;
    }
    function fillCfg(list, layer) { S.cfg[layer] = {}; (list || []).forEach(function (e) { if (e && e.kind && e.key != null && e.value != null) S.cfg[layer][ck(e.kind, e.key)] = e.value; }); }
    /** 나만 보기로 바꿔 둔 곡 정보(BPM · 송폼 · 링크)를 곡 목록에 덧씌웁니다 */
    function applySongCfg() { songs.forEach(function (s) { var o = S.cfg.mine[ck('song', s.title)]; if (o) Object.assign(s, o); }); }
    function songIdentity(s) { return s ? (s.kind && s.seq ? s.kind + '|' + s.seq : 't|' + s.title) : ''; }
    function replaceSongs(list) {
      var keep = songIdentity(songs[S.songIdx]);
      songs.length = 0; (list || []).forEach(function (x) { songs.push(x); });
      applySongCfg();
      S.maps = {};                                                       // 곡 순서가 바뀌었을 수 있어 쪽↔곡 연결을 다시 계산
      var ni = -1; songs.forEach(function (x, i) { if (ni < 0 && songIdentity(x) === keep) ni = i; });
      if (ni < 0) ni = S.songIdx >= 0 && S.songIdx < songs.length ? S.songIdx : -1;
      renderSongSel(); if (S.doc) { scanTitles(S.doc, sheets[S.sheetIdx]); var idx = resolveSong(sheets[S.sheetIdx], S.page); if (idx >= 0) ni = idx; }
      setSong(ni, true); P.emit('songs');
    }
    function applyMapCfg(fileIdV, force) {
      var m = S.maps[fileIdV]; if (!m) return;
      var v = cfgGet('map', fileIdV); if (!v && !force) return; m.manual = v ? JSON.parse(JSON.stringify(v)) : {};
      if (S.doc && sheets[S.sheetIdx] && sheets[S.sheetIdx].id === fileIdV) { syncSongForPage(); renderSongSel(); }
    }
    function loadCfg() {
      if (!opts.callServer || !S.room) return;
      opts.callServer('worshipCfgLoad', [opts.token, S.room], function (r) {
        if (S.dead || !r) return;
        fillCfg(r.team, 'team'); fillCfg(r.mine, 'mine'); S.cfgLoaded = true;
        if (Array.isArray(r.songs) && r.songs.length) {                                        // 허브에서 방금 바뀐 곡 정보 · 순번(seq · kind)을 채움
          var titles = songs.map(function (x) { return x.title; }).join('\u0001'), nt = r.songs.map(function (x) { return x.title; }).join('\u0001');
          if (titles === nt) { songs.forEach(function (x, i) { Object.assign(x, r.songs[i]); }); applySongCfg(); }
          else replaceSongs(r.songs);
        }
        applyPrefs(S.cfg.mine[ck('follow', 'sync')]);
        Object.keys(S.maps).forEach(function (id) { applyMapCfg(id, false); });
        if (S.doc) { syncSongForPage(); renderSongSel(); if (S.songIdx >= 0) setSong(S.songIdx, true); }
        P.emit('cfg', { kind: 'all', key: '', remote: false });
      }, function () { /* 연결이 안 되면 이 기기에 기억된 값으로 계속 */ });
    }
    function onRemoteCfg(m) {
      if (!m || m.cid === S.cid || !m.kind) return;
      var k = ck(m.kind, m.key);
      if (m.value == null) delete S.cfg.team[k]; else S.cfg.team[k] = m.value;
      if (m.kind === 'map') { applyMapCfg(m.key, true); if (sheets[S.sheetIdx] && sheets[S.sheetIdx].id === m.key) toast(YNHon.say(m.by || '팀') + ' 쪽 ↔ 곡 연결을 바꿨습니다.', false, 2200); }
      P.emit('cfg', { kind: m.kind, key: m.key, remote: true, by: m.by });
    }
    function applySongPatch(kind, seq, patch, by, remote) {
      var i = -1; songs.forEach(function (x, j) { if (i < 0 && x.seq === seq && (x.kind || '콘티') === kind) i = j; });
      if (i < 0 || !patch) return;
      Object.assign(songs[i], patch); applySongCfg();
      if (i === S.songIdx) setSong(i, true);
      renderSongSel(); P.emit('songedit', songs[i], !!remote);
      if (remote) toast(YNHon.say(by || '팀') + ' "' + songs[i].title + '" 곡 정보를 바꿨습니다.', false, 2400);
    }
    function songsSig(list) { return (list || []).map(function (x) { return [x.title, x.key, x.bpm, x.form, x.link, x.team, x.seq, x.kind].join('\u0002'); }).join('\u0001'); }
    var refetchT = 0;
    function refetchSongs() {
      clearTimeout(refetchT);
      refetchT = setTimeout(function () {
        if (!opts.callServer || !S.room || S.dead) return;
        opts.callServer('worshipSongsOf', [opts.token, S.room], function (r) {
          if (S.dead || !r || !Array.isArray(r.songs)) return;
          if (songsSig(r.songs) === songsSig(songs)) return;                        // 실제로 달라진 게 없으면 다시 그리지도, 알림을 띄우지도 않음
          replaceSongs(r.songs); toast('허브에서 곡 목록이 바뀌어 새로 불러왔습니다.', false, 2200);
        }, function () {});
      }, 400);
    }
    /** 곡 정보(BPM · 송폼 · 유튜브 링크) 저장 — 팀 층이면 '찬양콘티' 줄을 고쳐 팀에 실시간 전달, 나만 보기면 내 설정으로 */
    function saveSongInfo(idx, patch, done) {
      var s = songs[idx]; if (!s || !patch) { if (done) done(false); return; }
      var layer = cfgLayer(), fail = function (e) { toast((e && e.message) || '저장하지 못했습니다.', true); if (done) done(false); };
      if (layer === 'team' && s.seq && s.kind && opts.callServer && S.room) {
        opts.callServer('worshipSongPatch', [opts.token, S.room, s.kind, s.seq, patch, S.cid], function (r) {
          var k = ck('song', s.title); if (S.cfg.mine[k] !== undefined) { delete S.cfg.mine[k]; cfgSend('mine', 'song', s.title, null); }
          Object.assign(s, r && r.song ? { bpm: r.song.bpm, form: r.song.form, link: r.song.link } : patch); applySongCfg();
          if (patch.bpm) { var mc0 = cfgGet('metro', s.title); if (mc0 && mc0.bpm) cfgSet('metro', s.title, Object.assign({}, mc0, { bpm: +patch.bpm })); }         // 곡 BPM 을 새로 정하면 예전 메트로놈 BPM 도 맞춤
          if (idx === S.songIdx) setSong(idx, true); renderSongSel(); P.emit('songedit', s, false);
          toast('팀 모두에게 저장했습니다.', false, 1800); if (done) done(true);
        }, fail);
      } else {
        var k2 = ck('song', s.title), cur = Object.assign({}, S.cfg.mine[k2] || {}, patch);
        S.cfg.mine[k2] = cur; Object.assign(s, patch);
        if (patch.bpm) { var mc1 = S.cfg.mine[ck('metro', s.title)]; if (mc1 && mc1.bpm) cfgSet('metro', s.title, Object.assign({}, mc1, { bpm: +patch.bpm })); }
        cfgSend('mine', 'song', s.title, cur, function (ok) { if (ok) toast('나에게만 저장했습니다.', false, 1600); if (done) done(ok); });
        if (idx === S.songIdx) setSong(idx, true); renderSongSel(); P.emit('songedit', s, false);
      }
    }
    S.maps = {};
    function mapOf(f) {
      var m = S.maps[f.id];
      if (!m) {
        var saved = {}, shared = cfgGet('map', f.id);
        if (shared) saved = JSON.parse(JSON.stringify(shared)); else { try { saved = JSON.parse(ls('map.' + (S.room || '') + '.' + f.id) || '{}') || {}; } catch (e) { saved = {}; } }
        if (!shared && !Object.keys(saved).length && f.map) { saved = {}; Object.keys(f.map).forEach(function (p) { saved[p] = f.map[p]; }); }       // 곡별 악보로 저장해 둔 쪽 범위가 기본 연결
        m = S.maps[f.id] = { auto: {}, manual: saved, scanned: false, scanning: false, base: guessSong(f.name, songs) };
      }
      return m;
    }
    function saveManual(f) {
      var man = mapOf(f).manual;
      try { ls('map.' + (S.room || '') + '.' + f.id, JSON.stringify(man)); } catch (e) {}                 // 기기 기억은 그대로 (연결이 끊겼을 때 대비)
      cfgSet('map', f.id, Object.keys(man).length ? man : null);                                          // 서버 저장 + 팀에 실시간 전달 (나만 보기면 내 것만)
    }
    function resolveSong(f, pg) {
      var m = mapOf(f), cur = m.base;
      for (var p = 1; p <= pg; p++) { if (m.manual[p] != null) cur = m.manual[p]; else if (m.auto[p] != null) cur = m.auto[p]; }
      return cur;
    }
    function autoSongAt(f, pg) { var m = mapOf(f), cur = m.base; for (var p = 1; p <= pg; p++) if (m.auto[p] != null) cur = m.auto[p]; return cur; }
    function scanTitles(d, f) {
      var m = mapOf(f);
      if (m.scanned || m.scanning || !d.pdf || !songs.length) { m.scanned = true; return Promise.resolve(); }
      m.scanning = true;
      var titles = songs.map(function (x) { return normName(x.title); }), pg = 1, last = Math.min(d.n, 120);
      function step() {
        if (pg > last || S.dead) { m.scanning = false; m.scanned = true; return Promise.resolve(); }
        var p = pg++;
        return d.pdf.getPage(p).then(function (page) {
          var top = page.view ? page.view[3] : 0;
          return page.getTextContent().then(function (tc) {
            var head = tc.items.filter(function (it) { return it.str && (!top || !it.transform || it.transform[5] >= top * 0.6); }).slice(0, 40).map(function (it) { return it.str; }).join('');
            var n = normName(head), best = -1, bl = 0;
            titles.forEach(function (t, i) { if (t.length >= 2 && n.indexOf(t) >= 0 && t.length > bl) { best = i; bl = t.length; } });
            if (best >= 0) m.auto[p] = best;
          });
        }).catch(function () {}).then(step);
      }
      return step().then(function () { if (S.doc === d) syncSongForPage(); });
    }
    function songLabel(i) { return i >= 0 && songs[i] ? (i + 1) + '. ' + songs[i].title : '없음'; }
    function renderSongSel() {
      var sel = $('.pv-songsel'); if (!sel) return;
      if (!songs.length) { sel.style.display = 'none'; return; }
      var f = sheets[S.sheetIdx], m = mapOf(f), man = m.manual[S.page], auto = autoSongAt(f, S.page);
      var html = '<option value="auto">자동 · ' + h(songLabel(auto)) + '</option>' + songs.map(function (x, i) { return '<option value="' + i + '">' + h((i + 1) + '. ' + x.title) + '</option>'; }).join('') +
        (canTeam() && opts.callServer && S.room ? '<option value="__split">▸ 곡별 악보로 저장…</option>' : '');
      sel.innerHTML = html; sel.value = man != null ? String(man) : 'auto'; sel.style.display = '';
      sel.classList.toggle('manual', man != null);
      var sb = $('.pv-splitbtn'); if (sb && !sb.getAttribute('data-p')) { sb.setAttribute('data-p', '1'); splitBtnPaint(f.map && Object.keys(f.map).length ? 'saved' : 'dirty'); } else if (sb) sb.style.display = (canTeam() && opts.callServer && S.room && songs.length) ? '' : 'none';
    }
    function syncSongForPage() {
      if (S.applying || !S.doc || S.dead) return;
      var idx = resolveSong(sheets[S.sheetIdx], S.page);
      if (idx >= 0 && idx !== S.songIdx) setSong(idx, true);
      renderSongSel(); updateFormBadge();
    }
    /* 송폼 배지 (Step 2.15) — 콘티에 송폼이 정해져 있으면 그 곡 악보의 맨 위에 "V1 – C – V2 – B – C – Out" 을 유리 알약으로 띄웁니다.
       악보 그림(캔버스) 위의 HTML 덮개일 뿐이라 필기 좌표 · 실시간 동기화 · PNG/PDF 내보내기에는 영향이 없습니다. 쪽 안에서 스크롤해도 화면 위에 붙어 따라옵니다(sticky). */
    var fbadge1 = doc.createElement('div'), fbadge2 = doc.createElement('div');
    fbadge1.className = 'pv-formbadge'; fbadge2.className = 'pv-formbadge'; fbadge1.setAttribute('aria-live', 'polite');
    box.insertBefore(fbadge1, box.firstChild);
    var box2El = $('.pv-pagebox2'); if (box2El) box2El.insertBefore(fbadge2, box2El.firstChild);
    function formTokens(s) {
      var f = s && String(s.form || '').trim(); if (!f) return [];
      try { if (root.YNForm && root.YNForm.parse) return root.YNForm.parse(f).filter(function (t) { return t && t.k; }); } catch (e) { /* 아래 간단 나누기로 */ }
      return f.split(/\s*[-–>,\/]\s*|\s+/).filter(Boolean).map(function (k) { return { k: k }; });
    }
    function fbDisp(k) { try { return root.YNForm && root.YNForm.disp ? root.YNForm.disp(k) : k; } catch (e) { return k; } }
    function fbCall(k) { try { return !!(root.YNForm && root.YNForm.isCall && root.YNForm.isCall(k)); } catch (e) { return false; } }
    function formBadgeHtml(idx) {
      var s = idx >= 0 ? songs[idx] : null, t = formTokens(s); if (!t.length) return '';
      return '<span class="pv-fb-in" role="img" aria-label="송폼 ' + h(t.map(function (x) { return fbDisp(x.k) + (x.rep > 1 ? ' ×' + x.rep : ''); }).join(', ')) + '">' +
        '<svg class="pv-fb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
        t.map(function (x, i) { return (i ? '<b class="pv-fb-sep" aria-hidden="true">–</b>' : '') + '<span class="pv-fb-t' + (x.custom ? ' cu' : '') + (fbCall(x.k) ? ' call' : '') + '" data-s="' + idx + '" data-i="' + i + '" data-k="' + h(x.k) + '">' + h(fbDisp(x.k)) + (x.rep > 1 ? '<sub>×' + x.rep + '</sub>' : '') + '</span>'; }).join('') + '</span>';
    }
    function badgeIdx(pg) { return S.fbadge !== false && S.doc && pg >= 1 && pg <= (S.pages || 1) ? resolveSong(sheets[S.sheetIdx], pg) : -1; }
    function updateFormBadge() {
      if (S.dead) return;
      var h1 = formBadgeHtml(badgeIdx(S.page)); if (fbadge1.getAttribute('data-h') !== h1) { fbadge1.innerHTML = h1; fbadge1.setAttribute('data-h', h1); }
      var h2 = spreadOn() ? formBadgeHtml(badgeIdx(S.page + 1)) : ''; if (fbadge2.getAttribute('data-h') !== h2) { fbadge2.innerHTML = h2; fbadge2.setAttribute('data-h', h2); }
    }
    /** 배지가 쪽 맨 위를 가리지 않게, 글자가 시작하는 곳을 배지 아래로 (컴퓨터 화면은 배지가 오른쪽 위 빈 곳에 뜨므로 그대로) */
    function badgePad() { return 0; }                                  // v6 — 송폼은 악보 위가 아니라 떠 있는 "송폼" 창에 (쪽 맨 위를 가리지 않음)
    /** 지금 악보의 쪽 ↔ 곡 연결(자동 + 직접 고른 것)을 곡별 악보(곡 + 쪽 범위)로 저장 — 다음에 그 곡을 콘티에 가져오면 쪽 범위도 같이 따라옵니다 */
    function splitBtnPaint(state) {            // state: 'dirty' | 'saving' | 'saved'
      var b = $('.pv-splitbtn'); if (!b) return;
      var show = canTeam() && opts.callServer && S.room && songs.length; b.style.display = show ? '' : 'none';
      b.textContent = state === 'saving' ? '저장 중…' : state === 'saved' ? '✓ 곡별 저장됨' : '💾 곡별 저장'; b.classList.toggle('on', state === 'saved'); b.disabled = state === 'saving';
    }
    var splitT = 0;
    /** auto=true: 직접 고른 쪽 ↔ 곡이 바뀐 뒤 잠깐 있다가 조용히 저장 (확인창 · 오류 알림 없음) · false: [💾 곡별 저장] 단추 */
    function saveSplit(auto) {
      clearTimeout(splitT);
      var f = sheets[S.sheetIdx], total = S.pages || 0;
      if (!f || !S.doc || !total) { if (!auto) toast('악보가 열린 뒤에 저장할 수 있습니다.', true); return; }
      var by = {}, i, pg;
      for (pg = 1; pg <= total; pg++) { i = resolveSong(f, pg); if (i != null && i >= 0 && songs[i]) (by[i] = by[i] || []).push(pg); }
      var keys = Object.keys(by);
      if (!keys.length) { if (!auto) toast('곡에 연결된 쪽이 없습니다. "이 쪽부터 곡 선택" 으로 먼저 연결해주세요.', true); return; }
      function spec(a) { var o = [], j = 0; while (j < a.length) { var k = j; while (k + 1 < a.length && a[k + 1] === a[k] + 1) k++; o.push(k > j ? a[j] + '–' + a[k] : String(a[j])); j = k + 1; } return o.join(', '); }
      splitBtnPaint('saving');
      opts.callServer('worshipSheetSplit', [opts.token, S.room, f.id, by], function (r) {
        splitBtnPaint('saved');
        var n = (r && r.songs && r.songs.length) || keys.length;
        toast((auto ? '쪽 ↔ 곡 연결을 곡별 악보로 저장했어요' : '곡별 악보로 저장했습니다') + ' (' + n + '곡) — 다음에 이 곡을 쓰면 그대로 따라옵니다.', false, 2800);
      }, function (e) { splitBtnPaint('dirty'); if (!auto) toast((e && e.message) || '저장하지 못했습니다.', true); });
    }
    function splitLater() { if (!(canTeam() && opts.callServer && S.room)) return; splitBtnPaint('dirty'); clearTimeout(splitT); splitT = setTimeout(function () { saveSplit(true); }, 2500); }
    (function () { var b = $('.pv-splitbtn'); if (b) b.onclick = function () { saveSplit(false); }; })();
    $('.pv-songsel').onchange = function () {
      if (this.value === '__split') { renderSongSel(); saveSplit(false); return; }
      var f = sheets[S.sheetIdx], m = mapOf(f), v = this.value;
      if (v === 'auto') delete m.manual[S.page]; else m.manual[S.page] = +v;
      saveManual(f); var idx = resolveSong(f, S.page);
      if (idx >= 0) setSong(idx, true); renderSongSel(); sendNav(); splitLater();
      toast(v === 'auto' ? '이 쪽을 자동 연결로 되돌렸습니다.' : '이 쪽부터 "' + ((songs[+v] || {}).title || '') + '" 로 연결했습니다. (BPM · 송폼도 이 곡 기준)');
    };

    function setSong(i, silent) {
      S.songIdx = i >= 0 && i < songs.length ? i : -1;
      var s = songs[S.songIdx], t = $('.pv-songinfo');
      t.textContent = s ? [s.title, s.key ? 'Key ' + s.key : '', s.bpm ? s.bpm + ' BPM' : ''].filter(Boolean).join(' · ') : '';
      setYt(s);
      updateFormBadge();
      P.emit('song', s || null, S.songIdx);
      if (!silent) sendNav();
    }
    /* 유튜브 참고 영상 — 리더가 곡 정보에 넣어 둔 링크를 앱 안의 작은 창으로 재생 (악보 화면을 떠나지 않음, 필기 · 실시간 동기화와 무관) */
    function ytIdOf(url) { var m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/.exec(String(url || '')); return m ? m[1] : ''; }
    var ytBtn = $('.pv-ytbtn'), ytBox = null, ytCtl = null;
    function closeYt() { if (ytCtl) { try { ytCtl.destroy(); } catch (e) {} ytCtl = null; } if (ytBox) { ytBox.remove(); ytBox = null; } ytBtn.classList.remove('on'); ytBtn.setAttribute('aria-pressed', 'false'); }
    function setYt(s) { var id = s ? ytIdOf(s.link) : ''; if (ytBox && ytBtn.getAttribute('data-id') !== id) closeYt(); ytBtn.style.display = id ? '' : 'none'; ytBtn.setAttribute('data-id', id); if (!id) closeYt(); }
    ytBtn.onclick = function () {
      var id = ytBtn.getAttribute('data-id'); if (!id) return;
      if (ytBox) { closeYt(); return; }
      try { root.YNAudioShift && root.YNAudioShift.closeDialog && root.YNAudioShift.closeDialog(); } catch (e) {}          // 키 바꿔 듣기 카드가 열려 있으면 닫음 (소리가 겹치지 않게)
      ytBox = doc.createElement('div'); ytBox.className = 'pv-yt'; ytBox.setAttribute('role', 'dialog');      // V859 — 떠 있는 창: 위 줄(제목)을 끌어 옮김 · 자리는 이 기기에 기억 ytBox.setAttribute('aria-label', '유튜브 참고 영상');
      ytBox.innerHTML = '<div class="pv-yth" data-drag title="끌어서 옮기기"><span class="pv-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><b>' + h((songs[S.songIdx] || {}).title || '참고 영상') + '</b><a target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=' + id + '" title="유튜브에서 열기">↗</a><button type="button" aria-label="닫기">' + YI('close') + '</button></div><div class="pv-ytbody"></div>';
      ytBox.querySelector('.pv-yth button').onclick = closeYt;
      ytBox.style.right = 'auto'; ytBox.style.bottom = 'auto';
      if (P.floatWin) P.floatWin('yt', ytBox, function () { return S.compact ? { x: 0.5, y: 0.98 } : { x: 0.98, y: 0.9 }; }); else el.appendChild(ytBox);
      ytBtn.classList.add('on'); ytBtn.setAttribute('aria-pressed', 'true');
      var body = ytBox.querySelector('.pv-ytbody');
      if (root.YNYt) ytCtl = root.YNYt.open(body, { id: id, title: (songs[S.songIdx] || {}).title, ytApi: opts.ytApi, key: null });        // V859 — "키 바꿔 연습" 은 뺌 (유튜브 소리는 키를 못 바꾸고, 모두 유튜브로 연습)        // 공식 IFrame API: 속도 · A-B 반복 · 연습 키(악보 코드 · 녹음 재생에만 반영)
      else body.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?rel=0&playsinline=1&autoplay=1" title="유튜브 참고 영상" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    };

    /* ------------------------------------------------------------ 패널과 주고받는 통로 */
    var handlers = {};
    var P = {
      yt: function () { return ytCtl; }, cfgGet: cfgGet, cfgSet: cfgSet, cfgLayer: cfgLayer, canTeam: canTeam, saveSongInfo: saveSongInfo, songIdxOf: function (s) { return songs.indexOf(s); },
      el: el, opts: opts, songs: songs, sheets: sheets, tabs: [], toast: toast,
      on: function (n, fn) { (handlers[n] = handlers[n] || []).push(fn); return P; },
      emit: function (n, a, b) { (handlers[n] || []).slice().forEach(function (fn) { try { fn(a, b); } catch (e) { if (root.console) root.console.error('[practice:' + n + ']', e); } }); },
      song: function () { return songs[S.songIdx] || null; }, pageSong: function (pg) { return resolveSong(sheets[S.sheetIdx], pg == null ? S.page : pg); }, songIdx: function () { return S.songIdx; }, setSong: function (i) { setSong(i); },
      file: function () { return sheets[S.sheetIdx]; }, page: function () { return S.page; }, goPage: function (n) { goPage(n, true); }, setTool: function (t) { setTool(t); },
      pdf: function () { return S.doc && S.doc.pdf || null; }, canvas: function () { return pdfCv; },
      pageBox: function () { return box; }, pages: function () { return S.pages; },
      pageSize: function (pg) { return S.doc ? pageInfo(S.doc, pg).then(function (i) { return { w: i.w, h: i.h }; }) : Promise.reject(new Error('악보가 열려 있지 않습니다.')); },
      renderPageTo: function (cv, pg, scale) { return S.doc ? renderTo(cv, S.doc, pg, scale) : Promise.reject(new Error('악보가 열려 있지 않습니다.')); },
      lang: function () { return S.lang; }, setLang: function (l) { S.lang = l === 'ko' ? 'ko' : 'en'; ls('lang', S.lang); },
      cacheInfo: function () { return { pages: S.pcache.size, bytes: S.pcBytes, mine: Object.keys(S.mineCache).length }; },
      penTap: function () { return ls('pentap') !== '0'; },
      setEraseBack: function (v) { S.eraseBack = !!v; ls('eraseback', v ? '1' : '0'); }, eraseBack: function () { return S.eraseBack !== false; },
      setPenTap: function (on) { ls('pentap', on ? '1' : '0'); if (an.setPenTap) an.setPenTap(!!on); },
      penMode: function () { return (an.state && an.state().penMode) || 'auto'; },
      setPenModePref: function (v) { v = v === 'always' || v === 'off' ? v : 'auto'; ls('penmode', v); an.setPenMode(S.layout === 'tablet' ? v : 'off'); },
      swapPenEraser: function () { return an.swapPenEraser ? an.swapPenEraser() : false; },
      formBadge: function () { return S.fbadge !== false; },
      setFormBadge: function (on) { S.fbadge = !!on; ls('fbadge', on ? '1' : '0'); updateFormBadge(); },
      wake: function () { return wakeCtl ? wakeCtl.state() : { wanted: false, mode: 'none', active: false }; },
      fit: function () { return S.fit; }, fullscreen: function () { return !!S.fs; }, setFullscreen: function (b) { setFs(b); },
      layout: function () { return S.layout; }, setLayout: function (l) { applyLayout(l, true); }, hand: function () { return S.hand; },
      setHand: function (hd) { S.hand = hd === 'left' ? 'left' : 'right'; ls('hand', S.hand); applyLayout(S.layout, false); },
      anno: function () { return an; }, rt: function () { return rt; }, canEdit: !!opts.canEdit, canLead: function () { return !!(rt && rt.me && rt.me.canLead); },
      isLeader: function () { return !!(rt && rt.isLeader); }, isClicker: function () { return !!(rt && rt.isClicker); }, showTab: function (id) { showTab(id); },
      getLayer: function () { return S.layer; }, getScope: function () { return S.scope; }, setLayer: function (l) { setLayer(l, true); }, setScope: function (s) { setScope(s); },
      recvCue: function (v) { if (v !== undefined) { S.recvCue = !!v; ls('recvcue', v ? '1' : '0'); } return S.recvCue; },
      sendCueOn: function (v) { if (v !== undefined) { S.sendCue = !!v; ls('sendcue', v ? '1' : '0'); } return S.sendCue; },
      cueIdFor: cueIdFor,
      /** 페이지 컨트롤 또는 클릭 컨트롤이면 팀 모두에게 큐를 보냅니다 (스위치가 켜져 있을 때 · 동기화를 끈 동안에는 보내지 않음) */
      broadcastCue: function (id) {
        if (!rt || !(rt.isLeader || rt.isClicker) || !S.sendCue || !rt.online || S.manual) return Promise.resolve(false);
        return rt.call('cue', { label: id, kind: 'cue' }).then(function () { return true; }, function (e) { toast('큐를 팀에 보내지 못했습니다: ' + e.message, true); return false; });
      },
      /** 동기화 끄기 (수동) — 켜 두면 남이 넘기는 쪽 · 바꾸는 BPM · 시작/멈춤 · 큐를 모두 무시하고, 내 것도 보내지 않습니다 */
      manual: function () { return S.manual; }, setManual: function (b) { setManual(b); },
      claimClick: function (force) { return claimClick(force); }, releaseClick: function () { return releaseClick(); },
      follow: function () { return S.follow; }, setFollow: function (b) { setFollow(b); }, followMetro: function () { return S.followM; }, setFollowMetro: function (b) { setFollowM(b); }, followNow: function () { followNow(); },
      flashCue: function (id) { return flashCue(id); }, flashForm: flashForm,
      claim: function (force) { return claim(force); }, release: function () { return release(); },
      exportPng: function () { return exportPng(); }, exportPdf: function (print) { return exportPdf(print); },
      callServer: opts.callServer, saveNow: function () { flushMine(true); if (rt && rt.online) rt.call('anno:save', { file: sheets[S.sheetIdx].id, scope: 'song' }).catch(function () {}); if (rt && rt.online && S.room) rt.call('anno:save', { file: sheets[S.sheetIdx].id, scope: S.room }).catch(function () {}); },
      status: function () { return { conn: rt ? rt.state : 'unavailable', minePending: S.minePend, savedAt: S.savedAt, unsent: Object.keys(S.unsent).length }; }
    };
    /* 연습 키 이동 (Feature 2) — 곡마다 −3 ~ +3 반음, 이 기기에만 기억(팀에 보내지 않음). 화음 탭(harmony-ui.js)이 'keyshift' 를 듣고 악보 코드를 따라 바꾸며,
       유튜브 카드 · 키 바꿔 듣기 카드(audio-shift.js)가 같은 값을 씁니다. ensureTab: 탭을 화면에 띄우지 않고 (처음 한 번만) 만들어 둡니다. */
    function ksName() { var s = songs[S.songIdx]; return 'ks.' + (s ? normName(s.title) : '_'); }
    P.keyShift = function () { var v = parseInt(ls(ksName()), 10); return isFinite(v) ? clamp(v, -3, 3) : 0; };
    P.setKeyShift = function (n) {
      n = Math.round(+n); n = isFinite(n) ? clamp(n, -3, 3) : 0;
      if (n === P.keyShift()) return n;
      ls(ksName(), String(n));
      if (n !== 0) P.ensureTab('harmony');
      P.emit('keyshift', n, songs[S.songIdx] || null); return n;
    };
    P.ensureTab = function (id) { return ensureTab(id); };
    P.closeYt = function () { closeYt(); };
    P.openAudioShift = function (o) { return root.YNAudioShift && root.YNAudioShift.openDialog ? root.YNAudioShift.openDialog(P, o) : null; };
    P.on('song', function () { if (P.keyShift() !== 0) P.ensureTab('harmony'); });
    S.room = opts.room || '';
    var rt = null, an = null;

    /* ------------------------------------------------------------ 필기 엔진 연결 */
    var YA = root.YNAnno;
    if (!YA) { toast('필기 도구를 불러오지 못했습니다. 새로고침해 주세요.', true); }
    an = YA ? YA.create({
      host: box, canvas: annoCv, me: opts.me || '', canEdit: !!opts.canEdit,
      sawPen: ls('sawpen') === '1', onPenSeen: function () { ls('sawpen', '1'); },                    // 이 기기에서 펜슬을 한 번 쓴 적이 있으면 처음부터 손가락 필기를 막음 (손바닥 방지) — 필기 탭의 "펜 입력"에서 바꿀 수 있음
      onToolSwap: function (to, from, via) { swapTool(to, via); },
      onEraseDone: function () {                                                        // V844 — 펜슬로 지우고 떼면 원래 펜으로
        if (S.eraseBack === false || S.tool !== 'eraser' || !S.prevDraw) return;
        setTool(S.prevDraw, false, true); toast(S.prevDraw === 'hl' ? '형광펜으로 돌아왔습니다' : '펜으로 돌아왔습니다', false, 900);
      },
      onHoldEraseEnd: function (back) { setTool(back === 'hl' ? 'hl' : 'pen', false, true); },      // V848 — 1초 눌러 쓴 지우개를 떼면 원래 도구로
      onAutoSelect: function () { setTool('select', true); toast('선택·이동 모드 — 다시 쓰려면 도구를 누르세요', false, 1400); },
      onAdd: function (layer, it) { annoSend(layer, it, 'add'); }, onDel: function (layer, id) { annoSend(layer, { id: id }, 'del'); },
      onClear: function (layer, ids, pg, all) { annoClear(layer, ids, pg, all); },
      onLive: function (m) { if (rt && rt.online) rt.fire('anno:live', Object.assign({ file: sheets[S.sheetIdx].id }, m)); },
      onChange: function () { P.emit('annochange'); },
      onMessage: function (t, bad) { toast(t, bad); },
      keepEditor: function (a) { return !!(a && (toolsEl.contains(a) || (drawerEl && drawerEl.contains(a)))); },
      teamBlocked: function () {
        var blocked = !rt || rt.state === 'unavailable' || rt.state === 'denied';
        if (!blocked) return '';
        if (!S.layerUser) { S.layer = 'mine'; an.setLayer('mine'); renderTools(); toast('팀에 연결되어 있지 않아 이번에는 "나만 보기"로 씁니다.'); return ''; }       // 직접 고르지 않았다면 필기가 막히지 않도록 임시로 내 것으로
        return '팀 공유에 연결되어 있지 않습니다. "나만 보기"를 체크해서 쓰거나 새로고침해 주세요.';
      }
    }) : { setPenMode: function () {}, resize: function () {}, setPage: function () {}, closeEditor: function () {}, setItems: function () {}, items: function () { return []; }, setTool: function () {}, setLayer: function () {}, count: function () { return 0; }, drawPage: function () {}, remoteAdd: function () {}, remoteDel: function () {}, remoteClear: function () {}, remoteLive: function () {}, undo: function () {}, redo: function () {}, state: function () { return {}; }, destroy: function () {}, setVisible: function () {}, setPerms: function () {}, setColor: function () {}, setWidth: function () {}, setSymbol: function () {}, setSymSize: function () {}, setTextSize: function () {}, clearPage: function () { return 0; }, setHlColor: function () {}, setStraight: function () {} };

    try { if (an.setPenTap) an.setPenTap(ls('pentap') !== '0'); } catch (e) { /* 필기 도구가 없어도 화면은 계속 */ }
    function fileId() { return sheets[S.sheetIdx].id; }
    function scopeOfItem(it) { return S.scopeOf[it.id] || S.scopeKey; }
    function annoSend(layer, it, op) {
      var sc = op === 'add' ? (S.scopeOf[it.id] || S.scopeKey) : (S.scopeOf[it.id] || S.scopeKey);
      if (op === 'add') S.scopeOf[it.id] = sc;
      if (layer === 'mine') { if (op === 'add') { S.localMine[it.id] = 1; delete S.delMine[it.id]; } else { S.delMine[it.id] = 1; delete S.localMine[it.id]; } markMine(sc); if (op === 'del') delete S.scopeOf[it.id]; return; }
      if (!rt || rt.state === 'unavailable' || rt.state === 'denied') return;
      var payload = op === 'add' ? { file: fileId(), scope: sc, item: it } : { file: fileId(), scope: sc, id: it.id };
      if (op === 'add') S.unsent[it.id] = 1;
      rt.call(op === 'add' ? 'anno:add' : 'anno:del', payload, { queue: true }).then(function (r) {
        if (op === 'add' && r && !r.queued) delete S.unsent[it.id];
        if (op === 'del') delete S.scopeOf[it.id];
        P.emit('sync');
      }, function (e) {
        if (op === 'add') delete S.unsent[it.id];
        toast(e.code === 'perm' ? e.message : '팀 필기를 보내지 못했습니다: ' + e.message, true);
        if (op === 'add' && e.code) { an.remoteDel('team', it.id); }            // 서버가 거절한 항목은 화면에서도 뺍니다
      });
    }
    function annoClear(layer, ids, pg, all) {
      var scs = {}; ids.forEach(function (id) { scs[S.scopeOf[id] || S.scopeKey] = 1; });
      if (layer === 'mine') { Object.keys(scs).forEach(markMine); return; }
      if (!rt || rt.state === 'unavailable') return;
      Object.keys(scs).forEach(function (sc) { rt.call('anno:clear', { file: fileId(), scope: sc, pg: pg, own: !all }, { queue: true }).catch(function (e) { toast('지우기를 팀에 보내지 못했습니다: ' + e.message, true); }); });
    }
    /* 나만 보기 필기 — 1.5초 모아서 서버(시트)에 저장 */
    function markMine(sc) { delete S.mineCache[fileId() + '|' + sc]; S.mineDirty[fileId() + '|' + sc] = 1; S.minePend = Object.keys(S.mineDirty).length; clearTimeout(S.mineT); S.mineT = setTimeout(function () { flushMine(); }, 1500); P.emit('sync'); }
    function flushMine(now) {
      clearTimeout(S.mineT); S.mineT = 0;
      var keys = Object.keys(S.mineDirty); if (!keys.length || !opts.callServer) { S.mineDirty = {}; S.minePend = 0; return; }
      var snapshot = an.items('mine');
      keys.forEach(function (k) {
        var parts = k.split('|'), file = parts[0], sc = parts[1];
        if (file !== fileId()) return;                       // 다른 악보로 이미 넘어갔다면 (loadSheet 가 먼저 저장하므로 드묾)
        if (!S.mineLoaded[k]) { S.mineT = setTimeout(function () { flushMine(); }, 3000); return; }   // 저장된 필기를 다 불러온 뒤에만 저장 (덮어쓰기 방지)
        var items = snapshot.filter(function (i) { return (S.scopeOf[i.id] || S.scopeKey) === sc; });
        delete S.mineDirty[k];
        opts.callServer('worshipAnnoSaveMine', [opts.token, file, sc, items], function () { if (!S.mineDirty[k]) mineCachePut(file, sc, items); S.savedAt = Date.now(); S.minePend = Object.keys(S.mineDirty).length; P.emit('sync'); },
          function (e) { S.mineDirty[k] = 1; S.minePend = Object.keys(S.mineDirty).length; toast('내 필기를 저장하지 못했습니다 (자동으로 다시 시도합니다): ' + ((e && e.message) || ''), true); clearTimeout(S.mineT); S.mineT = setTimeout(function () { flushMine(); }, 15000); P.emit('sync'); });
      });
      S.minePend = Object.keys(S.mineDirty).length;
    }
    function scopes() { return S.room ? ['song', S.room] : ['song']; }
    /** 한 범위(scope)의 항목으로 통째로 바꿈 — 아직 서버에 못 보낸 내 항목은 남깁니다 */
    function replaceScope(layer, sc, items) {
      var mineL = layer === 'mine';
      var keep = an.items(layer).filter(function (i) { return (S.scopeOf[i.id] || S.scopeKey) !== sc || (mineL ? S.localMine[i.id] : S.unsent[i.id]); });
      if (mineL) items = (items || []).filter(function (i) { return !S.delMine[i.id]; });
      (items || []).forEach(function (i) { S.scopeOf[i.id] = sc; });
      var ids = {}; keep.forEach(function (i) { ids[i.id] = 1; });
      an.setItems(layer, keep.concat((items || []).filter(function (i) { return !ids[i.id]; })));
    }
    /* 내 필기(나만 보기)는 나만 바꾸므로 잠깐(2분) 기억해 두고, 같은 악보로 다시 돌아오면 서버에 묻지 않습니다.
       내가 저장할 때마다 이 기억도 함께 최신으로 바꿉니다. 팀 필기는 실시간 서버(메모리)에서 바로 받으므로 기억하지 않습니다. */
    var MINE_TTL = 120000;
    S.mineCache = {};
    function mineCacheGet(file, sc) { var e = S.mineCache[file + '|' + sc]; return e && Date.now() - e.at < MINE_TTL ? e : null; }
    function mineCachePut(file, sc, items) { S.mineCache[file + '|' + sc] = { at: Date.now(), items: (items || []).slice() }; }
    function loadAnno() {
      var id = ++S.annoId, file = fileId(); S.teamFrom = {}; S.scopeOf = {}; S.unsent = {}; S.localMine = {}; S.delMine = {};
      scopes().forEach(function (sc) { delete S.mineLoaded[file + '|' + sc]; });
      an.setItems('team', []); an.setItems('mine', []);
      var rtOn = !!(rt && rt.online);                                                    // 실시간이 연결돼 있으면 팀 필기는 그쪽에서 받으므로 시트 읽기를 아낍니다
      if (opts.callServer) scopes().forEach(function (sc) { loadOne(id, file, sc, 0, rtOn); });
      loadTeam(id, file);
    }
    function loadOne(id, file, sc, tries, mineOnly) {
      var hit = mineOnly ? mineCacheGet(file, sc) : null;
      if (hit) { S.mineLoaded[file + '|' + sc] = true; replaceScope('mine', sc, hit.items); return; }                 // 기억해 둔 내 필기 — 서버에 묻지 않음
      opts.callServer('worshipAnnoLoad', [opts.token, file, sc, !!mineOnly], function (r) {
        if (id !== S.annoId || !r) return;
        S.mineLoaded[file + '|' + sc] = true;
        mineCachePut(file, sc, r.mine || []);
        replaceScope('mine', sc, r.mine || []);
        if (Array.isArray(r.team) && S.teamFrom[sc] !== 'rt') { replaceScope('team', sc, r.team); S.teamFrom[sc] = 'http'; }
        if (r.me) an.setPerms(String(r.me), !!r.canEdit);
      }, function (e) {
        if (id !== S.annoId) return;
        if (tries < 3) { setTimeout(function () { if (id === S.annoId) loadOne(id, file, sc, tries + 1, mineOnly); }, 4000 * (tries + 1)); return; }
        toast('저장된 필기를 불러오지 못했습니다. 새로 쓴 "나만 보기" 필기는 불러오기가 끝난 뒤에 저장됩니다: ' + ((e && e.message) || ''), true);
      });
    }
    function loadTeam(id, file) {
      if (!rt || !rt.online) return;
      scopes().forEach(function (sc) {
        rt.call('anno:load', { file: file, scope: sc }).then(function (r) { if (id !== S.annoId || file !== fileId()) return; S.teamFrom[sc] = 'rt'; replaceScope('team', sc, r.items || []); }, function (e) {
          if (id !== S.annoId) return;
          if (opts.callServer) opts.callServer('worshipAnnoLoad', [opts.token, file, sc, false], function (r) {          // 실시간 응답이 없으면 시트에서 팀 필기를 받아 대신함
            if (id !== S.annoId || !r || !Array.isArray(r.team) || S.teamFrom[sc]) return; replaceScope('team', sc, r.team); S.teamFrom[sc] = 'http';
          }, function () { toast('팀 필기를 불러오지 못했습니다: ' + e.message, true); });
          else toast('팀 필기를 불러오지 못했습니다: ' + e.message, true);
        });
      });
    }
    function setLayer(l, byUser) { S.layer = l === 'mine' ? 'mine' : 'team'; if (byUser) { S.layerUser = true; ls('layer', S.layer); } an.setLayer(S.layer); P.emit('layer', S.layer); renderTools(); }
    function setScope(s) { S.scope = s === 'date' ? 'date' : 'song'; ls('scope', S.scope); P.emit('scope', S.scope); renderTools(); }
    /* scope 를 서버에 보낼 때: 'song' 그대로 / 'date' = 방(날짜) 키 */
    Object.defineProperty(S, 'scopeKey', { get: function () { return S.scope === 'date' && S.room ? S.room : 'song'; } });

    /* ------------------------------------------------------------ 실시간 · 리더-팔로워 */
    /* v6.9 — 페이지 컨트롤이 넘기면 곧바로 보냅니다 (예전: 120ms 기다린 뒤 보냄). 연달아 넘기거나 스크롤 · 확대할 때만 묶어서 보내고, 마지막 위치는 반드시 한 번 더 보냅니다 */
    function navPayload() { return { file: fileId(), page: S.page, song: S.songIdx, zoom: S.zoom, sy: scrollFrac() }; }
    function navSend() {
      if (!rt || !rt.isLeader || !S.follow) return;
      S.navLast = Date.now();
      rt.call('nav', navPayload()).catch(function (e) { if (e.code !== 'perm') toast('페이지 컨트롤 화면을 보내지 못했습니다: ' + e.message, true); });
    }
    function sendNav() {
      if (S.applying || !rt || !rt.isLeader || !S.follow) return;      // 페이지 동기화를 끈 동안에는 내 화면을 보내지 않음
      clearTimeout(S.navT); S.navT = 0;
      var gap = Date.now() - (S.navLast || 0);
      if (gap >= 80) { navSend(); return; }                            // 오랜만의 넘김 → 즉시
      S.navT = setTimeout(function () { S.navT = 0; navSend(); }, 80 - gap);   // 너무 잦으면 80ms 간격으로 묶음 (마지막 위치는 꼭 전달)
    }
    function applyNav(nav, force) {
      if (!nav || S.dead) return;
      if (rt && rt.isLeader) return;                                  // 리더 자신은 따라갈 대상이 없음
      if (!S.follow && !force) { S.pendingNav = nav; renderChips(); return; }
      S.pendingNav = null; S.applying = true;
      var done = function () { S.applying = false; renderChips(); };
      try {
        var idx = nav.file ? sheets.findIndex(function (s) { return s.id === nav.file; }) : S.sheetIdx;
        if (nav.file && idx < 0) { toast('페이지 컨트롤이 연 악보가 내 목록에 없습니다. (악보 목록을 새로고침해 보세요)', true); return done(); }
        if (nav.song != null && nav.song >= 0 && nav.song !== S.songIdx) setSong(nav.song, true);
        var z = nav.zoom > 0 ? nav.zoom : 1;
        var after = function () { if (Math.abs(z - S.zoom) > 0.01) { S.zoom = clamp(z, 0.4, 4); return renderPage(); } };
        var scrollTo = function () { if (nav.sy != null) { var sc = function () { var sh = stage.scrollHeight - stage.clientHeight; if (sh > 0) stage.scrollTop = sh * nav.sy; }; sc(); setTimeout(sc, 60); } };      // 즉시 맞추고, 그림이 붙은 뒤 한 번 더 확인
        if (idx !== S.sheetIdx || !S.doc) { loadSheet(idx, nav.page, false).then(function () { return after(); }).then(function () { scrollTo(); done(); }, done); }
        else { var same = nav.page === S.page; if (!same) goPage(nav.page, false); Promise.resolve(after()).then(function () { scrollTo(); done(); }, done); }
      } catch (e) { done(); }
    }
    /* ---- 따라가기 (페이지 · 메트로놈 독립) — 이 기기에 저장 + 서버(내 설정)에 저장 + 접속자 목록에 표시 ---- */
    function pushPrefs() {
      S.prefTouched = true; clearTimeout(S.prefT);
      S.prefT = setTimeout(function () {
        var v = { page: S.follow, metro: S.followM };
        if (rt && rt.online) rt.call('prefs', v).catch(function () {});
        cfgSend('mine', 'follow', 'sync', v);                          // 계정에 저장 → 다른 기기 · 다음 접속에서도 같은 상태
      }, 400);
    }
    function applyPrefs(v) {                                            // 서버에 저장된 내 상태를 불러올 때 (알림 없이)
      if (!v || S.prefTouched) return;
      var pg = v.page !== false;
      if (pg === S.follow) return;
      S.follow = pg; ls('fpage', pg ? '1' : '0');
      if (pg && rt && rt.nav && !rt.isLeader) applyNav(S.pendingNav || rt.nav, true);
      renderChips(); P.emit('follow', S.follow);
    }
    function setFollow(b, quiet) {
      b = !!b; if (S.follow === b && !quiet) return;
      var wasManual = S.manual;
      S.follow = b; ls('fpage', b ? '1' : '0');
      if (S.follow && S.pendingNav) applyNav(S.pendingNav, true);
      else if (S.follow && rt && rt.nav && !rt.isLeader) applyNav(rt.nav, true);
      else if (S.follow && rt && rt.isLeader) sendNav();
      renderChips(); P.emit('follow', S.follow); if (wasManual !== S.manual) P.emit('manual', S.manual);
      if (!quiet) { pushPrefs(); toast(b ? (rt && rt.isLeader ? '내 페이지 넘김을 팀에 보냅니다.' : '페이지 컨트롤 화면을 따라갑니다.') : (rt && rt.isLeader ? '페이지 동기화를 껐습니다. 내 페이지 넘김은 팀에 보내지 않습니다.' : '페이지 따라가기를 껐습니다. 내 화면은 그대로 유지됩니다.')); }
    }
    function setFollowM(b, quiet) {
      return;                                                             // v6 — 메트로놈 따라가기 없앰 (예전 호출은 아무 일도 하지 않음)
      b = !!b; if (S.followM === b && !quiet) return;
      var wasManual = S.manual;
      S.followM = b; ls('fmetro', b ? '1' : '0');
      renderChips(); P.emit('followm', b); if (wasManual !== S.manual) P.emit('manual', S.manual);
      if (!quiet) { pushPrefs(); toast(b ? (rt && rt.isClicker ? '내 메트로놈 조작을 팀에 보냅니다.' : '클릭 컨트롤의 메트로놈을 따라갑니다.') : (rt && rt.isClicker ? '메트로놈 동기화를 껐습니다. 내 조작은 팀에 보내지 않습니다.' : '메트로놈 따라가기를 껐습니다. 내 메트로놈은 내가 직접 조절합니다.')); }
    }
    /** 예전 "동기화 끄기 (수동)" = 두 스위치를 함께 끄기/켜기 */
    function setManual(b) {
      b = !!b; if (S.manual === b) return;
      var m0 = S.followM; S.follow = !b; ls('fpage', b ? '0' : '1');
      if (!b) {                                                           // 다시 켜면 지금 상태로 바로 맞춥니다
        if (rt && !rt.isLeader) { var n = S.pendingNav || rt.nav; if (n) applyNav(n, true); }
        else if (rt && rt.isLeader) sendNav();
      }
      renderChips(); P.emit('follow', S.follow); if (m0 !== S.followM) P.emit('followm', S.followM); P.emit('manual', b); pushPrefs();
      toast(b ? '페이지 동기화를 껐습니다. 내 화면은 따로 움직이고, 내 넘김도 팀에 보내지 않습니다.' : '페이지 동기화를 켰습니다. 팀과 같은 화면으로 맞춥니다.');
    }
    function followNow() { var n = S.pendingNav || (rt && rt.nav); if (n) applyNav(n, true); else toast('페이지 컨트롤이 아직 화면을 넘기지 않았습니다.'); }
    function claim(force) {
      if (!rt) return Promise.reject(new Error('실시간 연결이 없습니다.'));
      return rt.claim(force).then(function () { toast('페이지 컨트롤이 되었습니다. 지금부터 넘기는 화면을 팀이 따라옵니다.'); sendNav(); renderChips(); }, function (e) {
        toast(e.code === 'taken' ? e.message + ' 넘겨받으려면 "넘겨받기"를 누르세요.' : e.message, true); throw e;
      });
    }
    function release() { return rt ? rt.release().then(function () { toast('페이지 컨트롤을 내려놓았습니다.'); renderChips(); }, function (e) { toast(e.message, true); }) : Promise.resolve(); }
    function claimClick(force) {
      if (!rt) return Promise.reject(new Error('실시간 연결이 없습니다.'));
      return rt.claimClick(force).then(function () { toast('클릭 컨트롤이 되었습니다. 지금부터 누르는 시작 · 멈춤 · BPM 을 팀 모두의 메트로놈이 따라옵니다.'); renderChips(); P.emit('clicker'); }, function (e) {
        toast(e.code === 'taken' ? e.message + ' 넘겨받으려면 "넘겨받기"를 누르세요.' : e.message, true); throw e;
      });
    }
    function releaseClick() { return rt ? rt.releaseClick().then(function () { toast('클릭 컨트롤을 내려놓았습니다.'); renderChips(); P.emit('clicker'); }, function (e) { toast(e.message, true); }) : Promise.resolve(); }

    /* ---- 맨 위 "실시간" 눌렀을 때 메뉴 — 페이지 리드하기 · 내려놓기 · 따라가기 · 큐 보내기/받기 ---- */
    var rtPop = $('.pv-rtpop');
    function rtPaint() {
      var st = rt ? rt.state : 'unavailable', on = st === 'online', lead = on ? rt.leader : null, mine = on && rt.isLeader, can = !!(rt && rt.me && rt.me.canLead);
      var t = { online: '● 실시간 연결됨 — ' + (rt ? rt.peers.length : 0) + '명 접속 중', connecting: '○ 연결하는 중…', offline: '○ 연결이 끊겼습니다 (자동으로 다시 연결)', unavailable: '○ 혼자 보기 — 실시간을 쓸 수 없습니다', denied: '✕ 이 예배에 접속할 권한이 없습니다', idle: '○ 준비 중' }[st] || st;
      var x = '<div class="pv-rt-st ' + st + '">' + h(t) + '</div>';
      if (on) {
        x += '<div class="pv-rt-sec"><b>' + YI('page') + ' 페이지 리드</b><small>' + (mine ? '내가 넘기는 악보 · 페이지 · 확대를 따라가기를 켠 사람들이 그대로 따라옵니다.' : lead ? h(lead) + ' 님이 리드 중입니다.' : '아직 리드하는 사람이 없습니다.') + '</small>' +
          (can ? (mine ? '<button type="button" class="pv-btn2" data-r="release">리드 내려놓기</button>' : lead ? '<button type="button" class="pv-btn2 warn" data-r="force">리드 넘겨받기</button>' : '<button type="button" class="pv-btn2 primary" data-r="claim">📄 내가 페이지 리드하기</button>') : '<small>팀장 · 인도자만 리드할 수 있습니다.</small>') + '</div>';
        x += '<div class="pv-rt-sec"><label class="pv-chk"><input type="checkbox" data-r="follow"' + (S.follow ? ' checked' : '') + '> ' + (mine ? '내 페이지 넘김을 팀에 보내기' : '리드하는 화면 따라가기') + '</label>' +
          (!S.follow && lead && !mine ? '<button type="button" class="pv-btn2" data-r="now">리드 화면으로 한 번만 가기</button>' : '') + '</div>';
        x += '<div class="pv-rt-sec"><label class="pv-chk"><input type="checkbox" data-r="send"' + (S.sendCue ? ' checked' : '') + '> 리드일 때 콜아웃을 팀에 보내기</label><label class="pv-chk"><input type="checkbox" data-r="recv"' + (S.recvCue ? ' checked' : '') + '> 리드의 콜아웃 받기</label></div>';
      }
      rtPop.innerHTML = x;
    }
    function rtOpen(open) {
      open = !!open; rtPop.hidden = !open; $('.pv-conn').setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) return; var wp = $('.pv-wifipop'); if (wp) wp.hidden = true; rtPaint();
      var cr = $('.pv-conn').getBoundingClientRect(), er = el.getBoundingClientRect(), w = Math.min(320, er.width - 16);
      rtPop.style.width = w + 'px'; rtPop.style.top = Math.round(cr.bottom - er.top + 6) + 'px'; rtPop.style.left = Math.round(Math.max(8, Math.min(er.width - w - 8, cr.left - er.left))) + 'px';
    }
    rtPop.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-r]') : null; if (!b) return; var a = b.getAttribute('data-r');
      if (a === 'claim') claim(false).catch(function () {}); else if (a === 'force') { if (root.confirm('지금 페이지 리드를 넘겨받을까요?')) claim(true).catch(function () {}); }
      else if (a === 'release') release(); else if (a === 'now') followNow();
    });
    rtPop.addEventListener('change', function (e) {
      var t = e.target, a = t.getAttribute && t.getAttribute('data-r');
      if (a === 'follow') setFollow(t.checked); else if (a === 'send') { S.sendCue = !!t.checked; ls('sendcue', t.checked ? '1' : '0'); } else if (a === 'recv') { S.recvCue = !!t.checked; ls('recvcue', t.checked ? '1' : '0'); }
      rtPaint();
    });
    function rtOutside(e) { if (rtPop.hidden) return; var tg = e.target; if (tg && tg.closest && (tg.closest('.pv-rtpop') || tg.closest('.pv-conn'))) return; rtOpen(false); }
    doc.addEventListener('pointerdown', rtOutside, true);      // (닫을 때 떼기는 아래 doc.removeEventListener 와 함께)

    /* ---- "실시간" 칩을 길게 누르면 — 교회 와이파이 QR (숨은 기능, 방송팀이 현장에서 씀) ---- */
    (function () {
      var WIFI_SSID = 'youngnaktech', WIFI_PASS = 'cjdsusqn';
      var connBtn = $('.pv-conn'), wifiPop = $('.pv-wifipop'), wifiDrawn = false, pressT = 0, longed = false;
      function wifiPaint() {
        if (wifiDrawn) return; wifiDrawn = true;
        var esc = function (s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); };
        var payload = 'WIFI:T:WPA;S:' + esc(WIFI_SSID) + ';P:' + esc(WIFI_PASS) + ';;';
        var svg = '';
        try { var qr = qrcode(0, 'M'); qr.addData(payload); qr.make(); svg = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) {}
        wifiPop.innerHTML = '<div class="pv-rt-sec"><b>교회 와이파이</b><small>카메라로 QR을 찍으면 자동으로 접속됩니다.</small></div>' +
          '<div class="pv-wifiqr">' + svg + '</div>';
      }
      function wifiOpen(open) {
        open = !!open; wifiPop.hidden = !open;
        if (!open) return;
        rtPop.hidden = true; wifiPaint();
        var cr = connBtn.getBoundingClientRect(), er = el.getBoundingClientRect(), w = Math.min(280, er.width - 16);
        wifiPop.style.width = w + 'px'; wifiPop.style.top = Math.round(cr.bottom - er.top + 6) + 'px'; wifiPop.style.left = Math.round(Math.max(8, Math.min(er.width - w - 8, cr.left - er.left))) + 'px';
      }
      function wifiOutside(e) { if (wifiPop.hidden) return; var tg = e.target; if (tg && tg.closest && (tg.closest('.pv-wifipop') || tg.closest('.pv-conn'))) return; wifiOpen(false); }
      doc.addEventListener('pointerdown', wifiOutside, true);
      connBtn.addEventListener('pointerdown', function () { longed = false; clearTimeout(pressT); pressT = setTimeout(function () { longed = true; wifiOpen(wifiPop.hidden); }, 550); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (k) { connBtn.addEventListener(k, function () { clearTimeout(pressT); }); });
      connBtn.addEventListener('click', function (e) { if (longed) { longed = false; e.stopPropagation(); e.preventDefault(); } });
    })();

    function renderChips() {
      var conn = $('.pv-conn'), lead = $('.pv-lead'), fol = $('.pv-follow'), clk = $('.pv-click'), folm = $('.pv-followm');
      var st = rt ? rt.state : 'unavailable';
      var label = { idle: '연결 전', connecting: '연결 중…', online: '실시간 연결됨', offline: '연결 끊김 — 다시 연결 중', unavailable: '혼자 보기 (실시간 없음)', denied: '연결 거부됨' }[st] || st;
      conn.textContent = { online: '● 실시간', connecting: '○ 연결 중', offline: '○ 끊김', unavailable: '○ 혼자', denied: '✕ 거부', idle: '○' }[st] || '○';
      conn.className = 'pv-chip pv-conn ' + st; conn.title = label + (rt && rt.error && st !== 'online' ? ' — ' + rt.error : '');
      var pend = rt ? rt.pending() : 0; if (pend) conn.textContent += ' · 대기 ' + pend;
      var peers = rt ? rt.peers.length : 0;
      if (st === 'online') {
        var ln = rt.leader; lead.style.display = (rt.isLeader || ln) ? '' : 'none';     // v6 — 컨트롤이 없으면 칩을 숨겨 위 막대를 짧게 ("함께" 탭에서 맡기)
        lead.innerHTML = rt.isLeader ? I('page') + '내가 페이지 컨트롤' : ln ? I('page') + h(ln) : '페이지 컨트롤 없음'; lead.className = 'pv-chip pv-lead' + (rt.isLeader ? ' me' : ln ? ' has' : '');
        lead.title = peers + '명 접속 중 — 눌러서 페이지 컨트롤 · 클릭 컨트롤 · 동기화 설정 열기';
        var cn = rt.clicker;
        clk.style.display = 'none'; clk.innerHTML = rt.isClicker ? I('metronome') + '내가 클릭 컨트롤' : cn ? I('metronome') + h(cn) : '클릭 컨트롤 없음'; clk.className = 'pv-chip pv-click' + (rt.isClicker ? ' me' : cn ? ' has' : '');
        clk.title = '메트로놈(클릭)을 조절하는 사람 — 눌러서 설정 열기';
      } else { lead.style.display = 'none'; clk.style.display = 'none'; }
      if (st === 'online' && S.manual && !(rt.leader && !rt.isLeader)) {      // v6 — 수동 = 페이지 따라가기 끔. 컨트롤이 있으면 아래에서 "컨트롤 N쪽" 안내
        fol.style.display = ''; fol.className = 'pv-chip pv-follow off manual'; fol.textContent = '페이지 따라가기 꺼짐'; fol.setAttribute('aria-pressed', 'false');
        fol.title = '눌러서 동기화 다시 켜기';
      } else if (st === 'online' && rt.leader && !rt.isLeader) {
        fol.style.display = ''; fol.className = 'pv-chip pv-follow ' + (S.follow ? 'on' : 'off'); fol.title = '페이지 컨트롤 화면 따라가기 켜기/끄기';
        var behind = !S.follow && S.pendingNav && (S.pendingNav.page !== S.page || S.pendingNav.file !== fileId());
        fol.textContent = S.follow ? '따라가는 중' : (behind ? '따라가기 꺼짐 · 컨트롤 ' + S.pendingNav.page + '쪽' : '따라가기 꺼짐');
        fol.setAttribute('aria-pressed', S.follow ? 'true' : 'false');
      } else fol.style.display = 'none';
      if (folm) {                                                         // v6 — 메트로놈 따라가기 칩은 없앰
        if (false) {
          folm.style.display = ''; folm.className = 'pv-chip pv-followm ' + (S.followM ? 'on' : 'off'); folm.innerHTML = YI('metronome') + (S.followM ? ' 메트로놈 따라감' : ' 메트로놈 따라가기 꺼짐');
          folm.title = '클릭 컨트롤의 메트로놈 따라가기 켜기/끄기'; folm.setAttribute('aria-pressed', S.followM ? 'true' : 'false');
        } else folm.style.display = 'none';
      }
      P.emit('conn', st); if (!rtPop.hidden) rtPaint();
    }
    function connect() {
      if (opts.realtime === false || !root.YNRT || !S.room) { renderChips(); return; }
      rt = root.YNRT.create({ token: opts.token, room: S.room, io: opts.io });
      ['state', 'peers', 'leader', 'clicker', 'outbox'].forEach(function (n) { rt.on(n, function () { renderChips(); P.emit(n); }); });
      rt.on('joined', function (r) {
        renderChips(); P.emit('joined', r);
        rt.call('prefs', { page: S.follow, metro: S.followM }).catch(function () {});      // 접속자 목록에 내 따라가기 상태 표시
        if (r.you) an.setPerms(r.you.name, r.you.canEdit);
        if (S.doc) loadTeam(++S.annoId, fileId());
        if (r.nav && !rt.isLeader) applyNav(r.nav, false);
        if (r.metro) P.emit('metro', r.metro);
      });
      rt.on('metro', function (m) { P.emit('metro', m); });
      rt.on('nav', function (n) { applyNav(n, false); });
      rt.on('leader', function (m) {
        if (rt.isLeader) sendNav();
        else if (m && m.name && m.reason === 'takeover') toast(YNHon.say(m.name) + ' 페이지 컨트롤을 넘겨받았습니다.');
        else if (m && !m.name && m.reason === 'left') toast('페이지 컨트롤이 나갔습니다.');
        renderChips();
      });
      rt.on('sent', function (m) { if (m.name === 'anno:add' && m.payload && m.payload.item) { delete S.unsent[m.payload.item.id]; P.emit('sync'); } });
      rt.on('rejected', function (r) {
        var m = r.msg; if (m.name === 'anno:add' && m.payload && m.payload.item) { delete S.unsent[m.payload.item.id]; an.remoteDel('team', m.payload.item.id); }
        toast('보내지 못한 필기가 있습니다: ' + r.error.message, true); P.emit('sync');
      });
      rt.on('clicker', function (m) {
        if (m && m.name && m.reason === 'takeover' && !rt.isClicker) toast(YNHon.say(m.name) + ' 클릭 컨트롤을 넘겨받았습니다.');
        else if (m && !m.name && m.reason === 'left') toast('클릭 컨트롤이 나갔습니다.');
      });
      rt.on('cue', function (c) { P.emit('cue', c); });
      rt.on('lead', function (st) { P.emit('lead', st); });                          // V842 — 리드의 BPM · 송폼 위치 (화면만)
      rt.on('msg', function (m) { P.emit('msg', m); }); rt.on('msg:ack', function (a) { P.emit('msg:ack', a); });   // 요청 메시지 (livemsg.js)
      rt.on('cfg', onRemoteCfg);
      rt.on('song', function (m) { if (m && m.cid !== S.cid) applySongPatch(m.kind, m.seq, m.patch, m.by, true); });
      rt.on('songs:changed', function () { refetchSongs(); });
      rt.on('state', function (st) { if (st === 'online' && S.cfgLoaded && S.wasOffline) loadCfg(); S.wasOffline = st === 'offline'; });
      rt.on('anno:add', function (m) { if (m.file !== fileId() || scopes().indexOf(m.scope) < 0) return; S.scopeOf[m.item.id] = m.scope; an.remoteAdd('team', m.item); });
      rt.on('anno:del', function (m) { if (m.file === fileId()) an.remoteDel('team', m.id); });
      rt.on('anno:clear', function (m) { if (m.file === fileId()) an.remoteClear('team', m.ids); });
      rt.on('anno:live', function (m) { if (m.file === fileId()) an.remoteLive(m); });
      rt.on('anno:saved', function (m) { if (m.ok) S.savedAt = m.at; else toast('팀 필기 자동 저장에 실패했습니다. 잠시 후 다시 시도합니다.', true); P.emit('sync'); });
      rt.connect(); renderChips();
    }

    /* ------------------------------------------------------------ 도구 막대 */
    var SIZES = { pen: [0.0018, 0.003, 0.0055], hl: [0.012, 0.02, 0.032], text: [0.018, 0.024, 0.034], sym: [0.022, 0.032, 0.05], fbox: [0.02, 0.028, 0.04] };
    /* V844 — 펜 · 형광펜 굵기 3칸을 각자 원하는 굵기로: 이미 고른 칸을 한 번 더 누르면 조절 막대가 나오고, 바꾼 굵기는 그 칸에 이 기기에 저장됩니다 */
    var SZ_RANGE = { pen: [0.0008, 0.016], hl: [0.006, 0.06] };
    function slotSizes(k) { var d = SIZES[k].slice(); if (!SZ_RANGE[k]) return d; try { var v = JSON.parse(ls('sz.' + k) || 'null'); if (Array.isArray(v)) for (var i = 0; i < 3; i++) if (+v[i] >= SZ_RANGE[k][0] && +v[i] <= SZ_RANGE[k][1]) d[i] = +v[i]; } catch (e) { /* 기본값 */ } return d; }
    function slotSave(k, i, v) { var a = slotSizes(k); a[i] = v; ls('sz.' + k, JSON.stringify(a)); }
    function slotDot(k, v, i) { if (k === 'pen') return Math.max(2, Math.min(18, Math.round(v * 1500))); if (k === 'hl') return Math.max(4, Math.min(20, Math.round(v * 380))); return 4 + i * 4; }
    S.szEdit = -1; S.eraseBack = ls('eraseback') !== '0';
    S.tool = 'none'; S.sizeIdx = 1; S.symOpen = false; S.fboxTag = (YA && ls('fbtag') && /^[A-Za-z0-9]{1,8}$/.test(ls('fbtag'))) ? ls('fbtag') : 'V';
    function sizeKey() { return S.tool === 'fbox' ? 'fbox' : S.tool === 'hl' ? 'hl' : S.tool === 'text' || S.tool === 'chord' ? 'text' : S.tool === 'sym' ? 'sym' : 'pen'; }
    S.fsz = {}; S.font = ls('font') && YA && YA.FONTS[ls('font')] ? ls('font') : 'sans';
    /* V865 — 마지막에 쓰던 색 · 굵기를 기억 (도구마다, 이 기기) */
    S.sizeOf = {};
    (function () {
      var m = {}; try { m = JSON.parse(ls('toolmemo') || '{}') || {}; } catch (e) { m = {}; }
      var okc = function (c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null; };
      if (okc(m.pen)) S.penSel = m.pen; if (okc(m.hl)) S.hlSel = m.hl;
      if (m.tc && typeof m.tc === 'object') { S.toolCol = {}; ['chord', 'fbox'].forEach(function (k) { if (okc(m.tc[k])) S.toolCol[k] = m.tc[k]; }); }
      if (m.sz && typeof m.sz === 'object') Object.keys(m.sz).forEach(function (k) { var v = +m.sz[k]; if (v === 0 || v === 1 || v === 2) S.sizeOf[k] = v; });
      if (m.fsz && typeof m.fsz === 'object') Object.keys(m.fsz).forEach(function (k) { var v = +m.fsz[k]; if (v > 0 && v < 0.2) S.fsz[k] = v; });
    })();
    function memoSave() { try { ls('toolmemo', JSON.stringify({ pen: S.penSel || '', hl: S.hlSel || '', tc: S.toolCol || {}, sz: S.sizeOf, fsz: S.fsz })); } catch (e) { /* 저장이 막힌 브라우저 */ } }
    function applySize() {
      var v = S.fsz[sizeKey()] || slotSizes(sizeKey())[S.sizeIdx];
      if (S.tool === 'pen' || S.tool === 'hl') an.setWidth(v); else if (S.tool === 'text' || S.tool === 'chord') an.setTextSize(v); else if (S.tool === 'sym') an.setSymSize(v); else if (S.tool === 'fbox') an.setFboxSize(v);
    }
    /** 펜 ↔ 지우개 빠른 전환 (V848: 펜 · 형광펜을 1초 누르고 있기 · 펜 옆 버튼) — 도구 막대의 단추를 누른 것과 똑같이 바꿉니다 */
    function swapTool(to, via) {
      setTool(to);
      if (via === 'hold') { toast('지우개 — 문질러 지우세요 · 떼면 ' + (S.prevDraw === 'hl' ? '형광펜' : '펜') + '으로 돌아갑니다', false, 1300); return; }
      toast(to === 'eraser' ? '지우개로 전환 — 펜 옆 버튼을 다시 누르면 펜으로 돌아옵니다' : '펜으로 돌아왔습니다', false, 1600);
    }
    /* 음표 도구 = 기호 도구에 음표 · 쉼표 팔레트 (필기 저장 형식은 기호와 같음) */
    function toolOn(t) { return t === 'note' ? (S.tool === 'sym' && S.symGrp === 'note') : t === 'sym' ? (S.tool === 'sym' && S.symGrp !== 'note') : S.tool === t; }
    function setTool(t, fromAnno, quiet) {
      if (opts.readOnly && t !== 'none') return;
      if (t === 'note' || t === 'sym') {
        var grp = t === 'note' ? 'note' : 'sym', grpChanged = S.symGrp !== grp; S.symGrp = grp; t = 'sym';
        var inGrp = function (k) { return YA.SYMBOLS.some(function (x) { return x.k === k && (x.grp === 'note') === (grp === 'note'); }); };
        if (!inGrp(S.sym)) { S.sym = grp === 'note' ? 'n:4' : 'sharp'; an.setSymbol(S.sym); }
        if (grpChanged) { var pp = $('.pv-sympop'); if (pp) { pp.innerHTML = ''; pp._wired = false; } }
        if (S.tool === 'sym' && grpChanged && !fromAnno) { S.symOpen = true; renderTools(); renderSymPop(); if (!quiet) toast(grp === 'note' ? '음표: 위에서 음표 · 쉼표를 고르고 악보를 눌러 찍습니다.' : '기호: 고른 기호를 악보에 눌러 찍습니다.', false, 2400); return; }
      }
      if (t === 'eraser' && (S.tool === 'pen' || S.tool === 'hl')) S.prevDraw = S.tool;      // V844 — 지우개를 쓰고 펜슬을 떼면 돌아갈 도구
      if (t !== S.tool) S.szEdit = -1;
      S.tool = t; if (!fromAnno) an.setTool(t);
      if (S.sizeOf[sizeKey()] != null) S.sizeIdx = S.sizeOf[sizeKey()];                 // V865 — 그 도구에서 마지막에 고른 굵기
      if (t === 'pen') an.setWidth(slotSizes('pen')[S.sizeIdx]); else if (t === 'hl') an.setWidth(slotSizes('hl')[S.sizeIdx]);
      if (fromAnno) { S.symOpen = false; renderTools(); renderSymPop(); P.emit('tool', t); return; }    // v6 — 필기 도구가 스스로 선택·이동으로 바꿈 (지금 누르고 있는 동작은 그대로 이어짐)
      applySize(); S.symOpen = t === 'sym'; renderTools(); renderSymPop(); P.emit('tool', t);
      var hint = { pen: '펜: 손가락 · 펜 · 마우스로 그립니다.', hl: '형광펜: 문지르면 반투명하게 칠해집니다.', text: '글자: 악보를 눌러 글을 씁니다. 쓴 글자를 다시 누르면 고칠 수 있습니다.', chord: '코드: 악보를 눌러 코드를 씁니다. 아래 버튼으로 빠르게 입력하세요.', sym: S.symGrp === 'note' ? '음표: 위에서 온음표 · 2분 · 4분 · 8분 · 16분음표나 쉼표를 고르고 악보를 눌러 찍습니다. (크기는 아래 숫자칸, 옮기기는 선택·이동)' : '기호: 고른 기호를 악보에 눌러 찍습니다. (이음줄 · 크레센도는 끌어서 길이 조절)', select: '선택·이동: 글자 · 코드 · 기호 · 송폼 라벨을 눌러 선택한 뒤, 끌어서 원하는 자리로 옮기세요. 아래에서 크기 · 글꼴을 바꾸거나 지울 수 있습니다.', eraser: '지우개: 지울 필기를 문지르세요. (내가 쓴 것만 지워집니다)', fbox: '송폼 라벨: 위 칸에서 V · C · P · B · Int 같은 이름표를 고른 뒤, 악보의 원하는 자리를 누르면 그 글자가 바로 붙습니다. (누른 채 끌면 자리를 맞출 수 있고, 잘못 붙였으면 선택·이동 도구로 옮기거나 지울 수 있습니다)' }[t];
      if (hint && !quiet) toast(hint, false, 2600);
    }
    function renderTools() {
      var ae = doc.activeElement;
      if (ae && ae.tagName === 'INPUT' && (ae.type === 'range' || ae.type === 'number') && toolsEl.contains(ae)) { S.toolsDirty = true; return; }          // 숫자칸에 직접 치는 중에는 다시 그리지 않음
      S.toolsDirty = false;
      var st = an.state ? an.state() : {}, hl = S.tool === 'hl', cols = hl ? YA.HL_COLORS : YA.PALETTE;
      var sel = S.tool === 'select' && an.selected ? an.selected() : null;
      var txt = S.tool === 'text' || S.tool === 'chord' || S.tool === 'sym' || !!(sel && (sel.t === 'text' || sel.t === 'sym' || sel.t === 'fbox')), isSym = S.tool === 'sym' || !!(sel && sel.t === 'sym');
      var fsz = sel ? (sel.sz || (sel.t === 'fbox' ? 0.028 : sel.t === 'sym' ? 0.032 : 0.024)) : isSym ? (st.symSize || 0.032) : (st.textSize || 0.024);
      var fontVal = sel ? (sel.f || 'sans') : S.font, showFont = !sel || sel.t === 'text';
      var rng = sel && sel.t === 'fbox' ? [8, 60] : isSym ? [12, 120] : [12, 80];
      var lock = sel && !sel.canModify ? ' disabled' : '';
      /* 글꼴 · 크기 줄 — 크기는 긴 슬라이더 대신 "숫자 + ▲▼" 작은 조절기 */
      var fontRow = !txt ? '' :
        '<div class="pv-tg pv-fontrow">' + (showFont ? '<label class="pv-fl"><span>글꼴</span><select data-font aria-label="글꼴"' + lock + '>' + YA.FONT_KEYS.map(function (k) { return '<option value="' + k + '"' + (fontVal === k ? ' selected' : '') + '>' + h(YA.FONT_NAMES[k]) + '</option>'; }).join('') + '</select></label>' : '') +
        '<div class="pv-fl"><span>크기</span><span class="pv-num" role="group" aria-label="글자 크기">' +
          '<input type="number" inputmode="numeric" pattern="[0-9]*" data-fsz min="' + rng[0] + '" max="' + rng[1] + '" step="1" value="' + Math.round(fsz * 1000) + '" aria-label="크기 숫자"' + lock + '>' +
          '<span class="pv-numbtns"><button type="button" class="pv-nb" data-step="1" aria-label="크기 키우기" title="크기 키우기"' + lock + '>▲</button><button type="button" class="pv-nb" data-step="-1" aria-label="크기 줄이기" title="크기 줄이기"' + lock + '>▼</button></span></span></div>' +
        (sel ? '<button type="button" class="pv-tool sm pv-del" data-a="delsel" title="선택한 것 지우기 (Delete)"' + lock + '><span class="ic">' + I('trash') + '</span><span class="nm">지우기</span></button>' : '') + '</div>';
      if (S.tool === 'select' && !sel) fontRow = '<div class="pv-tg pv-selhint">글자 · 코드 · 기호 · 송폼 라벨 · 펜 획을 눌러 선택하세요. 선택한 뒤 끌면 옮겨지고, 쓴 사람이 보입니다.</div>';
      /* 복사 · 붙여넣기 — 선택한 것을 복사하고, 복사해 둔 것이 있으면 어느 쪽에서든 붙여넣기 (키보드: Ctrl/⌘+C · V · D) */
      var canClip = !opts.readOnly && an.copySelected, hasClip = canClip && an.hasClip();
      var clipRow = !canClip || (!sel && !(hasClip && S.tool !== 'none')) ? '' : '<div class="pv-tg pv-cliprow">' +
        (sel ? '<button type="button" class="pv-tool sm" data-a="copysel" title="선택한 것 복사 (Ctrl/⌘+C)"><span class="ic">' + I('copy') + '</span><span class="nm">복사</span></button>' : '') +
        (hasClip ? '<button type="button" class="pv-tool sm" data-a="paste" title="붙여넣기 (Ctrl/⌘+V)"><span class="ic">' + I('paste') + '</span><span class="nm">붙여넣기</span></button>' : '') + '</div>';
      var curCol = sel && sel.c ? sel.c : S.curColor;
      var colRow = S.tool === 'select' && !sel ? '' : '<div class="pv-tg pv-colors pv-sec">' + cols.map(function (c) { var nm = (YA.COLOR_NAMES && YA.COLOR_NAMES[c]) || c; return '<button class="pv-col' + (c === curCol ? ' on' : '') + (c === '#ffffff' ? ' white' : '') + '" data-color="' + c + '" style="--c:' + c + '" title="' + nm + '" aria-label="색 ' + nm + '" aria-pressed="' + (c === curCol) + '"' + lock + '></button>'; }).join('') + '</div>';
      var fbRow = S.tool !== 'fbox' ? '' :
        '<div class="pv-tg pv-fbrow" role="group" aria-label="송폼 라벨">' + YA.FBOX_TAGS.map(function (k) { return '<button type="button" class="pv-fbtag' + (S.fboxTag === k ? ' on' : '') + '" data-fbtag="' + h(k) + '" title="' + h(YA.FBOX_NAMES[k] || k) + '" aria-pressed="' + (S.fboxTag === k) + '">' + h(k) + '</button>'; }).join('') + '</div>';
      toolsEl.innerHTML =
        '<button type="button" class="pv-dk" data-a="dockhide" title="도구 접기" aria-label="도구 접기"><span class="ic">' + I('up') + '</span><span class="nm">접기</span></button>' +
        '<div class="pv-tg">' + TOOLS.map(function (t) { var on = toolOn(t.t); return '<button class="pv-tool' + (on ? ' on' : '') + '" data-tool="' + t.t + '" title="' + t.n + '" aria-pressed="' + on + '"><span class="ic">' + I(t.ic) + '</span><span class="nm">' + t.n + '</span></button>'; }).join('') + '</div>' +
        colRow +
        fontRow + clipRow +
        fbRow +
        (S.tool === 'select' ? '' : '<div class="pv-tg pv-sizes pv-sec">' + [0, 1, 2].map(function (i) { var k = sizeKey(), sv = slotSizes(k); return '<button class="pv-size' + (S.sizeIdx === i && !S.fsz[k] ? ' on' : '') + '" data-size="' + i + '" title="' + (txt ? '크기 ' : '굵기 ') + (i + 1) + (SZ_RANGE[k] ? ' — 한 번 더 누르면 굵기 조절' : '') + '"><i style="--s:' + slotDot(k, sv[i], i) + 'px"></i></button>'; }).join('') +
          (SZ_RANGE[sizeKey()] && S.szEdit >= 0 ? (function () { var k = sizeKey(), r = SZ_RANGE[k], v = slotSizes(k)[S.szEdit]; return '<div class="pv-szpop" role="group" aria-label="굵기 ' + (S.szEdit + 1) + ' 조절"><span>굵기 ' + (S.szEdit + 1) + '</span><input type="range" data-szr min="' + r[0] + '" max="' + r[1] + '" step="' + (k === 'pen' ? 0.0002 : 0.001) + '" value="' + v + '" aria-label="굵기"><i class="pv-szprev" style="--s:' + slotDot(k, v, S.szEdit) + 'px"></i><button type="button" class="pv-szok" data-a="szok">완료</button></div>'; })() : '') + '</div>') +
        '<div class="pv-tg"><button class="pv-tool sm" data-a="undo" title="되돌리기 (Ctrl+Z)"' + (st.canUndo ? '' : ' disabled') + '><span class="ic">' + I('undo') + '</span><span class="nm">취소</span></button>' +
          '<button class="pv-tool sm" data-a="redo" title="다시 (Ctrl+Shift+Z)"' + (st.canRedo ? '' : ' disabled') + '><span class="ic">' + I('redo') + '</span><span class="nm">다시</span></button>' +
          '<button class="pv-tool sm pv-sec" data-a="clearpg" title="현재 페이지에 내가 쓴 필기 지우기"><span class="ic">' + I('trash') + '</span><span class="nm">현재 페이지</span></button></div>' +
        '<button type="button" class="pv-dk" data-a="dockmore" aria-pressed="' + (S.dockMore ? 'true' : 'false') + '" aria-expanded="' + (S.dockMore ? 'true' : 'false') + '" title="더 보기 — 색 · 굵기 · 글꼴" aria-label="더 보기"><span class="ic">' + I('more') + '</span><span class="nm">더 보기</span></button>' +
        '<div class="pv-tg pv-pills pv-sec"><label class="pv-mineonly' + (S.layer === 'mine' ? ' on' : '') + '" title="체크하면 나에게만 보입니다. 체크하지 않으면(기본) 팀 모두의 화면에 실시간으로 나타납니다."><input type="checkbox" data-a="mineonly"' + (S.layer === 'mine' ? ' checked' : '') + '><span>나만 보기</span></label>' +
          '<button class="pv-pill scope" data-a="scope" title="필기가 어디에 붙나요? (눌러서 바꾸기)">' + (S.scope === 'date' && S.room ? I('calendar') + '이 날짜만' : I('pin') + '곡에 계속') + '</button></div>';
      try { P.emit('toolsrender', toolsEl); } catch (e) { /* 라이브 컨트롤이 안 붙어도 도구는 그대로 */ }
    }
    toolsEl.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.disabled) return;
      if (b.dataset.fbtag) { S.fboxTag = b.dataset.fbtag; an.setFboxTag(S.fboxTag); ls('fbtag', S.fboxTag); renderTools(); return; }
      if (b.dataset.tool) { setTool(toolOn(b.dataset.tool) && b.dataset.tool !== 'none' ? 'none' : b.dataset.tool); return; }
      if (b.dataset.step != null) { if (e.detail === 0) stepFsz(+b.dataset.step); return; }               // 마우스 · 터치는 pointerdown (꾹 누르면 반복), 키보드(Enter · Space)만 여기서
      if (b.dataset.color && S.tool === 'select') { if (an.editSelected({ c: b.dataset.color })) renderTools(); return; }
      if (b.dataset.color) { S.curColor = b.dataset.color; if (S.tool === 'hl') { an.setHlColor(S.curColor); S.hlSel = S.curColor; } else { an.setColor(S.curColor); if (S.tool === 'chord' || S.tool === 'fbox') (S.toolCol = S.toolCol || {})[S.tool] = S.curColor; else S.penSel = S.curColor; } memoSave(); renderTools(); an.focusEditor && an.focusEditor(); return; }
      if (b.dataset.size != null) {
        var si = +b.dataset.size, again = S.sizeIdx === si && !S.fsz[sizeKey()];
        S.sizeIdx = si; delete S.fsz[sizeKey()]; S.sizeOf[sizeKey()] = si; memoSave();
        S.szEdit = again && SZ_RANGE[sizeKey()] ? (S.szEdit === si ? -1 : si) : -1;         // V844 — 이미 고른 칸을 한 번 더 누르면 굵기 조절 막대 열기 · 닫기
        applySize(); renderTools(); an.focusEditor && an.focusEditor(); return;
      }
      if (b.dataset.a === 'szok') { S.szEdit = -1; renderTools(); return; }
      var a = b.dataset.a;
      if (a === 'dockhide') { setTools(false, true); return; }
      if (a === 'dockmore') { setDockMore(!S.dockMore, true); return; }
      if (a === 'undo') { an.undo(); renderTools(); } else if (a === 'redo') { an.redo(); renderTools(); }
      else if (a === 'clearpg') { var n = an.clearPage(S.layer, false); if (n) toast(n + '개를 지웠습니다. ↶ 로 되돌릴 수 있어요.'); renderTools(); }
      else if (a === 'copysel') { doCopy(); }
      else if (a === 'paste') { doPaste(); }
      else if (a === 'delsel') { if (an.deleteSelected()) { toast('지웠습니다. ↶ 로 되돌릴 수 있어요.', false, 1600); } renderTools(); }
      else if (a === 'scope') { if (!S.room) toast('이 곡에만 붙일 수 있습니다.'); else setScope(S.scope === 'song' ? 'date' : 'song'); }
    });
    /* 나만 보기 체크박스 · 글꼴 · 크기 슬라이더 */
    toolsEl.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.a === 'mineonly') { setLayer(t.checked ? 'mine' : 'team', true); toast(t.checked ? '이제 나만 보이게 씁니다.' : '이제 팀 모두에게 공유됩니다.', false, 1400); }
      else if (t.dataset && t.dataset.font != null) {
        if (S.tool === 'select') { an.editSelected({ f: t.value }); renderTools(); return; }
        S.font = t.value; ls('font', S.font); an.setFont(S.font); renderTools(); an.focusEditor && an.focusEditor();
      }
      else if (t.dataset && t.dataset.fsz != null) { var nv = parseInt(t.value, 10); if (isFinite(nv)) setFsz(nv / 1000); S.toolsDirty = false; renderTools(); an.focusEditor && an.focusEditor(); }
    });
    toolsEl.addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.szr != null && S.szEdit >= 0) {                        // V844 — 굵기 칸 조절: 바로 반영 + 이 기기에 저장 (막대를 끄는 동안 도구 막대를 다시 그리지 않음)
        var k = sizeKey(), v = Math.round(+t.value * 10000) / 10000; if (!SZ_RANGE[k] || !(v > 0)) return;
        slotSave(k, S.szEdit, v); if (S.sizeIdx === S.szEdit) an.setWidth(v);
        var pv = toolsEl.querySelector('.pv-szprev'); if (pv) pv.style.setProperty('--s', slotDot(k, v, S.szEdit) + 'px');
        var bt = toolsEl.querySelector('.pv-size[data-size="' + S.szEdit + '"] i'); if (bt) bt.style.setProperty('--s', slotDot(k, v, S.szEdit) + 'px');
        return;
      }
      if (!(t.dataset && t.dataset.fsz != null)) return;
      var nv = parseInt(t.value, 10); if (isFinite(nv) && nv >= (+t.min || 1) && nv <= (+t.max || 999)) setFsz(nv / 1000, true);      // 숫자를 치는 도중에도 바로 반영
    });
    /* 글자 크기 — 숫자칸 + ▲▼ (1 단위). 선택·이동 도구에서는 선택한 항목에, 나머지는 새로 쓸 글자 · 기호 크기에 적용 */
    function fszRange() { var sel = S.tool === 'select' && an.selected ? an.selected() : null; return sel && sel.t === 'fbox' ? [0.008, 0.06] : (S.tool === 'sym' || (sel && sel.t === 'sym')) ? [0.012, 0.12] : [0.012, 0.08]; }
    function curFsz() {
      var sel = S.tool === 'select' && an.selected ? an.selected() : null, st = an.state();
      return sel ? (sel.sz || (sel.t === 'fbox' ? 0.028 : sel.t === 'sym' ? 0.032 : 0.024)) : S.tool === 'sym' ? (st.symSize || 0.032) : (st.textSize || 0.024);
    }
    function setFsz(v, quiet) {
      var r = fszRange(); v = Math.max(r[0], Math.min(r[1], Math.round(v * 1000) / 1000));
      if (S.tool === 'select') { an.editSelected({ sz: v }); }
      else { var key = sizeKey(); S.fsz[key] = v; if (key === 'sym') an.setSymSize(v); else an.setTextSize(v); memoSave(); }
      var o = toolsEl.querySelector('input[data-fsz]'); if (o && doc.activeElement !== o) o.value = Math.round(v * 1000);
      if (!quiet) { S.toolsDirty = false; }
    }
    function stepFsz(dir) { setFsz(Math.round(curFsz() * 1000 + dir) / 1000); renderTools(); if (S.tool !== 'select') an.focusEditor && an.focusEditor(); }
    /* ▲▼ 꾹 누르면 반복 (포커스를 뺏지 않아 글자를 치던 중에도 그대로 이어집니다) */
    var holdT = 0, holdI = 0;
    function holdStop() { clearTimeout(holdT); clearInterval(holdI); holdT = holdI = 0; }
    toolsEl.addEventListener('pointerdown', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-step]') : null; if (!b || b.disabled) return;
      e.preventDefault(); var dir = +b.dataset.step; stepFsz(dir); holdStop();
      holdT = setTimeout(function () { holdI = setInterval(function () { stepFsz(dir); }, 70); }, 420);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { toolsEl.addEventListener(n, holdStop); });
    doc.addEventListener('pointerup', holdStop);
    P.on('annochange', function () { clearTimeout(S.toolT); S.toolT = setTimeout(renderTools, 60); });
    ['songedit', 'songs', 'page', 'sheet', 'cfg'].forEach(function (n) { P.on(n, function () { updateFormBadge(); }); });
    /* 색은 도구마다 기억 (펜/글자는 같은 색, 형광펜은 따로) */
    S.curColor = YA ? YA.PALETTE[0] : '#ff5a1f';
    var origSetTool = setTool;
    setTool = function (t) { origSetTool(t); S.curColor = t === 'hl' ? (S.hlSel || YA.HL_COLORS[0]) : (t === 'chord' || t === 'fbox') ? ((S.toolCol && S.toolCol[t]) || '#111111') : (S.penSel || YA.PALETTE[0]);   /* v6.9 — 코드 · 송폼 라벨의 기본색은 검정 (색을 바꾸면 그 도구에서는 기억) */ if (t === 'hl') an.setHlColor(S.curColor); else if (t !== 'none') an.setColor(S.curColor); renderTools(); if (S.compact && t !== 'none') setDrawer(false); };     // v6.1 — 도구를 고르면 서랍을 닫아 바로 악보에 쓸 수 있게

    function renderSymPop() {
      var pop = $('.pv-sympop'); pop.style.display = S.symOpen ? 'block' : 'none';
      if (!S.symOpen) return;
      if (!pop.firstChild) {
        var noteGrp = S.symGrp === 'note';
        pop.innerHTML = '<div class="pv-symbar" title="끌어서 옮기기 · 두 번 누르면 처음 자리로"><span class="pv-symgrip" aria-hidden="true">⋮⋮</span><b>' + (noteGrp ? '음표 · 쉼표' : '기호') + '</b><small>끌어서 옮기기</small>' +
          '<button type="button" class="pv-symfold" aria-label="접기 / 펼치기" title="접기 / 펼치기">▾</button></div><div class="pv-symgrid">' + YA.SYMBOLS.filter(function (s) { return (s.grp === 'note') === noteGrp; }).map(function (s) { return '<button class="pv-sym' + (s.k === S.sym ? ' on' : '') + '" data-k="' + s.k + '" title="' + h(s.n) + '"><canvas width="44" height="44"></canvas><span>' + h(s.n) + '</span></button>'; }).join('') + '</div>';
        Array.prototype.forEach.call(pop.querySelectorAll('.pv-sym'), function (b) {
          var c = b.querySelector('canvas').getContext('2d'), k = b.dataset.k;
          YA.drawItem(c, { t: 'sym', k: k, c: '#ffb066', x: YA.STRETCH[k] ? 0.15 : 0.5, y: 0.5, sz: k === 'n:16b' ? 0.26 : k === 'n:3' ? 0.34 : (k === 'n:hd' || k === 'n:ho') ? 0.9 : 0.42, w2: 0.7 }, 44, 44);
        });
        if (!pop._drag) wireSymDrag(pop);
        if (!pop._wired) pop.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('.pv-sym') : null; if (!b) return; an.setSymbol(b.dataset.k); S.sym = b.dataset.k; Array.prototype.forEach.call(pop.querySelectorAll('.pv-sym'), function (x) { x.classList.toggle('on', x === b); }); toast(b.title + ' — 악보를 눌러 찍으세요.', false, 1800); });
        pop._wired = true;
      }
      pop.classList.toggle('folded', ls('symfold') === '1');
      symPlace(pop);
    }
    /* 기호 · 음표 팔레트 옮기기 — 위쪽 막대를 끌면 화면 어디로든 (기기에 기억), 두 번 누르면 처음 자리 · ▾ 로 접기 */
    function symPos() { try { var p = JSON.parse(ls('sympos') || 'null'); return p && isFinite(p.x) && isFinite(p.y) ? p : null; } catch (e) { return null; } }
    function symBox(pop) { var cb = pop.offsetParent || pop.parentNode; var r = cb.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width || root.innerWidth, h: r.height || root.innerHeight }; }   // 팔레트가 들어 있는 칸 (악보 화면) 기준
    function symPlace(pop) {
      var p = symPos();
      if (!p) { pop.classList.remove('moved'); pop.style.left = pop.style.top = ''; return; }
      pop.classList.add('moved');
      var B = symBox(pop), w = pop.offsetWidth || 320;
      pop.style.left = Math.round(Math.max(4, Math.min(B.w - w - 4, p.x * B.w))) + 'px';
      pop.style.top = Math.round(Math.max(4, Math.min(B.h - 48, p.y * B.h))) + 'px';
    }
    function wireSymDrag(pop) {
      pop._drag = true;
      var d = null;
      pop.addEventListener('pointerdown', function (e) {
        var bar = e.target.closest ? e.target.closest('.pv-symbar') : null;
        if (!bar || e.target.closest('.pv-symfold') || (e.pointerType === 'mouse' && e.button !== 0)) return;
        var r = pop.getBoundingClientRect();
        d = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, x0: e.clientX, y0: e.clientY };
        try { bar.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
        e.preventDefault(); e.stopPropagation();
      });
      pop.addEventListener('pointermove', function (e) {
        if (!d || e.pointerId !== d.id) return;
        if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 4) return;
        d.moved = true; pop.classList.add('moved', 'dragging');
        var B = symBox(pop), w = pop.offsetWidth;
        var L = Math.max(4, Math.min(B.w - w - 4, e.clientX - d.dx - B.l)), T = Math.max(4, Math.min(B.h - 48, e.clientY - d.dy - B.t));
        pop.style.left = L + 'px'; pop.style.top = T + 'px';
        e.preventDefault();
      });
      function end(e) {
        if (!d || (e && e.pointerId !== d.id)) return;
        if (d.moved) { var B = symBox(pop); ls('sympos', JSON.stringify({ x: +((parseFloat(pop.style.left) || 0) / B.w).toFixed(4), y: +((parseFloat(pop.style.top) || 0) / B.h).toFixed(4) })); }
        pop.classList.remove('dragging'); d = null;
      }
      pop.addEventListener('pointerup', end); pop.addEventListener('pointercancel', end);
      pop.addEventListener('dblclick', function (e) { if (!(e.target.closest && e.target.closest('.pv-symbar')) || e.target.closest('.pv-symfold')) return; ls('sympos', ''); symPlace(pop); toast('팔레트를 처음 자리로 옮겼습니다.', false, 1400); });
      pop.addEventListener('click', function (e) { if (!(e.target.closest && e.target.closest('.pv-symfold'))) return; var f = !pop.classList.contains('folded'); pop.classList.toggle('folded', f); ls('symfold', f ? '1' : '0'); symPlace(pop); });
      root.addEventListener('resize', function () { if (pop.style.display !== 'none') symPlace(pop); });
    }

    /* ------------------------------------------------------------ 패널(탭) */
    /** 탭을 (아직이면) 만듭니다 — 화면에 띄우지는 않음. showTab 의 "처음 열릴 때 만들기" 부분을 그대로 떼어 낸 것 */
    function ensureTab(id) {
      var t = P.tabs.filter(function (x) { return x.id === id; })[0]; if (!t) return null;
      if (!t.built) {
        var pane = panesEl.querySelector('[data-pane="' + id + '"]'); if (!pane) return null;
        t.built = true;
        try { t.api = t.build(pane) || {}; } catch (e) { pane.innerHTML = '<p class="pv-err">이 패널을 열지 못했습니다: ' + h(e.message) + '</p>'; if (root.console) root.console.error(e); }
      }
      return t.api || null;
    }
    function showTab(id) {
      var t = P.tabs.filter(function (x) { return x.id === id; })[0]; if (!t) return;
      S.tab = id; el.classList.add('pv-sideopen'); if (S.layout === 'computer') ls('side', '1');
      Array.prototype.forEach.call(tabsEl.children, function (b) { b.classList.toggle('on', b.dataset.tab === id); b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false'); });
      Array.prototype.forEach.call(panesEl.children, function (p) { p.style.display = p.dataset.pane === id ? '' : 'none'; });
      ensureTab(id);
      try { if (t.api && t.api.onShow) t.api.onShow(); } catch (e) {}
      paintRanges();
      renderSoon(260);
    }
    /* 슬라이더의 주황 채움 폭(--fill) — 값이 바뀔 때마다 갱신 (손잡이를 움직이거나 패널이 값을 넣을 때) */
    function paintRanges() {
      Array.prototype.forEach.call(el.querySelectorAll('input[type=range]'), function (r) {
        var mn = parseFloat(r.min || 0), mx = parseFloat(r.max || 100), v = parseFloat(r.value);
        r.style.setProperty('--fill', (mx > mn ? Math.max(0, Math.min(100, (v - mn) / (mx - mn) * 100)) : 0) + '%');
      });
    }
    el.addEventListener('input', function (e) { if (e.target && e.target.type === 'range') paintRanges(); }, true);
    el.addEventListener('change', function (e) { if (e.target && e.target.type === 'range') paintRanges(); }, true);
    function buildTabs() {
      try { P.tabs = root.YNPanels ? root.YNPanels.build(P) : []; } catch (e) { P.tabs = []; toast('패널을 불러오지 못했습니다: ' + e.message, true); }
      tabsEl.innerHTML = P.tabs.map(function (t) { return '<button class="pv-tabbtn" role="tab" data-tab="' + t.id + '" title="' + h(t.label) + '" aria-label="' + h(t.label) + '"><span>' + (I(t.icon) || t.icon) + '</span><em>' + h(t.short || t.label) + '</em></button>'; }).join('');   // V842 — 짧은 이름 · 넓으면 한 줄, 좁으면 두 줄 격자
      panesEl.innerHTML = P.tabs.map(function (t) { return '<div class="pv-pane" data-pane="' + t.id + '" style="display:none"></div>'; }).join('');
    }
    tabsEl.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('.pv-tabbtn') : null; if (b) showTab(b.dataset.tab); });

    /* ------------------------------------------------------------ 내보내기 · 인쇄 */
    function fname(ext, suffix) { var n = String((sheets[S.sheetIdx].name || '악보')).replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]/g, '_'); return n + (suffix || '') + '.' + ext; }
    function saveBlob(blob, name) { var a = doc.createElement('a'); a.href = root.URL.createObjectURL(blob); a.download = name; doc.body.appendChild(a); a.click(); setTimeout(function () { root.URL.revokeObjectURL(a.href); a.remove(); }, 800); }
    function composite(d, pg, scale) {
      var cv = doc.createElement('canvas');
      return renderTo(cv, d, pg, scale).then(function (info) { try { an.drawPage(cv.getContext('2d'), cv.width, cv.height, pg); } catch (e) {} return { cv: cv, info: info }; });
    }
    function exportPng() {
      if (!S.doc) { toast('악보가 열려 있어야 합니다.', true); return Promise.resolve(); }
      toast('그림 파일을 만드는 중…');
      return composite(S.doc, S.page, 2).then(function (r) { return new Promise(function (res, rej) { r.cv.toBlob(function (b) { b ? res(b) : rej(new Error('그림을 만들지 못했습니다')); }, 'image/png'); }); })
        .then(function (b) { saveBlob(b, fname('png', '-' + S.page + '쪽')); toast('필기가 들어간 그림을 저장했습니다.'); }, function (e) { toast('저장하지 못했습니다: ' + e.message, true); });
    }
    function exportPdf(printIt) {
      if (!S.doc) { toast('악보가 열려 있어야 합니다.', true); return Promise.resolve(); }
      var d = S.doc, n = d.n, scale = n > 8 ? 1.3 : n > 4 ? 1.6 : 2;
      return loadScript('/vendor/jspdf.umd.min.js', function () { return !!(root.jspdf && root.jspdf.jsPDF); }).then(function () {
        var pdf = null, i = 1;
        function step() {
          if (i > n) return pdf;
          toast((printIt ? '인쇄 준비' : 'PDF 만드는 중') + '… ' + i + ' / ' + n, false, 8000);
          return composite(d, i, scale).then(function (r) {
            var w = r.info.w, hh = r.info.h, o = w > hh ? 'l' : 'p';
            if (!pdf) pdf = new root.jspdf.jsPDF({ orientation: o, unit: 'pt', format: [w, hh], compress: true }); else pdf.addPage([w, hh], o);
            pdf.addImage(r.cv.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, w, hh); r.cv.width = r.cv.height = 1; i++;
            return new Promise(function (res) { setTimeout(res, 0); }).then(step);
          });
        }
        return step();
      }).then(function (pdf) {
        if (!printIt) { pdf.save(fname('pdf', '-필기')); toast('필기가 들어간 PDF 를 저장했습니다.'); return; }
        var url = root.URL.createObjectURL(pdf.output('blob')), fr = doc.createElement('iframe');
        fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'; fr.src = url; doc.body.appendChild(fr);
        fr.onload = function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); toast('인쇄 창을 열었습니다.'); } catch (e) { pdf.save(fname('pdf', '-필기')); toast('바로 인쇄할 수 없어 PDF 로 저장했습니다. 저장한 파일을 인쇄해 주세요.', true); } setTimeout(function () { fr.remove(); root.URL.revokeObjectURL(url); }, 60000); };
      }).catch(function (e) { toast('만들지 못했습니다: ' + ((e && e.message) || e), true); });
    }

    /* ------------------------------------------------------------ 입력: 클릭 · 스와이프 · 키보드 */
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-a],[data-layout]') : null; if (!b || toolsEl.contains(b)) return;
      if (b.dataset.layout) { applyLayout(b.dataset.layout, true); return; }
      var a = b.dataset.a;
      if (a === 'more') { setMore(!el.classList.contains('pv-moreopen')); return; }
      if (a === 'drawer-close') setDrawer(false); else if (a === 'drawer-panel') { setDrawer(false); toggleSide(true); }
      else if (a === 'close') api.close(); else if (a === 'prev') prevPage(true); else if (a === 'next') nextPage(true);
      else if (a === 'zin') setZoom(S.zoom * 1.2, true); else if (a === 'zout') setZoom(S.zoom / 1.2, true);
      else if (a === 'spread') toggleSpread();
      else if (a === 'crop') { S.crop = !S.crop; ls('crop', S.crop ? '1' : '0'); S.zoom = 1; syncCropUi(); renderPage(); sendNav(); toast(S.crop ? '여백을 줄여 악보를 크게 보여 줍니다' : '종이 전체를 보여 줍니다'); }
      else if (a === 'zfit') { S.fitUser = true; S.zoom = 1; S.fit = S.fit === 'page' ? 'width' : 'page'; renderPage(); sendNav(); toast(S.fit === 'page' ? '한 쪽이 다 보이게 맞춤' : '가로 폭에 맞춤'); }
      else if (a === 'theme') {                                                  // v6.3 — 라이브 악보도 ☀️ / 🌙 (포털 · 허브와 같은 설정)
        var toLight = doc.documentElement.getAttribute('data-theme') !== 'light';
        try { if (window.YNTheme && window.YNTheme.set) window.YNTheme.set(toLight ? 'light' : 'dark', b); else { if (toLight) doc.documentElement.setAttribute('data-theme', 'light'); else doc.documentElement.removeAttribute('data-theme'); localStorage.setItem('ynTheme', toLight ? 'light' : 'dark'); } } catch (e) {}
        b.innerHTML = I(toLight ? 'moon' : 'sun');
      }
      else if (a === 'fs') setFs(!S.fs); else if (a === 'fs-bar') fsBar(!el.classList.contains('pv-fsbar-on')); else if (a === 'fs-tools') { setTools(el.classList.contains('pv-toolshide'), false); fsBar(true); } else if (a === 'fs-panel') { toggleSide(); fsBar(true); }
      else if (a === 'pdf') exportPdf(false); else if (a === 'rtmenu') rtOpen(rtPop.hidden); else if (a === 'panel') toggleSide(); else if (a === 'follow') { if (S.manual) setManual(false); else setFollow(!S.follow); } else if (a === 'followm') setFollowM(!S.followM); else if (a && a.indexOf('tab:') === 0) showTab(a.slice(4));
    });
    stage.addEventListener('click', function (e) {
      if (S.layout !== 'tablet' || S.tool !== 'none' || !box.contains(e.target) || S.zoom > 1.05 || e.target.closest('.pv-toast')) return;
      var r = box.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width;
      if (fx < 0.18) prevPage(true); else if (fx > 0.82) nextPage(true);
    });
    /* ---- 손가락 제스처 (폰 · 태블릿) — 옆으로 쓸기 = 쪽 넘기기, 두 손가락 벌리기 · 좁히기 = 확대 · 축소 ----
       · 왼쪽으로 쓸면 다음 쪽, 오른쪽으로 쓸면 이전 쪽 (확대해서 보는 중에는 원래대로 화면을 옮김)
       · 필기 도구를 쓰는 중에는 손가락 한 개는 그리기에 쓰이므로 쓸어 넘기기는 꺼집니다 (펜슬 전용 모드에서는 손가락이 넘기기 · 화면 이동)
       · 두 손가락은 언제나 확대 · 축소 (그리던 획은 버림) */
    var T = null;
    var SWIPE_MIN_DX = 60, SWIPE_MAX_SLOPE = 0.5, SWIPE_ZOOM = 1.05;            // 옆으로 60px 넘게, 세로는 가로의 절반 미만일 때만 쪽 넘김
    /** 쪽 넘김 + 부드러운 슬라이드 — 손가락을 따라 악보가 끌려다니지 않고, 넘어간 뒤 새 쪽이 옆에서 미끄러져 들어옵니다 */
    var slideT = 0;
    function slideFlip(dir) {
      var before = S.page + ':' + S.sheetIdx; dir > 0 ? nextPage(true) : prevPage(true);
      if (before === S.page + ':' + S.sheetIdx) return;                                           // 첫 쪽 · 마지막 쪽이라 안 넘어감
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      box.classList.remove('pv-slide-n', 'pv-slide-p'); void box.offsetWidth; box.classList.add(dir > 0 ? 'pv-slide-n' : 'pv-slide-p');
      clearTimeout(slideT); slideT = setTimeout(function () { box.classList.remove('pv-slide-n', 'pv-slide-p'); }, 320);
    }
    /** 브라우저가 악보 칸을 스스로 밀지 않게 — 한 쪽이 화면에 다 들어오면(확대 전 · 가로로 넘치지 않음) 터치 스크롤을 아예 끕니다 (아이패드 고무줄 당김 방지) */
    function syncTouch() {
      if (S.dead) return;
      var hx = stage.scrollWidth > stage.clientWidth + 2, vy = stage.scrollHeight > stage.clientHeight + 2, free = S.zoom <= SWIPE_ZOOM && (!hx || !!S.cropNow);   // v6.1 — 여백 자동 맞춤으로 종이 가장자리만 넘치는 것은 "확대"가 아님 → 쓸어 넘기기 그대로
      S.noHx = free; stage.classList.toggle('pv-tx-none', free && !vy); stage.classList.toggle('pv-tx-y', free && vy);
    }
    function tdist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
    function tmid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
    function fingerFree() { return S.tool === 'none' || (an.fingerDraws && !an.fingerDraws()); }        // 손가락 한 개를 "쓸기 · 화면 이동"에 써도 되는가
    /* v6.1 — 쓸어 넘기기를 사진 앱처럼: 끄는 동안 쪽이 손가락을 따라오고, 놓으면 넘어가거나 제자리로 돌아옵니다 */
    function canFlip(dir) { return dir > 0 ? (S.page < S.pages || S.sheetIdx < sheets.length - 1) : (S.page > 1 || S.sheetIdx > 0); }
    var dragT = 0;
    function dragMove(x) { clearTimeout(dragT); box.style.transition = 'none'; box.style.transform = 'translateX(' + Math.round(x) + 'px)'; }
    function dragReset(anim) {
      clearTimeout(dragT);
      if (!anim) { box.style.transition = ''; box.style.transform = ''; return; }
      box.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'; box.style.transform = 'translateX(0)';
      dragT = setTimeout(function () { box.style.transition = ''; box.style.transform = ''; }, 240);
    }
    function dragFlip(dir) { clearTimeout(dragT); box.style.transition = ''; box.style.transform = ''; slideFlip(dir); }   // 놓는 순간 넘기고 새 쪽이 옆에서 미끄러져 들어옴
    var lastTap = null;
    function dblTap(t) {
      var now = Date.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 30) {
        lastTap = null;
        var br = box.getBoundingClientRect();
        if (S.zoom > 1.05) { setZoom(1, true); return; }
        S.anchor = { fx: clamp((t.clientX - br.left) / (br.width || 1), 0, 1), fy: clamp((t.clientY - br.top) / (br.height || 1), 0, 1), cx: t.clientX, cy: t.clientY, t: now };
        setZoom(2, true); return;
      }
      lastTap = { t: now, x: t.clientX, y: t.clientY };
    }
    /** 확대 미리보기 — 손가락이 움직이는 대로 매 이벤트마다 스타일을 바꾸지 않고, 화면 프레임마다 마지막 값 하나만 적용 */
    var pvScale = 1, pvRaf = 0, pvTx = 0, pvTy = 0, pvOrg = '50% 0';
    function applyPreview() { pvRaf = 0; box.style.transformOrigin = pvOrg; box.style.transform = (pvScale === 1 && !pvTx && !pvTy) ? '' : (pvTx || pvTy ? 'translate(' + pvTx + 'px,' + pvTy + 'px) ' : '') + 'scale(' + pvScale + ')'; }
    /** tx · ty · org 는 두 손가락 확대에서 "손가락 사이 지점을 중심으로, 손가락이 움직인 만큼 함께" 미리 보여 주기 위한 값 (없으면 예전처럼 위쪽 가운데 기준 크기만) */
    function pinchPreview(scale, tx, ty, org) {
      pvScale = scale; pvTx = tx || 0; pvTy = ty || 0; pvOrg = org || '50% 0';
      if (scale === 1 && !pvTx && !pvTy) { if (pvRaf) { root.cancelAnimationFrame && root.cancelAnimationFrame(pvRaf); pvRaf = 0; } applyPreview(); return; }
      if (!pvRaf) pvRaf = root.requestAnimationFrame ? root.requestAnimationFrame(applyPreview) : (applyPreview(), 0);
    }
    /* ---- 애플 펜슬 손바닥 무시 (Step 2.12) ----
       펜슬이 화면에 닿아 있거나 위에 떠 있는 동안(끝난 뒤 700ms 까지), 그리고 닿는 면이 넓은 터치(손바닥)는 쪽 넘기기 · 화면 이동 · 확대에 쓰지 않고 브라우저 스크롤도 막습니다.
       그리는 캔버스는 처음부터 touch-action:none 이고, 필기 중에는 악보 칸 전체도 잠깁니다(.pv-penlock). */
    var penT = 0, penLockT = 0;
    function penNear() { return Date.now() - penT < 700; }
    function palmTouch(t) { return !!t && Math.max(t.radiusX || 0, t.radiusY || 0) > 44; }      // v6.1 — 아이패드 손가락(반지름 20~40)을 손바닥으로 잘못 보지 않게
    function notePenPtr(e) {
      if (e.pointerType !== 'pen') return;
      penT = Date.now(); if (!stage.classList.contains('pv-penlock')) stage.classList.add('pv-penlock');
      clearTimeout(penLockT); penLockT = setTimeout(function () { stage.classList.remove('pv-penlock'); }, 900);
    }
    ['pointerdown', 'pointermove', 'pointerover', 'pointerup'].forEach(function (n) { stage.addEventListener(n, notePenPtr, true); });
    P.on('close', function () { clearTimeout(penLockT); clearTimeout(dragT); doc.removeEventListener('pointerdown', moreOutside, true); });
    stage.addEventListener('touchstart', function (e) {
      if (S.dead) return;
      var anyPalm = penNear(); if (e.touches.length < 2) for (var pi = 0; pi < e.touches.length && !anyPalm; pi++) anyPalm = palmTouch(e.touches[pi]);   // 두 손가락(확대 · 이동)은 펜슬이 가까울 때만 막음
      if (anyPalm && !(T && T.pinch)) { T = { palm: true }; if (e.cancelable) e.preventDefault(); return; }
      if (T && T.drag) dragReset(false);      // 손바닥 · 펜슬 근처의 터치: 아무 동작도 하지 않음
      if (e.touches.length >= 2) {
        if (an.cancelCurrent) an.cancelCurrent();
        var m0 = tmid(e.touches[0], e.touches[1]), br = box.getBoundingClientRect();
        T = { pinch: true, d0: tdist(e.touches[0], e.touches[1]) || 1, z0: S.zoom, scale: 1, mx0: m0.x, my0: m0.y, mx: m0.x, my: m0.y, sl0: stage.scrollLeft, st0: stage.scrollTop,
          fx: clamp((m0.x - br.left) / (br.width || 1), 0, 1), fy: clamp((m0.y - br.top) / (br.height || 1), 0, 1), zoomed: false };
        if (e.cancelable) e.preventDefault(); return;
      }
      if (e.touches.length === 1) { var t = e.touches[0]; T = { x0: t.clientX, y0: t.clientY, lx: t.clientX, ly: t.clientY, t0: Date.now(), free: fingerFree(), moved: false, axis: null, drag: false }; }
    }, { passive: false });
    stage.addEventListener('touchmove', function (e) {
      if (!T) return;
      if (T.palm) { if (e.cancelable) e.preventDefault(); return; }
      if (T.pinch) {
        if (e.touches.length < 2) return;
        var mm = tmid(e.touches[0], e.touches[1]); T.mx = mm.x; T.my = mm.y;
        T.scale = clamp(tdist(e.touches[0], e.touches[1]) / T.d0, 0.3, 5) ; T.scale = clamp(T.z0 * T.scale, 0.5, 5) / T.z0;      // v6.1 — 사진 앱처럼: 줄이면 잠깐 작아졌다가 놓으면 한 쪽 맞춤으로 돌아옴
        if (!T.zoomed && Math.abs(T.scale - 1) < 0.05) {                                          // 두 손가락 이동 = 화면 밀기 (스크롤) — 손가락 간격이 거의 그대로일 때
          stage.scrollLeft = T.sl0 - (mm.x - T.mx0); stage.scrollTop = T.st0 - (mm.y - T.my0); pinchPreview(1);
        } else {                                                                                   // 간격이 변하면 확대 · 축소 — 손가락 사이 지점을 중심으로, 손가락이 움직인 만큼 함께 이동
          T.zoomed = true; stage.scrollLeft = T.sl0; stage.scrollTop = T.st0;
          pinchPreview(T.scale, mm.x - T.mx0, mm.y - T.my0, (T.fx * 100) + '% ' + (T.fy * 100) + '%');
        }
        if (e.cancelable) e.preventDefault(); return;
      }
      if (e.touches.length !== 1) return;
      var t = e.touches[0]; T.moved = T.moved || Math.abs(t.clientX - T.x0) > 8 || Math.abs(t.clientY - T.y0) > 8;
      /* 축 고정 (Step 2.14) — 10px 이상 움직인 순간 한 번만 정합니다: 세로 흔들림이 가로의 절반 미만(|dy/dx| < 0.5)이면 "가로 쓸기".
         가로 쓸기로 정해지면 (확대하지 않았고 가로로 밀 자리가 없을 때) 브라우저 스크롤 · 고무줄 당김을 막아 악보 쪽이 제자리에 그대로 있습니다. */
      var adx = Math.abs(t.clientX - T.x0), ady = Math.abs(t.clientY - T.y0);
      if (!T.axis && (adx > 10 || ady > 10)) T.axis = adx > 10 && ady < adx * 0.5 ? 'h' : 'v';
      if (T.free && T.axis === 'h' && S.zoom <= SWIPE_ZOOM && S.noHx) {                            // v6.1 — 사진 앱처럼 악보가 손가락을 따라 옆으로 움직임
        if (e.cancelable) e.preventDefault(); T.lx = t.clientX; T.ly = t.clientY;
        var ddx = t.clientX - T.x0, edge = !canFlip(ddx < 0 ? 1 : -1);
        T.drag = true; T.vx = (t.clientX - (T.px == null ? T.x0 : T.px)) / Math.max(1, Date.now() - (T.pt || T.t0)); T.px = t.clientX; T.pt = Date.now();
        dragMove(edge ? ddx * 0.28 : ddx); return;
      }
      if (T.free && S.tool !== 'none') {                                                          // 펜슬 전용 모드 — 캔버스가 브라우저의 스크롤을 막고 있으니 화면 이동은 직접
        stage.scrollLeft -= t.clientX - T.lx; stage.scrollTop -= t.clientY - T.ly; if (e.cancelable) e.preventDefault();
      }
      T.lx = t.clientX; T.ly = t.clientY;
    }, { passive: false });
    function touchDone(e) {
      if (!T) return;
      if (T.palm) { if (!e.touches.length) T = null; return; }
      if (T.pinch) {
        if (e.touches.length >= 2) return;
        var sc = T.scale, tt = T; T = null; pinchPreview(1);
        if (tt.zoomed && Math.abs(sc - 1) > 0.02) {
          var nz = S.zoom * sc; if (nz < 1) nz = 1;                                               // 사진 앱처럼 — 한 쪽보다 작게 놓으면 한 쪽 맞춤으로
          S.anchor = { fx: tt.fx, fy: tt.fy, cx: tt.mx, cy: tt.my, t: Date.now() };              // 다시 그린 뒤 손가락 사이 지점이 손가락이 놓인 자리에 오도록 스크롤 맞춤
          if (Math.abs(nz - S.zoom) > 0.01) setZoom(nz, true);
        }
        return;
      }
      var me = T; if (e.touches.length) return; T = null;
      if (e.type === 'touchcancel' || !me.free || !e.changedTouches.length) { if (me.drag) dragReset(true); return; }
      var t = e.changedTouches[0], dx = t.clientX - me.x0, dy = t.clientY - me.y0, dt = Date.now() - me.t0;
      if (me.drag) {                                                                               // 따라 움직이던 쪽: 충분히 밀었거나 빠르게 튕겼으면 넘기고, 아니면 제자리로
        var wv = stage.clientWidth || 800, dir = dx < 0 ? 1 : -1;
        var go = (Math.abs(dx) > SWIPE_MIN_DX && Math.abs(dy) < Math.abs(dx) * SWIPE_MAX_SLOPE && dt < 800) || Math.abs(dx) > wv * 0.35;   // 빠르게 쓸었거나, 천천히라도 화면의 1/3 넘게 끌었으면
        if (go && canFlip(dir)) dragFlip(dir); else dragReset(true);
        return;
      }
      if (!me.moved && S.tool === 'none' && e.changedTouches.length === 1) { dblTap(t); return; }   // v6.1 — 두 번 톡 = 확대 / 한 쪽 맞춤 (사진 앱처럼)
      if (S.zoom <= SWIPE_ZOOM && Math.abs(dx) > SWIPE_MIN_DX && Math.abs(dy) < Math.abs(dx) * SWIPE_MAX_SLOPE && dt < 800) { slideFlip(dx < 0 ? 1 : -1); }
    }
    stage.addEventListener('touchend', touchDone, { passive: true });
    stage.addEventListener('touchcancel', touchDone, { passive: true });
    stage.classList.add('pv-gest');
    var scT = 0; stage.addEventListener('scroll', function () { clearTimeout(scT); scT = setTimeout(sendNav, 250); });
    stage.addEventListener('wheel', function (e) { if (e.ctrlKey) { e.preventDefault(); wheelZoom(e.deltaY < 0 ? 1.08 : 1 / 1.08); } }, { passive: false });
    /* 글자를 치는 중인지 — 그때는 단축키를 모두 끕니다. (체크박스 · 슬라이더 · 버튼에 초점이 남아 있는 것은 "치는 중"이 아니므로 단축키가 계속 됩니다) */
    var NOTYPE = { checkbox: 1, radio: 1, range: 1, button: 1, submit: 1, reset: 1, color: 1, file: 1, image: 1 };
    function isTyping(t) {
      if (!t || !t.tagName) return false;
      var tag = t.tagName; if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
      return tag === 'INPUT' && !NOTYPE[String(t.type || 'text').toLowerCase()];
    }
    var CUE_KEYS = { i: 'intro', c: 'c', p: 'pc', b: 'b', t: 'tag', r: 'repc', k: 'keyup', u: 'build', d: 'die', m: 'inst', e: 'end' };   // V859 — M 인스트루멘탈 · E 엔딩   // V843 — K 키 업 · U 빌드 업 · D 다이 다운
    var VERSE_IDS = ['v1', 'v2', 'v3', 'v4'], verseN = 0, verseSong = -2;
    /* V836 — Enter 를 누르면 이 곡의 송폼(예: Int V1 C V2 C B C) 순서를 따라 한 칸씩 콜아웃합니다. 끝까지 가면 처음으로, 곡을 바꾸면 첫 칸부터 다시.
       송폼이 없는 곡이면 아무 일도 하지 않습니다 (기본 동작 그대로). 마지막 칸에서 한 번 더 누르면 처음으로 돌아가요. */
    var formPos = -1, formPosSong = -2;
    function nextFormCue(back) {
      var toks = formTokens(songs[S.songIdx]); if (!toks.length) return null;
      if (S.songIdx !== formPosSong) { formPosSong = S.songIdx; formPos = back ? 0 : -1; }
      for (var n = 0; n < toks.length; n++) {                                          // 부를 큐가 없는 칸(예: 직접 쓴 빈 칸)은 건너뜀
        formPos = back ? (formPos - 1 + toks.length) % toks.length : (formPos + 1) % toks.length;
        var tok = toks[formPos] || {}, id = cueForToken(toks, formPos) || (tok.custom && tok.k ? tok.k : '');
        if (id) return { id: id, i: formPos };
      }
      return null;
    }
    function cueFromKey(e) {
      var k = e.key; if (!k || e.ctrlKey || e.metaKey || e.altKey) return null;
      if (S.songIdx !== verseSong) { verseSong = S.songIdx; verseN = 0; }                 // 곡이 바뀌면 절 세기를 처음부터
      if (k === 'P') return 'prayer'; if (k === 'R') return 'once';
      if (k === '2' || k === '3') { verseN = +k; return VERSE_IDS[+k - 1]; }        // V859 — 1 은 "1박 다시 맞추기" (1절은 V)
      var lk = k.length === 1 ? k.toLowerCase() : ''; if (e.shiftKey && lk !== 'p' && lk !== 'r') return null;
      if (lk === 'v') { var id = VERSE_IDS[verseN % 4]; verseN++; return id; }          // v 를 누를 때마다 1절 → 2절 → 3절 → 4절
      return CUE_KEYS[lk] || null;
    }
    /** 콜아웃한 자리(악보의 V · C · B … 송폼 라벨)를 1~2초 깜빡여 알려줍니다 */
    var CUE_TAGS = { intro: ['Int', 'Intro'], v1: ['V1', 'V'], v2: ['V2', 'V'], v3: ['V3', 'V'], v4: ['V4', 'V'], cvoice: ['C(Voice)', 'C', 'C1'], c: ['C', 'C1'], c2: ['C2'], c3: ['C3'], pc: ['P', 'PC'], pc2: ['PC2', 'P'], b: ['B'], b2: ['B2', 'B'], itld: ['Itld'], inst: ['Inst'], vamp: ['Turn', 'Vamp'], end: ['End', 'Out', 'Coda'],
      solo: ['Solo'], tag: ['Tag'], repc: ['C', 'C1', 'C2'], halfc: ['C', 'C1'], lastl: [], prayer: ['Prayer', 'Pray'] };
    /** 송폼 칸(i번째)을 지금 위치로 표시 — 송폼 창 · 악보 위 배지에서 밝게 (Enter 로 순서대로 부를 때 어디까지 왔는지 보이게) */
    function flashForm(i) {
      var si = S.songIdx, nodes = el.querySelectorAll('.pv-fb-t[data-s="' + si + '"]');
      Array.prototype.forEach.call(nodes, function (n) { var on = +n.getAttribute('data-i') === i; n.classList.toggle('cur', on); if (on) { n.classList.add('say'); setTimeout(function () { n.classList.remove('say'); }, 1100); } });
      S.formCur = { s: si, i: i };
      try { if (P.sendLead) P.sendLead({ song: si, fi: i }); } catch (e) { /* 리드가 아니면 보내지 않음 */ }   // V842 — 리드가 누른 송폼 위치를 팀 화면에
    }
    /* V842 — 리드가 지금 어느 송폼 칸인지 (다른 사람 화면의 송폼 창 · 배지에 "리드" 표시) */
    function paintLeadPos() {
      var lp = S.leadPos, nodes = el.querySelectorAll('.pv-fb-t[data-i]');
      Array.prototype.forEach.call(nodes, function (n) { var on = !!(lp && +n.getAttribute('data-s') === lp.s && +n.getAttribute('data-i') === lp.i); n.classList.toggle('lead', on); if (on) n.setAttribute('data-lead', lp.by || ''); else n.removeAttribute('data-lead'); });
    }
    P.on('lead', function (st) {
      if (!st) return; var me = rt && rt.me ? rt.me.name : '';
      if (st.by === me) return;
      if (st.fi >= 0 && st.song >= 0) {
        var changed = !S.leadPos || S.leadPos.s !== st.song || S.leadPos.i !== st.fi;
        S.leadPos = { s: st.song, i: st.fi, by: st.by };
        paintLeadPos();
        if (changed) Array.prototype.forEach.call(el.querySelectorAll('.pv-fb-t.lead'), function (n) { n.classList.remove('say'); void n.offsetWidth; n.classList.add('say'); setTimeout(function () { n.classList.remove('say'); }, 1100); });
      }
      S.leadBy = st.by || ''; paintForm();
    });
    function paintBpm() {                                                              // V844 — BPM 숫자만 그 자리에서 바꿈 (창 전체를 다시 그리지 않음)
      var cb = P.curBpm ? P.curBpm() : null, s0 = songs[S.songIdx] || {}, t = cb ? cb + ' BPM' : (s0.bpm ? s0.bpm + ' BPM' : '');
      Array.prototype.forEach.call(el.querySelectorAll('.pv-form-bpm'), function (n) { if (n.textContent !== t) n.textContent = t; });
    }
    P.on('bpmview', paintBpm);
    function flashCue(id) { var t = CUE_TAGS[String(id || '').replace(/~m\d+$/, '')]; if (!t || !t.length || !an || !an.flashTags) return 0; return an.flashTags(t, 1800); }
    var spaceEaten = false;
    function onKey(e) {
      if (S.dead || isTyping(e.target)) return;
      var k = e.key, mod = e.ctrlKey || e.metaKey;
      if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? an.redo() : an.undo(); renderTools(); return; }
      if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); an.redo(); renderTools(); return; }
      if (mod && (k === 'd' || k === 'D') && an.selected && an.selected() && !opts.readOnly) { e.preventDefault(); if (doCopy()) doPaste(); return; }   // Ctrl/⌘+D = 바로 복제
      if (mod) return;
      if (e.altKey) {                                                                  // 필기 도구 단축키는 Alt+글자 (글자만 누르는 키는 콜아웃에 씁니다)
        var tm = { KeyV: 'none', KeyP: 'pen', KeyH: 'hl', KeyT: 'text', KeyM: 'select', KeyC: 'chord', KeyS: 'sym', KeyN: 'note', KeyB: 'fbox', KeyE: 'eraser' }[e.code];
        if (tm) { e.preventDefault(); setTool(tm); }
        return;
      }
      if (k === 'Enter' && !e.repeat) {      // Enter = 송폼 순서대로 한 칸씩 콜아웃 (Shift+Enter = 한 칸 뒤로)
        var nf = nextFormCue(e.shiftKey);
        if (nf && nf.id && P.cueKey) { e.preventDefault(); var cr2 = P.cueKey(nf.id); try { P.flashForm && P.flashForm(nf.i); } catch (x) {} if (cr2) { toast('송폼 ' + (nf.i + 1) + '번째 — ' + ((root.YNMetro && root.YNMetro.CUE_BY[nf.id] ? (P.lang() === 'ko' ? root.YNMetro.CUE_BY[nf.id].ko : root.YNMetro.CUE_BY[nf.id].en) : nf.id)), false, 900); } return; }
      }
      if (k === '1' && !e.shiftKey && !e.repeat && P.metroKey) { var r1 = P.metroKey('re'); if (r1) { e.preventDefault(); return; } }   // V859 — 1 = 1박 다시 맞추기 (누른 그 박이 새 1박)
      if ((k === 'n' || k === 'N') && !e.shiftKey && !e.repeat && P.metroKey) { var rn = P.metroKey('count'); if (rn) { e.preventDefault(); return; } }   // V842 — N = 숫자로 세기 (누르는 순간이 1박)
      var cue = cueFromKey(e);                                                         // 콜아웃 단축키 (i v c p b r t · Shift+P 기도 · Shift+R 한 번 더 · 1 2 3 = 1·2·3절)
      if (cue) { if (P.cueKey) { var cr = e.repeat ? { ok: true } : P.cueKey(cue); if (cr) { e.preventDefault(); return; } } return; }
      if ((k === 'Delete' || k === 'Backspace') && an.selected && an.selected()) { e.preventDefault(); an.deleteSelected(); renderTools(); return; }
      var map = { ArrowRight: 'n', PageDown: 'n', ArrowLeft: 'p', PageUp: 'p', ArrowUp: 'bu', ArrowDown: 'bd', ' ': 'sp', Spacebar: 'sp', '+': 'zi', '=': 'zi', '-': 'zo', '0': 'zf', Escape: 'esc' };
      var m = map[k]; if (!m) return;
      if (m === 'bu' || m === 'bd' || m === 'sp') {                                    // 메트로놈: ↑↓ BPM · Space 시작/멈춤 — 메트로놈을 쓸 수 없으면 원래 동작(스크롤 등) 그대로
        if (!P.metroKey) return;
        var r = m === 'sp' ? (e.repeat ? { ok: true } : P.metroKey('toggle')) : P.metroKey('bpm', (m === 'bu' ? 1 : -1) * (e.shiftKey ? 5 : 1));
        if (!r) return; e.preventDefault(); if (m === 'sp') spaceEaten = true; return;
      }
      e.preventDefault();
      if (m === 'n') nextPage(true); else if (m === 'p') prevPage(true); else if (m === 'zi') setZoom(S.zoom * 1.2, true); else if (m === 'zo') setZoom(S.zoom / 1.2, true);
      else if (m === 'zf') { S.zoom = 1; renderPage(); sendNav(); }
      else if (m === 'esc') { if (S.fs) setFs(false); else if (an.selected && an.selected()) { an.deselect(); renderTools(); } else if (el.classList.contains('pv-drawopen')) setDrawer(false); else if (S.tool !== 'none') setTool('none'); else api.close(); } else setTool(m);
    }
    /* 필기 복사 · 붙여넣기 — 앱 안에서 기억한 항목(모양 · 색 그대로) + 시스템 클립보드에도 글을 넣어 둠.
       붙여넣을 때 클립보드 글이 방금 복사한 것이면 그 항목을, 다른 앱에서 복사한 글이면 새 글자로 붙임 */
    var lastClipTxt = null;
    function doCopy(evt) {
      var sel = an.selected && an.selected(); if (!sel) { toast('복사할 필기를 먼저 선택하세요 (선택·이동 도구).', true, 1800); return false; }
      var t = an.copySelected(); lastClipTxt = t || '[악보 필기]';
      if (evt && evt.clipboardData) { try { evt.clipboardData.setData('text/plain', lastClipTxt); evt.preventDefault(); } catch (x) { /* 무시 */ } }
      else if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(lastClipTxt).catch(function () {}); }
      toast('복사했습니다 — 붙여넣기(Ctrl/⌘+V)로 이 쪽이나 다른 쪽 · 다른 악보에 붙일 수 있어요.', false, 2000); renderTools(); return true;
    }
    function doPaste(text) {
      if (opts.readOnly) return false;
      var useClip = an.hasClip() && (text == null || text === '' || text === lastClipTxt);
      var it = useClip ? an.paste() : (text ? an.pasteText(text) : null);
      if (!it) return false;
      if (S.tool !== 'select') setTool('select', false, true);
      an.select && an.select(S.layer, it.id);
      toast(useClip ? '붙여넣었습니다 — 끌어서 자리를 맞추세요.' : '글자로 붙여넣었습니다 — 끌어서 자리를 맞추세요.', false, 1600); renderTools(); return true;
    }
    function onCopy(e) { if (S.dead || isTyping(e.target) || !(an.selected && an.selected())) return; doCopy(e); }
    function onPaste(e) {
      if (S.dead || opts.readOnly || isTyping(e.target) || !el.isConnected) return;
      var txt = ''; try { txt = (e.clipboardData && e.clipboardData.getData('text/plain')) || ''; } catch (x) { /* 무시 */ }
      if (!an.hasClip() && !txt.trim()) return;
      if (doPaste(txt)) e.preventDefault();
    }
    doc.addEventListener('copy', onCopy); doc.addEventListener('paste', onPaste);
    box.addEventListener('pointerdown', function (e) { if (an && an.markPoint) an.markPoint(e.clientX, e.clientY); }, true);
    function onKeyUp(e) { if ((e.key === ' ' || e.key === 'Spacebar') && spaceEaten) { spaceEaten = false; e.preventDefault(); } }   // 버튼에 초점이 있어도 Space 가 그 버튼을 또 누르지 않게
    doc.addEventListener('keyup', onKeyUp);
    el.addEventListener('change', function (e) { var t = e.target; if (t && t.tagName === 'SELECT') { try { t.blur(); } catch (x) {} } });   // 목록을 고른 뒤에도 단축키가 바로 먹도록
    doc.addEventListener('keydown', onKey);
    var rz = 0, ro = null;
    /* 창 크기 · 화면 회전 · 칸 크기 변화는 마지막 변화 뒤 150ms 가 조용할 때 한 번만 처리 (끌어서 창을 늘리는 동안 매 프레임 다시 계산 · 다시 그리지 않음) */
    function onResize() { clearTimeout(rz); rz = setTimeout(function () { rz = 0; if (S.dead) return; checkCompact(); renderSoon(0); }, 150); }
    root.addEventListener('resize', onResize);
    if (root.ResizeObserver) { ro = new root.ResizeObserver(onResize); ro.observe(stage); }
    /* 화면 켜짐 유지 — 세션 / 연습 화면이 열려 있는 동안 (Wake Lock API → 안 되면 작은 동영상 방식). 다시 보이면 알아서 다시 잡습니다 */
    var wakeCtl = root.YNWake ? root.YNWake.create({ win: root }) : null;
    function requestWake() { if (wakeCtl) wakeCtl.acquire(); }
    function onBeforeUnload() { flushMine(); try { rt && rt.close(); } catch (e) {} }
    root.addEventListener('pagehide', onBeforeUnload);

    /* ============================================================ v6 — 떠 있는 창 (도구 · 메트로놈 · 송폼 · 타이머)
       · 손잡이(⋮⋮)를 끌어 악보 위 어디든 옮기고, 자리는 이 기기에 기억합니다 (창 크기가 바뀌어도 같은 비율 자리).
       · 위 막대의 ⏱ · 🎼 · 🥁 로 보이기/숨기기. 도구는 ▴ 로 작은 알약으로 접고, 악보의 빈 곳을 톡 치면 접힙니다.
       · 좁은 화면(폰 · 서랍 메뉴)에서는 예전 배치 그대로 (도구는 서랍 · 메트로놈은 빠른 버튼). */
    var mainEl = $('.pv-main'), FL = {};
    var GRIP = '<span class="pv-grip" data-drag aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    function flPos(k) { try { var v = JSON.parse(ls('pos.' + k) || 'null'); if (v && isFinite(v.x) && isFinite(v.y)) return v; } catch (e) {} return null; }
    /** 떠 있는 창이 다닐 수 있는 곳 = 악보 칸 (오른쪽 패널 위로는 가지 않음) */
    function flArea() { return { x: stage.offsetLeft, y: stage.offsetTop, w: Math.max(80, stage.offsetWidth), h: Math.max(80, stage.offsetHeight) }; }
    function flPlace(k) {
      var f = FL[k]; if (!f || !f.node.isConnected) return;
      var n = f.node; if (n.offsetParent === null) return;                            // 숨겨져 있으면 다음에
      var A = flArea(), w = n.offsetWidth, hh = n.offsetHeight;
      var p = flPos(k) || f.def();
      n.style.left = Math.round(A.x + clamp(p.x, 0, 1) * Math.max(0, A.w - w)) + 'px';
      n.style.top = Math.round(A.y + clamp(p.y, 0, 1) * Math.max(0, A.h - hh)) + 'px';
    }
    function flPlaceAll() { Object.keys(FL).forEach(flPlace); placePill(); }
    function makeFloat(k, node, def, opt) {
      opt = opt || {};
      node.classList.add('pv-float', 'pv-fl-' + k);
      if (!node.querySelector('[data-drag]') && !opt.whole) node.insertAdjacentHTML('afterbegin', GRIP);
      if (opt.whole) node.setAttribute('data-drag', '');
      if (!opt.keep && node.parentNode !== mainEl) mainEl.appendChild(node);
      FL[k] = { node: node, def: def };
      var drag = null;
      node.addEventListener('pointerdown', function (e) {
        var g = e.target.closest ? e.target.closest('[data-drag]') : null;
        if (!g || !node.contains(g) || (opt.whole && e.target.closest('button,select,input,a') && e.target.closest('button,select,input,a') !== node)) return;
        if (!opt.whole && e.target.closest('button,select,input,a') && g.contains(e.target.closest('button,select,input,a'))) return;   // V859 — 손잡이 줄 안의 단추(유튜브 창 닫기 · ↗)는 누르기로
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var r = node.getBoundingClientRect(), m = mainEl.getBoundingClientRect();
        drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, mx: m.left, my: m.top, moved: false, x0: e.clientX, y0: e.clientY };
        try { node.setPointerCapture(e.pointerId); } catch (x) {}
        node.classList.add('pv-dragging');
      });
      node.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
        drag.moved = true;
        var A = flArea();
        node.style.left = Math.round(clamp(e.clientX - drag.mx - drag.dx, A.x, A.x + Math.max(0, A.w - node.offsetWidth))) + 'px';
        node.style.top = Math.round(clamp(e.clientY - drag.my - drag.dy, A.y, A.y + Math.max(0, A.h - node.offsetHeight))) + 'px';
        if (k === 'tools') placePill();
      });
      function end(e) {
        if (!drag || e.pointerId !== drag.id) return;
        var moved = drag.moved; drag = null; node.classList.remove('pv-dragging');
        try { node.releasePointerCapture(e.pointerId); } catch (x) {}
        if (!moved) { if (opt.onTap) opt.onTap(e); return; }
        var A = flArea();
        ls('pos.' + k, JSON.stringify({ x: Math.round((parseFloat(node.style.left) - A.x) / Math.max(1, A.w - node.offsetWidth) * 1000) / 1000, y: Math.round((parseFloat(node.style.top) - A.y) / Math.max(1, A.h - node.offsetHeight) * 1000) / 1000 }));
      }
      node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end);
      if (root.ResizeObserver) { try { new root.ResizeObserver(function () { if (!drag) flResize(); }).observe(node); } catch (e) {} }   // 창 크기가 바뀌면(⋯ 펼치기 등) 화면 밖으로 나가지 않게 다시 맞춤
      requestAnimationFrame(function () { flPlace(k); });
      return node;
    }
    /* 접힌 도구 알약(✏️ 도구)은 도크가 있던 자리에 */
    function placePill() {
      if (S.compact || !FL.tools) return;
      var t = FL.tools.node, A = flArea();
      var x = parseFloat(t.style.left), y = parseFloat(t.style.top);
      if (!isFinite(x)) { var p = flPos('tools') || { x: 0.5, y: 0.012 }; x = A.x + p.x * Math.max(0, A.w - 420); y = A.y + p.y * Math.max(0, A.h - 50); }
      toolsBtn.style.left = Math.round(clamp(x, A.x, A.x + Math.max(0, A.w - (toolsBtn.offsetWidth || 110)))) + 'px';
      toolsBtn.style.top = Math.round(clamp(y, A.y, A.y + Math.max(0, A.h - (toolsBtn.offsetHeight || 44)))) + 'px';
    }
    /* 접힌 도구 알약도 끌어서 옮길 수 있습니다 — 짧게 톡 치면 도구가 펴지고, 4px 이상 끌면 이동 (자리는 이 기기에 기억) */
    (function () {
      var d = null;
      toolsBtn.style.touchAction = 'none';
      toolsBtn.addEventListener('pointerdown', function (e) {
        if (S.compact || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
        var r = toolsBtn.getBoundingClientRect(), m = mainEl.getBoundingClientRect();
        d = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, mx: m.left, my: m.top, x0: e.clientX, y0: e.clientY, moved: false };
        try { toolsBtn.setPointerCapture(e.pointerId); } catch (x) {}
      });
      toolsBtn.addEventListener('pointermove', function (e) {
        if (!d || e.pointerId !== d.id) return;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
        d.moved = true; toolsBtn.classList.add('pv-dragging'); e.preventDefault();
        var A = flArea();
        toolsBtn.style.left = Math.round(clamp(e.clientX - d.mx - d.dx, A.x, A.x + Math.max(0, A.w - toolsBtn.offsetWidth))) + 'px';
        toolsBtn.style.top = Math.round(clamp(e.clientY - d.my - d.dy, A.y, A.y + Math.max(0, A.h - toolsBtn.offsetHeight))) + 'px';
        if (FL.tools) { FL.tools.node.style.left = toolsBtn.style.left; FL.tools.node.style.top = toolsBtn.style.top; }     // 도구가 다시 펴질 때 같은 자리에서
      });
      function end(e) {
        if (!d || e.pointerId !== d.id) return;
        var x = d; d = null; toolsBtn.classList.remove('pv-dragging'); try { toolsBtn.releasePointerCapture(e.pointerId); } catch (y) {}
        if (!x.moved) return;
        S.pillMoved = Date.now();                                                         // 뒤따라오는 click 은 "펴기"로 처리하지 않음
        var A = flArea(), w = FL.tools && FL.tools.node.offsetWidth ? FL.tools.node.offsetWidth : toolsBtn.offsetWidth, hh = FL.tools && FL.tools.node.offsetHeight ? FL.tools.node.offsetHeight : toolsBtn.offsetHeight;
        ls('pos.tools', JSON.stringify({ x: Math.round((parseFloat(toolsBtn.style.left) - A.x) / Math.max(1, A.w - w) * 1000) / 1000, y: Math.round((parseFloat(toolsBtn.style.top) - A.y) / Math.max(1, A.h - hh) * 1000) / 1000 }));
      }
      toolsBtn.addEventListener('pointerup', end); toolsBtn.addEventListener('pointercancel', end);
    })();
    /* 보이기 / 숨기기 (위 막대 ⏱ · 🎼 · 🥁) */
    var SHOWS = [['timer', 'timer', '예배 타이머'], ['form', 'form', '송폼 · 곡 정보'], ['metro', 'metronome', '메트로놈']];
    var SHOW_DEF = { timer: false, form: true, metro: false };            // 저장된 값이 없을 때의 기본 (v11) — 타이머 · 메트로놈 창은 꺼짐, 메트로놈은 송폼 창 안의 동그라미(축소형)만
    function showOn(k) { var v = ls('show.' + k); if (v !== null) return v !== '0'; if (S.compact) return k === 'metro'; return SHOW_DEF[k] !== false; }     // V836 — 폰(좁은 화면)은 처음에 메트로놈 창만 떠 있음
    function paintShows() {
      SHOWS.forEach(function (s) {
        var on = showOn(s[0]); el.classList.toggle('pv-hide-' + s[0], !on);
        var b = el.querySelector('.pv-flt[data-k="' + s[0] + '"]'); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.title = s[2] + (on ? ' 숨기기' : ' 보이기'); }
      });
    }
    var fltGrp = doc.createElement('div'); fltGrp.className = 'pv-grp pv-flts'; fltGrp.setAttribute('role', 'group'); fltGrp.setAttribute('aria-label', '떠 있는 창 보이기');
    fltGrp.innerHTML = SHOWS.map(function (s) { return '<button type="button" class="pv-b pv-flt" data-k="' + s[0] + '" aria-pressed="true" aria-label="' + s[2] + '" title="' + s[2] + '">' + I(s[1]) + '</button>'; }).join('');
    $('.pv-top').insertBefore(fltGrp, $('.pv-fsbtn'));
    fltGrp.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.pv-flt') : null; if (!b) return;
      var k = b.getAttribute('data-k'), on = !showOn(k); ls('show.' + k, on ? '1' : '0'); paintShows();
      if (on) requestAnimationFrame(function () { flPlace(k); });
      toast((SHOWS.filter(function (s) { return s[0] === k; })[0] || [])[2] + (on ? ' 보이기' : ' 숨김') + (on ? '' : ' — 위 막대의 같은 단추로 다시 켭니다'), false, 1400);
    });
    /* 송폼 · 곡 정보 창 (악보 본문 대신 떠 있는 카드) */
    var formEl = doc.createElement('div'); formEl.className = 'pv-form'; formEl.setAttribute('aria-live', 'polite');
    /* v7.3 — 송폼 칸을 누르면 그 자리를 보이스로 콜아웃 (V1 → "Verse 1") + 악보 안의 같은 송폼 라벨 깜빡임 (기존 콜아웃 · 깜빡임 그대로 사용) */
    formEl.addEventListener('click', function (e) {
      var sp = e.target && e.target.closest ? e.target.closest('.pv-fb-t[data-i]') : null; if (!sp || S.dead) return;
      var si = +sp.getAttribute('data-s'), ti = +sp.getAttribute('data-i'), toks = formTokens(songs[si]), cue = cueForToken(toks, ti);
      if (si === S.songIdx) { formPosSong = si; formPos = ti; flashForm(ti); }                              // 칸을 직접 눌렀으면 Enter 는 그 다음 칸부터
      if (!cue && toks[ti] && toks[ti].custom && toks[ti].k) cue = toks[ti].k;                              // 직접 입력한 칸은 글자 그대로 음성 안내 (송폼 패널과 같게)
      sp.classList.add('say'); setTimeout(function () { sp.classList.remove('say'); }, 1100);
      if (!cue) { try { an && an.flashTags && an.flashTags([toks[ti] && toks[ti].k], 1800); } catch (x) {} toast('"' + sp.getAttribute('data-k') + '" 은(는) 음성 콜아웃이 없어 악보에서만 깜빡입니다.', false, 1400); return; }
      var r = P.cueKey ? P.cueKey(cue) : null;
      if (!r) { toast('메트로놈 도구를 불러오는 중입니다. 잠시 뒤 다시 눌러 주세요.', true); return; }
    });
    function paintForm() {
      if (S.dead) return;
      var i = S.songIdx, s = i >= 0 ? songs[i] : null;
      // V842 → V844 — 지금 BPM 은 따로 칸(pv-form-bpm)에 넣고 그 자리만 바꿉니다 (BPM 이 바뀔 때마다 송폼 창 전체를 다시 그리면 −/+ 를 누르고 있던 손이 풀린 걸 못 알아채 BPM 이 계속 내려가던 문제)
      var meta = s ? [s.key ? 'Key ' + h(s.key) : '', '<span class="pv-form-bpm"></span>', S.leadBy ? '리드 ' + h(S.leadBy) : ''].filter(Boolean).join(' · ') : '';
      var i2 = spreadOn() ? badgeIdx(S.page + 1) : -1;
      var h2 = i2 >= 0 && i2 !== i ? '<div class="pv-form-2"><b>' + h((songs[i2] || {}).title || '') + '</b>' + formBadgeHtml(i2) + '</div>' : '';
      var html = s ? '<div class="pv-form-h"><b>' + h(s.title || '') + '</b>' + (meta ? '<small>' + meta + '</small>' : '') + '</div>' + (formBadgeHtml(i) || '<span class="pv-form-none">송폼 없음</span>') + h2 : '<span class="pv-form-none">곡을 고르면 송폼이 여기에 보입니다</span>';
      if (formEl.getAttribute('data-h') !== html) {
        formEl.innerHTML = GRIP + '<div class="pv-form-b">' + html + '</div><span class="pv-rsz" aria-hidden="true" title="끌어서 크기 조절 (두 번 누르면 처음 크기)"></span>'; formEl.setAttribute('data-h', html);
        if (S.formCur && S.formCur.s === i) { var cn = formEl.querySelector('.pv-fb-t[data-i="' + S.formCur.i + '"]'); if (cn) cn.classList.add('cur'); }
        paintLeadPos();
        if (mcApi) formEl.insertBefore(mcApi.el, formEl.children[1]);                                  // v6.1 — 메트로놈 동그라미
        if (fsApi) { var fh = formEl.querySelector('.pv-form-h'); if (fh) fh.parentNode.insertBefore(fsApi.el, fh.nextSibling); else if (fsApi.el.parentNode) fsApi.el.parentNode.removeChild(fsApi.el); fsApi.sync(); }
        requestAnimationFrame(function () { flPlace('form'); });
      }
      paintBpm();
    }
    /* 메트로놈 창 — 라이브 컨트롤(▶ · BPM · 콜아웃)을 도구 도크에서 떼어 따로 띄웁니다 */
    /* v6.1 — 송폼 창 크기 조절: 오른쪽 아래 모서리를 끌면 옆으로 = 폭(두 줄 → 한 줄), 위아래로 = 글자 크기. 이 기기에 기억 */
    var mcApi = null, fsApi = null;
    function formSize() { try { var v = JSON.parse(ls('size.form') || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
    function applyFormSize() {
      var v = formSize();
      formEl.style.width = v && v.w ? Math.round(v.w) + 'px' : ''; formEl.style.maxWidth = v && v.w ? 'none' : '';
      formEl.style.setProperty('--pvfs', v && v.s ? String(v.s) : (opts.readOnly ? '1.5' : '1'));      // 방송팀 보기는 송폼을 처음부터 크게
    }
    (function () {
      var rs = null;
      formEl.addEventListener('pointerdown', function (e) {
        if (!e.target.closest || !e.target.closest('.pv-rsz')) return;
        e.preventDefault(); e.stopPropagation();
        var r = formEl.getBoundingClientRect(), v = formSize() || {};
        rs = { id: e.pointerId, x0: e.clientX, y0: e.clientY, w0: r.width, s0: +v.s || 1 };
        try { formEl.setPointerCapture(e.pointerId); } catch (x) {}
        formEl.classList.add('pv-resizing');
      });
      formEl.addEventListener('pointermove', function (e) {
        if (!rs || e.pointerId !== rs.id) return;
        var A = flArea(), w = clamp(rs.w0 + (e.clientX - rs.x0), 190, Math.max(220, A.w - 8)), s = Math.round(clamp(rs.s0 * (1 + (e.clientY - rs.y0) / 260), 0.8, 1.8) * 100) / 100;
        rs.w = w; rs.s = s; formEl.style.width = Math.round(w) + 'px'; formEl.style.maxWidth = 'none'; formEl.style.setProperty('--pvfs', String(s));
      });
      function end(e) {
        if (!rs || e.pointerId !== rs.id) return;
        var x = rs; rs = null; formEl.classList.remove('pv-resizing'); try { formEl.releasePointerCapture(e.pointerId); } catch (y) {}
        if (x.w) { ls('size.form', JSON.stringify({ w: Math.round(x.w), s: x.s || x.s0 })); flResize(); }
      }
      formEl.addEventListener('pointerup', end); formEl.addEventListener('pointercancel', end);
      formEl.addEventListener('dblclick', function (e) { if (e.target.closest && e.target.closest('.pv-rsz')) { ls('size.form', ''); applyFormSize(); flResize(); } });
    })();
    /* v6.4 — 필기 도구 창 폭 조절: 오른쪽 가장자리의 손잡이를 끌어 폭을 바꿉니다. 폭이 모자라면 도구가 다음 줄로 내려옵니다(옆으로 잘리지 않음). 이 기기에 기억 */
    function toolsSize() { try { var v = JSON.parse(ls('size.tools') || 'null'); return v && +v.w > 0 ? v : null; } catch (e) { return null; } }
    function applyToolsSize() { var v = toolsSize(); toolsEl.style.width = v ? Math.round(v.w) + 'px' : ''; toolsEl.style.maxWidth = v ? 'none' : ''; }
    function addToolsRsz(host) { if (host && !host.querySelector(':scope > .pv-rszw')) { var r = doc.createElement('span'); r.className = 'pv-rszw'; r.setAttribute('aria-hidden', 'true'); r.title = '끌어서 폭 조절 (두 번 누르면 처음 폭)'; host.appendChild(r); } }
    (function () {
      var rs = null;
      toolsEl.addEventListener('pointerdown', function (e) {
        if (!e.target.closest || !e.target.closest('.pv-rszw')) return;
        e.preventDefault(); e.stopPropagation();
        rs = { id: e.pointerId, x0: e.clientX, w0: toolsEl.getBoundingClientRect().width };
        try { toolsEl.setPointerCapture(e.pointerId); } catch (x) {} toolsEl.classList.add('pv-resizing');
      });
      toolsEl.addEventListener('pointermove', function (e) {
        if (!rs || e.pointerId !== rs.id) return;
        var A = flArea(), w = clamp(rs.w0 + (e.clientX - rs.x0), 200, Math.max(220, A.w - 8)); rs.w = w; toolsEl.style.width = Math.round(w) + 'px'; toolsEl.style.maxWidth = 'none';
      });
      function end(e) {
        if (!rs || e.pointerId !== rs.id) return; var x = rs; rs = null; toolsEl.classList.remove('pv-resizing'); try { toolsEl.releasePointerCapture(e.pointerId); } catch (y) {}
        if (x.w) { ls('size.tools', JSON.stringify({ w: Math.round(x.w) })); flResize(); }
      }
      toolsEl.addEventListener('pointerup', end); toolsEl.addEventListener('pointercancel', end);
      toolsEl.addEventListener('dblclick', function (e) { if (e.target.closest && e.target.closest('.pv-rszw')) { ls('size.tools', ''); applyToolsSize(); flResize(); } });
    })();
    var metroEl = doc.createElement('div'); metroEl.className = 'pv-metro'; metroEl.setAttribute('role', 'group'); metroEl.setAttribute('aria-label', '메트로놈');
    /* V838 — 메트로놈 창을 콜아웃까지 펼쳤을 때 크기 조절: 오른쪽 아래 손잡이를 끌면 너비(과 버튼 크기) · 콜아웃 칸 높이가 바뀝니다.
       이 기기에 기억하고, 두 번 누르면 처음 크기로. 접힌 상태(▶ · BPM · − +)의 크기는 그대로입니다. */
    function metroSize() { try { var v = JSON.parse(ls('size.metro') || 'null'); return v && +v.w > 0 ? v : null; } catch (e) { return null; } }
    function applyMetroSize() {
      var v = metroSize(); metroEl.classList.toggle('pv-msized', !!v);
      if (v) { metroEl.style.setProperty('--mw', Math.round(v.w) + 'px'); metroEl.style.setProperty('--mh', Math.round(v.h || 320) + 'px'); metroEl.style.setProperty('--ms', String(v.s || 1)); }
      else { metroEl.style.removeProperty('--mw'); metroEl.style.removeProperty('--mh'); metroEl.style.removeProperty('--ms'); }
    }
    (function () {
      var h = doc.createElement('span'); h.className = 'pv-rsz pv-mrsz'; h.setAttribute('aria-hidden', 'true'); h.title = '끌어서 크기 조절 (두 번 누르면 처음 크기)'; metroEl.appendChild(h);
      var rs = null;
      var lastDown = 0;
      metroEl.addEventListener('pointerdown', function (e) {
        if (!e.target.closest || !e.target.closest('.pv-mrsz')) return;
        e.preventDefault(); e.stopPropagation();
        var now = Date.now(); if (now - lastDown < 380) { lastDown = 0; ls('size.metro', ''); applyMetroSize(); flResize(); return; }      // 두 번 톡 = 처음 크기로
        lastDown = now;
        var cues = metroEl.querySelector('.pv-lv-cues'), v = metroSize() || {};
        rs = { id: e.pointerId, x0: e.clientX, y0: e.clientY, w0: metroEl.getBoundingClientRect().width, h0: cues ? cues.getBoundingClientRect().height : 300, w: 0 };
        try { metroEl.setPointerCapture(e.pointerId); } catch (x) {}
        metroEl.classList.add('pv-resizing');
      });
      metroEl.addEventListener('pointermove', function (e) {
        if (!rs || e.pointerId !== rs.id) return;
        var A = flArea(), w = clamp(rs.w0 + (e.clientX - rs.x0), 250, Math.max(260, A.w - 8)), hh = clamp(rs.h0 + (e.clientY - rs.y0), 90, Math.max(120, Math.round(A.h * 0.85))), sc = Math.round(clamp(w / 460, 0.85, 1.5) * 100) / 100;
        rs.w = w; rs.h = hh; rs.s = sc;
        metroEl.classList.add('pv-msized'); metroEl.style.setProperty('--mw', Math.round(w) + 'px'); metroEl.style.setProperty('--mh', Math.round(hh) + 'px'); metroEl.style.setProperty('--ms', String(sc));
      });
      function end(e) {
        if (!rs || e.pointerId !== rs.id) return;
        var x = rs; rs = null; metroEl.classList.remove('pv-resizing'); try { metroEl.releasePointerCapture(e.pointerId); } catch (y) {}
        if (x.w) { ls('size.metro', JSON.stringify({ w: Math.round(x.w), h: Math.round(x.h), s: x.s })); flResize(); }
      }
      metroEl.addEventListener('pointerup', end); metroEl.addEventListener('pointercancel', end);
      applyMetroSize();
    })();
    function setupFloats() {
      makeFloat('tools', toolsEl, function () { return { x: 0.5, y: 0.012 }; }, { keep: true });
      makeFloat('metro', metroEl, function () { return { x: 0.02, y: 0.985 }; });
      makeFloat('form', formEl, function () { return S.compact ? { x: 0.98, y: 0.86 } : S.narrow ? { x: 0.985, y: 0.075 } : { x: 0.985, y: 0.1 }; });
      if (timerBar && timerBar.el) {
        makeFloat('timer', timerBar.el, function () { return S.compact ? { x: 0.02, y: 0.985 } : { x: 0.985, y: 0.985 }; });
        try { if (S.compact && timerBar.miniSaved() === null) timerBar.setMini(true, false); } catch (e) {}     // 좁은 화면은 처음에 작게 (예배 경과만)
      }
      P.on('toolsrender', function (host) { if (host && !host.querySelector(':scope > .pv-grip')) host.insertAdjacentHTML('afterbegin', GRIP); addToolsRsz(host); });
      addToolsRsz(toolsEl); applyToolsSize();
      if (!toolsEl.querySelector(':scope > .pv-grip')) toolsEl.insertAdjacentHTML('afterbegin', GRIP);
      P.floatWin = function (k, node, def) { return makeFloat(k, node, def); };            // v6.1 — 패널이 만드는 떠 있는 창 (시작음 피아노)
      P.floatPlace = function (k) { requestAnimationFrame(function () { flPlace(k); }); };
      try { if (P.metroCircle) mcApi = P.metroCircle(); } catch (e) { mcApi = null; }
      try { if (P.beatStrip) fsApi = P.beatStrip('form'); } catch (e) { fsApi = null; }      // V848 — 송폼 창: 저장 · 박 흐름 · 1234 · 1박 · ×2 · 숫자로 · 3·2·1
      applyFormSize(); paintShows(); paintForm();
      P.on('song', paintForm); P.on('page', paintForm); P.on('sheet', paintForm); P.on('songedit', paintForm); P.on('songs', paintForm);   // V838 — 송폼을 고치면 떠 있는 송폼 창도 바로 바뀜
      root.addEventListener('resize', flResize);
      if (root.ResizeObserver) { flRo = new root.ResizeObserver(flResize); flRo.observe(mainEl); }
    }
    var flRt = 0, flRo = null;
    function flResize() { if (flRt) return; flRt = requestAnimationFrame(function () { flRt = 0; if (!S.dead) flPlaceAll(); }); }
    P.on('close', function () { root.removeEventListener('resize', flResize); if (flRo) flRo.disconnect(); });
    /* 악보의 빈 곳을 톡 → 도구 접기 (이동 · 선택 모드에서) · 펜슬 전용 모드에서 손가락 톡 → 선택·이동 */
    var tapD = null;
    /* v6.10 — 애플 펜슬로 악보에 그냥 쓰면 바로 펜으로 그려집니다 (도구를 열어 펜을 고르지 않아도).
       "이동"(손바닥) 도구일 때만 — 선택 · 글자 · 코드 등 일부러 고른 도구는 그대로 둡니다. 도구가 접혀 있어도 되고, 첫 획부터 이어서 그려집니다. */
    stage.addEventListener('pointerdown', function (e) {
      if (S.dead || opts.readOnly || e.pointerType !== 'pen' || S.tool !== 'none' || !e.isPrimary) return;
      if (e.target.closest && e.target.closest('.pv-float,.an-editor,.pv-sympop,.pv-toolsbtn,button,select,input,a,textarea')) return;
      if (e.pointerType === 'pen' && e.button > 0 && e.button !== 5) return;
      setTool('pen', false, true);
      if (an.beginExternal) an.beginExternal(e);
      if (!S.penAutoHint) { S.penAutoHint = true; toast('✏️ 펜슬로 바로 쓰면 펜으로 그려져요 — 손가락으로 화면을 옮기려면 도구에서 “이동”을 고르세요', false, 3400); }
    }, true);
    stage.addEventListener('pointerdown', function (e) {
      tapD = (e.isPrimary && !(e.target.closest && e.target.closest('.pv-float,.an-editor,.pv-sympop,.pv-toolsbtn,button,select,input'))) ? { x: e.clientX, y: e.clientY, t: Date.now(), sel: !!(an.selected && an.selected()), tool: S.tool, type: e.pointerType, id: e.pointerId } : null;
    }, true);
    stage.addEventListener('pointerup', function (e) {
      var d = tapD; tapD = null;
      if (!d || e.pointerId !== d.id || S.dead) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || Date.now() - d.t > 400) return;
      /* V849 — 이동 도구로 악보의 코드 글자를 톡 → 피아노로 그 코드 (화음 탭에서 분석해 둔 페이지) */
      if (d.tool === 'none' && S.tool === 'none') { try { var hz = P.ensureTab ? P.ensureTab('harmony') : null; if (hz && hz.chordTap && hz.chordTap(e.clientX, e.clientY, d.type !== 'mouse')) return; } catch (x) { /* 화음 도구가 없어도 화면은 계속 */ } }
      /* V848 — 이동 도구로 필기를 톡 → 누가 썼는지 잠깐 (이름표) */
      if (d.tool === 'none' && S.tool === 'none' && an && an.peekAt && an.peekAt(e.clientX, e.clientY, d.type === 'touch')) return;
      /* v6.9 — 악보의 아무 곳이나 톡 치면 열려 있던 메뉴(🛠 서랍 · ⋯ 더보기 · 태블릿의 옆 패널: 필기 · 송폼 · 메트로놈 …)가 다시 숨겨집니다 */
      var closed = false;
      if (S.compact && el.classList.contains('pv-drawopen')) { setDrawer(false); closed = true; }
      if (el.classList.contains('pv-moreopen')) { setMore(false); closed = true; }
      if (!S.fs && !S.compact && S.layout !== 'computer' && el.classList.contains('pv-sideopen')) { toggleSide(false); closed = true; }
      if (S.fs || S.compact || closed) return;
      /* v6.9 — 예전에는 펜슬 전용 모드에서 손가락으로 톡 치면 어떤 도구든 "선택·이동"으로 바뀌어, 글자 · 코드를 놓을 수 없고 펜 · 형광펜도 풀렸습니다.
         이제 펜 · 형광펜은 도구를 그대로 유지하고(손가락은 화면 이동에만), 글자 · 코드 · 기호 · 송폼은 톡 치면 그 자리에 만들어집니다 (anno.js). */
      /* v6.10 — 펜슬 전용 모드(이 기기에서 펜슬을 쓴 적이 있음)에서는 펜 · 형광펜 · 지우개 도구인 채로 악보 아무 곳이나 손가락으로 톡 쳐도 도구가 접힙니다 ("이동" 도구로 바꾸지 않아도) */
      if (d.type === 'touch' && (d.tool === 'pen' || d.tool === 'hl' || d.tool === 'eraser') && an.fingerDraws && !an.fingerDraws() && S.tool === d.tool && !penNear()) {
        if (S.dockMore) { setDockMore(false, true); return; }
        if (!el.classList.contains('pv-toolshide')) { setTools(false, false); return; }
        if (!S.penHint) { S.penHint = true; toast('✏️ 펜슬 전용 모드예요 — 손가락으로도 쓰려면 ⚙ 설정 › 펜 입력 › “손가락도 그림”', false, 3200); }
      }
      if ((d.tool === 'none' || d.tool === 'select') && S.tool === d.tool && !d.sel && !(an.selected && an.selected())) {
        if (S.dockMore) setDockMore(false, true);
        else if (!el.classList.contains('pv-toolshide')) { setTools(false, false); }
      }
    });

    /* ------------------------------------------------------------ 시작 · 닫기 */
    var api = {
      el: el, P: P, goPage: function (n) { goPage(n, true); }, loadSheet: function (i, pg) { return loadSheet(i, pg, true); },
      close: function () {
        if (S.dead) return; S.dead = true; if (S.fs) setFs(false); closeYt(); flushMine(); P.emit('close');
        try { an.closeEditor(); } catch (e) {}
        P.tabs.forEach(function (t) { try { t.api && t.api.destroy && t.api.destroy(); } catch (e) {} });
        try { rt && rt.close(); } catch (e) {} try { an.destroy(); } catch (e) {}
        try { timerBar && timerBar.destroy(); } catch (e) {}
        doc.removeEventListener('pointerdown', rtOutside, true); doc.removeEventListener('keydown', onKey); doc.removeEventListener('keyup', onKeyUp); doc.removeEventListener('copy', onCopy); doc.removeEventListener('paste', onPaste); root.removeEventListener('pagehide', onBeforeUnload);
        doc.removeEventListener('pointerup', holdStop); root.removeEventListener('orientationchange', onOrient); doc.removeEventListener('fullscreenchange', onFsChange); clearTimeout(S.fsT);
        if (ro) ro.disconnect(); root.removeEventListener('resize', onResize);
        /* 남아 있는 예약(타이머) · 반복 · 그림 저장소를 모두 정리 — 화면을 여닫아도 메모리가 쌓이지 않게 (내 필기 저장 재시도 S.mineT 만 남겨 둡니다) */
        [rz, orT, wz.t, S.rsT, S.navT, S.preT, S.msgT, S.toolT, refetchT, scT].forEach(function (t) { if (t) clearTimeout(t); });
        holdStop(); if (pvRaf && root.cancelAnimationFrame) { try { root.cancelAnimationFrame(pvRaf); } catch (e) {} pvRaf = 0; }
        if (S.task) { try { S.task.cancel(); } catch (e) {} S.task = null; }
        pcClear(); S.pending = null;
        try { wakeCtl && wakeCtl.destroy(); } catch (e) {}
        Object.keys(S.cache).forEach(function (k) { try { S.cache[k].pdf && S.cache[k].pdf.destroy(); } catch (e) {} });
        el.remove(); doc.body.classList.remove('pv-lock'); current = null;
        try { opts.onClose && opts.onClose(); } catch (e) {}
      }
    };
    current = api;
    S.layer = ls('layer') === 'mine' ? 'mine' : 'team'; S.layerUser = !!ls('layer'); S.scope = ls('scope') === 'date' && S.room ? 'date' : 'song'; an.setLayer(S.layer); if (an.setFont) an.setFont(S.font); if (an.setFboxTag) an.setFboxTag(S.fboxTag);
    setCompact(calcCompact()); setNarrow(); autoFit(); applyLayout(S.layout, false); renderTools(); buildTabs(); connect(); loadCfg(); requestWake();
    try { if (root.YNLiveMsg) root.YNLiveMsg.attach(P); } catch (e) { if (root.console) root.console.warn('[livemsg]', e); }   // 요청 메시지 — 방송팀에 보내기 · 받은 메시지 띄우기
    /* 예배 타이머 막대 (Feature 1 · timer.js) — 헤더 바로 아래에 붙어 전체 화면에서도 보입니다. timer.js 가 없거나 opts.timer === false 면 아무것도 하지 않음 */
    var timerBar = null;
    try {
      if (root.YNTimer && opts.timer !== false && S.room) {
        timerBar = root.YNTimer.mountViewer(el, { token: opts.token, room: S.room, io: opts.io, getPlan: function () { return { room: S.room, songs: songs.map(function (x) { return { t: x.title }; }) }; } });
      }
    } catch (e) { /* 타이머 막대가 없어도 세션 화면은 그대로 */ }
    try { setupFloats(); } catch (e) { /* 떠 있는 창을 못 만들어도 악보 · 필기는 그대로 */ }
    var g0 = typeof opts.song === 'number' ? opts.song : guessSong(sheets[S.sheetIdx].name, songs); if (g0 >= 0) setSong(g0, true);
    loadSheet(S.sheetIdx, Math.max(1, opts.startPage | 0) || 1, false);   // 라이브러리에서 곡별로 나눈 악보를 열면 그 곡 첫 쪽부터
    if (S.layout === 'computer' && ls('side') === '1' && P.tabs.length) showTab(P.tabs[0].id);
    return api;
  }

  root.YNPractice = { warm: warm, prescale: prescale, IMG_MAX: IMG_MAX, open: open, current: function () { return current; }, close: function () { if (current) current.close(); }, isOpen: function () { return !!current; }, guessSong: guessSong, cueIdFor: cueIdFor, detectLayout: detectLayout, CUE_MAP: CUE_MAP };
}(typeof self !== 'undefined' ? self : this));
