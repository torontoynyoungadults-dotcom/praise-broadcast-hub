/**
 * 라이브 악보 — 패널 v12: 열 때 패널 닫힘 · 긴 설명 빼기 · 시작 버튼 고정 해제 · EQ 접기 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-panels-v12.js
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
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '1'); localStorage.setItem('yn.pv.layout', 'computer'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  console.log('■ 열면 패널이 닫힌 채로 (예전에 열어 둔 적이 있어도)');
  const sideOpen = () => page.evaluate(() => document.querySelector('.pv').classList.contains('pv-sideopen'));
  ok(await page.evaluate(() => YNPractice.current().P.layout()) === 'computer', '컴퓨터 화면 배치');
  ok(!(await sideOpen()), '처음 열면 패널이 닫혀 있음 (저장된 "열림" 값이 있어도)');
  await page.evaluate(() => document.querySelector('.pv-panelbtn').click()); await sleep(400);
  ok(await sideOpen(), '패널 단추로 열 수 있음');
  await page.reload();
  await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }); await sleep(500);
  ok(!(await sideOpen()), '다시 열면 또 닫힌 채로 시작');
  /* ---- 패널 v12: 긴 설명 빼기 · 시작 버튼/작은 메트로놈 고정 해제 · EQ 접기 ---- */
  const PV = (fn, a) => page.evaluate(fn, a);
  await PV(() => YNPractice.current().P.setLayout('computer')); await sleep(400);
  const sideText = () => PV(() => { const p = [...document.querySelectorAll('.pv-panes > *')].find((x) => x.offsetParent !== null); return p ? p.textContent : ''; });
  await PV(() => YNPractice.current().P.showTab('anno')); await sleep(400);
  let tx = await sideText();
  ok(tx.indexOf('나만 보기') >= 0, '필기 탭이 열림');
  ok(!/체크하면 내 필기는|이 날짜만"은 이번 예배|굵기 3칸|하드웨어 더블탭/.test(tx), '필기 탭: 긴 설명 4개가 없음');
  await PV(() => YNPractice.current().P.showTab('form')); await sleep(500);
  tx = await sideText();
  ok(tx.indexOf('송폼 순서') >= 0, '송폼 탭이 열림');
  ok(!/칸을 누르면 지금 위치가 밝게|칩을 누르면 선택됩니다/.test(tx), '송폼 탭: 긴 설명 2개가 없음');
  const scrollCheck = (sel) => PV((sel) => {
    const n = [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null); if (!n) return { none: true };
    let sc = n.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const pos = getComputedStyle(n).position; if (!sc) return { pos, noScroll: true };
    sc.scrollTop = 0; const t0 = n.getBoundingClientRect().top; sc.scrollTop = 260; const t1 = n.getBoundingClientRect().top; const moved = sc.scrollTop; sc.scrollTop = 0;
    return { pos, t0: Math.round(t0), t1: Math.round(t1), moved };
  }, sel);
  let sc = await scrollCheck('.pv-mini'); console.log('    작은 메트로놈', JSON.stringify(sc));
  ok(sc.none || (sc.pos !== 'sticky' && (sc.noScroll || sc.moved < 10 || sc.t1 < sc.t0 - sc.moved + 10)), '송폼 탭: 작은 메트로놈이 위에 고정되지 않고 같이 스크롤됨', sc);
  await PV(() => YNPractice.current().P.showTab('metro')); await sleep(500);
  tx = await sideText();
  ok(tx.indexOf('딸깍') >= 0, '메트로놈 탭이 열림');
  sc = await scrollCheck('.pv-mline'); console.log('    시작 버튼', JSON.stringify(sc));
  ok(!sc.none && sc.pos !== 'sticky' && (sc.noScroll || sc.moved < 10 || sc.t1 < sc.t0 - sc.moved + 10), '메트로놈 탭: 시작 버튼이 고정되지 않고 같이 스크롤됨', sc);
  const eqv = () => PV(() => { const e = [...document.querySelectorAll('.pv-eq')].find((x) => x.offsetParent !== null); if (!e) return null; const lo = e.querySelector('[data-o="eqlow"]'), sel = e.querySelector('[data-o="eqp"]'), tg = e.querySelector('.pv-eqtog'); return { open: e.classList.contains('open'), low: !!(lo && lo.offsetParent !== null), sel: !!(sel && sel.offsetParent !== null), exp: tg && tg.getAttribute('aria-expanded') }; });
  let ev = await eqv();
  ok(ev && !ev.open && !ev.low && ev.sel && ev.exp === 'false', 'EQ 는 처음에 접혀 있음 (미리 정한 값 고르기만 보임)', ev);
  await PV(() => { const e = [...document.querySelectorAll('.pv-eq')].find((x) => x.offsetParent !== null); e.querySelector('.pv-eqtog').click(); }); await sleep(200);
  ev = await eqv();
  ok(ev && ev.open && ev.low && ev.exp === 'true', 'EQ 머리줄을 누르면 세부 설정(저음 · 가운데 · 고음)이 펼쳐짐', ev);
  await PV(() => { const e = [...document.querySelectorAll('.pv-eq')].find((x) => x.offsetParent !== null); e.querySelector('[data-o="eqp"]').click(); }); await sleep(150);
  ev = await eqv();
  ok(ev && ev.open, '미리 정한 값 고르기를 눌러도 접히지 않음', ev);
  await PV(() => { const e = [...document.querySelectorAll('.pv-eq')].find((x) => x.offsetParent !== null); e.querySelector('.pv-eqtog').click(); }); await sleep(200);
  ok(!(await eqv()).open, '한 번 더 누르면 다시 접힘');
  await PV(() => YNPractice.current().P.showTab('harmony')); await sleep(500);
  tx = await sideText();
  ok(!/PDF 는 글자층에서|유튜브 카드 · 키 바꿔 듣기 카드의 키|분석한 페이지에서 이동\(손바닥\)|고친 화음 · 코드는 팀 모두에게 자동으로 저장/.test(tx), '화음 탭: 긴 설명이 없음');
  await PV(() => YNPractice.current().P.showTab('together')); await sleep(500);
  tx = await sideText();
  ok(!/켜면 다른 사람이 넘기는 페이지/.test(tx), '함께 탭: 혼자 보기 긴 설명이 없음');

  /* ---- 메트로놈: 시작 · BPM −/+ · TAP · 박 동그라미가 한 줄 ---- */
  await page.evaluate(() => YNPractice.current().P.showTab('metro')); await sleep(500);
  const row = await page.evaluate(() => { const pane = [...document.querySelectorAll('.pv-panes > *')].find((x) => x.offsetParent !== null); const g = (s) => { const n = pane.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height) }; };
    return { go: g('.pv-mgo'), minus: g('[data-a="b-"]'), bpm: g('.pv-bpm'), plus: g('[data-a="b+"]'), tap: g('[data-a="tap"]'), dot: g('.pv-beat'), pane: g('.pv-metrosec'), sticky: !!pane.querySelector('.pv-mstick') }; });
  const mid = (x) => (x.t + x.b) / 2;
  ok(row.go && row.dot && ['minus', 'bpm', 'plus', 'tap', 'dot'].every((k) => row[k] && Math.abs(mid(row[k]) - mid(row.go)) < 10), '시작 · − · BPM · + · TAP · 박 동그라미가 한 줄', row);
  ok(row.go && row.go.h <= 48, '시작 버튼이 작아짐 (높이 48px 이하)', row.go);
  ok(row.dot && row.pane && row.dot.r <= row.pane.r + 1, '한 줄이 패널 폭 안에 들어감', { dot: row.dot, pane: row.pane });
  ok(!row.sticky, '예전 큰 시작 막대는 없음');
  await page.evaluate(() => { const pane = [...document.querySelectorAll('.pv-panes > *')].find((x) => x.offsetParent !== null); pane.querySelector('.pv-mgo').click(); }); await sleep(400);
  const run1 = await page.evaluate(() => { const b = [...document.querySelectorAll('.pv-mgo')].find((x) => x.offsetParent !== null); return { t: b.textContent, a: b.getAttribute('aria-label'), on: b.classList.contains('on') }; });
  ok(run1.on && run1.t === '■' && run1.a === '멈춤', '누르면 시작 (■ · 멈춤 표시)', run1);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.pv-mgo')].find((x) => x.offsetParent !== null); b.click(); }); await sleep(400);
  const run2 = await page.evaluate(() => { const b = [...document.querySelectorAll('.pv-mgo')].find((x) => x.offsetParent !== null); return { t: b.textContent, on: b.classList.contains('on') }; });
  ok(!run2.on && run2.t === '▶', '다시 누르면 멈춤 (▶)', run2);

  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
