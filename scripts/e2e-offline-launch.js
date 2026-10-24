/**
 * 오프라인 시험 — "오프라인용 다운로드" 뒤에 서버를 끄고(= 인터넷 없음) 시작 주소 · 라이브 악보 주소를 열어 악보가 뜨는지 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-offline-launch.js
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
  const liveStore = require(path.join(ROOT, 'lib/liveStore'));
  const QS = 'team=' + TEAM + '&date=' + DATE;
  let r2srv = null;
  if (process.env.R2SIM) {                                                       // R2_DIRECT=1 처럼 — /sheet/<id> 는 다른 주소(R2)로 넘김 (CORS 허용)
    r2srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/pdf', 'access-control-allow-origin': '*', 'content-length': PDFS[fid(0)].length }); res.end(Buffer.from(PDFS[fid(0)])); });
    await new Promise((r) => r2srv.listen(0, r));
    app.get(/^\/sheet\/[A-Za-z0-9_-]+$/, (req, res) => res.redirect(302, 'http://127.0.0.1:' + r2srv.address().port + '/r2/' + req.path.split('/').pop() + '?sig=x'));
  }
  app.get('/', (req, res) => res.redirect(302, '/conti/practice?' + QS));       // 진짜 허브의 "/" 도 /conti 로 넘김 (start_url)
  app.get('/conti/offline-plan', (req, res) => res.json({ ok: true, team: TEAM, pages: ['/', '/conti/practice?' + QS], sheets: NAMES.map((t, i) => liveStore.sheetIdOf(TEAM, 'https://drive.google.com/file/d/' + fid(i) + '/view')),
    extra: ['/site.webmanifest', '/vendor/pdfjs/pdf.min.js', '/vendor/pdfjs/pdf.worker.min.js', '/worship/pitch-worklet.js', '/socket.io/socket.io.js'], weeks: [] }));
  app.use(live);
  const server = http.createServer(app);
  const realtime = require(path.join(ROOT, 'lib/realtime')), liveAuth = require(path.join(ROOT, 'lib/liveAuth'));
  const rt = realtime.attach(server, { log: () => {}, auth: (t) => liveAuth.verify(t), loadAnno: () => [], saveAnno: () => true });
  live.setRealtime && live.setRealtime(rt);
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const br = await require('playwright').chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1200, height: 800 }, locale: 'ko-KR' });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const drawn = (p, ms) => p.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: ms || 15000 }).then(() => true, () => false);
  await page.goto(BASE + '/conti/practice?' + QS);
  ok(await drawn(page), '온라인: 라이브 악보가 그려짐');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)); await page.reload(); await drawn(page);
  console.log('  서비스워커 제어:', await page.evaluate(() => !!navigator.serviceWorker.controller));
  await page.evaluate((a) => window.YNOff.dl.start(a), { team: TEAM, date: DATE });
  await page.waitForFunction(() => ['done', 'error'].indexOf(YNOff.dl.status().state) >= 0, null, { timeout: 60000 });
  const st = await page.evaluate(() => { const s = YNOff.dl.status(); return { state: s.state, msg: s.msg, failed: s.failed, pages: s.pages, sheets: s.sheetsDone, bytes: s.bytes }; });
  console.log('  다운로드:', JSON.stringify(st));
  ok(st.state === 'done' && !st.failed, '오프라인용 다운로드가 실패 없이 끝남', st);
  await page.evaluate(() => YNOff.list('r|').then((rows) => Promise.all(rows.map((r) => YNOff.del(r.key)))));      // 열면서 저장된 서버 답을 지우고 — 다운로드만으로 다시 채워지는지
  await page.evaluate((a) => window.YNOff.dl.start(a), { team: TEAM, date: DATE }).catch(() => {});
  await page.waitForFunction(() => ['done', 'error'].indexOf(YNOff.dl.status().state) >= 0, null, { timeout: 60000 });
  const rk = await page.evaluate(() => YNOff.list('r|').then((rows) => rows.map((r) => r.key)));
  console.log('  기억해 둔 서버 답:', JSON.stringify(rk));
  ok(rk.some((k) => /^r\|cfg\|/.test(k)) && rk.some((k) => /^r\|songs\|/.test(k)) && rk.filter((k) => /^r\|anno\|/.test(k)).length >= 3, '다운로드가 곡 목록 · 설정 · 필기 답도 미리 받아 둠', rk);
  console.log('  보관된 것:', JSON.stringify(await page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).map((r) => r.url.replace(location.origin, '')); return o; })));
  await page.close();
  /* ---- 서버를 끔 = 인터넷 없음 ---- */
  if (r2srv) { r2srv.closeAllConnections && r2srv.closeAllConnections(); r2srv.close(); }
  await rt.close(); server.closeAllConnections && server.closeAllConnections(); await new Promise((r) => server.close(r));
  for (const [name, url] of [['시작 주소 "/"', BASE + '/'], ['라이브 악보 주소', BASE + '/conti/practice?' + QS], ['곡 지정 주소 (&sheet=)', BASE + '/conti/practice?' + QS + '&sheet=' + liveStore.sheetIdOf(TEAM, 'https://drive.google.com/file/d/' + fid(1) + '/view')]]) {
    const p2 = await ctx.newPage(); const e2 = []; p2.on('pageerror', (e) => e2.push(e.message));
    let navErr = ''; try { await p2.goto(url, { timeout: 15000 }); } catch (e) { navErr = String(e.message).split('\n')[0]; }
    const okDraw = !navErr && await drawn(p2, 15000);
    const body = navErr ? '' : await p2.evaluate(() => document.body && document.body.innerText.slice(0, 80).replace(/\s+/g, ' '));
    ok(okDraw, '오프라인: ' + name + ' 에서 악보가 열림', navErr || body);
    if (e2.length) console.log('    페이지 오류:', e2.slice(0, 3));
    await p2.close();
  }
  await br.close();
  console.log('\n통과 ' + pass + ' · 실패 ' + fail); if (fail) console.log(fails.join('\n'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
