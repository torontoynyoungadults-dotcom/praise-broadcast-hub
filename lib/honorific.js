/**
 * 호칭 — 역할에 "목회자"가 들어 있는 사람은 모든 화면에서 "윤정환 목사" 으로 부릅니다.
 * (이름 · 호칭 규칙을 한곳에 모아 두어, 화면마다 같은 방식으로 쓰도록)
 *   isPastorRoles('인도자, 목회자')  → true
 *   await pastorSet(team)           → 그 팀의 목회자 이름 Set
 *   call(set, '윤정환')              → '윤정환 목사'
 */
const avatar = require('./avatar');

const SUFFIX = ' 목사';
const isPastorRoles = (roles) => /(^|,)\s*목회자\s*(,|$)/.test(String(roles || ''));

async function pastorSet(team) {
  const set = new Set();
  try {
    const info = await avatar.teamInfoMap(team);
    Object.keys(info).forEach((n) => { if (isPastorRoles(info[n].역할)) set.add(n); });
  } catch (e) { /* 호칭 없이도 화면은 떠야 함 */ }
  return set;
}
/** 여러 팀을 한꺼번에 (이름 → 목회자 여부) */
async function pastorSetOf(teams) {
  const out = new Set();
  for (const t of [].concat(teams || [])) (await pastorSet(t)).forEach((n) => out.add(n));
  return out;
}
const call = (set, name) => { name = String(name == null ? '' : name); return name && set && set.has(name.trim()) ? name + SUFFIX : name; };

/** 화면을 그리기 전에 prime(team) 으로 그 팀의 목사 명단을 미리 받아 두면, 아래 for(team, 이름) 이 곳곳에서 바로(동기) 호칭을 붙입니다 */
const CACHE = new Map();
async function prime(team) { team = String(team || ''); if (!team) return new Set(); const set = await pastorSet(team); CACHE.set(team, set); return set; }
const forTeam = (team, name) => call(CACHE.get(String(team || '')), name);

module.exports = { isPastorRoles, pastorSet, pastorSetOf, call, prime, forTeam, SUFFIX };
