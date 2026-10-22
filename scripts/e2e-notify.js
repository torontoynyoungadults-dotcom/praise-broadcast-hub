/**
 * 알림(종 아이콘) — 서버(구독 · 자동 알림 · 보내기 · 권한) + 화면(종 · 알림 창 · 악보 고르기) 시험
 *   NODE_PATH=$(npm root -g) node scripts/e2e-notify.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; fails.push(m); console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stub = (rel, exports) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

/* ---------- 메모리 시트 ---------- */
const now = Date.now(), iso = (msAgo) => new Date(now - msAgo).toISOString();
const T = {
  설정: [], 알림: [], 알림구독: [],
  회원: [
    { 이름: '김리더', 이메일: 'lead@test', 소속팀: 'Kairos' },
    { 이름: '박싱어', 이메일: 'singer@test', 소속팀: 'Kairos' },
    { 이름: '이중지', 이메일: 'paused@test', 소속팀: 'Kairos', 접속중지: 'TRUE' },
    { 이름: '최객원', 이메일: 'guest@test', 소속팀: 'Kairos', 객원: 'TRUE' },
    { 이름: '정타팀', 이메일: 'other@test', 소속팀: 'Selah' },
  ],
  악보저장소: [
    { ID: 'F1', 팀ID: 'Kairos', 날짜: '2026-10-25', 행사ID: '', 제목: 'Way Maker.pdf', 올린사람: '김리더', 올린시각: iso(5 * 60e3) },
    { ID: 'F2', 팀ID: 'Kairos', 날짜: '2026-10-25', 행사ID: '', 제목: 'Holy Forever.pdf', 올린사람: '김리더', 올린시각: iso(2 * 3600e3) },
    { ID: 'F3', 팀ID: 'Kairos', 날짜: '2026-10-11', 행사ID: '', 제목: '아주 옛 악보', 올린사람: '김리더', 올린시각: iso(20 * 24 * 3600e3) },
    { ID: 'F4', 팀ID: 'Selah', 날짜: '2026-10-25', 행사ID: '', 제목: '다른 팀 악보', 올린사람: '정타팀', 올린시각: iso(60e3) },
  ],
};
const DB = {
  readAll: async (tab) => (T[tab] || []).map((r, i) => Object.assign({ __row: i + 2 }, r)),
  findOne: async (tab, col, val) => { const r = (T[tab] || []).findIndex((x) => x[col] === val); return r < 0 ? null : Object.assign({ __row: r + 2 }, T[tab][r]); },
  getSetting: async (k, fb) => { const r = T.설정.find((x) => x.키 === k); return r ? r.값 : fb; },
  appendRow: async (tab, o) => { (T[tab] = T[tab] || []).push(Object.assign({}, o)); },
  updateRow: async (tab, row, o) => { T[tab][row - 2] = Object.assign({}, o); },
  deleteRows: async (tab, rows) => { const s = new Set(rows); T[tab] = T[tab].filter((_, i) => !s.has(i + 2)); },
  invalidate: () => {},
};
stub('lib/sheetsDb', DB);

/* ---------- 가짜 푸시 서버 ---------- */
const PUSHED = []; let DEAD = new Set();
const realWp = require('web-push');
const wpPath = require.resolve('web-push');
require.cache[wpPath] = { id: wpPath, filename: wpPath, loaded: true, exports: Object.assign({}, realWp, {
  setVapidDetails: () => {},
  sendNotification: async (sub, payload) => { if (DEAD.has(sub.endpoint)) { const e = new Error('gone'); e.statusCode = 410; throw e; } PUSHED.push({ ep: sub.endpoint, payload: JSON.parse(payload) }); },
}) };

/* ---------- 로그인한 사람 바꿔 가며 ---------- */
let WHO = 'lead@test';
stub('lib/teamContext', {
  resolve: async (req) => {
    const m = T.회원.find((x) => x.이메일 === WHO);
    const teams = String(m.소속팀).split(',');
    const t = String(req.query.team || '').trim();
    return { member: m, isAdmin: false, teams, current: teams.includes(t) ? t : teams[0], roles: [] };
  },
});

