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
  function applyTheme(t) {
    root.setAttribute('data-theme', t === 'light' ? 'light' : 'dark'); put(THEME_KEY, theme());
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light' ? '#FBF6EE' : '#11131A');
    paint();
  }

  var fs = parseInt(get(FS_KEY), 10);
  if (isNaN(fs)) {                                  // 예전 A-/A+ 값(0.85 ~ 1.4)을 가까운 단계로
    var old = parseFloat(get(OLD_SCALE_KEY) || '1'), best = 0, gap = 9;
    Object.keys(SCALES).forEach(function (k) { var g = Math.abs(SCALES[k] - old); if (g < gap) { gap = g; best = +k; } });
    fs = best;
  }
  function applyFs(n) {
    fs = Math.max(-1, Math.min(3, n));
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
      b.title = light ? '어두운 화면으로' : '밝은 화면으로';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ph-fs'), function (g) {
      g.setAttribute('data-step', String(fs));
      var d = g.querySelector('[data-ph-act="font-down"]'), u = g.querySelector('[data-ph-act="font-up"]');
      if (d) d.disabled = fs <= -1;
      if (u) u.disabled = fs >= 3;
    });
  }

  applyTheme(get(THEME_KEY) || 'dark');
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
