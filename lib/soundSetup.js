/**
 * 마이크 · 인이어 설정 — 싱어는 이름마다 마이크 라인 · 인이어 번호, 세션은 악기마다 마이크 번호, 그리고 P16 채널 16개 이름.
 * '음향설정' 탭(lib/schema.js)에 팀 · 종류 · 열쇠마다 한 줄. 주일 편성(routes/conti.js lineupCell)이 이름 아래에 번호를 보여 줌.
 */
const sheetsDb = require('./sheetsDb');

const SINGER_POS = ['인도자', '남성싱어', '여성싱어', '알토'];
const SESSION_INST = ['드럼', '베이스', '일렉', '피아노', '신디', '어쿠기타'];
const P16_DEFAULT = ['드럼', '베이스', '일렉', '피아노', '야마하신디', '노드신디', '모조오르간', '어쿠', '포디움 마이크', '무선마이크', '싱어', '메트로놈', '토크백', '', '', ''];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n || 12);
const parse = (v) => { try { const o = JSON.parse(String(v || '{}')); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };

/** 이 팀의 설정 — { singer: {이름: {mic, iem}}, session: {악기: {mic}}, p16: ['이름', … 16개] } */
async function get(team) {
  const rows = (await sheetsDb.readAll('음향설정')).filter((r) => r['팀ID'] === team);
  const out = { singer: {}, session: {}, p16: P16_DEFAULT.slice(), saved: false };
  rows.forEach((r) => {
    const k = String(r['열쇠'] || '').trim(), v = parse(r['값']);
    if (r['종류'] === '싱어' && k) out.singer[k] = { mic: clean(v.mic), iem: clean(v.iem) };
    else if (r['종류'] === '세션' && k) out.session[k] = { mic: clean(v.mic) };
    else if (r['종류'] === 'P16') { const i = Number(k) - 1; if (i >= 0 && i < 16) { out.p16[i] = clean(v.name, 24); out.saved = true; } }
  });
  return out;
}

/** 통째로 저장 — 바뀐 줄만 고치고, 새 줄은 더하고, 비운 줄은 지움 */
async function save(team, data, by) {
  const rows = (await sheetsDb.readAll('음향설정', { fresh: true })).filter((r) => r['팀ID'] === team);
  const want = [];
  Object.keys(data.singer || {}).forEach((n) => { const v = data.singer[n]; if (v.mic || v.iem) want.push(['싱어', n, JSON.stringify({ mic: v.mic, iem: v.iem })]); });
  Object.keys(data.session || {}).forEach((k) => { const v = data.session[k]; if (v.mic) want.push(['세션', k, JSON.stringify({ mic: v.mic })]); });
  (data.p16 || []).forEach((name, i) => want.push(['P16', String(i + 1), JSON.stringify({ name })]));
  const now = new Date().toISOString();
  const key = (a, b) => a + '|' + b;
  const have = new Map(rows.map((r) => [key(r['종류'], String(r['열쇠'])), r]));
  const keep = new Set();
  const adds = [];
  for (const [kind, k, val] of want) {
    keep.add(key(kind, k));
    const r = have.get(key(kind, k));
    const obj = { '팀ID': team, '종류': kind, '열쇠': k, '값': val, '수정자': by, '수정시각': now };
    if (!r) adds.push(obj);
    else if (String(r['값']) !== val) await sheetsDb.updateRow('음향설정', r.__row, obj);
  }
  if (adds.length) await sheetsDb.appendRows('음향설정', adds);
  const gone = rows.filter((r) => !keep.has(key(r['종류'], String(r['열쇠'])))).map((r) => r.__row);
  if (gone.length) await sheetsDb.deleteRows('음향설정', gone);
  sheetsDb.invalidate('음향설정');
}

/** 주일 편성 칸에 붙일 작은 글 — 싱어 "마이크 3 · 인이어 5", 세션 "마이크 7" */
function tagFor(cfg, pos, name) {
  if (!cfg) return '';
  if (SINGER_POS.includes(pos)) {
    const v = cfg.singer[name]; if (!v) return '';
    return [v.mic && `마이크 ${v.mic}`, v.iem && `인이어 ${v.iem}`].filter(Boolean).join(' · ');
  }
  const v = cfg.session[pos];
  return v && v.mic ? `마이크 ${v.mic}` : '';
}

/** 같은 정보를 칸으로 — [{k:'mic'|'iem', v:'3'}] */
function partsFor(cfg, pos, name) {
  if (!cfg) return [];
  if (SINGER_POS.includes(pos)) { const v = cfg.singer[name] || {}; return [v.mic && { k: 'mic', v: v.mic }, v.iem && { k: 'iem', v: v.iem }].filter(Boolean); }
  const v = cfg.session[pos]; return v && v.mic ? [{ k: 'mic', v: v.mic }] : [];
}

module.exports = { get, save, tagFor, partsFor, SINGER_POS, SESSION_INST, P16_DEFAULT };
