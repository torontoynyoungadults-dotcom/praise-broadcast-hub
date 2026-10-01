/**
 * 라이브 악보 시작 — church-app 허브 화면의 openPractice() 자리.
 *  · callServer(이름, [인자], 성공, 실패) — church-app public/app.js 와 같은 약속 (POST /api/<이름> { args } → { ok, result | error })
 *  · YNTheme — 라이브 악보의 ☀️/🌙 단추가 이 앱의 화면 모드(ph.theme)에 저장되도록
 *  · 서버가 넣어 준 window.__LIVE__ 로 YNPractice.open(...) — 닫으면(✕ · Esc) 예배콘티로 돌아갑니다
 */
(function () {
  'use strict';
  var B = window.__LIVE__ || {};
  var doc = document, root = doc.documentElement;

  function callServer(name, args, onOk, onFail) {
    function fail(e) { if (onFail) onFail(e); else if (window.console) console.error('[' + name + ']', e); }
    fetch('/api/' + encodeURIComponent(name), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ args: args || [] })
    }).then(function (res) {
      return res.text().then(function (t) {
        try { return JSON.parse(t); } catch (e) {
          if (res.status === 413) throw new Error('파일이 너무 큽니다. 더 작은 파일로 다시 시도해주세요.');
          throw new Error('서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요. (' + res.status + ')');
        }
      });
    }).then(function (d) {
      if (d && d.ok) { if (onOk) onOk(d.result); }
      else fail(new Error((d && d.error) || '처리하지 못했습니다.'));
    }, function (e) {
      fail(navigator.onLine === false ? new Error('인터넷 연결을 확인해주세요.') : (e instanceof Error && /[가-힣]/.test(e.message) ? e : new Error('서버에 연결하지 못했습니다.')));
    });
  }
  callServer.pending = function () { return 0; };
  window.callServer = callServer;

  function themeNow() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function themeSet(t) {
    t = t === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('ph.theme', t); } catch (e) { /* 저장이 막힌 브라우저 */ }
    var m = doc.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light' ? '#EFEBE5' : '#1C1C1C');
    return t;
  }
  window.YNTheme = { get: themeNow, set: themeSet, toggle: function () { return themeSet(themeNow() === 'light' ? 'dark' : 'light'); }, isAuto: function () { return false; }, auto: function () {} };

  function fallback(msg) {
    var box = doc.getElementById('lvFallback'); if (!box) return;
    box.style.display = '';
    box.innerHTML = '<p>' + String(msg).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</p><p><a href="' + (B.back || '/conti') + '">← 예배콘티로 돌아가기</a></p>';
  }

  function boot() {
    if (!window.YNPractice) { fallback('라이브 악보 화면을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'); return; }
    var api = window.YNPractice.open({
      token: B.token, room: B.room, me: B.me, sheets: B.sheets || [], songs: B.songs || [], start: B.start,
      canEdit: true, callServer: callServer, recs: B.recs || [],
      onClose: function () { location.href = B.back || '/conti'; }
    });
    var box = doc.getElementById('lvFallback');
    if (api) { if (box) box.style.display = 'none'; }
    else fallback('열 수 있는 악보가 없습니다. 먼저 악보(PDF · 사진)를 올려주세요.');
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
}());
