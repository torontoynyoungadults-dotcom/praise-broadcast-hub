/**
 * 머리말(헤더) · 자르기를 적용한 곡 악보 — 원본에서 언제든 다시 만들 수 있도록 "만든 방법"을 악보저장소.메모 에 남겨 둡니다.
 *   메모 = '헤더|{"s":원본 링크,"p":원본에서 쓴 쪽('' = 전부),"c":자르기("l,t,r,b;…",'' = 자동),"h":머리말 1|0,"g":머리말에 쓴 곡 정보 지문,"v":원본이 비공개면 1}'
 *   (예전 '나누기|<쪽>|<원본 링크>' — 곡별로 나누기 + 헤더 달기 — 도 읽음)
 *
 * 곡 정보(제목 · 원곡팀 · Key · BPM · 송폼)나 곡 순서(머리말의 번호)가 바뀌면 refresh() 가 지문이 달라진 악보만 머리말을 새로 만들고,
 * 새 파일로 바꿔 끼운 뒤 그 악보에 쓴 필기를 새 파일로 옮깁니다. (파일을 새로 만드는 까닭: 기기에 저장된 옛 악보(서비스 워커)가
 * 같은 주소로는 갱신되지 않기 때문)
 */
const crypto = require('crypto');
const sheetsDb = require('./sheetsDb');
const fileBytes = require('./fileBytes');
const driveStore = require('./driveStore');
const pkgPdf = require('./pkgPdf');
const sheetSearch = require('./sheetSearch');
const { PDFDocument } = require('pdf-lib');
const liveStore = require('./liveStore');
const pageSpec = require('./pageSpec');

const TAG = '헤더|', OLD_SPLIT = '나누기|';

/** 메모 → { src, spec, crop, header, sig } | null */
function parse(row) {
  const m = String((row && row['메모']) || '');
  if (m.indexOf(TAG) === 0) {
    try {
      const o = JSON.parse(m.slice(TAG.length));
      const src = String(o.s || '').trim();
      if (!src) return null;
      return { src, spec: pageSpec.cleanSpec(o.p || ''), crop: String(o.c || ''), header: !!o.h, sig: String(o.g || ''), priv: !!o.v, cont: !!o.n, pc: Number(o.k) || 0 };
    } catch (e) { return null; }
  }
  if (m.indexOf(OLD_SPLIT) === 0) {
    const rest = m.slice(OLD_SPLIT.length), i = rest.indexOf('|');
    if (i < 0) return null;
    const spec = pageSpec.cleanSpec(rest.slice(0, i)), src = rest.slice(i + 1).trim();
    return spec && src ? { src, spec, crop: '', header: true, sig: '', priv: false } : null;
  }
  return null;
}
function encode(o) {
  const v = { s: String(o.src || ''), p: String(o.spec || ''), c: String(o.crop || ''), h: o.header ? 1 : 0, g: String(o.sig || '') };
  if (o.pc) v.k = o.pc;                                      // 이 악보의 쪽 수 (콘티 전체 쪽 번호를 셀 때 다시 열어 보지 않게)
  if (o.cont) v.n = 1;                                       // 같은 곡의 두 번째 이후 악보 — 정식 머리말 없이 송폼만
  if (o.priv) v.v = 1;                                       // 원본을 비공개로 보관함 — 되돌릴 때 공개 사본을 만들어야 함
  return TAG + JSON.stringify(v);
}

/** 머리말에 들어가는 곡 정보 — 번호는 같은 구분(콘티 · 결단 · 폐회송) 안의 순서 */
function songInfo(scopeSongs, song) {
  const same = scopeSongs.filter((r) => r['구분'] === song['구분']).sort((a, b) => Number(a['순서'] || 0) - Number(b['순서'] || 0));
  return { kind: song['구분'], no: Math.max(1, same.findIndex((r) => r['ID'] === song['ID']) + 1), title: song['제목'], team: song['팀'], key: song['Key'], bpm: song['BPM'], form: song['송폼'], note: '' };
}
function sigOf(info) {
  const v = [info.kind, info.no, info.title, info.team, info.key, info.bpm, info.form, info.pageOffset, info.pageTotal].map((x) => String(x == null ? '' : x).trim());
  return crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
}

/** 같은 곡의 머리말 악보들 중 "맨 앞(올린 순서)" 한 개만 정식 머리말을 가짐 — row 는 지금 판단하는 악보 줄(없으면 새로 올릴 악보)
 *  songRows = 그 곡(곡ID)의 악보저장소 줄들 → 이 악보가 두 번째 이후면 true */
function isCont(songRows, row) {
  const heads = (songRows || []).filter((r) => { const h = parse(r); return h && h.header; }).map((r) => r.__row);
  if (row && row.__row) { heads.push(row.__row); return Math.min.apply(null, heads) !== row.__row; }
  return heads.length > 0;
}

/** 원본 바이트 + 만든 방법 → PDF (머리말이면 인쇄용 PDF 와 같은 곡 쪽, 아니면 자르기만). 실패하면 null */
async function render(info, buf, how) {
  const sheet = { buf, spec: how.spec || '', crop: how.crop || '' };
  return how.header ? pkgPdf.buildSongSheet(info, sheet, sheetSearch.imagesToPdf, { cont: !!how.cont }) : pkgPdf.buildCroppedSheet(sheet, sheetSearch.imagesToPdf);
}
const safeName = (t) => String(t || '악보').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || '악보';
async function uploadPdf(title, pdf) {
  return driveStore.uploadPublic('악보', { buffer: pdf, mimetype: 'application/pdf', originalname: safeName(title) + '.pdf', size: pdf.length });
}

