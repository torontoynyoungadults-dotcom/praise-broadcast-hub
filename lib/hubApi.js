/**
 * 스케줄표 · 라이브러리 서버 함수 — church-app(yntoronto.2026) logic/app.js · worship6.js · docs9.js 의
 * worshipSchedule · setWorshipSlot · setMyUnavailableMany · removeMyUnavailable · worshipGuestSearch ·
 * worshipArchive · worshipStats · worshipRepoSongs · worshipRepoSongSave · worshipRepoEdit · worshipRepoSongUse · worshipRepoSave ·
 * hubScheduleDoc · hubStatsDoc 를 이 앱의 시트 DB 로 옮긴 것입니다. 돌려주는 모양은 church-app 과 같아서
 * church-app 화면 코드(public/hub/hubport.js)를 그대로 씁니다. 이 앱에만 있는 것: worshipPracticeSet (연습일 바꾸기).
 *
 * ▣ 이 앱과 다른 점
 *   · 팀이 여럿 — 모든 자료는 토큰의 팀(팀ID)만 봅니다.
 *   · 포지션 이름은 이 앱 것(피아노 · 인도자 · 남성싱어 …) — church-app 의 키(piano · lead · mvocal …) 대신 그대로 키로 씁니다.
 *   · 행사 = 특별예배 (키 'ev-<ID>'). 행사의 편성 · 콘티는 행사ID 로 주일과 따로 (예배콘티 화면과 같음).
 *   · 연습일 — 예배(주일 · 행사)마다 따로. 기본은 주일 바로 전 금요일, 바뀐 것만 '연습일정' 탭에 (대상 = 주일 날짜 또는 ev-ID · 28일 전까지 · 비고 '연습 없음').
 */
const sheetsDb = require('./sheetsDb');
const week = require('./weekUtil');
const avatar = require('./avatar');
const photo = require('./photo');
const driveStore = require('./driveStore');
const liveStore = require('./liveStore');
const pageSpec = require('./pageSpec');
const { POSITION_GROUPS, POSITION_ROLE_HINT, canonicalPosition } = require('./positions');

const ICONS = { 피아노: 'piano', 신디: 'synth', 드럼: 'drum', 베이스: 'bass', 일렉: 'egt', 어쿠기타: 'agt', 인도자: 'mic', 남성싱어: 'voice', 여성싱어: 'voice', 알토: 'voice', 음향: 'sound', PPT: 'ppt', 코디: 'codi' };
const MULTI = { 남성싱어: 1, 여성싱어: 1, 알토: 1 };
const BCAST = { 음향: 1, PPT: 1, 코디: 1 };
const LEAD = '인도자';

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function addDays(d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
function clean(s, max) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max); }
/** 곡 제목 비교 열쇠 — church-app songNorm / 가사키_ 와 같은 규칙 */
function songKey(t) {
  const s = String(t || '').toLowerCase();
  const a = s.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^0-9a-z가-힣ㄱ-ㆎ]/g, '');
  return a || s.replace(/[^0-9a-z가-힣ㄱ-ㆎ]/g, '') || s;
}
function err(m) { return new Error(m); }

/** 같은 팀의 쓰기는 한 줄로 (행 번호가 밀리는 지우기 · 붙이기가 섞이지 않게) */
const chains = new Map();
function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const job = prev.catch(() => {}).then(fn);
  chains.set(key, job);
  return job.finally(() => { if (chains.get(key) === job) chains.delete(key); });
}
/** 여러 줄 지우기 — 아래 줄부터 (위 줄을 먼저 지우면 아래 행 번호가 밀림) */
async function deleteRows(tab, rows) {
  const nums = Array.from(new Set(rows.map((r) => r.__row))).sort((a, b) => b - a);
  for (const n of nums) await sheetsDb.deleteRow(tab, n);
}

/* ================================================================ 기본 자료 */
function positions() {
  const out = [];
  POSITION_GROUPS.forEach(([group, keys]) => keys.forEach((k) => out.push({ key: k, label: k, icon: ICONS[k] || 'voice', multi: !!MULTI[k], bcast: !!BCAST[k], group })));
  return out;
}
const POS_KEYS = new Set(positions().map((p) => p.key));

/** 팀원 — church-app D.members ({ name, photo, role, fit }) */
async function members(team) {
  const info = await avatar.teamInfoMap(team);
  return Object.keys(info).sort((a, b) => a.localeCompare(b, 'ko')).map((name) => {
    const roles = String(info[name].역할 || '').split(',').map((s) => s.trim()).filter(Boolean);
    const fit = positions().filter((p) => (POSITION_ROLE_HINT[p.key] || []).some((r) => roles.includes(r))).map((p) => p.key);
    return { name, photo: photo.src(info[name].사진 || ''), role: roles.join(' · '), fit, pastor: roles.includes('목회자') };
  });
}

/** 화면을 열 때 함께 보내는 D (church-app worshipHub 의 일부) */
async function boot(user) {
  const next = week.normalizeDate(null);
  return { who: user.name, canEdit: !!user.canEdit, committee: !!user.admin, positions: positions(), members: await members(user.team),
    today: week.todayStr(), nextWeek: next, thisWeek: next, weeks: [], events: [], mine: [] };
}

async function events(team) {
  return (await sheetsDb.readAll('특별예배')).filter((r) => r['팀ID'] === team && isDate(r['날짜']))
    .map((r) => ({ key: 'ev-' + r['ID'], id: r['ID'], date: r['날짜'], endDate: r['날짜'], name: String(r['이름'] || '특별예배'), kind: '행사', place: '' }));
}
/** 키(날짜 · ev-ID) → 이 앱 범위 { event, date } */
async function scopeOfKey(team, key) {
  key = String(key || '').trim();
  if (/^ev-/.test(key)) {
    const ev = (await events(team)).find((e) => e.key === key);
    if (!ev) throw err('행사를 찾지 못했습니다. 화면을 새로 열어주세요.');
    return { event: ev.id, date: ev.date, ev };
  }
  if (!isDate(key)) throw err('날짜를 확인해주세요.');
  return { event: '', date: key };
}
const inScope = (r, sc) => (sc.event ? r['행사ID'] === sc.event : (!r['행사ID'] && r['날짜'] === sc.date));

