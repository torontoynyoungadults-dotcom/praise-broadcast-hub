/**
 * 대신 서 줄 사람 찾기 — 서는 날을 "안 되는 날"로 표시한 사람이 부탁을 올리면,
 * 같은 포지션으로 서 본 적 있는 팀원(그 날 이미 서거나 안 되는 사람은 빼고)에게 알림이 가고,
 * 누가 "제가 설게요" 를 누르면 관리자에게 알림 → 관리자가 한 번 눌러 편성을 바꿉니다 (lib/hubApi.js setWorshipSlot — 변경 기록 · 알림도 그대로).
 *
 * '대신요청' 탭 — 한 부탁이 한 줄. 상태: 요청 → 수락 → 완료 (요청 · 수락 상태에서 부탁한 사람이 취소 가능)
 */
const sheetsDb = require('./sheetsDb');
const hubApi = require('./hubApi');
const notify = require('./notify');
const { canonicalPosition } = require('./positions');

const TAB = '대신요청';
const WD = ['주일', '월', '화', '수', '목', '금', '토'];
const s = (v) => String(v == null ? '' : v).trim();
const err = (m) => Object.assign(new Error(m), { user: true });
const md = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s(d)); return m ? `${Number(m[2])}/${Number(m[3])}(${WD[new Date(d + 'T12:00:00').getDay()]})` : s(d); };
const today = () => require('./weekUtil').todayStr();
const inScope = (r, sc) => (sc.event ? r['행사ID'] === sc.event : (!r['행사ID'] && r['날짜'] === sc.date));
const view = (r) => ({ id: s(r['ID']), team: s(r['팀ID']), key: s(r['대상']), date: s(r['날짜']), ev: s(r['행사']), pos: s(r['포지션']), from: s(r['요청자']),
  why: s(r['사유']), state: s(r['상태']), to: s(r['수락자']), at: s(r['요청시각']), row: r.__row });
const label = (x) => `${md(x.date)}${x.ev ? ' ' + x.ev : ''} · ${x.pos}`;

async function members(team) {
  return (await sheetsDb.readAll('회원')).filter((m) => String(m['접속중지']).toUpperCase() !== 'TRUE'
    && String(m['소속팀'] || '').split(',').map((x) => x.trim()).includes(team));
}

/** 이 부탁에 답할 수 있는 사람들 — 같은 포지션으로 지난 1년 안에 서 본 팀원, 그 날 이미 서거나 안 되는 사람 · 부탁한 사람은 빼고 */
async function candidates(team, x) {
  const [assign, offs] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정')]);
  const A = assign.filter((r) => r['팀ID'] === team);
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const sc = { date: x.date, event: x.key.indexOf('ev-') === 0 ? x.key.slice(3) : '' };
  const busy = new Set(A.filter((r) => inScope(r, sc)).map((r) => s(r['이름'])));
  offs.filter((r) => r['팀ID'] === team && s(r['날짜']) === x.key && s(r['구분']) !== '연습').forEach((r) => busy.add(s(r['이름'])));
  const names = new Set(A.filter((r) => s(r['날짜']) >= since && canonicalPosition(s(r['포지션'])) === x.pos).map((r) => s(r['이름'])));
  return Array.from(names).filter((n) => n && n !== x.from && !busy.has(n));
}

/** 부탁 올리기 — 그 날 내가 선 자리마다 한 줄 (이미 열린 부탁이 있으면 그대로) */
async function create(u, key, why) {
  key = s(key);
  const sc = await hubApi.scopeOfKey(u.team, key);
  if (sc.date < today()) throw err('지난 날짜예요.');
  const mine = (await sheetsDb.readAll('찬양편성', { fresh: true })).filter((r) => r['팀ID'] === u.team && inScope(r, sc) && s(r['이름']) === u.name);
  const poss = Array.from(new Set(mine.map((r) => canonicalPosition(s(r['포지션']))).filter(Boolean)));
  if (!poss.length) throw err('이 날 서는 자리가 없어요.');
  const open = (await sheetsDb.readAll(TAB, { fresh: true })).filter((r) => r['팀ID'] === u.team && s(r['대상']) === key && s(r['요청자']) === u.name && ['요청', '수락'].includes(s(r['상태'])));
  let people = 0, made = 0;
  for (const pos of poss) {
    if (open.some((r) => s(r['포지션']) === pos)) continue;
    const row = { 'ID': 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), '팀ID': u.team, '대상': key, '날짜': sc.date, '행사': sc.ev ? sc.ev.name : '',
      '포지션': pos, '요청자': u.name, '사유': s(why).slice(0, 100), '상태': '요청', '수락자': '', '요청시각': new Date().toISOString(), '수락시각': '', '처리자': '', '처리시각': '' };
    await sheetsDb.appendRow(TAB, row);
    made++;
    const x = view(row), names = await candidates(u.team, x);
    const ms = await members(u.team), to = ms.filter((m) => names.includes(s(m['이름']))).map((m) => s(m['이메일']).toLowerCase()).filter(Boolean);
    people += names.length;
    if (to.length) await notify.send(u.team, { kind: '대신', title: `대신 서 줄 수 있어요? · ${label(x)}`, body: `${u.name}님이 이 날 어려워요. 누르면 바로 답할 수 있어요.`, url: '/sub?team=' + encodeURIComponent(u.team), by: u.name, byEmail: u.email, to });
  }
  return { made, people, already: poss.length - made };
}

