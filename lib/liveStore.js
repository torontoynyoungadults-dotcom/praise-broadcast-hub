/**
 * 라이브 악보 저장소 — church-app(yntoronto.2026 v6) 의 logic/worship2.js(필기) · logic/worship4.js(연습 설정 · 곡 정보)를
 * 이 앱의 구글 시트 DB(lib/sheetsDb)에 맞게 옮긴 것입니다. 규칙(값 정리 · 한도 · 층 · 범위)은 church-app 과 똑같습니다.
 *
 * ▣ 필기 ('찬양주석' 탭)
 *    lib/realtime.js(church-app 그대로)는 필기를 "동기"로 읽고 씁니다 (church-app 의 시트 도구가 동기라서).
 *    이 앱의 시트 도구는 비동기라서, 서버가 켜질 때 탭 전체를 메모리에 올려 두고(ready) 거기서 바로 읽고,
 *    쓰기는 메모리를 먼저 바꾼 뒤 층(팀 · 파일 · 범위 · 소유)마다 한 줄로 세워 시트에 차례로 저장합니다.
 *    저장이 실패하면 30초 뒤 다시 시도하고, 서버가 꺼질 때는 drain() 으로 남은 저장을 기다립니다.
 *    한 층 = 여러 줄(순번) — 시트 한 칸 5만 글자 한도 때문에 40000 글자씩 나눕니다. 줄은 지우지 않고(행 번호가 밀리지 않게) 비워서 재사용합니다.
 *
 * ▣ 예전 필기 ('악보필기' 탭) — 읽기 전용으로 옮겨 보여주기
 *    예전 연습 화면은 "한 사람 · 한 악보(악보저장소 행 번호)" 에 {tool, color, page, points:[[x,y]…]} 목록을 저장했습니다.
 *    새 형식에 아직 아무것도 없는 악보를 처음 열 때만, 예전 필기를 새 형식(펜 · 형광펜)으로 바꿔서 보여줍니다
 *    (공개 → 팀 층, 나만 보기 → 그 사람 층). 누군가 그 층을 고치면 그때부터 새 형식으로 저장됩니다. 예전 행은 그대로 둡니다.
 *
 * ▣ 연습 설정 ('연습설정' 탭) · 곡 목록 · 곡 정보 고치기 ('찬양콘티' 탭)
 */
const crypto = require('crypto');
const sheetsDb = require('./sheetsDb');

const ROOM_RE = /^(\d{4}-\d{2}-\d{2}|ev-[0-9a-z]{6,}(~[0-9a-z]{1,10})?)$/i;
const FILE_RE = /^[A-Za-z0-9_-]{10,}$/;
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CHUNK = 40000;          // church-app 주석칸한도_
const ITEM_MAX = 4000;        // church-app 주석항목한도_
const CFG_VALUE_MAX = 6000;   // church-app 연습설정값한도_
const CFG_COUNT_MAX = 800;    // church-app 연습설정개수한도_
const RETRY_MS = 30000;

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ================================================================ 악보 파일 ID
 * church-app 은 드라이브 파일 ID 를 악보 ID 로 씁니다 (/sheet/<id>, 필기 열쇠). 이 앱의 악보는 '파일링크'(주소)로 저장돼 있어서:
 *   · 드라이브 주소면 그 안의 파일 ID
 *   · 다른 주소면 'u' + (팀 · 주소) 해시 24글자 — 늘 같은 값이라 필기가 그 악보에 계속 붙습니다. */
