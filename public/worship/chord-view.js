/**
 * 코드 구성음 보기 — 라이브 악보에서 코드를 누르면 뜨는 말풍선의 "오선 · 피아노 · 기타" 그림 (V880)
 * ------------------------------------------------------------
 *  YNChordView.spell(rootName, degs, bassPc, flats)  → 도수에 맞는 음 이름 (C7 의 7음 = B♭, A# 아님)
 *  YNChordView.piano(midis, bassMidi, nameOf)         → SVG 문자열 (실제로 치는 자리, 베이스는 다른 색)
 *  YNChordView.guitar(pcs, bassPc, req, nameOf)        → { list: [운지…] }  ·  guitarSvg(운지, nameOf) → SVG 문자열
 *  YNChordView.staff(el, midis, bassMidi, nameOf)      → Promise — abcjs(앱 안 /vendor) 로 큰보표(높은음 · 낮은음자리표)를 그림. 못 불러오면 간단한 SVG 로
 *  순수 계산(spell · guitar)은 Node 시험에서도 씁니다.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.YNChordView = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  function mod(a, n) { return ((a % n) + n) % n; }
  var LET = 'CDEFGAB', NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var SH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], FL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pretty(n) { return String(n).replace(/##/, '𝄪').replace(/bb$/, '𝄫').replace(/#/g, '♯').replace(/(.)b/g, '$1♭'); }

  /* ------------------------------------------------------------ 음 이름 (도수대로) */
  /** 루트 이름(예 'Bb') + 도수 목록 [{d:'b7', pc}] → { pc: '음 이름' } — 글자는 도수만큼 올리고(7음 = 루트 글자 + 6), 임시표는 실제 음높이에 맞춤 */
  function spell(rootName, degs, bassPc, flats) {
    var out = {}, m = /^([A-G])/.exec(String(rootName || '')), li = m ? LET.indexOf(m[1]) : -1;
    (degs || []).forEach(function (g) {
      var num = parseInt(String(g.d).replace(/[^0-9]/g, ''), 10);
      if (li < 0 || !(num >= 1)) { out[g.pc] = (flats ? FL : SH)[g.pc]; return; }
      var L = LET[(li + num - 1) % 7], a = mod(g.pc - NAT[L] + 6, 12) - 6;                     // −6 ~ +5
      if (Math.abs(a) > 2) { out[g.pc] = (flats ? FL : SH)[g.pc]; return; }
      if (out[g.pc] == null) out[g.pc] = L + (a > 0 ? (a === 2 ? '##' : '#') : a < 0 ? (a === -2 ? 'bb' : 'b') : '');
    });
    if (bassPc != null && out[bassPc] == null) out[bassPc] = (flats ? FL : SH)[bassPc];
    return out;
  }

  /* ------------------------------------------------------------ 피아노 */
  function piano(midis, bassMidi, nameOf) {
    var notes = (midis || []).slice(), lo, hi;
    if (bassMidi != null && notes.indexOf(bassMidi) < 0) notes.unshift(bassMidi);
    lo = Math.min.apply(null, notes); hi = Math.max.apply(null, notes);
    if (hi - lo > 34 && bassMidi != null) {                                                       // 너무 넓으면 베이스만 한 옥타브 위에 그림 (이름은 그대로)
      var nb = bassMidi; while (nb + 12 < Math.min.apply(null, midis) && hi - (nb + 12) >= 0) nb += 12;
      notes = notes.map(function (n) { return n === bassMidi ? nb : n; }); bassMidi = nb; lo = Math.min.apply(null, notes);
    }
    var start = lo - mod(lo, 12), end = hi + (11 - mod(hi, 12)); if (end - start < 23) end = start + 23;
    var whites = [], k; for (k = start; k <= end; k++) if ([1, 3, 6, 8, 10].indexOf(mod(k, 12)) < 0) whites.push(k);
    var WW = 268 / whites.length, H = 86, BH = 52, BW = WW * 0.62, on = {}, svg = [];
    notes.forEach(function (n) { on[n] = n === bassMidi ? 'b' : 'n'; });
    svg.push('<svg class="cv-piano" viewBox="0 0 270 ' + (H + 18) + '" width="100%" role="img" aria-label="피아노 건반">');
    whites.forEach(function (n, i) {
      var x = 1 + i * WW, st = on[n];
      svg.push('<rect x="' + x.toFixed(1) + '" y="1" width="' + (WW - 1).toFixed(1) + '" height="' + H + '" rx="2.5" class="cv-wk' + (st ? ' on' + (st === 'b' ? ' bass' : '') : '') + '"/>');
      if (mod(n, 12) === 0) svg.push('<text x="' + (x + WW / 2).toFixed(1) + '" y="' + (H - 5) + '" class="cv-c">C' + (Math.floor(n / 12) - 1) + '</text>');
    });
    for (k = start; k <= end; k++) {
      if ([1, 3, 6, 8, 10].indexOf(mod(k, 12)) < 0) continue;
      var wi = whites.indexOf(k - 1), bx = 1 + (wi + 1) * WW - BW / 2, st2 = on[k];
      svg.push('<rect x="' + bx.toFixed(1) + '" y="1" width="' + BW.toFixed(1) + '" height="' + BH + '" rx="2" class="cv-bk' + (st2 ? ' on' + (st2 === 'b' ? ' bass' : '') : '') + '"/>');
    }
    notes.forEach(function (n) {                                                                  // 누른 건반 아래 음 이름
      var isB = [1, 3, 6, 8, 10].indexOf(mod(n, 12)) >= 0, x = isB ? 1 + (whites.indexOf(n - 1) + 1) * WW : 1 + whites.indexOf(n) * WW + WW / 2;
      svg.push('<text x="' + x.toFixed(1) + '" y="' + (H + 14) + '" class="cv-nm' + (n === bassMidi ? ' bass' : '') + '">' + esc(pretty(nameOf(mod(n, 12)))) + '</text>');
    });
    svg.push('</svg>');
    return svg.join('');
  }

  /* ------------------------------------------------------------ 기타 운지 (표준 조율 E A D G B E) */
  var TUNE = [40, 45, 50, 55, 59, 64];
  /** pcs: 코드음(12음) · bassPc: 맨 아래 음 · req: 꼭 있어야 할 음(루트 · 3음 · 7음 · 변화음) → 좋은 순서의 운지 목록 [{ f:[6줄, -1 = 안 침], base, score }] */
  function guitar(pcs, bassPc, req) {
    var set = {}, need = {}, res = [], seen = {};
    pcs.forEach(function (p) { set[mod(p, 12)] = 1; }); if (bassPc != null) set[mod(bassPc, 12)] = 1;
    (req || []).forEach(function (p) { need[mod(p, 12)] = 1; });
    for (var b = 0; b <= 12; b++) {
      var opts = TUNE.map(function (t) {
        var o = [-1]; for (var f = b; f <= b + 3; f++) { if (f === 0 && b > 0) continue; if (set[mod(t + f, 12)]) o.push(f); }
        if (b > 0 && b <= 3 && set[mod(t, 12)] && o.indexOf(0) < 0) o.push(0);                   // 낮은 자리에서는 개방현도
        return o;
      });
      (function walk(i, cur) {
        if (i < 6) { opts[i].forEach(function (f) { cur[i] = f; walk(i + 1, cur); }); return; }
        var sc = scoreOf(cur.slice(), need, bassPc); if (sc == null) return;
        var key = cur.join(','); if (seen[key]) return; seen[key] = 1;
        res.push({ f: cur.slice(), score: sc });
      })(0, []);
    }
    res.sort(function (a, b) { return a.score - b.score; });
    var out = [], sig = {};                                                                     // 비슷한 자리는 하나만 (서로 다른 자리 위주로)
    for (var i = 0; i < res.length && out.length < 4; i++) {
      var fr = res[i].f.filter(function (x) { return x > 0; }), lo = fr.length ? Math.min.apply(null, fr) : 0, k = lo <= 3 ? 'o' : String(lo);
      if (sig[k]) continue; sig[k] = 1; res[i].base = lo; out.push(res[i]);
    }
    return { list: out };
  }
  function scoreOf(f, need, bassPc) {
    var snd = [], i, muteLow = 0;
    for (i = 0; i < 6; i++) if (f[i] >= 0) snd.push(i);
    if (snd.length < 4) return null;
    for (i = 0; i < 6 && f[i] < 0; i++) muteLow++;                                              // 6 · 5번 줄 쪽(낮은 줄)부터 안 치는 것은 자유
    var mids = 0; for (i = muteLow; i < 6; i++) if (f[i] < 0) mids++;                                 // 그 위로 안 치는 줄은 하나까지만
    if (mids > 1) return null;
    var low = TUNE[snd[0]] + f[snd[0]];
    if (bassPc != null && mod(low, 12) !== mod(bassPc, 12)) return null;                         // 맨 아래 음 = 베이스(루트 · 슬래시 베이스)
    var have = {}; snd.forEach(function (s) { have[mod(TUNE[s] + f[s], 12)] = 1; });
    var miss = 0; Object.keys(need).forEach(function (p) { if (!have[p]) miss++; }); if (miss) return null;
    var fr = snd.map(function (s) { return f[s]; }).filter(function (x) { return x > 0; });
    var lo = fr.length ? Math.min.apply(null, fr) : 0, hi = fr.length ? Math.max.apply(null, fr) : 0;
    if (hi - lo > 3) return null;
    var fingers = fr.length, barre = false;
    if (fingers > 4) {                                                                           // 손가락이 모자라면 바레(가장 낮은 프렛을 검지로 눌러 막음)
      var atLo = snd.filter(function (s) { return f[s] === lo; }), first = atLo[0];
      if (atLo.length < 2) return null;
      if (snd.some(function (s) { return s > first && f[s] === 0; })) return null;
      fingers = 1 + fr.filter(function (x) { return x > lo; }).length; barre = true;
      if (fingers > 4) return null;
    }
    var openOk = lo <= 3 && hi <= 4;
    if (!openOk && snd.some(function (s) { return f[s] === 0; })) return null;                   // 높은 자리에서 개방현 섞인 운지는 빼기
    var tones = Object.keys(have).length;
    var opens = snd.filter(function (s) { return f[s] === 0; }).length;
    return (lo ? lo * 0.75 + 1.5 : 0) + (hi - lo) * 0.6 + (barre ? 1.2 : 0) + (6 - snd.length) * 0.9 + mids * 2.6 + fingers * 0.15 - tones * 0.4 +
      (opens && hi >= 4 ? 2 : 0);                                                                  // 개방현 + 4프렛 이상 벌리기는 어색한 모양
  }
  function guitarSvg(v, nameOf) {
    if (!v) return '<p class="cv-none">이 코드는 기타 운지를 찾지 못했습니다.</p>';
    var fr = v.f.filter(function (x) { return x > 0; }), lo = fr.length ? Math.min.apply(null, fr) : 0, hi = fr.length ? Math.max.apply(null, fr) : 0;
    var top = hi <= 4 ? 1 : lo, X0 = 34, Y0 = 26, SW = 34, FH = 22, N = 4, svg = [];
    svg.push('<svg class="cv-gtr" viewBox="0 0 230 ' + (Y0 + FH * N + 22) + '" width="100%" role="img" aria-label="기타 운지">');
    if (top === 1) svg.push('<rect x="' + (X0 - 1) + '" y="' + (Y0 - 4) + '" width="' + (SW * 5 + 2) + '" height="4" rx="1" class="cv-nut"/>');
    else svg.push('<text x="' + (X0 - 9) + '" y="' + (Y0 + FH / 2 + 4) + '" class="cv-fr" text-anchor="end">' + top + 'fr</text>');
    var i, s;
    for (i = 0; i <= N; i++) svg.push('<line x1="' + X0 + '" y1="' + (Y0 + i * FH) + '" x2="' + (X0 + SW * 5) + '" y2="' + (Y0 + i * FH) + '" class="cv-ln"/>');
    for (s = 0; s < 6; s++) svg.push('<line x1="' + (X0 + s * SW) + '" y1="' + Y0 + '" x2="' + (X0 + s * SW) + '" y2="' + (Y0 + N * FH) + '" class="cv-ln cv-str"/>');
    var atLo = []; for (s = 0; s < 6; s++) if (v.f[s] === lo && lo > 0) atLo.push(s);
    if (fr.length > 4 && atLo.length >= 2) {                                                       // 바레
      var bs = atLo[0], be = 5; while (be > bs && v.f[be] < lo) be--;
      svg.push('<rect x="' + (X0 + bs * SW - 8) + '" y="' + (Y0 + (lo - top) * FH + FH / 2 - 7) + '" width="' + ((be - bs) * SW + 16) + '" height="14" rx="7" class="cv-dot"/>');
    }
    for (s = 0; s < 6; s++) {
      var f = v.f[s], x = X0 + s * SW;
      if (f < 0) svg.push('<text x="' + x + '" y="' + (Y0 - 9) + '" class="cv-xo">×</text>');
      else if (f === 0) svg.push('<circle cx="' + x + '" cy="' + (Y0 - 13) + '" r="5" class="cv-open"/>');
      else svg.push('<circle cx="' + x + '" cy="' + (Y0 + (f - top) * FH + FH / 2) + '" r="8" class="cv-dot"/>');
      if (f >= 0) svg.push('<text x="' + x + '" y="' + (Y0 + N * FH + 16) + '" class="cv-sn">' + esc(pretty(nameOf(mod(TUNE[s] + f, 12)))) + '</text>');
    }
    svg.push('</svg>');
    return svg.join('');
  }

  /* ------------------------------------------------------------ 오선 (큰보표) */
  var ABCJS_URL = '/vendor/abcjs/abcjs-basic-min.js', abcP = null;
  function abcjs() {
    if (root.ABCJS) return Promise.resolve(root.ABCJS);
    if (abcP) return abcP;
    abcP = new Promise(function (res, rej) {
      var d = root.document, sc = d.createElement('script'); sc.src = ABCJS_URL; sc.async = true;
      sc.onload = function () { root.ABCJS ? res(root.ABCJS) : rej(new Error('abcjs')); };
      sc.onerror = function () { abcP = null; rej(new Error('abcjs')); };
      d.head.appendChild(sc);
    });
    return abcP;
  }
  /** MIDI + 이름('Bb') → ABC 음표 ("_B,") — 이름의 글자로 옥타브를 정함 (B# · Cb 처럼 옥타브를 넘는 이름도 바르게) */
  function abcNote(m, name, natural) {
    var L = name.charAt(0), acc = name.slice(1), a = acc === '#' ? 1 : acc === '##' ? 2 : acc === 'b' ? -1 : acc === 'bb' ? -2 : 0;
    var oct = Math.floor((m - NAT[L] - a) / 12) - 1;                                              // C4 = 가운데 도
    var pre = a === 1 ? '^' : a === 2 ? '^^' : a === -1 ? '_' : a === -2 ? '__' : natural ? '=' : '';          // 제자리표는 같은 글자에 임시표가 있을 때만
    var t = oct >= 5 ? L.toLowerCase() + new Array(oct - 4).join("'") : L + new Array(Math.max(0, 4 - oct) + 1).join(',');
    return pre + t;
  }
  function staff(el, midis, bassMidi, nameOf) {
    var all = (midis || []).slice(); if (bassMidi != null && all.indexOf(bassMidi) < 0) all.unshift(bassMidi);
    all.sort(function (a, b) { return a - b; });
    var tr = all.filter(function (n) { return n >= 60; }), bs = all.filter(function (n) { return n < 60; });
    var accL = {}; all.forEach(function (n) { var nm = nameOf(mod(n, 12)); if (nm.length > 1) accL[nm.charAt(0)] = 1; });
    var chord = function (list) { return list.length ? '[' + list.map(function (n) { var nm = nameOf(mod(n, 12)); return abcNote(n, nm, nm.length === 1 && accL[nm]); }).join('') + ']4' : 'x4'; };
    var abc = 'X:1\nM:none\nL:1/4\n%%staves {T B}\nK:C\nV:T clef=treble\n' + chord(tr) + '|]\nV:B clef=bass\n' + chord(bs) + '|]\n';
    return abcjs().then(function (A) {
      el.innerHTML = '';
      A.renderAbc(el, abc, { staffwidth: 120, scale: 0.95, paddingtop: 0, paddingbottom: 0, paddingleft: 0, paddingright: 0, add_classes: true, foregroundColor: 'currentColor' });
      return true;
    }).catch(function () { el.innerHTML = '<p class="cv-none">오선을 그리는 도구를 불러오지 못했습니다 (인터넷 연결 확인).</p>'; return false; });
  }

  return { spell: spell, pretty: pretty, piano: piano, guitar: guitar, guitarSvg: guitarSvg, staff: staff, abcNote: abcNote, preload: function () { return abcjs().catch(function () {}); } };
}));
