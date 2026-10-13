/**
 * 악보 화질 보정 (v12) — 사진 악보를 브라우저에서 보정해 바꿔 끼우기 · 필기 유지 · 되돌리기 · 글자 PDF 는 건너뜀 · 폰은 막음 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-sheetfix.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
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
  await mkPage.close();
  const jpg = Buffer.from(photoJpg, 'base64'), pd = await PDFDocument.create(), ji = await pd.embedJpg(jpg), pp = pd.addPage([595, 842]); pp.drawImage(ji, { x: 0, y: 0, width: 595, height: 842 });
  PDFS[fid(0)] = Buffer.from(await pd.save());
  await liveStore.loadAnnos();
  liveStore.writeLayer(TEAM, fid(0), 'song', '*', [{ id: 'note1', t: 'pen', pg: 1, c: '#ff0000', w: 3, p: [0.2, 0.3, 0.4, 0.35] }], '김리더');   // 원래 악보의 팀 필기

  console.log('■ 라이브 악보는 보정 도구를 미리 불러오지 않음');
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.layout', 'computer'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  const reqs = []; page.on('request', (r) => reqs.push(r.url()));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  ok(!reqs.some((u) => /sheetfix|tfjs|esrgan/.test(u)) && await page.evaluate(() => !window.YNSheetFix && !window.tf), '열 때 sheetfix.js · TensorFlow · AI 모델을 내려받지 않음', reqs.filter((u) => /sheetfix|tfjs|esrgan/.test(u)));
  const cur = () => page.evaluate(() => { const c = YNPractice.current(), p = c.perf(); return { sheet: p.sheet, id: (c.P.file() || {}).id }; });
  ok((await cur()).id === fid(0), '첫 악보 = 사진 악보');
  await page.evaluate(() => document.querySelector('.pv-morebtn').click()); await sleep(300);
  ok(await page.evaluate(() => { const b = document.querySelector('.pv-acts [data-a="fixsheet"]'); return !!(b && b.offsetParent !== null && /화질 보정/.test(b.textContent)); }), '⋯ 메뉴에 「악보 화질 보정」');

  console.log('■ 보정 창 — 경고 · 시작 · 비교 · 바꾸기');
  await page.evaluate(() => document.querySelector('.pv-acts [data-a="fixsheet"]').click());
  ok(await page.waitForSelector('.sf-back .sf', { timeout: 8000 }).then(() => true, () => false), '보정 창이 열림');
  const warn = await page.evaluate(() => (document.querySelector('.sf-warn') || {}).textContent || '');
  ok(/컴퓨터 또는 iPad Pro/.test(warn) && /예배 중/.test(warn), '경고: 컴퓨터 · iPad Pro 에서 · 예배 중에는 하지 말 것', warn);
  ok(await page.evaluate(() => !window.tf), '창을 열어도 AI 는 아직 안 불러옴 (시작할 때만)');
  await page.evaluate(() => { document.querySelector('.sf [data-r="ai"]').checked = false; });      // 소프트웨어 그래픽이라 AI 는 아래에서 따로 작게 시험
  await page.click('.sf [data-a="start"]');
  ok(await page.waitForFunction(() => { const b = document.querySelector('.sf [data-a="apply"]'); return b && !b.hidden && !b.disabled; }, null, { timeout: 60000 }).then(() => true, () => false), '보정을 마치고 「보정본으로 바꾸기」가 켜짐');
  const st = await page.evaluate(() => ({ st: document.querySelector('.sf [data-r="st"]').textContent, pg: document.querySelector('.sf [data-r="pg"]').textContent, empty: getComputedStyle(document.querySelector('.sf [data-r="empty"]')).display }));
  ok(/보정을 마쳤어요 \(1쪽\)/.test(st.st) && st.pg === '1 / 1' && st.empty === 'none', '진행 안내 · 쪽 번호 · 비교 화면', st);
  const sample = () => page.evaluate(() => {                              // 비교 캔버스: 왼쪽(원본)은 누런 종이, 오른쪽(보정본)은 흰 종이
    const c = document.querySelector('.sf-cv'), x = c.getContext('2d'), W = c.width, H = c.height;
    const avg = (x0) => { const d = x.getImageData(x0, Math.round(H * 0.05), 30, 30).data; let r = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2]; } return { r: Math.round(r / (d.length / 4)), b: Math.round(b / (d.length / 4)) }; };
    return { L: avg(Math.round(W * 0.42)), R: avg(Math.round(W * 0.55)) };
  });
  let half = await sample(); for (let i = 0; i < 30 && !(half.R.b > 235); i++) { await sleep(150); half = await sample(); }      // 보정본 그림은 조금 늦게 그려짐
  ok(half.L.r - half.L.b > 10 && half.R.b > 235 && Math.abs(half.R.r - half.R.b) < 6, '비교: 원본은 누런 종이 · 보정본은 흰 종이', half);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/sf-done.png' });
  /* 보정 세기 — 기본 「선명하게」 · 바꾸면 키운 그림을 다시 쓰고 마무리만 새로 */
  const md = await page.evaluate(() => ({ on: (document.querySelector('.sf [data-a="mode"].on') || {}).getAttribute && document.querySelector('.sf [data-a="mode"].on').getAttribute('data-m'), n: document.querySelectorAll('.sf [data-a="mode"]').length, hint: document.querySelector('.sf [data-r="mh"]').textContent, base: YNSheetFix.current()._st.base.filter(Boolean).length }));
  ok(md.n === 4 && md.on === 'clean' && /PDF 악보처럼/.test(md.hint) && md.base === 1, '세기 4가지 · 기본 「PDF처럼 깔끔하게」 · 키운 그림 보관', md);
  const j0 = await page.evaluate(() => YNSheetFix.current()._st.res[0].jpg.length);
  await page.click('.sf [data-a="mode"][data-m="bold"]');
  ok(await page.waitForFunction((n) => { const s = YNSheetFix.current()._st; return !s.busy && s.res[0] && s.res[0].jpg.length !== n && /세기를 바꿨어요/.test(document.querySelector('.sf [data-r="st"]').textContent); }, j0, { timeout: 20000 }).then(() => true, () => false), '「아주 진하게」로 바꾸면 바로 다시 만들어짐 (처음부터 다시 하지 않음)');
  ok(await page.evaluate(() => localStorage.getItem('yn.sf.mode2') === 'bold'), '고른 세기는 다음에도 기억');
  await page.click('.sf [data-a="mode"][data-m="clean"]');
  await page.waitForFunction(() => !YNSheetFix.current()._st.busy && /세기를 바꿨어요/.test(document.querySelector('.sf [data-r="st"]').textContent), null, { timeout: 20000 }).catch(() => {});
  await page.click('.sf [data-a="zoom"]'); await sleep(200);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/sf-zoom.png' });
  ok(await page.evaluate(() => document.querySelector('.sf [data-a="zoom"]').getAttribute('aria-pressed') === 'true'), '🔍 확대 보기');
  await page.click('.sf [data-a="apply"]');
  ok(await page.waitForFunction((old) => { const c = YNPractice.current(); return !document.querySelector('.sf-back') && c.P.file() && c.P.file().id !== old && c.perf().drawn; }, fid(0), { timeout: 30000 }).then(() => true, () => false), '바꾸면 창이 닫히고 라이브 악보가 새 파일로 바로 바뀜');
  const after = await cur();
  ok(/화질 보정한 악보로 바꿨어요/.test(await page.evaluate(() => document.querySelector('.pv-toast').textContent)), '바꿨다는 안내');
  const row0 = TABS['악보저장소'][0];
  ok(row0['파일링크'].indexOf(after.id) >= 0 && row0['메모'] === '', '악보저장소 줄이 새 링크로 · 자르기 기록은 비움', { link: row0['파일링크'], memo: row0['메모'] });
  ok(TABS['악보보정'].length === 1 && TABS['악보보정'][0]['원래링크'] === link(fid(0)) && TABS['악보보정'][0]['새파일'] === after.id, '원본 링크를 「악보보정」에 보관 (되돌리기용)', TABS['악보보정']);
  const newDoc = await PDFDocument.load(PDFS[after.id]), sz = newDoc.getPage(0).getSize();
  ok(newDoc.getPageCount() === 1 && Math.abs(sz.width - 595) < 0.5 && Math.abs(sz.height - 842) < 0.5, '새 PDF: 쪽 수 · 쪽 크기가 원본과 같음 (필기 자리가 맞음)', { n: newDoc.getPageCount(), sz });
  const moved = liveStore.readLayer(TEAM, after.id, 'song', '*');
  ok(moved.length === 1 && moved[0].id === 'note1', '팀 필기가 새 파일로 그대로 옮겨짐', moved);
  ok(PDFS[after.id].length < 6 * 1048576, '파일 크기가 알맞음 (' + (PDFS[after.id].length / 1048576).toFixed(2) + 'MB)');
  ok(await page.evaluate(() => !window.tf || !tf.engine().backendInstance), '창을 닫으면 AI 그래픽 메모리를 돌려줌');

  console.log('■ 다시 열면 "이미 보정" · 원본으로 되돌리기');
  await page.evaluate(() => { document.querySelector('.pv-morebtn').click(); }); await sleep(200);
  await page.evaluate(() => document.querySelector('.pv-acts [data-a="fixsheet"]').click());
  await page.waitForSelector('.sf-back .sf'); await sleep(600);
  const again = await page.evaluate(() => ({ start: document.querySelector('.sf [data-a="start"]').disabled, rev: !document.querySelector('.sf [data-a="revert"]').hidden, st: document.querySelector('.sf [data-r="st"]').textContent }));
  ok(again.start && again.rev && /이미 화질 보정/.test(again.st), '이미 보정한 악보: 시작은 꺼지고 「원본으로 되돌리기」가 보임', again);
  await page.click('.sf [data-a="revert"]');
  ok(await page.waitForFunction((old) => { const c = YNPractice.current(); return !document.querySelector('.sf-back') && c.P.file() && c.P.file().id !== old && c.perf().drawn; }, after.id, { timeout: 30000 }).then(() => true, () => false), '되돌리면 원본 내용의 새 파일로 바뀜');
  const back = await cur();
  ok(TABS['악보보정'].length === 0 && TABS['악보저장소'][0]['메모'].indexOf('헤더|') === 0, '되돌리면 보정 기록이 지워지고 원래 메모(자르기 기록)가 돌아옴', { reg: TABS['악보보정'], memo: TABS['악보저장소'][0]['메모'] });
  ok(Buffer.compare(Buffer.from((await PDFDocument.load(PDFS[back.id])).getPageCount() + ''), Buffer.from('1')) === 0 && liveStore.readLayer(TEAM, back.id, 'song', '*').length === 1, '되돌린 파일에도 필기가 그대로');

  console.log('■ 글자 · 선으로 된 PDF 는 건너뜀');
  await page.evaluate(() => YNPractice.current().next()); await sleep(1200);
  ok((await cur()).id === fid(1), '두 번째 악보(글자 PDF)로 넘어감');
  await page.evaluate(() => { document.querySelector('.pv-morebtn').click(); }); await sleep(200);
  await page.evaluate(() => document.querySelector('.pv-acts [data-a="fixsheet"]').click());
  await page.waitForSelector('.sf-back .sf'); await page.evaluate(() => { document.querySelector('.sf [data-r="ai"]').checked = false; });
  await page.click('.sf [data-a="start"]');
  ok(await page.waitForFunction(() => /이미 선명/.test(document.querySelector('.sf [data-r="empty"]').textContent), null, { timeout: 20000 }).then(() => true, () => false), '"이미 선명해서 보정할 필요가 없어요"');
  await page.click('.sf [data-a="close"]'); await sleep(200);
  ok(await page.evaluate(() => !document.querySelector('.sf-back')), '닫기');

  console.log('■ AI 2배 (작은 그림으로) — 불러오기 · 계산 · 메모리 돌려주기 · 다시 쓰기');
  const ai = await page.evaluate(async () => {
    const E = YNSheetFix._engine, c = document.createElement('canvas'); c.width = 160; c.height = 120; const x = c.getContext('2d'); x.fillStyle = '#e8dcc0'; x.fillRect(0, 0, 160, 120); x.fillStyle = '#222'; x.font = 'bold 30px sans-serif'; x.fillText('G7 ♪', 20, 70);
    const keep = E.CFG.target; E.CFG.target = 330;
    await E.aiLoad(); const r = await E.processCanvas(c, { ai: true }); E.aiFree();
    await E.aiLoad(); const r2 = await E.processCanvas(c, { ai: true }); E.aiFree(); E.CFG.target = keep;
    const d = r.cv.getContext('2d').getImageData(0, 0, r.cv.width, r.cv.height).data; let white = 0, dark = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 245) white++; else if (d[i] < 60) dark++; }
    return { ai: r.ai, ai2: r2.ai, w: r.cv.width, h: r.cv.height, white: white / (d.length / 4), dark: dark / (d.length / 4), freed: !tf.engine().backendInstance };
  });
  ok(ai.ai && ai.ai2 && ai.w === 330 && ai.h === 248, 'AI 2배로 키운 뒤 목표 크기로 (두 번째도 다시 불러와 동작)', ai);
  ok(ai.white > 0.6 && ai.dark > 0.008, 'AI 결과도 종이는 하얗고 글자는 진함', ai);
  ok(ai.freed, '끝나면 그래픽 메모리를 돌려줌');

  console.log('■ 휴대폰에서는 막음');
  const pctx = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR' });
  const pp2 = await pctx.newPage(); pp2.on('pageerror', (e) => errs.push('phone: ' + e.message));
  await pp2.goto(BASE + '/__blank'); await pp2.addScriptTag({ url: '/worship/sheetfix.js' });
  await pp2.evaluate(() => YNSheetFix.open({ id: 'x', name: '악보', fetchUrl: '/__vec.pdf', apply: () => Promise.resolve({}) })); await sleep(300);
  const ph = await pp2.evaluate(() => ({ start: document.querySelector('.sf [data-a="start"]').disabled, msg: document.querySelector('.sf [data-r="empty"]').textContent }));
  ok(ph.start && /휴대폰/.test(ph.msg), '휴대폰: 시작 단추가 꺼지고 컴퓨터 · iPad Pro 안내', ph);
  await pctx.close();

  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
