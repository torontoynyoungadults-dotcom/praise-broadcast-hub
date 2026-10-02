/**
 * 허브 안의 다섯 탭(예배콘티 · 공지및모임 · 스케줄표 · 라이브러리 · 장비·수리)과 허브 홈·관리자 화면을
 * church-app의 탭(TABS/tab())처럼 "페이지를 새로 불러오지 않고" 그 자리에서 바꿔 끼웁니다.
 * - 같은 그룹의 링크를 누르면: fetch로 조각만 받아 #ph-tabbody 안을 교체 (풀 리로드 없음)
 * - 그 안의 폼을 제출하면: fetch로 보내고, 서버가 알려주는 주소를 다시 조각으로 받아 교체
 * - 자바스크립트가 꺼져 있거나 문제가 생기면: 그냥 평소처럼 실제 페이지 이동으로 자동 전환됨
 */
(function () {
  if (window.__phSpaBound) return; // 탭 전환 후 내용이 통째로 바뀌어도 document 레벨 리스너는 유지되므로 1번만 bind
  window.__phSpaBound = true;

  var SPA_PREFIXES = ['/conti', '/roster', '/notices', '/schedule', '/library', '/equipment', '/admin'];

  function isSpaPath(pathname) {
    if (pathname.indexOf('/conti/practice') === 0) return false; // 라이브 악보는 독립된 화면으로 그대로 둠
    if (pathname.indexOf('/schedule') === 0 || pathname.indexOf('/library') === 0) return false; // church-app 화면(스크립트 · 스타일 따로)은 페이지째 엶
    if (pathname === '/') return true;
    return SPA_PREFIXES.some(function (p) { return pathname.indexOf(p) === 0; });
  }

  /* V20 — 같은 화면에서 저장만 한 경우(점검 OK · 이상, 메모 저장 …)에는 맨 위로 튀지 않고 보던 자리 그대로.
     keepY 가 숫자면 그 높이로 되돌리고, 같은 주소는 기록(history)을 쌓지 않고 바꿔치기만 합니다. */
  function sameScreen(urlStr) {
    try {
      var u = new URL(urlStr, location.href);
      if (u.pathname !== location.pathname) return false;
      var cur = new URLSearchParams(location.search), nxt = u.searchParams, ok = true;
      cur.forEach(function (v, k) { if (k !== 'partial' && nxt.get(k) !== v) ok = false; });     // 지금 주소의 조건은 그대로여야 하고
      nxt.forEach(function (v, k) { if (k !== 'partial' && k !== 'team' && cur.get(k) !== v) ok = false; });   // 서버가 덧붙이는 team 만 새로 있어도 같은 화면
      return ok;
    } catch (e) { return false; }
  }
  function loadPartial(urlStr, push, keepY) {
    var sep = urlStr.indexOf('?') === -1 ? '?' : '&';
    var tabbody = document.getElementById('ph-tabbody');
    if (tabbody) tabbody.classList.add('ph-loading');
    fetch(urlStr + sep + 'partial=1', { headers: { 'X-PH-Partial': '1' }, credentials: 'same-origin' })
      .then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (!r.ok || ct.indexOf('application/json') === -1) throw new Error('not-partial');
        return r.json();
      })
      .then(function (d) {
        if (d && d.redirect) { loadPartial(d.redirect, push, keepY); return; }      // 서버가 "다른 화면으로" 라고 알려 줌 (첫 화면 → 예배콘티 등)
        if (!tabbody) { location.href = urlStr; return; }
        var same = typeof keepY === 'number' && sameScreen(urlStr);
        tabbody.innerHTML = d.html;
        tabbody.classList.remove('ph-loading');
        if (d.title) document.title = d.title;
        if (push && !same) history.pushState({ ph: true }, '', urlStr);
        else if (same) { try { history.replaceState({ ph: true }, '', urlStr); } catch (e) {} }
        window.scrollTo(0, same ? keepY : 0);
        document.dispatchEvent(new CustomEvent('ph:content-updated'));
      })
      .catch(function () { location.href = urlStr; });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.target && a.target !== '' && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.origin !== location.origin || !isSpaPath(url.pathname)) return;
    e.preventDefault();
    loadPartial(url.pathname + url.search, true);
  });

  // 파일 첨부가 있는 폼(enctype=multipart 또는 <input type=file>)만 FormData(=multipart)로 보내고,
  // 그 외 평범한 폼은 urlencoded로 보냅니다. fetch에 FormData를 그대로 넘기면 브라우저가 무조건
  // Content-Type을 multipart/form-data로 강제해버리는데, 서버의 폼 라우트 대부분은 그 포맷을 해석하는
  // multer 미들웨어가 없어서(파일이 없는 폼이라 안 붙여둠) req.body가 통째로 비어버리는 문제가 있었음
  // (관리자 설정 저장 등 여러 폼이 "눌러도 저장 안 되는" 상태였음 — 실제 브라우저 클릭 테스트로 발견).
  function needsMultipart(form) {
    var enctype = (form.getAttribute('enctype') || '').toLowerCase();
    if (enctype.indexOf('multipart') !== -1) return true;
    return !!form.querySelector('input[type=file]');
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var url;
    try { url = new URL(form.getAttribute('action') || location.pathname, location.href); } catch (err) { return; }
    if (url.origin !== location.origin || !isSpaPath(url.pathname)) return;
    var method = (form.getAttribute('method') || 'get').toUpperCase();
    e.preventDefault();
    if (method === 'GET') {
      var qs = new URLSearchParams(new FormData(form));
      loadPartial(url.pathname + '?' + qs.toString(), true);
      return;
    }
    var opts = { method: method, headers: { 'X-PH-Partial': '1' }, credentials: 'same-origin' };
    if (needsMultipart(form)) {
      opts.body = new FormData(form);
    } else {
      var usp = new URLSearchParams();
      new FormData(form).forEach(function (v, k) { usp.append(k, v); });
      opts.body = usp.toString();
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    var keepY = window.pageYOffset || document.documentElement.scrollTop || 0;
    fetch(url.pathname + url.search, opts)
      .then(function (r) { return r.json(); })
      .then(function (d) { loadPartial((d && d.redirect) || (url.pathname + url.search), true, keepY); })
      .catch(function () { form.submit(); });
  });

  window.addEventListener('popstate', function () {
    if (!isSpaPath(location.pathname)) { location.reload(); return; }      // 스케줄표 · 라이브러리 · 라이브 악보는 페이지째
    loadPartial(location.pathname + location.search, false);
  });
})();
