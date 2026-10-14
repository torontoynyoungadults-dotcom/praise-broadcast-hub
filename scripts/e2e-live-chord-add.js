/**
 * V870 라이브 악보 — 키를 바꿔 덧그린 코드 칩이 서로 겹치지 않음 · 놓친 코드를 길게 눌러 직접 넣기 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-chord-add.js
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
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');

  console.log('■ 키 +1 → 코드 자동 덮어쓰기 · 칩이 겹치지 않음');
  await page.evaluate(() => YNPractice.current().P.setKeyShift(1));
  const HZ = 'YNPractice.current().P.ensureTab("harmony")._ui';
  ok(await page.waitForFunction(`(function(){ var h=${HZ}; var S=h&&h._state; return S && S.data && S.data.pages['1'] && S.data.pages['1'].chords.length>=5 && !S.busy; })()`, null, { timeout: 20000 }).then(() => true, () => false), '페이지 분석 끝 (코드 읽음)');
  await sleep(500);
  const info = await page.evaluate(`(function(){ var h=${HZ}, S=h._state; return { okey: S.okey && S.okey.tonic, semis: S.semis, chords: S.data.pages['1'].chords.map(function(c){return c.text;}), hits: S.hits.filter(function(q){return q.kind==='chord';}) }; })()`);
  ok(info.semis === 1, '목표 조 = 원래 조 + 1', info.semis);
  const hs = info.hits.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  let overl = [];
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const a = hs[i], b = hs[j]; if (Math.abs(a.y - b.y) < (a.h + b.h) / 2 && Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5) overl.push([i, j]); }
  ok(hs.length >= 5, '코드 칩이 그려짐 (' + hs.length + '개)', hs.length);
  ok(overl.length === 0, '바짝 붙은 코드(G C D Em7 → Ab Db Eb Fm7)의 칩이 서로 겹치지 않음', overl);

  console.log('■ 놓친 코드(Am)를 길게 눌러 넣기');
  const amPos = await page.evaluate(`(function(){ var h=${HZ}, S=h._state, pd=S.data.pages['1']; var am=pd.chords.filter(function(c){return c.text==='Am';})[0]; pd.chords=pd.chords.filter(function(c){return c!==am;}); h._commit(); var r=document.querySelector('canvas.pv-harm').getBoundingClientRect(); return { x: r.left+(am.x+am.w/2)*r.width, y: r.top+(am.y+am.h/2)*r.height, ax: am.x, ay: am.y, aw: am.w, ah: am.h, n: pd.chords.length }; })()`);
  await sleep(300);
  await page.mouse.move(amPos.x, amPos.y); await page.mouse.down(); await sleep(900); await page.mouse.up();
  ok(await page.waitForSelector('.hm-edbox', { timeout: 3000 }).then(() => true, () => false), '길게 누르면 코드 입력 상자가 뜸');
  const boxTxt = await page.evaluate(() => document.querySelector('.hm-edbox').textContent);
  ok(/놓친 코드 넣기/.test(boxTxt) && /악보 글자/.test(boxTxt) && /바꾼 키/.test(boxTxt), '입력 상자: 제목 · 「악보 글자 / 바꾼 키」 고르기', boxTxt);
  await sleep(700);                                                                                       // 인쇄된 글자 자리 찾기(snap)
  await page.evaluate(() => { const b = document.querySelector('.hm-edseg button[data-k=orig]'); b && b.click(); });
  await page.fill('.hm-edbox input', 'Am');
  const prevTxt = await page.evaluate(() => document.querySelector('.hm-edprev').textContent);
  ok(/A#m|Bbm/.test(prevTxt), '미리보기: 화면에 보일 코드(+1) 표시', prevTxt);
  await page.press('.hm-edbox input', 'Enter'); await sleep(400);
  const added = await page.evaluate(`(function(){ var h=${HZ}, S=h._state, pd=S.data.pages['1']; var c=pd.chords.filter(function(c){return c.src==='user';})[0]; return c ? { text: c.text, x: c.x, y: c.y, w: c.w, h: c.h, cover: !!c.cover, n: pd.chords.length, hit: S.hits.some(function(q){return q.kind==='chord'&&q.id===c.id;}) } : null; })()`);
  ok(added && added.text === 'Am' && added.n === amPos.n + 1, '코드가 원래 조 글자(Am)로 저장됨', added);
  ok(added && added.cover && Math.abs(added.x - amPos.ax) < 0.01 && Math.abs(added.y - amPos.ay) < 0.012, '인쇄된 Am 글자 자리에 딱 맞춤 (원래 글자를 덮음)', { added, amPos });
  ok(added && added.hit, '넣은 코드도 칩으로 그려짐 (눌러 피아노 · 고치기 가능)');
  ok(!(await page.$('.hm-edbox')), '입력 상자가 닫힘');

  console.log('■ 「바꾼 키」로 입력 → 원래 조로 바꿔 저장');
  await page.mouse.move(amPos.x - 0, amPos.y); await page.mouse.down(); await sleep(900); await page.mouse.up();
  ok(await page.waitForSelector('.hm-edbox', { timeout: 3000 }).then(() => true, () => false), '이미 있는 코드를 길게 누르면 고치기 상자');
  ok(/코드 고치기/.test(await page.evaluate(() => document.querySelector('.hm-edbox').textContent)), '제목: 코드 고치기');
  await page.evaluate(() => { const b = document.querySelector('.hm-edseg button[data-k=target]'); b && b.click(); });
  ok(/^(A#m|Bbm)$/.test(await page.inputValue('.hm-edbox input')), '「바꾼 키」로 바꾸면 입력칸도 바꾼 키 글자로', await page.inputValue('.hm-edbox input'));
  await page.fill('.hm-edbox input', 'B7');
  await page.evaluate(() => { const b = document.querySelector('.hm-edact button[data-k=ok]'); b && b.click(); }); await sleep(400);
  const fixed = await page.evaluate(`(function(){ var S=${HZ}._state; var c=S.data.pages['1'].chords.filter(function(c){return c.src==='user';})[0]; return c && c.text; })()`);
  ok(fixed === 'A#7' || fixed === 'Bb7', '바꾼 키 B7 → 원래 조 A#7/Bb7 로 저장', fixed);
  await sleep(300);
  const hits2 = await page.evaluate(`${HZ}._state.hits.filter(function(q){return q.kind==='chord';})`);
  let ov2 = 0; for (let i = 0; i < hits2.length; i++) for (let j = i + 1; j < hits2.length; j++) { const a = hits2[i], b = hits2[j]; if (Math.abs(a.y - b.y) < (a.h + b.h) / 2 && Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5) ov2++; }
  ok(ov2 === 0, '넣은 뒤에도 칩끼리 겹침 없음', ov2);

  console.log('■ 빈 곳 짧게 톡은 그대로 (입력 상자 안 뜸)');
  await page.mouse.click(amPos.x + 60, amPos.y + 200); await sleep(400);
  ok(!(await page.$('.hm-edbox')), '짧게 누르면 입력 상자가 뜨지 않음');

  await page.screenshot({ path: process.env.SHOT || '/tmp/chord-add.png', clip: { x: 0, y: 0, width: 1400, height: 900 } });
  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
