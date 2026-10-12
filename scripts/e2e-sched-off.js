/**
 * 스케줄표 "내가 안 되는 날" (v12) — 날짜 단추를 누르면 바로 저장 · 다시 누르면 취소 · 사유 선택 · 금요일 연습만 / 주일만 (브라우저 시험)
 *   NODE_PATH=$(npm root -g) node scripts/e2e-sched-off.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const TEAM = 'Kairos';
const TABS = { '회원': [{ ID: 'm1', 이메일: 'lead@test', 이름: '김리더', 소속팀: TEAM, 역할: '팀원' }], '불가일정': [] };
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
  app.use(require(path.join(ROOT, 'routes/schedule')));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const br = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const offRows = () => rowsOf('불가일정').filter((r) => r['이름'] === '김리더');
  for (const [w, h, nm] of [[1280, 900, 'pc'], [390, 844, 'phone']]) {
    console.log('■ ' + nm);
    TABS['불가일정'] = [];
    const ctx = await br.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', isMobile: nm === 'phone', hasTouch: nm === 'phone' });
    const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(nm + ': ' + e.message));
    await page.goto(BASE + '/schedule?team=' + TEAM);
    ok(await page.waitForSelector('.offcard .offd', { timeout: 15000 }).then(() => true, () => false), '스케줄표 위에 "내가 안 되는 날" 카드 · 날짜 단추가 바로 보임');
    const info = await page.evaluate(() => { const c = document.querySelector('.offcard'), p = document.querySelector('.stpanel'); return { n: c.querySelectorAll('.offd').length, before: !!(c.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING), btn: !!document.querySelector('.stoffbtn'), hint: c.querySelector('.offc-hint').textContent }; });
    ok(info.n >= 10 && info.before && !info.btn, '앞으로 3개월 주일이 단추로 · 스케줄표보다 위 · 예전 "날짜 고르기" 단추 없음', info);
    if (nm === 'phone') { const fit = await page.evaluate(() => { const b = document.querySelectorAll('.offd'), r = b[b.length - 1].getBoundingClientRect(); return { right: r.right, w: innerWidth, h: r.height }; }); ok(fit.right <= fit.w && fit.h >= 44, '폰: 단추가 화면 안 · 누르기 쉬운 크기(44px 이상)', fit); }
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/praise-' + nm + '-0.png' });
    /* 누르면 바로 저장 */
    const k1 = await page.evaluate(() => { const b = document.querySelectorAll('.offd')[1]; b.click(); return b.getAttribute('onclick').match(/'([^']+)'/)[1]; });
    ok(await page.evaluate(() => document.querySelectorAll('.offd')[1].classList.contains('on')), '누르자마자 단추가 "불가"로 바뀜 (서버를 기다리지 않음)');
    await page.waitForFunction(() => /저장했어요/.test((document.getElementById('offCardMsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const r1 = offRows();
    ok(r1.length >= 1 && r1.every((r) => String(r['날짜']) === k1) && r1.some((r) => r['사유'] === '개인 사정'), '저장됨 — 사유를 안 써도 "개인 사정"', r1);
    ok(await page.evaluate(() => !!document.querySelector('.offc-ed') && /표시했어요/.test(document.querySelector('.offc-et').textContent)), '누른 날 아래에 사유 · 어느 때 칸이 열림');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/praise-' + nm + '-1.png' });
    /* 금요일 연습만 */
    await page.evaluate(() => { const b = [...document.querySelectorAll('.offc-ed .seg button')].find((x) => /연습만/.test(x.textContent)); b.click(); });
    await page.waitForFunction(() => /연습만 안 되는 날로/.test((document.getElementById('offCardMsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const mine2 = await page.evaluate((k) => (ST.mine || []).find((x) => x.date === k), k1);
    ok(mine2 && mine2.part === 'prac' && mine2.pr && !mine2.sr, '「금요일 연습만」 → 연습만 불가 (예배는 나올 수 있음)', mine2);
    ok(await page.evaluate(() => { const b = document.querySelectorAll('.offd')[1]; return b.classList.contains('half') && /금/.test(b.querySelector('i').textContent); }), '단추에 "금" 표시 (빗금)');
    await page.evaluate(() => { const b = [...document.querySelectorAll('.offc-ed .seg button')].find((x) => /주일만/.test(x.textContent)); b.click(); });
    await page.waitForFunction(() => /예배만 안 되는 날로/.test((document.getElementById('offCardMsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const mine3 = await page.evaluate((k) => (ST.mine || []).find((x) => x.date === k), k1);
    ok(mine3 && mine3.part === 'sun' && mine3.sr && !mine3.pr, '「주일만」으로 바꾸기', mine3);
    /* 사유 바꾸기 */
    await page.fill('#offWhy', '가족 행사'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => /사유를 저장했어요/.test((document.getElementById('offCardMsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(offRows().some((r) => r['사유'] === '가족 행사') && (await page.evaluate((k) => (ST.mine || []).find((x) => x.date === k), k1)).part === 'sun', '사유 저장 (어느 때는 그대로)', offRows());
    /* 여러 날 */
    await page.evaluate(() => { document.querySelectorAll('.offd')[3].click(); }); await sleep(150);
    await page.evaluate(() => { document.querySelectorAll('.offd')[4].click(); });
    await page.waitForFunction(() => document.querySelectorAll('.offd.on').length === 3 && /저장했어요/.test((document.getElementById('offCardMsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    ok(new Set(offRows().map((r) => r['날짜'])).size === 3 && /3일 표시됨/.test(await page.evaluate(() => document.querySelector('.offc-n').textContent)), '여러 날을 연달아 눌러도 각각 저장 · "3일 표시됨"', offRows().map((r) => r['날짜']));
    /* 다시 누르면 취소 */
    await page.evaluate(() => { document.querySelectorAll('.offd')[1].click(); });
    ok(await page.evaluate(() => !document.querySelectorAll('.offd')[1].classList.contains('on')), '다시 누르면 바로 취소');
    await page.waitForFunction(() => /지웠어요/.test((document.getElementById('offCardMsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(!offRows().some((r) => String(r['날짜']) === k1), '서버에서도 지워짐');
    /* 스케줄표에도 반영 */
    const tag = await page.evaluate(() => (document.querySelector('.stpanel') || {}).textContent || '');
    ok(/나 불가|나 금요일 불가|나 주일 불가/.test(tag), '아래 스케줄표에도 "나 불가" 표시', tag.slice(0, 80));
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '/praise-' + nm + '-2.png' });
    await ctx.close();
  }
  ok(errs.length === 0, '화면 오류 없음', errs);
  await br.close(); server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); if (fail) console.log('실패:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
