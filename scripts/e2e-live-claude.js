/**
 * V873 라이브 악보 Claude AI — 정해진 계정만 · 놓친 코드 찾기 · 코드 악보 · 곡 정보 · 묻기 (가짜 Claude 로 브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-claude.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.CLAUDE_ALLOW_EMAILS = 'lead@test';
const CALLS = [];
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
  if (/api\.anthropic\.com/.test(u)) {
    const body = JSON.parse(opt.body), txt = JSON.stringify(body.messages); CALLS.push({ headers: opt.headers, body });
    let out = '';
    if (/List EVERY chord symbol/.test(txt)) {
      const at = (x, w) => +((x + w / 2) / 612).toFixed(3), y = +((792 - 656 - 4.3) / 792).toFixed(3);
      out = JSON.stringify({ chords: [{ t: 'G', x: at(90, 9), y }, { t: 'C', x: at(104, 9), y }, { t: 'D', x: at(118, 9), y }, { t: 'Em9', x: at(134, 25), y }, { t: 'G', x: at(300, 9), y }, { t: 'Am', x: at(420, 20), y }] });
    } else if (/ChordPro/.test(txt)) out = '{title: Way Maker}\n{key: G}\n{comment: Verse 1}\n[G]주님 여기 [D/F#]계시네\n[Em7]예배 [C]드려요\n{comment: Chorus}\n[G] [C] [D]';
    else if (/Read the song information/.test(txt)) out = '```json\n{"title":"Way Maker","key":"G","bpm":72,"time":"4/4","form":"V1-C-V2-C-B-C","note":"송폼은 반복 기호로 짐작"}\n```';
    else out = '브릿지에서는 베이스가 G - D/F# - Em 으로 내려가요.';
    return new Response(JSON.stringify({ content: [{ type: 'text', text: out }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
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
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '0'); localStorage.setItem('yn.pv.ks.waymaker', '2'); } } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  ok(await page.waitForSelector('.pv-aibtn', { state: 'attached', timeout: 6000 }).then(() => true, () => false), '허용된 계정: 「⋯」 에 Claude AI 단추');
  const HZ = 'YNPractice.current().P.ensureTab("harmony")._ui';
  await page.waitForFunction(`(function(){ var S=${HZ}._state; return S && S.data && S.data.pages['1'] && !S.busy; })()`, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(`(function(){ var h=${HZ}, pd=h._state.data.pages['1']; pd.chords = pd.chords.filter(function(c){ return c.text !== 'Am'; }); h._commit(); })()`);
  await page.evaluate(() => { document.querySelector('.pv-morebtn').click(); }); await sleep(150);
  await page.evaluate(() => document.querySelector('.pv-aibtn').click()); await sleep(200);
  ok(!!(await page.$('.pv-aip')), 'Claude AI 창이 열림');

  console.log('■ A. 놓친 코드 찾기');
  const n0 = await page.evaluate(`${HZ}._state.data.pages['1'].chords.length`);
  await page.click('.pv-aip [data-k=chords]');
  ok(await page.waitForFunction(() => /빠진 코드 1개를 넣었어요/.test((document.querySelector('.pv-aip .out') || {}).textContent || ''), null, { timeout: 20000 }).then(() => true, () => false), '빠진 코드(Am) 1개를 넣음', await page.evaluate(() => (document.querySelector('.pv-aip .out') || {}).textContent));
  const outA = await page.evaluate(() => document.querySelector('.pv-aip .out').textContent);
  ok(/같은 코드 4개/.test(outA) && /Em7 → Em9/.test(outA), '같은 코드 4개 · 다르게 읽은 코드(Em7 → Em9) 알려 줌', outA);
  const am = await page.evaluate(`(function(){ var c=${HZ}._state.data.pages['1'].chords.filter(function(c){return c.ai;})[0]; return c ? { t: c.text, src: c.src, x: c.x, w: c.w } : null; })()`);
  ok(am && am.t === 'Am' && am.src === 'ocr' && Math.abs(am.x - 420 / 612) < 0.012, '넣은 Am 은 인쇄된 글자 자리에 맞춤 (점선 칩)', am);
  ok(await page.evaluate(`${HZ}._state.hits.some(function(q){ return q.kind==='chord'; })`), '넣은 코드도 키에 맞춰 그려짐');
  await page.click('.pv-aip [data-k=diff]'); await sleep(200);
  ok(await page.evaluate(`${HZ}._state.data.pages['1'].chords.some(function(c){return c.text==='Em9';})`), '「AI 쪽으로 바꾸기」 → Em7 이 Em9 로');
  const call0 = CALLS[CALLS.length - 1];
  ok(call0 && call0.headers['x-api-key'] === 'sk-test' && call0.headers['anthropic-version'] && call0.body.messages[0].content[0].type === 'image', '서버가 키 · 그림을 실어 Claude 에 보냄 (키는 화면에 없음)');
  ok(!(await page.evaluate(() => document.documentElement.outerHTML.indexOf('sk-test') >= 0)), '화면(HTML)에는 키가 없음');

  console.log('■ B. 코드 악보');
  await page.click('.pv-aip [data-k=chart]');
  ok(await page.waitForSelector('.pv-aich', { timeout: 20000 }).then(() => true, () => false), '코드 악보 창이 열림');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace('.png', '-chart.png') });
  const chart = await page.evaluate(() => ({ t: document.querySelector('.pv-aich .sheet').innerText, btns: Array.from(document.querySelectorAll('.pv-aich [data-v]')).map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')) }));
  ok(/A\b/.test(chart.t) && /E\/G#/.test(chart.t) && /F#m7/.test(chart.t) && /주님 여기/.test(chart.t), '바꾼 키(+2)로: G→A · D/F#→E/G# · Em7→F#m7, 가사 그대로', chart.t);
  ok(chart.btns.length === 2 && /바꾼 키 A/.test(chart.btns[1]), '원래 키 / 바꾼 키 고르기', chart.btns);
  await page.click('.pv-aich [data-v=orig]'); await sleep(100);
  ok(/D\/F#/.test(await page.evaluate(() => document.querySelector('.pv-aich .sheet').innerText)), '원래 키로 바꿔 보기');
  await page.click('.pv-aich [data-a=x]'); await sleep(100);
  const nCalls = CALLS.length;
  await page.click('.pv-aip [data-k=chart]'); await sleep(500);
  ok(CALLS.length === nCalls && !!(await page.$('.pv-aich')), '두 번째는 저장해 둔 악보를 바로 엶 (Claude 다시 안 부름)');
  await page.click('.pv-aich [data-a=x]');

  console.log('■ C. 곡 정보');
  await page.click('.pv-aip [data-k=info]');
  ok(await page.waitForFunction(() => /V1-C-V2-C-B-C/.test((document.querySelector('.pv-aip .out') || {}).textContent || ''), null, { timeout: 20000 }).then(() => true, () => false), 'Key · BPM · 송폼을 보여 줌');
  await page.click('.pv-aip [data-k=applykey]'); await sleep(200);
  ok(await page.evaluate(`${HZ}._state.data.orig`) === 'G', '「원래 조를 G 로」 → 화음 탭 원래 조');

  console.log('■ D. 묻기');
  await page.fill('.pv-aip textarea', '브릿지 베이스 라인?');
  await page.press('.pv-aip textarea', 'Enter');
  ok(await page.waitForFunction(() => document.querySelectorAll('.pv-aip .msg.a').length === 1, null, { timeout: 20000 }).then(() => true, () => false), '답이 대화창에 나옴');
  const ask1 = CALLS[CALLS.length - 1].body.messages;
  ok(ask1[ask1.length - 1].content[0].type === 'image' && /지금 A/.test(JSON.stringify(ask1)), '첫 질문엔 악보 그림 · 키 정보(지금 A)를 같이 보냄');
  await page.fill('.pv-aip textarea', '인트로는?'); await page.press('.pv-aip textarea', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.pv-aip .msg.a').length === 2, null, { timeout: 20000 }).catch(() => {});
  const ask2 = CALLS[CALLS.length - 1].body.messages;
  ok(ask2.length === 3 && ask2[2].content[0].type === 'text', '같은 페이지 두 번째 질문: 앞 대화를 이어 보내고 그림은 다시 안 보냄', ask2.map((m) => m.role));

  console.log('■ 다른 계정');
  process.env.CLAUDE_ALLOW_EMAILS = 'someone@else';
  const r = await page.evaluate(() => new Promise((res) => callServer('worshipClaude', [YNPractice.current().P.opts.token, 'ask', { q: 'hi' }], (x) => res({ ok: x }), (e) => res({ err: e.message || String(e) }))));
  ok(r.err && /정해진 계정/.test(r.err), '다른 계정은 서버가 거절', r);
  const st = await page.evaluate(() => new Promise((res) => callServer('worshipClaude', [YNPractice.current().P.opts.token, 'status', {}], res, (e) => res({ err: String(e) }))));
  ok(st && st.allowed === false, '다른 계정: status = 쓸 수 없음 (단추 없음)', st);

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