const notify = require(path.join(ROOT, 'lib/notify'));
const sub = (n) => ({ endpoint: 'https://push.example/' + n, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });

(async () => {
  /* 1) 키 — 한 번만 만들어 보관 */
  const [k1, k2] = await Promise.all([notify.publicKey(), notify.publicKey()]);
  ok(k1 && k1 === k2 && T.설정.filter((r) => r.키 === 'VAPID공개키').length === 1 && T.설정.filter((r) => r.키 === 'VAPID비밀키').length === 1, '푸시 키는 한 번만 만들어 설정 탭에 보관');

  /* 2) 구독 */
  await notify.subscribe('lead@test', sub('lead-phone'), 'iPhone');
  await notify.subscribe('singer@test', sub('singer-phone'), 'Android');
  await notify.subscribe('singer@test', sub('singer-pc'), 'PC');
  await notify.subscribe('singer@test', sub('singer-pc'), 'PC');                   // 같은 기기 다시 → 중복 없음
  await notify.subscribe('paused@test', sub('paused-phone'), 'x');
  await notify.subscribe('other@test', sub('other-phone'), 'x');
  ok(T.알림구독.length === 5, '같은 기기를 다시 켜도 한 줄만', T.알림구독.length);
  let bad = false; try { await notify.subscribe('lead@test', { endpoint: 'http://x', keys: {} }); } catch (e) { bad = true; }
  ok(bad, '이상한 구독 정보는 거절');

  /* 3) 콘티 곡 자동 알림 — 세 곡을 연달아 올려도 알림은 한 번 */
  const scope = { date: '2026-10-25', event: '' };
  notify.contiSongAdded('Kairos', scope, 'Way Maker', '김리더', 'lead@test');
  notify.contiSongAdded('Kairos', scope, 'Holy Forever', '김리더', 'lead@test');
  notify.contiSongAdded('Kairos', scope, 'Way Maker', '김리더', 'lead@test');       // 같은 곡 두 번 → 한 번만 적힘
  ok(T.알림.length === 0, '모으는 동안은 아직 안 보냄');
  await notify.flushPending();
  ok(T.알림.length === 1 && T.알림[0].종류 === '콘티' && /Way Maker, Holy Forever/.test(T.알림[0].내용) && /10\/25/.test(T.알림[0].제목), '곡 여러 개 → 알림 한 개', T.알림);
  const eps = PUSHED.map((p) => p.ep).sort();
  ok(JSON.stringify(eps) === JSON.stringify(['https://push.example/singer-pc', 'https://push.example/singer-phone']), '같은 팀 · 보낸 사람 빼고 · 접속중지 빼고 · 다른 팀 빼고 푸시', eps);
  ok(PUSHED[0].payload.url === '/conti?team=Kairos&date=2026-10-25', '누르면 그 주 콘티로', PUSHED[0].payload.url);

  /* 4) 끝난 구독은 정리 */
  PUSHED.length = 0; DEAD = new Set(['https://push.example/singer-pc']);
  await notify.send('Kairos', { kind: '직접', title: 't', body: 'b', url: '/conti', by: '김리더', byEmail: 'lead@test' });
  ok(!T.알림구독.some((r) => r.주소 === 'https://push.example/singer-pc') && T.알림구독.length === 4, '만료된 기기(410)는 구독에서 지움');
  DEAD = new Set(); PUSHED.length = 0;

  /* 5) 길(route) */
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { email: WHO }; next(); });
  app.use(require(path.join(ROOT, 'routes/notify')));
  const pageShell = require(path.join(ROOT, 'lib/pageShell'));
  app.get('/page', async (req, res) => {
    const who = { name: '김리더', team: 'Kairos', isAdmin: false, pastor: false };
    const body = `<div id="ph-tabbody">${pageShell.decorate(pageShell.hero({ eyebrow: 'Kairos', title: '예배 콘티' }), who)}</div>`;
    res.type('html').send(await pageShell.render(body, { title: '시험', who }));
  });
  app.get('/page-anon', async (req, res) => res.type('html').send(await pageShell.render(`<div id="ph-tabbody">${pageShell.decorate(pageShell.hero({ title: '로그인' }), null)}</div>`, { title: '시험' })));
  app.get('/conti', (req, res) => res.type('html').send('<h1>conti ' + (req.query.date || '') + '</h1>'));
  app.get('/sw.js', (req, res) => res.type('js').sendFile(path.join(ROOT, 'public/sw.js')));
  app.use(express.static(path.join(ROOT, 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };

  let r = await api('GET', '/notify/state?team=Kairos&ep=' + encodeURIComponent('https://push.example/lead-phone'));
  ok(r.s === 200 && r.j.canSend && r.j.subscribed && r.j.key === k1 && r.j.items.length === 2, '상태: 받은 알림 · 구독 · 공개키', r.j && { n: r.j.items && r.j.items.length, sub: r.j.subscribed });
  ok(JSON.stringify(r.j.pending.map((p) => p.id)) === '["F1","F2"]', '알릴 악보 = 최근 3일 · 이 팀 것만', r.j.pending);

  r = await api('POST', '/notify/send', { team: 'Kairos', ids: ['F1'], message: '2절 코드 바뀌었어요' });
  ok(r.s === 200 && r.j.ok && r.j.people === 1, '악보 알림 보내기', r.j);
  const row = T.알림[T.알림.length - 1];
  ok(row.종류 === '악보' && /Way Maker — 2절 코드 바뀌었어요/.test(row.내용) && !/\.pdf/.test(row.내용) && row.대상 === '["F1"]', '악보 알림 내용 · 대상 기록', row);
  r = await api('GET', '/notify/state?team=Kairos');
  ok(JSON.stringify(r.j.pending.map((p) => p.id)) === '["F2"]', '보낸 악보는 다시 안 뜸', r.j.pending);
  r = await api('POST', '/notify/send', { team: 'Kairos', ids: ['F2'] });
  ok(r.s === 429, '연달아 두 번 누르면 막음', r.s);

  WHO = 'singer@test'; await sleep(1);
  r = await api('POST', '/notify/send', { team: 'Selah', ids: ['F4'] });
  ok(r.s === 403, '다른 팀에는 못 보냄', r.s);
  WHO = 'guest@test';
  r = await api('POST', '/notify/send', { team: 'Kairos', message: 'hi' });
  ok(r.s === 403, '객원은 못 보냄', r.s);
  r = await api('GET', '/notify/state?team=Kairos');
  ok(r.j.ok && r.j.canSend === false && r.j.pending.length === 0, '객원은 받은 알림만 봄', { c: r.j.canSend, p: r.j.pending.length });
  WHO = 'singer@test';
  r = await api('POST', '/notify/send', { team: 'Kairos' });
  ok(r.s === 400, '고른 것도 글도 없으면 거절', r.s);

  /* 6) 화면 */
  T.알림 = T.알림.filter((x) => !x.대상); lastReset();        // 위 시험에서 보낸 악보 알림은 지움 (화면 시험은 처음부터)
  const { chromium } = require('playwright');
  const br = await chromium.launch({ args: ['--no-sandbox'] });
  for (const theme of ['dark', 'light']) {
    WHO = 'lead@test'; for (const k of Object.keys(PUSHED)) delete PUSHED[k]; PUSHED.length = 0; lastReset();
    const ctx = await br.newContext({ viewport: { width: 420, height: 860 }, locale: 'ko-KR' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('ph.theme', t); } catch (e) {} }, theme);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '/page?team=Kairos');
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const bell = page.locator('[data-ph-act="bell"]');
    ok(await bell.count() === 1, '[' + theme + '] 배너 오른쪽 위에 종 아이콘');
    const box = await bell.boundingBox(), rf = await page.locator('[data-ph-act="refresh"]').boundingBox();
    ok(box && rf && box.x > rf.x && Math.abs(box.y - rf.y) < 4 && box.x + box.width <= 420, '[' + theme + '] 종은 새로고침 오른쪽 끝', { box, rf });
    await page.waitForFunction(() => document.querySelector('.ph-bell.has-new, .ph-bell.has-pend'), null, { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => document.querySelector('.ph-bell').classList.contains('has-new')), '[' + theme + '] 안 읽은 알림이 있으면 빨간 점');
    if (theme === 'dark') await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/notify-toast.png' });
    ok(await page.locator('.ph-nt-toast').count() === 1, '[' + theme + '] 방금 올린 악보가 있으면 "알릴까요?" 안내');
    await bell.click();
    await page.waitForSelector('.ph-nt:not([hidden]) .ph-nt-list');
    const items = await page.locator('.ph-nt-item').count();
    ok(items >= 2, '[' + theme + '] 알림 창에 받은 알림 목록', items);
    ok(await page.locator('.ph-nt-pick').count() === 2, '[' + theme + '] 보낼 악보 2개 (옛 악보 · 다른 팀 제외)');
    ok(await page.locator('.ph-nt-push').count() === 1, '[' + theme + '] 이 기기로 알림 받기 줄');
    const inView = await page.evaluate(() => { const r = document.querySelector('.ph-nt-box').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
    ok(inView, '[' + theme + '] 알림 창이 화면 안');
    if (theme === 'dark') await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/notify-dark.png' }); else await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/notify-light.png' });
    ok(await page.evaluate(() => !document.querySelector('.ph-bell').classList.contains('has-new')), '[' + theme + '] 열어 보면 빨간 점이 사라짐');
    await page.locator('.ph-nt-pick input').nth(1).uncheck();
    ok(/1개/.test(await page.locator('.ph-nt-go').textContent()), '[' + theme + '] 고른 악보 수가 단추에 나옴');
    await page.fill('.ph-nt-msg', '악보 확인 부탁해요');
    const before = T.알림.length;
    lastSendReset();
    await page.locator('.ph-nt-go').click();
    await page.waitForFunction(() => /보냈어요/.test((document.querySelector('.ph-nt-res') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    ok(T.알림.length === before + 1 && T.알림[T.알림.length - 1].대상 === '["F2"]' || T.알림[T.알림.length - 1].대상 === '["F1"]', '[' + theme + '] 알림 보내기 → 서버에 기록', T.알림[T.알림.length - 1]);
    ok(/보냈어요/.test(await page.locator('.ph-nt-res').textContent()), '[' + theme + '] "보냈어요" 안내');
    ok(await page.locator('.ph-nt-item').count() === items + 1, '[' + theme + '] 목록에 바로 추가');
    await page.locator('.ph-nt-item').first().click();
    await page.waitForURL(/\/conti/, { timeout: 5000 }).catch(() => {});
    ok(/\/conti\?team=Kairos/.test(page.url()), '[' + theme + '] 알림을 누르면 그 콘티로', page.url());
    ok(errs.length === 0, '[' + theme + '] 페이지 오류 없음', errs);
    await ctx.close();
    // 보낸 알림은 다음 테마 시험에서도 보이게 두고, 보낼 악보는 되돌림
    T.알림 = T.알림.filter((x) => x.종류 !== '악보'); lastReset();
  }
  const ctx2 = await br.newContext(); const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/page-anon');
  ok(await p2.locator('[data-ph-act="bell"]').count() === 0, '로그인 전 화면에는 종이 없음');
  await br.close(); server.close();

  /* 7) 서비스워커 */
  const sw = require('fs').readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
  ok(/addEventListener\('push'/.test(sw) && /notificationclick/.test(sw), '서비스워커가 푸시를 받고 눌림을 처리');

  console.log(`\n${pass} 통과 · ${fail} 실패`); if (fail) { console.log(fails); process.exit(1); } process.exit(0);

  function lastReset() { PUSHED.length = 0; }
  function lastSendReset() { /* 서버의 8초 간격 제한을 시험에서는 건너뜀 */ require(path.join(ROOT, 'routes/notify')).__resetLimit && require(path.join(ROOT, 'routes/notify')).__resetLimit(); }
})().catch((e) => { console.error(e); process.exit(1); });
