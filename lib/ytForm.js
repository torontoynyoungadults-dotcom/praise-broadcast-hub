/**
 * 유튜브 송폼 태그 · 나만 보는 악보 (church-app logic/worship10.js 와 같은 약속)
 *  · 송폼 태그: 팀 · 영상마다 한 줄 ('유튜브송폼'). 팀원 누구나 저장. 그사이 다른 분이 저장했으면 덮어쓰지 않고 알림.
 *  · 나만 보는 악보: '개인악보' — 예배(방)마다 · 사람마다. 드라이브에는 링크 공유 없이(uploadPrivate) — /sheet/<id> 로 본인만.
 *  화면: public/worship/ytform.js (라이브 악보 유튜브 창 · 예배콘티 「유튜브로 이어 듣기」) · public/worship/practice.js (나만 보는 악보)
 */
const sheetsDb = require('./sheetsDb');
const driveStore = require('./driveStore');
const liveStore = require('./liveStore');

const VID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_TAGS = 80, MINE_MAX = 30;
const err = (m) => Object.assign(new Error(m), { user: true });

function vidOf(v) { v = String(v || '').trim(); if (!VID_RE.test(v)) throw err('유튜브 영상을 확인해주세요.'); return v; }
/** [{ t: 초(0.1 단위), k: 이름(12자) }] — 화면 ytform.js clean 과 같은 규칙 */
function cleanTags(tags) {
  const out = [], seen = new Set();
  (Array.isArray(tags) ? tags : []).forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const t = Math.round(Number(x.t) * 10) / 10;
    const k = String(x.k == null ? '' : x.k).replace(/[^A-Za-z0-9가-힣 .+\-()#']/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
    if (!Number.isFinite(t) || t < 0 || t > 36000 || !k || seen.has(t + '|' + k)) return;
    seen.add(t + '|' + k); out.push({ t, k });
  });
  out.sort((a, b) => a.t - b.t);
  return out.slice(0, MAX_TAGS);
}
function shape(vid, r) {
  if (!r) return { vid, tags: [], by: '', at: 0, title: '' };
  let tags = []; try { tags = cleanTags(JSON.parse(String(r['태그'] || '[]'))); } catch (e) { tags = []; }
  return { vid, tags, by: String(r['수정자'] || ''), at: Number(r['저장시각값']) || 0, title: String(r['제목'] || '') };
}
async function rowOf(team, vid, fresh) {
  const rows = await sheetsDb.readAll('유튜브송폼', fresh ? { fresh: true } : undefined);
  return rows.find((r) => r['팀ID'] === team && String(r['영상ID'] || '').trim() === vid) || null;
}

async function get(team, vid) { vid = vidOf(vid); return shape(vid, await rowOf(team, vid)); }

