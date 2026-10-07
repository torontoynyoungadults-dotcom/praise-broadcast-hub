/**
 * 인쇄용 PDF → 팀이 정한 구글 드라이브 폴더에 올리기.
 *   · 폴더는 관리 > 설정에서 팀마다 정함 ('설정' 탭: 키 = '인쇄PDF폴더:<팀명>', 값 = 폴더 ID, 설명 = 폴더 이름)
 *   · 같은 콘티(팀 + 날짜 · 행사)는 같은 파일을 덮어씀 — 올린 파일에 appProperties.ynhubPkg = 콘티 열쇠 를 남겨 두고 다음에 찾아 바꿈
 *   · 앱이 쓰는 구글 계정이 그 폴더에 "편집자" 로 있어야 함 (설정 화면에 계정 이메일을 보여 줌)
 */
const crypto = require('crypto');
const { Readable } = require('stream');
const { driveApi } = require('./googleAuth');
const sheetsDb = require('./sheetsDb');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const keyOf = (team) => '인쇄PDF폴더:' + String(team || '').trim();

/** 붙여 넣은 링크(또는 ID) → 폴더 ID | '' */
function folderIdFrom(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  let m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{15,}$/.test(s) ? s : '';
}
const folderUrl = (id) => (id ? 'https://drive.google.com/drive/folders/' + id : '');

/** 정해 둔 폴더 { id, name } | null */
async function getFolder(team) {
  const row = await sheetsDb.findOne('설정', '키', keyOf(team));
  const id = row ? String(row['값'] || '').trim() : '';
  return id ? { id, name: String(row['설명'] || '').replace(/^폴더:\s*/, '') } : null;
}

/** 폴더를 열어 보고 쓸 수 있는지 확인 → { id, name } (안 되면 사람이 읽을 메시지로 throw) */
async function checkFolder(id) {
  let f;
  try {
    f = (await driveApi().files.get({ fileId: id, fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)', supportsAllDrives: true })).data;
  } catch (e) {
    const code = e && (e.code || (e.response && e.response.status));
    throw new Error(code === 404 || code === 403 ? '폴더를 열 수 없어요. 링크가 맞는지, 앱 계정을 그 폴더에 "편집자"로 공유했는지 확인해 주세요.' : '폴더를 확인하지 못했어요. 잠시 뒤 다시 해 주세요.');
  }
  if (!f || f.mimeType !== FOLDER_MIME) throw new Error('폴더 링크가 아니에요. 구글 드라이브에서 폴더를 열고 그 주소를 붙여 넣어 주세요.');
  if (f.trashed) throw new Error('휴지통에 있는 폴더예요.');
  if (f.capabilities && f.capabilities.canAddChildren === false) throw new Error('이 폴더에 파일을 올릴 권한이 없어요. 앱 계정을 "편집자"로 공유해 주세요.');
  return { id: f.id, name: f.name || '' };
}

/** 폴더 저장 (빈 값이면 해제) */
async function saveFolder(team, folder) {
  const key = keyOf(team);
  const row = { '키': key, '값': folder ? folder.id : '', '설명': folder ? '폴더: ' + (folder.name || '') : '' };
  const existing = await sheetsDb.findWhere('설정', (r) => r['키'] === key);
  if (existing) await sheetsDb.updateRow('설정', existing.__row, row);
  else await sheetsDb.appendRow('설정', row);
}

/** 앱이 쓰는 구글 계정 이메일 (설정 화면 안내용) */
let _acct = null;
async function appAccount() {
  if (_acct) return _acct;
  try { const r = await driveApi().about.get({ fields: 'user(emailAddress)' }); _acct = (r.data && r.data.user && r.data.user.emailAddress) || ''; } catch (e) { return ''; }
  return _acct;
}

/** 콘티마다 하나 — 팀 + 날짜 · 행사 */
const contiKey = (team, scope) => crypto.createHash('sha1').update(String(team) + '\u0001' + (scope.event ? 'ev-' + scope.event : String(scope.date || ''))).digest('hex').slice(0, 24);

/** 올리기 — 같은 콘티 파일이 그 폴더에 있으면 내용 · 이름을 바꾸고, 없으면 새로 → { link, name, replaced, folder } */
async function upload(team, scope, name, pdf) {
  const folder = await getFolder(team);
  if (!folder) { const e = new Error('관리 > 설정에서 인쇄용 PDF를 올릴 구글 드라이브 폴더를 먼저 정해 주세요.'); e.setup = true; throw e; }
  const drive = driveApi();
  const key = contiKey(team, scope);
  const fileName = String(name || '콘티').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 120) + '.pdf';
  const q = `'${folder.id}' in parents and trashed=false and appProperties has { key='ynhubPkg' and value='${key}' }`;
  const found = await drive.files.list({ q, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: 5 });
  const hit = found.data.files && found.data.files[0];
  const media = { mimeType: 'application/pdf', body: Readable.from(pdf) };
  let r;
  try {
    r = hit
      ? await drive.files.update({ fileId: hit.id, requestBody: { name: fileName }, media, fields: 'id,webViewLink', supportsAllDrives: true })
      : await drive.files.create({ requestBody: { name: fileName, parents: [folder.id], appProperties: { ynhubPkg: key } }, media, fields: 'id,webViewLink', supportsAllDrives: true });
  } catch (e) {
    const code = e && (e.code || (e.response && e.response.status));
    throw new Error(code === 403 || code === 404 ? `"${folder.name || '폴더'}"에 올릴 권한이 없어요. 앱 계정을 그 폴더에 "편집자"로 공유했는지 확인해 주세요.` : '구글 드라이브에 올리지 못했어요. 잠시 뒤 다시 해 주세요.');
  }
  return { link: (r.data && r.data.webViewLink) || ('https://drive.google.com/file/d/' + r.data.id + '/view'), name: fileName, replaced: !!hit, folder: folder.name || '' };
}

module.exports = { folderIdFrom, folderUrl, getFolder, checkFolder, saveFolder, appAccount, upload, contiKey, keyOf };
