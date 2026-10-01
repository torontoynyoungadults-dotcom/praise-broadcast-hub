/**
 * 악보 코드 인식 · 키 바꾸기 · 알토/테너 화음 덧그리기 — 세션 / 연습 화면의 "화음" 탭 (Step 13)
 * ------------------------------------------------------------
 *  YNHarmonyUI.mount(host, P)   ← practice-panels.js 의 "화음" 탭이 부릅니다 (P = 연습 화면이 패널에 주는 통로)
 *
 *  · 분석: PDF 는 글자층에서 코드 글자와 정확한 위치를 바로 읽고(없으면 OCR — tesseract.js), 오선 · 멜로디 음표는 omr.js 로 찾습니다.
 *  · 키 바꾸기: 원래 조 ➔ 목표 조 반음 수를 계산해 코드를 옮기고, 원래 코드 글자 위를 종이 색으로 덮은 뒤 새 코드를 어두운 유리 칩으로 덧그립니다.
 *  · 화음: harmony-core.js 가 코드음 안에서 알토(빨강 #FF4D4D) · 테너(파랑 #4D94FF)를 계산 → 오선 위에 머리 표시만 덧그림(악보 원본은 그대로).
 *  · 손으로 고치기: 화음 음표를 위아래로 끌면 반음이 아니라 "오선 한 칸"씩 옮겨지고(조표 반영), 멜로디 음표 · 코드 글자도 고칠 수 있습니다.
 *  · 미리듣기: Web Audio(피아노 소리) 로 멜로디 + 알토 + 테너를 함께 들려주고, 소리마다 켜고 끌 수 있습니다.
 *  덧그림은 별도 캔버스(.pv-harm)라서 필기 · PDF 그림은 건드리지 않습니다. 결과는 이 기기(localStorage)에 악보 파일별로 기억합니다.
 *
 *  · 연습 키 이동 연동 (Feature 2): 연습 화면의 P.keyShift() (곡별 −3 ~ +3 반음, 유튜브 카드 · 키 바꿔 듣기 카드가 바꿈) = "목표 조 − 원래 조".
 *      - 'keyshift' / 'song' 이벤트를 들으면 목표 조 = 원래 조를 n 반음 옮긴 조 로 맞추고 코드를 다시 그립니다 (화음 탭을 한 번도 안 열었어도 practice.js 의 P.ensureTab 이 이 모듈을 화면 없이 만들어 줌).
 *      - 이 페이지이 아직 분석 전이면 (PDF 글자층 ▸ 없으면 OCR) 자동으로 한 번 분석합니다 — 쪽 · 악보마다 세션에 한 번, 화면을 막지 않음, 오프라인이면 안내만.
 *      - 이 탭의 "목표 조" 를 손으로 바꾸면 ±3 반음 안일 때 연습 키 이동에 되돌려 반영합니다 (되먹임 고리 없음).
 */
