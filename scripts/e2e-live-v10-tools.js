/**
 * 라이브 악보 v10 — 형광펜(글자 밑 · 곱하기) · 색 · 굵기 창 · 글자 바탕/테두리 · 코드 도구 정리 · 기호+음표 팔레트 (브라우저 시험)
 *   진짜 routes/live.js · lib/realtime.js · public/worship/* 를 쓰고, 구글(시트 · 드라이브)만 가짜로 (e2e-live-lasso-header.js 와 같은 방식)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-v10-tools.js      (playwright · sharp · pdf-lib 가 필요)
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
  ok(/\/worship\/toolpop\.css/.test(html) && /\/worship\/anno\.js[^"]*"><\/script>\s*<script defer src="\/worship\/toolpop\.js/.test(html), 'toolpop.css · toolpop.js 를 읽음 (anno.js 다음)');

  const br = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '0'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  await page.waitForFunction(() => { const c = document.querySelector('.pv-conn'); return c && /실시간/.test(c.textContent); }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => { const b = document.querySelector('.pv-metbtn'); return b && b.style.display !== 'none'; }, null, { timeout: 8000 }).catch(() => {});

  const P = () => 'YNPractice.current().P';
  const sharp = require('sharp');
  async function shot(clip) { const buf = await page.screenshot({ clip }); const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height, ch: info.channels, at(x, y) { const i = (Math.round(y) * info.width + Math.round(x)) * info.channels; return [data[i], data[i + 1], data[i + 2]]; } }; }
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const st = () => page.evaluate(() => YNPractice.current().P.anno().state());

  console.log('■ 도구 막대 — 코드 도구 없음 · 기호와 음표 하나로 · 색 단추 늘 보임');
  await page.setViewportSize({ width: 1280, height: 800 }); await page.evaluate(() => YNPractice.current().P.setLayout('computer')); await sleep(500);
  const tb = await page.evaluate(() => Array.from(document.querySelectorAll('.pv-tools [data-tool]')).map((b) => b.dataset.tool));
  ok(!tb.includes('chord') && !tb.includes('note') && tb.includes('sym') && tb.includes('text'), '도구: 코드 · 음표 단추가 없고 「기호 · 음표」 하나', tb);
  if (await page.evaluate(() => document.querySelector('.pv').classList.contains('pv-toolshide'))) { await page.click('.pv-toolsbtn'); await sleep(300); }
  await page.evaluate(() => YNPractice.current().P.setTool('pen')); await sleep(150);
  ok(await page.evaluate(() => { const b = document.querySelector('.pv-tools [data-a="style"]'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 10 && r.height > 10 && getComputedStyle(b).display !== 'none'; }), '펜: 색 단추가 보임 (더 보기를 펼치지 않아도)');

  console.log('■ 형광펜 — 악보 글자 밑에 (곱하기)');
  await page.evaluate(() => YNPractice.current().P.anno().setVisible('team', true));
  const pb = await page.evaluate(() => { const c = document.querySelector('.pv-anno').getBoundingClientRect(), s = document.querySelector('.pv-stage').getBoundingClientRect(); const l = Math.max(c.left, s.left), t = Math.max(c.top, s.top), r = Math.min(c.right, s.right), b = Math.min(c.bottom, s.bottom); return { x: Math.ceil(l), y: Math.ceil(t), width: Math.floor(r - l), height: Math.floor(b - t) }; });
  const s0 = await shot(pb), cx0 = Math.round(pb.width / 2);
  let yd = -1, best = 999;
  for (let y = 4; y < s0.h - 4; y++) { const L = lum(s0.at(cx0, y)); if (L < 110) { let yy = y, mn = L; while (yy + 1 < s0.h && lum(s0.at(cx0, yy + 1)) < 110) { yy++; mn = Math.min(mn, lum(s0.at(cx0, yy))); } let k = y; for (let q = y; q <= yy; q++) if (lum(s0.at(cx0, q)) === mn) k = q; yd = k; best = mn; break; } }
  let yw = -1; if (yd > 0) for (let y = yd + 2; y < s0.h; y++) { if (lum(s0.at(cx0, y)) > 245) { yw = y + 1; break; } }
  ok(yd > 0 && yw > 0, '악보의 검은 줄 · 흰 칸 찾음', { yd, yw, best });
  await page.evaluate(() => { const P = YNPractice.current().P; P.setTool('hl'); P.anno().setWidth(0.04); }); await sleep(150);
  const ym = pb.y + (yd + yw) / 2;
  await page.mouse.move(pb.x + cx0 - 120, ym); await page.mouse.down(); await page.mouse.move(pb.x + cx0 + 120, ym, { steps: 12 }); await page.mouse.up(); await sleep(400);
  const hlItem = (await page.evaluate(() => YNPractice.current().P.anno().items('team').filter((i) => i.t === 'hl')))[0];
  ok(!!hlItem, '형광펜 획이 저장됨');
  const layer = await page.evaluate(() => { const h = document.querySelector('.pv-pagebox .yn-hlink'), a = document.querySelector('.pv-anno'); return h ? { blend: getComputedStyle(h).mixBlendMode, vis: getComputedStyle(h).display, before: h.nextElementSibling === a, w: h.width } : null; });
  ok(!!layer && layer.blend === 'multiply' && layer.vis !== 'none' && layer.before && layer.w > 0, '형광펜 층: 필기 캔버스 바로 밑 · mix-blend-mode multiply', layer);
  const mainHas = await page.evaluate(([fx, fy]) => { const a = document.querySelector('.pv-anno'), r = a.getBoundingClientRect(); const x = Math.round((fx - r.left) / r.width * a.width), y = Math.round((fy - r.top) / r.height * a.height); return a.getContext('2d').getImageData(x, y, 1, 1).data[3]; }, [pb.x + cx0, ym]);
  ok(mainHas === 0, '필기 캔버스에는 형광펜을 그리지 않음 (형광펜 층에만)', mainHas);
  const s1 = await shot(pb), d0 = lum(s0.at(cx0, yd)), d1 = lum(s1.at(cx0, yd)), w1 = s1.at(cx0, yw);
  ok(d1 <= d0 + 12, '형광펜 밑의 검은 줄이 흐려지지 않음 (밝기 ' + Math.round(d0) + ' → ' + Math.round(d1) + ')', { d0, d1 });
  ok(w1[0] > 200 && w1[1] > 190 && w1[2] < w1[1] - 50, '흰 종이는 노랗게 칠해짐', w1);
  await page.evaluate(() => YNPractice.current().P.setTool('pen')); await sleep(100);
  const hlSig = await page.evaluate(() => { const h = document.querySelector('.yn-hlink'); h.__mark = 1; return h.width; });
  await page.mouse.move(pb.x + 60, pb.y + pb.height - 60); await page.mouse.down(); await page.mouse.move(pb.x + 200, pb.y + pb.height - 40, { steps: 10 }); await page.mouse.up(); await sleep(250);
  ok(await page.evaluate((w) => { const h = document.querySelector('.yn-hlink'); return !!h && h.__mark === 1 && h.width === w; }, hlSig), '펜을 그어도 형광펜 층은 그대로 (다시 만들지 않음)');
  await page.evaluate(() => YNPractice.current().P.anno().undo()); await sleep(100);
  await page.evaluate(() => YNPractice.current().P.anno().undo()); await sleep(250);
  ok(await page.evaluate(() => { const h = document.querySelector('.yn-hlink'); return !h || (getComputedStyle(h).display === 'none' && h.width === 0); }), '형광펜이 없으면 층 캔버스를 비움 (메모리 0)');

  console.log('■ 색 · 굵기 창');
  await page.evaluate(() => YNPractice.current().P.setTool('pen')); await sleep(150);
  await page.click('.pv-tools [data-a="style"]'); await sleep(250);
  const pop = await page.evaluate(() => { const p = document.querySelector('.tp-pop'); if (!p || p.hidden) return null; const r = p.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sw: p.querySelectorAll('.tp-sws:not(.tp-rec) .tp-sw:not(.tp-cust)').length, wp: p.querySelectorAll('.tp-wp').length, cust: !!p.querySelector('input[type=color]') }; });
  ok(!!pop && pop.sw >= 16 && pop.wp >= 6 && pop.cust, '펜: 16색 + 직접 고르기 + 굵기 6단계', pop);
  ok(!!pop && pop.l >= 0 && pop.t >= 0 && pop.r <= 1280 && pop.b <= 800, '창이 화면 안에', pop);
  await page.screenshot({ path: '/tmp/claude-0/shot-pen.png' });
  await page.click('.tp-pop [data-col="#0d9488"]'); await sleep(120);
  ok((await st()).color === '#0d9488', '추가 색(청록) 고르면 펜 색이 바뀜');
  await page.click('.tp-pop .tp-wp >> nth=0'); await sleep(120);
  ok(Math.abs((await st()).pw - 0.0006) < 1e-9, '아주 가는 펜 (0.0006)', (await st()).pw);
  await page.evaluate(() => YNPractice.current().P.setTool('hl')); await sleep(150);
  ok(await page.evaluate(() => { const p = document.querySelector('.tp-pop'); return !p.hidden && /형광펜/.test(p.textContent) && p.querySelectorAll('.tp-sws:not(.tp-rec) .tp-sw:not(.tp-cust)').length >= 10; }), '형광펜으로 바꾸면 창도 형광펜 10색으로');
  await page.mouse.click(30, 780); await sleep(150);
  ok(await page.evaluate(() => document.querySelector('.tp-pop').hidden), '바깥을 누르면 창이 닫힘');

  console.log('■ 도구 막대를 접어도 색 · 굵기');
  await page.evaluate(() => YNPractice.current().P.setTool('pen')); await sleep(100);
  await page.click('.pv-tools [data-a="dockhide"]'); await sleep(300);
  ok(await page.evaluate(() => { const q = document.querySelector('.tp-qchip'); if (!q || q.hidden) return false; const r = q.getBoundingClientRect(); return r.width >= 40 && r.left >= 0 && r.top >= 0 && r.bottom <= innerHeight; }), '접으면 떠 있는 색 단추가 보임');
  await page.click('.tp-qchip'); await sleep(250);
  ok(await page.evaluate(() => !document.querySelector('.tp-pop').hidden), '떠 있는 단추로 색 · 굵기 창 열림');
  await page.keyboard.press('Escape'); await sleep(120);
  await page.click('.pv-toolsbtn'); await sleep(300);
  ok(await page.evaluate(() => document.querySelector('.tp-qchip').hidden), '도구 막대를 펴면 떠 있는 단추는 숨김');

  console.log('■ 글자 — 바탕 · 테두리 · 글꼴 (작은 화면에서도 화면 안)');
  await page.evaluate(() => YNPractice.current().P.setTool('text')); await sleep(150);
  await page.click('.pv-tools [data-a="style"]'); await sleep(200);
  ok(await page.evaluate(() => { const p = document.querySelector('.tp-pop'); return !!p.querySelector('select[data-tp="font"]') && !!p.querySelector('[data-tp="bg"]') && !!p.querySelector('[data-tp="bd"]'); }), '글자 창: 글꼴 · 크기 · 바탕 · 테두리');
  await page.click('.tp-pop [data-tp="bg"]'); await sleep(120);
  await page.click('.tp-pop [data-tp="bd"]'); await sleep(120);
  await page.click('.tp-pop [data-bd="#2563eb"]'); await sleep(120);
  await page.screenshot({ path: '/tmp/claude-0/shot-text.png' });
  const ts = await st();
  ok(/^#[0-9a-f]{6}$/.test(ts.textBg) && ts.textBd === '#2563eb', '바탕 켜기 · 테두리 파랑', ts);
  await page.keyboard.press('Escape'); await sleep(100);
  await page.mouse.click(pb.x + 220, pb.y + 260); await sleep(250);
  await page.keyboard.type('G/B'); await page.keyboard.press('Enter'); await sleep(250);
  const tx = (await page.evaluate(() => YNPractice.current().P.anno().items('team').filter((i) => i.t === 'text')))[0];
  ok(!!tx && tx.s === 'G/B' && tx.bg === ts.textBg && tx.bd === '#2563eb', '새 글자에 바탕 · 테두리가 저장됨', tx);
  const tpx = await shot({ x: pb.x + 200, y: pb.y + 220, width: 80, height: 60 });
  let blue = 0; for (let y = 0; y < tpx.h; y++) for (let x = 0; x < tpx.w; x++) { const c = tpx.at(x, y); if (c[2] > 180 && c[0] < 90) blue++; }
  ok(blue > 20, '화면에 파란 테두리가 그려짐', blue);
  await page.evaluate(() => YNPractice.current().P.setTool('select')); await sleep(100);
  await page.evaluate((id) => YNPractice.current().P.anno().select('team', id), tx.id); await sleep(100);
  await page.click('.pv-tools [data-a="style"]'); await sleep(200);
  await page.click('.tp-pop [data-tp="bd"]'); await sleep(150);
  ok(!(await page.evaluate((id) => YNPractice.current().P.anno().items('team').find((i) => i.id === id), tx.id)).bd, '선택한 글자의 테두리 끄기');
  await page.keyboard.press('Escape'); await sleep(100);
  for (const [w, h] of [[375, 667], [390, 844], [820, 1180]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(450);
    await page.evaluate(() => YNPractice.current().P.setTool('text')); await sleep(150);
    await page.evaluate(() => { const b = document.querySelector('.tp-qchip:not([hidden])') || document.querySelector('[data-a="style"]'); b.click(); }); await sleep(250);
    await page.screenshot({ path: '/tmp/claude-0/shot-text-' + w + '.png' });
    const r = await page.evaluate(() => { const p = document.querySelector('.tp-pop'), q = p.getBoundingClientRect(), s = p.querySelector('select[data-tp="font"]').getBoundingClientRect(); return { open: !p.hidden, l: q.left, r: q.right, t: q.top, b: q.bottom, sl: s.left, sr: s.right, W: innerWidth, H: innerHeight, sx: p.scrollWidth - p.clientWidth }; });
    ok(r.open && r.l >= 0 && r.r <= r.W + 0.5 && r.t >= 0 && r.b <= r.H + 0.5 && r.sl >= r.l && r.sr <= r.r && r.sx <= 1, w + '×' + h + ': 글꼴 · 크기 칸이 화면 밖으로 잘리지 않음', r);
    await page.keyboard.press('Escape'); await sleep(100);
  }
  await page.setViewportSize({ width: 1280, height: 800 }); await page.evaluate(() => YNPractice.current().P.setLayout('computer')); await sleep(500);

  console.log('■ 기호 · 음표 팔레트 — 하나로 · 끌어서 옮김 · 접힘');
  await page.evaluate(() => YNPractice.current().P.setTool('sym')); await sleep(300);
  const sp = await page.evaluate(() => { const p = document.querySelector('.pv-sympop'); const r = p.getBoundingClientRect(), s = document.querySelector('.pv-stage').getBoundingClientRect(); return { cls: p.className, vis: getComputedStyle(p).display !== 'none', w: r.width, area: (r.width * r.height) / (s.width * s.height), cats: Array.from(p.querySelectorAll('.tp-cat')).map((c) => c.dataset.cat), n: p.querySelectorAll('.tp-sym').length, l: r.left, t: r.top }; });
  ok(sp.vis && /tp-symv2/.test(sp.cls) && sp.w <= 300 && sp.area < 0.2, '팔레트가 작게 (폭 ≤ 300 · 화면의 20% 미만)', sp);
  ok(['note', 'rest', 'acc', 'dyn', 'art', 'nav', 'mark'].every((c) => sp.cats.includes(c)), '분류: 음표 · 쉼표 · 임시표 · 셈여림 · 연주법 · 반복 · 표시', sp.cats);
  await page.click('.tp-cat[data-cat="rest"]'); await sleep(150);
  ok(await page.evaluate(() => Array.from(document.querySelectorAll('.tp-sym')).every((b) => /^n:r/.test(b.dataset.k))), '쉼표 칸 = 쉼표만');
  await page.click('.tp-sym[data-k="n:r4"]'); await sleep(120);
  ok(await page.evaluate(() => YNPractice.current().P.anno().state().cur === null) && await page.evaluate(() => document.querySelector('.tp-sym[data-k="n:r4"]').classList.contains('on')), '4분쉼표 고름');
  const symCount = async () => (await page.evaluate(() => YNPractice.current().P.anno().items('team').filter((i) => i.t === 'sym').map((i) => i.k)));
  await page.mouse.click(pb.x + 300, pb.y + 330); await sleep(200);
  ok((await symCount()).includes('n:r4'), '악보를 누르면 고른 쉼표가 찍힘');
  await page.evaluate(() => YNPractice.current().P.setTool('sym')); await sleep(200);
  const hd = await page.evaluate(() => { const r = document.querySelector('.tp-symhead b').getBoundingClientRect(), q = document.querySelector('.pv-sympop').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: q.left, t: q.top }; });
  await page.mouse.move(hd.x, hd.y); await page.mouse.down(); await page.mouse.move(hd.x - 420, hd.y + 180, { steps: 10 }); await page.mouse.up(); await sleep(200);
  const moved = await page.evaluate(() => { const r = document.querySelector('.pv-sympop').getBoundingClientRect(); return { l: r.left, t: r.top, saved: localStorage.getItem('yn.tp.sympos') }; });
  ok(Math.abs(moved.l - (hd.l - 420)) < 6 && Math.abs(moved.t - (hd.t + 180)) < 6 && !!moved.saved, '위쪽 막대를 끌면 옮겨지고 자리를 기억', [moved, hd]);
  ok(await page.evaluate(() => YNPractice.current().P.anno().items('team').filter((i) => i.t === 'sym').length) === (await symCount()).length && (await symCount()).length === 1, '팔레트를 끌어도 악보에 기호가 찍히지 않음');
  await page.evaluate(() => YNPractice.current().P.zoom ? 0 : 0);
  await page.keyboard.press('Equal').catch(() => {}); await page.keyboard.press('Equal').catch(() => {}); await sleep(400);
  const scr = await page.evaluate(async () => { const s = document.querySelector('.pv-stage'), p = document.querySelector('.pv-sympop'), a = p.getBoundingClientRect(); s.scrollTop += 150; s.scrollLeft += 80; await new Promise((r) => setTimeout(r, 120)); const b = p.getBoundingClientRect(); return { dy: s.scrollTop, a: [a.left, a.top], b: [b.left, b.top] }; });
  ok(scr.a[0] === scr.b[0] && scr.a[1] === scr.b[1], '악보를 스크롤해도 팔레트는 제자리', scr);
  await page.screenshot({ path: '/tmp/claude-0/shot-sym.png' });
  await page.click('.tp-ib[data-sp="fold"]'); await sleep(150);
  ok(await page.evaluate(() => { const p = document.querySelector('.pv-sympop'); return p.classList.contains('folded') && getComputedStyle(p.querySelector('.tp-grid')).display === 'none' && p.getBoundingClientRect().height < 50; }), '▾ 로 접으면 머리줄만 (높이 < 50px)');
  await page.click('.tp-ib[data-sp="fold"]'); await sleep(150);
  await page.evaluate(() => YNPractice.current().P.setTool('none')); await sleep(100);
  await page.keyboard.down('Alt'); await page.keyboard.press('KeyN'); await page.keyboard.up('Alt'); await sleep(250);
  ok(await page.evaluate(() => YNPractice.current().P.anno().state().tool === 'sym' && document.querySelector('.tp-cat.on').dataset.cat === 'note'), 'Alt+N → 기호 · 음표 도구가 음표 칸으로');
  await page.click('.tp-ib[data-sp="close"]'); await sleep(150);
  ok(await page.evaluate(() => YNPractice.current().P.anno().state().tool === 'none' && getComputedStyle(document.querySelector('.pv-sympop')).display === 'none'), '✕ 로 팔레트 닫기 = 이동 도구');
  await page.keyboard.down('Alt'); await page.keyboard.press('KeyC'); await page.keyboard.up('Alt'); await sleep(150);
  ok(await page.evaluate(() => YNPractice.current().P.anno().state().tool === 'text'), 'Alt+C (예전 코드) → 글자 도구');

  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
