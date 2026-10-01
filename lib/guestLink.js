/**
 * 방송팀 보기 전용 링크 — 로그인 없이 "예배 콘티 · 스케줄표" 두 화면만 보는 비밀 주소 (/b/<열쇠>).
 * 열쇠는 '설정' 시트에 찬양팀마다 한 줄('방송팀링크:<팀명>')로 두고, 관리자가 새로 만들면 예전 주소는 바로 쓸 수 없게 됩니다.
 */
const crypto = require('crypto');
const sheetsDb = require('./sheetsDb');

const PREFIX = '방송팀링크:';
const keyOf = (team) => PREFIX + team;

async function rows() { return (await sheetsDb.readAll('설정')).filter((r) => String(r['키'] || '').indexOf(PREFIX) === 0); }

/** 이 팀의 열쇠 (없으면 '') */
async function tokenFor(team) {
  const r = (await rows()).find((x) => x['키'] === keyOf(team));
  return r ? String(r['값'] || '') : '';
}

/** 새 열쇠를 만들어 저장 (이미 있으면 바꿈 — 예전 주소는 못 씀) */
async function regenerate(team) {
  const token = crypto.randomBytes(18).toString('base64url');
  const row = { '키': keyOf(team), '값': token, '설명': '방송팀 보기 전용 링크 열쇠 — 바꾸면 예전 주소는 쓸 수 없어요' };
  const existing = (await sheetsDb.readAll('설정', { fresh: true })).find((x) => x['키'] === keyOf(team));
  if (existing) await sheetsDb.updateRow('설정', existing.__row, row); else await sheetsDb.appendRow('설정', row);
  return token;
}

/** 열쇠 → 찬양팀 이름 (모르는 열쇠 · 비활성 팀이면 null) */
async function teamOf(token) {
  token = String(token || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const hit = (await rows()).find((r) => String(r['값'] || '') === token);
  if (!hit) return null;
  const team = String(hit['키']).slice(PREFIX.length);
  const t = await sheetsDb.findOne('찬양팀', '팀명', team);
  if (!t || String(t['활성여부']).toUpperCase() === 'FALSE') return null;
  return team;
}

module.exports = { tokenFor, regenerate, teamOf };