function slotsOf(rows) {
  const slots = {};
  rows.slice().sort((a, b) => a.__row - b.__row).forEach((r) => {
    const p = canonicalPosition(String(r['포지션'] || '').trim()), n = String(r['이름'] || '').trim();
    if (!p || !n) return;
    const list = slots[p] = slots[p] || [];
    if (!list.includes(n)) list.push(n);
  });
  return slots;
}
/** 불가일정 한 줄의 범위 — '' (옛 기록 · 둘 다) · '연습' (금요일 연습만) · '예배' (주일/행사 예배만) */
const OFF_PART = { '': 'all', '연습': 'prac', '예배': 'sun' };
const offPartOf = (r) => OFF_PART[String(r['구분'] || '').trim()] || 'all';
/** 같은 사람의 줄들을 합쳐 { prac: 사유|null, sun: 사유|null } */
function offState(rows) {
  const e = { prac: null, sun: null };
  rows.forEach((r) => { const part = offPartOf(r), why = String(r['사유'] || '불가'); if (part !== 'sun') e.prac = why; if (part !== 'prac') e.sun = why; });
  return e;
}
const offSummary = (e) => (e.prac && e.sun) ? (e.prac === e.sun ? e.prac : '금 ' + e.prac + ' · 주일 ' + e.sun) : (e.prac || e.sun || '');
const offPartName = (e) => (e.prac && e.sun) ? 'all' : (e.prac ? 'prac' : 'sun');
/** 그 예배(key)에 못 나오는 사람들 — part: all(둘 다) · prac(금요일 연습만) · sun(예배만) */
function offOf(rows, key) {
  const by = new Map();
  rows.filter((r) => String(r['날짜']) === key && r['이름']).forEach((r) => { const n = String(r['이름']); (by.get(n) || by.set(n, []).get(n)).push(r); });
  return Array.from(by.entries()).map(([name, rs]) => { const e = offState(rs); return { name, reason: offSummary(e), part: offPartName(e), pr: e.prac || '', sr: e.sun || '' }; });
}

/* ================================================================ 연습일 (lib/practice.js — 예배마다 따로) */
const prac = require('./practice');
const practiceFor = (key, date, rows) => prac.practiceFor(key, date, rows);

/**
 * 연습일 바꾸기 — body { mode:'set'|'reset'|'none', date, note, also:[다른 예배 키…] }
 *  · key = 주일 날짜 또는 'ev-행사ID'. 한 번 연습에 여러 예배(주일 2주치 · 주일+행사)를 하려면 also 에 그 예배들의 키를 함께 보냅니다.
 *  · 날짜는 그 예배 당일부터 28일 전까지에서 고릅니다.
 */
async function worshipPracticeSet(u, key, body) {
  if (!u.canEdit) throw err('연습일은 팀원만 바꿀 수 있습니다.');
  key = String(key || '').trim(); body = body || {};
  const mode = ['set', 'reset', 'none'].includes(body.mode) ? body.mode : 'set';
  const keys = [key].concat(mode === 'set' ? (Array.isArray(body.also) ? body.also : []) : []).map((k) => String(k || '').trim()).filter(Boolean)
    .filter((k, i, a) => a.indexOf(k) === i).slice(0, 12);
  const targets = [];
  for (const k of keys) { const sc = await scopeOfKey(u.team, k); targets.push({ key: k, date: sc.date, name: sc.ev ? sc.ev.name : '' }); }
  let date = '', note = '';
  if (mode === 'set') {
    date = String(body.date || '').trim(); note = clean(body.note, 60);
    if (!isDate(date)) throw err('연습 날짜를 골라주세요.');
    for (const t of targets) {
      const w = prac.windowOf(t.date);
      if (!(date >= w[0] && date <= w[1])) throw err((t.name || t.date.slice(5).replace('-', '/') + ' 예배') + ' 연습일은 ' + w[0].slice(5).replace('-', '/') + ' ~ ' + w[1].slice(5).replace('-', '/') + ' 안에서 골라주세요.');
    }
    if (note === prac.NO_PRACTICE) note = '';
  }
  return serial('practice|' + u.team, async () => {
    let all = (await sheetsDb.readAll('연습일정', { fresh: true })).filter((r) => r['팀ID'] === u.team);
    for (const t of targets) {
      await deleteRows('연습일정', prac.rowsOf(t.key, t.date, all));
      all = (await sheetsDb.readAll('연습일정', { fresh: true })).filter((r) => r['팀ID'] === u.team);
    }
    if (mode !== 'reset') {
      for (const t of targets) {
        await sheetsDb.appendRow('연습일정', { 'ID': 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), '팀ID': u.team,
          '날짜': mode === 'none' ? addDays(t.date, /^ev-/.test(t.key) ? 0 : -2) : date, '비고': mode === 'none' ? prac.NO_PRACTICE : note,
          '등록시각': new Date().toISOString(), '대상': t.key });
      }
    }
    const after = (await sheetsDb.readAll('연습일정', { fresh: true })).filter((r) => r['팀ID'] === u.team);
    const updated = {};
    targets.forEach((t) => { updated[t.key] = practiceFor(t.key, t.date, after); });
    return { practice: updated[key], updated };
  });
}

/* ================================================================ 스케줄표 */
const RANGES = { next3: [0, 12], next6: [0, 26], around: [-13, 13], past3: [-13, -1], past6: [-26, -1], past12: [-52, -1] };

async function myUnavailable(u, offRows, evs) {
  const today = week.todayStr();
  const byKey = new Map((evs || await events(u.team)).map((e) => [e.key, e]));
  const rows = offRows || (await sheetsDb.readAll('불가일정')).filter((r) => r['팀ID'] === u.team);
  const by = new Map();
  rows.filter((r) => r['이름'] === u.name).forEach((r) => { const k = String(r['날짜']); (by.get(k) || by.set(k, []).get(k)).push(r); });
  return Array.from(by.entries()).map(([k, rs]) => {
    const e = byKey.get(k), st = offState(rs);
    return { date: k, day: e ? e.endDate : k, label: e ? e.name : '', reason: offSummary(st), part: offPartName(st), pr: st.prac || '', sr: st.sun || '' };
  }).filter((x) => isDate(x.day) && x.day >= today).sort((a, b) => a.day.localeCompare(b.day));
}

async function worshipSchedule(u, range) {
  const span = RANGES[range] || RANGES.next3;
  const first = week.normalizeDate(null);
  const dates = [];
  for (let i = span[0]; i <= span[1]; i++) dates.push(addDays(first, i * 7));
  const last = dates[dates.length - 1];
  const [assign, offs, songs, prac, evAll] = await Promise.all([
    sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), sheetsDb.readAll('찬양콘티'), sheetsDb.readAll('연습일정'), events(u.team)]);
  const mine = (rows) => rows.filter((r) => r['팀ID'] === u.team);
  const A = mine(assign), O = mine(offs), S = mine(songs), P = mine(prac);
  const evs = evAll.filter((e) => e.endDate >= dates[0] && e.date <= last);
  const songCount = (sc) => S.filter((r) => inScope(r, sc) && String(r['제목'] || '').trim()).length;
  const rows = dates.map((d) => {
    const sc = { event: '', date: d };
    return { key: d, date: d, event: null, slots: slotsOf(A.filter((r) => inScope(r, sc))), off: offOf(O, d), verse: '', songs: songCount(sc),
      practice: practiceFor(d, d, P), practiceDefault: addDays(d, -2) };
  }).concat(evs.map((e) => {
    const sc = { event: e.id, date: e.date };
    return { key: e.key, date: e.date, event: { key: e.key, name: e.name, kind: e.kind, date: e.date, endDate: e.endDate, place: '' },
      slots: slotsOf(A.filter((r) => inScope(r, sc))), off: offOf(O, e.key), verse: '', songs: songCount(sc),
      practice: practiceFor(e.key, e.date, P), practiceDefault: '' };
  })).sort((a, b) => (a.date === b.date ? (a.event ? 1 : -1) : a.date.localeCompare(b.date)));
  // 같은 날 연습하는 다른 예배 — 카드·표에서 "같은 날 연습: 11/2 주일 · 부흥회" 처럼 보여주기
  const byDay = {};
  rows.forEach((r) => { if (r.practice && r.practice.date && !r.practice.none) (byDay[r.practice.date] = byDay[r.practice.date] || []).push(r); });
  rows.forEach((r) => {
    const g = r.practice && r.practice.date && !r.practice.none ? byDay[r.practice.date] : null;
    r.practiceWith = g ? g.filter((x) => x !== r).map((x) => ({ key: x.key, date: x.date, name: x.event ? x.event.name : '' })) : [];
  });
  if (String(range || '').indexOf('past') === 0) rows.reverse();
  return { rows, range: RANGES[range] ? range : 'next3', mine: await myUnavailable(u, O, evAll) };
}

