/* 떠 있는 "라이브 악보 시작" 바 — 아래로 읽어 내려가는 동안은 비켜 주고, 위로 조금만 올리거나 맨 아래에 닿으면 다시 보여 줌.
   body 에 fb-away 클래스만 붙였다 뗌 (모양은 css/polish.css). 화면이 바뀌어도(SPA) 같은 리스너로 계속 동작. */
(function () {
  if (window.__fbBound) return;
  window.__fbBound = true;
  var lastY = window.scrollY, ticking = false;
  function update() {
    ticking = false;
    var y = window.scrollY, dy = y - lastY;
    if (!document.querySelector('.v13-livebar')) { document.body.classList.remove('fb-away'); lastY = y; return; }
    var nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 80;
    if (y < 120 || nearBottom || dy < -6) document.body.classList.remove('fb-away');
    else if (dy > 6) document.body.classList.add('fb-away');
    if (Math.abs(dy) > 6) lastY = y;
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  document.addEventListener('ph:content-updated', function () { document.body.classList.remove('fb-away'); lastY = window.scrollY; });
})();