function driveIdOf(link) {
  const s = String(link || '');
  if (!/^https?:\/\/([a-z0-9-]+\.)*(google\.com|googleusercontent\.com)\//i.test(s)) return '';
  const m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : '';
}
function sheetIdOf(team, link) {
  const d = driveIdOf(link);
  if (d) return d;
  return 'u' + crypto.createHash('sha256').update(String(team) + '\n' + String(link || '')).digest('hex').slice(0, 24);
}

/** 곡별로 저장해 둔 악보(원본 파일 + 쪽 범위)를 열 주소 — 쪽 범위가 있으면 그 곡 쪽만 담은 PDF(/sheet/<id>/part), 없으면 원본 주소 그대로 */
function openHref(team, link, spec, name) {
  const sp = String(spec || '').trim();
  if (!sp || !link) return String(link || '');
  return '/sheet/' + sheetIdOf(team, link) + '/part?p=' + encodeURIComponent(sp) + (name ? '&n=' + encodeURIComponent(String(name).slice(0, 80)) : '');
}

/* ================================================================ 예배키(방) ↔ 이 앱의 범위
 *   'YYYY-MM-DD'   → 그 날짜의 보통 주일예배 (행사ID 비어 있음)
 *   'ev-<행사ID>'  → 그 행사 (주일 외 찬양.ID) */
function roomOf(scope) { return scope && scope.event ? 'ev-' + scope.event : String((scope && scope.date) || ''); }
function scopeOfRoom(room) {
  room = String(room || '').trim();
  if (!ROOM_RE.test(room)) throw new Error('예배(날짜)를 확인해주세요.');
  if (/^ev-/i.test(room)) return { event: room.slice(3).replace(/~.*$/, ''), date: '' };
  return { event: '', date: room };
}
function inScope(row, scope) {
  return scope.event ? row['행사ID'] === scope.event : (!row['행사ID'] && row['날짜'] === scope.date);
}

/* ================================================================ 필기 (메모리 + 시트) */
const A = { ready: false, loading: null, map: new Map(), legacy: new Map(), err: '' };
const K = (team, file, scope, owner) => [team || '', file, scope, owner].join('\u0001');

async function loadAnnos() {
  if (A.loading) return A.loading;
  A.loading = (async () => {
    try {
      const [rows, oldRows, sheetRows] = await Promise.all([
        sheetsDb.readAll('찬양주석', { fresh: true }),
        sheetsDb.readAll('악보필기').catch(() => []),
        sheetsDb.readAll('악보저장소').catch(() => []),
      ]);
      const groups = new Map();
      rows.forEach((r) => {
        const k = K(String(r['팀ID'] || ''), String(r['파일ID'] || '').trim(), String(r['범위'] || '').trim(), String(r['소유'] || '').trim());
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ row: r.__row, n: Number(r['순번']) || 0, s: String(r['내용'] || '') });
      });
      A.map = new Map();
      groups.forEach((parts, k) => {
        parts.sort((a, b) => a.n - b.n);
        A.map.set(k, { json: parts.map((p) => p.s).join(''), rows: parts.map((p) => p.row), dirty: false, chain: null, retry: null });
      });
      A.legacy = buildLegacy(oldRows, sheetRows);
      A.ready = true; A.err = '';
    } catch (e) {
      A.err = (e && e.message) || String(e);
      A.loading = null;               // 다음 요청 때 다시 시도
      throw e;
    }
  })();
  return A.loading;
}