/** 내 화면 — 나에게 온 부탁 · 내가 한 부탁 · (관리자) 편성 반영 기다리는 것 */
async function board(team, name, admin) {
  const t = today();
  const rows = (await sheetsDb.readAll(TAB, { fresh: true })).filter((r) => r['팀ID'] === team && s(r['날짜']) >= t).map(view).sort((a, b) => a.date.localeCompare(b.date));
  const forMe = [];
  for (const x of rows.filter((r) => r.state === '요청' && r.from !== name)) if ((await candidates(team, x)).includes(name)) forMe.push(x);
  return { forMe, mine: rows.filter((r) => r.from === name && r.state !== '취소'), pending: admin ? rows.filter((r) => r.state === '수락') : [], taken: rows.filter((r) => r.to === name && r.state !== '취소') };
}

async function find(team, id) {
  const r = (await sheetsDb.readAll(TAB, { fresh: true })).find((x) => x['팀ID'] === team && s(x['ID']) === s(id));
  if (!r) throw err('부탁을 찾지 못했어요. 화면을 새로 열어 주세요.');
  return { r, x: view(r) };
}

/** "제가 설게요" — 먼저 누른 한 사람만. 부탁한 사람 · 관리자에게 알림 */
async function accept(u, id) {
  return hubApi.serial('sub|' + u.team, async () => {
    const { r, x } = await find(u.team, id);
    if (x.state !== '요청') throw err(x.state === '수락' ? `이미 ${x.to}님이 설게요 했어요.` : '이미 끝난 부탁이에요.');
    if (!(await candidates(u.team, x)).includes(u.name)) throw err('이 부탁에는 답할 수 없어요. (이미 그 날 서거나 안 되는 날로 표시돼 있어요)');
    await sheetsDb.updateRow(TAB, r.__row, Object.assign({}, r, { '상태': '수락', '수락자': u.name, '수락시각': new Date().toISOString() }));
    const ms = await members(u.team);
    const to = ms.filter((m) => String(m['관리자여부']).toUpperCase() === 'TRUE' || s(m['이름']) === x.from).map((m) => s(m['이메일']).toLowerCase()).filter(Boolean);
    if (to.length) await notify.send(u.team, { kind: '대신', title: `${u.name}님이 대신 설게요 · ${label(x)}`, body: `${x.from}님 대신이에요. 관리자가 확인하면 편성에 반영돼요.`, url: '/sub?team=' + encodeURIComponent(u.team), by: u.name, byEmail: u.email, to });
    return x;
  });
}

/** 관리자 — 편성에 반영 (부탁한 사람 → 수락한 사람) */
async function approve(u, id) {
  if (!u.admin) throw err('관리자만 편성에 반영할 수 있어요.');
  return hubApi.serial('sub|' + u.team, async () => {
    const { r, x } = await find(u.team, id);
    if (x.state !== '수락') throw err('아직 설게요 한 사람이 없거나 이미 반영했어요.');
    const sc = await hubApi.scopeOfKey(u.team, x.key);
    const now = (await sheetsDb.readAll('찬양편성', { fresh: true })).filter((a) => a['팀ID'] === u.team && inScope(a, sc) && canonicalPosition(s(a['포지션'])) === x.pos).map((a) => s(a['이름']));
    const names = Array.from(new Set(now.map((n) => (n === x.from ? x.to : n)).concat(now.includes(x.from) ? [] : [x.to])));
    await hubApi.FNS.setWorshipSlot({ team: u.team, name: u.name, canEdit: true, admin: true }, x.key, x.pos, names);
    await sheetsDb.updateRow(TAB, r.__row, Object.assign({}, r, { '상태': '완료', '처리자': u.name, '처리시각': new Date().toISOString() }));
    return x;
  });
}

/** 부탁한 사람이 취소 (요청 · 수락 상태에서만) */
async function cancel(u, id) {
  const { r, x } = await find(u.team, id);
  if (x.from !== u.name && !u.admin) throw err('부탁한 사람만 취소할 수 있어요.');
  if (!['요청', '수락'].includes(x.state)) throw err('이미 끝난 부탁이에요.');
  await sheetsDb.updateRow(TAB, r.__row, Object.assign({}, r, { '상태': '취소', '처리자': u.name, '처리시각': new Date().toISOString() }));
  return x;
}

/** 홈 "팀 소식" 용 — 나에게 온 부탁 수 · (관리자) 반영 기다리는 수 */
async function counts(team, name, admin) {
  try { const b = await board(team, name, admin); return { forMe: b.forMe.length, pending: b.pending.length }; } catch (e) { return { forMe: 0, pending: 0 }; }
}

module.exports = { TAB, create, board, accept, approve, cancel, counts, candidates, label };
