/**
 * v9.16 — 라이브 악보: 올가미(lasso) 선택 · 위 막대 다이어트 · 폰 전용 모드 · 메트로놈 켜기/끄기 · 유튜브 아이콘 (브라우저 시험)
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
  await page.waitForFunction(() => { const c = document.querySelector('.pv-conn'); return c && /실시간/.test(c.textContent); }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => { const b = document.querySelector('.pv-metbtn'); return b && b.style.display !== 'none'; }, null, { timeout: 8000 }).catch(() => {});

  console.log('■ 위 막대 — 크기마다 겹침 · 줄바꿈 · 넘침 없음');
  const measure = () => page.evaluate(() => {
    const top = document.querySelector('.pv-top'), tr = top.getBoundingClientRect(), kids = [];
    const vis = (n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden'; };
    (function w(x) { for (const c of x.children) { const s = getComputedStyle(c); if (s.display === 'contents') { w(c); continue; } if (!vis(c)) continue; if (c.matches('.pv-grp')) w(c); else kids.push(c); } })(top);
    const boxes = kids.map((n) => { const r = n.getBoundingClientRect(); return { c: String(n.className).split(' ').slice(0, 2).join('.') + (n.dataset && n.dataset.a ? '[' + n.dataset.a + ']' : ''), l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; });
    const over = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) over.push(a.c + ' × ' + b.c); }
    const cy = tr.top + tr.height / 2, wrapped = [];
    top.querySelectorAll('.pv-chip, .pv-b, .pv-pg, .pv-sel').forEach((n) => { if (!vis(n)) return; const tw = document.createTreeWalker(n, NodeFilter.SHOW_TEXT), tops = []; let tn; while ((tn = tw.nextNode())) { if (!tn.textContent.trim() || !vis(tn.parentElement)) continue; const rg = document.createRange(); rg.selectNodeContents(tn); Array.from(rg.getClientRects()).forEach((q) => { if (q.width > 1) tops.push(q.top); }); } if (tops.length && Math.max(...tops) - Math.min(...tops) > 6) wrapped.push(String(n.className)); });
    return { over, wrapped, offRow: boxes.filter((b) => Math.abs((b.t + b.b) / 2 - cy) > 8).map((b) => b.c), tall: boxes.filter((b) => b.h > 46).map((b) => b.c), clipped: boxes.filter((b) => b.r > innerWidth + 1 || b.l < -1).map((b) => b.c), scroll: top.scrollWidth - top.clientWidth, h: Math.round(tr.height), names: boxes.map((b) => b.c), compact: document.querySelector('.pv').classList.contains('pv-compact') };
  });
  for (const [w, h, lay] of [[390, 844], [375, 667], [820, 1180, 'tablet'], [1180, 820, 'tablet'], [1024, 768], [1280, 800, 'computer'], [1440, 900, 'computer']]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(300);
    if (lay) await page.evaluate((l) => YNPractice.current().P.setLayout(l), lay);
    await sleep(400);
    const m = await measure();
    console.log('   ' + w + '×' + h + (lay ? ' ' + lay : '') + ' → ' + m.h + 'px · ' + m.names.join(' '));
    ok(!m.over.length && !m.offRow.length && !m.tall.length && !m.clipped.length && !m.wrapped.length && m.scroll <= 1 && m.h <= 66, w + '×' + h + ': 겹침 · 줄바꿈 · 잘림 · 넘침 없음 (한 줄)', m);
    if (w <= 400) ok(m.compact && !m.names.some((n) => /pv-ytbtn|pv-fsbtn|pv-chip|pv-themebtn|pv-panelbtn|pv-morebtn|\[zfit\]/.test(n)) && m.names.some((n) => /pv-metbtn/.test(n)) && m.names.some((n) => /pv-menubtn/.test(n)) && m.names.some((n) => /pv-songpill/.test(n)), w + ': 폰 모드 — 닫기 · 악보 알약 · 쪽 · (요청) · 메트로놈 · ⋯ 만', m.names);
  }

  console.log('■ 폰: ⋯ 서랍');
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(500);
  await page.click('.pv-menubtn'); await sleep(350);
  ok(await page.evaluate(() => { const a = document.querySelector('.pv-drawer .pv-ds-acts'); const v = (q) => { const n = a && a.querySelector(q); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 10 && r.height > 10; }; return v('.pv-songsel') && v('.pv-ytbtn') && v('.pv-fsbtn') && v('.pv-themebtn') && v('.pv-flt[data-k="metro"]'); }), '서랍 「더 보기」: 이 쪽의 곡 · 유튜브 · 전체 화면 · 밝기 · 떠 있는 창');
  await page.click('.pv-dclose'); await sleep(300);

  console.log('■ 컴퓨터: 알약 · ⋯ 메뉴 · 메트로놈 · 유튜브');
  await page.setViewportSize({ width: 1280, height: 800 }); await page.evaluate(() => YNPractice.current().P.setLayout('computer')); await sleep(600);
  ok(await page.evaluate(() => { const p = document.querySelector('.pv-top .pv-songpill'); return !!p && !!p.querySelector('.pv-sheetsel') && !!p.querySelector('.pv-songsel'); }), '악보 · 이 쪽의 곡이 알약 하나');
  ok(await page.evaluate(() => document.querySelector('.pv-top .pv-pager').getBoundingClientRect().width <= 120), '쪽 넘기기는 작게 (≤ 120px)');
  ok(await page.evaluate(() => ['.pv-themebtn', '.pv-flt'].every((q) => { const n = document.querySelector(q); return !n || !n.closest('.pv-top'); })), '밝기 · 떠 있는 창 단추는 위 막대가 아니라 ⋯ 안');
  await page.click('.pv-morebtn'); await sleep(300);
  ok(await page.evaluate(() => { const m = document.querySelector('.pv-morepop'); const v = (q) => { const n = m.querySelector(q); return !!n && n.getBoundingClientRect().height > 10; }; return v('.pv-themebtn') && v('.pv-flt[data-k="form"]') && v('[data-layout="tablet"]'); }), '⋯ → 메뉴 (밝기 · 떠 있는 창 · 화면 배치)');
  const th0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'dark');
  await page.click('.pv-morepop .pv-themebtn'); await sleep(300);
  ok(await page.waitForFunction((t) => (document.documentElement.getAttribute('data-theme') || 'dark') !== t, th0, { timeout: 4000 }).then(() => true, () => false), '⋯ 메뉴의 밝기 단추 동작');
  await page.click('.pv-morepop .pv-themebtn'); await sleep(200);
  await page.mouse.click(500, 500); await sleep(200);
  ok(await page.evaluate(() => !document.querySelector('.pv').classList.contains('pv-moreopen')), '바깥을 누르면 메뉴 닫힘');
  ok(await page.evaluate(() => { const b = document.querySelector('.pv-top .pv-ytbtn'); if (!b || getComputedStyle(b).display === 'none') return false; const r = b.querySelector('svg rect'), p = b.querySelector('svg path'); return /#ff0000/i.test(r.getAttribute('fill')) && +r.getAttribute('rx') > 0 && /#fff/i.test(p.getAttribute('fill')) && !b.querySelector('img'); }), '유튜브 단추 = 빨간 둥근 네모 + 흰 ▶ (SVG, 외부 그림 없음)');
  ok(await page.evaluate(() => { const b = document.querySelector('.pv-top .pv-metbtn'); return !!b && getComputedStyle(b).display !== 'none' && !!b.querySelector('svg.yi-metronome') && /72/.test(b.textContent); }), '메트로놈 단추: 아이콘 + BPM');
  await page.click('.pv-top .pv-metbtn');
  ok(await page.waitForFunction(() => { const b = document.querySelector('.pv-metbtn'); return b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true'; }, null, { timeout: 3000 }).then(() => true, () => false), '누르면 메트로놈 켜짐');
  await page.click('.pv-top .pv-metbtn');
  ok(await page.waitForFunction(() => !document.querySelector('.pv-metbtn').classList.contains('on'), null, { timeout: 3000 }).then(() => true, () => false), '다시 누르면 꺼짐');
  ok(await page.evaluate(() => { const b = document.querySelector('.pv-msgbtn'); return !b || !!b.closest('.pv-top'); }), '방송팀 요청 단추는 위 막대에 그대로');

  console.log('■ 올가미');
  const geo = await page.evaluate(() => { const cv = document.querySelector('.pv-anno'), c = cv.getBoundingClientRect(), s = document.querySelector('.pv-stage').getBoundingClientRect(); const x0 = Math.max(c.left, s.left, 0), y0 = Math.max(c.top, s.top, 0), x1 = Math.min(c.right, s.right, innerWidth), y1 = Math.min(c.bottom, s.bottom, innerHeight); return { c: { l: c.left, t: c.top, w: c.width, h: c.height }, cw: cv.clientWidth, ch: cv.clientHeight, v: { x0: (x0 - c.left) / c.width, y0: (y0 - c.top) / c.height, x1: (x1 - c.left) / c.width, y1: (y1 - c.top) / c.height } }; });
  const V = geo.v, at = (fx, fy) => [V.x0 + (V.x1 - V.x0) * fx, V.y0 + (V.y1 - V.y0) * fy], px = (p) => [geo.c.l + p[0] * geo.c.w, geo.c.t + p[1] * geo.c.h];
  const sx = geo.c.w / geo.cw, sy = geo.c.h / geo.ch;                                  // 캔버스 CSS px → 화면 px
  async function stroke(pts) { const a = px(pts[0]); await page.mouse.move(a[0], a[1]); await page.mouse.down(); for (let i = 1; i < pts.length; i++) { const q = px(pts[i]); await page.mouse.move(q[0], q[1], { steps: 5 }); } await page.mouse.up(); await sleep(120); }
  const items = () => page.evaluate(() => YNPractice.current().P.anno().items('team').map((i) => JSON.parse(JSON.stringify(i))));
  await page.evaluate(() => YNPractice.current().P.setTool('pen')); await sleep(150);
  await stroke([at(0.30, 0.40), at(0.36, 0.44), at(0.42, 0.40)]);
  await stroke([at(0.30, 0.52), at(0.42, 0.55)]);
  await stroke([at(0.80, 0.85), at(0.88, 0.88)]);                                        // 고리 바깥
  await page.evaluate(([x, y]) => { YNPractice.current().P.anno().pasteText('가사 메모', { x, y }); }, at(0.33, 0.62));
  const i0 = await items(), outside = i0.find((i) => i.t === 'pen' && i.p[0] > at(0.7, 0)[0]);
  ok(i0.length === 4 && !!outside, '필기 4개 (펜 3 · 글자 1)', i0.map((i) => i.t));
  await page.evaluate(() => YNPractice.current().P.setTool('lasso')); await sleep(150);
  ok(await page.evaluate(() => !!document.querySelector('.pv-tools [data-tool="lasso"] svg.yi-lasso')), '도구 막대에 올가미');
  const loop = [at(0.24, 0.32), at(0.50, 0.30), at(0.55, 0.50), at(0.50, 0.72), at(0.24, 0.72), at(0.20, 0.50), at(0.24, 0.33)];
  await stroke(loop);
  ok(await page.evaluate(() => YNPractice.current().P.anno().lassoCount()) === 3, '고리 안의 3개만 골라짐 (바깥 획 제외)');
  const g1 = await page.evaluate(() => YNPractice.current().P.anno().lassoGeom());
  const cx = geo.c.l + (g1.x + g1.w / 2) * sx, cy = geo.c.t + (g1.y + g1.h / 2) * sy;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy + 30, { steps: 8 }); await page.mouse.up(); await sleep(200);
  const i1 = await items(), by = (a, id) => a.find((x) => x.id === id), ndx = 60 / geo.c.w;
  ok(i0.filter((o) => o.id !== outside.id).every((o) => { const n = by(i1, o.id); return o.t === 'pen' ? Math.abs(n.p[0] - o.p[0] - ndx) < 0.01 : Math.abs(n.x - o.x - ndx) < 0.01; }), '끌면 3개가 함께 옮겨짐');
  ok(JSON.stringify(by(i1, outside.id).p) === JSON.stringify(outside.p), '바깥 획은 그대로');
  ok(i0.every((o) => Object.keys(by(i1, o.id)).every((k) => k in o || k === 'ts')), '저장 형식 그대로 (새 칸 없음)');
  await page.evaluate(() => YNPractice.current().P.anno().undo()); await sleep(150);
  const i2 = await items();
  ok(i0.every((o) => { const n = by(i2, o.id); return o.t === 'pen' ? JSON.stringify(n.p) === JSON.stringify(o.p) : n.x === o.x; }), '되돌리기 한 번에 3개 모두 제자리');
  await stroke(loop); await sleep(100);
  const g2 = await page.evaluate(() => YNPractice.current().P.anno().lassoGeom());
  await page.mouse.move(geo.c.l + g2.br.x * sx, geo.c.t + g2.br.y * sy); await page.mouse.down(); await page.mouse.move(geo.c.l + (g2.br.x + g2.w * 0.5) * sx, geo.c.t + (g2.br.y + g2.h * 0.5) * sy, { steps: 8 }); await page.mouse.up(); await sleep(200);
  const i3 = await items(), t0 = i0.find((i) => i.t === 'text');
  ok(by(i3, t0.id).sz > t0.sz * 1.2, '모서리를 끌면 함께 커짐', [t0.sz, by(i3, t0.id).sz]);
  await page.evaluate(() => YNPractice.current().P.anno().undo()); await sleep(100);
  await stroke(loop); await sleep(100);
  const g3 = await page.evaluate(() => YNPractice.current().P.anno().lassoGeom());
  await page.mouse.click(geo.c.l + g3.tr.x * sx, geo.c.t + g3.tr.y * sy); await sleep(200);
  ok((await items()).length === 1, '✕ 손잡이로 3개 지움');
  await page.evaluate(() => YNPractice.current().P.anno().undo()); await sleep(150);
  ok((await items()).length === 4, '되돌리기 한 번에 3개 모두 다시');
  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
