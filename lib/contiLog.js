/**
 * 예배콘티 변경 기록 — 누가 · 언제 · 어느 예배의 어느 곡을 어떻게 바꿨는지 '콘티변경기록' 탭에 한 줄씩 남깁니다.
 * (스케줄표의 lib/scheduleLog.js 와 같은 방식)
 *
 *  · 종류: 추가 · 삭제 · 수정(바뀐 칸마다 한 줄) · 순서 · 악보추가 · 악보삭제
 *  · 대상 = 예배 키(주일 날짜 또는 'ev-<행사ID>'), 날짜 = 그 예배 날짜, 행사 = 행사 이름(주일이면 빈 칸)
 *
 * "처음 볼 때 알림" — '콘티확인' 탭에 사람 · 예배(대상)마다 마지막으로 콘티를 연 시각을 둡니다.
 * 콘티를 열면 그 시각 이후 다른 사람이 바꾼 것들을 돌려주고(화면이 맨 위에 알림 · 곡에 표시), 확인 시각을 지금으로 바꿉니다.
 * 메뉴의 "예배 콘티" 탭에 붙는 숫자 표시는 확인 시각을 건드리지 않고 개수만 셉니다(count).
 *
 * 기록은 덤 — 기록 쓰기가 실패해도 실제 변경은 그대로 둡니다 (오류는 로그에만).
 */
const sheetsDb = require('./sheetsDb');

const TAB = '콘티변경기록';
const SEEN = '콘티확인';
const FIRST_LOOKBACK_MS = 7 * 24 * 3600 * 1000;   // 처음 여는 사람 — 지난 7일 변경을 보여 줌
const MAX_CHANGES = 200;
const CLIP = 140;
const FULL = 4000;                                  // 이전 · 이후 값 — 되돌리기를 위해 거의 그대로 남김 (화면에서는 줄여 보임)

let _n = 0;
const uid = () => 'K' + Date.now().toString(36) + (++_n).toString(36) + Math.random().toString(36).slice(2, 5);
const s = (v) => String(v == null ? '' : v).trim();
const clip = (v) => { const t = s(v).replace(/\s+/g, ' '); return t.length > CLIP ? t.slice(0, CLIP - 1) + '…' : t; };
const full = (v) => { const t = s(v); return t.length > FULL ? t.slice(0, FULL - 1) + '…' : t; };
const strip = (r) => { if (!r) return null; const o = Object.assign({}, r); delete o.__row; return o; };

/** 예배 키 — 행사면 'ev-<ID>', 아니면 주일 날짜 */
const keyOf = (scope) => (scope && scope.event ? 'ev-' + scope.event : s(scope && scope.date));

/** 곡 구분 → 보여 줄 이름 */
const KIND_LABEL = { 콘티: '콘티', 결단: '설교 후 찬양', 폐회송: '폐회송' };

/** 수정으로 볼 칸 (시트 칸 이름 → 보여 줄 이름) */
const FIELDS = [['제목', '제목'], ['팀', '원곡팀'], ['Key', 'Key'], ['BPM', 'BPM'], ['송폼', '송폼'], ['유튜브', '유튜브'], ['비고', '설명']];

function row(e) {
  const sc = e.scope || {};
  return {
    'ID': uid(), '팀ID': s(e.team), '시각': e.at || new Date().toISOString(), '변경자': s(e.by) || '알 수 없음',
    '대상': keyOf(sc), '날짜': s(sc.date), '행사': s(e.ev), '종류': s(e.kind),
    '곡ID': s(e.songId), '곡': clip(e.song), '항목': s(e.field), '이전': full(e.before), '이후': full(e.after),
    '데이터': e.data ? JSON.stringify(e.data).slice(0, 45000) : '',
  };
}

/** 여러 건을 한 번에. 실패해도 던지지 않음 */
async function log(entries) {
  const rows = (Array.isArray(entries) ? entries : [entries]).filter(Boolean).map(row).filter((r) => r['팀ID'] && r['대상'] && r['종류']);
  if (!rows.length) return 0;
  let n = 0;
  try { n = await sheetsDb.appendRows(TAB, rows); }
  catch (e) { console.error('[콘티 변경 기록 실패]', e && e.message); }
  // 관리자에게 알림 (모아서 한 번 · 실패해도 조용히) — notify 가 이 파일을 쓰지 않도록 여기서 늦게 불러옴
  try { require('./notify').adminConti(rows.map(view)); } catch (e) { console.error('[관리자 변경 알림 실패]', e && e.message); }
  return n;
}

/** 곡 하나가 새로 생김 */
const addEntry = (team, by, scope, song) => ({ team, by, scope, kind: '추가', songId: song['ID'], song: song['제목'], field: KIND_LABEL[song['구분']] || '콘티', after: song['제목'] });
/** 곡 하나가 지워짐 */
const removeEntry = (team, by, scope, song) => ({ team, by, scope, kind: '삭제', songId: song['ID'], song: song['제목'], field: KIND_LABEL[song['구분']] || '콘티', before: song['제목'], data: { row: strip(song) } });