/** 예전 필기 → { 팀|파일 → { team:[items], mine:{ 이름:[items] } } } */
function buildLegacy(oldRows, sheetRows) {
  const out = new Map();
  if (!oldRows || !oldRows.length) return out;
  const fileByOldId = new Map();       // 팀|악보저장소 행번호 → 새 파일 ID
  (sheetRows || []).forEach((s) => fileByOldId.set(s['팀ID'] + '\u0001' + String(s.__row), sheetIdOf(s['팀ID'], s['파일링크'])));
  oldRows.forEach((r) => {
    const file = fileByOldId.get(r['팀ID'] + '\u0001' + String(r['악보ID']));
    if (!file) return;
    let strokes = [];
    try { strokes = JSON.parse(r['필기'] || '[]'); } catch (e) { strokes = []; }
    if (!Array.isArray(strokes) || !strokes.length) return;
    const by = String(r['작성자'] || '');
    const ts = Date.parse(r['수정시각']) || 0;
    const items = [];
    strokes.forEach((st, i) => {
      if (!st || (st.tool !== 'pen' && st.tool !== 'hl') || !Array.isArray(st.points) || st.points.length < 2) return;   // 예전 지우개 획은 새 형식에 대응이 없어 옮기지 않음
      const p = [];
      st.points.forEach((pt) => {
        const x = Array.isArray(pt) ? pt[0] : pt && pt.x, y = Array.isArray(pt) ? pt[1] : pt && pt.y;
        if (Number.isFinite(+x) && Number.isFinite(+y)) p.push(Math.round(Math.min(1, Math.max(0, +x)) * 10000) / 10000, Math.round(Math.min(1, Math.max(0, +y)) * 10000) / 10000);
      });
      if (p.length < 4) return;
      const id = 'lg' + crypto.createHash('sha1').update(r['ID'] + ':' + i).digest('hex').slice(0, 16);
      items.push({ id, t: st.tool, pg: Math.max(1, Math.round(Number(st.page) || 1)), c: COLOR_RE.test(String(st.color || '')) ? String(st.color).toLowerCase() : '#ff5a1f', w: st.tool === 'hl' ? 0.02 : 0.003, p, by, ts });
    });
    if (!items.length) return;
    const k = r['팀ID'] + '\u0001' + file;
    if (!out.has(k)) out.set(k, { team: [], mine: {} });
    const g = out.get(k);
    if (String(r['공개']).toUpperCase() === 'FALSE') (g.mine[by] = g.mine[by] || []).push(...items);
    else g.team.push(...items);
  });
  return out;
}

function needReady() {
  if (!A.ready && !A.loading) loadAnnos().catch(() => { /* 다음 요청 때 다시 */ });
  if (!A.ready) throw new Error('필기 저장소를 준비하는 중입니다. 잠시 후 다시 열어주세요.' + (A.err ? ' (' + A.err + ')' : ''));
}
function cleanFile(file) { file = String(file || '').trim(); if (!FILE_RE.test(file)) throw new Error('악보 파일을 확인해주세요.'); return file; }
function cleanScope(scope) { scope = String(scope || 'song').trim(); if (scope === 'song' || ROOM_RE.test(scope)) return scope; throw new Error('예배(날짜)를 확인해주세요.'); }

/** 한 층의 필기 목록 (동기 — lib/realtime.js 의 loadAnno) */
function readLayer(team, file, scope, owner) {
  needReady();
  file = cleanFile(file); scope = cleanScope(scope); owner = String(owner || '*');
  const ent = A.map.get(K(team, file, scope, owner));
  if (ent) {
    if (!ent.json) return [];
    let list = [];
    try { list = JSON.parse(ent.json); } catch (e) { list = []; }
    return Array.isArray(list) ? list.slice(0, ITEM_MAX) : [];
  }
  if (scope === 'song') {                                   // 새 형식으로 저장된 적 없는 악보 — 예전 필기를 보여줌
    const g = A.legacy.get((team || '') + '\u0001' + file);
    if (g) return (owner === '*' ? g.team : (g.mine[owner] || [])).slice(0, ITEM_MAX).map((it) => Object.assign({}, it));
  }
  return [];
}

/** 한 층을 통째로 바꿔 저장 (동기로 메모리를 바꾸고, 시트 저장은 뒤에서 차례로) — lib/realtime.js 의 saveAnno */
function writeLayer(team, file, scope, owner, items, by) {
  needReady();
  file = cleanFile(file); scope = cleanScope(scope); owner = String(owner || '*');
  items = (Array.isArray(items) ? items : []).slice(0, ITEM_MAX);
  const k = K(team, file, scope, owner);
  let ent = A.map.get(k);
  if (!ent) { ent = { json: '', rows: [], dirty: false, chain: null, retry: null }; A.map.set(k, ent); }
  ent.json = items.length ? JSON.stringify(items) : '';
  ent.by = String(by || '');
  ent.meta = { team: team || '', file, scope, owner };
  ent.dirty = true;
  schedule(ent);
  return Math.ceil(ent.json.length / CHUNK);
}