async function weekOf(u, key) {
  const sc = await scopeOfKey(u.team, key);
  const [assign, offs] = await Promise.all([sheetsDb.readAll('찬양편성', { fresh: true }), sheetsDb.readAll('불가일정')]);
  return { date: key, slots: slotsOf(assign.filter((r) => r['팀ID'] === u.team && inScope(r, sc))), off: offOf(offs.filter((r) => r['팀ID'] === u.team), key) };
}

async function setWorshipSlot(u, key, posKey, names) {
  if (!u.canEdit) throw err('편성은 팀원만 바꿀 수 있습니다.');
  posKey = String(posKey || '').trim();
  if (!POS_KEYS.has(posKey)) throw err('포지션을 확인해주세요.');
  const want = (Array.isArray(names) ? names : []).map((n) => clean(n, 40)).filter(Boolean);
  const uniq = Array.from(new Set(want)).slice(0, 20);
  if (!MULTI[posKey] && uniq.length > 1) uniq.splice(1);
  const sc = await scopeOfKey(u.team, key);
  await serial('assign|' + u.team, async () => {
    const all = (await sheetsDb.readAll('찬양편성', { fresh: true })).filter((r) => r['팀ID'] === u.team && inScope(r, sc) && canonicalPosition(String(r['포지션'] || '').trim()) === posKey);
    const have = all.map((r) => String(r['이름'] || '').trim());
    await deleteRows('찬양편성', all.filter((r) => !uniq.includes(String(r['이름'] || '').trim()) || have.indexOf(String(r['이름']).trim()) !== all.indexOf(r)));
    for (const n of uniq) {
      if (have.includes(n)) continue;
      await sheetsDb.appendRow('찬양편성', { 'ID': 'A' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), '팀ID': u.team, '날짜': sc.date, '포지션': posKey, '이름': n, '행사ID': sc.event });
    }
  });
  return weekOf(u, key);
}

/** 안 되는 날 표시 — part: 'all'(금요일 연습 + 주일 예배, 기본) · 'prac'(금요일 연습만) · 'sun'(주일/행사 예배만).
 *  이미 표시한 날에 다른 범위를 더하면 합쳐집니다 (금요일만 + 주일만 = 둘 다). 사유는 범위마다 따로 기억합니다. */
async function setMyUnavailableMany(u, keys, reason, part) {
  reason = clean(reason, 100);
  if (!reason) throw err('사유를 적어주세요.');
  part = ['all', 'prac', 'sun'].includes(part) ? part : 'all';
  keys = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k || '').trim()).filter(Boolean).slice(0, 60);
  if (!keys.length) throw err('날짜를 먼저 골라주세요.');
  for (const k of keys) await scopeOfKey(u.team, k);
  await serial('off|' + u.team, async () => {
    const rows = (await sheetsDb.readAll('불가일정', { fresh: true })).filter((r) => r['팀ID'] === u.team && r['이름'] === u.name);
    const mineRows = rows.filter((r) => keys.includes(String(r['날짜'])));
    const states = {};
    keys.forEach((k) => {
      const e = offState(mineRows.filter((r) => String(r['날짜']) === k));
      if (part !== 'sun') e.prac = reason;
      if (part !== 'prac') e.sun = reason;
      states[k] = e;
    });
    await deleteRows('불가일정', mineRows);
    for (const k of keys) await writeOffState(u, k, states[k]);
  });
  return myUnavailable(u);
}

/** 한 날의 내 불가 상태를 줄로 적기 — 둘 다 같은 사유면 한 줄('' 구분), 아니면 범위별로 한 줄씩 */
async function writeOffState(u, key, e) {
  const base = { 'ID': '', '팀ID': u.team, '이름': u.name, '날짜': key, '등록시각': new Date().toISOString() };
  const add = (why, part) => sheetsDb.appendRow('불가일정', Object.assign({}, base, { 'ID': 'O' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), '사유': why, '구분': part }));
  if (e.prac && e.sun && e.prac === e.sun) await add(e.prac, '');
  else { if (e.prac) await add(e.prac, '연습'); if (e.sun) await add(e.sun, '예배'); }
}

/** 내 불가 해제 — part 를 주면 그 범위만 풀고 (금요일만 풀면 주일 불가는 남음), 없으면 전부 */
async function removeMyUnavailable(u, key, part) {
  key = String(key || '').trim();
  part = ['prac', 'sun'].includes(part) ? part : 'all';
  await serial('off|' + u.team, async () => {
    const rows = (await sheetsDb.readAll('불가일정', { fresh: true })).filter((r) => r['팀ID'] === u.team && r['이름'] === u.name && String(r['날짜']) === key);
    const e = offState(rows);
    if (part === 'all') { await deleteRows('불가일정', rows); return; }
    if (part === 'prac') e.prac = null; else e.sun = null;
    await deleteRows('불가일정', rows);
    await writeOffState(u, key, e);
  });
  return myUnavailable(u);
}

/** 객원 찾기 — church-app 은 교적에서 찾지만, 이 앱은 다른 찬양팀 회원 · 팀원 명단에서 찾습니다 */
async function worshipGuestSearch(u, q) {
  q = clean(q, 30).toLowerCase();
  if (!q) return { list: [], total: 0, hint: [] };
  const [mem, roster, mine] = await Promise.all([sheetsDb.readAll('회원'), sheetsDb.readAll('팀원명단'), avatar.teamInfoMap(u.team)]);
  const digits = q.replace(/\D/g, '');
  const people = new Map();
  mem.forEach((m) => { const n = String(m['이름'] || '').trim(); if (n) people.set(n, { name: n, photo: photo.src(m['프로필사진'] || ''), cell: String(m['소속팀'] || '').split(',')[0].trim(), phone: String(m['전화번호'] || '') }); });
  roster.forEach((r) => { const n = String(r['이름'] || '').trim(); if (n && !people.has(n)) people.set(n, { name: n, photo: photo.src(r['사진'] || ''), cell: String(r['팀ID'] || ''), phone: '' }); });
  const hits = Array.from(people.values()).filter((p) => p.name.toLowerCase().includes(q) || (digits.length >= 3 && p.phone.replace(/\D/g, '').includes(digits)));
  const hint = hits.filter((p) => mine[p.name]).map((p) => p.name);
  const list = hits.filter((p) => !mine[p.name]).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { list: list.slice(0, 12).map((p) => ({ name: p.name, photo: p.photo, cell: p.cell, tail: p.phone.replace(/\D/g, '').slice(-4) })), total: list.length, hint };
}

