/**
 * 구글 인증 — 이 앱은 구글 OAuth 클라이언트 두 개를 씁니다.
 *
 *  ① 서버 자격 (GOOGLE_CLIENT_ID/SECRET + GOOGLE_REFRESH_TOKEN)
 *     — "Desktop app" 유형. 서버가 구글 시트·드라이브를 읽고 쓸 때 항상 이 자격으로 접속합니다.
 *     — scripts/get-refresh-token.js 로 딱 한 번 발급받습니다 (교회 공용 구글 계정으로 로그인).
 *
 *  ② 로그인 자격 (GOOGLE_LOGIN_CLIENT_ID/SECRET)
 *     — "Web application" 유형. 멤버가 "Google로 로그인" 버튼을 누를 때만 씁니다.
 *     — 이 자격으로는 그 사람이 본인 구글 계정의 주인인지(이메일)만 확인하고, 시트·드라이브 접근 권한은 없습니다.
 *
 * 두 자격을 분리해 둔 이유: 로그인 자격은 리디렉션 주소가 매번 노출되는 웹 플로우라 Render 주소가
 * 바뀌면(새 서비스로 옮기는 등) 다시 등록해야 하지만, 서버 자격(리프레시 토큰)은 한 번 발급하면
 * 주소가 바뀌어도 그대로 씁니다.
 */
const { google } = require('googleapis');

let _serviceClient = null;
/** 시트·드라이브 호출용 — 서버 자격(리프레시 토큰) */
function serviceAuth() {
  if (_serviceClient) return _serviceClient;
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET, refresh = process.env.GOOGLE_REFRESH_TOKEN;
  if ((!id || !secret || !refresh) && process.env.GOOGLE_SERVICE_ACCOUNT) {   // 교회 앱이 서비스 계정으로 도는 경우 (교회 앱 안에서 돌릴 때)
    _serviceClient = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT), scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
    return _serviceClient;
  }
  if (!id || !secret || !refresh) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN 환경변수가 필요합니다. (README의 "① 서버 자격" 참고, npm run auth 로 발급)');
  }
  _serviceClient = new google.auth.OAuth2(id, secret);
  _serviceClient.setCredentials({ refresh_token: refresh });
  return _serviceClient;
}

function sheetsApi() { return google.sheets({ version: 'v4', auth: serviceAuth() }); }
function driveApi() { return google.drive({ version: 'v3', auth: serviceAuth() }); }

/** 로그인(멤버용) OAuth2 클라이언트 — redirectUri는 매 요청의 BASE_URL 기준으로 만듭니다 */
function loginClient(redirectUri) {
  const id = process.env.GOOGLE_LOGIN_CLIENT_ID, secret = process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET 환경변수가 필요합니다. (README의 "② 로그인 자격" 참고)');
  }
  return new google.auth.OAuth2(id, secret, redirectUri);
}

module.exports = { serviceAuth, sheetsApi, driveApi, loginClient };