(function (root) {
  'use strict';
  var doc = root.document, HC = root.YNHarmony, OM = root.YNOmr;
  var VER = 1, OCR_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  var COL = { alto: '#FF4D4D', tenor: '#4D94FF', mel: '#35e0c0', chip: 'rgba(14,14,22,.94)', chipTx: '#FFB066', chipLn: 'rgba(255,138,42,.9)', ink: '#f8f5f0' };
  var MINORS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
  var uidN = 0;
  function uid() { return 'h' + Date.now().toString(36) + (uidN++).toString(36); }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
  function tick() { return new Promise(function (r) { setTimeout(r, 16); }); }

  /* ------------------------------------------------------------ 스타일 (한 번만) */
  var CSS = '' +
    '.pv-harm{z-index:3;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}' +
    '.hm-stat{margin-top:9px;font-size:13px;line-height:1.55;color:var(--g-sub,#d4cfc7)}.hm-stat.bad{color:#ffc2c2}.hm-stat b{color:var(--g-a2,#ffb066)}' +
    '.hm-keys{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:end}.hm-keys label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--g-sub,#d4cfc7);font-weight:800}' +
    '.hm-arrow{font-size:22px;color:var(--g-a2,#ffb066);padding-bottom:9px}' +
    '.hm-semis{margin-top:9px;font-size:13.5px;font-weight:800;color:var(--g-ink,#f8f5f0)}.hm-semis i{font-style:normal;color:var(--g-a2,#ffb066)}' +
    '.hm-seg{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '.hm-seg button{flex:1 1 auto;min-height:42px;padding:8px 12px;border-radius:12px;border:1px solid var(--g-line2,rgba(255,255,255,.26));background:rgba(255,255,255,.07);color:var(--g-ink,#f8f5f0);font-size:14px;font-weight:800;cursor:pointer}' +
    '.hm-seg button[aria-pressed=true]{background:linear-gradient(135deg,#ff9d47,#ff7a1c);color:#1a0f05;border-color:transparent}' +
    '.hm-sub{margin-top:6px}.hm-sub button{min-height:36px;font-size:13px}' +
    '.hm-dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:-1px}' +
    '.hm-sel{margin-top:9px;padding:9px 11px;border-radius:12px;border:1px solid var(--g-line,rgba(255,255,255,.15));background:rgba(255,255,255,.06);font-size:13.5px;line-height:1.5}' +
    '.hm-chk{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:14px}.hm-chk label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}' +
    '.hm-chk input{width:20px;height:20px;accent-color:#ff8a2a}' +
    '.hm-num{width:78px;padding:9px 10px;border-radius:11px;border:1px solid var(--g-line2,rgba(255,255,255,.26));background:rgba(255,255,255,.09);color:var(--g-ink,#f8f5f0);font-size:16px;font-weight:800;text-align:center}' +
    '.hm-staffs label{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13.5px}' +
    '.hm-edit{position:absolute;z-index:7;padding:4px 8px;border-radius:9px;border:2px solid #ff8a2a;background:rgba(14,14,22,.96);color:#ffb066;font:800 16px -apple-system,Helvetica,Arial,sans-serif;outline:none;box-shadow:0 6px 22px rgba(0,0,0,.55)}' +
    '.hm-legend span{margin-right:12px;font-size:12.5px;color:var(--g-sub,#d4cfc7)}';
  function injectCss() {
    if (!doc || doc.getElementById('yn-harm-css')) return;
    var s = doc.createElement('style'); s.id = 'yn-harm-css'; s.textContent = CSS; doc.head.appendChild(s);
  }

  /* ------------------------------------------------------------ 저장 (악보 파일별, 이 기기) */
  function keyOf(id) { return 'yn.pv.harm.' + id; }
  function freshData() { return { v: VER, orig: 'auto', target: '', bpm: 0, keyMode: 'target', vol: 0.8, voices: { m: true, a: true, t: true }, show: { chords: true, alto: true, tenor: true, link: true, orig: false }, pages: {}, ov: { alto: {}, tenor: {} }, use: {} }; }
  function loadData(id) {
    try { var s = root.localStorage.getItem(keyOf(id)); if (s) { var d = JSON.parse(s); if (d && d.v === VER && d.pages) { d.ov = d.ov || { alto: {}, tenor: {} }; d.ov.alto = d.ov.alto || {}; d.ov.tenor = d.ov.tenor || {}; d.use = d.use || {}; d.show = Object.assign(freshData().show, d.show || {}); d.voices = Object.assign({ m: true, a: true, t: true }, d.voices || {}); return d; } } } catch (e) { /* 저장이 막힌 브라우저 */ }
    return freshData();
  }

  /* ------------------------------------------------------------ 키 이동 계산 (순수 함수 — Node 시험용으로도 내보냄) */
  function mod12(a) { return ((a % 12) + 12) % 12; }
  function clampShift(n) { n = Math.round(+n); return isFinite(n) ? clamp(n, -3, 3) : 0; }
  /** H = YNHarmony.  targetFor(원래 조, n): n 반음 옮긴 목표 조의 으뜸음 이름(KEY_CHOICES, 0 이면 '' = 그대로) · shiftFor(원래 조, 목표 조): ±3 반음 안이면 그 값, 밖이면 null */
  function keyMath(H) {
    return {
      targetFor: function (okey, n) { n = clampShift(n); return n && okey ? H.KEY_CHOICES[mod12(okey.tonic + n)] : ''; },
      shiftFor: function (okey, tkey) { if (!okey || !tkey) return null; var d = H.keySemitones(okey, tkey); return Math.abs(d) <= 3 ? d : null; }
    };
  }

  /* ------------------------------------------------------------ 본체 */
  function mount(host, P) {
    if (!HC || !OM) { host.innerHTML = '<p class="pv-err">화음 도구(harmony-core.js · omr.js)를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>'; return null; }
    injectCss();
    var box = P.pageBox && P.pageBox();
    if (!box) { host.innerHTML = '<p class="pv-err">악보 화면을 찾지 못했습니다.</p>'; return null; }
    var S = { dead: false, data: null, model: {}, mode: 'view', sub: { melody: 'move', chord: 'edit' }, sel: null, undo: [], hits: [], drag: null, busy: false, playing: null, playIdx: -1,
      okey: null, tkey: null, semis: 0, flats: false, guess: null, statMsg: '', statBad: false, worker: null, saveT: 0, editor: null };
    var dpr = Math.min(3, root.devicePixelRatio || 1);
    var cv = doc.createElement('canvas'); cv.className = 'pv-harm'; cv.style.pointerEvents = 'none'; cv.setAttribute('aria-hidden', 'true');
    box.appendChild(cv);
    var ctx = cv.getContext('2d');
    var au = { ctx: null, master: null, synth: null };
    var KM = keyMath(HC);
    S.autoTried = {}; S.autoRun = false; S.autoPend = false; S.reflecting = false; S.autoOn = true;
    try { S.autoOn = root.localStorage.getItem('yn.pv.harm.auto') !== '0'; } catch (e) { /* 저장이 막힌 브라우저 */ }

    /* ---------- 데이터 · 모델 ---------- */
    function fid() { var f = P.file && P.file(); return f && f.id || ''; }
    function pgKey() { return String(P.page()); }
    function saveSoon() { clearTimeout(S.saveT); S.saveT = setTimeout(saveNow, 350); }
    function saveNow() {
      clearTimeout(S.saveT); if (!S.data || !S.fid) return;
      try { root.localStorage.setItem(keyOf(S.fid), JSON.stringify(S.data, function (k, v) { return k === 'parsed' ? undefined : v; })); } catch (e) { toast('이 기기의 저장 공간이 부족해 분석 결과를 기억하지 못했습니다.', true); }
    }
    function toast(t, bad) { try { P.toast(t, !!bad); } catch (e) {} }
    function loadFile() {
      S.fid = fid(); S.data = S.fid ? loadData(S.fid) : freshData(); S.undo = []; S.sel = null; stop(); linkFromP(); computeModel(); redraw(); syncPanel();
    }
    /* ---------- 연습 키 이동(P.keyShift) 연동 ---------- */
    function pShift() { return P.keyShift ? clampShift(P.keyShift()) : 0; }
    function note(t, bad) { try { P.emit('harmstat', t || '', !!bad); } catch (e) { /* 알림이 안 가도 그리기는 계속 */ } }
    /** 이 악보 데이터에 연습 키 이동을 심음 (목표 조는 computeModel 이 원래 조에서 계산) — 연동 중이 아니고 이동도 0 이면 손댈 것이 없음 */
    function linkFromP() { var n = pShift(); if (n === 0 && typeof S.data.tshift !== 'number') return; S.data.tshift = n; }
    /** 손으로 목표 조를 고르면 ±3 반음 안일 때 연습 키 이동에 되돌려 반영 (고리 방지: S.reflecting 동안 'keyshift' 를 무시) */
    function reflect(n) {
      if (!P.setKeyShift || !P.keyShift || P.keyShift() === n) return;
      S.reflecting = true; try { P.setKeyShift(n); } finally { S.reflecting = false; }
    }
    function setTargetManual(v) {
      S.data.target = v || ''; S.statMsg = '';
      var k = v ? HC.parseKey(v + (S.okey && S.okey.minor ? 'm' : '')) : S.okey, sm = KM.shiftFor(S.okey, k);
      if (sm != null) { S.data.tshift = sm; reflect(sm); }
      else { delete S.data.tshift; if (pShift() !== 0) { reflect(0); note('목표 조가 ±3 반음 밖이라 연습 키 이동은 0 으로 되돌렸습니다 (녹음 재생은 ±3 반음까지만 바꿀 수 있습니다).'); } }
      commit();
    }
    function origKey() {
      var d = S.data, k = d.orig && d.orig !== 'auto' ? HC.parseKey(d.orig) : null;
      if (k) { S.guess = null; return k; }
      var list = [];
      Object.keys(d.pages).forEach(function (pg) { (d.pages[pg].chords || []).forEach(function (c) { var pc = HC.parseChord(c.text); if (pc) list.push(pc); }); });
      var g = list.length >= 3 ? HC.guessKey(list) : null;
      if (g) { S.guess = g.key; return g.key; }
      var sk = P.song && P.song() && HC.parseKey(P.song().key); S.guess = null;
      return sk || HC.parseKey('C');
    }
    function targetKey(o) {
      var t = S.data.target; if (!t) return o;
      var k = HC.parseKey(t + (o.minor ? 'm' : '')); return k || o;
    }
    function sigCountOf(key) { var sg = HC.keySignature(key), n = 0, L; for (L in sg) if (sg[L]) n++; return n; }
    function usedStaff(pg, i) { var st = S.data.pages[pg].staves[i], o = S.data.use[pg + ':' + i]; return o === undefined ? !!st.melody : !!o; }
    function computeModel() {
      var d = S.data; S.okey = origKey(); if (typeof d.tshift === 'number') d.target = KM.targetFor(S.okey, d.tshift); S.tkey = targetKey(S.okey); S.semis = HC.keySemitones(S.okey, S.tkey); S.flats = HC.keyUsesFlats(S.tkey);
      S.model = {};
      var nsig = sigCountOf(S.okey);
      Object.keys(d.pages).forEach(function (pg) {
        var pd = d.pages[pg]; if (!pd || !pd.staves) return;
        var asp = pd.w / pd.h, chords = (pd.chords || []).filter(function (c) { c.parsed = HC.parseChord(c.text); return !!c.parsed; });
        var geo = chords.map(function (c) { return { x0: c.x, x1: c.x + c.w, y0: c.y, y1: c.y + c.h }; });
        var notes = (pd.notes || []).filter(function (n) {
          var st = pd.staves[n.staff]; if (!st || !usedStaff(pg, n.staff)) return false;
          if (n.src === 'user') return true;
          return n.x >= st.x0 + OM.headerSpaces(nsig) * (st.sp / asp);
        }).sort(function (a, b) { return a.staff - b.staff || a.x - b.x; });
        var idx = HC.assignChords(geo, pd.staves, notes, asp);
        var items = notes.map(function (n, i) { return { id: n.id, midi: HC.stepToMidi(n.step, S.okey), chord: idx[i] >= 0 ? chords[idx[i]].parsed : null }; });
        var hm = items.length ? HC.buildHarmony(items, { key: S.okey }) : [];
        S.model[pg] = { notes: notes.map(function (n, i) {
          var a = hm[i], oa = d.ov.alto[n.id], ot = d.ov.tenor[n.id];
          return { id: n.id, n: n, staff: n.staff, x: n.x, step: n.step, midi: items[i].midi, chord: idx[i] >= 0 ? chords[idx[i]] : null, alto: a.alto, tenor: a.tenor,
            altoF: oa != null ? oa : a.alto, tenorF: ot != null ? ot : a.tenor, altoEd: oa != null, tenorEd: ot != null, nct: a.nct, beats: n.beats || 1, rest: n.rest || 0 };
        }) };
      });
    }
    function commit(noSave) { computeModel(); redraw(); syncPanel(); if (!noSave) saveSoon(); }
    function pushUndo(fn) { S.undo.push(fn); if (S.undo.length > 60) S.undo.shift(); syncPanel(); }
    function undo() { var f = S.undo.pop(); if (!f) return; try { f(); } catch (e) {} commit(); }

    /* ---------- 그리기 ---------- */
    function stepY(st, step, Hh) { return (st.bottom - step * st.sp / 2) * Hh; }
    function roundRect(c, x, y, w, hh, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    function head(c, x, y, rx, ry, color, ring) {
      c.save(); c.translate(x, y); c.rotate(-0.35); c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      c.fillStyle = color; c.fill(); c.lineWidth = Math.max(1.2, rx * 0.16); c.strokeStyle = 'rgba(10,10,16,.75)'; c.stroke();
      if (ring) { c.beginPath(); c.ellipse(0, 0, rx * 1.55, ry * 1.75, 0, 0, Math.PI * 2); c.lineWidth = Math.max(1.6, rx * 0.2); c.strokeStyle = ring; c.stroke(); }
      c.restore();
    }
    function ledgers(c, st, step, x, W, Hh, rx, color) {
      var s2; c.save(); c.strokeStyle = color; c.lineWidth = Math.max(1.4, st.sp * Hh * 0.09); c.globalAlpha = 0.9;
      var lines = [];
      if (step <= -2) for (s2 = -2; s2 >= step; s2 -= 2) lines.push(s2);
      if (step >= 10) for (s2 = 10; s2 <= step; s2 += 2) lines.push(s2);
      lines.forEach(function (ls) { var yy = stepY(st, ls, Hh); c.beginPath(); c.moveTo(x - rx * 1.7, yy); c.lineTo(x + rx * 1.7, yy); c.stroke(); });
      c.restore();
    }
    function label(c, x, y, text, color) {
      c.save(); c.font = '800 13px -apple-system,Helvetica,Arial,sans-serif'; var w = c.measureText(text).width + 14;
      roundRect(c, x - w / 2, y - 26, w, 24, 8); c.fillStyle = 'rgba(14,14,22,.95)'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = color; c.stroke();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y - 14); c.restore();
    }
    /** 한 쪽의 덧그림을 그립니다 — W · Hh 는 그리는 곳의 픽셀 크기(화면 · 내보내기 공용). o.hits 이면 눌러 볼 수 있는 자리를 모아 둡니다 */
    function draw(c, W, Hh, pg, o) {
      o = o || {}; var d = S.data, pd = d && d.pages[pg]; if (!pd) return;
      var sh = d.show, hits = o.hits ? [] : null;
      c.save();
      /* 1) 코드: 원래 글자를 종이 색으로 덮고 새 코드를 유리 칩으로 */
      if (sh.chords && !sh.orig) {
        var rowsSorted = (pd.chords || []).filter(function (x) { return x.parsed; }).sort(function (a, b) { return a.y - b.y || a.x - b.x; });
        rowsSorted.forEach(function (cd, i) {
          var user = cd.src === 'user'; if (S.semis === 0 && !user) return;
          var txt = cd.pre + HC.formatChord(cd.parsed, S.semis, S.flats) + cd.post;
          var x = cd.x * W, y = cd.y * Hh, w = cd.w * W, hh = cd.h * Hh, pad = Math.max(2, hh * 0.14), fs = Math.max(9, (cd.fs || cd.h) * Hh);
          if (!user) { c.fillStyle = pd.paper || '#fff'; c.fillRect(x - pad, y - pad, w + pad * 2, hh + pad * 2); }
          var nextX = 1e9, k; for (k = i + 1; k < rowsSorted.length; k++) { var nb = rowsSorted[k]; if (Math.abs(nb.y - cd.y) < cd.h * 0.7) { nextX = nb.x * W; break; } }
          var f = fs; c.font = '800 ' + f + 'px -apple-system,"Helvetica Neue",Arial,sans-serif'; var tw = c.measureText(txt).width;
          var avail = Math.max(w + 6, nextX - x - 4); if (tw + 12 > avail) { f = Math.max(fs * 0.62, f * (avail - 12) / tw); c.font = '800 ' + f + 'px -apple-system,"Helvetica Neue",Arial,sans-serif'; tw = c.measureText(txt).width; }
          var cw = Math.max(w + 6, tw + 12), chh = Math.max(hh + pad, f * 1.2);
          roundRect(c, x - 4, y + hh / 2 - chh / 2, cw, chh, Math.min(8, chh * 0.3)); c.fillStyle = COL.chip; c.fill();
          c.lineWidth = 1.6; c.strokeStyle = COL.chipLn; if (cd.conf != null && cd.conf < 60 && cd.src === 'ocr') c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]);
          c.fillStyle = COL.chipTx; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(txt, x + 2, y + hh / 2 + f * 0.03);
          if (hits) hits.push({ kind: 'chord', id: cd.id, x: x - 4 + cw / 2, y: y + hh / 2, w: cw, h: chh });
        });
      }
      /* 2) 화음 머리 */
      var M = S.model[pg];
      if (M) {
        M.notes.forEach(function (nt, ni) {
          var st = pd.staves[nt.staff]; if (!st) return;
          var spPx = st.sp * Hh, rx = 0.68 * spPx, ry = 0.5 * spPx, x = nt.x * W, playing = S.playing && S.playIdx === ni;
          var my = stepY(st, nt.step, Hh);
          var vs = [];
          if (sh.alto) vs.push({ k: 'alto', midi: nt.altoF, ed: nt.altoEd, col: COL.alto });
          if (sh.tenor) vs.push({ k: 'tenor', midi: nt.tenorF, ed: nt.tenorEd, col: COL.tenor });
          var prevStep = nt.step;
          vs.forEach(function (v) {
            var sm = (S.drag && S.drag.kind === v.k && S.drag.id === nt.id) ? S.drag.midi : v.midi, sp2 = HC.midiToStep(sm, S.okey), y = stepY(st, sp2.step, Hh), hx = x;
            if (Math.abs(sp2.step - prevStep) <= 1) hx = x - rx * 1.75;                                // 2도 차이로 붙는 머리는 옆으로 비켜서 그림
            if (sh.link) { c.save(); c.strokeStyle = v.col; c.globalAlpha = 0.5; c.lineWidth = Math.max(1.3, rx * 0.16); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, my); c.lineTo(hx, y); c.stroke(); c.restore(); }
            ledgers(c, st, sp2.step, hx, W, Hh, rx, v.col);
            var sel = S.sel && S.sel.kind === v.k && S.sel.id === nt.id;
            if (playing) { c.save(); c.shadowColor = v.col; c.shadowBlur = 22; head(c, hx, y, rx * 1.15, ry * 1.15, v.col, '#fff'); c.restore(); }
            head(c, hx, y, rx, ry, v.col, sel ? '#ffffff' : (v.ed ? 'rgba(255,255,255,.55)' : null));
            if (sp2.acc) { c.save(); c.fillStyle = v.col; c.font = '800 ' + (spPx * 1.7) + 'px serif'; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(sp2.acc > 0 ? '♯' : '♭', hx - rx * 1.35, y); c.restore(); }
            if (hits) hits.push({ kind: v.k, id: nt.id, x: hx, y: y, r: Math.max(rx * 1.6, 15) });
            prevStep = sp2.step;
            if (sel || (S.drag && S.drag.kind === v.k && S.drag.id === nt.id)) label(c, hx, y - ry * 2, v.k === 'alto' ? '알토 ' + HC.staffPitchName(sm, S.okey) : '테너 ' + HC.staffPitchName(sm, S.okey), v.col);
          });
          if (S.mode === 'melody' && o.hits !== false) {
            var isSel = S.sel && S.sel.kind === 'melody' && S.sel.id === nt.id;
            c.save(); c.beginPath(); c.ellipse(x, my, rx * 1.5, ry * 1.8, 0, 0, Math.PI * 2); c.lineWidth = isSel ? 3 : 2; c.strokeStyle = isSel ? '#fff' : COL.mel; c.setLineDash(isSel ? [] : [4, 3]); c.stroke(); c.restore();
            if (hits) hits.push({ kind: 'melody', id: nt.id, x: x, y: my, r: Math.max(rx * 1.7, 16) });
          } else if (hits && S.mode === 'harmony') { /* 화음 모드에서는 멜로디 머리를 누를 수 없음 */ }
        });
      }
      if (S.mode === 'chord') {
        (pd.chords || []).forEach(function (cd) {
          if (!cd.parsed) return; c.save(); c.setLineDash([5, 4]); c.lineWidth = 1.5; c.strokeStyle = COL.mel; c.strokeRect(cd.x * W - 5, cd.y * Hh - 4, cd.w * W + 10, cd.h * Hh + 8); c.restore();
          if (hits && !hits.some(function (q) { return q.id === cd.id; })) hits.push({ kind: 'chord', id: cd.id, x: (cd.x + cd.w / 2) * W, y: (cd.y + cd.h / 2) * Hh, w: cd.w * W + 12, h: cd.h * Hh + 10 });
        });
      }
      c.restore();
      if (hits) S.hits = hits;
    }
    var rafDraw = 0;
    function redraw() {
      if (S.dead) return;
      if (rafDraw) return;
      rafDraw = root.requestAnimationFrame ? root.requestAnimationFrame(doDraw) : (doDraw(), 0);
    }
    function doDraw() {
      rafDraw = 0; if (S.dead) return;
      var w = box.clientWidth, hgt = box.clientHeight; if (!w || !hgt) return;
      var pw = Math.round(w * dpr), ph = Math.round(hgt * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      cv.style.width = w + 'px'; cv.style.height = hgt + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hgt);
      draw(ctx, w, hgt, pgKey(), { hits: true });
    }
    var ro = null;
    if (root.ResizeObserver) { ro = new root.ResizeObserver(function () { redraw(); }); ro.observe(box); }
    root.addEventListener('resize', redraw);

    /* ---------- 분석: 글자층 · OCR · 오선/멜로디 ---------- */
    var mctx = null;
    function measurer() { if (!mctx) { mctx = doc.createElement('canvas').getContext('2d'); mctx.font = '800 20px Helvetica, Arial, sans-serif'; } return function (s) { return mctx.measureText(s).width; }; }
    function textLayerChords(pg) {
      var pdf = P.pdf && P.pdf(); if (!pdf) return Promise.resolve(null);
      return pdf.getPage(pg).then(function (page) {
        var vp = page.getViewport({ scale: 1 });
        return page.getTextContent().then(function (tc) {
          var toks = [], chars = 0, ms = measurer();
          tc.items.forEach(function (it) {
            if (!it.str || !it.str.trim()) return; chars += it.str.length;
            var tr = it.transform, fs = Math.hypot(tr[0], tr[1]) || it.height || 10, p0 = vp.convertToViewportPoint(tr[4], tr[5]), wpx = (it.width || 0) * vp.scale;
            var item = { str: it.str, x0: p0[0], x1: p0[0] + wpx, y0: p0[1] - fs * 0.8, y1: p0[1] + fs * 0.22, fs: fs };
            HC.splitItem(item, ms).forEach(function (t) { t.fs = fs; toks.push(t); });
          });
          var cs = HC.chordsFromTokens(toks, {});
          return { hasText: chars > 8, chords: cs.map(function (c) {
            var fs = 0; toks.some(function (t) { if (t.x0 === c.x0 && t.y0 === c.y0) { fs = t.fs; return true; } return false; });
            return { id: uid(), text: c.text, pre: c.pre, post: c.post, x: c.x0 / vp.width, y: c.y0 / vp.height, w: (c.x1 - c.x0) / vp.width, h: (c.y1 - c.y0) / vp.height, fs: (fs || (c.y1 - c.y0)) / vp.height, src: 'text' };
          }) };
        });
      });
    }
    function loadOcr() {
      return new Promise(function (res, rej) {
        if (typeof root.Tesseract !== 'undefined') return res(root.Tesseract);
        var s = doc.createElement('script'); s.src = OCR_URL; s.async = true;
        s.onload = function () { typeof root.Tesseract !== 'undefined' ? res(root.Tesseract) : rej(new Error('OCR 도구를 불러오지 못했습니다')); };
        s.onerror = function () { rej(new Error('OCR 도구를 내려받지 못했습니다 (인터넷 연결을 확인해 주세요)')); };
        doc.head.appendChild(s);
      });
    }
    function getWorker() {
      if (S.worker) return S.worker;
      S.worker = loadOcr().then(function (T) {
        return T.createWorker('eng', 1, { logger: function (m) { if (m && m.status === 'recognizing text') setStat('OCR 읽는 중… ' + Math.round((m.progress || 0) * 100) + '%'); } });
      }).then(function (w) { return w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' }).then(function () { return w; }); });
      S.worker.catch(function () { S.worker = null; });
      return S.worker;
    }
    function ocrWords(w, canvas) {
      return w.recognize(canvas, {}, { blocks: true }).then(function (r) {
        var out = [], d = r && r.data || {};
        if (d.blocks) d.blocks.forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (x) { out.push(x); }); }); }); });
        else (d.words || []).forEach(function (x) { out.push(x); });
        return out.map(function (x) { return { text: x.text, x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1, conf: x.confidence }; });
      });
    }
    /** 코드 띠의 "잉크 지도"(1 = 어두운 점)에서, 아래 가장자리를 뚫고 올라온 줄기(가는 세로줄)를 지웁니다 — 줄기가 글자에 붙어 읽히지 않게 */
    function eraseStems(ink, bw, bh, sp) {
      var maxRun = Math.round(sp * 3.2), x, y, dx, xx;
      for (x = 0; x < bw; x++) {
        if (!ink[(bh - 1) * bw + x]) continue;
        var run = 0; while (run < bh && ink[(bh - 1 - run) * bw + x]) run++;
        if (run <= maxRun) for (y = bh - run; y < bh; y++) for (dx = -1; dx <= 1; dx++) { xx = x + dx; if (xx >= 0 && xx < bw) ink[y * bw + xx] = 0; }
      }
    }
    /** 띠 안의 글자 덩어리(코드 하나 = 가로로 붙어 있는 잉크 무리)를 x 순서로 찾습니다 */
    function inkTokens(ink, bw, bh, sp) {
      var col = new Uint8Array(bw), x, y, out = [], gap = Math.max(3, Math.round(sp * 0.55));
      for (x = 0; x < bw; x++) for (y = 0; y < bh; y++) if (ink[y * bw + x]) { col[x] = 1; break; }
      x = 0;
      while (x < bw) {
        if (!col[x]) { x++; continue; }
        var a = x, last = x; while (x < bw && x - last <= gap) { if (col[x]) last = x; x++; }
        var y0 = bh, y1 = -1, xx; for (xx = a; xx <= last; xx++) for (y = 0; y < bh; y++) if (ink[y * bw + xx]) { if (y < y0) y0 = y; break; }
        for (xx = a; xx <= last; xx++) for (y = bh - 1; y >= 0; y--) if (ink[y * bw + xx]) { if (y > y1) y1 = y; break; }
        if (y1 >= y0) out.push({ x0: a, x1: last, y0: y0, y1: y1 });
      }
      return out;
    }
    /** 글자 덩어리 하나를 잘라 흰 바탕 · 검은 글자 그림으로 (글자 높이 64px 로 맞춤 — 작은 글자는 키워서) */
    function tokenCanvas(ink, bw, t) {
      var tw = t.x1 - t.x0 + 1, th = t.y1 - t.y0 + 1, pad = Math.round(th * 0.35), c = doc.createElement('canvas'), x, y;
      c.width = tw; c.height = th; var cx = c.getContext('2d'), im = cx.createImageData(tw, th);
      for (y = 0; y < th; y++) for (x = 0; x < tw; x++) { var v = ink[(t.y0 + y) * bw + t.x0 + x] ? 0 : 255, i = (y * tw + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
      cx.putImageData(im, 0, 0);
      var k = 64 / th, out = doc.createElement('canvas'); out.width = Math.max(8, Math.round((tw + 2 * pad) * k)); out.height = Math.max(8, Math.round((th + 2 * pad) * k));
      var oc = out.getContext('2d'); oc.fillStyle = '#fff'; oc.fillRect(0, 0, out.width, out.height); oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
      oc.drawImage(c, 0, 0, tw, th, Math.round(pad * k), Math.round(pad * k), Math.round(tw * k), Math.round(th * k));
      return out;
    }
    function setPsm(w, psm) { return w.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' }); }
    /** 오선 위 띠마다 글자 덩어리를 하나씩 잘라 읽음 (쪽 전체를 한꺼번에 읽으면 C · G 같은 한 글자 코드를 자주 놓침) — 코드로 읽히는 것만 남김 */
    function ocrChords(cv0, om, W, Hh) {
      return getWorker().then(function (w) {
        var melodyStaves = om.staves.filter(function (s) { return s.melody; }), out = [], big = cv0.getContext('2d');
        function pageLevel() {
          setStat('OCR 읽는 중… (페이지 전체)');
          return setPsm(w, '11').then(function () { return ocrWords(w, cv0); }).then(function (words) {
            var cs = HC.chordsFromTokens(words, { fixOcr: true }), capH = median(cs.map(function (c) { return c.y1 - c.y0; }));
            cs.forEach(function (c) { out.push({ id: uid(), text: c.text, pre: c.pre, post: c.post, x: c.x0 / W, y: c.y0 / Hh, w: (c.x1 - c.x0) / W, h: (c.y1 - c.y0) / Hh, fs: (capH / 0.72) / Hh, conf: c.conf, src: 'ocr' }); });
            return out;
          });
        }
        if (!melodyStaves.length) return pageLevel();
        var seq = setPsm(w, '7');
        melodyStaves.forEach(function (st, i) {
          seq = seq.then(function () {
            var prev = null; om.staves.forEach(function (s) { if (s.bottom < st.top && (!prev || s.bottom > prev.bottom)) prev = s; });
            var top = Math.round(Math.max(prev ? prev.bottom + 0.5 * st.sp : 0, st.top - 7 * st.sp)), bh = Math.round(st.top - 0.3 * st.sp) - top;
            if (bh < 8) return null;
            var d = big.getImageData(0, top, W, bh).data, ink = new Uint8Array(W * bh), k;
            for (k = 0; k < ink.length; k++) ink[k] = (d[k * 4] * 0.299 + d[k * 4 + 1] * 0.587 + d[k * 4 + 2] * 0.114) < 150 ? 1 : 0;
            eraseStems(ink, W, bh, st.sp);
            var toks = inkTokens(ink, W, bh, st.sp).filter(function (t) { var th = t.y1 - t.y0 + 1, tw = t.x1 - t.x0 + 1; return th >= st.sp * 0.5 && th <= st.sp * 3 && tw >= st.sp * 0.3; }), ti = 0, found = [];
            function next() {
              if (ti >= toks.length) return null;
              var t = toks[ti++], cnv = tokenCanvas(ink, W, t);
              setStat('OCR 읽는 중… ' + (i + 1) + ' / ' + melodyStaves.length + ' 줄 (' + ti + ' / ' + toks.length + ')');
              function read(psm) { return (psm === '7' ? Promise.resolve() : setPsm(w, psm)).then(function () { return w.recognize(cnv); }).then(function (r) {
                var txt = String((r.data && r.data.text) || '').replace(/\s+/g, ''), fx = HC.fixOcrChord(txt); return { text: fx, ok: !!HC.parseChord(fx), conf: r.data && r.data.confidence, raw: txt };
              }); }
              return read('7').then(function (r1) {
                if (r1.ok || (t.x1 - t.x0 + 1) > (t.y1 - t.y0 + 1) * 1.8) return r1;
                return read('10').then(function (r2) { return setPsm(w, '7').then(function () { return r2.ok ? r2 : r1; }); });                // 한 글자짜리는 "글자 하나" 모드로 한 번 더
              }).then(function (r) {
                if (r.ok) found.push({ text: r.text, conf: r.conf, x0: t.x0, x1: t.x1 + 1, y0: t.y0, y1: t.y1 + 1 });
                return next();
              });
            }
            return Promise.resolve(next()).then(function () {
              var capH = median(found.map(function (c) { return c.y1 - c.y0; }));
              found.forEach(function (c) {
                var pc = HC.parseChord(c.text);
                out.push({ id: uid(), text: c.text, pre: '', post: '', x: c.x0 / W, y: (top + c.y0) / Hh, w: (c.x1 - c.x0) / W, h: (c.y1 - c.y0) / Hh, fs: (capH / 0.72) / Hh, conf: c.conf, src: 'ocr' });
              });
            });
          });
        });
        return seq.then(function () { return out; });
      });
    }
    function samplePaper(rgba) {
      var r = 0, g = 0, b = 0, n = 0, i;
      for (i = 0; i < rgba.length; i += 4 * 13) { var lum = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114; if (lum > 185) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++; } }
      return n ? 'rgb(' + Math.round(r / n) + ',' + Math.round(g / n) + ',' + Math.round(b / n) + ')' : '#fff';
    }
    function analyzeOne(pg, forceOcr) {
      return P.pageSize(pg).then(function (sz) {
        var sc = clamp(2000 / sz.w, 0.4, 6), cv0 = doc.createElement('canvas');
        setStat(pg + '페이지 그림을 준비하는 중…');
        return P.renderPageTo(cv0, pg, sc).then(tick).then(function () {
          var W = cv0.width, Hh = cv0.height, img = cv0.getContext('2d').getImageData(0, 0, W, Hh);
          setStat(pg + '페이지 오선 · 멜로디를 찾는 중…');
          var om = OM.analyze(img.data, W, Hh, { adaptive: !(P.pdf && P.pdf()) }), paper = samplePaper(img.data);
          return tick().then(function () { return forceOcr ? null : textLayerChords(pg); }).then(function (tl) {
            if (tl && tl.chords.length) return { chords: tl.chords, src: 'text' };
            setStat('코드를 OCR 로 읽는 중… (처음에는 OCR 도구를 내려받느라 시간이 걸립니다)');
            return ocrChords(cv0, om, W, Hh).then(function (cs) { return { chords: cs, src: 'ocr' }; });
          }).then(function (cr) {
            var staves = om.staves.map(function (s) { return { top: s.top / Hh, bottom: s.bottom / Hh, sp: s.sp / Hh, x0: s.x0 / W, x1: s.x1 / W, sys: s.sys, melody: !!s.melody }; });
            var notes = om.notes.map(function (n) { return { id: uid(), staff: n.staff, x: n.x / W, step: n.step, open: !!n.open, beats: n.beats, rest: n.restAfter || 0, src: 'auto' }; });
            var old = S.data.pages[pg]; if (old) { old.notes.forEach(function (n) { delete S.data.ov.alto[n.id]; delete S.data.ov.tenor[n.id]; }); Object.keys(S.data.use).forEach(function (k) { if (k.indexOf(pg + ':') === 0) delete S.data.use[k]; }); }
            S.data.pages[pg] = { w: W, h: Hh, paper: paper, chords: cr.chords, staves: staves, notes: notes, src: cr.src, at: Date.now() };
            return { pg: pg, chords: cr.chords.length, staves: staves.length, notes: notes.length, src: cr.src };
          });
        });
      });
    }
    function analyze(pages, forceOcr, auto) {
      if (S.busy) return;
      S.busy = true; S.autoRun = !!auto; S.undo = []; syncPanel();
      var results = [], seq = Promise.resolve();
      pages.forEach(function (pg) { seq = seq.then(function () { return analyzeOne(pg, forceOcr).then(function (r) { results.push(r); commit(); }); }); });
      seq.then(function () {
        S.busy = false; saveNow(); computeModel(); redraw();
        var cur = results.filter(function (r) { return String(r.pg) === pgKey(); })[0] || results[0];
        var msg = pages.length > 1 ? results.length + '페이지 분석 완료. ' : '';
        if (cur) msg += cur.pg + '페이지: 코드 ' + cur.chords + '개(' + (cur.src === 'text' ? 'PDF 글자층' : 'OCR') + ') · 오선 ' + cur.staves + '줄 · 멜로디 음 ' + cur.notes + '개';
        var warn = '';
        if (cur && !cur.staves) warn = ' — 오선을 찾지 못했습니다. 코드 변환만 되고 화음은 만들 수 없습니다.';
        else if (cur && !cur.notes) warn = ' — 멜로디 음표를 찾지 못했습니다. "멜로디 수정"에서 음표를 직접 찍을 수 있습니다.';
        else if (cur && !cur.chords) warn = ' — 코드를 찾지 못했습니다. "코드 수정"에서 직접 넣을 수 있습니다.';
        setStat(msg + warn, !!warn); syncPanel();
        if (S.autoRun) {                                                               // 키 이동 때문에 자동으로 돌린 분석 — 유튜브 · 재생 카드에도 결과를 알림
          if (cur && cur.chords) note('이 페이지 코드 ' + cur.chords + '개를 ' + HC.keyName(S.okey) + ' → ' + HC.keyName(S.tkey) + ' (' + (S.semis > 0 ? '+' : '') + S.semis + ') 로 바꿔 그렸습니다. (' + (cur.src === 'text' ? 'PDF 글자층' : 'OCR') + ')');
          else note('이 페이지에서 코드를 찾지 못해 바꿀 코드가 없습니다.' + (cur && !cur.staves ? '' : ' 화음 탭의 "코드" 모드에서 직접 넣을 수 있습니다.'), true);
        }
        S.autoRun = false; if (S.autoPend) { S.autoPend = false; maybeAuto(); }
      }, function (e) {
        S.busy = false; var m = '분석하지 못했습니다: ' + ((e && e.message) || e); setStat(m, true); syncPanel();
        if (S.autoRun) toast('악보 코드 자동 분석: ' + m, true);
        S.autoRun = false; if (S.autoPend) { S.autoPend = false; maybeAuto(); }
      });
    }
    /** 연습 키 이동이 0 이 아닌데 이 페이지이 아직 분석 전이면 자동으로 한 번 분석 (쪽 · 악보마다 세션에 한 번). 화면을 막지 않고, 오프라인 + 글자층 없음이면 안내만 */
    function maybeAuto() {
      if (S.dead || !S.data || !S.autoOn || !pShift()) return;
      var pg = P.page(), key = S.fid + ':' + pg;
      if (S.data.pages[String(pg)] || S.autoTried[key]) return;
      if (S.busy) { S.autoPend = true; return; }
      S.autoTried[key] = 1;
      var sheetNow = S.fid;
      P.pageSize(pg).then(function () { return textLayerChords(pg).catch(function () { return null; }); }, function () { return undefined; }).then(function (tl) {
        if (S.dead) return;
        if (tl === undefined || sheetNow !== S.fid || pg !== P.page()) { delete S.autoTried[key]; return; }           // 악보가 아직 안 열렸거나 그 사이 페이지이 바뀜 → 'sheet' · 'page' 가 다시 부름
        var hasText = !!(tl && tl.chords.length);
        if (!hasText && root.navigator && root.navigator.onLine === false && typeof root.Tesseract === 'undefined') {
          var m = '오프라인이라 글자가 없는 악보(그림 · 스캔)의 코드를 자동으로 읽지 못했습니다. 인터넷에 연결된 뒤 화음 탭의 "이 페이지 분석"을 눌러 주세요.';
          note(m, true); toast(m, true); return;
        }
        if (S.busy) { S.autoPend = true; delete S.autoTried[key]; return; }
        note(pg + '페이지 코드를 ' + (hasText ? 'PDF 글자층에서' : 'OCR 로(처음에는 도구를 내려받느라 시간이 걸립니다)') + ' 읽는 중…');
        setStat(pg + '페이지 코드를 자동으로 읽는 중…'); analyze([pg], false, true);
      });
    }
    /** 연습 키 이동 n 을 이 악보에 적용: 목표 조 = 원래 조 + n 반음 → 코드를 다시 그림 → 필요하면 자동 분석 */
    function applyShift(n) {
      if (S.dead || !S.data) return;
      n = clampShift(n);
      if (n === 0 && typeof S.data.tshift !== 'number') { note('원래 키 그대로 — 악보 코드를 바꾸지 않습니다.'); return; }        // 손으로 정한 목표 조는 건드리지 않음
      if (S.data.tshift !== n) { S.data.tshift = n; S.statMsg = ''; commit(); } else { computeModel(); redraw(); syncPanel(); }
      noteState(); maybeAuto();
    }
    /** 지금 쪽의 상태를 유튜브 · 재생 카드의 "악보:" 줄에 알림 */
    function noteState() {
      var n = pShift(), pg = pgKey(), pd = S.data && S.data.pages[pg];
      if (n === 0) { note('원래 키 그대로 — 악보 코드를 바꾸지 않습니다.'); return; }
      if (pd) { var nc = pd.chords.filter(function (c) { return c.parsed; }).length; note(nc ? '이 페이지 코드 ' + nc + '개를 ' + HC.keyName(S.okey) + ' → ' + HC.keyName(S.tkey) + ' (' + (S.semis > 0 ? '+' : '') + S.semis + ') 로 바꿔 그렸습니다.' : '이 페이지에서 읽은 코드가 없습니다.', !nc); }
      else if (S.autoOn) { if (S.busy) note('분석이 끝나면 이 페이지 코드를 바꿔 그립니다…'); }
      else note('이 페이지은 아직 분석하지 않았습니다. 화음 탭에서 "이 페이지 분석"을 눌러 주세요 (자동 분석이 꺼져 있습니다).', true);
    }

    /* ---------- 소리 ---------- */
    function fallbackSynth(actx, dest) {
      return { on: function (midi, vel, when) {
        var t = when == null ? actx.currentTime : when, o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25 * (vel || 0.8), t + 0.02);
        o.connect(g); g.connect(dest); o.start(t);
        return { off: function (w) { var t2 = Math.max(w == null ? actx.currentTime : w, t); try { g.gain.setTargetAtTime(0.0001, t2, 0.08); o.stop(t2 + 0.5); } catch (e) {} } };
      }, allOff: function () {} };
    }
    function ensureAudio() {
      if (au.ctx && au.ctx.state !== 'closed') { if (au.ctx.state === 'suspended') { try { au.ctx.resume(); } catch (e) {} } return au; }
      var AC = root.AudioContext || root.webkitAudioContext; if (!AC) throw new Error('이 브라우저는 소리 미리듣기를 지원하지 않습니다.');
      try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (e) {}
      au.ctx = new AC(); au.master = au.ctx.createGain(); au.master.gain.value = clamp(S.data.vol, 0.05, 1.5);
      var comp = au.ctx.createDynamicsCompressor ? au.ctx.createDynamicsCompressor() : null;
      if (comp) { au.master.connect(comp); comp.connect(au.ctx.destination); } else au.master.connect(au.ctx.destination);
      au.synth = root.YNPitch && root.YNPitch.createSynth ? root.YNPitch.createSynth(au.ctx, au.master) : fallbackSynth(au.ctx, au.master);
      return au;
    }
    function tone(midi, dur) { try { var a = ensureAudio(), v = a.synth.on(midi + (S.data.keyMode === 'target' ? S.semis : 0), 0.85); v.off(a.ctx.currentTime + (dur || 0.4)); } catch (e) { /* 소리가 안 나도 그리기는 계속 */ } }
    function playItems(pg) {
      var M = S.model[pg]; if (!M) return [];
      return M.notes.map(function (n) { return { midi: n.midi, alto: n.altoF, tenor: n.tenorF, beats: n.beats, rest: n.rest, id: n.id }; });
    }
    function play() {
      if (S.playing) { stop(); return; }
      var pg = pgKey(), items = playItems(pg);
      if (!items.length) { toast('먼저 "이 페이지 분석"으로 멜로디를 찾거나, "멜로디 수정"에서 음표를 찍어 주세요.', true); return; }
      var a; try { a = ensureAudio(); } catch (e) { toast(e.message, true); return; }
      var bpm = +S.data.bpm || (P.song() && +P.song().bpm >= 30 && +P.song().bpm <= 240 ? +P.song().bpm : 80);
      var sch = HC.buildSchedule(items, { bpm: bpm, semis: S.data.keyMode === 'target' ? S.semis : 0, voices: S.data.voices });
      var t0 = a.ctx.currentTime + 0.1, vel = { m: 0.9, a: 0.72, t: 0.72 };
      sch.events.forEach(function (e) { try { var v = a.synth.on(e.midi, vel[e.voice], t0 + e.t); v.off(t0 + e.t + e.dur); } catch (x) {} });
      S.playing = { t0: t0, sch: sch, pg: pg, raf: 0 }; S.playIdx = -1; syncPanel();
      (function loop() {
        if (!S.playing || S.dead) return;
        var now = a.ctx.currentTime - t0, i = -1, k;
        for (k = 0; k < sch.starts.length; k++) if (sch.starts[k] <= now) i = k; else break;
        if (i !== S.playIdx) { S.playIdx = i; redraw(); }
        if (now > sch.total + 0.35) { if (S.loop) { stop(true); play(); } else stop(); return; }
        S.playing.raf = root.requestAnimationFrame ? root.requestAnimationFrame(loop) : setTimeout(loop, 30);
      })();
    }
    function stop(keepLoop) {
      var p = S.playing; S.playing = null; S.playIdx = -1;
      if (p && p.raf) { try { root.cancelAnimationFrame(p.raf); } catch (e) {} }
      try { if (au.synth) au.synth.allOff(); } catch (e) {}
      if (!keepLoop) { redraw(); syncPanel(); }
    }

    /* ---------- 눌러서 고치기 (마우스 · 손가락 · 애플 펜슬 공통) ---------- */
    function toLocal(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.clientWidth / r.width), y: (e.clientY - r.top) * (cv.clientHeight / r.height), nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height }; }
    function hitAt(p, kinds, touch) {
      var best = null, bd = 1e9;
      S.hits.forEach(function (q) {
        if (kinds.indexOf(q.kind) < 0) return;
        var d, ok;
        if (q.kind === 'chord') { ok = Math.abs(p.x - q.x) <= q.w / 2 + (touch ? 8 : 2) && Math.abs(p.y - q.y) <= q.h / 2 + (touch ? 8 : 2); d = Math.hypot(p.x - q.x, p.y - q.y); }
        else { d = Math.hypot(p.x - q.x, p.y - q.y); ok = d <= q.r * (touch ? 1.4 : 1); }
        if (ok && d < bd) { bd = d; best = q; }
      });
      return best;
    }
    function noteOf(id) { var M = S.model[pgKey()]; if (!M) return null; for (var i = 0; i < M.notes.length; i++) if (M.notes[i].id === id) return M.notes[i]; return null; }
    function stepFromY(st, ny, snapMin) { return clamp(Math.round((st.bottom - ny) / (st.sp / 2)), snapMin == null ? -7 : snapMin, 17); }
    function staffAt(pd, pg, ny) {
      var best = -1, bd = 1e9; pd.staves.forEach(function (st, i) { if (!usedStaff(pg, i)) return; var c0 = (st.top + st.bottom) / 2, d = Math.abs(ny - c0); if (ny >= st.top - 4 * st.sp && ny <= st.bottom + 4 * st.sp && d < bd) { bd = d; best = i; } });
      return best;
    }
    var ptr = null;
    function onDown(e) {
      if (S.mode === 'view' || S.dead) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'touch' && ((e.width || 0) > 44 || (e.height || 0) > 44)) return;            // 손바닥은 무시
      var p = toLocal(e), touch = e.pointerType !== 'mouse', pg = pgKey(), pd = S.data.pages[pg]; if (!pd) return;
      e.preventDefault(); if (S.editor) closeEditor(true);
      if (S.mode === 'harmony') {
        var q = hitAt(p, ['alto', 'tenor'], touch); if (!q) { S.sel = null; redraw(); syncPanel(); return; }
        var nt = noteOf(q.id); if (!nt) return;
        var now = Date.now(), dbl = S.lastTap && S.lastTap.id === q.id && S.lastTap.k === q.kind && now - S.lastTap.t < 380; S.lastTap = { id: q.id, k: q.kind, t: now };
        if (dbl) { resetVoice(q.kind, q.id); return; }
        S.sel = { kind: q.kind, id: q.id }; var cur = q.kind === 'alto' ? nt.altoF : nt.tenorF;
        S.drag = { kind: q.kind, id: q.id, midi: cur, orig: cur, hadOv: q.kind === 'alto' ? nt.altoEd : nt.tenorEd, moved: false, pid: e.pointerId, dy: p.y - q.y };
        try { cv.setPointerCapture(e.pointerId); } catch (x) {}
        tone(cur, 0.35); redraw(); syncPanel(); return;
      }
      if (S.mode === 'melody') {
        var m = hitAt(p, ['melody'], touch), sub = S.sub.melody;
        if (m) {
          var mn = noteOf(m.id); if (!mn) return;
          if (sub === 'del') { deleteMelody(m.id); return; }
          S.sel = { kind: 'melody', id: m.id };
          S.drag = { kind: 'melody', id: m.id, x0: mn.n.x, s0: mn.n.step, st0: mn.n.staff, moved: false, pid: e.pointerId, dy: p.y - m.y };
          try { cv.setPointerCapture(e.pointerId); } catch (x) {}
          tone(mn.midi, 0.3); redraw(); syncPanel(); return;
        }
        if (sub === 'add') {
          var si = staffAt(pd, pg, p.ny); if (si < 0) { toast('오선 근처를 눌러 주세요.', true); return; }
          var st = pd.staves[si], step = stepFromY(st, p.ny), n = { id: uid(), staff: si, x: p.nx, step: step, open: false, beats: 1, rest: 0, src: 'user' };
          pd.notes.push(n); pushUndo(function () { pd.notes = pd.notes.filter(function (z) { return z.id !== n.id; }); });
          S.sel = { kind: 'melody', id: n.id }; commit(); tone(HC.stepToMidi(step, S.okey), 0.3); return;
        }
        S.sel = null; redraw(); syncPanel(); return;
      }
      if (S.mode === 'chord') {
        var c = hitAt(p, ['chord'], touch), sub2 = S.sub.chord;
        if (c) { openEditor(c.id, null); return; }
        if (sub2 === 'add') { openEditor(null, { nx: p.nx, ny: p.ny }); return; }
      }
    }
    function onMove(e) {
      var dr = S.drag; if (!dr || e.pointerId !== dr.pid) return;
      var p = toLocal(e), pg = pgKey(), pd = S.data.pages[pg], nt = noteOf(dr.id); if (!nt) return;
      var st = pd.staves[dr.kind === 'melody' ? nt.staff : nt.staff];
      var ny = (p.y - dr.dy) / cv.clientHeight, step = stepFromY(st, ny);
      if (dr.kind === 'alto' || dr.kind === 'tenor') {
        var midi = clamp(HC.stepToMidi(step, S.okey), 36, 90);
        if (midi !== dr.midi) { dr.midi = midi; dr.moved = true; tone(midi, 0.28); redraw(); }
      } else {
        var nx = clamp(p.nx, st.x0, st.x1);
        if (step !== nt.n.step || Math.abs(nx - nt.n.x) > 0.0005) { if (step !== nt.n.step) tone(HC.stepToMidi(step, S.okey), 0.25); nt.n.step = step; nt.n.x = nx; dr.moved = true; computeModel(); redraw(); }
      }
    }
    function onUp(e) {
      var dr = S.drag; if (!dr || (e && e.pointerId !== dr.pid)) return;
      S.drag = null; try { cv.releasePointerCapture(dr.pid); } catch (x) {}
      if (dr.kind === 'alto' || dr.kind === 'tenor') {
        if (dr.moved && dr.midi !== dr.orig) {
          var o = S.data.ov[dr.kind], prev = dr.hadOv ? dr.orig : undefined, id = dr.id, kind = dr.kind;
          o[id] = dr.midi; pushUndo(function () { if (prev === undefined) delete S.data.ov[kind][id]; else S.data.ov[kind][id] = prev; });
        }
      } else if (dr.moved) {
        var nt = noteOf(dr.id), n = nt && nt.n, id2 = dr.id, x0 = dr.x0, s0 = dr.s0, pdx = S.data.pages[pgKey()];
        if (n) pushUndo(function () { var z = pdx.notes.filter(function (q) { return q.id === id2; })[0]; if (z) { z.x = x0; z.step = s0; } });
      }
      commit();
    }
    function resetVoice(kind, id) {
      var o = S.data.ov[kind]; if (o[id] == null) { toast('이 음은 자동 계산값 그대로입니다.'); return; }
      var prev = o[id]; delete o[id]; pushUndo(function () { S.data.ov[kind][id] = prev; }); commit(); toast('자동 계산값으로 되돌렸습니다.');
    }
    function nudge(dir) {
      var s = S.sel; if (!s || (s.kind !== 'alto' && s.kind !== 'tenor')) return;
      var nt = noteOf(s.id); if (!nt) return; var cur = s.kind === 'alto' ? nt.altoF : nt.tenorF, o = S.data.ov[s.kind], prev = o[s.id], had = prev != null;
      o[s.id] = clamp(cur + dir, 36, 90); pushUndo(function () { if (!had) delete S.data.ov[s.kind][s.id]; else S.data.ov[s.kind][s.id] = prev; }); tone(o[s.id], 0.35); commit();
    }
    function deleteMelody(id) {
      var pd = S.data.pages[pgKey()], n = pd.notes.filter(function (z) { return z.id === id; })[0]; if (!n) return;
      pd.notes = pd.notes.filter(function (z) { return z.id !== id; }); if (S.sel && S.sel.id === id) S.sel = null;
      pushUndo(function () { pd.notes.push(n); }); commit();
    }
    /* 코드 글자 고치기 — 칩 자리에 입력칸을 띄움 */
    function openEditor(id, at) {
      var pg = pgKey(), pd = S.data.pages[pg], cd = id ? pd.chords.filter(function (c) { return c.id === id; })[0] : null; if (id && !cd) return;
      var W = cv.clientWidth, Hh = cv.clientHeight, inp = doc.createElement('input');
      inp.type = 'text'; inp.className = 'hm-edit'; inp.value = cd ? cd.text : ''; inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('autocomplete', 'off'); inp.setAttribute('spellcheck', 'false'); inp.setAttribute('enterkeyhint', 'done'); inp.setAttribute('aria-label', '코드 (원래 악보에 적힌 그대로)');
      var x = cd ? cd.x * W - 6 : at.nx * W - 30, y = cd ? cd.y * Hh - 8 : at.ny * Hh - 18;
      inp.style.left = Math.max(0, x) + 'px'; inp.style.top = Math.max(0, y) + 'px'; inp.style.width = Math.max(96, cd ? cd.w * W + 40 : 96) + 'px';
      box.appendChild(inp); S.editor = { inp: inp, id: id, at: at }; setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 0);
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); closeEditor(false); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeEditor(true); } ev.stopPropagation(); });
      inp.addEventListener('blur', function () { setTimeout(function () { if (S.editor && S.editor.inp === inp) closeEditor(false); }, 120); });
      ['pointerdown', 'touchstart', 'click'].forEach(function (n) { inp.addEventListener(n, function (ev) { ev.stopPropagation(); }); });
    }
    function closeEditor(cancel) {
      var ed = S.editor; if (!ed) return; S.editor = null; var txt = (ed.inp.value || '').trim(); try { ed.inp.remove(); } catch (e) {}
      if (cancel) return;
      var pg = pgKey(), pd = S.data.pages[pg], cd = ed.id ? pd.chords.filter(function (c) { return c.id === ed.id; })[0] : null;
      if (!txt) { if (cd) { pd.chords = pd.chords.filter(function (c) { return c.id !== cd.id; }); pushUndo(function () { pd.chords.push(cd); }); commit(); } return; }
      var fixed = HC.fixOcrChord(txt), parsed = HC.parseChord(fixed);
      if (!parsed) { toast('"' + txt + '" 은(는) 코드로 읽을 수 없습니다. (예: G, Am7, D/F#, Bbmaj7)', true); return; }
      if (cd) { var prev = cd.text; if (prev === fixed) return; cd.text = fixed; pushUndo(function () { cd.text = prev; }); }
      else {
        var W = cv.clientWidth, Hh = cv.clientHeight, fs = median((pd.chords || []).map(function (c) { return c.fs || c.h; })) || 0.014, ms = measurer(), wpx = ms(fixed) / 20 * fs * Hh;
        var n = { id: uid(), text: fixed, pre: '', post: '', x: ed.at.nx, y: ed.at.ny - fs * 0.5, w: wpx / W, h: fs * 1.05, fs: fs, src: 'user' };
        pd.chords.push(n); pushUndo(function () { pd.chords = pd.chords.filter(function (c) { return c.id !== n.id; }); });
      }
      commit();
    }

    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    ['touchstart', 'touchmove', 'touchend'].forEach(function (n) { cv.addEventListener(n, function (e) { if (S.mode !== 'view') { e.stopPropagation(); if (e.cancelable && n !== 'touchend') e.preventDefault(); } }, { passive: false }); });      // 쓸어 넘기기 · 확대 제스처가 끼어들지 않게

    function setMode(m) {
      if (S.editor) closeEditor(true);
      S.mode = m; S.sel = null; S.drag = null; cv.style.pointerEvents = m === 'view' ? 'none' : 'auto'; cv.style.cursor = m === 'view' ? '' : m === 'chord' ? 'text' : 'grab';
      redraw(); syncPanel();
    }
    P.on('tool', function (t) { if (!S.dead && S.mode !== 'view' && t && t !== 'none') setMode('view'); });                    // 필기 도구를 고르면 화음 수정은 끝냄

    /* ---------- 패널 ---------- */
    host.innerHTML =
      '<div class="hm">' +
      '<div class="pv-sec"><h4>① 악보 분석 — 코드 · 오선 · 멜로디</h4>' +
        '<div class="pv-row"><button type="button" class="pv-btn2 primary" data-a="an-page">🔍 이 페이지 분석</button><button type="button" class="pv-btn2" data-a="an-all">전체 페이지 분석</button></div>' +
        '<label class="pv-switch" style="margin-top:10px"><input type="checkbox" data-o="ocr"><span></span><b>PDF 글자 대신 OCR 로 읽기</b></label>' +
        '<div class="hm-stat" role="status" aria-live="polite"></div>' +
        '<p class="pv-help">PDF 는 글자층에서 코드와 위치를 정확히 읽습니다. 글자가 없는 스캔 · 사진 악보는 OCR(처음 한 번 도구를 내려받음)로 읽습니다. 오선이 반듯한 악보일수록 멜로디 인식이 잘 됩니다.</p></div>' +
      '<div class="pv-sec"><h4>② 키 바꾸기</h4>' +
        '<div class="hm-keys"><label>원래 조<select class="pv-sel" data-o="orig" aria-label="원래 조"></select></label><span class="hm-arrow" aria-hidden="true">➔</span><label>목표 조<select class="pv-sel" data-o="target" aria-label="목표 조"></select></label></div>' +
        '<div class="hm-semis" aria-live="polite"></div>' +
        '<div class="pv-row"><button type="button" class="pv-btn2" data-a="song-key" style="display:none"></button></div>' +
        '<label class="pv-switch" style="margin-top:10px"><input type="checkbox" data-o="showorig"><span></span><b>원래 코드 그대로 보기</b></label>' +
        '<label class="pv-switch" style="margin-top:10px"><input type="checkbox" data-o="auto"><span></span><b>키를 바꾸면 이 페이지을 자동으로 분석</b></label>' +
        '<p class="pv-help hm-linkhelp">유튜브 카드 · 키 바꿔 듣기 카드의 키(−3 ~ +3 반음)와 이 목표 조는 같은 값입니다. 어느 쪽을 바꿔도 다른 쪽이 따라옵니다 (±3 반음 안에서). 키를 바꿨는데 이 페이지이 아직 분석 전이면 알아서 한 번 분석합니다.</p></div>' +
      '<div class="pv-sec"><h4>③ 화음 보기 <span class="hm-legend"><span><i class="hm-dot" style="background:#FF4D4D"></i>알토</span><span><i class="hm-dot" style="background:#4D94FF"></i>테너</span></span></h4>' +
        '<div class="hm-chk"><label><input type="checkbox" data-o="alto"> 알토(빨강)</label><label><input type="checkbox" data-o="tenor"> 테너(파랑)</label><label><input type="checkbox" data-o="link"> 멜로디와 연결선</label></div>' +
        '<div class="pv-row"><button type="button" class="pv-btn2" data-a="reset-all">수정 모두 자동값으로</button></div>' +
        '<p class="pv-help">알토는 멜로디 3도 아래(높으면 위 6도), 테너는 아래 6도 · 옥타브 · 안쪽 화음음을 코드음 안에서 골라, 앞뒤 도약과 병행 5도/8도를 피하도록 곡 전체를 함께 계산합니다. 표시는 인쇄된 악보의 조(원래 조) 기준입니다.</p></div>' +
      '<div class="pv-sec"><h4>④ 손으로 고치기</h4>' +
        '<div class="hm-seg" role="group" aria-label="고치기 방식"><button type="button" data-mode="view">보기</button><button type="button" data-mode="harmony">화음</button><button type="button" data-mode="melody">멜로디</button><button type="button" data-mode="chord">코드</button></div>' +
        '<div class="hm-seg hm-sub" data-sub="melody" style="display:none" role="group" aria-label="멜로디 도구"><button type="button" data-sub="move">이동</button><button type="button" data-sub="add">＋ 추가</button><button type="button" data-sub="del">🗑 지우기</button></div>' +
        '<div class="hm-seg hm-sub" data-sub="chord" style="display:none" role="group" aria-label="코드 도구"><button type="button" data-sub="edit">고치기 · 지우기</button><button type="button" data-sub="add">＋ 추가</button></div>' +
        '<div class="hm-sel" style="display:none"></div>' +
        '<div class="pv-row"><button type="button" class="pv-btn2" data-a="undo">↶ 되돌리기</button></div>' +
        '<p class="pv-help hm-modehelp"></p></div>' +
      '<div class="pv-sec"><h4>⑤ 화음 미리듣기</h4>' +
        '<div class="pv-row" style="align-items:center"><button type="button" class="pv-btn2 primary" data-a="play" style="min-width:190px">▶ 화음 미리듣기</button><label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:800">BPM <input class="hm-num" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" maxlength="3" data-o="bpm" aria-label="BPM"></label></div>' +
        '<div class="hm-chk"><label><input type="checkbox" data-v="m"> 멜로디</label><label><input type="checkbox" data-v="a"> <span style="color:#FF7A7A">알토</span></label><label><input type="checkbox" data-v="t"> <span style="color:#7AB2FF">테너</span></label><label><input type="checkbox" data-o="loop"> 반복</label></div>' +
        '<div class="hm-keys" style="margin-top:10px;grid-template-columns:1fr 1fr"><label>소리 높이<select class="pv-sel" data-o="keymode" aria-label="미리듣기 조"><option value="target">목표 조로 듣기</option><option value="orig">원래 조로 듣기</option></select></label><label>음량<input type="range" min="10" max="150" data-o="vol" aria-label="음량"></label></div>' +
        '<p class="pv-help">음 길이는 음표 모양(빈 머리 · 줄기 · 꼬리 · 점)으로 짐작하므로 실제 리듬과 다를 수 있습니다. 화음을 끌어 옮기는 동안에도 그 음이 들립니다.</p></div>' +
      '<div class="pv-sec hm-staffs" style="display:none"><h4>멜로디로 쓸 오선 (이 페이지)</h4><div class="hm-stafflist"></div><p class="pv-help">피아노 반주(큰 보표)의 아래 줄이 멜로디로 읽히면 체크를 끄세요.</p></div>' +
      '<div class="pv-sec"><div class="pv-row"><button type="button" class="pv-btn2" data-a="png">🖼 바뀐 코드·화음 넣은 그림 저장 (이 페이지)</button></div></div>' +
      '</div>';
    var $ = function (sel) { return host.querySelector(sel); };
    var statEl = $('.hm-stat'), semisEl = $('.hm-semis'), selEl = $('.hm-sel'), helpEl = $('.hm-modehelp'), selOrig = $('[data-o=orig]'), selTarget = $('[data-o=target]'), songBtn = $('[data-a=song-key]');
    var HELP = {
      view: '"화음 / 멜로디 / 코드"를 고르면 악보 위에서 바로 고칠 수 있습니다. (고치는 동안에는 필기 · 페이지 넘기기 제스처가 잠시 멈춥니다)',
      harmony: '빨강(알토) · 파랑(테너) 음표를 <b>위아래로 끌면</b> 오선 한 칸씩 옮겨지고 소리가 납니다. 두 번 누르면 자동값으로 돌아갑니다. 반음이 필요하면 음을 누른 뒤 ♭ ♯ 버튼을 쓰세요.',
      melody: '자동으로 찾은 멜로디 음표에 점선 동그라미가 보입니다. <b>이동</b>: 끌어서 위치 · 높이 수정 / <b>추가</b>: 오선 위를 눌러 새 음표 / <b>지우기</b>: 음표를 눌러 삭제. 고치면 화음이 다시 계산됩니다.',
      chord: '점선 상자가 코드 글자입니다. <b>고치기</b>: 상자를 누르고 악보에 적힌 그대로 고쳐 쓰기(비우면 삭제) / <b>추가</b>: 빈 곳을 눌러 새 코드 넣기.'
    };
    function setStat(t, bad) { S.statMsg = t || ''; S.statBad = !!bad; if (statEl) { statEl.textContent = S.statMsg; statEl.className = 'hm-stat' + (bad ? ' bad' : ''); } if (S.autoRun) note(S.statMsg, S.statBad); }
    function fillKeys() {
      var ok = S.okey, minor = ok && ok.minor, ml = minor ? MINORS : HC.KEY_CHOICES, cur = S.data.orig;
      var opts = '<option value="auto">자동 인식' + (S.guess ? ' (' + h(HC.keyName(S.guess)) + ')' : (S.okey ? ' (' + h(HC.keyName(S.okey)) + ')' : '')) + '</option>';
      HC.KEY_CHOICES.forEach(function (k) { opts += '<option value="' + k + '">' + k + ' 장조</option>'; });
      MINORS.forEach(function (k) { opts += '<option value="' + k + '">' + k.replace(/m$/, '') + ' 단조</option>'; });
      if (selOrig.getAttribute('data-sig') !== opts) { selOrig.innerHTML = opts; selOrig.setAttribute('data-sig', opts); }
      selOrig.value = cur || 'auto';
      var t = '<option value="">' + h(HC.keyName(S.okey)) + ' (그대로)</option>';
      HC.KEY_CHOICES.forEach(function (k) { var kk = HC.parseKey(k + (minor ? 'm' : '')), sm = HC.keySemitones(S.okey, kk); t += '<option value="' + k + '">' + h(k + (minor ? 'm' : '')) + ' (' + (sm > 0 ? '+' : '') + sm + ')</option>'; });
      if (selTarget.getAttribute('data-sig') !== t) { selTarget.innerHTML = t; selTarget.setAttribute('data-sig', t); }
      selTarget.value = S.data.target || '';
    }
    function syncPanel() {
      if (S.dead || !S.data) return;
      var d = S.data, pg = pgKey(), pd = d.pages[pg], M = S.model[pg];
      fillKeys();
      var nChords = pd ? pd.chords.filter(function (c) { return c.parsed; }).length : 0;
      semisEl.innerHTML = S.semis === 0 ? '<i>' + h(HC.keyName(S.okey)) + '</i> 그대로 — 코드를 바꾸지 않습니다' : '<i>' + h(HC.keyName(S.okey)) + ' ➔ ' + h(HC.keyName(S.tkey)) + '</i> · ' + (S.semis > 0 ? '+' : '') + S.semis + ' 반음 (' + (S.semis > 0 ? '위로' : '아래로') + ') · 이 페이지 코드 ' + nChords + '개 변환';
      var sk = P.song && P.song() ? HC.parseKey(P.song().key) : null, tk = S.tkey;
      if (sk && S.okey && sk.tonic !== tk.tonic) { songBtn.style.display = ''; songBtn.textContent = '곡 정보의 Key (' + (P.song().key) + ') 로 맞추기'; } else songBtn.style.display = 'none';
      host.querySelector('[data-o=showorig]').checked = !!d.show.orig; host.querySelector('[data-o=auto]').checked = !!S.autoOn;
      ['alto', 'tenor', 'link'].forEach(function (k) { host.querySelector('[data-o=' + k + ']').checked = !!d.show[k]; });
      ['m', 'a', 't'].forEach(function (k) { host.querySelector('[data-v=' + k + ']').checked = !!d.voices[k]; });
      host.querySelector('[data-o=loop]').checked = !!S.loop;
      host.querySelector('[data-o=keymode]').value = d.keyMode; var vol = host.querySelector('[data-o=vol]'); vol.value = String(Math.round(d.vol * 100));
      var bpmIn = host.querySelector('[data-o=bpm]'); if (doc.activeElement !== bpmIn) bpmIn.value = d.bpm || (P.song() && +P.song().bpm) || 80;
      host.querySelector('[data-o=ocr]').checked = !!S.forceOcr;
      Array.prototype.forEach.call(host.querySelectorAll('.hm-seg[role=group]:not(.hm-sub) button'), function (b) { b.setAttribute('aria-pressed', S.mode === b.getAttribute('data-mode') ? 'true' : 'false'); });
      ['melody', 'chord'].forEach(function (k) {
        var g = host.querySelector('.hm-sub[data-sub=' + k + ']'); g.style.display = S.mode === k ? '' : 'none';
        Array.prototype.forEach.call(g.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', S.sub[k] === b.getAttribute('data-sub') ? 'true' : 'false'); });
      });
      helpEl.innerHTML = HELP[S.mode];
      // 선택한 음
      var sel = S.sel, info = '';
      if (sel && M) {
        var nt = noteOf(sel.id);
        if (nt && (sel.kind === 'alto' || sel.kind === 'tenor')) {
          var mid = sel.kind === 'alto' ? nt.altoF : nt.tenorF, ed = sel.kind === 'alto' ? nt.altoEd : nt.tenorEd;
          info = '<b style="color:' + (sel.kind === 'alto' ? COL.alto : COL.tenor) + '">' + (sel.kind === 'alto' ? '알토' : '테너') + '</b> ' + HC.staffPitchName(mid, S.okey) + ' · 멜로디 ' + HC.staffPitchName(nt.midi, S.okey) + '의 ' + HC.intervalName(nt.midi, mid) + (nt.chord ? ' · 코드 ' + h(nt.chord.text) : '') + (nt.nct ? ' · 멜로디가 코드음이 아님' : '') + (ed ? ' · <b>손으로 고침</b>' : '') +
            '<div class="pv-row"><button type="button" class="pv-btn2" data-a="nudge-" aria-label="반음 내리기">♭ 반음↓</button><button type="button" class="pv-btn2" data-a="nudge+" aria-label="반음 올리기">♯ 반음↑</button>' + (ed ? '<button type="button" class="pv-btn2" data-a="reset-sel">자동값으로</button>' : '') + '</div>';
        } else if (nt && sel.kind === 'melody') {
          info = '<b style="color:' + COL.mel + '">멜로디</b> ' + HC.staffPitchName(nt.midi, S.okey) + (nt.chord ? ' · 코드 ' + h(nt.chord.text) : '') + '<div class="pv-row"><button type="button" class="pv-btn2 warn" data-a="del-sel">🗑 이 음표 지우기</button></div>';
        }
      }
      selEl.style.display = info ? '' : 'none'; selEl.innerHTML = info;
      var uBtn = host.querySelector('[data-a=undo]'); uBtn.disabled = !S.undo.length; uBtn.style.opacity = S.undo.length ? '' : '.5';
      var pl = host.querySelector('[data-a=play]'); pl.textContent = S.playing ? '■ 멈춤' : '▶ 화음 미리듣기';
      host.querySelector('[data-a=an-page]').disabled = S.busy; host.querySelector('[data-a=an-all]').disabled = S.busy;
      // 오선 목록
      var sf = host.querySelector('.hm-staffs'), list = host.querySelector('.hm-stafflist');
      if (pd && pd.staves.length > 1) {
        sf.style.display = ''; var html = '';
        pd.staves.forEach(function (st, i) { html += '<label><input type="checkbox" data-staff="' + i + '"' + (usedStaff(pg, i) ? ' checked' : '') + '> ' + (i + 1) + '번째 오선' + (st.melody ? '' : ' <small style="opacity:.7">(아래 줄 · 반주로 보임)</small>') + '</label>'; });
        if (list.getAttribute('data-sig') !== html) { list.innerHTML = html; list.setAttribute('data-sig', html); } else Array.prototype.forEach.call(list.querySelectorAll('input'), function (inp) { inp.checked = usedStaff(pg, +inp.getAttribute('data-staff')); });
      } else sf.style.display = 'none';
      if (!S.statMsg) {
        if (!pd) setStat('아직 분석하지 않은 페이지입니다. "이 페이지 분석"을 눌러 주세요.');
        else setStat('이 페이지: 코드 ' + nChords + '개(' + (pd.src === 'text' ? 'PDF 글자층' : 'OCR') + ') · 오선 ' + pd.staves.length + '줄 · 멜로디 음 ' + (M ? M.notes.length : 0) + '개' + (pd.chords.some(function (c) { return c.conf != null && c.conf < 60; }) ? ' — 점선 칩은 OCR 이 불확실하게 읽은 코드입니다. "코드" 모드에서 확인해 주세요.' : ''));
      }
    }
    host.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || !host.contains(b)) return;
      var a = b.getAttribute('data-a'), mode = b.getAttribute('data-mode'), sub = b.getAttribute('data-sub');
      if (mode) { setMode(mode); return; }
      if (sub) { var g = b.parentNode.getAttribute('data-sub'); S.sub[g] = sub; syncPanel(); return; }
      if (a === 'an-page') { S.statMsg = ''; analyze([P.page()], S.forceOcr); }
      else if (a === 'an-all') { var n = P.pages ? P.pages() : 1, ps = [], i; for (i = 1; i <= n; i++) ps.push(i); S.statMsg = ''; analyze(ps, S.forceOcr); }
      else if (a === 'song-key') { var sk = HC.parseKey(P.song().key); if (sk) setTargetManual(HC.KEY_CHOICES.filter(function (k) { return HC.parseKey(k).tonic === sk.tonic; })[0] || ''); }
      else if (a === 'reset-all') { var oa = S.data.ov.alto, ot = S.data.ov.tenor; if (!Object.keys(oa).length && !Object.keys(ot).length) { toast('고친 화음이 없습니다.'); return; } S.data.ov = { alto: {}, tenor: {} }; pushUndo(function () { S.data.ov = { alto: oa, tenor: ot }; }); commit(); }
      else if (a === 'undo') undo();
      else if (a === 'play') play();
      else if (a === 'nudge-') nudge(-1); else if (a === 'nudge+') nudge(1);
      else if (a === 'reset-sel') { if (S.sel) resetVoice(S.sel.kind, S.sel.id); }
      else if (a === 'del-sel') { if (S.sel && S.sel.kind === 'melody') deleteMelody(S.sel.id); }
      else if (a === 'png') exportPng();
    });
    host.addEventListener('change', function (e) {
      var t = e.target, o = t.getAttribute && t.getAttribute('data-o'), v = t.getAttribute && t.getAttribute('data-v'), st = t.getAttribute && t.getAttribute('data-staff');
      if (st != null) { S.data.use[pgKey() + ':' + st] = !!t.checked; S.statMsg = ''; commit(); return; }
      if (v) { S.data.voices[v] = !!t.checked; saveSoon(); return; }
      if (!o) return;
      if (o === 'orig') { S.data.orig = t.value; S.data.target = ''; delete S.data.tshift; S.statMsg = ''; linkFromP(); commit(); }          // 원래 조를 고치면 목표 조는 초기화 — 연습 키 이동이 있으면 새 원래 조 기준으로 다시 적용
      else if (o === 'target') { setTargetManual(t.value); }
      else if (o === 'auto') { S.autoOn = !!t.checked; try { root.localStorage.setItem('yn.pv.harm.auto', S.autoOn ? '1' : '0'); } catch (e) { /* 저장이 막힌 브라우저 */ } if (S.autoOn) maybeAuto(); }
      else if (o === 'showorig') { S.data.show.orig = !!t.checked; commit(); }
      else if (o === 'alto' || o === 'tenor' || o === 'link') { S.data.show[o] = !!t.checked; commit(); }
      else if (o === 'ocr') { S.forceOcr = !!t.checked; }
      else if (o === 'loop') { S.loop = !!t.checked; }
      else if (o === 'keymode') { S.data.keyMode = t.value; saveSoon(); }
      else if (o === 'bpm') { var n = Math.round(+t.value); S.data.bpm = n >= 30 && n <= 240 ? n : 0; saveSoon(); syncPanel(); }
    });
    host.addEventListener('input', function (e) { var t = e.target; if (t.getAttribute && t.getAttribute('data-o') === 'vol') { S.data.vol = (+t.value) / 100; if (au.master) au.master.gain.value = S.data.vol; saveSoon(); } });

    /* ---------- 그림으로 저장 ---------- */
    function exportPng() {
      var pg = pgKey(), pd = S.data.pages[pg];
      if (!pd) { toast('먼저 "이 페이지 분석"을 해 주세요.', true); return; }
      toast('그림 파일을 만드는 중…');
      var c2 = doc.createElement('canvas');
      P.renderPageTo(c2, P.page(), 2.2).then(function () {
        var x = c2.getContext('2d'); draw(x, c2.width, c2.height, pg, { hits: false });
        try { var an = P.anno(); an && an.drawPage && an.drawPage(x, c2.width, c2.height, P.page()); } catch (e) {}
        c2.toBlob(function (b) {
          if (!b) { toast('그림을 만들지 못했습니다.', true); return; }
          var a = doc.createElement('a'), nm = String((P.file() || {}).name || '악보').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]/g, '_');
          a.href = root.URL.createObjectURL(b); a.download = nm + '-p' + pg + '-' + HC.keyName(S.tkey) + '.png'; doc.body.appendChild(a); a.click(); setTimeout(function () { root.URL.revokeObjectURL(a.href); a.remove(); }, 800);
          toast('바뀐 코드와 화음이 들어간 그림을 저장했습니다.');
        }, 'image/png');
      }, function () { toast('그림을 만들지 못했습니다.', true); });
    }

    /* ---------- 연습 화면 이벤트 ---------- */
    P.on('page', function () { if (S.dead) return; if (S.playing) stop(); S.sel = null; S.statMsg = ''; if (S.editor) closeEditor(true); redraw(); syncPanel(); if (pShift()) { noteState(); maybeAuto(); } });
    P.on('sheet', function () { if (S.dead) return; if (S.fid && S.data) saveNow(); S.statMsg = ''; loadFile(); if (pShift()) { noteState(); maybeAuto(); } });
    P.on('keyshift', function (n) { if (S.dead || S.reflecting) return; applyShift(n); });                    // 유튜브 카드 · 재생 카드가 연습 키를 바꿈
    P.on('song', function () { if (S.dead) return; applyShift(pShift()); });                                    // 곡이 바뀌면 그 곡의 연습 키로
    P.on('close', function () { destroy(); });
    function destroy() {
      if (S.dead) return; S.dead = true; saveNow(); stop(true);
      try { if (ro) ro.disconnect(); root.removeEventListener('resize', redraw); } catch (e) {}
      try { cv.remove(); } catch (e) {} try { if (S.editor) S.editor.inp.remove(); } catch (e) {}
      try { if (au.ctx && au.ctx.close) au.ctx.close(); } catch (e) {}
      try { if (S.worker) S.worker.then(function (w) { return w.terminate(); }).catch(function () {}); } catch (e) {}
    }
    loadFile(); if (pShift()) { noteState(); maybeAuto(); }
    /* 시험 · 점검용 손잡이 */
    var api = { onShow: function () { computeModel(); redraw(); syncPanel(); }, destroy: destroy, _state: S, _draw: draw, _analyze: analyze, _model: function () { return S.model; }, _setMode: setMode, _play: play, _stop: stop, _commit: commit };
    root.YNHarmonyUI._last = api;
    return api;
  }

  root.YNHarmonyUI = { mount: mount, keyMath: keyMath, clampShift: clampShift };
}(typeof self !== 'undefined' ? self : this));
