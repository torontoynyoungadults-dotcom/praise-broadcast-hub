/**
 * 파일 업로드(멀티파트 폼) 공용 설정.
 * defParamCharset: 'utf8' 꼭 필요 — 안 넣으면 한글 필드 이름(이름/제목/파일 등)이
 * 깨진 채로 들어와서 req.body에서 값을 못 찾습니다 (busboy 기본값은 필드 이름을 latin1로 해석함).
 * 이 버그를 회원가입 폼에서 한 번 겪었어서, 앞으로 생길 모든 업로드 폼이 같은 실수를 하지 않도록
 * 하나의 multer 인스턴스로 공유합니다.
 */
const multer = require('multer');

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  defParamCharset: 'utf8',
});
