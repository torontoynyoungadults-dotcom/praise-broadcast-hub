/**
 * 송폼 만들기 — 버튼을 눌러 곡의 진행 순서를 만듭니다 (V1 → C → V2 → C → B …)
 * ------------------------------------------------------------
 * · 저장 형식은 예전 그대로 글자 한 줄입니다 ("V1-C-V2-C-B-C") — 이미 입력해 둔 송폼도 그대로 읽습니다.
 * · 모르는 표기(예: "Tag2", "간주")도 버리지 않고 그대로 보관합니다.
 * · 연습 모드에서는 같은 순서가 큐 버튼이 됩니다 (누르면 그 구간을 박자에 맞춰 안내).
 * 브라우저와 Node(시험) 양쪽에서 쓰는 파일입니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNForm = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* k: 저장되는 표기 · ko: 한글 이름 · cue: 음성 안내(영어) · cueKo: 음성 안내(한국어) · g: 묶음 */
  var TOKENS = [
    { k: 'Intro', ko: '인트로', cue: 'Intro', cueKo: '인트로', g: 'main' },
    { k: 'V', ko: '절', cue: 'Verse', cueKo: '절', g: 'main' },
    { k: 'PC', ko: '프리코러스', cue: 'Pre-chorus', cueKo: '프리코러스', g: 'main' },
    { k: 'C', ko: '후렴', cue: 'Chorus', cueKo: '후렴', g: 'main' },
    { k: 'B', ko: '브릿지', cue: 'Bridge', cueKo: '브릿지', g: 'main' },
    { k: 'Itld', ko: '간주', cue: 'Interlude', cueKo: '간주', g: 'main' },
    { k: 'Out', ko: '아웃트로', cue: 'Ending', cueKo: '엔딩', g: 'main' },
    { k: 'V1', ko: '1절', cue: 'Verse 1', cueKo: '1절', g: 'num' },
    { k: 'V2', ko: '2절', cue: 'Verse 2', cueKo: '2절', g: 'num' },
    { k: 'V3', ko: '3절', cue: 'Verse 3', cueKo: '3절', g: 'num' },
    { k: 'PC2', ko: '프리코러스 2', cue: 'Pre-chorus 2', cueKo: '프리코러스 2', g: 'num' },
    { k: 'C2', ko: '후렴 2', cue: 'Chorus 2', cueKo: '후렴 2', g: 'num' },
    { k: 'C3', ko: '후렴 3', cue: 'Chorus 3', cueKo: '후렴 3', g: 'num' },
    { k: 'B1', ko: '브릿지 1', cue: 'Bridge 1', cueKo: '브릿지 1', g: 'num' },
    { k: 'B2', ko: '브릿지 2', cue: 'Bridge 2', cueKo: '브릿지 2', g: 'num' },
    { k: 'Vamp', ko: '뱀프', cue: 'Vamp', cueKo: '뱀프', g: 'etc' },
    { k: 'Solo', ko: '솔로', cue: 'Solo', cueKo: '솔로', g: 'etc' },
    { k: 'Inst', ko: '연주', cue: 'Instrumental', cueKo: '연주', g: 'etc', call: 'inst' },
    { k: 'Break', ko: '브레이크', cue: 'Break', cueKo: '브레이크', g: 'dyn', call: 'break' },
    { k: 'Tag', ko: '태그', cue: 'Tag', cueKo: '태그', g: 'rep', call: 'tag' },
    { k: 'Turn', ko: '턴어라운드', cue: 'Turnaround', cueKo: '턴어라운드', g: 'etc' },
    { k: 'Coda', ko: '코다', cue: 'Coda', cueKo: '코다', g: 'etc' },
    { k: 'End', ko: '끝', cue: 'End', cueKo: '끝', g: 'etc' },
    { k: 'Prayer', ko: '기도', cue: 'Prayer', cueKo: '기도', g: 'rep', call: 'prayer' },
    { k: 'KeyUp', ko: '키 업', cue: 'Key Up', cueKo: '키 업', g: 'rep', call: 'keyup' },       // Step 2.12
    /* V838 — 콜아웃 칸: 송폼 중간중간에 넣어 두면 Enter 로 순서대로 불립니다. 저장되는 글자는 짧게(RepC …), 화면에는 부르는 말(Repeat Chorus)이 보입니다.
       call = 메트로놈 큐 id (public/worship/metro.js 의 CUES) */
    { k: 'RepC', ko: '코러스 반복', cue: 'Repeat Chorus', cueKo: '코러스 반복', g: 'rep', call: 'repc' },
    { k: 'HalfC', ko: '코러스 반', cue: 'Half Chorus', cueKo: '코러스 반', g: 'rep', call: 'halfc' },
    { k: 'LastL', ko: '마지막 줄 한 번 더', cue: 'Last line again', cueKo: '마지막 줄 한 번 더', g: 'rep', call: 'lastl' },
    { k: 'Once', ko: '한 번 더', cue: 'One more time', cueKo: '한 번 더', g: 'rep', call: 'once' },
    { k: 'OneBar', ko: '한마디 더', cue: 'One more bar', cueKo: '한마디 더', g: 'rep', call: 'onebar' },
    { k: 'LastC', ko: '마지막 후렴', cue: 'Last Chorus', cueKo: '마지막 후렴', g: 'rep', call: 'lastc' },
    { k: 'VOnly', ko: '보컬만', cue: 'Voice only', cueKo: '보컬만', g: 'dyn', call: 'vonly' },
    { k: 'Drums', ko: '드럼만', cue: 'Drums only', cueKo: '드럼만', g: 'dyn', call: 'drums' },
    { k: 'Build', ko: '빌드 업', cue: 'Build up', cueKo: '빌드 업', g: 'dyn', call: 'build' },
    { k: 'Down', ko: '점점 작게', cue: 'Die down', cueKo: '점점 작게', g: 'dyn', call: 'die' },
    { k: 'Ferm', ko: '늘임표', cue: 'Fermata', cueKo: '늘임표', g: 'dyn', call: 'ferm' },
    { k: 'Slow', ko: '느리게', cue: 'Slow down', cueKo: '느리게', g: 'dyn', call: 'slow' },
    { k: 'Hold', ko: '홀드', cue: 'Hold', cueKo: '홀드', g: 'dyn', call: 'hold' },
    { k: 'BigEnd', ko: '크게 끝내기', cue: 'Big ending', cueKo: '크게 끝내기', g: 'dyn', call: 'bigend' }
  ];
  var BY = {};
  TOKENS.forEach(function (t) { BY[t.k.toLowerCase()] = t; });

  /* 자주 쓰는 다른 표기 → 표준 표기 */
  var ALIAS = {
    verse: 'V', 'verse1': 'V1', 'verse2': 'V2', 'verse3': 'V3', chorus: 'C', 'chorus2': 'C2', 'chorus3': 'C3',
    bridge: 'B', 'bridge1': 'B1', 'bridge2': 'B2', prechorus: 'PC', 'pre': 'PC', 'pre-chorus': 'PC', 'prechorus2': 'PC2',
    interlude: 'Itld', inter: 'Itld', 'int': 'Itld', outro: 'Out', ending: 'Out', 'instrumental': 'Inst',
    'turnaround': 'Turn', '기도': 'Prayer', 'pray': 'Prayer', '키업': 'KeyUp', 'keyup': 'KeyUp', 'keychange': 'KeyUp', '인트로': 'Intro', '후렴': 'C', '브릿지': 'B', '간주': 'Itld', '엔딩': 'Out', '뱀프': 'Vamp', '솔로': 'Solo'
  };

  var REP = /^(.+?)\s*[x×*]\s*(\d{1,2})$/i;
  var BARS = /^(.+?)\s*(?::|\()\s*(\d{1,2})\s*(?:마디|bars?)?\s*\)?$/i;      // "C:8" · "C(8)" · "C:8마디" — 그 칸의 마디 수 (1 ~ 64)
  var CUSTOM_MAX = 24;
  function clampBars(n) { n = Math.round(Number(n)); return n >= 1 && n <= 64 ? n : 0; }

  function norm(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    var rep = 1, bars = 0, m = REP.exec(s);
    if (m) { s = m[1].trim(); rep = Math.min(9, Math.max(1, Number(m[2]))); }
    m = BARS.exec(s);
    if (m) { s = m[1].trim(); bars = clampBars(m[2]); }
    var key = s.toLowerCase().replace(/\s+/g, '');
    var t = BY[key] || (ALIAS[key] && BY[ALIAS[key].toLowerCase()]);
    // 1절 · 2절 처럼 한글 번호 표기
    if (!t) { var ko = /^(\d)절$/.exec(s); if (ko && BY['v' + ko[1]]) t = BY['v' + ko[1]]; }
    var out = { k: t ? t.k : s.slice(0, CUSTOM_MAX), rep: rep };
    if (bars) out.bars = bars;
    if (!t) out.custom = true;
    return out;
  }

  /** "V1-C-V2×2-B" → [{k:'V1',rep:1}, …] — 구분은 - , 공백 > → 등 무엇이든 */
  function parse(str) {
    str = String(str == null ? '' : str).trim();
    // 1) 쉼표 · 하이픈 · 화살표 등으로 나눈 것을 우선합니다 ("Verse 1 > Chorus ×2" 처럼 칸 안에 공백이 있어도 됨)
    var parts = str.split(/\s*[,\-–—>→·|/]+\s*/).filter(function (x) { return x.trim(); });
    // 2) 공백뿐이면 단어 단위로 나누되, "Verse 1" · "Chorus x2" 는 한 덩어리로 묶습니다
    // (직접 입력한 글이 공백을 포함해 한 칸뿐이면 — 마디 수 표기가 있거나 한글이고 모르는 단어가 섞여 있으면 — 쪼개지 않고 한 칸으로 둡니다)
    var keepWhole = parts.length === 1 && /[:(가-힣]/.test(parts[0]) && parts[0].split(/\s+/).some(function (w) { var n = norm(w); return !n || n.custom; }) && !/^\d절\b/.test(parts[0]);
    if (parts.length === 1 && /\s/.test(parts[0]) && !keepWhole) {
      var words = parts[0].split(/\s+/), merged = [];
      words.forEach(function (w) {
        var last = merged[merged.length - 1];
        if (last != null && ((/^\d$/.test(w) && /^[A-Za-z]{2,}$/.test(last) && ALIAS[last.toLowerCase()]) || /^[x×*]\d{1,2}$/i.test(w))) merged[merged.length - 1] = last + ' ' + w;
        else merged.push(w);
      });
      parts = merged;
    }
    return parts.map(norm).filter(Boolean);
  }
  function stringify(list) {
    return (list || []).map(function (t) { return t.k + (t.bars ? ':' + t.bars : '') + (t.rep > 1 ? '×' + t.rep : ''); }).join('-');
  }
  function info(k) { return BY[String(k || '').toLowerCase()] || null; }
  /** 화면에 보이는 이름 — 콜아웃 칸(RepC · VOnly …)은 부르는 말(Repeat Chorus · Voice only), 나머지는 저장된 글자 그대로 */
  var CALL_ONLY = { repc: 1, halfc: 1, lastl: 1, once: 1, onebar: 1, lastc: 1, vonly: 1, drums: 1, build: 1, down: 1, ferm: 1, slow: 1, hold: 1, bigend: 1 };
  function disp(k) { var t = info(k); return t && CALL_ONLY[t.k.toLowerCase()] ? t.cue : String(k); }
  function isCall(k) { var t = info(k); return !!(t && t.call && (t.g === 'rep' || t.g === 'dyn')); }
  function label(k, lang) {
    var t = info(k);
    return t ? (lang === 'ko' ? t.ko : t.k) : String(k);
  }
  /** 음성으로 안내할 말 — 영어 기본, lang 'ko' 면 한국어 */
  function cueFor(k, lang) {
    var t = info(k);
    if (!t) return String(k);
    if (lang !== 'ko') return t.cue;
    if (t.k === 'V') return '절';
    return t.cueKo;
  }
  /** 몇 번째 자리인지 알 수 있게 — "V1" 이 없고 "V" 만 있으면 등장 순서대로 Verse 1, 2 … */
  function numbered(list) {
    var seen = {};
    return (list || []).map(function (t) {
      var out = { k: t.k, rep: t.rep, bars: t.bars || 0, custom: t.custom, cueKey: t.k };
      if (t.k === 'V') {                                   // V842 — 번호는 절(V)만: 그냥 "C" 는 몇 번째든 "Chorus" (C2 라고 적은 칸만 "Chorus 2")
        seen.V = (seen.V || 0) + 1;
        if (seen.V <= 3) out.cueKey = 'V' + seen.V;
      }
      return out;
    });
  }

  /* ============================================================
     화면 — 만들기 (곡 편집 화면)
     ============================================================ */
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var GROUPS = [['main', '기본'], ['num', '번호'], ['etc', '기타'], ['rep', '반복 콜아웃'], ['dyn', '다이내믹 콜아웃']];

  /**
   * 송폼 만들기 — el 안에 그립니다.
   *   var f = YNForm.mount(el, { value: 'V1-C', onChange: function (str, list) {} });
   *   f.get() / f.set('V1-C-V2') / f.destroy()
   */
  function mount(el, opt) {
    opt = opt || {};
    var list = parse(opt.value), sel = -1, undo = [], destroyed = false;
    function push() { undo.push(JSON.stringify(list)); if (undo.length > 60) undo.shift(); }
    function changed() {
      draw();
      if (opt.onChange) { try { opt.onChange(stringify(list), list.slice()); } catch (e) { if (window.console) console.error(e); } }
    }
    function add(k, bars) {
      push();
      var at = sel >= 0 ? sel + 1 : list.length;
      var t = { k: k, rep: 1 }; if (clampBars(bars)) t.bars = clampBars(bars);
      list.splice(at, 0, t);
      sel = at;
      changed();
    }
    /** 직접 입력 — 아무 글이나 한 칸으로 (예: "키 업", "기도", "마지막 줄 한 번 더"). 표준 이름이면 그 칸으로 바뀜 */
    function addCustom(text, bars) {
      var clean = String(text == null ? '' : text).replace(/[,\-–—>→·|/:()×*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();       // 칸을 나누는 기호는 공백으로
      if (!clean) return false;
      var t = norm(clean); if (!t) return false;
      push();
      if (clampBars(bars)) t.bars = clampBars(bars);
      var at = sel >= 0 ? sel + 1 : list.length; list.splice(at, 0, t); sel = at; changed(); return true;
    }
    function setBars(n) { if (sel < 0) return; push(); if (clampBars(n)) list[sel].bars = clampBars(n); else delete list[sel].bars; changed(); }
    var busy = false;                                                   // 다시 그리는 도중(입력칸이 사라지며 blur → change)에 또 그리지 않도록
    function draw() {
      if (destroyed || busy) return; busy = true;
      try { drawNow(); } finally { busy = false; }
    }
    function drawNow() {
      var seq = list.length ? list.map(function (t, i) {
        var inf = info(t.k);
        return '<span class="fb-chip' + (i === sel ? ' on' : '') + (t.custom ? ' custom' : '') + (isCall(t.k) ? ' call' : '') + '" role="button" tabindex="0" data-i="' + i + '" title="' + h(inf ? inf.ko : t.k) + '">' +
          '<b>' + h(disp(t.k)) + '</b>' + (t.bars ? '<em>' + t.bars + '마디</em>' : '') + (t.rep > 1 ? '<i>×' + t.rep + '</i>' : '') + '</span>';
      }).join('<span class="fb-arr" aria-hidden="true">›</span>') : '<span class="fb-empty">아래 버튼을 눌러 순서대로 넣어주세요</span>';
      var pal = GROUPS.map(function (g) {
        return '<div class="fb-row">' + (g[0] === 'rep' || g[0] === 'dyn' ? '<span class="fb-gl">' + h(g[1]) + '</span>' : '') + TOKENS.filter(function (t) { return t.g === g[0]; }).map(function (t) {
          return '<button type="button" class="fb-btn' + (t.g === 'rep' || t.g === 'dyn' ? ' call' : '') + '" data-add="' + t.k + '" title="' + h(t.ko) + '">' + h(disp(t.k)) + '</button>';
        }).join('') + '</div>';
      }).join('');
      el.innerHTML =
        '<div class="fb">' +
          '<div class="fb-seq" aria-label="송폼 순서">' + seq + '</div>' +
          '<div class="fb-tools">' +
            '<button type="button" class="fb-t" data-act="left"' + (sel > 0 ? '' : ' disabled') + ' aria-label="앞으로">‹ 앞으로</button>' +
            '<button type="button" class="fb-t" data-act="right"' + (sel >= 0 && sel < list.length - 1 ? '' : ' disabled') + ' aria-label="뒤로">뒤로 ›</button>' +
            '<button type="button" class="fb-t" data-act="rep"' + (sel >= 0 ? '' : ' disabled') + '>×2 반복</button>' +
            '<button type="button" class="fb-t" data-act="del"' + (sel >= 0 ? '' : ' disabled') + '>지우기</button>' +
            '<button type="button" class="fb-t" data-act="undo"' + (undo.length ? '' : ' disabled') + '>되돌리기</button>' +
            '<button type="button" class="fb-t" data-act="clear"' + (list.length ? '' : ' disabled') + '>모두 지우기</button>' +
          '</div>' +
          (sel >= 0 ? '<div class="fb-bars" role="group" aria-label="선택한 칸의 마디 수"><span>마디 수</span>' +
            [0, 2, 4, 8, 12, 16].map(function (n) { return '<button type="button" class="fb-t' + ((list[sel].bars || 0) === n ? ' on' : '') + '" data-bars="' + n + '">' + (n ? n : '없음') + '</button>'; }).join('') +
            '<input type="text" class="fb-num" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" maxlength="2" autocomplete="off" data-role="barsin" placeholder="직접" value="' + ([0, 2, 4, 8, 12, 16].indexOf(list[sel].bars || 0) < 0 ? list[sel].bars : '') + '" aria-label="마디 수 직접 입력"></div>' : '') +
          '<div class="fb-pal">' + pal + '</div>' +
          '<div class="fb-custom"><span>직접 입력</span><input type="text" class="fb-cin" maxlength="' + CUSTOM_MAX + '" autocomplete="off" data-role="cin" placeholder="예: 키 업 · 기도 · 마지막 줄 한 번 더 (한글은 한국어 음성으로 읽어줘요)">' +
            '<input type="text" class="fb-num" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" maxlength="2" autocomplete="off" data-role="cbars" placeholder="마디" aria-label="마디 수 (선택)">' +
            '<button type="button" class="fb-t primary" data-act="addcustom">＋ 넣기</button></div>' +
          '<p class="fb-hint">칩을 누르면 선택됩니다. 선택한 칩 뒤에 새 칸이 들어가고, 선택이 없으면 맨 끝에 붙습니다. 칩을 선택하면 "마디 수"(예: 4 · 8마디)를 붙일 수 있고, "직접 입력"에는 어떤 글이든 한 칸으로 넣을 수 있습니다.</p>' +
        '</div>';
    }
    function onClick(ev) {
      var t = ev.target.closest ? ev.target.closest('[data-i],[data-add],[data-act],[data-bars]') : null;
      if (!t || !el.contains(t)) return;
      if (t.hasAttribute('data-bars')) { setBars(Number(t.getAttribute('data-bars'))); return; }
      if (t.getAttribute('data-act') === 'addcustom') { var ci = el.querySelector('[data-role="cin"]'), cb = el.querySelector('[data-role="cbars"]'); if (!addCustom(ci && ci.value, cb && cb.value)) { if (ci) ci.focus(); } return; }
      if (t.hasAttribute('data-add')) { add(t.getAttribute('data-add')); return; }
      if (t.hasAttribute('data-i')) { var i = Number(t.getAttribute('data-i')); sel = (sel === i ? -1 : i); draw(); return; }
      var a = t.getAttribute('data-act');
      if (t.disabled) return;
      if (a === 'undo') { if (undo.length) { list = JSON.parse(undo.pop()); sel = Math.min(sel, list.length - 1); changed(); } return; }
      push();
      if (a === 'left' && sel > 0) { var x = list[sel]; list[sel] = list[sel - 1]; list[sel - 1] = x; sel--; }
      else if (a === 'right' && sel >= 0 && sel < list.length - 1) { var y = list[sel]; list[sel] = list[sel + 1]; list[sel + 1] = y; sel++; }
      else if (a === 'rep' && sel >= 0) list[sel].rep = list[sel].rep >= 2 ? 1 : 2;
      else if (a === 'del' && sel >= 0) { list.splice(sel, 1); sel = Math.min(sel, list.length - 1); }
      else if (a === 'clear') { list = []; sel = -1; }
      changed();
    }
    function onKey(ev) {
      var tg = ev.target, role = tg && tg.getAttribute && tg.getAttribute('data-role');
      if (ev.key === 'Enter' && (role === 'cin' || role === 'cbars')) { ev.preventDefault(); var ci = el.querySelector('[data-role="cin"]'), cb = el.querySelector('[data-role="cbars"]'); addCustom(ci && ci.value, cb && cb.value); return; }
      if (ev.key === 'Enter' && role === 'barsin') { ev.preventDefault(); setBars(tg.value); return; }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.getAttribute && ev.target.getAttribute('data-i') != null) { ev.preventDefault(); onClick(ev); }
    }
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    function onChange(ev) { if (busy) return; var tg = ev.target; if (tg && tg.getAttribute && tg.getAttribute('data-role') === 'barsin') setBars(tg.value); }
    el.addEventListener('change', onChange);
    draw();
    return {
      get: function () { return stringify(list); },
      list: function () { return list.slice(); },
      set: function (s) { list = parse(s); sel = -1; undo = []; draw(); },
      destroy: function () { destroyed = true; el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); el.removeEventListener('change', onChange); el.innerHTML = ''; }
    };
  }

  /**
   * 연주 중 송폼 — 칩을 누르면 onPick(토큰, 순서) 를 부르고, 지금 위치(current)를 밝게 보여줍니다.
   *   var p = YNForm.mountPlayer(el, { value: 'V1-C', lang: 'en', onPick: function (tok, i) {} });
   *   p.setCurrent(2) / p.next() / p.set('V1-C-V2')
   */
  function mountPlayer(el, opt) {
    opt = opt || {};
    var list = parse(opt.value), cur = -1, lang = opt.lang || 'en';
    function draw() {
      if (!list.length) { el.innerHTML = '<p class="fb-empty">이 곡에 송폼이 없습니다. 곡 수정에서 "송폼 만들기"로 넣어주세요.</p>'; return; }
      el.innerHTML = '<div class="fp">' + list.map(function (t, i) {
        var inf = info(t.k);
        return '<button type="button" class="fp-chip' + (isCall(t.k) ? ' call' : '') + (i === cur ? ' on' : (i < cur ? ' done' : '')) + '" data-i="' + i + '" title="' + h(inf ? inf.ko : t.k) + '">' +
          '<b>' + h(disp(t.k)) + '</b>' + (t.rep > 1 ? '<i>×' + t.rep + '</i>' : '') + (t.bars ? '<em>' + t.bars + '마디</em>' : '') + '<small>' + h(label(t.k, lang === 'ko' ? 'ko' : 'ko')) + '</small></button>';
      }).join('') + '</div>';
    }
    function onClick(ev) {
      var t = ev.target.closest ? ev.target.closest('[data-i]') : null;
      if (!t || !el.contains(t)) return;
      var i = Number(t.getAttribute('data-i'));
      cur = i; draw();
      if (opt.onPick) opt.onPick(list[i], i, numbered(list)[i]);
    }
    el.addEventListener('click', onClick);
    draw();
    return {
      set: function (s) { list = parse(s); cur = -1; draw(); },
      setCurrent: function (i) { cur = i; draw(); },
      next: function () { cur = Math.min(list.length - 1, cur + 1); draw(); return list[cur] || null; },
      list: function () { return list.slice(); },
      setLang: function (l) { lang = l; draw(); },
      destroy: function () { el.removeEventListener('click', onClick); el.innerHTML = ''; }
    };
  }

  /** 보기 좋게 — "V1:8-C×2" → "V1 (8마디) › C ×2" (허브 곡 카드 등 글로 보여줄 때) */
  function pretty(str) { return parse(str).map(function (t) { return disp(t.k) + (t.bars ? ' (' + t.bars + '마디)' : '') + (t.rep > 1 ? ' ×' + t.rep : ''); }).join(' › '); }

  return { pretty: pretty, disp: disp, isCall: isCall, TOKENS: TOKENS, parse: parse, stringify: stringify, info: info, label: label, cueFor: cueFor, numbered: numbered, mount: mount, mountPlayer: mountPlayer };
}));
