/**
 * 녹음 · 영상 받아들이기 — 큰 파일(예배 전체 · 영상)도 올릴 수 있게.
 *  · 파일은 서버 디스크(임시)로 받아 R2 'audio/<ID>' 로 흘려 올림 → 링크 '/audio/<ID>' (메모리 25MB 한도 없음, 최대 MAX_MB)
 *  · 카톡에서 바로 올리기 — 안드로이드: 홈 화면 앱의 "공유" 대상(/share/rec) · 아이폰: 단축어가 개인 주소(토큰)로 보냄
 */
'use strict';
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sheetsDb = require('./sheetsDb');
const r2 = require('./r2');

const MAX_MB = 800;
const big = multer({ storage: multer.diskStorage({ destination: os.tmpdir() }), limits: { fileSize: MAX_MB * 1024 * 1024 }, defParamCharset: 'utf8' });

const EXT_TYPE = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', amr: 'audio/amr', '3gp': 'audio/3gpp', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm' };
function typeOf(file) {
  const t = String(file.mimetype || '');
  if (/^(audio|video)\//.test(t)) return t;
  const ext = String(file.originalname || '').split('.').pop().toLowerCase();
  return EXT_TYPE[ext] || '';
}
/** 받은 파일 → R2 → '/audio/<ID>'. 임시 파일은 지움 */
async function store(file) {
  try {
    if (!r2.enabled()) throw new Error('녹음 저장소(R2)가 설정되지 않았어요.');
    const type = typeOf(file);
    if (!type) throw new Error('음원 · 영상 파일(mp3, m4a, wav, mp4 등)만 올릴 수 있어요.');
    const id = r2.newId();
    if (file.path) await r2.putFile(id, file.path, file.size, type, 'audio');
    else await r2.put(id, file.buffer, type, 'audio');
    return '/audio/' + id;
  } finally { if (file && file.path) fs.unlink(file.path, () => {}); }
}
function cleanTitle(name) { return String(name || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '녹음'; }

/** 토론토 날짜 'YYYY-MM-DD' */
const ymd = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto' }).format(d);
/** 어느 주일 콘티에 넣을지 기본값 — 예배 녹음은 지난(오늘 포함) 주일, 연습 · 참고는 다가오는(오늘 포함) 주일 */
function defaultDate(kind) {
  const t = ymd(new Date()), d = new Date(t + 'T12:00:00Z'), dow = d.getUTCDay();
  const add = kind === '예배' ? -dow : (7 - dow) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}
/** 단축어에서 고른 주일 — "다가오는 주일" · "지난 주일" · "2주 전 주일" (없으면 종류에 따른 기본) */
function dateFor(kind, when) {
  const w = String(when || '');
  if (!w) return defaultDate(kind);
  const back = /2\s*주|그\s*전|전전/.test(w), past = back || /지난|저번/.test(w);
  const d = new Date(defaultDate(past ? '예배' : '연습') + 'T12:00:00Z');
  if (back) d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}
/** 고를 수 있는 주일 — 지난 4주 · 앞으로 3주 */
function sundayChoices() {
  const base = new Date(defaultDate('연습') + 'T12:00:00Z'), out = [];
  for (let i = -4; i <= 3; i++) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + i * 7); out.push(d.toISOString().slice(0, 10)); }
  return out;
}

async function addRec({ team, date, event, kind, title, link, who }) {
  const k = kind === '예배' ? '예배' : kind === '참고' ? '참고' : '연습';
  await sheetsDb.appendRow('녹음', { 'ID': 'R' + Date.now().toString(36), '팀ID': team, '날짜': date, '행사ID': event || '', '구분': k, '제목': title, '링크': link, '올린사람': who, '올린시각': new Date().toISOString() });
  return k;
}

/* ---- 아이폰 단축어용 개인 주소 (토큰) ---- */
const TOK = (email) => '업로드토큰:' + String(email || '').toLowerCase();
async function setSetting(key, value, desc) {
  const rows = await sheetsDb.readAll('설정', { fresh: true });
  const hit = rows.find((r) => r['키'] === key);
  const row = { '키': key, '값': value, '설명': desc || (hit && hit['설명']) || '' };
  if (hit) await sheetsDb.updateRow('설정', hit.__row, row); else await sheetsDb.appendRow('설정', row);
}
async function tokenFor(email, reset) {
  let t = reset ? '' : String((await sheetsDb.getSetting(TOK(email), '')) || '');
  if (!t) { t = crypto.randomBytes(18).toString('base64url'); await setSetting(TOK(email), t, '아이폰 단축어로 녹음 올리기 — 개인 주소 (다시 만들면 예전 단축어는 안 됨)'); }
  return t;
}
async function emailOfToken(token) {
  const t = String(token || '').trim(); if (t.length < 16) return '';
  const rows = await sheetsDb.readAll('설정');
  const hit = rows.find((r) => String(r['키'] || '').startsWith('업로드토큰:') && String(r['값'] || '') === t);
  return hit ? String(hit['키']).slice('업로드토큰:'.length) : '';
}

module.exports = { big, store, typeOf, cleanTitle, defaultDate, dateFor, sundayChoices, addRec, tokenFor, emailOfToken, MAX_MB };
