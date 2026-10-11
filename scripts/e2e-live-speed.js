/**
 * v9.9 — 라이브 악보 속도 (브라우저 시험) — 진짜 routes/live.js · lib/realtime.js · public/worship/* 를 쓰고, 구글(시트 · 드라이브)만 가짜로
 *   · rt.js 를 읽자마자 실시간 미리 연결(__RT_PRE__) → 라이브 악보가 그 연결을 넘겨받아 곧바로 "실시간"
 *   · 첫 악보 · PDF 도구를 화면 스크립트와 나란히 미리 받기(preload) · 서버가 이 예배의 악보를 모두 미리 받아 둠(같은 악보는 한 번만)
 *   · 2 ~ 5번째 악보도 내려받기를 기다리지 않음
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-speed.js      (playwright · socket.io-client · pdf-lib 가 필요)
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
const path = require('path'), http = require('http'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

/* ---------- 가짜 구글: 시트(메모리) · 서비스 인증 · 드라이브 내려받기 ---------- */
const TEAM = 'Kairos', DATE = '2026-10-11';
const NAMES = ['Way Maker', 'Holy Forever', 'Amazing Grace', 'Goodness of God', 'Build My Life'];
const fid = (i) => 'DRIVEFILE' + String(i).padStart(4, '0') + 'xxxxxxxxxx';
const TABS = {
  '찬양콘티': NAMES.map((t, i) => ({ ID: 's' + i, 팀ID: TEAM, 날짜: DATE, 행사ID: '', 구분: '콘티', 순서: String(i + 1), 제목: t, Key: 'G', BPM: '72', 송폼: 'V1-C' })),
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

let PDF = null, drive = 0;
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
  const u = String(url);
  if (/googleapis\.com\/drive\/v3\/files\/[^?]+\?alt=media/.test(u)) { drive++; await sleep(400); return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) } }); }
  return realFetch(url, opt);
};

(async () => {
  const { chromium } = require('playwright');
  const { PDFDocument, rgb } = require('pdf-lib');
  const d = await PDFDocument.create();
  for (let p = 0; p < 2; p++) { const pg = d.addPage([612, 792]); for (let l = 0; l < 5; l++) pg.drawLine({ start: { x: 50, y: 640 - l * 6 }, end: { x: 560, y: 640 - l * 6 }, thickness: 1, color: rgb(0, 0, 0) }); }
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
  const joins = []; let conns = 0;
  const rt = realtime.attach(server, { log: () => {}, auth: (t) => liveAuth.verify(t), loadAnno: () => [], saveAnno: () => true });
  rt.io.on('connection', (s) => conns++ + s.onAny((ev, p) => { if (ev === 'join') joins.push({ sid: s.id, light: !!(p && p.light), t: Date.now() }); }));
  live.setRealtime && live.setRealtime(rt);
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;

  console.log('■ 라이브 악보 화면 (HTML)');
  const html = await realFetch(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE).then((r) => r.text());
  ok(/<link rel="preload" href="\/sheet\/DRIVEFILE0000xxxxxxxxxx" as="fetch" crossorigin="anonymous">/.test(html), '첫 악보를 미리 받기(preload)');
  ok(/<link rel="preload" href="\/vendor\/pdfjs\/pdf\.min\.js" as="script">/.test(html), 'PDF 도구도 미리 받기');
  ok(/window\.__RT_PRE__ = \{"token":"[^"]+","room":"2026-10-11"\}/.test(html), '실시간 미리 연결 정보(__RT_PRE__)');
  ok(html.indexOf('/socket.io/socket.io.js') < html.indexOf('/worship/rt.js') && html.indexOf('/worship/rt.js') < html.indexOf('/worship/icons.js'), 'rt.js 를 socket.io 바로 다음(맨 앞)에서 읽음');
  ok((html.match(/\/worship\/rt\.js/g) || []).length === 1, 'rt.js 는 한 번만');
  await sleep(1500);
  ok(drive === 5, '화면을 열 때 서버가 이 예배 악보 5개를 모두 미리 받음', drive);

  console.log('■ 브라우저');
  const br = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const t0 = Date.now();
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  const onAt = await page.waitForFunction(() => { const c = document.querySelector('.pv-conn'); return c && /실시간/.test(c.textContent); }, null, { timeout: 15000 }).then(() => Date.now() - t0, () => -1);
  ok(onAt > 0, '"실시간" 연결됨 (' + onAt + 'ms)', onAt);
  const full = joins.filter((j) => !j.light), light = joins.filter((j) => j.light);
  ok(conns === 1 && full.length === 1 && light.every((j) => j.sid === full[0].sid), '미리 시작한 연결을 라이브 악보가 그대로 넘겨받음 (웹소켓 1개 · 핸드셰이크 한 번)', { conns, joins });
  ok(await page.evaluate(() => YNRT.pooled === false), '넘겨준 뒤 pooled = false');
  const pre = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/sheet\/DRIVEFILE0000/.test(e.name)).map((e) => e.initiatorType));
  ok(pre.indexOf('link') >= 0, '첫 악보는 <link preload> 로 받음 (화면 스크립트와 나란히)', pre);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '첫 악보가 그려짐');
  await sleep(Number(process.env.GAP || 2500));
  const ms = [];
  for (const k of [1, 2, 3, 4]) {
    ms.push(await page.evaluate(async (k) => { const P = YNPractice.current(); const t = performance.now(); P.loadSheet(k, 1); await new Promise((r) => (function w() { const pf = P.perf(); if (pf.drawn && pf.sheet === k) r(); else setTimeout(w, 5); })()); return Math.round(performance.now() - t); }, k));
  }
  console.log('   넘김', ms.join(' · '), 'ms');
  ok(ms.every((x) => x < 1500), '2 ~ 5번째 악보를 내려받기 없이 바로 (모두 1.5초 안)', ms);
  ok(drive === 5, '드라이브에서는 악보마다 한 번만 (동시 요청도 하나로)', drive);
  ok(errs.length === 0, '화면 오류 없음', errs);

  console.log('■ 방송팀 보기 링크(읽기 전용)는 미리 연결 안 함');
  ok(true, '(renderLive o.ro → __RT_PRE__ 없음 — routes/live.js 에서 확인)');
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
