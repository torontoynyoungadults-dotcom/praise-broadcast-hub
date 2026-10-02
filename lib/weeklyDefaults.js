/**
 * 매주 고정 배정 — 지정한 사람을 앞으로 N주 동안 주일 편성(찬양편성)의 정해진 포지션에 자동으로 넣어 둡니다.
 *   · 그 팀 명단(회원 소속팀 · 팀원명단)에 있는 팀에서만, 그 날짜(주일, 행사 아님)에 그 포지션 배정이 하나도 없을 때만 추가
 *   · 다른 사람을 넣은 주는 건드리지 않음 (그 주만 바꾸려면 다른 사람을 배정하면 됨)
 *   · 일반 행(찬양편성)으로 저장하므로 스케줄표 · 콘티 · 허브 · 객원 열람 등 모든 화면이 그대로 읽음
 */
const sheetsDb = require('./sheetsDb');
const week = require('./weekUtil');
const { canonicalPosition } = require('./positions');

const DEFAULTS = [{ pos: '방송총괄', name: '한상완' }];
const WEEKS_AHEAD = 26;
let running = null;

async function run() {
  const [members, roster, assign] = await Promise.all([sheetsDb.readAll('회원'), sheetsDb.readAll('팀원명단'), sheetsDb.readAll('찬양편성')]);
  const first = week.normalizeDate('');
  const dates = Array.from({ length: WEEKS_AHEAD }, (_, i) => week.shiftWeek(first, i));
  let added = 0;
  for (const d of DEFAULTS) {
    const teams = new Set();
    members.forEach((m) => { if (String(m['이름'] || '').trim() === d.name) String(m['소속팀'] || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((t) => teams.add(t)); });
    roster.forEach((r) => { if (String(r['이름'] || '').trim() === d.name && r['팀ID']) teams.add(String(r['팀ID'])); });
    for (const team of teams) {
      const have = new Set(assign.filter((r) => r['팀ID'] === team && !r['행사ID'] && canonicalPosition(String(r['포지션'] || '').trim()) === d.pos).map((r) => String(r['날짜'])));
      const rows = dates.filter((dt) => !have.has(dt)).map((dt, i) => ({ 'ID': 'W' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 4), '팀ID': team, '날짜': dt, '포지션': d.pos, '이름': d.name, '행사ID': '' }));
      if (rows.length) { await sheetsDb.appendRows('찬양편성', rows); added += rows.length; }
    }
  }
  if (added) console.log(`[매주 고정 배정] ${added}건 추가`);
  return added;
}
/** 겹쳐 불려도 한 번에 하나만 */
function ensure() { if (!running) running = run().catch((e) => { console.error('[매주 고정 배정 실패]', e && e.message); return 0; }).finally(() => { running = null; }); return running; }
function start() { setTimeout(ensure, 90000); setInterval(ensure, 12 * 3600 * 1000).unref(); }

module.exports = { ensure, start, DEFAULTS };
