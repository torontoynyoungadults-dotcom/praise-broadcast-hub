/**
 * 코드 변환 · 오선 음높이 · 2성부 화음(알토 / 테너) 계산 — 순수 계산 모듈 (Step 13)
 * ------------------------------------------------------------
 *  화면(캔버스)을 전혀 건드리지 않는 계산만 모았습니다. 브라우저와 Node(시험) 양쪽에서 같은 파일을 씁니다.
 *  · 코드 기호 읽기 / 옮기기:  parseChord · transposeChord · chordsFromTokens(PDF 글자층 · OCR 낱말에서 코드만 골라냄)
 *  · 조(Key):                  parseKey · keySemitones · guessKey · keyUsesFlats
 *  · 오선 ↔ 음높이:            stepToMidi · midiToStep  (높은음자리표, 조표 반영. 아래 첫째 줄 = 미(E4) = step 0, 한 칸(선 → 간)마다 step +1)
 *  · 코드 붙이기:              assignChords (멜로디 음마다 "지금 울리는 코드"를 찾음)
 *  · 화음 만들기:              buildHarmony — 알토(3도 아래 · 위 6도) / 테너(아래 6도 · 옥타브 · 안쪽 화음음)를 코드음 안에서 고르고,
 *                              앞뒤 음과의 도약 · 병행 5도/8도 · 성부 겹침을 따져 전체 곡에서 가장 매끄러운 조합을 동적계획법으로 찾음
 *  · 미리듣기 일정:            buildSchedule — 멜로디 + 알토 + 테너 소리 시작 시각 · 길이 목록
 *  옛 브라우저(아이패드 사파리 포함)에서도 돌도록 ES5 문법만 씁니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNHarmony = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var LETTERS = 'CDEFGAB';
  var SHARP_ORDER = 'FCGDAEB', FLAT_ORDER = 'BEADGCF';
  var VOICE_RANGE = { alto: [55, 76], tenor: [48, 69], melody: [48, 88] };        // 소리 나는 높이(MIDI) 기준 — 알토 G3~E5 · 테너 C3~A4

  function mod(n, m) { return ((n % m) + m) % m; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function accOf(ch) { return (ch === '#' || ch === '♯') ? 1 : (ch === 'b' || ch === '♭') ? -1 : 0; }
  function midiName(m) { m = Math.round(m); return SHARP[mod(m, 12)] + (Math.floor(m / 12) - 1); }

  /* ============================================================ 조 (Key) */
  /** "G" "Bb" "F#m" "Em" "C minor" "A♭" → { tonic, minor, name, flats } · 못 읽으면 null */
  function parseKey(str) {
    var s = String(str == null ? '' : str).replace(/\(.*?\)/g, ' ').replace(/\bkey\b\s*(of)?/i, ' ').trim();
    var m = /^([A-Ga-g])\s*([#♯b♭]?)\s*(minor|major|maj|min|mi|m|-)?\s*$/.exec(s);
    if (!m) return null;
    var letter = m[1].toUpperCase(), acc = accOf(m[2]);
    var tonic = mod(LETTER_PC[letter] + acc, 12), minor = /^(minor|min|mi|m|-)$/.test(m[3] || '');
    var flats = acc < 0 ? true : acc > 0 ? false : (minor ? [2, 7, 0, 5].indexOf(tonic) >= 0 : tonic === 5);
    return { tonic: tonic, minor: minor, name: letter + (acc > 0 ? '#' : acc < 0 ? 'b' : '') + (minor ? 'm' : ''), flats: flats };
  }
  /** 이 조는 ♭ 표기를 쓰는가 (코드 이름을 ♭ 로 쓸지 ♯ 로 쓸지) */
  function keyUsesFlats(key) {
    if (!key) return false;
    if (key.name && /[b♭]/.test(key.name.slice(1)) ) return true;
    if (key.name && /#/.test(key.name)) return false;
    var rel = key.minor ? mod(key.tonic + 3, 12) : key.tonic;
    return [5, 10, 3, 8, 1].indexOf(rel) >= 0;
  }
  /** 조표: 으뜸음(+ 단조 여부) → 샵(+) / 플랫(−) 개수 */
  function sigCount(key) {
    var rel = key.minor ? mod(key.tonic + 3, 12) : key.tonic, flatTyped = keyUsesFlats(key);
    var table = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: flatTyped ? -6 : 6, 1: flatTyped ? -5 : 7, 8: -4, 3: -3, 10: -2, 5: -1 };
    return table[rel];
  }
  /** 조표가 붙이는 임시표: { F: 1, C: 1 … } (없으면 0) */
  function keySignature(key) {
    var n = key ? sigCount(key) : 0, sig = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 }, i;
    if (n > 0) for (i = 0; i < n; i++) sig[SHARP_ORDER[i]] = 1;
    else for (i = 0; i < -n; i++) sig[FLAT_ORDER[i]] = -1;
    return sig;
  }
  /** 원래 조 → 목표 조 반음 수 (가장 가까운 쪽: −5 ~ +6) */
  function keySemitones(from, to) {
    var a = typeof from === 'string' ? parseKey(from) : from, b = typeof to === 'string' ? parseKey(to) : to;
    if (!a || !b) return 0;
    var d = mod(b.tonic - a.tonic, 12); return d > 6 ? d - 12 : d;
  }
  function scalePcs(key) {
    var iv = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return iv.map(function (x) { return mod(key.tonic + x, 12); });
  }
  /** 이 조의 이름(화면 표시용) — 예: G · Bb · F#m */
  function keyName(key) { if (!key) return ''; return (keyUsesFlats(key) ? FLAT : SHARP)[key.tonic] + (key.minor ? 'm' : ''); }
  /** 12개 으뜸음 목록(화면의 조 선택용) — ♭ 이름을 기본으로 하되 F# 는 샵 */
  var KEY_CHOICES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  /** 코드 순서(파싱된 코드 목록)로 조를 짐작: 조에 맞는 코드가 많을수록 · 처음/마지막 코드가 으뜸화음일수록 점수가 높음 */
  function guessKey(chords) {
    var list = (chords || []).filter(function (c) { return c && typeof c.root === 'number'; });
    if (list.length < 2) return null;
    var best = null, cand = [], t, minor;
    for (t = 0; t < 12; t++) for (minor = 0; minor < 2; minor++) {
      var degMaj = { 0: 'M', 2: 'm', 4: 'm', 5: 'M', 7: 'M', 9: 'm', 11: 'd' };
      var degMin = { 0: 'm', 2: 'd', 3: 'M', 5: 'm', 7: 'mM', 8: 'M', 10: 'M' };
      var map = minor ? degMin : degMaj, s = 0;
      list.forEach(function (c) {
        var rel = mod(c.root - t, 12), want = map[rel];
        if (want == null) { s -= 0.7; return; }
        var q = c.triad === 'min' ? 'm' : c.triad === 'dim' ? 'd' : 'M';
        s += want.indexOf(q) >= 0 ? 1 : 0.35;
        if (rel === 0 || rel === 7 || rel === 5) s += 0.2;
      });
      var first = list[0], last = list[list.length - 1];
      if (last.root === t && (last.triad === 'min') === !!minor) s += 2.2; else if (last.root === t) s += 0.8;
      if (first.root === t && (first.triad === 'min') === !!minor) s += 1.4; else if (first.root === t) s += 0.5;
      if (minor) s -= 0.3;                                                       // 비슷하면 장조를 우선
      cand.push({ s: s, tonic: t, minor: !!minor });
    }
    cand.sort(function (a, b) { return b.s - a.s; }); best = cand[0];
    var key = { tonic: best.tonic, minor: best.minor, name: '', flats: false };
    key.flats = keyUsesFlats({ tonic: best.tonic, minor: best.minor, name: '' });
    key.name = keyName(key);
    return { key: key, score: best.s, margin: best.s - cand[1].s };
  }

  /* ---- V849 조 찾기: 악보에 적힌 "Key" 글자 · 조표 · 코드 흐름 · 곡 정보를 합쳐서 ---- */
  /** 글에서 "Key: G" · "Key - Bb" · "Key of D" · "KEY=F#m" · "(Key E)" · "키: A" 를 찾음 → parseKey 결과 | null */
  function findKeyText(text) {
    var t = String(text == null ? '' : text).replace(/[♯＃]/g, '#').replace(/♭/g, 'b');
    var re = /(?:^|[^A-Za-z])(?:original\s+)?(?:key|키)\s*(?:of|is|in)?\s*[:=\-–—]?\s*\(?\s*([A-Ga-g])\s?([#b]?)\s*(minor|major|min|maj|m)?(?![A-Za-z0-9#])/i, m = re.exec(t);
    if (!m) return null;
    var q = (m[3] || '').toLowerCase();
    return parseKey(m[1].toUpperCase() + m[2] + (q === 'm' || q === 'min' || q === 'minor' ? 'm' : ''));
  }
  /** 조표(샵 + · 플랫 −) 개수 → 그 조표의 장조 · 나란한조 */
  function keysForSig(n) {
    n = Math.round(+n) || 0; var maj = n >= 0 ? mod(7 * n, 12) : mod(5 * -n, 12);
    var M = { tonic: maj, minor: false, name: '', flats: n < 0 }, m = { tonic: mod(maj + 9, 12), minor: true, name: '', flats: n < 0 };
    M.name = keyName(M); m.name = keyName(m); return [M, m];
  }
  /** 코드 흐름으로 매긴 24개 조의 점수 (높은 순) */
  function rankKeys(chords) {
    var list = (chords || []).filter(function (c) { return c && typeof c.root === 'number'; }), cand = [], t, minor;
    if (!list.length) return [];
    for (t = 0; t < 12; t++) for (minor = 0; minor < 2; minor++) {
      var map = minor ? { 0: 'm', 2: 'd', 3: 'M', 5: 'm', 7: 'mM', 8: 'M', 10: 'M' } : { 0: 'M', 2: 'm', 4: 'm', 5: 'M', 7: 'M', 9: 'm', 11: 'd' }, sc = 0;
      list.forEach(function (c) {
        var rel = mod(c.root - t, 12), want = map[rel];
        if (want == null) { sc -= 0.7; return; }
        var q = c.triad === 'min' ? 'm' : c.triad === 'dim' ? 'd' : 'M';
        sc += want.indexOf(q) >= 0 ? 1 : 0.35;
        if (rel === 0 || rel === 7 || rel === 5) sc += 0.2;
      });
      var first = list[0], last = list[list.length - 1];
      if (last.root === t && (last.triad === 'min') === !!minor) sc += 2.2; else if (last.root === t) sc += 0.8;
      if (first.root === t && (first.triad === 'min') === !!minor) sc += 1.4; else if (first.root === t) sc += 0.5;
      if (minor) sc -= 0.3;
      cand.push({ s: sc, tonic: t, minor: !!minor });
    }
    return cand.sort(function (a, b) { return b.s - a.s; });
  }
  /**
   * 원래 조 정하기. o = { text: parseKey|null (악보의 Key 글자), sig: {n, conf}|null (조표), chords: [parseChord…], song: parseKey|null }
   *  1) 악보에 "Key" 가 적혀 있으면 그것  2) 조표를 읽었으면 그 조표의 장조 · 단조 중 코드 흐름에 더 맞는 쪽 (샵 · 플랫 없음은 코드와 맞을 때만)
   *  3) 코드 흐름이 뚜렷하면 그것  4) 곡 정보의 Key  5) C
   * 반환 { key, src: 'text' | 'sig' | 'chords' | 'song' | 'none' }
   */
  function fuseKey(o) {
    o = o || {};
    function fin(k) { var key = { tonic: k.tonic, minor: !!k.minor, name: '', flats: false }; key.flats = keyUsesFlats(key); key.name = keyName(key); return key; }
    if (o.text) return { key: fin(o.text), src: 'text' };
    var ranks = rankKeys(o.chords || []), scoreOf = function (k) { for (var i = 0; i < ranks.length; i++) if (ranks[i].tonic === k.tonic && ranks[i].minor === k.minor) return ranks[i].s; return -1e9; };
    var sig = o.sig;
    if (sig && sig.n != null && (sig.n !== 0 || (ranks.length >= 3 && ranks[0].tonic === 0 && !ranks[0].minor) || (ranks.length >= 3 && ranks[0].tonic === 9 && ranks[0].minor))) {
      var pair = keysForSig(sig.n), pick = pair[0];
      if (ranks.length >= 2 && scoreOf(pair[1]) > scoreOf(pair[0]) + 1) pick = pair[1];
      else if (!ranks.length && o.song && o.song.minor && o.song.tonic === pair[1].tonic) pick = pair[1];
      return { key: fin(pick), src: 'sig' };
    }
    if (ranks.length >= 3 && (ranks[0].s - ranks[1].s) > 0.25) return { key: fin(ranks[0]), src: 'chords' };
    if (o.song) return { key: fin(o.song), src: 'song' };
    if (ranks.length >= 2) return { key: fin(ranks[0]), src: 'chords' };
    return { key: fin({ tonic: 0, minor: false }), src: 'none' };
  }

  /* ============================================================ 코드 기호 */
  /* ============================================================ 코드 기호 (V849 — 텐션 · 변화 코드 전부)
     읽는 것: 장 · 단 · dim · aug · sus2/4 · 5(파워) · 6 · 6/9 · 7 · maj7 · mM7 · dim7 · m7b5(ø) · 9 · 11 · 13 · add2/4/6/9/11/13 ·
              b5 #5 b9 #9 #11 b13 (+ − 표기 · 괄호 · 쉼표 포함) · alt · omit3/no3 · omit5/no5 · 슬래시 베이스(G/B)
     구성음은 도(interval)와 도수(deg) 목록(iv)으로 만들어 두고 → tones(12음 안, 정렬) · 피아노 보이싱(voiceChord) 이 함께 씁니다. */
  function normChordText(s) {
    return String(s == null ? '' : s).trim()
      .replace(/[♯＃]/g, '#').replace(/♭/g, 'b').replace(/[−–—]/g, '-')
      .replace(/[Δ△](?=(9|11|13))/g, 'maj').replace(/[Δ△]7?/g, 'maj7')
      .replace(/[øØ]7?/g, 'm7b5').replace(/[°º˚]/g, 'dim')
      .replace(/\s+/g, '');
  }
  var ADD_IV = { '2': [2, '2'], '4': [5, '4'], '6': [9, '6'], '9': [14, '9'], 'b9': [13, 'b9'], '#9': [15, '#9'], '11': [17, '11'], '#11': [18, '#11'], '13': [21, '13'], 'b13': [20, 'b13'], 'b6': [8, 'b6'] };
  var ALT_IV = { 'b5': 'f-', '#5': 'f+', 'b9': [13, 'b9'], '#9': [15, '#9'], '#11': [18, '#11'], 'b13': [20, 'b13'], 'b6': [20, 'b13'] };
  function newSt() { return { q: 'maj', sev: null, six: false, sus: null, power: false, no3: false, no5: false, fifth: 0, x: [], nums: false, alt: false }; }
  function addX(st, i, d, imp) { for (var k = 0; k < st.x.length; k++) if (st.x[k].i === i) { if (!imp) st.x[k].imp = false; return; } st.x.push({ i: i, d: d, imp: !!imp }); }
  /** 숫자 7 · 9 · 11 · 13 이 붙으면 7음(없으면 b7)과 그 아래 텐션이 따라옴 */
  function extNum(st, n, sev) {
    if (!st.sev) st.sev = sev || (st.q === 'dim' && n === '7' ? 'd7' : '7');
    if (n === '9' || n === '11' || n === '13') addX(st, 14, '9', true);
    if (n === '11') addX(st, 17, '11', n !== '11' || true);
    if (n === '13') { addX(st, 21, '13', true); if (st.q === 'min') addX(st, 17, '11', true); }
    if (n === '11') st.x.forEach(function (e) { if (e.i === 17) e.imp = false; });
    st.nums = true;
  }
  /** 코드 뒤 글자(quality)를 왼쪽부터 읽음. 알 수 없는 글자가 남으면 null */
  function readSuffix(suf, st, inPar) {
    st = st || newSt();
    var s = suf, m, guard = 0;
    while (s.length && guard++ < 40) {
      if ((m = /^\(([^()]*)\)/.exec(s))) {
        var parts = m[1].split(/[,\s/]+/).filter(Boolean), ok = true;
        parts.forEach(function (p) { if (ok && !readSuffix(p, st, true)) ok = false; });
        if (!ok) return null;
      }
      else if ((m = /^(mM|mMaj|mmaj|mMA|mma|minmaj|minMaj|-maj|-M|mΔ|m\/maj|m\/M)(7|9|11|13)?/.exec(s))) { st.q = 'min'; extNum(st, m[2] || '7', 'M7'); }
      else if ((m = /^(maj|Maj|MAJ|Ma|MA|M)(7|9|11|13)?(?![a-z])/.exec(s))) { if (m[2]) extNum(st, m[2], 'M7'); }
      else if ((m = /^(major)/.exec(s))) { /* 장조 그대로 */ }
      else if ((m = /^(min|mi|m)(?!aj|a\b)/.exec(s))) { st.q = 'min'; }
      else if ((m = /^-(5|9|11|13)/.exec(s)) && (st.nums || st.sev || st.six)) { var a1 = ALT_IV['b' + m[1]]; if (a1 === 'f-') st.fifth = -1; else if (a1) addX(st, a1[0], a1[1]); else return null; }
      else if ((m = /^\+(5|9|11)/.exec(s)) && (st.nums || st.sev || st.six)) { var a2 = ALT_IV['#' + m[1]]; if (a2 === 'f+') st.fifth = 1; else if (a2) addX(st, a2[0], a2[1]); }
      else if ((m = /^-/.exec(s))) { st.q = 'min'; }
      else if ((m = /^dim(7|9)?/.exec(s))) { st.q = 'dim'; if (m[1]) { st.sev = 'd7'; if (m[1] === '9') addX(st, 14, '9'); st.nums = true; } }
      else if ((m = /^(aug|\+)(7|9|11|13)?/.exec(s))) { st.q = 'aug'; if (m[2]) extNum(st, m[2]); }
      else if ((m = /^sus(2sus4|24|42|2|4)?/.exec(s))) { st.sus = !m[1] || m[1] === '4' ? 4 : m[1] === '2' ? 2 : 24; }
      else if ((m = /^add(b|#)?(2|4|6|9|11|13)/.exec(s))) { var ad = ADD_IV[(m[1] || '') + m[2]]; if (!ad) return null; addX(st, ad[0], ad[1]); }
      else if ((m = /^(omit|no)(3|5)/.exec(s))) { if (m[2] === '3') st.no3 = true; else st.no5 = true; }
      else if ((m = /^alt/.exec(s))) { st.alt = true; if (!st.sev) st.sev = '7'; addX(st, 13, 'b9'); addX(st, 15, '#9'); addX(st, 20, 'b13'); st.no5 = true; st.nums = true; }
      else if ((m = /^(6\/9|69)/.exec(s))) { st.six = true; addX(st, 14, '9'); st.nums = true; }
      else if ((m = /^(b|#)(5|6|9|11|13)/.exec(s))) { var a3 = ALT_IV[m[1] + m[2]]; if (!a3) return null; if (a3 === 'f-') st.fifth = -1; else if (a3 === 'f+') st.fifth = 1; else addX(st, a3[0], a3[1]); }
      else if ((m = /^(13|11|9|7)/.exec(s))) { if (inPar && m[1] !== '7') { addX(st, { 9: 14, 11: 17, 13: 21 }[m[1]], m[1]); st.nums = true; } else extNum(st, m[1]); }      // 괄호 안의 (9) (11) (13) 은 그 음만 더함
      else if ((m = /^6/.exec(s))) { st.six = true; st.nums = true; }
      else if ((m = /^5(?![#b])/.exec(s))) { st.power = true; }
      else if ((m = /^2/.exec(s))) { addX(st, 2, '2'); }
      else if ((m = /^4/.exec(s))) { st.sus = 4; }
      else if ((m = /^[,]/.exec(s))) { /* 괄호 밖 쉼표 */ }
      else return null;
      s = s.slice(m[0].length);
    }
    return s.length ? null : st;
  }
  /** 읽은 상태 → 구성음 [{ i: 루트에서 반음(9 · 11 · 13 은 옥타브 위), d: 도수 이름 }] */
  function chordIvs(st) {
    var iv = [{ i: 0, d: '1' }];
    var dom11 = st.q === 'maj' && !st.sus && st.x.some(function (e) { return e.i === 17; }) && st.sev && !st.x.some(function (e) { return e.i === 17 && e.add; });
    if (st.power) { /* 3음 없음 */ }
    else if (st.sus === 2) iv.push({ i: 2, d: '2' });
    else if (st.sus === 4) iv.push({ i: 5, d: '4' });
    else if (st.sus === 24) { iv.push({ i: 2, d: '2' }); iv.push({ i: 5, d: '4' }); }
    else if (!st.no3 && !dom11) iv.push(st.q === 'min' || st.q === 'dim' ? { i: 3, d: 'b3' } : { i: 4, d: '3' });
    if (!st.no5) {
      var f = st.q === 'dim' ? 6 : st.q === 'aug' ? 8 : 7;
      if (st.fifth === -1) f = 6; else if (st.fifth === 1) f = 8;
      iv.push({ i: f, d: f === 6 ? 'b5' : f === 8 ? '#5' : '5' });
    }
    if (st.sev === '7') iv.push({ i: 10, d: 'b7' }); else if (st.sev === 'M7') iv.push({ i: 11, d: '7' }); else if (st.sev === 'd7') iv.push({ i: 9, d: 'bb7' });
    if (st.six && st.sev !== 'd7') iv.push({ i: 9, d: '6' });
    var has = function (i) { return st.x.some(function (e) { return e.i === i; }); };
    st.x.forEach(function (e) {
      if (e.imp && e.i === 14 && (has(13) || has(15))) return;                 // b9 · #9 가 있으면 저절로 붙는 9 는 뺌
      if (e.imp && e.i === 21 && has(20)) return;
      if (e.imp && e.i === 17 && has(18)) return;
      if (e.i === 8 && st.q !== 'aug' && st.fifth !== 1 && !st.sev) { iv.push({ i: 8, d: 'b6' }); return; }
      iv.push({ i: e.i, d: e.d });
    });
    var seen = {}; return iv.filter(function (e) { var k = e.i; if (seen[k]) return false; seen[k] = 1; return true; }).sort(function (a, b) { return a.i - b.i; });
  }
  /** 코드 글자 하나("Am7", "G/B", "F#m7b5", "C7(b9,#11)", "Bbmaj9#11/D") → { root, bass, suffix, triad, tones, pcs, iv, text } · 코드가 아니면 null */
  function parseChord(str) {
    var raw = String(str == null ? '' : str).trim(), s = normChordText(raw);
    var m = /^([A-G])([#b]?)(.*)$/.exec(s);
    if (!m) return null;
    var rest = m[3], bassPc = null, bassTxt = '', bm = /^(.*?)\/([A-G])([#b]?)$/.exec(rest);
    if (bm) { rest = bm[1]; bassTxt = bm[2] + bm[3]; bassPc = mod(LETTER_PC[bm[2]] + accOf(bm[3]), 12); }
    var st = readSuffix(rest);
    if (!st) return null;
    var root = mod(LETTER_PC[m[1]] + accOf(m[2]), 12), iv = chordIvs(st);
    var seen = {}, tones = iv.map(function (e) { return mod(e.i, 12); }).filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }).sort(function (a, b) { return a - b; });
    var pcs = tones.map(function (t) { return mod(root + t, 12); });
    if (bassPc != null && pcs.indexOf(bassPc) < 0) pcs.push(bassPc);
    var core = iv.filter(function (e) { return e.i < 12; }).map(function (e) { return mod(root + e.i, 12); });
    var seventh = st.sev === '7' ? 'b7' : st.sev === 'M7' ? 'maj7' : st.sev === 'd7' ? 'bb7' : null;
    return { root: root, rootText: m[1] + m[2], suffix: rest, bass: bassPc, bassText: bassTxt, triad: st.sus ? 'sus' : st.power ? 'p5' : st.q, seventh: seventh,
      tones: tones, pcs: pcs, core: core, iv: iv, text: raw };
  }
  /**
   * 피아노로 칠 소리(MIDI) — 왼손 베이스(루트 또는 슬래시 베이스, C2 ~ B2 근처) + 오른손(3음 · 7음 · 텐션, 대략 E3 ~ G5).
   *  음이 많으면 5음 → (베이스가 루트면) 루트 순으로 뺍니다. semis = 옮길 반음. 반환 { bass, notes:[...], all:[...], names:[...] }
   */
  function voiceChord(c, semis, flats) {
    if (!c) return null;
    semis = semis | 0;
    var rootPc = mod(c.root + semis, 12), bassPc = c.bass != null ? mod(c.bass + semis, 12) : rootPc;
    var bass = 36 + bassPc; if (bass > 44) bass -= 12;                                  // A1 ~ G#2 (낮게 울려도 탁하지 않게)
    var ups = (c.iv || []).slice();
    var max = 6;
    if (ups.length > max) ups = ups.filter(function (e) { return e.d !== '5'; });
    if (ups.length > max - 1 && bassPc === rootPc) ups = ups.filter(function (e) { return e.i !== 0; });
    var r = 48 + rootPc; if (r < 52) r += 12;                                            // 오른손 루트 자리: E3 ~ D#4
    var notes = ups.map(function (e) { return r + e.i; });
    while (notes.length && Math.max.apply(null, notes) > 84) notes = notes.map(function (n) { return n - 12; });
    notes = notes.map(function (n) { while (n <= bass + 3) n += 12; return n; });
    var seen = {}; notes = notes.filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; }).sort(function (a, b) { return a - b; });
    var all = [bass].concat(notes), nm = flats ? FLAT : SHARP;
    return { bass: bass, notes: notes, all: all, names: all.map(function (n) { return nm[mod(n, 12)]; }),
      degs: (c.iv || []).map(function (e) { return { d: e.d, pc: mod(rootPc + e.i, 12), name: nm[mod(rootPc + e.i, 12)] }; }) };
  }
  function isChordSymbol(str) { return !!parseChord(str); }
  function nameOfPc(pc, flats) { return (flats ? FLAT : SHARP)[mod(pc, 12)]; }
  function formatChord(c, semis, flats) {
    var s = nameOfPc(c.root + semis, flats) + c.suffix;
    if (c.bass != null) s += '/' + nameOfPc(c.bass + semis, flats);
    return s;
  }
  /** 코드 글자를 semis 반음만큼 옮김 (♭ / ♯ 표기는 flats). 코드가 아니면 null */
  function transposeChord(str, semis, flats) {
    var c = parseChord(str); if (!c) return null;
    return formatChord(c, semis | 0, !!flats);
  }

  /* ---- 낱말 → 코드 골라내기 (PDF 글자층 · OCR 공통) ---- */
  var LABEL_RE = /^(intro|verse|chorus|bridge|pre-?chorus|pre|outro|ending|tag|inst|instrumental|interlude|vamp|solo|turn|coda|end|refrain|v\d|c\d|b\d|pc\d?|x\d+|\d+x|1st|2nd|3rd|4th|repeat|rep|fine|d\.?s\.?|d\.?c\.?|segno|verse\d?|후렴|간주|전주|후주|브릿지|절)[:.)]*$/i;
  var SEP_RE = /^[|:;.,\-–—~\\%()[\]{}*]+$|^n\.?c\.?$/i;
  var HANGUL = /[ㄱ-ㆎ가-힣]/;
  /** OCR 이 자주 틀리는 글자를 고쳐서 코드가 되면 그 글자를, 아니면 원래 글자를 돌려줌
   *  · 사선(/)을 I · l · | · 1 · ! 로 읽음: "DIF#" → "D/F#" · "C1E" → "C/E" */
  function fixOcrChord(text) {
    var t = String(text == null ? '' : text).trim();
    if (!t || parseChord(t)) return t;
    var v = t.replace(/^([A-G][#♯b♭]?[^A-G/]*?)[Iil|1!\\jJ](?=[A-G][#♯b♭]?$)/, '$1/');
    if (v !== t && parseChord(v)) return v;
    v = t.replace(/[Il|!]+$/, '');
    if (v !== t && parseChord(v)) return v;
    return t;
  }
  /** 낱말 하나를 나눔: { kind: 'chord' | 'label' | 'sep' | 'other', chord?, pre, post } (fix = OCR 오류 고치기) */
  function classifyToken(text, fix) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return { kind: 'sep', pre: '', post: '' };
    if (/^[\uE000-\uF8FF\u0000-\u001F\u2000-\u206F\s]+$/.test(t)) return { kind: 'sep', pre: '', post: '' };
    if (/^\d{1,3}[.,]?$|^\d[.,]\s?\d[.,]?$|^\[\d+\]$|^x\d$/i.test(t)) return { kind: 'sep', pre: '', post: '' };                         // 마디 번호 · 반복 괄호 번호(1. 2,3.)             // V849 — 악보 글꼴의 음표 · 쉼표 기호(사용자 영역 문자)
    if (/^(V|P|PC|I|O|T|v|p|pc|R)$/.test(t) || /^[\[(]?(V|PC|P|C|B|I)\d*[\])]?$/.test(t) && /\d|\[|\(/.test(t) && !parseChord(t.replace(/[\[\]()]/g, ''))) return { kind: 'label', pre: '', post: '' };   // 리허설 표시 (V · P · C1 …)
    var whole = fix ? fixOcrChord(t) : t, wc = parseChord(whole);
    if (wc && /^[A-G]/.test(whole)) return { kind: 'chord', chord: wc, pre: '', post: '', core: whole };                 // V849 — "C7(♭9)" 처럼 괄호로 끝나는 코드는 통째로
    var wm = /^([([{|:]*)(.*?)([)\]}|,.;:]*)$/.exec(t), pre = wm[1], core = wm[2], post = wm[3];
    if (core && fix) core = fixOcrChord(core);
    if (core) { var c = parseChord(core); if (c) return { kind: 'chord', chord: c, pre: pre, post: post, core: core }; }
    if (SEP_RE.test(t)) return { kind: 'sep', pre: '', post: '' };
    if (LABEL_RE.test(t) || LABEL_RE.test(core)) return { kind: 'label', pre: '', post: '' };
    return { kind: 'other', pre: '', post: '' };
  }
  /** PDF 글자 덩어리("G    D/F#   Em7") 하나를 낱말로 나누며, 글자 폭 비율로 각 낱말의 가로 위치를 추정 (measure: 글자 폭 재는 함수) */
  function splitItem(item, measure) {
    var str = String(item.str == null ? item.text : item.str), out = [], re = /\S+/g, m;
    var total = measure ? measure(str) : str.length; if (!(total > 0)) total = str.length || 1;
    var w = item.x1 - item.x0;
    while ((m = re.exec(str))) {
      var a = measure ? measure(str.slice(0, m.index)) : m.index, b = measure ? measure(str.slice(0, m.index + m[0].length)) : m.index + m[0].length;
      out.push({ text: m[0], x0: item.x0 + w * a / total, x1: item.x0 + w * b / total, y0: item.y0, y1: item.y1, conf: item.conf });
    }
    return out;
  }
  /** V849 — 조각난 코드 글자 붙이기: PDF 는 위첨자(maj7 · sus4) · ♯ 기호 · 슬래시 베이스를 따로 된 글자로 넣는 일이 많습니다.
   *  바로 옆(빈틈이 글자 높이의 35% 이하) · 세로로 겹치는 두 조각을 붙여서 코드가 되면 하나로 합칩니다 ("C"+"#m7" · "D/F"+"#" · "G"+"sus4"). */
  /** 아직 덜 쓴 코드인가 ("Bbadd" · "C7(" · "C7(b" 처럼 다음 조각이 붙으면 코드가 되는 것) */
  function partialChord(t) { return ['9', '9)', '7', '2', 'b9)', '/C', '4'].some(function (x) { return !!parseChord(t + x); }); }
  function mergeChordPieces(toks) {
    var list = toks.slice().sort(function (a, b) { return a.x0 - b.x0; }), changed = true, guard = 0;
    while (changed && guard++ < 6) {
      changed = false;
      for (var i = 0; i < list.length; i++) {
        var a = list[i]; if (!a) continue;
        var ha = a.y1 - a.y0;
        for (var j = 0; j < list.length; j++) {
          var b = list[j]; if (!b || b === a) continue;
          var hb = b.y1 - b.y0, gap = b.x0 - a.x1, hm = Math.max(1, Math.min(ha, hb));
          if (gap < -0.15 * hm || gap > 0.35 * Math.max(ha, hb) || b.y0 >= a.y1 || b.y1 <= a.y0) continue;
          var at = String(a.text).trim(), bt = String(b.text).trim(), joined = at + bt;
          if (!/^[A-G]/.test(at) || (/^[A-G]/.test(bt) && !/^\//.test(bt) && !/\/$/.test(at) && parseChord(bt))) continue;
          var slashy = /^\/$/.test(bt) || (/\/$/.test(at) && /^[A-G][#b♯♭]?$/.test(bt));                // "F" + "/" + "A" 처럼 사선이 따로 된 글자
          if (!slashy && (!(parseChord(joined) || partialChord(joined)) || (parseChord(at) && parseChord(bt) && !/^[#b♯♭(\/]/.test(bt) && !/^(maj|min|m|sus|add|dim|aug|alt|[0-9])/.test(bt)))) continue;
          list[i] = { text: joined, x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), conf: a.conf, fs: a.fs || b.fs };
          list[j] = null; a = list[i]; ha = a.y1 - a.y0; changed = true;
        }
      }
      list = list.filter(Boolean);
    }
    return list;
  }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
  /** tokens: [{text, x0,y0,x1,y1, conf?}] (같은 좌표 단위) → 코드 목록 [{ text, chord, pre, post, x0,y0,x1,y1, conf }]
   *  opt.loose = true 이면 "코드 띠만 읽은 OCR 결과"라 잡음 낱말이 코드보다 많지만 않으면 코드 줄로 봅니다. opt.fixOcr = OCR 오류 고치기.
   *  기본은 줄 단위로 엄격하게 판단합니다 — 줄 안의 낱말이 거의 모두 코드일 때만 코드 줄로 봅니다(가사 줄 · 제목의 "A", "Am" 같은 낱말이 코드로 오인되지 않게). */
  function chordsFromTokens(tokens, opt) {
    opt = opt || {};
    var toks = (tokens || []).filter(function (t) { return t && String(t.text).trim() && t.x1 >= t.x0 && t.y1 >= t.y0; });
    if (!toks.length) return [];
    if (opt.merge !== false) toks = mergeChordPieces(toks);
    var mh = median(toks.map(function (t) { return t.y1 - t.y0; })) || 1;
    toks.sort(function (a, b) { return (a.y0 + a.y1) - (b.y0 + b.y1); });
    var rows = [], cur = null;
    toks.forEach(function (t) {
      var cy = (t.y0 + t.y1) / 2;
      if (cur && Math.abs(cy - cur.cy) <= 0.6 * mh) { cur.items.push(t); cur.cy = (cur.cy * (cur.items.length - 1) + cy) / cur.items.length; }
      else { cur = { cy: cy, items: [t] }; rows.push(cur); }
    });
    var out = [];
    rows.forEach(function (row) {
      row.items.sort(function (a, b) { return a.x0 - b.x0; });
      var cls = row.items.map(function (t) { return classifyToken(t.text, opt.fixOcr); });
      var nChord = cls.filter(function (c) { return c.kind === 'chord'; }).length, others = [];
      cls.forEach(function (c, i) { if (c.kind === 'other') others.push(row.items[i]); });
      var ok = nChord > 0;
      if (ok) {
        var nOther = others.length, nAll = nChord + nOther;
        if (opt.loose) ok = nOther <= nChord;                                          // OCR 로 코드 띠만 읽은 경우: 잡음 낱말이 코드보다 많지 않으면 코드 줄
        else ok = nOther === 0 || (nOther <= Math.floor(0.25 * nAll) && others.every(function (o) { var tx = String(o.text); return tx.length <= 4 && !HANGUL.test(tx); }));
      }
      if (!ok) return;
      row.items.forEach(function (t, i) {
        if (cls[i].kind !== 'chord') return;
        out.push({ text: cls[i].core, chord: cls[i].chord, pre: cls[i].pre, post: cls[i].post, x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1, conf: t.conf });
      });
    });
    return out;
  }

  /* ============================================================ 오선 ↔ 음높이 (높은음자리표) */
  /** step: 오선 맨 아래 줄(E4) = 0, 그 위 간 = 1, 둘째 줄(G4) = 2 … 한 칸마다 글자(도레미…) 하나씩 올라감 */
  function stepLetter(step) { var d = 2 + step; return { letter: LETTERS[mod(d, 7)], octave: 4 + Math.floor(d / 7) }; }
  /** 조표를 반영한 실제 음높이(MIDI) */
  function stepToMidi(step, key) {
    var sl = stepLetter(step), sig = keySignature(key);
    return 12 * (sl.octave + 1) + LETTER_PC[sl.letter] + sig[sl.letter];
  }
  /** MIDI → 오선 칸(step)과 붙여야 하는 임시표(acc: 0 | 1 | −1). 조표 안의 음이면 acc = 0 */
  function midiToStep(midi, key) {
    var s, best = null;
    for (s = -14; s <= 28; s++) { if (stepToMidi(s, key) === midi) { if (best === null || Math.abs(s - 6) < Math.abs(best - 6)) best = s; } }
    if (best !== null) return { step: best, acc: 0 };
    var flats = keyUsesFlats(key), target = flats ? midi + 1 : midi - 1, alt = null;
    for (s = -14; s <= 28; s++) { var nat = 12 * (stepLetter(s).octave + 1) + LETTER_PC[stepLetter(s).letter]; if (nat === target) { if (alt === null || Math.abs(s - 6) < Math.abs(alt - 6)) alt = s; } }
    if (alt === null) { alt = 0; }
    return { step: alt, acc: flats ? -1 : 1 };
  }
  /** 그 칸에 조표만 반영했을 때 붙어 있어야 할 기본 임시표 (조표 밖 음에 ♯ ♭ 을 그릴 때 기준) */
  function staffPitchName(midi, key) { var f = keyUsesFlats(key); return (f ? FLAT : SHARP)[mod(midi, 12)] + (Math.floor(midi / 12) - 1); }

  /* ============================================================ 멜로디 음에 코드 붙이기 */
  /** 멜로디 음(notes[i].staff, x, y) 마다 "지금 울리는 코드"를 찾습니다. 좌표는 모두 쪽 전체 기준 0~1.
   *  staves[i] = { top, bottom, sp } (y 방향 0~1) · pageAspect = 쪽 너비 / 높이
   *  chords[i] = { x0, x1, y0, y1, chord } — 같은 오선 위(위쪽 8칸 안)에 있는 코드만 그 오선에 붙습니다.
   *  반환: 각 음의 chordIdx (없으면 −1) */
  function assignChords(chords, staves, notes, pageAspect) {
    var asp = pageAspect || 0.707, byStaff = staves.map(function () { return []; });
    chords.forEach(function (c, ci) {
      var best = -1, bd = 1e9, cyb = c.y1, i;
      for (i = 0; i < staves.length; i++) {
        var st = staves[i], gap = st.top - cyb, lim = 8 * st.sp;
        if (gap >= -0.6 * st.sp && gap <= lim && gap < bd) { bd = gap; best = i; }
      }
      c.staff = best; if (best >= 0) byStaff[best].push(ci);
    });
    byStaff.forEach(function (arr) { arr.sort(function (a, b) { return chords[a].x0 - chords[b].x0; }); });
    var lastOfPrev = -1, res = [], prevStaff = -1;
    notes.forEach(function (n) {
      var st = staves[n.staff], spx = st ? st.sp / asp : 0.01, arr = byStaff[n.staff] || [], pick = -1, k;
      for (k = 0; k < arr.length; k++) { if (chords[arr[k]].x0 <= n.x + 0.5 * spx) pick = arr[k]; else break; }
      if (pick < 0) {
        // 이 줄의 첫 코드보다 앞선 음: 앞 줄의 마지막 코드가 이어짐 (없으면 이 줄의 첫 코드)
        var pi;
        for (pi = n.staff - 1; pi >= 0 && pick < 0; pi--) { var pa = byStaff[pi]; if (pa && pa.length) pick = pa[pa.length - 1]; }
        if (pick < 0 && arr.length) pick = arr[0];
      }
      res.push(pick);
    });
    return res;
  }

  /* ============================================================ 화음 (알토 · 테너) */
  function intervalName(m, p) {
    var d = Math.abs(m - p), dir = p < m ? '아래' : '위', deg;
    if (d === 0) return '같은 음'; if (d <= 2) deg = '2도'; else if (d <= 4) deg = '3도'; else if (d <= 6) deg = '4도'; else if (d === 7) deg = '5도';
    else if (d <= 9) deg = '6도'; else if (d <= 11) deg = '7도'; else if (d === 12) deg = '8도'; else deg = '9도 이상';
    return deg + ' ' + dir;
  }
  function altoIntervalCost(m, p) {
    var d = m - p, a = Math.abs(d), c;
    if (d > 0) {                                                    // 멜로디보다 아래
      c = { 1: 6, 2: 3, 3: 0, 4: 0, 5: 1.5, 6: 3, 7: 1.8, 8: 1.2, 9: 1.2, 10: 3, 11: 3.4, 12: 2.5 }[a]; if (c == null) c = 4.5;
    } else {                                                        // 멜로디보다 위 (위 6도가 "쓸 만한" 대안, 나머지는 피함)
      c = { 1: 6, 2: 4, 3: 1.8, 4: 1.8, 5: 2.4, 6: 3.5, 7: 2.6, 8: 0.4, 9: 0.4, 10: 3.5, 11: 4, 12: 3 }[a]; if (c == null) c = 5;
      if (m >= 65) c += 1.5;                                        // 멜로디가 높을 땐 위로 올라가지 않음
    }
    return c;
  }
  function tenorIntervalCost(m, p) {
    var d = m - p, a = Math.abs(d), c;
    if (d > 0) c = { 1: 7, 2: 5, 3: 2.4, 4: 2.4, 5: 1.6, 6: 3, 7: 0.8, 8: 0, 9: 0, 10: 1.4, 11: 2.2, 12: 0.8, 13: 1.6, 14: 2.4, 15: 2.2, 16: 2.2, 17: 3 }[a];
    else c = 8;                                                     // 테너는 멜로디보다 위로 가지 않음
    if (c == null) c = 4.5;
    return c;
  }
  function pairCost(a, t) {
    var d = a - t;
    var c = { 2: 2.5, 3: 0, 4: 0, 5: 0.2, 6: 1.2, 7: 0.5, 8: 0.2, 9: 0.2, 10: 0.8, 11: 1, 12: 0.8 }[d];
    return c == null ? (d < 2 ? 9 : 2) : c;
  }
  /** 한 성부가 앞 음에서 이 음으로 옮겨 갈 때의 벌점. dm = 같은 순간 멜로디가 움직인 반음 수.
   *  · 제자리(같은 음 반복)는 보너스  · 멜로디와 같은 방향 · 같은 크기로 나란히 움직이면(3도/6도 평행) 거의 벌점 없음
   *  · 그 밖의 도약은 클수록 벌점 */
  function leapCost(a, b, dm) {
    var d = b - a, l = Math.abs(d);
    if (l === 0) return -0.15;
    if (dm && (dm > 0) === (d > 0) && Math.abs(d - dm) <= 1) return 0.15;
    if (l <= 2) return 0.2 * l; if (l <= 4) return 0.5 + 0.3 * (l - 2); if (l <= 7) return 1.4 + 0.5 * (l - 4); return 3 + 0.8 * (l - 7);
  }
  /** 병행 완전5도 · 8도 벌점 (두 성부가 함께 같은 방향으로 움직이며 같은 완전 음정을 유지) */
  function parallelPenalty(lo0, hi0, lo1, hi1) {
    var i0 = mod(hi0 - lo0, 12), i1 = mod(hi1 - lo1, 12);
    if (!((i0 === 7 || i0 === 0) && i0 === i1)) return 0;
    var dl = lo1 - lo0, dh = hi1 - hi0;
    if (dl === 0 || dh === 0) return 0;
    return (dl > 0) === (dh > 0) ? 3 : 0;
  }
  /**
   * notes: 연주 순서대로 [{ id, midi, chord (parseChord 결과 | null) }]  ·  opt: { key, alto:[lo,hi], tenor:[lo,hi] }
   * 반환: 음마다 { alto, tenor, aRule, tRule, nct } (nct = 멜로디가 코드음이 아님)
   */
  function buildHarmony(notes, opt) {
    opt = opt || {};
    var key = opt.key || { tonic: 0, minor: false, name: 'C', flats: false }, scale = scalePcs(key);
    var aR = opt.alto || VOICE_RANGE.alto, tR = opt.tenor || VOICE_RANGE.tenor;
    var n = notes.length; if (!n) return [];
    // 1) 음마다 후보 (알토 · 테너)
    /* V849 — 코드가 있으면 알토 · 테너는 반드시 그 코드의 구성음 안에서만 (텐션음 9 · 11 · 13 은 조금 덜 선호). 코드가 없을 때만 조의 음계 */
    function cands(m, chord, lo, hi, costFn, isTenor) {
      var chordPcs = chord ? chord.pcs : null, core = chord ? (chord.core || chord.pcs) : null, out = [], p;
      var center = isTenor ? 58 : 66;
      function ok(pc) { return chordPcs ? chordPcs.indexOf(pc) >= 0 : scale.indexOf(pc) >= 0; }
      for (p = Math.max(lo, m - 17); p <= Math.min(hi, m + 14); p++) {
        if (p === m) continue;
        var pc = mod(p, 12); if (!ok(pc)) continue;
        var pen = chordPcs && core.indexOf(pc) < 0 ? 0.6 : 0;
        if (chord && chord.bass != null && pc === chord.bass && core.indexOf(pc) < 0) pen += 0.4;     // 슬래시 베이스음은 베이스에 맡김
        out.push({ p: p, c: costFn(m, p) + pen + 0.04 * Math.abs(p - center), inChord: !!chordPcs });
      }
      if (!out.length) {                                            // 범위 안에 후보가 없으면(아주 높은/낮은 음) 범위를 넓혀 가장 가까운 코드음으로
        for (p = m - 14; p <= m + 14; p++) { if (p === m) continue; if (ok(mod(p, 12))) out.push({ p: p, c: costFn(m, p) + 3 + 0.1 * (p < lo ? lo - p : p > hi ? p - hi : 0), inChord: !!chordPcs }); }
      }
      return out;
    }
    var states = [], i, j, k;
    for (i = 0; i < n; i++) {
      var nt = notes[i], m = nt.midi, ca = cands(m, nt.chord, aR[0], aR[1], altoIntervalCost, false), ct = cands(m, nt.chord, tR[0], tR[1], tenorIntervalCost, true), st = [];
      var chordPcs2 = nt.chord ? nt.chord.pcs : null;
      for (j = 0; j < ca.length; j++) for (k = 0; k < ct.length; k++) {
        var a = ca[j], t = ct[k]; if (t.p > a.p - 2) continue;
        var pc = pairCost(a.p, t.p) + a.c + t.c;
        if (chordPcs2) {                                            // 코드음을 골고루 (멜로디 + 알토 + 테너가 코드의 서로 다른 음을 가지도록)
          var seen = {}, cov = 0;
          [m, a.p, t.p].forEach(function (x) { var q = mod(x, 12); if (chordPcs2.indexOf(q) >= 0 && !seen[q]) { seen[q] = 1; cov++; } });
          pc += (Math.min(3, chordPcs2.length) - Math.min(Math.min(3, chordPcs2.length), cov)) * 0.8;
        }
        if (mod(a.p, 12) === mod(t.p, 12) || mod(a.p, 12) === mod(m, 12)) pc += 1;
        st.push({ a: a.p, t: t.p, cost: pc });
      }
      if (!st.length) { var fa = ca[0] ? ca[0].p : m - 4, ft = ct[0] ? Math.min(ct[0].p, fa - 3) : fa - 4; st.push({ a: fa, t: ft, cost: 20 }); }
      states.push(st);
    }
    // 2) 앞뒤 연결 (동적계획법)
    var best = states.map(function (s) { return s.map(function () { return { cost: 0, prev: -1 }; }); });
    for (j = 0; j < states[0].length; j++) best[0][j].cost = states[0][j].cost;
    for (i = 1; i < n; i++) {
      for (j = 0; j < states[i].length; j++) {
        var cur = states[i][j], bc = 1e18, bp = 0;
        for (k = 0; k < states[i - 1].length; k++) {
          var pv = states[i - 1][k], mv0 = notes[i - 1].midi, mv1 = notes[i].midi, c = best[i - 1][k].cost + cur.cost;
          c += leapCost(pv.a, cur.a, mv1 - mv0) + leapCost(pv.t, cur.t, mv1 - mv0);
          c += parallelPenalty(Math.min(mv0, pv.a), Math.max(mv0, pv.a), Math.min(mv1, cur.a), Math.max(mv1, cur.a));       // 멜로디 ↔ 알토
          c += parallelPenalty(Math.min(mv0, pv.t), Math.max(mv0, pv.t), Math.min(mv1, cur.t), Math.max(mv1, cur.t));       // 멜로디 ↔ 테너
          c += parallelPenalty(pv.t, pv.a, cur.t, cur.a);                                                                   // 테너 ↔ 알토
          if (c < bc) { bc = c; bp = k; }
        }
        best[i][j].cost = bc; best[i][j].prev = bp;
      }
    }
    // 3) 뒤에서부터 되짚기
    var end = 0, bcst = 1e18;
    for (j = 0; j < states[n - 1].length; j++) if (best[n - 1][j].cost < bcst) { bcst = best[n - 1][j].cost; end = j; }
    var out = new Array(n), idx = end;
    for (i = n - 1; i >= 0; i--) {
      var s = states[i][idx], mm = notes[i].midi, ch = notes[i].chord;
      out[i] = { alto: s.a, tenor: s.t, aRule: intervalName(mm, s.a), tRule: intervalName(mm, s.t), nct: !!(ch && ch.pcs.indexOf(mod(mm, 12)) < 0) };
      idx = best[i][idx].prev; if (idx < 0) idx = 0;
    }
    return out;
  }

  /* ============================================================ 미리듣기 일정 */
  /** items: 연주 순서대로 [{ midi, alto, tenor, beats }] · opt: { bpm, semis (옮길 반음), voices: {m,a,t}, lead (첫 박 앞 여유 초) }
   *  반환: { events:[{ t, dur, midi, voice: 'm'|'a'|'t', i }], total, starts:[음마다 시작 시각] } — t · dur 는 초 (items[i].rest = 뒤에 붙일 쉼(박)) */
  function buildSchedule(items, opt) {
    opt = opt || {};
    var bpm = clamp(+opt.bpm || 90, 30, 240), spb = 60 / bpm, semis = opt.semis | 0, v = opt.voices || { m: true, a: true, t: true };
    var t = opt.lead == null ? 0.15 : opt.lead, ev = [], starts = [];
    items.forEach(function (it, i) {
      var dur = Math.max(0.15, (it.beats || 1) * spb), len = Math.max(0.12, dur * 0.94);
      starts.push(t);
      if (v.m && it.midi != null) ev.push({ t: t, dur: len, midi: it.midi + semis, voice: 'm', i: i });
      if (v.a && it.alto != null) ev.push({ t: t, dur: len, midi: it.alto + semis, voice: 'a', i: i });
      if (v.t && it.tenor != null) ev.push({ t: t, dur: len, midi: it.tenor + semis, voice: 't', i: i });
      t += dur + Math.max(0, (it.rest || 0)) * spb;
    });
    return { events: ev, total: t, starts: starts };
  }

  return {
    SHARP: SHARP, FLAT: FLAT, KEY_CHOICES: KEY_CHOICES, VOICE_RANGE: VOICE_RANGE,
    parseKey: parseKey, keyUsesFlats: keyUsesFlats, keySignature: keySignature, keySemitones: keySemitones, scalePcs: scalePcs, keyName: keyName, guessKey: guessKey, findKeyText: findKeyText, keysForSig: keysForSig, rankKeys: rankKeys, fuseKey: fuseKey,
    parseChord: parseChord, voiceChord: voiceChord, normChordText: normChordText, isChordSymbol: isChordSymbol, transposeChord: transposeChord, formatChord: formatChord, nameOfPc: nameOfPc,
    classifyToken: classifyToken, fixOcrChord: fixOcrChord, splitItem: splitItem, chordsFromTokens: chordsFromTokens, mergeChordPieces: mergeChordPieces,
    stepToMidi: stepToMidi, midiToStep: midiToStep, stepLetter: stepLetter, midiName: midiName, staffPitchName: staffPitchName,
    assignChords: assignChords, buildHarmony: buildHarmony, intervalName: intervalName, buildSchedule: buildSchedule
  };
}));
