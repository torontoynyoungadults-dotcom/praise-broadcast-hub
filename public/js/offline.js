/**
 * 오프라인 저장소 — 인터넷이 끊겨도 콘티 · 라이브 악보 · 내 필기를 보고 쓸 수 있게 합니다
 * (church-app public/offline.js 를 허브에 맞게 옮김).
 *
 *   · IndexedDB('ph-offline') 의 kv 창고
 *       r|…  마지막으로 받은 서버 답 (곡 목록 · 쪽↔곡 연결 · 저장된 필기)
 *       o|…  아직 서버에 못 보낸 "내 필기" 저장 (연결되면 자동으로 보냄 — 같은 악보는 최신 것 하나만)
 *   · Cache Storage — 악보 'ph-sheets-v1' · 화면 파일 'ph-shell-v1' · 페이지 'ph-pages-v1' (서비스워커 /sw.js 가 돌려줌)
 *   · 이 파일이 없거나 IndexedDB · 서비스워커가 막혀도 앱은 예전처럼 동작합니다.
 *
 * window.YNOff — 라이브 악보 화면(live-boot.js 의 callServer)이 쓰는 이름은 church-app 과 같습니다.
 * window.YNOff.dl — "오프라인용 다운로드" (콘티 화면 public/js/conti-tools.js 가 단추 · 진행률을 그림)
 */
