/**
 * 라이브 악보 — 코드 표시(칩 없이) · 텐션 · ♭ 인식 · 말풍선 오선 / 피아노 / 기타 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-chordview.js
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
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.HelveticaBold), r = await d.embedFont(StandardFonts.Helvetica), pg = d.addPage([612, 792]);
    pg.drawText('Key: G', { x: 50, y: 720, size: 14, font: f });
    const staff = (y) => { for (let l = 0; l < 5; l++) pg.drawLine({ start: { x: 50, y: y - l * 7 }, end: { x: 560, y: y - l * 7 }, thickness: 1, color: rgb(0, 0, 0) }); };
    staff(640); staff(520);
    [['G', 60], ['D/F#', 130], ['Em7', 220], ['Cmaj7', 300], ['Am7(9)', 390], ['D7sus4', 480]].forEach(([t, x]) => pg.drawText(t, { x, y: 656, size: 12, font: f }));
    pg.drawText('Way maker miracle worker promise keeper', { x: 60, y: 596, size: 11, font: r });
    [['Bb', 60], ['C/E', 130], ['Ebmaj7', 220], ['D7(b9)', 310], ['Gsus4', 400], ['G', 480]].forEach(([t, x]) => pg.drawText(t, { x, y: 536, size: 12, font: f }));
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
  const SHOTS = process.env.SHOTS || '';
  const run = async (theme) => {
    const ctx = await br.newContext({ viewport: { width: 1180, height: 860 }, locale: 'ko-KR' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '0'); localStorage.setItem('ph.theme', t); } catch (e) {} }, theme);
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
    ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '[' + theme + '] 라이브 악보가 그려짐');
    await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
    await page.evaluate(() => YNPractice.current().P.setKeyShift(2));
    const HZ = 'YNPractice.current().P.ensureTab("harmony")._ui';
    ok(await page.waitForFunction(`(function(){ var S=${HZ}._state; return S && S.data && S.data.pages['1'] && !S.busy && S.semis===2 && S.hits.filter(function(q){return q.kind==='chord';}).length>=12; })()`, null, { timeout: 20000 }).then(() => true, () => false), '[' + theme + '] 코드 12개 모두 읽고 +2 로 그림');
    await sleep(500);
    const txt = await page.evaluate(`${HZ}._state.data.pages['1'].chords.map(function(c){return c.text;})`);
    ok(['D/F#', 'Am7(9)', 'D7sus4', 'Ebmaj7', 'D7(b9)', 'C/E'].every((t) => txt.indexOf(t) >= 0), '[' + theme + '] 텐션 · 슬래시 · ♭ 코드도 읽음', txt);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/sheet-' + theme + '.png' });
    const tap = async (i) => {
      const pt = await page.evaluate(`(function(){ var S=${HZ}._state, L=S.hits.filter(function(q){return q.kind==='chord';}).sort(function(a,b){return a.y-b.y||a.x-b.x;}), q=L[${i}], r=document.querySelector('canvas.pv-harm').getBoundingClientRect(), cv=document.querySelector('canvas.pv-harm'); return { x: r.left + q.x * r.width / cv.clientWidth, y: r.top + q.y * r.height / cv.clientHeight }; })()`);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
    };
    for (const [tab, i] of [['piano', 0], ['gtr', 1], ['staff', 9]]) {
      await page.evaluate((t) => { localStorage.setItem('yn.pv.harm.cv', t); }, tab);
      await page.evaluate(() => { const p = document.querySelector('.hm-pop'); if (p) p.classList.add('off'); });
      await page.evaluate(`(function(){ ${HZ}._state; })()`);
      await page.evaluate((t) => { const u = YNPractice.current().P.ensureTab('harmony')._ui; u._state.cvTab = t; }, tab).catch(() => {});
      await tap(i);
      if (tab === 'staff') await page.waitForFunction(() => document.querySelector('.hm-cvstaff svg'), null, { timeout: 8000 }).catch(() => {});
      const info = await page.evaluate(() => { const p = document.querySelector('.hm-pop'); if (!p) return null; const r = p.getBoundingClientRect(); return { name: (p.querySelector('b') || {}).textContent, tones: [...p.querySelectorAll('.hm-poptones em')].map((e) => e.textContent), svg: !!p.querySelector('.hm-cvbody svg'), on: [...p.querySelectorAll('.hm-cvtabs button[aria-pressed=true]')].map((b) => b.dataset.cv), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, op: getComputedStyle(p).opacity }; });
      ok(info && info.svg && info.on[0] === tab && info.inView, '[' + theme + '] 코드를 누르면 「' + tab + '」 그림 · 화면 안', info);
      if (tab === 'piano') {
        const adv = await page.evaluate(() => ({ av: (document.querySelector('.hm-cvadv .av') || {}).textContent || '', nX: document.querySelectorAll('.hm-cvbody .cv-avx').length, nOk: document.querySelectorAll('.hm-cvbody .cv-wk.ok,.hm-cvbody .cv-bk.ok').length }));
        ok(/피할 음\s*D\b/.test(adv.av) && adv.nX >= 2 && adv.nOk >= 4, '[' + theme + '] A 코드(조 A): 피할 음 D 를 빨간 ✕ 로 · 어울리는 음은 초록', adv);
      }
      if (SHOTS) await page.screenshot({ path: SHOTS + '/pop-' + tab + '-' + theme + '.png' });
    }
    /* 기타: 다른 자리 */
    await page.evaluate(() => { const b = document.querySelector('.hm-cvtabs [data-cv=gtr]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); await sleep(200);
    const g1 = await page.evaluate(() => document.querySelector('.hm-cvbody').innerHTML.length);
    const hasNext = await page.evaluate(() => !!document.querySelector('[data-cvnext]'));
    if (hasNext) { await page.evaluate(() => document.querySelector('[data-cvnext]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await sleep(200); }
    ok(hasNext && /2 \//.test(await page.evaluate(() => document.querySelector('.hm-cvnext span').textContent)), '[' + theme + '] 기타 「다른 자리」 로 넘김', g1);
    ok(errs.length === 0, '[' + theme + '] 페이지 오류 없음', errs);
    await ctx.close();
  };
  await run('dark'); await run('light');
  await br.close(); server.close(); rt && rt.close && rt.close();
  console.log(`\n${pass} 통과 · ${fail} 실패`); if (fail) { console.log(fails); process.exit(1); } process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
