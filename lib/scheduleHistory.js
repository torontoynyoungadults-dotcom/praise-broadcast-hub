/**
 * 지난 스케줄표(2024.7 ~ 2025.12, 엑셀 "전체스케쥴")를 스케줄표 시트에 넣습니다 — data/schedule-history.json
 *  · 편성(찬양편성): 포지션별 이름 · 인도자(김상래 → 강산 → 윤정환 목사, 연습일 기준) · 주일 외 행사(부흥회 · 송구영신 · 성탄절 · 특별새벽기도회)
 *  · 불참(불가일정) · 연습일(연습일정) — 기본(주일 − 2일 금요일)과 다른 날 연습한 주만 따로 적음
 *  · 이미 있는 것은 건드리지 않습니다 — 같은 자리에 다른 사람이 이미 적혀 있으면 건너뛰고(충돌), 같은 건 중복 없이 넘어감. 여러 번 눌러도 안전.
 *  · 싱어는 팀원 명단의 성별로 남성싱어 / 여성싱어에 나눕니다 (명단에 없으면 김중규 · 이준민만 남성).
 */
const fs = require('fs');
const path = require('path');
const sheetsDb = require('./sheetsDb');
const prac = require('./practice');
const { canonicalPosition } = require('./positions');

const load = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'schedule-history.json'), 'utf8'));
const MALE_FALLBACK = new Set(['김중규', '이준민']);
const MULTI = new Set(['남성싱어', '여성싱어', '알토']);
let _n = 0;
const uid = (p) => p + Date.now().toString(36) + (++_n).toString(36) + Math.random().toString(36).slice(2, 4);

async function run(team, { dryRun } = {}) {
  const H = load();
  const [members, evRows, assignAll, offAll, pracAll] = await Promise.all([
    sheetsDb.readAll('회원'), sheetsDb.readAll('특별예배', { fresh: true }), sheetsDb.readAll('찬양편성', { fresh: true }),
    sheetsDb.readAll('불가일정', { fresh: true }), sheetsDb.readAll('연습일정', { fresh: true })]);
  const roster = new Map(members.map((m) => [String(m['이름'] || '').trim(), m]));
  const genderOf = (n) => { const m = roster.get(n); const g = m && String(m['성별'] || '').trim(); return g === '남' ? '남성싱어' : g === '여' ? '여성싱어' : (MALE_FALLBACK.has(n) ? '남성싱어' : '여성싱어'); };
  const myEvs = evRows.filter((e) => e['팀ID'] === team);
  const newEvents = [];
  const evIdOf = {};                                         // 'ev:날짜' → 행사 ID
  H.events.forEach((e) => {
    let ev = myEvs.find((x) => x['날짜'] === e.date) || newEvents.find((x) => x['날짜'] === e.date);
    if (!ev) { ev = { 'ID': uid('S'), '팀ID': team, '날짜': e.date, '이름': e.name, '등록시각': new Date().toISOString(), '예배시간': '', '리허설시간': '' }; newEvents.push(ev); }
    evIdOf['ev:' + e.date] = ev['ID'];
  });
  const scopeOf = (t) => (t.indexOf('ev:') === 0 ? { date: t.slice(3), ev: evIdOf[t] || '' , key: 'ev-' + (evIdOf[t] || '') } : { date: t, ev: '', key: t });

  // 편성
  const have = new Map();                                    // 키|포지션 → 이름들
  assignAll.filter((r) => r['팀ID'] === team).forEach((r) => {
    const k = (r['행사ID'] ? 'ev-' + r['행사ID'] : r['날짜']) + '|' + canonicalPosition(String(r['포지션'] || '').trim());
    (have.get(k) || have.set(k, []).get(k)).push(String(r['이름'] || '').trim());
  });
  const addA = [], conflicts = [], unknown = new Set();
  H.assign.forEach((a) => {
    const sc = scopeOf(a.t);
    const pos = a.pos === '싱어' ? genderOf(a.name) : a.pos;
    const k = sc.key + '|' + pos;
    const cur = have.get(k) || [];
    if (cur.includes(a.name)) return;
    if (!MULTI.has(pos) && cur.length) { conflicts.push(`${sc.date} ${pos}: 이미 ${cur.join(', ')} (엑셀: ${a.name})`); return; }
    cur.push(a.name); have.set(k, cur);
    if (!roster.has(a.name)) unknown.add(a.name);
    addA.push({ 'ID': uid('A'), '팀ID': team, '날짜': sc.date, '포지션': pos, '이름': a.name, '행사ID': sc.ev });
  });

  // 불참
  const offHave = new Set(offAll.filter((r) => r['팀ID'] === team).map((r) => String(r['날짜']) + '|' + String(r['이름'])));
  const addO = [];
  H.absences.forEach((o) => {
    const sc = scopeOf(o.t);
    const k = sc.key + '|' + o.name;
    if (offHave.has(k)) return;
    offHave.add(k);
    addO.push({ 'ID': uid('O'), '팀ID': team, '이름': o.name, '날짜': sc.key, '사유': o.reason || '불참', '등록시각': new Date().toISOString(), '구분': o.part === 'prac' ? '연습' : '' });
  });

  // 연습일
  const myPrac = pracAll.filter((r) => r['팀ID'] === team);
  const addP = [];
  H.practice.forEach((p) => {
    const sc = scopeOf(p.t);
    const key = sc.key;
    if (prac.rowsOf(key, sc.date, myPrac.concat(addP)).length) return;
    const none = p.note === prac.NO_PRACTICE;
    addP.push({ 'ID': uid('P'), '팀ID': team, '날짜': none ? prac.addDays(sc.date, -2) : p.date, '비고': p.note || '', '등록시각': new Date().toISOString(), '대상': key });
  });

  if (!dryRun) {
    if (newEvents.length) await sheetsDb.appendRows('특별예배', newEvents);
    if (addA.length) await sheetsDb.appendRows('찬양편성', addA);
    if (addO.length) await sheetsDb.appendRows('불가일정', addO);
    if (addP.length) await sheetsDb.appendRows('연습일정', addP);
  }
  return { assign: addA.length, off: addO.length, practice: addP.length, events: newEvents.length, conflicts, unknown: Array.from(unknown).sort() };
}

module.exports = { run };
