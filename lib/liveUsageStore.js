/**
 * 라이브 악보 사용 기록 (V1310) — 허브 저장소: 구글 시트 '라이브악보기록' 탭 (lib/schema.js)
 * 모으기 · 권한 · 보관 규칙은 lib/liveUsage.js (청년부 앱과 같은 파일), 여기는 "누구인지 · 어디에 쓰는지" 만.
 */
'use strict';
const sheetsDb = require('./sheetsDb');
const liveAuth = require('./liveAuth');
const liveUsage = require('./liveUsage');

const TAB = '라이브악보기록';
const HEAD = ['날짜', '팀', '이름', '이메일', '구분', '콘티', '콘티이름', '처음', '마지막', '초', '횟수', '기기', '수정시각'];
const keyOf = (r) => [r['날짜'], r['팀'] || '', String(r['이메일'] || r['이름'] || '').toLowerCase(), r['콘티'] || ''].join('|');

async function identify(token) {
  const u = liveAuth.verify(token);
  if (u.ro) return { name: '방송팀 보기 링크', email: '', kind: '방송팀', team: u.team };
  if (u.gday) return { name: '객원 (공유 링크)', email: '', kind: '객원', team: u.team };
  return { name: u.name, email: u.email || '', kind: u.guest ? '객원 멤버' : '팀원', team: u.team };
}

async function merge(entries, cutoff) {
  const rows = await sheetsDb.readAll(TAB, { fresh: true });
  const at = new Map(rows.map((r) => [keyOf(r), r]));
  const now = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const cells = [], adds = [];
  entries.forEach((e) => {
    const r = at.get(keyOf(e));
    if (!r) { const o = Object.assign({}, e, { 수정시각: now }); adds.push(o); at.set(keyOf(e), Object.assign({ __new: true }, o)); return; }
    const o = r.__new ? r : Object.assign({}, r);
    o['초'] = Math.round((Number(o['초']) || 0) + (Number(e['초']) || 0));
    o['횟수'] = Math.round((Number(o['횟수']) || 0) + (Number(e['횟수']) || 0));
    if (e['처음'] && (!o['처음'] || e['처음'] < o['처음'])) o['처음'] = e['처음'];
    if (e['마지막'] && (!o['마지막'] || e['마지막'] > o['마지막'])) o['마지막'] = e['마지막'];
    ['이름', '구분', '콘티이름', '기기'].forEach((h) => { if (e[h]) o[h] = e[h]; });
    o['수정시각'] = now;
    if (r.__new) { Object.assign(r, o); const a = adds.find((x) => keyOf(x) === keyOf(r)); if (a) Object.assign(a, o); return; }
    ['이름', '구분', '콘티이름', '처음', '마지막', '초', '횟수', '기기', '수정시각'].forEach((h) => cells.push({ row: r.__row, header: h, value: o[h] }));
  });
  if (cells.length) await sheetsDb.updateCells(TAB, cells);
  if (adds.length) await sheetsDb.appendRows(TAB, adds.map((o) => { const x = {}; HEAD.forEach((h) => { x[h] = o[h]; }); return x; }));
  if (cutoff) {
    const old = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r['날짜'] || '')) && r['날짜'] < cutoff).map((r) => r.__row);
    if (old.length) await sheetsDb.deleteRows(TAB, old);
  }
}

async function read(from, to) {
  const rows = await sheetsDb.readAll(TAB, { fresh: true });
  return rows.filter((r) => { const d = String(r['날짜'] || ''); return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from && d <= to; });
}

const store = liveUsage.create({ identify, merge, read });
module.exports = store;
