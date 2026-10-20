/**
 * Cloudflare R2 (S3 호환) — 악보 파일 보관함.
 * ------------------------------------------------------------
 *  · 악보 파일은 R2 버킷의 `sheets/<파일ID>`, 녹음(음원)은 `audio/<파일ID>` 에 둡니다. 파일ID = 라이브 악보의 필기 열쇠와 같은 값(lib/liveStore.sheetIdOf).
 *    그래서 예전 악보(구글 드라이브 파일ID)를 R2 로 옮겨도 링크 · ID · 필기는 그대로입니다.
 *  · 서버가 R2 에서 읽는 것(들어오는 트래픽)은 Render 대역폭에 잡히지 않습니다. 잡히는 건 서버 → 사용자 쪽(나가는 트래픽)뿐이라,
 *    R2_DIRECT=1 이면 사용자 브라우저가 R2 에서 바로 받게 합니다 (서버는 "임시 열람 주소"로 돌려보내기만 함).
 *
 * 환경변수 (Render → Environment)
 *   R2_ACCOUNT_ID         Cloudflare 계정 ID (R2 개요 화면 오른쪽)
 *   R2_ACCESS_KEY_ID      R2 API 토큰의 Access Key ID  (권한: Object Read & Write — 이 버킷만)
 *   R2_SECRET_ACCESS_KEY  R2 API 토큰의 Secret Access Key
 *   R2_BUCKET             이 앱 전용 새 버킷 이름 (청년부앱 버킷과 따로)
 *   R2_DIRECT             1 이면 악보를 R2 에서 바로 받게 함 (아래 CORS 설정 먼저 — scripts/r2-setup.js)
 *   R2_FOLDERS            R2 에 올릴 폴더 이름들 (쉼표). 기본 '악보,악보원본,나만 보는 악보,음원' (음원 = 녹음 올리기)
 * 위 4개(ACCOUNT_ID · KEY · SECRET · BUCKET)가 하나라도 없으면 R2 는 꺼진 것으로 보고 예전처럼 구글 드라이브만 씁니다.
 */
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/** 종류별 폴더 — sheets = 악보, audio = 녹음(음원). 같은 파일ID 라도 종류가 다르면 다른 파일 */
const PREFIX = { sheets: 'sheets/', audio: 'audio/' };
const ID_RE = /^[A-Za-z0-9_-]{10,}$/;
const env = (k) => String(process.env[k] || '').trim();

const enabled = () => !!(env('R2_ACCOUNT_ID') && env('R2_ACCESS_KEY_ID') && env('R2_SECRET_ACCESS_KEY') && env('R2_BUCKET'));
const direct = () => enabled() && /^(1|true|yes)$/i.test(env('R2_DIRECT'));
const folders = () => new Set((env('R2_FOLDERS') || '악보,악보원본,나만 보는 악보,음원').split(',').map((s) => s.trim()).filter(Boolean));
/** 이 폴더(드라이브 하위 폴더 이름으로 부르던 용도)의 파일을 R2 에 올릴지 */
const handles = (subfolder) => enabled() && folders().has(String(subfolder || ''));

let _client = null, _clientKey = '';
function client() {
  const key = [env('R2_ACCOUNT_ID'), env('R2_ACCESS_KEY_ID')].join('|');
  if (_client && _clientKey === key) return _client;
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
  });
  _clientKey = key;
  return _client;
}

const keyOf = (id, kind) => (PREFIX[kind] || PREFIX.sheets) + String(id);
const okId = (id) => ID_RE.test(String(id || ''));

/** 새 악보 파일ID — [A-Za-z0-9_-] 22글자 (FILE_RE 를 통과) */
function newId() { return require('crypto').randomBytes(16).toString('base64url'); }

async function put(id, buf, contentType, kind) {
  if (!okId(id)) throw new Error('잘못된 파일 ID');
  await client().send(new PutObjectCommand({ Bucket: env('R2_BUCKET'), Key: keyOf(id, kind), Body: buf, ContentType: contentType || 'application/octet-stream' }));
}