function schedule(ent) {
  if (ent.chain) return;                                    // 지금 저장 중 — 끝나면 dirty 를 보고 한 번 더
  if (ent.retry) { clearTimeout(ent.retry); ent.retry = null; }
  ent.chain = (async () => {
    while (ent.dirty) {
      ent.dirty = false;
      try { await persist(ent); } catch (e) {
        ent.dirty = true;
        console.error('[찬양주석 저장 실패 — 30초 뒤 다시]', ent.meta && ent.meta.file, (e && e.message) || e);
        ent.chain = null;
        ent.retry = setTimeout(() => { ent.retry = null; schedule(ent); }, RETRY_MS);
        if (ent.retry.unref) ent.retry.unref();
        return;
      }
    }
    ent.chain = null;
  })();
}

async function persist(ent) {
  const { team, file, scope, owner } = ent.meta;
  const json = ent.json, now = stamp(), by = ent.by;
  const chunks = [];
  for (let i = 0; i * CHUNK < json.length; i++) chunks.push(json.slice(i * CHUNK, (i + 1) * CHUNK));
  const row = (n, s) => ({ '파일ID': file, '범위': scope, '소유': owner, '순번': n, '내용': s, '수정시각': now, '수정자': by, '팀ID': team });
  let appended = false;
  for (let i = 0; i < Math.max(chunks.length, ent.rows.length); i++) {
    const s = i < chunks.length ? chunks[i] : '';
    if (i < ent.rows.length) await sheetsDb.updateRow('찬양주석', ent.rows[i], row(i, s));
    else { await sheetsDb.appendRow('찬양주석', row(i, s)); appended = true; }
  }
  if (appended) {                                           // 새로 붙인 줄의 행 번호를 알아 둡니다 (다음 저장 때 그 줄을 고치도록)
    const all = await sheetsDb.readAll('찬양주석', { fresh: true });
    ent.rows = all.filter((r) => String(r['팀ID'] || '') === team && String(r['파일ID']).trim() === file && String(r['범위']).trim() === scope && String(r['소유']).trim() === owner)
      .sort((a, b) => (Number(a['순번']) || 0) - (Number(b['순번']) || 0)).map((r) => r.__row);
  }
}

/** 남은 저장을 기다립니다 (서버가 꺼지기 전) */
async function drain(timeoutMs) {
  const until = Date.now() + (timeoutMs || 8000);
  while (Date.now() < until) {
    const busy = Array.from(A.map.values()).filter((e) => e.chain || e.dirty || e.retry);
    if (!busy.length) return true;
    busy.forEach((e) => { if (e.retry) { clearTimeout(e.retry); e.retry = null; schedule(e); } });
    await Promise.race([Promise.all(busy.map((e) => e.chain).filter(Boolean)), new Promise((r) => setTimeout(r, 250))]);
  }
  return false;
}
function pendingWrites() { return Array.from(A.map.values()).filter((e) => e.chain || e.dirty || e.retry).length; }

