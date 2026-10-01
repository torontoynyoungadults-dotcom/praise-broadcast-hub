/**
 * 객원 멤버 — 가입할 때 "객원 멤버"로 체크한 사람.
 *   · 스케줄(찬양편성)에 이름이 있는 날(예배 · 행사)만 그 날의 콘티 · 라이브 악보 · 필기 · 댓글을 쓸 수 있고, 그날은 모든 것을 팀원과 똑같이 씁니다.
 *   · 공지 및 모임 · 스케줄표는 늘 볼 수 있고, 라이브러리 · 행사 · 장비 · 팀원관리 · 관리 화면은 닫혀 있습니다.
 *   · 관리자는 팀원관리에서 접속을 일시 중지하거나 멤버를 삭제할 수 있습니다 (회원.접속중지 = 'TRUE').
 * 방(room) 이름: 'YYYY-MM-DD' (보통 주일) · 'ev-<행사ID>' (행사) — lib/liveStore.js 와 같은 규칙.
 */
const sheetsDb = require('./sheetsDb');

const T = (v) => String(v || '').toUpperCase() === 'TRUE';
const isGuest = (m) => !!m && T(m['객원']);
const isSuspended = (m) => !!m && T(m['접속중지']);

/** 이 사람이 서는 날들의 방 이름 Set — 찬양편성에 이름이 있는 예배(날짜) · 행사 */
async function servingRooms(team, name) {
  const set = new Set();
  const n = String(name || '').trim();
  if (!n) return set;
  (await sheetsDb.readAll('찬양편성')).forEach((r) => {
    if (r['팀ID'] !== team || String(r['이름'] || '').trim() !== n) return;
    if (r['행사ID']) set.add('ev-' + r['행사ID']); else if (r['날짜']) set.add(String(r['날짜']));
  });
  return set;
}
/** 어떤 범위({event,date})가 이 사람이 서는 날인가 */
const scopeRoom = (scope) => (scope && scope.event ? 'ev-' + scope.event : String((scope && scope.date) || ''));
async function canSee(member, team, scope) {
  if (!isGuest(member)) return true;
  if (isSuspended(member)) return false;
  return (await servingRooms(team, member['이름'])).has(scopeRoom(scope));
}

/* ---- 라이브 악보(소켓 · /api) 용 — 동기로 확인해야 해서 짧게 기억해 둡니다 ---- */
const CACHE = new Map();
const TTL = 30 * 1000;
const keyOf = (team, name) => team + '\u0001' + name;
async function prime(member, team) {
  const set = await servingRooms(team, member['이름']);
  CACHE.set(keyOf(team, String(member['이름'] || '').trim()), { set, susp: isSuspended(member), exp: Date.now() + TTL });
  return set;
}
/** 토큰의 사람이 이 방에 들어가도 되나 — 객원이 아니면 늘 true. 기억해 둔 것이 없으면 false(화면을 다시 열면 채워짐) */
function roomOk(user, room) {
  if (!user || !user.guest) return true;
  const e = CACHE.get(keyOf(user.team, user.name));
  if (!e) return false;
  if (e.exp < Date.now()) refresh(user);                          // 오래됐으면 이번엔 그대로 쓰고 뒤에서 새로 채움
  if (e.susp) return false;
  return e.set.has(String(room || '').replace(/~.*$/, ''));
}
async function refresh(user) {
  try {
    const m = await sheetsDb.findOne('회원', '이메일', user.email);
    if (!m) { CACHE.delete(keyOf(user.team, user.name)); return; }
    await prime(m, user.team);
  } catch (e) { /* 다음에 다시 */ }
}
/** /api 호출 직전 — 객원이면 최신으로 채움 (삭제 · 일시 중지도 여기서 막힘) */
async function ensure(user) {
  if (!user || !user.guest) return;
  const m = await sheetsDb.findOne('회원', '이메일', user.email);
  if (!m || isSuspended(m)) throw new Error('접속이 중지되었습니다. 관리자에게 문의해주세요.');
  await prime(m, user.team);
}

module.exports = { isGuest, isSuspended, servingRooms, scopeRoom, canSee, prime, ensure, roomOk };