/* ================================================================ 아카이브 · 통계 */
function recView(r) {
  const id = liveStore.driveIdOf(r['링크']);
  return { id: String(r['ID'] || ''), title: String(r['제목'] || '녹음'), kind: String(r['구분'] || '연습'), by: String(r['올린사람'] || ''),
    at: String(r['올린시각'] || '').slice(0, 10), url: String(r['링크'] || ''), play: id ? '/audio/' + id : '' };
}
const isPdfLink = (link) => !/\.(png|jpe?g|gif|webp|heic)(\?|$)/i.test(String(link || ''));
function keyOfRow(r) { return r['행사ID'] ? 'ev-' + r['행사ID'] : String(r['날짜'] || ''); }

async function worshipArchive(u) {
  const [songs, sheets, recs, assign, evs] = await Promise.all([sheetsDb.readAll('찬양콘티'), sheetsDb.readAll('악보저장소'), sheetsDb.readAll('녹음'), sheetsDb.readAll('찬양편성'), events(u.team)]);
  const evBy = new Map(evs.map((e) => [e.key, e]));
  const days = new Map();
  const one = (k) => {
    if (!days.has(k)) { const e = evBy.get(k); days.set(k, { key: k, date: e ? e.date : k, event: e ? { name: e.name, kind: e.kind } : null, lead: [], songs: [], files: [], recs: [] }); }
    return days.get(k);
  };
  const ok = (k) => isDate(k) || evBy.has(k);
  const kindById = new Map();
  songs.filter((r) => r['팀ID'] === u.team).forEach((r) => {
    const k = keyOfRow(r), t = String(r['제목'] || '').trim();
    kindById.set(r['ID'], r['구분'] === '결단' ? '결단' : '콘티');
    if (!t || !ok(k)) return;
    let solo = []; try { solo = JSON.parse(r['솔로'] || '[]'); } catch (e) { solo = []; }
    one(k).songs.push({ seq: Number(r['순서']) || 0, kind: r['구분'] === '결단' ? '결단' : '콘티', title: t, team: String(r['팀'] || ''), key: String(r['Key'] || ''),
      link: String(r['유튜브'] || ''), bpm: String(r['BPM'] || ''), solo: Array.isArray(solo) ? solo : [] });
  });
  sheets.filter((r) => r['팀ID'] === u.team && r['파일링크']).forEach((r) => {
    const k = keyOfRow(r); if (!r['날짜'] || !ok(k)) return;
    one(k).files.push({ id: String(r['ID'] || r.__row), name: String(r['제목'] || '악보'), kind: kindById.get(r['곡ID']) || '콘티', url: String(r['파일링크']), pdf: isPdfLink(r['파일링크']),
      range: pageSpec.cleanSpec(r['쪽']), href: liveStore.openHref(u.team, r['파일링크'], pageSpec.cleanSpec(r['쪽']), String(r['제목'] || '')) });   // 곡별로 저장한 악보는 그 곡 쪽만 (/sheet/<id>/part)
  });
  recs.filter((r) => r['팀ID'] === u.team).forEach((r) => { const k = keyOfRow(r); if (ok(k)) one(k).recs.push(recView(r)); });
  assign.filter((r) => r['팀ID'] === u.team && canonicalPosition(r['포지션']) === LEAD).forEach((r) => {
    const d = days.get(keyOfRow(r)); if (d && r['이름'] && !d.lead.includes(r['이름'])) d.lead.push(String(r['이름']));
  });
  const list = Array.from(days.values()).map((x) => {
    x.songs.sort((a, b) => (a.kind === b.kind ? 0 : (a.kind === '결단' ? 1 : -1)) || a.seq - b.seq);
    return x;
  }).sort((a, b) => b.date.localeCompare(a.date));
  return { today: week.todayStr(), days: list };
}

async function worshipStats(u) {
  const [songs, assign, evs] = await Promise.all([sheetsDb.readAll('찬양콘티'), sheetsDb.readAll('찬양편성'), events(u.team)]);
  const evBy = new Map(evs.map((e) => [e.key, e]));
  const lineupAll = {};
  assign.filter((r) => r['팀ID'] === u.team).forEach((r) => {
    const k = keyOfRow(r), p = canonicalPosition(String(r['포지션'] || '').trim()), n = String(r['이름'] || '').trim();
    if (!k || !p || !n) return;
    const x = lineupAll[k] = lineupAll[k] || { lead: [], people: [] };
    if (p === LEAD && !x.lead.includes(n)) x.lead.push(n);
    if (!x.people.includes(n)) x.people.push(n);
  });
  const out = [];
  songs.filter((r) => r['팀ID'] === u.team).forEach((r) => {
    const k = keyOfRow(r), t = String(r['제목'] || '').trim(); if (!k || !t) return;
    const d = evBy.has(k) ? evBy.get(k).date : k; if (!isDate(d)) return;
    out.push([k, d, r['구분'] === '결단' ? '결단' : '콘티', t, String(r['팀'] || '').trim(), String(r['Key'] || '').trim()]);
  });
  const used = new Set(out.map((x) => x[0]));
  const lineups = {}, evNames = {};
  used.forEach((k) => { if (lineupAll[k]) lineups[k] = lineupAll[k]; if (evBy.has(k)) evNames[k] = evBy.get(k).name; });
  return { today: week.todayStr(), songs: out, lineups, events: evNames };
}

