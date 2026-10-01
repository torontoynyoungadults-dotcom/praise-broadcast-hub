/**
 * 키 · 템포 바꿔 듣기 — 녹음 / 내 오디오 파일용 "실제" 음높이 변환 (Web Audio)   (Feature 2)
 * ------------------------------------------------------------
 *  ※ 유튜브 영상은 다른 사이트(iframe)라서 브라우저가 그 소리를 이 페이지의 Web Audio 로 넘겨 주지 않습니다.
 *     그래서 유튜브의 "소리" 자체는 여기서 키를 바꿀 수 없습니다 (탭 녹음 · 화면 공유 · 오디오 추출은 쓰지 않습니다).
 *     유튜브 카드는 속도(공식 API)와 "악보 코드 키" 만 바꾸고, 소리로 키를 바꿔 연습하려면 이 파일의 카드(녹음 · 내 오디오 파일)를 씁니다.
 *
 *  · 음높이: 미디어 요소 ➔ MediaElementSource ➔ 음높이 변환기 ➔ 음량 ➔ 스피커.
 *      - 변환기는 AudioWorklet(pitch-worklet.js: WSOLA 늘이기 + 리샘플) — 길이는 그대로, 음높이만 반음 단위로 −3 ~ +3.
 *      - AudioWorklet 을 못 쓰는 기기는 일반 노드(DelayNode 두 개를 톱니파로 흔드는 방식)로 대신합니다 (소리가 조금 떨릴 수 있음).
 *  · 템포: 미디어 요소의 playbackRate 0.75 ~ 1.25 (0.05 단위) + preservesPitch = true (브라우저의 시간 늘이기) — 음높이 변환과 서로 독립.
 *  · 내 오디오 파일은 이 기기 안에서 blob 주소로만 재생합니다 (어디에도 올리지 않습니다).
 *  · 순수 함수(clampKey · clampTempo · semitoneToRatio · transposeKeyName · keyLabel …)는 Node 시험에서도 씁니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.YNAudioShift = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KEY_MIN = -3, KEY_MAX = 3, TEMPO_MIN = 0.75, TEMPO_MAX = 1.25, TEMPO_STEP = 0.05;
  var MAJ = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];                          // 화음 탭의 목표 조 목록과 같은 표기
  var MIN = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
  var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function mod(a, n) { return ((a % n) + n) % n; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var doc = root.document;

  /* ============================================================ 순수 함수 */
  /** 키 이동(반음) — 정수로 반올림하고 −3 ~ +3 로 자름. 숫자가 아니면 0 */
  function clampKey(n) { n = Math.round(+n); return isFinite(n) ? clamp(n, KEY_MIN, KEY_MAX) : 0; }
  /** 템포 배수 — 0.05 단위로 맞추고 0.75 ~ 1.25 로 자름. 숫자가 아니면 1 */
  function clampTempo(r) { r = +r; if (!isFinite(r)) return 1; r = Math.round(r / TEMPO_STEP) * TEMPO_STEP; return +clamp(r, TEMPO_MIN, TEMPO_MAX).toFixed(2); }
  function semitoneToRatio(n) { return Math.pow(2, n / 12); }
  function ratioToSemitone(r) { return 12 * Math.log(r) / Math.LN2; }
  function ratioToCents(r) { return 1200 * Math.log(r) / Math.LN2; }
  /** 화면에 쓰는 반음 표기: +2 · -1 · 0 */
  function fmtShift(n) { n = Math.round(+n) || 0; return n > 0 ? '+' + n : String(n); }
  function fmtTempo(r) { return (+r).toFixed(2) + 'x'; }
  function fmtClock(sec) { sec = isFinite(sec) && sec > 0 ? sec : 0; var m = Math.floor(sec / 60), s = Math.floor(sec - m * 60); return m + ':' + (s < 10 ? '0' : '') + s; }
  /** "G" "Bb" "F#m" "C minor" "A♭" → { pc, minor } · 못 읽으면 null */
  function parseKeyName(str) {
    var s = String(str == null ? '' : str).replace(/\(.*?\)/g, ' ').replace(/\bkey\b\s*(of)?/i, ' ').trim();
    var m = /^([A-Ga-g])\s*([#♯b♭]?)\s*(minor|major|maj|min|mi|m|-)?\s*$/.exec(s); if (!m) return null;
    var acc = (m[2] === '#' || m[2] === '♯') ? 1 : (m[2] === 'b' || m[2] === '♭') ? -1 : 0;
    return { pc: mod(LETTER_PC[m[1].toUpperCase()] + acc, 12), minor: /^(minor|min|mi|m|-)$/.test(m[3] || '') };
  }
  /** 키 이름을 n 반음 옮긴 이름 (예: G, +2 → A · Em, +3 → Gm · C, −3 → A) — 못 읽으면 null */
  function transposeKeyName(name, n) {
    var k = parseKeyName(name); if (!k) return null;
    var pc = mod(k.pc + Math.round(+n || 0), 12); return (k.minor ? MIN : MAJ)[pc];
  }
  /** 화면 문구: "G → A (+2)" · 0 이면 "G (원래 키)" · 곡 키를 못 읽으면 "+2 반음" */
  function keyLabel(name, n) {
    n = Math.round(+n) || 0; var k = parseKeyName(name);
    if (!k) return n === 0 ? '원래 키' : fmtShift(n) + ' 반음';
    var from = (k.minor ? MIN : MAJ)[k.pc];
    return n === 0 ? from + ' (원래 키)' : from + ' → ' + transposeKeyName(name, n) + ' (' + fmtShift(n) + ')';
  }
  /** 두 키 사이의 가까운 쪽 반음 수 (−5 ~ +6) */
  function semitonesBetween(a, b) { var A = parseKeyName(a), B = parseKeyName(b); if (!A || !B) return null; var d = mod(B.pc - A.pc, 12); return d > 6 ? d - 12 : d; }
  /** 원래 키 → 목표 키가 ±3 반음 안이면 그 반음 수, 밖이면 null (연습 키 이동 범위 밖) */
  function shiftFromKeys(orig, target) { var d = semitonesBetween(orig, target); return d != null && d >= KEY_MIN && d <= KEY_MAX ? d : null; }
  function normTitle(s) { return String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\s_\-\.\(\)\[\]·,]/g, ''); }
  /** 이 곡에 맞는 녹음 고르기 — 제목이 같거나 서로 포함하면 앞으로 (연습 녹음 > 예배 녹음), 나머지는 뒤에 그대로 */
  function rankRecs(recs, songTitle) {
    var nt = normTitle(songTitle), out = [];
    (recs || []).forEach(function (r, i) {
      if (!r || !r.play) return;
      var nr = normTitle(r.title), sc = 0;
      if (nt && nr) { if (nr === nt) sc = 3; else if (nr.indexOf(nt) >= 0 || (nr.length >= 2 && nt.indexOf(nr) >= 0)) sc = 2; }
      out.push({ r: r, i: i, match: sc > 0, score: sc * 2 + (r.kind !== '예배' ? 1 : 0) });
    });
    out.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    return out.map(function (x) { var o = {}; for (var k in x.r) o[k] = x.r[k]; o.match = x.match; return o; });
  }

  /* ============================================================ 음높이 변환기 (AudioWorklet ▸ 일반 노드) */
  var BASE = (function () { try { var s = doc && doc.currentScript, src = s && s.src; if (src) return src.replace(/[^\/]*$/, '').replace(/\?.*$/, ''); } catch (e) { /* 아래 기본값 */ } return '/worship/'; }());
  var wkCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function timeout(p, ms, msg) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error(msg || 'timeout')); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); }
  /** pitch-worklet.js 를 AudioContext 에 올립니다. fetch(서비스워커 보관본 포함) ➔ blob 주소 순으로 시도하고, 안 되면 주소 그대로 */
  function loadWorklet(ctx, url) {
    if (!ctx || !ctx.audioWorklet || typeof root.AudioWorkletNode === 'undefined') return Promise.reject(new Error('AudioWorklet 을 지원하지 않습니다'));
    if (wkCache && wkCache.has(ctx)) return wkCache.get(ctx);
    url = url || BASE + 'pitch-worklet.js';
    var viaBlob = function () {
      return root.fetch(url, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('worklet fetch ' + r.status); return r.text(); }).then(function (txt) {
        var u = root.URL.createObjectURL(new root.Blob([txt], { type: 'text/javascript' }));
        return ctx.audioWorklet.addModule(u).then(function () { root.URL.revokeObjectURL(u); }, function (e) { root.URL.revokeObjectURL(u); throw e; });
      });
    };
    var p = timeout(viaBlob().catch(function () { return ctx.audioWorklet.addModule(url); }), 6000, 'worklet load timeout');
    if (wkCache) { wkCache.set(ctx, p); p.catch(function () { wkCache.delete(ctx); }); }
    return p;
  }

  function workletShifter(ctx, n0, opt) {
    var node = new root.AudioWorkletNode(ctx, 'yn-pitch-shifter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCounts: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions: { ratio: semitoneToRatio(n0) } });
    var semis = n0, dead = false;
    node.onprocessorerror = function () { if (!dead && opt && opt.onError) { try { opt.onError(new Error('processor error')); } catch (e) { /* 무시 */ } } };
    return {
      mode: 'worklet', input: node, output: node,
      setSemitones: function (n) { semis = clampKey(n); try { node.port.postMessage({ type: 'ratio', value: semitoneToRatio(semis) }); } catch (e) { /* 무시 */ } },
      semitones: function () { return semis; },
      destroy: function () { dead = true; try { node.port.close(); } catch (e) { /* 무시 */ } try { node.disconnect(); } catch (e2) { /* 무시 */ } }
    };
  }

  /**
   * 일반 노드만 쓰는 대체 변환기 (지연선 방식): 지연을 톱니파로 서서히 늘리거나(음높이 ↓) 줄여(음높이 ↑) 도플러 효과로 음높이를 바꾸고,
   * 톱니가 되감기는 순간은 반대쪽 지연선으로 부드럽게 넘깁니다. AudioWorklet 이 없는 옛 브라우저용 — 소리가 조금 떨릴 수 있습니다.
   */
  function delayShifter(ctx, n0) {
    var W = 0.1, FADE = 0.12, sr = ctx.sampleRate, len = Math.round(sr), bufDur = len / sr;
    var input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    input.connect(dry); dry.connect(output); wet.connect(output);
    var ramp = ctx.createBuffer(1, len, sr), fade = ctx.createBuffer(1, len, sr), r = ramp.getChannelData(0), f = fade.getChannelData(0), i, u;
    function ss(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
    for (i = 0; i < len; i++) {
      u = i / len; r[i] = u;
      f[i] = u < 0.5 ? ss((u - (0.5 - FADE)) / FADE) : 1 - ss((u - 0.5 - (0.5 - FADE)) / FADE);          // 두 개를 반 주기 어긋나게 더하면 항상 1
    }
    var grains = [0, 0.5].map(function (ph) {
      var d = ctx.createDelay(W + 0.05), sc = ctx.createGain(), fg = ctx.createGain(), rs = ctx.createBufferSource(), fs = ctx.createBufferSource();
      rs.buffer = ramp; rs.loop = true; fs.buffer = fade; fs.loop = true; fg.gain.value = 0; d.delayTime.value = 0; sc.gain.value = 0;
      input.connect(d); d.connect(fg); fg.connect(wet); rs.connect(sc); sc.connect(d.delayTime); fs.connect(fg.gain);
      var t0 = ctx.currentTime + 0.01; rs.start(t0, ph * bufDur); fs.start(t0, ph * bufDur);
      return { d: d, sc: sc, rs: rs, fs: fs, fg: fg };
    });
    var semis = 0, dead = false;
    function set(n) {
      semis = clampKey(n); var p = semitoneToRatio(semis), t = ctx.currentTime;
      if (semis === 0) { dry.gain.setTargetAtTime(1, t, 0.02); wet.gain.setTargetAtTime(0, t, 0.02); return; }
      var rho = bufDur * Math.abs(1 - p) / W, up = p > 1;
      grains.forEach(function (g) {
        g.rs.playbackRate.setValueAtTime(rho, t); g.fs.playbackRate.setValueAtTime(rho, t);
        g.d.delayTime.setValueAtTime(up ? W : 0, t); g.sc.gain.setValueAtTime(up ? -W : W, t);
      });
      dry.gain.setTargetAtTime(0, t, 0.02); wet.gain.setTargetAtTime(1, t, 0.02);
    }
    dry.gain.value = 1; wet.gain.value = 0; set(n0);
    return {
      mode: 'delay', input: input, output: output, setSemitones: set, semitones: function () { return semis; },
      destroy: function () { if (dead) return; dead = true; grains.forEach(function (g) { try { g.rs.stop(); g.fs.stop(); } catch (e) { /* 무시 */ } }); try { input.disconnect(); output.disconnect(); } catch (e2) { /* 무시 */ } }
    };
  }

  /**
   * createShifter(ctx, { semitones, mode: 'worklet' | 'delay' (시험용으로 강제), workletUrl, onError })
   *   → Promise<{ mode, input, output, setSemitones(n), semitones(), destroy() }>   (ctx 는 OfflineAudioContext 도 가능)
   */
  function createShifter(ctx, opt) {
    opt = opt || {}; var n0 = clampKey(opt.semitones || 0);
    if (opt.mode === 'delay') return Promise.resolve(delayShifter(ctx, n0));
    return loadWorklet(ctx, opt.workletUrl).then(function () { return workletShifter(ctx, n0, opt); }).catch(function (e) {
      if (opt.mode === 'worklet') throw e;
      var s = delayShifter(ctx, n0); s.fallbackReason = (e && e.message) || String(e); return s;
    });
  }

  /* ============================================================ 목표 키 시작음 (YNPitch 피아노 소리) */
  var toneCtx = null;
  function audioCtor() { return root.AudioContext || root.webkitAudioContext || null; }
  function setPlaybackSession() { try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (e) { /* 지원 안 하는 브라우저 */ } }
  /** 곡 키를 n 반음 옮긴 키의 시작음(으뜸음, 가운데 도 위쪽 한 옥타브 안)을 피아노 소리로 냅니다. 소리를 못 내면 null */
  function playStartTone(songKey, n, dur) {
    var name = transposeKeyName(songKey, n), k = parseKeyName(name || songKey), AC = audioCtor();
    if (!k || !AC || !root.YNPitch || !root.YNPitch.createSynth) return null;
    try {
      setPlaybackSession();
      if (!toneCtx || toneCtx.state === 'closed') { toneCtx = new AC(); }
      if (toneCtx.state === 'suspended') toneCtx.resume();
      var g = toneCtx.createGain(); g.gain.value = 0.9; g.connect(toneCtx.destination);
      var synth = root.YNPitch.createSynth(toneCtx, g), midi = 60 + k.pc, v = synth.on(midi, 0.85);
      v.off(toneCtx.currentTime + (dur || 1.6));
      setTimeout(function () { try { g.disconnect(); } catch (e) { /* 무시 */ } }, ((dur || 1.6) + 2) * 1000);
      return { midi: midi, key: name || songKey };
    } catch (e) { return null; }
  }

  /* ============================================================ 스타일 (한 번만) */
  var CSS = '' +
    '.pv-as{position:absolute;z-index:31;right:14px;bottom:74px;width:min(380px,calc(100% - 28px));max-height:calc(100% - 96px);overflow:auto;border-radius:16px;background:rgba(16,16,23,.96);border:1px solid var(--g-line2,rgba(255,255,255,.22));box-shadow:0 18px 60px rgba(0,0,0,.65);color:var(--g-ink,#f8f5f0)}' +
    '.pv-tablet .pv-as{width:min(440px,calc(100% - 28px))}' +
    '.pv-as .pv-yth{position:sticky;top:0;background:rgba(16,16,23,.98);z-index:1}' +
    '.as{padding:2px 12px 12px;display:flex;flex-direction:column;gap:9px;font-size:13px}' +
    '.as-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.as-lb{flex:none;min-width:38px;font-size:12px;font-weight:800;color:var(--g-sub,#d4cfc7)}' +
    '.as-src{display:flex;flex-direction:column;gap:6px}.as-src .pv-sel{width:100%;min-height:40px;font-size:13.5px}' +
    '.as-b{padding:7px 10px;min-height:38px;border-radius:10px;border:1px solid var(--g-line2,rgba(255,255,255,.26));background:rgba(255,255,255,.09);color:var(--g-ink,#f8f5f0);font-size:12.5px;font-weight:800;cursor:pointer}' +
    '.as-b:hover{background:rgba(255,255,255,.17)}.as-b:disabled{opacity:.4;cursor:default}.as-b.on{background:linear-gradient(135deg,#ff9d47,#ff7a1c);border-color:transparent;color:#1a0f05}' +
    '.as-b.ghost{background:transparent}.as-b:focus-visible,.as-play:focus-visible{outline:2px solid #ffb066;outline-offset:2px}' +
    '.as-tr{display:flex;align-items:center;gap:10px}.as-play{flex:none;width:46px;height:46px;border-radius:50%;border:none;background:linear-gradient(135deg,#ff9d47,#ff7a1c);color:#1a0f05;font-size:18px;font-weight:900;cursor:pointer}.as-play:disabled{opacity:.4;cursor:default}' +
    '.as-seek{flex:1;min-width:0}.as-time{flex:none;font-size:12px;font-variant-numeric:tabular-nums;color:var(--g-sub,#d4cfc7);min-width:78px;text-align:right}' +
    '.as-keys{display:flex;gap:4px;flex:1 1 220px}.as-keys .as-b{flex:1 1 0;min-width:0;padding:7px 0;text-align:center}' +
    '.as-kn{flex:1 1 100%;font-size:13px;font-weight:800;color:#ffb066}' +
    '.as-tv{flex:none;min-width:52px;text-align:center;font-weight:900;font-variant-numeric:tabular-nums}.as-tempo{flex:1;min-width:90px}' +
    '.as-vol{flex:1;min-width:90px}' +
    '.as-msg{font-size:12px;color:#ffb066}.as-msg:empty{display:none}.as-msg.bad{color:#ffb9b9}' +
    '.as-eng{font-size:11.5px;color:var(--g-dim,#a9a39a)}.as-note{margin:0;font-size:11.5px;line-height:1.5;color:var(--g-dim,#a9a39a)}' +
    '.as-hide{display:none!important}';
  function injectCss() {
    if (!doc || doc.getElementById('yn-as-css')) return;
    var s = doc.createElement('style'); s.id = 'yn-as-css'; s.textContent = CSS; (doc.head || doc.documentElement).appendChild(s);
  }
  function el(tag, cls, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fill(r) { try { var mn = +r.min, mx = +r.max, v = +r.value; r.style.setProperty('--fill', (mx > mn ? clamp((v - mn) / (mx - mn) * 100, 0, 100) : 0) + '%'); } catch (e) { /* 무시 */ } }

  /* ============================================================ 재생 카드 */
  /**
   * mountPlayer(host, {
   *   title, sources: [{ title, src, kind, match }], songKey,
   *   key: { get(), set(n), on(cb) → off, status?(), onStatus?(cb) → off, startNote?(n) }   (없으면 카드 안에서만 쓰는 키 이동)
   *   mode: 'worklet' | 'delay' (시험용), workletUrl, ctxFactory
   * }) → { play, pause, toggle, setKey, setTempo, key, tempo, loadUrl, loadFile, destroy, state, ready, _nodes }
   */
  function mountPlayer(host, opt) {
    opt = opt || {}; injectCss();
    var AC = audioCtor(), bind = opt.key || null;
    var st = { key: bind ? clampKey(bind.get()) : 0, tempo: 1, vol: 1, dead: false, ready: false, mode: 'none', src: '', title: '', blob: '', timer: 0, offs: [], why: '' };
    var audio = doc.createElement('audio'); audio.preload = 'metadata'; audio.setAttribute('playsinline', ''); audio.controls = false;
    function pp() { try { audio.preservesPitch = true; audio.webkitPreservesPitch = true; audio.mozPreservesPitch = true; } catch (e) { /* 무시 */ } }
    pp();
    var srcs = (opt.sources || []).filter(function (s) { return s && s.src; });
    host.innerHTML = '';
    var box = el('div', 'as');
    box.innerHTML =
      '<div class="as-src"><select class="pv-sel" data-o="src" aria-label="들을 녹음"></select>' +
        '<div class="as-row"><button type="button" class="as-b" data-a="pick">📁 내 오디오 파일 고르기</button><input type="file" data-o="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.flac,.opus" class="as-hide" aria-label="내 오디오 파일"></div></div>' +
      '<div class="as-tr"><button type="button" class="as-play" data-a="play" aria-label="재생" disabled>▶</button><input type="range" class="as-seek" data-o="seek" min="0" max="1000" step="1" value="0" aria-label="재생 위치" disabled><span class="as-time" aria-live="off">0:00 / 0:00</span></div>' +
      '<div class="as-row as-krow" role="group" aria-label="키 (반음)"><span class="as-lb">키</span><div class="as-keys">' +
        [-3, -2, -1, 0, 1, 2, 3].map(function (n) { return '<button type="button" class="as-b" data-key="' + n + '" aria-pressed="false" aria-label="키 ' + fmtShift(n) + ' 반음">' + (n === 0 ? '0' : fmtShift(n)) + '</button>'; }).join('') + '</div>' +
        '<span class="as-kn" aria-live="polite"></span></div>' +
      '<div class="as-msg as-hs" role="status" aria-live="polite"></div>' +
      '<div class="as-row"><button type="button" class="as-b ghost" data-a="startnote">🎹 목표 키 시작음</button><button type="button" class="as-b ghost" data-a="reset">키 · 템포 원래대로</button></div>' +
      '<div class="as-row" role="group" aria-label="템포"><span class="as-lb">템포</span><button type="button" class="as-b" data-t="-1" aria-label="느리게">−</button><span class="as-tv" aria-live="polite">1.00x</span><button type="button" class="as-b" data-t="1" aria-label="빠르게">＋</button>' +
        '<input type="range" class="as-tempo" data-o="tempo" min="75" max="125" step="5" value="100" aria-label="템포 (0.75배 ~ 1.25배)"></div>' +
      '<div class="as-row"><span class="as-lb">음량</span><input type="range" class="as-vol" data-o="vol" min="0" max="150" step="1" value="100" aria-label="출력 음량"></div>' +
      '<div class="as-msg" role="status"></div><div class="as-eng"></div>' +
      '<p class="as-note">키는 음높이만, 템포는 속도만 바뀝니다 (서로 독립). 이 기기 안에서만 처리하며 파일을 어디에도 올리지 않습니다.</p>';
    host.appendChild(box);
    var q = function (s) { return box.querySelector(s); };
    var selSrc = q('[data-o=src]'), fileIn = q('[data-o=file]'), playB = q('[data-a=play]'), seek = q('[data-o=seek]'), timeEl = q('.as-time'), knEl = q('.as-kn'), tvEl = q('.as-tv'), tempoR = q('[data-o=tempo]'), volR = q('[data-o=vol]'), msgEl = q('.as-msg:not(.as-hs)'), hsEl = q('.as-hs'), engEl = q('.as-eng');
    function say(t, bad) { msgEl.textContent = t || ''; msgEl.className = 'as-msg' + (bad ? ' bad' : ''); }

    /* ---- 소스 목록 ---- */
    function fillSources() {
      var h2 = '<option value="">' + (srcs.length ? '— 이 곡의 녹음 고르기 (' + srcs.length + '개) —' : '이 곡 · 이 날짜에 올라온 녹음이 없습니다') + '</option>';
      srcs.forEach(function (s, i) { h2 += '<option value="' + i + '">' + (s.match ? '★ ' : '') + esc(s.title || '녹음') + (s.kind ? ' · ' + esc(s.kind) : '') + '</option>'; });
      selSrc.innerHTML = h2; selSrc.disabled = !srcs.length;
    }
    fillSources();

    /* ---- 오디오 그래프 ---- */
    var g = { ctx: null, msrc: null, sh: null, vol: null };
    function build() {
      if (!AC) { st.why = '이 브라우저는 Web Audio 를 지원하지 않아 키를 바꿀 수 없습니다. 템포(속도)만 바뀝니다.'; st.ready = true; st.mode = 'none'; paint(); return Promise.resolve(); }
      setPlaybackSession();
      try { g.ctx = opt.ctxFactory ? opt.ctxFactory() : new AC(); } catch (e) { g.ctx = null; st.why = '오디오를 시작하지 못했습니다: ' + e.message; st.ready = true; paint(); return Promise.resolve(); }
      try { g.ctx.resume(); } catch (e) { /* 재생 버튼에서 다시 */ }
      g.vol = g.ctx.createGain(); g.vol.gain.value = st.vol; g.vol.connect(g.ctx.destination);
      try { g.msrc = g.ctx.createMediaElementSource(audio); } catch (e2) { g.msrc = null; st.why = '이 브라우저에서는 소리를 처리할 수 없어 키를 바꿀 수 없습니다. 템포(속도)만 바뀝니다.'; st.ready = true; paint(); return Promise.resolve(); }
      return createShifter(g.ctx, { semitones: st.key, mode: opt.mode, workletUrl: opt.workletUrl, onError: function () { say('소리 변환 중 문제가 생겼습니다. 카드를 닫았다 다시 열어 주세요.', true); } }).then(function (sh) {
        if (st.dead) { sh.destroy(); return; }
        g.sh = sh; st.mode = sh.mode; g.msrc.connect(sh.input); sh.output.connect(g.vol); st.ready = true; paint();
      }, function (e) { st.why = '키 변환기를 만들지 못했습니다: ' + ((e && e.message) || e); try { g.msrc.connect(g.vol); } catch (x) { /* 무시 */ } st.ready = true; paint(); });
    }

    /* ---- 화면 ---- */
    function paint() {
      var n = st.key, canKey = !!g.sh;
      Array.prototype.forEach.call(box.querySelectorAll('[data-key]'), function (b) { var on = +b.getAttribute('data-key') === n; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.disabled = !canKey; });
      knEl.textContent = keyLabel(opt.songKey, n);
      tvEl.textContent = fmtTempo(st.tempo); tempoR.value = String(Math.round(st.tempo * 100)); fill(tempoR); fill(volR); fill(seek);
      q('[data-t="-1"]').disabled = st.tempo <= TEMPO_MIN + 1e-9; q('[data-t="1"]').disabled = st.tempo >= TEMPO_MAX - 1e-9;
      var hasSrc = !!st.src; playB.disabled = !st.ready || !hasSrc; seek.disabled = !hasSrc || !(audio.duration > 0);
      var playing = !audio.paused && !audio.ended; playB.textContent = playing ? '❚❚' : '▶'; playB.setAttribute('aria-label', playing ? '일시정지' : '재생');
      q('[data-a=startnote]').classList.toggle('as-hide', !(opt.songKey && parseKeyName(opt.songKey)));
      engEl.textContent = !st.ready ? '소리 변환기를 준비하는 중…' : g.sh ? (g.sh.mode === 'worklet' ? '변환 방식: 고품질 (AudioWorklet)' : '변환 방식: 호환 모드 (일반 노드) — 소리가 조금 떨릴 수 있습니다' + (g.sh.fallbackReason ? ' · 이유: ' + g.sh.fallbackReason : '')) : (st.why || '');
      if (!hasSrc && st.ready && !msgEl.textContent) say(srcs.length ? '위에서 녹음을 고르거나 내 오디오 파일을 골라 주세요.' : '녹음이 없으면 내 오디오 파일을 골라 들을 수 있습니다.');
    }
    function paintTime() {
      var d = audio.duration, t = audio.currentTime;
      timeEl.textContent = fmtClock(t) + ' / ' + fmtClock(isFinite(d) ? d : 0);
      if (d > 0 && isFinite(d) && doc.activeElement !== seek) { seek.value = String(Math.round(t / d * 1000)); fill(seek); }
    }
    function tick() { paintTime(); }
    function startTimer() { if (!st.timer) st.timer = setInterval(tick, 250); }
    function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = 0; } }

    /* ---- 조작 ---- */
    function applyKey(n, fromBind) {
      n = clampKey(n); st.key = n; if (g.sh) g.sh.setSemitones(n);
      if (bind && !fromBind && bind.set) { try { bind.set(n); } catch (e) { /* 무시 */ } }
      paint();
    }
    function applyTempo(r) {
      r = clampTempo(r); st.tempo = r; audio.defaultPlaybackRate = r; audio.playbackRate = r; pp(); paint();
    }
    function load(src, title, isBlob) {
      if (st.blob && st.blob !== src) { try { root.URL.revokeObjectURL(st.blob); } catch (e) { /* 무시 */ } st.blob = ''; }
      if (isBlob) st.blob = src;
      st.src = src; st.title = title || ''; say('');
      audio.pause(); audio.src = src; audio.defaultPlaybackRate = st.tempo; audio.playbackRate = st.tempo; pp();
      try { audio.load(); } catch (e) { /* 무시 */ }
      paintTime(); paint();
    }
    function play() {
      if (!st.src) { say('먼저 들을 녹음을 고르거나 내 오디오 파일을 골라 주세요.', true); return Promise.resolve(false); }
      if (g.ctx && g.ctx.state === 'suspended') { try { g.ctx.resume(); } catch (e) { /* 무시 */ } }
      var pr; try { pr = audio.play(); } catch (e2) { pr = Promise.reject(e2); }
      return Promise.resolve(pr).then(function () { say(''); startTimer(); paint(); return true; }, function (err) {
        say(err && err.name === 'NotAllowedError' ? '브라우저가 자동 재생을 막았습니다. ▶ 를 한 번 더 눌러 주세요.' : '재생하지 못했습니다: ' + ((err && err.message) || err), true); paint(); return false;
      });
    }
    function pause() { try { audio.pause(); } catch (e) { /* 무시 */ } paint(); }
    function toggle() { return audio.paused || audio.ended ? play() : (pause(), Promise.resolve(false)); }

    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.disabled) return;
      var a = b.getAttribute('data-a'), k = b.getAttribute('data-key'), t = b.getAttribute('data-t');
      if (k != null) applyKey(+k);
      else if (t != null) applyTempo(st.tempo + (+t) * TEMPO_STEP);
      else if (a === 'play') toggle();
      else if (a === 'pick') fileIn.click();
      else if (a === 'reset') { applyKey(0); applyTempo(1); say('키와 템포를 원래대로 되돌렸습니다.'); }
      else if (a === 'startnote') {
        var r = bind && bind.startNote ? bind.startNote(st.key) : playStartTone(opt.songKey, st.key);
        if (!r) say('시작음을 낼 수 없습니다 (곡의 Key 를 읽지 못했거나 소리를 켤 수 없습니다).', true); else say('시작음 ' + (r.key || '') + ' 을 들려 드립니다.');
      }
    });
    box.addEventListener('change', function (e) {
      var t = e.target, o = t.getAttribute && t.getAttribute('data-o');
      if (o === 'src') { var i = t.value === '' ? -1 : +t.value; if (i >= 0 && srcs[i]) load(srcs[i].src, srcs[i].title, false); }
      else if (o === 'file') {
        var f = t.files && t.files[0]; t.value = ''; if (!f) return;
        if (f.type && !/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|mp4)$/i.test(f.name)) { say('오디오 파일이 아닙니다: ' + f.name, true); return; }
        api.loadFile(f); selSrc.value = '';
      }
    });
    box.addEventListener('input', function (e) {
      var t = e.target, o = t.getAttribute && t.getAttribute('data-o');
      if (o === 'tempo') applyTempo((+t.value) / 100);
      else if (o === 'vol') { st.vol = (+t.value) / 100; if (g.vol) g.vol.gain.value = st.vol; fill(t); }
      else if (o === 'seek') { var d = audio.duration; if (d > 0 && isFinite(d)) { try { audio.currentTime = (+t.value) / 1000 * d; } catch (x) { /* 무시 */ } paintTime(); fill(t); } }
    });
    audio.addEventListener('timeupdate', paintTime);
    audio.addEventListener('loadedmetadata', function () { paintTime(); paint(); });
    audio.addEventListener('durationchange', function () { paintTime(); paint(); });
    audio.addEventListener('play', function () { startTimer(); paint(); });
    audio.addEventListener('pause', function () { stopTimer(); paintTime(); paint(); });
    audio.addEventListener('ended', function () { stopTimer(); paintTime(); paint(); });
    audio.addEventListener('error', function () {
      var c = audio.error && audio.error.code; if (!st.src) return;
      say(c === 4 ? '이 파일은 이 기기에서 재생할 수 없는 형식입니다 (mp3 · m4a · wav 를 권장합니다).' : c === 2 ? '네트워크 문제로 불러오지 못했습니다.' : '오디오를 불러오지 못했습니다.', true); paint();
    });
    if (bind && bind.onStatus) {
      var hs0 = bind.status && bind.status(); if (hs0 && hs0.text) { hsEl.textContent = '악보: ' + hs0.text; hsEl.className = 'as-msg as-hs' + (hs0.bad ? ' bad' : ''); }
      st.offs.push(bind.onStatus(function (t, bad) { hsEl.textContent = t ? '악보: ' + t : ''; hsEl.className = 'as-msg as-hs' + (bad ? ' bad' : ''); }));
    }
    if (bind && bind.on) st.offs.push(bind.on(function () { var n = clampKey(bind.get()); if (n !== st.key) applyKey(n, true); else paint(); }));

    var api = {
      play: play, pause: pause, toggle: toggle,
      setKey: function (n) { applyKey(n); }, setTempo: function (r) { applyTempo(r); }, key: function () { return st.key; }, tempo: function () { return st.tempo; },
      loadUrl: function (u, t) { load(u, t, false); },
      loadFile: function (f) { var u = root.URL.createObjectURL(f); load(u, f.name, true); say('내 파일 "' + f.name + '" 을 불러왔습니다.'); },
      state: function () { return { key: st.key, tempo: st.tempo, mode: st.mode, ready: st.ready, playing: !audio.paused && !audio.ended, time: audio.currentTime, duration: audio.duration, src: st.src, title: st.title, why: st.why, rate: audio.playbackRate, preservesPitch: audio.preservesPitch }; },
      ready: null, _nodes: function () { return { ctx: g.ctx, audio: audio, shifter: g.sh, out: g.vol, source: g.msrc }; },
      destroy: function () {
        if (st.dead) return; st.dead = true; stopTimer(); st.offs.forEach(function (f) { try { f && f(); } catch (e) { /* 무시 */ } });
        try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) { /* 무시 */ }
        if (st.blob) { try { root.URL.revokeObjectURL(st.blob); } catch (e2) { /* 무시 */ } }
        try { g.sh && g.sh.destroy(); } catch (e3) { /* 무시 */ } try { g.msrc && g.msrc.disconnect(); } catch (e4) { /* 무시 */ }
        try { g.ctx && g.ctx.close && g.ctx.close(); } catch (e5) { /* 무시 */ }
        host.innerHTML = '';
      }
    };
    applyTempo(1); paintTime(); paint();
    api.ready = build();
    if (opt.autoLoad !== false && srcs.length && srcs[0].match) { selSrc.value = '0'; load(srcs[0].src, srcs[0].title, false); }
    return api;
  }

  /* ============================================================ 연습 화면 연결 (practice.js 의 P 통로) */
  function hookOf(P) {
    if (P.__ynAs) return P.__ynAs;
    var h = P.__ynAs = { subs: [], stat: [], last: '', lastBad: false };
    var fire = function () { h.subs.slice().forEach(function (f) { try { f(); } catch (e) { /* 무시 */ } }); };
    P.on('keyshift', fire); P.on('song', fire); P.on('close', function () { closeDialog(); });
    P.on('harmstat', function (t, bad) { h.last = t || ''; h.lastBad = !!bad; h.stat.slice().forEach(function (f) { try { f(h.last, h.lastBad); } catch (e) { /* 무시 */ } }); });
    return h;
  }
  /** 유튜브 카드 · 재생 카드가 함께 쓰는 "연습 키" 통로 — 값은 P(곡별로 이 기기에 기억) 하나입니다 */
  function keyBinding(P) {
    var h = hookOf(P);
    return {
      get: function () { return P.keyShift ? clampKey(P.keyShift()) : 0; },
      set: function (n) { if (P.setKeyShift) P.setKeyShift(clampKey(n)); },
      on: function (cb) { h.subs.push(cb); return function () { var i = h.subs.indexOf(cb); if (i >= 0) h.subs.splice(i, 1); }; },
      onStatus: function (cb) { h.stat.push(cb); return function () { var i = h.stat.indexOf(cb); if (i >= 0) h.stat.splice(i, 1); }; },
      status: function () { return { text: h.last, bad: h.lastBad }; },
      name: function () { var s = P.song && P.song(); return s && s.key || ''; },
      label: function (n) { var s = P.song && P.song(); return keyLabel(s && s.key, n); },
      startNote: function (n) { var s = P.song && P.song(); return playStartTone(s && s.key, n); },
      openShifter: function () { return openDialog(P); }
    };
  }

  var dlg = null;
  function closeDialog() { if (dlg) { var d = dlg; dlg = null; try { d.api.destroy(); } catch (e) { /* 무시 */ } try { d.box.remove(); } catch (e2) { /* 무시 */ } } }
  /**
   * openDialog(P, { src, title, file })  — 연습 화면 위에 재생 카드를 띄웁니다 (이 곡에 맞는 팀 녹음 ▸ 없으면 내 파일).
   * 유튜브 카드가 열려 있으면 소리가 겹치지 않도록 닫습니다.
   */
  function openDialog(P, o) {
    o = o || {}; injectCss(); closeDialog();
    try { if (P.closeYt) P.closeYt(); } catch (e) { /* 무시 */ }
    var s = P.song && P.song(), box = el('div', 'pv-as'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '키 · 템포 바꿔 연습');
    box.innerHTML = '<div class="pv-yth"><b>' + esc('🎧 키 바꿔 연습' + (s && s.title ? ' — ' + s.title : '')) + '</b><button type="button" aria-label="닫기">✕</button></div><div class="as-host"></div>';
    var recs = rankRecs((P.opts && P.opts.recs) || [], s && s.title);
    var sources = recs.map(function (r) { return { title: r.title, src: r.play, kind: r.kind, match: r.match }; });
    var api = mountPlayer(box.querySelector('.as-host'), { songKey: s && s.key || '', sources: sources, key: keyBinding(P), mode: o.mode, workletUrl: o.workletUrl });
    box.querySelector('.pv-yth button').onclick = closeDialog;
    (P.el || doc.body).appendChild(box);
    dlg = { api: api, box: box };
    if (o.src) api.loadUrl(o.src, o.title || '');
    if (o.file) api.loadFile(o.file);
    return api;
  }

  return {
    KEY_MIN: KEY_MIN, KEY_MAX: KEY_MAX, TEMPO_MIN: TEMPO_MIN, TEMPO_MAX: TEMPO_MAX, TEMPO_STEP: TEMPO_STEP,
    clampKey: clampKey, clampTempo: clampTempo, semitoneToRatio: semitoneToRatio, ratioToSemitone: ratioToSemitone, ratioToCents: ratioToCents,
    fmtShift: fmtShift, fmtTempo: fmtTempo, fmtClock: fmtClock, parseKeyName: parseKeyName, transposeKeyName: transposeKeyName, keyLabel: keyLabel,
    semitonesBetween: semitonesBetween, shiftFromKeys: shiftFromKeys, rankRecs: rankRecs,
    loadWorklet: loadWorklet, createShifter: createShifter, playStartTone: playStartTone,
    mountPlayer: mountPlayer, keyBinding: keyBinding, openDialog: openDialog, closeDialog: closeDialog, isOpen: function () { return !!dlg; }, current: function () { return dlg && dlg.api; }
  };
}));