/* ================================================================ 연습 설정 — church-app logic/worship4.js 그대로 */
function cfgRoom(room) { room = String(room || '').trim(); if (!ROOM_RE.test(room)) throw new Error('예배(날짜)를 확인해주세요.'); return room; }
function cfgKey(kind, key) {
  key = String(key == null ? '' : key).replace(/[\u0000-\u001f]/g, '').trim();
  if (kind === 'map') { if (!FILE_RE.test(key)) throw new Error('악보 파일을 확인해주세요.'); }
  else if (kind === 'follow') { if (key !== 'sync') throw new Error('설정 이름을 확인해주세요.'); }
  else if (!key || key.length > 80) throw new Error('곡 이름을 확인해주세요.');
  return key;
}
function int(v, lo, hi, fallback) { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback; }
function cfgValue(kind, value) {
  if (value == null) return null;
  if (kind === 'map') {
    const m = {}; let n = 0;
    Object.keys(value || {}).forEach((k) => {
      const pg = Math.round(Number(k));
      if (!(pg >= 1 && pg <= 500) || n >= 300) return;
      const v = Math.round(Number(value[k]));
      if (!Number.isFinite(v) || v < 0 || v > 199) return;
      m[pg] = v; n++;
    });
    return n ? m : null;
  }
  if (kind === 'metro') {
    const o = {}; let any = false;
    if (value.num != null) { o.num = int(value.num, 1, 16, 4); any = true; }
    if (value.den != null) { const d = int(value.den, 2, 16, 4); o.den = [2, 4, 8, 16].indexOf(d) >= 0 ? d : 4; any = true; }
    if (Array.isArray(value.marks)) { o.marks = value.marks.slice(0, 16).map((x) => int(x, 0, 2, 0)); any = true; }
    if (value.count != null) { o.count = int(value.count, 0, 4, 0); any = true; }
    if (value.bpm != null && String(value.bpm) !== '') { o.bpm = int(value.bpm, 30, 300, 72); any = true; }
    return any ? o : null;
  }
  if (kind === 'follow') {
    return { page: value.page !== false && value.page !== 0 && value.page !== '0', metro: value.metro !== false && value.metro !== 0 && value.metro !== '0' };
  }
  if (kind === 'song') {
    const s = {}; let has = false;
    if (value.bpm != null) { s.bpm = String(value.bpm).replace(/[^0-9]/g, '').slice(0, 3); has = true; }
    if (value.form != null) { s.form = String(value.form).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120); has = true; }
    if (value.link != null) { s.link = String(value.link).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 300); has = true; }
    return has ? s : null;
  }
  throw new Error('설정 종류를 확인해주세요.');
}
async function cfgRead(team, room, owner) {
  room = cfgRoom(room); owner = String(owner || '*');
  const out = [];
  (await sheetsDb.readAll('연습설정')).forEach((r) => {
    if (String(r['팀ID'] || '') !== team || String(r['방']).trim() !== room || String(r['소유']).trim() !== owner) return;
    let v = null;
    try { v = JSON.parse(String(r['내용'] || 'null')); } catch (e) { v = null; }
    if (v == null) return;
    out.push({ kind: String(r['종류']).trim(), key: String(r['열쇠']).trim(), value: v, by: String(r['수정자'] || ''), ts: String(r['수정시각'] || '') });
  });
  return out;
}
const cfgChains = new Map();    // 같은 방의 저장은 한 줄로 (같은 열쇠를 두 번 새로 만들지 않게)
async function cfgSave(team, room, owner, kind, key, value, by) {
  room = cfgRoom(room); owner = String(owner || '*');
  if (['map', 'metro', 'song', 'follow'].indexOf(kind) < 0) throw new Error('설정 종류를 확인해주세요.');
  key = cfgKey(kind, key);
  const clean = cfgValue(kind, value);
  const json = clean == null ? '' : JSON.stringify(clean);
  if (json.length > CFG_VALUE_MAX) throw new Error('설정이 너무 큽니다.');
  const lockKey = team + '\u0001' + room;
  const prev = cfgChains.get(lockKey) || Promise.resolve();
  const job = prev.catch(() => {}).then(async () => {
    const rows = (await sheetsDb.readAll('연습설정', { fresh: true })).filter((r) => String(r['팀ID'] || '') === team && String(r['방']).trim() === room);
    const hit = rows.find((r) => String(r['종류']).trim() === kind && String(r['열쇠']).trim() === key && String(r['소유']).trim() === owner);
    if (clean != null && !hit && rows.filter((r) => String(r['내용'] || '')).length >= CFG_COUNT_MAX) throw new Error('이 예배에 저장된 설정이 너무 많습니다.');
    const obj = { '방': room, '종류': kind, '열쇠': key, '소유': owner, '내용': json, '수정시각': stamp(), '수정자': String(by || ''), '팀ID': team };
    if (hit) await sheetsDb.updateRow('연습설정', hit.__row, obj);          // 지우기 = 내용을 비움 (행 번호가 밀리지 않게)
    else if (clean != null) await sheetsDb.appendRow('연습설정', obj);
  });
  cfgChains.set(lockKey, job);
  try { await job; } finally { if (cfgChains.get(lockKey) === job) cfgChains.delete(lockKey); }
  return clean;
}

