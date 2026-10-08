/**
 * 실시간 서버 (Socket.io) — 찬양방송팀 허브
 * ------------------------------------------------------------
 * 구글 드라이브를 다시 읽어 오는 방식(수 초 지연)이 아니라 웹소켓으로 곧바로 나눕니다.
 *
 *   · 방 (room)      예배 하나 = 방 하나 ("w:2026-09-27" · "w:ev-abc123")  — 같은 날짜 콘티를 여는 사람끼리
 *   · 리더/팔로워    리더가 넘기는 악보 · 쪽 · 곡을 따라가는 사람들. 따라가기는 사람마다 끄고 켤 수 있음 (클라이언트 쪽 선택)
 *   · 필기           팀 필기는 서버 메모리에서 실시간으로 나누고, 멈춘 뒤 몇 초 만에 한 번 묶어서 시트에 저장
 *                    (구글 시트 쓰기 제한 때문에 그리는 동안에는 시트에 쓰지 않습니다)
 *   · 큐(cue)        리더가 누른 토크백 큐를 팀에게 그대로 전달
 *   · 역할 두 가지   "페이지 컨트롤"(leader: 악보 · 쪽 · 큐)과 "클릭 컨트롤"(clicker: 메트로놈 BPM · 박자 · 시작/멈춤)은
 *                    서로 독립입니다 — 한 사람이 둘 다 맡아도 되고 다른 사람이 나눠 맡아도 됩니다.
 *   · 예배 타이머    예배 경과 · 찬양 구간 · 설교 시작 예상 (Feature 1). 상태는 서버 메모리에 예배(날짜)별로 하나만 두고(방이 비어도 12시간 유지),
 *                    시각(timestamp)으로 저장해 화면들이 각자 계산합니다. 조작은 팀장 · 인도자(canLead)만. 웹소켓 + HTTP(대체) 가 같은 상태를 봅니다.
 *                    계산 규칙은 public/worship/timer.js (화면과 같은 파일) 를 그대로 씁니다.
 *   · 메트로놈       소리는 보내지 않습니다. 클릭 컨트롤이 보낸 "상태"(BPM · 박자 · 강세 · 시작/멈춤)만 방 전체에 나누고,
 *                    시작 시각(startAt)은 서버 시계로 정해 각 기기가 자기 오디오로 같은 박에 맞춰 냅니다.
 *
 * 서버는 시트를 직접 모릅니다 — deps 로 받은 세 함수만 부릅니다 (server.js 가 연결, 시험에서는 가짜로 대체):
 *   auth(token)                       → { name, canEdit, canLead, committee, admin }   (틀리면 Error)
 *   loadAnno(file, scope)             → 필기 목록 (팀 층)
 *   saveAnno(file, scope, items, by)  → 저장
 *
 * ▣ 찬양방송팀 허브(praise-broadcast-hub) 이식 메모 — church-app(yntoronto.2026 v6) lib/realtime.js 를 그대로 가져와
 *    "여러 찬양팀" 구분만 더했습니다. 바뀐 곳은 PBH 표시가 붙은 줄뿐입니다.
 *   · auth(token) 이 team 을 돌려주면, 방 · 예배 타이머 · 실시간 알림 열쇠 앞에 "팀|" 을 붙여 팀끼리 섞이지 않게 합니다.
 *     (예: 1부 찬양팀의 2026-10-04 와 3부 찬양팀의 2026-10-04 는 서로 다른 방)
 *   · loadAnno · saveAnno 의 마지막 인자로 그 방의 팀을 넘깁니다 (시트에 팀ID 와 함께 저장).
 *   · team 이 없으면 church-app 과 완전히 똑같이 동작합니다 — church-app 의 시험(test-step2-server · test-step28-metro)을 그대로 돌릴 수 있습니다.
 */
const { Server } = require('socket.io');
const YT = require('../public/worship/timer.js');          // 예배 타이머 순수 계산 (화면 · 서버 공용)

const ROOM_RE = /^(\d{4}-\d{2}-\d{2}|ev-[0-9a-z]{6,}(~[0-9a-z]{1,10})?)$/i;
const FILE_RE = /^[A-Za-z0-9_-]{10,}$/;
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TYPES = ['pen', 'hl', 'text', 'sym', 'fbox'];
const FBOX_TAG_RE = /^[A-Za-z0-9\u3131-\uD7A3]{1,8}$/;      // 송폼 박스 이름표 — Int · V · V1 · P · C · B … (anno.js FBOX_TAGS 와 같은 모양, 직접 적은 이름도 8자까지)
const SYMBOLS = ['sharp', 'flat', 'natural', 'fermata', 'segno', 'coda', 'repeatStart', 'repeatEnd', 'breath', 'cresc', 'decresc',
  'accent', 'staccato', 'tenuto', 'tie', 'arrowDown', 'arrowUp', 'star', 'check', 'circle', 'box',
  'dyn:pp', 'dyn:p', 'dyn:mp', 'dyn:mf', 'dyn:f', 'dyn:ff', 'dyn:dc', 'dyn:ds', 'dyn:tocoda', 'dyn:fine',
  'g:quarter', 'g:eighth', 'g:sharp', 'g:flat',
  'n:1', 'n:2', 'n:2d', 'n:4', 'n:4d', 'n:8', 'n:8d', 'n:16', 'n:8b', 'n:16b', 'n:3', 'n:r1', 'n:r2', 'n:r4', 'n:r8', 'n:r16', 'n:hd', 'n:ho'];   // 음표 · 쉼표
const FONT_KEYS = ['sans', 'serif', 'hand', 'pen', 'dodum'];                  // 글자 · 코드 · 글자 모양 기호의 글꼴 (anno.js FONT_KEYS 와 같아야 함)

