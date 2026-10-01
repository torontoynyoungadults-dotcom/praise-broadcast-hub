/**
 * 찬양방송팀 허브 — Render(Node.js) 서버
 * ------------------------------------------------------------
 *   /                   로그인 전: 로그인 화면 / 로그인 후: 소속팀 허브
 *   /auth/google        구글 로그인 시작
 *   /auth/google/callback  구글 로그인 콜백
 *   /signup             최초 로그인 시 가입 폼
 *   /admin              관리자 화면 (관리자만)
 *   /healthz            서버 상태 확인 (Render 헬스체크)
 *   /socket.io/         실시간 (연습 화면 — 다음 단계에서 기능 추가)
 *
 * 지금 단계(1단계): 로그인 → 가입 → 허브 진입이 끝까지 동작하는 것이 목표입니다.
 * 예배콘티 · 공지및모임 · 스케줄표 · 라이브러리 · 장비·수리는 다음 단계에서 이어 붙입니다.
 */
process.env.TZ = process.env.TZ || 'America/Toronto';

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('./lib/session');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));
app.use(session.middleware);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use(require('./routes/auth'));
app.use(require('./routes/home'));

app.use((req, res) => res.status(404).type('text').send('Not found'));
app.use((err, req, res, next) => {
  console.error('[서버 오류]', err);
  res.status(500).type('text').send('서버 오류가 발생했습니다.');
});

const server = http.createServer(app);

// 실시간(Socket.io)은 연습 화면을 만드는 단계에서 이어 붙입니다. 자리만 미리 마련해 둡니다.
// const { Server } = require('socket.io');
// const io = new Server(server, { cors: { origin: false } });
// require('./lib/realtime')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`찬양방송팀 허브 — http://localhost:${PORT}`));
