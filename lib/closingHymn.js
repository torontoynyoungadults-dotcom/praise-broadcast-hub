/**
 * 폐회송 — 축도 직전에 부르는 곡. 보통 1년에 한 번 정도만 바뀝니다.
 * 찬양팀마다 '설정' 시트에 한 줄('폐회송:<팀명>', 값은 JSON) — "관리"에서 바꿉니다.
 * 저장해 두면, 그 뒤로 여는 모든 주(행사 제외)의 예배콘티에 '구분'=폐회송 곡으로 자동으로 들어갑니다
 * (routes/conti.js 의 ensureClosingHymn — 이미 그 주에 들어가 있으면 다시 넣지 않아, 그 주만 따로 고쳐도 됩니다).
 */
const sheetsDb = require('./sheetsDb');

const PREFIX = '폐회송:';
const FIELDS = ['제목', '팀', 'Key', 'BPM', '송폼', '유튜브', '비고'];
const MAX = { 제목: 80, 팀: 60, Key: 8, BPM: 4, 송폼: 120, 유튜브: 300, 비고: 300 };

function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }

/** 저장된 기본값 — 제목이 없으면(아직 안 정함) null */
async function get(team) {
  let v = {};
  try {
    const r = (await sheetsDb.readAll('설정')).find((x) => x['키'] === PREFIX + team);
    if (r && r['값']) v = JSON.parse(r['값']);
  } catch (e) { v = {}; }
  const out = {}; FIELDS.forEach((k) => { out[k] = clean(v[k], MAX[k]); });
  return out['제목'] ? out : null;
}

async function save(team, input) {
  input = input || {};
  const next = {}; FIELDS.forEach((k) => { next[k] = clean(input[k], MAX[k]); });
  const row = { '키': PREFIX + team, '값': JSON.stringify(next), '설명': '폐회송(축도 직전 찬양) 기본값 — 관리에서 바꿈. 매주 콘티에 자동으로 들어가요.' };
  const ex = (await sheetsDb.readAll('설정', { fresh: true })).find((x) => x['키'] === PREFIX + team);
  if (ex) await sheetsDb.updateRow('설정', ex.__row, row); else await sheetsDb.appendRow('설정', row);
  return next;
}

module.exports = { get, save, FIELDS };
