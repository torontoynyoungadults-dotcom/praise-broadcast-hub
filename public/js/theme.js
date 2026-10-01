/* 다크/라이트 모드 · 글자 크기 조절 · 새로고침 — 모든 페이지 공통 (기존 church-app 기능 포팅) */
(function () {
  var root = document.documentElement;
  var THEME_KEY = 'ph.theme', SCALE_KEY = 'ph.fontScale';

  function applyTheme(t) { root.setAttribute('data-theme', t); try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
  function applyScale(s) { root.style.setProperty('--font-scale', s); try { localStorage.setItem(SCALE_KEY, s); } catch (e) {} }

  var savedTheme = 'dark', savedScale = '1';
  try { savedTheme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
  try { savedScale = localStorage.getItem(SCALE_KEY) || '1'; } catch (e) {}
  applyTheme(savedTheme); applyScale(savedScale);

  function mount() {
    var bar = document.querySelector('.ph-tools');
    if (!bar) return;
    var themeBtn = document.createElement('button');
    themeBtn.className = 'ph-icon-btn'; themeBtn.type = 'button'; themeBtn.title = '화면 모드';
    themeBtn.textContent = root.getAttribute('data-theme') === 'light' ? '🌙' : '☀️';
    themeBtn.onclick = function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next); themeBtn.textContent = next === 'light' ? '🌙' : '☀️';
    };

    var smaller = document.createElement('button');
    smaller.className = 'ph-icon-btn'; smaller.type = 'button'; smaller.title = '글자 작게'; smaller.textContent = 'A-';
    smaller.onclick = function () { applyScale(Math.max(0.85, parseFloat(getComputedStyle(root).getPropertyValue('--font-scale')) - 0.1).toFixed(2)); };

    var bigger = document.createElement('button');
    bigger.className = 'ph-icon-btn'; bigger.type = 'button'; bigger.title = '글자 크게'; bigger.textContent = 'A+';
    bigger.onclick = function () { applyScale(Math.min(1.4, parseFloat(getComputedStyle(root).getPropertyValue('--font-scale')) + 0.1).toFixed(2)); };

    var refresh = document.createElement('button');
    refresh.className = 'ph-icon-btn'; refresh.type = 'button'; refresh.title = '새로고침'; refresh.textContent = '↻';
    refresh.onclick = function () { location.reload(); };

    [smaller, bigger, themeBtn, refresh].forEach(function (b) { bar.appendChild(b); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
