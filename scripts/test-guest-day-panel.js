/**
 * 예배콘티(로그인 화면) — 객원이 스케줄에 있는 날에만 "객원 공유 링크" 칸이 나옴 (서버 시험)
 *   node scripts/test-guest-day-panel.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const TEAM = 'Kairos';
const TABS = { '회원': [{ '이름': '김리더', '이메일': 'a@test', '소속팀': TEAM }, { '이름': '이객원', '이메일': 'g@test', '소속팀': TEAM, '객원': 'TRUE' }], '팀원명단': [], '찬양팀': [{ '팀명': TEAM, '활성여부': 'TRUE' }], '설정': [], '찬양콘티': [], '악보저장소': [], '녹음': [], '콘티댓글': [], '찬양편성': [], '연습일정': [], '특별예배': [] };
const rowsOf = (tab) => (TABS[tab] = TABS[tab] || []);
const stub = (p, ex) => { const f = require.resolve(path.join(ROOT, p)); require.cache[f] = { id: f, filename: f, loaded: true, exports: ex }; };
stub('lib/sheetsDb', new Proxy({
  readAll: async (tab) => rowsOf(tab).map((r, i) => Object.assign({ __row: i + 2 }, r)),
  findOne: async (tab, col, v) => rowsOf(tab).map((r, i) => Object.assign({ __row: i + 2 }, r)).find((r) => r[col] === v) || null,
  appendRow: async (tab, obj) => { rowsOf(tab).push(Object.assign({}, obj)); return {}; },
  appendRows: async (tab, objs) => { objs.forEach((o) => rowsOf(tab).push(Object.assign({}, o))); return objs.length; },
  updateRow: async (tab, row, obj) => { const t = rowsOf(tab); t[row - 2] = Object.assign({}, obj); delete t[row - 2].__row; return {}; },
  updateCells: async () => ({}), deleteRow: async () => ({}), invalidate: () => {}, folderId: () => 'FOLDER', getSetting: async (k, f) => f,
}, { get: (t, k) => (k in t ? t[k] : async () => null) }));
stub('lib/googleAuth', new Proxy({}, { get: () => () => ({}) }));
stub('lib/notify', new Proxy({}, { get: () => () => {} }));
let ADMIN = false;
const tcPath = require.resolve(path.join(ROOT, 'lib/teamContext'));
const realTc = require(tcPath);
require.cache[tcPath] = { id: tcPath, filename: tcPath, loaded: true, exports: Object.assign({}, realTc, { resolve: async () => ({ current: TEAM, teams: [TEAM], member: { 이름: '김리더', 이메일: 'a@test' }, isAdmin: ADMIN }), teamSwitcher: () => '' }) };

(async () => {
  const express = require('express');
  const week = require(path.join(ROOT, 'lib/weekUtil'));
  const app = express();
  app.use(express.urlencoded({ extended: true })); app.use(express.json());
  app.use((req, res, next) => { req.session = { uid: 'a@test' }; next(); });
  app.use(require(path.join(ROOT, 'routes/conti')));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const sun = week.normalizeDate(null);
  const page = async () => { const r = await fetch(BASE + '/conti?team=' + TEAM + '&date=' + sun + '&partial=1', { headers: { 'X-PH-Partial': '1' } }); const j = await r.json().catch(() => null); return j && j.html ? j.html : ''; };

  let html = await page();
  ok(html.length > 500 && !/cn-guestday/.test(html), '팀원만 서는 날 — 객원 링크 칸이 없음');
  rowsOf('찬양편성').push({ '팀ID': TEAM, '날짜': sun, '행사ID': '', '포지션': '인도자', '이름': '김리더' }, { '팀ID': TEAM, '날짜': sun, '행사ID': '', '포지션': '키보드', '이름': '이객원' });
  html = await page();
  ok(/cn-guestday/.test(html) && /이객원/.test(html), '객원 멤버가 스케줄에 있으면 링크 칸이 나옴');
  const m = /value="([^"]*\/g\/[A-Za-z0-9_-]{16,64})"/.exec(html);
  ok(!!m, '바로 복사할 수 있는 /g/<열쇠> 주소가 보임', m && m[1]);
  const again = /value="([^"]*\/g\/[A-Za-z0-9_-]{16,64})"/.exec(await page());
  ok(again && again[1] === m[1], '다시 열어도 같은 주소');
  ok(!/guest-day-link/.test(html), '관리자가 아니면 "새 링크로 바꾸기" 단추 없음');
  rowsOf('찬양편성').push({ '팀ID': TEAM, '날짜': sun, '행사ID': '', '포지션': '드럼', '이름': '명단에없는사람' });
  ok(/명단에없는사람/.test(await page()), '팀 명단에 없는 객원 이름(직접 입력)도 객원으로 봄');
  ADMIN = true;
  html = await page();
  ok(/guest-day-link/.test(html), '관리자에게는 "새 링크로 바꾸기" 단추');
  const old = m[1].split('/g/')[1];
  const r = await fetch(BASE + '/conti/guest-day-link', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-PH-Partial': '1' }, body: new URLSearchParams({ team: TEAM, date: sun }) });
  const neu = /value="([^"]*\/g\/([A-Za-z0-9_-]{16,64}))"/.exec(await page());
  ok(neu && neu[2] !== old, '새 링크로 바꾸면 주소가 달라짐', r.status);
  TABS['찬양편성'] = [{ '팀ID': TEAM, '날짜': sun, '행사ID': '', '포지션': '인도자', '이름': '김리더' }];   // 객원 없는 날 — 관리자만 접힌 칸으로 직접 만들기
  html = await page();
  ok(/cn-guestday/.test(html) && /직접 만들기/.test(html) && !/cn-guestday" open/.test(html), '객원이 안 잡히는 날 — 관리자에게 접힌 「직접 만들기」 칸');
  ADMIN = false;
  ok(!/cn-guestday/.test(await page()), '관리자가 아니면 그 칸도 없음');
  server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
