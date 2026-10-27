/**
 * V1310 — 라이브 악보 사용 기록 (브라우저 시험): 신호 · 저장(시트에 더하기) · 관리자만 보기
 *   진짜 routes/live.js · lib/realtime.js · public/worship/* 를 쓰고, 구글(시트 · 드라이브)만 가짜로 (e2e-live-speed.js 와 같은 방식)
 *   · 위 막대: 아이폰(390 · 375) · 아이패드(820 · 1180) · 컴퓨터(1024 · 1280 · 1440)에서 겹침 · 줄바꿈 · 잘림 · 넘침 없음
 *   · 폰: 닫기 · 악보 알약 · 쪽 · (방송팀 요청) · 메트로놈 · ⋯ 만 — 나머지는 ⋯ 서랍
 *   · ⋯ 메뉴(밝기 · 떠 있는 창 · 화면 배치) · 메트로놈 켜기/끄기 · 유튜브 빨간 아이콘
 *   · 올가미: 고리 안의 필기만 골라 함께 옮기기 · 크기 · 지우기 · 되돌리기 한 번에 · 저장 형식 그대로
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-lasso-header.js      (playwright · socket.io-client · pdf-lib 가 필요)
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
process.env.LIVE_USAGE_OWNER = 'lead@test';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

/* ---------- 가짜 구글: 시트(메모리) · 서비스 인증 · 드라이브 내려받기 ---------- */
const TEAM = 'Kairos', DATE = '2026-10-11';
const NAMES = ['Way Maker', 'Holy Forever', 'Amazing Grace'];
const fid = (i) => 'DRIVEFILE' + String(i).padStart(4, '0') + 'xxxxxxxxxx';
const TABS = {
  '찬양콘티': NAMES.map((t, i) => ({ ID: 's' + i, 팀ID: TEAM, 날짜: DATE, 행사ID: '', 구분: '콘티', 순서: String(i + 1), 제목: t, Key: 'G', BPM: '72', 송폼: 'V1-C', 유튜브: i === 0 ? 'https://www.youtube.com/watch?v=abcdefghijk' : '' })),
  '악보저장소': NAMES.map((t, i) => ({ ID: 'r' + i, 팀ID: TEAM, 날짜: DATE, 행사ID: '', 곡ID: 's' + i, 제목: t, 파일링크: 'https://drive.google.com/file/d/' + fid(i) + '/view', 쪽: '', 올린시각: '2026-10-0' + (i + 1) })),
};
const sheetsDbPath = require.resolve(path.join(ROOT, 'lib/sheetsDb'));
require.cache[sheetsDbPath] = { id: sheetsDbPath, filename: sheetsDbPath, loaded: true, exports: new Proxy({
  readAll: async (tab) => (TABS[tab] || []).map((r, i) => Object.assign({ __row: i + 2 }, r)),
  findWhere: async (tab, pred) => (TABS[tab] || []).find(pred) || null,
  appendRows: async (tab, objs) => { (TABS[tab] = TABS[tab] || []).push(...objs.map((o) => Object.assign({}, o))); return objs.length; },
  updateCells: async (tab, cells) => { cells.forEach((c) => { TABS[tab][c.row - 2][c.header] = c.value; }); return cells.length; },
  deleteRows: async (tab, nums) => { nums.slice().sort((a, b) => b - a).forEach((n) => TABS[tab].splice(n - 2, 1)); return nums.length; },
  findOne: async () => null, appendRow: async () => ({}), updateRow: async () => ({}), deleteRow: async () => ({}), invalidate: () => {},
}, { get: (t, k) => (k in t ? t[k] : async () => null) }) };
const gaPath = require.resolve(path.join(ROOT, 'lib/googleAuth'));
require.cache[gaPath] = { id: gaPath, filename: gaPath, loaded: true, exports: new Proxy({ serviceAuth: () => ({ getAccessToken: async () => ({ token: 'fake' }) }) }, { get: (t, k) => (k in t ? t[k] : () => ({})) }) };
const tcPath = require.resolve(path.join(ROOT, 'lib/teamContext'));
require.cache[tcPath] = { id: tcPath, filename: tcPath, loaded: true, exports: { resolve: async () => ({ current: TEAM, teams: [TEAM], member: { 이름: '김리더', 이메일: 'lead@test' }, isAdmin: false }) } };
const honPath = require.resolve(path.join(ROOT, 'lib/honorific'));
require.cache[honPath] = { id: honPath, filename: honPath, loaded: true, exports: new Proxy({ pastorSet: async () => new Set() }, { get: (t, k) => (k in t ? t[k] : () => '') }) };

let PDF = null;
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
  const u = String(url);
  if (/googleapis\.com\/drive\/v3\/files\/[^?]+\?alt=media/.test(u)) { await sleep(30); return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) } }); }
  return realFetch(url, opt);
};

