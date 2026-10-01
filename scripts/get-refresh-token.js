/**
 * 서버 자격(①)의 리프레시 토큰을 한 번 받아 오는 도구입니다. (본인 컴퓨터에서 한 번만 실행)
 *
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run auth
 *
 * 1. 터미널에 뜨는 주소를 브라우저로 열고, 반드시 "교회 공용 구글 계정"(드라이브 폴더 편집 권한이 있는 계정)으로
 *    로그인해 허용합니다.
 * 2. 터미널에 찍히는 GOOGLE_REFRESH_TOKEN 값을 Render 환경변수에 넣습니다.
 *
 * 클라이언트 ID는 Google Cloud Console → API 및 서비스 → 사용자 인증 정보 →
 * "OAuth 클라이언트 ID 만들기" → 유형 **데스크톱 앱(Desktop app)** 으로 만든 것을 씁니다.
 * (멤버들이 로그인할 때 쓰는 "웹 애플리케이션" 클라이언트와는 다른, 별도의 클라이언트입니다.)
 */
const http = require('http');
const { google } = require('googleapis');

const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secret) {
  console.error('GOOGLE_CLIENT_ID 와 GOOGLE_CLIENT_SECRET 을 함께 넣어 실행해주세요.\n' +
    '예) GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run auth');
  process.exit(1);
}

const PORT = 53682;
const redirect = 'http://127.0.0.1:' + PORT;
const oauth = new google.auth.OAuth2(id, secret, redirect);
const url = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get('code');
  if (!code) { res.end('code 가 없습니다.'); return; }
  try {
    const { tokens } = await oauth.getToken(code);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<h2>완료했습니다. 터미널로 돌아가세요.</h2>');
    console.log('\n아래 값을 Render 환경변수 GOOGLE_REFRESH_TOKEN 에 넣어주세요:\n');
    console.log(tokens.refresh_token || '(리프레시 토큰이 오지 않았습니다 — myaccount.google.com/permissions 에서 이 앱 권한을 지우고 다시 실행해주세요)');
    console.log('');
  } catch (e) {
    res.end('실패: ' + e.message);
    console.error(e.message);
  }
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n이 주소를 브라우저에서 열고 교회 공용 구글 계정으로 로그인해주세요:\n\n' + url + '\n');
});
