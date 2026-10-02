/**
 * 찬양방송팀 허브 — Render(Node.js) 서버
 * ------------------------------------------------------------
 *   /                   로그인 전: 로그인 화면 / 로그인 후: 소속팀 허브
 *   /auth/google        구글 로그인 시작
 *   /auth/google/callback  구글 로그인 콜백
 *   /signup             최초 로그인 시 가입 폼
 *   /profile            내 정보 수정 (본인 전화번호·성별·사진·역할)
 *   /admin              관리자 화면 (관리자만 — 찬양팀 · 멤버 · 태그라인 관리)
 *   /roster             팀원관리 (팀원 명단 — 회원가입 화이트리스트, 아이콘·사진·이름으로 가입현황 보기)
 *   /healthz            서버 상태 확인 (Render 헬스체크)
 *   /conti              예배콘티 (콘티 · 결단찬양 · 악보 · 녹음 · 댓글)
 *   /conti/practice     라이브 악보 (church-app 라이브 악보 그대로 — 필기 · 메트로놈 · 콜아웃 · 화음 · 함께 보기, Socket.io 실시간)
 *   /sheet/:id · /audio/:id   라이브 악보가 여는 악보 · 녹음 파일 (같은 출처)
 *   /api/*              라이브 악보의 서버 호출 (church-app callServer 와 같은 약속)
 *   /b/<열쇠>           방송팀(PPT) 보기 전용 — 로그인 없이 예배콘티 · 스케줄표만 (고칠 수 없음 · 댓글만 가능)
 *   /socket.io/         실시간 (연습 화면 동기화)
 *   /notices            공지 및 모임 (공지사항 + 토요모임 기도제목 나누기)
 *   /schedule           스케줄표 (주차별 포지션 편성 + 내가 안 되는 날)
 *   /events             행사 (주일 외 서는 날 — 성탄절 · 송구영신예배 · 특별새벽기도 · 부흥회 등)
 *   /library            라이브러리 (지난 콘티 · 악보 · 녹음 모아보기 + 곡 순위)
 *   /equipment          장비 · 수리 (오늘 점검 + 수리 요청, 단일 페이지 — iframe 없음)
 *
 * 관리자 대시보드는 다음 단계에서 이어 붙입니다.
 */
process.env.TZ = process.env.TZ || 'America/Toronto';

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('./lib/session');
const compression = require('compression');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
// 글자 파일(HTML · CSS · JS · JSON)은 압축해서 보냄 — 악보(PDF) · 녹음 · 사진 · 실시간 연결은 이미 압축돼 있거나 부분 요청이라 제외
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const p = req.path || '';
    if (p.indexOf('/sheet/') === 0 || p.indexOf('/audio/') === 0 || p.indexOf('/photo/') === 0 || p.indexOf('/socket.io/') === 0 || req.headers.range) return false;
    return compression.filter(req, res);
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use('/api/worshipRepoSave', express.json({ limit: '20mb' }));   // 라이브러리 "＋ 악보 PDF" (12MB PDF → base64) — 아래 기본(2MB)보다 먼저
app.use(express.json({ limit: '2mb' })); // 필기(연습 화면) 저장처럼 JS가 JSON으로 보내는 요청용 — 폼 전송(urlencoded)과 공존
app.use(session.middleware);
// 오프라인 일꾼 — 늘 새 것을 확인하게 (public/sw.js · 범위는 사이트 전체)
app.get('/sw.js', (req, res) => { res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }); res.type('application/javascript').sendFile(path.join(__dirname, 'public', 'sw.js')); });
// 화면 파일(js/css)은 주소에 ?v=<수정시각> 이 붙어 있어서 내용이 바뀌면 주소가 달라집니다 → 1년 동안 다시 묻지 않음. 라이브러리(vendor) · 큐 소리는 7일.
app.use((req, res, next) => {
  if (req.method === 'GET') {
    if (req.query && req.query.v && /\.(js|css|svg|png|woff2?)$/i.test(req.path)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/^\/(vendor|worship\/cues|icons)\//.test(req.path)) res.set('Cache-Control', 'public, max-age=604800');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.use(require('./lib/guestGate').middleware);   // 접속 일시 중지 · 객원 멤버(서는 날만)
app.get('/healthz', (req, res) => res.type('text').send('ok' + (process.env.RENDER_GIT_COMMIT ? ' ' + String(process.env.RENDER_GIT_COMMIT).slice(0, 7) : '')));   // 어느 버전이 떠 있는지(Render 가 커밋 번호를 넣어 줌)

const live = require('./routes/live');     // 라이브 악보 (/conti/practice · /sheet · /audio · /api/*) — conti 보다 먼저
const conti = require('./routes/conti');

app.use(require('./routes/photo'));    // /photo/:id — 드라이브 사진을 이 앱 주소로 (깨진 "?" 방지)
app.use(require('./routes/auth'));
app.use(require('./routes/profile'));
app.use(require('./routes/roster'));
app.use(live);
app.use(conti);
app.use(require('./routes/guest'));   // /b/<열쇠> — 방송팀 보기 전용 (로그인 없음 · 예배콘티 + 스케줄표 · 댓글만)
app.use(require('./routes/guide'));   // /guide — 사용설명서
app.use(require('./routes/notices'));
app.use(require('./routes/scheduleImport'));   // /schedule/import (관리자) — /schedule 보다 먼저
app.use(require('./routes/schedule'));
app.use(require('./routes/events'));
app.use(require('./routes/library'));
app.use(require('./routes/equipment'));
app.use(require('./routes/admin'));
app.use(require('./routes/home'));

app.use((req, res) => res.status(404).type('text').send('Not found'));
app.use((err, req, res, next) => {
  console.error('[서버 오류]', err);
  res.status(500).type('text').send('서버 오류가 발생했습니다.');
});

const server = http.createServer(app);

// 실시간(Socket.io) — 라이브 악보(church-app 그대로)의 페이지 · 클릭 컨트롤, 팀 필기, 메트로놈, 큐, 예배 타이머.
// lib/realtime.js 는 church-app 파일에 "팀 구분"만 더한 것이고, 시트와는 아래 세 함수로만 만납니다.
const realtime = require('./lib/realtime');
const liveStore = require('./lib/liveStore');
const liveAuth = require('./lib/liveAuth');
const rt = realtime.attach(server, {
  log: (...a) => console.error(...a),
  auth: (token) => liveAuth.verify(token),
  loadAnno: (file, scope, team) => liveStore.readLayer(team, file, scope, '*'),
  saveAnno: (file, scope, items, by, team) => liveStore.writeLayer(team, file, scope, '*', items, by),
});
live.setRealtime(rt);
conti.setLiveNotify(live.songsChanged);
liveStore.loadAnnos().catch((e) => console.error('[찬양주석 불러오기 실패 — 필기를 열 때 다시 시도합니다]', e && e.message));

// 서버가 꺼질 때(Render 배포 · 재시작) — 아직 시트에 안 쓴 팀 필기를 마저 저장합니다
let stopping = false;
async function shutdown(sig) {
  if (stopping) return; stopping = true;
  console.log(`[${sig}] 남은 필기를 저장하고 끕니다…`);
  try { rt.flushAll(); } catch (e) { console.error('[종료 저장]', e && e.message); }
  try { await liveStore.drain(8000); } catch (e) { /* 끄는 중 */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`찬양방송팀 허브 — http://localhost:${PORT}`); if (process.env.NODE_ENV !== 'test') require('./lib/weeklyDefaults').start(); });