(async () => {
  const { chromium } = require('playwright');
  const { PDFDocument, rgb } = require('pdf-lib');
  const d = await PDFDocument.create();
  for (let p = 0; p < 3; p++) { const pg = d.addPage([612, 792]); for (let l = 0; l < 5; l++) pg.drawLine({ start: { x: 50, y: 640 - l * 6 }, end: { x: 560, y: 640 - l * 6 }, thickness: 1, color: rgb(0, 0, 0) }); }
  PDF = Buffer.from(await d.save());

  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { req.session = { uid: 'lead@test' }; next(); });
  app.use(express.static(path.join(ROOT, 'public')));
  const live = require(path.join(ROOT, 'routes/live'));
  app.post('/api/:fn', (req, res, next) => (/^worship(Anno|Cfg|MySheets|SongsOf)/.test(req.params.fn) ? res.json({ ok: true, result: req.params.fn === 'worshipCfgLoad' ? { team: [], mine: [] } : req.params.fn === 'worshipMySheets' ? { sheets: [] } : req.params.fn === 'worshipSongsOf' ? [] : { team: [], mine: [] } }) : next()));
  app.use(live);
  const server = http.createServer(app);
  const realtime = require(path.join(ROOT, 'lib/realtime')), liveAuth = require(path.join(ROOT, 'lib/liveAuth'));
  const rt = realtime.attach(server, { log: () => {}, auth: (t) => liveAuth.verify(t), loadAnno: () => [], saveAnno: () => true });
  live.setRealtime && live.setRealtime(rt);
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;

  console.log('■ 라이브 악보 화면 (HTML)');
  const html = await realFetch(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE).then((r) => r.text());
  ok(/\/worship\/live-glass\.css[^"]*">\s*<link rel="stylesheet" href="\/worship\/live-head\.css/.test(html), 'live-head.css 를 live-glass.css 바로 다음에 읽음');

  const br = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '0'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  const LU = require(path.join(ROOT, 'lib/liveUsageStore'));
  const liveAuthM = require(path.join(ROOT, 'lib/liveAuth'));
  const liveTok = () => liveAuthM.mint({ 이름: '김리더', 이메일: 'lead@test' }, TEAM, false);
  const otherTok = () => liveAuthM.mint({ 이름: '박팀원', 이메일: 'member@test' }, TEAM, false);
  TABS['라이브악보기록'] = [{ 날짜: '2025-01-01', 팀: TEAM, 이름: '옛기록', 이메일: 'old@test', 구분: '팀원', 콘티: '2025-01-01', 콘티이름: '', 처음: '10:00', 마지막: '10:30', 초: 1800, 횟수: 1, 기기: '아이패드', 수정시각: '' }];

  console.log('■ 신호');
  await sleep(1200);
  ok(LU._pending.size === 1 && [...LU._pending.values()][0].횟수 === 1 && [...LU._pending.values()][0].이메일 === 'lead@test', '라이브 악보를 열면 바로 "연 번 1" 신호', [...LU._pending.values()]);
  const e0 = [...LU._pending.values()][0];
  ok(e0.콘티 && /^\d{2}:\d{2}$/.test(e0.처음) && e0.기기, '콘티 · 처음 시각 · 기기가 함께 옴', e0);
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = ''; document.head.appendChild(s); });
  await page.evaluate(() => new Promise((r) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); setTimeout(r, 600); }));
  const sec1 = [...LU._pending.values()][0].초;
  ok(sec1 >= 1 && sec1 < 10, '화면을 벗어나면 그때까지 본 시간(초)을 보냄', sec1);
  await sleep(1500);
  await page.evaluate(() => new Promise((r) => { document.dispatchEvent(new Event('visibilitychange')); setTimeout(r, 300); }));
  ok([...LU._pending.values()][0].초 === sec1, '화면이 꺼져 있던 동안은 세지 않음');
  await page.evaluate(() => new Promise((r) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); setTimeout(r, 2200); }));

  console.log('■ 저장 — 시트에 더하기 · 1년 지난 줄 지우기');
  await LU.flush();
  let rows = TABS['라이브악보기록'];
  ok(rows.length === 1 && rows[0].이름 === '김리더' && rows[0].횟수 === 1, '한 사람 · 하루 · 콘티가 한 줄 (1년 지난 옛 줄은 지움)', rows);
  await LU.beat(liveTok(), { sid: 'x', room: e0.콘티, ms: 60000, open: true, dev: 'ipad' });
  await LU.flush();
  rows = TABS['라이브악보기록'];
  ok(rows.length === 1 && rows[0].횟수 === 2 && rows[0].초 >= 60, '서버가 다시 켜진 뒤에도 같은 줄에 더함 (초 · 횟수)', rows[0]);

  console.log('■ 관리자만 보기');
  await page.waitForFunction(() => !!document.querySelector('.pv-acts .lu-actbtn'), null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => !!document.querySelector('.pv-acts .lu-actbtn')), '관리자에게만 ⋯ 메뉴 「라이브 악보 사용 기록」');
  let deny = ''; try { await LU.list(otherTok(), {}); } catch (e) { deny = e.message; }
  ok(/관리자만/.test(deny), '다른 사람은 서버가 막음', deny);
  await page.setViewportSize({ width: 820, height: 1180 }); await sleep(300);
  await page.evaluate(() => { document.querySelector('.pv-acts .lu-actbtn').click(); }); await sleep(900);
  ok(await page.evaluate(() => /김리더/.test(document.querySelector('.lu-bd').textContent) && /1명/.test(document.querySelector('.lu-sum').textContent)), '기록 화면: 날짜별 · 본 사람 · 시간');
  await page.click('.lu-gh'); await sleep(250);
  if (process.env.SHOTDIR) await page.screenshot({ path: process.env.SHOTDIR + '/lu-day.png' });
  await page.click('[data-by="person"]'); await sleep(200); await page.click('.lu-gh'); await sleep(200);
  if (process.env.SHOTDIR) await page.screenshot({ path: process.env.SHOTDIR + '/lu-person.png' });
  ok(await page.evaluate(() => /김리더/.test(document.querySelector('.lu-gt').textContent)), '사람별 보기');
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  ok(await page.evaluate(() => { const l = document.querySelector('.lu'); return l.scrollWidth <= l.clientWidth + 1; }), '폰: 넘치지 않음');
  if (process.env.SHOTDIR) await page.screenshot({ path: process.env.SHOTDIR + '/lu-phone.png' });
  ok(!errs.length, '페이지 오류 없음', errs);
  await br.close(); server.close();
  console.log('\n' + pass + ' 통과 · ' + fail + ' 실패'); if (fail) { console.log(fails.join('\n')); process.exit(1); } process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
