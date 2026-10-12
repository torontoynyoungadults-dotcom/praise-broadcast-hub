/**
 * 라이브러리 — 날짜를 누르면 그날 선 사람 · 콘티 · 악보 · 녹음 자세히 (v12 · public/worship/libday.js)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-libday.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const TEAM = 'Kairos';
const D1 = '2026-09-27', D2 = '2026-08-30';
const LINK = 'https://drive.google.com/file/d/FILE1/view';
const TABS = {
  '회원': [{ ID: 'm1', 이메일: 'lead@test', 이름: '김리더', 소속팀: TEAM, 역할: '팀원' }],
  '찬양콘티': [
    { ID: 's1', 팀ID: TEAM, 날짜: D1, 구분: '콘티', 순서: 1, 제목: 'Way Maker', Key: 'E', 유튜브: 'https://www.youtube.com/watch?v=n4XWfwLHeLM', 송폼: 'V1-C-V2-C-B', BPM: '68', 비고: '브릿지 3번', 팀: 'Sinach', 솔로: JSON.stringify([{ name: '박소망', part: '2절' }]) },
    { ID: 's2', 팀ID: TEAM, 날짜: D1, 구분: '콘티', 순서: 2, 제목: '주의 은혜라', Key: 'G', BPM: '72', 팀: '' },
    { ID: 's3', 팀ID: TEAM, 날짜: D2, 구분: '콘티', 순서: 1, 제목: 'Way Maker', Key: 'D', BPM: '66', 송폼: 'V1-C', 팀: 'Sinach' },
    { ID: 's4', 팀ID: 'Other', 날짜: D1, 구분: '콘티', 순서: 1, 제목: '다른 팀 곡', Key: 'A' }],
  '악보저장소': [{ ID: 'f1', 팀ID: TEAM, 날짜: D1, 제목: 'Way Maker', 파일링크: LINK, 곡ID: 's1' }, { ID: 'f2', 팀ID: TEAM, 날짜: D1, 제목: '주의 은혜라', 파일링크: 'https://drive.google.com/file/d/FILE2/view', 곡ID: 's2' }],
  '찬양편성': [{ ID: 'a1', 팀ID: TEAM, 날짜: D1, 포지션: '인도자', 이름: '김인도' }, { ID: 'a2', 팀ID: TEAM, 날짜: D1, 포지션: '피아노', 이름: '이피아노' }, { ID: 'a3', 팀ID: TEAM, 날짜: D1, 포지션: '음향', 이름: '한음향' },
    { ID: 'a4', 팀ID: TEAM, 날짜: D2, 포지션: '인도자', 이름: '오리더' }, { ID: 'a5', 팀ID: 'Other', 날짜: D1, 포지션: '드럼', 이름: '남의팀' }],
  '녹음': [{ ID: 'r1', 팀ID: TEAM, 날짜: D1, 제목: '9/27 연습', 구분: '연습', 올린사람: '김리더', 링크: 'https://drive.google.com/file/d/REC1/view' }],
};
const rowsOf = (tab) => (TABS[tab] = TABS[tab] || []);
const sheetsDbPath = require.resolve(path.join(ROOT, 'lib/sheetsDb'));
require.cache[sheetsDbPath] = { id: sheetsDbPath, filename: sheetsDbPath, loaded: true, exports: new Proxy({
  readAll: async (tab) => rowsOf(tab).map((r, i) => Object.assign({ __row: i + 2 }, r)),
  findWhere: async (tab, pred) => rowsOf(tab).find(pred) || null, findOne: async () => null,
  appendRow: async (tab, obj) => { rowsOf(tab).push(Object.assign({}, obj)); return {}; },
  appendRows: async (tab, objs) => { objs.forEach((o) => rowsOf(tab).push(Object.assign({}, o))); return {}; },
  updateRow: async (tab, row, obj) => { const t = rowsOf(tab); t[row - 2] = Object.assign({}, obj); delete t[row - 2].__row; return {}; },
  updateCells: async (tab, cells) => { const t = rowsOf(tab); cells.forEach((c) => { if (t[c.row - 2]) t[c.row - 2][c.header] = c.value; }); return {}; },
  deleteRow: async (tab, row) => { rowsOf(tab).splice(row - 2, 1); return {}; },
  deleteRows: async (tab, rows) => { rows.slice().sort((a, b) => b - a).forEach((row) => rowsOf(tab).splice(row - 2, 1)); return {}; },
  invalidate: () => {}, folderId: () => 'FOLDER', getSetting: async (k, f) => f,
}, { get: (t, k) => (k in t ? t[k] : async () => null) }) };
const gaPath = require.resolve(path.join(ROOT, 'lib/googleAuth'));
require.cache[gaPath] = { id: gaPath, filename: gaPath, loaded: true, exports: new Proxy({ serviceAuth: () => ({ getAccessToken: async () => ({ token: 'fake' }) }) }, { get: (t, k) => (k in t ? t[k] : () => ({})) }) };
const tcPath = require.resolve(path.join(ROOT, 'lib/teamContext'));
const realTc = require(tcPath);
require.cache[tcPath] = { id: tcPath, filename: tcPath, loaded: true, exports: Object.assign({}, realTc, { resolve: async () => ({ current: TEAM, teams: [TEAM], member: { 이름: '김리더', 이메일: 'lead@test' }, isAdmin: false }), teamSwitcher: () => '' }) };
const honPath = require.resolve(path.join(ROOT, 'lib/honorific'));
require.cache[honPath] = { id: honPath, filename: honPath, loaded: true, exports: new Proxy({ pastorSet: async () => new Set() }, { get: (t, k) => (k in t ? t[k] : () => '') }) };

(async () => {
  const { chromium } = require('playwright');
  const express = require('express');
  const app = express();
  app.use(express.urlencoded({ extended: true })); app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { req.session = { uid: 'lead@test' }; next(); });
  app.use(express.static(path.join(ROOT, 'public')));
  app.use(require(path.join(ROOT, 'routes/live')));
  app.use(require(path.join(ROOT, 'routes/library')));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const hubApi = require(path.join(ROOT, 'lib/hubApi'));
  const det = await hubApi.FNS.worshipDayDetail({ team: TEAM, name: '김리더', canEdit: true }, D1);
  ok(det.slots['인도자'][0] === '김인도' && det.songs.length === 2 && det.songs[0].form === 'V1-C-V2-C-B' && det.files.length === 2 && det.recs.length === 1 && !det.slots['드럼'], '서버: worshipDayDetail — 우리 팀 편성 · 콘티 · 악보 · 녹음만', det);
  const br = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  for (const th of ['dark', 'light']) {
    console.log('■ ' + th);
    const ctx = await br.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ko-KR', colorScheme: th });
    await ctx.addInitScript((t) => { try { localStorage.setItem('ph-theme', t); localStorage.setItem('ynTheme', t); } catch (e) {} }, th);
    const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(th + ': ' + e.message));
    await page.goto(BASE + '/library?team=' + TEAM + '&v=repo');
    ok(await page.waitForSelector('.rp-main:has-text("Way Maker")', { timeout: 15000 }).then(() => true, () => false), '곡 · 악보 목록');
    await page.click('.rp-main:has-text("Way Maker")'); await sleep(300);
    const hd = await page.$$eval('.rp-hd', (xs) => xs.map((x) => x.textContent));
    ok(hd.length === 2, '지난 콘티 기록: 날짜가 버튼 (2번)', hd);
    await page.click('.rp-hd >> nth=0');
    ok(await page.waitForFunction(() => { const s = document.querySelector('.yc-sh .ld'); return s && !s.hasAttribute('aria-busy') && document.querySelector('.ld-song'); }, null, { timeout: 10000 }).then(() => true, () => false), '시트가 열리고 그날 내용이 채워짐');
    const info = await page.evaluate(() => { const s = document.querySelector('.yc-sh'); return { sub: (s.querySelector('.ld-sub') || {}).textContent, song: s.querySelector('.ld-song').textContent, all: s.textContent, rows: s.querySelectorAll('.ld-row').length, on: (s.querySelector('.ld-row.on') || {}).textContent || '', hot: [...s.querySelectorAll('.ld-song .afile')].map((a) => ({ t: a.textContent, h: a.getAttribute('href') })), recs: s.querySelectorAll('.arrecs .rec').length }; });
    ok(/인도 김인도/.test(info.sub), '제목 아래 그날 인도자', info.sub);
    ok(/E/.test(info.song) && /68/.test(info.song) && /V1-C-V2-C-B/.test(info.song) && /박소망 \(2절\)/.test(info.song) && /브릿지 3번/.test(info.song), '고른 곡: Key · BPM · 송폼 · 솔로 · 비고', info.song);
    ok(info.hot.some((x) => /Way Maker/.test(x.t) && /\/library\/live\?id=f1/.test(x.h)) && info.hot.some((x) => /YouTube/.test(x.t)), '고른 곡의 악보 = 라이브 악보 링크 + YouTube', info.hot);
    ok(['이피아노', '한음향'].every((n) => info.all.includes(n)) && !/남의팀/.test(info.all), '그날 선 사람 (다른 팀 편성은 빠짐)');
    ok(info.rows === 2 && /Way Maker/.test(info.on), '그날 콘티 2곡 · 이 곡 강조', info);
    ok(info.recs === 1, '그날 녹음', info.recs);
    await sleep(600); if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/praise-libday-' + th + '.png' });
    await page.evaluate(() => YC.close(true));
    await page.click('.rp-hd >> nth=1');
    ok(await page.waitForFunction(() => { const s = document.querySelector('.yc-sh'); return s && /오리더/.test(s.textContent) && document.querySelector('.ld-song') && /V1-C/.test(document.querySelector('.ld-song').textContent) && !/김인도/.test(s.textContent); }, null, { timeout: 10000 }).then(() => true, () => false), '다른 날짜: 그날 인도 · Key');
    await page.evaluate(() => YC.close(true));
    /* 아카이브 곡별 · 날짜별 */
    await page.evaluate(() => { AR.view = 'song'; AR.range = 'all'; tab('archive'); });
    await page.waitForSelector('.arsg', { timeout: 10000 });
    await page.click('.arsg:has-text("Way Maker") .adates button >> nth=0');
    ok(await page.waitForFunction(() => !!document.querySelector('.yc-sh .ld-song'), null, { timeout: 10000 }).then(() => true, () => false), '아카이브 곡별: 날짜 → 그날 자세히');
    await page.evaluate(() => YC.close(true));
    await page.evaluate(() => { AR.view = 'date'; render(); });
    await page.waitForSelector('.arday', { timeout: 10000 });
    await page.click('.arday:has-text("Way Maker") .arbtns button:has-text("자세히") >> nth=0');
    ok(await page.waitForFunction(() => { const s = document.querySelector('.yc-sh .ld'); return s && !s.hasAttribute('aria-busy') && document.querySelectorAll('.ld-row').length >= 1 && !document.querySelector('.ld-song'); }, null, { timeout: 10000 }).then(() => true, () => false), '아카이브 날짜별: 「자세히」');
    await page.evaluate(() => YC.close(true));
    /* 통계 */
    await page.evaluate(() => tab('stats'));
    await page.waitForFunction(() => window.SS && SS.data && SS.names, null, { timeout: 10000 });
    const c = await page.evaluate(() => Object.keys(SS.names).find((k) => /Way Maker/.test(SS.names[k])));
    await page.evaluate((k) => { SS.range = 'all'; songSheet(k); }, c);
    ok(await page.waitForFunction(() => document.querySelectorAll('.yg-day').length >= 2, null, { timeout: 8000 }).then(() => true, () => false), '통계: 부른 날이 버튼');
    await page.click('.yg-day >> nth=0');
    ok(await page.waitForFunction(() => !document.querySelector('.yg-ov') && !!document.querySelector('.yc-sh .ld-song'), null, { timeout: 10000 }).then(() => true, () => false), '통계: 날짜 → 그날 자세히');
    if (th === 'light') {
      const bad = await page.evaluate(() => { const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }; const bg = getComputedStyle(document.querySelector('.yc-sh')).backgroundColor; const dark = lum(bg) < 0.5; const out = []; document.querySelectorAll('.ld-st b, .ld-kv b, .ld-row .at').forEach((e) => { const l = lum(getComputedStyle(e).color); if (dark ? l < 0.5 : l > 0.7) out.push(e.textContent.slice(0, 12)); }); return out; });
      ok(bad.length === 0, '밝은 화면: 글씨가 잘 보임', bad);
    }
    await ctx.close();
  }
  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
