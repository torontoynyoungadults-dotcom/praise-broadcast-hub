/**
 * 찬양방송팀 허브 — 오프라인 일꾼 (church-app public/sw.js 의 오프라인 부분을 허브에 맞게 옮김).
 *
 * 인터넷이 끊겨도 예배 화면(콘티 · 라이브 악보)이 열리도록 화면 파일 · 페이지 · 악보 · 사진을 보관합니다.
 *   · 화면 파일(js/css/이미지/음원 큐) : 늘 서버에서 새로 받고, 못 받을 때만 보관해 둔 것을 씁니다 (?v= 가 달라도 같은 파일로 봄)
 *   · 페이지 : 허용한 화면(콘티 · 라이브 악보 · 홈 …)만, 열어 볼 때마다 새로 받고 못 받을 때 보관본을 보여 줍니다 (주소 전체가 열쇠)
 *   · 악보(/sheet/<id>) : 한 번 받으면 기기에 두고 바로 보여 줍니다 (Range 요청 · 같은 악보 동시 요청은 하나로)
 *   · 사진(/photo/<id>) : 한 번 받은 것은 기기에 두고 먼저 보여 줍니다
 *   · 미리 받기는 콘티 화면의 "오프라인용 다운로드" 를 눌렀을 때만 (public/js/offline.js)
 *   · 로그아웃(/logout)을 열면 보관해 둔 페이지 · 사진은 지웁니다 (개인 정보가 남지 않게)
 *   · 서버 호출(/api) · 녹음(/audio) · 실시간(/socket.io) 은 손대지 않습니다 (필기 · 콘티의 기기 보관은 offline.js)
 */
var VER = 'v1';
var SHELL = 'ph-shell-' + VER, PAGES = 'ph-pages-v1', SHEETS = 'ph-sheets-v1', PHOTOS = 'ph-photos-v1';
var KEEP = [SHELL, PAGES, SHEETS, PHOTOS];
var PAGES_MAX = 80, PHOTOS_MAX = 150;
/** 교회 앱 안(/praise/…)에서 돌 때는 범위의 앞머리를 떼고 PAGE_OK 로 봅니다 (따로 돌 때는 빈 값) */
var BASE = ''; try { BASE = new URL(self.registration.scope).pathname.replace(/\/$/, ''); } catch (e) {}
function rel(p) { return BASE && p.indexOf(BASE) === 0 ? (p.slice(BASE.length) || '/') : p; }

/** 보관할 수 있는 페이지 — 로그인 · 관리자 · 업로드/저장 같은 것은 제외 */
var PAGE_OK = /^\/($|conti(\/(practice|stage))?$|schedule(\/.*)?$|library(\/.*)?$|notices(\/.*)?$|events(\/.*)?$|roster(\/.*)?$|equipment(\/.*)?$|b\/[A-Za-z0-9_-]+(\/(conti|schedule|stage))?$)/;

self.addEventListener('install', function (e) { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return KEEP.indexOf(k) < 0 && /^(ph|yn)-/.test(k); }).map(function (k) { return caches.delete(k); })); })
      .catch(function () {}).then(function () { return self.clients.claim(); })
  );
});

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0D1A19;color:#F4EEDC;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">' +
    '<div><h3 style="margin:0 0 8px;">인터넷 연결을 확인해주세요</h3>' +
    '<p style="color:#C3CFC4;margin:0;">연결되면 새로고침해주세요.<br>"오프라인용 다운로드"를 해 둔 예배 화면은 연결 없이도 열립니다.</p></div>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function trim(cache, name) {
  var max = name === PAGES ? PAGES_MAX : name === PHOTOS ? PHOTOS_MAX : 0;
  if (!max) return null;
  return cache.keys().then(function (ks) { var over = ks.length - max; return over > 0 ? Promise.all(ks.slice(0, over).map(function (k) { return cache.delete(k); })) : null; });
}
function cacheable(res) {
  if (!res || res.status !== 200 || res.type === 'opaque') return false;
  try { if (res.redirected && /\/login\/?$/.test(new URL(res.url).pathname)) return false; } catch (e) {}      // 로그인 화면으로 돌려보낸 답은 보관하지 않음
  try { if (/\/login\/?$/.test(new URL(res.url).pathname)) return false; } catch (e) {}
  return true;
}