const LIMITS = {
  maxRooms: 200, maxLayers: 60, maxItems: 4000, maxPoints: 1500, maxText: 200, maxItemBytes: 24000,
  saveDelayMs: 8000, saveGapMs: 2500, retryMs: 30000, burst: 240, perSec: 120, abuseKill: 6,
};

const METRO_LEAD_MS = 450;
const MSG_MAX = 200, MSG_KEEP = 30, MSG_RECENT_MS = 15 * 60 * 1000;    // 요청 메시지 — 글자 수 · 방마다 기억할 개수 · 다시 들어온 화면에 보여 줄 시간
function recentMsgs(room, t) { t = t || Date.now(); return (room.msgs || []).filter((m) => t - m.t < MSG_RECENT_MS); }                                    // 시작 명령 후 이만큼 뒤에 모든 기기가 첫 박을 냅니다 (네트워크 지연 흡수)

/* ---------------------------------------------------------------- 예배 타이머 저장소
 * 방(room) 객체 안이 아니라 모듈 수준 Map — 방은 사람이 모두 나가면 사라지지만 타이머는 계속 가야 하기 때문입니다.
 * 예배(날짜) 키 → { state, touched }. 마지막 사용 12시간 뒤 정리, 최대 TIMER_MAX 개(넘으면 가장 오래 안 쓴 것부터). */
const TIMER_TTL_MS = 12 * 3600 * 1000, TIMER_MAX = 300;
const PROC_SID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);   // 서버가 다시 켜지면 달라집니다 → 화면이 "새 상태"로 알아봄
const timers = new Map();
let timerSweepT = null;
function timerSweep(t) {
  t = t || Date.now();
  timers.forEach((e, k) => { if (t - e.touched > TIMER_TTL_MS) timers.delete(k); });
  if (timers.size > TIMER_MAX) {
    Array.from(timers.entries()).sort((a, b) => a[1].touched - b[1].touched).slice(0, timers.size - TIMER_MAX).forEach((x) => timers.delete(x[0]));
  }
  if (!timers.size && timerSweepT) { clearInterval(timerSweepT); timerSweepT = null; }
}
function timerEnsureSweep() {
  if (timerSweepT) return;
  timerSweepT = setInterval(() => timerSweep(), 10 * 60 * 1000);
  if (timerSweepT.unref) timerSweepT.unref();
}
/** 지금 상태 (아직 아무도 조작하지 않았다면 빈 기본 상태 — 저장하지 않습니다. sid 는 서버가 켜져 있는 동안 늘 같음) */
function timerGet(key, t) {
  t = t || Date.now();
  const e = timers.get(key);
  if (e) { if (t - e.touched > TIMER_TTL_MS) { timers.delete(key); } else return e.state; }
  const st = YT.newState(0); st.sid = PROC_SID;
  return st;
}
/**
 * 조작 하나 — 팀장 · 인도자만. 값은 모두 검사 · 정리한 뒤 적용합니다.
 * → { ok:true, state, changed, serverTime } | { ok:false, code, error }
 */
function timerApply(key, user, raw, t) {
  t = t || Date.now();
  if (!user || !user.canLead) return { ok: false, code: 'perm', error: '팀장 · 인도자만 타이머를 조작할 수 있습니다.' };
  const cmd = YT.cleanCmd(raw, t);
  if (!cmd) return { ok: false, code: 'bad', error: '타이머 조작 형식이 올바르지 않습니다.' };
  const base = timerGet(key, t), isNew = !timers.has(key);
  // 새로 만들어질 때마다 새 sid — 12시간 뒤 다시 만들어져도 화면이 "새 상태"로 알아봄 (seq 가 작아도)
  const cur = isNew ? Object.assign({}, base, { sid: PROC_SID + '.' + Math.random().toString(36).slice(2, 8) }) : base;
  const r = YT.applyCmd(cur, cmd, t, user.name);
  if (r.changed) {
    timers.set(key, { state: r.state, touched: t });
    timerSweep(t); timerEnsureSweep();
    return { ok: true, state: r.state, changed: true, serverTime: t };
  }
  if (!isNew) timers.get(key).touched = t;
  return { ok: true, state: base, changed: false, serverTime: t };            // 바뀐 게 없으면 저장하지 않고 기존(또는 기본) 상태 그대로
}

/** PBH — 팀이 있으면 "팀|열쇠", 없으면 열쇠 그대로 (church-app 과 같음) */
const teamKey = (user, k) => (user && user.team ? String(user.team) + '|' : '') + k;

const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const r4 = (v) => Math.round(v * 10000) / 10000;

