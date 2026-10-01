/**
 * 예배 타이머 · 상태 막대 (Step 3.2 · Feature 1) — 예배 전체 시간 · 찬양 구간 시간 · 설교 시작 예상
 * ------------------------------------------------------------
 *  세 가지 시계
 *    1. 예배 경과   — 예배 시작부터 올라가는 시계 (시작 · 일시정지 · 다시 시작)
 *    2. 찬양 구간   — 지금 곡(구간)의 경과. 목표 시간을 정하면 남은 시간 · 초과 시간도 함께 보여줍니다
 *    3. 설교 시작   — 설교까지 남은 시간. 자동(남은 곡 수 × 곡당 시간) 또는 인도자가 정한 시각(수동)
 *
 *  · 상태는 서버가 하나만 가집니다 (lib/realtime.js). 시각(timestamp)으로 저장하므로 화면은 서버 시계(serverNow)로
 *    스스로 계산하고, 1초마다 서버와 주고받지 않습니다. 탭이 잠들었다 깨어도 항상 시각에서 다시 계산합니다.
 *  · 조작(시작 · 다음 곡 …)은 팀장 · 인도자(canLead)만 — 나머지는 읽기 전용 화면
 *  · 웹소켓이 주 통로. 끊기면 3초마다 HTTP(POST /api/worshipTimerGet · worshipTimerCmd)로 대신 동기화합니다.
 *  · 이 파일의 앞부분(순수 함수)은 서버(lib/realtime.js)도 그대로 씁니다 — 서버 · 화면이 같은 규칙으로 계산
 *
 *  YNTimer.mountBar({ host, token, getRoom | room, getPlan, variant:'hub' })   허브 화면 막대 (화면 아래에 떠 있음 — 위쪽 "세션 / 연습 시작" 막대와 겹치지 않도록)
 *  YNTimer.mountViewer(pvEl, { token, room, getPlan })                        세션 / 연습 화면 안 막대 (practice.js 가 부름)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.YNTimer = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ================================================================ 순수 계산 (서버 · 화면 공용) */
  var LIM = { maxSongs: 40, maxIdx: 99, maxTargetSec: 7200, perSongMin: 30, perSongMax: 1800, extraMin: -3600, extraMax: 7200,
    atPastMs: 3600e3, atFutureMs: 12 * 3600e3, maxAccMs: 24 * 3600e3, label: 40, title: 60 };
  var ACTIONS = ['start', 'pause', 'resume', 'reset', 'resetAll', 'segNext', 'segPrev', 'segGoto', 'segStart', 'segPause', 'segReset', 'segTarget', 'setPlan', 'setSermon', 'restore'];

  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }
  function has(v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); }
  function str(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function newState(now) {
    now = now || 0;
    return { sid: now.toString(36) + Math.random().toString(36).slice(2, 8), seq: 0, t: now, by: '',
      total: { running: false, startedAt: 0, accMs: 0 },
      seg: { idx: -1, label: '', running: false, startedAt: 0, accMs: 0, targetMs: null },
      sermon: { mode: 'auto', atMs: null, perSongSec: 300, extraSec: 0 },
      plan: { songs: [] } };
  }

  function cleanSongs(list) {
    var out = [];
    (Array.isArray(list) ? list : []).slice(0, LIM.maxSongs).forEach(function (x) {
      if (typeof x === 'string') x = { t: x };
      if (!x || typeof x !== 'object') return;
      out.push({ t: str(x.t != null ? x.t : x.title, LIM.title), sec: has(x.sec) ? Math.round(num(x.sec, 0, 3600, 0)) : 0 });
    });
    return out;
  }
  function planHash(songs) { return cleanSongs(songs).map(function (s) { return s.t + '|' + s.sec; }).join('\n'); }

  function cleanPart(x, now, running) {
    x = x && typeof x === 'object' ? x : {};
    var r = !!x.running, acc = Math.round(num(x.accMs, 0, LIM.maxAccMs, 0));
    var st = r ? Math.round(num(x.startedAt, now - LIM.maxAccMs, now, now)) : 0;
    void running;
    return { running: r, startedAt: st, accMs: acc };
  }

  /** 브라우저 · HTTP 로 온 조작 하나를 검사 · 정리 — 이상하면 null (숫자는 안전한 범위로, 글자는 다듬어서) */
  function cleanCmd(raw, now) {
    if (!raw || typeof raw !== 'object') return null;
    var a = String(raw.action || '');
    if (ACTIONS.indexOf(a) < 0) return null;
    now = now || Date.now();
    var c = { action: a };
    if (a === 'segGoto') { c.idx = Math.round(num(raw.idx, -1, LIM.maxIdx, 0)); c.label = str(raw.label, LIM.label); }
    else if (a === 'segTarget') c.targetSec = has(raw.targetSec) && Number(raw.targetSec) > 0 ? Math.round(num(raw.targetSec, 1, LIM.maxTargetSec, 300)) : 0;
    else if (a === 'setPlan') c.songs = cleanSongs(raw.songs);
    else if (a === 'setSermon') {
      if (raw.mode === 'auto' || raw.mode === 'manual') c.mode = raw.mode;
      if (has(raw.at)) c.at = Math.round(num(raw.at, now - LIM.atPastMs, now + LIM.atFutureMs, now));
      if (has(raw.inMin)) c.inMin = num(raw.inMin, 0, LIM.atFutureMs / 60000, 0);
      if (has(raw.perSongSec)) c.perSongSec = Math.round(num(raw.perSongSec, LIM.perSongMin, LIM.perSongMax, 300));
      if (has(raw.extraSec)) c.extraSec = Math.round(num(raw.extraSec, LIM.extraMin, LIM.extraMax, 0));
    } else if (a === 'restore') {
      var s = raw.state;
      if (!s || typeof s !== 'object' || !s.total || !s.seg) return null;
      c.state = {
        total: cleanPart(s.total, now),
        seg: Object.assign(cleanPart(s.seg, now), { idx: Math.round(num(s.seg.idx, -1, LIM.maxIdx, -1)), label: str(s.seg.label, LIM.label),
          targetMs: has(s.seg.targetMs) && Number(s.seg.targetMs) > 0 ? Math.round(num(s.seg.targetMs, 1000, LIM.maxTargetSec * 1000, 300000)) : null }),
        sermon: (function (m) { m = m && typeof m === 'object' ? m : {};
          return { mode: m.mode === 'manual' ? 'manual' : 'auto', atMs: has(m.atMs) ? Math.round(num(m.atMs, now - LIM.atPastMs, now + LIM.atFutureMs, now)) : null,
            perSongSec: Math.round(num(m.perSongSec, LIM.perSongMin, LIM.perSongMax, 300)), extraSec: Math.round(num(m.extraSec, LIM.extraMin, LIM.extraMax, 0)) }; }(s.sermon)),
        plan: { songs: cleanSongs(s.plan && s.plan.songs) } };
    }
    return c;
  }

  function elapsed(x, now) { return Math.max(0, (x.accMs || 0) + (x.running ? Math.max(0, now - x.startedAt) : 0)); }
  function pausePart(x, now) { if (x.running) { x.accMs = elapsed(x, now); x.running = false; x.startedAt = 0; } }
  function startPart(x, now) { if (!x.running) { x.running = true; x.startedAt = now; } }

  function songSec(s, i, songs) { return (songs[i] && songs[i].sec > 0) ? songs[i].sec : s.sermon.perSongSec; }

  /**
   * 설교 시작 예상 — 자동: 지금 + (지금 곡의 남은 시간) + (뒤에 남은 곡 × 곡당 시간) + 추가 시간 / 수동: 정해 둔 시각
   * fallback 은 서버에 곡 목록이 없을 때 이 화면이 가진 목록
   */
  function planSongs(s, fallback) { return s.plan.songs.length ? s.plan.songs : cleanSongs(fallback); }
  function sermonEstimate(s, now, fallback) {
    var m = s.sermon;
    if (m.mode === 'manual') return m.atMs == null ? { has: false, atMs: null, remainingMs: null, mode: 'manual' } : { has: true, atMs: m.atMs, remainingMs: m.atMs - now, mode: 'manual' };
    var songs = planSongs(s, fallback), n = songs.length, idx = s.seg.idx, rem = 0, i;
    if (idx < 0) { for (i = 0; i < n; i++) rem += songSec(s, i, songs) * 1000; }
    else if (idx < n) {
      var cur = s.seg.targetMs || songSec(s, idx, songs) * 1000;
      rem += Math.max(0, cur - elapsed(s.seg, now));
      for (i = idx + 1; i < n; i++) rem += songSec(s, i, songs) * 1000;
    }
    rem += m.extraSec * 1000;
    if (rem < 0) rem = 0;
    return { has: n > 0, atMs: n > 0 ? now + rem : null, remainingMs: n > 0 ? rem : null, mode: 'auto' };
  }

  function segLabel(s, fallback, idx) {
    idx = idx == null ? s.seg.idx : idx;
    if (s.seg.label) return s.seg.label;
    var songs = planSongs(s, fallback), n = songs.length;
    if (idx < 0) return '';
    if (n && idx >= n) return '찬양 종료';
    return (songs[idx] && songs[idx].t) || ('곡 ' + (idx + 1));
  }

  function goSeg(s, idx, label, now) {
    var n = s.plan.songs.length, max = n ? n : LIM.maxIdx;
    idx = Math.max(-1, Math.min(max, idx));
    var prevTarget = s.seg.targetMs;
    s.seg.idx = idx; s.seg.label = label || ''; s.seg.accMs = 0;
    var live = idx >= 0 && idx < (n || LIM.maxIdx + 1);
    s.seg.running = live; s.seg.startedAt = live ? now : 0;
    var planned = idx >= 0 && idx < n && s.plan.songs[idx].sec > 0 ? s.plan.songs[idx].sec * 1000 : 0;
    s.seg.targetMs = idx < 0 ? null : (planned || prevTarget || null);          // 목표 시간은 다음 곡으로 넘어가도 이어집니다 (곡마다 정한 시간이 있으면 그것)
  }

  function core(s) { return JSON.stringify([s.total, s.seg, s.sermon, s.plan]); }

  /**
   * 조작 하나를 적용 — { state, changed }  (바뀐 게 없으면 seq 를 올리지 않습니다)
   * cmd 는 cleanCmd 를 거친 것이어야 합니다. now = 서버 시각(ms), by = 조작한 사람
   */
  function applyCmd(prev, cmd, now, by) {
    var s = JSON.parse(JSON.stringify(prev)), before = core(prev), a = cmd.action;
    if (a === 'start' || a === 'resume') startPart(s.total, now);
    else if (a === 'pause') pausePart(s.total, now);
    else if (a === 'reset') s.total = { running: false, startedAt: 0, accMs: 0 };
    else if (a === 'resetAll') { s.total = { running: false, startedAt: 0, accMs: 0 }; s.seg = { idx: -1, label: '', running: false, startedAt: 0, accMs: 0, targetMs: null }; }
    else if (a === 'segNext') goSeg(s, s.seg.idx + 1, '', now);
    else if (a === 'segPrev') goSeg(s, s.seg.idx - 1, '', now);
    else if (a === 'segGoto') goSeg(s, cmd.idx, cmd.label, now);
    else if (a === 'segStart') {
      if (s.seg.idx < 0) goSeg(s, 0, '', now);
      else if (!s.plan.songs.length || s.seg.idx < s.plan.songs.length) startPart(s.seg, now);
    }
    else if (a === 'segPause') pausePart(s.seg, now);
    else if (a === 'segReset') { s.seg.accMs = 0; s.seg.startedAt = s.seg.running ? now : 0; }
    else if (a === 'segTarget') s.seg.targetMs = cmd.targetSec > 0 ? cmd.targetSec * 1000 : null;
    else if (a === 'setPlan') s.plan.songs = cmd.songs;
    else if (a === 'setSermon') {
      var m = s.sermon;
      if (cmd.perSongSec != null) m.perSongSec = cmd.perSongSec;
      if (cmd.extraSec != null) m.extraSec = cmd.extraSec;
      if (cmd.at != null) { m.mode = 'manual'; m.atMs = cmd.at; }
      else if (cmd.inMin != null) { m.mode = 'manual'; m.atMs = Math.round(now + cmd.inMin * 60000); }
      else if (cmd.mode === 'manual') { if (m.atMs == null) { m.atMs = sermonEstimate({ seg: s.seg, plan: s.plan, sermon: Object.assign({}, m, { mode: 'auto' }) }, now).atMs; } m.mode = 'manual'; }
      else if (cmd.mode === 'auto') { m.mode = 'auto'; m.atMs = null; }
    }
    else if (a === 'restore') {
      if (prev.seq !== 0) return { state: prev, changed: false };          // 서버가 아직 아무 조작도 받지 않았을 때만 (재시작 뒤 복구)
      s.total = cmd.state.total; s.seg = cmd.state.seg; s.sermon = cmd.state.sermon; s.plan = cmd.state.plan;
    }
    if (core(s) === before) return { state: prev, changed: false };
    s.seq = prev.seq + 1; s.t = now; s.by = String(by || '');
    return { state: s, changed: true };
  }

  /** 화면에 그릴 값 — 모두 시각에서 계산 (now = 서버 시각) */
  function view(s, now, fallback) {
    var songs = planSongs(s, fallback), n = songs.length, idx = s.seg.idx;
    var segMs = elapsed(s.seg, now), tgt = s.seg.targetMs;
    var est = sermonEstimate(s, now, fallback);
    return {
      total: { ms: elapsed(s.total, now), running: s.total.running, started: s.total.running || s.total.accMs > 0 },
      seg: { idx: idx, n: n, label: segLabel(s, fallback), ms: segMs, running: s.seg.running, targetMs: tgt, remainingMs: tgt ? tgt - segMs : null, over: !!(tgt && segMs > tgt), done: n > 0 && idx >= n, active: idx >= 0 },
      sermon: est, by: s.by || '', seq: s.seq
    };
  }

  /* ---- 글자 ---- */
  function hms(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r);
  }
  function fmtElapsed(ms) { return hms(ms / 1000); }
  /** 남은 시간 — 0 이 되기 직전까지 올림, 지나면 { over:true, text:'+0:23' } */
  function fmtCountdown(ms) {
    if (ms == null || !isFinite(ms)) return { text: '--:--', over: false };
    if (ms >= 0) return { text: hms(Math.ceil(ms / 1000)), over: false };
    return { text: '+' + hms(Math.floor(-ms / 1000)), over: true };
  }
  function fmtClock(ms) {
    if (ms == null || !isFinite(ms)) return '';
    var d = new Date(ms), h = d.getHours();
    return (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + pad2(d.getMinutes());
  }

  /** 온 상태를 받아들일지 — 서버가 다시 시작해 새 상태(sid 가 다름)면 무조건, 아니면 더 새로운 seq 만 */
  function accept(cur, inc) {
    if (!inc || typeof inc !== 'object' || typeof inc.seq !== 'number' || !inc.total || !inc.seg || !inc.sermon || !inc.plan) return false;
    if (!cur) return true;
    if (inc.sid !== cur.sid) return true;
    return inc.seq > cur.seq;
  }

  /* ================================================================ 연결 (웹소켓 + HTTP 대체) — 화면 여러 개가 하나를 나눠 씁니다 */
  var REG = {};
  function lsGet(k) { try { return root.localStorage && root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage && root.localStorage.setItem(k, v); } catch (e) {} }

  function createController(opt) {
    opt = opt || {};
    var pollMs = opt.pollMs || 3000;
    var C = { state: null, me: null, offset: 0, denied: false, lastPollOk: 0, lastRestore: 0, subs: [], plans: [], stopped: false, pollT: null, pingT: null, lastLocalHash: null, pushedHash: null, pushT: null, planT: null, err: '' };
    var rt = null;
    var fetchFn = opt.fetchFn || (root.fetch ? function (u, o) { return root.fetch(u, o); } : null);
    var room = opt.room, token = opt.token;

    function emit() { C.subs.slice().forEach(function (fn) { try { fn(api); } catch (e) { if (typeof console !== 'undefined') console.warn('[timer]', e); } }); }
    function serverNow() { return Date.now() + C.offset; }
    function fallbackSongs() { var p = C.plans.length ? C.plans[C.plans.length - 1]() : null; return p && p.songs ? p.songs : []; }
    function localPlan() { var p = C.plans.length ? C.plans[C.plans.length - 1]() : null; return p && Array.isArray(p.songs) && (!p.room || p.room === room) ? cleanSongs(p.songs) : null; }
    function pushBlocked() { var p = C.plans.length ? C.plans[C.plans.length - 1]() : null; return !!(p && p.noPush); }     // 지난 주 콘티를 훑어보는 것만으로 서버에 타이머를 만들지 않도록
    function storeKey() { return 'yn.tm.' + room; }

    function take(st, why) {
      if (!accept(C.state, st)) return false;
      var prev = C.state;
      C.state = st; C.err = '';
      if (me() && me().canLead) {                                          // 서버가 다시 시작돼 텅 빈 상태가 됐다면, 이 기기가 기억하는 마지막 상태로 되살립니다
        var snap = prev && prev.sid !== st.sid ? prev : null;
        if (!snap && st.seq === 0) { try { snap = JSON.parse(lsGet(storeKey()) || 'null'); } catch (e) { snap = null; } if (snap && Date.now() - (snap.t || 0) > LIM.atFutureMs) snap = null; }
        if (st.seq === 0 && snap && (snap.total && (snap.total.running || snap.total.accMs > 0) || snap.seg && snap.seg.idx >= 0) && Date.now() - C.lastRestore > 5000) {
          C.lastRestore = Date.now();
          send({ action: 'restore', state: snap }).catch(function () {});
        }
      }
      if (st.seq > 0) lsSet(storeKey(), JSON.stringify(st));
      emit(); schedulePush();
      void why;
      return true;
    }
    function me() { return C.me; }

    /* ---- 곡 목록 자동 맞춤 (팀장 · 인도자 화면만) — 내가 콘티를 고쳤거나 서버에 목록이 아직 없을 때만 보냅니다 (여럿이 서로 덮어쓰지 않게) ---- */
    function schedulePush() {
      if (C.pushT || C.stopped) return;
      C.pushT = setTimeout(function () { C.pushT = null; maybePush(); }, 700);
    }
    function maybePush() {
      if (!C.state || !C.me || !C.me.canLead) return;
      var songs = localPlan(); if (!songs || !songs.length || pushBlocked()) return;
      var h = planHash(songs), serverH = planHash(C.state.plan.songs);
      var changed = C.lastLocalHash !== null && h !== C.lastLocalHash, empty = !C.state.plan.songs.length;
      C.lastLocalHash = h;
      if (h === serverH || h === C.pushedHash) return;
      if (empty || changed) { C.pushedHash = h; send({ action: 'setPlan', songs: songs }).catch(function () { C.pushedHash = null; }); }
    }

    /* ---- 서버 통신 ---- */
    function url(fn) { return (opt.base || '') + '/api/' + fn; }
    function post(fn, args) {
      if (!fetchFn) return Promise.reject(new Error('연결할 수 없습니다'));
      var t0 = Date.now(), ac = root.AbortController ? new root.AbortController() : null, tm = ac ? setTimeout(function () { try { ac.abort(); } catch (e) {} }, 6000) : null;
      return fetchFn(url(fn), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: args }), signal: ac ? ac.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (tm) clearTimeout(tm);
          var t1 = Date.now();
          if (!j || j.ok === false) { var e = new Error((j && j.error) || '처리하지 못했습니다'); e.code = j && j.code; throw e; }
          var res = j.result || {};
          if (res.serverTime) C.offset = res.serverTime + (t1 - t0) / 2 - t1;
          if (res.you) C.me = res.you;
          return res;
        }, function (e) { if (tm) clearTimeout(tm); throw e; });
    }
    function pollOnce() {
      var cur = C.state;
      return post('worshipTimerGet', [token, room, cur ? cur.sid : '', cur ? cur.seq : -1]).then(function (r) {
        C.lastPollOk = Date.now();
        if (r.state) take(r.state, 'poll'); else emit();
      }, function (e) {
        if (e && e.code === 'auth') { C.denied = true; C.err = e.message; }
        emit();
      });
    }
    function pollLoop() {
      C.pollT = null; if (C.stopped) return;
      var online = rt && rt.state === 'online';
      if (online || C.denied) { C.pollT = setTimeout(pollLoop, pollMs); return; }
      pollOnce().then(function () { if (!C.stopped) C.pollT = setTimeout(pollLoop, pollMs); });
    }
    function startPoll(delay) { if (C.stopped) return; if (C.pollT) clearTimeout(C.pollT); C.pollT = setTimeout(pollLoop, delay); }

    /** 조작 보내기 — 웹소켓이 되면 그쪽, 아니면(또는 응답이 없으면) HTTP */
    function send(cmd) {
      cmd = Object.assign({}, cmd);
      function viaHttp() { return post('worshipTimerCmd', [token, room, cmd]).then(function (r) { C.lastPollOk = Date.now(); if (r.state) take(r.state, 'cmd'); return Object.assign({ ok: true }, r); }); }
      if (rt && rt.state === 'online') {
        return rt.call('timer:cmd', cmd).then(function (r) { if (r && r.serverTime) C.offset = r.serverTime - Date.now(); if (r && r.state) take(r.state, 'cmd'); return r; },
          function (e) { if (e && e.code) throw e; return viaHttp(); });
      }
      return viaHttp();
    }

    function pingClock() {
      if (!rt || rt.state !== 'online') return;
      var t0 = Date.now();
      rt.call('ping', {}).then(function (r) { if (r && r.t) { var t1 = Date.now(); C.offset = r.t + (t1 - t0) / 2 - t1; } }, function () {});
    }

    var api = {
      get state() { return C.state; }, get me() { return C.me; }, get room() { return room; }, get canLead() { return !!(C.me && C.me.canLead); },
      get error() { return C.err; },
      now: serverNow,
      /** 'socket' | 'poll' | 'offline' | 'denied' | 'connecting' */
      get status() {
        if (C.denied || (rt && rt.state === 'denied')) return 'denied';
        if (rt && rt.state === 'online') return 'socket';
        if (Date.now() - C.lastPollOk < pollMs * 2.5) return 'poll';
        if (!C.state) return root.navigator && root.navigator.onLine === false ? 'offline' : 'connecting';
        return 'offline';
      },
      view: function () { return C.state ? view(C.state, serverNow(), fallbackSongs()) : null; },
      songs: function () { return C.state ? planSongs(C.state, fallbackSongs()) : cleanSongs(fallbackSongs()); },
      on: function (fn) { C.subs.push(fn); return function () { C.subs = C.subs.filter(function (f) { return f !== fn; }); }; },
      send: send,
      addPlan: function (fn) { C.plans.push(fn); schedulePush(); },
      removePlan: function (fn) { C.plans = C.plans.filter(function (f) { return f !== fn; }); },
      poll: pollOnce,
      stop: function () {
        C.stopped = true; clearTimeout(C.pollT); clearInterval(C.pingT); clearInterval(C.planT); clearTimeout(C.pushT);
        if (rt) { try { rt.close(); } catch (e) {} }
        C.subs = []; rt = null;
      },
      start: function () {
        C.planT = setInterval(schedulePush, 1500);                         // 콘티를 고쳤는지 살핌 (인도자 화면만 실제로 보냄)
        if (C.planT.unref) C.planT.unref();
        var YR = opt.YNRT || root.YNRT;
        if (YR && (opt.io || root.io || opt.rt)) {
          rt = opt.rt || YR.create({ token: token, room: room, io: opt.io, url: opt.url, light: true });
          rt.on('state', function () { if (rt.state !== 'online') startPoll(rt.state === 'unavailable' ? 0 : 1500); emit(); });
          rt.on('joined', function (r) {
            if (r.you) C.me = r.you;
            C.offset = rt.serverNow() - Date.now();
            if (r.timer) take(r.timer, 'join'); else emit();
            maybePush();
          });
          rt.on('timer', function (st) { take(st, 'push'); });
          if (!opt.rt) rt.connect();
          C.pingT = setInterval(pingClock, 60000);
          startPoll(rt.state === 'unavailable' ? 0 : 1500);
        } else startPoll(0);
        return api;
      },
      /** 시험 · 진단용 */
      _rt: function () { return rt; }
    };
    return api;
  }

  /** 같은 (토큰, 예배) 는 연결 하나를 나눠 씁니다 — 허브 막대와 세션 화면 막대가 함께 있어도 소켓은 하나 */
  function acquire(opt) {
    var k = String(opt.token) + '|' + String(opt.room);
    var e = REG[k];
    if (!e) { e = REG[k] = { n: 0, c: createController(opt).start() }; }
    e.n++;
    return { c: e.c, release: function () { if (e.n > 0 && --e.n === 0) { e.c.stop(); if (REG[k] === e) delete REG[k]; } } };
  }

  /* ================================================================ 화면 (막대 · 방송 모드) — 브라우저에서만 */
  var IC = {
    clock: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 1.6M9.5 2.5h5"/>',
    music: '<path d="M9 18.2V5.6l10.5-2v12.6"/><circle cx="6.2" cy="18.2" r="2.8"/><circle cx="16.7" cy="16.2" r="2.8"/>',
    book: '<path d="M12 7.2C10.4 5.8 8.2 5 5.8 5H3v13h2.8c2.4 0 4.6.8 6.2 2.2M12 7.2C13.6 5.8 15.8 5 18.2 5H21v13h-2.8c-2.4 0-4.6.8-6.2 2.2M12 7.2v13"/>',
    play: '<path d="M7.5 4.8v14.4l11.5-7.2z" fill="currentColor"/>',
    pause: '<path d="M8.5 5v14M15.5 5v14" stroke-width="3"/>',
    next: '<path d="M5 5.5v13l10-6.5zM19 5v14"/>',
    prev: '<path d="M19 5.5v13L9 12zM5 5v14"/>',
    reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2L3.5 8.5M3.5 3.5v5h5"/>',
    expand: '<path d="M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  function svg(k, cls) { return '<svg class="' + (cls || 'yt-i') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + IC[k] + '</svg>'; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var CSS = '' +
    '.yt-bar,.yt-panel{--yt-bg:rgba(16,16,23,.86);--yt-bg2:rgba(255,255,255,.07);--yt-line:rgba(255,255,255,.2);--yt-ink:#fff;--yt-sub:#d8d3cb;--yt-a:#ff8a2a;--yt-a2:#ffb066;--yt-ok:#5fe39b;--yt-warn:#ffc04d;--yt-bad:#ff7a7a;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",Roboto,sans-serif;color:var(--yt-ink);box-sizing:border-box}' +
    '.yt-bar *,.yt-panel *{box-sizing:border-box}' +
    '.yt-bar{display:flex;align-items:stretch;gap:6px;padding:6px;border-radius:18px;background:var(--yt-bg);border:1px solid var(--yt-line);' +
      'backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);box-shadow:0 8px 26px rgba(0,0,0,.28);width:100%;max-width:100%}' +
    /* 허브: 화면 아래에 떠 있는 막대 (맨 위는 "세션 / 연습 시작" 막대가 이미 붙어 있어서 겹치지 않게). 내용은 body 아래 여백으로 가려지지 않게 */
    '.yt-hub{position:fixed;left:50%;transform:translateX(-50%);bottom:max(8px,env(safe-area-inset-bottom,0px));width:min(680px,calc(100% - 16px));z-index:60;margin:0}' +
    'body.yt-hub-on{padding-bottom:calc(var(--yt-hub-h,0px) + 26px + env(safe-area-inset-bottom,0px))}' +
    'body.yt-hub-on .ynpwa-bar,body.yt-hub-on .ynpwa-ask{bottom:calc(var(--yt-hub-h,0px) + 20px + env(safe-area-inset-bottom,0px))!important}' +
    'body.pv-lock .yt-hub,body.yt-typing .yt-hub{display:none}' +
    '.yt-hub .yt-toast{top:auto;bottom:calc(100% + 6px)}' +
    '.yt-viewer{position:relative;flex:none;z-index:31;border-radius:0;border-width:0 0 1px;box-shadow:none;padding:4px 8px}' +
    '.pv-fs .yt-viewer{padding-top:max(4px,env(safe-area-inset-top))}' +
    '.pv-fs .pv-fsbar{top:var(--yt-h,0px)!important}.pv-fs .pv-fshandle{top:var(--yt-h,0px)!important}' +
    '.yt-chips{flex:1 1 auto;min-width:0;display:flex;gap:6px}' +
    '.yt-chips .yt-chip{flex:1 0 auto}.yt-chip[hidden],.yt-bar .yt-ser{display:none!important}' +
    '.yt-bar .yt-setb{display:inline-flex}' +
    '.yt-setpop{position:absolute;right:8px;bottom:calc(100% + 6px);z-index:6;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:16px;background:rgba(16,16,23,.97);border:1px solid var(--yt-line);box-shadow:0 10px 30px rgba(0,0,0,.4)}' +
    '.yt-setpop[hidden]{display:none}.yt-viewer .yt-setpop{bottom:auto;top:calc(100% + 6px)}' +
    '.yt-setrow{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:var(--yt-ink);white-space:nowrap}' +
    '.yt-setrow .yt-tm{min-height:38px;font-size:15px}.yt-sethelp{margin:0;font-size:11.5px;color:var(--yt-sub);max-width:260px;white-space:normal}' +
    '.yt-chip{position:relative;min-width:0;display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:13px;background:var(--yt-bg2);border:1px solid transparent;transition:background .2s,border-color .2s}' +
    '.yt-chip>.yt-i{flex:none;width:17px;height:17px;color:var(--yt-a2)}' +
    '.yt-tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;line-height:1.15}' +
    '.yt-l{font-size:10.5px;font-weight:700;letter-spacing:.02em;color:var(--yt-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.yt-v{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em;white-space:nowrap}' +
    '.yt-s{font-size:10.5px;font-weight:700;color:var(--yt-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}' +
    '.yt-chip.run{border-color:rgba(255,138,42,.6);background:rgba(255,138,42,.14)}' +
    '.yt-chip.over .yt-v,.yt-chip.over .yt-s{color:var(--yt-bad)}.yt-chip.soon .yt-v{color:var(--yt-warn)}' +
    '.yt-chip.idle .yt-v{color:#efeae3}' +
    '.yt-ib{flex:none;display:none;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border-radius:50%;border:1px solid var(--yt-line);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font:inherit;-webkit-tap-highlight-color:transparent}' +
    '.yt-ib .yt-i{width:15px;height:15px}' +
    '.yt-ib:hover{background:rgba(255,255,255,.2)}.yt-ib:active{transform:scale(.92)}' +
    '.yt-ib:focus-visible,.yt-btn:focus-visible,.yt-in:focus-visible,.yt-tab:focus-visible{outline:2px solid var(--yt-a2);outline-offset:2px}' +
    '.yt-ib.pri{background:linear-gradient(135deg,#ff9d47,#ff7a1c);color:#1a0f05;border-color:transparent}' +
    '.yt-lead .yt-ctl{display:inline-flex}' +
    '.yt-side{flex:none;display:flex;align-items:center;gap:4px}' +
    '.yt-sync{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--yt-sub);white-space:nowrap}' +
    '.yt-sync i{width:9px;height:9px;border-radius:50%;background:#8a857d;flex:none}' +
    '.yt-sync[data-s=socket] i,.yt-sync[data-s=poll] i{background:var(--yt-ok);box-shadow:0 0 0 3px rgba(95,227,155,.18)}' +
    '.yt-sync[data-s=poll] i{background:var(--yt-warn);box-shadow:0 0 0 3px rgba(255,192,77,.18)}' +
    '.yt-sync[data-s=offline] i,.yt-sync[data-s=denied] i{background:var(--yt-bad);box-shadow:0 0 0 3px rgba(255,122,122,.18)}' +
    '.yt-exp{display:inline-flex}.yt-ph .yt-sync{font-size:13px}.yt-ph .yt-sync b{display:inline}' +
    '.yt-minb{display:inline-flex}' +
    '.yt-mini .yt-chip:not(.yt-total),.yt-mini .yt-sync b,.yt-mini .yt-exp,.yt-mini .yt-setb{display:none!important}' +
    '.yt-mini .yt-chip{padding:3px 8px}.yt-mini .yt-s{display:none}.yt-mini .yt-v{font-size:17px}' +
    '.yt-hub.yt-mini{left:auto;right:max(10px,env(safe-area-inset-right,0px));transform:none;width:auto;min-width:0}' +
    '.yt-toast{position:absolute;left:8px;right:8px;top:calc(100% + 6px);padding:8px 12px;border-radius:12px;background:rgba(60,18,18,.96);border:1px solid rgba(255,122,122,.6);color:#ffdada;font-size:13px;font-weight:700;z-index:2}' +
    '.yt-toast[hidden]{display:none}' +
    '.sr-only-yt{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    '@media (max-width:520px){' +
      '.yt-bar{gap:4px;padding:5px;border-radius:16px}.yt-chips{gap:4px}.yt-chip{padding:4px 6px;gap:4px;border-radius:12px}.yt-chip>.yt-i{display:none}' +
      '.yt-v{font-size:16px}.yt-s{display:none}.yt-ib{width:26px;height:26px}.yt-ib .yt-i{width:13px;height:13px}' +
      '.yt-sync b{display:none}.yt-side{gap:2px}.yt-viewer{padding:3px 6px}' +
      '.yt-v.lg{font-size:13px;letter-spacing:-.02em}' +
    '}' +
    '@media (max-width:360px){.yt-v{font-size:14.5px}.yt-v.lg{font-size:12px}.yt-ib{width:24px;height:24px}}' +
    /* 방송 모드 */
    '.yt-panel{position:fixed;inset:0;z-index:3500;display:flex;flex-direction:column;background:radial-gradient(900px 520px at 85% -10%,rgba(255,138,42,.22),transparent 60%),radial-gradient(700px 500px at -10% 110%,rgba(108,79,211,.2),transparent 60%),#0a0a0f;overflow:auto;-webkit-overflow-scrolling:touch}' +
    '.yt-ph{flex:none;display:flex;align-items:center;gap:10px;padding:max(12px,env(safe-area-inset-top)) 16px 10px}' +
    '.yt-ph h2{margin:0;font-size:17px;font-weight:800;flex:1;letter-spacing:-.01em}' +
    '.yt-pb{flex:1;display:flex;flex-direction:column;gap:14px;padding:6px 16px max(22px,env(safe-area-inset-bottom));max-width:1180px;width:100%;margin:0 auto}' +
    '.yt-big{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}' +
    '.yt-card{position:relative;padding:16px 18px;border-radius:22px;background:rgba(255,255,255,.07);border:1px solid var(--yt-line);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:flex;flex-direction:column;gap:2px;min-width:0}' +
    '.yt-card.run{border-color:rgba(255,138,42,.65);box-shadow:0 0 0 3px rgba(255,138,42,.14)}' +
    '.yt-card.over .yt-bv,.yt-card.over .yt-bs{color:var(--yt-bad)}.yt-card.soon .yt-bv{color:var(--yt-warn)}' +
    '.yt-bl{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;color:var(--yt-a2)}.yt-bl .yt-i{width:20px;height:20px}' +
    '.yt-bv{font-size:clamp(52px,12vw,124px);line-height:1.02;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;white-space:nowrap;margin:4px 0}' +
    '.yt-bs{font-size:clamp(14px,2.2vw,20px);font-weight:700;color:var(--yt-sub);min-height:1.4em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.yt-ctrl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:12px}' +
    '.yt-sec{padding:14px 16px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid var(--yt-line);display:flex;flex-direction:column;gap:10px;min-width:0}' +
    '.yt-sec h3{margin:0;font-size:14px;font-weight:800;color:var(--yt-a2);display:flex;align-items:center;gap:7px}.yt-sec h3 .yt-i{width:17px;height:17px}' +
    '.yt-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}' +
    '.yt-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 15px;border-radius:13px;border:1px solid var(--yt-line);background:rgba(255,255,255,.1);color:#fff;font:800 15px inherit;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '.yt-btn .yt-i{width:17px;height:17px}.yt-btn:hover{background:rgba(255,255,255,.18)}.yt-btn:active{transform:scale(.96)}' +
    '.yt-btn.pri{background:linear-gradient(135deg,#ff9d47,#ff7a1c);color:#1a0f05;border-color:transparent}' +
    '.yt-btn.warn{background:rgba(255,80,80,.2);border-color:rgba(255,122,122,.7);color:#ffdada}' +
    '.yt-btn[aria-pressed=true]{background:rgba(255,138,42,.32);border-color:rgba(255,138,42,.85)}' +
    '.yt-btn.sm{min-height:38px;padding:0 12px;font-size:14px}' +
    '.yt-in{min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--yt-line);background:rgba(255,255,255,.1);color:#fff;font:700 16px inherit;font-family:inherit;min-width:0;color-scheme:dark}' +
    'select.yt-in{flex:1 1 180px;max-width:100%}' +
    '.yt-val{min-width:64px;text-align:center;font-weight:800;font-size:17px;font-variant-numeric:tabular-nums}' +
    '.yt-lb{font-size:13px;font-weight:700;color:var(--yt-sub)}' +
    '.yt-ro{padding:11px 14px;border-radius:14px;background:rgba(255,255,255,.06);border:1px dashed var(--yt-line);font-size:13.5px;color:var(--yt-sub);line-height:1.5}' +
    '.yt-by{font-size:12.5px;color:var(--yt-sub)}' +
    '.yt-only-lead[hidden]{display:none!important}' +
    '@media (prefers-reduced-motion:reduce){.yt-chip,.yt-btn,.yt-ib{transition:none}.yt-btn:active,.yt-ib:active{transform:none}}';
  function injectCss() {
    var doc = root.document;
    if (!doc || doc.getElementById('yn-timer-css')) return;
    var s = doc.createElement('style'); s.id = 'yn-timer-css'; s.textContent = CSS; (doc.head || doc.documentElement).appendChild(s);
  }

  var SYNC_TX = { socket: ['동기화됨', '실시간으로 동기화되고 있습니다'], poll: ['동기화됨', '실시간 연결이 끊겨 3초마다 확인하는 방식으로 동기화 중입니다'], offline: ['오프라인', '서버와 연결되지 않았습니다 — 마지막 상태로 계산해 보여줍니다'], denied: ['권한 없음', '이 예배 타이머에 접근할 수 없습니다'], connecting: ['연결 중', '연결하는 중입니다'] };

  /**
   * 막대 하나 만들기
   *  opts: { host, variant:'hub'|'viewer', token, room | getRoom(), getPlan() → { room?, songs:[{t|title, sec?}] }, io, base }
   */
  /* 시간 설정 (이 기기 전용) — 예배 시작 시각 기본 오후 2시 */
  function loadCfg() { var c = {}; try { c = JSON.parse(lsGet('yn.tm.cfg') || '{}') || {}; } catch (e) { c = {}; }
    return { svc: /^\d\d:\d\d$/.test(c.svc || '') ? c.svc : '14:00', svcOn: c.svcOn !== false, prac: /^\d\d:\d\d$/.test(c.prac || '') ? c.prac : '', pracOn: !!c.pracOn && !!c.prac }; }
  function saveCfg(c) { lsSet('yn.tm.cfg', JSON.stringify(c)); }
  function todayAt(now, hm) { var p = String(hm).split(':'), d = new Date(now.getTime()); d.setHours(+p[0] || 0, +p[1] || 0, 0, 0); return d; }
  function fmtHM(d) { var h = d.getHours(), m = d.getMinutes(); return (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + pad2(m); }

  function mountBar(opts) {
    var doc = root.document;
    if (!doc || !opts || !opts.host) return null;
    injectCss();
    var variant = opts.variant === 'viewer' ? 'viewer' : 'hub';
    var bar = doc.createElement('div');
    bar.className = 'yt-bar yt-' + variant;
    bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '예배 타이머');
    bar.innerHTML =
      '<div class="yt-chips">' +
        '<div class="yt-chip yt-now" data-k="now">' + svg('clock') + '<div class="yt-tx"><span class="yt-l">지금</span><b class="yt-v" aria-label="지금 시각">--:--</b><span class="yt-s">&nbsp;</span></div></div>' +
        '<div class="yt-chip yt-total idle" data-k="total">' + svg('clock') + '<div class="yt-tx"><span class="yt-l">예배 경과</span><b class="yt-v" role="timer" aria-label="예배 경과 시간">0:00</b><span class="yt-s">&nbsp;</span></div>' +
          '<button type="button" class="yt-ib yt-ctl pri" data-a="toggle" aria-label="예배 시작" title="예배 시작 · 일시정지">' + svg('play') + '</button></div>' +
        '<div class="yt-chip yt-seg idle" data-k="seg">' + svg('music') + '<div class="yt-tx"><span class="yt-l">찬양 구간</span><b class="yt-v" role="timer" aria-label="찬양 구간 시간">0:00</b><span class="yt-s">&nbsp;</span></div>' +
          '<button type="button" class="yt-ib yt-ctl pri" data-a="segnext" aria-label="다음 곡" title="다음 곡으로 (구간 시계를 0부터 다시)">' + svg('next') + '</button></div>' +
        '<div class="yt-chip yt-ser idle" data-k="ser">' + svg('book') + '<div class="yt-tx"><span class="yt-l">설교까지</span><b class="yt-v" role="timer" aria-label="설교 시작까지 남은 시간">--:--</b><span class="yt-s">&nbsp;</span></div></div>' +
        '<div class="yt-chip yt-svc idle" data-k="svc" hidden>' + svg('clock') + '<div class="yt-tx"><span class="yt-l">예배 시작까지</span><b class="yt-v" role="timer" aria-label="예배 시작까지 남은 시간">--</b><span class="yt-s">&nbsp;</span></div></div>' +
        '<div class="yt-chip yt-prac idle" data-k="prac" hidden>' + svg('clock') + '<div class="yt-tx"><span class="yt-l">연습 종료까지</span><b class="yt-v" role="timer" aria-label="연습 종료까지 남은 시간">--</b><span class="yt-s">&nbsp;</span></div></div>' +
      '</div>' +
      '<div class="yt-setpop" role="dialog" aria-label="시간 설정" hidden>' +
        '<label class="yt-setrow"><input type="checkbox" data-c="svcOn"> <span>예배 시작 시각</span> <input class="yt-in yt-tm" type="time" data-c="svc" step="60"></label>' +
        '<label class="yt-setrow"><input type="checkbox" data-c="pracOn"> <span>연습 종료 시각</span> <input class="yt-in yt-tm" type="time" data-c="prac" step="60"></label>' +
        '<p class="yt-sethelp">이 기기에만 저장됩니다. 켜 두면 위 막대에 "몇 분 남았는지" 가 나옵니다.</p></div>' +
      '<div class="yt-side"><button type="button" class="yt-ib yt-setb" data-a="cfg" aria-expanded="false" aria-label="시간 설정 (예배 시작 · 연습 종료 시각)" title="예배 시작 · 연습 종료 시각 설정">' + YI('gear') + '</button><span class="yt-sync" data-s="connecting" role="status" aria-live="polite"><i></i><b>연결 중</b></span>' +
        '<button type="button" class="yt-ib yt-minb" data-a="mini" aria-pressed="false" aria-label="작게 보기" title="작게 보기 (예배 경과만) / 크게 보기"><svg class="yt-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg></button>' +
        '<button type="button" class="yt-ib yt-exp" data-a="expand" aria-haspopup="dialog" aria-expanded="false" aria-label="방송 모드 열기" title="방송 모드 (큰 글씨)">' + svg('expand') + '</button></div>' +
      '<div class="yt-toast" role="alert" hidden></div>';
    var host = opts.host;
    if (variant === 'viewer' && opts.after && opts.after.parentNode === host) host.insertBefore(bar, opts.after.nextSibling);
    else host.insertBefore(bar, host.firstChild);

    var $ = function (s, r) { return (r || bar).querySelector(s); };
    var cTotal = $('.yt-total'), cSeg = $('.yt-seg'), cSer = $('.yt-ser');
    var cNow = $('.yt-now'), cSvc = $('.yt-svc'), cPrac = $('.yt-prac'), vNow = $('.yt-v', cNow), vSvc = $('.yt-v', cSvc), vPrac = $('.yt-v', cPrac), sSvc = $('.yt-s', cSvc), sPrac = $('.yt-s', cPrac), setPop = $('.yt-setpop');
    var CFG = loadCfg();
    var vTotal = $('.yt-v', cTotal), vSeg = $('.yt-v', cSeg), vSer = $('.yt-v', cSer);
    var sSeg = $('.yt-s', cSeg), sSer = $('.yt-s', cSer), lSeg = $('.yt-l', cSeg), lSer = $('.yt-l', cSer);
    var bToggle = $('[data-a=toggle]'), bNext = $('[data-a=segnext]'), bExp = $('[data-a=expand]');
    var syncEl = $('.yt-sync'), toastEl = $('.yt-toast');
    var ctl = null, rel = null, room = '', unsub = null, tickT = null, dead = false, panel = null, toastT = 0, lastLead = null, lastSync = '';
    var planFn = function () { var p = opts.getPlan ? opts.getPlan() : null; return p ? Object.assign({}, p, { room: p.room }) : null; };
    var last = {};
    function setText(node, key, txt) { if (last[key] !== txt) { last[key] = txt; node.textContent = txt; if (node.classList.contains('yt-v')) node.classList.toggle('lg', txt.length >= 7); } }
    function setCls(node, key, cls) { if (last[key] !== cls) { last[key] = cls; node.className = cls; } }

    function roomNow() { return String(opts.getRoom ? opts.getRoom() : opts.room || ''); }
    function attach() {
      var r = roomNow();
      if (r === room && ctl) return;
      detach(); room = r;
      if (!r || !opts.token) { render(); return; }
      var a = acquire({ token: opts.token, room: r, io: opts.io, base: opts.base, fetchFn: opts.fetchFn });
      ctl = a.c; rel = a.release;
      ctl.addPlan(planFn);
      unsub = ctl.on(function () { render(); if (panel) panel.update(); });
      render();
    }
    function detach() {
      if (unsub) { unsub(); unsub = null; }
      if (ctl) { ctl.removePlan(planFn); ctl = null; }
      if (rel) { rel(); rel = null; }
      last = {}; room = '';
    }

    function toast(msg) {
      toastEl.textContent = msg; toastEl.hidden = false;
      clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 4500);
    }
    function cmd(action, extra) {
      if (!ctl) return Promise.resolve();
      return ctl.send(Object.assign({ action: action }, extra || {})).catch(function (e) { toast((e && e.message) || '타이머를 조작하지 못했습니다.'); });
    }

    /** 지금 시각 · 예배 시작까지 · 연습 종료까지 — 이 기기 시계(서버 시계 보정 포함)로 계산. 설정은 이 기기에만 저장 */
    function clockRender() {
      var now = new Date();
      setText(vNow, 'vn', fmtHM(now));
      [[cSvc, vSvc, sSvc, CFG.svcOn && CFG.svc, 'sv', '예배 시작'], [cPrac, vPrac, sPrac, CFG.pracOn && CFG.prac, 'pr', '연습 종료']].forEach(function (x) {
        var t = x[3] ? todayAt(now, x[3]) : null, node = x[0];
        var diff = t ? t.getTime() - now.getTime() : 0, show = !!t && diff > -10 * 60000;      // 지난 뒤 10분까지는 "지났음"으로 보여주고 그 뒤엔 숨김
        if (node.hidden === show) node.hidden = !show;
        if (!show) return;
        var over = diff <= 0, cd = over ? '지남 ' + Math.max(0, Math.floor(-diff / 60000)) + '분' : diff < 60000 ? '0:' + pad2(Math.ceil(diff / 1000) % 60) : diff >= 3600000 ? Math.floor(diff / 3600000) + '시간 ' + Math.floor(diff % 3600000 / 60000) + '분' : Math.ceil(diff / 60000) + '분';
        setText(x[1], x[4], cd); setText(x[2], x[4] + 's', fmtHM(t));
        setCls(node, x[4] + 'c', 'yt-chip ' + (x[5] === '예배 시작' ? 'yt-svc' : 'yt-prac') + ' ' + (over ? 'over' : diff < 300000 ? 'soon' : 'idle'));
      });
    }
    function render() {
      if (dead) return;
      clockRender();
      var v = ctl ? ctl.view() : null;
      var lead = !!(ctl && ctl.canLead);
      if (lead !== lastLead) { lastLead = lead; bar.classList.toggle('yt-lead', lead); Array.prototype.forEach.call(bar.querySelectorAll('.yt-ctl'), function (b) { b.hidden = !lead; }); }
      var st = ctl ? ctl.status : 'connecting';
      if (st !== lastSync) {
        lastSync = st; var tx = SYNC_TX[st] || SYNC_TX.connecting;
        syncEl.setAttribute('data-s', st); syncEl.title = tx[1]; syncEl.querySelector('b').textContent = tx[0]; syncEl.setAttribute('aria-label', tx[0] + ' — ' + tx[1]);
      }
      if (!v) { setText(vTotal, 'vt', '0:00'); setText(vSeg, 'vs', '0:00'); setText(vSer, 'vr', '--:--'); return; }
      setText(vTotal, 'vt', fmtElapsed(v.total.ms));
      setCls(cTotal, 'ct', 'yt-chip yt-total ' + (v.total.running ? 'run' : v.total.started ? '' : 'idle'));
      setText(lSeg, 'ls', v.seg.active ? (v.seg.done ? '찬양 종료' : (v.seg.label || '찬양 구간')) : '찬양 구간');
      setText(vSeg, 'vs', fmtElapsed(v.seg.ms));
      var segSub = '';
      if (v.seg.targetMs) { var cd = fmtCountdown(v.seg.remainingMs); segSub = (cd.over ? '초과 ' : '남음 ') + cd.text.replace('+', ''); }
      else if (v.seg.n && v.seg.active && !v.seg.done) segSub = (v.seg.idx + 1) + ' / ' + v.seg.n + '곡';
      setText(sSeg, 'ss', segSub || ' ');
      setCls(cSeg, 'cs', 'yt-chip yt-seg ' + (v.seg.over ? 'over ' : '') + (v.seg.running ? 'run' : v.seg.active ? '' : 'idle'));
      var se = v.sermon;
      if (se.has) {
        var cd2 = fmtCountdown(se.remainingMs);
        setText(vSer, 'vr', cd2.text); setText(sSer, 'sr', fmtClock(se.atMs) + (se.mode === 'manual' ? ' · 수동' : ' · 예상'));
        setCls(cSer, 'cr', 'yt-chip yt-ser ' + (cd2.over ? 'over' : se.remainingMs < 300000 ? 'soon' : v.total.running ? 'run' : 'idle'));
      } else { setText(vSer, 'vr', '--:--'); setText(sSer, 'sr', se.mode === 'manual' ? '시각 미정' : '곡 목록 없음'); setCls(cSer, 'cr', 'yt-chip yt-ser idle'); }
      if (bToggle) {
        var tl = v.total.running ? '예배 일시정지' : v.total.started ? '예배 다시 시작' : '예배 시작';
        if (last.tl !== tl) { last.tl = tl; bToggle.setAttribute('aria-label', tl); bToggle.title = tl; bToggle.innerHTML = svg(v.total.running ? 'pause' : 'play'); }
      }
      if (panel) panel.tick(v);
    }

    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-a]') : null; if (!b || !bar.contains(b)) return;
      var a = b.getAttribute('data-a'), v = ctl && ctl.view();
      if (a === 'toggle') cmd(v && v.total.running ? 'pause' : 'start');
      else if (a === 'segnext') cmd('segNext');
      else if (a === 'expand') openPanel();
      else if (a === 'mini') setMini(!bar.classList.contains('yt-mini'), true);
      else if (a === 'cfg') { var open = setPop.hidden; setPop.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) paintCfg(); }
    });
    function paintCfg() { Array.prototype.forEach.call(setPop.querySelectorAll('[data-c]'), function (i) { var k = i.getAttribute('data-c'); if (i.type === 'checkbox') i.checked = !!CFG[k]; else i.value = CFG[k] || ''; }); }
    setPop.addEventListener('change', function (ev) {
      var i = ev.target, k = i && i.getAttribute && i.getAttribute('data-c'); if (!k) return;
      CFG[k] = i.type === 'checkbox' ? !!i.checked : String(i.value || '');
      if ((k === 'svc' || k === 'prac') && CFG[k]) CFG[k + 'On'] = true;              // 시각을 넣으면 자동으로 켬
      saveCfg(CFG); paintCfg(); clockRender();
    });
    /* v6 — 작게 보기: 예배 경과 하나만 남기고 나머지는 접습니다 (자리를 덜 차지하게). 이 기기에 기억 */
    function setMini(on, save) {
      bar.classList.toggle('yt-mini', !!on);
      var b = bar.querySelector('[data-a=mini]');
      if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? '크게 보기' : '작게 보기');
        b.innerHTML = on ? '<svg class="yt-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' : '<svg class="yt-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>'; }
      if (save) { try { root.localStorage.setItem('yn.yt.mini.' + variant, on ? '1' : '0'); } catch (e) {} }
    }
    /* v7.9 — 처음에는 작게 (저장된 선택이 있으면 그대로). 필요할 때 ＋ 로 펼칩니다 */
    try { var ms = root.localStorage.getItem('yn.yt.mini.' + variant); if (ms === null ? variant === 'hub' : ms === '1') setMini(true, false); } catch (e) { if (variant === 'hub') setMini(true, false); }

    function openPanel() {
      if (panel || !ctl) return;
      bExp.setAttribute('aria-expanded', 'true');
      panel = buildPanel({ ctl: ctl, cmd: cmd, opener: bExp, onClose: function () { panel = null; bExp.setAttribute('aria-expanded', 'false'); try { bExp.focus(); } catch (e) {} } });
      panel.update(); render();
    }

    /* 화면 갱신 — 0.25초마다 시각에서 다시 계산합니다 (탭이 잠들었다 깨어도 어긋나지 않음). 바뀐 글자만 손댑니다 */
    function loop() {
      if (dead) return;
      attach();
      if (!doc.hidden) render();
      if (variant === 'hub') { var hh = bar.offsetHeight || 0; if (last.hh !== hh) { last.hh = hh; doc.documentElement.style.setProperty('--yt-hub-h', hh + 'px'); } }
    }
    function onVis() { if (!doc.hidden) { loop(); if (ctl && ctl.status !== 'socket') ctl.poll(); } }
    doc.addEventListener('visibilitychange', onVis);
    root.addEventListener && root.addEventListener('online', onVis);
    var ro = null;
    if (variant === 'viewer' && root.ResizeObserver) {
      var pv = opts.host;
      ro = new root.ResizeObserver(function () { pv.style.setProperty('--yt-h', bar.offsetHeight + 'px'); }); ro.observe(bar);
      pv.style.setProperty('--yt-h', bar.offsetHeight + 'px');
    }
    var typT = 0;
    function isTyper(t) { return !!(t && t.matches && t.matches('textarea,select,[contenteditable=""],[contenteditable="true"],input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file])') && !(t.closest && t.closest('.yt-bar,.yt-panel'))); }
    function onFocusIn(ev) { if (isTyper(ev.target)) { clearTimeout(typT); doc.body.classList.add('yt-typing'); } }       // 글을 입력하는 동안에는 키보드 위로 올라오지 않게 잠시 숨김
    function onFocusOut() { clearTimeout(typT); typT = setTimeout(function () { doc.body.classList.remove('yt-typing'); }, 150); }
    if (variant === 'hub') { doc.body.classList.add('yt-hub-on'); doc.addEventListener('focusin', onFocusIn); doc.addEventListener('focusout', onFocusOut); }
    attach(); loop();
    tickT = setInterval(loop, 250);

    return {
      el: bar, get controller() { return ctl; }, render: render, refresh: attach, setMini: setMini,
      miniSaved: function () { try { return root.localStorage.getItem('yn.yt.mini.' + variant); } catch (e) { return null; } },
      openPanel: openPanel, closePanel: function () { if (panel) panel.close(); },
      destroy: function () {
        if (dead) return; dead = true; clearInterval(tickT);
        doc.removeEventListener('visibilitychange', onVis); root.removeEventListener && root.removeEventListener('online', onVis);
        if (ro) ro.disconnect();
        if (panel) panel.close(true);
        detach();
        if (variant === 'hub') { doc.body.classList.remove('yt-hub-on', 'yt-typing'); doc.removeEventListener('focusin', onFocusIn); doc.removeEventListener('focusout', onFocusOut); clearTimeout(typT); doc.documentElement.style.removeProperty('--yt-hub-h'); }
        else { try { opts.host.style.removeProperty('--yt-h'); } catch (e) {} }
        if (bar.parentNode) bar.parentNode.removeChild(bar);
      }
    };
  }

  /* ---------------------------------------------------------------- 방송 모드 (큰 글씨 + 인도자 조작판) */
  function buildPanel(o) {
    var doc = root.document, ctl = o.ctl, cmd = o.cmd;
    var el = doc.createElement('div');
    el.className = 'yt-panel'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '방송 모드 — 예배 타이머');
    el.innerHTML =
      '<div class="yt-ph"><h2>방송 모드</h2><span class="yt-sync" role="status" aria-live="polite" data-s="connecting"><i></i><b>연결 중</b></span>' +
        '<button type="button" class="yt-btn sm" data-a="close" aria-label="방송 모드 닫기">' + svg('close') + '닫기</button></div>' +
      '<div class="yt-pb">' +
        '<div class="yt-big">' +
          '<div class="yt-card" data-c="total"><div class="yt-bl">' + svg('clock') + '예배 경과</div><div class="yt-bv" role="timer" aria-label="예배 경과 시간">0:00</div><div class="yt-bs">&nbsp;</div></div>' +
          '<div class="yt-card" data-c="seg"><div class="yt-bl">' + svg('music') + '<span data-f="segl">찬양 구간</span></div><div class="yt-bv" role="timer" aria-label="찬양 구간 시간">0:00</div><div class="yt-bs">&nbsp;</div></div>' +
          '<div class="yt-card" data-c="ser"><div class="yt-bl">' + svg('book') + '설교 시작까지</div><div class="yt-bv" role="timer" aria-label="설교 시작까지 남은 시간">--:--</div><div class="yt-bs">&nbsp;</div></div>' +
        '</div>' +
        '<div class="yt-ro yt-only-ro">읽기 전용 화면입니다 — 팀장 · 인도자가 조작하면 이 화면에 그대로 나타납니다. <span class="yt-by" data-f="by"></span></div>' +
        '<div class="yt-ctrl yt-only-lead" hidden>' +
          '<section class="yt-sec"><h3>' + svg('clock') + '예배 전체</h3><div class="yt-row">' +
            '<button type="button" class="yt-btn pri" data-a="toggle"></button>' +
            '<button type="button" class="yt-btn warn" data-a="reset">' + svg('reset') + '처음부터</button></div>' +
            '<div class="yt-by" data-f="by2"></div></section>' +
          '<section class="yt-sec"><h3>' + svg('music') + '찬양 구간</h3>' +
            '<div class="yt-row"><select class="yt-in" data-f="songsel" aria-label="지금 곡 고르기"></select></div>' +
            '<div class="yt-row"><button type="button" class="yt-btn sm" data-a="segprev" aria-label="이전 곡">' + svg('prev') + '이전</button>' +
              '<button type="button" class="yt-btn pri sm" data-a="segnext" aria-label="다음 곡">다음 곡' + svg('next') + '</button>' +
              '<button type="button" class="yt-btn sm" data-a="segtoggle"></button>' +
              '<button type="button" class="yt-btn sm" data-a="segreset" aria-label="구간 시계를 0으로">구간 0초</button></div>' +
            '<div class="yt-lb">목표 시간 (남은 시간 · 초과 시간 표시)</div>' +
            '<div class="yt-row"><button type="button" class="yt-btn sm" data-a="tminus" aria-label="목표 30초 줄이기">−30초</button><span class="yt-val" data-f="tval">없음</span>' +
              '<button type="button" class="yt-btn sm" data-a="tplus" aria-label="목표 30초 늘리기">+30초</button>' +
              '<button type="button" class="yt-btn sm" data-a="tset" data-v="180">3분</button><button type="button" class="yt-btn sm" data-a="tset" data-v="240">4분</button>' +
              '<button type="button" class="yt-btn sm" data-a="tset" data-v="300">5분</button><button type="button" class="yt-btn sm" data-a="tset" data-v="0">없음</button></div></section>' +
          '<section class="yt-sec"><h3>' + svg('book') + '설교 시작 예상</h3>' +
            '<div class="yt-row"><button type="button" class="yt-btn sm" data-a="mauto" aria-pressed="true">자동 계산</button><button type="button" class="yt-btn sm" data-a="mman" aria-pressed="false">시각 직접 정하기</button></div>' +
            '<div data-f="auto"><div class="yt-lb">곡당 시간 · 남은 곡 수를 곱해 계산합니다</div>' +
              '<div class="yt-row"><button type="button" class="yt-btn sm" data-a="pminus" aria-label="곡당 시간 줄이기">−30초</button><span class="yt-val" data-f="pval">5:00</span><button type="button" class="yt-btn sm" data-a="pplus" aria-label="곡당 시간 늘리기">+30초</button></div>' +
              '<div class="yt-lb">그 밖에 더 걸릴 시간 (기도 · 광고 · 헌금 등)</div>' +
              '<div class="yt-row"><button type="button" class="yt-btn sm" data-a="eminus" aria-label="추가 시간 줄이기">−1분</button><span class="yt-val" data-f="eval">0분</span><button type="button" class="yt-btn sm" data-a="eplus" aria-label="추가 시간 늘리기">+1분</button></div></div>' +
            '<div data-f="man" hidden><div class="yt-lb">설교 시작 시각</div>' +
              '<div class="yt-row"><input class="yt-in" type="time" data-f="clock" aria-label="설교 시작 시각"><button type="button" class="yt-btn pri sm" data-a="mclock">적용</button></div>' +
              '<div class="yt-lb">지금부터</div>' +
              '<div class="yt-row"><button type="button" class="yt-btn sm" data-a="min" data-v="5">5분 뒤</button><button type="button" class="yt-btn sm" data-a="min" data-v="10">10분 뒤</button>' +
              '<button type="button" class="yt-btn sm" data-a="min" data-v="15">15분 뒤</button><button type="button" class="yt-btn sm" data-a="min" data-v="20">20분 뒤</button>' +
              '<button type="button" class="yt-btn sm" data-a="mplus" data-v="1">+1분</button><button type="button" class="yt-btn sm" data-a="mplus" data-v="-1">−1분</button></div></div></section>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(el);
    var $ = function (s) { return el.querySelector(s); };
    var F = function (n) { return el.querySelector('[data-f=' + n + ']'); };
    var cards = { total: $('[data-c=total]'), seg: $('[data-c=seg]'), ser: $('[data-c=ser]') };
    var bv = function (k) { return cards[k].querySelector('.yt-bv'); }, bs = function (k) { return cards[k].querySelector('.yt-bs'); };
    var last = {}, closed = false;
    function set(node, key, txt) { if (last[key] !== txt) { last[key] = txt; node.textContent = txt; } }
    function cls(node, key, c) { if (last[key] !== c) { last[key] = c; node.className = c; } }

    function tick(v) {
      if (closed) return;
      v = v || ctl.view(); if (!v) return;
      set(bv('total'), 't', fmtElapsed(v.total.ms));
      cls(cards.total, 'tc', 'yt-card ' + (v.total.running ? 'run' : ''));
      set(bs('total'), 'ts', v.total.running ? '진행 중' : v.total.started ? '일시정지' : '시작 전');
      set(F('segl'), 'sl', v.seg.active ? (v.seg.done ? '찬양 종료' : (v.seg.label || '찬양 구간')) : '찬양 구간');
      set(bv('seg'), 's', fmtElapsed(v.seg.ms));
      var sub = v.seg.targetMs ? (function () { var cd = fmtCountdown(v.seg.remainingMs); return (cd.over ? '목표 초과 ' + cd.text.replace('+', '') : '목표까지 ' + cd.text) + ' (목표 ' + fmtElapsed(v.seg.targetMs) + ')'; }()) : (v.seg.n && v.seg.active && !v.seg.done ? (v.seg.idx + 1) + ' / ' + v.seg.n + '곡' : '목표 시간 없음');
      set(bs('seg'), 'ss', sub);
      cls(cards.seg, 'sc', 'yt-card ' + (v.seg.over ? 'over ' : '') + (v.seg.running ? 'run' : ''));
      var se = v.sermon;
      if (se.has) {
        var cd2 = fmtCountdown(se.remainingMs);
        set(bv('ser'), 'r', cd2.text); set(bs('ser'), 'rs', (cd2.over ? '예정 시각 지남 · ' : '') + fmtClock(se.atMs) + (se.mode === 'manual' ? ' 시작 (수동)' : ' 시작 예상'));
        cls(cards.ser, 'rc', 'yt-card ' + (cd2.over ? 'over' : se.remainingMs < 300000 ? 'soon' : ''));
      } else { set(bv('ser'), 'r', '--:--'); set(bs('ser'), 'rs', se.mode === 'manual' ? '시각을 정해 주세요' : '곡 목록이 없어 계산할 수 없습니다'); cls(cards.ser, 'rc', 'yt-card'); }
    }

    function update() {
      if (closed) return;
      var s = ctl.state, lead = ctl.canLead, st = ctl.status;
      var syncEl = $('.yt-sync'), tx = SYNC_TX[st] || SYNC_TX.connecting;
      syncEl.setAttribute('data-s', st); syncEl.title = tx[1]; syncEl.querySelector('b').textContent = tx[0];
      $('.yt-only-ro').hidden = lead; $('.yt-only-lead').hidden = !lead;
      var by = s && s.by ? (window.YNHon ? YNHon.say(s.by) : s.by + ' 님이') + ' 마지막으로 조작' : '';
      set(F('by'), 'by', by); set(F('by2'), 'by2', by);
      tick();
      if (!s || !lead) return;
      var v = ctl.view();
      var tg = $('[data-a=toggle]'); set(tg, 'tg', v.total.running ? '일시정지' : v.total.started ? '다시 시작' : '예배 시작');
      var sg = $('[data-a=segtoggle]'); set(sg, 'sgt', v.seg.running ? '구간 멈춤' : '구간 시작');
      set(F('tval'), 'tv', s.seg.targetMs ? fmtElapsed(s.seg.targetMs) : '없음');
      set(F('pval'), 'pv', fmtElapsed(s.sermon.perSongSec * 1000)); set(F('eval'), 'ev', (s.sermon.extraSec / 60) + '분');
      var manual = s.sermon.mode === 'manual';
      $('[data-a=mauto]').setAttribute('aria-pressed', manual ? 'false' : 'true'); $('[data-a=mman]').setAttribute('aria-pressed', manual ? 'true' : 'false');
      F('auto').hidden = manual; F('man').hidden = !manual;
      var sel = F('songsel'), songs = ctl.songs(), sig = songs.map(function (x) { return x.t; }).join('\u0001') + '#' + s.seg.idx;
      if (last.sig !== sig && doc.activeElement !== sel) {
        last.sig = sig;
        var opts = '<option value="-1">— 아직 시작 전 —</option>' + songs.map(function (x, i) { return '<option value="' + i + '">' + h((i + 1) + '. ' + (x.t || '곡 ' + (i + 1))) + '</option>'; }).join('') + (songs.length ? '<option value="' + songs.length + '">찬양 종료</option>' : '');
        sel.innerHTML = opts; sel.value = String(Math.min(s.seg.idx, songs.length || 99));
      }
      var ck = F('clock');
      if (doc.activeElement !== ck && manual && s.sermon.atMs && last.ck !== s.sermon.atMs) { last.ck = s.sermon.atMs; var d = new Date(s.sermon.atMs); ck.value = pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    }

    var resetT = 0;
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-a]') : null; if (!b) return;
      var a = b.getAttribute('data-a'), v = ctl.view(), s = ctl.state; if (!s) return;
      if (a === 'close') return close();
      var val = Number(b.getAttribute('data-v'));
      if (a === 'toggle') cmd(v.total.running ? 'pause' : 'start');
      else if (a === 'reset') {
        if (!resetT) { b.lastChild.textContent = '정말 처음부터?'; resetT = setTimeout(function () { resetT = 0; b.lastChild.textContent = '처음부터'; }, 3000); }
        else { clearTimeout(resetT); resetT = 0; b.lastChild.textContent = '처음부터'; cmd('resetAll'); }
      }
      else if (a === 'segprev') cmd('segPrev'); else if (a === 'segnext') cmd('segNext');
      else if (a === 'segtoggle') cmd(v.seg.running ? 'segPause' : 'segStart');
      else if (a === 'segreset') cmd('segReset');
      else if (a === 'tminus') cmd('segTarget', { targetSec: Math.max(30, (s.seg.targetMs ? s.seg.targetMs / 1000 : 300) - 30) });
      else if (a === 'tplus') cmd('segTarget', { targetSec: (s.seg.targetMs ? s.seg.targetMs / 1000 : 270) + 30 });
      else if (a === 'tset') cmd('segTarget', { targetSec: val });
      else if (a === 'mauto') cmd('setSermon', { mode: 'auto' }); else if (a === 'mman') cmd('setSermon', { mode: 'manual' });
      else if (a === 'pminus') cmd('setSermon', { perSongSec: s.sermon.perSongSec - 30 }); else if (a === 'pplus') cmd('setSermon', { perSongSec: s.sermon.perSongSec + 30 });
      else if (a === 'eminus') cmd('setSermon', { extraSec: s.sermon.extraSec - 60 }); else if (a === 'eplus') cmd('setSermon', { extraSec: s.sermon.extraSec + 60 });
      else if (a === 'min') cmd('setSermon', { inMin: val });
      else if (a === 'mplus') cmd('setSermon', { at: (s.sermon.atMs || ctl.now()) + val * 60000 });
      else if (a === 'mclock') {
        var t = String(F('clock').value || '').split(':'); if (t.length < 2) return;
        var d = new Date(ctl.now()); d.setHours(Number(t[0]), Number(t[1]), 0, 0);
        if (d.getTime() < ctl.now() - 3600e3) d.setDate(d.getDate() + 1);
        cmd('setSermon', { at: d.getTime() });
      }
    });
    F('songsel').addEventListener('change', function () { cmd('segGoto', { idx: Number(F('songsel').value) }); });
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if (ev.key !== 'Tab') return;
      var f = Array.prototype.filter.call(el.querySelectorAll('button,select,input'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (ev.shiftKey && doc.activeElement === a) { ev.preventDefault(); z.focus(); } else if (!ev.shiftKey && doc.activeElement === z) { ev.preventDefault(); a.focus(); }
    }
    doc.addEventListener('keydown', onKey, true);
    function close(silent) {
      if (closed) return; closed = true; clearTimeout(resetT);
      doc.removeEventListener('keydown', onKey, true);
      if (el.parentNode) el.parentNode.removeChild(el);
      if (!silent && o.onClose) o.onClose();
    }
    try { $('[data-a=close]').focus(); } catch (e) {}
    return { el: el, update: update, tick: tick, close: close };
  }

  /* ---------------------------------------------------------------- 진입점 */
  /** 세션 / 연습 화면 안에 막대 달기 — pvEl = practice.js 의 .pv 뿌리. 헤더 바로 아래에 붙습니다. */
  function mountViewer(pvEl, o) {
    o = o || {};
    if (!pvEl) return null;
    var top = pvEl.querySelector ? pvEl.querySelector('.pv-top') : null;
    return mountBar({ host: pvEl, after: top, variant: 'viewer', token: o.token, room: o.room, getPlan: o.getPlan, io: o.io, base: o.base });
  }

  return {
    LIM: LIM, ACTIONS: ACTIONS, newState: newState, cleanCmd: cleanCmd, cleanSongs: cleanSongs, planHash: planHash, applyCmd: applyCmd, accept: accept,
    elapsed: elapsed, view: view, sermonEstimate: sermonEstimate, segLabel: segLabel,
    fmtElapsed: fmtElapsed, fmtCountdown: fmtCountdown, fmtClock: fmtClock, hms: hms,
    createController: createController, acquire: acquire, mountBar: mountBar, mountViewer: mountViewer, _reg: REG
  };
}));
