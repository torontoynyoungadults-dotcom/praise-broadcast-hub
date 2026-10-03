/**
 * 악보 필기 엔진 — PDF 위에 펜 · 형광펜 · 글자/코드 · 음악 기호를 얹고, 팀과 실시간으로 나눕니다
 * ------------------------------------------------------------
 *  · 모든 좌표는 "쪽 크기에 대한 비율(0~1)"로 저장 → 화면 크기 · 확대 · 다른 기기에서도 같은 자리에 그려짐
 *  · 필기 항목 형식은 서버(lib/realtime.js cleanItem)와 같습니다 — { id, t:'pen'|'hl'|'text'|'sym', pg, c, w, p[], x, y, sz, s, chord, k, w2 … }
 *  · 층(layer): 'team' = 모두에게 보임(실시간 공유) / 'mine' = 나만 보임
 *  · 이 파일은 (1) 순수 함수(좌표 · 판정 · 기호 그리기) (2) create() 엔진(포인터 입력 · 되돌리기 · 그리기)으로 되어 있습니다
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNAnno = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 펜 · 글자 · 코드 · 기호 색: 빨강 · 파랑 · 초록 · 보라 · 검정 · 흰색(흰색은 틀린 곳을 덮는 "수정액"). 예전에 쓴 다른 색(주황 등)의 필기도 그대로 그려집니다 */
  var PALETTE = ['#e53935', '#2563eb', '#16a34a', '#7c3aed', '#111111', '#ffffff'];
  var COLOR_NAMES = { '#e53935': '빨강', '#2563eb': '파랑', '#16a34a': '초록', '#7c3aed': '보라', '#111111': '검정', '#ffffff': '흰색 (수정액)' };
  var HL_COLORS = ['#ffe14d', '#7dff8a', '#ff9ad5', '#7fd4ff', '#ffb066'];
  var STRETCH = { tie: 1, cresc: 1, decresc: 1 };
  /** 송폼 라벨 글자 — 서버(lib/realtime.js FBOX_TAG_RE)는 이 글자들과 같은 모양(영문 · 숫자 · 한글 8자 이내)만 받습니다. Int=인트로 V=절 P=프리코러스 C=후렴 B=브릿지 */
  var FBOX_TAGS = ['Int', 'V', 'V1', 'V2', 'V3', 'P', 'C', 'C2', 'B', 'Inst', 'Itld', 'Solo', 'Tag', 'Turn', 'Out', 'Coda', 'End'];
  var FBOX_NAMES = { Int: '인트로', V: '절', V1: '1절', V2: '2절', V3: '3절', P: '프리코러스', C: '후렴', C2: '후렴 2', B: '브릿지', Inst: '연주', Itld: '간주', Solo: '솔로', Tag: '태그', Turn: '턴어라운드', Out: '아웃트로', Coda: '코다', End: '끝' };
  /** 글꼴 — 글자 · 코드 · 글자 모양 기호(음표 도장 · 다이내믹)에 씁니다. 서버는 이 키(sans · serif · hand)만 받습니다 */
  var FONT_KEYS = ['sans', 'serif', 'hand', 'pen', 'dodum'];
  var FONT_NAMES = { sans: '고딕 (Sans-serif)', serif: '명조 (Serif)', hand: '손글씨 (기기 글꼴)', pen: '나눔 펜 손글씨', dodum: '고운돋움 (손글씨체)' };
  /** 한글 손글씨 웹폰트 (구글 폰트) — 화면 글자 · 코드에 고를 수 있고, 못 받으면 아래 대체 글꼴로 보입니다 */
  var WEBFONT_URL = 'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&family=Gowun+Dodum&display=swap';
  var WEBFONT_FACES = ['Nanum Pen Script', 'Gowun Dodum'];
  var FONTS = {
    pen: '"Nanum Pen Script","Segoe Print","Bradley Hand","Noteworthy","Apple SD Gothic Neo",cursive',
    dodum: '"Gowun Dodum","Nanum Gothic","Apple SD Gothic Neo","Malgun Gothic",sans-serif',
    sans: '"Segoe UI","Apple SD Gothic Neo","Malgun Gothic",Arial,sans-serif',
    serif: '"Times New Roman","Noto Serif KR","Apple Myungjo","Batang",Georgia,serif',
    hand: '"Segoe Print","Bradley Hand","Noteworthy","Nanum Pen Script","Comic Sans MS","Apple SD Gothic Neo",cursive'
  };
  var GLYPH_FALLBACK = ',"Segoe UI Symbol","Apple Symbols","Noto Music","DejaVu Sans"';
  var GLYPHS = { quarter: '\u2669', eighth: '\u266a', sharp: '\u266f', flat: '\u266d' };     // ♩ ♪ ♯ ♭
  /** 웹폰트를 한 번만 불러오고, 다 받으면 바로 다시 그리도록 알려 줍니다 (캔버스는 글꼴이 늦게 오면 예전 모양 그대로라서) */
  var _fontsAsked = false;
  function ensureWebFonts(done) {
    if (typeof document === 'undefined') return;
    try {
      if (!_fontsAsked) {
        _fontsAsked = true;
        if (!document.getElementById('yn-anno-fonts')) {
          var pc = document.createElement('link'); pc.rel = 'preconnect'; pc.href = 'https://fonts.gstatic.com'; pc.crossOrigin = 'anonymous'; document.head.appendChild(pc);
          var lk = document.createElement('link'); lk.id = 'yn-anno-fonts'; lk.rel = 'stylesheet'; lk.href = WEBFONT_URL; document.head.appendChild(lk);
          lk.onload = function () { if (done) done(); };
        }
      }
      if (document.fonts && document.fonts.load) {
        Promise.all(WEBFONT_FACES.map(function (f) { return document.fonts.load('24px "' + f + '"', '\uAC00\uB098\uB2E4'); })).then(function () { if (done) done(); }, function () {});
      }
    } catch (e) { /* 글꼴을 못 받아도 대체 글꼴로 계속 동작 */ }
  }
  function textLike(k) { return k.indexOf('dyn:') === 0 || k.indexOf('g:') === 0; }
  function fontOf(it) { return FONTS[it && it.f] ? it.f : 'sans'; }

  /** 기호 목록 (서버 SYMBOLS 와 동일해야 함 — 시험에서 비교) */
  var SYMBOLS = [
    { k: 'sharp', n: '샵 ♯' }, { k: 'flat', n: '플랫 ♭' }, { k: 'natural', n: '제자리 ♮' }, { k: 'fermata', n: '늘임표' },
    { k: 'segno', n: '세뇨' }, { k: 'coda', n: '코다' }, { k: 'repeatStart', n: '도돌이 시작' }, { k: 'repeatEnd', n: '도돌이 끝' },
    { k: 'breath', n: '숨표' }, { k: 'cresc', n: '크레센도' }, { k: 'decresc', n: '데크레센도' }, { k: 'accent', n: '악센트' },
    { k: 'staccato', n: '스타카토' }, { k: 'tenuto', n: '테누토' }, { k: 'tie', n: '이음줄' }, { k: 'arrowDown', n: '↓ 화살표' },
    { k: 'arrowUp', n: '↑ 화살표' }, { k: 'star', n: '별' }, { k: 'check', n: '체크' }, { k: 'circle', n: '동그라미' }, { k: 'box', n: '네모' },
    { k: 'dyn:pp', n: 'pp' }, { k: 'dyn:p', n: 'p' }, { k: 'dyn:mp', n: 'mp' }, { k: 'dyn:mf', n: 'mf' }, { k: 'dyn:f', n: 'f' }, { k: 'dyn:ff', n: 'ff' },
    { k: 'dyn:dc', n: 'D.C.' }, { k: 'dyn:ds', n: 'D.S.' }, { k: 'dyn:tocoda', n: 'To Coda' }, { k: 'dyn:fine', n: 'Fine' },
    { k: 'g:quarter', n: '♩ 4분음표' }, { k: 'g:eighth', n: '♪ 8분음표' }, { k: 'g:sharp', n: '♯ 샵 (글자)' }, { k: 'g:flat', n: '♭ 플랫 (글자)' }
  ];
  var DYN_TEXT = { pp: 'pp', p: 'p', mp: 'mp', mf: 'mf', f: 'f', ff: 'ff', dc: 'D.C.', ds: 'D.S.', tocoda: 'To Coda', fine: 'Fine' };

  var _seq = 0;
  function newId() {
    var r = ''; for (var i = 0; i < 5; i++) r += Math.floor(Math.random() * 36).toString(36);
    return 'a' + Date.now().toString(36) + (++_seq).toString(36) + r;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function doc0() { return typeof document !== 'undefined' ? document : { activeElement: null }; }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  /** 0~1 좌표 점들이 아주 좁은 곳에 모여 있나 (톡 친 것인가) */
  function tinyPath(p) { if (!p || p.length < 2) return true; var x0 = p[0], x1 = p[0], y0 = p[1], y1 = p[1]; for (var i = 2; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } return (x1 - x0) < 0.012 && (y1 - y0) < 0.012; }

  /** 점 줄이기 (Douglas–Peucker) — 손떨림 · 불필요한 점을 없애 전송량과 저장량을 줄입니다. p = [x,y,x,y…] (0~1), eps = 비율 */
  function simplify(p, eps) {
    var n = p.length / 2; if (n <= 2) return p.slice();
    var keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1], ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1], dmax = 0, idx = -1;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      for (var i = a + 1; i < b; i++) {
        var px = p[i * 2], py = p[i * 2 + 1], d;
        if (len2 === 0) d = Math.hypot(px - ax, py - ay);
        else { var t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1); d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    var out = []; for (var j = 0; j < n; j++) if (keep[j]) out.push(r4(p[j * 2]), r4(p[j * 2 + 1]));
    return out;
  }
  /** 점이 maxPts 개를 넘으면 eps 를 키워가며 줄입니다 */
  function limitPoints(p, maxPts) {
    var eps = 0.0003, out = simplify(p, eps), guard = 0;
    while (out.length / 2 > maxPts && guard++ < 20) { eps *= 1.6; out = simplify(p, eps); }
    return out;
  }

  /* ------------------------------------------------------------ 기호 그리기 (중심 (0,0), s = 기호 크기(px)) */
  function ln(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  var SYM = {
    sharp: function (c, s) { c.lineWidth = Math.max(1.4, s * 0.06); ln(c, -.17 * s, -.5 * s, -.17 * s, .44 * s); ln(c, .17 * s, -.44 * s, .17 * s, .5 * s); c.lineWidth = Math.max(2.2, s * 0.13); ln(c, -.38 * s, .12 * s, .38 * s, -.04 * s); ln(c, -.38 * s, .34 * s, .38 * s, .18 * s); },
    flat: function (c, s) { c.lineWidth = Math.max(1.5, s * 0.07); ln(c, -.15 * s, -.55 * s, -.15 * s, .42 * s); c.beginPath(); c.moveTo(-.15 * s, .42 * s); c.bezierCurveTo(.5 * s, .2 * s, .5 * s, -.28 * s, -.15 * s, -.06 * s); c.stroke(); },
    natural: function (c, s) { c.lineWidth = Math.max(1.4, s * 0.06); ln(c, -.16 * s, -.5 * s, -.16 * s, .22 * s); ln(c, .16 * s, -.22 * s, .16 * s, .5 * s); c.lineWidth = Math.max(2.2, s * 0.12); ln(c, -.16 * s, .12 * s, .16 * s, .05 * s); ln(c, -.16 * s, -.06 * s, .16 * s, -.13 * s); },
    fermata: function (c, s) { c.lineWidth = Math.max(1.6, s * 0.08); c.beginPath(); c.arc(0, .2 * s, .42 * s, Math.PI, 0); c.stroke(); c.beginPath(); c.arc(0, .1 * s, .07 * s, 0, 7); c.fill(); },
    segno: function (c, s) { c.lineWidth = Math.max(1.6, s * 0.08); c.beginPath(); c.moveTo(.25 * s, -.3 * s); c.bezierCurveTo(-.3 * s, -.6 * s, -.4 * s, -.05 * s, 0, 0); c.bezierCurveTo(.4 * s, .05 * s, .3 * s, .6 * s, -.25 * s, .3 * s); c.stroke(); ln(c, -.32 * s, .42 * s, .32 * s, -.42 * s); c.beginPath(); c.arc(-.3 * s, -.04 * s, .05 * s, 0, 7); c.arc(.3 * s, .04 * s, .05 * s, 0, 7); c.fill(); },
    coda: function (c, s) { c.lineWidth = Math.max(1.6, s * 0.07); c.beginPath(); c.arc(0, 0, .3 * s, 0, 7); c.stroke(); ln(c, 0, -.5 * s, 0, .5 * s); ln(c, -.5 * s, 0, .5 * s, 0); },
    repeatStart: function (c, s) { c.fillRect(-.32 * s, -.5 * s, .12 * s, s); c.lineWidth = Math.max(1.2, s * 0.04); ln(c, -.1 * s, -.5 * s, -.1 * s, .5 * s); c.beginPath(); c.arc(.12 * s, -.14 * s, .055 * s, 0, 7); c.arc(.12 * s, .14 * s, .055 * s, 0, 7); c.fill(); },
    repeatEnd: function (c, s) { c.fillRect(.2 * s, -.5 * s, .12 * s, s); c.lineWidth = Math.max(1.2, s * 0.04); ln(c, .1 * s, -.5 * s, .1 * s, .5 * s); c.beginPath(); c.arc(-.12 * s, -.14 * s, .055 * s, 0, 7); c.arc(-.12 * s, .14 * s, .055 * s, 0, 7); c.fill(); },
    breath: function (c, s) { c.lineWidth = Math.max(2, s * 0.1); c.lineCap = 'round'; c.beginPath(); c.moveTo(-.05 * s, -.3 * s); c.quadraticCurveTo(.3 * s, -.25 * s, 0, .3 * s); c.stroke(); },
    cresc: function (c, s, len) { c.lineWidth = Math.max(1.6, s * 0.07); c.beginPath(); c.moveTo(len, -.22 * s); c.lineTo(0, 0); c.lineTo(len, .22 * s); c.stroke(); },
    decresc: function (c, s, len) { c.lineWidth = Math.max(1.6, s * 0.07); c.beginPath(); c.moveTo(0, -.22 * s); c.lineTo(len, 0); c.lineTo(0, .22 * s); c.stroke(); },
    accent: function (c, s) { c.lineWidth = Math.max(1.8, s * 0.09); c.beginPath(); c.moveTo(-.38 * s, -.24 * s); c.lineTo(.38 * s, 0); c.lineTo(-.38 * s, .24 * s); c.stroke(); },
    staccato: function (c, s) { c.beginPath(); c.arc(0, 0, Math.max(2, .11 * s), 0, 7); c.fill(); },
    tenuto: function (c, s) { c.lineWidth = Math.max(2, s * 0.1); ln(c, -.38 * s, 0, .38 * s, 0); },
    tie: function (c, s, len) { c.lineWidth = Math.max(1.6, s * 0.07); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len / 2, s * .55, len, 0); c.stroke(); },
    arrowDown: function (c, s) { c.lineWidth = Math.max(1.8, s * 0.08); ln(c, 0, -.5 * s, 0, .5 * s); c.beginPath(); c.moveTo(-.25 * s, .22 * s); c.lineTo(0, .5 * s); c.lineTo(.25 * s, .22 * s); c.stroke(); },
    arrowUp: function (c, s) { c.lineWidth = Math.max(1.8, s * 0.08); ln(c, 0, -.5 * s, 0, .5 * s); c.beginPath(); c.moveTo(-.25 * s, -.22 * s); c.lineTo(0, -.5 * s); c.lineTo(.25 * s, -.22 * s); c.stroke(); },
    star: function (c, s) { c.beginPath(); for (var i = 0; i < 10; i++) { var r = i % 2 ? .22 * s : .5 * s, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); },
    check: function (c, s) { c.lineWidth = Math.max(2, s * 0.1); c.lineJoin = 'round'; c.beginPath(); c.moveTo(-.4 * s, 0); c.lineTo(-.1 * s, .34 * s); c.lineTo(.4 * s, -.4 * s); c.stroke(); },
    circle: function (c, s) { c.lineWidth = Math.max(1.8, s * 0.07); c.beginPath(); c.ellipse(0, 0, .55 * s, .42 * s, 0, 0, 7); c.stroke(); },
    box: function (c, s) { c.lineWidth = Math.max(1.8, s * 0.07); c.strokeRect(-.6 * s, -.4 * s, 1.2 * s, .8 * s); }
  };
  function symBox(k, it, W, H) {              // 기호가 차지하는 사각형(px) — 판정 · 지우개용
    var s = (it.sz || 0.03) * W, x = it.x * W, y = it.y * H;
    if (STRETCH[k]) { var len = (it.w2 || 0.08) * W; return { x1: x - 4, y1: y - s * .5, x2: x + len + 4, y2: y + s * .6 }; }
    if (k.indexOf('g:') === 0) return { x1: x - s * .38, y1: y - s * .55, x2: x + s * .38, y2: y + s * .55 };
    var half = k.indexOf('dyn:') === 0 ? { w: s * (DYN_TEXT[k.slice(4)].length * .3 + .2), h: s * .5 } : { w: s * .62, h: s * .55 };
    return { x1: x - half.w, y1: y - half.h, x2: x + half.w, y2: y + half.h };
  }

  /** 선택 표시 · 잡기용 — 글자 · 기호 · 송폼 라벨이 차지하는 사각형(px) */
  function itemBox(it, W, H) {
    if (it.t === 'text') { var px = Math.max(8, (it.sz || 0.025) * W), w = textWidth(it, W); return { x: it.x * W - 3, y: it.y * H - px - 1, w: w + 6, h: px * 1.3 + 4 }; }
    if (it.t === 'sym') { var b = symBox(it.k, it, W, H); return { x: b.x1, y: b.y1, w: b.x2 - b.x1, h: b.y2 - b.y1 }; }
    if (it.t === 'fbox') { var lb = fboxLabel(it, W, H); return { x: lb.x, y: lb.y, w: lb.w, h: lb.h }; }
    return null;
  }
  function movable(it) { return !!it && (it.t === 'text' || it.t === 'sym' || it.t === 'fbox'); }
  var SZ_RANGE = { text: [0.012, 0.08], sym: [0.012, 0.12], fbox: [0.008, 0.06] };

  /* ------------------------------------------------------------ 송폼 박스 도우미 */
  function isLightColor(c) { var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ''); return !!m && (parseInt(m[1], 16) * 0.3 + parseInt(m[2], 16) * 0.59 + parseInt(m[3], 16) * 0.11) > 170; }
  function rrect(c, x, y, w, h, r) { c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }
  var _fm = null;
  /**
   * 송폼 라벨 — 박스 없이 V · C · P · B · Int 같은 글자만 악보 위에 또렷하게 씁니다 (글자 둘레의 흰(또는 어두운) 테두리로 어떤 악보 위에서도 잘 보임).
   * 저장 형식은 예전 "송폼 박스"(t:'fbox')와 같아서, 이미 그려 둔 박스도 지워지지 않고 글자 라벨만 남겨 그립니다.
   *  · 새 라벨은 w=h=0.01 로 저장하고, 누른 자리가 글자의 한가운데입니다.
   *  · 예전 박스(w · h 가 0.03 보다 큼)는 예전 이름표 자리(박스 왼쪽 위)에 그대로 글자만 그립니다.
   */
  function fboxLegacy(it) { return (it.w || 0) > 0.03 || (it.h || 0) > 0.03; }
  function fboxLabel(it, W, H) {
    var px = Math.max(12, Math.min(44, (it.sz || 0.026) * W)), pad = Math.max(3, px * 0.28), tw = 0, s = String(it.k || '');
    try { if (typeof document !== 'undefined') { _fm = _fm || document.createElement('canvas').getContext('2d'); _fm.font = '800 ' + px + 'px ' + FONTS.sans; tw = _fm.measureText(s).width; } } catch (e) {}
    if (!tw) tw = s.length * px * 0.62;
    var w = tw + pad * 2, h = px + pad, x, y;
    if (fboxLegacy(it)) { x = it.x * W; y = it.y * H - h; if (y < 0) y = it.y * H; }
    else { x = it.x * W - w / 2; y = it.y * H - h / 2; }
    x = Math.max(0, Math.min(Math.max(0, W - w), x)); y = Math.max(0, Math.min(Math.max(0, H - h), y));
    return { x: x, y: y, w: w, h: h, px: px, pad: pad };
  }

  /* ------------------------------------------------------------ 항목 그리기
     V836 — 필기 선을 캣멀-롬(Catmull-Rom) 곡선으로: 찍힌 점을 모두 정확히 지나면서 그 사이를 매끄럽게 이어 손글씨(GoodNotes) 느낌에 가깝게.
     (예전에는 "중간점만 지나는" 곡선이라 각진 곳이 깎였습니다.) 저장되는 점 데이터는 그대로라서 예전 필기도 그대로 보이고, 서버 · 다른 기기와 호환됩니다. */
  function strokePath(c, p, W, H) {
    var n = p.length / 2; if (!n) return;
    function X(i) { return p[i * 2] * W; } function Y(i) { return p[i * 2 + 1] * H; }
    c.beginPath(); c.moveTo(X(0), Y(0));
    if (n === 1) { c.lineTo(X(0) + 0.01, Y(0)); return; }
    if (n === 2) { c.lineTo(X(1), Y(1)); return; }
    for (var i = 0; i < n - 1; i++) {
      var i0 = i > 0 ? i - 1 : 0, i3 = i + 2 < n ? i + 2 : n - 1;
      var p0x = X(i0), p0y = Y(i0), p1x = X(i), p1y = Y(i), p2x = X(i + 1), p2y = Y(i + 1), p3x = X(i3), p3y = Y(i3);
      c.bezierCurveTo(p1x + (p2x - p0x) / 6, p1y + (p2y - p0y) / 6, p2x - (p3x - p1x) / 6, p2y - (p3y - p1y) / 6, p2x, p2y);
    }
  }
  /** 항목 하나를 ctx 에 그림. W,H = 그릴 쪽의 픽셀 크기. o.alpha = 전체 투명도 */
  function drawItem(c, it, W, H, o) {
    o = o || {};
    c.save();
    try {
      c.strokeStyle = c.fillStyle = it.c || '#ff5a1f'; c.lineCap = 'round'; c.lineJoin = 'round';
      if (o.alpha != null) c.globalAlpha = o.alpha;
      if (it.t === 'pen') { c.lineWidth = Math.max(0.8, (it.w || 0.003) * W); strokePath(c, it.p || [], W, H); c.stroke(); }
      else if (it.t === 'hl') { c.globalAlpha = (o.alpha == null ? 1 : o.alpha) * 0.38; c.lineCap = it.line ? 'butt' : 'round'; c.lineWidth = Math.max(4, (it.w || 0.02) * W); strokePath(c, it.p || [], W, H); c.stroke(); }
      else if (it.t === 'text') {
        var px = Math.max(8, (it.sz || 0.025) * W);
        c.translate(it.x * W, it.y * H); if (it.rot) c.rotate(it.rot * Math.PI / 180);
        c.font = (it.chord ? '800 ' : '600 ') + px + 'px ' + FONTS[fontOf(it)]; c.textBaseline = 'alphabetic';
        if (it.chord && it.s) {                                                            // 코드는 악보에 이미 있는 코드 위에 덮어 쓰므로, 밑에 흰 바탕을 깔아 원래 코드를 가립니다
          var cw = c.measureText(it.s).width, cp = Math.max(2, px * 0.14);
          c.save(); c.globalAlpha = (o.alpha == null ? 1 : o.alpha); c.fillStyle = '#FFFFFF'; c.fillRect(-cp, -px * 0.92, cw + cp * 2, px * 1.2); c.restore();
        }
        c.lineWidth = Math.max(2, px * 0.2); c.strokeStyle = 'rgba(255,255,255,.9)'; c.strokeText(it.s || '', 0, 0);
        c.fillStyle = it.c || '#ff5a1f'; c.fillText(it.s || '', 0, 0);
      } else if (it.t === 'fbox') {                                                        // 송폼 라벨 — 글자를 네모 테두리 안에 (콜아웃 때는 깜빡)
        var lb = fboxLabel(it, W, H), fc = it.c || '#ff5a1f', rr = Math.max(3, lb.px * 0.16), fl = !!o.flash, bw = Math.max(1.6, lb.px * 0.1);
        if (fl) { var cx0 = lb.x + lb.w / 2, cy0 = lb.y + lb.h / 2; c.translate(cx0, cy0); c.scale(1.45, 1.45); c.translate(-cx0, -cy0); c.shadowColor = 'rgba(255,122,28,.95)'; c.shadowBlur = Math.max(14, lb.px * 0.9); }
        c.beginPath();
        if (c.roundRect) c.roundRect(lb.x, lb.y, lb.w, lb.h, rr); else c.rect(lb.x, lb.y, lb.w, lb.h);
        c.fillStyle = fl ? '#FF7A1C' : 'rgba(255,255,255,.94)'; c.fill();
        c.lineWidth = bw; c.strokeStyle = fl ? '#FFFFFF' : fc; c.stroke();
        c.shadowBlur = 0; c.shadowColor = 'transparent';
        c.font = '800 ' + lb.px + 'px ' + FONTS.sans; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = fl ? '#FFFFFF' : fc; c.fillText(String(it.k || ''), lb.x + lb.w / 2, lb.y + lb.h / 2 + 0.5);
      } else if (it.t === 'sym') {
        var k = it.k, s = Math.max(8, (it.sz || 0.03) * W);
        c.translate(it.x * W, it.y * H); if (it.rot) c.rotate(it.rot * Math.PI / 180);
        if (k.indexOf('g:') === 0) {                                                       // 음표 도장 ♩ ♪ ♯ ♭ — 글꼴 설정을 따름
          c.font = '700 ' + s * 1.05 + 'px ' + FONTS[it.f && FONTS[it.f] ? it.f : 'serif'] + GLYPH_FALLBACK; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.lineWidth = Math.max(2, s * 0.14); c.strokeStyle = 'rgba(255,255,255,.9)'; c.strokeText(GLYPHS[k.slice(2)] || '', 0, 0); c.fillText(GLYPHS[k.slice(2)] || '', 0, 0);
        } else if (k.indexOf('dyn:') === 0) {
          c.font = it.f && FONTS[it.f] ? 'italic 700 ' + s * 0.85 + 'px ' + FONTS[it.f] : 'italic 700 ' + s * 0.85 + 'px "Times New Roman",Georgia,serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.lineWidth = Math.max(2, s * 0.16); c.strokeStyle = 'rgba(255,255,255,.9)'; c.strokeText(DYN_TEXT[k.slice(4)] || '', 0, 0); c.fillText(DYN_TEXT[k.slice(4)] || '', 0, 0);
        } else if (SYM[k]) { c.strokeStyle = 'rgba(255,255,255,.0)'; c.strokeStyle = it.c || '#ff5a1f'; SYM[k](c, s, (it.w2 || 0.08) * W); }
      }
    } catch (e) { /* 항목 하나가 이상해도 나머지는 그립니다 */ }
    c.restore();
  }

  /* ------------------------------------------------------------ 판정 (지우개) */
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(px - ax, py - ay);
    var t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  var _meas = null;
  function textWidth(it, W) {
    var px = Math.max(8, (it.sz || 0.025) * W), s = String(it.s || '');
    try {
      if (typeof document !== 'undefined') { _meas = _meas || document.createElement('canvas').getContext('2d'); _meas.font = (it.chord ? '800 ' : '600 ') + px + 'px ' + FONTS[fontOf(it)]; return _meas.measureText(s).width; }
    } catch (e) {}
    var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? px : px * 0.58;
    return w;
  }
  /** (x,y 픽셀)이 항목 위인가? tol = 허용 오차(px) */
  function hit(it, x, y, W, H, tol) {
    tol = tol == null ? 8 : tol;
    if (it.t === 'pen' || it.t === 'hl') {
      var p = it.p || [], r = Math.max(tol, ((it.w || 0.003) * W) / 2 + tol * 0.4);
      if (p.length === 2) return Math.hypot(x - p[0] * W, y - p[1] * H) <= r;
      for (var i = 0; i + 3 < p.length; i += 2) if (segDist(x, y, p[i] * W, p[i + 1] * H, p[i + 2] * W, p[i + 3] * H) <= r) return true;
      return false;
    }
    if (it.t === 'text') { var px = Math.max(8, (it.sz || 0.025) * W), w = textWidth(it, W); return x >= it.x * W - tol && x <= it.x * W + w + tol && y >= it.y * H - px - tol && y <= it.y * H + px * 0.3 + tol; }
    if (it.t === 'fbox') { var lb = fboxLabel(it, W, H); return x >= lb.x - tol && x <= lb.x + lb.w + tol && y >= lb.y - tol && y <= lb.y + lb.h + tol; }   // 글자 칸만
    if (it.t === 'sym') { var b = symBox(it.k, it, W, H); return x >= b.x1 - tol && x <= b.x2 + tol && y >= b.y1 - tol && y <= b.y2 + tol; }
    return false;
  }

  /* ============================================================ 엔진 */
  var CHORD_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', '#', 'b', 'm', '7', 'maj7', 'sus4', 'add9', '/', '(', ')'];

  /**
   * create({ host, canvas, me, canEdit, onAdd(layer,item), onDel(layer,id), onClear(layer,ids,pg,all), onLive(msg), onChange(), onMessage(text,isError) })
   *  host   = 캔버스를 감싼 position:relative 요소 (글자 입력칸을 이 안에 띄움)
   *  canvas = PDF 화면 위에 겹쳐진 투명 canvas (크기는 resize() 로 맞춤)
   */
  function create(o) {
    var cv = o.canvas, host = o.host, ctx = cv.getContext('2d');
    var S = { layers: { team: new Map(), mine: new Map() }, vis: { team: true, mine: true }, page: 1, tool: 'none', color: PALETTE[0], hlColor: HL_COLORS[0],
      pw: 0.003, hw: 0.02, sym: 'sharp', fboxTag: 'V',  symSize: 0.032, textSize: 0.024, font: 'sans', layer: 'team', W: 1, H: 1, dpr: 1, cur: null, live: new Map(), hist: [], redo: [],
      sawPen: !!o.sawPen, penT: 0, penTap: true, prevDraw: 'pen', tapDown: null, tapLast: null, seq: 0, sel: null, fboxSize: 0.028, penMode: 'auto', straight: false, me: o.me || '', canEdit: !!o.canEdit, editor: null, raf: 0, dead: false, liveTimer: 0,
      autoSel: o.autoSelect !== false, placed: false };   // v6 — 한 번 쓰고 난 뒤 빈 곳을 톡 치면 선택·이동 도구로 (autoSel)
    function say(t, bad) { try { if (o.onMessage) o.onMessage(t, !!bad); } catch (e) {} }
    function changed() { try { if (o.onChange) o.onChange(); } catch (e) {} }

    /* ---- 그리기 ---- */
    /** 다시 그리기 예약 (한 화면 프레임에 한 번으로 모읍니다). dyn=true 는 "확정된 필기는 그대로, 그리는 중인 획 · 선택 표시 · 남의 실시간 획만 바뀜" — 이때는 확정 필기를 다시 그리지 않고 저장해 둔 그림을 붙입니다 */
    function invalidate(dyn) { if (!dyn) S.dirty = true; if (S.raf || S.dead) return; S.raf = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (f) { return setTimeout(f, 16); })(function () { S.raf = 0; redraw(); }); }
    function pageItems(layer, pg) { var out = []; S.layers[layer].forEach(function (it) { if (it.pg === pg) out.push(it); }); return out; }
    /** 콜아웃(큐)을 말할 때 그 송폼 라벨(V · C …)을 1~2초 깜빡여 어디를 봐야 하는지 알려줍니다. keys = 라벨 글자 목록 (대소문자 무시) */
    function flashOn() { var f = S.flash; if (!f) return null; var t = Date.now() - f.t0; if (t > f.ms) return null; return Math.floor(t / 260) % 2 === 0 ? f : null; }
    function flashTags(keys, ms) {
      var map = {}, n = 0; (keys || []).forEach(function (k) { map[String(k).toLowerCase()] = 1; });
      ['team', 'mine'].forEach(function (ly) { if (S.vis[ly]) pageItems(ly, S.page).forEach(function (it) { if (it.t === 'fbox' && map[String(it.k || '').toLowerCase()]) n++; }); });
      if (!n) return 0;
      S.flash = { keys: map, t0: Date.now(), ms: ms || 1800 }; clearInterval(S.flashTimer);
      S.flashTimer = setInterval(function () { if (S.dead || !S.flash || Date.now() - S.flash.t0 > S.flash.ms) { clearInterval(S.flashTimer); S.flash = null; S.dirty = true; if (!S.dead) invalidate(); return; } S.dirty = true; invalidate(); }, 130);
      S.dirty = true; invalidate(); return n;
    }
    function drawPage(c, W, H, pg, vis, skip) {                                   // skip: 그리지 않을 항목 번호 (손가락으로 옮기는 중인 항목 — 따로 위에 그림)
      vis = vis || S.vis;
      ['team', 'mine'].forEach(function (ly) {
        if (!vis[ly]) return;
        var list = pageItems(ly, pg);
        if (S.byFilter) list = list.filter(function (i) { return (i.by || '') === S.byFilter; });   // V842 — "이 사람 필기만 보기" (화면에서만 · 저장 · 내보내기는 그대로)
        list.filter(function (i) { return i.t === 'hl' && i.id !== skip; }).forEach(function (i) { drawItem(c, i, W, H); });
        var fl = flashOn();
        list.filter(function (i) { return i.t !== 'hl' && i.id !== skip; }).forEach(function (i) { drawItem(c, i, W, H, fl && i.t === 'fbox' && fl.keys[String(i.k || '').toLowerCase()] ? { flash: true } : null); });
      });
    }
    /** 옮기기 · 크기 바꾸기 중인 항목 번호 (없으면 null) */
    function movingId() { var c = S.cur; return c && (c.kind === 'move' || c.kind === 'resize') && c.item ? c.item.id : null; }
    /** 확정된 필기를 따로 그려 두는 그림 — 필기가 많은 쪽(30개↑)에서 획을 긋는 동안만 씁니다 (적은 쪽은 그냥 다시 그리는 게 더 쌉니다) */
    function baseWorth() {
      if (!S.cur && !S.live.size) return false;
      if (cv.width * cv.height > 12e6 || typeof document === 'undefined') return false;
      var n = 0; ['team', 'mine'].forEach(function (ly) { S.layers[ly].forEach(function (it) { if (it.pg === S.page) n++; }); });
      return n >= (movingId() ? 8 : 30);                                            // 항목을 끌 때는 8개만 넘어도 나머지를 저장해 둔 그림으로 붙임
    }
    function buildBase() {
      try {
        var bc = S.base || (S.base = document.createElement('canvas'));
        if (bc.width !== cv.width || bc.height !== cv.height) { bc.width = cv.width; bc.height = cv.height; }
        var b = bc.getContext('2d'); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, bc.width, bc.height); b.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
        S.baseId = movingId(); drawPage(b, S.W, S.H, S.page, null, S.baseId); S.baseOk = true;
      } catch (e) { S.baseOk = false; }
    }
    function freeBase() { S.baseOk = false; if (S.base) { try { S.base.width = S.base.height = 0; } catch (e) { /* 무시 */ } S.base = null; } }
    function redraw() {
      if (S.dead) return;
      var dirty = S.dirty; S.dirty = false; if (dirty) S.baseOk = false;
      if (S.baseOk && S.baseId !== movingId()) S.baseOk = false;                   // 저장해 둔 그림이 지금 옮기는 항목과 다르면 버림
      if (!dirty && !S.baseOk && baseWorth()) buildBase();
      var usedBase = !dirty && S.baseOk;
      if (usedBase) {                                                              // 획을 긋는 동안 : 확정된 필기는 저장해 둔 그림을 한 번에 붙임
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(S.base, 0, 0); ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
        if (S.baseId && S.cur && S.cur.item) drawItem(ctx, S.cur.item, S.W, S.H);   // 옮기는 항목만 새 자리에 따로 그림
      } else {
        ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); ctx.clearRect(0, 0, S.W, S.H);
        drawPage(ctx, S.W, S.H, S.page);
      }
      var now = Date.now(), keep = false;
      S.live.forEach(function (l, id) {
        if (now - l.at > 4000) { S.live.delete(id); return; }
        keep = true;
        if (l.pg !== S.page || !l.p || l.p.length < 2) return;
        drawItem(ctx, { t: l.t, c: l.c, w: l.w, p: l.p }, S.W, S.H, { alpha: 0.85 });
        var lx = l.p[l.p.length - 2] * S.W, ly = l.p[l.p.length - 1] * S.H;
        ctx.save(); ctx.font = '600 11px sans-serif'; ctx.fillStyle = 'rgba(20,20,26,.85)'; var lb = hon(l.by || ''); var tw = ctx.measureText(lb).width; ctx.fillRect(lx + 6, ly - 20, tw + 8, 15); ctx.fillStyle = '#fff'; ctx.fillText(lb, lx + 10, ly - 9); ctx.restore();
      });
      if (keep && !S.liveTimer) S.liveTimer = setTimeout(function () { S.liveTimer = 0; invalidate(true); }, 1200);
      if (S.cur && (S.cur.kind === 'pen' || S.cur.kind === 'hl')) {
        var cc = S.cur; drawItem(ctx, { t: cc.kind, c: cc.color, w: cc.w, p: cc.straight ? cc.p.slice(0, 2).concat(cc.p.slice(-2)) : (cc.pred && cc.pred.length ? cc.p.concat(cc.pred) : cc.p), line: cc.straight }, S.W, S.H);
      } else if (S.cur && (S.cur.kind === 'sym' || S.cur.kind === 'fbox')) {
        drawItem(ctx, S.cur.item, S.W, S.H, { alpha: 0.75 });
      }
      if (S.showBy) drawAuthorTags(ctx);
      var si = selItem();
      if (si && si.pg === S.page && S.vis[S.sel.layer]) drawSel(ctx, si);
    }
    /* V842 — 누가 쓴 필기인지: 이름표 (짧게 · 같은 사람의 가까운 필기는 이름표 하나로) */
    function hon(n) { try { return typeof window !== 'undefined' && window.YNHon ? window.YNHon.name(n) : n; } catch (e) { return n; } }   // 찬양방송팀 허브 — 목사님 호칭
    function ago(ts) {
      var d = Math.max(0, Date.now() - (+ts || 0)) / 1000; if (!ts) return '';
      if (d < 60) return '방금'; if (d < 3600) return Math.floor(d / 60) + '분 전'; if (d < 86400) return Math.floor(d / 3600) + '시간 전';
      var t = new Date(+ts); return (t.getMonth() + 1) + '/' + t.getDate();
    }
    function byTag(c, x, y, text, strong) {
      c.save(); c.font = (strong ? '700 12px' : '600 10.5px') + ' sans-serif'; c.textBaseline = 'middle';
      var tw = c.measureText(text).width, h = strong ? 18 : 15, w = tw + 10;
      x = clamp(x, 2, Math.max(2, S.W - w - 2)); y = clamp(y, 2, Math.max(2, S.H - h - 2));
      c.fillStyle = strong ? 'rgba(255,138,42,.95)' : 'rgba(20,20,26,.78)'; c.beginPath();
      if (c.roundRect) c.roundRect(x, y, w, h, h / 2); else c.rect(x, y, w, h); c.fill();
      c.fillStyle = strong ? '#1a0d02' : '#fff'; c.fillText(text, x + 5, y + h / 2 + .5); c.restore();
    }
    function drawAuthorTags(c) {
      var seen = {};
      ['team', 'mine'].forEach(function (ly) {
        if (!S.vis[ly]) return;
        pageItems(ly, S.page).forEach(function (it) {
          if (S.byFilter && (it.by || '') !== S.byFilter) return;
          var b = itemBox(it, S.W, S.H); if (!b) return;
          var cell = (it.by || '?') + '|' + Math.floor(b.x / 140) + ':' + Math.floor(b.y / 70); if (seen[cell]) return; seen[cell] = 1;
          byTag(c, b.x, b.y - 16, (ly === 'mine' ? '🔒 ' : '') + (hon(it.by) || '알 수 없음'), false);
        });
      });
    }
    /** 선택한 항목 둘레의 점선 테두리 + 모서리 점 (끌어서 옮길 수 있다는 표시) */
    function selItem() { return S.sel && S.layers[S.sel.layer] ? (S.layers[S.sel.layer].get(S.sel.id) || null) : null; }
    /** 선택 상자의 자리 · 손잡이 자리 (화면 가장자리에 걸려도 손잡이는 화면 안에 남게) */
    var HANDLE_R = 11;
    function handleGeom(it) {
      var b = itemBox(it, S.W, S.H); if (!b) return null;
      var pad = 5, x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
      function cl(px, py) { return { x: clamp(px, HANDLE_R, Math.max(HANDLE_R, S.W - HANDLE_R)), y: clamp(py, HANDLE_R, Math.max(HANDLE_R, S.H - HANDLE_R)) }; }
      return { x: x, y: y, w: w, h: h, tl: cl(x, y), tr: cl(x + w, y), br: cl(x + w, y + h), bl: cl(x, y + h) };
    }
    function drawHandle(c, pt, color, kind) {
      c.save(); c.translate(pt.x, pt.y);
      c.beginPath(); c.arc(0, 0, HANDLE_R, 0, 7); c.fillStyle = color; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
      c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round';
      if (kind === 'del') { c.beginPath(); c.moveTo(-4, -4); c.lineTo(4, 4); c.moveTo(4, -4); c.lineTo(-4, 4); c.stroke(); }
      else if (kind === 'size') { c.beginPath(); c.moveTo(-4, -4); c.lineTo(4, 4); c.moveTo(4, 4); c.lineTo(0.5, 4); c.moveTo(4, 4); c.lineTo(4, 0.5); c.moveTo(-4, -4); c.lineTo(-0.5, -4); c.moveTo(-4, -4); c.lineTo(-4, -0.5); c.stroke(); }
      else if (kind === 'edit') { c.font = '800 13px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('T', 0, 1); }
      c.restore();
    }
    function drawSel(c, it) {
      var g = handleGeom(it); if (!g) return;
      var can = canModify(S.sel.layer, it);
      c.save();
      c.setLineDash([6, 4]); c.lineWidth = 3.4; c.strokeStyle = 'rgba(20,20,26,.5)'; c.strokeRect(g.x, g.y, g.w, g.h);       // 어두운 밑줄 — 흰 악보 · 어두운 악보 어디서나 보임
      c.lineWidth = 1.8; c.strokeStyle = can ? '#ff8a2a' : '#8b8b96'; c.strokeRect(g.x, g.y, g.w, g.h); c.setLineDash([]);
      byTag(c, g.x + (can ? 0 : 0), g.y - 22, '✎ ' + (hon(it.by) || '알 수 없음') + (it.ts ? ' · ' + ago(it.ts) : '') + (S.sel.layer === 'mine' ? ' · 나만 보기' : ''), true);   // V842 — 누가 · 언제 쓴 필기인지
      if (can) {
        drawHandle(c, g.tr, '#e5484d', 'del'); drawHandle(c, g.br, '#ff8a2a', 'size');
        if (it.t === 'text') drawHandle(c, g.tl, '#ff8a2a', 'edit');
        else { c.fillStyle = '#ff8a2a'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.rect(g.tl.x - 4, g.tl.y - 4, 8, 8); c.fill(); c.stroke(); }
        c.fillStyle = '#ff8a2a'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.rect(g.bl.x - 4, g.bl.y - 4, 8, 8); c.fill(); c.stroke();
      }
      c.restore();
    }
    /** 누른 자리가 선택 항목의 손잡이인지 ('del' 지우기 · 'size' 크기 · 'edit' 글자 고치기) — 손가락은 넉넉하게(24px) */
    function handleAt(px, py, touch) {
      var it = selItem(); if (!it || it.pg !== S.page || !S.vis[S.sel.layer] || !canModify(S.sel.layer, it)) return null;
      var g = handleGeom(it); if (!g) return null;
      var tol = touch ? 24 : 15, best = null, bd = 1e9;
      [['del', g.tr], ['size', g.br]].concat(it.t === 'text' ? [['edit', g.tl]] : []).forEach(function (h) { var d = Math.hypot(px - h[1].x, py - h[1].y); if (d <= tol && d < bd) { bd = d; best = h[0]; } });
      return best;
    }
    /** 누른 자리가 선택 항목의 몸통 안인지 (손가락은 넉넉하게) */
    function inSelBox(px, py, touch) {
      var it = selItem(); if (!it || it.pg !== S.page || !S.vis[S.sel.layer]) return false;
      var g = handleGeom(it); if (!g) return false; var t = touch ? 14 : 6;
      return px >= g.x - t && px <= g.x + g.w + t && py >= g.y - t && py <= g.y + g.h + t;
    }

    /* ---- 항목 추가 · 삭제 (되돌리기 기록 포함) ---- */
    function mine(it) { return it.by === S.me; }
    function canModify(layer, it) { return layer === 'mine' || mine(it) || S.canEdit; }
    function put(layer, it, notify) { S.layers[layer].set(it.id, it); if (notify !== false) { try { o.onAdd && o.onAdd(layer, it); } catch (e) {} } invalidate(); changed(); }
    function take(layer, id, notify) { var it = S.layers[layer].get(id); if (!it) return null; S.layers[layer].delete(id); if (notify !== false) { try { o.onDel && o.onDel(layer, id); } catch (e) {} } invalidate(); changed(); return it; }
    function record(op) { S.seq++; S.hist.push(op); if (S.hist.length > 200) S.hist.shift(); S.redo = []; }
    function addLocal(layer, it) { it.by = S.me; it.ts = Date.now(); put(layer, it); record({ op: 'add', layer: layer, item: it }); return it; }

    function undo() {
      var h = S.hist.pop(); if (!h) { say('되돌릴 것이 없습니다.'); return false; }
      if (h.op === 'add') take(h.layer, h.item.id);
      else if (h.op === 'del') put(h.layer, h.item);
      else if (h.op === 'edit') put(h.layer, h.before);
      else if (h.op === 'clear') h.items.forEach(function (i) { put(h.layer, i); });
      S.redo.push(h); return true;
    }
    function redo() {
      var h = S.redo.pop(); if (!h) return false;
      if (h.op === 'add') put(h.layer, h.item);
      else if (h.op === 'del') take(h.layer, h.item.id);
      else if (h.op === 'edit') put(h.layer, h.after);
      else if (h.op === 'clear') h.items.forEach(function (i) { take(h.layer, i.id); });
      S.hist.push(h); return true;
    }

    /* ---- 입력 ---- */
    var rectC = null;                                                             // 손가락을 대고 있는 동안의 캔버스 자리 (움직일 때마다 배치를 다시 재지 않으려고)
    function norm(e) { var r = (S.cur && rectC) || cv.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / (r.width || 1), 0, 1), y: clamp((e.clientY - r.top) / (r.height || 1), 0, 1) }; }
    function drawing() { return S.tool !== 'none'; }
    function notePen(e) { if (e.pointerType === 'pen') S.penT = Date.now(); }        // 애플 펜슬이 화면 위(떠 있을 때 포함)에 있는 동안 손바닥을 무시하기 위한 기록
    cv.addEventListener('pointermove', notePen); cv.addEventListener('pointerover', notePen);
    function refreshTouch() {
      cv.style.pointerEvents = drawing() ? 'auto' : 'none';
      var lockTouch = S.penMode === 'always' || (S.penMode === 'auto' && S.sawPen);
      // 그리는 캔버스는 손가락이든 애플 펜슬이든 브라우저가 스크롤 · 확대로 가로채지 못하게 항상 none (필기가 끊기는 문제).
      // 손가락을 "펜만 그림" 으로 막아 둔 경우의 스크롤 · 스와이프 · 핀치는 화면 쪽 터치 처리(practice.js)가 직접 합니다.
      void lockTouch;
      cv.style.touchAction = 'none'; cv.style.webkitUserSelect = 'none'; cv.style.userSelect = 'none'; cv.style.webkitTouchCallout = 'none';
      cv.style.cursor = toolCursor();
    }
    function toolCursor() { return !drawing() ? '' : S.tool === 'select' ? 'move' : S.tool === 'eraser' ? 'cell' : S.tool === 'fbox' ? 'crosshair' : S.tool === 'text' || S.tool === 'chord' ? 'text' : 'crosshair'; }
    function activeColor() { return S.tool === 'hl' ? S.hlColor : S.color; }

    function eraseAt(px, py) {
      var tol = (S.cur && S.cur.touch) ? 14 : 9, gone = 0, denied = false;
      ['mine', 'team'].forEach(function (ly) {
        if (!S.vis[ly]) return;
        pageItems(ly, S.page).slice().reverse().forEach(function (it) {
          if (!hit(it, px, py, S.W, S.H, tol)) return;
          if (!canModify(ly, it)) { denied = true; return; }
          var t = take(ly, it.id); if (t) { record({ op: 'del', layer: ly, item: t }); gone++; }
        });
      });
      if (denied && !gone && S.cur && !S.cur.warned) { S.cur.warned = 1; say('다른 사람이 쓴 필기는 지울 수 없습니다. (팀장 · 인도자만 가능)', true); }
      return gone;
    }

    /** 누른 자리의 옮길 수 있는 항목 (글자 · 코드 · 기호 · 송폼 라벨) — 위에 그려진 것부터 */
    function pickMovable(px, py, touch) {
      var tol = touch ? 14 : 7, found = null;
      ['team', 'mine'].forEach(function (ly) {
        if (!S.vis[ly]) return;
        pageItems(ly, S.page).forEach(function (it) {
          if (!movable(it)) return;
          var b = itemBox(it, S.W, S.H);
          var inBox = it.t !== 'fbox' && b && px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
          if (inBox || hit(it, px, py, S.W, S.H, tol)) found = { layer: ly, item: it };
        });
      });
      return found;
    }
    function startMove(e, g, p, editOnTap) {
      var was = !!(S.sel && S.sel.id === g.item.id && S.sel.layer === g.layer), fresh = S.fresh === g.item.id;
      S.sel = { layer: g.layer, id: g.item.id }; S.fresh = null;
      S.cur = { kind: 'move', ptr: e.pointerId, layer: g.layer, orig: g.item, item: Object.assign({}, g.item), x0: p.x, y0: p.y, px0: e.clientX, py0: e.clientY,
        moved: false, editOnTap: !!editOnTap && !fresh, wasSel: was && !fresh, locked: !canModify(g.layer, g.item), warned: false };     // 방금 만든 항목을 한 번 톡 치면: 고치기 대신 "옮기기 상태" 유지
      cv.style.cursor = 'grabbing'; invalidate(); changed();
    }
    /** 선택한 항목이 있을 때 빈 곳을 눌러 끌기 — 항목이 손가락을 따라 움직입니다 (작은 글자를 정확히 집지 않아도 됨). 끌지 않고 떼면 then 을 합니다 */
    function startRelMove(e, p, then) {
      var it = selItem(), ly = S.sel.layer; if (!it) return false;
      S.cur = { kind: 'move', ptr: e.pointerId, layer: ly, orig: it, item: Object.assign({}, it), x0: p.x, y0: p.y, px0: e.clientX, py0: e.clientY,
        moved: false, editOnTap: false, wasSel: true, locked: false, warned: false, rel: true, then: then || null };
      cv.style.cursor = 'grabbing'; invalidate(); return true;
    }
    /** 손잡이 누르기 — 크기(끌기) · 지우기 · 글자 고치기 (뗄 때 실행) */
    function beginHandle(e, which, p) {
      var it = selItem(), ly = S.sel.layer; if (!it) return;
      var g = handleGeom(it);
      if (which === 'size') {
        var ox = it.x * S.W, oy = it.y * S.H;
        S.cur = { kind: 'resize', ptr: e.pointerId, layer: ly, orig: it, item: Object.assign({}, it), ox: ox, oy: oy, d0: Math.max(12, Math.hypot(g.br.x - ox, g.br.y - oy)),
          gx: g.br.x - p.x * S.W, gy: g.br.y - p.y * S.H, moved: false };
        cv.style.cursor = 'nwse-resize';
      } else S.cur = { kind: 'handle', which: which, ptr: e.pointerId, px0: e.clientX, py0: e.clientY, moved: false };
      invalidate();
    }
    /** 그리던 것 · 옮기던 것을 버리고 원래 모양으로 (도구 · 쪽을 바꾸거나 두 번째 손가락이 닿았을 때) */
    function dropCur() { var c = S.cur; S.cur = null; if (c && (c.kind === 'move' || c.kind === 'resize') && S.layers[c.layer]) S.layers[c.layer].set(c.orig.id, c.orig); rectC = null; }
    /** 방금 만든 글자 · 기호 · 송폼 라벨을 바로 선택 상태(테두리 + 손잡이)로 — 곧바로 끌어서 옮기거나 크기를 바꿀 수 있음 */
    /* v6 — 자동 선택·이동: 글자 · 코드 · 기호 · 라벨 · 펜을 한 번 쓴 뒤 악보의 빈 곳을 톡 치면 선택·이동 도구로 바뀝니다 */
    function autoSelect() {
      S.tool = 'select'; S.placed = false; S.fresh = null; S.sel = null;      // 선택도 풀어서, 톡 친 손가락을 끌어도 방금 쓴 것이 따라 움직이지 않게
      refreshTouch(); cv.style.cursor = toolCursor();
      try { o.onAutoSelect && o.onAutoSelect(); } catch (e) {}
      changed();
    }
    function adopt(layer, it) {
      if (!it || (S.tool !== 'text' && S.tool !== 'chord' && S.tool !== 'sym' && S.tool !== 'fbox')) return;
      S.sel = { layer: layer, id: it.id }; S.fresh = it.id; invalidate(); changed();
    }
    /* ---- 펜 ↔ 지우개 빠른 전환 (Step 2.15) ----
       웹 페이지(사파리 포함)는 애플 펜슬의 하드웨어 "더블탭"을 받을 수 없습니다 — 그 신호는 네이티브 앱(UIPencilInteraction)에만 전달됩니다.
       그래서 페이지 안에서 받을 수 있는 신호로 같은 일을 합니다:
         ① 펜 끝으로 같은 자리를 빠르게 두 번 톡톡 (펜 · 형광펜 ↔ 지우개)  ② 펜 옆 버튼(서피스 펜 · S펜 · 와콤 등) 누르기  ③ 펜의 지우개 쪽 끝(잡고 있는 동안만 지우개)
         ④ 도구 막대의 단추 · E 키(지우개) 는 기존 그대로.
       첫 번째 톡으로 찍힌 점(또는 지워진 것)은 두 번째 톡이 확인되는 순간 자동으로 되돌립니다. */
    var TAP_MS = 380, TAP_PX = 34;
    function swapPenEraser(via) {
      var from = S.tool, to = from === 'eraser' ? (S.prevDraw || 'pen') : (from === 'pen' || from === 'hl') ? 'eraser' : '';
      if (!to) return false;
      if (from !== 'eraser') S.prevDraw = from;
      if (o.onToolSwap) { try { o.onToolSwap(to, from, via || 'tap'); } catch (x) {} } else api.setTool(to);
      return true;
    }
    /** 펜 입력의 빠른 전환 처리 — 처리했으면 true (그 입력으로는 그리기를 시작하지 않음) */
    function penGesture(e) {
      if (!S.penTap) return false;
      var t = S.tool; if (t !== 'pen' && t !== 'hl' && t !== 'eraser') return false;
      if ((e.buttons & 2) || e.button === 2) { S.tapLast = null; return swapPenEraser('barrel'); }        // 펜 옆 버튼
      var L = S.tapLast, now = Date.now(); S.tapLast = null;
      if (L && now - L.t < TAP_MS && Math.hypot(e.clientX - L.x, e.clientY - L.y) < TAP_PX && S.seq === L.after && t === L.tool) {
        var n = L.after - L.before;                                                                       // 첫 번째 톡이 남긴 흔적만큼 되돌림
        while (n-- > 0 && S.hist.length) { if (!undo()) break; }
        return swapPenEraser('tap');
      }
      return false;
    }
    function onDown(e) {
      if (!drawing() || S.dead) return;
      if (e.pointerType === 'pen') { if (!S.sawPen) { S.sawPen = true; refreshTouch(); try { o.onPenSeen && o.onPenSeen(); } catch (x) {} } }
      else if (e.pointerType === 'touch') {
        /* v6.9 — 글자 · 코드 · 기호 · 송폼 · 선택·이동은 "한 번 톡"이 핵심이라 손가락(아이패드)으로도 됩니다. 펜 전용 모드는 펜 · 형광펜 · 지우개의 "그리기"에만 적용 (손바닥 방지는 그대로) */
        var palm = Date.now() - S.penT < 700 || ((e.width || 0) > 76 || (e.height || 0) > 76);
        var penOnly = S.penMode === 'always' || (S.penMode === 'auto' && S.sawPen);
        var fingerOk = S.tool === 'text' || S.tool === 'chord' || S.tool === 'sym' || S.tool === 'fbox' || S.tool === 'select';
        if (palm || (penOnly && !fingerOk)) return;
      }
      else if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (S.cur) { dropCur(); invalidate(); return; }                                                                   // 두 번째 손가락 = 그리기 취소 (확대 동작)
      if (e.pointerType === 'pen' && penGesture(e)) { e.preventDefault(); return; }                                    // 펜 더블탭 · 옆 버튼 = 펜 ↔ 지우개
      var hadEd = !!S.editor;
      if (S.editor) { closeEditor(true); }
      if (S.layer === 'team' && o.teamBlocked && o.teamBlocked()) { say(o.teamBlocked(), true); return; }
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      if (e.pointerType === 'pen' && S.penTap && (S.tool === 'pen' || S.tool === 'hl' || S.tool === 'eraser')) S.tapDown = { t: Date.now(), x: e.clientX, y: e.clientY, seq: S.seq };
      if (e.pointerType === 'pen' && S.penTap && (e.button === 5 || (e.buttons & 32)) && (S.tool === 'pen' || S.tool === 'hl')) {     // 지우개 쪽 끝: 잡고 있는 동안만 지우개
        var pe = norm(e); S.tapDown = null; S.cur = { kind: 'erase', ptr: e.pointerId, touch: false }; eraseAt(pe.x * S.W, pe.y * S.H); return;
      }
      var p = norm(e), touch = e.pointerType === 'touch', ppx = p.x * S.W, ppy = p.y * S.H;
      rectC = cv.getBoundingClientRect();                                                                              // 이 손가락이 떨어질 때까지 캔버스 자리를 다시 재지 않음
      if (S.autoSel && (S.placed || hadEd) && (S.tool === 'text' || S.tool === 'chord' || S.tool === 'sym' || S.tool === 'fbox')) {
        var onIt = (S.sel && selItem() && (inSelBox(ppx, ppy, touch) || handleAt(ppx, ppy, touch))) || pickMovable(ppx, ppy, touch);
        if (!onIt) {
          var si = S.sel && selItem();
          if (si && canModify(S.sel.layer, si)) { startRelMove(e, p, { kind: 'autosel' }); return; }                // 방금 쓴 것이 선택돼 있으면: 끌면 따라 움직이고(예전 그대로) · 톡 치면 선택·이동 도구로
          autoSelect();                                                                                                // 빈 곳 → 선택·이동 (아래 select 로 이어서 처리)
        }
      }
      var keepSel = S.tool === 'select' || S.tool === 'text' || S.tool === 'chord' || S.tool === 'sym' || S.tool === 'fbox';
      if (!keepSel && S.sel) { S.sel = null; S.fresh = null; changed(); }
      if (keepSel && S.sel) { var hh = handleAt(ppx, ppy, touch); if (hh) { beginHandle(e, hh, p); return; } }              // 손잡이: 크기 · 지우기 · 고치기
      var relOk = !!(S.sel && (S.tool === 'select' || S.tool === 'text' || S.tool === 'chord') && selItem() && canModify(S.sel.layer, selItem()));
      if (S.tool === 'select') {
        var g = pickMovable(ppx, ppy, touch);
        if (g) startMove(e, g, p, false);
        else if (relOk) startRelMove(e, p, { kind: 'deselect' });                                                       // 빈 곳을 끌면 선택한 항목이 따라옴 · 톡 치면 선택 해제
        else if (S.sel) { S.sel = null; S.fresh = null; invalidate(); changed(); }
      } else if (S.tool === 'pen' || S.tool === 'hl') {
        S.cur = { kind: S.tool, id: newId(), ptr: e.pointerId, p: [p.x, p.y], color: activeColor(), w: S.tool === 'hl' ? S.hw : S.pw, sent: 0, fresh: true, straight: S.tool === 'hl' && S.straight, touch: touch, t0: Date.now(), pen: e.pointerType === 'pen' };
        invalidate();
      } else if (S.tool === 'eraser') { S.cur = { kind: 'erase', ptr: e.pointerId, touch: touch, t0: Date.now(), seq0: S.seq, x0: p.x, y0: p.y, pen: e.pointerType === 'pen' }; eraseAt(p.x * S.W, p.y * S.H); }
      else if (S.tool === 'sym' && S.sel && selItem() && canModify(S.sel.layer, selItem()) && inSelBox(ppx, ppy, touch)) startMove(e, { layer: S.sel.layer, item: selItem() }, p, false);   // 방금 놓은 기호를 다시 눌러 끌기
      else if (S.tool === 'fbox' && S.sel && selItem() && canModify(S.sel.layer, selItem()) && inSelBox(ppx, ppy, touch)) startMove(e, { layer: S.sel.layer, item: selItem() }, p, false);
      else if (S.tool === 'sym') {
        var stretch = !!STRETCH[S.sym];
        S.cur = { kind: 'sym', ptr: e.pointerId, x0: p.x, y0: p.y, stretch: stretch, item: { id: newId(), t: 'sym', pg: S.page, c: S.color, x: r4(p.x), y: r4(p.y), sz: S.symSize, k: S.sym, f: textLike(S.sym) && S.font !== 'sans' ? S.font : undefined, w2: stretch ? 0.08 : undefined } };
        invalidate();
      } else if (S.tool === 'fbox') {
        S.cur = { kind: 'fbox', ptr: e.pointerId, x0: p.x, y0: p.y, moved: false, item: { id: newId(), t: 'fbox', pg: S.page, c: S.color, x: r4(clamp(p.x, 0.005, 0.995)), y: r4(clamp(p.y, 0.005, 0.995)), w: 0.01, h: 0.01, sz: S.fboxSize, k: S.fboxTag } };
        invalidate();
      } else if (S.tool === 'text' || S.tool === 'chord') {
        var g2 = pickMovable(p.x * S.W, p.y * S.H, touch);
        if (g2 && g2.item.t === 'text' && canModify(g2.layer, g2.item)) startMove(e, g2, p, true);              // 글자를 누르면: 그냥 떼면 고치기 · 끌면 옮기기
        else if (relOk) startRelMove(e, p, { kind: 'text', x: p.x, y: p.y });                                   // 선택한 글자가 있으면: 빈 곳을 끌면 따라옴 · 톡 치면 새 글자
        else S.cur = { kind: 'textpos', ptr: e.pointerId, x: p.x, y: p.y };
      }
    }
    function onMove(e) {
      var c = S.cur; if (!c || e.pointerId !== c.ptr) return;
      var list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e]; if (!list.length) list = [e];
      if (c.kind === 'move') {
        if (!c.moved && Math.hypot(e.clientX - c.px0, e.clientY - c.py0) < 5) return;                           // 살짝 흔들린 것은 "누름"으로
        if (c.locked) { if (!c.warned) { c.warned = true; say('다른 사람이 쓴 필기는 옮길 수 없습니다. (팀장 · 인도자만 가능)', true); } return; }
        c.moved = true;
        var qm = norm(e), o0 = c.orig, it0 = c.item, dx = qm.x - c.x0, dy = qm.y - c.y0;
        if (o0.t === 'fbox') { it0.x = r4(clamp(o0.x + dx, 0, 1 - (o0.w || 0))); it0.y = r4(clamp(o0.y + dy, 0, 1 - (o0.h || 0))); }
        else { it0.x = r4(clamp(o0.x + dx, 0, 1)); it0.y = r4(clamp(o0.y + dy, 0, 1)); }
        S.layers[c.layer].set(it0.id, it0); invalidate(true);                                                   // 미리보기: 옮기는 동안은 새 자리에 그려짐 (나머지 필기는 저장해 둔 그림)
      } else if (c.kind === 'resize') {
        var qr = norm(e), rr = clamp(Math.hypot(qr.x * S.W + c.gx - c.ox, qr.y * S.H + c.gy - c.oy) / c.d0, 0.15, 8);
        var rng = SZ_RANGE[c.orig.t] || SZ_RANGE.text, base0 = c.orig.sz || (c.orig.t === 'text' ? 0.025 : 0.03), nz = r4(clamp(base0 * rr, rng[0], rng[1]));
        if (nz !== c.item.sz) {
          c.item.sz = nz; if (c.orig.w2 != null) c.item.w2 = r4(clamp(c.orig.w2 * rr, 0.02, 0.5));
          c.moved = true; S.layers[c.layer].set(c.item.id, c.item); invalidate(true);
        }
      } else if (c.kind === 'handle') {
        if (Math.hypot(e.clientX - c.px0, e.clientY - c.py0) > 12) c.moved = true;
      } else if (c.kind === 'pen' || c.kind === 'hl') {
        for (var i = 0; i < list.length; i++) {
          var q = norm(list[i]), n = c.p.length;
          if (n >= 6000) break;
          if (!c.straight) q = stabilize(c, q);                                                                   // V836 — 손떨림 · 센서 잡음을 살짝 눌러 선이 부드럽게 (빨리 그을 땐 거의 그대로라 늦지 않음)
          if (Math.abs(q.x - c.p[n - 2]) + Math.abs(q.y - c.p[n - 1]) < 0.0004) continue;
          c.p.push(q.x, q.y);
        }
        c.pred = [];                                                                                              // 펜이 곧 갈 곳 (브라우저가 알려 줄 때만) — 화면에만 잇고 저장하지 않음 → 펜 끝 쪽 지연이 줄어듦
        if (!c.straight && e.pointerType === 'pen' && e.getPredictedEvents) { try { (e.getPredictedEvents() || []).slice(0, 3).forEach(function (pe) { var pq = norm(pe); c.pred.push(pq.x, pq.y); }); } catch (x) { /* 지원하지 않음 */ } }
        sendLive(c); invalidate(true);
      } else if (c.kind === 'erase') { list.forEach(function (ev) { var q = norm(ev); eraseAt(q.x * S.W, q.y * S.H); }); }
      else if (c.kind === 'fbox') {                                                            // 누른 채 끌면 글자가 손가락을 따라 다닙니다 (떼는 자리에 놓임)
        var q3 = norm(e), it3 = c.item;
        it3.x = r4(clamp(q3.x, 0.005, 0.995)); it3.y = r4(clamp(q3.y, 0.005, 0.995)); c.moved = true; invalidate(true);
      }
      else if (c.kind === 'sym' && c.stretch) { var q2 = norm(e); c.item.w2 = r4(clamp(Math.abs(q2.x - c.x0), 0.02, 0.5)); invalidate(true); }
    }
    /** 입력 안정화 — 직전에 그린 점에서 새 점으로 "일부만" 이동 (거리가 짧을수록 더 많이 누름). 화면 픽셀 기준이라 확대 · 쪽 크기와 무관 */
    function stabilize(c, q) {
      var n = c.p.length; if (n < 2) return q;
      var dx = (q.x - c.p[n - 2]) * S.W, dy = (q.y - c.p[n - 1]) * S.H, d = Math.hypot(dx, dy);
      var k = clamp(0.38 + d / 14, 0.38, 1);                                   // 3px 안쪽 미세한 떨림은 약 45% 만 반영, 14px 넘게 빨리 움직이면 100%
      return { x: c.p[n - 2] + (q.x - c.p[n - 2]) * k, y: c.p[n - 1] + (q.y - c.p[n - 1]) * k };
    }
    function sendLive(c, final) {
      if (S.layer !== 'team' || !o.onLive) return;
      var now = Date.now(); if (!final && now - c.sent < 70) return; c.sent = now;
      var p = c.p, n = p.length / 2; if (n > 200) p = limitPoints(p, 200);
      try { o.onLive({ id: c.id, t: c.kind, pg: S.page, c: c.color, w: r4(clamp(c.w, 0.0005, 0.06)), p: p, fresh: c.fresh ? 1 : 0 }); } catch (e) {} c.fresh = false;
    }
    function onUp(e) {
      var c = S.cur; if (!c || e.pointerId !== c.ptr) return;
      S.cur = null; rectC = null; if (cv.style.cursor === 'grabbing' || cv.style.cursor === 'nwse-resize') cv.style.cursor = toolCursor();
      try { cv.releasePointerCapture(e.pointerId); } catch (x) {}
      if (e.type === 'pointercancel') { if (c.kind === 'move' || c.kind === 'resize') S.layers[c.layer].set(c.orig.id, c.orig); invalidate(); return; }
      if (c.kind === 'move' || c.kind === 'resize') {
        if (!c.moved) {
          S.layers[c.layer].set(c.orig.id, c.orig);
          if (c.rel) {                                                                                                 // 빈 곳을 눌렀다 뗌
            var th = c.then; S.sel = null; S.fresh = null;
            if (th && th.kind === 'autosel') autoSelect();                                                             // v6 — 쓰고 난 뒤 빈 곳 톡 → 선택·이동
            else if (th && th.kind === 'text') openEditor(th.x, th.y);
          }
          else if (c.editOnTap) { S.sel = null; openEditor(c.orig.x, c.orig.y, c.orig, c.layer); }
          else if (c.wasSel && c.orig.t === 'text' && !c.locked && c.kind === 'move') openEditor(c.orig.x, c.orig.y, c.orig, c.layer);       // 선택된 글자를 한 번 더 누르면 고치기
          changed();
        } else {
          var after = Object.assign({}, c.item, { ts: Date.now() });
          put(c.layer, after); record({ op: 'edit', layer: c.layer, before: c.orig, after: after });
        }
      } else if (c.kind === 'handle') {
        if (!c.moved && e.type === 'pointerup') {
          var hs = selItem();
          if (c.which === 'del') api.deleteSelected();
          else if (c.which === 'edit' && hs && hs.t === 'text') { var hl = S.sel.layer; S.sel = null; openEditor(hs.x, hs.y, hs, hl); }
        }
        changed();
      /* v6.9 — 펜 · 형광펜은 빈 곳을 톡 쳐도 선택·이동으로 바뀌지 않고 계속 그 도구로 남습니다 (예전엔 톡 → 선택·이동). 글자 · 코드 · 기호 · 송폼만 빈 곳을 톡 치면 선택·이동. */
      } else if (c.kind === 'erase' && S.autoSel && !c.pen && e.type === 'pointerup' && S.seq === c.seq0 && Date.now() - c.t0 < 320 && tinyPath([c.x0, c.y0].concat(norm(e) ? [norm(e).x, norm(e).y] : []))) {
        autoSelect();                                                                                                   // 아무것도 지우지 않은 톡 → 선택·이동
      } else if (c.kind === 'pen' || c.kind === 'hl') {
        var p = c.p; if (p.length < 4) p = [p[0], p[1], p[0] + 0.0005, p[1]];
        if (c.straight && p.length > 4) p = p.slice(0, 2).concat(p.slice(-2));
        p = limitPoints(p, 1400);
        var it = { id: c.id, t: c.kind, pg: S.page, c: c.color, w: r4(clamp(c.w, 0.0005, 0.06)), p: p };
        if (c.straight) it.line = 1;
        addLocal(S.layer, it); S.placed = true;
      } else if (c.kind === 'fbox') {
        var fb = c.item; fb.w = 0.01; fb.h = 0.01;
        adopt(S.layer, addLocal(S.layer, fb)); S.placed = true;
      } else if (c.kind === 'sym') { var s = c.item; if (s.w2 == null) delete s.w2; if (s.f == null) delete s.f; adopt(S.layer, addLocal(S.layer, s)); S.placed = true; }
      else if (c.kind === 'textpos') { openEditor(c.x, c.y); }
      if (S.tapDown && e.pointerType === 'pen') {                                                                        // 펜으로 짧게 톡 친 것을 기억 (두 번째 톡이 오면 전환)
        var d0 = S.tapDown; S.tapDown = null;
        if (e.type === 'pointerup' && Date.now() - d0.t < 260 && Math.hypot(e.clientX - d0.x, e.clientY - d0.y) < 10 && (c.kind === 'pen' || c.kind === 'hl' || c.kind === 'erase')) S.tapLast = { t: Date.now(), x: d0.x, y: d0.y, before: d0.seq, after: S.seq, tool: S.tool };
        else S.tapLast = null;
      }
      invalidate();
    }

    /* ---- 글자 · 코드 입력칸 ---- */
    function openEditor(x, y, existing, layerOf) {
      closeEditor(false);
      var r = cv.getBoundingClientRect(), hr = host.getBoundingClientRect(), chord = S.tool === 'chord' || (existing && existing.chord);
      var px = Math.max(12, (existing ? existing.sz : S.textSize) * S.W);
      var box = document.createElement('div'); box.className = 'an-editor';
      box.style.left = (r.left - hr.left + x * r.width) + 'px'; box.style.top = (r.top - hr.top + y * r.height - px) + 'px';
      var inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 200; inp.className = 'an-input' + (chord ? ' chord' : '');
      inp.value = existing ? existing.s : '';
      inp.placeholder = chord ? '코드 (예: G/B)' : '글자'; inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('spellcheck', 'false');
      box.appendChild(inp);
      if (chord) {
        var bar = document.createElement('div'); bar.className = 'an-chordbar';
        CHORD_KEYS.forEach(function (k) { var b = document.createElement('button'); b.type = 'button'; b.textContent = k; b.className = 'an-ck';
          b.addEventListener('pointerdown', function (ev) { ev.preventDefault(); var s = inp.selectionStart == null ? inp.value.length : inp.selectionStart; inp.value = inp.value.slice(0, s) + k + inp.value.slice(inp.selectionEnd == null ? s : inp.selectionEnd); inp.focus(); try { inp.setSelectionRange(s + k.length, s + k.length); } catch (e) {} });
          bar.appendChild(b); });
        box.appendChild(bar);
      }
      host.appendChild(box);
      S.editor = { box: box, inp: inp, x: x, y: y, chord: !!chord, existing: existing || null, layer: layerOf || S.layer, done: false,
        color: existing ? existing.c : S.color, font: existing ? fontOf(existing) : S.font, sz: existing ? existing.sz : S.textSize, colorSet: false, fontSet: false, szSet: false };
      paintEditor();
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); closeEditor(true); } else if (ev.key === 'Escape') { ev.preventDefault(); closeEditor(false); } ev.stopPropagation(); });
      inp.addEventListener('blur', function () {
        setTimeout(function () {
          if (!(S.editor && S.editor.inp === inp)) return;
          var a = doc0().activeElement;
          if (a === inp) return;                                                       // 다시 입력칸으로 돌아왔음
          if (o.keepEditor && a && o.keepEditor(a)) return;            // 색 · 글꼴 · 크기 조절 칸을 만지는 중이면 입력을 끝내지 않음
          closeEditor(true);
        }, 120);
      });
      try { inp.focus(); } catch (e) {}
      setTimeout(function () { try { if (S.editor && S.editor.inp === inp && doc0().activeElement !== inp) inp.focus(); } catch (e) {} }, 0);
    }
    /** 입력칸 미리보기 — 지금 고른 색 · 글꼴 · 크기 그대로 (확정된 글자와 같은 모양). 흰색은 흰 바탕에서 안 보이므로 칸 배경을 어둡게 */
    function isLight(c) { var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ''); return !!m && (parseInt(m[1], 16) * 0.3 + parseInt(m[2], 16) * 0.59 + parseInt(m[3], 16) * 0.11) > 200; }
    function paintEditor() {
      var ed = S.editor; if (!ed) return; var st = ed.inp.style, px = Math.max(12, ed.sz * S.W);
      st.setProperty('color', ed.color, 'important'); st.setProperty('-webkit-text-fill-color', ed.color, 'important'); st.setProperty('caret-color', ed.color, 'important');
      st.fontFamily = FONTS[ed.font] || FONTS.sans; st.fontSize = px + 'px'; st.background = isLight(ed.color) ? 'rgba(40,40,48,.94)' : 'rgba(255,255,255,.96)';
      ed.box.style.top = (parseFloat(ed.box.style.top) || 0) + 'px';
    }
    function closeEditor(commit) {
      var ed = S.editor; if (!ed || ed.done) return; ed.done = true; S.editor = null;
      var txt = ed.inp.value.replace(/\s+$/, ''); try { ed.box.remove(); } catch (e) {}
      if (!commit || !txt.trim()) { if (commit && ed.existing && !txt.trim()) { var t = take(ed.layer, ed.existing.id); if (t) record({ op: 'del', layer: ed.layer, item: t }); } return; }
      if (ed.existing) {
        if (ed.existing.s === txt && !ed.colorSet && !ed.fontSet && !ed.szSet) return;
        var before = ed.existing, after = Object.assign({}, before, { s: txt.slice(0, 200), ts: Date.now() });
        if (ed.colorSet) after.c = ed.color;
        if (ed.fontSet) { if (ed.font === 'sans') delete after.f; else after.f = ed.font; }
        if (ed.szSet) after.sz = ed.sz;
        put(ed.layer, after); record({ op: 'edit', layer: ed.layer, before: before, after: after }); S.placed = true;
      } else {
        S.placed = true;
        adopt(ed.layer, addLocal(ed.layer, { id: newId(), t: 'text', pg: S.page, c: ed.color, x: r4(ed.x), y: r4(ed.y), sz: ed.sz, s: txt.slice(0, 200), chord: ed.chord ? 1 : undefined, f: ed.font !== 'sans' ? ed.font : undefined }));
      }
    }
    /** 글자 도구로 기존 글자를 누르면 고치기 */
    var origUp = onUp;
    onUp = function (e) {
      var c = S.cur;
      if (c && c.kind === 'textpos' && e.type !== 'pointercancel') {
        var px = c.x * S.W, py = c.y * S.H, found = null, fl = null;
        ['mine', 'team'].forEach(function (ly) { if (!S.vis[ly]) return; pageItems(ly, S.page).forEach(function (it) { if (it.t === 'text' && hit(it, px, py, S.W, S.H, 4)) { found = it; fl = ly; } }); });
        if (found) { S.cur = null; try { cv.releasePointerCapture(e.pointerId); } catch (x) {} if (canModify(fl, found)) openEditor(found.x, found.y, found, fl); else say('다른 사람이 쓴 글자는 고칠 수 없습니다.', true); return; }
      }
      origUp(e);
    };
    cv.addEventListener('pointermove', function (e) {                                                            // 마우스를 올렸을 때: 손잡이는 손가락 · 크기 화살표, 몸통은 이동 커서
      if (S.cur || e.pointerType !== 'mouse' || !S.sel || !drawing()) return;
      var r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, h = handleAt(px, py, false);
      cv.style.cursor = h === 'del' ? 'pointer' : h === 'size' ? 'nwse-resize' : h === 'edit' ? 'pointer' : inSelBox(px, py, false) ? 'move' : toolCursor();
    });
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', function (e) { onUp(e); }); cv.addEventListener('pointercancel', function (e) { onUp(e); });
    cv.addEventListener('contextmenu', function (e) { if (drawing()) e.preventDefault(); });
    /* 아이패드 · 폰: 그리는 동안 글자 선택 · 스크롤 · 확대가 끼어들어 필기가 끊기는 것을 막습니다 (그리는 캔버스에만 적용) */
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (n) {
      cv.addEventListener(n, function (e) { if (drawing() && e.cancelable) e.preventDefault(); }, { passive: false });
    });
    cv.addEventListener('selectstart', function (e) { if (drawing()) e.preventDefault(); });
    cv.addEventListener('dragstart', function (e) { e.preventDefault(); });
    ensureWebFonts(function () { invalidate(); });
    refreshTouch();

    /* ---- 바깥에서 부르는 함수 ---- */
    var api = {
      resize: function (cssW, cssH) {
        S.dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
        S.W = Math.max(1, Math.round(cssW)); S.H = Math.max(1, Math.round(cssH));
        var pw = Math.round(S.W * S.dpr), ph = Math.round(S.H * S.dpr);
        if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }            // 크기가 그대로면 캔버스를 다시 만들지 않습니다 (메모리 · 깜빡임 절약)
        var sw = S.W + 'px', sh = S.H + 'px'; if (cv.style.width !== sw) cv.style.width = sw; if (cv.style.height !== sh) cv.style.height = sh;
        rectC = null; invalidate();
      },
      setPage: function (n) { n = Math.max(1, n | 0); if (n === S.page) { invalidate(); return; } closeEditor(true); S.page = n; dropCur(); S.sel = null; S.fresh = null; freeBase(); invalidate(); },      // 같은 쪽을 다시 그릴 때(확대·창 크기)는 쓰던 획을 끊지 않음
      setTool: function (t) { closeEditor(true); S.placed = false; S.tool = ['none', 'pen', 'hl', 'select', 'text', 'chord', 'sym', 'fbox', 'eraser'].indexOf(t) >= 0 ? t : 'none'; dropCur(); if (S.fresh) { S.sel = null; S.fresh = null; }      /* 방금 만들어서 자동 선택된 것은 도구를 바꾸면 선택을 풀어 예전처럼 */
      if (S.tool !== 'select' && S.tool !== 'text' && S.tool !== 'chord' && S.tool !== 'sym' && S.tool !== 'fbox') { S.sel = null; S.fresh = null; } changed(); refreshTouch(); invalidate(); },
      setColor: function (c) {
        if (!/^#[0-9a-f]{6}$/i.test(c)) return;
        if (S.tool === 'hl') S.hlColor = c; else S.color = c;
        if (S.editor && S.tool !== 'hl') { S.editor.color = c; S.editor.colorSet = true; paintEditor(); }          // 글자를 치는 도중에 색을 바꿔도 입력칸이 바로 그 색으로
      },
      setFont: function (f) { if (!FONTS[f]) return; S.font = f; if (S.editor) { S.editor.font = f; S.editor.fontSet = true; paintEditor(); } },
      focusEditor: function () { try { if (S.editor) S.editor.inp.focus(); } catch (e) {} },
      setHlColor: function (c) { if (/^#[0-9a-f]{6}$/i.test(c)) S.hlColor = c; },
      setWidth: function (w) { w = +w; if (w > 0) { if (S.tool === 'hl') S.hw = clamp(w, 0.005, 0.06); else S.pw = clamp(w, 0.0008, 0.02); } },
      setSymbol: function (k) { if (SYMBOLS.some(function (s) { return s.k === k; })) { S.sym = k; S.placed = false; } },   // 새 기호를 고르면 또 놓으려는 것 — 자동 선택·이동은 다시 한 번 쓴 뒤부터
      flashTags: function (keys, ms) { return flashTags(keys, ms); },
      setFboxTag: function (k) { k = String(k || '').slice(0, 8); if (/^[A-Za-z0-9\u3131-\uD7A3]{1,8}$/.test(k)) { S.fboxTag = k; S.placed = false; } }, setFboxSize: function (v) { S.fboxSize = clamp(+v || 0.028, 0.012, 0.06); },
      setSymSize: function (s) { S.symSize = clamp(+s || 0.032, 0.012, 0.12); }, setTextSize: function (s) { S.textSize = clamp(+s || 0.024, 0.012, 0.08); if (S.editor) { S.editor.sz = S.textSize; S.editor.szSet = true; paintEditor(); } },
      setLayer: function (ly) { if (ly === 'team' || ly === 'mine') S.layer = ly; },
      setVisible: function (ly, on) { S.vis[ly] = !!on; invalidate(); },
      setPenMode: function (m) { S.penMode = m === 'always' || m === 'off' ? m : 'auto'; refreshTouch(); },
      setPenTap: function (on) { S.penTap = !!on; S.tapLast = null; S.tapDown = null; }, penTap: function () { return !!S.penTap; },
      swapPenEraser: function () { return swapPenEraser('button'); },
      setSawPen: function (b) { S.sawPen = !!b; refreshTouch(); },
      setStraight: function (b) { S.straight = !!b; },
      setAutoSelect: function (b) { S.autoSel = !!b; }, autoSelect: function () { return !!S.autoSel; },
      setPerms: function (me, canEdit) { S.me = me || S.me; S.canEdit = !!canEdit; },
      setItems: function (ly, items) { var m = new Map(); (items || []).forEach(function (i) { if (i && i.id) m.set(i.id, i); }); S.layers[ly] = m; S.hist = S.hist.filter(function (h) { return h.layer !== ly; }); invalidate(); changed(); },
      remoteAdd: function (ly, it) { S.layers[ly].set(it.id, it); S.live.delete(it.id); invalidate(); changed(); },
      remoteDel: function (ly, id) { S.layers[ly].delete(id); invalidate(); changed(); },
      remoteClear: function (ly, ids) { (ids || []).forEach(function (id) { S.layers[ly].delete(id); }); invalidate(); changed(); },
      remoteLive: function (m) { if (!m || !m.id) return; var old = S.live.get(m.id); S.live.set(m.id, { id: m.id, t: m.t, pg: m.pg, c: m.c, w: m.w, p: m.p, by: m.by, at: Date.now() }); invalidate(true); },
      undo: undo, redo: redo,
      /** 그리던 획 · 옮기던 항목을 저장하지 않고 버림 (손가락 두 개로 확대를 시작할 때) */
      cancelCurrent: function () { if (!S.cur) return false; dropCur(); invalidate(); return true; },
      /** 선택한 항목 (없으면 null) — 화면 도구줄이 크기 · 글꼴 칸을 맞추는 데 씁니다 */
      selected: function () { var it = selItem(); return it ? { layer: S.sel.layer, id: it.id, t: it.t, by: it.by || '', ts: it.ts || 0, sz: it.sz, f: it.f, c: it.c, s: it.s, chord: it.chord, canModify: canModify(S.sel.layer, it) } : null; },
      select: function (layer, id) { if (S.layers[layer] && S.layers[layer].get(id)) { S.sel = { layer: layer, id: id }; invalidate(); changed(); return true; } return false; },
      deselect: function () { if (S.sel) { S.sel = null; S.fresh = null; invalidate(); changed(); } },
      deleteSelected: function () {
        var it = selItem(); if (!it) return false;
        if (!canModify(S.sel.layer, it)) { say('다른 사람이 쓴 필기는 지울 수 없습니다.', true); return false; }
        var ly = S.sel.layer, t = take(ly, it.id); S.sel = null; S.fresh = null; if (t) record({ op: 'del', layer: ly, item: t }); return !!t;
      },
      /** 선택 항목 고치기 — patch: { sz, f, c } 중 필요한 것만. 되돌리기 가능 · 같은 자리에서 실시간 전파 */
      editSelected: function (patch) {
        var it = selItem(); if (!it || !patch) return false;
        var ly = S.sel.layer; if (!canModify(ly, it)) { say('다른 사람이 쓴 필기는 고칠 수 없습니다.', true); return false; }
        var after = Object.assign({}, it, { ts: Date.now() }), rng = SZ_RANGE[it.t] || SZ_RANGE.text, ch = false;
        if (patch.sz != null && isFinite(+patch.sz)) { var nz = r4(clamp(+patch.sz, rng[0], rng[1])); if (nz !== it.sz) { after.sz = nz; ch = true; } }
        if (patch.f != null && it.t === 'text' && FONTS[patch.f]) { if (patch.f === 'sans') { if (after.f != null) { delete after.f; ch = true; } } else if (after.f !== patch.f) { after.f = patch.f; ch = true; } }
        if (patch.c != null && /^#[0-9a-f]{6}$/i.test(patch.c) && after.c !== patch.c) { after.c = patch.c; ch = true; }
        if (!ch) return false;
        put(ly, after); record({ op: 'edit', layer: ly, before: it, after: after }); return true;
      },
      /** 악보 위(캔버스 밖)에서 시작된 펜슬 입력을 지금 막 켠 필기 도구로 이어받아 첫 획부터 그립니다 — 도구 "이동"에서 펜슬로 바로 쓰기 (practice.js) */
      beginExternal: function (e) { if (!S.dead && e && e.pointerType === 'pen' && drawing()) onDown(e); },
      /** 손가락으로 그려지는 상태인가 (펜만 그림 모드에서는 손가락이 화면 밀기 · 넘기기 · 확대에 쓰임) */
      fingerDraws: function () { return !(S.penMode === 'always' || (S.penMode === 'auto' && S.sawPen)); },
      clearPage: function (ly, all) {
        var ids = [], gone = [];
        pageItems(ly, S.page).forEach(function (it) { if (mine(it) || ly === 'mine' || (all && S.canEdit)) { ids.push(it.id); gone.push(it); } });
        if (!gone.length) { say('현재 페이지에 지울 필기가 없습니다.'); return 0; }
        gone.forEach(function (it) { S.layers[ly].delete(it.id); });
        record({ op: 'clear', layer: ly, items: gone }); invalidate(); changed();
        try { o.onClear && o.onClear(ly, ids, S.page, !!all); } catch (e) {}
        return gone.length;
      },
      items: function (ly) { return Array.from(S.layers[ly].values()); },
      /* V842 — 필기 기록: 쓴 사람별 개수 · 쪽 · 마지막 시각 / 이름표 보이기 / 한 사람 필기만 보기 */
      authors: function () {
        var m = {}; ['team', 'mine'].forEach(function (ly) { S.layers[ly].forEach(function (it) {
          var k = it.by || ''; var a = m[k] || (m[k] = { name: k, n: 0, pages: {}, last: 0, mine: 0 });
          a.n++; a.pages[it.pg] = (a.pages[it.pg] || 0) + 1; if ((+it.ts || 0) > a.last) a.last = +it.ts || 0; if (ly === 'mine') a.mine++;
        }); });
        return Object.keys(m).map(function (k) { var a = m[k]; a.pages = Object.keys(a.pages).map(Number).sort(function (x, y) { return x - y; }); return a; }).sort(function (x, y) { return y.last - x.last; });
      },
      setShowAuthors: function (b) { S.showBy = !!b; S.dirty = true; invalidate(); }, showAuthors: function () { return !!S.showBy; },
      setAuthorFilter: function (name) { S.byFilter = name ? String(name) : null; S.dirty = true; S.baseOk = false; invalidate(); }, authorFilter: function () { return S.byFilter || null; },
      ago: ago,
      count: function (pg) { var n = 0; ['team', 'mine'].forEach(function (ly) { S.layers[ly].forEach(function (i) { if (pg == null || i.pg === pg) n++; }); }); return n; },
      drawPage: drawPage,
      state: function () { return { fboxTag: S.fboxTag, cur: S.cur ? S.cur.kind : null, ed: !!S.editor, tool: S.tool, sel: S.sel ? { layer: S.sel.layer, id: S.sel.id } : null, layer: S.layer, page: S.page, color: S.color, font: S.font, textSize: S.textSize, symSize: S.symSize, edColor: S.editor ? S.editor.color : null, sawPen: S.sawPen, canUndo: S.hist.length > 0, canRedo: S.redo.length > 0, vis: Object.assign({}, S.vis), penMode: S.penMode }; },
      redraw: redraw, closeEditor: function () { closeEditor(true); },
      destroy: function () { S.dead = true; if (S.raf && typeof cancelAnimationFrame === 'function') { try { cancelAnimationFrame(S.raf); } catch (e) {} } S.raf = 0; if (S.liveTimer) { clearTimeout(S.liveTimer); S.liveTimer = 0; } freeBase(); S.live.clear(); closeEditor(false); try { cv.remove(); } catch (e) {} }
    };
    return api;
  }

  return { create: create, newId: newId, simplify: simplify, limitPoints: limitPoints, drawItem: drawItem, hit: hit, symBox: symBox,
    SYMBOLS: SYMBOLS, FBOX_TAGS: FBOX_TAGS, FBOX_NAMES: FBOX_NAMES, fboxLabel: fboxLabel, PALETTE: PALETTE, COLOR_NAMES: COLOR_NAMES, FONTS: FONTS, FONT_KEYS: FONT_KEYS, FONT_NAMES: FONT_NAMES, GLYPHS: GLYPHS, HL_COLORS: HL_COLORS, STRETCH: STRETCH, CHORD_KEYS: CHORD_KEYS };
}));
