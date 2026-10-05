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
    var M = null, mUi = null, lastBeat = -1, onBpmUser = null, flushMetroCfg = null;   // V836 — 메트로놈 탭이 미뤄 둔 저장을 다른 탭(송폼)의 "저장"으로도 바로 흘려보냄
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
          if (kind === 'state') { quick.sync(); minis.forEach(function (x) { x.sync(); }); try { leadFromState(); } catch (x) { /* 화면만 */ } }
          if (mUi) mUi.event(kind, d); else if (kind === 'error') P.toast(d && d.message || '소리를 낼 수 없습니다.', true);
        }
      });
      M.setLang(P.lang());
      setTimeout(function () { try { if (P.ensureTab) P.ensureTab('metro'); } catch (e) { /* 탭이 없어도 메트로놈은 */ } }, 0);   // V848 — 곡별 저장 BPM 을 탭을 열지 않아도 적용
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
      /* V844 — 누르고 있는 동안만 반복: 손을 뗀 신호를 단추가 못 받는 경우(단추가 다시 그려져 화면에서 잠깐 빠짐 · 펜슬 · 팜 리젝션)에도
         문서 전체의 pointerup/cancel · 단추가 화면에서 빠짐 · 6초 안전장치로 반드시 멈춥니다 (예전: BPM 이 30 까지 계속 내려가던 문제) */
      var t0 = 0;
      function loop() { if (!btn.isConnected || btn.disabled || Date.now() - t0 > 6000) { stop(); return; } once(); n++; t2 = setTimeout(loop, n > 12 ? 45 : n > 5 ? 80 : 130); }
      function stop() { clearTimeout(t1); clearTimeout(t2); t1 = t2 = 0; n = 0; pid = null; doc.removeEventListener('pointerup', docUp, true); doc.removeEventListener('pointercancel', docUp, true); }
      function docUp(e) { if (pid == null || e.pointerId === pid) stop(); }
      btn.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        if (btn.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault(); pid = e.pointerId;
        try { btn.setPointerCapture(e.pointerId); } catch (x) { /* 캡처가 안 돼도 pointerup 으로 멈춤 */ }
        t0 = Date.now(); doc.addEventListener('pointerup', docUp, true); doc.addEventListener('pointercancel', docUp, true);
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
        note.innerHTML = mode === 'send' ? I('metronome') + '내가 클릭 컨트롤 — 팀에 전달됩니다' : lock ? I('metronome') + h((root.YNHon ? root.YNHon.say(rt && rt.clicker || '') : (rt && rt.clicker || '') + ' 님이')) + ' 클릭 컨트롤 — 자동으로 따라감' : '';
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

    /* ---------- V848 — 박 흐름 막대 (송폼 창 · 메트로놈 창) ----------
       ● ● ● ●  박이 흘러가는 것을 보여 주고(2박으로 쪼개면 사이에 작은 점), 바로 누르는 단추들:
         [저장] (송폼 창만 — 지금 BPM 을 이 곡에 저장. 누르지 않으면 바꾼 BPM 은 저장되지 않고, 다른 곡에 갔다 오면 저장된 BPM 으로)
         [1234] 숫자로 세기(한 마디) · [1박] 1박 다시 맞추기 · [×2] 2박으로 쪼개기 · ☐ 숫자로(딸깍 대신 계속) · ☐ 콜아웃 뒤 3·2·1 */
    var saveBpmImpl = null;
    P.saveBpm = function () { try { if (P.ensureTab) P.ensureTab('metro'); } catch (e) { /* 없음 */ } return saveBpmImpl ? saveBpmImpl() : false; };
    P.savedBpm = function () { var s = P.song(); if (!s) return null; var mc = P.cfgGet ? P.cfgGet('metro', String(s.title || '')) : null; if (mc && mc.bpm >= 30 && mc.bpm <= 300) return Math.round(mc.bpm); return +s.bpm >= 30 && +s.bpm <= 300 ? Math.round(+s.bpm) : null; };
    function beatStrip(kind) {
      var el = doc.createElement('div'); el.className = 'pv-bs pv-bs-' + kind; el.setAttribute('role', 'group'); el.setAttribute('aria-label', '박 흐름 · 세기');
      el.innerHTML = (kind === 'form' ? '<button type="button" class="pv-bs-save" data-bs="save" title="지금 BPM 을 이 곡에 저장 (누르지 않으면 바꾼 BPM 은 저장되지 않아요)">저장</button>' : '') +
        '<div class="pv-bs-dots" aria-hidden="true"></div>' +
        '<div class="pv-bs-row">' +
          (kind === 'form' ? '<button type="button" class="pv-bs-b" data-bs="count" title="숫자로 세기 (N) — 바로 다음 박부터 One · Two · Three · Four">1234</button>' : '') +
          '<button type="button" class="pv-bs-b" data-bs="re" title="1박 다시 맞추기 — 누른 그 박이 새 1박">1박</button>' +
          '<button type="button" class="pv-bs-b" data-bs="sub" aria-pressed="false" title="2박으로 쪼개기 — 4/4 면 한 마디에 8번 (화면 깜빡임은 4번)">×2</button>' +
          '<label class="pv-bs-c" title="딸깍 대신 One · Two · Three · Four 로 계속 세기"><input type="checkbox" data-bs="cnum"><span>숫자로</span></label>' +
          '<label class="pv-bs-c" title="콜아웃 뒤 Three · Two · One (예: Verse, 3, 2, 1)"><input type="checkbox" data-bs="cd"><span>3·2·1</span></label>' +
          '<label class="pv-bs-c pv-bs-cdr" title="3·2·1 때 누르면 바로 다음 박을 1박으로 (끄면 박은 그대로 — 다음 마디 첫 박에 콜아웃 → 3 · 2 · 1)"><input type="checkbox" data-bs="cdr"><span>바로 1박</span></label>' +
        '</div>';
      var dots = el.querySelector('.pv-bs-dots'), saveB = el.querySelector('.pv-bs-save'), key = '', subT = 0;
      function sync() {
        var st = M ? M.state() : null, c = st ? st.cfg : {}, num = st ? st.num : 4, sub = c.sub === 2, k = num + ':' + (sub ? 2 : 1);
        if (k !== key) { key = k; var hh = ''; for (var i = 0; i < num; i++) hh += '<i data-b="' + i + '"' + (i === 0 ? ' class="d1"' : '') + '></i>' + (sub ? '<i class="h" data-h="' + i + '"></i>' : ''); dots.innerHTML = hh; dots.style.setProperty('--n', String(num * (sub ? 2 : 1))); }
        var sb = el.querySelector('[data-bs="sub"]'); sb.classList.toggle('on', sub); sb.setAttribute('aria-pressed', sub ? 'true' : 'false');
        var cn = el.querySelector('[data-bs="cnum"]'), cd = el.querySelector('[data-bs="cd"]');
        if (cn.checked !== !!c.countAll) cn.checked = !!c.countAll; if (cd.checked !== !!c.countdown) cd.checked = !!c.countdown;
        var cr = el.querySelector('[data-bs="cdr"]'); if (cr) { if (cr.checked !== (c.cdReset !== false)) cr.checked = c.cdReset !== false; cr.disabled = !c.countdown; cr.parentNode.classList.toggle('off', !c.countdown); }
        el.querySelector('[data-bs="re"]').disabled = !(st && st.running);
        var mk = st ? st.marks : [];                                                   // V859 — 박 동그라미: 강세(>) · 끈 박 표시
        Array.prototype.forEach.call(dots.querySelectorAll('[data-b]'), function (d) { var v = mk[+d.getAttribute('data-b')]; d.classList.toggle('acc', !!v && v !== 3); d.classList.toggle('mute', v === 3); });
        if (!(st && st.running)) Array.prototype.forEach.call(dots.children, function (d) { d.classList.remove('on'); });
        if (saveB) {
          var cur = P.curBpm ? P.curBpm() : null, sv = P.savedBpm(), dirty = !!(cur && sv && cur !== sv);
          saveB.classList.toggle('dirty', dirty); saveB.disabled = !P.song();
          saveB.textContent = dirty ? '저장 ' + cur : '저장됨';
          saveB.title = dirty ? '지금 ' + cur + ' BPM 을 이 곡에 저장 (저장된 값 ' + sv + ') — 누르지 않으면 다른 곡에 갔다 오면 ' + sv + ' 로 돌아가요' : '이 곡에 저장된 BPM ' + (sv || '—');
        }
      }
      function beat(e) {
        var ds = dots.children; for (var i = 0; i < ds.length; i++) ds[i].classList.remove('on');
        var d = dots.querySelector('[data-b="' + (e && e.beat) + '"]'); if (d) d.classList.add('on');
        clearTimeout(subT);
        var st = M ? M.state() : null;
        if (st && st.cfg.sub === 2) { var hd = dots.querySelector('[data-h="' + e.beat + '"]'); if (hd) subT = setTimeout(function () { if (d) d.classList.remove('on'); hd.classList.add('on'); }, 30000 / st.bpm); }
      }
      el.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('button,input,label')) e.stopPropagation(); });   // 창 끌기 · 악보 톡과 겹치지 않게
      dots.removeAttribute('aria-hidden'); dots.title = '박 동그라미를 누를 때마다 보통 → 강세(>) → 소리 끔';
      el.addEventListener('click', function (e) {
        var dt = e.target.closest ? e.target.closest('.pv-bs-dots [data-b]') : null;        // V859 — 박 동그라미를 눌러 강세 · 소리 끔
        if (dt) { e.stopPropagation(); if (P.metroKey) { var rm = P.metroKey('mark', +dt.getAttribute('data-b')); if (rm && rm.ok !== false) P.toast(rm.on === 'mute' ? (+dt.getAttribute('data-b') + 1) + '박 소리 끔' : rm.on ? (+dt.getAttribute('data-b') + 1) + '박 강세 (>)' : (+dt.getAttribute('data-b') + 1) + '박 보통', false, 900); } syncAllStrips(); return; }
        var b = e.target.closest ? e.target.closest('[data-bs]') : null; if (!b) return;
        e.stopPropagation();
        var a = b.getAttribute('data-bs'); if (b.tagName === 'INPUT') return;           // 체크칸은 change 에서
        var m = metro(); if (!m) { P.toast('메트로놈 도구를 불러오지 못했습니다.', true); return; }
        if (a === 'save') P.saveBpm();
        else if (a === 'count') P.metroKey('count');
        else if (a === 're') { var rr = m.markNow(); P.toast(rr != null ? '지금 박을 1박으로 다시 맞췄습니다' : '먼저 메트로놈을 시작하세요', rr == null, 1100); }
        else if (a === 'sub') { var on = m.state().cfg.sub !== 2; m.setSub(on ? 2 : 1); P.toast(on ? '2박으로 쪼개기 — 한 마디 ' + (m.state().num * 2) + '번 (깜빡임은 ' + m.state().num + '번)' : '쪼개기 끔', false, 1300); }
        syncAllStrips();
      });
      el.addEventListener('change', function (e) {
        var t = e.target; if (!t || !t.getAttribute) return; var a = t.getAttribute('data-bs'); if (!a) return;
        var m = metro(); if (!m) return;
        if (a === 'cnum') { m.setCountAll(t.checked); P.toast(t.checked ? '딸깍 대신 숫자로 셉니다 (One · Two · Three · Four)' : '숫자로 세기 끔 — 딸깍', false, 1300); }
        else if (a === 'cd') { m.setCountdown(t.checked); P.toast(t.checked ? '콜아웃 뒤 Three · Two · One 켜짐' : '콜아웃 뒤 3·2·1 끔', false, 1200); }
        else if (a === 'cdr') { if (m.setCountdownReset) m.setCountdownReset(t.checked); P.toast(t.checked ? '3·2·1 — 누르면 바로 다음 박이 1박' : '3·2·1 — 박은 그대로, 다음 마디 첫 박에 콜아웃', false, 1500); }
        syncAllStrips(); if (mUi) mUi.sync();
      });
      var api = { el: el, sync: sync, beat: beat, destroy: function () { clearTimeout(subT); var i = minis.indexOf(api); if (i >= 0) minis.splice(i, 1); if (el.parentNode) el.parentNode.removeChild(el); } };
      minis.push(api); sync(); P.on('song', sync); P.on('cfg', function () { setTimeout(sync, 0); }); P.on('close', api.destroy);
      return api;
    }
    function syncAllStrips() { minis.forEach(function (x) { try { x.sync(); } catch (e) { /* 화면만 */ } }); }
    P.beatStrip = function (kind) { return beatStrip(kind); };

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
      /* V836 — 메트로놈 떠 있는 창의 "펼치기": 반복 · 다이내믹 · 진행 · 들어가기 콜아웃 전부 + 볼륨을 패널을 열지 않고 바로 (폰에서도 이것만 떠 있습니다) */
      var expB = null, cuesEl = null, EXP_GROUPS = [['rep', '반복'], ['dyn', '다이내믹'], ['sec', '진행'], ['in', '들어가기']];
      var expState = false;                                                    // V838 — 열 때마다 접힌 채로 시작 (펼친 상태는 이 화면에서만 기억)
      function expOn() { return expState; }
      function cuesHtml() {
        var C = root.YNMetro && root.YNMetro.CUES; if (!C) return '';
        return EXP_GROUPS.map(function (g) {
          var list = C.filter(function (c) { return c.g === g[0]; }); if (!list.length) return '';
          return '<div class="pv-lv-grp"><span>' + g[1] + '</span><div>' + list.map(function (c) { return '<button type="button" class="pv-cue" data-cue="' + c.id + '"></button>'; }).join('') + '</div></div>';
        }).join('') +
          '<div class="pv-lv-vols"><label>딸깍 볼륨 <input type="range" min="0" max="1" step="0.02" data-vol="click" aria-label="딸깍 볼륨"></label><label>음성 볼륨 <input type="range" min="0" max="2" step="0.05" data-vol="voice" aria-label="음성 볼륨"></label></div>';
      }
      function cueLabels() {
        if (!cuesEl || !root.YNMetro) return;
        var lang = P.lang();
        Array.prototype.forEach.call(cuesEl.querySelectorAll('[data-cue]'), function (b) {
          var c = root.YNMetro.CUE_BY[b.dataset.cue]; if (!c) return;
          var t = lang === 'ko' ? c.ko : c.en; if (b.textContent !== t) { b.textContent = t; b.title = c.en + ' / ' + c.ko; }
        });
      }
      function setExp(on) {
        if (!el) return;
        on = !!on; el.classList.toggle('expanded', on);
        if (expB) { expB.setAttribute('aria-pressed', on ? 'true' : 'false'); expB.setAttribute('aria-expanded', on ? 'true' : 'false'); expB.setAttribute('aria-label', on ? '콜아웃 접기' : '콜아웃 펼치기'); expB.textContent = on ? '▴' : '▾'; }
        var mw = el.closest ? el.closest('.pv-metro') : null; if (mw) mw.classList.toggle('pv-mexp', on);
        expState = on;
      }
      function build() {
        el = doc.createElement('div'); el.className = 'pv-live'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', '라이브 컨트롤 — 메트로놈 · 음성 콜아웃');
        el.innerHTML = '<button type="button" class="pv-lv-go" aria-pressed="false" title="메트로놈 시작 / 멈춤 (Space)" aria-label="메트로놈 시작">' + IC.play + '</button>' +
          '<button type="button" class="pv-lv-step pv-lv-dn" title="BPM −1 (누르고 있으면 계속)" aria-label="BPM 내리기">−</button>' +
          '<button type="button" class="pv-lv-bpm" title="메트로놈 패널 열기" aria-label="BPM — 메트로놈 패널 열기"><b>—</b><small>BPM</small><i class="pv-lv-dot b0"></i></button>' +
          '<button type="button" class="pv-lv-step pv-lv-up" title="BPM +1 (누르고 있으면 계속)" aria-label="BPM 올리기">+</button>' +
          '<button type="button" class="pv-lv-cnt" title="숫자로 세기 (N) — 누르면 바로 다음 박부터 One · Two · Three · Four (목소리만)" aria-label="숫자로 세기">1234</button>' +
          '<button type="button" class="pv-lv-tts" aria-pressed="true" title="음성 콜아웃 (TTS) 켜기 / 끄기" aria-label="음성 콜아웃 켜짐">' + IC.vol + '<small>콜아웃</small></button>' +
          '<button type="button" class="pv-lv-exp" aria-pressed="false" aria-expanded="false" title="콜아웃 펼치기 / 접기 (반복 · 다이내믹 · 진행 · 볼륨)" aria-label="콜아웃 펼치기">▾</button>' +
          '<div class="pv-lv-cues" role="group" aria-label="콜아웃 — 반복 · 다이내믹 · 진행 · 들어가기">' + cuesHtml() + '</div>';
        try { var bsx = beatStrip('metro'); el.insertBefore(bsx.el, el.querySelector('.pv-lv-cues')); } catch (x) { /* 박 막대는 덤 */ }    // V848 — 박 흐름 · 1박 · ×2 · 숫자로 · 3·2·1
        expB = el.querySelector('.pv-lv-exp'); cuesEl = el.querySelector('.pv-lv-cues');
        goB = el.querySelector('.pv-lv-go'); bpmB = el.querySelector('.pv-lv-bpm'); ttsB = el.querySelector('.pv-lv-tts'); dot = el.querySelector('.pv-lv-dot');
        bpmStep(el.querySelector('.pv-lv-dn'), -1, sync); bpmStep(el.querySelector('.pv-lv-up'), 1, sync);
        el.addEventListener('input', function (e) {
          var t = e.target; if (!t || !t.dataset || !t.dataset.vol) return; var m = metro(); if (!m) return;
          if (t.dataset.vol === 'click') m.setClickVolume(+t.value); else m.setVoiceVolume(+t.value);
        });
        el.addEventListener('click', function (e) {
          var cb = e.target.closest ? e.target.closest('[data-cue]') : null;
          if (cb) { e.stopPropagation(); var cr = doCue(cb.dataset.cue); if (cr && cr.ok) { cb.classList.add('flash'); setTimeout(function () { cb.classList.remove('flash'); }, 350); } return; }
          var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
          if (b.classList.contains('pv-lv-step')) return;                 // BPM −/+ 는 bpmStep 이 처리
          e.stopPropagation();                                            // 도구 막대의 다른 단추 처리기로 넘어가지 않게
          if (b === goB) {
            var r = P.metroKey('toggle');
            if (r === null) P.toast('메트로놈 도구를 불러오지 못했습니다.', true);
          } else if (b === bpmB) P.showTab('metro');
          else if (b.classList.contains('pv-lv-cnt')) P.metroKey('count');
          else if (b === expB) setExp(!el.classList.contains('expanded'));
          else if (b === ttsB) {
            var m = metro(); if (!m) { P.toast('메트로놈 도구를 불러오지 못했습니다.', true); return; }
            if (!speechOk()) { P.toast('이 기기는 음성 안내를 지원하지 않습니다.', true); return; }
            var on = !(m.state().cfg.speak !== false); m.setSpeak(on);
            P.toast(on ? '음성 콜아웃 켜짐' : '음성 콜아웃 꺼짐 — 큐 이름을 말하지 않습니다', false, 1200);
          }
          sync();
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
        Array.prototype.forEach.call(el.querySelectorAll('.pv-lv-step'), function (x) { x.disabled = ctl() === 'locked'; });
        el.classList.toggle('locked', ctl() === 'locked');
        cueLabels();
        if (st && st.cfg && cuesEl) {
          var vc = cuesEl.querySelector('[data-vol="click"]'), vv = cuesEl.querySelector('[data-vol="voice"]');
          if (vc && doc.activeElement !== vc) vc.value = st.cfg.click; if (vv && doc.activeElement !== vv) vv.value = st.cfg.voice;
        }
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
        if (expB && expOn() !== el.classList.contains('expanded')) setExp(expOn()); else if (expB) { var mw = el.closest ? el.closest('.pv-metro') : null; if (mw) mw.classList.toggle('pv-mexp', el.classList.contains('expanded')); }
        sync();
      }
      function destroy() { if (el && el.parentNode) el.parentNode.removeChild(el); el = goB = bpmB = ttsB = dot = expB = cuesEl = null; }
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
    function lockedMsg() { var rt = P.rt(); return (root.YNHon ? root.YNHon.say(rt && rt.clicker ? rt.clicker : '다른 사람') : (rt && rt.clicker ? rt.clicker : '다른 사람') + ' 님이') + ' 클릭 컨트롤입니다. 직접 쓰려면 "함께" 탭에서 클릭 컨트롤을 넘겨받으세요.'; }
    /** 지금 내 메트로놈 상태를 서버로 (내가 클릭 컨트롤일 때) */
    function sendState(o) {
      var rt = P.rt(), m = metro(); if (!rt || !m || ctl() !== 'send') return;
      o = o || {}; var st = m.state();
      var body = { playing: o.playing != null ? !!o.playing : st.running, bpm: st.bpm, num: st.num, den: st.den, marks: st.marks, count: o.count != null ? o.count : (mUi ? mUi.count() : 0), keep: !!o.keep };
      rt.sendMetro(body).catch(function (e) { P.toast('메트로놈 상태를 팀에 보내지 못했습니다: ' + e.message, true); });
    }
    function sendSoon(o) { clearTimeout(sendT); sendT = setTimeout(function () { sendState(o); }, 220); }
    /** 클릭 컨트롤에게서 받은 상태를 내 메트로놈에 적용 — 서버 시각(startAt)을 내 오디오 시계로 바꿔 같은 박에 시작 */
    var V842_SILENT = true;
    /* ---------- V842 리드 상태 — 리드가 바꾼 BPM · 박자는 모두의 화면에 (소리는 각자, 절대 원격으로 울리지 않음) ---------- */
    var leadLast = {}, leadApplying = false, leadT = 0, leadPend = {};
    function leadOK() {
      var rt = P.rt(); if (!rt || !rt.online || !rt.me) return false;
      return !!(rt.isLeader || rt.isClicker || (!rt.leader && !rt.clicker && rt.me.canLead));
    }
    P.isLeadNow = leadOK;
    P.sendLead = function (patch) {
      if (!leadOK()) return false;
      for (var k in patch) leadPend[k] = patch[k];
      clearTimeout(leadT);
      leadT = setTimeout(function () { var p2 = leadPend, rt = P.rt(); leadPend = {}; if (rt && rt.sendLead) rt.sendLead(p2).catch(function () { /* 다음 변경 때 다시 */ }); }, 120);
      return true;
    };
    P.curBpm = function () { if (M) return Math.round(M.state().bpm); var s = P.song(); return s && +s.bpm >= 30 ? Math.round(+s.bpm) : null; };
    function leadFromState() {
      if (leadApplying || !M) return;
      var st = M.state(), b = Math.round(st.bpm);
      if (b === leadLast.bpm && st.num === leadLast.num && st.den === leadLast.den) return;
      leadLast = { bpm: b, num: st.num, den: st.den };
      P.sendLead({ bpm: b, num: st.num, den: st.den, song: P.songIdx ? P.songIdx() : -1 });
      P.emit('bpmview', b);
    }
    P.on('lead', function (st) {
      var rt = P.rt(); if (!st || (rt && rt.me && st.by === rt.me.name)) return;
      var prevLead = P.leadNow; P.leadNow = st;
      var fresh = !!(rt && rt.serverNow && st.t && Math.abs(rt.serverNow() - st.t) < 4000);
      if (st.cue && fresh) remoteCueFlash(String(st.cue), st.by);                         // V848 — 리드가 누른 콜아웃 (큐 보내기 설정과 상관없이)
      if (st.bpm >= 30 && fresh && prevLead && prevLead.bpm && prevLead.bpm !== st.bpm) {  // V848 — 리드가 BPM 을 바꾸면 모두에게 숫자로
        P.toast('♩ ' + (st.by ? st.by + ' — ' : '') + 'BPM ' + st.bpm, false, 1300);
        Array.prototype.forEach.call(P.el.querySelectorAll('.pv-form-bpm,.pv-lv-bpm b'), function (n) { n.classList.remove('pv-bpmchg'); void n.offsetWidth; n.classList.add('pv-bpmchg'); });
      }
      if (st.bpm >= 30) {
        var m = metro();
        if (m) {
          leadApplying = true;
          try {
            var cur = m.state();
            if (Math.round(cur.bpm) !== st.bpm) m.setBpm(st.bpm);
            if (st.num && st.den && (cur.num !== st.num || cur.den !== st.den)) m.setSig(st.num, st.den);
          } finally { leadApplying = false; }
          leadLast = { bpm: Math.round(m.state().bpm), num: m.state().num, den: m.state().den };
          if (mUi) mUi.sync(); minis.forEach(function (x) { x.sync(); }); quick.sync();
        }
        P.emit('bpmview', st.bpm);
      }
    });
    function remoteMetro(st) {
      var rt = P.rt(); if (!st || !rt || !P.followMetro()) return;
      if (st.seq != null && st.seq < remoteSeq) return;
      var m = metro(); if (!m) return;
      remoteSeq = st.seq == null ? remoteSeq : st.seq;
      var cur = m.state();
      if (Math.round(cur.bpm * 10) !== Math.round(st.bpm * 10)) m.setBpm(st.bpm);
      if (cur.num !== st.num || cur.den !== st.den) m.setSig(st.num, st.den);
      m.setMarks(st.marks);
      /* V842 — 다른 사람 기기에서는 절대 소리를 내지 않습니다: 팀 메트로놈 상태가 와도 BPM · 박자 · 강세 숫자만 맞추고 시작/멈춤은 각자 */
      if (V842_SILENT) { lastAnchor = 0; remoteWait = false; if (mUi) mUi.sync(); return; }
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
      else { if (r.muted) P.toast('음성 콜아웃이 꺼져 있습니다 — "' + (r.text || '') + '"', false, 1400); if (!fromRemote) { P.broadcastCue(id); try { P.sendLead({ cue: String(id).slice(0, 40) }); } catch (x) { /* 리드가 아니면 보내지 않음 */ } } try { P.flashCue && P.flashCue(id); } catch (e) { /* 깜빡임은 덤 */ } }
      return r;
    }
    P.cueKey = function (id) { return metro() ? (doCue(id) || { ok: false }) : null; };
    P.on('cue', function (c) {
      /* V842 — 리드의 콜아웃은 받는 기기에서 절대 소리 내지 않습니다. 화면에만: 알림 · 악보의 송폼 라벨 깜빡임 · 송폼 창 위치 */
      /* V848 — 따라가기 · 큐 받기를 꺼 두었어도 리드의 콜아웃은 반드시 반짝 (소리는 여전히 안 남) */
      if (!c || !c.label) return;
      remoteCueFlash(String(c.label), c.by);
    });
    var lastRemoteCue = { k: '', t: 0 };
    function remoteCueFlash(label, by) {
      var now = Date.now(); if (lastRemoteCue.k === label && now - lastRemoteCue.t < 1500) return;      // 같은 콜아웃이 두 길(큐 · 리드 상태)로 와도 한 번만
      lastRemoteCue = { k: label, t: now };
      var cb = root.YNMetro && root.YNMetro.CUE_BY[label], name = cb ? (P.lang() === 'ko' ? cb.ko : cb.en) : label;
      try { P.flashCue && P.flashCue(label); } catch (e) { /* 깜빡임은 덤 */ }
      P.toast('🔇 ' + (by ? by + ' — ' : '') + name, false, 1500);
    }
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
      if (act2 === 'count') {                                            // V842 — 숫자로 세기 (N): 누르는 순간이 1박, 멈춰 있으면 시작하면서 셈
        if (ctl() === 'locked') { P.toast(lockedMsg(), true); return { ok: false, locked: true }; }
        var rc = m.countNow(); if (rc && rc.ok === false) { P.toast(rc.error || '소리를 낼 수 없습니다.', true); return rc; }
        P.toast('One · Two · Three · Four', false, 900); return { ok: true };
      }
      if (act2 === 'mark') { var rk = act('mark', d); if (rk && rk.ok !== false && P._saveMetroSoon) P._saveMetroSoon(); return rk; }   // V859 — 박 흐름 막대(메트로놈 · 송폼 창)의 동그라미
      if (act2 === 're') {                                               // V859 — 1 키: 1박 다시 맞추기
        if (ctl() === 'locked') { P.toast(lockedMsg(), true); return { ok: false, locked: true }; }
        var rr = m.markNow(); P.toast(rr != null ? '지금 박을 1박으로 다시 맞췄습니다' : '먼저 메트로놈을 시작하세요', rr == null, 1100); return { ok: rr != null };
      }
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
          '<label class="pv-chk"><input type="checkbox" data-o="pentap" checked> 펜 · 형광펜을 화면에 0.9초 대고 있으면 지우개 — 그대로 문지르면 지우고 떼면 원래대로, 바뀐 뒤 바로 떼면 지우개가 남아 다음에 지우고 떼면 원래 펜으로 · 형광펜 줄 끝에서 0.9초 멈추면 반듯하게</label>' +
          '<label class="pv-chk"><input type="checkbox" data-o="eraseback" checked> 펜슬로 지우개를 쓰고 떼면 원래 펜으로 돌아가기</label>' +
          '<p class="pv-help">굵기 3칸: 고른 칸을 한 번 더 누르면 조절 막대가 나와요. 바꾼 굵기는 그 칸에 저장됩니다 (펜 · 형광펜 따로).</p>' +
          '<p class="pv-help">웹 페이지는 애플 펜슬의 하드웨어 더블탭을 받을 수 없어, 펜슬을 0.9초 대고 있기(또는 펜 옆 버튼)로 지우개를 씁니다. 펜으로 다른 필기를 톡 치면 누가 썼는지 잠깐 보입니다. 두 손가락은 화면 밀기 · 확대 · 축소에 쓰이고, 펜슬을 쓰는 중에는 손가락 · 손바닥으로는 그려지지 않습니다.</p></div>' +
        '<div class="pv-sec"><h4>지우기</h4><div class="pv-row"><button class="pv-btn2" data-a="mine">현재 페이지 내 필기 지우기</button>' + (P.canEdit ? '<button class="pv-btn2 warn" data-a="all">현재 페이지 모두 지우기</button>' : '') + '</div><p class="pv-help">지운 뒤에도 화면 왼쪽(위)의 ↶ 로 되돌릴 수 있습니다.</p></div>' +
        '<div class="pv-sec"><h4>저장</h4><div class="pv-save" data-role="save"></div><div class="pv-row"><button class="pv-btn2" data-a="save">지금 저장</button></div></div>' +
        '<div class="pv-sec"><h4>내보내기 · 인쇄 (필기 포함)</h4><div class="pv-row"><button class="pv-btn2" data-a="png">현재 페이지 그림(PNG)</button><button class="pv-btn2" data-a="pdf">전체 PDF</button><button class="pv-btn2" data-a="print">인쇄</button></div></div>' +
        '<div class="pv-sec"><h4>화면 설정</h4><div class="pv-radio" data-g="layout"><button data-v="tablet">' + I('tablet') + '태블릿</button><button data-v="computer">' + I('laptop') + '컴퓨터</button></div>' +
          '<label class="pv-chk"><input type="checkbox" data-o="lefty"> 왼손잡이 (도구 막대를 왼쪽에)</label>' +
          '<p class="pv-help">태블릿: 큰 버튼 · 화면 양쪽 가장자리를 눌러 쪽 넘김 · 도구 막대가 떠 있음. 컴퓨터: 위쪽 도구 줄 · 오른쪽 패널 · 단축키(←→ 쪽, Alt+P 펜, Alt+H 형광펜, Alt+T 글자, Alt+C 코드, Alt+E 지우개, Ctrl+Z 취소, ↑↓ BPM, Space 메트로놈). 콜아웃 단축키: I 인트로 · V 절(누를 때마다 1→2→3절, 또는 2 3) · 1 1박 다시 맞추기 · M 인스트루멘탈 · E 엔딩 · C 후렴 · P 프리코러스 · B 브릿지 · R 코러스 반복 · T 태그 · Shift+P 기도 · Shift+R 한 번 더 · K 키 업 · U 빌드 업 · D 다이 다운 · N 숫자로 세기 · Enter 송폼 순서대로.</p></div>';
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
        host.querySelector('[data-o="pen"]').value = P.penMode(); host.querySelector('[data-o="pentap"]').checked = P.penTap(); host.querySelector('[data-o="eraseback"]').checked = P.eraseBack ? P.eraseBack() : true;
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
        else if (t.dataset.o === 'eraseback') P.setEraseBack(t.checked);
        else if (t.dataset.o === 'lefty') P.setHand(t.checked ? 'left' : 'right');
        else if (t.dataset.o === 'mineonly') P.setLayer(t.checked ? 'mine' : 'team');
      });
      ['sync', 'layer', 'scope', 'conn'].forEach(function (n) { P.on(n, paint); });
      paint();
      return { onShow: paint };
    } });

    /* ------------------------------------------------------------ V842 기록 — 누가 쓴 필기인지 */
    tabs.push({ id: 'log', icon: 'user', label: '필기 기록', short: '기록', build: function (host) {
      host.innerHTML =
        '<div class="pv-sec"><h4>누가 썼나요 <small>여러 명이 동시에 써도 실시간으로 모두에게 보입니다</small></h4>' +
          '<label class="pv-chk"><input type="checkbox" data-o="showby"> 악보 위에 쓴 사람 이름표 보이기</label>' +
          '<p class="pv-help">아래 "최근 필기"를 누르면 그 필기가 악보에서 반짝입니다. 펜 · 이동 도구로 필기를 톡 치면 쓴 사람이 잠깐 보이고, "선택" 도구로 필기(펜 획 포함)를 누르면 쓴 사람과 시각이 주황 이름표로 보입니다. 남의 필기는 볼 수만 있고, 팀장 · 인도자만 고치거나 지울 수 있습니다.</p>' +
          '<div class="pv-logwho" data-role="who"></div></div>' +
        '<div class="pv-sec"><h4>최근 필기</h4><div class="pv-logrec" data-role="rec"></div></div>';
      var whoEl = host.querySelector('[data-role="who"]'), recEl = host.querySelector('[data-role="rec"]'), chk = host.querySelector('[data-o="showby"]');
      var KIND = { pen: '펜', hl: '형광펜', text: '글자', sym: '기호', fbox: '송폼 라벨' };
      function an() { var a = P.anno && P.anno(); return a && a.authors ? a : null; }
      function paint() {
        var a = an(); if (!a) { whoEl.innerHTML = '<p class="pv-help">필기 도구를 불러오지 못했습니다.</p>'; return; }
        chk.checked = a.showAuthors(); var f = a.authorFilter(), list = a.authors();
        whoEl.innerHTML = list.length ? list.map(function (x) {
          var on = f === x.name;
          return '<div class="pv-logrow' + (on ? ' on' : '') + '"><b>' + h(x.name || '알 수 없음') + '</b><small>' + x.n + '개 · ' + (x.pages.length > 4 ? x.pages.slice(0, 4).join(', ') + '…' : x.pages.join(', ')) + '쪽 · ' + h(a.ago(x.last)) + (x.mine ? ' · 나만 보기 ' + x.mine : '') + '</small>' +
            '<span><button type="button" class="pv-btn2" data-only="' + h(x.name) + '">' + (on ? '모두 보기' : '이 사람만') + '</button><button type="button" class="pv-btn2" data-pg="' + (x.pages[0] || 1) + '">쪽으로</button></span></div>';
        }).join('') + (f ? '<p class="pv-help pv-logf">지금 <b>' + h(f) + '</b> 님 필기만 보이는 중입니다.</p>' : '') : '<p class="pv-help">아직 이 악보에 필기가 없습니다.</p>';
        var items = []; ['team', 'mine'].forEach(function (ly) { (a.items(ly) || []).forEach(function (it) { items.push({ ly: ly, it: it }); }); });
        items.sort(function (x, y) { return (+y.it.ts || 0) - (+x.it.ts || 0); });
        recEl.innerHTML = items.length ? items.slice(0, 25).map(function (x) {
          var it = x.it, what = KIND[it.t] || it.t; if (it.t === 'text' && it.s) what += ' "' + String(it.s).slice(0, 14) + '"'; if (it.t === 'fbox' && it.k) what += ' ' + it.k;
          return '<button type="button" class="pv-logit" data-ly="' + x.ly + '" data-id="' + h(it.id) + '" data-pg="' + it.pg + '"><i style="background:' + h(it.c || '#ff8a2a') + '"></i><b>' + h(it.by || '알 수 없음') + '</b><span>' + h(what) + ' · ' + it.pg + '쪽</span><small>' + h(a.ago(it.ts)) + '</small></button>';
        }).join('') : '<p class="pv-help">없음</p>';
      }
      host.addEventListener('click', function (e) {
        var a = an(); if (!a) return; var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        if (b.hasAttribute('data-only')) { var n = b.getAttribute('data-only'); a.setAuthorFilter(a.authorFilter() === n ? null : n); paint(); return; }
        if (b.classList.contains('pv-logit')) {                                                   // V848 — 누르면 그 필기가 반짝 (도구는 그대로)
          var pg = +b.getAttribute('data-pg'), id = b.getAttribute('data-id'), turn = pg && pg !== P.page();
          Array.prototype.forEach.call(recEl.querySelectorAll('.pv-logit.on'), function (x) { x.classList.remove('on'); }); b.classList.add('on');
          if (turn) P.goPage(pg);
          setTimeout(function () { try { if (a.flashItem) a.flashItem(id); } catch (x) { /* 없음 */ } }, turn ? 450 : 0); return; }
        if (b.hasAttribute('data-pg')) { P.goPage(+b.getAttribute('data-pg')); }
      });
      chk.addEventListener('change', function () { var a = an(); if (a) a.setShowAuthors(chk.checked); });
      var tmr = 0; P.on('annochange', function () { if (host.offsetParent) { clearTimeout(tmr); tmr = setTimeout(paint, 300); } });
      P.on('sheet', paint); P.on('close', function () { clearTimeout(tmr); });
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
        if (force || a !== eBpm) { eBpm.value = s.bpm || ''; if (force) bpmDirty = false; }
        if (force || a !== eForm) { eForm.value = s.form || ''; if (fb) fb.set(eForm.value); }
        if (force || a !== eLink) eLink.value = s.link || '';
        infoWhere();
      }
      var bpmDirty = false; eBpm.addEventListener('input', function () { bpmDirty = true; });                   // 직접 입력한 BPM 은 메트로놈 값으로 덮어쓰지 않음
      eForm.addEventListener('change', function () { if (fb) fb.set(eForm.value); });
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-a="saveinfo"]') : null; if (!b) return;
        var metroSaved = false; if (flushMetroCfg) metroSaved = !!flushMetroCfg();                  // 메트로놈(박자 · 강세 · 시작 전 마디 · BPM)에서 미뤄 둔 저장도 같이 바로 보냄
        var i = P.songIdx(), s = P.song(); if (!s) { eMsg.textContent = '먼저 곡을 골라주세요.'; eMsg.className = 'pv-msg2 bad'; return; }
        /* 연습하다가 메트로놈 BPM 을 (미니 · 동그라미 · 메트로놈 탭 · 떠 있는 창에서) 바꿔 둔 뒤 여기서 "저장"만 눌러도 그대로 반영 —
           BPM 칸을 직접 고치는 중이 아니면 지금 메트로놈 값을 칸에 먼저 채웁니다 */
        var mm = M, lb = mm && mm.state ? Math.round(mm.state().bpm) : 0;
        if (doc.activeElement !== eBpm && lb >= 30 && lb <= 300 && !bpmDirty) eBpm.value = lb;
        var patch = {}, bpm = String(eBpm.value || '').replace(/[^0-9]/g, '');
        if (bpm !== String(s.bpm || '')) { if (bpm && (+bpm < 30 || +bpm > 300)) { eMsg.textContent = 'BPM 은 30 ~ 300 사이로 넣어주세요.'; eMsg.className = 'pv-msg2 bad'; return; } patch.bpm = bpm; }
        if (String(eForm.value || '').trim() !== String(s.form || '')) patch.form = String(eForm.value || '').trim();
        var lk = String(eLink.value || '').trim();
        if (lk !== String(s.link || '')) { if (lk && !/^https?:\/\//i.test(lk)) { eMsg.textContent = '링크는 http 로 시작하는 주소여야 합니다.'; eMsg.className = 'pv-msg2 bad'; return; } patch.link = lk; }
        if (!Object.keys(patch).length) { eMsg.textContent = metroSaved ? '메트로놈 설정(박자 · 강세)을 저장했습니다.' : '바뀐 내용이 없습니다.'; eMsg.className = 'pv-msg2'; return; }
        b.disabled = true; eMsg.textContent = '저장 중…'; eMsg.className = 'pv-msg2';
        P.saveSongInfo(i, patch, function (ok) { b.disabled = false; eMsg.textContent = ok ? '저장했습니다.' : '저장하지 못했습니다.'; eMsg.className = 'pv-msg2' + (ok ? '' : ' bad'); if (ok) { bpmDirty = false; fillInfo(true); } });
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
        '<div class="pv-sec pv-metrosec"><div class="pv-syncnote" data-role="syncnote"></div><div class="pv-bpmwrap"><div class="pv-bpmrow"><button class="pv-btn2 sq" data-a="b-">−</button><input class="pv-bpm" type="number" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" min="30" max="300" step="1" data-role="bpm" aria-label="BPM"><button class="pv-btn2 sq" data-a="b+">＋</button><button class="pv-btn2" data-a="tap">TAP</button></div>' +
          '<div class="pv-dots" data-role="dots" role="group" aria-label="박 — 눌러서 > 강세 켜고 끄기"></div></div>' +
          '<div class="pv-row"><label class="pv-chk">박자 <select data-o="sig"><option value="4/4">4/4</option><option value="3/4">3/4</option><option value="2/4">2/4</option><option value="6/8">6/8</option><option value="12/8">12/8</option></select></label>' +
          '<label class="pv-chk">시작 전 <select data-o="count"><option value="0">바로</option><option value="1">1마디</option><option value="2">2마디</option></select></label></div>' +
          '<div class="pv-row"><button class="pv-btn2" data-a="reanchor">1박 다시 맞추기</button><button class="pv-btn2" data-a="count4">숫자로 세기</button><button class="pv-btn2" data-a="sub" aria-pressed="false">×2 쪼개기</button><button class="pv-btn2" data-a="savebpm">이 곡 BPM 저장</button></div>' +
          '<label class="pv-chk"><input type="checkbox" data-o="countall"> 딸깍 대신 숫자로 세기 <small>(One · Two · Three · Four 를 계속)</small></label>' +
          '<p class="pv-help">"×2 쪼개기" — 박 사이에 작은 딸깍을 하나 더 (4/4 면 한 마디에 8번 · 화면 깜빡임은 4번). 연주 중에 바꾼 BPM 은 저장되지 않습니다 — "이 곡 BPM 저장"(또는 송폼 창의 "저장")을 눌러야 다음에도 그 BPM 으로 열립니다.</p>' +
          '<p class="pv-help">"1박 다시 맞추기" — 밴드가 실제로 들어간 순간에 누르면, 딸깍 간격은 그대로 두고 그 박을 "1박"으로 다시 정합니다 (강세 · 음성 큐 기준이 그 박으로 옮겨갑니다).<br>"숫자로 세기" — 다음 마디를 딸깍 대신 One · Two · Three · Four 로 세어 줍니다(한 번만, 실제 박자 그대로).</p>' +
          '<p class="pv-help pv-dotshelp">원(박)을 누를 때마다 보통 → ">" 강세 → 소리 끔(✕) → 보통 — 강세 박은 더 높고 크게, 끈 박은 딸깍이 나지 않습니다. 송폼 · 메트로놈 창의 작은 동그라미도 같아요.</p>' +
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
          '<label class="pv-rng">음성 볼륨 <input type="range" min="0" max="2" step="0.05" data-o="voice"><output data-role="voiceout"></output></label>' +
          '<p class="pv-help">딸깍 볼륨은 가운데가 기본 크기이고 오른쪽 끝이 약 6배입니다 — 높일수록 소리가 단단하고 길어져 실제로 더 크게 들립니다 (찢어지지 않게 자동으로 눌러 줍니다). 음성 볼륨은 최대 2배입니다. 음높이는 반음 단위로 −12 ~ +12 입니다.</p>' +
          '<label class="pv-chk"><input type="checkbox" data-o="speak" checked> 음성 콜아웃 (TTS) 켜기 <small>(끄면 큐 이름을 소리로 말하지 않습니다 — 화면 위 도크에서도 켜고 끌 수 있어요)</small></label>' +
          '<label class="pv-chk">큐 타이밍 <select data-o="mode"><option value="lead">박자에 맞춰 미리 말하기 (추천)</option><option value="downbeat">다음 마디 첫 박에 맞춰</option><option value="now">누르는 즉시</option></select></label>' +
          '<label class="pv-chk">미리 말할 박 수 <select data-o="lead"><option value="1">1박 전</option><option value="2">2박 전</option><option value="3">3박 전</option><option value="4">4박 전</option></select></label>' +
          '<label class="pv-chk"><input type="checkbox" data-o="countdown"> 콜아웃 뒤 "Three, Two, One" 세어주기 <small>(예: Verse, Three, Two, One — 누른 뒤 바로 다음 박이 새 1박 — 콜아웃이 그 박에 나오고, 그 마디 끝 3박에서 숫자를 셉니다. 끄면 콜아웃은 박과 상관없이 누르는 즉시 나옵니다. 박자가 빠르면 빨리 말합니다)</small></label>' +
          '<label class="pv-chk pv-sub"><input type="checkbox" data-o="cdreset" checked> 누르면 바로 다음 박을 1박으로 <small>(켬: 누른 바로 다음 박이 새 1박 — 박이 그 자리에서 다시 맞춰집니다. 끔: 박은 그대로 흐르고, 다음 마디 첫 박에 콜아웃이 나온 뒤 그 마디 끝 3박에서 Three, Two, One)</small></label>' +
          '<label class="pv-chk"><input type="checkbox" data-o="cdskip"> 반복 · 다이내믹 콜아웃에는 Three, Two, One 하지 않기 <small>(Repeat · Voice only · Break … 는 바로 이어지므로)</small></label>' +
          '<label class="pv-chk">큐 언어 <select data-o="lang"><option value="en">English</option><option value="ko">한국어</option></select></label>' +
          '<label class="pv-chk">음성 <select data-o="gender"></select></label>' +
          '<div class="pv-row"><button type="button" class="pv-btn2" data-a="voicetest">▶ 들어보기 (Bridge)</button></div>' +
          '<div class="pv-help" data-role="voiceinfo"></div>' +
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
        for (var i = 0; i < num; i++) s += '<button type="button" class="pv-beat' + (marks && marks[i] === 3 ? ' mute' : marks && marks[i] ? ' acc' : '') + '" data-beat="' + i + '" aria-pressed="' + (marks && marks[i] && marks[i] !== 3 ? 'true' : 'false') + '" aria-label="' + (i + 1) + '박 — 누를 때마다 보통 → 강세 → 소리 끔" title="누를 때마다 보통 → 강세(>) → 소리 끔"></button>';
        dotsEl.style.setProperty('--n', num > 8 ? Math.ceil(num / 2) : num);
        dotsEl.className = 'pv-dots n' + num;
        dotsEl.innerHTML = s;
      }
      function paintMarks(marks) {
        var ds = dotsEl.children;
        for (var i = 0; i < ds.length; i++) { var mu = !!(marks && marks[i] === 3), on = !!(marks && marks[i]) && !mu; ds[i].classList.toggle('acc', on); ds[i].classList.toggle('mute', mu); ds[i].setAttribute('aria-pressed', on ? 'true' : 'false'); }
      }
      /** 음성 목록 — 녹음 목소리(남 · 여) 와 기기 음성. 녹음 목록은 manifest 를 불러온 뒤에 채워집니다 */
      var vsKey = '';
      function fillVoices() {
        var cv = m.clipVoices ? m.clipVoices() : [], key = cv.map(function (v) { return v.id; }).join(',') + '|' + P.lang(); if (key === vsKey) return; vsKey = key;
        var sel = q('[data-o="gender"]'), cur = sel.value || (m.state().cfg.voiceSel || 'mix'), def = m.clipDefault ? m.clipDefault() : 'am_eric';
        var rec = '<option value="mix">기본 — 남성 ' + h((cv.filter(function (v) { return v.id === def; })[0] || { label: 'Eric' }).label) + '</option>' +
          cv.filter(function (v) { return v.id !== def; }).map(function (v) { return '<option value="v:' + h(v.id) + '">' + (v.g === 'f' ? '여성' : '남성') + ' · ' + h(v.label) + '</option>'; }).join('') +
          '<option value="rot:m">남성 번갈아</option><option value="rot:mf">남녀 번갈아</option>';
        sel.innerHTML = '<optgroup label="미국 영어 녹음 (지연 없이 박에 정확히)">' + rec + '</optgroup>' +
          '<optgroup label="이 기기의 음성 (실시간 합성)"><option value="live">기기 음성 · 남성 (미국 영어)</option><option value="female">기기 음성 · 여성</option><option value="any">기기 기본 음성</option></optgroup>';
        sel.value = cur === 'male' ? 'mix' : cur; if (sel.value !== cur && cur !== 'male') sel.value = 'mix';
      }
      function sync() {
        var st = m.state(), c = st.cfg;
        fillVoices();
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
        else if (lock) note.innerHTML = I('metronome') + '<b>' + h((root.YNHon ? root.YNHon.say(rt.clicker) : rt.clicker + ' 님이')) + '</b> 클릭 컨트롤입니다 — 시작 · 멈춤 · BPM 이 자동으로 따라옵니다. (직접 쓰려면 위 "함께" 탭에서 클릭 컨트롤을 넘겨받으세요)';
        else note.textContent = '';
        q('[data-o="first"]').checked = c.first !== false; q('[data-o="click"]').value = c.click; q('[data-o="voice"]').value = c.voice; q('[data-o="mode"]').value = c.mode; q('[data-o="lead"]').value = String(c.lead);
        q('[data-o="lang"]').value = c.lang; q('[data-o="speak"]').checked = c.speak !== false; q('[data-o="sound"]').value = c.sound; q('[data-o="gender"]').value = c.voiceSel === 'male' ? 'mix' : (c.voiceSel || 'mix'); q('[data-role="voiceout"]').textContent = '×' + (Math.round(c.voice * 10) / 10);
        q('[data-o="countdown"]').checked = c.countdown === true; q('[data-o="cdskip"]').checked = c.cdSkip !== false; q('[data-o="cdreset"]').checked = c.cdReset !== false; q('[data-o="cdreset"]').disabled = !c.countdown;
        var sbB = q('[data-a="sub"]'); if (sbB) { sbB.classList.toggle('on', c.sub === 2); sbB.setAttribute('aria-pressed', c.sub === 2 ? 'true' : 'false'); }
        var caB = q('[data-o="countall"]'); if (caB) caB.checked = !!c.countAll;
        var rAn = q('[data-a="reanchor"]'), rCnt = q('[data-a="count4"]'); if (rAn) rAn.disabled = !st.running; if (rCnt) rCnt.disabled = false;
        var vi = m.voiceInfo ? m.voiceInfo(c.lang) : null;
        var recSel = /^(v:|rot:)/.test(c.voiceSel || '') || c.voiceSel === 'mix' || c.voiceSel === 'male';
        q('[data-role="voiceinfo"]').textContent = (recSel && c.lang === 'en') ? (m.clipsReady() ? '녹음된 음성이라 박에 정확히 맞고 무음 모드에서도 들립니다.' : '녹음 음성을 불러오는 중입니다… (그동안은 이 기기의 음성으로 말합니다)') : !st.speech ? '' : c.gender === 'mix' && m.voiceNames ? (m.voiceNames(c.lang).length ? '번갈아 쓰는 음성 ' + m.voiceNames(c.lang).length + '개: ' + m.voiceNames(c.lang).join(', ') : '이 기기에서 쓸 수 있는 음성을 찾는 중입니다…') : vi ? '사용 음성: ' + vi.name + (c.gender === 'male' ? (vi.male ? ' (남성)' : ' — 이 기기에서 남성 음성을 못 찾아 낮은 음높이로 대신합니다') : '') : '이 기기에서 쓸 수 있는 음성을 찾는 중입니다…';
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
        /* v8.39 — 둘 다 이 기기만의 설정(강세 표시 · 세는 소리)이라 클릭 컨트롤 잠금과 무관하게 바로 씁니다 */
        else if (a === 'reanchor') { var rr = m.markNow(); say(rr != null ? '지금 박을 1박으로 다시 맞췄습니다.' : '먼저 메트로놈을 시작하세요.', rr == null); }
        else if (a === 'count4') { var rc = m.countNow(); say(rc.ok ? '바로 다음 박부터 숫자로 세어 줍니다.' : (rc.error || ''), !rc.ok); }
        else if (a === 'sub') { m.setSub(m.state().cfg.sub === 2 ? 1 : 2); syncAllStrips(); }
        else if (a === 'savebpm') P.saveBpm();
        sync();
      });
      bpmIn.addEventListener('change', function () { var v = Math.round(+bpmIn.value); if (!(v >= 30 && v <= 300)) { say('BPM 은 30 ~ 300 사이로 입력해주세요.', true); sync(); return; } say(''); act('bpm', v); rememberBpm(); });
      /* 곡 자동 BPM — 악보 쪽을 넘겨 다음 곡이 되면 리더가 곡 정보에 넣어 둔 BPM 을 자동으로 적용합니다.
         곡 정보에 BPM 이 없거나 현장에서 바꾸고 싶으면 그대로 고치면 됩니다 (−/＋ · 탭 · 직접 입력). 고친 값은 그 곡에만 기억되어 다시 돌아와도 유지됩니다. */
      var bpmOver = {}, curSongKey = '';
      /* V848 — 연주 중에 바꾼 BPM 은 저장하지 않습니다 ("저장" 단추를 누를 때만). 다른 곡에 갔다 오면 저장된 BPM 으로 */
      function rememberBpm() { syncAllStrips(); }
      onBpmUser = rememberBpm;
      host.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-a="b-"],[data-a="b+"],[data-a="tap"]')) setTimeout(rememberBpm, 0); });
      /* 곡별 메트로놈 설정(박자 · 강세 · 시작 전 마디 · BPM)을 팀과 함께 저장 · 실시간 공유 — 저장은 P.cfgSet (나만 보기 · 권한은 거기서 처리) */
      /* 700ms 뒤로 미뤄 둔 저장은 "그 때" 곡(saveKey)을 기억했다가 그 키로 저장합니다 — 곡을 바로 넘기거나 패널을 닫아도 엉뚱한 곡에 저장되거나 사라지지 않게.
         flushMetroSave() 는 미뤄 둔 저장을 지금 바로 보냅니다 (곡 전환 · 닫기 · 송폼 탭의 "저장" 단추에서 부름). 보냈으면 true */
      var applyingCfg = false, saveT = 0, pendingCfg = false, saveKey = '';
      function flushMetroSave() {
        if (!saveT) return false;
        clearTimeout(saveT); saveT = 0;
        var key = saveKey; saveKey = ''; if (!key) return false;
        var st = m.state(), prev = P.cfgGet('metro', key) || {};
        var body = { num: st.num, den: st.den, marks: st.marks.map(function (x) { return x === 3 ? 3 : x ? (x === 2 ? 2 : 1) : 0; }), count: mUi ? Math.min(2, mUi.count()) : 0 };
        if (prev.bpm >= 30 && prev.bpm <= 300) body.bpm = prev.bpm;                // V848 — BPM 은 저장된 값 그대로 (박자 · 강세만 자동 저장)
        P.cfgSet('metro', key, body);
        return true;
      }
      /** V848 — "저장" 단추: 지금 BPM 을 이 곡에 저장 (박자 · 강세도 함께) */
      saveBpmImpl = function () {
        if (!curSongKey) { var sg = P.song(); if (sg) curSongKey = String(sg.title || ''); }
        if (!curSongKey) { P.toast('곡을 먼저 고르세요.', true); return false; }
        clearTimeout(saveT); saveT = 0; saveKey = '';
        var st = m.state(), b = Math.round(st.bpm);
        P.cfgSet('metro', curSongKey, { num: st.num, den: st.den, marks: st.marks.map(function (x) { return x === 3 ? 3 : x ? (x === 2 ? 2 : 1) : 0; }), count: mUi ? Math.min(2, mUi.count()) : 0, bpm: b });
        P.toast('BPM ' + b + ' 저장 — ' + curSongKey, false, 1300); say('BPM ' + b + ' 를 이 곡에 저장했습니다.');
        setTimeout(syncAllStrips, 0); return true;
      };
      function saveMetroSoon() {
        if (applyingCfg || !curSongKey) return;
        saveKey = curSongKey; clearTimeout(saveT);
        saveT = setTimeout(flushMetroSave, 700);
      }
      flushMetroCfg = flushMetroSave; P._saveMetroSoon = saveMetroSoon;        // V859 — 박 흐름 막대의 동그라미에서도 곡별 저장
      function applyMetroCfg(fromRemote, keepBpm) {
        var mc = curSongKey ? P.cfgGet('metro', curSongKey) : null; if (!mc) return false;
        if (ctl() === 'locked') return false;                                       // 클릭 컨트롤의 박자를 따르는 중
        if (m.state().running && fromRemote) { pendingCfg = true; say('팀 메트로놈 설정이 바뀌었습니다 — 멈추면 적용됩니다.'); return false; }
        applyingCfg = true;
        try {
          var st = m.state();
          if (mc.num && (mc.num !== st.num || mc.den !== st.den)) act('sig', mc.num, mc.den);
          if (Array.isArray(mc.marks) && mc.marks.length === m.state().num) act('marks', mc.marks);
          if (mc.count != null && mUi) { var cs = q('[data-o="count"]'); if (cs) cs.value = String(Math.min(2, mc.count)); }
          if (!keepBpm && mc.bpm >= 30 && mc.bpm <= 300 && Math.round(m.state().bpm) !== mc.bpm) act('bpm', mc.bpm);
          if (mUi) { drawDots(m.state().num, m.state().marks); mUi.sync(); }
        } finally { applyingCfg = false; }
        return mc.bpm >= 30 && mc.bpm <= 300 ? true : 'nobpm';
      }
      function applySongBpm(x, fromSync, keepBpm) {
        flushMetroSave();                                                     // 곡이 바뀌기 전에, 이전 곡에 걸려 있던 저장을 먼저 보냄
        if (!x) { curSongKey = ''; return; }
        var nk = String(x.title || '');
        if (keepBpm && nk !== curSongKey) keepBpm = false;
        curSongKey = nk;
        if (pendingCfg && !m.state().running) pendingCfg = false;
        var got = applyMetroCfg(!!fromSync, keepBpm);
        if (got === true || (got && keepBpm)) { if (!keepBpm) say('저장된 메트로놈 설정(' + Math.round(m.state().bpm) + ' BPM · ' + m.state().num + '/' + m.state().den + ')을 적용했습니다.'); syncAllStrips(); return; }
        if (keepBpm) return;
        var own = 0, base = Math.round(+x.bpm);
        var v = own || (base >= 30 && base <= 300 ? base : 0);
        if (!v) { say('이 곡에는 BPM 이 없습니다. 직접 입력하거나 탭 템포를 쓰세요.'); return; }
        if (ctl() === 'locked') { say(''); return; }                             // 클릭 컨트롤의 BPM 을 따르는 중
        if (fromSync && m.state().running) { say('곡 정보의 BPM 이 ' + v + ' 로 바뀌었습니다 — 멈추면 적용됩니다.'); pendingCfg = true; return; }
        if (Math.round(m.state().bpm) !== v) { applyingCfg = true; try { act('bpm', v); } finally { applyingCfg = false; } }
        say(own ? '이 곡에서 고친 BPM ' + v + ' 를 적용했습니다.' : '곡 정보의 BPM ' + v + ' 를 자동 적용했습니다. (바꾸려면 직접 고치세요)');
      }
      /* 팀이 바꾼 설정 · 곡 정보가 오면 (메트로놈이 멈춰 있을 때) 바로 적용 */
      P.on('cfg', function (e) { if (e && (e.kind === 'all' || (e.kind === 'metro' && e.key === curSongKey))) applySongBpm(P.song(), !!e.remote, e.kind === 'all'); });   // V848 — 다른 설정이 새로 와도 지금 BPM 은 그대로
      P.on('songedit', function (s) { if (s && String(s.title || '') === curSongKey) { bpmOver[curSongKey] = 0; applySongBpm(s, true); } });
      P.on('song', applySongBpm); P.on('close', flushMetroSave);
      try { applySongBpm(P.song()); } catch (e) {}                          // 탭을 처음 열 때 이미 정해진 곡에도 적용
      host.addEventListener('change', function (e) {
        var t = e.target, o = t.dataset && t.dataset.o; if (!o) return;
        if (o === 'sig') { var p = t.value.split('/'); var rs = act('sig', +p[0], +p[1]); if (rs && rs.locked) { sync(); return; } drawDots(+p[0], m.state().marks); saveMetroSoon(); }
        else if (o === 'count') saveMetroSoon();
        else if (o === 'flash') m.setFlash(t.checked); else if (o === 'flashall') m.setFlashAll(t.checked); else if (o === 'pitch') m.setPitch(+t.value);
        else if (o === 'click') m.setClickVolume(+t.value); else if (o === 'voice') m.setVoiceVolume(+t.value); else if (o === 'mode') m.setMode(t.value);
        else if (o === 'lead') m.setLead(+t.value); else if (o === 'lang') { m.setLang(t.value); P.setLang(t.value); labels(); } else if (o === 'sound') m.setSound(t.value); else if (o === 'gender') m.setGender(t.value); else if (o === 'first') { if (t.checked !== !!m.state().marks[0]) act('mark', 0); }
        else if (o === 'send') P.sendCueOn(t.checked); else if (o === 'recv') P.recvCue(t.checked); else if (o === 'mq') quick.setOn(t.checked); else if (o === 'speak') m.setSpeak(t.checked);
        else if (o === 'countdown') { m.setCountdown(t.checked); syncAllStrips(); }
        else if (o === 'countall') { m.setCountAll(t.checked); syncAllStrips(); }
        else if (o === 'cdskip') m.setCountdownSkip(t.checked);
        else if (o === 'cdreset') { if (m.setCountdownReset) m.setCountdownReset(t.checked); syncAllStrips(); }
        sync();
      });
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-a="voicetest"]') : null; if (!b) return;
        var r = m.cue('b', 'now'); if (r && r.ok === false) say(r.error || '소리를 낼 수 없습니다.', true);
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
    tabs.push({ id: 'harmony', icon: 'harmony', label: '화음 · 시작음', short: '화음', build: function (host) {
      var sec = doc.createElement('div'); sec.className = 'pv-sec pv-pianosec';
      sec.innerHTML = '<h4>시작음 <small>곡의 Key · 첫 음 확인</small></h4><button type="button" class="pv-btn2 primary pv-pianobtn" aria-pressed="false"></button>' +
        '<p class="pv-help">피아노가 악보 위 작은 창으로 뜹니다 — ⋮⋮ 를 끌어 옮기고, ✕ 로 닫습니다.</p>';
      host.appendChild(sec);
      var pb = sec.querySelector('.pv-pianobtn'); pianoBtns.push(pb); paintPianoBtns();
      pb.addEventListener('click', function () { pianoWin(!(piano && !piano.el.classList.contains('pv-piano-off'))); });
      var sub = doc.createElement('div'); sub.className = 'pv-hmhost'; host.appendChild(sub);
      if (!need('화음 · 코드 변환', root.YNHarmonyUI && root.YNHarmony && root.YNOmr, sub)) return;
      var ui = root.YNHarmonyUI.mount(sub, P); if (!ui) return;
      return { onShow: function () { ui.onShow(); }, destroy: function () { try { ui.destroy(); } catch (e) {} }, chordTap: function (x, y, t) { return ui.chordTap ? ui.chordTap(x, y, t) : false; } };   // V849 — 악보의 코드 톡 → 피아노
    } });

    /* ------------------------------------------------------------ 메인스테이지 컨트롤 (MIDI 로 MainStage 페이더 · 패치 전환)
       MainStage 는 MIDI 로만 외부 조작을 받으므로, 같은 맥의 Chrome 이 Web MIDI API 로 가상 MIDI 포트(IAC 드라이버)에
       신호를 보내고 MainStage 가 MIDI Learn 으로 외워둔 자기 컨트롤을 움직이는 구조입니다 (mainstage.js). 서버에는
       아무것도 보내지 않고, 켜짐 여부 · 출력 · 페이더/패치 목록은 이 브라우저에만 저장됩니다(팀 공유 없음). */
    tabs.push({ id: 'mainstage', icon: 'sliders', label: '메인스테이지', short: '메인', build: function (host) {
      if (!need('메인스테이지 컨트롤', root.YNMainStage, host)) return;
      var ms = root.YNMainStage.create(), cfg = ms.cfg, unsub;
      function chanOptions() {
        var s = ''; for (var i = 1; i <= 16; i++) s += '<option value="' + i + '"' + (cfg.channel === i ? ' selected' : '') + '>' + i + '</option>';
        return s;
      }
      function rowsFaders() {
        return cfg.faders.map(function (f) {
          return '<div class="pv-msrow" data-fader="' + h(f.id) + '">' +
            '<input type="text" class="pv-msname" data-f="name" value="' + h(f.name) + '" maxlength="24" placeholder="이름 (예: 드럼)">' +
            '<label class="pv-mscc">CC <input type="number" inputmode="numeric" pattern="[0-9]*" data-f="cc" min="0" max="127" value="' + f.cc + '"></label>' +
            '<input type="range" class="pv-msrange" data-f="val" min="0" max="127" step="1" value="' + f.value + '" aria-label="' + h(f.name) + ' 페이더">' +
            '<output class="pv-msout2">' + f.value + '</output>' +
            '<button type="button" class="pv-btn2 sq" data-a="delfader" data-id="' + h(f.id) + '" aria-label="페이더 삭제">✕</button></div>';
        }).join('') || '<p class="pv-help">아직 없습니다 — "+ 페이더 추가"로 만드세요.</p>';
      }
      function rowsPatches() {
        return cfg.patches.map(function (p) {
          return '<div class="pv-msrow" data-patch="' + h(p.id) + '">' +
            '<input type="text" class="pv-msname" data-p="name" value="' + h(p.name) + '" maxlength="24" placeholder="이름 (예: 킥 드럼)">' +
            '<label class="pv-mscc">PC <input type="number" inputmode="numeric" pattern="[0-9]*" data-p="pc" min="0" max="127" value="' + p.pc + '"></label>' +
            '<button type="button" class="pv-btn2 primary" data-a="firepatch" data-id="' + h(p.id) + '">보내기</button>' +
            '<button type="button" class="pv-btn2 sq" data-a="delpatch" data-id="' + h(p.id) + '" aria-label="삭제">✕</button></div>';
        }).join('') || '<p class="pv-help">아직 없습니다 — "+ 버튼 추가"로 만드세요.</p>';
      }
      function statusLine() {
        if (!ms.supported()) return 'Chrome 에서 이 페이지를 열면 아래 스위치를 켤 수 있습니다.';
        if (!cfg.on) return '';
        var outs = ms.outputs();
        if (!outs.length) return '아직 MIDI 출력을 찾지 못했습니다 — 오디오 MIDI 설정에서 IAC 드라이버가 켜져 있는지 확인하세요.';
        var cur = find2(outs, cfg.outputId);
        return cur ? ('연결됨 — ' + cur.name) : '연결하는 중…';
      }
      function find2(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
      function paintOutputs() {
        var sel = host.querySelector('[data-role="out"]'); if (!sel) return;
        var outs = ms.outputs();
        sel.innerHTML = '<option value="">자동 선택</option>' + outs.map(function (o) { return '<option value="' + h(o.id) + '"' + (o.id === cfg.outputId ? ' selected' : '') + '>' + h(o.name || o.id) + '</option>'; }).join('');
        var stat = host.querySelector('[data-role="stat"]'); if (stat) stat.textContent = statusLine();
      }
      function render() {
        host.innerHTML =
          '<div class="pv-sec"><h4>🎛 메인스테이지 컨트롤</h4>' +
            '<p class="pv-help">같은 맥의 <b>Chrome</b>에서 열었을 때만 동작합니다(Safari 는 지원하지 않습니다). 먼저 "오디오 MIDI 설정"에서 IAC 드라이버를 켜고, MainStage 에서 페이더 · 패치를 MIDI Learn(⌘L)으로 연결해 두세요 — 이 화면의 슬라이더를 움직이거나 "보내기"를 누르면 그대로 Learn 됩니다.</p>' +
            (ms.supported() ? '' : '<p class="pv-help bad">이 브라우저는 MIDI 전송을 지원하지 않습니다.</p>') +
            '<label class="pv-switch"><input type="checkbox" data-a="on"' + (cfg.on ? ' checked' : '') + (ms.supported() ? '' : ' disabled') + '><span></span><b>메인스테이지 컨트롤 켜기</b></label>' +
            '<div data-role="body" style="display:' + (cfg.on ? '' : 'none') + '">' +
              '<div class="pv-row">' +
                '<label class="pv-fl2" style="flex:2 1 160px"><span>MIDI 출력</span><select data-role="out"><option value="">자동 선택</option></select></label>' +
                '<label class="pv-fl2" style="flex:1 1 80px"><span>채널</span><select data-role="chan">' + chanOptions() + '</select></label>' +
              '</div>' +
              '<p class="pv-help" data-role="stat"></p>' +
            '</div></div>' +
          '<div class="pv-sec" data-role="fadersSec" style="display:' + (cfg.on ? '' : 'none') + '"><h4>페이더</h4><div data-role="faders">' + rowsFaders() + '</div>' +
            '<div class="pv-row"><button type="button" class="pv-btn2" data-a="addfader">+ 페이더 추가</button></div></div>' +
          '<div class="pv-sec" data-role="patchesSec" style="display:' + (cfg.on ? '' : 'none') + '"><h4>악기 전환</h4><div data-role="patches">' + rowsPatches() + '</div>' +
            '<div class="pv-row"><button type="button" class="pv-btn2" data-a="addpatch">+ 버튼 추가</button></div></div>';
        paintOutputs();
      }
      render();
      if (cfg.on) ms.setOn(true);                                    // 이미 켜져 있었으면 탭을 열 때 다시 연결 시도
      unsub = ms.on(function (kind, d) {
        if (kind === 'devices' || kind === 'output') paintOutputs();
        else if (kind === 'error') P.toast(d, true);
      });
      host.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-a]') : null; if (!b) return;
        var a = b.dataset.a, id = b.dataset.id;
        if (a === 'addfader') { ms.addFader(); render(); }
        else if (a === 'delfader') { ms.removeFader(id); render(); }
        else if (a === 'addpatch') { ms.addPatch(); render(); }
        else if (a === 'delpatch') { ms.removePatch(id); render(); }
        else if (a === 'firepatch') { ms.firePatch(id); b.classList.add('flash'); setTimeout(function () { b.classList.remove('flash'); }, 350); }
      });
      host.addEventListener('change', function (e) {
        var t = e.target, role = t.dataset && t.dataset.role;
        if (t.dataset.a === 'on') { ms.setOn(t.checked); render(); return; }
        if (role === 'out') { ms.selectOutput(t.value); paintOutputs(); return; }
        if (role === 'chan') { ms.setChannel(+t.value); return; }
        var frow = t.closest ? t.closest('[data-fader]') : null;
        if (frow) { var fid = frow.dataset.fader; if (t.dataset.f === 'name') ms.renameFader(fid, t.value); else if (t.dataset.f === 'cc') ms.setFaderCc(fid, +t.value); return; }
        var prow = t.closest ? t.closest('[data-patch]') : null;
        if (prow) { var pid = prow.dataset.patch; if (t.dataset.p === 'name') ms.renamePatch(pid, t.value); else if (t.dataset.p === 'pc') ms.setPatchPc(pid, +t.value); }
      });
      host.addEventListener('input', function (e) {
        var t = e.target; if (t.dataset.f !== 'val') return;
        var row = t.closest ? t.closest('[data-fader]') : null; if (!row) return;
        ms.setFaderValue(row.dataset.fader, +t.value);
        var out = row.querySelector('.pv-msout2'); if (out) out.textContent = t.value;
      });
      return { destroy: function () { if (unsub) unsub(); } };
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
    /* V848 — "기록" 탭은 맨 뒤 ("함께" 다음) */
    (function () { var i = -1; tabs.forEach(function (t, k) { if (t.id === 'log') i = k; }); if (i >= 0) tabs.push(tabs.splice(i, 1)[0]); })();
    return tabs;
  }

  root.YNPanels = { build: build };
}(typeof self !== 'undefined' ? self : this));
