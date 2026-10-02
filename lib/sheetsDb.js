/**
 * 구글 시트를 DB처럼 쓰기 위한 아주 단순한 도우미.
 * - DB_FOLDER_ID 폴더 안에서 SPREADSHEET_TITLE 이름의 시트를 찾고, 없으면 만듭니다.
 * - SHEETS 에 정의된 탭이 없으면 만들고, 머리글(1행)이 비어 있으면 채웁니다.
 * - 읽기는 메모리에 캐시합니다 (구글 시트 API 는 분당 호출 한도가 있고 한 번에 0.3~1초 걸려서, 화면을 열 때마다 읽으면 느려집니다):
 *     · 20초 안: 그대로 사용
 *     · 20초 ~ 5분: 지난 값을 바로 보여 주고 뒤에서 새로 읽어 둠 (다음 화면부터 새 값)
 *     · 이 앱이 쓰기(추가 · 수정 · 삭제)를 하면 그 탭 캐시는 바로 비움 → 쓴 직후 화면은 늘 새 값
 *     · 같은 탭을 동시에 읽는 요청은 하나로 합침 · 읽기가 실패(한도 초과 · 네트워크)하면 10분 안의 지난 값으로 버팀
 *
 * 데이터 많아지면(수천 행) 더 정교한 캐시/배치 쓰기가 필요할 수 있지만,
 * 지금 단계(로그인/가입)에서는 이 정도로 충분합니다.
 */
const { sheetsApi, driveApi } = require('./googleAuth');
const { SPREADSHEET_TITLE, SHEETS } = require('./schema');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

let _spreadsheetId = null;
const _readCache = new Map(); // tab -> { at, rows }
const _gen = new Map();       // tab -> 쓰기로 비울 때마다 +1 (비우기 전에 시작한 읽기가 옛 값을 다시 채우지 않게)
const _inflight = new Map();  // tab#gen -> 읽는 중인 약속
const CACHE_MS = 20000;       // 이 안에서는 그대로
const SWR_MS = 5 * 60 * 1000; // 이 안에서는 지난 값을 바로 주고 뒤에서 새로 읽음
const STALE_MS = 10 * 60 * 1000; // 읽기가 실패하면 이 안의 지난 값으로 버팀

function folderId() {
  const id = String(process.env.DB_FOLDER_ID || '').trim();
  if (!id) throw new Error('DB_FOLDER_ID 환경변수가 필요합니다.');
  return id;
}

/** DB_FOLDER_ID 안에서 스프레드시트를 찾거나 만듭니다 (결과를 메모리에 기억) */
async function spreadsheetId() {
  if (_spreadsheetId) return _spreadsheetId;
  const drive = driveApi();
  const q = `'${folderId()}' in parents and mimeType='${SHEET_MIME}' and name='${SPREADSHEET_TITLE.replace(/'/g, "\\'")}' and trashed=false`;
  const found = await drive.files.list({ q, fields: 'files(id,name)', spaces: 'drive' });
  if (found.data.files && found.data.files.length) {
    _spreadsheetId = found.data.files[0].id;
    return _spreadsheetId;
  }
  const created = await drive.files.create({
    requestBody: { name: SPREADSHEET_TITLE, mimeType: SHEET_MIME, parents: [folderId()] },
    fields: 'id',
  });
  _spreadsheetId = created.data.id;
  return _spreadsheetId;
}

/** 1→A, 26→Z, 27→AA 식으로 열 번호를 시트 A1 표기 글자로 바꿉니다 */
function columnLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

let _ensuredTabs = null; // Set of tab titles known to exist with headers, this process lifetime
let _ensuring = null;     // 지금 확인 중인 작업 — 동시에 여러 요청이 와도 한 번만 (구글 읽기 한도: 분당 60회)

/** 구글 한도(429 · 일시 오류)에 걸리면 잠깐 쉬었다가 다시 — 읽기/쓰기 호출을 감쌈 */
async function withRetry(fn, tries) {
  let wait = 1500;
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const code = e && (e.code || (e.response && e.response.status));
      const quota = code === 429 || /quota|rate ?limit|Read requests/i.test(String(e && e.message));
      if (i >= (tries || 3) || !(quota || code === 503)) throw e;
      await new Promise((r) => setTimeout(r, wait + Math.random() * 500)); wait *= 2;
    }
  }
}