const chains = new Map();
function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const job = prev.catch(() => {}).then(fn);
  chains.set(key, job);
  return job.finally(() => { if (chains.get(key) === job) chains.delete(key); });
}
async function save(team, who, vid, title, tags, baseAt) {
  vid = vidOf(vid);
  const clean = cleanTags(tags);
  title = String(title || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  return serial(team + '\u0001' + vid, async () => {
    const row = await rowOf(team, vid, true), cur = shape(vid, row);
    if (cur.at && Number(baseAt || 0) < cur.at) throw err(`${cur.by || '다른 분'} 님이 방금 이 영상의 송폼 태그를 저장했어요. 「취소」 후 다시 열어 최신 태그에서 고쳐 주세요.`);
    const at = Date.now();
    const obj = { '영상ID': vid, '팀ID': team, '제목': title || cur.title, '태그': JSON.stringify(clean), '수정자': who, '수정시각': new Date(at).toISOString(), '저장시각값': at };
    if (row && !clean.length) await sheetsDb.deleteRow('유튜브송폼', row.__row);
    else if (row) await sheetsDb.updateRow('유튜브송폼', row.__row, obj);
    else if (clean.length) await sheetsDb.appendRow('유튜브송폼', obj);
    return { ok: true, vid, tags: clean, by: clean.length ? who : '', at: clean.length ? at : 0 };
  });
}

/* ---------------------------------------------------------------- 나만 보는 악보 */
function ownerOf(u) { return String((u && (u.email || u.name)) || '').trim(); }
function mineList(rows, team, room, owner) {
  return rows.filter((r) => r['팀ID'] === team && String(r['방'] || '') === room && String(r['주인'] || '') === owner && r['파일링크'])
    .map((r) => ({ id: liveStore.sheetIdOf(team, r['파일링크']), name: String(r['제목'] || '나만 보는 악보'), mine: true }));
}
async function mySheets(u, room) {
  room = String(room || ''); liveStore.scopeOfRoom(room);
  return { sheets: mineList(await sheetsDb.readAll('개인악보'), u.team, room, ownerOf(u)) };
}
async function mySheetAdd(u, room, fileName, dataUrl) {
  room = String(room || ''); liveStore.scopeOfRoom(room);
  const m = /^data:([a-zA-Z0-9.+\/-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw err('파일을 읽을 수 없습니다.');
  const mime = m[1].toLowerCase();
  if (mime !== 'application/pdf' && mime.indexOf('image/') !== 0) throw err('PDF 또는 사진 파일만 올릴 수 있습니다.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 20 * 1048576) throw err('파일은 20MB까지 올릴 수 있습니다.');
  const owner = ownerOf(u);
  if (mineList(await sheetsDb.readAll('개인악보', { fresh: true }), u.team, room, owner).length >= MINE_MAX) throw err(`이 예배에 나만 보는 악보는 ${MINE_MAX}개까지 올릴 수 있어요. 쓰지 않는 것을 지워 주세요.`);
  const safe = String(fileName || '악보.pdf').replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, 80) || '악보';
  const link = await driveStore.uploadPrivate('나만 보는 악보', { originalname: safe, mimetype: mime, buffer: buf });
  const name = safe.replace(/\.(pdf|png|jpe?g|webp|gif|heic)$/i, '') || '악보';
  await sheetsDb.appendRow('개인악보', { 'ID': 'M' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), '팀ID': u.team, '방': room, '제목': name, '파일링크': link, '주인': owner, '올린시각': new Date().toISOString() });
  const sheets = mineList(await sheetsDb.readAll('개인악보', { fresh: true }), u.team, room, owner);
  return { ok: true, sheet: { id: liveStore.sheetIdOf(u.team, link), name, mine: true }, sheets };
}
async function mySheetDel(u, room, fileId) {
  room = String(room || ''); fileId = String(fileId || '').trim();
  const owner = ownerOf(u);
  const rows = await sheetsDb.readAll('개인악보', { fresh: true });
  const hit = rows.find((r) => r['팀ID'] === u.team && String(r['방'] || '') === room && String(r['주인'] || '') === owner && liveStore.sheetIdOf(u.team, r['파일링크']) === fileId);
  if (!hit) throw err('내가 올린 나만 보는 악보만 지울 수 있어요.');
  await sheetsDb.deleteRow('개인악보', hit.__row);
  try { await driveStore.removeByLink(hit['파일링크']); } catch (e) { /* 이미 없으면 그대로 */ }
  return { ok: true, sheets: mineList(await sheetsDb.readAll('개인악보', { fresh: true }), u.team, room, owner) };
}
/** /sheet/<id> — 그 사람(ctx)의 나만 보는 악보 줄 (없으면 null) */
async function mineRowFor(ctx, id) {
  if (!ctx || !ctx.member) return null;
  const owners = [String(ctx.member['이메일'] || '').trim(), String(ctx.member['이름'] || '').trim()].filter(Boolean);
  const rows = await sheetsDb.readAll('개인악보');
  return rows.find((r) => (ctx.teams || []).includes(r['팀ID']) && owners.includes(String(r['주인'] || '')) && r['파일링크'] && liveStore.sheetIdOf(r['팀ID'], r['파일링크']) === id) || null;
}

module.exports = { get, save, cleanTags, mySheets, mySheetAdd, mySheetDel, mineRowFor, VID_RE };
