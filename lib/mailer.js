/**
 * 메일 보내기 — 구글 Gmail API (HTTPS 로 보내서 Render 에서 SMTP 포트가 막혀도 됩니다).
 *
 *  · 보내는 계정 = 서버 자격(구글 시트 · 드라이브를 쓰는 교회 공용 계정)과 같은 OAuth 클라이언트
 *  · 메일 권한(gmail.send)이 든 리프레시 토큰이 필요합니다:
 *      npm run auth  (scripts/get-refresh-token.js — 이제 메일 권한도 함께 받음)
 *    로 새로 받은 토큰을 Render 환경변수 GMAIL_REFRESH_TOKEN 에 넣으세요.
 *    (GOOGLE_REFRESH_TOKEN 을 새 토큰으로 바꿔도 되고, 그러면 GMAIL_REFRESH_TOKEN 은 없어도 됩니다)
 *  · 보내는 주소 · 이름: MAIL_FROM (그 계정의 Gmail 주소) · MAIL_FROM_NAME (기본 "토론토영락교회 찬양팀 허브")
 *    MAIL_FROM 이 없으면 이름 없이 계정 주소로만 갑니다.
 */
const { google } = require('googleapis');

const FROM_NAME = () => process.env.MAIL_FROM_NAME || '토론토영락교회 찬양팀 허브';
let _client = null;
function client() {
  if (_client) return _client;
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  _client = new google.auth.OAuth2(id, secret);
  _client.setCredentials({ refresh_token: refresh });
  return _client;
}
function configured() { return !!client(); }

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const word = (s) => '=?UTF-8?B?' + b64(s) + '?=';
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n');

/** 메일 한 통 — { to, subject, html, text }. 실패하면 오류를 던집니다 (부르는 쪽에서 잡음) */
async function send({ to, subject, html, text }) {
  const auth = client();
  if (!auth) throw new Error('메일 설정이 없어요 (GMAIL_REFRESH_TOKEN).');
  const boundary = 'phb' + Date.now().toString(36);
  const mime = [
    ...(process.env.MAIL_FROM ? [`From: ${word(FROM_NAME())} <${process.env.MAIL_FROM}>`] : []),   // 없으면 Gmail 이 보내는 계정 주소를 그대로 씀
    `To: ${to}`,
    `Subject: ${word(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text || '')),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(html || '')),
    `--${boundary}--`, '',
  ].join('\r\n');
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: b64url(mime) } });
}

module.exports = { send, configured };