/* ================================================================ 곡 · 악보 (church-app 악보 Repository) */
async function worshipRepoSongs(u) {
  const [songs, sheets, info, assign, evs] = await Promise.all([sheetsDb.readAll('찬양콘티'), sheetsDb.readAll('악보저장소'), sheetsDb.readAll('곡정보'), sheetsDb.readAll('찬양편성'), events(u.team)]);
  const evBy = new Map(evs.map((e) => [e.key, e]));
  const leadBy = {};
  assign.filter((r) => r['팀ID'] === u.team && canonicalPosition(r['포지션']) === LEAD && r['이름']).forEach((r) => { const k = keyOfRow(r); (leadBy[k] = leadBy[k] || []).includes(r['이름']) || leadBy[k].push(String(r['이름'])); });
  const S = {};
  const one = (title) => {
    const k = songKey(title); if (!k) return null;
    return S[k] || (S[k] = { id: k, title, team: '', theme: '', memo: '', uses: 0, lastDate: '', last: null, keys: {}, leaders: {}, history: [], sheets: [], hasLyrics: false });
  };
  const titleById = new Map(), rowById = new Map();
  songs.filter((r) => r['팀ID'] === u.team).forEach((r) => {
    const t = String(r['제목'] || '').trim(), k = keyOfRow(r);
    titleById.set(r['ID'], t); rowById.set(r['ID'], r);
    const date = evBy.has(k) ? evBy.get(k).date : k;
    if (!t || !isDate(date)) return;
    const s = one(t); if (!s) return;
    let solo = []; try { solo = JSON.parse(r['솔로'] || '[]'); } catch (e) { solo = []; }
    const h = { date, kind: r['구분'] === '결단' ? '결단' : '콘티', key: String(r['Key'] || '').trim(), bpm: String(r['BPM'] || '').trim(), form: String(r['송폼'] || '').trim(),
      solo: Array.isArray(solo) ? solo : [], note: String(r['비고'] || '').trim(), link: String(r['유튜브'] || '').trim(), team: String(r['팀'] || '').trim(),
      leaders: leadBy[k] || [], leader: (leadBy[k] || []).join(', ') };
    s.uses++;
    if (h.key) s.keys[h.key] = (s.keys[h.key] || 0) + 1;
    h.leaders.forEach((n) => { s.leaders[n] = (s.leaders[n] || 0) + 1; });
    s.history.push(h);
    if (date >= s.lastDate) { s.lastDate = date; s.last = h; s.title = t; }
  });
  Object.values(S).forEach((s) => {
    s.history.sort((a, b) => b.date.localeCompare(a.date));
    const wt = s.history.find((h) => h.team); s.team = wt ? wt.team : '';
    s.history = s.history.slice(0, 30);
  });
  info.filter((r) => r['팀ID'] === u.team).forEach((r) => {
    const s = one(String(r['제목'] || '').trim()); if (!s) return;
    if (String(r['원곡팀'] || '').trim()) s.team = String(r['원곡팀']).trim();
    s.theme = String(r['주제'] || '').trim(); s.memo = String(r['메모'] || '').trim();
  });
  sheets.filter((r) => r['팀ID'] === u.team && r['파일링크']).forEach((r) => {
    const linked = r['곡ID'] && titleById.get(r['곡ID']);
    const s = one(linked || String(r['제목'] || '').trim()); if (!s) return;
    const sr = r['곡ID'] ? rowById.get(r['곡ID']) : null;
    const k = keyOfRow(r), date = String(r['저장소날짜'] || '') || (evBy.has(k) ? evBy.get(k).date : String(r['날짜'] || ''));
    const range = pageSpec.cleanSpec(r['쪽']);
    if (s.sheets.some((x) => x.url === r['파일링크'] && x.range === range)) return;               // 같은 PDF(같은 쪽 범위)를 여러 주에 건 것은 한 번만
    s.sheets.push({ id: String(r['ID'] || ''), title: s.title, name: String(r['제목'] || '악보'), url: String(r['파일링크']), href: liveStore.openHref(u.team, r['파일링크'], range, s.title),
      key: String(r['Key'] || '') || (sr ? String(sr['Key'] || '') : ''), bpm: Number(r['BPM'] || (sr ? sr['BPM'] : '')) || '', date,
      leader: String(r['인도자'] || '') || (leadBy[k] || []).join(', '), pages: Number(r['쪽수']) || '', range, note: String(r['메모'] || '') });
  });
  const f = { keys: {}, teams: {}, themes: {}, leaders: {} };
  const list = Object.values(S).map((s) => {
    s.sheets.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const topKey = Object.keys(s.keys).sort((a, b) => s.keys[b] - s.keys[a])[0] || '';
    s.mainKey = (s.last && s.last.key) || topKey;
    Object.keys(s.keys).forEach((x) => { f.keys[x] = (f.keys[x] || 0) + 1; });
    s.sheets.forEach((x) => { if (x.key && !s.keys[x.key]) f.keys[x.key] = (f.keys[x.key] || 0) + 1; });
    if (s.team) f.teams[s.team] = (f.teams[s.team] || 0) + 1;
    if (s.theme) s.theme.split(/[,，]/).forEach((t) => { t = t.trim(); if (t) f.themes[t] = (f.themes[t] || 0) + 1; });
    Object.keys(s.leaders).forEach((n) => { f.leaders[n] = (f.leaders[n] || 0) + 1; });
    s.sheets.forEach((x) => { if (x.leader) f.leaders[x.leader] = f.leaders[x.leader] || 0; });
    return s;
  }).sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || '') || a.title.localeCompare(b.title, 'ko'));
  return { songs: list, facets: f, today: week.todayStr() };
}

async function worshipRepoSongSave(u, meta) {
  if (!u.canEdit) throw err('팀원만 고칠 수 있습니다.');
  meta = meta || {};
  const title = clean(meta.title, 80), key = songKey(title);
  if (!key) throw err('곡 제목을 적어주세요.');
  const row = { '키': key, '제목': title, '원곡팀': clean(meta.team, 60), '주제': clean(meta.theme, 80), '메모': clean(meta.memo, 300), '수정자': u.name, '수정시각': new Date().toISOString(), '팀ID': u.team };
  await serial('songinfo|' + u.team, async () => {
    const hits = (await sheetsDb.readAll('곡정보', { fresh: true })).filter((r) => r['팀ID'] === u.team && String(r['키']) === key);
    if (hits.length) { await sheetsDb.updateRow('곡정보', hits[0].__row, row); await deleteRows('곡정보', hits.slice(1)); }
    else if (row['원곡팀'] || row['주제'] || row['메모']) await sheetsDb.appendRow('곡정보', row);
  });
  return { ok: true };
}

async function worshipRepoEdit(u, id, patch) {
  if (!u.canEdit) throw err('팀원만 고칠 수 있습니다.');
  id = String(id || '').trim(); patch = patch || {};
  const hit = (await sheetsDb.readAll('악보저장소', { fresh: true })).find((r) => r['팀ID'] === u.team && String(r['ID']) === id);
  if (!hit) throw err('악보를 찾지 못했습니다.');
  const next = Object.assign({}, hit);
  if (patch.key !== undefined) next['Key'] = clean(patch.key, 8);
  if (patch.leader !== undefined) next['인도자'] = clean(patch.leader, 30);
  if (patch.note !== undefined) next['메모'] = clean(patch.note, 200);
  if (patch.bpm !== undefined) { const b = Math.round(Number(patch.bpm) || 0); next['BPM'] = (b >= 30 && b <= 300) ? b : ''; }
  if (patch.date !== undefined) { if (!isDate(patch.date)) throw err('날짜를 확인해주세요.'); next['저장소날짜'] = patch.date; }
  delete next.__row;
  await sheetsDb.updateRow('악보저장소', hit.__row, next);
  return { ok: true };
}

