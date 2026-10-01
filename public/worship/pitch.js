/**
 * 시작음 확인용 피아노 건반 — 가로 건반 + Web Audio 피아노 소리 (ADSR)
 * ------------------------------------------------------------
 *  · 용도는 딱 하나: 곡을 시작하기 전에 "첫 음"을 확인합니다. 곡 Key 의 으뜸음(시작음)을 한 번에 들을 수 있고,
 *    건반을 눌러 원하는 음도 들어볼 수 있습니다. (예전의 목표 멜로디 찍기 · 재생 · 마이크 음정 검출 · 점수 기능은 없앴습니다.)
 *  · 소리 만들기: 피아노는 오실레이터 하나가 아니라 "기본음 + 배음" 이므로 배음 6개를 겹치고,
 *    ADSR 엔벨로프(Attack 치는 순간 → Decay 빠르게 잦아듦 → Sustain 누르는 동안 천천히 사라짐 → Release 손을 떼면 여운)와
 *    낮은 통과 필터(치는 순간 밝고 곧 어두워짐)로 부드러운 피아노 느낌을 냅니다. 높은 음일수록 빨리 잦아듭니다.
 *  · 순수 함수(음 이름 · Key 해석 · 건반 배치 · 엔벨로프 값 · 소리 만들기)는 브라우저와 Node(시험) 양쪽에서 씁니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNPitch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var SOLFEGE = { 0: '도', 2: '레', 4: '미', 5: '파', 7: '솔', 9: '라', 11: '시' };
  var FLAT = { 'Db': 1, 'Eb': 3, 'Gb': 6, 'Ab': 8, 'Bb': 10, 'Cb': 11, 'Fb': 4, 'E#': 5, 'B#': 0 };
  var BLACK = [1, 3, 6, 8, 10];
  var PARTIALS = [1.0, 0.56, 0.32, 0.2, 0.11, 0.06];         // 배음 세기 (기본음 = 1)
  var MAX_VOICES = 12;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function freqToMidi(f) { return 69 + 12 * Math.log(f / 440) / Math.LN2; }
  function isBlack(m) { return BLACK.indexOf(((m % 12) + 12) % 12) >= 0; }
  function noteName(m) { m = Math.round(m); return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  /** "G" "Bb" "F#m" "Em" → { tonic: 7, minor: false, name } 못 읽으면 null */
  function parseKey(str) {
    var m = /^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(m|min|minor|-)?\s*$/.exec(String(str || '').replace(/\s*\(.*\)\s*/g, ''));
    if (!m) return null;
    var n = m[1].toUpperCase() + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
    var pc = NAMES.indexOf(n);
    if (pc < 0) pc = FLAT[n] != null ? FLAT[n] : -1;
    if (pc < 0) return null;
    return { tonic: pc, minor: !!m[3], name: n + (m[3] ? 'm' : '') };
  }
  function scalePcs(key) {
    if (!key) return [];
    var steps = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return steps.map(function (s) { return (key.tonic + s) % 12; });
  }
  /** 곡 Key 의 시작음(으뜸음) — 가운데 도(C4=60)부터 한 옥타브 안. Key 를 못 읽으면 null */
  function startMidi(key) { var k = typeof key === 'string' ? parseKey(key) : key; return k ? 60 + k.tonic : null; }

  /**
   * 건반 배치 — lo..hi (MIDI) 를 "흰 건반 줄" 로 돌려줍니다.
   * 반환: { whites:[{ midi, pc, index }], blacks:[{ midi, pc, after }], nWhite }  (검은 건반의 after = 왼쪽 흰 건반의 index)
   * lo · hi 는 흰 건반으로 맞춥니다 (검은 건반에서 시작하면 한 칸 안쪽으로).
   */
  function layout(lo, hi) {
    lo = Math.round(lo); hi = Math.round(hi);
    while (isBlack(lo)) lo++;
    while (isBlack(hi)) hi--;
    var whites = [], blacks = [], idx = -1;
    for (var m = lo; m <= hi; m++) {
      var pc = ((m % 12) + 12) % 12;
      if (isBlack(m)) blacks.push({ midi: m, pc: pc, after: idx });
      else { idx++; whites.push({ midi: m, pc: pc, index: idx }); }
    }
    return { whites: whites, blacks: blacks, nWhite: whites.length, lo: lo, hi: hi };
  }

  /**
   * ADSR 값 — 높은 음일수록 짧게 잦아들고(피아노 줄이 짧음), 세게 칠수록 밝고 큽니다. 시간은 초, sustain 은 최고 음량 대비 비율.
   *   attack  : 치는 순간 최고 음량까지 (해머) — 아주 짧게
   *   decay   : 최고 → sustain 으로 빠르게 잦아드는 시간 상수
   *   sustain : 건반을 누르고 있는 동안 남는 음량 비율 (그 뒤로도 아주 천천히 더 줄어듦: hold)
   *   release : 건반을 뗀 뒤 여운 (댐퍼가 내려오는 시간)
   */
  function adsr(midi, vel) {
    var hi = clamp((midi - 36) / 60, 0, 1);              // 0 = 낮은 음 · 1 = 높은 음
    var v = clamp(vel == null ? 0.8 : vel, 0.05, 1);
    return {
      attack: 0.006 + 0.004 * (1 - v),
      decay: 0.42 - 0.24 * hi,
      sustain: 0.34 - 0.16 * hi,
      hold: 2.6 - 1.5 * hi,                               // sustain 이후 천천히 줄어드는 시간 상수
      release: 0.5 - 0.28 * hi,
      peak: 0.16 + 0.34 * v,
      cutoffStart: Math.min(9000, midiToFreq(midi) * (5 + 9 * v)),
      cutoffEnd: Math.min(5000, midiToFreq(midi) * 2.6),
      cutoffTime: 0.35
    };
  }

  /**
   * 피아노 소리 합성기 — ctx = AudioContext(또는 같은 모양의 가짜), dest = 출력 노드.
   *   on(midi, vel, when) → 음 하나를 시작하고 { midi, off(when) } 를 돌려줍니다 (건반에서 손을 떼면 off)
   *   allOff()
   */
  function createSynth(ctx, dest) {
    var voices = [];
    function killOldest() { var v = voices.shift(); if (v) try { v.off(ctx.currentTime, true); } catch (e) {} }
    function on(midi, vel, when) {
      var t = when == null ? ctx.currentTime + 0.005 : when, p = adsr(midi, vel), f0 = midiToFreq(midi);
      if (voices.length >= MAX_VOICES) killOldest();
      var env = ctx.createGain(), lp = ctx.createBiquadFilter(), mix = ctx.createGain(), oscs = [];
      lp.type = 'lowpass'; lp.Q.value = 0.5;
      lp.frequency.setValueAtTime(p.cutoffStart, t); lp.frequency.exponentialRampToValueAtTime(Math.max(200, p.cutoffEnd), t + p.cutoffTime);
      mix.gain.value = 1 / 2.4;                            // 배음 합이 1 을 넘지 않게
      // ADSR: A → 최고 음량 / D → sustain 으로 (지수 감쇠) / S → 누르는 동안 천천히 줄어듦
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(p.peak, t + p.attack);
      env.gain.setTargetAtTime(p.peak * p.sustain, t + p.attack, p.decay / 3);
      env.gain.setTargetAtTime(0.0001, t + p.attack + p.decay, p.hold);
      PARTIALS.forEach(function (amp, i) {
        var n = i + 1, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f0 * n * Math.sqrt(1 + 0.00018 * n * n);       // 실제 피아노 줄은 배음이 아주 조금 높게 울림
        g.gain.value = amp; o.connect(g); g.connect(mix); o.start(t); oscs.push(o);
      });
      mix.connect(lp); lp.connect(env); env.connect(dest);
      var v = { midi: midi, dead: false, at: t };
      v.off = function (when2, quick) {
        if (v.dead) return; v.dead = true;
        var t2 = Math.max(when2 == null ? ctx.currentTime : when2, t), rel = quick ? 0.05 : p.release;
        try {
          env.gain.cancelScheduledValues(t2);
          env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), t2);
          env.gain.setTargetAtTime(0.0001, t2, rel / 3.5);
        } catch (e) {}
        oscs.forEach(function (o) { try { o.stop(t2 + rel + 0.08); } catch (e) {} });
        var i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1);
        var done = function () { try { env.disconnect(); lp.disconnect(); mix.disconnect(); } catch (e) {} };
        if (oscs[0]) oscs[0].onended = done;
      };
      v.oscs = oscs; v.env = env; v.params = p;
      voices.push(v);
      return v;
    }
    return {
      on: on,
      allOff: function () { voices.slice().forEach(function (v) { v.off(ctx.currentTime, true); }); },
      count: function () { return voices.length; }
    };
  }

  /* ==================== UI: 가로 피아노 건반 ==================== */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /**
   * mount(host, { key, octave, onError })
   * 반환: { setKey, destroy, playStart, press, release }
   */
  function mount(host, opt) {
    opt = opt || {};
    var st = { key: parseKey(opt.key), oct: clamp(opt.octave == null ? 3 : opt.octave, 1, 5), solfege: false, vol: 0.8, ctx: null, master: null, synth: null,
      held: {}, ptr: {}, dead: false };
    function say(t, bad) { info.textContent = t || ''; info.className = 'pk-info' + (bad ? ' bad' : ''); if (bad && opt.onError) { try { opt.onError(t); } catch (e) {} } }

    host.innerHTML = ''; host.classList.add('pk-root');
    var bar = el('div', 'pk-bar'), board = el('div', 'pk-board'), info = el('div', 'pk-info');
    board.setAttribute('role', 'group'); board.setAttribute('aria-label', '피아노 건반');
    bar.innerHTML =
      '<button type="button" class="pk-btn pri" data-a="start" title="곡 Key 의 시작음을 들려줍니다">▶ 시작음 듣기 <b class="pk-startname"></b></button>' +
      '<span class="pk-oct" role="group" aria-label="옥타브"><button type="button" class="pk-btn sm" data-a="oct-" aria-label="옥타브 내리기">◀</button><span class="pk-octl"></span><button type="button" class="pk-btn sm" data-a="oct+" aria-label="옥타브 올리기">▶</button></span>' +
      '<label class="pk-chk"><input type="checkbox" data-o="solfege"> 도레미</label>' +
      '<label class="pk-rng">볼륨 <input type="range" min="0" max="1" step="0.05" value="0.8" data-o="vol" aria-label="건반 볼륨"></label>';
    host.appendChild(bar); host.appendChild(board); host.appendChild(info);
    var startB = bar.querySelector('.pk-startname'), octL = bar.querySelector('.pk-octl');

    function ac() {
      if (!st.ctx) {
        var C = (typeof AudioContext !== 'undefined' && AudioContext) || (typeof webkitAudioContext !== 'undefined' && webkitAudioContext);
        if (!C) throw new Error('이 브라우저는 오디오를 지원하지 않습니다');
        st.ctx = new C();
        st.master = st.ctx.createGain(); st.master.gain.value = st.vol;
        var comp = st.ctx.createDynamicsCompressor ? st.ctx.createDynamicsCompressor() : null;         // 여러 건반을 함께 눌러도 소리가 깨지지 않게
        if (comp) { comp.threshold.value = -14; comp.ratio.value = 6; st.master.connect(comp); comp.connect(st.ctx.destination); } else st.master.connect(st.ctx.destination);
        st.synth = createSynth(st.ctx, st.master);
      }
      if (st.ctx.state === 'suspended' && st.ctx.resume) st.ctx.resume();
      return st.ctx;
    }

    function label(w) {
      var pc = w.pc, base = st.solfege ? SOLFEGE[pc] : NAMES[pc];
      return pc === 0 ? base + '<i>' + (Math.floor(w.midi / 12) - 1) + '</i>' : base;
    }
    var keyEls = {};
    function build() {
      var lo = 12 * (st.oct + 1), L = layout(lo, lo + 24);          // C(옥타브) 부터 두 옥타브 + 맨 위 도
      board.innerHTML = ''; keyEls = {};
      var sc = st.key ? scalePcs(st.key) : [];
      function flag(b, pc) { if (st.key && pc === st.key.tonic) b.classList.add('tonic'); else if (sc.indexOf(pc) >= 0) b.classList.add('scale'); }
      L.whites.forEach(function (w) {
        var b = el('button', 'pk-w'); b.type = 'button'; b.setAttribute('data-m', w.midi); b.setAttribute('aria-label', noteName(w.midi));
        b.style.left = (w.index / L.nWhite * 100) + '%'; b.style.width = (100 / L.nWhite) + '%';
        b.innerHTML = '<span class="pk-lb">' + label(w) + '</span>'; flag(b, w.pc); board.appendChild(b); keyEls[w.midi] = b;
      });
      L.blacks.forEach(function (k) {
        var b = el('button', 'pk-b'); b.type = 'button'; b.setAttribute('data-m', k.midi); b.setAttribute('aria-label', noteName(k.midi));
        var bw = 0.6 / L.nWhite * 100; b.style.width = bw + '%'; b.style.left = ((k.after + 1) / L.nWhite * 100 - bw / 2) + '%'; flag(b, k.pc);
        board.appendChild(b); keyEls[k.midi] = b;
      });
      octL.textContent = '옥타브 ' + st.oct + '–' + (st.oct + 2);
      var sm = startMidi(st.key); startB.textContent = sm != null ? noteName(sm) : '';
      bar.querySelector('[data-a="start"]').disabled = sm == null;
      Object.keys(st.held).forEach(function (m) { if (keyEls[m]) keyEls[m].classList.add('on'); });
    }

    /* ---- 소리 내기 ---- */
    function press(midi, key) {
      try {
        ac();
        if (st.held[midi]) release(midi);
        st.held[midi] = st.synth.on(midi, 0.8);
        if (keyEls[midi]) keyEls[midi].classList.add('on');
        say(noteName(midi) + '  ·  ' + midiToFreq(midi).toFixed(1) + ' Hz' + (st.key && ((midi % 12) === st.key.tonic) ? '  ·  Key ' + st.key.name + ' 시작음' : ''));
      } catch (e) { say('소리를 낼 수 없습니다: ' + e.message, true); }
    }
    function release(midi) {
      var v = st.held[midi]; if (!v) return;
      delete st.held[midi]; try { v.off(st.ctx.currentTime); } catch (e) {}
      if (keyEls[midi]) keyEls[midi].classList.remove('on');
    }
    function releaseAll() { Object.keys(st.held).forEach(function (m) { release(+m); }); }
    function keyAt(x, y) {
      var e = document.elementFromPoint(x, y);
      var b = e && e.closest ? e.closest('.pk-w,.pk-b') : null;
      return b && board.contains(b) ? +b.getAttribute('data-m') : null;
    }
    board.addEventListener('pointerdown', function (e) {
      var m = keyAt(e.clientX, e.clientY); if (m == null) return;
      e.preventDefault(); try { board.setPointerCapture(e.pointerId); } catch (x) {}
      st.ptr[e.pointerId] = m; press(m);
    });
    board.addEventListener('pointermove', function (e) {                    // 건반 위를 미끄러지면(글리산도) 음이 이어서 바뀜
      if (st.ptr[e.pointerId] == null) return;
      var m = keyAt(e.clientX, e.clientY); if (m == null || m === st.ptr[e.pointerId]) return;
      release(st.ptr[e.pointerId]); st.ptr[e.pointerId] = m; press(m);
    });
    function up(e) { var m = st.ptr[e.pointerId]; if (m == null) return; delete st.ptr[e.pointerId]; release(m); }
    board.addEventListener('pointerup', up); board.addEventListener('pointercancel', up); board.addEventListener('lostpointercapture', up);
    board.addEventListener('keydown', function (e) {                        // 키보드로 건반에 포커스했을 때 (접근성): Space · Enter 로 누름
      if ((e.key === ' ' || e.key === 'Enter') && e.target.getAttribute && e.target.getAttribute('data-m') && !e.repeat) { e.preventDefault(); e.stopPropagation(); press(+e.target.getAttribute('data-m')); }
    });
    board.addEventListener('keyup', function (e) { if ((e.key === ' ' || e.key === 'Enter') && e.target.getAttribute && e.target.getAttribute('data-m')) { e.stopPropagation(); release(+e.target.getAttribute('data-m')); } });
    board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    function playStart() {
      var m = startMidi(st.key); if (m == null) { say('이 곡에는 Key 가 없습니다. 건반을 눌러 확인하세요.', true); return; }
      press(m); setTimeout(function () { release(m); }, 1800);
      say('시작음 ' + noteName(m) + '  ·  Key ' + st.key.name);
    }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-a]') : null; if (!b) return; var a = b.getAttribute('data-a');
      if (a === 'start') playStart();
      else if (a === 'oct-') { st.oct = clamp(st.oct - 1, 1, 5); releaseAll(); build(); }
      else if (a === 'oct+') { st.oct = clamp(st.oct + 1, 1, 5); releaseAll(); build(); }
    });
    bar.addEventListener('change', function (e) {
      var t = e.target, o = t.getAttribute && t.getAttribute('data-o');
      if (o === 'solfege') { st.solfege = t.checked; build(); }
      else if (o === 'vol') { st.vol = +t.value; if (st.master) st.master.gain.value = st.vol; }
    });
    bar.addEventListener('input', function (e) { var t = e.target; if (t.getAttribute && t.getAttribute('data-o') === 'vol') { st.vol = +t.value; if (st.master) st.master.gain.value = st.vol; } });
    build();
    say(st.key ? '시작음 ' + noteName(startMidi(st.key)) + ' (Key ' + st.key.name + '). 건반을 눌러 소리를 확인하세요.' : '건반을 눌러 시작음을 확인하세요. (곡에 Key 가 있으면 시작음 버튼이 켜집니다)');

    return {
      setKey: function (k) { st.key = parseKey(k); build(); },
      playStart: playStart, press: press, release: release,
      destroy: function () { st.dead = true; releaseAll(); try { st.synth && st.synth.allOff(); } catch (e) {} try { st.ctx && st.ctx.close && st.ctx.close(); } catch (e) {} host.innerHTML = ''; host.classList.remove('pk-root'); }
    };
  }

  return {
    NAMES: NAMES, PARTIALS: PARTIALS, midiToFreq: midiToFreq, freqToMidi: freqToMidi, noteName: noteName, isBlack: isBlack,
    parseKey: parseKey, scalePcs: scalePcs, startMidi: startMidi, layout: layout, adsr: adsr, createSynth: createSynth, mount: mount
  };
}));
