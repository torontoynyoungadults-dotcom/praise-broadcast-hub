/**
 * 스케줄 변경 기록 — 누가 · 언제 · 어느 예배의 무엇을 바꿨는지 '스케줄변경기록' 탭에 한 줄씩 남깁니다.
 *
 *  · 종류: 편성(포지션 배정) · 불가(안 되는 날) · 연습(연습일)
 *  · 대상 = 예배 키(주일 날짜 또는 'ev-<행사ID>'), 날짜 = 그 예배 날짜, 행사 = 행사 이름(주일이면 빈 칸)
 *  · 편성은 이전/이후에 이름들(쉼표), 불가는 사람 + 이전/이후 사유, 연습은 이전/이후 연습일 글
 *  · 변경자가 '자동'으로 시작하면(매주 고정 배정 등) 기록에만 남고 "새 변경" 강조에서는 빠집니다
 *
 * "처음 볼 때 강조" — '스케줄확인' 탭에 사람마다 마지막으로 스케줄표를 연 시각을 둡니다.
 * 스케줄표를 열면 그 시각 이후 다른 사람이 바꾼 것들을 돌려주고(화면이 강조), 확인 시각을 지금으로 바꿉니다.
 *
 * 기록은 덤 — 기록 쓰기가 실패해도 실제 변경은 그대로 둡니다 (오류는 로그에만).
 */
const sheetsDb = require('./sheetsDb');

const TAB = '스케줄변경기록';
const SEEN = '스케줄확인';
const FIRST_LOOKBACK_MS = 7 * 24 * 3600 * 1000;   // 처음 여는 사람 — 지난 7일 변경을 보여 줌
const MAX_CHANGES = 300;

let _n = 0;
const uid = () => 'H' + Date.now().toString(36) + (++_n).toString(36) + Math.random().toString(36).slice(2, 5);
const s = (v) => String(v == null ? '' : v).trim();
const list = (a) => (Array.isArray(a) ? a.map(s).filter(Boolean).join(', ') : s(a));

/**
 * 기록 줄 만들기
 * @param {{team, by, key, date, ev?, kind, pos?, person?, before?, after?, at?}} e
 */
function row(e) {
  return {
    'ID': uid(), '팀ID': s(e.team), '시각': e.at || new Date().toISOString(), '변경자': s(e.by) || '알 수 없음',
    '대상': s(e.key), '날짜': s(e.date), '행사': s(e.ev), '종류': s(e.kind), '포지션': s(e.pos), '사람': s(e.person),
    '이전': list(e.before), '이후': list(e.after),
  };
}

/** 여러 건을 한 번에 — 이전과 이후가 같은 건 뺌. 실패해도 던지지 않음 */
async function log(entries) {
  const rows = (Array.isArray(entries) ? entries : [entries]).filter(Boolean).map(row).filter((r) => r['이전'] !== r['이후'] && r['팀ID'] && r['대상']);
  if (!rows.length) return 0;
  let n = 0;
  try { n = await sheetsDb.appendRows(TAB, rows); }
  catch (e) { console.error('[스케줄 변경 기록 실패]', e && e.message); return 0; }
  // 내 편성이 바뀐 사람에게만 알림 (lib/notify.js — 기다리지 않고, 실패해도 변경에는 영향 없음)
  try { require('./notify').scheduleChanged(Array.isArray(entries) ? entries.filter(Boolean) : [entries]); } catch (e) { console.error('[스케줄 알림 예약 실패]', e && e.message); }
  return n;
}

/** 편성 한 칸(예배 · 포지션)의 이름이 바뀐 것 — before/after 는 이름 배열 */
function assignEntry(team, by, sc, pos, before, after) {
  const b = (before || []).map(s).filter(Boolean), a = (after || []).map(s).filter(Boolean);
  if (b.join('\n') === a.join('\n')) return null;
  return { team, by, key: sc.key, date: sc.date, ev: sc.evName || '', kind: '편성', pos, before: b, after: a };
}

/** 불가(안 되는 날) 상태 { prac, sun } → 글 */
function offText(e) {
  if (!e) return '';
  const p = s(e.prac), u = s(e.sun);
  if (p && u) return p === u ? p : '연습: ' + p + ' · 예배: ' + u;
  if (p) return '연습만 · ' + p;
  if (u) return '예배만 · ' + u;
  return '';
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
function md(d) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s(d)); if (!m) return s(d); const x = new Date(d + 'T12:00:00'); return Number(m[2]) + '/' + Number(m[3]) + '(' + WD[x.getDay()] + ')'; }
/** lib/practice.js practiceFor 결과 → 글 */
function pracText(p) {
  if (!p) return '';
  if (p.none) return '연습 없음';
  if (p.unset || !p.date) return '미정';
  return md(p.date) + (p.note ? ' ' + p.note : '') + (p.auto ? ' (기본)' : '');
}

