/* 페이지 방문 기록 — 이 페이지를 실제로 보고 있던 시간(화면이 가려지면 멈춤)을 떠날 때 /visit 로 보냄 (관리 화면에서 관리자만 봄) */
(function () {
  if (window.__phVisit) return; window.__phVisit = 1;
  function dev() {
    var u = navigator.userAgent || '', os = 'PC', br = '';
    if (/iPhone/.test(u)) os = 'iPhone';
    else if (/iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) os = 'iPad';
    else if (/Android/.test(u)) os = /Mobile/.test(u) ? 'Android 폰' : 'Android 태블릿';
    else if (/Macintosh/.test(u)) os = 'Mac';
    else if (/Windows/.test(u)) os = 'Windows';
    if (/SamsungBrowser/.test(u)) br = '삼성 인터넷'; else if (/Edg\//.test(u)) br = 'Edge'; else if (/KAKAOTALK/i.test(u)) br = '카카오톡'; else if (/CriOS|Chrome\//.test(u)) br = 'Chrome'; else if (/FxiOS|Firefox\//.test(u)) br = 'Firefox'; else if (/Safari\//.test(u)) br = 'Safari';
    var app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    return os + (app ? ' · 홈 화면 앱' : br ? ' · ' + br : '');
  }
  var NAMES = [[/^\/$/, '홈'], [/^\/conti\/listen/, '녹음 듣기'], [/^\/conti/, '주일콘티'], [/^\/practice-conti/, '연습콘티'], [/^\/schedule\/generate/, '연습 일정 만들기'], [/^\/schedule/, '스케쥴'], [/^\/events/, '주일 외'], [/^\/library/, '라이브러리'], [/^\/roster/, '팀원관리'], [/^\/sound/, '마이크 · 인이어'], [/^\/admin/, '관리'], [/^\/profile/, '프로필'], [/^\/guide/, '사용설명서']];
  var LIB = { repo: '곡 · 악보', date: '날짜별', file: '악보 파일', files: '악보 파일', rec: '녹음', recs: '녹음', stats: '통계' };
  function pageName() {
    var p = location.pathname, n = '';
    for (var i = 0; i < NAMES.length; i++) if (NAMES[i][0].test(p)) { n = NAMES[i][1]; break; }
    if (!n) n = (document.title || p).replace(/^\S+ 찬양팀\s*/, '');
    if (n === '라이브러리') { var v = new URLSearchParams(location.search).get('v'); if (v && LIB[v]) n += ' · ' + LIB[v]; }
    var d = new URLSearchParams(location.search).get('date'); if (d && /콘티/.test(n)) n += ' · ' + d.slice(5).replace('-', '/');
    return n;
  }
  var D = dev(), cur = null;
  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function begin() { cur = { id: rid(), path: location.pathname + location.search, page: pageName(), acc: 0, t: document.visibilityState === 'visible' ? Date.now() : 0 }; }
  function pause() { if (cur && cur.t) { cur.acc += (Date.now() - cur.t) / 1000; cur.t = 0; } }
  function send() {
    if (!cur) return; pause();
    var sec = Math.round(cur.acc); cur.acc = 0;
    if (sec < 3) return;
    var body = JSON.stringify([{ id: cur.id, path: cur.path, page: cur.page, dev: D, sec: sec }]);
    try { if (navigator.sendBeacon && navigator.sendBeacon('/visit', new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
    try { fetch('/visit', { method: 'POST', body: body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'text/plain' } }); } catch (e) {}
  }
  function check() {
    var p = location.pathname + location.search;
    if (cur && p === cur.path) { cur.page = pageName(); return; }
    send(); begin();
  }
  begin();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') send(); else if (cur && !cur.t) cur.t = Date.now(); });
  window.addEventListener('pagehide', send);
  window.addEventListener('popstate', function () { setTimeout(check, 0); });
  document.addEventListener('ph:content-updated', function () { setTimeout(check, 0); });
  setInterval(check, 2000);
  setInterval(function () { if (cur && cur.t && (Date.now() - cur.t) / 1000 + cur.acc > 300) { send(); if (document.visibilityState === 'visible') cur.t = Date.now(); } }, 60000);
})();
