/**
 * 페이지 방문 기록 — 누가 · 언제 · 어느 페이지를 · 어떤 기기로 · 얼마나 봤는지 (관리자만 봄).
 * 화면(public/js/visit.js)이 페이지를 떠나거나 가릴 때 그동안 본 초를 보내고, 여기서 모아 1분마다 '방문기록' 탭에 한꺼번에 씁니다.
 * 같은 방문(ID)이 여러 번 오면 합칩니다 (이미 시트에 쓴 뒤 온 것은 새 줄 — 읽을 때 ID 로 더함).
 */
'use strict';
const sheetsDb = require('./sheetsDb');

const TAB = '방문기록';
const buf = new Map();
let timer = null;

const stamp = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d).replace(' ', 'T');

function add(e) {
  const id = String(e.id || '').slice(0, 40);
  const sec = Math.max(0, Math.min(6 * 3600, Math.round(Number(e.sec) || 0)));
  if (!id || !sec) return;
  const cur = buf.get(id);
  if (cur) { cur['초'] += sec; return; }
  buf.set(id, { 'ID': id, '시각': stamp(new Date(Date.now() - sec * 1000)), '이메일': e.email, '이름': e.name, '페이지': String(e.page || '').slice(0, 60), '주소': String(e.path || '').slice(0, 160), '기기': String(e.dev || '').slice(0, 40), '초': sec });
}

async function flush() {
  if (!buf.size) return;
  const rows = Array.from(buf.values()); buf.clear();
  try { await sheetsDb.appendRows(TAB, rows); }
  catch (e) { console.error('[방문 기록 저장 실패]', e && e.message); rows.forEach((r) => { if (!buf.has(r['ID'])) buf.set(r['ID'], r); }); }
}

function start() { if (!timer) { timer = setInterval(() => flush(), 60 * 1000); timer.unref(); } }

/** 최근 days 일 — ID 로 합친 방문 목록 (아직 시트에 안 쓴 것 포함), 새것부터 */
async function list(days) {
  const from = stamp(new Date(Date.now() - days * 86400000));
  const rows = (await sheetsDb.readAll(TAB, { fresh: true })).concat(Array.from(buf.values()));
  const by = new Map();
  rows.forEach((r) => {
    if (String(r['시각'] || '') < from) return;
    const id = r['ID'], hit = by.get(id);
    if (hit) { hit.sec += Number(r['초']) || 0; return; }
    by.set(id, { at: String(r['시각']), email: r['이메일'], name: r['이름'], page: r['페이지'], path: r['주소'], dev: r['기기'], sec: Number(r['초']) || 0 });
  });
  // 라이브 악보 (따로 모으는 기록) — 하루 · 콘티당 한 줄
  try {
    const live = await sheetsDb.readAll('라이브악보기록');
    live.forEach((r) => {
      const at = String(r['날짜'] || '') + 'T' + String(r['처음'] || '00:00').slice(0, 5);
      if (at < from || !(Number(r['초']) > 0)) return;
      by.set('L' + r.__row, { at, email: r['이메일'], name: r['이름'], page: '라이브 악보' + (r['콘티이름'] ? ' · ' + r['콘티이름'] : ''), path: '', dev: r['기기'] || '', sec: Number(r['초']) || 0, live: true, n: Number(r['횟수']) || 1 });
    });
  } catch (e) { /* 없으면 넘어감 */ }
  return Array.from(by.values()).sort((a, b) => b.at.localeCompare(a.at));
}

module.exports = { add, flush, start, list };
