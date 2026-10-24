/**
 * 연습일 기준으로 묶어 보기 — "연습 콘티" 탭과 맨 위 배너의 "이번 주 연습 안내"가 함께 씁니다.
 *
 *  · 연습일은 예배(주일 · 행사)마다 따로 정해져 있습니다(lib/practice.js). 여기서는 거꾸로
 *    "이 연습 날에 어떤 예배들의 콘티를 연습하나"로 묶습니다 — 한 금요일에 2주치를 연습하면 두 예배가 한 묶음.
 *  · '연습 없음' · 날짜 미정인 예배는 빠집니다.
 */
const sheetsDb = require('./sheetsDb');
const prac = require('./practice');
const week = require('./weekUtil');
const timeSettings = require('./timeSettings');
const { canonicalPosition } = require('./positions');

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const md = (d) => { const x = new Date(d + 'T12:00:00'); return `${x.getMonth() + 1}월 ${x.getDate()}일`; };
const dowOf = (d) => new Date(d + 'T12:00:00').getDay();

/** 예배 하나의 이름 — "10월 25일 주일" · "부흥회(11월 1일)" */
function targetName(t) { return t.event ? `${t.name}(${md(t.date)})` : `${md(t.date)} 주일`; }

/**
 * 연습 날짜가 [from, to] 안에 있는 연습들 — 날짜 순.
 * @returns {Promise<{date:string, note:string, targets:{key:string,date:string,event:string,name:string}[]}[]>}
 */
async function groups(team, from, to) {
  const [rows, evRows, ts] = await Promise.all([
    sheetsDb.readAll('연습일정'), sheetsDb.readAll('특별예배'), timeSettings.get(team)]);
  const mine = rows.filter((r) => r['팀ID'] === team);
  const defNote = timeSettings.practiceNote(ts);
  const last = prac.addDays(to, prac.MAX_BACK);                 // 연습일은 예배보다 최대 28일 앞 — 그만큼 뒤 예배까지 봄
  const cands = [];
  for (let d = from; d <= last; d = prac.addDays(d, 1)) if (dowOf(d) === 0) cands.push({ key: d, date: d, event: '', name: '' });
  evRows.filter((e) => e['팀ID'] === team && prac.isDate(e['날짜']) && e['날짜'] >= from && e['날짜'] <= last)
    .forEach((e) => cands.push({ key: 'ev-' + e['ID'], date: e['날짜'], event: String(e['ID']), name: String(e['이름'] || '주일 외 찬양') }));
  const by = new Map();
  cands.forEach((c) => {
    const p = prac.practiceFor(c.key, c.date, mine, defNote);
    if (p.none || p.unset || !p.date || p.date < from || p.date > to) return;
    const g = by.get(p.date) || by.set(p.date, { date: p.date, note: '', targets: [] }).get(p.date);
    if (!g.note && p.note) g.note = p.note;
    g.targets.push(c);
  });
  const out = Array.from(by.values()).sort((a, b) => a.date.localeCompare(b.date));
  out.forEach((g) => g.targets.sort((a, b) => a.date.localeCompare(b.date) || (a.event ? 1 : 0) - (b.event ? 1 : 0)));
  return out;
}

/** 그 예배(target)에 이 사람이 서는지 · 연습에 못 온다고 했는지 */
function standing(name, target, assignRows, offRows) {
  const inT = (r) => (target.event ? r['행사ID'] === target.event : (!r['행사ID'] && r['날짜'] === target.date));
  const pos = [];
  assignRows.filter((r) => inT(r) && String(r['이름'] || '').trim() === name).forEach((r) => { const p = canonicalPosition(String(r['포지션'] || '').trim()); if (p && !pos.includes(p)) pos.push(p); });
  const off = offRows.some((r) => String(r['날짜']) === target.key && String(r['이름'] || '').trim() === name && String(r['구분'] || '').trim() !== '예배');
  return { pos, off };
}

/**
 * 맨 위 배너용 — 오늘부터 6일 안의 가장 가까운 연습 한 번과, 그 연습에서 이 사람의 상태.
 * @returns {Promise<null|{date, note, dayLabel, href, state:'on'|'off'|'free', mine:object[], targets:object[]}>}
 */
async function weekNotice(team, name) {
  if (!team || !name) return null;
  const today = week.todayStr();
  const gs = await groups(team, today, prac.addDays(today, 6));
  if (!gs.length) return null;
  const g = gs[0];
  const [assign, offs] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정')]);
  const A = assign.filter((r) => r['팀ID'] === team), O = offs.filter((r) => r['팀ID'] === team);
  const st = g.targets.map((t) => Object.assign({ t }, standing(name, t, A, O)));
  const on = st.filter((s) => s.pos.length && !s.off), offOnly = st.filter((s) => s.pos.length && s.off);
  const d = g.date, diff = Math.round((new Date(d + 'T12:00:00') - new Date(today + 'T12:00:00')) / 864e5);
  const dayLabel = (dowOf(d) >= dowOf(today) ? '이번 주 ' : '다음 주 ') + DOW[dowOf(d)] + '요일';
  return {
    date: d, md: md(d) + (diff === 0 ? '(오늘)' : diff === 1 ? '(내일)' : ''), note: g.note, dayLabel,
    href: `/practice-conti?team=${encodeURIComponent(team)}&pd=${encodeURIComponent(d)}`,
    state: on.length ? 'on' : offOnly.length ? 'off' : 'free',
    mine: (on.length ? on : offOnly).map((s) => ({ name: targetName(s.t), pos: s.pos })),
    targets: g.targets.map(targetName),
  };
}

module.exports = { groups, weekNotice, standing, targetName, md };
