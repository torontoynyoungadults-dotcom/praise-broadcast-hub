/**
 * 예배·연습 시간 기본값 — 찬양팀마다 '설정' 시트에 한 줄('시간설정:<팀명>', 값은 JSON).
 *  · 예배 시간(오전 11시 15분) · 주일 당일 리허설 모임(오전 10시 35분) · 기본 연습(오후 6시 30분) · 연습 장소(본당)
 *  · "관리"에서 바꿉니다. 연습 시간은 주별로 스케줄표 '연습일정 비고'에서 따로 바꿀 수 있고(그 주만),
 *    주일 외 찬양은 행사마다 예배 시간 · 당일 리허설 시간을 따로 적습니다.
 */
const sheetsDb = require('./sheetsDb');

const PREFIX = '시간설정:';
const DEFAULTS = { worship: '11:15', rehearsal: '10:35', practice: '18:30', place: '본당' };
const isTime = (s) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || '').trim());
const norm = (s) => parse(s);

/**
 * 사람이 적은 시간 → "HH:MM" (못 읽으면 '').  "17:00" · "5:00 pm" · "오후 5시" · "오후 5시 30분" · "5시" · "5" 모두 OK.
 * 오전/오후를 안 적으면 1~6시는 오후, 7~11시는 오전, 12시는 낮 12시로 읽어요.
 */
function parse(input) {
  let t = String(input == null ? '' : input).trim().toLowerCase();
  if (!t) return '';
  let ap = '';
  if (/오후|pm|p\.m/.test(t)) ap = 'pm'; else if (/오전|am|a\.m/.test(t)) ap = 'am';
  t = t.replace(/오전|오후|a\.?m\.?|p\.?m\.?/g, ' ').trim();
  let m = /^(\d{1,2})\s*(?::|시)\s*(\d{1,2})?\s*(?:분)?$/.exec(t) || /^(\d{1,2})$/.exec(t);
  if (!m) { const d = /^(\d{1,2})(\d{2})$/.exec(t); if (d) m = d; }
  if (!m) return '';
  let h = Number(m[1]), mi = m[2] === undefined ? 0 : Number(m[2]);
  if (!(mi >= 0 && mi <= 59) || h > 23) return '';
  if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 6) h += 12;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return pad(h) + ':' + pad(mi);
}

/** "11:15" → "오전 11시 15분" · "18:30" → "오후 6시 30분" · "12:00" → "오후 12시" */
function fmt(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return '';
  const h = Number(m[1]), mi = Number(m[2]);
  const ap = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}시${mi ? ` ${mi}분` : ''}`;
}

async function get(team) {
  let v = {};
  try {
    const r = (await sheetsDb.readAll('설정')).find((x) => x['키'] === PREFIX + team);
    if (r && r['값']) v = JSON.parse(r['값']);
  } catch (e) { v = {}; }
  const out = { ...DEFAULTS };
  ['worship', 'rehearsal', 'practice'].forEach((k) => { if (parse(v[k])) out[k] = parse(v[k]); });
  if (typeof v.place === 'string') out.place = v.place.trim().slice(0, 30);
  return out;
}

async function save(team, input) {
  const cur = await get(team);
  const next = { ...cur };
  ['worship', 'rehearsal', 'practice'].forEach((k) => { if (parse(input[k])) next[k] = parse(input[k]); });
  if (input.place !== undefined) next.place = String(input.place || '').trim().slice(0, 30);
  const row = { '키': PREFIX + team, '값': JSON.stringify(next), '설명': '예배·리허설·연습 기본 시간 (관리에서 바꿈)' };
  const ex = (await sheetsDb.readAll('설정', { fresh: true })).find((x) => x['키'] === PREFIX + team);
  if (ex) await sheetsDb.updateRow('설정', ex.__row, row); else await sheetsDb.appendRow('설정', row);
  return next;
}

/** 기본 연습 안내 문구 — "오후 6시 30분 본당" */
const practiceNote = (s) => [fmt(s.practice), s.place].filter(Boolean).join(' ');

module.exports = { DEFAULTS, isTime, parse, fmt, get, save, practiceNote };
