/**
 * 구글 시트를 DB처럼 쓰기 위한 아주 단순한 도우미.
 * - DB_FOLDER_ID 폴더 안에서 SPREADSHEET_TITLE 이름의 시트를 찾고, 없으면 만듭니다.
 * - SHEETS 에 정의된 탭이 없으면 만들고, 머리글(1행)이 비어 있으면 채웁니다.
 * - 짧은 시간(5초) 안의 반복 읽기는 메모리에 캐시해 둡니다 (여러 요청이 겹칠 때 API 호출을 아낌).
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
const CACHE_MS = 5000;

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

let _ensuredTabs = null; // Set of tab titles known to exist with headers, this process lifetime
async function ensureTabs() {
  if (_ensuredTabs) return _ensuredTabs;
  const id = await spreadsheetId();
  const sheets = sheetsApi();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const toAdd = Object.keys(SHEETS).filter((t) => !existing.has(t));
  if (toAdd.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: toAdd.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }
  // 첫 행(머리글)이 비어 있으면 채웁니다
  for (const title of Object.keys(SHEETS)) {
    const headers = SHEETS[title];
    const row1 = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${title}'!1:1` });
    const have = (row1.data.values && row1.data.values[0]) || [];
    if (!have.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id, range: `'${title}'!A1`, valueInputOption: 'RAW', requestBody: { values: [headers] },
      });
    }
  }
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

/** 탭 전체를 읽어 {header: value} 객체 배열로 돌려줍니다 */
async function readAll(tab, { fresh } = {}) {
  const headers = SHEETS[tab];
  if (!headers) throw new Error('알 수 없는 탭: ' + tab);
  await ensureTabs();
  const hit = _readCache.get(tab);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const id = await spreadsheetId();
  const res = await sheetsApi().spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A2:Z`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rows = rowsToObjects(headers, res.data.values || []);
  _readCache.set(tab, { at: Date.now(), rows });
  return rows;
}

function invalidate(tab) { _readCache.delete(tab); }

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

/** '설정' 탭에서 키로 값을 읽습니다. 없으면 fallback. */
async function getSetting(key, fallback) {
  const row = await findOne('설정', '키', key);
  return row ? row['값'] : fallback;
}

module.exports = { spreadsheetId, ensureTabs, readAll, appendRow, updateRow, findOne, invalidate, folderId, getSetting };