async function worshipRepoSongUse(u, date, kind, titles, attach, notify) {
  if (!u.canEdit) throw err('팀원만 콘티에 넣을 수 있습니다.');
  const sc = await scopeOfKey(u.team, String(date || '').trim() || week.normalizeDate(null));
  kind = kind === '결단' ? '결단' : '콘티';
  titles = (Array.isArray(titles) ? titles : [titles]).map((x) => clean(x, 80)).filter(Boolean).slice(0, 20);
  if (!titles.length) throw err('콘티에 넣을 곡을 골라주세요.');
  const by = new Map((await worshipRepoSongs(u)).songs.map((s) => [s.id, s]));
  let added = 0, attached = 0;
  await serial('conti|' + u.team, async () => {
    const existing = (await sheetsDb.readAll('찬양콘티', { fresh: true })).filter((r) => r['팀ID'] === u.team && inScope(r, sc) && (r['구분'] === '결단' ? '결단' : '콘티') === kind);
    if (kind === '결단' && (existing.length || titles.length > 1)) throw err('설교 후 찬양은 한 곡만 넣을 수 있습니다' + (existing.length ? ' — 이미 한 곡이 있어요.' : '. 한 곡만 골라주세요.'));
    let seq = existing.reduce((m, r) => Math.max(m, Number(r['순서']) || 0), 0);
    for (const t of titles) {
      const s = by.get(songKey(t)), L = s && s.last;
      seq += 1;
      const id = 'C' + Date.now().toString(36) + seq;
      await sheetsDb.appendRow('찬양콘티', { 'ID': id, '팀ID': u.team, '날짜': sc.date, '행사ID': sc.event, '구분': kind, '순서': seq, '제목': s ? s.title : t,
        '팀': (s && s.team) || (L && L.team) || '', 'Key': L ? L.key : '', '유튜브': L ? L.link : '', '송폼': L ? L.form : '', 'BPM': L ? L.bpm : '', '비고': L ? L.note : '',
        '만든시각': new Date().toISOString(), '솔로': JSON.stringify(L ? L.solo : []) });
      added++;
      if (attach && s && s.sheets.length) {
        const x = s.sheets.find((q) => q.range) || s.sheets[0];                  // 곡별로 쪽 범위를 저장해 둔 악보가 있으면 그것을
        await sheetsDb.appendRow('악보저장소', { 'ID': 'F' + Date.now().toString(36) + seq, '팀ID': u.team, '날짜': sc.date, '행사ID': sc.event, '제목': x.name, '파일링크': x.url,
          '올린사람': u.name, '올린시각': new Date().toISOString(), '곡ID': id, 'Key': x.key || '', 'BPM': x.bpm || '', '인도자': '', '쪽수': x.pages || '', '메모': '', '저장소날짜': '', '쪽': x.range || '' });
        attached++;
      }
    }
  });
  if (typeof notify === 'function') notify(u.team, sc);
  return { added, sheets: attached };
}

