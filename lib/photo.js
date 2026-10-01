/**
 * 사진 주소 — 드라이브에 올린 사진은 이 앱 주소(/photo/<파일ID>)로 바꿔서 보여줍니다.
 * 이유: 올릴 때 받은 주소(drive.google.com/uc?export=view&id=…)를 <img> 에 직접 걸면 구글이 막아서
 * (로그인 쿠키 · 3rd-party 차단 · 바이러스 검사 안내 페이지) 사진 대신 깨진 그림("?")이 나옵니다.
 * 서버가 서비스 계정 토큰으로 대신 받아서 같은 출처로 내려주면 항상 보입니다 (routes/photo.js).
 * 저장된 값(시트)은 그대로 두고, 화면에 낼 때만 바꿉니다 → 이미 올려 둔 사진도 그대로 고쳐집니다.
 */
const FILE_RE = /^[A-Za-z0-9_-]{10,}$/;

/** 구글 드라이브 주소에서 파일 ID — 아니면 '' */
function driveIdOf(link) {
  const s = String(link || '').trim();
  if (!/^https?:\/\/([a-z0-9-]+\.)*(google\.com|googleusercontent\.com)\//i.test(s)) return '';
  const m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : '';
}

/** 화면에 낼 사진 주소 — 우리 드라이브 사진이면 /photo/<id>, 구글 계정 사진 등 다른 주소는 그대로 */
function src(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const id = driveIdOf(raw);
  if (id && /^https?:\/\/drive\.google\.com\//i.test(raw)) return '/photo/' + id;
  return raw;
}

module.exports = { src, driveIdOf, FILE_RE };
