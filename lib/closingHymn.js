/**
 * 폐회송 — 축도 직전에 부르는 곡. 보통 1년에 한 번 정도만 바뀝니다.
 * 찬양팀마다 '설정' 시트에 한 줄('폐회송:<팀명>', 값은 JSON) — "관리"에서 바꿉니다.
 * 저장해 두면, 그 뒤로 여는 모든 주(행사 제외)의 예배콘티에 '구분'=폐회송 곡으로 자동으로 들어갑니다
 * (routes/conti.js 의 ensureClosingHymn — 이미 그 주에 들어가 있으면 다시 넣지 않아, 그 주만 따로 고쳐도 됩니다).
 * 기본 악보(파일 · 링크)도 여기 함께 저장해 두면(getSheets/addSheets/removeSheet), 매주 만들어지는 폐회송 곡에
 * 그대로 복사돼 붙습니다 (routes/conti.js 의 ensureClosingHymn).
 */
const sheetsDb = require('./sheetsDb');

const PREFIX = '폐회송:';
const FIELDS = ['제목', '팀', 'Key', 'BPM', '송폼', '유튜브', '비고'];
const MAX = { 제목: 80, 팀: 60, Key: 8, BPM: 4, 송폼: 120, 유튜브: 300, 비고: 300 };
const DESC = '폐회송(축도 직전 찬양) 기본값 — 관리에서 바꿈. 매주 콘티에 자동으로 들어가요.';

function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }

/** 저장된 전체 값(제목 등 + 악보) 그대로 — 내부용. 읽기 실패하면 빈 값. */
async function load(team, opts) {
  try {
    const r = (await sheetsDb.readAll('설정', opts)).find((x) => x['키'] === PREFIX + team);
    return (r && r['값']) ? JSON.parse(r['값']) : {};
  } catch (e) { return {}; }
}
async function store(team, v) {
  const row = { '키': PREFIX + team, '값': JSON.stringify(v), '설명': DESC };
  const ex = (await sheetsDb.readAll('설정', { fresh: true })).find((x) => x['키'] === PREFIX + team);
  if (ex) await sheetsDb.updateRow('설정', ex.__row, row); else await sheetsDb.appendRow('설정', row);
}

/** 저장된 기본값 — 제목이 없으면(아직 안 정함) null */
async function get(team) {
  const v = await load(team);
  const out = {}; FIELDS.forEach((k) => { out[k] = clean(v[k], MAX[k]); });
  return out['제목'] ? out : null;
}

/** 제목 · 팀 · Key 등 글 칸만 바꿉니다 — 악보(getSheets)는 그대로 둡니다. */
async function save(team, input) {
  input = input || {};
  const prev = await load(team, { fresh: true });
  const next = Object.assign({}, prev);
  FIELDS.forEach((k) => { next[k] = clean(input[k], MAX[k]); });
  await store(team, next);
  const out = {}; FIELDS.forEach((k) => { out[k] = next[k]; });
  return out;
}

/** 기본 악보 목록 — [{제목, 링크}] */
async function getSheets(team) {
  const v = await load(team);
  return Array.isArray(v['악보']) ? v['악보'].filter((x) => x && x['링크']).map((x) => ({ 제목: clean(x['제목'], 80) || '악보', 링크: clean(x['링크'], 500) })) : [];
}

/** 기본 악보 더하기 — items: [{제목, 링크}] (링크 없는 건 무시) */
async function addSheets(team, items) {
  const v = await load(team, { fresh: true });
  const list = Array.isArray(v['악보']) ? v['악보'].slice() : [];
  ([].concat(items || [])).forEach((it) => {
    const link = clean(it && it['링크'], 500);
    if (link) list.push({ 제목: clean(it['제목'], 80) || '악보', 링크: link });
  });
  v['악보'] = list;
  await store(team, v);
  return list;
}

/** 기본 악보 하나 지우기 (idx = getSheets가 돌려준 배열의 자리) */
async function removeSheet(team, idx) {
  const v = await load(team, { fresh: true });
  const list = Array.isArray(v['악보']) ? v['악보'].slice() : [];
  idx = Number(idx);
  if (Number.isInteger(idx) && idx >= 0 && idx < list.length) list.splice(idx, 1);
  v['악보'] = list;
  await store(team, v);
  return list;
}

module.exports = { get, save, getSheets, addSheets, removeSheet, FIELDS };