/** 브라우저가 보낸 필기 하나를 검사 · 정리합니다. 이상하면 null (서버가 소유자 · 시각을 직접 채웁니다) */
function cleanItem(raw, user, now) {
  if (!raw || typeof raw !== 'object') return null;
  const t = String(raw.t || '');
  if (TYPES.indexOf(t) === -1) return null;
  const id = String(raw.id || '');
  if (!ID_RE.test(id)) return null;
  const it = { id, t, pg: Math.round(num(raw.pg, 1, 500, 1)), c: COLOR_RE.test(String(raw.c || '')) ? String(raw.c).toLowerCase() : '#ff5a1f',
    by: user.name, ts: now };
  if (t === 'pen' || t === 'hl') {
    if (!Array.isArray(raw.p) || raw.p.length < 2 || raw.p.length > LIMITS.maxPoints * 2) return null;
    const p = [];
    for (let i = 0; i + 1 < raw.p.length; i += 2) p.push(r4(num(raw.p[i], 0, 1, 0)), r4(num(raw.p[i + 1], 0, 1, 0)));
    it.p = p;
    it.w = r4(num(raw.w, 0.0005, 0.06, t === 'hl' ? 0.02 : 0.003));
    if (raw.line) it.line = 1;                                    // 형광펜 직선
  } else if (t === 'fbox') {                                      // 송폼 박스 — 악보 위 투명한 네모 테두리 + 이름표
    const k = String(raw.k || '');
    if (!FBOX_TAG_RE.test(k)) return null;
    it.k = k;
    it.x = r4(num(raw.x, 0, 1, 0)); it.y = r4(num(raw.y, 0, 1, 0));
    it.w = r4(num(raw.w, 0.004, 1, 0.1)); it.h = r4(num(raw.h, 0.004, 1, 0.05));
    if (it.x + it.w > 1) it.w = r4(1 - it.x);
    if (it.y + it.h > 1) it.h = r4(1 - it.y);
    if (it.w < 0.004 || it.h < 0.004) return null;
    it.sz = r4(num(raw.sz, 0.008, 0.06, 0.02));
  } else {
    it.x = r4(num(raw.x, 0, 1, 0)); it.y = r4(num(raw.y, 0, 1, 0));
    it.sz = r4(num(raw.sz, 0.004, 0.25, 0.02));
    if (raw.rot != null) it.rot = Math.round(num(raw.rot, -180, 180, 0));
    if (t === 'text') {
      const s = String(raw.s == null ? '' : raw.s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, LIMITS.maxText);
      if (!s.trim()) return null;
      it.s = s;
      if (raw.chord) it.chord = 1;                                 // 코드 표기 (굵게 · 색 강조)
      if (FONT_KEYS.indexOf(raw.f) > 0) it.f = raw.f;              // 명조 · 손글씨 (고딕은 기본이라 저장하지 않음)
    } else {
      const k = String(raw.k || '');
      if (SYMBOLS.indexOf(k) === -1) return null;
      it.k = k;
      if (raw.w2 != null) it.w2 = r4(num(raw.w2, 0.005, 0.6, 0.05));   // 늘어나는 기호(크레센도 · 붙임줄)의 길이
      if (FONT_KEYS.indexOf(raw.f) > 0 && (k.indexOf('g:') === 0 || k.indexOf('dyn:') === 0)) it.f = raw.f;   // 글자 모양 기호의 글꼴
    }
  }
  if (JSON.stringify(it).length > LIMITS.maxItemBytes) return null;
  return it;
}

/** 클릭 컨트롤이 보낸 메트로놈 상태를 검사 · 정리 (이상한 값은 안전한 범위로) */
function cleanMetro(p) {
  p = p && typeof p === 'object' ? p : {};
  const n = Math.round(num(p.num, 1, 16, 4));
  const marks = [];
  for (let i = 0; i < n; i++) marks.push(Array.isArray(p.marks) && p.marks[i] ? 1 : 0);
  return { playing: !!p.playing, bpm: Math.round(num(p.bpm, 30, 300, 72) * 10) / 10, num: n, den: Number(p.den) === 8 ? 8 : 4, marks,
    count: Math.round(num(p.count, 0, 4, 0)), keep: !!p.keep };
}

