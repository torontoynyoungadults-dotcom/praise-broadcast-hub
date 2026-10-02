/**
 * 예배콘티 "녹음" 카드 — 자체 재생 플레이어 + 올릴 때 제목 자동 입력.
 *  · [data-rp] 플레이어: 재생/멈춤 · 이전/다음 · ±10초 · 빠르기(0.5~2배, 음높이 유지) · A-B 구간 반복 · 한 곡 반복 · 이어서 재생 · 소리
 *    목록은 같은 카드 안의 [data-rp-src] 들 (DOM 순서). 빠르기 · 소리 · 이어서 재생은 이 기기에 기억합니다.
 *  · [data-rec-form] 올리기 폼: 파일을 고르면 파일 이름(확장자 뺌)을, 유튜브 링크를 붙이면 영상 제목을 제목 칸에 자동으로 넣음
 *    (직접 고친 제목은 덮어쓰지 않음)
 * SPA 조각 교체(ph:content-updated) 뒤에도 새로 들어온 칸에 붙습니다.
 */
(function () {
  var KEY = 'ph_rp_v1';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 저장 못 해도 재생엔 영향 없음 */ } }
  function fmt(t) { if (!isFinite(t) || t < 0) t = 0; t = Math.floor(t); var m = Math.floor(t / 60), s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function clampRate(r) { return Math.max(0.5, Math.min(2, Math.round(r * 100) / 100)); }

  function mount(root) {
    if (root.getAttribute('data-rp-on')) return;
    root.setAttribute('data-rp-on', '1');
    var card = root.parentNode;
    var au = root.querySelector('audio');
    var $ = function (s) { return root.querySelector(s); };
    var bar = $('.rp-bar'), cur = $('.rp-cur'), dur = $('.rp-dur'), go = $('.rp-go'), rateEl = $('.rp-rate'), msg = $('.rp-msg'),
        ttl = $('.rp-title'), by = $('.rp-by'), abEl = $('.rp-ab'), vol = $('.rp-vol'), auto = $('.rp-auto'), loop = $('.rp-loop');
    var st = load(), idx = -1, A = null, B = null, seeking = false;
    var rate = clampRate(st.rate || 1);
    try { au.preservesPitch = true; au.mozPreservesPitch = true; au.webkitPreservesPitch = true; } catch (e) { /* 일부 브라우저는 기본이 음높이 유지 */ }
    vol.value = st.vol == null ? 100 : st.vol; auto.checked = st.auto !== false; loop.checked = !!st.loop;
    au.volume = vol.value / 100;

    function items() { return Array.prototype.slice.call(card.querySelectorAll('[data-rp-src]')); }
    function say(t, bad) { msg.textContent = t || ''; msg.classList.toggle('bad', !!bad); }
    function applyRate() { au.playbackRate = rate; rateEl.textContent = rate.toFixed(2) + '×'; root.querySelectorAll('[data-rp-rate]').forEach(function (b) { b.classList.toggle('on', Math.abs(Number(b.getAttribute('data-rp-rate')) - rate) < 0.001); }); }
    function setRate(r) { rate = clampRate(r); applyRate(); st.rate = rate; save(st); }
    function paintBar() {
      var d = au.duration, p = d > 0 ? au.currentTime / d : 0;
      if (!seeking) bar.value = Math.round(p * 1000);
      var a = A != null && d > 0 ? A / d * 100 : null, b = B != null && d > 0 ? B / d * 100 : null;
      var base = 'var(--accent)', off = 'rgba(255,255,255,.18)', pc = (p * 100).toFixed(2);
      bar.style.background = (a != null && b != null && b > a)
        ? 'linear-gradient(90deg,' + base + ' ' + pc + '%,' + off + ' ' + pc + '%), linear-gradient(90deg,transparent ' + a + '%,rgba(255,138,61,.55) ' + a + '%,rgba(255,138,61,.55) ' + b + '%,transparent ' + b + '%)'
        : 'linear-gradient(90deg,' + base + ' ' + pc + '%,' + off + ' ' + pc + '%)';
      cur.textContent = fmt(au.currentTime); dur.textContent = fmt(d);
    }
    function paintAB() { abEl.textContent = A == null && B == null ? '' : (A != null ? fmt(A) : '–') + ' ~ ' + (B != null ? fmt(B) : '–'); paintBar(); }
    function mark() {
      items().forEach(function (el, i) { var on = i === idx; el.classList.toggle('rp-on', on); });
      if ('mediaSession' in navigator && idx >= 0) { try { var it = items()[idx]; navigator.mediaSession.metadata = new MediaMetadata({ title: it.getAttribute('data-rp-title') || '녹음', artist: it.getAttribute('data-rp-by') || '' }); } catch (e) { /* 지원 안 하면 건너뜀 */ } }
    }
    function select(i, play) {
      var list = items(); if (!list.length) return;
      if (i < 0) i = 0; if (i >= list.length) i = list.length - 1;
      var it = list[i]; idx = i; A = B = null; paintAB(); say('');
      ttl.textContent = it.getAttribute('data-rp-title') || '녹음'; by.textContent = it.getAttribute('data-rp-by') || '';
      au.src = it.getAttribute('data-rp-src'); applyRate(); au.load(); mark();
      if (play) au.play().catch(function (e) { if (e && e.name !== 'AbortError' && e.name !== 'NotSupportedError') say('재생을 시작하지 못했어요. ▶ 를 한 번 더 눌러 주세요.', true); });
    }
    function toggle() {
      if (idx < 0) { select(0, true); return; }
      if (au.paused) au.play().catch(function (e) { if (e && e.name !== 'AbortError' && e.name !== 'NotSupportedError') say('재생하지 못했어요.', true); }); else au.pause();
    }
    function seekBy(d) { if (idx < 0) return; var t = au.currentTime + d, end = au.duration || 0; au.currentTime = Math.max(0, end ? Math.min(end, t) : t); }
    function next(dir) { var n = items().length; if (!n) return; select(idx < 0 ? 0 : (idx + dir + n) % n, true); }

    var actions = {
      toggle: toggle, back: function () { seekBy(-10); }, fwd: function () { seekBy(10); },
      prev: function () { if (au.currentTime > 3) au.currentTime = 0; else next(-1); }, next: function () { next(1); },
      slower: function () { setRate(rate - 0.05); }, faster: function () { setRate(rate + 0.05); },
      setA: function () { if (idx < 0) return; A = au.currentTime; if (B != null && B <= A) B = null; paintAB(); say('구간 시작을 ' + fmt(A) + ' 로 잡았어요. 끝나는 곳에서 "B 끝"을 눌러요.'); },
      setB: function () { if (idx < 0) return; if (A == null) A = 0; if (au.currentTime <= A + 0.3) { say('B(끝)는 A(시작)보다 뒤여야 해요.', true); return; } B = au.currentTime; paintAB(); say('구간 반복 중 — 해제하려면 "해제".'); },
      clearAB: function () { A = B = null; paintAB(); say(''); },
    };
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !root.contains(b)) return;
      var a = b.getAttribute('data-rp-a'); if (a && actions[a]) { actions[a](); return; }
      var r = b.getAttribute('data-rp-rate'); if (r) setRate(Number(r));
    });
    card.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rp-pick]'); if (!b) return;
      var it = b.closest('[data-rp-src]'); if (!it) return;
      var i = items().indexOf(it);
      if (i === idx) toggle(); else select(i, true);
    });
    bar.addEventListener('input', function () { seeking = true; var d = au.duration || 0; cur.textContent = fmt(d * bar.value / 1000); });
    bar.addEventListener('change', function () { var d = au.duration || 0; if (d) au.currentTime = d * bar.value / 1000; seeking = false; });
    vol.addEventListener('input', function () { au.volume = vol.value / 100; st.vol = Number(vol.value); save(st); });
    auto.addEventListener('change', function () { st.auto = auto.checked; save(st); });
    loop.addEventListener('change', function () { st.loop = loop.checked; save(st); });
    root.addEventListener('keydown', function (e) {
      var t = e.target; if (t && (t.tagName === 'INPUT' && t.type !== 'range' || t.tagName === 'SELECT')) return;
      if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft' && !(t && t === bar)) { e.preventDefault(); seekBy(-10); }
      else if (e.key === 'ArrowRight' && !(t && t === bar)) { e.preventDefault(); seekBy(10); }
    });
    au.addEventListener('timeupdate', function () {
      if (A != null && B != null && B > A && au.currentTime >= B) au.currentTime = A;     // 구간 반복
      paintBar();
    });
    au.addEventListener('loadedmetadata', function () { applyRate(); paintBar(); });
    au.addEventListener('durationchange', paintBar);
    au.addEventListener('play', function () { go.textContent = '❚❚'; root.classList.add('playing'); });
    au.addEventListener('pause', function () { go.textContent = '▶'; root.classList.remove('playing'); });
    au.addEventListener('waiting', function () { say('불러오는 중…'); });
    au.addEventListener('playing', function () { say(A != null && B != null ? '구간 반복 중' : ''); });
    au.addEventListener('ended', function () {
      if (loop.checked) { au.currentTime = 0; au.play().catch(function () {}); return; }
      if (auto.checked && idx < items().length - 1) next(1); else { go.textContent = '▶'; }
    });
    au.addEventListener('error', function () {
      if (!au.getAttribute('src')) return;
      say('이 녹음을 재생할 수 없어요 (파일 형식이나 링크를 확인해 주세요). 목록의 "새 창"으로 열어 볼 수 있어요.', true);
      go.textContent = '▶';
    });
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', function () { toggle(); });
        navigator.mediaSession.setActionHandler('pause', function () { au.pause(); });
        navigator.mediaSession.setActionHandler('previoustrack', function () { next(-1); });
        navigator.mediaSession.setActionHandler('nexttrack', function () { next(1); });
        navigator.mediaSession.setActionHandler('seekbackward', function () { seekBy(-10); });
        navigator.mediaSession.setActionHandler('seekforward', function () { seekBy(10); });
      } catch (e) { /* 일부만 지원 */ }
    }
    applyRate(); paintAB();
    if (!items().length) { ttl.textContent = '재생할 수 있는 녹음이 아직 없어요'; root.classList.add('empty'); }
    root.__rp = { select: select, au: au };
  }

  function wireForm(form) {
    if (form.getAttribute('data-rec-on')) return;
    form.setAttribute('data-rec-on', '1');
    var title = form.querySelector('input[name="제목"]'), file = form.querySelector('input[type="file"]'), link = form.querySelector('input[name="링크"]');
    var auto = '';                                   // 마지막으로 자동 입력한 값 — 사용자가 고쳤으면 덮어쓰지 않음
    function put(t) { if (!t) return; if (!title.value.trim() || title.value === auto) { title.value = t; auto = t; } }
    if (file) file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      put(f.name.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim());
      if (link) link.value = '';
    });
    if (link) {
      var timer = null;
      var lookup = function () {
        var u = link.value.trim(); if (!/^https?:\/\//i.test(u)) return;
        if (/youtu/i.test(u)) {
          fetch('/conti/youtube/info?url=' + encodeURIComponent(u), { credentials: 'same-origin' }).then(function (r) { return r.json(); })
            .then(function (d) { if (d && d.title) put(d.title); }).catch(function () {});
        } else {
          try { var seg = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_+/g, ' ').trim(); if (seg && !/^[A-Za-z0-9_-]{20,}$/.test(seg)) put(seg); } catch (e) { /* 이름을 못 읽으면 서버가 정함 */ }
        }
      };
      link.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(lookup, 450); });
      link.addEventListener('change', lookup);
    }
  }

  function boot(root) {
    (root || document).querySelectorAll('[data-rp]').forEach(mount);
    (root || document).querySelectorAll('[data-rec-form]').forEach(wireForm);
  }
  document.addEventListener('ph:content-updated', function () { boot(document); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(document); }); else boot(document);
})();
