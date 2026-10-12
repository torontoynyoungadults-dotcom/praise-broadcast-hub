/**
 * 라이브 악보 — 떠 있는 창 ✕ 닫기 · 메뉴의 "떠 있는 창" 칸 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-float-close.js
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
  const ctx = await br.newContext({ viewport: { width: 1180, height: 820 }, locale: 'ko-KR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '1'); localStorage.setItem('yn.pv.show.metro', '1'); localStorage.setItem('yn.pv.side', '0'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  console.log('■ 떠 있는 창마다 ✕ · 「⋯」 메뉴의 "떠 있는 창" 칸');
  await page.evaluate(() => YNPractice.current().P.setLayout('tablet')); await sleep(600);
  const Q = (sel) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vis: n.offsetParent !== null }; }, sel);
  const LS = (k) => page.evaluate((x) => { try { return localStorage.getItem('yn.pv.' + x); } catch (e) { return 'ERR'; } }, k);
  const openMenu = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll('.pv-morebtn,.pv-menubtn')].find((x) => x.offsetParent !== null); b && b.click(); }); await sleep(350); };
  const closeMenu = async () => { await page.evaluate(() => { const b = document.querySelector('.pv-morebtn[aria-expanded="true"]'); b && b.click(); }); await sleep(150); };

  let fx = await Q('.pv-form .pv-fx'), mx = await Q('.pv-metro .pv-fx'), fo = await Q('.pv-form');
  ok(fo && fo.vis && fx && fx.vis && fx.w >= 24, '송폼 · 곡 정보 창에 ✕ 가 보임', { fo, fx });
  ok(mx && mx.vis && mx.w >= 24, '메트로놈 창에 ✕ 가 보임', mx);
  ok(fx && fo && fx.x >= fo.x && fx.x + fx.w <= fo.x + fo.w + 2 && fx.y >= fo.y - 14 && fx.y <= fo.y + 20, '송폼 창 ✕ 는 창의 오른쪽 위', { fo, fx });
  const vw = await page.evaluate(() => innerWidth), vh = await page.evaluate(() => innerHeight);
  ok(mx && mx.x >= 0 && mx.x + mx.w <= vw && mx.y >= 0 && mx.y + mx.h <= vh, '메트로놈 ✕ 가 화면 안에 있음', { mx, vw, vh });

  /* 송폼 창 ✕ */
  const pos0 = await Q('.pv-form');
  await page.click('.pv-form .pv-fx'); await sleep(250);
  ok(!(await Q('.pv-form')).vis, '송폼 · 곡 정보 창 ✕ → 창이 닫힘');
  ok((await LS('show.form')) === '0', '닫은 상태가 이 기기에 저장됨 (show.form = 0)');
  ok((await Q('.pv-metro')).vis, '메트로놈 창은 그대로');
  ok(/닫았습니다/.test(await page.evaluate(() => (document.querySelector('.pv-toast') || {}).textContent || '')), '닫았다는 안내가 뜸 (다시 켜는 곳 포함)');
  await openMenu();
  const lab = await page.evaluate(() => (document.querySelector('.pv-acts .pv-fltlabel') || {}).textContent || '');
  ok(lab.trim() === '떠 있는 창', '메뉴에 "떠 있는 창" 칸이 따로 있음', lab);
  const st1 = await page.evaluate(() => [...document.querySelectorAll('.pv-acts .pv-flt')].map((b) => b.getAttribute('data-k') + ':' + b.getAttribute('aria-pressed')));
  ok(st1.indexOf('form:false') >= 0 && st1.indexOf('metro:true') >= 0, '메뉴 단추 상태가 창 상태와 같음', st1);
  ok(st1.indexOf('tools:false') >= 0 || st1.indexOf('tools:true') >= 0, '메뉴에 필기 도구 창 단추도 있음', st1);
  await page.evaluate(() => document.querySelector('.pv-acts .pv-flt[data-k="form"]').click()); await sleep(350);
  const fo2 = await Q('.pv-form');
  ok(fo2 && fo2.vis, '메뉴의 송폼 · 곡 정보 단추 → 창이 다시 열림');
  ok(fo2 && Math.abs(fo2.x - pos0.x) <= 3 && Math.abs(fo2.y - pos0.y) <= 3, '다시 열어도 같은 자리', { pos0, fo2 });
  ok((await page.evaluate(() => document.querySelectorAll('.pv-form .pv-fx').length)) === 1, '다시 열린 창에 ✕ 가 하나');
  await closeMenu();

  /* 송폼을 고쳐 창이 다시 그려져도 ✕ 유지 */
  await page.evaluate(() => { const P = YNPractice.current().P; P.emit && P.emit('songedit'); }); await sleep(300);
  ok((await page.evaluate(() => document.querySelectorAll('.pv-form .pv-fx').length)) === 1, '송폼 창이 다시 그려져도 ✕ 가 그대로 하나');

  /* 손잡이를 끄는 것은 그대로 되고, ✕ 를 눌러도 창이 끌려가지 않음 */
  const g = await Q('.pv-form .pv-grip'), f3 = await Q('.pv-form');
  await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2); await page.mouse.down(); await page.mouse.move(g.x + g.w / 2 - 90, g.y + g.h / 2 + 60, { steps: 6 }); await page.mouse.up(); await sleep(250);
  const f4 = await Q('.pv-form');
  ok(f4.x < f3.x - 40 && f4.y > f3.y + 30, '손잡이(⋮⋮)를 끌면 창이 옮겨짐 (✕ 를 넣어도 그대로)', { f3, f4 });

  /* 메트로놈 창 ✕ */
  await page.click('.pv-metro .pv-fx'); await sleep(250);
  ok(!(await Q('.pv-metro')).vis, '메트로놈 창 ✕ → 창이 닫힘');
  ok((await LS('show.metro')) === '0', '메트로놈 창 닫은 상태 저장');
  await openMenu();
  await page.evaluate(() => document.querySelector('.pv-acts .pv-flt[data-k="metro"]').click()); await sleep(350);
  ok((await Q('.pv-metro')).vis && (await Q('.pv-metro .pv-fx')).vis, '메뉴의 메트로놈 단추 → 창이 다시 열리고 ✕ 도 보임');
  await closeMenu();

  /* 필기 도구 창 (메뉴에서 켜고 끔) */
  const tools0 = await page.evaluate(() => !document.querySelector('.pv').classList.contains('pv-toolshide'));
  await openMenu();
  await page.evaluate(() => document.querySelector('.pv-acts .pv-flt[data-k="tools"]').click()); await sleep(450);
  const tools1 = await page.evaluate(() => !document.querySelector('.pv').classList.contains('pv-toolshide'));
  ok(tools1 !== tools0, '메뉴의 필기 도구 단추로 도구 창이 켜지고 꺼짐', { tools0, tools1 });
  ok((await page.evaluate(() => document.querySelector('.pv-acts .pv-flt[data-k="tools"]').getAttribute('aria-pressed'))) === String(tools1), '필기 도구 단추 상태 표시가 맞음');
  await closeMenu();

  /* 폰 크기에서도 ✕ 가 화면 안에 */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.pv') && document.querySelector('.pv').classList.contains('pv-compact'), null, { timeout: 5000 }).catch(() => {}); await sleep(600);
  await page.evaluate(() => { try { localStorage.setItem('yn.pv.show.metro', '1'); } catch (e) {} const c = YNPractice.current(); c.P.emit && c.P.emit('songedit'); });
  const compact = await page.evaluate(() => document.querySelector('.pv').classList.contains('pv-compact'));
  ok(compact, '폰 크기(390px)에서 폰 배치로 바뀜');
  if (compact) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('.pv-flt[data-k="metro"]')][0]; });
    const m2 = await Q('.pv-metro .pv-fx'), mm = await Q('.pv-metro');
    ok(m2 && m2.vis && m2.x >= 0 && m2.x + m2.w <= 390 && m2.y >= 0, '폰: 메트로놈 ✕ 가 화면 안에 보임', { m2, mm });
    await page.click('.pv-metro .pv-fx'); await sleep(250);
    ok(!(await Q('.pv-metro')).vis, '폰: 메트로놈 창 ✕ → 닫힘');
    await page.evaluate(() => { const b = [...document.querySelectorAll('.pv-menubtn,.pv-morebtn')].find((x) => x.offsetParent !== null); b && b.click(); }); await sleep(500);
    const dr = await page.evaluate(() => { const b = document.querySelector('.pv-drawer .pv-flt[data-k="metro"], .pv-morepop .pv-flt[data-k="metro"]'); return b ? { vis: b.offsetParent !== null, on: b.getAttribute('aria-pressed') } : null; });
    ok(dr && dr.vis && dr.on === 'false', '폰: 메뉴에서 메트로놈 창을 다시 켤 수 있음 (꺼짐 표시)', dr);
    await page.evaluate(() => document.querySelector('.pv-drawer .pv-flt[data-k="metro"], .pv-morepop .pv-flt[data-k="metro"]').click()); await sleep(400);
    ok((await Q('.pv-metro')).vis, '폰: 메뉴 단추로 메트로놈 창이 다시 열림');
  }

  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
