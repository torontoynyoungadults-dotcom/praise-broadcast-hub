/**
 * V871 라이브 악보 — 예배 전 전체 준비 · 예배 모드 · 페달 맞추기 · 기타 카포 보기 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-live-worship-prep.js
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
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('yn.pv.show.form', '0'); localStorage.setItem('yn.pv.show.metro', '0'); localStorage.setItem('yn.pv.side', '0'); localStorage.setItem('yn.pv.ks.waymaker', '1'); localStorage.setItem('yn.pv.ks.amazinggrace', '-2'); } } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/conti/practice?team=' + TEAM + '&date=' + DATE);
  ok(await page.waitForFunction(() => window.YNPractice && YNPractice.current() && YNPractice.current().perf().drawn, null, { timeout: 15000 }).then(() => true, () => false), '라이브 악보가 그려짐');
  const HZ = 'YNPractice.current().P.ensureTab("harmony")._ui';
  const harmKeys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => /^yn\.pv\.harm\.DRIVE/.test(k)).map((k) => { const d = JSON.parse(localStorage.getItem(k)); return k.slice(12, 21) + ':' + Object.keys(d.pages || {}).length; }).sort());

  console.log('■ 1. 예배 전 전체 준비');
  await page.evaluate(() => { document.querySelector('.pv-morebtn').click(); });
  await sleep(200);
  ok(await page.evaluate(() => !!document.querySelector('.pv-prepbtn') && !!document.querySelector('.pv-wsonbtn') && !!document.querySelector('.pv-pedalbtn')), '「⋯」 안에 전체 준비 · 예배 모드 · 페달 단추');
  await page.evaluate(() => document.querySelector('.pv-prepbtn').click());
  ok(await page.waitForSelector('.pv-prep', { timeout: 4000 }).then(() => true, () => false), '준비 진행 카드가 뜸');
  ok(await page.waitForFunction(() => { const e = document.querySelector('.pv-prep'); return e && /준비 완료|거의 준비/.test(e.textContent); }, null, { timeout: 60000 }).then(() => true, () => false), '준비가 끝남');
  const prepTxt = await page.evaluate(() => document.querySelector('.pv-prep').textContent);
  ok(/예배 준비 완료/.test(prepTxt) && /악보 3개/.test(prepTxt) && /코드 바꿀 곡 2개/.test(prepTxt), '완료 카드: 악보 3개 · 코드 바꿀 곡 2개', prepTxt);
  const hk = await harmKeys();
  ok(hk.length === 2 && hk.every((x) => /:1$/.test(x)), '키를 바꾼 두 곡만 미리 분석해 이 기기에 저장 (안 바꾼 곡은 건너뜀)', hk);
  ok(await page.evaluate(() => /✓ \d\d:\d\d/.test(document.querySelector('.pv-prepbtn').textContent)), '준비 단추에 ✓ 시각 표시');
  /* 세 번째 악보로 가면 분석 없이 바로 코드가 바뀌어 있음 */
  await page.evaluate(() => YNPractice.current().loadSheet(2, 1)); await sleep(1200);
  const s3 = await page.evaluate(`(function(){ var S=${HZ}._state; return { busy: S.busy, semis: S.semis, n: S.hits.filter(function(q){return q.kind==='chord';}).length }; })()`);
  ok(!s3.busy && s3.semis === -2 && s3.n >= 5, '준비한 곡(-2)은 열자마자 코드가 바뀌어 그려짐 (분석 대기 없음)', s3);

  console.log('■ 3. 예배 모드');
  await page.evaluate(() => YNPractice.current().loadSheet(0, 1)); await sleep(900);
  await page.evaluate(() => { document.querySelector('.pv-morebtn').click(); }); await sleep(150);
  await page.evaluate(() => document.querySelector('.pv-wsonbtn').click()); await sleep(300);
  ok(await page.evaluate(() => document.querySelector('.pv').classList.contains('pv-worship') && !document.querySelector('.pv-wsbtn').hidden), '예배 모드 켜짐 · 위에 🔒 예배 모드 표시');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.pv-tools')).display === 'none'), '필기 도구가 숨겨짐');
  await page.evaluate(() => YNPractice.current().P.setTool('pen')); await sleep(100);
  ok(await page.evaluate(() => /잠겨/.test(document.querySelector('.pv-toast').textContent)), '펜을 고르려 하면 "잠겨 있어요" 안내');
  await page.keyboard.press('Alt+KeyP'); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(200);
  ok(await page.evaluate(() => !!YNPractice.current() && !!document.querySelector('.pv')), 'Esc 로 라이브 악보가 닫히지 않음');
  await page.evaluate(() => document.querySelector('.pv-top [data-a=close]').click()); await sleep(200);
  ok(await page.evaluate(() => !!document.querySelector('.pv') && /한 번 더/.test(document.querySelector('.pv-toast').textContent)), '닫기 단추 한 번은 안내만 (실수로 닫히지 않음)');
  await sleep(2700);
  const pos = await page.evaluate(`(function(){ var pd=${HZ}._state.data.pages['1'], c=pd.chords[0], r=document.querySelector('canvas.pv-harm').getBoundingClientRect(); return { x: r.left+(c.x+c.w/2)*r.width, y: r.top+(c.y+c.h/2)*r.height }; })()`);
  await page.mouse.move(pos.x, pos.y); await page.mouse.down(); await sleep(900); await page.mouse.up(); await sleep(300);
  ok(!(await page.$('.hm-edbox')) && !(await page.evaluate(() => { const p = document.querySelector('.hm-pop'); return p && !p.classList.contains('off') && p.style.opacity === '1'; })), '코드를 길게 · 짧게 눌러도 입력 상자 · 피아노 소리 없음');
  await page.evaluate(() => YNPractice.current().P.ensureTab('harmony')._ui._setMode('chord')); await sleep(100);
  ok(await page.evaluate(`${HZ}._state.mode`) === 'view', '화음 탭의 고치기 모드도 잠김');
  await page.keyboard.press('ArrowRight'); await sleep(800);
  ok(await page.evaluate(() => YNPractice.current().perf().sheet) === 1, '→ 키(페이지 넘김)는 그대로 됨');
  ok(await page.evaluate(() => localStorage.getItem('yn.pv.worship')) === (() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })(), '오늘 날짜로 기억 (다시 열어도 예배 모드)');
  await page.evaluate(() => document.querySelector('.pv-wsbtn').click()); await sleep(150);
  ok(await page.evaluate(() => document.querySelector('.pv').classList.contains('pv-worship')), '🔒 한 번 = 그대로 (안내만)');
  await page.evaluate(() => document.querySelector('.pv-wsbtn').click()); await sleep(200);
  ok(await page.evaluate(() => !document.querySelector('.pv').classList.contains('pv-worship') && document.querySelector('.pv-wsbtn').hidden), '🔒 두 번 = 예배 모드 끔');

  console.log('■ 4. 페달 맞추기');
  await page.evaluate(() => { document.querySelector('.pv-morebtn').click(); }); await sleep(150);
  await page.evaluate(() => document.querySelector('.pv-pedalbtn').click()); await sleep(200);
  ok(await page.evaluate(() => /다음 페이지/.test((document.querySelector('.pv-pedal') || {}).textContent || '')), '페달 맞추기 카드: 다음 페이지 페달을 밟으세요');
  await page.keyboard.press('ArrowDown'); await sleep(150);
  await page.keyboard.press('ArrowDown'); await sleep(150);
  ok(await page.evaluate(() => /다른 페달/.test(document.querySelector('.pv-pedal').textContent)), '같은 페달을 두 번 밟으면 다른 페달을 요청');
  await page.keyboard.press('ArrowUp'); await sleep(250);
  ok(!(await page.$('.pv-pedal')) && await page.evaluate(() => /↓/.test(localStorage.getItem('yn.pv.pedal') ? '↓' : '')), '두 페달을 맞추면 카드가 닫히고 저장됨');
  const bpm0 = await page.evaluate(() => (document.querySelector('.pv-metbpm') || {}).textContent);
  const sh0 = await page.evaluate(() => YNPractice.current().perf());
  await page.keyboard.press('ArrowDown'); await sleep(900);
  const sh1 = await page.evaluate(() => YNPractice.current().perf());
  ok(sh1.sheet !== sh0.sheet || sh1.page !== sh0.page, '맞춘 페달(↓) = 다음 페이지 (메트로놈 BPM 대신)', { sh0: [sh0.sheet, sh0.page], sh1: [sh1.sheet, sh1.page] });
  ok(await page.evaluate(() => (document.querySelector('.pv-metbpm') || {}).textContent) === bpm0, 'BPM 은 바뀌지 않음');
  await page.keyboard.press('ArrowUp'); await sleep(900);
  const sh2 = await page.evaluate(() => YNPractice.current().perf());
  ok(sh2.sheet === sh0.sheet && sh2.page === sh0.page, '맞춘 페달(↑) = 이전 페이지');

  console.log('■ 5. 기타 카포 보기');
  await page.evaluate(() => YNPractice.current().loadSheet(0, 1)); await sleep(900);
  await page.evaluate(() => { const s = document.querySelector('[data-o=capo]'); s.value = 'auto'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500);
  const cp = await page.evaluate(`(function(){ var S=${HZ}._state, b=document.querySelector('.hm-capo'); return { capo: S.capoPg['1'], badge: b && b.style.display !== 'none' ? b.textContent : '' }; })()`);
  ok(cp.capo === 1 && /카포 1 · G 모양/.test(cp.badge), '자동: G → Ab(+1) 곡은 카포 1 · G 모양', cp);
  ok(await page.evaluate(`${HZ}._state.hits.filter(function(q){return q.kind==='chord';}).length`) === 0, '카포 1 + G 모양 = 인쇄된 코드 그대로라 덮어 그리지 않음');
  await page.evaluate(() => { const s = document.querySelector('[data-o=capo]'); s.value = '3'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500);
  const cp3 = await page.evaluate(`(function(){ var S=${HZ}._state, D=S.data.pages['1']; var HC=window.YNHarmony; return { capo: S.capoPg['1'], badge: document.querySelector('.hm-capo').textContent, n: S.hits.filter(function(q){return q.kind==='chord';}).length }; })()`);
  ok(cp3.capo === 3 && /카포 3 · F 모양/.test(cp3.badge) && cp3.n >= 5, '카포 3 고정: F 모양 코드로 덮어 그림', cp3);
  ok(await page.evaluate(() => { const r = document.querySelector('.hm-capo').getBoundingClientRect(); return r.top >= 50 && r.top < 140 && r.left < 60 && r.width > 40; }), '카포 표시가 화면 왼쪽 위에 보임');
  await page.screenshot({ path: process.env.SHOT || '/tmp/ws.png' });
  await page.evaluate(() => { const s = document.querySelector('[data-o=capo]'); s.value = 'off'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(400);
  ok(await page.evaluate(() => document.querySelector('.hm-capo').style.display) === 'none', '끄면 카포 표시가 사라짐');

  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); await rt.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
