/**
 * V874 악보 화질 보정 + Claude (정해진 계정만) — ① 기기 보정 + 코드 · 제목 다시 쓰기 ② 실험: 새로 그리기 (ABC → abcjs) · 다른 계정은 예전 그대로 (가짜 Claude 로 브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-sheetfix-claude.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.CLAUDE_ALLOW_EMAILS = 'lead@test';
let LABELS = [], LYRICS = []; const CALLS = [];
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

/* ---------- 가짜 구글: 시트(메모리, 쓰기도 반영) · 드라이브(올리기 · 내려받기) ---------- */
const TEAM = 'Kairos', DATE = '2026-10-11';
const fid = (i) => 'DRIVEFILE' + String(i).padStart(4, '0') + 'xxxxxxxxxx';
const link = (id) => 'https://drive.google.com/file/d/' + id + '/view';
const TABS = {
  '찬양콘티': ['Way Maker', 'Holy Forever'].map((t, i) => ({ ID: 's' + i, 팀ID: TEAM, 날짜: DATE, 행사ID: '', 구분: '콘티', 순서: String(i + 1), 제목: t, Key: 'G', BPM: '72', 송폼: 'V1-C', 유튜브: '' })),
  '악보저장소': [0, 1].map((i) => ({ ID: 'r' + i, 팀ID: TEAM, 날짜: DATE, 행사ID: '', 곡ID: 's' + i, 제목: ['Way Maker', 'Holy Forever'][i], 파일링크: link(fid(i)), 쪽: '', 메모: i === 0 ? '헤더|' + JSON.stringify({ s: link(fid(9)), p: '', c: '0.1,0.1,0.9,0.9', h: 0, g: '' }) : '', 올린시각: '2026-10-0' + (i + 1) })),
  '찬양주석': [], '악보보정': [],
};
const rowsOf = (tab) => (TABS[tab] = TABS[tab] || []);
const sheetsDbPath = require.resolve(path.join(ROOT, 'lib/sheetsDb'));
require.cache[sheetsDbPath] = { id: sheetsDbPath, filename: sheetsDbPath, loaded: true, exports: new Proxy({
  readAll: async (tab) => rowsOf(tab).map((r, i) => Object.assign({ __row: i + 2 }, r)),
  findWhere: async (tab, pred) => rowsOf(tab).find(pred) || null,
  findOne: async () => null,
  appendRow: async (tab, obj) => { rowsOf(tab).push(Object.assign({}, obj)); return {}; },
  appendRows: async (tab, objs) => { objs.forEach((o) => rowsOf(tab).push(Object.assign({}, o))); return {}; },
  updateRow: async (tab, row, obj) => { const t = rowsOf(tab); t[row - 2] = Object.assign({}, obj); delete t[row - 2].__row; return {}; },
  updateCells: async (tab, cells) => { const t = rowsOf(tab); cells.forEach((c) => { if (t[c.row - 2]) t[c.row - 2][c.header] = c.value; }); return {}; },
  deleteRow: async (tab, row) => { rowsOf(tab).splice(row - 2, 1); return {}; },
  invalidate: () => {}, folderId: () => 'FOLDER',
}, { get: (t, k) => (k in t ? t[k] : async () => null) }) };
const gaPath = require.resolve(path.join(ROOT, 'lib/googleAuth'));
require.cache[gaPath] = { id: gaPath, filename: gaPath, loaded: true, exports: new Proxy({ serviceAuth: () => ({ getAccessToken: async () => ({ token: 'fake' }) }) }, { get: (t, k) => (k in t ? t[k] : () => ({})) }) };
const tcPath = require.resolve(path.join(ROOT, 'lib/teamContext'));
require.cache[tcPath] = { id: tcPath, filename: tcPath, loaded: true, exports: { resolve: async () => ({ current: TEAM, teams: [TEAM], member: { 이름: '김리더', 이메일: 'lead@test' }, isAdmin: false }) } };
const honPath = require.resolve(path.join(ROOT, 'lib/honorific'));
require.cache[honPath] = { id: honPath, filename: honPath, loaded: true, exports: new Proxy({ pastorSet: async () => new Set() }, { get: (t, k) => (k in t ? t[k] : () => '') }) };
let PDFS = {}, upN = 100;
const dsPath = require.resolve(path.join(ROOT, 'lib/driveStore'));
require.cache[dsPath] = { id: dsPath, filename: dsPath, loaded: true, exports: {
  uploadPublic: async (sub, file) => { const id = fid(upN++); PDFS[id] = Buffer.from(file.buffer); return 'https://drive.google.com/uc?export=view&id=' + id; },
  uploadPrivate: async () => '', removeByLink: async () => {},
} };
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
  const u = String(url);
  const m = /googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media/.exec(u);
  if (/api\.anthropic\.com/.test(u)) {
    const body = JSON.parse(opt.body), txt = JSON.stringify(body.messages); CALLS.push(body);
    let out = '';
    if (/TEXT LABELS/.test(txt)) out = JSON.stringify({ items: LABELS });
    else if (/Find every LYRIC/.test(txt)) out = JSON.stringify({ items: LYRICS });
    else if (/Re-engrave/.test(txt)) out = 'X:1\nT:Way Maker\nM:4/4\nL:1/8\nQ:1/4=72\nK:G\n"^Verse 1""G"B2 B2 "D/F#"A2 A2 | "Em7"G4 "C"E4 |\nw:주 님 여 기 계 시 네\n"G"D2 G2 "D"A2 B2 | "C"c8 |]\nw:예 배 드 려 요\n';
    return new Response(JSON.stringify({ content: [{ type: 'text', text: out }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (m) { const id = decodeURIComponent(m[1]), B = PDFS[id]; if (!B) return new Response('no', { status: 404 }); return new Response(B, { status: 200, headers: { 'content-type': B.slice(0, 4).toString('latin1') === '%PDF' ? 'application/pdf' : 'image/jpeg', 'content-length': String(B.length) } }); }
  return realFetch(url, opt);
};

(async () => {
  const { chromium } = require('playwright');
  const MK = require('/home/claude/yntoronto.2026/scripts/browser/mksheet.js');
  const { PDFDocument } = require('pdf-lib');
  const vector = Buffer.from(await MK.mkSheetPdf(MK.layout().prims));
  PDFS[fid(1)] = vector;                                    // 글자 · 선으로 된 PDF (이미 선명)
  PDFS[fid(9)] = vector;                                    // 0번 줄 메모의 "원본" (자르기만 한 기록)

  const express = require('express');
  const app = express();
  app.use('/live/sheetfix', express.json({ limit: '30mb' }));
  app.use('/api/worshipClaude', express.json({ limit: '16mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { req.session = { uid: 'lead@test' }; next(); });
  app.use(express.static(path.join(ROOT, 'public')));
  app.get('/__vec.pdf', (q, r) => r.type('application/pdf').send(vector));
  app.get('/__blank', (q, r) => r.type('html').send('<!doctype html><body></body>'));
  const live = require(path.join(ROOT, 'routes/live'));
  app.post('/api/:fn', (req, res, next) => (/^worship(Cfg|MySheets|SongsOf)/.test(req.params.fn) ? res.json({ ok: true, result: req.params.fn === 'worshipCfgLoad' ? { team: [], mine: [] } : req.params.fn === 'worshipMySheets' ? { sheets: [] } : [] }) : next()));
  app.use(live);
  const server = http.createServer(app);
  const realtime = require(path.join(ROOT, 'lib/realtime')), liveAuth = require(path.join(ROOT, 'lib/liveAuth')), liveStore = require(path.join(ROOT, 'lib/liveStore'));
  const rt = realtime.attach(server, { log: () => {}, auth: (t) => liveAuth.verify(t), loadAnno: (file, scope, team) => liveStore.readLayer(team, file, scope, '*'), saveAnno: (file, scope, items, by, team) => liveStore.writeLayer(team, file, scope, '*', items, by) });
  live.setRealtime && live.setRealtime(rt);
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const br = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });

  /* 사진 악보 만들기 — 글자 PDF 를 긴 변 1000px 로 그려 누런 종이 · 그림자 · 흐림 · 잡티를 넣고 JPEG 한 장짜리 PDF 로 */
  const mkPage = await br.newPage();
  await mkPage.goto(BASE + '/__blank');
  await mkPage.addScriptTag({ url: '/vendor/pdfjs/pdf.min.js' });
  const photoJpg = await mkPage.evaluate(async () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await (await fetch('/__vec.pdf')).arrayBuffer()) }).promise, pg = await pdf.getPage(1);
    const vp = pg.getViewport({ scale: 1000 / pg.getViewport({ scale: 1 }).height }), cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); await pg.render({ canvasContext: cx, viewport: vp }).promise;
    const d1 = document.createElement('canvas'); d1.width = cv.width; d1.height = cv.height; const x1 = d1.getContext('2d'); x1.filter = 'blur(0.9px)'; x1.drawImage(cv, 0, 0); x1.filter = 'none';
    const im = x1.getImageData(0, 0, d1.width, d1.height), d = im.data;
    for (let y = 0; y < d1.height; y++) for (let x = 0; x < d1.width; x++) { const i = (y * d1.width + x) * 4, sh = 0.62 + 0.38 * Math.min(1, (x / d1.width) * 1.4), nz = ((x * 7919 + y * 104729) % 23) - 11; d[i] = d[i] * sh * 0.97 + nz; d[i + 1] = d[i + 1] * sh * 0.92 + nz; d[i + 2] = d[i + 2] * sh * 0.78 + nz; }
    x1.putImageData(im, 0, 0);
    const b = await new Promise((r) => d1.toBlob(r, 'image/jpeg', 0.6)); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s);
  });
  const ALL = await mkPage.evaluate(async () => {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await (await fetch('/__vec.pdf')).arrayBuffer()) }).promise, pg = await pdf.getPage(1), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    const isC = (t) => /^[A-G][#b]?(m|maj|sus|dim|aug|add|[0-9])*(\/[A-G][#b]?)?$/.test(t);
    return tc.items.filter((it) => it.str.trim()).map((it) => { const fs = Math.hypot(it.transform[0], it.transform[1]), p = vp.convertToViewportPoint(it.transform[4], it.transform[5]), t = it.str.trim(); return { t, k: isC(t) ? 'chord' : 'lyric', x: (p[0] + it.width / 2) / vp.width, y: (p[1] - fs * 0.36) / vp.height, h: fs * 0.72 / vp.height }; });
  });
  LABELS = ALL.filter((x) => x.k === 'chord'); LYRICS = ALL.filter((x) => x.k === 'lyric' && /^[a-z]+$/i.test(x.t) && x.t.length < 9);
  /* 실제 Claude 처럼 자리를 조금씩 틀리게 (가로 ±1.8% · 세로 ±1% · 글자 높이 ±30%) */
  const jit = (arr) => arr.map((c, i) => Object.assign({}, c, { x: c.x + (((i * 37) % 7) - 3) * 0.006, y: c.y + (((i * 53) % 5) - 2) * 0.005, h: c.h * (i % 2 ? 1.3 : 0.75) }));
  LABELS = jit(LABELS); LYRICS = jit(LYRICS);
  await mkPage.close();
  const jpg = Buffer.from(photoJpg, 'base64'), pd = await PDFDocument.create(), ji = await pd.embedJpg(jpg), pp = pd.addPage([595, 842]); pp.drawImage(ji, { x: 0, y: 0, width: 595, height: 842 });
  PDFS[fid(0)] = Buffer.from(await pd.save());
  await liveStore.loadAnnos();
  liveStore.writeLayer(TEAM, fid(0), 'song', '*', [{ id: 'note1', t: 'pen', pg: 1, c: '#ff0000', w: 3, p: [0.2, 0.3, 0.4, 0.35] }], '김리더');   // 원래 악보의 팀 필기


  console.log('■ 허용된 계정 — 보정 창에 Claude 줄');
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.layout', 'computer'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn && typeof YNPractice.current().P.claude === 'function', null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보 · Claude 연결됨 (이 계정)');
  ok(LABELS.length >= 4, '시험 악보의 코드 자리 ' + LABELS.length + '개', LABELS.length);
  await page.evaluate(() => document.querySelector('.pv-morebtn').click()); await sleep(200);
  await page.evaluate(() => document.querySelector('.pv-acts [data-a="fixsheet"]').click());
  ok(await page.waitForSelector('.sf-back .sf', { timeout: 8000 }).then(() => true, () => false), '보정 창이 열림');
  const cm = await page.evaluate(() => ({ n: document.querySelectorAll('.sf [data-a="cmode"]').length, on: (document.querySelector('.sf [data-a="cmode"].on') || {}).getAttribute('data-m'), hint: document.querySelector('.sf [data-r="ch"]').textContent }));
  ok(cm.n === 3 && cm.on === 'text' && /음표 머리/.test(cm.hint) && /가사/.test(cm.hint), 'Claude 3가지 · 기본 「+ Claude 다듬기 (음표 · 코드 · 가사)」', cm);

  console.log('■ ① 기기 보정 + 코드 · 제목 다시 쓰기');
  await page.click('.sf [data-a="start"]');
  ok(await page.waitForFunction(() => { const b = document.querySelector('.sf [data-a="apply"]'); return b && !b.hidden && !b.disabled; }, null, { timeout: 90000 }).then(() => true, () => false), '보정을 마침');
  const st1 = await page.evaluate(() => document.querySelector('.sf [data-r="st"]').textContent);
  const n1 = +((/코드 · 제목 (\d+)개/.exec(st1) || [])[1] || 0), nl = +((/가사 (\d+)자/.exec(st1) || [])[1] || 0), nn = +((/음표 머리 (\d+)개/.exec(st1) || [])[1] || 0);
  ok(n1 >= Math.ceil(LABELS.length * 0.75), 'Claude 가 읽은 코드 중 ' + n1 + ' / ' + LABELS.length + '개를 깨끗한 글자로 다시 씀', st1);
  ok(nl >= Math.ceil(LYRICS.filter((x) => !/[gjpqy]/.test(x.t)).length * 0.6), '가사 ' + nl + ' / ' + LYRICS.length + '자를 다시 씀', st1);
  ok(nn >= 3, '검은 음표 머리 ' + nn + '개를 반듯하게 다듬음', st1);
  ok(CALLS.length === 2 && CALLS.every((b) => b.messages[0].content[0].type === 'image'), '쪽마다 Claude 에 두 번 (코드 · 제목 / 가사)', CALLS.length);
  if (process.env.SHOT) { await page.click('.sf [data-a="zoom"]'); await sleep(400); await page.screenshot({ path: process.env.SHOT + '/sfc-text.png' }); await page.click('.sf [data-a="zoom"]'); }
  if (process.env.SHOT) { const b64 = await page.evaluate(() => { const u = YNSheetFix.current()._st.res[0].jpg; let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }); require('fs').writeFileSync(process.env.SHOT + '/sfc-text-full.jpg', Buffer.from(b64, 'base64')); }
  const j0 = await page.evaluate(() => YNSheetFix.current()._st.res[0].jpg.length);
  await page.click('.sf [data-a="mode"][data-m="bold"]');
  await page.waitForFunction((n) => { const s = YNSheetFix.current()._st; return !s.busy && s.res[0] && s.res[0].jpg.length !== n; }, j0, { timeout: 30000 }).catch(() => {});
  ok(CALLS.length === 2, '세기를 바꿔도 Claude 에 다시 묻지 않음 (읽은 글자를 다시 씀)', CALLS.length);

  console.log('■ ② 실험: 새로 그리기');
  await page.click('.sf [data-a="cmode"][data-m="engrave"]'); await sleep(200);
  ok(await page.evaluate(() => /다시 보정/.test(document.querySelector('.sf [data-a="start"]').textContent) && document.querySelector('.sf [data-a="apply"]').hidden), '방식을 바꾸면 다시 보정하도록');
  await page.click('.sf [data-a="start"]');
  ok(await page.waitForFunction(() => { const b = document.querySelector('.sf [data-a="dl"]'); return b && !b.hidden && !b.disabled; }, null, { timeout: 60000 }).then(() => true, () => false), '새로 그림 → 「PDF 내려받기」 · 「바꾸기」', await page.evaluate(() => document.querySelector('.sf [data-r="st"]').textContent));
  const eng = await page.evaluate(() => { const s = YNSheetFix.current()._st; return { n: s.eng && s.eng.jpgs.length, abc: !!s.abc, st: document.querySelector('.sf [data-r="st"]').textContent }; });
  ok(eng.n >= 1 && eng.abc && /원본과 꼭 비교/.test(eng.st), '새로 그린 쪽 ' + eng.n + '개 · 비교하라는 안내', eng);
  if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT + '/sfc-engrave.png' }); const b64 = await page.evaluate(() => { const u = YNSheetFix.current()._st.eng.jpgs[0]; let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }); require('fs').writeFileSync(process.env.SHOT + '/sfc-eng-full.jpg', Buffer.from(b64, 'base64')); }
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('.sf [data-a="dl"]')]);
  const dlPath = await dl.path(), dlBytes = require('fs').readFileSync(dlPath);
  const dDoc = await PDFDocument.load(dlBytes), dsz = dDoc.getPage(0).getSize();
  ok(/(새로 그림\)\.pdf|^download)$/.test(dl.suggestedFilename()) && Math.round(dsz.width) === 612 && Math.round(dsz.height) === 792, 'PDF 내려받기: Letter 쪽', { name: dl.suggestedFilename(), dsz });
  const old = (await page.evaluate(() => YNPractice.current().P.file().id));
  await page.click('.sf [data-a="apply"]');
  ok(await page.waitForFunction((o) => { const c = YNPractice.current(); return !document.querySelector('.sf-back') && c.P.file() && c.P.file().id !== o && c.perf().drawn; }, old, { timeout: 30000 }).then(() => true, () => false), '「바꾸기」(확인 후) → 새로 그린 악보로 바뀜');

  console.log('■ 다른 계정 — 예전처럼 기기에서만');
  process.env.CLAUDE_ALLOW_EMAILS = 'someone@else';
  const ctx2 = await br.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR' });
  await ctx2.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.layout', 'computer'); } catch (e) {} });
  const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  await p2.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).catch(() => {});
  await sleep(1200);
  ok(await p2.evaluate(() => !YNPractice.current().P.claude && !document.querySelector('.pv-aibtn')), '다른 계정: Claude 연결 없음 · 단추 없음');
  await p2.evaluate(() => document.querySelector('.pv-morebtn').click()); await sleep(200);
  await p2.evaluate(() => document.querySelector('.pv-acts [data-a="fixsheet"]').click());
  await p2.waitForSelector('.sf-back .sf', { timeout: 8000 }).catch(() => {});
  ok(await p2.evaluate(() => !!document.querySelector('.sf') && !document.querySelector('.sf [data-a="cmode"]') && !!document.querySelector('.sf [data-a="start"]')), '다른 계정: 보정 창은 예전 그대로 (Claude 줄 없음)');

  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
