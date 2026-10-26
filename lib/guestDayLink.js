/**
 * 객원 공유 링크 — 그날(예배 · 행사) 하나의 콘티만, 로그인 없이 여는 비밀 주소 (/g/<열쇠>).
 * 객원(다른 부서 · 청년2부 찬양팀 등 불러온 분)이 그날 스케줄에 있을 때 만들어 나눠 줍니다.
 *   · 열쇠는 '설정' 시트에 날(방)마다 한 줄 ('객원링크:<팀명>|<방>') — 바꾸면 예전 주소는 바로 쓸 수 없게 됩니다
 *   · 이 주소로는 그 날의 콘티 · 라이브 악보(필기 · 클릭 · 화음) · 녹음만 열립니다 (다른 날 · 다른 메뉴는 닫혀 있음)
 */
const crypto = require('crypto');
const sheetsDb = require('./sheetsDb');
const liveStore = require('./liveStore');

const PREFIX = '객원링크:';
const keyOf = (team, room) => PREFIX + team + '|' + room;
const baseRoom = (room) => String(room || '').replace(/~.*$/, '');

async function rows(fresh) { return (await sheetsDb.readAll('설정', fresh ? { fresh: true } : undefined)).filter((r) => String(r['키'] || '').indexOf(PREFIX) === 0); }

/** 이 날의 열쇠 (없으면 '') */
async function tokenFor(team, room) {
  const r = (await rows()).find((x) => x['키'] === keyOf(team, baseRoom(room)));
  return r ? String(r['값'] || '') : '';
}

/** 동시에 두 번 눌러도 한 개만 만들도록 */
const PENDING = new Map();
async function ensure(team, room) {
  room = baseRoom(room);
  const k = keyOf(team, room);
  const have = await tokenFor(team, room);
  if (have) return have;
  if (!PENDING.has(k)) PENDING.set(k, regenerate(team, room).finally(() => PENDING.delete(k)));
  return PENDING.get(k);
}

/** 새 열쇠를 만들어 저장 (이미 있으면 바꿈 — 예전 주소는 못 씀) */
async function regenerate(team, room) {
  room = baseRoom(room);
  const token = crypto.randomBytes(18).toString('base64url');
  const row = { '키': keyOf(team, room), '값': token, '설명': '객원 공유 링크 열쇠 — 그날 콘티만 열림 · 바꾸면 예전 주소는 쓸 수 없어요' };
  const existing = (await sheetsDb.readAll('설정', { fresh: true })).find((x) => x['키'] === keyOf(team, room));
  if (existing) await sheetsDb.updateRow('설정', existing.__row, row); else await sheetsDb.appendRow('설정', row);
  CACHE.delete(token);
  return token;
}

/* 소켓 · 파일 열람처럼 동기로 물어야 하는 곳을 위해 짧게 기억 (바꾸면 TTL 안에 막힘) */
const CACHE = new Map();
const TTL = 30 * 1000;

/** 열쇠 → { team, room, scope:{event,date} } (모르는 열쇠 · 비활성 팀 · 올바르지 않은 방이면 null) */
async function resolve(token) {
  token = String(token || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const hit = (await rows()).find((r) => String(r['값'] || '') === token);
  if (!hit) { CACHE.delete(token); return null; }
  const [team, room] = String(hit['키']).slice(PREFIX.length).split('|');
  const t = await sheetsDb.findOne('찬양팀', '팀명', team);
  if (!t || String(t['활성여부']).toUpperCase() === 'FALSE') { CACHE.delete(token); return null; }
  let scope;
  try { scope = liveStore.scopeOfRoom(room); } catch (e) { return null; }
  const v = { team, room, scope };
  CACHE.set(token, { v, exp: Date.now() + TTL });
  return v;
}

/** 동기 확인 — 이 열쇠가 이 방을 여는 열쇠인지 (기억해 둔 것 기준, 오래됐으면 뒤에서 새로 확인) */
function validSync(token, room) {
  const e = CACHE.get(String(token || ''));
  if (!e) return false;
  if (e.exp < Date.now()) resolve(token).catch(() => {});
  return baseRoom(room) === e.v.room;
}

module.exports = { tokenFor, ensure, regenerate, resolve, validSync, baseRoom };
