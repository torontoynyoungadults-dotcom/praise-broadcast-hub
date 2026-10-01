/**
 * 유튜브 참고 영상 — 공식 YouTube IFrame Player API
 * ------------------------------------------------------------
 *  · 재생 속도 0.75 / 1 / 1.25 배 (YouTube 가 지원하는 단계 — 음높이는 YouTube 가 그대로 유지), A-B 구간 반복 (어려운 부분만 반복해서 듣기)
 *    (예전부터 있던 0.5 배는 요청 범위 밖의 보조 버튼으로 흐리게 남겨 둡니다)
 *  · 키(−3 ~ +3 반음) 줄 (Feature 2): 연습 화면의 "연습 키 이동"(P.keyShift) 을 바꿉니다 → 악보 코드가 따라 바뀜.
 *    ※ 유튜브의 소리 자체는 다른 사이트 iframe 이라 브라우저에서 키를 바꿀 수 없습니다 — 카드 안에 그 사실을 적어 두고,
 *       소리도 바꿔 듣고 싶으면 [키 바꿔 연습] 버튼으로 녹음 · 내 오디오 파일용 재생 카드(audio-shift.js)를 엽니다.
 *  · API 스크립트(https://www.youtube.com/iframe_api)를 처음 열 때 한 번만 불러옵니다.
 *    불러오지 못하는 환경(오프라인 · 차단)에서는 속도/반복 없이 일반 임베드로 대신 재생하고 그 사실을 알려 줍니다.
 *  · 순수 함수(fmtTime · loopStep · normLoop · RATES)는 Node 시험에서도 씁니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNYt = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RATES = [0.5, 0.75, 1, 1.25];
  var TEMPO_RATES = [0.75, 1, 1.25];         // 요청 범위(0.75 ~ 1.25) — 화면에서 주된 속도 버튼
  var KEY_STEPS = [-3, -2, -1, 0, 1, 2, 3];   // 키(반음)
  var MIN_LOOP = 0.5;                       // A-B 구간은 최소 0.5초
  var API_URL = 'https://www.youtube.com/iframe_api';

  function fmtTime(sec) {
    sec = Math.max(0, +sec || 0); var m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  /** A-B 구간 확인 — 바르면 {a,b} (b 는 없을 수 있음), 안 되면 null. b 가 a 보다 MIN_LOOP 이상 커야 함 */
  function normLoop(a, b) {
    if (a == null || !isFinite(a) || a < 0) return null;
    if (b == null) return { a: a, b: null };
    if (!isFinite(b) || b - a < MIN_LOOP) return null;
    return { a: a, b: b };
  }
  /** 지금 재생 위치가 B 에 닿았으면 되돌아갈 위치(A), 아니면 null. 영상이 A 보다 앞이면(사용자가 직접 앞으로 감음) 건드리지 않음 */
  function loopStep(t, a, b, lead) {
    if (a == null || b == null || t == null) return null;
    lead = lead == null ? 0.12 : lead;
    if (t >= b - lead && t < b + 3) return a;                         // B 를 방금 지남 → A 로
    return null;
  }

  var apiP = null;
  /** API 를 불러와 YT 객체를 돌려줍니다 (이미 있으면 바로). 실패하면 거절 */
  function loadApi(timeoutMs) {
    if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiP) return apiP;
    apiP = new Promise(function (res, rej) {
      var done = false, prev = window.onYouTubeIframeAPIReady;
      var t = setTimeout(function () { if (!done) { done = true; apiP = null; rej(new Error('timeout')); } }, timeoutMs || 9000);
      window.onYouTubeIframeAPIReady = function () { try { if (typeof prev === 'function') prev(); } catch (e) {} if (!done) { done = true; clearTimeout(t); res(window.YT); } };
      var s = document.createElement('script'); s.src = API_URL; s.async = true;
      s.onerror = function () { if (!done) { done = true; clearTimeout(t); apiP = null; rej(new Error('load')); } };
      document.head.appendChild(s);
    });
    return apiP;
  }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  var CSS = '.pv-yt{max-height:calc(100% - 92px);overflow-y:auto;overscroll-behavior:contain}.yt-kstat:empty{display:none}.yt-b.xr{opacity:.55;font-weight:700}.yt-b.xr.on{opacity:1}.yt-note{margin:0;font-size:11.5px;line-height:1.5;color:var(--g-dim,#a9a39a)}' +
    '.yt-keys{display:flex;gap:4px;flex:1 1 220px}.yt-keys .yt-b{flex:1 1 0;min-width:0;padding:7px 0;text-align:center}' +
    '.yt-kn{flex:1 1 100%;font-size:13px;font-weight:800;color:#ffb066}.yt-kstat{font-size:12px;color:#ffb066;min-height:1.2em}.yt-kstat.bad{color:#ffb9b9}' +
    '.yt-stage{position:relative}.yt-zone{position:absolute;top:14%;bottom:22%;width:32%;z-index:2;display:flex;align-items:center;justify-content:center;touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}.yt-zl{left:0}.yt-zr{right:0}' +
    '.yt-zone i{font-style:normal;opacity:0;padding:7px 12px;border-radius:99px;background:rgba(0,0,0,.66);color:#fff;font-size:14px;font-weight:800;pointer-events:none}.yt-zone.flash{background:rgba(255,255,255,.14)}.yt-zone.flash i{animation:ytflash .7s ease-out}@keyframes ytflash{0%{opacity:1;transform:scale(1.08)}70%{opacity:1}100%{opacity:0;transform:scale(1)}}.yt-skiphint{flex:1 1 100%;margin:0}' +
    '.yt-warn{margin:0;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,176,102,.45);background:rgba(255,138,42,.10);font-size:12px;line-height:1.5;color:var(--g-ink,#f8f5f0)}.yt-warn b{color:#ffb066}';
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('yn-yt-css')) return;
    var s = document.createElement('style'); s.id = 'yn-yt-css'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
  }

  /**
   * open(host, { id, title, onClose, ytApi? })  → { destroy, setRate, markA, markB, clearLoop, state }
   * host 안에 플레이어 + 컨트롤을 그립니다.
   */
  function open(host, opt) {
    opt = opt || {};
    var id = opt.id, st = { rate: 1, a: null, b: null, player: null, ready: false, dead: false, timer: null, rates: RATES.slice(), fallback: false }, kb = opt.key || null, kOffs = [];
    injectCss();
    host.innerHTML = '';
    var stage = el('div', 'yt-stage'), holder = el('div', 'yt-holder'); stage.appendChild(holder);
    var ctl = el('div', 'yt-ctl');
    ctl.innerHTML =
      '<div class="yt-row yt-skip" role="group" aria-label="15초 이동"><span class="yt-lb">이동</span><button type="button" class="yt-b" data-skip="-15" aria-label="15초 뒤로">⟲ 15초</button><button type="button" class="yt-b" data-skip="15" aria-label="15초 앞으로">15초 ⟳</button><span class="yt-note yt-skiphint">영상 왼쪽 · 오른쪽을 두 번 누르거나 더블클릭해도 됩니다</span></div>' +
      '<div class="yt-row yt-rates" role="group" aria-label="재생 속도 (템포)"><span class="yt-lb">속도</span>' + RATES.map(function (r) { var ext = TEMPO_RATES.indexOf(r) < 0; return '<button type="button" class="yt-b' + (ext ? ' xr' : '') + '" data-rate="' + r + '" aria-pressed="' + (r === 1) + '"' + (ext ? ' title="0.5배는 요청 범위(0.75~1.25배) 밖의 보조 속도입니다"' : '') + '>' + r + 'x</button>'; }).join('') + '</div>' +
      '<p class="yt-note yt-ratenote">속도는 YouTube 가 지원하는 0.75 · 1 · 1.25배만 고를 수 있고, 음높이는 YouTube 가 그대로 유지합니다.</p>' +
      (kb ?
        '<div class="yt-row yt-key" role="group" aria-label="키 (반음)"><span class="yt-lb">키</span><div class="yt-keys">' + KEY_STEPS.map(function (n) { return '<button type="button" class="yt-b" data-key="' + n + '" aria-pressed="false" aria-label="키 ' + (n > 0 ? '+' + n : n) + ' 반음">' + (n === 0 ? '0' : n > 0 ? '+' + n : n) + '</button>'; }).join('') + '</div><span class="yt-kn" aria-live="polite"></span></div>' +
        '<div class="yt-kstat" role="status" aria-live="polite"></div>' +
        '<p class="yt-warn" role="note">ⓘ <b>유튜브 영상의 소리는 브라우저에서 키를 바꿀 수 없습니다</b> (유튜브 화면은 다른 사이트라 앱이 소리를 가공할 수 없습니다). 여기서 고른 키는 <b>악보의 코드 표시</b>에 반영됩니다. 소리도 같은 키로 바꿔 연습하려면 아래 버튼으로 팀 녹음 · 내 오디오 파일을 여세요.</p>' +
        '<div class="yt-row yt-kbtns">' + (kb.openShifter ? '<button type="button" class="yt-b on" data-k="shifter">' + YI('headphones') + ' 키 바꿔 연습 (녹음 · 내 오디오 파일)</button>' : '') + (kb.startNote ? '<button type="button" class="yt-b" data-k="startnote">' + YI('piano_small') + ' 목표 키 시작음</button>' : '') + '</div>'
        : '') +
      '<div class="yt-row yt-ab" role="group" aria-label="구간 반복"><span class="yt-lb">구간 반복</span>' +
        '<button type="button" class="yt-b" data-a="a">A 지정</button><button type="button" class="yt-b" data-a="b">B 지정</button><button type="button" class="yt-b ghost" data-a="clear">해제</button>' +
        '<span class="yt-abinfo" aria-live="polite">A–B 를 정하면 그 구간만 계속 반복합니다</span></div>' +
      '<div class="yt-msg" role="status"></div>';
    var zl = el('div', 'yt-zone yt-zl', '<i></i>'), zr = el('div', 'yt-zone yt-zr', '<i></i>'); zl.setAttribute('aria-hidden', 'true'); zr.setAttribute('aria-hidden', 'true'); stage.appendChild(zl); stage.appendChild(zr);
    host.appendChild(stage); host.appendChild(ctl);
    var msg = ctl.querySelector('.yt-msg'), abinfo = ctl.querySelector('.yt-abinfo'), knEl = ctl.querySelector('.yt-kn'), kstat = ctl.querySelector('.yt-kstat');
    function say(t, bad) { msg.textContent = t || ''; msg.className = 'yt-msg' + (bad ? ' bad' : ''); }
    /* 키 줄 (opt.key 가 있을 때만) — 값은 연습 화면의 "연습 키 이동" 하나를 함께 씁니다 */
    function keyNow() { var n = 0; try { n = Math.round(+kb.get()) || 0; } catch (e) { /* 무시 */ } return Math.max(-3, Math.min(3, n)); }
    function paintKey() {
      if (!kb) return; var n = keyNow(), label = '';
      try { label = kb.label ? kb.label(n) : (n > 0 ? '+' + n : String(n)) + ' 반음'; } catch (e) { label = String(n); }
      [].forEach.call(ctl.querySelectorAll('[data-key]'), function (b) { var on = +b.getAttribute('data-key') === n; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      if (knEl) knEl.textContent = label;
      var sb = ctl.querySelector('[data-k="startnote"]'); if (sb) sb.disabled = !(kb.name && kb.name());
    }
    function setKeyStatus(t, bad) { if (!kstat) return; kstat.textContent = t ? '악보: ' + t : ''; kstat.className = 'yt-kstat' + (bad ? ' bad' : ''); }
    if (kb) {
      paintKey();
      if (kb.on) kOffs.push(kb.on(paintKey));
      if (kb.onStatus) { kOffs.push(kb.onStatus(setKeyStatus)); var s0 = kb.status && kb.status(); if (s0 && s0.text) setKeyStatus(s0.text, s0.bad); }
    }
    function paintRates() {
      [].forEach.call(ctl.querySelectorAll('[data-rate]'), function (b) {
        var r = +b.getAttribute('data-rate'), on = Math.abs(r - st.rate) < 1e-6;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.disabled = st.fallback || !st.ready || st.rates.indexOf(r) < 0;
      });
      [].forEach.call(ctl.querySelectorAll('[data-a]'), function (b) { b.disabled = st.fallback || !st.ready; });
      [].forEach.call(ctl.querySelectorAll('[data-skip]'), function (b) { b.disabled = st.fallback || !st.ready; });
      zl.style.display = zr.style.display = st.fallback ? 'none' : '';
    }
    function paintAB() {
      var t = st.a == null ? 'A–B 를 정하면 그 구간만 계속 반복합니다' : st.b == null ? 'A ' + fmtTime(st.a) + ' — 이제 B 를 지정하세요' : '반복 · ' + fmtTime(st.a) + ' → ' + fmtTime(st.b) + ' 반복 중';
      abinfo.textContent = t; ctl.classList.toggle('looping', st.a != null && st.b != null);
      ctl.querySelector('[data-a="a"]').classList.toggle('on', st.a != null); ctl.querySelector('[data-a="b"]').classList.toggle('on', st.b != null);
    }
    function now() { try { return +st.player.getCurrentTime(); } catch (e) { return null; } }
    function tick() {
      if (st.dead || !st.player || st.a == null || st.b == null) return;
      var back = loopStep(now(), st.a, st.b);
      if (back != null) { try { st.player.seekTo(back, true); } catch (e) {} }
    }
    function startTimer() { if (!st.timer) st.timer = setInterval(tick, 100); }
    function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = null; } }

    function setRate(r) {
      r = +r; if (!st.player || !st.ready || st.rates.indexOf(r) < 0) return false;
      try { st.player.setPlaybackRate(r); st.rate = r; paintRates(); say(r === 1 ? '' : '재생 속도 ' + r + '배'); return true; } catch (e) { say('속도를 바꾸지 못했습니다', true); return false; }
    }
    function markA() { var t = now(); if (t == null) return; st.a = t; if (st.b != null && !normLoop(st.a, st.b)) st.b = null; paintAB(); if (st.b == null) say('A 지점 ' + fmtTime(t) + ' — 반복이 끝날 곳에서 B 를 누르세요'); }
    function markB() {
      var t = now(); if (t == null) return;
      if (st.a == null) { say('먼저 A(반복 시작 위치)를 지정하세요', true); return; }
      var n = normLoop(st.a, t); if (!n) { say('B 는 A 보다 ' + MIN_LOOP + '초 이상 뒤여야 합니다', true); return; }
      st.b = n.b; paintAB(); startTimer(); say(''); try { st.player.seekTo(st.a, true); st.player.playVideo(); } catch (e) {}
    }
    function clearLoop() { st.a = st.b = null; paintAB(); say(''); }
    /* ±15초 이동 — 버튼 · 영상 왼쪽/오른쪽 더블탭(더블클릭). A–B 반복 중이면 반복 구간 밖으로 나가도 반복 감시가 다시 A 로 되돌립니다. */
    function skip(d) {
      if (!st.player || !st.ready || st.fallback) return false;
      var t = now(); if (t == null || isNaN(t)) return false;
      var dur = 0; try { dur = +st.player.getDuration() || 0; } catch (e) { /* 무시 */ }
      var to = Math.max(0, t + d); if (dur > 0) to = Math.min(to, Math.max(0, dur - 0.5));
      try { st.player.seekTo(to, true); } catch (e) { return false; }
      return to;
    }
    function flash(z, d) { var i = z.firstChild; if (!i) return; i.textContent = (d < 0 ? '⟲ ' : '') + Math.abs(d) + '초' + (d > 0 ? ' ⟳' : ''); z.classList.remove('flash'); void z.offsetWidth; z.classList.add('flash'); }
    function togglePlay() { try { var S = st.player.getPlayerState(); if (S === 1) st.player.pauseVideo(); else st.player.playVideo(); } catch (e) { /* 무시 */ } }
    /* 한 번 누르면 재생/멈춤 (영역이 유튜브 화면을 덮으므로 대신 처리), 빠르게 두 번 누르면 15초 이동. 연속으로 누르면 계속 15초씩 */
    function zone(z, d) {
      var last = 0, tm = null, chain = false;
      function hit() {
        var n = Date.now();
        if (n - last < 320) { clearTimeout(tm); tm = null; chain = true; var r = skip(d); if (r !== false) flash(z, d); last = n; return; }
        last = n; chain = false; clearTimeout(tm); tm = setTimeout(function () { tm = null; if (!chain) togglePlay(); }, 330);
      }
      z.addEventListener('pointerup', function (e) { if (e.pointerType === 'mouse' && e.button !== 0) return; e.preventDefault(); hit(); });
      z.addEventListener('dblclick', function (e) { e.preventDefault(); });
      z.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }
    zone(zl, -15); zone(zr, 15);
    ctl.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.disabled) return;
      if (b.hasAttribute('data-skip')) { var sd = +b.getAttribute('data-skip'), r0 = skip(sd); if (r0 === false) say('영상이 준비된 뒤에 이동할 수 있습니다', true); else { say(sd < 0 ? '15초 뒤로' : '15초 앞으로'); flash(sd < 0 ? zl : zr, sd); } }
      else if (b.hasAttribute('data-rate')) setRate(b.getAttribute('data-rate'));
      else if (b.hasAttribute('data-key')) { if (kb) { try { kb.set(+b.getAttribute('data-key')); } catch (e) { /* 무시 */ } paintKey(); } }
      else if (b.getAttribute('data-k') === 'shifter') { if (kb && kb.openShifter) kb.openShifter(); }
      else if (b.getAttribute('data-k') === 'startnote') { var r = kb && kb.startNote ? kb.startNote(keyNow()) : null; if (r) say('목표 키 시작음 ' + (r.key || '') + ' 을 들려 드립니다.'); else say('시작음을 낼 수 없습니다 (곡의 Key 를 읽지 못했거나 소리를 켤 수 없습니다).', true); }
      else { var a = b.getAttribute('data-a'); if (a === 'a') markA(); else if (a === 'b') markB(); else if (a === 'clear') clearLoop(); }
    });

    function fallbackFrame(why) {
      st.fallback = true; holder.innerHTML = '';
      var f = document.createElement('iframe'); f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?rel=0&playsinline=1&autoplay=1'; f.title = '유튜브 참고 영상';
      f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture'); f.setAttribute('allowfullscreen', ''); f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin'); holder.appendChild(f);
      paintRates(); say(why || '속도 · 구간 반복 기능을 불러오지 못해 기본 플레이어로 재생합니다 (인터넷 연결을 확인하세요).', true);
    }

    paintRates(); paintAB(); say('플레이어를 불러오는 중…');
    var api = opt.ytApi ? Promise.resolve(opt.ytApi) : loadApi();
    api.then(function (YT) {
      if (st.dead) return;
      var box = document.createElement('div'); holder.appendChild(box);
      st.player = new YT.Player(box, {
        videoId: id, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
        playerVars: { rel: 0, playsinline: 1, autoplay: 1, modestbranding: 1, origin: typeof location !== 'undefined' ? location.origin : undefined },
        events: {
          onReady: function () {
            if (st.dead) return; st.ready = true;
            try { var av = st.player.getAvailablePlaybackRates && st.player.getAvailablePlaybackRates(); if (av && av.length) st.rates = RATES.filter(function (r) { return av.indexOf(r) >= 0; }); } catch (e) {}
            paintRates(); say('');
          },
          onStateChange: function (ev) {
            var S = ev && ev.data;
            if (S === 1) { if (st.a != null && st.b != null) startTimer(); }              // 재생 시작 → 반복 감시
            else if (S === 0 && st.a != null && st.b != null) { try { st.player.seekTo(st.a, true); st.player.playVideo(); } catch (e) {} }   // 영상 끝에 닿아도 A 로
          },
          onError: function (ev) { var c = ev && ev.data; say(c === 101 || c === 150 ? '이 영상은 앱 안에서 재생할 수 없게 설정되어 있습니다. ↗ 를 눌러 유튜브에서 여세요.' : c === 100 ? '영상을 찾을 수 없습니다 (삭제되었거나 비공개).' : '영상을 재생하지 못했습니다.', true); },
          onPlaybackRateChange: function (ev) { if (ev && ev.data) { st.rate = +ev.data; paintRates(); } }
        }
      });
    }, function () { if (!st.dead) fallbackFrame(); });

    return {
      setRate: setRate, markA: markA, markB: markB, clearLoop: clearLoop, skip: skip,
      state: function () { return { rate: st.rate, a: st.a, b: st.b, ready: st.ready, fallback: st.fallback, key: kb ? keyNow() : null }; },
      setKeyStatus: setKeyStatus, repaintKey: paintKey,
      destroy: function () { st.dead = true; stopTimer(); kOffs.forEach(function (f) { try { f && f(); } catch (e) { /* 무시 */ } }); kOffs = []; try { st.player && st.player.destroy && st.player.destroy(); } catch (e) {} host.innerHTML = ''; }
    };
  }

  return { RATES: RATES, TEMPO_RATES: TEMPO_RATES, KEY_STEPS: KEY_STEPS, MIN_LOOP: MIN_LOOP, fmtTime: fmtTime, normLoop: normLoop, loopStep: loopStep, loadApi: loadApi, open: open };
}));
