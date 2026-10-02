/**
 * 교회 앱(yntoronto.2026) 안에서 /praise/… 로 열릴 때 앞머리 — 교회 앱의 lib/hubProxy.js 가 X-Forwarded-Prefix 로 알려 줍니다.
 * 이 앱을 따로 띄우면 빈 값이라 지금과 똑같이 동작합니다. (주소 안 링크는 교회 앱 쪽에서 앞머리를 붙여 줌 — 여기서는 "완전한 주소"를 만들 때만 씀)
 */
function prefixOf(req) {
  const p = String((req && req.get && req.get('x-forwarded-prefix')) || '').trim();
  return /^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(p) ? p : '';
}
module.exports = { prefixOf };