/* ---------- 콘티 전체 기준 쪽 번호 — 곡 순서 → (곡 안) 악보 순서대로 쪽을 이어 셈 ---------- */
const pageCache = new Map();                                 // 링크 → 쪽 수
async function pagesOfLink(link) {
  if (pageCache.has(link)) return pageCache.get(link);
  let n = 1;
  try {
    const buf = await fileBytes.get(link);
    if (buf && buf.slice(0, 5).toString('latin1') === '%PDF-') n = (await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })).getPageCount() || 1;
  } catch (e) { /* 못 세면 1쪽으로 */ }
  pageCache.set(link, n);
  return n;
}
async function pagesOfRow(r) {
  const how = parse(r);
  if (how && how.pc) return how.pc;
  if (!how) { const sp = pageSpec.specPages(pageSpec.cleanSpec(r['쪽'] || '')); if (sp.length) return sp.length; }
  return pagesOfLink(r['파일링크']);
}
/** 이 예배의 곡별 악보들을 콘티 순서로 이어 세어 → { offsets: Map(줄번호 → 그 악보 앞의 쪽 수), total } */
async function pageLayout(songRows, sheetRows, team, scope) {
  const { conti, fin, closing } = liveStore.orderedSongs(songRows, team, scope);
  const files = sheetRows.filter((r) => r['팀ID'] === team && liveStore.inScope(r, scope) && r['곡ID'] && r['파일링크']);
  const offsets = new Map(); let at = 0;
  for (const song of conti.concat(fin).concat(closing)) {
    for (const r of files.filter((x) => x['곡ID'] === song['ID']).sort((a, b) => a.__row - b.__row)) { offsets.set(r.__row, at); at += await pagesOfRow(r); }
  }
  return { offsets, total: at };
}

/** 이 예배(scope)의 머리말 악보 중 곡 정보 · 번호가 바뀐 것만 다시 만듦 → 바꾼 개수 */
async function refresh(team, scope, notify) {
  const [songRows, sheetRows] = await Promise.all([sheetsDb.readAll('찬양콘티', { fresh: true }), sheetsDb.readAll('악보저장소', { fresh: true })]);
  const songs = songRows.filter((r) => r['팀ID'] === team && liveStore.inScope(r, scope));
  const byId = new Map(songs.map((r) => [r['ID'], r]));
  let changed = 0;
  let layout = { offsets: new Map(), total: 0 };
  try { layout = await pageLayout(songRows, sheetRows, team, scope); } catch (e) { console.error('[쪽 번호 세기 실패 — 번호 없이]', e.message); }
  for (const f of sheetRows.filter((r) => r['팀ID'] === team && liveStore.inScope(r, scope) && r['곡ID'] && r['파일링크'])) {
    const how = parse(f);
    if (!how || !how.header) continue;                      // 자르기만 한 악보는 곡 정보와 상관없음
    const song = byId.get(f['곡ID']);
    if (!song) continue;
    const info = songInfo(songs, song);
    if (layout.offsets.has(f.__row)) { info.pageOffset = layout.offsets.get(f.__row); info.pageTotal = layout.total; }
    const sig = sigOf(info);
    const cont = isCont(sheetRows.filter((r) => r['팀ID'] === team && r['곡ID'] === f['곡ID'] && liveStore.inScope(r, scope)), f);
    if (how.sig === sig && !!how.cont === cont) continue;
    how.cont = cont;
    try {
      const buf = await fileBytes.get(how.src);
      if (!buf) { console.error('[머리말 다시 만들기 — 원본을 받지 못함]', how.src); continue; }
      const pdf = await render(info, buf, how);
      if (!pdf) continue;
      try { how.pc = (await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false })).getPageCount(); } catch (e) { /* 쪽 수는 다음에 */ }
      const link = await uploadPdf(song['제목'] || f['제목'], pdf);
      if (how.pc) pageCache.set(link, how.pc);
      try {                                                 // 필기를 새 파일로 (쪽 모양이 같으니 그대로 맞음)
        await liveStore.loadAnnos();
        liveStore.copyAnnos(team, liveStore.sheetIdOf(team, f['파일링크']), liveStore.sheetIdOf(team, link));
      } catch (e) { console.error('[머리말 다시 만들기 — 필기 옮기기 실패]', e.message); }
      await sheetsDb.updateCells('악보저장소', [
        { row: f.__row, header: '파일링크', value: link },
        { row: f.__row, header: '메모', value: encode(Object.assign({}, how, { sig })) },
      ]);
      changed++;
    } catch (e) { console.error('[머리말 다시 만들기 실패]', f['제목'], e.message); }
  }
  if (changed && typeof notify === 'function') { try { notify(team, scope, 'saveSheetSplit'); } catch (e) { /* 알림은 덤 */ } }
  return changed;
}

/** 같은 예배의 refresh 는 하나씩 차례로 (동시에 두 번 만들지 않게) */
const chains = new Map();
function queue(team, scope, notify) {
  const key = team + '\u0001' + liveStore.roomOf(scope);
  const prev = chains.get(key) || Promise.resolve();
  const job = prev.catch(() => {}).then(() => refresh(team, scope, notify)).catch((e) => { console.error('[머리말 다시 만들기]', e.message); return 0; });
  chains.set(key, job);
  job.finally(() => { if (chains.get(key) === job) chains.delete(key); });
  return job;
}
/** 화면이 너무 오래 기다리지 않게 — ms 안에 끝나면 결과, 아니면 뒤에서 계속 만들고 null */
function settle(p, ms) {
  return Promise.race([p, new Promise((ok) => { const t = setTimeout(() => ok(null), ms); if (t.unref) t.unref(); })]);
}

module.exports = { parse, encode, songInfo, sigOf, isCont, render, uploadPdf, refresh, queue, settle, TAG };
