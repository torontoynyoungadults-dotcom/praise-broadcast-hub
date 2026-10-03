/**
 * 세션 / 연습 패널 — 필기 옵션 · 송폼 · 메트로놈(음성 큐) · 음정 · 함께(리더-팔로워)
 * practice.js 가 YNPanels.build(P) 를 불러 탭 목록을 받습니다. 각 탭은 처음 열릴 때 만들어집니다.
 * (formb.js · metro.js · pitch.js 가 없으면 그 탭은 "불러오지 못했다"는 안내만 보이고 나머지는 정상 동작)
 */
(function (root) {
  'use strict';
  var doc = root.document;
  function I(n) { return root.YNIcon ? root.YNIcon.get(n) : ''; }       // v8.3 — 직접 그린 아이콘
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function need(name, mod, host) {
    if (mod) return true;
    host.innerHTML = '<p class="pv-err">' + h(name) + ' 도구를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>'; return false;
  }
  function hhmm(t) { var d = new Date(t); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }

  function build(P) {
    var M = null, mUi = null, lastBeat = -1, onBpmUser = null, flushMetroCfg = null;   // v8.36 — 메트로놈 탭이 저장을 미루고 있을 때, 다른 탭(송폼)의 "저장" 단추로도 바로 흘려보냄
    var tabs = [];

    /* ------------------------------------------------------------ 메트로놈 (여러 탭이 함께 씁니다) */
    var flashEl = null;
    /** 첫 박에 화면 전체가 살짝 깜빡입니다 (끄고 켤 수 있음). 마디가 1초에 3번을 넘게 도는 아주 빠른 박자에서는 눈이 아프지 않게 건너뜁니다. */
    function flash(e) {
      if (!M || !e) return;
      var st = M.state(); if (!st.cfg.flash) return;
      if (st.cfg.flashAll === false && e.beat !== 0) return;                  // 끄면 첫 박만, 기본은 모든 박
      if (st.cfg.flashAll === false ? st.bpm / 60 / st.num > 3 : st.bpm / 60 > 3) return;   // 초당 3번을 넘는 아주 빠른 깜빡임은 눈이 아프지 않게 건너뜀
      try {
        if (!flashEl) { flashEl = doc.createElement('div'); flashEl.className = 'pv-flash'; flashEl.setAttribute('aria-hidden', 'true'); doc.body.appendChild(flashEl); }
        flashEl.classList.toggle('ci', !!e.countIn); flashEl.classList.toggle('acc', e.beat === 0);
        flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go');
      } catch (x) { /* 화면 효과가 박자에 영향을 주면 안 됩니다 */ }
    }
    function metro() {
      if (M) return M;
      if (!root.YNMetro) return null;
      var s = P.song(), bpm = s && +s.bpm >= 30 && +s.bpm <= 300 ? +s.bpm : undefined;
      M = root.YNMetro.create({
        bpm: bpm,
        onBeat: function (e) { flash(e); quick.beat(e); minis.forEach(function (x) { x.beat(e); }); if (mUi) mUi.beat(e); },
        onEvent: function (kind, d) {
          if (kind === 'error' && remoteWait) { remoteBlocked = true; P.toast('팀 메트로놈 소리가 막혀 있습니다. 화면을 한 번 누르면 바로 시작합니다.', true); }
          if (kind === 'state') { quick.sync(); minis.forEach(function (x) { x.sync(); }); }
          if (mUi) mUi.event(kind, d); else if (kind === 'error') P.toast(d && d.message || '소리를 낼 수 없습니다.', true);
        }
      });
      M.setLang(P.lang());
      return M;
    }

    /* ---------- BPM −/+ 누르고 있기 (송폼 창 · 메트로놈 창) ----------
       한 번 누르면 1, 계속 누르고 있으면 점점 빠르게 반복합니다. 조작은 P.metroKey('bpm') 한 곳을 지나므로
       클릭 컨트롤 잠금 · 팀 동기화가 그대로 적용되고, 창을 끌거나 악보를 톡 친 것으로 처리되지 않게 이벤트를 여기서 끊습니다. */
    function bpmStep(btn, dir, after) {
      var t1 = 0, t2 = 0, n = 0, pid = null;
      function once() {
        var r = P.metroKey('bpm', dir);
        if (r === null) { stop(); P.toast('메트로놈 도구를 불러오지 못했습니다.', true); }
        else if (r && r.locked) { stop(); P.toast('다른 사람이 클릭 컨트롤 중이라 BPM 을 바꿀 수 없습니다.', true, 1400); }
        if (after) after();
      }
      function loop() { once(); n++; t2 = setTimeout(loop, n > 12 ? 45 : n > 5 ? 80 : 130); }
      function stop() { clearTimeout(t1); clearTimeout(t2); t1 = t2 = 0; n = 0; pid = null; }
      btn.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        if (btn.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault(); pid = e.pointerId;
        try { btn.setPointerCapture(e.pointerId); } catch (x) { /* 캡처가 안 돼도 pointerup 으로 멈춤 */ }
        once(); t1 = setTimeout(loop, 450);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (k) { btn.addEventListener(k, function (e) { e.stopPropagation(); stop(); }); });
      btn.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });
      btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); once(); } });
      return stop;
    }

    /* ---------- 미니 메트로놈 (송폼 탭 맨 위에 고정) ----------
       송폼 · 음성 큐를 다루는 동안에도 메트로놈(시작/멈춤 · BPM · 박)이 같은 화면에 함께 보이도록 합니다.
       조작은 메트로놈 탭과 같은 경로(P.metroKey → act)를 쓰므로 클릭 컨트롤 잠금 · 동기화 · 팀 전달이 그대로 적용됩니다. */
    var minis = [];
    function miniMetro(host) {
      var el = doc.createElement('div'); el.className = 'pv-mini'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', '메트로놈 (송폼과 함께 보기)');
      el.innerHTML = '<button type="button" class="pv-mini-go" data-m="toggle" aria-pressed="false">▶</button>' +
        '<div class="pv-mini-bpm"><button type="button" class="pv-btn2 sq" data-m="b-" aria-label="BPM 내리기">−</button>' +
        '<input class="pv-mini-in" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" maxlength="3" autocomplete="off" aria-label="BPM">' +
        '<button type="button" class="pv-btn2 sq" data-m="b+" aria-label="BPM 올리기">+</button><small>BPM</small></div>' +
        '<div class="pv-mini-dots" aria-hidden="true"></div><div class="pv-mini-note"></div>';
      host.insertBefore(el, host.firstChild);
      var go = el.querySelector('.pv-mini-go'), inp = el.querySelector('.pv-mini-in'), dots = el.querySelector('.pv-mini-dots'), note = el.querySelector('.pv-mini-note'), lastNum = 0;
      function sync() {
        var st = M ? M.state() : null, sg = P.song(), b = st ? Math.round(st.bpm) : (sg && +sg.bpm >= 30 && +sg.bpm <= 300 ? Math.round(+sg.bpm) : 0), run = !!(st && st.running), mode = ctl(), lock = mode === 'locked';
        go.textContent = run ? '■' : '▶'; go.classList.toggle('on', run); go.setAttribute('aria-pressed', run ? 'true' : 'false');
        if (doc.activeElement !== inp) inp.value = b || '';
        var num = st ? st.num : 4;
        if (num !== lastNum) { lastNum = num; dots.innerHTML = new Array(num + 1).join('<i></i>'); }
        Array.prototype.forEach.call(el.querySelectorAll('button,input'), function (x) { x.disabled = lock; });
        el.classList.toggle('locked', lock);
        var rt = P.rt();
        note.innerHTML = mode === 'send' ? I('metronome') + '내가 클릭 컨트롤 — 팀에 전달됩니다' : lock ? I('metronome') + h(YNHon.say(rt && rt.clicker || '')) + ' 클릭 컨트롤 — 자동으로 따라감' : '';
      }
      function beat(e) {
        var ds = dots.children; for (var i = 0; i < ds.length; i++) ds[i].classList.remove('on');
        var d = ds[e && e.beat]; if (d) d.classList.add('on');
      }
      el.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-m]') : null; if (!b) return;
        var k = b.dataset.m, r = k === 'toggle' ? P.metroKey('toggle') : P.metroKey('bpm', k === 'b+' ? 1 : -1);
        if (r === null) P.toast('메트로놈 도구를 불러오지 못했습니다.', true);
        sync();
      });
      inp.addEventListener('change', function () {
        var v = Math.round(+inp.value);
        if (!(v >= 30 && v <= 300)) { P.toast('BPM 은 30 ~ 300 사이로 입력해주세요.', true); sync(); return; }
        var m = metro(); if (!m) return; var r = act('bpm', v); if (r && r.locked) { sync(); return; } sync();
      });
      var api = { el: el, sync: sync, beat: beat, destroy: function () { var i = minis.indexOf(api); if (i >= 0) minis.splice(i, 1); if (el.parentNode) el.parentNode.removeChild(el); } };
      minis.push(api); sync();
      return api;
    }

    /* ---------- v6.1 — 메트로놈 동그라미 (떠 있는 송폼 창 안) ----------
       작은 동그라미 하나: 누르면 시작 / 멈춤, 가운데에 BPM, 박마다 테두리가 반짝(첫 박은 더 밝게). 길게 누르면 메트로놈 탭.
       조작은 다른 메트로놈 단추와 같은 경로(P.metroKey)라 클릭 컨트롤 잠금 · 팀 동기화가 그대로입니다. */
    function circleMetro() {
      var el = doc.createElement('button'); el.type = 'button'; el.className = 'pv-mc'; el.setAttribute('aria-pressed', 'false');
      el.innerHTML = '<b class="pv-mc-n">—</b><small class="pv-mc-s">▶</small>';
      var wrap = doc.createElement('div'); wrap.className = 'pv-mcw'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', '메트로놈 · BPM 조절');
      var dn = doc.createElement('button'), up = doc.createElement('button');
      dn.type = up.type = 'button'; dn.className = 'pv-mcs pv-mcs-dn'; up.className = 'pv-mcs pv-mcs-up';
      dn.textContent = '−'; up.textContent = '+'; dn.setAttribute('aria-label', 'BPM 내리기'); up.setAttribute('aria-label', 'BPM 올리기'); dn.title = 'BPM −1 (누르고 있으면 계속)'; up.title = 'BPM +1 (누르고 있으면 계속)';
      wrap.appendChild(dn); wrap.appendChild(el); wrap.appendChild(up);
      var nEl = el.querySelector('.pv-mc-n'), sEl = el.querySelector('.pv-mc-s'), pressT = 0, longed = false, bt = 0;
      function sync() {
        var st = M ? M.state() : null, sg = P.song(), b = st ? Math.round(st.bpm) : (sg && +sg.bpm >= 30 && +sg.bpm <= 300 ? Math.round(+sg.bpm) : 0), run = !!(st && st.running), lock = ctl() === 'locked';
        nEl.textContent = b || '—'; sEl.textContent = run ? '■' : '▶';
        el.classList.toggle('on', run); el.classList.toggle('locked', lock); el.setAttribute('aria-pressed', run ? 'true' : 'false');
        el.title = (run ? '메트로놈 멈춤' : '메트로놈 시작') + (b ? ' · ' + b + ' BPM' : '') + ' (길게 누르면 메트로놈 설정)';
        el.setAttribute('aria-label', el.title);
        dn.disabled = up.disabled = lock; wrap.classList.toggle('locked', lock);
      }
      function beat(e) {
        el.classList.remove('b', 'b0'); void el.offsetWidth; el.classList.add('b'); if (e && e.beat === 0) el.classList.add('b0');
        clearTimeout(bt); bt = setTimeout(function () { el.classList.remove('b', 'b0'); }, 140);
      }
      el.addEventListener('pointerdown', function (e) { e.stopPropagation(); longed = false; clearTimeout(pressT); pressT = setTimeout(function () { longed = true; P.showTab('metro'); }, 550); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (k) { el.addEventListener(k, function () { clearTimeout(pressT); }); });
      el.addEventListener('click', function (e) {
        e.stopPropagation(); if (longed) { longed = false; return; }
        var r = P.metroKey('toggle'); if (r === null) P.toast('메트로놈 도구를 불러오지 못했습니다.', true); sync();
      });
      var stops = [bpmStep(dn, -1, sync), bpmStep(up, 1, sync)];
      var api = { el: wrap, sync: sync, beat: beat, destroy: function () { stops.forEach(function (f) { f(); }); var i = minis.indexOf(api); if (i >= 0) minis.splice(i, 1); } };
      minis.push(api); sync(); P.on('song', sync); P.on('close', api.destroy);
      return api;
    }
    P.metroCircle = function () { return circleMetro(); };

    /* ---------- 라이브 컨트롤 (Step 2.15) — 도크 맨 앞의 메트로놈 · 음성 콜아웃(TTS) 켜기/끄기 ----------
       필기 도구 도크(태블릿 캡슐 · 컴퓨터 떠 있는 막대)의 맨 앞에 붙어서, 패널을 열지 않고도 라이브 예배 중에 바로 누릅니다.
       메트로놈은 빠른 버튼 · 패널 · Space 와 같은 경로(P.metroKey)를 쓰므로 클릭 컨트롤 잠금 · 팀 동기화가 그대로 적용됩니다.
       도크가 접혀 있거나 좁은 화면(서랍)에서는 이 묶음이 숨고 예전의 떠 있는 빠른 버튼이 대신 보입니다. */
    var live = (function () {
      var el = null, goB = null, bpmB = null, ttsB = null, dot = null;
      function svg(p) { return '<svg class="pv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
      var IC = {
        play: svg('<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>'),
        stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
        vol: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
        mute: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>')
      };
      function speechOk() { return !!(root.speechSynthesis && root.SpeechSynthesisUtterance); }
      function speakOn() {
        var st = M ? M.state() : null;
        if (st && st.cfg) return st.cfg.speak !== false;
        try { return root.localStorage.getItem('yn.metro.speak') !== 'false'; } catch (e) { return true; }
      }
      /* v8.35 — 자주 쓰는 반복 · 다이내믹 콜아웃을 메트로놈 떠 있는 창에서 패널을 열지 않고도 바로 누르도록 "펼치기" 추가 */
      var QUICK_CUE_IDS = ['repc', 'halfc', 'tag', 'onebar', 'vonly', 'break'];
      var expB = null, cuesEl = null;
      function build() {
        el = doc.createElement('div'); el.className = 'pv-live'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', '라이브 컨트롤 — 메트로놈 · 음성 콜아웃');
        el.innerHTML = '<button type="button" class="pv-lv-go" aria-pressed="false" title="메트로놈 시작 / 멈춤 (Space)" aria-label="메트로놈 시작">' + IC.play + '</button>' +
          '<button type="button" class="pv-lv-step pv-lv-dn" title="BPM −1 (누르고 있으면 계속)" aria-label="BPM 내리기">−</button>' +
          '<button type="button" class="pv-lv-bpm" title="메트로놈 패널 열기" aria-label="BPM — 메트로놈 패널 열기"><b>—</b><small>BPM</small><i class="pv-lv-dot b0"></i></button>' +
          '<button type="button" class="pv-lv-step pv-lv-up" title="BPM +1 (누르고 있으면 계속)" aria-label="BPM 올리기">+</button>' +
          '<button type="button" class="pv-lv-tts" aria-pressed="true" title="음성 콜아웃 (TTS) 켜기 / 끄기" aria-label="음성 콜아웃 켜짐">' + IC.vol + '<small>콜아웃</small></button>' +
          '<button type="button" class="pv-lv-exp" aria-pressed="false" aria-expanded="false" title="자주 쓰는 콜아웃 펼치기/접기 (반복 · 다이내믹)" aria-label="콜아웃 펼치기">▾</button>' +
          '<div class="pv-lv-cues" role="group" aria-label="콜아웃 — 반복 · 다이내믹">' + QUICK_CUE_IDS.map(function (id) { return '<button type="button" class="pv-cue" data-cue="' + id + '"></button>'; }).join('') + '</div>';
        goB = el.querySelector('.pv-lv-go'); bpmB = el.querySelector('.pv-lv-bpm'); ttsB = el.querySelector('.pv-lv-tts'); dot = el.querySelector('.pv-lv-dot');
        expB = el.querySelector('.pv-lv-exp'); cuesEl = el.querySelector('.pv-lv-cues');
        bpmStep(el.querySelector('.pv-lv-dn'), -1, sync); bpmStep(el.querySelector('.pv-lv-up'), 1, sync);
        el.addEventListener('click', function (e) {
          var cb = e.target.closest ? e.target.closest('[data-cue]') : null;
          if (cb) { e.stopPropagation(); var r = doCue(cb.dataset.cue); if (r && r.ok) { cb.classList.add('flash'); setTimeout(function () { cb.classList.remove('flash'); }, 350); } return; }
          var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
          e.stopPropagation();                                            // 도구 막대의 다른 단추 처리기로 넘어가지 않게
          if (b.classList.contains('pv-lv-step')) return;                 // BPM −/+ 는 bpmStep 이 처리
          if (b === goB) {
            var r2 = P.metroKey('toggle');
            if (r2 === null) P.toast('메트로놈 도구를 불러오지 못했습니다.', true);
          } else if (b === bpmB) P.showTab('metro');
          else if (b === expB) {
            var on2 = el.classList.toggle('expanded');
            expB.setAttribute('aria-pressed', on2 ? 'true' : 'false'); expB.setAttribute('aria-expanded', on2 ? 'true' : 'false'); expB.setAttribute('aria-label', on2 ? '콜아웃 접기' : '콜아웃 펼치기'); expB.textContent = on2 ? '▴' : '▾';
            var mw = el.closest('.pv-metro'); if (mw) mw.classList.toggle('pv-mexp', on2);
          }
          else if (b === ttsB) {
            var m = metro(); if (!m) { P.toast('메트로놈 도구를 불러오지 못했습니다.', true); return; }
            if (!speechOk()) { P.toast('이 기기는 음성 안내를 지원하지 않습니다.', true); return; }
            var on = !(m.state().cfg.speak !== false); m.setSpeak(on);
            P.toast(on ? '음성 콜아웃 켜짐' : '음성 콜아웃 꺼짐 — 큐 이름을 말하지 않습니다', false, 1200);
          }
          sync();
        });
      }
      function cueLabels() {
        if (!cuesEl || !root.YNMetro) return;
        var lang = P.lang();
        Array.prototype.forEach.call(cuesEl.querySelectorAll('[data-cue]'), function (b) {
          var c = root.YNMetro.CUE_BY[b.dataset.cue]; if (!c) return;
          b.textContent = lang === 'ko' ? c.ko : c.en; b.title = c.en + ' / ' + c.ko;
        });
      }
      function sync() {
        if (!el) return;
        var st = M ? M.state() : null, s = P.song(), b = st ? Math.round(st.bpm) : (s && +s.bpm >= 30 && +s.bpm <= 300 ? Math.round(+s.bpm) : 0), run = !!(st && st.running), sp = speakOn(), ok = speechOk();
        goB.classList.toggle('on', run); goB.setAttribute('aria-pressed', run ? 'true' : 'false'); goB.setAttribute('aria-label', run ? '메트로놈 멈춤' : '메트로놈 시작');
        var want = run ? IC.stop : IC.play; if (goB.getAttribute('data-ic') !== (run ? 's' : 'p')) { goB.innerHTML = want; goB.setAttribute('data-ic', run ? 's' : 'p'); }
        var bb = bpmB.querySelector('b'); if (bb.textContent !== String(b || '—')) bb.textContent = b || '—';
        var on = ok && sp; ttsB.classList.toggle('off', !on); ttsB.disabled = !ok; ttsB.setAttribute('aria-pressed', on ? 'true' : 'false'); ttsB.setAttribute('aria-label', !ok ? '음성 콜아웃 — 이 기기에서는 쓸 수 없음' : on ? '음성 콜아웃 켜짐' : '음성 콜아웃 꺼짐');
        var ck = on ? 'v' : 'm'; if (ttsB.getAttribute('data-ic') !== ck) { ttsB.innerHTML = (on ? IC.vol : IC.mute) + '<small>콜아웃</small>'; ttsB.setAttribute('data-ic', ck); }
        el.classList.toggle('locked', ctl() === 'locked');
        Array.prototype.forEach.call(el.querySelectorAll('.pv-lv-step'), function (x) { x.disabled = ctl() === 'locked'; });
        cueLabels();
      }
      function beat(e) {
        if (!dot) return;
        dot.className = 'pv-lv-dot ' + (e && e.beat === 0 ? 'acc ' : '') + ((e && e.count || 0) % 2 ? 'b1' : 'b0');
      }
      /** 도구 막대가 다시 그려질 때마다(innerHTML) 맨 앞에 다시 붙입니다 */
      function attach(host) {
        if (!host) return;
        if (!el) build();
        var fl = P.el.querySelector('.pv-metro');                         // v6 — 떠 있는 메트로놈 창이 있으면 그 안에 (도구 도크와 따로 옮김)
        if (fl) { if (el.parentNode !== fl) fl.appendChild(el); }
        else if (host.firstChild !== el) host.insertBefore(el, host.firstChild);
        sync();
      }
      function destroy() { if (el && el.parentNode) el.parentNode.removeChild(el); el = goB = bpmB = ttsB = dot = null; }
      return { attach: attach, sync: sync, beat: beat, destroy: destroy, el: function () { return el; } };
    }());

    /* ---------- 악보 화면 위 메트로놈 빠른 버튼 ----------
       패널(아래에서 올라오는 시트 · 오른쪽 칸)을 열지 않고도, 스크롤 없이 항상 보이는 자리에서 시작 · 멈춤을 누릅니다.
       악보 화면(.pv-main) 위에 떠 있는 작은 유리 버튼이고, 패널의 "메트로놈" 탭 맨 위에도 같은 시작 버튼이 고정되어 있습니다. */
    var quick = (function () {
      var el = null, goB = null, bpmB = null, dot = null, on = true;
      try { on = root.localStorage.getItem('yn.pv.mq') !== '0'; } catch (e) { on = true; }
      function stateNow() { return M ? M.state() : null; }
      function sync() {
        live.sync();
        if (!el) return;
        var st = stateNow(), s = P.song(), b = st ? Math.round(st.bpm) : (s && +s.bpm >= 30 && +s.bpm <= 300 ? Math.round(+s.bpm) : 0), run = !!(st && st.running);
        el.style.display = on ? '' : 'none';
        goB.classList.toggle('on', run); goB.setAttribute('aria-pressed', run ? 'true' : 'false');
        goB.firstChild.textContent = run ? '■' : '▶'; goB.setAttribute('aria-label', run ? '메트로놈 멈춤' : '메트로놈 시작');
        var bb = bpmB.querySelector('b'); if (bb.textContent !== String(b || '—')) bb.textContent = b || '—';
        el.classList.toggle('locked', ctl() === 'locked');
      }
      function beat(e) {
        live.beat(e);
        if (!dot || !on) return;
        dot.className = 'pv-mq-dot ' + (e && e.beat === 0 ? 'acc ' : '') + ((e && e.count || 0) % 2 ? 'b1' : 'b0');   // 클래스를 번갈아 바꿔 깜빡임을 다시 시작 (강제 레이아웃 없음)
      }
      function mount() {
        if (el) return;
        var host = P.el.querySelector('.pv-main'); if (!host) return;
        el = doc.createElement('div'); el.className = 'pv-mq'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', '메트로놈 빠른 버튼');
        el.innerHTML = '<button type="button" class="pv-mq-go" aria-pressed="false"><span>▶</span></button>' +
          '<button type="button" class="pv-mq-bpm" title="메트로놈 패널 열기"><b>—</b><small>BPM</small><i class="pv-mq-dot b0"></i></button>';
        goB = el.querySelector('.pv-mq-go'); bpmB = el.querySelector('.pv-mq-bpm'); dot = el.querySelector('.pv-mq-dot');
        el.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
          if (b === goB) {
            var r = P.metroKey('toggle');
            if (r === null) P.toast('메트로놈 도구를 불러오지 못했습니다.', true);
            sync();
          } else P.showTab('metro');
        });
        host.appendChild(el); sync();
      }
      function unmount() { if (el && el.parentNode) el.parentNode.removeChild(el); el = goB = bpmB = dot = null; }
      return {
        mount: mount, unmount: unmount, sync: sync, beat: beat, on: function () { return on; },
        setOn: function (v) { on = !!v; try { root.localStorage.setItem('yn.pv.mq', on ? '1' : '0'); } catch (e) { /* 저장이 막혀도 이번 화면에서는 동작 */ } sync(); }
      };
    }());

    /* ---------- 클릭 컨트롤 · 동기화 ----------
       소리는 기기마다 자기 오디오로 냅니다 (소리를 보내지 않음). 서로 나누는 것은 "상태" 뿐입니다 — BPM · 박자 · 강세 · 시작/멈춤.
         local  : 혼자 쓰기 (실시간 없음 · 동기화 끔 · 클릭 컨트롤이 아직 없음)
         send   : 내가 클릭 컨트롤 — 누르는 것을 서버로 보내고, 방 전체(나 포함)가 같은 시각에 시작
         locked : 다른 사람이 클릭 컨트롤 — 내 조작은 막고 그 사람 것을 따라감 ("동기화 끄기"로 풀 수 있음) */
    var remoteSeq = -1, lastAnchor = 0, remoteWait = false, remoteBlocked = false, sendT = 0, primed = false;
    function ctl() {
      var rt = P.rt();
      if (!rt || !rt.online || !P.followMetro()) return 'local';
      if (rt.isClicker) return 'send';
      if (rt.clicker) return 'locked';
      return 'local';
    }
    function lockedMsg() { var rt = P.rt(); return YNHon.say(rt && rt.clicker ? rt.clicker : '다른 사람') + ' 클릭 컨트롤입니다. 직접 쓰려면 "함께" 탭에서 클릭 컨트롤을 넘겨받으세요.'; }
    /** 지금 내 메트로놈 상태를 서버로 (내가 클릭 컨트롤일 때) */
    function sendState(o) {
      var rt = P.rt(), m = metro(); if (!rt || !m || ctl() !== 'send') return;
      o = o || {}; var st = m.state();
      var body = { playing: o.playing != null ? !!o.playing : st.running, bpm: st.bpm, num: st.num, den: st.den, marks: st.marks, count: o.count != null ? o.count : (mUi ? mUi.count() : 0), keep: !!o.keep };
      rt.sendMetro(body).catch(function (e) { P.toast('메트로놈 상태를 팀에 보내지 못했습니다: ' + e.message, true); });
    }
    function sendSoon(o) { clearTimeout(sendT); sendT = setTimeout(function () { sendState(o); }, 220); }
    /** 클릭 컨트롤에게서 받은 상태를 내 메트로놈에 적용 — 서버 시각(startAt)을 내 오디오 시계로 바꿔 같은 박에 시작 */
    function remoteMetro(st) {
      var rt = P.rt(); if (!st || !rt || !P.followMetro()) return;
      if (st.seq != null && st.seq < remoteSeq) return;
      var m = metro(); if (!m) return;
      remoteSeq = st.seq == null ? remoteSeq : st.seq;
      var cur = m.state();
      if (Math.round(cur.bpm * 10) !== Math.round(st.bpm * 10)) m.setBpm(st.bpm);
      if (cur.num !== st.num || cur.den !== st.den) m.setSig(st.num, st.den);
      m.setMarks(st.marks);
      if (!st.playing || !st.startAt) { lastAnchor = 0; remoteWait = false; if (m.state().running) m.stop(); if (mUi) mUi.sync(); return; }
      if (m.state().running && lastAnchor === st.startAt) { if (mUi) mUi.sync(); return; }     // 강세만 바뀜 — 박은 그대로
      lastAnchor = st.startAt; remoteWait = true; remoteBlocked = false;
      if (m.state().running) m.stop();
      var r = m.startIn(st.startAt - rt.serverNow(), st.count || 0);
      if (r && r.ok === false) { remoteBlocked = true; P.toast(r.error || '소리를 낼 수 없습니다.', true); }
      setTimeout(function () { remoteWait = false; }, 1500);
      if (mUi) mUi.sync();
    }
    /** 아이폰 · 크롬은 사용자가 화면을 한 번 눌러야 소리를 낼 수 있습니다 — 처음 누를 때 미리 준비해 두면 원격 시작이 바로 됩니다 */
    function prime() {
      var rt = P.rt(); if (!rt || !rt.online) return;
      if (!primed) { var m = metro(); if (m && m.prime) { m.prime(); primed = true; } }
      if (remoteBlocked && P.followMetro() && rt.metro && rt.metro.playing) { remoteBlocked = false; remoteMetro(Object.assign({}, rt.metro, { seq: null })); }
    }
    doc.addEventListener('pointerdown', prime, true);
    /* 메트로놈 소리 장치를 처음 누르는 순간 미리 깨워 둡니다 (온라인 여부와 상관없이) — 시작 단추를 누를 때 기다림이 없도록.
       아이폰은 손을 뗄 때(pointerup · click)에야 허락하는 경우가 있어 그때도 다시 시도하고, 깨어나면 더는 하지 않습니다. */
    function wakeAudio() {
      var m = metro(); if (!m || !m.prime) return;
      try { m.prime(); if (m.ready && m.ready()) { doc.removeEventListener('pointerdown', wakeAudio, true); doc.removeEventListener('pointerup', wakeAudio, true); doc.removeEventListener('click', wakeAudio, true); } } catch (e) { /* 무시 */ }
    }
    doc.addEventListener('pointerdown', wakeAudio, true); doc.addEventListener('pointerup', wakeAudio, true); doc.addEventListener('click', wakeAudio, true);
    /* 시작/멈춤 단추는 "뗄 때(click)"가 아니라 "누르는 순간(pointerdown)"에 반응합니다 — click 은 손가락을 뗀 뒤(보통 50~150ms, 터치 기기는 더)에야 오기 때문.
       소리 장치가 이미 깨어 있을 때만 (아니면 예전처럼 click 에서 처리). 뒤따라오는 click 은 한 번 삼켜 두 번 눌리지 않게 합니다. */
    var FAST = '.pv-lv-go, .pv-mq-go, .pv-big[data-a="toggle"], button[data-m="toggle"]', swallow = null;
    function fastDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var b = e.target && e.target.closest ? e.target.closest(FAST) : null; if (!b || b.disabled) return;
      var m = metro(); if (!m || !m.ready || !m.ready()) return;
      swallow = b; setTimeout(function () { if (swallow === b) swallow = null; }, 900);
      b.click();
    }
    function fastClick(e) {
      if (!swallow || !e.isTrusted) return;
      var b = e.target && e.target.closest ? e.target.closest(FAST) : null;
      if (b && b === swallow) { swallow = null; e.stopImmediatePropagation(); e.preventDefault(); }
    }
    doc.addEventListener('pointerdown', fastDown, true); doc.addEventListener('click', fastClick, true);
    /* v6.9 — 무음(진동) 스위치가 켜져 있어도 콜아웃 음성이 들리게: 화면을 처음 누르는(뗄) 때 소리 없는 재생을 켜 두고 라이브 악보를 닫을 때까지 유지합니다.
       아이폰은 pointerdown 이 아니라 손을 뗄 때(click · pointerup)에야 재생을 허락하므로 그때 시도하고, 성공하면 더는 하지 않습니다. */
    function holdVoice() {
      var m = metro(); if (!m || !m.hold) return;
      try { var ok = m.hold(true); if (ok) { doc.removeEventListener('pointerup', holdVoice, true); doc.removeEventListener('click', holdVoice, true); } } catch (e) { /* 무시 */ }
    }
    doc.addEventListener('pointerup', holdVoice, true); doc.addEventListener('click', holdVoice, true);
    /**
     * 메트로놈 조작 한 곳 — 화면 버튼 · 단축키 · 곡 BPM 이 모두 이리로 옵니다.
     *   kind: toggle · bpm(v) · sig(n,d) · mark(i) · tap
     */
    function act(kind, a, b2) {
      var m = metro(); if (!m) return { ok: false, error: '메트로놈 도구를 불러오지 못했습니다.' };
      var mode = ctl();
      if (mode === 'locked') { P.toast(lockedMsg(), true); return { ok: false, locked: true }; }
      var count = mUi ? mUi.count() : 0, res = { ok: true };
      if (kind === 'toggle') {
        if (mode === 'send') { sendState({ playing: !m.state().running, count: count }); return { ok: true, sent: true }; }
        var r = m.toggle(count); if (r && r.ok === false) return r;
      } else if (kind === 'bpm' || kind === 'tap') {
        var v = kind === 'tap' ? m.tap() : a; res.bpm = v; if (!v) return { ok: true, tap: null };
        m.setBpm(v); if (mode === 'send') sendSoon({});
      } else if (kind === 'sig') { m.setSig(a, b2); if (mode === 'send') sendSoon({ keep: false });
      } else if (kind === 'mark') { res.on = m.toggleMark(a); if (mode === 'send') sendState({ keep: true }); }
      else if (kind === 'marks') { m.setMarks(a); if (mode === 'send') sendState({ keep: true }); }
      if (mUi) mUi.sync();
      return res;
    }
    /** 큐 하나를 소리로 (박자가 돌면 박에 맞춰) + 페이지/클릭 컨트롤이면 팀에 전달 */
    function doCue(id, fromRemote) {
      var m = metro(); if (!m) { P.toast('메트로놈 도구를 불러오지 못했습니다.', true); return; }
      var r = m.cue(id);
      if (!r.ok) P.toast(r.error || '큐를 재생하지 못했습니다.', true);
      else { if (r.muted) P.toast('음성 콜아웃이 꺼져 있습니다 — "' + (r.text || '') + '"', false, 1400); if (!fromRemote) P.broadcastCue(id); try { P.flashCue && P.flashCue(id); } catch (e) { /* 깜빡임은 덤 */ } }
      return r;
    }
    P.cueKey = function (id) { return metro() ? (doCue(id) || { ok: false }) : null; };
    P.on('cue', function (c) {
      if (!P.recvCue() || P.manual() || !c || !c.label) return;
      var m = metro(); if (!m) return;
      var r = m.cue(String(c.label)); if (r && r.ok) try { P.flashCue && P.flashCue(String(c.label)); } catch (e) {} if (r && r.ok) P.toast('컨트롤 큐: ' + (r.text || c.label) + (r.muted ? ' (음성 꺼짐)' : ''), false, 1500);
    });
    P.on('metro', function (st) { remoteMetro(st); });
    /* 동기화를 다시 켜면 지금 팀 메트로놈 상태로 바로 맞춥니다 */
    P.on('followm', function (on) {
      var rt = P.rt();
      if (on && rt && rt.online && rt.metro && ctl() !== 'send') { remoteSeq = -1; lastAnchor = 0; remoteMetro(rt.metro); }
      if (mUi) mUi.sync();
    });
    P.on('song', function (s) {
      var b = s && +s.bpm; if (!(M && b >= 30 && b <= 300)) return;
      var mode = ctl(); if (mode === 'locked') return;                     // 클릭 컨트롤의 BPM 을 따르는 중
      M.setBpm(b); if (mode === 'send') sendSoon({}); if (mUi) mUi.sync();
    });
    P.on('close', function () { quick.unmount(); live.destroy(); clearTimeout(sendT); doc.removeEventListener('pointerdown', prime, true); doc.removeEventListener('pointerdown', wakeAudio, true); doc.removeEventListener('pointerup', wakeAudio, true); doc.removeEventListener('click', wakeAudio, true); doc.removeEventListener('pointerdown', fastDown, true); doc.removeEventListener('click', fastClick, true); doc.removeEventListener('pointerup', holdVoice, true); doc.removeEventListener('click', holdVoice, true); try { var mh = metro(); mh && mh.hold && mh.hold(false); } catch (e) {} try { M && M.destroy(); } catch (e) {} M = null; if (flashEl && flashEl.parentNode) flashEl.parentNode.removeChild(flashEl); flashEl = null; });
    ['clicker', 'conn', 'leader', 'followm', 'manual', 'song'].forEach(function (n) { P.on(n, function () { if (mUi) mUi.sync(); minis.forEach(function (x) { x.sync(); }); }); });
    /* 단축키용 — 메트로놈 탭을 한 번도 안 열었어도 ↑↓ (BPM) · Space (시작/멈춤) 이 동작합니다. 쓸 수 없으면 null */
    P.metroKey = function (act2, d) {
      var m = metro(); if (!m) return null;
      if (act2 === 'bpm') {
        var v = Math.max(30, Math.min(300, Math.round(m.state().bpm) + (d || 0)));
        var r = act('bpm', v); if (r.locked) return { ok: false, locked: true };
        if (onBpmUser) onBpmUser(); P.toast('BPM ' + v, false, 700); return { ok: true, bpm: v };
      }
      if (act2 === 'toggle') {
        var r2 = act('toggle'); if (r2 && r2.locked) return { ok: false, locked: true };
        if (r2 && r2.ok === false) { P.toast(r2.error || '소리를 낼 수 없습니다.', true); return { ok: false }; }
        if (r2 && r2.sent) { P.toast('▶/■ 팀 메트로놈에 보냈습니다', false, 700); return { ok: true, sent: true }; }
        P.toast(m.state().running ? '▶ 메트로놈 시작' : '■ 메트로놈 멈춤', false, 700); return { ok: true, running: m.state().running };
      }
      return null;
    };

    /* ------------------------------------------------------------ 필기 */
    tabs.push({ id: 'anno', icon: 'pen', label: '필기', build: function (host) {
      host.innerHTML =
        '<div class="pv-sec"><h4>누가 볼 수 있나요</h4><label class="pv-chk"><input type="checkbox" data-o="mineonly"> ' + I('lock') + '나만 보기</label>' +
          '<p class="pv-help">체크하면 내 필기는 나에게만 보입니다. 체크하지 않으면(기본) 이 예배를 연 모든 사람 화면에 실시간으로 공유됩니다.</p></div>' +
        '<div class="pv-sec"><h4>필기가 붙는 곳</h4><div class="pv-radio" data-g="scope"><button data-v="song">' + I('pin') + '이 곡에 계속</button><button data-v="date">' + I('calendar') + '이 날짜(콘티)만</button></div>' +
          '<p class="pv-help">"이 곡에 계속"은 다음 주에 같은 악보를 열어도 남아 있고, "이 날짜만"은 이번 예배에서만 보입니다.</p></div>' +
        '<div class="pv-sec"><h4>보이기</h4><label class="pv-chk"><input type="checkbox" data-vis="mine" checked> 내 필기 보이기</label><label class="pv-chk"><input type="checkbox" data-vis="team" checked> 팀 필기 보이기</label>' +
          '<label class="pv-chk"><input type="checkbox" data-o="straight"> 형광펜을 반듯한 직선으로</label>' +
          '<label class="pv-chk pv-penrow">펜 입력 <select data-o="pen"><option value="auto">자동 (펜이 감지되면 손가락 무시)</option><option value="always">항상 펜만 (손바닥 방지)</option><option value="off">손가락도 그림</option></select></label>' +
          '<label class="pv-chk"><input type="checkbox" data-o="pentap" checked> 펜 끝으로 같은 자리를 두 번 톡 → 펜 ↔ 지우개 전환</label>' +
          '<p class="pv-help">웹 페이지는 애플 펜슬의 하드웨어 더블탭을 받을 수 없어, 펜 끝으로 두 번 톡 치는 것(또는 펜 옆 버튼)으로 대신합니다. 두 손가락은 화면 밀기 · 확대 · 축소에 쓰이고, 펜슬을 쓰는 중에는 손가락 · 손바닥으로는 그려지지 않습니다.</p></div>' +
        '<div class="pv-sec"><h4>지우기</h4><div class="pv-row"><button class="pv-btn2" data-a="mine">현재 페이지 내 필기 지우기</button>' + (P.canEdit ? '<button class="pv-btn2 warn" data-a="all">현재 페이지 모두 지우기</button>' : '') + '</div><p class="pv-help">지운 뒤에도 화면 왼쪽(위)의 ↶ 로 되돌릴 수 있습니다.</p></div>' +
        '<div class="pv-sec"><h4>저장</h4><div class="pv-save" data-role="save"></div><div class="pv-row"><button class="pv-btn2" data-a="save">지금 저장</button></div></div>' +
        '<div class="pv-sec"><h4>내보내기 · 인쇄 (필기 포함)</h4><div class="pv-row"><button class="pv-btn2" data-a="png">현재 페이지 그림(PNG)</button><button class="pv-btn2" data-a="pdf">전체 PDF</button><button class="pv-btn2" data-a="print">인쇄</button></div></div>' +
        '<div class="pv-sec"><h4>화면 설정</h4><div class="pv-radio" data-g="layout"><button data-v="tablet">' + I('tablet') + '태블릿</button><button data-v="computer">' + I('laptop') + '컴퓨터</button></div>' +
          '<label class="pv-chk"><input type="checkbox" data-o="lefty"> 왼손잡이 (도구 막대를 왼쪽에)</label>' +
          '<p class="pv-help">태블릿: 큰 버튼 · 화면 양쪽 가장자리를 눌러 쪽 넘김 · 도구 막대가 떠 있음. 컴퓨터: 위쪽 도구 줄 · 오른쪽 패널 · 단축키(←→ 쪽, Alt+P 펜, Alt+H 형광펜, Alt+T 글자, Alt+C 코드, Alt+E 지우개, Ctrl+Z 취소, ↑↓ BPM, Space 메트로놈). 콜아웃 단축키: I 인트로 · V 절(누를 때마다 1→2→3절, 또는 1 2 3) · C 후렴 · P 프리코러스 · B 브릿지 · R 코러스 반복 · T 태그 · Shift+P 기도 · Shift+R 한 번 더.</p></div>';
      var an = function () { return P.anno(); };
      function paint() {
        [['scope', P.getScope()], ['layout', P.layout()]].forEach(function (x) {
          Array.prototype.forEach.call(host.querySelectorAll('[data-g="' + x[0] + '"] button'), function (b) { b.classList.toggle('on', b.dataset.v === x[1]); });
        });
        var st = P.status(), t = [];
        t.push(st.conn === 'online' ? '● 팀과 실시간 연결됨' : st.conn === 'unavailable' ? '○ 혼자 보기 (팀 공유 없음)' : '○ 팀 연결 ' + (st.conn === 'connecting' ? '중…' : '끊김 — 자동으로 다시 연결합니다'));
        if (st.unsent) t.push('아직 보내지 못한 팀 필기 ' + st.unsent + '개 (연결되면 자동 전송)');
        if (st.minePending) t.push('내 필기 저장 대기 ' + st.minePending + '건');
        t.push(st.savedAt ? '마지막 저장 ' + hhmm(st.savedAt) : '아직 저장한 기록 없음');
        host.querySelector('[data-role="save"]').innerHTML = t.map(function (x) { return '<div>' + h(x) + '</div>'; }).join('');
        host.querySelector('[data-o="pen"]').value = P.penMode(); host.querySelector('[data-o="pentap"]').checked = P.penTap();
        host.querySelector('[data-o="lefty"]').checked = P.hand() === 'left'; host.querySelector('[data-o="mineonly"]').checked = P.getLayer() === 'mine';
      }
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        var g = b.parentNode && b.parentNode.dataset && b.parentNode.dataset.g;
        if (g === 'scope') { if (b.dataset.v === 'date' && !P.opts.room) P.toast('날짜 정보가 없어 이 곡에만 붙일 수 있습니다.', true); else P.setScope(b.dataset.v); } else if (g === 'layout') P.setLayout(b.dataset.v);
        var a = b.dataset.a;
        if (a === 'mine') { var n = an().clearPage(P.getLayer(), false); P.toast(n ? n + '개를 지웠습니다.' : '지울 내 필기가 없습니다.'); }
        else if (a === 'all') { if (root.confirm('현재 페이지의 모든 사람의 필기를 지울까요? (내 것뿐 아니라 팀 필기 전체)')) { var n2 = an().clearPage(P.getLayer(), true); P.toast(n2 ? n2 + '개를 지웠습니다.' : '지울 필기가 없습니다.'); } }
        else if (a === 'save') { P.saveNow(); P.toast('저장을 요청했습니다.'); setTimeout(paint, 900); }
        else if (a === 'png') P.exportPng(); else if (a === 'pdf') P.exportPdf(false); else if (a === 'print') P.exportPdf(true);
        paint();
      });
      host.addEventListener('change', function (e) {
        var t = e.target; if (t.dataset.vis) an().setVisible(t.dataset.vis, t.checked);
        else if (t.dataset.o === 'straight') an().setStraight(t.checked);
        else if (t.dataset.o === 'pen') P.setPenModePref(t.value);
        else if (t.dataset.o === 'pentap') P.setPenTap(t.checked);
        else if (t.dataset.o === 'lefty') P.setHand(t.checked ? 'left' : 'right');
        else if (t.dataset.o === 'mineonly') P.setLayer(t.checked ? 'mine' : 'team');
      });
      ['sync', 'layer', 'scope', 'conn'].forEach(function (n) { P.on(n, paint); });
      paint();
      return { onShow: paint };
    } });

    /* ------------------------------------------------------------ 송폼 */
    tabs.push({ id: 'form', icon: 'form', label: '송폼', build: function (host) {
      if (!need('송폼', root.YNForm, host)) return;
      host.innerHTML = '<div class="pv-sec"><h4>곡</h4><select class="pv-sel" data-role="song"></select><div class="pv-songmeta" data-role="meta"></div></div>' +
        '<div class="pv-sec"><h4>송폼 순서</h4><div data-role="player"></div>' +
          '<div class="pv-row"><button class="pv-btn2" data-a="prev">◀ 이전</button><button class="pv-btn2 primary" data-a="next">다음 ▶</button></div>' +
          '<label class="pv-chk"><input type="checkbox" data-o="cue" checked> 칸을 누르면 음성 큐로 알려주기 (박자가 돌고 있으면 박에 맞춰)</label>' +
          '<label class="pv-chk"><input type="checkbox" data-o="fbadge"> 악보 맨 위에 송폼 순서 배지 보이기</label>' +
          '<label class="pv-chk pv-penrow">큐 언어 <select data-o="lang"><option value="en">English (Verse 1 …)</option><option value="ko">한국어 (1절 …)</option></select></label>' +
          '<p class="pv-help">칸을 누르면 지금 위치가 밝게 표시됩니다. 리더가 "팀에 큐 보내기"를 켜 두었다면 팀원 기기에서도 같은 큐가 들립니다. 송폼은 곡 정보의 "송폼 만들기"에서 고칩니다.</p></div>';
      /* 곡 정보 고치기 — BPM · 송폼 · 유튜브 링크. 팀장 · 인도자는 팀 전체에 (실시간), "나만 보기" 이거나 팀원이면 나에게만 저장 */
      host.insertAdjacentHTML('beforeend', '<div class="pv-sec pv-songedit"><h4>곡 정보 고치기 <small>BPM · 송폼 · 유튜브</small></h4>' +
        '<label class="pv-fl2"><span>BPM</span><input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" maxlength="3" data-e="bpm" autocomplete="off" placeholder="예: 72"></label>' +
        '<label class="pv-fl2"><span>송폼</span><input type="text" data-e="form" maxlength="120" autocomplete="off" placeholder="예: Int V1 C V2 C B C"></label><div data-role="formb"></div>' +
        '<label class="pv-fl2"><span>유튜브</span><input type="url" inputmode="url" data-e="link" autocomplete="off" placeholder="https://youtu.be/…"></label>' +
        '<div class="pv-row"><button type="button" class="pv-btn2 primary" data-a="saveinfo">저장</button></div><div class="pv-msg2" data-role="infomsg"></div><div class="pv-help" data-role="infowhere"></div></div>');
      var eBpm = host.querySelector('[data-e="bpm"]'), eForm = host.querySelector('[data-e="form"]'), eLink = host.querySelector('[data-e="link"]'), eMsg = host.querySelector('[data-role="infomsg"]'), eWhere = host.querySelector('[data-role="infowhere"]');
      var fb = root.YNForm.mount ? root.YNForm.mount(host.querySelector('[data-role="formb"]'), { value: '', onChange: function (str) { eForm.value = str; } }) : null;
      function infoWhere() {
        eWhere.textContent = P.cfgLayer() === 'team' ? '저장하면 팀 모두의 화면에 실시간으로 바뀝니다. (허브의 곡 정보와 같은 값입니다)'
          : P.canTeam() ? '"나만 보기" 가 켜져 있어 나에게만 저장됩니다. 팀에 공유하려면 필기 도구의 "나만 보기" 를 끄세요.' : '팀 공유는 팀장 · 인도자만 할 수 있어서 나에게만 저장됩니다.';
      }
      function fillInfo(force) {
        var s = P.song(); if (!s) { eBpm.value = eForm.value = eLink.value = ''; return; }
        var a = doc.activeElement;
        if (force || a !== eBpm) eBpm.value = s.bpm || '';
        if (force || a !== eForm) { eForm.value = s.form || ''; if (fb) fb.set(eForm.value); }
        if (force || a !== eLink) eLink.value = s.link || '';
        infoWhere();
      }
      eForm.addEventListener('change', function () { if (fb) fb.set(eForm.value); });
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-a="saveinfo"]') : null; if (!b) return;
        if (flushMetroCfg) flushMetroCfg();                                   // v8.36 — 여기서 "저장"을 누르면 메트로놈 탭(박자 · 강세 · 시작 전 마디)에서 미뤄둔 저장도 같이 흘려보냄
        var i = P.songIdx(), s = P.song(); if (!s) { eMsg.textContent = '먼저 곡을 골라주세요.'; eMsg.className = 'pv-msg2 bad'; return; }
        /* v8.35 — 연습하다가 메트로놈 BPM 을 (미니 · 동그라미 · 메트로놈 탭에서) 바꿔 둔 뒤 여기서 "저장"만 눌러도 그대로 반영되도록 —
           BPM 칸에 직접 입력 중이 아니면(포커스가 없으면) 지금 돌고 있는 메트로놈 값을 그 입력칸에 먼저 채웁니다. */
        var m = metro(), live = m && m.state ? Math.round(m.state().bpm) : 0;
        if (doc.activeElement !== eBpm && live >= 30 && live <= 300) eBpm.value = live;
        var patch = {}, bpm = String(eBpm.value || '').replace(/[^0-9]/g, '');
        if (bpm !== String(s.bpm || '')) { if (bpm && (+bpm < 30 || +bpm > 300)) { eMsg.textContent = 'BPM 은 30 ~ 300 사이로 넣어주세요.'; eMsg.className = 'pv-msg2 bad'; return; } patch.bpm = bpm; }
        if (String(eForm.value || '').trim() !== String(s.form || '')) patch.form = String(eForm.value || '').trim();
        var lk = String(eLink.value || '').trim();
        if (lk !== String(s.link || '')) { if (lk && !/^https?:\/\//i.test(lk)) { eMsg.textContent = '링크는 http 로 시작하는 주소여야 합니다.'; eMsg.className = 'pv-msg2 bad'; return; } patch.link = lk; }
        if (!Object.keys(patch).length) { eMsg.textContent = '바뀐 내용이 없습니다.'; eMsg.className = 'pv-msg2'; return; }
        b.disabled = true; eMsg.textContent = '저장 중…'; eMsg.className = 'pv-msg2';
        P.saveSongInfo(i, patch, function (ok) { b.disabled = false; eMsg.textContent = ok ? '저장했습니다.' : '저장하지 못했습니다.'; eMsg.className = 'pv-msg2' + (ok ? '' : ' bad'); if (ok) fillInfo(true); });
      });
      /* 메트로놈 + 콜아웃 큐를 송폼과 함께 (메트로놈 탭으로 옮겨 다니지 않아도 됨) */
      var miniM = miniMetro(host);
      var fcue = doc.createElement('div'); fcue.className = 'pv-sec pv-fcues';
      fcue.innerHTML = '<h4>콜아웃 큐 <small>눌러서 알려주기</small></h4><div class="pv-cues">' + root.YNMetro.CUES.filter(function (c) { return c.g === 'rep'; }).map(function (c) { return '<button type="button" class="pv-cue" data-cue="' + c.id + '"></button>'; }).join('') + '</div>';
      var songSec = host.querySelector('.pv-sec'); songSec.parentNode.insertBefore(fcue, songSec.nextSibling);
      function fcueLabels() { Array.prototype.forEach.call(fcue.querySelectorAll('[data-cue]'), function (b) { var c = root.YNMetro.CUE_BY[b.dataset.cue]; b.textContent = P.lang() === 'ko' ? c.ko : c.en; b.title = c.en + ' / ' + c.ko; }); }
      fcue.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-cue]') : null; if (!b) return; var r = doCue(b.dataset.cue); if (r && r.ok) { b.classList.add('flash'); setTimeout(function () { b.classList.remove('flash'); }, 350); } });
      fcueLabels(); P.on('close', function () { miniM.destroy(); });
      var sel = host.querySelector('[data-role="song"]'), meta = host.querySelector('[data-role="meta"]'), player = null, cur = -1;
      function fill() {
        sel.innerHTML = '<option value="-1">곡 선택…</option>' + P.songs.map(function (s, i) { return '<option value="' + i + '">' + h((i + 1) + '. ' + s.title) + '</option>'; }).join('');
        sel.value = String(P.songIdx());
      }
      function song() {
        var s = P.song(); fill(); cur = -1;
        meta.textContent = s ? [s.key ? 'Key ' + s.key : '', s.bpm ? s.bpm + ' BPM' : '', s.team || ''].filter(Boolean).join(' · ') : '악보에 해당하는 곡을 골라주세요.';
        if (player) player.set(s ? s.form : '');
        fillInfo(true); eMsg.textContent = '';
      }
      function pick(tok, i, num) {
        cur = i; var id = P.cueIdFor(num && num.cueKey || tok.k);
        if (host.querySelector('[data-o="cue"]').checked) { if (id) doCue(id); else if (tok && tok.custom && tok.k) doCue(tok.k); }      // 직접 입력한 글은 그 글 그대로 음성 안내
      }
      player = root.YNForm.mountPlayer(host.querySelector('[data-role="player"]'), { value: (P.song() || {}).form || '', lang: P.lang(), onPick: pick });
      sel.onchange = function () { P.setSong(+sel.value); };
      host.querySelector('[data-o="lang"]').value = P.lang();
      host.querySelector('[data-o="lang"]').onchange = function (e) { P.setLang(e.target.value); if (M) M.setLang(e.target.value); player.setLang(e.target.value); fcueLabels(); };
      var fbChk = host.querySelector('[data-o="fbadge"]'); if (fbChk) { fbChk.checked = P.formBadge(); fbChk.onchange = function () { P.setFormBadge(fbChk.checked); }; }
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-a]') : null; if (!b) return;
        var list = player.list(); if (!list.length) { P.toast('이 곡에는 송폼이 없습니다.', true); return; }
        if (b.dataset.a === 'next') { var t = player.next(); cur = Math.min(list.length - 1, cur + 1); var num = root.YNForm.numbered(list)[cur]; if (host.querySelector('[data-o="cue"]').checked && num) { var id = P.cueIdFor(num.cueKey); if (id) doCue(id); else if (num.custom && num.k) doCue(num.k); } }
        else { cur = Math.max(0, cur - 1); player.setCurrent(cur); }
      });
      P.on('song', song); P.on('songedit', function () { song(); }); P.on('songs', function () { song(); }); P.on('layer', infoWhere); song();
      return { onShow: function () { fill(); infoWhere(); fcueLabels(); miniM.sync(); } };
    } });

    /* ------------------------------------------------------------ 메트로놈 + 음성 큐 */
    tabs.push({ id: 'metro', icon: 'metronome', label: '메트로놈', build: function (host) {
      var m = metro(); if (!need('메트로놈', m, host)) return;
      var CUES = root.YNMetro.CUES, GROUPS = [['sec', '진행'], ['rep', '반복 · 콜아웃'], ['dyn', '다이내믹'], ['in', '들어가기']];
      host.innerHTML =
        '<div class="pv-mstick"><button class="pv-big" data-a="toggle" data-role="toggle">▶ 시작</button></div>' +
        '<div class="pv-sec pv-metrosec"><div class="pv-syncnote" data-role="syncnote"></div><div class="pv-bpmrow"><button class="pv-btn2 sq" data-a="b-">−</button><input class="pv-bpm" type="number" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" min="30" max="300" step="1" data-role="bpm" aria-label="BPM"><button class="pv-btn2 sq" data-a="b+">＋</button><button class="pv-btn2" data-a="tap">TAP</button></div>' +
          '<div class="pv-row"><label class="pv-chk">박자 <select data-o="sig"><option value="4/4">4/4</option><option value="3/4">3/4</option><option value="2/4">2/4</option><option value="6/8">6/8</option><option value="12/8">12/8</option></select></label>' +
          '<label class="pv-chk">시작 전 <select data-o="count"><option value="0">바로</option><option value="1">1마디</option><option value="2">2마디</option></select></label></div>' +
          '<div class="pv-dots" data-role="dots" role="group" aria-label="박 — 눌러서 > 강세 켜고 끄기"></div>' +
          '<p class="pv-help pv-dotshelp">원(박)을 누르면 ">" 강세가 켜지고 꺼집니다 — 강세 박은 더 높고 크게 울립니다.</p>' +
          '<label class="pv-chk pv-flashchk"><input type="checkbox" data-o="flash"> ' + I('bulb') + '전체 화면 깜빡임 <small>(박마다 화면이 번쩍)</small></label>' +
          '<label class="pv-chk pv-flashchk pv-flashall"><input type="checkbox" data-o="flashall" checked> 모든 박에서 깜빡임 <small>(끄면 마디 첫 박에만)</small></label>' +
          '<label class="pv-chk pv-flashchk"><input type="checkbox" data-o="mq" checked> ' + I('timer') + '악보 화면 위에 메트로놈 시작 버튼 띄우기 <small>(패널을 열지 않고도 시작 · 멈춤)</small></label>' +
          '<div class="pv-msg2" data-role="msg"></div></div>' +
        '<div class="pv-sec"><h4>음성 큐 — 눌러서 알려주기</h4><p class="pv-help" data-role="cuehelp"></p>' +
          GROUPS.map(function (g) { return '<div class="pv-cuegrp"><span>' + g[1] + '</span><div class="pv-cues">' + CUES.filter(function (c) { return c.g === g[0]; }).map(function (c) { return '<button class="pv-cue" data-cue="' + c.id + '"></button>'; }).join('') + '</div></div>'; }).join('') +
          '<div class="pv-cuestat" data-role="cuestat"></div></div>' +
        '<div class="pv-sec"><h4>소리 · 큐 설정</h4>' +
          '<label class="pv-rng">딸깍 볼륨 <input type="range" min="0" max="1" step="0.05" data-o="click"><output data-role="clickout"></output></label>' +
          '<label class="pv-rng">딸깍 음높이 <input type="range" min="-12" max="12" step="0.5" data-o="pitch"><output data-role="pitchout"></output></label>' +
          '<label class="pv-rng">음성 볼륨 <input type="range" min="0" max="1" step="0.05" data-o="voice"></label>' +
          '<p class="pv-help">볼륨 막대는 기본 크기의 0 ~ 8배입니다 (소리가 찢어지지 않게 자동으로 눌러 줍니다). 음높이는 반음 단위로 −12 ~ +12 입니다.</p>' +
          '<label class="pv-chk"><input type="checkbox" data-o="speak" checked> 음성 콜아웃 (TTS) 켜기 <small>(끄면 큐 이름을 소리로 말하지 않습니다 — 화면 위 도크에서도 켜고 끌 수 있어요)</small></label>' +
          '<label class="pv-chk">큐 타이밍 <select data-o="mode"><option value="lead">박자에 맞춰 미리 말하기 (추천)</option><option value="downbeat">다음 마디 첫 박에 맞춰</option><option value="now">누르는 즉시</option></select></label>' +
          '<label class="pv-chk">미리 말할 박 수 <select data-o="lead"><option value="1">1박 전</option><option value="2">2박 전</option><option value="3">3박 전</option><option value="4">4박 전</option></select></label>' +
          '<label class="pv-chk">큐 언어 <select data-o="lang"><option value="en">English</option><option value="ko">한국어</option></select></label>' +
          '<label class="pv-chk">음성 <select data-o="gender"><option value="mix">미국 영어 · 남녀 여러 명 (기본)</option><option value="male">남성 목소리</option><option value="female">여성 목소리</option><option value="any">기기 기본</option><option value="live">실시간 음성 합성 (저장된 소리 대신)</option></select></label>' +
          '<div class="pv-help" data-role="voiceinfo"></div>' +
          '<p class="pv-help" data-role="livehelp" hidden>다른 낱말이 미리 녹음된 소리로 이상하게 들릴 때 — 저장된 소리 대신 이 기기의 음성 합성을 바로 씁니다. (Bridge · Interlude · Vamp · Break · Prayer 는 끝소리가 잘리는 문제로 이미 항상 실시간 음성을 씁니다.) 기기마다 발음 · 목소리가 다르게 들릴 수 있어요.</p>' +
          '<label class="pv-chk"><input type="checkbox" data-o="first" checked> 첫 박 강세 (1박을 더 높고 크게)</label>' +
          '<label class="pv-chk">딸깍 종류 <select data-o="sound"><option value="wood">우드</option><option value="beep">삐</option><option value="click">클릭</option><option value="soft">부드러운 톤</option><option value="stick">스틱</option><option value="hihat">하이햇</option><option value="cowbell">카우벨</option><option value="drum">드럼 (툭)</option><option value="mute">딸깍만 (음성 끔)</option></select></label>' +
          '<div class="pv-help" data-role="lat"></div></div>' +
        '<div class="pv-sec"><h4>팀과 함께</h4>' +
          '<label class="pv-chk"><input type="checkbox" data-o="send"> 내가 페이지 컨트롤일 때 큐를 팀 전체에 보내기</label>' +
          '<label class="pv-chk"><input type="checkbox" data-o="recv"> 컨트롤이 보낸 큐 받기 (이 기기에서 소리 나게)</label>' +
          '<p class="pv-help">딸깍 소리는 기기마다 각자 냅니다. 메트로놈(BPM · 박자 · 시작/멈춤)은 팀과 맞추지 않고 각자 조절합니다 — 페이지만 함께 넘어갑니다.</p></div>';
      var q = function (s) { return host.querySelector(s); };
      var dotsEl = q('[data-role="dots"]'), toggleB = q('[data-role="toggle"]'), msg = q('[data-role="msg"]'), bpmIn = q('[data-role="bpm"]');
      function say(t, bad) { msg.textContent = t || ''; msg.className = 'pv-msg2' + (bad ? ' bad' : ''); }
      function labels() {
        var lang = P.lang();
        Array.prototype.forEach.call(host.querySelectorAll('[data-cue]'), function (b) { var c = CUES.filter(function (x) { return x.id === b.dataset.cue; })[0]; b.textContent = lang === 'ko' ? c.ko : c.en; b.title = c.en + ' / ' + c.ko; });
        q('[data-role="cuehelp"]').textContent = m.state().speech ? '박자가 돌아가는 중에 누르면 다음 마디 시작에 맞춰 말해 줍니다. 멈춰 있을 때는 바로 들려줍니다.' : root.YNMetro.help.noSpeech;
      }
      /** 박 원 — 박자 수만큼, 칸 너비를 꽉 채워 크게 (9박 이상은 두 줄). 눌러서 ">" 강세 켜고 끄기 */
      function drawDots(num, marks) {
        var s = '';
        for (var i = 0; i < num; i++) s += '<button type="button" class="pv-beat' + (marks && marks[i] ? ' acc' : '') + '" data-beat="' + i + '" aria-pressed="' + (marks && marks[i] ? 'true' : 'false') + '" aria-label="' + (i + 1) + '박 강세"></button>';
        dotsEl.style.setProperty('--n', num > 8 ? Math.ceil(num / 2) : num);
        dotsEl.className = 'pv-dots n' + num;
        dotsEl.innerHTML = s;
      }
      function paintMarks(marks) {
        var ds = dotsEl.children;
        for (var i = 0; i < ds.length; i++) { var on = !!(marks && marks[i]); ds[i].classList.toggle('acc', on); ds[i].setAttribute('aria-pressed', on ? 'true' : 'false'); }
      }
      function sync() {
        var st = m.state(), c = st.cfg;
        if (doc.activeElement !== bpmIn) bpmIn.value = Math.round(st.bpm);
        toggleB.textContent = st.running ? '■ 멈춤' : '▶ 시작'; toggleB.classList.toggle('on', st.running);
        var sigv = st.num + '/' + st.den, ss = q('[data-o="sig"]'); if (ss.value !== sigv) ss.value = sigv;
        if (dotsEl.children.length !== st.num) drawDots(st.num, st.marks); else paintMarks(st.marks);
        q('[data-o="flash"]').checked = !!c.flash; q('[data-o="flashall"]').checked = c.flashAll !== false; q('[data-o="mq"]').checked = quick.on();
        q('[data-o="pitch"]').value = c.pitch; q('[data-role="pitchout"]').textContent = (c.pitch > 0 ? '+' : '') + c.pitch + ' 반음';
        q('[data-role="clickout"]').textContent = '×' + (Math.round(st.gain * 10) / 10);
        var mode = ctl(), rt = P.rt(), note = q('[data-role="syncnote"]'), lock = mode === 'locked';
        host.classList.toggle('pv-locked', lock);
        ['[data-a="b-"]', '[data-a="b+"]', '[data-a="tap"]', '[data-role="bpm"]', '[data-o="sig"]', '[data-o="count"]', '[data-role="toggle"]'].forEach(function (sel) { var el = q(sel); if (el) el.disabled = lock; });
        Array.prototype.forEach.call(dotsEl.children, function (d) { d.disabled = lock; });
        if (mode === 'send') note.innerHTML = I('metronome') + '<b>내가 클릭 컨트롤</b> — 여기서 누르는 시작 · 멈춤 · BPM · 박자 · 강세가 팀 모두의 메트로놈에 전달됩니다.';
        else if (lock) note.innerHTML = I('metronome') + '<b>' + h(YNHon.say(rt.clicker)) + '</b> 클릭 컨트롤입니다 — 시작 · 멈춤 · BPM 이 자동으로 따라옵니다. (직접 쓰려면 위 "함께" 탭에서 클릭 컨트롤을 넘겨받으세요)';
        else note.textContent = '';
        q('[data-o="first"]').checked = c.first !== false; q('[data-o="click"]').value = c.click; q('[data-o="voice"]').value = c.voice; q('[data-o="mode"]').value = c.mode; q('[data-o="lead"]').value = String(c.lead);
        q('[data-o="lang"]').value = c.lang; q('[data-o="speak"]').checked = c.speak !== false; q('[data-o="sound"]').value = c.sound; q('[data-o="gender"]').value = c.gender || 'mix';
        var vi = m.voiceInfo ? m.voiceInfo(c.lang) : null;
        var mixLike = c.gender === 'mix' || c.gender === 'live';
        q('[data-role="voiceinfo"]').textContent = !st.speech ? '' : mixLike && m.voiceNames ? (m.voiceNames(c.lang).length ? '번갈아 쓰는 음성 ' + m.voiceNames(c.lang).length + '개: ' + m.voiceNames(c.lang).join(', ') : '이 기기에서 쓸 수 있는 음성을 찾는 중입니다…') : vi ? '사용 음성: ' + vi.name + (c.gender === 'male' ? (vi.male ? ' (남성)' : ' — 이 기기에서 남성 음성을 못 찾아 낮은 음높이로 대신합니다') : '') : '이 기기에서 쓸 수 있는 음성을 찾는 중입니다…';
        q('[data-role="livehelp"]').hidden = c.gender !== 'live';
        q('[data-role="lat"]').textContent = st.speech ? '음성 지연 보정: 약 ' + Math.round(c.lat) + 'ms (말하는 데 걸리는 시간을 기기가 스스로 재서 박자에 맞춥니다)' : '';
        q('[data-o="send"]').checked = P.sendCueOn(); q('[data-o="recv"]').checked = P.recvCue();
        var pend = st.pending && st.pending.length ? '대기 중: ' + st.pending.map(function (p) { return p.label; }).join(', ') : '';
        q('[data-role="cuestat"]').textContent = pend;
      }
      mUi = {
        sync: sync, count: function () { return +q('[data-o="count"]').value || 0; },
        beat: function (e) {
          var ds = dotsEl.children; for (var i = 0; i < ds.length; i++) ds[i].classList.remove('on', 'ci');
          var d = ds[e.beat]; if (d) { d.classList.add('on'); if (e.countIn) d.classList.add('ci'); }
        },
        event: function (kind, d) {
          if (kind === 'state') { sync(); if (pendingCfg && !m.state().running) { pendingCfg = false; setTimeout(function () { applySongBpm(P.song(), false); }, 0); } }
          else if (kind === 'error') { say(d && d.message, true); P.toast(d && d.message || '소리를 낼 수 없습니다.', true); }
          else if (kind === 'info') say(d && d.message);
          else if (kind === 'speechError') say('음성 안내를 재생하지 못했습니다 — 대신 "삐" 소리로 알려드립니다.', true);
          else if (kind === 'latency') sync();
          else if (kind === 'cue') { if (d.status === 'planned' && d.plan) q('[data-role="cuestat"]').textContent = '"' + d.text + '" — ' + d.plan.beat + '박째 (다음 마디까지 ' + Math.max(0, (d.plan.landAt - (m.ctx() ? m.ctx().currentTime : 0))).toFixed(1) + '초)'; else if (d.status === 'spoken') q('[data-role="cuestat"]').textContent = ''; }
        }
      };
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        if (b.dataset.beat != null && b.dataset.beat !== '') { var rb = act('mark', +b.dataset.beat); if (rb && rb.ok === false && !rb.locked) say(rb.error || '', true); else saveMetroSoon(); return; }
        if (b.dataset.cue) { var r = doCue(b.dataset.cue); if (r && r.ok) { b.classList.add('flash'); setTimeout(function () { b.classList.remove('flash'); }, 350); } return; }
        var a = b.dataset.a; if (!a) return;
        if (a === 'toggle') { var r2 = act('toggle'); if (r2 && r2.ok === false && !r2.locked) say(r2.error, true); else say(''); }
        else if (a === 'b-') act('bpm', Math.max(30, Math.round(m.state().bpm) - 1)); else if (a === 'b+') act('bpm', Math.min(300, Math.round(m.state().bpm) + 1));
        else if (a === 'tap') { var t = act('tap'); if (t && t.bpm) say('탭 템포 ≈ ' + Math.round(t.bpm) + ' BPM'); else if (t && !t.locked) say('계속 눌러 박자를 알려주세요.'); }
        sync();
      });
      bpmIn.addEventListener('change', function () { var v = Math.round(+bpmIn.value); if (!(v >= 30 && v <= 300)) { say('BPM 은 30 ~ 300 사이로 입력해주세요.', true); sync(); return; } say(''); act('bpm', v); rememberBpm(); });
      /* 곡 자동 BPM — 악보 쪽을 넘겨 다음 곡이 되면 리더가 곡 정보에 넣어 둔 BPM 을 자동으로 적용합니다.
         곡 정보에 BPM 이 없거나 현장에서 바꾸고 싶으면 그대로 고치면 됩니다 (−/＋ · 탭 · 직접 입력). 고친 값은 그 곡에만 기억되어 다시 돌아와도 유지됩니다. */
      var bpmOver = {}, curSongKey = '';
      function rememberBpm() { if (curSongKey) bpmOver[curSongKey] = Math.round(m.state().bpm); saveMetroSoon(); }
      onBpmUser = rememberBpm;
      host.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-a="b-"],[data-a="b+"],[data-a="tap"]')) setTimeout(rememberBpm, 0); });
      /* 곡별 메트로놈 설정(박자 · 강세 · 시작 전 마디 · BPM)을 팀과 함께 저장 · 실시간 공유 — 저장은 P.cfgSet (나만 보기 · 권한은 거기서 처리) */
      /* v8.36 — 700ms 뒤로 미뤄둔 저장은 "그 때" 곡(saveKey)을 기억해뒀다가 그 키로 저장합니다 (저장이 아직 안 나갔는데 곡을 바로 넘기면
         엉뚱한 곡에 저장되거나 사라지던 경합 상태를 고침). flushMetroSave() 로 미뤄둔 저장을 바로 흘려보낼 수 있고,
         곡 전환 · 패널 닫기 · 송폼 탭의 "저장" 단추에서 이걸 부릅니다. */
      var applyingCfg = false, saveT = 0, pendingCfg = false, saveKey = '';
      function flushMetroSave() {
        if (!saveT) return;
        clearTimeout(saveT); saveT = 0;
        var key = saveKey; saveKey = '';
        if (!key) return;
        var st = m.state();
        P.cfgSet('metro', key, { num: st.num, den: st.den, marks: st.marks.map(function (x) { return x ? (x === 2 ? 2 : 1) : 0; }), count: mUi ? Math.min(2, mUi.count()) : 0, bpm: Math.round(st.bpm) });
      }
      function saveMetroSoon() {
        if (applyingCfg || !curSongKey) return;
        saveKey = curSongKey;
        clearTimeout(saveT);
        saveT = setTimeout(flushMetroSave, 700);
      }
      flushMetroCfg = flushMetroSave;
      function applyMetroCfg(fromRemote) {
        var mc = curSongKey ? P.cfgGet('metro', curSongKey) : null; if (!mc) return false;
        if (ctl() === 'locked') return false;                                       // 클릭 컨트롤의 박자를 따르는 중
        if (m.state().running && fromRemote) { pendingCfg = true; say('팀 메트로놈 설정이 바뀌었습니다 — 멈추면 적용됩니다.'); return false; }
        applyingCfg = true;
        try {
          var st = m.state();
          if (mc.num && (mc.num !== st.num || mc.den !== st.den)) act('sig', mc.num, mc.den);
          if (Array.isArray(mc.marks) && mc.marks.length === m.state().num) act('marks', mc.marks);
          if (mc.count != null && mUi) { var cs = q('[data-o="count"]'); if (cs) cs.value = String(Math.min(2, mc.count)); }
          if (mc.bpm >= 30 && mc.bpm <= 300 && Math.round(m.state().bpm) !== mc.bpm) { bpmOver[curSongKey] = mc.bpm; act('bpm', mc.bpm); }
          if (mUi) { drawDots(m.state().num, m.state().marks); mUi.sync(); }
        } finally { applyingCfg = false; }
        return true;
      }
      function applySongBpm(x, fromSync) {
        flushMetroSave();                                                     // 곡이 바뀌기 전에, 이전 곡에 걸려있던 저장을 먼저 흘려보냄
        if (!x) { curSongKey = ''; return; }
        curSongKey = String(x.title || '');
        if (pendingCfg && !m.state().running) pendingCfg = false;
        var got = applyMetroCfg(!!fromSync);
        if (got) { say('팀 · 내 메트로놈 설정(' + Math.round(m.state().bpm) + ' BPM · ' + m.state().num + '/' + m.state().den + ')을 적용했습니다.'); return; }
        var own = bpmOver[curSongKey], base = Math.round(+x.bpm);
        var v = own || (base >= 30 && base <= 300 ? base : 0);
        if (!v) { say('이 곡에는 BPM 이 없습니다. 직접 입력하거나 탭 템포를 쓰세요.'); return; }
        if (ctl() === 'locked') { say(''); return; }                             // 클릭 컨트롤의 BPM 을 따르는 중
        if (fromSync && m.state().running) { say('곡 정보의 BPM 이 ' + v + ' 로 바뀌었습니다 — 멈추면 적용됩니다.'); pendingCfg = true; return; }
        if (Math.round(m.state().bpm) !== v) { applyingCfg = true; try { act('bpm', v); } finally { applyingCfg = false; } }
        say(own ? '이 곡에서 고친 BPM ' + v + ' 를 적용했습니다.' : '곡 정보의 BPM ' + v + ' 를 자동 적용했습니다. (바꾸려면 직접 고치세요)');
      }
      /* 팀이 바꾼 설정 · 곡 정보가 오면 (메트로놈이 멈춰 있을 때) 바로 적용 */
      P.on('cfg', function (e) { if (e && (e.kind === 'all' || (e.kind === 'metro' && e.key === curSongKey))) applySongBpm(P.song(), !!e.remote); });
      P.on('songedit', function (s) { if (s && String(s.title || '') === curSongKey) { bpmOver[curSongKey] = 0; applySongBpm(s, true); } });
      P.on('song', applySongBpm);
      P.on('close', flushMetroSave);
      try { applySongBpm(P.song()); } catch (e) {}                          // 탭을 처음 열 때 이미 정해진 곡에도 적용
      host.addEventListener('change', function (e) {
        var t = e.target, o = t.dataset && t.dataset.o; if (!o) return;
        if (o === 'sig') { var p = t.value.split('/'); var rs = act('sig', +p[0], +p[1]); if (rs && rs.locked) { sync(); return; } drawDots(+p[0], m.state().marks); saveMetroSoon(); }
        else if (o === 'count') saveMetroSoon();
        else if (o === 'flash') m.setFlash(t.checked); else if (o === 'flashall') m.setFlashAll(t.checked); else if (o === 'pitch') m.setPitch(+t.value);
        else if (o === 'click') m.setClickVolume(+t.value); else if (o === 'voice') m.setVoiceVolume(+t.value); else if (o === 'mode') m.setMode(t.value);
        else if (o === 'lead') m.setLead(+t.value); else if (o === 'lang') { m.setLang(t.value); P.setLang(t.value); labels(); } else if (o === 'sound') m.setSound(t.value); else if (o === 'gender') m.setGender(t.value); else if (o === 'first') { if (t.checked !== !!m.state().marks[0]) act('mark', 0); }
        else if (o === 'send') P.sendCueOn(t.checked); else if (o === 'recv') P.recvCue(t.checked); else if (o === 'mq') quick.setOn(t.checked); else if (o === 'speak') m.setSpeak(t.checked);
        sync();
      });
      host.addEventListener('input', function (e) {
        var t = e.target, o = t.dataset && t.dataset.o;
        if (o === 'click') m.setClickVolume(+t.value); else if (o === 'voice') m.setVoiceVolume(+t.value); else if (o === 'pitch') m.setPitch(+t.value);
      });
      m.setLang(P.lang()); labels(); sync();
      P.on('conn', sync);
      return { onShow: function () { labels(); sync(); }, destroy: function () { mUi = null; } };
    } });

    /* ------------------------------------------------------------ 화음 · 시작음 (v6.1 — 두 탭을 하나로)
       맨 위 "🎹 피아노 보기" → 시작음 피아노를 악보 위 떠 있는 창으로 (⋮⋮ 로 옮기기 · ✕ 로 닫기 · 자리 기억).
       그 아래는 예전 화음 탭(코드 인식 · 키 바꾸기 · 알토/테너 — Step 13) 그대로. */
    var piano = null;
    function pianoWin(show) {
      if (!root.YNPitch) { P.toast('시작음 피아노 도구를 불러오지 못했습니다. 페이지를 새로고침해 주세요.', true); return false; }
      if (!piano) {
        var w = doc.createElement('div'); w.className = 'pv-piano'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', '시작음 피아노');
        w.innerHTML = '<div class="pv-piano-h"><b>' + I('piano_small') + '시작음 피아노</b><small class="pv-piano-k"></small><button type="button" class="pv-piano-x" aria-label="피아노 닫기" title="닫기">' + YI('close') + '</button></div><div class="pv-piano-b"></div>';
        w.innerHTML = '<div class="pv-pianowrap">' + w.innerHTML + '</div>';                    // ⋮⋮ 손잡이(왼쪽) 옆에 머리줄 + 건반
        var s = P.song(), pr = root.YNPitch.mount(w.querySelector('.pv-piano-b'), { key: s && s.key || '', onError: function (x) { P.toast(x, true); } });
        var kEl = w.querySelector('.pv-piano-k');
        function key(x) { kEl.textContent = x && x.key ? 'Key ' + x.key : ''; }
        key(s);
        P.on('song', function (x) { if (x) { pr.setKey(x.key || ''); key(x); } });
        w.querySelector('.pv-piano-x').addEventListener('click', function (e) { e.stopPropagation(); pianoWin(false); });
        if (P.floatWin) P.floatWin('piano', w, function () { return { x: 0.5, y: 0.4 }; }); else doc.body.appendChild(w);
        P.on('close', function () { try { pr.destroy(); } catch (e) {} });
        piano = { el: w };
      }
      piano.el.classList.toggle('pv-piano-off', !show);
      if (show && P.floatPlace) P.floatPlace('piano');
      paintPianoBtns();
      return true;
    }
    var pianoBtns = [];
    function paintPianoBtns() { var on = !!(piano && !piano.el.classList.contains('pv-piano-off')); pianoBtns.forEach(function (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.innerHTML = I('piano_small') + (on ? '피아노 닫기' : '피아노 보기 (떠 있는 창)'); }); }
    P.piano = pianoWin;
    tabs.push({ id: 'harmony', icon: 'harmony', label: '화음 · 시작음', build: function (host) {
      var sec = doc.createElement('div'); sec.className = 'pv-sec pv-pianosec';
      sec.innerHTML = '<h4>시작음 <small>곡의 Key · 첫 음 확인</small></h4><button type="button" class="pv-btn2 primary pv-pianobtn" aria-pressed="false"></button>' +
        '<p class="pv-help">피아노가 악보 위 작은 창으로 뜹니다 — ⋮⋮ 를 끌어 옮기고, ✕ 로 닫습니다.</p>';
      host.appendChild(sec);
      var pb = sec.querySelector('.pv-pianobtn'); pianoBtns.push(pb); paintPianoBtns();
      pb.addEventListener('click', function () { pianoWin(!(piano && !piano.el.classList.contains('pv-piano-off'))); });
      var sub = doc.createElement('div'); sub.className = 'pv-hmhost'; host.appendChild(sub);
      if (!need('화음 · 코드 변환', root.YNHarmonyUI && root.YNHarmony && root.YNOmr, sub)) return;
      var ui = root.YNHarmonyUI.mount(sub, P); if (!ui) return;
      return { onShow: function () { ui.onShow(); }, destroy: function () { try { ui.destroy(); } catch (e) {} } };
    } });

    /* (가사 추출은 Step 2.8 에서 허브 화면의 "가사 도구"(방송팀 요청 바로 위)로 옮겼습니다 — public/worship/hubtools.js) */

    /* ------------------------------------------------------------ 함께 (페이지 컨트롤 · 클릭 컨트롤 · 동기화 끄기) */
    tabs.push({ id: 'together', icon: 'together', label: '함께', build: function (host) {
      function paint() {
        var rt = P.rt(), st = rt ? rt.state : 'unavailable', on = st === 'online', lead = on ? rt.leader : null, mine = on && rt.isLeader;
        var clk = on ? rt.clicker : null, cmine = on && rt.isClicker, manual = P.manual(), fp = P.follow(), fm = P.followMetro();
        var html = '<div class="pv-sec"><h4>연결</h4><div class="pv-conninfo ' + st + '">' +
          ({ online: '● 실시간 연결됨 — ' + rt.peers.length + '명 접속 중', connecting: '○ 연결하는 중…', offline: '○ 연결이 끊겼습니다. 자동으로 다시 연결합니다.', unavailable: '○ 실시간 기능을 쓸 수 없어 혼자 보기로 동작합니다.', denied: '✕ 이 예배에 접속할 권한이 없습니다.', idle: '○ 준비 중' }[st] || st) + '</div>' +
          (rt && rt.error && !on ? '<div class="pv-help">' + h(rt.error) + '</div>' : '') + '</div>';
        if (on) {
          html += '<div class="pv-sec"><h4>접속한 사람</h4><ul class="pv-peers">' + rt.peers.map(function (p) {
            return '<li class="' + (p.lead || p.click ? 'lead' : '') + '">' + (p.lead ? YI('page') + ' ' : '') + (p.click ? YI('metronome') + ' ' : '') + h(p.name) +
              (p.lead ? ' <small>(페이지 컨트롤)</small>' : '') + (p.click ? ' <small>(클릭 컨트롤)</small>' : '') + (p.canLead && !p.lead && !p.click ? ' <small>(컨트롤 가능)</small>' : '') + (p.follow && p.follow.page === false ? ' <small class="pv-pf">· 페이지 따로</small>' : '') + '</li>'; }).join('') + '</ul></div>';
          html += '<div class="pv-sec"><h4>' + I('page') + '페이지 컨트롤</h4><p class="pv-help">' + (mine ? '지금 내가 페이지 컨트롤입니다. 내가 넘기는 악보 · 쪽 · 확대를 따라가기를 켠 사람들이 그대로 따라옵니다.' : lead ? h(lead) + ' 님이 페이지 컨트롤입니다.' : '아직 페이지 컨트롤이 없습니다.') + '</p><div class="pv-row">' +
            (P.canLead() ? (mine ? '<button class="pv-btn2" data-a="release">페이지 컨트롤 내려놓기</button>' : lead ? '<button class="pv-btn2 warn" data-a="force">페이지 컨트롤 넘겨받기</button>' : '<button class="pv-btn2 primary" data-a="claim">📄 내가 페이지 컨트롤 하기</button>') : '<span class="pv-help">팀장 · 인도자만 컨트롤을 맡을 수 있습니다.</span>') + '</div></div>';
          html += '<div class="pv-sec pv-follows"><h4>따라가기</h4>' +
            '<label class="pv-switch"><input type="checkbox" data-a="follow"' + (fp ? ' checked' : '') + '><span></span><b>페이지 컨트롤 따라가기</b></label>' +
            '<p class="pv-help">' + (mine ? '내가 페이지 컨트롤입니다. 켜 두면 내가 넘기는 쪽이 팀에 전달되고, 끄면 팀에 보내지 않고 나 혼자 봅니다.' : fp ? (lead ? h(lead) + ' 님이 넘기는 쪽 · 악보 · 확대를 그대로 따라갑니다.' : '페이지 컨트롤이 생기면 그 화면을 따라갑니다.') : '끄면 페이지 컨트롤이 넘겨도 내 화면은 그대로입니다. 켜면 그 사람이 있는 곳으로 바로 돌아갑니다.') + '</p>' +
            (!fp && lead && !mine ? '<div class="pv-row"><button class="pv-btn2" data-a="now">컨트롤 화면으로 한 번만 가기</button></div>' : '') +
            '<p class="pv-help">메트로놈은 기기마다 따로 씁니다 (팀과 맞추지 않음).</p></div>';
          html += '<div class="pv-sec"><h4>큐(음성 안내)</h4><label class="pv-chk"><input type="checkbox" data-a="send"' + (P.sendCueOn() ? ' checked' : '') + '> 컨트롤일 때 큐를 팀에 보내기</label><label class="pv-chk"><input type="checkbox" data-a="recv"' + (P.recvCue() ? ' checked' : '') + '> 컨트롤의 큐 받기</label></div>';
        }
        host.innerHTML = html;
      }
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-a]') : null; if (!b) return; var a = b.dataset.a;
        if (a === 'claim') P.claim(false).catch(function () {}); else if (a === 'force') { if (root.confirm('지금 페이지 컨트롤을 넘겨받을까요?')) P.claim(true).catch(function () {}); }
        else if (a === 'release') P.release(); else if (a === 'now') P.followNow();
        else if (a === 'cclaim') P.claimClick(false).catch(function () {}); else if (a === 'cforce') { if (root.confirm('지금 클릭 컨트롤을 넘겨받을까요?')) P.claimClick(true).catch(function () {}); }
        else if (a === 'crelease') P.releaseClick();
      });
      host.addEventListener('change', function (e) {
        var t = e.target, a = t.dataset && t.dataset.a;
        if (a === 'follow') P.setFollow(t.checked); else if (a === 'followm') P.setFollowMetro(t.checked); else if (a === 'send') P.sendCueOn(t.checked); else if (a === 'recv') P.recvCue(t.checked); else if (a === 'manual') P.setManual(t.checked);
      });
      ['conn', 'peers', 'leader', 'clicker', 'follow', 'followm', 'manual', 'state', 'joined'].forEach(function (n) { P.on(n, function () { if (host.offsetParent !== null) paint(); }); });
      paint();
      return { onShow: paint };
    } });

    P.on('song', function () { quick.sync(); }); ['clicker', 'conn', 'leader', 'manual', 'followm'].forEach(function (n) { P.on(n, function () { quick.sync(); }); });
    setTimeout(function () { quick.mount(); live.attach(P.el.querySelector('.pv-tools')); }, 0);
    P.on('toolsrender', function (host) { live.attach(host); });          // 화면 뼈대가 다 만들어진 다음에 붙입니다
    return tabs;
  }

  root.YNPanels = { build: build };
}(typeof self !== 'undefined' ? self : this));