/** 행사 ID → 이름 (주일이면 '') */
async function evName(team, evId) {
  if (!s(evId)) return '';
  try { const r = (await sheetsDb.readAll('특별예배')).find((x) => x['팀ID'] === team && s(x['ID']) === s(evId)); return r ? s(r['이름']) || '주일 외 찬양' : ''; }
  catch (e) { return ''; }
}

/**
 * 찬양편성 줄들 전/후 → 칸(예배 · 포지션)마다 한 건 — 엑셀 가져오기 · 매주 고정 배정처럼 여러 칸을 한 번에 바꿀 때
 * @param {object[]} beforeRows 이 팀의 바꾸기 전 찬양편성 줄 · @param {object[]} afterRows 바꾼 뒤
 * @param {(pos:string)=>string} canon 포지션 이름 맞추기
 */
async function assignDiff(team, by, beforeRows, afterRows, canon) {
  const cell = (rows) => {
    const m = new Map();
    rows.forEach((r) => {
      const ev = s(r['행사ID']), key = ev ? 'ev-' + ev : s(r['날짜']), pos = canon(s(r['포지션'])), name = s(r['이름']);
      if (!key || !pos || !name) return;
      const k = key + '|' + pos;
      const c = m.get(k) || m.set(k, { key, date: s(r['날짜']), ev, pos, names: [] }).get(k);
      if (!c.names.includes(name)) c.names.push(name);
    });
    return m;
  };
  const b = cell(beforeRows), a = cell(afterRows);
  const out = [];
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const x = a.get(k) || b.get(k);
    const bn = (b.get(k) || { names: [] }).names, an = (a.get(k) || { names: [] }).names;
    if (bn.slice().sort().join('\n') === an.slice().sort().join('\n')) continue;
    out.push({ team, by, key: x.key, date: x.date, ev: await evName(team, x.ev), kind: '편성', pos: x.pos, before: bn, after: an });
  }
  return out;
}

/* ================================================================ 읽기 */
async function teamRows(team) {
  return (await sheetsDb.readAll(TAB)).filter((r) => r['팀ID'] === team);
}

function view(r) {
  return { id: s(r['ID']), at: s(r['시각']), by: s(r['변경자']), key: s(r['대상']), date: s(r['날짜']), ev: s(r['행사']),
    kind: s(r['종류']), pos: s(r['포지션']), person: s(r['사람']), before: s(r['이전']), after: s(r['이후']) };
}

const isAuto = (by) => /^자동/.test(s(by));

/**
 * 마지막으로 연 뒤 다른 사람이 바꾼 것들 — 그리고 확인 시각을 지금으로
 * @returns {{ since:string, first:boolean, items:object[] }}
 */
async function changesSince(team, name, { mark = true } = {}) {
  team = s(team); name = s(name);
  const now = new Date().toISOString();
  const seenRows = await sheetsDb.readAll(SEEN, { fresh: true });
  const mine = seenRows.find((r) => r['팀ID'] === team && s(r['이름']) === name);
  const first = !mine || !s(mine['확인시각']);
  const since = first ? new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString() : s(mine['확인시각']);
  const items = (await teamRows(team)).filter((r) => s(r['시각']) > since && s(r['변경자']) !== name && !isAuto(r['변경자']))
    .map(view).sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_CHANGES);
  if (mark && name) {
    try {
      if (mine) await sheetsDb.updateRow(SEEN, mine.__row, { '팀ID': team, '이름': name, '확인시각': now });
      else await sheetsDb.appendRow(SEEN, { '팀ID': team, '이름': name, '확인시각': now });
    } catch (e) { console.error('[스케줄 확인 시각 저장 실패]', e && e.message); }
  }
  return { since, first, items };
}

/**
 * 변경 기록 목록 (새 것부터)
 * @param {{ kind?:string, who?:string, days?:number, limit?:number }} o  who = 바꾼 사람이거나 변경에 들어 있는 사람
 */
async function history(team, o) {
  o = o || {};
  const from = o.days ? new Date(Date.now() - o.days * 24 * 3600 * 1000).toISOString() : '';
  const who = s(o.who);
  const has = (txt) => s(txt).split(/\s*,\s*/).includes(who);
  let rows = (await teamRows(s(team))).map(view);
  const people = Array.from(new Set(rows.map((r) => r.by).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'));
  rows = rows.filter((r) => (!from || r.at >= from) && (!o.kind || r.kind === o.kind) &&
    (!who || r.by === who || r.person === who || has(r.before) || has(r.after)));
  rows.sort((a, b) => b.at.localeCompare(a.at));
  const total = rows.length;
  return { items: rows.slice(0, o.limit || 400), total, people };
}

module.exports = { TAB, SEEN, log, assignEntry, assignDiff, evName, offText, pracText, changesSince, history, isAuto };
