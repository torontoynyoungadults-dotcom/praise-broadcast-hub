/**
 * 실시간 연결 (Socket.io 클라이언트 도우미)
 * ------------------------------------------------------------
 *  const rt = YNRT.create({ token, room: '2026-09-27' });
 *  rt.on('nav', fn) …   rt.call('nav', {...}) → Promise   rt.connect() / rt.close()
 *
 *  · 끊기면 자동으로 다시 접속하고, 다시 들어온 뒤 (방 입장 → 리더 상태 복원 → 밀린 필기 전송)
 *  · 오프라인일 때 보낸 필기(anno:add / anno:del)는 최대 300개까지 보관했다가 연결되면 순서대로 보냅니다
 *  · socket.io 스크립트를 못 불러오면 state = 'unavailable' — 앱은 혼자 쓰는 모드로 그대로 동작합니다
 * 상태(state): idle → connecting → online ⇄ offline / unavailable / denied (권한 없음 — 다시 시도 안 함)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNRT = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FWD = ['peers', 'leader', 'clicker', 'metro', 'nav', 'cue', 'lead', 'anno:add', 'anno:del', 'anno:clear', 'anno:live', 'anno:saved', 'cfg', 'song', 'songs:changed', 'timer'];
  var OUTBOX_MAX = 300, CALL_TIMEOUT = 8000;

  function create(opt) {
    opt = opt || {};
    var ioFn = opt.io || (typeof io !== 'undefined' ? io : null);
    var S = { state: ioFn ? 'idle' : 'unavailable', me: null, leader: null, clicker: null, metro: null, timer: null, peers: [], nav: null, offset: 0, socket: null, handlers: {}, outbox: [], joined: false, closed: false, lastError: '' };

    function emitLocal(name, a, b) { (S.handlers[name] || []).slice().forEach(function (fn) { try { fn(a, b); } catch (e) { if (typeof console !== 'undefined') console.warn('[rt:' + name + ']', e); } }); }
    function setState(s, why) { if (S.state === s && !why) return; S.state = s; S.lastError = why || ''; emitLocal('state', s, why || ''); }

    var api = {
      on: function (n, fn) { (S.handlers[n] = S.handlers[n] || []).push(fn); return api; },
      off: function (n, fn) { S.handlers[n] = (S.handlers[n] || []).filter(function (f) { return f !== fn; }); return api; },
      get state() { return S.state; }, get me() { return S.me; }, get leader() { return S.leader; }, get clicker() { return S.clicker; }, get metro() { return S.metro; }, get lead() { return S.lead; }, get peers() { return S.peers; }, get nav() { return S.nav; }, get timer() { return S.timer; },
      get online() { return S.state === 'online'; }, get error() { return S.lastError; },
      /** 서버 시각 (ms) — 큐 · 박자를 여러 기기에서 맞출 때 */
      serverNow: function () { return Date.now() + S.offset; },
      get isLeader() { return !!(S.me && S.leader && S.me.name === S.leader); },
      /** 클릭 컨트롤 (메트로놈) — 페이지 컨트롤(isLeader)과 별개 */
      get isClicker() { return !!(S.me && S.clicker && S.me.name === S.clicker); },

      connect: function () {
        if (!ioFn) { setState('unavailable', '실시간 도구(socket.io)를 불러오지 못했습니다'); return api; }
        if (S.socket) return api;
        S.closed = false; setState('connecting');
        var sock;
        try { sock = ioFn(opt.url || undefined, { path: opt.path || '/socket.io', transports: opt.transports || ['websocket', 'polling'], reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 8000, timeout: 12000 }); }
        catch (e) { setState('unavailable', '연결을 시작하지 못했습니다: ' + e.message); return api; }
        S.socket = sock;
        sock.on('connect', function () { join(); });
        sock.on('disconnect', function (why) {
          S.joined = false; if (!S.closed && S.state !== 'denied') setState('offline', why);
          // 서버가 먼저 끊은 경우(과속 차단 · 서버 정리)에는 socket.io 가 자동으로 다시 붙지 않으므로 직접 다시 시도합니다
          if (why === 'io server disconnect' && !S.closed && S.state !== 'denied') setTimeout(function () { try { if (S.socket === sock && !sock.connected) sock.connect(); } catch (e) {} }, 1500);
        });
        sock.on('connect_error', function (e) { if (!S.closed && S.state !== 'denied') setState(S.joined ? 'offline' : 'connecting', (e && e.message) || ''); });
        FWD.forEach(function (n) {
          sock.on(n, function (p) {
            if (n === 'peers') S.peers = p || [];
            if (n === 'leader') { S.leader = p && p.name || null; }
            if (n === 'clicker') { S.clicker = p && p.name || null; }
            if (n === 'metro') { if (p && S.metro && p.seq < S.metro.seq) return; S.metro = p || null; }
            if (n === 'nav') S.nav = p;
            if (n === 'lead') { if (p && S.lead && p.seq < S.lead.seq && p.by === S.lead.by) return; S.lead = p || null; }
            if (n === 'timer') { if (!p || (S.timer && p.sid === S.timer.sid && p.seq <= S.timer.seq)) return; S.timer = p; }   // 예배 타이머 — 더 새로운 것만
            emitLocal(n, p);
          });
        });
        return api;
      },

      /** 서버에 요청 → Promise (ack). 시간이 지나면 거절됩니다. */
      call: function (name, payload, o) {
        o = o || {};
        return new Promise(function (res, rej) {
          if (!S.socket || S.state === 'unavailable') return rej(new Error('실시간 연결이 없습니다'));
          if (!S.joined && name !== 'join') {
            if (o.queue) { queue(name, payload); return res({ ok: true, queued: true }); }
            return rej(new Error('아직 연결되지 않았습니다'));
          }
          var done = false, t = setTimeout(function () { if (done) return; done = true; if (o.queue) { queue(name, payload); res({ ok: true, queued: true }); } else rej(new Error('서버 응답이 없습니다')); }, o.timeout || CALL_TIMEOUT);
          try {
            S.socket.emit(name, payload || {}, function (r) {
              if (done) return; done = true; clearTimeout(t);
              if (r && r.ok === false) { var e = new Error(r.error || '처리하지 못했습니다'); e.code = r.code; e.res = r; return rej(e); }
              res(r || { ok: true });
            });
          } catch (e) { done = true; clearTimeout(t); rej(e); }
        });
      },
      /** 응답을 기다리지 않는 전송 (그리는 중인 선 등) — 연결이 없으면 조용히 버립니다 */
      fire: function (name, payload) { try { if (S.joined && S.socket) S.socket.volatile.emit(name, payload || {}); } catch (e) {} },

      claim: function (force) { return api.call('leader:claim', { force: !!force }); },
      release: function () { return api.call('leader:release', {}); },
      claimClick: function (force) { return api.call('click:claim', { force: !!force }); },
      releaseClick: function () { return api.call('click:release', {}); },
      /** 메트로놈 상태 보내기 (클릭 컨트롤만) — { playing, bpm, num, den, marks, count, keep } */
      sendMetro: function (st) { return api.call('metro', st || {}); },
      /** 예배 타이머 조작 보내기 (팀장 · 인도자만) — { action:'start'|'pause'|'segNext'|… } */
      /** V842 — 리드 상태(BPM · 박자 · 송폼 위치) 보내기 — 받는 쪽은 숫자 · 위치만 맞추고 소리는 내지 않음 */
      sendLead: function (st) { return api.call('lead', st || {}); },
      sendTimer: function (cmd) { return api.call('timer:cmd', cmd || {}); },
      close: function () { S.closed = true; try { if (S.socket) { S.socket.emit('leave', {}); S.socket.disconnect(); } } catch (e) {} S.socket = null; S.joined = false; S.me = null; S.leader = null; S.clicker = null; S.metro = null; S.timer = null; if (S.state !== 'unavailable') setState('idle'); },
      pending: function () { return S.outbox.length; }
    };

    function queue(name, payload) {
      if (name !== 'anno:add' && name !== 'anno:del' && name !== 'anno:clear') return;
      if (S.outbox.length >= OUTBOX_MAX) S.outbox.shift();
      S.outbox.push({ name: name, payload: payload });
      emitLocal('outbox', S.outbox.length);
    }

    function join() {
      var sock = S.socket; if (!sock) return;
      var t0 = Date.now();
      sock.emit('join', opt.light ? { token: opt.token, room: opt.room, light: true } : { token: opt.token, room: opt.room }, function (r) {
        if (!r || r.ok === false) {
          var denied = r && (r.code === 'auth' || r.code === 'room');
          S.joined = false;
          setState(denied ? 'denied' : 'offline', (r && r.error) || '방에 들어가지 못했습니다');
          if (denied) { S.closed = true; try { sock.disconnect(); } catch (e) {} S.socket = null; }
          else if (r && r.code === 'busy') setTimeout(function () { if (S.socket === sock && sock.connected) join(); }, 5000);
          return;
        }
        S.joined = true; S.me = r.you; S.leader = r.leader || null; S.clicker = r.clicker || null; S.metro = r.metro || null; S.peers = r.peers || []; S.nav = r.nav || null; S.timer = r.timer || null; S.lead = r.lead || null;
        if (r.serverTime) S.offset = r.serverTime + (Date.now() - t0) / 2 - Date.now();
        setState('online');
        emitLocal('joined', r);
        if (r.lead) emitLocal('lead', r.lead);
        if (r.timer) emitLocal('timer', r.timer);
        flush();
      });
    }
    function flush() {
      var list = S.outbox; S.outbox = [];
      emitLocal('outbox', 0);
      list.reduce(function (p, m) {
        return p.then(function () {
          return api.call(m.name, m.payload).then(function () { emitLocal('sent', m); }, function (e) {
            if (!e.code) queue(m.name, m.payload); else emitLocal('rejected', { msg: m, error: e });   // 서버가 거절한 것은 다시 보내지 않음
          });
        });
      }, Promise.resolve());
    }
    return api;
  }

  return { create: create, FWD: FWD };
}));
