/**
 * 예배콘티 "녹음" — 목록에는 재생 버튼만, 누르면 화면 아래에 뜨는 플로팅 플레이어.
 *  · 플레이어는 body 에 하나만 만들어 두므로 메뉴(탭)를 옮겨 다녀도 끊기지 않고 계속 재생됩니다 (SPA 조각 교체와 무관).
 *  · 접힌 모양: 재생/멈춤 · 제목 · 시간 · 진행 막대 · 펼치기 · 닫기.  펼치면: ±10초 · 이전/다음 · 빠르기(0.5~2배, 음높이 유지) · A-B 구간 반복 · 한 곡 반복 · 이어서 재생 · 소리.
 *  · 손잡이(⠿)를 끌어 원하는 곳으로 옮길 수 있고, 위치 · 빠르기 · 소리 · 펼침 상태는 이 기기에 기억합니다.
 *  · 목록은 누른 순간 화면에 있던 [data-rp-src] 들의 복사본 — 다른 탭으로 가도 이전/다음/이어서 재생이 그대로 됩니다.
 * 올릴 때 제목 자동 입력([data-rec-form])도 여기서 붙입니다.
 */
(function () {
  var KEY = 'ph_rp_v2';
  var I = {
    play: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    grip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  };
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 저장 못 해도 재생엔 영향 없음 */ } }
  function fmt(t) { if (!isFinite(t) || t < 0) t = 0; t = Math.floor(t); var m = Math.floor(t / 60), s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function clampRate(r) { return Math.max(0.5, Math.min(2, Math.round(r * 100) / 100)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var F = null;                                        // 플로팅 플레이어 (처음 재생할 때 만듦)

  function build() {
    var root = document.createElement('div');
    root.className = 'rpf'; root.setAttribute('data-rp', ''); root.setAttribute('role', 'region'); root.setAttribute('aria-label', '녹음 플레이어');
    root.innerHTML =
      '<audio preload="metadata" playsinline></audio>' +
      '<div class="rpf-main">' +
        '<span class="rpf-grip" title="끌어서 옮기기" aria-hidden="true">' + I.grip + '</span>' +
        '<button type="button" class="rp-go" data-rp-a="toggle" title="재생 / 멈춤" aria-label="재생 / 멈춤">' + I.play + '</button>' +
        '<div class="rpf-info"><b class="rp-title"></b><span class="rp-by"></span></div>' +
        '<span class="rpf-time"><span class="rp-cur">0:00</span> / <span class="rp-dur">0:00</span></span>' +
        '<button type="button" class="rpf-expand" data-rp-a="expand" title="자세히" aria-label="자세히 펼치기" aria-expanded="false">' + I.up + '</button>' +
        '<button type="button" class="rpf-x" data-rp-a="close" title="닫기" aria-label="플레이어 닫기">' + I.close + '</button>' +
      '</div>' +
      '<div class="rp-seek"><input class="rp-bar" type="range" min="0" max="1000" value="0" step="1" aria-label="재생 위치"></div>' +
      '<div class="rpf-more">' +
        '<div class="rp-ctl">' +
          '<button type="button" data-rp-a="prev" title="이전 녹음" aria-label="이전 녹음">' + I.prev + '</button>' +
          '<button type="button" data-rp-a="back" title="10초 뒤로" aria-label="10초 뒤로">−10</button>' +
          '<button type="button" data-rp-a="fwd" title="10초 앞으로" aria-label="10초 앞으로">+10</button>' +
          '<button type="button" data-rp-a="next" title="다음 녹음" aria-label="다음 녹음">' + I.next + '</button>' +
        '</div>' +
        '<div class="rp-opts">' +
          '<div class="rp-grp"><span class="rp-lb">빠르기</span><button type="button" data-rp-a="slower" aria-label="느리게">−</button><b class="rp-rate">1.00×</b><button type="button" data-rp-a="faster" aria-label="빠르게">+</button>' +
            '<span class="rp-presets">' + [0.5, 0.75, 1, 1.25, 1.5].map(function (n) { return '<button type="button" data-rp-rate="' + n + '">' + n + '×</button>'; }).join('') + '</span></div>' +
          '<div class="rp-grp"><span class="rp-lb">구간 반복</span><button type="button" data-rp-a="setA">A 시작</button><button type="button" data-rp-a="setB">B 끝</button><button type="button" data-rp-a="clearAB">해제</button><span class="rp-ab"></span></div>' +
          '<div class="rp-grp"><span class="rp-lb">소리</span><input class="rp-vol" type="range" min="0" max="100" value="100" aria-label="소리 크기"><label class="rp-chk"><input type="checkbox" class="rp-auto" checked> 이어서 재생</label><label class="rp-chk"><input type="checkbox" class="rp-loop"> 한 곡 반복</label></div>' +
        '</div>' +
      '</div>' +
      '<p class="rp-msg" role="status"></p>';
    document.body.appendChild(root);
    return root;
  }

  function create() {
    var root = build();
    var au = root.querySelector('audio');
    var $ = function (s) { return root.querySelector(s); };
    var bar = $('.rp-bar'), cur = $('.rp-cur'), dur = $('.rp-dur'), go = $('.rp-go'), rateEl = $('.rp-rate'), msg = $('.rp-msg'),
        ttl = $('.rp-title'), by = $('.rp-by'), abEl = $('.rp-ab'), vol = $('.rp-vol'), auto = $('.rp-auto'), loop = $('.rp-loop'), exp = $('.rpf-expand');
    var st = load(), list = [], idx = -1, A = null, B = null, seeking = false;
    var rate = clampRate(st.rate || 1);
    try { au.preservesPitch = true; au.mozPreservesPitch = true; au.webkitPreservesPitch = true; } catch (e) { /* 기본값이 음높이 유지 */ }
    vol.value = st.vol == null ? 100 : st.vol; auto.checked = st.auto !== false; loop.checked = !!st.loop; au.volume = vol.value / 100;

    function say(t, bad) { msg.textContent = t || ''; msg.classList.toggle('bad', !!bad); root.classList.toggle('has-msg', !!t); }
    function applyRate() { au.playbackRate = rate; rateEl.textContent = rate.toFixed(2) + '×'; root.querySelectorAll('[data-rp-rate]').forEach(function (b) { b.classList.toggle('on', Math.abs(Number(b.getAttribute('data-rp-rate')) - rate) < 0.001); }); }
    function setRate(r) { rate = clampRate(r); applyRate(); st.rate = rate; save(st); }
    function paintBar() {
      var d = au.duration, p = d > 0 ? au.currentTime / d : 0, pc = (p * 100).toFixed(2);
      if (!seeking) bar.value = Math.round(p * 1000);
      var a = A != null && d > 0 ? A / d * 100 : null, b = B != null && d > 0 ? B / d * 100 : null;
      var base = 'var(--accent)', off = 'rgba(255,255,255,.18)';
      bar.style.background = (a != null && b != null && b > a)
        ? 'linear-gradient(90deg,' + base + ' ' + pc + '%,' + off + ' ' + pc + '%), linear-gradient(90deg,transparent ' + a + '%,rgba(255,138,61,.55) ' + a + '%,rgba(255,138,61,.55) ' + b + '%,transparent ' + b + '%)'
        : 'linear-gradient(90deg,' + base + ' ' + pc + '%,' + off + ' ' + pc + '%)';
      cur.textContent = fmt(au.currentTime); dur.textContent = fmt(d);
    }
    function paintAB() { abEl.textContent = A == null && B == null ? '' : (A != null ? fmt(A) : '–') + ' ~ ' + (B != null ? fmt(B) : '–'); paintBar(); }
    function markList() {                              // 지금 화면에 있는 목록에서 재생 중인 줄 표시
      var src = idx >= 0 && list[idx] ? list[idx].src : '';
      document.querySelectorAll('[data-rp-src]').forEach(function (el) { el.classList.toggle('rp-on', !!src && el.getAttribute('data-rp-src') === src); });
    }
    function meta() {
      if (!('mediaSession' in navigator) || idx < 0 || !list[idx]) return;
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: list[idx].title || '녹음', artist: list[idx].by || '' }); } catch (e) { /* 지원 안 하면 건너뜀 */ }
    }
    function show() { root.classList.add('on'); document.body.classList.add('rpf-on'); }
    function select(i, play) {
      if (!list.length) return;
      if (i < 0) i = 0; if (i >= list.length) i = list.length - 1;
      var it = list[i]; idx = i; A = B = null; paintAB(); say('');
      ttl.textContent = it.title || '녹음'; by.textContent = it.by || '';
      au.src = it.src; applyRate(); au.load(); markList(); meta(); show();
      if (play) au.play().catch(function (e) { if (e && e.name !== 'AbortError' && e.name !== 'NotSupportedError') say('재생을 시작하지 못했어요. 재생 버튼을 한 번 더 눌러 주세요.', true); });
    }
    function toggle() {
      if (idx < 0) return;
      if (au.paused) au.play().catch(function (e) { if (e && e.name !== 'AbortError' && e.name !== 'NotSupportedError') say('재생하지 못했어요.', true); }); else au.pause();
    }
    function seekBy(d) { if (idx < 0) return; var t = au.currentTime + d, end = au.duration || 0; au.currentTime = Math.max(0, end ? Math.min(end, t) : t); }
    function step(dir) { var n = list.length; if (n) select((idx + dir + n) % n, true); }
    function setExpanded(on) { root.classList.toggle('open', on); exp.setAttribute('aria-expanded', on ? 'true' : 'false'); exp.setAttribute('aria-label', on ? '접기' : '자세히 펼치기'); st.open = on; save(st); place(); }
    function close() { au.pause(); au.removeAttribute('src'); au.load(); idx = -1; A = B = null; root.classList.remove('on', 'playing'); document.body.classList.remove('rpf-on'); markList(); say(''); go.innerHTML = I.play; }

    var actions = {
      toggle: toggle, back: function () { seekBy(-10); }, fwd: function () { seekBy(10); },
      prev: function () { if (au.currentTime > 3) au.currentTime = 0; else step(-1); }, next: function () { step(1); },
      slower: function () { setRate(rate - 0.05); }, faster: function () { setRate(rate + 0.05); },
      expand: function () { setExpanded(!root.classList.contains('open')); }, close: close,
      setA: function () { if (idx < 0) return; A = au.currentTime; if (B != null && B <= A) B = null; paintAB(); say('구간 시작을 ' + fmt(A) + ' 로 잡았어요. 끝나는 곳에서 "B 끝"을 눌러요.'); },
      setB: function () { if (idx < 0) return; if (A == null) A = 0; if (au.currentTime <= A + 0.3) { say('B(끝)는 A(시작)보다 뒤여야 해요.', true); return; } B = au.currentTime; paintAB(); say('구간 반복 중 — 해제하려면 "해제".'); },
      clearAB: function () { A = B = null; paintAB(); say(''); },
    };
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !root.contains(b)) return;
      var a = b.getAttribute('data-rp-a'); if (a && actions[a]) { actions[a](); return; }
      var r = b.getAttribute('data-rp-rate'); if (r) setRate(Number(r));
    });
    bar.addEventListener('input', function () { seeking = true; cur.textContent = fmt((au.duration || 0) * bar.value / 1000); });
    bar.addEventListener('change', function () { var d = au.duration || 0; if (d) au.currentTime = d * bar.value / 1000; seeking = false; });
    vol.addEventListener('input', function () { au.volume = vol.value / 100; st.vol = Number(vol.value); save(st); });
    auto.addEventListener('change', function () { st.auto = auto.checked; save(st); });
    loop.addEventListener('change', function () { st.loop = loop.checked; save(st); });
    root.addEventListener('keydown', function (e) {
      var t = e.target; if (t && ((t.tagName === 'INPUT' && t.type !== 'range') || t.tagName === 'SELECT')) return;
      if (e.key === 'Escape' && root.classList.contains('open')) setExpanded(false);
      else if (e.key === 'ArrowLeft' && t !== bar) { e.preventDefault(); seekBy(-10); }
      else if (e.key === 'ArrowRight' && t !== bar) { e.preventDefault(); seekBy(10); }
    });
    au.addEventListener('timeupdate', function () { if (A != null && B != null && B > A && au.currentTime >= B) au.currentTime = A; paintBar(); });
    au.addEventListener('loadedmetadata', function () { applyRate(); paintBar(); });
    au.addEventListener('durationchange', paintBar);
    au.addEventListener('play', function () { go.innerHTML = I.pause; root.classList.add('playing'); });
    au.addEventListener('pause', function () { go.innerHTML = I.play; root.classList.remove('playing'); });
    au.addEventListener('waiting', function () { say('불러오는 중…'); });
    au.addEventListener('playing', function () { say(A != null && B != null ? '구간 반복 중' : ''); });
    au.addEventListener('ended', function () {
      if (loop.checked) { au.currentTime = 0; au.play().catch(function () {}); return; }
      if (auto.checked && idx < list.length - 1) step(1); else go.innerHTML = I.play;
    });
    au.addEventListener('error', function () {
      if (!au.getAttribute('src')) return;
      say('이 녹음을 재생할 수 없어요 (파일 형식이나 링크를 확인해 주세요). 목록의 "새 창"으로 열어 볼 수 있어요.', true); go.innerHTML = I.play;
    });
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', toggle); navigator.mediaSession.setActionHandler('pause', function () { au.pause(); });
        navigator.mediaSession.setActionHandler('previoustrack', function () { step(-1); }); navigator.mediaSession.setActionHandler('nexttrack', function () { step(1); });
        navigator.mediaSession.setActionHandler('seekbackward', function () { seekBy(-10); }); navigator.mediaSession.setActionHandler('seekforward', function () { seekBy(10); });
      } catch (e) { /* 일부만 지원 */ }
    }

    /* ---- 옮기기 (손잡이를 끌면 그 자리에 놓임 · 화면 밖으로는 못 나감) ---- */
    function place() {
      if (st.x == null || st.y == null) { root.style.left = ''; root.style.top = ''; root.style.right = ''; root.style.bottom = ''; root.classList.remove('moved'); return; }
      var w = root.offsetWidth, h = root.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      var x = Math.max(6, Math.min(vw - w - 6, st.x)), y = Math.max(6, Math.min(vh - h - 6, st.y));
      root.style.left = x + 'px'; root.style.top = y + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto'; root.classList.add('moved');
    }
    var drag = null;
    $('.rpf-grip').addEventListener('pointerdown', function (e) {
      var r = root.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
      try { e.target.setPointerCapture(e.pointerId); } catch (x) { /* 없어도 동작 */ }
      e.preventDefault();
    });
    $('.rpf-grip').addEventListener('pointermove', function (e) { if (!drag) return; st.x = e.clientX - drag.dx; st.y = e.clientY - drag.dy; place(); });
    var endDrag = function () { if (drag) { drag = null; save(st); } };
    $('.rpf-grip').addEventListener('pointerup', endDrag); $('.rpf-grip').addEventListener('pointercancel', endDrag);
    $('.rpf-grip').addEventListener('dblclick', function () { st.x = st.y = null; save(st); place(); });   // 두 번 누르면 원래 자리(아래 가운데)로
    window.addEventListener('resize', place);

    applyRate(); paintAB();
    if (st.open) { root.classList.add('open'); exp.setAttribute('aria-expanded', 'true'); }
    place();
    return {
      root: root, au: au,
      play: function (items, i) { list = items; select(i, true); },
      current: function () { return idx >= 0 && list[idx] ? list[idx].src : ''; },
      mark: markList, toggle: toggle,
    };
  }

  /* ---- 목록 쪽: 재생 버튼 ---- */
  function snapshot() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-rp-src]')).map(function (el) {
      return { src: el.getAttribute('data-rp-src'), title: el.getAttribute('data-rp-title') || '녹음', by: el.getAttribute('data-rp-by') || '' };
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-rp-pick]'); if (!b) return;
    var it = b.closest('[data-rp-src]'); if (!it) return;
    var src = it.getAttribute('data-rp-src');
    if (!F) F = create();
    if (F.current() === src) { F.toggle(); return; }          // 같은 녹음을 또 누르면 재생/멈춤
    var items = snapshot(), i = items.findIndex(function (x) { return x.src === src; });
    F.play(items, i < 0 ? 0 : i);
  });

  /* ---- 올릴 때 제목 자동 입력 ---- */
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
    (root || document).querySelectorAll('[data-rec-form]').forEach(wireForm);
    if (F) F.mark();                                   // 다른 탭으로 갔다 와도 재생 중인 줄 표시 유지
  }
  document.addEventListener('ph:content-updated', function () { boot(document); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(document); }); else boot(document);
})();
