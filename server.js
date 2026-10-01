/**
 * 찬양방송팀 허브 — Render(Node.js) 서버
 * ------------------------------------------------------------
 *   /                   로그인 전: 로그인 화면 / 로그인 후: 소속팀 허브
 *   /auth/google        구글 로그인 시작
 *   /auth/google/callback  구글 로그인 콜백
 *   /signup             최초 로그인 시 가입 폼
 *   /admin              관리자 화면 (관리자만)
 *   /healthz            서버 상태 확인 (Render 헬스체크)
 *   /conti              예배콘티 (콘티 · 결단찬양 · 악보 · 녹음 · 댓글)
 *   /conti/practice     연습 화면 (라이브 악보 보기 · 메트로놈, Socket.io로 실시간 동기화)
 *   /public/conti       로그인 없이 보는 공개 예배콘티
 *   /socket.io/         실시간 (연습 화면 동기화)
 *   /notices            공지 및 모임 (공지사항 + 토요모임 기도제목 나누기)
 *   /schedule           스케줄표 (주차별 포지션 편성 + 내가 안 되는 날)
 *   /library            라이브러리 (지난 콘티 · 악보 · 녹음 모아보기 + 곡 순위)
 *
 * 장비·수리 · 관리자 대시보드는 다음 단계에서 이어 붙입니다.
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
app.use(require('./routes/conti'));
app.use(require('./routes/notices'));
app.use(require('./routes/schedule'));
app.use(require('./routes/library'));
app.use(require('./routes/home'));

app.use((req, res) => res.status(404).type('text').send('Not found'));
app.use((err, req, res, next) => {
  console.error('[서버 오류]', err);
  res.status(500).type('text').send('서버 오류가 발생했습니다.');
});

const server = http.createServer(app);

// 실시간(Socket.io) — 연습 화면(메트로놈 · 라이브 악보 보기)의 동기화에 씁니다.
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: false } });
require('./lib/realtime')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`찬양방송팀 허브 — http://localhost:${PORT}`));
