/**
 * 알림 (종 아이콘) — 맨 위 배너 오른쪽 위의 종을 누르면 알림 창이 열립니다.
 *   · 받은 알림 목록 (누르면 해당 콘티로)
 *   · "이 기기로 알림 받기" — 폰/노트북으로 푸시 (설정은 기기마다 한 번)
 *   · 자동 알림: 콘티 곡은 올린 5분 뒤 한꺼번에 · 내 스케줄(편성)이 바뀌면 그 사람에게만 (악보를 올릴 때는 알림 없음)
 *   · 따로 전할 말이 있으면 "알림 보내기" 로 팀 전체에 직접
 * 서버: routes/notify.js · 서비스워커: public/sw.js (push · notificationclick)
 */
(function () {
  'use strict';
  if (window.__phNotify) return; window.__phNotify = true;

  var S = { st: null, open: false, busy: false, ep: '', loadedAt: 0, picked: {} };
  var el = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function team() { try { return new URLSearchParams(location.search).get('team') || ''; } catch (e) { return ''; } }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 동작 */ } return null; }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { /* */ } return null; }
  function ago(iso) {
    var t = Date.parse(iso); if (!t) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return '방금'; if (m < 60) return m + '분 전';
    var h = Math.round(m / 60); if (h < 24) return h + '시간 전';
    var d = Math.round(h / 24); if (d < 8) return d + '일 전';
    var x = new Date(t); return (x.getMonth() + 1) + '/' + x.getDate();
  }
  var KIND = { '콘티': '콘티', '스케줄': '스케줄', '직접': '공지' };

  /* ---------------------------------------------------------------- 기기 푸시 */
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function standalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
  function b64(k) {
    var p = '='.repeat((4 - k.length % 4) % 4), s = (k + p).replace(/-/g, '+').replace(/_/g, '/'), r = atob(s), a = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a;
  }
  function reg() {
    return navigator.serviceWorker.register('/sw.js').catch(function () {}).then(function () { return navigator.serviceWorker.ready; });
  }
  function currentSub() {
    if (!pushSupported()) return Promise.resolve(null);
    return reg().then(function (r) { return r.pushManager.getSubscription(); }).catch(function () { return null; });
  }
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: '응답을 읽지 못했어요.' }; }); })
      .catch(function () { return { ok: false, error: '인터넷 연결을 확인해 주세요.' }; });
  }
  function turnOn() {
    if (!pushSupported()) return Promise.resolve({ ok: false, error: '이 브라우저는 알림을 지원하지 않아요.' });
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') return { ok: false, error: '알림이 막혀 있어요. 기기 설정에서 이 앱의 알림을 허용해 주세요.' };
      return reg().then(function (r) {
        return r.pushManager.getSubscription().then(function (sub) {
          return sub || r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(S.st.key) });
        });
      }).then(function (sub) {
        return post('/notify/subscribe', { subscription: sub.toJSON() }).then(function (j) { if (j.ok) S.ep = sub.endpoint; return j; });
      });
    }).catch(function (e) { return { ok: false, error: '알림을 켜지 못했어요. ' + (e && e.message ? e.message : '') }; });
  }
  function turnOff() {
    return currentSub().then(function (sub) {
      if (!sub) return { ok: true };
      var ep = sub.endpoint;
      return post('/notify/unsubscribe', { endpoint: ep }).then(function (j) { return sub.unsubscribe().catch(function () {}).then(function () { S.ep = ''; return j; }); });
    });
  }

  /* ---------------------------------------------------------------- 상태 */
  function load() {
    return currentSub().then(function (sub) {
      S.ep = sub ? sub.endpoint : '';
      var q = '?team=' + encodeURIComponent(team()) + (S.ep ? '&ep=' + encodeURIComponent(S.ep) : '');
      return fetch('/notify/state' + q, { credentials: 'same-origin', cache: 'no-store' });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.ok) return null;
      S.st = j; S.loadedAt = Date.now(); paintBell(); if (S.open) render(); return j;
    }).catch(function () { return null; });
  }
  function seenKey() { return 'ph.notify.seen.' + (S.st && S.st.team || ''); }
  function unread() {
    if (!S.st || !S.st.items.length) return 0;
    var seen = ls(seenKey()) || '';
    return S.st.items.filter(function (i) { return i.at > seen; }).length;
  }
  function paintBell() {
    var n = unread();
    Array.prototype.forEach.call(document.querySelectorAll('[data-ph-act="bell"]'), function (b) {
      b.classList.toggle('has-new', n > 0);
      b.setAttribute('aria-label', n ? '알림 ' + n + '개' : '알림');
    });
  }

  /* ---------------------------------------------------------------- 창 */
  function mount() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'ph-nt'; el.hidden = true;
    el.innerHTML = '<div class="ph-nt-back" data-nt="close"></div><section class="ph-nt-box" role="dialog" aria-label="알림"><div class="ph-nt-in"></div></section>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('input', function (e) { if (e.target && e.target.matches('.ph-nt-msg')) S.msg = e.target.value; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) close(); });
    return el;
  }
  function pushRow() {
    var st = S.st;
    if (!pushSupported()) {
      return '<div class="ph-nt-push off"><div><b>폰으로 알림 받기</b><small>' + (isIos() && !standalone()
        ? '아이폰은 먼저 <b>홈 화면에 추가</b>한 뒤, 홈 화면의 앱으로 열어야 알림을 켤 수 있어요. (공유 버튼 → 홈 화면에 추가)'
        : '이 브라우저에서는 알림을 켤 수 없어요. 크롬 · 사파리 최신 버전을 써 주세요.') + '</small></div></div>';
    }
    var denied = window.Notification && Notification.permission === 'denied';
    var on = !!(S.ep && st.subscribed);
    if (denied && !on) return '<div class="ph-nt-push off"><div><b>알림이 막혀 있어요</b><small>기기 설정(또는 브라우저 주소창의 자물쇠)에서 이 앱의 알림을 허용해 주세요.</small></div></div>';
    return '<div class="ph-nt-push' + (on ? ' on' : '') + '"><div><b>' + (on ? '이 기기로 알림을 받고 있어요' : '이 기기로 알림 받기') + '</b><small>' +
      (on ? '새 콘티 곡이나 악보가 올라오면 바로 알려 드려요.' : '새 콘티 곡이나 악보가 올라오면 폰에 바로 알려 드려요.') + '</small></div>' +
      '<button type="button" class="ph-nt-sw" role="switch" aria-checked="' + on + '" data-nt="' + (on ? 'off' : 'on') + '" aria-label="이 기기 알림"><i></i></button></div>' + (S.pushErr ? '<p class="ph-nt-err">' + esc(S.pushErr) + '</p>' : '');
  }
  function sendBox() {
    var st = S.st; if (!st.canSend) return '';
    return '<div class="ph-nt-send"><h4>팀에 알림 보내기</h4>' +
      '<p class="ph-nt-hint">콘티 곡은 올린 5분 뒤 자동으로, 내 스케줄이 바뀌면 그 사람에게만 알려 드려요. 따로 전할 말이 있을 때만 여기서 보내세요.</p>' +
      '<input class="ph-nt-msg" type="text" maxlength="140" placeholder="팀원들에게 전할 말" value="' + esc(S.msg || '') + '">' +
      '<button type="button" class="ph-nt-go" data-nt="send"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '보내는 중…' : '알림 보내기') + '</button>' +
      '<p class="ph-nt-res" role="status">' + esc(S.res || '') + '</p></div>';
  }
  function list() {
    var st = S.st;
    if (!st.items.length) return '<p class="ph-nt-none">아직 받은 알림이 없어요.</p>';
    var seen = S.seenAtOpen || '';
    return '<ul class="ph-nt-list">' + st.items.map(function (i) {
      return '<li><a href="' + esc(i.url || '/conti') + '" class="ph-nt-item' + (i.at > seen ? ' new' : '') + '" data-nt-go><span class="ph-nt-k k-' + esc(i.kind) + '">' + esc(KIND[i.kind] || i.kind) + '</span><span class="ph-nt-t"><b>' + esc(i.title) + '</b>' + (i.body ? '<small>' + esc(i.body) + '</small>' : '') +
        '</span><time>' + ago(i.at) + '</time></a></li>';
    }).join('') + '</ul>';
  }
  function render() {
    if (!el) return;
    var inn = $('.ph-nt-in', el);
    if (!S.st) { inn.innerHTML = head() + '<p class="ph-nt-none">불러오는 중…</p>'; return; }
    var keep = inn.querySelector('.ph-nt-msg') === document.activeElement, pos = inn.scrollTop;
    inn.innerHTML = head() + pushRow() + sendBox() + '<h4 class="ph-nt-h2">받은 알림</h4>' + list();
    inn.scrollTop = pos;
    if (keep) { var m = inn.querySelector('.ph-nt-msg'); if (m) { m.focus(); try { m.setSelectionRange(m.value.length, m.value.length); } catch (e) { /* */ } } }
  }
  function head() { return '<header class="ph-nt-head"><h3>알림</h3><button type="button" class="ph-nt-x" data-nt="close" aria-label="닫기">✕</button></header>'; }

  function open() {
    mount();
    Array.prototype.forEach.call(document.querySelectorAll('.ph-nt-toast'), function (t) { if (t.parentNode) t.parentNode.removeChild(t); });
    S.open = true; S.res = ''; S.seenAtOpen = ls(seenKey()) || '';
    el.hidden = false; document.documentElement.classList.add('ph-nt-open');
    render();
    load().then(function () {
      if (S.st && S.st.items.length) ls(seenKey(), S.st.items[0].at);       // 열어서 봤으면 읽음 (목록의 빨간 점은 이 창이 닫힐 때까지 그대로)
      paintBell();
    });
  }
  function close() {
    if (!el) return; S.open = false; el.hidden = true; document.documentElement.classList.remove('ph-nt-open'); paintBell();
  }
  function onClick(e) {
    var go = e.target.closest && e.target.closest('[data-nt-go]');
    if (go) { close(); return; }                                  // 링크 이동은 그대로 (SPA 가 받음)
    var b = e.target.closest && e.target.closest('[data-nt]'); if (!b) return;
    var a = b.getAttribute('data-nt');
    if (a === 'close') close();
    else if (a === 'on') { b.disabled = true; S.pushErr = ''; turnOn().then(function (j) { S.pushErr = j.ok ? '' : (j.error || ''); return load(); }); }
    else if (a === 'off') { b.disabled = true; turnOff().then(function () { return load(); }); }
    else if (a === 'send') send();
  }
  function send() {
    if (S.busy || !S.st) return;
    var msg = (S.msg || '').trim();
    if (!msg) { S.res = '전할 말을 적어 주세요.'; render(); return; }
    S.busy = true; S.res = ''; render();
    post('/notify/send', { team: S.st.team, message: msg }).then(function (j) {
      S.busy = false;
      if (j.ok) { S.res = '보냈어요 · ' + (j.people ? j.people + '명의 기기로 전달' : '알림을 켠 팀원이 아직 없어요 (목록에는 남았어요)'); S.msg = ''; }
      else S.res = j.error || '보내지 못했어요.';
      return load();
    }).then(function () { render(); });
  }

  /* ---------------------------------------------------------------- 시작 */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ph-act="bell"]'); if (!b) return;
    e.preventDefault(); if (S.open) close(); else open();
  });
  function boot() {
    if (!document.querySelector('[data-ph-act="bell"]')) return;
    load().then(function () { paintBell(); });
  }
  document.addEventListener('ph:content-updated', function () { if (Date.now() - S.loadedAt > 4000) boot(); else paintBell(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - S.loadedAt > 20000 && document.querySelector('[data-ph-act="bell"]')) load(); });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'ph-push') load(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.PHNotify = { open: open, close: close, reload: load };
})();
