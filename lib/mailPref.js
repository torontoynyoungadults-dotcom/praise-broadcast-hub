/**
 * 안내 메일 받기 — 기본은 받음. 본인이 알림 창(종)에서 끄면 회원.메일수신 = '끔' 이고 자동 안내 메일(연습 · 주일 · 콘티 올라옴)을 안 보냄.
 * (관리 화면의 "시험 메일" 은 관리자 본인에게 가는 것이라 그대로)
 */
const sheetsDb = require('./sheetsDb');
const find = async (email) => (await sheetsDb.readAll('회원')).find((m) => String(m['이메일'] || '').trim().toLowerCase() === String(email || '').trim().toLowerCase()) || null;
async function wants(email) { const m = await find(email); return !(m && String(m['메일수신'] || '').trim() === '끔'); }
async function set(email, on) {
  const m = await find(email);
  if (!m) return false;
  await sheetsDb.updateCells('회원', [{ row: m.__row, header: '메일수신', value: on ? '' : '끔' }]);
  return true;
}
module.exports = { wants, set };