/** 곡 수정 전 · 후 줄 → 바뀐 칸마다 한 건 (같으면 없음) */
function editEntries(team, by, scope, before, after, extra) {
  const out = [];
  FIELDS.forEach(([col, label]) => {
    const b = s(before[col]), a = s(after[col]);
    if (b === a) return;
    out.push(Object.assign({ team, by, scope, kind: '수정', songId: s(after['ID'] || before['ID']), song: s(after['제목']) || s(before['제목']), field: label, before: b, after: a }, extra || {}));
  });
  return out;
}

/** 순서가 바뀜 — 앞 · 뒤 곡 제목 목록 (같으면 없음) */
function orderEntry(team, by, scope, beforeTitles, afterTitles, beforeIds, afterIds) {
  const b = beforeTitles.map(s), a = afterTitles.map(s);
  if (b.join('\n') === a.join('\n')) return null;
  return { team, by, scope, kind: '순서', song: '', field: '순서', before: b.join(' › '), after: a.join(' › '), data: beforeIds ? { before: beforeIds.map(s), after: (afterIds || []).map(s) } : null };
}

/** 악보가 올라오거나 지워짐 — 곡 제목(없으면 콘티 전체) · 악보 제목 */
const sheetEntry = (team, by, scope, added, song, sheetTitle, data) => ({ team, by, scope, kind: added ? '악보추가' : '악보삭제', songId: s(song && song['ID']), song: s(song && song['제목']) || '콘티 전체', field: '악보', before: added ? '' : sheetTitle, after: added ? sheetTitle : '', data: data || null });

/* ================================================================ 읽기 */
function view(r) {
  let data = null; try { data = r['데이터'] ? JSON.parse(r['데이터']) : null; } catch (e) { data = null; }
  return { id: s(r['ID']), team: s(r['팀ID']), at: s(r['시각']), by: s(r['변경자']), key: s(r['대상']), date: s(r['날짜']), ev: s(r['행사']),
    kind: s(r['종류']), songId: s(r['곡ID']), song: s(r['곡']), field: s(r['항목']), before: s(r['이전']), after: s(r['이후']), data };
}

/** 한 예배(대상) 콘티의 모든 변경 — 새 것부터 */
async function list(team, key) {
  team = s(team); key = s(key);
  if (!team || !key) return [];
  return (await sheetsDb.readAll(TAB, { fresh: true })).filter((r) => r['팀ID'] === team && s(r['대상']) === key)
    .map(view).sort((a, b) => b.at.localeCompare(a.at));
}
/** 기록 한 건 */
async function byId(team, id) {
  const r = (await sheetsDb.readAll(TAB, { fresh: true })).find((x) => x['팀ID'] === s(team) && s(x['ID']) === s(id));
  return r ? view(r) : null;
}

async function seenRow(team, name, key, fresh) {
  const rows = await sheetsDb.readAll(SEEN, fresh ? { fresh: true } : undefined);
  return rows.find((r) => r['팀ID'] === team && s(r['이름']) === name && s(r['대상']) === key) || null;
}

async function unseen(team, name, key, mine) {
  const first = !mine || !s(mine['확인시각']);
  const since = first ? new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString() : s(mine['확인시각']);
  const items = (await sheetsDb.readAll(TAB))
    .filter((r) => r['팀ID'] === team && s(r['대상']) === key && s(r['시각']) > since && s(r['변경자']) !== name)
    .map(view).sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_CHANGES);
  return { first, since, items };
}

/**
 * 마지막으로 연 뒤 다른 사람이 바꾼 것들 — 그리고 확인 시각을 지금으로
 * @returns {{ first:boolean, since:string, items:object[] }}
 */
async function changesSince(team, name, key, { mark = true } = {}) {
  team = s(team); name = s(name); key = s(key);
  if (!team || !key) return { first: true, since: '', items: [] };
  const mine = name ? await seenRow(team, name, key, true) : null;
  const r = await unseen(team, name, key, mine);
  // 알릴 것도 없고 확인 시각도 이미 있으면 쓰지 않음 (열 때마다 시트를 건드리지 않게)
  if (mark && name && (r.items.length || !mine)) {
    try {
      const rec = { '팀ID': team, '이름': name, '대상': key, '확인시각': new Date().toISOString() };
      if (mine) await sheetsDb.updateRow(SEEN, mine.__row, rec); else await sheetsDb.appendRow(SEEN, rec);
    } catch (e) { console.error('[콘티 확인 시각 저장 실패]', e && e.message); }
  }
  return r;
}

/** 확인 시각은 그대로 두고 아직 못 본 변경 개수만 — 메뉴 표시용 (처음 보는 사람은 지난 7일 변경을 셈, changesSince 와 같은 기준) */
async function count(team, name, key) {
  team = s(team); name = s(name); key = s(key);
  if (!team || !key || !name) return 0;
  return (await unseen(team, name, key, await seenRow(team, name, key))).items.length;
}

module.exports = { TAB, SEEN, FIELDS, keyOf, log, addEntry, removeEntry, editEntries, orderEntry, sheetEntry, changesSince, count, list, byId, view, strip, KIND_LABEL };