async function ensureTabs() {
  if (_ensuredTabs) return _ensuredTabs;
  if (!_ensuring) _ensuring = doEnsureTabs().finally(() => { _ensuring = null; });
  return _ensuring;
}
async function doEnsureTabs() {
  const id = await spreadsheetId();
  const sheets = sheetsApi();
  const meta = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' }));
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const toAdd = Object.keys(SHEETS).filter((t) => !existing.has(t));
  if (toAdd.length) {
    await withRetry(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: toAdd.map((title) => ({ addSheet: { properties: { title } } })) },
    }));
  }
  // 첫 행(머리글)이 비어 있으면 채웁니다 — 모든 탭의 첫 행을 한 번의 요청(batchGet)으로 읽음 (예전: 탭마다 한 번씩 → 시작할 때마다 읽기 30회)
  const titles = Object.keys(SHEETS);
  const got = await withRetry(() => sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges: titles.map((t) => `'${t}'!1:1`) }));
  const firstRows = (got.data.valueRanges || []).map((vr) => (vr.values && vr.values[0]) || []);
  const writes = [];
  titles.forEach((title, i) => {
    const headers = SHEETS[title], have = firstRows[i] || [];
    if (!have.length) writes.push({ range: `'${title}'!A1`, values: [headers] });
    else if (have.length < headers.length) {
      // 기능이 느니 스키마에 칸이 늘어난 경우 — 기존 머리글/데이터 자리는 그대로 두고 새 칸만 뒤에 이어붙입니다.
      writes.push({ range: `'${title}'!${columnLetter(have.length + 1)}1`, values: [headers.slice(have.length)] });
    }
  });
  if (writes.length) await withRetry(() => sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: writes } }));
  _ensuredTabs = existing;
  return _ensuredTabs;
}

function rowsToObjects(headers, values) {
  return (values || []).map((row, i) => {
    const o = {}; headers.forEach((h, c) => { o[h] = row[c] === undefined ? '' : row[c]; });
    o.__row = i + 2; // 실제 시트의 행 번호 (헤더가 1행이므로 데이터는 2행부터)
    return o;
  });
}

