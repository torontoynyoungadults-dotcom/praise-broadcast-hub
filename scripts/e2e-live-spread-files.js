/**
 * 라이브 악보 — 두 페이지 보기가 악보 파일 여러 개에 걸쳐서도 이어지는지 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-spread-files.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
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
  findOne: async () => null, appendRow: async () => ({}), updateRow: async () => ({}), deleteRow: async () => ({}), invalidate: () => {},
}, { get: (t, k) => (k in t ? t[k] : async () => null) }) };
const gaPath = require.resolve(path.join(ROOT, 'lib/googleAuth'));
require.cache[gaPath] = { id: gaPath, filename: gaPath, loaded: true, exports: new Proxy({ serviceAuth: () => ({ getAccessToken: async () => ({ token: 'fake' }) }) }, { get: (t, k) => (k in t ? t[k] : () => ({})) }) };
const tcPath = require.resolve(path.join(ROOT, 'lib/teamContext'));
require.cache[tcPath] = { id: tcPath, filename: tcPath, loaded: true, exports: { resolve: async () => ({ current: TEAM, teams: [TEAM], member: { 이름: '김리더', 이메일: 'lead@test' }, isAdmin: false }) } };
const honPath = require.resolve(path.join(ROOT, 'lib/honorific'));
require.cache[honPath] = { id: honPath, filename: honPath, loaded: true, exports: new Proxy({ pastorSet: async () => new Set() }, { get: (t, k) => (k in t ? t[k] : () => '') }) };

let PDFS = {};
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
  const u = String(url);
  const m = /googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media/.exec(u);
  if (m) { await sleep(30); const PDF = PDFS[m[1]] || PDFS[fid(0)]; return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) } }); }
  return realFetch(url, opt);
};

(async () => {
  const { chromium } = require('playwright');
  const { PDFDocument, rgb } = require('pdf-lib');
  /* 파일 3개: ① 1페이지 (왼쪽 가운데 큰 검은 네모) ② 1페이지 (오른쪽 가운데 큰 검은 네모) ③ 3페이지 */
  const mk = async (n, box) => { const d = await PDFDocument.create(); for (let p = 0; p < n; p++) { const pg = d.addPage([612, 792]); for (let l = 0; l < 5; l++) pg.drawLine({ start: { x: 50, y: 640 - l * 6 }, end: { x: 560, y: 640 - l * 6 }, thickness: 1, color: rgb(0, 0, 0) }); if (box) pg.drawRectangle({ x: box === 'L' ? 60 : 380, y: 300, width: 170, height: 170, color: rgb(0, 0, 0) }); } return Buffer.from(await d.save()); };
  PDFS[fid(0)] = await mk(1, 'L'); PDFS[fid(1)] = await mk(1, 'R'); PDFS[fid(2)] = await mk(3, null);

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


  console.log('■ 두 페이지 보기 — 파일이 여러 개로 나뉘어 있어도 이어서');
  const br = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ko-KR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '0'); localStorage.setItem('yn.pv.spread', '1'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  await page.evaluate(() => YNPractice.current().P.setLayout('computer')); await sleep(500);
  if (!(await page.evaluate(() => YNPractice.current().perf().spread))) { await page.evaluate(() => document.querySelector('.pv-spreadbtn') && document.querySelector('.pv-spreadbtn').click()); await sleep(500); }
  const V = () => page.evaluate(() => { const c = YNPractice.current(), p = c.perf(), b = document.querySelector('.pv-pagebox2'), cv = document.querySelector('.pv-pdf2'); let dark = 0, n = 0; if (b && b.style.display !== 'none' && cv.width) { const g = cv.getContext('2d'), w = cv.width, h = cv.height; const l = g.getImageData(0, 0, w, h).data; for (let y = Math.round(h * 0.35); y < h * 0.6; y += 4) for (let x = 0; x < w; x += 4) { n++; if (l[(y * w + x) * 4] < 60) dark++; } const left = Math.round(dark / Math.max(1, n) * 1000); dark = 0; for (let y = Math.round(h * 0.35); y < h * 0.6; y += 4) for (let x = Math.round(w * 0.55); x < w * 0.85; x += 4) if (l[(y * w + x) * 4] < 60) dark++; return { sheet: p.sheet, page: p.page, spread: p.spread, right: true, rightDarkL: left, rightDarkR: dark }; } return { sheet: p.sheet, page: p.page, spread: p.spread, right: false }; });
  const wait = async (fn, ms = 6000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await V(); if (fn(v)) return v; await sleep(150); } return v; };

  let v = await wait((x) => x.spread && x.right);
  ok(v.spread && v.sheet === 0 && v.page === 1, '두 페이지 보기가 켜져 있음', v);
  ok(v.right, '첫 파일이 1페이지뿐이어도 오른쪽에 다음 파일의 첫 페이지가 보임', v);
  ok(v.right && v.rightDarkR > v.rightDarkL * 3 && v.rightDarkR > 20, '오른쪽에 보이는 건 ② 파일(오른쪽 큰 네모)', v);

  const songAt = () => page.evaluate(() => YNPractice.current().perf().song);
  await page.evaluate(() => YNPractice.current().next());
  v = await wait((x) => x.sheet === 1 && x.right);
  ok(v.sheet === 1 && v.page === 1 && v.right, '다음 → 오른쪽(②)이 다른 곡이라 한 장만: ② 가 왼쪽, 오른쪽엔 ③ 1페이지', v);
  await page.evaluate(() => YNPractice.current().next());
  v = await wait((x) => x.sheet === 2 && x.right);
  ok(v.sheet === 2 && v.page === 1, '다음 → 또 다른 곡이라 한 장: ③ 1페이지가 왼쪽', v);
  ok(v.right, '③ 1페이지의 오른쪽에는 ③ 의 2페이지', v);
  void songAt;
  await page.evaluate(() => YNPractice.current().next());
  v = await wait((x) => x.sheet === 2 && x.page === 3);
  ok(v.sheet === 2 && v.page === 3, '다음 → ③ 3페이지', v);
  await sleep(500); v = await V();
  ok(!v.right, '마지막 페이지는 오른쪽이 비어 있음', v);
  await page.evaluate(() => YNPractice.current().next()); await sleep(500);
  v = await V();
  ok(v.sheet === 2 && v.page === 3, '맨 끝에서 더 넘겨도 그대로 (같은 페이지를 다시 보여주지 않음)', v);

  await page.evaluate(() => YNPractice.current().prev());
  v = await wait((x) => x.sheet === 2 && x.page === 1 && x.right);
  ok(v.sheet === 2 && v.page === 1 && v.right, '이전 → ③ 1 · 2 페이지', v);
  await page.evaluate(() => YNPractice.current().prev());
  v = await wait((x) => x.sheet === 0 && x.page === 1 && x.right);
  ok(v.sheet === 0 && v.page === 1 && v.right, '이전 → ① ② 가 다시 한 쌍으로', v);

  console.log('■ 오른쪽 페이지를 누르면 그 페이지가 왼쪽으로');
  await page.click('.pv-pagebox2'); await sleep(200);
  v = await wait((x) => x.sheet === 1 && x.page === 1);
  ok(v.sheet === 1 && v.page === 1, '② 파일 페이지가 왼쪽으로 옴', v);
  ok(v.right, '그 오른쪽에는 ③ 의 첫 페이지', v);

  console.log('■ 두 페이지 보기를 끄면 한 페이지씩');
  await page.evaluate(() => document.querySelector('.pv-spreadbtn').click()); await sleep(600);
  v = await V();
  ok(!v.spread && !v.right, '끄면 오른쪽 칸이 사라짐', v);
  await page.evaluate(() => YNPractice.current().next()); v = await wait((x) => x.sheet === 2, 5000);
  ok(v.sheet === 2 && v.page === 1, '한 페이지씩 보기는 예전처럼 다음 파일로', v);

  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
