/**
 * V1300 — 라이브 악보: 클릭 · BPM 컨트롤 바 (브라우저 시험)
 *   진짜 routes/live.js · lib/realtime.js · public/worship/* 를 쓰고, 구글(시트 · 드라이브)만 가짜로 (e2e-live-speed.js 와 같은 방식)
 *   · 위 막대: 아이폰(390 · 375) · 아이패드(820 · 1180) · 컴퓨터(1024 · 1280 · 1440)에서 겹침 · 줄바꿈 · 잘림 · 넘침 없음
 *   · 폰: 닫기 · 악보 알약 · 쪽 · (방송팀 요청) · 메트로놈 · ⋯ 만 — 나머지는 ⋯ 서랍
 *   · ⋯ 메뉴(밝기 · 떠 있는 창 · 화면 배치) · 메트로놈 켜기/끄기 · 유튜브 빨간 아이콘
 *   · 올가미: 고리 안의 필기만 골라 함께 옮기기 · 크기 · 지우기 · 되돌리기 한 번에 · 저장 형식 그대로
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-lasso-header.js      (playwright · socket.io-client · pdf-lib 가 필요)
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
  await page.waitForFunction(() => window.YNClickDock && document.querySelector('.cd'), null, { timeout: 8000 }).catch(() => {});

  const P = () => 'YNPractice.current().P';
  const info = () => page.evaluate(() => {
    const d = document.querySelector('.cd'), r = d && d.getBoundingClientRect(), st = document.querySelector('.pv-stage').getBoundingClientRect(), main = document.querySelector('.pv-main').getBoundingClientRect();
    const vis = (q) => { const n = d && d.querySelector(q); if (!n || n.hidden) return false; const b = n.getBoundingClientRect(); return b.width > 2 && b.height > 2 && getComputedStyle(n).display !== 'none'; };
    return { exists: !!d, hidden: !d || d.hidden, cls: d ? d.className : '', top: r ? Math.round(r.top) : 0, bottom: r ? Math.round(r.bottom) : 0, h: r ? Math.round(r.height) : 0, mainBottom: Math.round(main.bottom), stageBottom: Math.round(st.bottom),
      ih: innerHeight, go: vis('.cd-go'), goH: d ? Math.round(d.querySelector('.cd-go').getBoundingClientRect().height) : 0, steps: vis('.cd-dn') && vis('.cd-up'), pop: vis('.cd-pop'), num: d ? d.querySelector('.cd-num b').textContent : '', running: d ? d.querySelector('.cd-go').classList.contains('on') : false };
  });

  console.log('■ 태블릿 세로 (820×1180) — 기본: 예배 모드에서만, 하단 바');
  await page.setViewportSize({ width: 820, height: 1180 }); await page.evaluate(() => YNPractice.current().P.setLayout('tablet')); await sleep(500);
  let m = await info();
  ok(m.exists && m.hidden, '예배 모드가 아니면 바가 안 보임 (기본값)', m);
  await page.evaluate(() => YNPractice.current().P.setWorship(true)); await sleep(500);
  m = await info();
  ok(!m.hidden && /cd-bar/.test(m.cls) && /cd-big/.test(m.cls) && /cd-lockbpm/.test(m.cls), '예배 모드 → 하단 바 · 크게 · 잠금형', m);
  ok(m.bottom <= m.ih + 1 && m.top >= m.mainBottom - 1 && m.stageBottom <= m.top + 1, '바는 화면 맨 아래, 악보 영역은 바 위에서 끝남 (겹침 없음)', m);
  if (process.env.INSPECT) console.log(await page.evaluate(() => { const out = []; for (const x of [100, 300, 600]) { const els = document.elementsFromPoint(x, innerHeight - 15); out.push(els.slice(0, 5).map((n) => n.tagName + '.' + String(n.className).slice(0, 40)).join(' > ')); } return out.join('\n'); }));
  if (process.env.SHOTDIR) { await page.click('.cd-go'); await sleep(300); await page.screenshot({ path: process.env.SHOTDIR + '/0-bar.png' }); await page.click('.cd-go'); await sleep(200); }
  ok(await page.evaluate(() => { const top = document.elementFromPoint(300, innerHeight - 15); return !!(top && top.closest('.cd')) && getComputedStyle(document.querySelector('.pv-side')).visibility === 'hidden'; }), '접힌 패널 시트가 바 뒤로 비치지 않음');
  ok(m.goH >= 56 && !m.steps && /72/.test(m.num), '큰 클릭 버튼 · −/+ 숨김 · BPM 72 표시', m);

  console.log('■ 멈춤은 한 번에');
  await page.click('.cd-go'); await sleep(250);
  ok((await info()).running, '한 번 누르면 클릭 시작');
  await page.click('.cd-go'); await sleep(250);
  ok(!(await info()).running, '한 번 더 누르면 바로 멈춤');
  const pg0 = await page.evaluate(() => YNPractice.current().P.page());
  for (let i = 0; i < 3; i++) { await page.click('.cd-go'); await sleep(120); }
  ok(await page.evaluate(() => YNPractice.current().P.page()) === pg0, '바를 눌러도 악보 페이지가 넘어가지 않음');
  await page.click('.cd-go'); await sleep(200);

  console.log('■ BPM 잠금형 — 숫자를 눌러야 열리고 3초 뒤 닫힘');
  await page.click('.cd-num'); await sleep(200);
  const SD = process.env.SHOTDIR; if (SD) await page.screenshot({ path: SD + '/1-pop.png' });
  ok((await info()).pop, '숫자 누르면 −5 −1 +1 +5 창 열림');
  await page.click('.cd-pop [data-d="5"]'); await sleep(150);
  await page.click('.cd-pop .cd-pup'); await sleep(150);
  m = await info(); ok(m.num === '78', 'BPM 72 → +5 → +1 = 78', m.num);
  ok(await page.evaluate(() => document.querySelector('.cd-num').classList.contains('chg') && /원래 72/.test(document.querySelector('.cd-note').textContent)), '바뀐 BPM 은 색 · 「원래 72」 표시');
  await sleep(3300);
  ok(!(await info()).pop, '손을 떼고 3초 뒤 자동으로 닫힘');
  await page.click('.cd-num'); await sleep(150); await page.click('.cd-pop [data-p="reset"]'); await sleep(200);
  ok((await info()).num === '72', '「원래 72」 → 72 로 복귀');
  await page.click('.cd-num'); await sleep(100);

  console.log('■ 설정: 항상 표시 · 기본 크기 · 떠 있는 버튼 · 상단 바');
  await page.click('.cd-set'); await sleep(250);
  ok(await page.evaluate(() => !!document.querySelector('.cd-sheet')), '설정 창 열림');
  if (SD) await page.screenshot({ path: SD + '/2-settings.png' });
  await page.click('.cd-seg[data-g="bpm"] [data-v="show"]'); await page.click('.cd-seg[data-g="big"] [data-v="0"]'); await sleep(200);
  m = await info(); ok(m.steps && m.goH < 56 && /cd-showbpm/.test(m.cls), '항상 표시 → −/+ 보임 · 기본 크기', m);
  await page.click('.cd-seg[data-g="pos"] [data-v="float"]'); await sleep(400);
  if (SD) await page.screenshot({ path: SD + '/3-float.png' });
  m = await info(); ok(/cd-float/.test(m.cls) && m.stageBottom >= m.ih - 2, '떠 있는 버튼 → 악보는 화면 끝까지', m);
  await page.click('.cd-sheet [data-x="1"]'); await sleep(150);
  await page.evaluate(() => YNPractice.current().P.metroKey('bpm', 150 - YNPractice.current().P.curBpm())); await sleep(200);
  const oneLine = () => page.evaluate(() => { const b = document.querySelector('.cd-nv b'), sm = document.querySelector('.cd-nv small'); return { t: b.textContent, h: Math.round(b.getBoundingClientRect().height), sh: Math.round(sm.getBoundingClientRect().height), fits: document.querySelector('.cd-num').scrollWidth <= document.querySelector('.cd-num').clientWidth + 1 }; });
  let ol = await oneLine(); ok(ol.t === '150' && ol.h < 34 && ol.sh < 18 && ol.fits, '떠 있는 버튼: 세 자리 BPM 이 한 줄 (BPM 글자도 한 줄)', ol);
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('yn.cdock')); c.bpm = 'lock'; c.big = true; localStorage.setItem('yn.cdock', JSON.stringify(c)); });
  await page.evaluate(() => YNPractice.current().P.clickDock.open()); await page.click('.cd-seg[data-g="bpm"] [data-v="lock"]'); await page.click('.cd-seg[data-g="big"] [data-v="1"]'); await page.click('.cd-sheet [data-x="1"]'); await sleep(200);
  ol = await oneLine(); ok(ol.h < 34 && ol.fits, '잠금형 · 크게에서도 세 자리 한 줄', ol);
  const g0 = await page.evaluate(() => { const g = document.querySelector('.cd-grip').getBoundingClientRect(); return { x: g.left + g.width / 2, y: g.top + g.height / 2 }; });
  await page.mouse.move(g0.x, g0.y); await page.mouse.down(); await page.mouse.move(g0.x - 300, g0.y - 500, { steps: 8 }); await page.mouse.up(); await sleep(200);
  const moved = await page.evaluate(() => { const r = document.querySelector('.cd').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), saved: !!localStorage.getItem('yn.cdock.pos') }; });
  ok(moved.saved && moved.t < 700 && moved.l < 300, '손잡이를 끌면 떠 있는 버튼이 옮겨지고 자리가 기억됨', moved);
  if (SD) await page.screenshot({ path: SD + '/3b-moved.png' });
  await page.click('.cd-num'); await sleep(200);
  ok(await page.evaluate(() => { const p = document.querySelector('.cd-pop').getBoundingClientRect(); return p.left >= 0 && p.right <= innerWidth && p.top >= 0; }), '옮긴 자리에서도 BPM 창이 화면 안에 열림');
  await page.click('.cd-num'); await sleep(150);
  await page.setViewportSize({ width: 1180, height: 820 }); await sleep(400);
  ok(await page.evaluate(() => { const r = document.querySelector('.cd').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0; }), '화면을 돌려도 화면 안에 남음');
  await page.setViewportSize({ width: 820, height: 1180 }); await sleep(300);
  await page.evaluate(() => YNPractice.current().P.clickDock.open()); await page.click('[data-k="repos"]'); await sleep(150);
  ok(await page.evaluate(() => !localStorage.getItem('yn.cdock.pos') && !document.querySelector('.cd').style.top), '「자리 처음으로」 → 오른쪽 아래');
  await page.click('.cd-seg[data-g="bpm"] [data-v="show"]'); await page.click('.cd-seg[data-g="big"] [data-v="0"]'); await sleep(100);
  await page.evaluate(() => YNPractice.current().P.metroKey('bpm', 72 - YNPractice.current().P.curBpm())); await sleep(100);
  await page.click('.cd-seg[data-g="pos"] [data-v="float"]'); await sleep(200);
  await page.click('.cd-seg[data-g="pos"] [data-v="top"]'); await sleep(300);
  m = await info(); ok(m.hidden && await page.evaluate(() => [...document.querySelectorAll('.pv-top .cd-hst')].filter((b) => getComputedStyle(b).display !== 'none').length === 2), '상단 바 → 바 숨김 · 위 막대 클릭 옆에 −/+', m);
  await page.click('.cd-seg[data-g="pos"] [data-v="bar"]'); await page.click('.cd-seg[data-g="show"] [data-v="always"]'); await page.click('.cd-seg[data-g="auto"] [data-v="1"]'); await sleep(200);
  await page.click('.cd-sheet [data-x="1"]'); await sleep(200);
  ok(await page.evaluate(() => [...document.querySelectorAll('.pv-top .cd-hst')].every((b) => getComputedStyle(b).display === 'none')), '아래 바로 돌아오면 위 막대 −/+ 는 숨김');
  ok(await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('yn.cdock')); return c.pos === 'bar' && c.show === 'always' && c.bpm === 'show' && c.big === false && c.auto === true; }), '설정이 이 기기에 저장됨');

  console.log('■ 곡이 바뀌면 멈춤 (선택)');
  await page.click('.cd-go'); await sleep(200);
  await page.evaluate(() => YNPractice.current().P.setSong(1)); await sleep(400);
  ok(!(await info()).running, '「곡이 바뀌면 클릭 멈춤」 → 다음 곡으로 가면 멈춤');

  console.log('■ 단축키 끄기 · 클릭 페달');
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('yn.cdock')); c.keys = false; localStorage.setItem('yn.cdock', JSON.stringify(c)); });
  await page.evaluate(() => YNPractice.current().P.clickDock.open()); await sleep(150);
  await page.click('.cd-seg[data-g="keys"] [data-v="0"]'); await page.click('[data-k="learn"]'); await sleep(100);
  await page.keyboard.press('KeyK'); await sleep(150);
  ok(await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('yn.cdock')); return c.pkey && c.pkey.c === 'KeyK'; }), '클릭 페달 키 맞추기 (K)');
  await page.click('.cd-sheet [data-x="1"]'); await sleep(150);
  await page.keyboard.press('Space'); await sleep(200);
  ok(!(await info()).running, '단축키 끄기 → Space 로 클릭이 켜지지 않음');
  await page.keyboard.press('KeyK'); await sleep(450);
  ok((await info()).running, '클릭 페달(K) → 시작');
  await page.keyboard.press('KeyK'); await sleep(350);
  ok(!(await info()).running, '클릭 페달(K) → 멈춤');

  console.log('■ 클릭 탭 — 세 자리 BPM 이 잘리지 않음');
  await page.evaluate(() => { const P = YNPractice.current().P; P.showTab('metro'); }); await sleep(500);
  await page.evaluate(() => { const i = document.querySelector('.pv-pane[data-pane="metro"] .pv-bpm'); i.value = '150'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(300);
  if (process.env.SHOTDIR) await page.screenshot({ path: process.env.SHOTDIR + '/5-tab.png' });
  ok(await page.evaluate(() => { const i = document.querySelector('.pv-pane[data-pane="metro"] .pv-bpm'); if (!i) return false; const c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(i); c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; return c.measureText('300').width <= i.clientWidth - 4; }), '클릭 탭 BPM 칸에 300 까지 다 보임');
  await page.evaluate(() => YNPractice.current().P.showTab('metro'));

  console.log('■ 폰 · 밝은 화면에서도');
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  m = await info(); ok(!m.hidden && m.bottom <= m.ih + 1 && await page.evaluate(() => { const d = document.querySelector('.cd'); return d.scrollWidth <= d.clientWidth + 1; }), '폰: 바가 넘치지 않음', m);
  ok(!errs.length, '페이지 오류 없음', errs);
  await page.screenshot({ path: process.env.SHOT || '/tmp/cd.png' });
  await br.close(); server.close();
  console.log('\n' + pass + ' 통과 · ' + fail + ' 실패'); if (fail) { console.log(fails.join('\n')); process.exit(1); } process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