/* ================================================================ 곡 목록 · 곡 정보 */
/** 콘티 · 결단 · 폐회송 곡을 콘티 화면과 같은 순서로. seq = 그 구분 안에서 1부터의 자리 (church-app 의 순번 자리) */
function orderedSongs(rows, team, scope) {
  const mine = rows.filter((r) => r['팀ID'] === team && inScope(r, scope));
  const sort = (a, b) => (Number(a['순서'] || 0) - Number(b['순서'] || 0)) || String(a['만든시각'] || '').localeCompare(String(b['만든시각'] || '')) || String(a['ID'] || '').localeCompare(String(b['ID'] || ''));
  const conti = mine.filter((r) => r['구분'] !== '결단' && r['구분'] !== '폐회송').sort(sort);
  const fin = mine.filter((r) => r['구분'] === '결단').sort(sort);
  const closing = mine.filter((r) => r['구분'] === '폐회송').sort(sort);
  return { conti, fin, closing };
}
function songView(r, kind, seq) {
  return { title: String(r['제목'] || ''), key: String(r['Key'] || ''), bpm: String(r['BPM'] || ''), form: String(r['송폼'] || ''), team: String(r['팀'] || ''), link: String(r['유튜브'] || ''), seq, kind };
}
async function songsOf(team, room) {
  const scope = scopeOfRoom(room);
  const { conti, fin, closing } = orderedSongs(await sheetsDb.readAll('찬양콘티'), team, scope);
  return conti.map((r, i) => songView(r, '콘티', i + 1)).concat(fin.map((r, i) => songView(r, '결단', i + 1))).concat(closing.map((r, i) => songView(r, '폐회송', i + 1)));
}
const songChains = new Map();
async function songPatch(team, room, kind, seq, patch) {
  const scope = scopeOfRoom(room);
  kind = kind === '결단' ? '결단' : kind === '폐회송' ? '폐회송' : '콘티';
  seq = Number(seq) || 0;
  patch = patch || {};
  const clean = {};
  if (patch.bpm != null) {
    const b = String(patch.bpm).replace(/[^0-9]/g, '').slice(0, 3);
    if (b && (Number(b) < 30 || Number(b) > 300)) throw new Error('BPM 은 30 ~ 300 사이로 넣어주세요.');
    clean.bpm = b;
  }
  if (patch.form != null) clean.form = String(patch.form).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
  if (patch.link != null) {
    const l = String(patch.link).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 300);
    if (l && !/^https?:\/\//i.test(l)) throw new Error('링크는 http 로 시작하는 주소여야 합니다.');
    clean.link = l;
  }
  if (!Object.keys(clean).length) throw new Error('바꿀 내용이 없습니다.');
  const lockKey = team + '\u0001' + room;
  const prev = songChains.get(lockKey) || Promise.resolve();
  const job = prev.catch(() => {}).then(async () => {
    const { conti, fin, closing } = orderedSongs(await sheetsDb.readAll('찬양콘티', { fresh: true }), team, scope);
    const row = (kind === '결단' ? fin : kind === '폐회송' ? closing : conti)[seq - 1];
    if (!row) throw new Error('곡을 찾지 못했습니다. 화면을 새로 열어주세요.');
    const next = Object.assign({}, row);
    if (clean.bpm != null) next['BPM'] = clean.bpm;
    if (clean.form != null) next['송폼'] = clean.form;
    if (clean.link != null) next['유튜브'] = clean.link;
    delete next.__row;
    await sheetsDb.updateRow('찬양콘티', row.__row, next);
    return { seq, kind, title: String(next['제목'] || ''), bpm: String(next['BPM'] || ''), form: String(next['송폼'] || ''), link: String(next['유튜브'] || '') };
  });
  songChains.set(lockKey, job);
  try { return { song: await job, patch: clean }; } finally { if (songChains.get(lockKey) === job) songChains.delete(lockKey); }
}

module.exports = {
  ROOM_RE, FILE_RE, ID_RE,
  driveIdOf, sheetIdOf, openHref, roomOf, scopeOfRoom, inScope,
  loadAnnos, readLayer, writeLayer, drain, pendingWrites, isReady: () => A.ready,
  cfgRead, cfgSave, songsOf, songPatch, orderedSongs,
  _internals: { A, buildLegacy, cfgValue, cfgKey, CHUNK },
};
