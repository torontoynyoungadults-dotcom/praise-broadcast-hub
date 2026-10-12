/**
 * 라이브 악보 — 유튜브 창 ← → 키로 영상 이동 · 메트로놈 패널 긴 설명 빼기 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-yt-keys.js
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


  const br = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ko-KR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '0'); } catch (e) {} });

  await ctx.addInitScript(() => {
    window.YT = { Player: class { constructor(box, o) { this.t = 100; window.__fy = this; setTimeout(() => o.events && o.events.onReady && o.events.onReady(), 20); }
      getCurrentTime() { return this.t; } seekTo(t) { this.t = t; } getDuration() { return 600; } getPlayerState() { return 1; } playVideo() {} pauseVideo() {}
      getAvailablePlaybackRates() { return [0.75, 1, 1.25]; } setPlaybackRate() {} mute() {} unMute() {} setVolume() {} destroy() {} } };
  });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  console.log('■ 유튜브 창 ← → 키 · 메트로놈 패널의 긴 설명 빼기');
  await page.evaluate(() => YNPractice.current().P.setLayout('tablet')); await sleep(500);
  const T = () => page.evaluate(() => (window.__fy ? window.__fy.t : null));
  const SH = () => page.evaluate(() => { const p = YNPractice.current().perf(); return { sheet: p.sheet, page: p.page }; });
  await page.evaluate(() => { const b = document.querySelector('.pv-ytbtn'); b && b.click(); });
  ok(await page.waitForFunction(() => document.querySelector('.pv-yt') && window.__fy && YNPractice.current().P.yt() && YNPractice.current().P.yt().state().ready, null, { timeout: 8000 }).then(() => true, () => false), '유튜브 창이 열림 (가짜 플레이어 준비됨)');
  const s0 = await SH(), t0 = await T();
  ok(!(await page.evaluate(() => document.querySelector('.pv-yt').classList.contains('pv-yt-sel'))), '처음에는 선택되지 않은 상태');

  /* 선택하지 않았을 때: → 는 악보 넘김 */
  await page.keyboard.press('ArrowRight'); await sleep(900);
  const s1 = await SH();
  ok(await T() === t0, '선택 전: → 키는 영상을 움직이지 않음', { t0, t: await T() });
  ok(s1.sheet !== s0.sheet || s1.page !== s0.page, '선택 전: → 키는 악보를 넘김', { s0, s1 });
  /* 악보가 넘어가면 곡이 바뀌어 영상 창이 닫힐 수 있으니, 되돌아가서 창을 다시 연다 */
  await page.keyboard.press('ArrowLeft'); await sleep(900);
  if (!(await page.evaluate(() => !!document.querySelector('.pv-yt')))) { await page.evaluate(() => { const b = document.querySelector('.pv-ytbtn'); b && b.click(); }); await page.waitForFunction(() => document.querySelector('.pv-yt') && window.__fy && YNPractice.current().P.yt() && YNPractice.current().P.yt().state().ready, null, { timeout: 8000 }).catch(() => {}); }
  const sBase = await SH(), tBase = await T();

  /* 창을 누르면 선택 → ← → 는 영상 이동 */
  await page.click('.pv-yt .pv-yth b'); await sleep(150);
  ok(await page.evaluate(() => document.querySelector('.pv-yt').classList.contains('pv-yt-sel')), '유튜브 창을 누르면 선택 표시(테두리)가 켜짐');
  await page.keyboard.press('ArrowRight'); await sleep(200);
  ok(await T() === tBase + 5, '선택 후: → 키 = 영상 5초 앞으로', { tBase, t: await T() });
  await page.keyboard.press('ArrowLeft'); await sleep(150); await page.keyboard.press('ArrowLeft'); await sleep(200);
  ok(await T() === tBase - 5, '선택 후: ← 키 두 번 = 영상 5초씩 뒤로', { tBase, t: await T() });
  await page.keyboard.press('Shift+ArrowRight'); await sleep(200);
  ok(await T() === tBase + 10, 'Shift + → = 15초 앞으로', { tBase, t: await T() });
  const sSel = await SH();
  ok(sSel.sheet === sBase.sheet && sSel.page === sBase.page, '선택 중에는 악보가 넘어가지 않음', { sBase, sSel });
  ok(/초/.test(await page.evaluate(() => (document.querySelector('.pv-yt .yt-zone.flash') || {}).textContent || '')), '이동했다는 "5초" 표시가 영상 위에 뜸');

  /* 영상 영역(투명 왼쪽/오른쪽)을 눌러도 선택 유지, 악보를 누르면 선택 해제 → 다시 악보 넘김 */
  await page.click('.pv-yt .yt-zl'); await sleep(450);
  ok(await page.evaluate(() => document.querySelector('.pv-yt').classList.contains('pv-yt-sel')), '영상 화면을 눌러도 선택 유지');
  const tNow = await T();
  await page.mouse.click(60, 400); await sleep(300);
  ok(!(await page.evaluate(() => document.querySelector('.pv-yt').classList.contains('pv-yt-sel'))), '악보를 누르면 선택이 풀림');
  await page.keyboard.press('ArrowRight'); await sleep(900);
  const sAfter = await SH();
  ok(await T() === tNow, '선택이 풀린 뒤: → 키는 영상을 움직이지 않음', { tNow, t: await T() });
  ok(sAfter.sheet !== sBase.sheet || sAfter.page !== sBase.page, '선택이 풀린 뒤: → 키는 다시 악보 넘김', { sBase, sAfter });

  /* 메트로놈 패널: 긴 설명 문단이 없음 */
  await page.evaluate(() => YNPractice.current().P.setLayout('computer')); await sleep(500);
  await page.evaluate(() => YNPractice.current().P.showTab('metro')); await sleep(700);
  const bad = ['사인파는 맑은', '딸깍 볼륨은 가운데', '원(박)을 누를 때마다', '약 6배', '박이 늦어지지 않', '박자가 빠르면 빨리 말합니다', '다음 마디를 딸깍 대신', '화면 위 도크에서도 켜고 끌 수 있어요'];
  const sideTxt = await page.evaluate(() => (document.querySelector('.pv-side') || {}).textContent || '');
  ok(sideTxt.indexOf('메트로놈') >= 0 && sideTxt.indexOf('딸깍') >= 0, '메트로놈 패널이 열려 있음');
  ok(bad.every((w) => sideTxt.indexOf(w) < 0), '긴 설명 문장(강세 · 볼륨 · EQ · 큐 안내)이 없음', bad.filter((w) => sideTxt.indexOf(w) >= 0));
  ok(!/연주 중에 바꾼 BPM|밴드가 실제로 들어간|이 기기에 기억됩니다|누른 뒤 바로 다음 박이 새 1박/.test(sideTxt), '예전 안내 문장이 하나도 남지 않음');
  ok(['×2 쪼개기', '이 곡 BPM 저장', '1박 다시 맞추기', '숫자로 세기'].every((w) => sideTxt.indexOf(w) >= 0), '단추 이름은 그대로 있음');

  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