/** R2 에 이 파일이 있는지 — 있으면 { size, type }, 없으면 null. (자주 부르므로 결과를 잠깐 기억: 있음 10분 · 없음 1분) */
const HEAD = new Map();
async function head(id, kind) {
  if (!enabled() || !okId(id)) return null;
  const hk = (kind || 'sheets') + ':' + id;
  const hit = HEAD.get(hk);
  if (hit && Date.now() - hit.at < (hit.v ? 10 * 60 * 1000 : 60 * 1000)) return hit.v;
  let v = null;
  try {
    const r = await client().send(new HeadObjectCommand({ Bucket: env('R2_BUCKET'), Key: keyOf(id, kind) }));
    v = { size: Number(r.ContentLength) || 0, type: r.ContentType || 'application/octet-stream' };
  } catch (e) {
    const st = e && e.$metadata && e.$metadata.httpStatusCode;
    if (st !== 404 && e.name !== 'NotFound' && e.name !== 'NoSuchKey') throw e;      // 404 말고 오류(네트워크 등)는 "없음"으로 기억하지 않음
  }
  HEAD.set(hk, { at: Date.now(), v });
  if (HEAD.size > 2000) HEAD.delete(HEAD.keys().next().value);
  return v;
}

/** 파일 바이트 → { buf, type } — 없으면 null */
async function getBuffer(id, kind) {
  if (!enabled() || !okId(id)) return null;
  try {
    const r = await client().send(new GetObjectCommand({ Bucket: env('R2_BUCKET'), Key: keyOf(id, kind) }));
    const chunks = [];
    for await (const c of r.Body) chunks.push(c);
    return { buf: Buffer.concat(chunks), type: r.ContentType || 'application/octet-stream' };
  } catch (e) {
    const st = e && e.$metadata && e.$metadata.httpStatusCode;
    if (st === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound') return null;
    throw e;
  }
}

/** 브라우저가 R2 에서 바로 받을 임시 주소 (기본 10분) */
async function signedUrl(id, { type, name, seconds, kind } = {}) {
  const disp = name ? `inline; filename*=UTF-8''${encodeURIComponent(String(name).slice(0, 120))}` : 'inline';
  return getSignedUrl(client(), new GetObjectCommand({
    Bucket: env('R2_BUCKET'), Key: keyOf(id, kind), ResponseContentType: type || undefined, ResponseContentDisposition: disp,
  }), { expiresIn: seconds || 600 });
}

async function remove(id, kind) {
  if (!enabled() || !okId(id)) return;
  HEAD.delete((kind || 'sheets') + ':' + id);
  await client().send(new DeleteObjectCommand({ Bucket: env('R2_BUCKET'), Key: keyOf(id, kind) }));
}

/** 파일을 조각(Range)으로 읽어 흘려보내기 — R2_DIRECT 가 꺼져 있을 때 서버가 대신 재생해 줄 때 (되감기 · 건너뛰기용). 없으면 null */
async function getStream(id, kind, range) {
  if (!enabled() || !okId(id)) return null;
  try {
    const r = await client().send(new GetObjectCommand({ Bucket: env('R2_BUCKET'), Key: keyOf(id, kind), Range: range || undefined }));
    return { body: r.Body, type: r.ContentType || 'application/octet-stream', length: r.ContentLength, range: r.ContentRange || '', etag: r.ETag || '', partial: !!r.ContentRange };
  } catch (e) {
    const st = e && e.$metadata && e.$metadata.httpStatusCode;
    if (st === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound') return null;
    if (st === 416) return { status: 416 };
    throw e;
  }
}

/** 브라우저(이 앱 주소)에서 R2 로 바로 읽기 요청을 보낼 수 있게 버킷 CORS 설정 (scripts/r2-setup.js 가 부름) */
async function setCors(origins) {
  await client().send(new PutBucketCorsCommand({
    Bucket: env('R2_BUCKET'),
    CORSConfiguration: { CORSRules: [{
      AllowedOrigins: origins, AllowedMethods: ['GET', 'HEAD'], AllowedHeaders: ['*'],
      ExposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type', 'ETag'], MaxAgeSeconds: 86400,
    }] },
  }));
}

module.exports = { enabled, direct, handles, newId, put, head, getBuffer, getStream, signedUrl, remove, setCors, keyOf, okId };