/** 탭 전체를 시트에서 새로 읽어 캐시에 채움 (같은 탭 동시 읽기는 하나로) */
function load(tab) {
  const g = _gen.get(tab) || 0, key = tab + '#' + g;
  let p = _inflight.get(key);
  if (p) return p;
  p = (async () => {
    const headers = SHEETS[tab];
    const id = await spreadsheetId();
    const res = await withRetry(() => sheetsApi().spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A2:Z`, valueRenderOption: 'UNFORMATTED_VALUE' }), 2);
    const rows = rowsToObjects(headers, res.data.values || []);
    if ((_gen.get(tab) || 0) === g) _readCache.set(tab, { at: Date.now(), rows });   // 읽는 사이 쓰기가 있었으면 캐시에 넣지 않음
    return rows;
  })();
  _inflight.set(key, p);
  const done = () => { if (_inflight.get(key) === p) _inflight.delete(key); };
  p.then(done, done);
  return p;
}

/** 탭 전체를 읽어 {header: value} 객체 배열로 돌려줍니다 (fresh: true 면 캐시를 건너뜀 — 읽고 바로 고칠 때) */
async function readAll(tab, { fresh } = {}) {
  const headers = SHEETS[tab];
  if (!headers) throw new Error('알 수 없는 탭: ' + tab);
  await ensureTabs();
  const hit = _readCache.get(tab), age = hit ? Date.now() - hit.at : Infinity;
  if (!fresh && hit && age < CACHE_MS) return hit.rows;
  if (!fresh && hit && age < SWR_MS) {                       // 지난 값을 바로 주고, 뒤에서 새로 읽어 둠
    load(tab).catch((e) => console.error('[시트 새로 읽기 실패 — 지난 값 유지]', tab, e && e.message));
    return hit.rows;
  }
  try { return await load(tab); }
  catch (e) {
    if (hit && age < STALE_MS) { console.error('[시트 읽기 실패 — 지난 값으로 버팀]', tab, e && e.message); return hit.rows; }
    throw e;
  }
}

function invalidate(tab) { _readCache.delete(tab); _gen.set(tab, (_gen.get(tab) || 0) + 1); }

/** 새 행을 맨 아래에 추가합니다. obj에 없는 칸은 빈 문자열. */
async function appendRow(tab, obj) {
  const headers = SHEETS[tab];
  if (!headers) throw new Error('알 수 없는 탭: ' + tab);
  await ensureTabs();
  const id = await spreadsheetId();
  const row = headers.map((h) => (obj[h] === undefined || obj[h] === null) ? '' : obj[h]);
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: id, range: `'${tab}'!A:A`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  invalidate(tab);
  return row;
}

/** 여러 행을 한 번에 맨 아래에 추가합니다 (요청 한 번 — 가져오기처럼 수백 줄을 넣을 때) */
async function appendRows(tab, objs) {
  const headers = SHEETS[tab];
  if (!headers) throw new Error('알 수 없는 탭: ' + tab);
  if (!objs || !objs.length) return 0;
  await ensureTabs();
  const id = await spreadsheetId();
  const values = objs.map((obj) => headers.map((h) => (obj[h] === undefined || obj[h] === null) ? '' : obj[h]));
  for (let i = 0; i < values.length; i += 500) {
    await sheetsApi().spreadsheets.values.append({
      spreadsheetId: id, range: `'${tab}'!A:A`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: values.slice(i, i + 500) },
    });
  }
  invalidate(tab);
  return values.length;
}

/** __row(시트의 실제 행 번호)를 기준으로 한 행 전체를 obj 내용으로 덮어씁니다 */
async function updateRow(tab, rowNumber, obj) {
  const headers = SHEETS[tab];
  if (!headers) throw new Error('알 수 없는 탭: ' + tab);
  const id = await spreadsheetId();
  const row = headers.map((h) => (obj[h] === undefined || obj[h] === null) ? '' : obj[h]);
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: id, range: `'${tab}'!A${rowNumber}`, valueInputOption: 'RAW', requestBody: { values: [row] },
  });
  invalidate(tab);
}

/** 한 칸 값으로 한 행을 찾습니다 (못 찾으면 null) */
async function findOne(tab, column, value) {
  const rows = await readAll(tab);
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return rows.find((r) => String(r[column] || '').trim().toLowerCase() === v) || null;
}

/** 여러 칸을 조합해서 찾아야 할 때(예: 팀+날짜) — predicate(row) => boolean */
async function findWhere(tab, predicate, opts) {
  const rows = await readAll(tab, opts);
  return rows.find(predicate) || null;
}

let _sheetIdByTitle = null;
async function sheetGidFor(tab) {
  if (_sheetIdByTitle && _sheetIdByTitle.has(tab)) return _sheetIdByTitle.get(tab);
  await ensureTabs();
  const id = await spreadsheetId();
  const meta = await sheetsApi().spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' });
  _sheetIdByTitle = new Map((meta.data.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
  return _sheetIdByTitle.get(tab);
}

/** __row(시트의 실제 행 번호) 한 줄을 통째로 지웁니다. */
async function deleteRow(tab, rowNumber) {
  if (!SHEETS[tab]) throw new Error('알 수 없는 탭: ' + tab);
  const id = await spreadsheetId();
  const sheetId = await sheetGidFor(tab);
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } } }] },
  });
  invalidate(tab);
}

/** 여러 줄을 한 번에 지웁니다 (요청 한 번 · 아래 줄부터 지워서 번호가 밀리지 않게) */
async function deleteRows(tab, rowNumbers) {
  if (!SHEETS[tab]) throw new Error('알 수 없는 탭: ' + tab);
  const nums = Array.from(new Set((rowNumbers || []).map(Number).filter((n) => n >= 2))).sort((a, b) => b - a);
  if (!nums.length) return 0;
  const id = await spreadsheetId();
  const sheetId = await sheetGidFor(tab);
  const requests = nums.map((n) => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } }));
  for (let i = 0; i < requests.length; i += 200) {
    await sheetsApi().spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: requests.slice(i, i + 200) } });
  }
  invalidate(tab);
  return nums.length;
}

/** '설정' 탭에서 키로 값을 읽습니다. 없으면 fallback. */
async function getSetting(key, fallback) {
  const row = await findOne('설정', '키', key);
  return row ? row['값'] : fallback;
}

module.exports = { spreadsheetId, ensureTabs, readAll, appendRow, appendRows, updateRow, deleteRows, findOne, findWhere, deleteRow, invalidate, folderId, getSetting };