async function worshipRepoSave(u, meta, dataUrl) {
  if (!u.canEdit) throw err('팀원만 올릴 수 있습니다.');
  meta = meta || {};
  const title = clean(meta.title, 80);
  if (!title) throw err('곡 제목을 적어주세요.');
  const m = /^data:application\/pdf;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw err('PDF 파일만 올릴 수 있습니다.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 12 * 1048576) throw err('PDF 가 너무 큽니다 (12MB 이하).');
  if (buf.slice(0, 4).toString('latin1') !== '%PDF') throw err('PDF 파일이 아닙니다.');
  const link = await driveStore.uploadPublic('악보', { originalname: clean(meta.source, 80) || title + '.pdf', mimetype: 'application/pdf', buffer: buf });
  const date = isDate(meta.date) ? meta.date : '';
  const b = Math.round(Number(meta.bpm) || 0);
  await sheetsDb.appendRow('악보저장소', { 'ID': 'F' + Date.now().toString(36), '팀ID': u.team, '날짜': '', '행사ID': '', '제목': title, '파일링크': link, '올린사람': u.name,
    '올린시각': new Date().toISOString(), '곡ID': '', 'Key': clean(meta.key, 8), 'BPM': (b >= 30 && b <= 300) ? b : '', '인도자': clean(meta.leader, 30),
    '쪽수': Math.max(0, Math.min(99, Math.round(Number(meta.pages) || 0))) || '', '메모': clean(meta.note, 200), '저장소날짜': date });
  return { ok: true };
}

/* ================================================================ 보고서 (church-app logic/docs9.js 문서틀_ · hubScheduleDoc · hubStatsDoc) */
const escD = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function docFrame(title, subtitle, bodyHtml, land) {
  const W = land ? 251 : 188;
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="yn-orient" content="' + (land ? 'landscape' : 'portrait') + '">' +
    '<title>' + String(title).replace(/<[^>]*>/g, '') + '</title><style>' +
    '@page { size: letter ' + (land ? 'landscape' : 'portrait') + '; margin: 15mm 14mm 17mm; }' +
    '* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; } html { background: #fff; }' +
    'body { font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; font-size: 10pt; line-height: 1.45; }' +
    '@media screen { html { background: #8c8c8c; } body { width: ' + W + 'mm; max-width: 100%; margin: 14px auto; padding: 15mm 14mm; background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.45); } }' +
    'body.cap { width: ' + W + 'mm !important; max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; background: #fff; }' +
    '.org { font-size: 8pt; color: #555; letter-spacing: 2.2pt; font-weight: 700; margin-bottom: 7px; } .rule { border-bottom: 3px solid #111; margin-bottom: 14px; }' +
    'h1 { font-size: 22pt; font-weight: 800; letter-spacing: -.4pt; margin: 0 0 4px; line-height: 1.2; color: #000; }' +
    '.sub { font-size: 10.5pt; color: #444; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #111; }' +
    'h2 { font-size: 10.5pt; letter-spacing: .6pt; color: #000; margin: 22px 0 7px; padding: 2px 0 2px 9px; border-left: 4px solid #111; font-weight: 800; page-break-after: avoid; break-after: avoid; }' +
    'table { width: 100%; border-collapse: collapse; table-layout: auto; margin: 0; }' +
    'th, td { text-align: left; vertical-align: top; padding: 6px 7px; border-bottom: 1px solid #C8C8C8; font-size: 9.5pt; word-break: break-word; overflow-wrap: anywhere; }' +
    'th { width: 110px; color: #222; font-weight: 700; font-size: 8.8pt; background: #EFEFEF; } table.grid { border: 1px solid #111; }' +
    'table.grid th { width: auto; background: #111; color: #fff; font-size: 8.6pt; letter-spacing: .3pt; padding: 7px 7px; border-bottom: 1px solid #111; border-right: 1px solid #444; }' +
    'table.grid th:last-child { border-right: 0; } table.grid td { border-right: 1px solid #E0E0E0; } table.grid td:last-child { border-right: 0; }' +
    'table.grid tbody tr:nth-child(even) td { background: #F6F6F6; } table.grid tr.grp td { background: #DCDCDC !important; font-weight: 700; border-top: 1px solid #888; }' +
    'table.grid tr:last-child td { border-bottom: 0; } table.grid td.n { width: 42%; font-weight: 600; } table.grid td.r { text-align: right; color: #444; font-size: 9.5pt; }' +
    'thead { display: table-header-group; } tr { page-break-inside: avoid; break-inside: avoid; }' +
    '.box { background: #F3F3F3; border-left: 4px solid #555; padding: 10px 13px; font-size: 10pt; line-height: 1.7; white-space: pre-wrap; margin-top: 4px; }' +
    '.stats { display: flex; gap: 10px; margin: 14px 0 4px; } .stat { flex: 1; border: 1px solid #111; padding: 10px 6px; text-align: center; }' +
    '.stat .v { font-size: 17pt; font-weight: 800; letter-spacing: -.5pt; } .stat .k { font-size: 8.5pt; color: #555; margin-top: 2px; }' +
    '.two { display: flex; gap: 20px; align-items: flex-start; } .two > div { flex: 1; min-width: 0; } table.num td.r, table.num th.r { text-align: right; }' +
    '.foot { margin-top: 26px; border-top: 2px solid #111; padding-top: 8px; font-size: 8.5pt; color: #444; display: flex; justify-content: space-between; }' +
    '</style></head><body><div class="org">TORONTO YOUNGNAK CHURCH &nbsp;·&nbsp; 찬양방송팀 허브</div><div class="rule"></div>' +
    '<h1>' + title + '</h1><div class="sub">' + subtitle + '</div>' + bodyHtml +
    '<div class="foot"><span>토론토영락교회 찬양방송팀</span><span>출력 ' + week.todayStr() + '</span></div></body></html>';
}
function docRes(title, subtitle, body, filename, land) {
  return { title, html: docFrame(title, subtitle, body, land), filename: String(filename || title).replace(/[\\/:*?"<>|]/g, '_'), landscape: !!land };
}
function thead(cols) {
  return '<thead><tr>' + cols.map((c) => { const a = typeof c === 'string' ? { t: c } : c; return '<th' + (a.r ? ' class="r"' : '') + (a.w ? ' style="width:' + a.w + ';"' : '') + '>' + a.t + '</th>'; }).join('') + '</tr></thead>';
}
const RANGE_NAMES = { next3: '앞으로 3개월', next6: '앞으로 6개월', around: '앞뒤 3개월', past3: '지난 3개월', past6: '지난 6개월', past12: '지난 1년' };
const SHORT = { 인도자: '인도', 남성싱어: '남싱', 여성싱어: '여싱', 어쿠기타: '어쿠' };

async function hubScheduleDoc(u, range) {
  const d = await worshipSchedule(u, range), pos = positions();
  const pastors = new Set((await members(u.team)).filter((m) => m.pastor).map((m) => m.name));
  const disp = (n) => escD(pastors.has(n) ? n + ' 목사님' : n);                      // 목회자는 "윤정환 목사님"
  const groups = POSITION_GROUPS.map(([g, keys]) => [g, keys.map((k) => pos.find((p) => p.key === k)).filter(Boolean)]);
  const cols = groups.reduce((a, g) => a.concat(g[1]), []);
  const rows = d.rows;
  const need = pos.filter((p) => !p.multi);
  let full = 0, off = 0;
  rows.forEach((r) => { if (need.every((p) => (r.slots[p.key] || []).length)) full++; off += (r.off || []).length; });
  const rangeName = RANGE_NAMES[d.range] || RANGE_NAMES.next3;
  let body = '<div class="stats"><div class="stat"><div class="v">' + rows.length + '</div><div class="k">예배</div></div>' +
    '<div class="stat"><div class="v">' + full + '</div><div class="k">편성 완료</div></div><div class="stat"><div class="v">' + (rows.length - full) + '</div><div class="k">편성 필요</div></div>' +
    '<div class="stat"><div class="v">' + off + '</div><div class="k">불가 표시</div></div></div>';
  const head1 = '<tr><th rowspan="2" style="width:24mm;">날짜</th>' + groups.map((g) => '<th colspan="' + g[1].length + '" style="text-align:center;">' + escD(g[0]) + '</th>').join('') + '<th rowspan="2" style="width:30mm;">불가</th></tr>';
  const head2 = '<tr>' + cols.map((p) => '<th style="text-align:center;">' + escD(SHORT[p.key] || p.label) + '</th>').join('') + '</tr>';
  let lastMo = '', trs = '';
  rows.forEach((r) => {
    const mo = r.date.slice(0, 7);
    if (mo !== lastMo) { lastMo = mo; trs += '<tr class="grp"><td colspan="' + (cols.length + 2) + '"><b>' + Number(mo.split('-')[1]) + '월</b> <span style="color:#555;">' + mo.split('-')[0] + '</span></td></tr>'; }
    const pr = r.practice ? (r.practice.none ? '연습 없음' : (r.practice.unset || !r.practice.date) ? '연습 미정' : '연습 ' + r.practice.date.slice(5).replace('-', '/')) : '';
    const dtc = r.event ? '<b>' + escD(r.date.slice(5)) + '</b><br><span style="color:#555;font-size:8pt;">' + escD(r.event.name) + '</span>' + (pr ? '<br><span style="color:#555;font-size:8pt;">' + escD(pr) + '</span>' : '')
      : '<b>' + escD(r.date.slice(5)) + '</b> <span style="color:#555;font-size:8pt;">일</span>' + (pr ? '<br><span style="color:#555;font-size:8pt;">' + escD(pr) + '</span>' : '');
    trs += '<tr><td>' + dtc + '</td>' + cols.map((p) => {
      const names = r.slots[p.key] || [];
      return '<td style="text-align:center;font-size:8.5pt;">' + (names.length ? names.map(disp).join('<br>') : '<span style="color:#bbb;">·</span>') + '</td>';
    }).join('') + '<td style="font-size:8pt;color:#8a2410;">' + (r.off || []).map((x) => disp(x.name) + (x.part === 'prac' ? ' [' + (r.event ? '연습' : '금') + ']' : x.part === 'sun' ? ' [' + (r.event ? '당일' : '주') + ']' : '') + (x.reason ? ' (' + escD(x.reason) + ')' : '')).join('<br>') + '</td></tr>';
  });
  body += '<h2>편성표 — ' + escD(rangeName) + '</h2>' + (rows.length ? '<table class="grid num"><thead>' + head1 + head2 + '</thead><tbody>' + trs + '</tbody></table>' : '<div class="box">해당 기간에 예배가 없습니다.</div>');
  return docRes(escD(u.team) + ' 스케줄표', escD(rangeName) + ' &nbsp;·&nbsp; ' + (rows.length ? escD(rows[0].date) + ' ~ ' + escD(rows[rows.length - 1].date) : ''), body, '스케줄표_' + d.range, true);
}

async function hubStatsDoc(u, months, kind, lead, q) {
  const d = await worshipStats(u);
  months = String(months == null ? '' : months).trim();
  let from = '';
  if (/^\d{1,2}$/.test(months) && Number(months) > 0) { const t = new Date(d.today + 'T12:00:00'); t.setMonth(t.getMonth() - Number(months)); from = t.toISOString().slice(0, 10); } else months = '';
  // 화면에서 지금 걸러 둔 상태 그대로 — 기간 · 종류(콘티/결단찬양) · 인도자 · 검색어
  kind = String(kind || '').trim(); lead = String(lead || '').trim(); q = String(q || '').trim();
  const qn = q ? songKey(q) : '';
  const items = d.songs.filter((x) => {
    if (from && x[1] < from) return false;
    if (kind && kind !== 'all' && x[2] !== kind) return false;
    if (lead && ((d.lineups || {})[x[0]] || { lead: [] }).lead.indexOf(lead) === -1) return false;
    if (qn && songKey(x[3]).indexOf(qn) === -1 && songKey(x[4]).indexOf(qn) === -1) return false;
    return true;
  }).map((x) => ({ key: x[0], date: x[1], kind: x[2], title: x[3], team: x[4], mkey: x[5], n: songKey(x[3]) }));
  const 곡 = {}, 인도 = {}, 사람 = {}, 월 = {}, 예배 = {};
  items.forEach((i) => {
    const s = 곡[i.n] = 곡[i.n] || { name: i.title, n: 0, last: '', keys: {}, team: {}, names: {} };
    s.n++; if (i.date > s.last) s.last = i.date;
    if (i.mkey) s.keys[i.mkey] = (s.keys[i.mkey] || 0) + 1;
    if (i.team) s.team[i.team] = (s.team[i.team] || 0) + 1;
    s.names[i.title] = (s.names[i.title] || 0) + 1;
    if (!예배[i.key]) { 예배[i.key] = 1; const m = i.date.slice(0, 7); 월[m] = (월[m] || 0) + 1; }
  });
  Object.keys(예배).forEach((k) => {
    const l = (d.lineups || {})[k]; if (!l) return;
    const dt = items.find((i) => i.key === k).date;
    (l.lead || []).forEach((n) => { const x = 인도[n] = 인도[n] || { name: n, n: 0, last: '' }; x.n++; if (dt > x.last) x.last = dt; });
    (l.people || []).forEach((n) => { const x = 사람[n] = 사람[n] || { name: n, n: 0, last: '' }; x.n++; if (dt > x.last) x.last = dt; });
  });
  const top = (o) => Object.keys(o || {}).sort((a, b) => o[b] - o[a] || b.length - a.length)[0] || '';
  const sortN = (arr) => arr.sort((a, b) => b.n - a.n || b.last.localeCompare(a.last) || a.name.localeCompare(b.name, 'ko'));
  const songs = sortN(Object.values(곡).map((s) => { s.name = top(s.names) || s.name; s.tm = top(s.team); s.k = Object.keys(s.keys).sort((a, b) => s.keys[b] - s.keys[a]).slice(0, 3).join(' · '); return s; }));
  const leaders = sortN(Object.values(인도)), people = sortN(Object.values(사람));
  const rangeName = [months ? '최근 ' + months + '개월' : '전체 기간', kind && kind !== 'all' ? (kind === '결단' ? '결단찬양만' : kind + '만') : '', lead ? '인도자 ' + escD(lead) : '', q ? '검색 "' + q + '"' : ''].filter(Boolean).join(' · ');
  const table = (h, rows, tr) => (rows.length ? '<table class="grid num">' + thead(h) + '<tbody>' + rows.map(tr).join('') + '</tbody></table>' : '<div class="box">기록이 없습니다.</div>');
  let body = '<div class="stats"><div class="stat"><div class="v">' + Object.keys(예배).length + '</div><div class="k">콘티가 있는 예배 · 특별예배</div></div>' +
    '<div class="stat"><div class="v">' + items.length + '</div><div class="k">곡 사용 횟수</div></div><div class="stat"><div class="v">' + songs.length + '</div><div class="k">서로 다른 곡</div></div>' +
    '<div class="stat"><div class="v">' + (songs[0] ? escD(songs[0].name) : '—') + '</div><div class="k">가장 많이 부른 곡' + (songs[0] ? ' (' + songs[0].n + '회)' : '') + '</div></div></div>';
  body += '<h2>많이 부른 곡 (상위 ' + Math.min(30, songs.length) + ')</h2>' + table([{ t: '#', w: '8mm' }, '곡', '팀 · 아티스트', { t: '횟수', r: 1 }, '마지막', '자주 쓴 Key'], songs.slice(0, 30),
    (s, i) => '<tr><td>' + (i + 1) + '</td><td class="n" style="width:auto;font-weight:700;">' + escD(s.name) + '</td><td>' + escD(s.tm) + '</td><td class="r"><b>' + s.n + '</b></td><td>' + escD(s.last) + '</td><td>' + escD(s.k) + '</td></tr>');
  body += '<div class="two"><div><h2>인도자별</h2>' + table(['인도자', { t: '횟수', r: 1 }, '마지막'], leaders.slice(0, 20), (x) => '<tr><td style="font-weight:700;">' + escD(x.name) + '</td><td class="r">' + x.n + '</td><td>' + escD(x.last) + '</td></tr>') + '</div>' +
    '<div><h2>팀원 참여 (상위 ' + Math.min(20, people.length) + ')</h2>' + table(['이름', { t: '횟수', r: 1 }, '마지막'], people.slice(0, 20), (x) => '<tr><td style="font-weight:700;">' + escD(x.name) + '</td><td class="r">' + x.n + '</td><td>' + escD(x.last) + '</td></tr>') + '</div></div>';
  const mk = Object.keys(월).sort();
  if (mk.length) body += '<h2>월별 예배 수</h2>' + table(['월', { t: '예배 · 특별예배', r: 1 }], mk, (m) => '<tr><td>' + escD(m) + '</td><td class="r">' + 월[m] + '</td></tr>');
  return docRes(escD(u.team) + ' 콘티 통계 보고서', escD(rangeName) + ' &nbsp;·&nbsp; ' + escD(d.today) + ' 기준', body, '콘티통계_' + (months ? months + '개월' : '전체') + (kind && kind !== 'all' ? '_' + kind : '') + (lead ? '_' + lead : '') + (q ? '_검색' : ''), false);
}

module.exports = {
  positions, members, boot, songKey, practiceFor, addDays, serial, NO_PRACTICE: prac.NO_PRACTICE,
  FNS: { worshipSchedule, setWorshipSlot, setMyUnavailableMany, removeMyUnavailable, worshipGuestSearch, worshipPracticeSet,
    worshipArchive, worshipStats, worshipRepoSongs, worshipRepoSongSave, worshipRepoEdit, worshipRepoSongUse, worshipRepoSave, hubScheduleDoc, hubStatsDoc },
};
