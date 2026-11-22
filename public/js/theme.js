/* 화면 모드(어두운/밝은) · 글자 크기 · 새로고침 — 맨 위 배너 안의 단추들 (lib/pageShell.js heroTools)
 *  · 단추는 탭을 옮길 때마다 새로 그려지므로 document 한 곳에서 눌림을 받습니다 (data-ph-act)
 *  · 글자 크기는 church-app 처럼 단계(0 ~ 3, 작게 -1)로: 이 앱 화면은 --font-scale, 청년부 앱에서 가져온 화면(.yn)은 html[data-fs] */
(function () {
  var root = document.documentElement;
  var THEME_KEY = 'ph.theme', FS_KEY = 'ph.fs', OLD_SCALE_KEY = 'ph.fontScale';
  var SCALES = { '-1': 0.9, '0': 1, '1': 1.12, '2': 1.25, '3': 1.4 };

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장이 막힌 브라우저 */ } }

  function theme() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  /** 단추로 직접 바꾼 것은 다음 전환 시각(아침 7시 / 저녁 7시)까지만 — 그 뒤에는 시간 자동으로 돌아감 (lib/themeBoot.js) */
  function applyTheme(t, auto) {
    t = 'light';                                    // V13 — 허브 화면은 늘 밝은 화면 (저녁 7시 자동 어둡게 끔 · 라이브 악보는 따로)
    root.setAttribute('data-theme', 'light');
    if (!auto) { if (window.PHThemeMode) window.PHThemeMode.setManual(theme()); else put(THEME_KEY, theme()); }
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light' ? '#F4F2EC' : '#0D1110');
    paint();
  }

  var fs = parseInt(get(FS_KEY), 10);
  if (isNaN(fs)) {                                  // 예전 A-/A+ 값(0.85 ~ 1.4)을 가까운 단계로
    var old = parseFloat(get(OLD_SCALE_KEY) || '1'), best = 0, gap = 9;
    Object.keys(SCALES).forEach(function (k) { var g = Math.abs(SCALES[k] - old); if (g < gap) { gap = g; best = +k; } });
    fs = best;
  }
  function applyFs(n) {
    n = 0;                                          // 글자 크기 단추를 없앰 — 늘 기본 크기
    fs = 0;
    put(FS_KEY, String(fs));
    root.style.setProperty('--font-scale', String(SCALES[String(fs)]));
    if (fs > 0) root.setAttribute('data-fs', String(fs)); else root.removeAttribute('data-fs');
    paint();
  }

  /** 단추 모양을 지금 상태에 맞춥니다 (탭을 옮겨 새로 그려진 배너에도) */
  /** 메뉴가 화면보다 길면 지금 탭이 보이도록 가로로 밀어 둡니다 (폰에서 라이브러리 · 장비 · 팀원 탭) */
  function showTab() {
    Array.prototype.forEach.call(document.querySelectorAll('.ph-hubnav-in'), function (n) {
      var on = n.querySelector('.ph-hubtab.on');
      if (!on || n.scrollWidth <= n.clientWidth + 1) return;
      var left = on.offsetLeft - (n.clientWidth - on.offsetWidth) / 2;
      n.scrollLeft = Math.max(0, Math.min(left, n.scrollWidth - n.clientWidth));
    });
  }
  function paint() {
    showTab();
    var light = theme() === 'light';
    Array.prototype.forEach.call(document.querySelectorAll('[data-ph-act="theme"]'), function (b) {
      b.setAttribute('aria-checked', light ? 'true' : 'false');
      b.setAttribute('aria-label', light ? '어두운 화면으로' : '밝은 화면으로');
      b.title = (light ? '어두운 화면으로' : '밝은 화면으로') + ' (아침 7시 · 저녁 7시에 다시 시간 자동)';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ph-fs'), function (g) {
      g.setAttribute('data-step', String(fs));
      var d = g.querySelector('[data-ph-act="font-down"]'), u = g.querySelector('[data-ph-act="font-up"]');
      if (d) d.disabled = fs <= -1;
      if (u) u.disabled = fs >= 3;
    });
  }

  applyTheme(window.PHThemeMode ? (window.PHThemeMode.light() ? 'light' : 'dark') : (get(THEME_KEY) || 'dark'), true);
  window.addEventListener('ph-theme-auto', function (e) { applyTheme(e.detail && e.detail.theme, true); });   // 열어 둔 채 시간이 바뀌면
  applyFs(fs);

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-ph-act]') : null;
    if (!b) return;
    var a = b.getAttribute('data-ph-act');
    if (a === 'theme') applyTheme(theme() === 'light' ? 'dark' : 'light');
    else if (a === 'font-up') applyFs(fs + 1);
    else if (a === 'font-down') applyFs(fs - 1);
    else if (a === 'refresh') { b.classList.add('spin'); location.reload(); }
    else return;
    e.preventDefault();
  });
  document.addEventListener('ph:content-updated', paint);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();
})();

/* 배너의 "캘린더에 추가" 메뉴 — 바깥을 누르거나 하나를 고르면 닫힘 */
(function () {
  if (window.__phCalBound) return; window.__phCalBound = true;
  document.addEventListener('click', function (e) {
    var open = document.querySelectorAll('.ph-calmenu[open]');
    for (var i = 0; i < open.length; i++) {
      var m = open[i];
      if (!m.contains(e.target) || (e.target.closest && e.target.closest('.ph-calpop a'))) m.removeAttribute('open');
    }
  });
})();

/* 새 버전 안내 — 앱을 켜 둔 채로 새 버전이 올라오면 화면 아래에 "새 버전 · 눌러서 적용" (새로고침 단추를 찾지 않아도 되게).
 * 지금 화면의 빌드(맨 아래 구석 #phBuild) 와 서버(/version.json) 를 앱으로 돌아올 때마다(5분에 한 번까지) 비교. 라이브 악보 화면에서는 예배 중이라 띄우지 않음. */
(function () {
  if (window.__phVerBound) return; window.__phVerBound = true;
  var el = document.getElementById('phBuild'); if (!el) return;
  var mine = String(el.textContent || '').replace(/^#/, '').split(' · ')[0].trim();
  if (!mine || mine === 'dev') return;
  if (/\/conti\/(practice|stage)/.test(location.pathname)) return;
  var last = 0, shown = false;
  function show() {
    if (shown) return; shown = true;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'ph-newver'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>새 버전이 나왔어요</span><b>눌러서 적용</b>';
    b.addEventListener('click', function () { location.reload(); });
    document.body.appendChild(b);
  }
  function check() {
    if (shown || document.hidden || Date.now() - last < 5 * 60 * 1000) return;
    last = Date.now();
    fetch((window.PH_BASE || '') + '/version.json', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.b && j.b !== 'dev' && j.b !== mine) show(); }).catch(function () {});
  }
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  setTimeout(check, 60 * 1000);
})();

/* 홈 첫 안내 — 처음 한 번만 (이 기기에서 "알겠어요" · "닫기" 를 누르면 다시 안 보임) */
(function () {
  var KEY = 'ph.intro.v1';
  function seen() { try { return !!localStorage.getItem(KEY); } catch (e) { return true; } }
  function paint() { var b = document.querySelector('[data-hm-intro]'); if (b && !seen()) b.hidden = false; }
  document.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('[data-hm-intro-close], [data-hm-intro] a') : null; if (!c) return;
    try { localStorage.setItem(KEY, '1'); } catch (x) {}
    if (c.hasAttribute('data-hm-intro-close')) { var b = document.querySelector('[data-hm-intro]'); if (b) b.hidden = true; }
  });
  document.addEventListener('ph:content-updated', paint);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();
})();
