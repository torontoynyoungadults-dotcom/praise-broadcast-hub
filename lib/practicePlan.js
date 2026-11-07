/**
 * 연습 일정 미리 만들기 (관리자) — 한 해의 연습 금요일을 규칙대로 만들어 미리 보고, 스케줄표('연습일정')에 넣음.
 * 규칙: N주(기본 2주)마다 금요일 한 번 = 그 뒤 주일 N개를 함께 연습. 매달 마지막 금요일(금요찬양기도회) · 공휴일은 미정.
 * 첫 연습 전에 남는 주일(예: 2027년 1/3)도 미정. 미정은 '연습 미정'으로 들어가 팀원 화면에 그렇게 보임.
 */
const prac = require('./practice');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dOf = (s) => new Date(s + 'T12:00:00');
const add = (s, n) => prac.addDays(s, n);

function easter(y) {                                      // 부활절 (그레고리력)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(mo)}-${pad(da)}`;
}
/** 그 해 금요일에 걸리는 공휴일 · 교회 절기 */
function holidays(y) {
  const h = {};
  h[`${y}-01-01`] = '신정';
  h[add(easter(y), -2)] = '성금요일';
  h[`${y}-07-01`] = '캐나다 데이';
  h[`${y}-12-24`] = '성탄 전날';
  h[`${y}-12-25`] = '성탄절';
  h[`${y}-12-31`] = '송구영신';
  return h;
}
function isLastFriday(s) { const d = dOf(s); const n = new Date(d); n.setDate(d.getDate() + 7); return n.getMonth() !== d.getMonth(); }
function firstFridayOf(y) { const d = new Date(y, 0, 1, 12); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return ymd(d); }

/**
 * @param {{year:number, start?:string, every?:number, skipLastFri?:boolean, skipHolidays?:boolean}} o
 * @returns {{year, start, every, slots:[{fri, sundays:[], ok:boolean, why:string}], counts:{all, ok, tbd}}}
 */
function plan(o) {
  const y = Number(o.year) || new Date().getFullYear() + 1;
  const every = [1, 2, 3].includes(Number(o.every)) ? Number(o.every) : 2;
  const skipLast = o.skipLastFri !== false, skipHol = o.skipHolidays !== false;
  let start = prac.isDate(o.start) && o.start.startsWith(String(y)) ? o.start : (y === 2027 ? '2027-01-08' : firstFridayOf(y));
  while (dOf(start).getDay() !== 5) start = add(start, 1);
  const hol = holidays(y), end = `${y}-12-31`;
  const slots = [];
  // 첫 연습 전에 남는 그 해 주일들 — 미정
  const lead = [];
  for (let d = `${y}-01-01`; d < add(start, 2); d = add(d, 1)) if (dOf(d).getDay() === 0) lead.push(d);
  if (lead.length) slots.push({ fri: '', sundays: lead, ok: false, why: `${lead.map(md).join(' · ')} — 앞 연습과 ${md(start)} 연습 사이에 끼어 있어요` });
  for (let f = start; f <= end; f = add(f, 7 * every)) {
    const sundays = []; for (let i = 0; i < every; i++) sundays.push(add(f, 2 + 7 * i));
    let why = '';
    if (skipHol && hol[f]) why = hol[f];
    else if (skipLast && isLastFriday(f)) why = '마지막 금요일 · 금요찬양기도회';
    slots.push({ fri: f, sundays, ok: !why, why });
  }
  const ok = slots.filter((s) => s.ok).length;
  return { year: y, start, every, skipLast, skipHol, slots, counts: { all: slots.length, ok, tbd: slots.length - ok } };
}
function md(s) { return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`; }

module.exports = { plan, holidays, easter };
