/**
 * 스케줄 변경 강조 · 변경 기록 (브라우저 시험)
 *   다른 사람이 편성 · 안 되는 날 · 연습일을 바꾸면 → 내가 스케줄표를 처음 열 때 그 칸이 강조되고, 다시 열면 강조가 사라짐.
 *   /schedule/history 에서 누가 · 무엇을 바꿨는지 보임.
 *   NODE_PATH=$(npm root -g) node scripts/e2e-sched-changes.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const TEAM = 'Kairos';
const TABS = {
  '회원': [{ ID: 'm1', 이메일: 'lead@test', 이름: '김리더', 소속팀: TEAM, 역할: '팀원' }, { ID: 'm2', 이메일: 'b@test', 이름: '이영희', 소속팀: TEAM, 역할: '건반' }, { ID: 'm3', 이메일: 'c@test', 이름: '박철수', 소속팀: TEAM, 역할: '건반' }],
  '불가일정': [], '찬양편성': [], '연습일정': [],
};
const rowsOf = (tab) => (TABS[tab] = TABS[tab] || []);
const sheetsDbPath = require.resolve(path.join(ROOT, 'lib/sheetsDb'));
require.cache[sheetsDbPath] = { id: sheetsDbPath, filename: sheetsDbPath, loaded: true, exports: new Proxy({
  readAll: async (tab) => rowsOf(tab).map((r, i) => Object.assign({ __row: i + 2 }, r)),
  findWhere: async (tab, pred) => rowsOf(tab).map((r, i) => Object.assign({ __row: i + 2 }, r)).find(pred) || null, findOne: async () => null,
  appendRow: async (tab, obj) => { rowsOf(tab).push(Object.assign({}, obj)); return {}; },
  appendRows: async (tab, objs) => { objs.forEach((o) => rowsOf(tab).push(Object.assign({}, o))); return objs.length; },
  updateRow: async (tab, row, obj) => { const t = rowsOf(tab); t[row - 2] = Object.assign({}, obj); delete t[row - 2].__row; return {}; },
  deleteRow: async (tab, row) => { rowsOf(tab).splice(row - 2, 1); return {}; },
  deleteRows: async (tab, rows) => { rows.slice().sort((a, b) => b - a).forEach((row) => rowsOf(tab).splice(row - 2, 1)); return {}; },
  invalidate: () => {}, folderId: () => 'FOLDER', getSetting: async (k, f) => f,
}, { get: (t, k) => (k in t ? t[k] : async () => null) }) };
const gaPath = require.resolve(path.join(ROOT, 'lib/googleAuth'));
require.cache[gaPath] = { id: gaPath, filename: gaPath, loaded: true, exports: new Proxy({}, { get: () => () => ({}) }) };
let ME = '김리더';
const tcPath = require.resolve(path.join(ROOT, 'lib/teamContext'));
const realTc = require(tcPath);
require.cache[tcPath] = { id: tcPath, filename: tcPath, loaded: true, exports: Object.assign({}, realTc, { resolve: async () => ({ current: TEAM, teams: [TEAM], member: { 이름: ME, 이메일: ME + '@test' }, isAdmin: false }), teamSwitcher: () => '' }) };

(async () => {
  const { chromium } = require('playwright');
  const express = require('express');
  const hubApi = require(path.join(ROOT, 'lib/hubApi'));
  const week = require(path.join(ROOT, 'lib/weekUtil'));
  const app = express();
  app.use(express.urlencoded({ extended: true })); app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { req.session = { uid: ME + '@test' }; next(); });
  app.use(express.static(path.join(ROOT, 'public')));
  app.use(require(path.join(ROOT, 'routes/live')));
  app.use(require(path.join(ROOT, 'routes/schedule')));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const br = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const sun1 = week.normalizeDate(null), sun2 = week.shiftWeek(sun1, 1);
  const B = { name: '이영희', team: TEAM, canEdit: true, admin: false };
  const C = { name: '박철수', team: TEAM, canEdit: true, admin: false };

  for (const [w, h, nm] of [[1280, 900, 'pc'], [390, 844, 'phone']]) {
    console.log('■ ' + nm);
    TABS['스케줄변경기록'] = []; TABS['스케줄확인'] = []; TABS['찬양편성'] = [{ ID: 'a0', 팀ID: TEAM, 날짜: sun1, 포지션: '피아노', 이름: '박철수', 행사ID: '' }]; TABS['불가일정'] = []; TABS['연습일정'] = [];
    const ctx = await br.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', isMobile: nm === 'phone', hasTouch: nm === 'phone' });
    const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(nm + ': ' + e.message));
    ME = '김리더';
    await page.goto(BASE + '/schedule?team=' + TEAM);
    await page.waitForFunction(() => window.ST && ST.rows && window.SCHED_CHANGES && SCHED_CHANGES.map, null, { timeout: 15000 });
    ok(rowsOf('스케줄확인').some((r) => r['이름'] === '김리더'), '처음 열면 확인 시각이 저장됨');
    ok(!(await page.$('.chg-banner')), '처음엔 강조할 변경 없음');
    await sleep(20);

    /* 다른 사람들이 바꿈 */
    await hubApi.FNS.setWorshipSlot(B, sun1, '피아노', ['이영희']);
    await hubApi.FNS.setWorshipSlot(B, sun2, '드럼', ['박철수']);
    await hubApi.FNS.setMyUnavailableMany(C, [sun2], '출장', 'all');
    await hubApi.FNS.worshipPracticeSet(C, sun1, { mode: 'set', date: addDays(sun1, -3), note: '' });
    const log = rowsOf('스케줄변경기록');
    ok(log.length === 4 && log.every((r) => r['변경자'] === '이영희' || r['변경자'] === '박철수'), '변경 4건 기록 (변경자 포함)', log.map((r) => [r['종류'], r['포지션'], r['이전'], r['이후'], r['변경자']]));
    ok(log.some((r) => r['종류'] === '편성' && r['이전'] === '박철수' && r['이후'] === '이영희'), '편성 이전 → 이후 기록');
    /* 내가 바꾼 것은 강조 안 함 */
    await hubApi.FNS.setWorshipSlot({ name: '김리더', team: TEAM, canEdit: true }, sun2, '베이스', ['김리더']);

    await page.reload();
    await page.waitForFunction(() => document.querySelector('.chg-banner'), null, { timeout: 15000 }).catch(() => {});
    const st = await page.evaluate(() => ({
      banner: (document.querySelector('.chg-banner b') || {}).textContent || '',
      cells: [...document.querySelectorAll('.chg')].map((n) => (n.getAttribute('onclick') || n.className).slice(0, 40)),
      days: document.querySelectorAll('.chg-day').length,
      tip: (document.querySelector('[onclick*="피아노"].chg') || {}).title || '',
      newName: document.querySelectorAll('.chg-new').length,
    }));
    ok(/4건/.test(st.banner), '"마지막으로 본 뒤 바뀐 곳 4건" 띠', st.banner);
    ok(st.cells.some((c) => /피아노/.test(c)) && st.cells.some((c) => /드럼/.test(c)), '바뀐 편성 칸 강조', st.cells);
    ok(!st.cells.some((c) => /베이스/.test(c)), '내가 바꾼 칸은 강조 안 함', st.cells);
    ok(st.days >= 2, '바뀐 날짜에 "변경" 표시', st.days);
    ok(/박철수 → 이영희/.test(st.tip) && /이영희/.test(st.tip), '칸에 이전 → 이후 · 누가', st.tip);
    ok(st.newName >= 1, '새로 들어온 이름 표시', st.newName);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/chg-' + nm + '-1.png' });
    await page.click('.chg-banner [data-a="open"]');
    const items = await page.$$eval('.chg-list li', (l) => l.map((x) => x.textContent));
    ok(items.length === 4 && items.some((t) => /연습일/.test(t)) && items.some((t) => /출장/.test(t)), '자세히 — 편성 · 불가 · 연습일 목록', items);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/chg-' + nm + '-2.png' });
    /* 날짜를 누르면 그날 바뀐 것 */
    await page.evaluate((k) => stDay(k), sun1);
    ok(await page.waitForSelector('#ynPortal .chg-daybox', { timeout: 4000 }).then(() => true, () => false), '날짜 자세히에도 바뀐 것');
    await page.evaluate(() => YC.close(true));
    /* 범위를 바꿔 다시 그려도 강조 유지 */
    await page.evaluate(() => { ST.view = ST.view === 'card' ? 'table' : 'card'; render(); });
    ok(await page.evaluate(() => document.querySelectorAll('.chg').length > 0), '보기를 바꿔도(카드 ↔ 테이블) 강조 유지');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/chg-' + nm + '-3.png' });
    /* 확인 → 꺼짐 */
    await page.click('.chg-banner [data-a="ok"]');
    ok(await page.evaluate(() => !document.querySelector('.chg-banner') && !document.querySelector('.chg')), '「확인」 누르면 강조 꺼짐');
    /* 다시 열면 강조 없음 (처음 볼 때만) */
    await page.reload();
    await page.waitForFunction(() => window.SCHED_CHANGES && SCHED_CHANGES.map, null, { timeout: 15000 });
    ok(await page.evaluate(() => !document.querySelector('.chg-banner') && !document.querySelector('.chg')), '다시 열면 강조 없음');

    /* 변경 기록 화면 */
    await page.goto(BASE + '/schedule/history?team=' + TEAM);
    const hist = await page.evaluate(() => ({ n: document.querySelectorAll('.sh-item').length, txt: document.body.innerText }));
    ok(hist.n === 5, '변경 기록 5건 (내 것 포함)', hist.n);
    ok(/이영희/.test(hist.txt) && /박철수/.test(hist.txt) && /출장/.test(hist.txt) && /연습일/.test(hist.txt), '누가 · 무엇을 보임');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/chg-' + nm + '-hist.png', fullPage: true });
    await page.selectOption('select[name="who"]', '박철수');
    await page.waitForFunction(() => /who=/.test(location.search) && document.querySelectorAll('.sh-item').length === 4, null, { timeout: 8000 }).catch(() => {});
    const n2 = await page.$$eval('.sh-item', (l) => l.length);
    ok(n2 === 4, '사람으로 거르기 (바꾼 사람 · 바뀐 칸의 사람)', n2);
    await page.selectOption('select[name="kind"]', '연습');
    await page.waitForFunction(() => /kind=/.test(location.search) && document.querySelectorAll('.sh-item').length === 1, null, { timeout: 8000 }).catch(() => {});
    ok((await page.$$eval('.sh-item', (l) => l.length)) === 1, '종류로 거르기');
    await ctx.close();
  }
  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
function addDays(d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