(function () {
  var DB = 'ph-offline', SHEETS = 'ph-sheets-v1', SHELL = 'ph-shell-v1', PAGES = 'ph-pages-v1', SHEET_MAX = 120, KEEP_MS = 90 * 86400000;
  var dbp = null, listeners = [], pending = 0, flushing = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      try {
        if (!window.indexedDB) return rej(new Error('no-idb'));
        var r = indexedDB.open(DB, 1);
        r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error || new Error('idb')); };
        r.onblocked = function () { rej(new Error('idb-blocked')); };
      } catch (e) { rej(e); }
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function run(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('kv', mode), st = t.objectStore('kv'), out = fn(st);
        t.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); };
        t.onerror = t.onabort = function () { rej(t.error || new Error('idb-tx')); };
      });
    });
  }
  function get(k) { return run('readonly', function (s) { return s.get(k); }); }
  function put(k, v) { return run('readwrite', function (s) { return s.put(v, k); }); }
  function del(k) { return run('readwrite', function (s) { return s.delete(k); }); }
  function list(prefix) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var out = [], t = db.transaction('kv', 'readonly'), c = t.objectStore('kv').openCursor(IDBKeyRange.bound(prefix, prefix + '￿'));
        c.onsuccess = function () { var x = c.result; if (x) { out.push({ key: x.key, value: x.value }); x.continue(); } };
        t.oncomplete = function () { res(out); };
        t.onerror = t.onabort = function () { rej(t.error || new Error('idb-list')); };
      });
    });
  }

  /* ---------- 어떤 호출을 기억하나 (첫 인자인 token 은 화면을 열 때마다 달라서 열쇠에 넣지 않습니다) ---------- */
  function readKey(name, args) {
    args = args || [];
    if (name === 'worshipAnnoLoad') return 'r|anno|' + args[1] + '|' + args[2] + '|' + (args[3] ? 1 : 0);
    if (name === 'worshipCfgLoad') return 'r|cfg|' + args[1];
    if (name === 'worshipSongsOf') return 'r|songs|' + args[1];
    return '';
  }
  function saveKey(args) { return 'o|' + (args && args[1]) + '|' + (args && args[2]); }

  function notify() { var s = state(); listeners.slice().forEach(function (f) { try { f(s); } catch (e) {} }); }
  function state() { return { online: typeof navigator === 'undefined' || navigator.onLine !== false, pending: pending }; }
  function recount() { return list('o|').then(function (a) { pending = a.length; notify(); return pending; }, function () { return 0; }); }

  /** 성공한 읽기 답을 기억 */
  function store(name, args, result) {
    var k = readKey(name, args); if (!k || result == null) return;
    var rec = { at: Date.now(), v: result };
    if (name === 'worshipAnnoLoad' && result && !Array.isArray(result.team)) {          // 내 필기만 받은 답 — 예전에 받은 팀 필기는 남겨 둠
      get(k).then(function (old) { if (old && old.v && Array.isArray(old.v.team)) { rec.v = Object.assign({}, result, { team: old.v.team }); } return put(k, rec); }).catch(function () {});
      return;
    }
    put(k, rec).catch(function () {});
  }
  /** 인터넷이 끊겼을 때 기억해 둔 답 (없으면 null). 아직 못 보낸 내 필기가 있으면 그것으로 덮어 보여 줌 */
  function fallback(name, args) {
    var k = readKey(name, args); if (!k) return Promise.resolve(null);
    return get(k).then(function (rec) {
      if (!rec || rec.v == null) return null;
      var v = rec.v;
      if (name === 'worshipAnnoLoad') {
        return get(saveKey(args)).then(function (o) {
          if (o && o.args && Array.isArray(o.args[3])) v = Object.assign({}, v, { mine: o.args[3] });
          return { result: v, at: rec.at };
        });
      }
      return { result: v, at: rec.at };
    }).catch(function () { return null; });
  }
  /** 내 필기 저장이 인터넷 문제로 실패했을 때 — 기기에 보관하고 "저장됨" 으로 처리 */
  function queueSave(name, args) {
    return put(saveKey(args), { name: name, args: args, at: Date.now(), fails: 0 }).then(function () { return recount(); }).then(function () { return true; }, function () { return false; });
  }
  function clearSave(args) { return del(saveKey(args)).then(recount, function () {}); }

  /** 보관해 둔 저장의 접속 토큰(args[0])은 3일 뒤 만료되므로, 지금 열려 있는 라이브 악보 화면의 새 토큰이 있으면 그것으로 바꿔 보냄 */
  function freshArgs(a) {
    a = (a || []).slice();
    try { if (window.__LIVE__ && window.__LIVE__.token) a[0] = window.__LIVE__.token; } catch (e) {}
    return a;
  }
  /** 보관해 둔 저장을 서버로 보냄 (연결되면 자동 · 필기를 불러오기 직전에도) */
  function flush() {
    if (flushing) return flushing;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(0);
    flushing = list('o|').then(function (rows) {
      var sent = 0;
      return rows.reduce(function (p, row) {
        return p.then(function (stop) {
          if (stop) return true;
          var o = row.value || {};
          return fetch('/api/' + encodeURIComponent(o.name), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ args: freshArgs(o.args) }) })
            .then(function (r) { return r.text(); })
            .then(function (t) {
              var d = null; try { d = JSON.parse(t); } catch (e) {}
              if (!d) return true;                                                       // 서버가 아직 준비 안 됨 — 다음에 다시
              return get(row.key).then(function (cur) {
                if (cur && cur.at !== o.at) return false;                                // 보내는 사이 더 새 필기가 저장됨 — 그것은 다음 차례에
                if (d.ok) { sent++; return del(row.key).then(function () { return false; }); }
                if (/만료|다시 열어/.test(String(d.error || ''))) return true;                // 접속 정보가 오래됨 — 라이브 악보를 새로 열면 새 토큰으로 보냄 (버리지 않음)
                o.fails = (o.fails || 0) + 1;                                            // 서버가 거절 (권한 등) — 5번까지 다시 해 보고 버림
                return (o.fails >= 5 ? del(row.key) : put(row.key, o)).then(function () { return false; });
              });
            }, function () { return true; });                                            // 인터넷 없음 — 멈춤
        });
      }, Promise.resolve(false)).then(function () { return sent; });
    }).then(function (n) { flushing = null; return recount().then(function () { return n; }); }, function () { flushing = null; return 0; });
    return flushing;
  }

  /* ================================================================ 오프라인용 다운로드
     · 기본은 꺼짐 — 인터넷이 잘 되면 악보는 열 때 바로 불러오고, 열어 본 것은 저절로 기기에 남습니다 (서비스워커).
     · "오프라인용 다운로드" 를 누르면: 서버가 알려 주는 계획(GET /conti/offline-plan)대로
       이 예배 앞뒤(지난주 ~ 앞으로 3주)의 콘티 · 라이브 악보 화면 + 화면 파일 · PDF 도구 + 악보를 기기에 받아 둡니다.
     · 진행률(%) · 받은 용량 · 완료 시각을 보여 주고, 지우면 받아 둔 것을 모두 지우고 다시 꺼집니다. */
  var DL_FLAG = 'ph.off.dl', POOL = 3;
  var CANCELLED = { cancelled: true };
  var DL = blank(), dlCancelFlag = false, dlRun = null, dlListeners = [];

  function blank() { return { state: 'idle', pct: 0, done: 0, total: 0, sheets: 0, sheetsDone: 0, pages: 0, bytes: 0, failed: 0, msg: '', quiet: false }; }
  function dlRecord() { try { return JSON.parse(localStorage.getItem(DL_FLAG) || 'null'); } catch (e) { return null; } }
  function dlSaveRecord(r) { try { if (r) localStorage.setItem(DL_FLAG, JSON.stringify(r)); else localStorage.removeItem(DL_FLAG); } catch (e) {} }
  function dlStatus() { return { state: DL.state, pct: DL.pct, done: DL.done, total: DL.total, sheets: DL.sheets, sheetsDone: DL.sheetsDone, pages: DL.pages, bytes: DL.bytes, failed: DL.failed, msg: DL.msg, quiet: DL.quiet, rec: dlRecord(), supported: !!(window.caches && window.isSecureContext !== false) }; }
  function dlNotify() { var s = dlStatus(); dlListeners.slice().forEach(function (f) { try { f(s); } catch (e) {} }); }
  function dlEnabled() { return !!dlRecord(); }
  function abs(u) { try { return new URL(u, location.href); } catch (e) { return null; } }

  /** 한 파일을 받으면서 진행 상황을 알립니다 (용량을 알면 %, 모르면 받은 만큼) */
  function dlFetch(url, onChunk) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok || r.status !== 200) throw new Error('HTTP ' + r.status);
      try { if (/\/login\/?$/.test(new URL(r.url).pathname)) throw new Error('login'); } catch (e) { if (e.message === 'login') throw e; }
      var type = r.headers.get('content-type') || 'application/octet-stream', total = Number(r.headers.get('content-length') || 0);
      if (!r.body || !r.body.getReader) return r.blob().then(function (b) { onChunk(b.size, total || b.size); return { blob: b, type: type }; });
      var rd = r.body.getReader(), parts = [], got = 0;
      return (function pump() {
        return rd.read().then(function (x) {
          if (x.done) return { blob: new Blob(parts, { type: type }), type: type };
          parts.push(x.value); got += x.value.length; onChunk(got, total);
          if (dlCancelFlag) { try { rd.cancel(); } catch (e) {} throw CANCELLED; }
          return pump();
        });
      })();
    });
  }
  function dlPut(cache, key, got) {
    return cache.put(key, new Response(got.blob, { status: 200, headers: { 'Content-Type': got.type, 'Content-Length': String(got.blob.size) } }));
  }
  function textOf(blob) { return new Promise(function (res) { try { var fr = new FileReader(); fr.onload = function () { res(String(fr.result || '')); }; fr.onerror = function () { res(''); }; fr.readAsText(blob); } catch (e) { res(''); } }); }
  /** 받은 페이지에서 같은 사이트의 스크립트 · 스타일 주소를 찾습니다 */
  function assetsOf(html) {
    var out = [], m, re = /<script\b[^>]*?\bsrc=["']([^"']+)["']|<link\b[^>]*?\bhref=["']([^"']+)["'][^>]*>/gi;
    while ((m = re.exec(html))) {
      var u = m[1] || m[2]; if (!u) continue;
      if (m[2] && !/rel=["'](stylesheet|manifest|icon|apple-touch-icon)/i.test(m[0])) continue;
      var a = abs(u); if (a && a.origin === location.origin) out.push(a.pathname);
    }
    return out;
  }

  /** 시작. opts = { team, date, event } (콘티 화면 단추의 data-*), quiet = 조용히(빠진 것만 채우기) */
  function dlStart(opts, quiet) {
    opts = opts || {};
    if (dlRun) return dlRun;
    if (!window.caches) { DL = Object.assign(blank(), { state: 'error', msg: '이 브라우저는 오프라인 저장을 지원하지 않습니다. (보안 연결 https 가 필요합니다)' }); dlNotify(); return Promise.resolve(false); }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { DL = Object.assign(blank(), { state: 'error', msg: '인터넷에 연결된 뒤에 눌러 주세요.' }); dlNotify(); return Promise.resolve(false); }
    dlCancelFlag = false;
    DL = Object.assign(blank(), { state: 'running', pct: 2, msg: '콘티를 확인하는 중…', quiet: !!quiet });
    dlNotify();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}                 // 기기가 마음대로 지우지 않게 요청
    var caches3, plan, seen = {}, unitDone = 0, frac = 0, pageRows = [];
    var bump = function () { DL.done = unitDone; DL.pct = DL.total ? Math.min(99, Math.round(3 + 96 * (unitDone + frac) / DL.total)) : 3; dlNotify(); };
    var qs = 'team=' + encodeURIComponent(opts.team || '') + (opts.event ? '&event=' + encodeURIComponent(opts.event) : '&date=' + encodeURIComponent(opts.date || ''));

    /** jobs 를 POOL 개씩 동시에 처리 */
    function pool(jobs, worker) {
      var i = 0;
      function next() {
        if (dlCancelFlag) throw CANCELLED;
        if (i >= jobs.length) return Promise.resolve();
        var j = jobs[i++];
        return Promise.resolve().then(function () { return worker(j); }).then(next);
      }
      var lanes = []; for (var n = 0; n < Math.min(POOL, jobs.length); n++) lanes.push(Promise.resolve().then(next));
      return Promise.all(lanes);
    }
    function oneJob(cache, key, url, count, isSheet, quietSkip) {
      return cache.match(key).then(function (hit) {
        if (hit && quietSkip) { if (isSheet) DL.bytes += Number(hit.headers.get('content-length') || 0); return null; }
        return dlFetch(url, function (got, total) { frac = total ? got / total : 0.5; bump(); })
          .then(function (got) { DL.bytes += got.blob.size; return dlPut(cache, key, got).then(function () { return got; }); })
          .catch(function (e) { if (e === CANCELLED) throw e; if (isSheet || !/^HTTP 404/.test(String(e && e.message))) DL.failed++; return null; });
      }).then(function (got) { if (count) { unitDone++; if (isSheet) DL.sheetsDone++; } frac = 0; bump(); return got; });
    }

    dlRun = fetch('/conti/offline-plan?' + qs, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (p) {
      if (!p || !p.ok) throw new Error((p && p.msg) || '준비하지 못했습니다.');
      plan = p;
      plan.pages = (plan.pages || []).map(function (u) { return u === '/' ? (window.PH_BASE || '') + '/' : u; });   // 홈 주소도 앞머리(/praise)에 맞춤
      return Promise.all([caches.open(PAGES), caches.open(SHELL), caches.open(SHEETS)]);
    }).then(function (cs) {
      caches3 = cs;
      var sheetIds = (plan.sheets || []).filter(function (x) { if (!x || seen['s' + x]) return false; return (seen['s' + x] = 1); });
      var extra = (plan.extra || []).filter(function (x) { if (seen[x]) return false; return (seen[x] = 1); });
      plan.sheets = sheetIds;
      DL.sheets = sheetIds.length; DL.pages = plan.pages.length;
      DL.total = plan.pages.length + extra.length + sheetIds.length; DL.msg = '받는 중…'; dlNotify();
      // 1) 페이지 (늘 새로 받음) — 받으면서 그 페이지가 쓰는 화면 파일 주소를 모읍니다
      var found = [];
      return pool(plan.pages, function (u) {
        var key = abs(u).href;
        return oneJob(caches3[0], key, u, true, false, false).then(function (got) { if (!got) return; return textOf(got.blob).then(function (t) { if (/<html/i.test(t)) found = found.concat(assetsOf(t)); }); });
      }).then(function () {
        found.forEach(function (p) { if (!seen[p] && /\.(js|css|png|jpe?g|svg|webp|ico|webmanifest|woff2?)$/i.test(p)) { seen[p] = 1; extra.push(p); } });
        DL.total = plan.pages.length + extra.length + sheetIds.length; bump();
        // 2) 화면 파일 · PDF 도구 · 음원 큐 (이미 있으면 건너뜀)
        return pool(extra, function (u) { return oneJob(caches3[1], location.origin + u.replace(/\?.*$/, ''), u, true, false, true); });
      }).then(function () {
        // 3) 악보 (이미 있으면 건너뜀)
        return pool(sheetIds, function (id) { var u = '/sheet/' + encodeURIComponent(id); return oneJob(caches3[2], u, u, true, true, true); });
      });
    }).then(function () {
      return caches.open(SHEETS).then(function (c) { return c.keys().then(function (keys) { var over = keys.length - SHEET_MAX; return over > 0 ? Promise.all(keys.slice(0, over).map(function (k) { return c.delete(k); })) : null; }); });
    }).then(function () {
      var okAll = DL.failed === 0;
      dlSaveRecord({ at: Date.now(), sheets: (plan.sheets || []).length, pages: plan.pages.length, bytes: DL.bytes, failed: DL.failed, team: opts.team || '', date: opts.date || '', event: opts.event || '' });
      DL.state = 'done'; DL.pct = 100; DL.msg = okAll ? '완료' : '완료 (일부 ' + DL.failed + '개는 받지 못했습니다)'; dlRun = null; dlNotify(); return true;
    }, function (e) {
      dlRun = null;
      if (e === CANCELLED) { DL.state = 'cancelled'; DL.msg = '취소했습니다'; }
      else { DL.state = 'error'; DL.msg = '받지 못했습니다: ' + ((e && e.message) || e); }
      dlNotify(); return false;
    });
    return dlRun;
  }
  function dlCancel() { dlCancelFlag = true; }
  /** 받아 둔 악보 · 화면 파일 · 페이지를 지우고 끕니다 */
  function dlClear() {
    dlCancelFlag = true;
    return (window.caches ? Promise.all([caches.delete(SHEETS), caches.delete(SHELL), caches.delete(PAGES)]) : Promise.resolve()).then(function () {
      dlSaveRecord(null); DL = blank(); dlRun = null; dlNotify(); return true;
    }, function () { return false; });
  }
  /** 한 번 받아 둔 기기에서 콘티 · 라이브 악보를 열 때 — 6시간에 한 번, 빠진 것만 조용히 채웁니다 */
  function dlRefill(opts) {
    var r = dlRecord();
    if (!r || dlRun || (Date.now() - (r.at || 0)) < 6 * 3600 * 1000) return Promise.resolve(false);
    if (typeof navigator === 'undefined' || navigator.onLine === false) return Promise.resolve(false);
    try { if (navigator.connection && navigator.connection.saveData) return Promise.resolve(false); } catch (e) {}
    return dlStart(opts, true);
  }

  /* ---------- 오래된 기억 청소 ---------- */
  function prune() {
    open().then(function (db) {
      var t = db.transaction('kv', 'readwrite'), c = t.objectStore('kv').openCursor(IDBKeyRange.bound('r|', 'r|￿'));
      c.onsuccess = function () { var x = c.result; if (x) { if (x.value && x.value.at && Date.now() - x.value.at > KEEP_MS) x.delete(); x.continue(); } };
    }).catch(function () {});
  }

  /* ---------- 서비스워커 등록 + 처음 한 번: 이 페이지도 보관 (서비스워커가 아직 없던 첫 방문) ---------- */
  function register() {
    try {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    } catch (e) {}
  }
  function cacheThisPage() {
    try {
      if (!('serviceWorker' in navigator) || !window.caches || navigator.serviceWorker.controller || !window.isSecureContext) return;
      var lp = location.pathname, PB = window.PH_BASE || ''; if (PB && lp.indexOf(PB) === 0) lp = lp.slice(PB.length) || '/';   // 교회 앱 안(/praise)에서 열려도 같은 규칙
      if (!/^\/(conti(\/practice)?)?$/.test(lp)) return;
      navigator.serviceWorker.ready.then(function () {
        return fetch(location.href, { credentials: 'same-origin' }).then(function (r) { if (r.ok) return caches.open(PAGES).then(function (c) { return c.put(location.href, r); }); });
      }).catch(function () {});
    } catch (e) {}
  }

  window.addEventListener('online', function () { notify(); flush(); });
  window.addEventListener('offline', notify);
  register();
  window.addEventListener('load', function () { setTimeout(function () { recount().then(function (n) { if (n) flush(); }); prune(); cacheThisPage(); }, 1200); });

  window.YNOff = {
    get: get, put: put, del: del, list: list,
    store: store, fallback: fallback, queueSave: queueSave, clearSave: clearSave, flush: flush,
    dl: { start: dlStart, cancel: dlCancel, clear: dlClear, status: dlStatus, enabled: dlEnabled, refill: dlRefill, on: function (f) { dlListeners.push(f); } },
    state: state, on: function (f) { listeners.push(f); }, recount: recount,
    isNetworkError: function (e) { return (typeof navigator !== 'undefined' && navigator.onLine === false) || !!(e && e.name === 'TypeError'); },
    /** 필기를 불러오기 직전에 밀린 저장이 있으면 먼저 보냄 (서버 것이 내 최신 필기를 덮어쓰지 않게) */
    before: function (name) { return name === 'worshipAnnoLoad' ? flush() : null; }
  };
})();