/** 서버 먼저 · 못 받으면(또는 timeout 안에 못 받으면) 보관해 둔 것 */
function netFirst(req, cacheName, timeout, key) {
  return caches.open(cacheName).then(function (cache) {
    var k = key || req;
    var net = fetch(req).then(function (res) {
      if (cacheable(res)) { var cp = res.clone(); cache.put(k, cp).then(function () { return trim(cache, cacheName); }).catch(function () {}); }
      return res;
    });
    net.catch(function () {});
    var timed = new Promise(function (resolve) {
      if (!timeout) return;
      setTimeout(function () { cache.match(k).then(function (hit) { if (hit) resolve(hit); }); }, timeout);   // 느린 인터넷: 보관본이 있으면 먼저 보여 줌
    });
    return Promise.race([net, timed].filter(Boolean)).catch(function () {
      return cache.match(k).then(function (hit) { if (hit) return hit; return net; });
    }).catch(function () { return cache.match(k); });
  });
}
/** 보관본이 있으면 바로 · 없으면 서버에서 받아 보관 */
function cacheFirst(req, cacheName, key) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(key || req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (cacheable(res)) { cache.put(key || req, res.clone()).then(function () { return trim(cache, cacheName); }).catch(function () {}); }
        return res;
      });
    });
  });
}

/** 보관해 둔 악보 전체를 Range 요청(부분 요청)에 맞게 잘라 줌 */
function rangeFrom(hit, range) {
  var m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!m) return hit;
  return hit.arrayBuffer().then(function (buf) {
    var total = buf.byteLength, start = m[1] === '' ? Math.max(0, total - parseInt(m[2], 10)) : parseInt(m[1], 10);
    var end = m[1] === '' || m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
    if (isNaN(start) || start >= total || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
    return new Response(buf.slice(start, end + 1), { status: 206, headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream', 'Content-Length': String(end - start + 1),
      'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Accept-Ranges': 'bytes' } });
  });
}
/** 같은 악보를 동시에 두 번 받지 않습니다 — 미리 받는 중에 뷰어가 같은 악보를 열면 그 내려받기를 같이 씀 */
var SHEET_INFLIGHT = {};
function sheetNet(req, url, c) {
  var p = SHEET_INFLIGHT[url];
  if (!p) {
    p = SHEET_INFLIGHT[url] = fetch(new Request(url, { credentials: 'same-origin' })).then(function (res) {
      if (res.status === 200) { c.put(url, res.clone()).catch(function () {}); }                               // 전체 응답만 보관 (부분 응답은 보관하지 않음)
      return res;
    });
    var done = function () { delete SHEET_INFLIGHT[url]; };
    p.then(done, done);
  }
  return p.then(function (res) { return res.clone(); });
}
function sheetFetch(event) {
  var req = event.request, u = new URL(req.url), url = u.pathname;
  if (/\/part$/.test(url)) url += u.search;                                                                   // 곡별 악보(/sheet/<id>/part?p=2-3)는 쪽 범위(?p=)가 곧 내용 — 빼면 전체 악보가 나옴
  return caches.open(SHEETS).then(function (c) {
    return c.match(url).then(function (hit) {
      if (hit) return req.headers.get('range') ? rangeFrom(hit, req.headers.get('range')) : hit;                 // 보관본이 있으면 바로
      if (req.headers.get('range')) return fetch(req);                                                         // 부분 요청은 그대로 서버로 (보관하지 않음)
      return sheetNet(req, url, c);
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var u; try { u = new URL(req.url); } catch (e) { return; }
  if (u.origin !== self.location.origin) return;
  var p = u.pathname;

  if (p === '/logout') {                                                                                       // 로그아웃: 개인 정보가 담긴 보관본을 지움 (악보 · 화면 파일은 그대로)
    event.waitUntil(Promise.all([caches.delete(PAGES), caches.delete(PHOTOS)]).catch(function () {}));
    return;
  }
  if (p.indexOf('/sheet/') === 0) { event.respondWith(sheetFetch(event).catch(function () { return new Response('offline', { status: 503 }); })); return; }
  if (p.indexOf('/photo/') === 0) {
    event.respondWith(cacheFirst(req, PHOTOS, u.pathname).catch(function () { return new Response('', { status: 504 }); }));
    return;
  }
  if (p.indexOf('/api/') === 0 || p.indexOf('/audio/') === 0 || p.indexOf('/cron') === 0 || p === '/sw.js' || p === '/healthz') return;
  if (p.indexOf('/socket.io/') === 0 && p !== '/socket.io/socket.io.js') return;                               // 실시간 연결은 그대로
  if (u.searchParams.get('partial') === '1' || req.headers.get('X-PH-Partial')) return;                        // 탭 전환용 조각 요청은 그대로 (끊기면 화면이 알아서 페이지째 엶)

  if (req.mode === 'navigate') {
    if (!PAGE_OK.test(rel(p))) return;
    event.respondWith(netFirst(req, PAGES, 9000, req.url).then(function (res) { return res || offlinePage(); }).catch(function () { return offlinePage(); }));
    return;
  }
  if (/\.(js|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|webmanifest|json|mp3)$/i.test(p)) {
    event.respondWith(netFirst(req, SHELL, 5000, u.origin + u.pathname).then(function (res) { return res || new Response('', { status: 504 }); }).catch(function () { return new Response('', { status: 504 }); }));
  }
});
