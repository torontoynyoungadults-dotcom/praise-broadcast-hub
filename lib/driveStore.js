/**
 * 제공받은 드라이브 폴더(DB_FOLDER_ID) 아래에 용도별 하위 폴더를 만들고 파일을 올리는 도우미.
 * 악보 · 음원 · 프로필사진 · 장비사진 모두 이 폴더 구조 안에 저장합니다.
 */
const { Readable } = require('stream');
const { driveApi } = require('./googleAuth');
const sheetsDb = require('./sheetsDb');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const subfolderCache = new Map(); // name -> id

async function subfolderId(name) {
  if (subfolderCache.has(name)) return subfolderCache.get(name);
  const drive = driveApi();
  const parent = sheetsDb.folderId();
  const q = `'${parent}' in parents and mimeType='${FOLDER_MIME}' and name='${name.replace(/'/g, "\\'")}' and trashed=false`;
  const found = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
  let id;
  if (found.data.files && found.data.files.length) {
    id = found.data.files[0].id;
  } else {
    const created = await drive.files.create({ requestBody: { name, mimeType: FOLDER_MIME, parents: [parent] }, fields: 'id' });
    id = created.data.id;
  }
  subfolderCache.set(name, id);
  return id;
}

/**
 * 파일(버퍼)을 올리고 "누구나 링크로 보기" 권한을 준 뒤, 바로 볼 수 있는 링크를 돌려줍니다.
 * @param {string} subfolder - 예: '프로필사진', '악보', '음원', '장비사진'
 * @param {{originalname:string, mimetype:string, buffer:Buffer}} file - multer 파일 객체
 */
async function uploadPublic(subfolder, file) {
  const drive = driveApi();
  const parents = [await subfolderId(subfolder)];
  const created = await drive.files.create({
    requestBody: { name: `${Date.now()}_${file.originalname}`, parents },
    media: { mimeType: file.mimetype, body: Readable.from(file.buffer) },
    fields: 'id,webViewLink,webContentLink',
  });
  await drive.permissions.create({ fileId: created.data.id, requestBody: { role: 'reader', type: 'anyone' } });
  // 이미지 미리보기에 바로 쓰기 좋은 주소
  return `https://drive.google.com/uc?export=view&id=${created.data.id}`;
}

/** 링크 공개 없이(서비스 계정만 읽음) 파일을 올리고 주소를 돌려줍니다 — 확정한 인쇄용 PDF 처럼 앱 안에서만 쓰는 파일용 */
async function uploadPrivate(subfolder, file) {
  const drive = driveApi();
  const created = await drive.files.create({
    requestBody: { name: `${Date.now()}_${file.originalname}`, parents: [await subfolderId(subfolder)] },
    media: { mimeType: file.mimetype, body: Readable.from(file.buffer) },
    fields: 'id',
  });
  return `https://drive.google.com/uc?export=download&id=${created.data.id}`;
}
async function removeByLink(link) {
  const m = String(link || '').match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (!m) return;
  try { await driveApi().files.delete({ fileId: m[1], supportsAllDrives: true }); } catch (e) { /* 이미 없으면 무시 */ }
}

module.exports = { uploadPublic, uploadPrivate, removeByLink };
