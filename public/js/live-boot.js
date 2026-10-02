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

  function asError(e, fallbackMsg) { return e instanceof Error && /[가-힣]/.test(e.message) ? e : new Error(fallbackMsg); }
  function callServer(name, args, onOk, onFail) {
    /* 오프라인 저장소(offline.js)가 있으면: 밀린 내 필기를 먼저 보내고, 인터넷이 끊겼을 때 마지막으로 받은 곡 · 필기를 대신 보여 줍니다 */
    var O = window.YNOff, pre = null;
    try { pre = O && O.before ? O.before(name, args) : null; } catch (e) { pre = null; }
    if (pre) pre.then(send, send); else send();
    function fail(e) { if (onFail) onFail(e); else if (window.console) console.error('[' + name + ']', e); }
    function send() {
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
        if (d && d.ok) {
          try { if (O) { O.store(name, args, d.result); if (name === 'worshipAnnoSaveMine') O.clearSave(args); } } catch (e) {}
          if (onOk) onOk(d.result);
        } else fail(new Error((d && d.error) || '처리하지 못했습니다.'));
      }, function (e) {
        var net = false; try { net = !!(O && O.isNetworkError(e)); } catch (x) {}
        if (net && O) {                                                                  // 인터넷 문제일 때만 (서버가 거절한 것은 그대로 오류)
          if (name === 'worshipAnnoSaveMine') {                                          // 내 필기 → 기기에 보관, 연결되면 자동 저장
            O.queueSave(name, args).then(function (ok) { if (ok && onOk) onOk({ offline: true }); else fail(asError(e, '서버에 연결하지 못했습니다.')); });
            return;
          }
          O.fallback(name, args).then(function (hit) {
            if (hit && onOk) { try { window.__OFFLINE_AT__ = hit.at; } catch (x) {} onOk(hit.result); }
            else fail(asError(navigator.onLine === false ? new Error('인터넷 연결을 확인해주세요.') : e, '서버에 연결하지 못했습니다.'));
          });
          return;
        }
        fail(navigator.onLine === false ? new Error('인터넷 연결을 확인해주세요.') : asError(e, '서버에 연결하지 못했습니다.'));
      });
    }
  }
  callServer.pending = function () { return 0; };
  window.callServer = callServer;

  function themeNow() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function themeSet(t) {
    t = t === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('ph.theme', t); } catch (e) { /* 저장이 막힌 브라우저 */ }
    var m = doc.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light' ? '#EDF4E9' : '#0A1311');
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
      canEdit: !B.ro, readOnly: !!B.ro, callServer: callServer, recs: B.recs || [],
      onClose: function () { location.href = B.back || '/conti'; }
    });
    try {                                                                              // 오프라인용 다운로드를 해 둔 기기라면, 빠진 것만 조용히 채움 (6시간에 한 번)
      if (window.YNOff && window.YNOff.dl.enabled() && B.back) {
        var bu = new URL(B.back, location.href);
        window.YNOff.dl.refill({ team: bu.searchParams.get('team') || '', date: bu.searchParams.get('date') || '', event: bu.searchParams.get('event') || '' });
      }
    } catch (e) { /* 오프라인 저장소가 없어도 화면은 그대로 */ }
    var box = doc.getElementById('lvFallback');
    if (api) { if (box) box.style.display = 'none'; }
    else fallback('열 수 있는 악보가 없습니다. 먼저 악보(PDF · 사진)를 올려주세요.');
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
}());
