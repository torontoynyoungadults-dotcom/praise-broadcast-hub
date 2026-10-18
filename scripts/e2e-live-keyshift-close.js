/**
 * 라이브 악보 — 키 −1 / +1 단추(코드 전조) · 닫기 후 흰 화면 방지 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-keyshift-close.js
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
  const { StandardFonts } = require('pdf-lib');
  /* 오선 한 줄 + 그 위에 바짝 붙은 코드들 (G C D Em7 · Am — Am 은 "못 읽은" 코드로 만듦) · 악보 위 "Key: G" */
  const mk = async () => {
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.HelveticaBold), pg = d.addPage([612, 792]);
    for (let l = 0; l < 5; l++) pg.drawLine({ start: { x: 50, y: 640 - l * 7 }, end: { x: 560, y: 640 - l * 7 }, thickness: 1, color: rgb(0, 0, 0) });
    pg.drawText('Key: G', { x: 50, y: 720, size: 14, font: f });
    [['G', 90], ['C', 104], ['D', 118], ['Em7', 134], ['G', 300], ['Am', 420]].forEach(([t, x]) => pg.drawText(t, { x, y: 656, size: 12, font: f }));
    return Buffer.from(await d.save());
  };
  PDFS[fid(0)] = await mk(); PDFS[fid(1)] = PDFS[fid(0)]; PDFS[fid(2)] = PDFS[fid(0)];

  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { req.session = { uid: 'lead@test' }; next(); });
  app.use(express.static(path.join(ROOT, 'public')));
  const live = require(path.join(ROOT, 'routes/live'));
  app.post('/api/:fn', (req, res, next) => (/^worship(Anno|Cfg|MySheets|SongsOf)/.test(req.params.fn) ? res.json({ ok: true, result: req.params.fn === 'worshipCfgLoad' ? { team: [], mine: [] } : req.params.fn === 'worshipMySheets' ? { sheets: [] } : req.params.fn === 'worshipSongsOf' ? [] : { team: [], mine: [] } }) : next()));
  app.use(live);
  app.get('/conti', (req, res) => res.type('html').send('<!doctype html><title>conti</title><h1 id="conti">예배콘티</h1>'));
  const server = http.createServer(app);
  const realtime = require(path.join(ROOT, 'lib/realtime')), liveAuth = require(path.join(ROOT, 'lib/liveAuth'));
  const rt = realtime.attach(server, { log: () => {}, auth: (t) => liveAuth.verify(t), loadAnno: () => [], saveAnno: () => true });
  live.setRealtime && live.setRealtime(rt);
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;




  const br = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ko-KR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '0'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const URL0 = BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE;
  await page.goto(BASE + '/conti?team=' + TEAM + '&date=' + DATE + '&start=1');               // 콘티 → 라이브 악보 순서로 방문 기록을 만듦
  await page.goto(URL0);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  const lbl = () => page.evaluate(() => { const b = [...document.querySelectorAll('.pv-top .pv-kslbl')][0]; return b ? b.textContent : null; });

  console.log('■ 위 막대 키 −1 / +1');
  ok(await page.evaluate(() => { const g = document.querySelector('.pv-top .pv-keyctl'); return !!g && g.offsetParent !== null; }), '위 막대에 키 단추가 보임');
  ok((await lbl()) === 'Key G', '처음엔 원래 키 (Key G)', await lbl());
  await page.click('.pv-top [data-a="ks-up"]'); await sleep(200);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === 1, '+1 → 키 이동 +1');
  ok(/^Ab \(\+1\)$/.test(await lbl()), '표시: Ab (+1)', await lbl());
  const HZ = 'YNPractice.current().P.ensureTab("harmony")._ui';
  ok(await page.waitForFunction(`(function(){ var h=${HZ}; var S=h&&h._state; return S && S.data && S.data.pages['1'] && S.data.pages['1'].chords.length>=5 && !S.busy && S.semis===1 && S.hits.filter(function(q){return q.kind==='chord';}).length>=5; })()`, null, { timeout: 20000 }).then(() => true, () => false), '악보 코드가 +1 로 덧그려짐');
  await page.click('.pv-top [data-a="ks-down"]'); await page.click('.pv-top [data-a="ks-down"]'); await sleep(300);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === -1, '−1 두 번 → −1');
  ok(/^F# \(−1\)$|^Gb \(−1\)$/.test(await lbl()), '표시: F# (−1)', await lbl());
  ok(await page.waitForFunction(`(function(){ var S=${HZ}._state; return S.semis===-1; })()`, null, { timeout: 5000 }).then(() => true, () => false), '코드도 −1 로 다시 그려짐');
  for (let i = 0; i < 8; i++) await page.click('.pv-top [data-a="ks-up"]').catch(() => {});
  await sleep(200);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === 6, '+6 까지 (그 이상은 막힘)');
  ok(await page.evaluate(() => document.querySelector('.pv-top [data-a="ks-up"]').disabled), '+6 에서 +1 단추 꺼짐');

  console.log('■ 예배 모드에서도 키 단추가 동작');
  await page.evaluate(() => YNPractice.current().setWorship(true)); await sleep(200);
  await page.click('.pv-top [data-a="ks-down"]'); await sleep(200);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === 5, '예배 모드에서 −1 동작');
  await page.click('.pv-top [data-a="ks-reset"]'); await sleep(100);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === 5, '가운데 한 번 누르기 → 바뀌지 않음 (실수 방지)');
  await page.click('.pv-top [data-a="ks-reset"]'); await sleep(200);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === 0, '가운데 두 번 → 원래 키');
  ok((await lbl()) === 'Key G', '표시: Key G', await lbl());

  console.log('■ 다음 곡은 키를 따로 기억');
  await page.click('.pv-top [data-a="ks-up"]'); await sleep(100);
  await page.evaluate(() => YNPractice.current().P.setSong(1)); await sleep(300);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === 0, '다른 곡 → 그 곡의 키 (0)');
  await page.evaluate(() => YNPractice.current().P.setSong(0)); await sleep(300);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === 1 && /\(\+1\)/.test(await lbl()), '첫 곡으로 돌아오면 +1 그대로', await lbl());
  await page.evaluate(() => YNPractice.current().setWorship(false));

  console.log('■ 폰: 메뉴 서랍 안에 키 단추');
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(800);
  ok(await page.evaluate(() => !!document.querySelector('.pv-drawer .pv-keyctl')), '폰에서는 메뉴(서랍)에 키 단추');
  await page.evaluate(() => document.querySelector('.pv-menubtn').click()); await sleep(400);
  await page.evaluate(() => document.querySelector('.pv-drawer [data-a="ks-up"]').click()); await sleep(200);
  ok(await page.evaluate(() => YNPractice.current().P.keyShift()) === 2, '서랍의 +1 동작');
  await page.setViewportSize({ width: 1400, height: 900 }); await sleep(600);

  console.log('■ 닫기: 정리 중 오류가 나도 닫히고 콘티로 이동 · 빈 화면 없음');
  await page.evaluate(() => { const P = YNPractice.current().P; P.on('close', () => { throw new Error('boom'); }); P.tabs.push({ api: { destroy: () => { throw new Error('boom2'); } } }); });
  const nav = page.waitForURL(/\/conti\?/, { timeout: 8000 }).then(() => true, () => false);
  await page.evaluate(() => YNPractice.current().close());
  ok(await nav, '닫으면 예배콘티로 이동 (정리 중 오류가 있어도)');
  ok(await page.evaluate(() => !!document.getElementById('conti')), '콘티 화면이 보임');
  await page.goBack().catch(() => {}); await sleep(800);
  const after = page.url();
  const blank = await page.evaluate(() => !document.querySelector('.pv') && !(document.getElementById('lvFallback') && document.getElementById('lvFallback').offsetParent) && !document.getElementById('conti')).catch(() => true);
  ok(!/\/conti\/practice/.test(after) && !blank, '뒤로 가기 → 닫은(빈) 라이브 악보가 아니라 그 전 콘티 화면', after);

  console.log('■ 느린 이동 중에도 안내가 보임');
  await page.goto(URL0);
  await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 });
  await page.route(/\/conti\?team=/, async (r) => { await sleep(2500); r.continue(); });
  const nav2 = page.waitForURL(/\/conti\?/, { timeout: 10000 }).then(() => true, () => false);
  const fb = await page.evaluate(() => { YNPractice.close(); const b = document.getElementById('lvFallback'); return b && getComputedStyle(b).display !== 'none' && !document.querySelector('.pv') ? b.textContent : null; });
  ok(fb && /돌아가는 중/.test(fb), '이동을 기다리는 동안 "돌아가는 중…" 안내 · 링크', fb);
  ok(await nav2, '조금 늦어도 결국 콘티로 이동');

  ok(errs.filter((m) => !/boom/.test(m)).length === 0, '페이지 오류 없음', errs);
  await br.close(); server.close(); rt && rt.close && rt.close();
  console.log(`\n${pass} 통과 · ${fail} 실패`); if (fail) { console.log(fails); process.exit(1); } process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