function attach(httpServer, deps, opt) {
  opt = opt || {};
  const L = Object.assign({}, LIMITS, opt.limits || {});
  const log = deps.log || (() => {});
  const now = deps.now || (() => Date.now());
  const io = new Server(httpServer, {
    path: opt.path || '/socket.io', maxHttpBufferSize: 200 * 1024, cors: false, serveClient: true,
    pingInterval: 20000, pingTimeout: 25000, connectTimeout: 15000,
  });

  const rooms = new Map();        // roomId → room
  const saveQueue = [];           // [layer]
  let saving = false, lastSaveAt = 0, saveTimer = null;

  function roomOf(id) {
    let r = rooms.get(id);
    if (!r) {
      if (rooms.size >= L.maxRooms) return null;
      r = { id, leader: null, clicker: null, nav: null, metro: null, metroSeq: 0, layers: new Map(), members: new Map() };
      rooms.set(id, r);
    }
    return r;
  }
  const peers = (room) => Array.from(room.members.values()).map((m) => ({ name: m.name, lead: !!(room.leader && room.leader.sid === m.sid), click: !!(room.clicker && room.clicker.sid === m.sid), canLead: !!m.canLead, follow: m.follow || null, stage: !!m.stage }));
  const sendPeers = (room) => io.to(room.id).emit('peers', peers(room));

  /* ---------------------------------------------------------- 저장 (묶어서 · 천천히) */
  function layerKey(file, scope) { return file + '|' + scope; }
  function markDirty(room, layer) {
    layer.dirty = true;
    if (layer.timer) return;
    layer.timer = setTimeout(() => { layer.timer = null; enqueue(room, layer); }, L.saveDelayMs);
    if (layer.timer.unref) layer.timer.unref();
  }
  function enqueue(room, layer) {
    if (layer.queued) return;
    layer.queued = true; saveQueue.push({ room, layer }); pump();
  }
  function pump() {
    if (saving || !saveQueue.length || saveTimer) return;
    const wait = Math.max(0, lastSaveAt + L.saveGapMs - now());
    saveTimer = setTimeout(() => { saveTimer = null; runOne(); }, wait);
    if (saveTimer.unref) saveTimer.unref();
  }
  function runOne() {
    const job = saveQueue.shift();
    if (!job) return;
    saving = true;
    const { room, layer } = job;
    layer.queued = false; layer.dirty = false;
    let ok = false, msg = '';
    try {
      deps.saveAnno(layer.file, layer.scope, Array.from(layer.items.values()), 'team', room.team);   // PBH — 방의 팀
      ok = true;
    } catch (e) { msg = (e && e.message) || String(e); layer.dirty = true; log('[필기 저장 실패]', layer.file, msg); }
    lastSaveAt = now(); saving = false;
    io.to(room.id).emit('anno:saved', { file: layer.file, scope: layer.scope, ok, at: lastSaveAt, error: ok ? '' : msg });
    if (!ok) { layer.retry = setTimeout(() => { layer.retry = null; if (layer.dirty) enqueue(room, layer); }, L.retryMs); if (layer.retry.unref) layer.retry.unref(); }
    if (!room.members.size && !layer.dirty) dropIfIdle(room);
    pump();
  }
  /** 사람이 모두 나간 방 — 저장할 것이 남았으면 저장하고 정리 */
  function dropIfIdle(room) {
    if (room.members.size) return;
    const pending = Array.from(room.layers.values()).some((l) => l.dirty || l.queued);
    if (!pending) rooms.delete(room.id);
  }
  /** 서버가 꺼지기 전 — 남은 필기를 모두 저장합니다 (동기) */
  function flushAll() {
    let n = 0;
    rooms.forEach((room) => room.layers.forEach((layer) => {
      if (!layer.dirty && !layer.queued) return;
      try { deps.saveAnno(layer.file, layer.scope, Array.from(layer.items.values()), 'team', room.team); layer.dirty = false; n++; } catch (e) { log('[종료 저장 실패]', e && e.message); }   // PBH — 방의 팀
    }));
    return n;
  }

  function getLayer(room, file, scope) {
    const k = layerKey(file, scope);
    let layer = room.layers.get(k);
    if (layer) return layer;
    if (room.layers.size >= L.maxLayers) return null;
    layer = { file, scope, items: new Map(), dirty: false, queued: false, timer: null, retry: null };
    let list = [];
    try { list = deps.loadAnno(file, scope, room.team) || []; } catch (e) { throw new Error('저장된 필기를 불러오지 못했습니다: ' + ((e && e.message) || e)); }   // PBH — 방의 팀
    (Array.isArray(list) ? list : []).slice(0, L.maxItems).forEach((it) => {
      const c = cleanItem(it, { name: String((it && it.by) || '') }, Number(it && it.ts) || now());
      if (c) { c.by = String((it && it.by) || ''); c.ts = Number(it && it.ts) || c.ts; layer.items.set(c.id, c); }
    });
    room.layers.set(k, layer);
    return layer;
  }

  /* ---------------------------------------------------------- 접속 */
  io.on('connection', (socket) => {
    let bucket = L.burst, lastFill = now(), strikes = 0, strikeAt = 0;
    const authTimer = setTimeout(() => { if (!socket.data.user) socket.disconnect(true); }, 10000);
    if (authTimer.unref) authTimer.unref();

    /** 너무 자주 보내면 막습니다 — 계속 어기면 연결을 끊습니다 */
    function allow() {
      const t = now();
      bucket = Math.min(L.burst, bucket + (t - lastFill) / 1000 * L.perSec); lastFill = t;
      if (bucket >= 1) { bucket -= 1; return true; }
      if (t - strikeAt > 10000) strikes = 0;
      strikeAt = t;
      if (++strikes >= L.abuseKill) socket.disconnect(true);
      return false;
    }
    const RO_BLOCK = new Set(['leader:claim', 'leader:release', 'nav', 'prefs', 'cue', 'lead', 'click:claim', 'click:release', 'metro', 'timer:cmd', 'anno:add', 'anno:del', 'anno:clear', 'anno:live', 'anno:save']);
    /** 이벤트 처리기 — 인증 · 속도 · 오류를 한곳에서 */
    function on(name, needAuth, fn) {
      socket.on(name, (payload, ack) => {
        if (typeof payload === 'function') { ack = payload; payload = {}; }
        const done = typeof ack === 'function' ? ack : () => {};
        try {
          if (!allow()) return done({ ok: false, code: 'rate', error: '너무 빠르게 보내고 있습니다. 잠시 후 다시 해주세요.' });
          const u = socket.data.user, room = socket.data.room ? rooms.get(socket.data.room) : null;
          if (u && u.ro && RO_BLOCK.has(name)) return done({ ok: false, code: 'perm', error: '방송팀 보기 링크는 읽기 전용입니다.' });   // 방송팀 보기 — 보기만
          // needAuth === 'user' : 방 없이 가벼운 접속(light)도 허용 (예배 타이머 화면)
          if (needAuth === 'user' ? (!u || !socket.data.tkey) : (needAuth && (!u || !room))) return done({ ok: false, code: 'auth', error: '먼저 방에 들어와야 합니다.' });
          const out = fn(payload && typeof payload === 'object' ? payload : {}, u, room, done);
          if (out !== undefined) done(out);
        } catch (e) {
          log('[realtime]', name, e && e.message);
          done({ ok: false, code: 'error', error: (e && e.message) || '처리하지 못했습니다.' });
        }
      });
    }

    on('join', false, (p) => {
      const roomKey = String(p.room || '');
      if (!ROOM_RE.test(roomKey)) return { ok: false, code: 'room', error: '예배(날짜)를 확인해주세요.' };
      let user;
      try { user = deps.auth(String(p.token || '')); } catch (e) { return { ok: false, code: 'auth', error: (e && e.message) || '접근할 수 없습니다.' }; }
      if (!user || !user.name) return { ok: false, code: 'auth', error: '접근할 수 없습니다.' };
      if (user.ro && (p.light || user.room !== roomKey)) return { ok: false, code: 'auth', error: '이 링크로는 해당 예배의 라이브 악보만 볼 수 있습니다.' };
      if (user.guest && !p.light && !require('./guestAccess').roomOk(user, roomKey)) return { ok: false, code: 'auth', error: '객원 멤버는 스케줄에 서는 날만 열 수 있습니다. 화면을 다시 열어주세요.' };   // 객원 멤버
      if (socket.data.room || socket.data.tkey) leave();
      const you = { name: user.name, canEdit: !!user.canEdit, canLead: !!user.canLead, committee: !!user.committee };
      const tk = teamKey(user, roomKey);                                   // PBH — 팀마다 다른 방 · 다른 예배 타이머
      if (p.light) {           // 가벼운 접속 — 방 사람 목록 · 필기 · 메트로놈 없이 예배 타이머만 (허브 화면 맨 위 막대)
        socket.data.user = user; socket.data.room = null; socket.data.tkey = tk; socket.data.light = true;
        socket.join('wt:' + tk);
        return { ok: true, light: true, you, timer: timerGet(tk, now()), serverTime: now() };
      }
      const room = roomOf('w:' + tk);
      if (!room) return { ok: false, code: 'busy', error: '지금은 새 방을 열 수 없습니다. 잠시 후 다시 해주세요.' };
      if (user.team) room.team = String(user.team);                        // PBH — 이 방 필기를 어느 팀으로 저장할지
      socket.data.user = user; socket.data.room = room.id; socket.data.tkey = tk; socket.data.light = false;
      room.members.set(socket.id, { sid: socket.id, name: user.name, canLead: !!user.canLead, stage: !!p.stage });   // stage: 방송팀 화면 (요청 메시지를 받는 쪽)
      socket.join(room.id); socket.join('wt:' + tk);
      sendPeers(room);
      return { ok: true, you,
        leader: room.leader ? room.leader.name : null, clicker: room.clicker ? room.clicker.name : null, nav: room.nav, metro: room.metro, lead: room.lead || null, peers: peers(room), timer: timerGet(tk, now()), serverTime: now(), msgs: recentMsgs(room) };
    });

    function leave() {
      const room = socket.data.room ? rooms.get(socket.data.room) : null;
      if (socket.data.tkey) { socket.leave('wt:' + socket.data.tkey); socket.data.tkey = null; }
      socket.data.room = null; socket.data.light = false;
      if (!room) return;
      socket.leave(room.id);
      room.members.delete(socket.id);
      if (room.leader && room.leader.sid === socket.id) { room.leader = null; io.to(room.id).emit('leader', { name: null, reason: 'left' }); }
      if (room.clicker && room.clicker.sid === socket.id) { room.clicker = null; io.to(room.id).emit('clicker', { name: null, reason: 'left' }); }
      sendPeers(room);
      // 남은 필기는 저장한 뒤에 방을 정리합니다
      room.layers.forEach((layer) => { if (layer.dirty && !layer.queued) { if (layer.timer) { clearTimeout(layer.timer); layer.timer = null; } enqueue(room, layer); } });
      dropIfIdle(room);
    }
    socket.on('disconnect', () => { clearTimeout(authTimer); leave(); });
    on('leave', 'user', () => { leave(); return { ok: true }; });
    on('ping', false, () => ({ ok: true, t: now() }));

    /* ---- 리더 · 팔로워 ---- */
    on('leader:claim', true, (p, u, room) => {
      if (!u.canLead) return { ok: false, code: 'perm', error: '팀장 · 인도자만 리더가 될 수 있습니다.' };
      if (room.leader && room.leader.sid !== socket.id && !p.force) return { ok: false, code: 'taken', leader: room.leader.name, error: room.leader.name + ' 님이 리더입니다.' };
      room.leader = { sid: socket.id, name: u.name };
      io.to(room.id).emit('leader', { name: u.name, reason: p.force ? 'takeover' : 'claim' });
      sendPeers(room);
      return { ok: true };
    });
    on('leader:release', true, (p, u, room) => {
      if (room.leader && room.leader.sid === socket.id) { room.leader = null; io.to(room.id).emit('leader', { name: null, reason: 'release' }); sendPeers(room); }
      return { ok: true };
    });
    on('nav', true, (p, u, room) => {
      if (!room.leader || room.leader.sid !== socket.id) return { ok: false, code: 'perm', error: '페이지 컨트롤만 넘길 수 있습니다.' };
      const nav = { file: FILE_RE.test(String(p.file || '')) ? String(p.file) : '', page: Math.round(num(p.page, 1, 500, 1)),
        song: Math.round(num(p.song, -1, 200, -1)), zoom: r4(num(p.zoom, 0.3, 6, 1)), sy: r4(num(p.sy, 0, 1, 0)), t: now() };
      room.nav = nav;
      socket.to(room.id).emit('nav', nav);
      return { ok: true };
    });
    /* 내 따라가기 상태 { page, metro } — 접속자 목록에 표시 (컨트롤이 누가 따로 보는지 알 수 있게). 방 전체에 peers 로 다시 알림 */
    on('prefs', true, (p, u, room) => {
      const m = room.members.get(socket.id); if (!m) return { ok: false, code: 'auth', error: '먼저 방에 들어와야 합니다.' };
      m.follow = { page: p.page !== false, metro: p.metro !== false };
      sendPeers(room);
      return { ok: true };
    });
    /* V842 — 리드(페이지 컨트롤 · 클릭 컨트롤, 아무도 안 맡았으면 팀장 · 인도자)가 보내는 "보이기만 하는" 상태.
       소리는 절대 보내지 않습니다 — 받는 쪽은 BPM 숫자 · 송폼 위치만 화면에 맞춥니다. 늦게 들어온 사람도 join 에서 받습니다. */
    const canLeadNow = (room, u) => (room.leader && room.leader.sid === socket.id) || (room.clicker && room.clicker.sid === socket.id) || (!room.leader && !room.clicker && !!u.canLead);
    on('lead', true, (p, u, room) => {
      if (!canLeadNow(room, u)) return { ok: false, code: 'perm', error: '리드(페이지 컨트롤)만 보낼 수 있습니다.' };
      const prev = room.lead || {};
      const songNow = p.song != null ? Math.round(num(p.song, -1, 200, -1)) : (prev.song != null ? prev.song : -1);
      if (p.fi == null && songNow !== prev.song) p.fi = -1;                 // 곡이 바뀌었는데 송폼 위치를 안 보냈으면 처음부터 (앞 곡의 위치가 남지 않게)
      const st = { bpm: p.bpm != null ? Math.round(num(p.bpm, 30, 300, 120)) : (prev.bpm || null), num: p.num != null ? Math.round(num(p.num, 1, 16, 4)) : (prev.num || null), den: p.den != null ? Math.round(num(p.den, 1, 16, 4)) : (prev.den || null),
        song: p.song != null ? Math.round(num(p.song, -1, 200, -1)) : (prev.song != null ? prev.song : -1), fi: p.fi != null ? Math.round(num(p.fi, -1, 200, -1)) : (prev.fi != null ? prev.fi : -1),
        cue: p.cue != null ? String(p.cue || '').slice(0, 40) : '', seq: ((prev.seq || 0) + 1), by: u.name, t: now() };
      room.lead = st;
      socket.to(room.id).emit('lead', st);
      return { ok: true, lead: st };
    });
    on('cue', true, (p, u, room) => {
      const isCtl = (room.leader && room.leader.sid === socket.id) || (room.clicker && room.clicker.sid === socket.id);
      if (!isCtl) return { ok: false, code: 'perm', error: '페이지 컨트롤 · 클릭 컨트롤만 큐를 보낼 수 있습니다.' };
      const cue = { label: String(p.label || '').slice(0, 40), kind: String(p.kind || '').slice(0, 20), by: u.name, t: now() };
      if (!cue.label) return { ok: false, code: 'bad', error: '큐 이름이 비어 있습니다.' };
      socket.to(room.id).emit('cue', cue);
      return { ok: true };
    });

    /* ---- 요청 메시지 — 찬양팀 ↔ 방송팀 (방송팀 화면 · 라이브 악보). 저장하지 않고 방 메모리에 최근 것만 (늦게 들어온 화면 · 다시 붙은 화면용).
       to: 'bc'(방송팀 화면 전체) · 'team'(라이브 악보를 연 찬양팀 전체) · 이름(그 사람). 방송팀 보기 링크(읽기 전용)도 보내고 확인할 수 있습니다. */
    let msgLast = 0;
    on('msg', true, (p, u, room) => {
      const t = now();
      if (t - msgLast < 700) return { ok: false, code: 'rate', error: '조금 천천히 보내주세요.' };
      const text = String(p.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MSG_MAX);
      if (!text) return { ok: false, code: 'bad', error: '보낼 내용이 없습니다.' };
      const to = p.to === 'bc' || p.to === 'team' ? p.to : String(p.to || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
      if (!to) return { ok: false, code: 'bad', error: '받는 사람을 골라주세요.' };
      msgLast = t;
      const m = { id: t.toString(36) + Math.random().toString(36).slice(2, 7), from: u.name, fromStage: !!(room.members.get(socket.id) || {}).stage, to, text,
        kind: String(p.kind || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 20), t, ack: null };
      room.msgs = (room.msgs || []).concat(m).slice(-MSG_KEEP);
      io.to(room.id).emit('msg', m);
      return { ok: true, msg: m };
    });
    on('msg:ack', true, (p, u, room) => {
      const id = String(p.id || '').slice(0, 40), m = (room.msgs || []).find((x) => x.id === id);
      if (!m) return { ok: true, gone: true };
      if (!m.ack) { const stage = !!(room.members.get(socket.id) || {}).stage; m.ack = { by: u.name, t: now(), stage }; io.to(room.id).emit('msg:ack', { id, by: u.name, t: m.ack.t, stage }); }
      return { ok: true, ack: m.ack };
    });

    /* 기록 지우기 — 방송팀 화면에서만. 방 메모리의 요청을 비우고, 다른 방송팀 화면도 같이 비웁니다 */
    on('msg:clear', true, (p, u, room) => {
      if (!(room.members.get(socket.id) || {}).stage) return { ok: false, code: 'perm', error: '기록은 방송팀 화면에서만 지울 수 있습니다.' };
      room.msgs = [];
      io.to(room.id).emit('msg:clear', { by: u.name, t: now() });
      return { ok: true };
    });

    /* ---- 클릭 컨트롤 (메트로놈) — 페이지 컨트롤(리더)과 독립 ---- */
    on('click:claim', true, (p, u, room) => {
      if (!u.canLead) return { ok: false, code: 'perm', error: '팀장 · 인도자만 클릭 컨트롤을 맡을 수 있습니다.' };
      if (room.clicker && room.clicker.sid !== socket.id && !p.force) return { ok: false, code: 'taken', clicker: room.clicker.name, error: room.clicker.name + ' 님이 클릭 컨트롤입니다.' };
      room.clicker = { sid: socket.id, name: u.name };
      io.to(room.id).emit('clicker', { name: u.name, reason: p.force ? 'takeover' : 'claim' });
      sendPeers(room);
      return { ok: true };
    });
    on('click:release', true, (p, u, room) => {
      if (room.clicker && room.clicker.sid === socket.id) { room.clicker = null; io.to(room.id).emit('clicker', { name: null, reason: 'release' }); sendPeers(room); }
      return { ok: true };
    });
    /**
     * 메트로놈 상태 — 클릭 컨트롤만. 방 전체(보낸 사람 포함)에 같은 상태를 보내 모두가 같은 시각(startAt)에 시작합니다.
     *   · 시작 · BPM · 박자가 바뀌면 startAt = 서버 지금 + METRO_LEAD_MS (모두 첫 박부터 다시 맞춤)
     *   · 강세(marks)만 바뀐 경우(keep)에는 기존 startAt 을 그대로 두어 박이 끊기지 않게 합니다
     *   · 멈춤이면 startAt = null
     */
    on('metro', true, (p, u, room) => {
      if (!room.clicker || room.clicker.sid !== socket.id) return { ok: false, code: 'perm', error: '클릭 컨트롤만 메트로놈을 조절할 수 있습니다.' };
      const c = cleanMetro(p), prev = room.metro;
      const same = prev && prev.playing && prev.startAt && prev.bpm === c.bpm && prev.num === c.num && prev.den === c.den;
      const st = { playing: c.playing, bpm: c.bpm, num: c.num, den: c.den, marks: c.marks, count: c.count,
        startAt: !c.playing ? null : (c.keep && same ? prev.startAt : now() + METRO_LEAD_MS), seq: ++room.metroSeq, by: u.name, t: now() };
      room.metro = st;
      io.to(room.id).emit('metro', st);
      return { ok: true, metro: st };
    });

    /* ---- 예배 타이머 — 조작은 팀장 · 인도자(canLead)만, 결과 상태는 같은 예배를 보는 모두(보낸 사람 포함)에게 ---- */
    on('timer:cmd', 'user', (p, u) => timerCommand(socket.data.tkey, u, p));
    on('timer:get', 'user', () => ({ ok: true, state: timerGet(socket.data.tkey, now()), serverTime: now() }));

    /* ---- 필기 ---- */
    const scopeOf = (s) => { s = String(s || 'song'); return s === 'song' || ROOM_RE.test(s) ? s : null; };
    const fileOf = (f) => (FILE_RE.test(String(f || '')) ? String(f) : null);
    function layerFor(p, room) {
      const file = fileOf(p.file), scope = scopeOf(p.scope);
      if (!file || !scope) throw new Error('악보 파일을 확인해주세요.');
      const layer = getLayer(room, file, scope);
      if (!layer) throw new Error('한 번에 열 수 있는 악보 수를 넘었습니다.');
      return layer;
    }
    on('anno:load', true, (p, u, room) => {
      const layer = layerFor(p, room);
      return { ok: true, file: layer.file, scope: layer.scope, items: Array.from(layer.items.values()) };
    });
    on('anno:add', true, (p, u, room) => {
      const layer = layerFor(p, room);
      const it = cleanItem(p.item, u, now());
      if (!it) return { ok: false, code: 'bad', error: '필기 형식이 올바르지 않습니다.' };
      if (!layer.items.has(it.id) && layer.items.size >= L.maxItems) return { ok: false, code: 'full', error: '이 악보에 필기가 너무 많습니다. 일부를 지워주세요.' };
      const old = layer.items.get(it.id);
      if (old && old.by !== u.name && !u.canEdit) return { ok: false, code: 'perm', error: '다른 사람의 필기는 고칠 수 없습니다.' };
      if (old) it.by = old.by;
      layer.items.set(it.id, it);
      markDirty(room, layer);
      socket.to(room.id).emit('anno:add', { file: layer.file, scope: layer.scope, item: it });
      return { ok: true, item: it };
    });
    on('anno:del', true, (p, u, room) => {
      const layer = layerFor(p, room);
      const id = String(p.id || ''), it = layer.items.get(id);
      if (!it) return { ok: true, gone: true };
      if (it.by !== u.name && !u.canEdit) return { ok: false, code: 'perm', error: '다른 사람의 필기는 지울 수 없습니다.' };
      layer.items.delete(id);
      markDirty(room, layer);
      socket.to(room.id).emit('anno:del', { file: layer.file, scope: layer.scope, id, by: u.name });
      return { ok: true };
    });
    on('anno:clear', true, (p, u, room) => {
      const layer = layerFor(p, room);
      const pg = p.pg == null ? null : Math.round(num(p.pg, 1, 500, 1));
      const mineOnly = !u.canEdit || !!p.own;                    // 팀장 · 인도자만 남의 필기까지 지웁니다
      const gone = [];
      layer.items.forEach((it, id) => {
        if (pg != null && it.pg !== pg) return;
        if (mineOnly && it.by !== u.name) return;
        gone.push(id);
      });
      gone.forEach((id) => layer.items.delete(id));
      if (gone.length) { markDirty(room, layer); socket.to(room.id).emit('anno:clear', { file: layer.file, scope: layer.scope, ids: gone, by: u.name }); }
      return { ok: true, n: gone.length, ids: gone };
    });
    /** 그리는 중인 선 — 저장하지 않고 다른 사람 화면에만 보여줍니다 */
    on('anno:live', true, (p, u, room) => {
      const file = fileOf(p.file), id = String(p.id || '');
      if (!file || !ID_RE.test(id) || !Array.isArray(p.p) || p.p.length > 400) return { ok: false, code: 'bad' };
      const pts = [];
      for (let i = 0; i + 1 < p.p.length; i += 2) pts.push(r4(num(p.p[i], 0, 1, 0)), r4(num(p.p[i + 1], 0, 1, 0)));
      socket.to(room.id).volatile.emit('anno:live', { file, id, t: p.t === 'hl' ? 'hl' : 'pen', pg: Math.round(num(p.pg, 1, 500, 1)),
        c: COLOR_RE.test(String(p.c || '')) ? p.c : '#ff5a1f', w: r4(num(p.w, 0.0005, 0.06, 0.003)), p: pts, by: u.name, fresh: p.fresh ? 1 : 0 });
      return { ok: true };
    });
    on('anno:save', true, (p, u, room) => {                     // "지금 저장" 버튼
      const layer = layerFor(p, room);
      if (layer.timer) { clearTimeout(layer.timer); layer.timer = null; }
      if (layer.dirty || p.force) { layer.dirty = true; enqueue(room, layer); }
      return { ok: true, pending: layer.dirty };
    });
  });

  /* ---------------------------------------------------------- 예배 타이머 (소켓 · HTTP 공통) */
  function timerCommand(key, user, raw) {
    const r = timerApply(key, user, raw, now());
    if (r.ok && r.changed) io.to('wt:' + key).emit('timer', r.state);
    return r;
  }
  /* HTTP 대체 통로 — 웹소켓이 막힌 기기용. 로그인 확인은 소켓과 같은 deps.auth 이고, 잦은 확인은 30초 동안 결과를 기억합니다 (시트를 매번 읽지 않도록) */
  const authCache = new Map(), httpBucket = new Map();
  function httpUser(token) {
    token = String(token || '');
    if (!token || token.length > 600) throw new Error('접근할 수 없습니다.');
    const t = now(), c = authCache.get(token);
    if (c && c.exp > t) { if (c.err) throw new Error(c.err); return c.user; }
    if (authCache.size > 500) authCache.clear();
    try {
      const u = deps.auth(token);
      if (!u || !u.name) throw new Error('접근할 수 없습니다.');
      authCache.set(token, { user: u, exp: t + 30000 });
      return u;
    } catch (e) { authCache.set(token, { err: (e && e.message) || '접근할 수 없습니다.', exp: t + 10000 }); throw e; }
  }
  function httpAllow(token) {
    const t = now(); let b = httpBucket.get(token);
    if (!b) { if (httpBucket.size > 500) httpBucket.clear(); b = { n: 60, t }; httpBucket.set(token, b); }
    b.n = Math.min(60, b.n + (t - b.t) / 1000 * 20); b.t = t;
    if (b.n >= 1) { b.n -= 1; return true; }
    return false;
  }
  /**
   * POST /api/worshipTimerGet  { args: [token, room, sid, seq] }   → { ok, result:{ serverTime, you, same? , state? } }
   * POST /api/worshipTimerCmd  { args: [token, room, cmd] }        → { ok, result:{ serverTime, you, state, changed } }   (바뀌면 소켓 방에도 알림)
   */
  function timerHttp(kind, args) {
    args = Array.isArray(args) ? args : [];
    const key = String(args[1] || '');
    if (!ROOM_RE.test(key)) return { ok: false, code: 'room', error: '예배(날짜)를 확인해주세요.' };
    let user;
    try { user = httpUser(args[0]); } catch (e) { return { ok: false, code: 'auth', error: (e && e.message) || '접근할 수 없습니다.' }; }
    if (user.ro && (kind !== 'get' || user.room !== key)) return { ok: false, code: 'perm', error: '방송팀 보기 링크는 읽기 전용입니다.' };
    if (user.guest && !require('./guestAccess').roomOk(user, key)) return { ok: false, code: 'auth', error: '객원 멤버는 스케줄에 서는 날만 열 수 있습니다.' };
    if (!httpAllow(String(args[0]))) return { ok: false, code: 'rate', error: '너무 빠르게 보내고 있습니다. 잠시 후 다시 해주세요.' };
    const you = { name: user.name, canEdit: !!user.canEdit, canLead: !!user.canLead, committee: !!user.committee };
    const tk = teamKey(user, key);                                        // PBH — 팀마다 다른 예배 타이머
    if (kind === 'get') {
      const st = timerGet(tk, now());
      const same = String(args[2] || '') === st.sid && Number(args[3]) === st.seq;
      return { ok: true, result: same ? { serverTime: now(), you, same: true } : { serverTime: now(), you, state: st } };
    }
    if (kind === 'cmd') {
      const r = timerCommand(tk, user, args[2]);
      if (!r.ok) return r;
      return { ok: true, result: { serverTime: r.serverTime, you, state: r.state, changed: r.changed } };
    }
    return { ok: false, code: 'bad', error: '알 수 없는 요청입니다.' };
  }

  /** 서버 쪽에서 방 사람들에게 알림 (HTTP 로 저장된 설정 · 곡 정보가 바뀌었을 때) — 허용된 이벤트만 */
  const BCAST_OK = { cfg: 1, song: 1, 'songs:changed': 1 };
  function broadcast(roomKey, event, payload, team) {                    // PBH — team 이 있으면 그 팀의 방에만
    if (!BCAST_OK[event] || !ROOM_RE.test(String(roomKey || ''))) return false;
    io.to('w:' + teamKey(team ? { team } : null, String(roomKey))).emit(event, payload || {});
    return true;
  }
  return { io, rooms, flushAll, broadcast, cleanItem, limits: L, timerGet: (k) => timerGet(k, now()), timerCommand, timerHttp, close: () => { flushAll(); return new Promise((res) => io.close(res)); } };
}

/** 시험용 — 타이머 저장소를 비웁니다 */
function timerReset() { timers.clear(); if (timerSweepT) { clearInterval(timerSweepT); timerSweepT = null; } }
const cleanTimerCmd = YT.cleanCmd;

module.exports = { attach, cleanItem, cleanMetro, cleanTimerCmd, timerGet, timerApply, timerSweep, timerReset, timers, TIMER_TTL_MS, TIMER_MAX, LIMITS, SYMBOLS, ROOM_RE, METRO_LEAD_MS };
