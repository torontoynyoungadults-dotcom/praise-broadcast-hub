/**
 * 예배콘티 변경 알림 (서버 시험 — 브라우저 없이)
 *   다른 사람이 콘티에서 곡을 더하고 · 고치고 · 순서를 바꾸고 · 지우면 → 내가 콘티를 열 때 맨 위에 알림 + 곡에 "새 곡 / 수정" 표시,
 *   메뉴 숫자(/conti/changes.json)는 개수만 세고, 콘티를 열면 확인 처리되어 사라지며, 내가 바꾼 것은 알리지 않음.
 *   node scripts/e2e-conti-changes.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const TEAM = 'Kairos';
const TABS = { '회원': [], '찬양콘티': [], '악보저장소': [], '녹음': [], '콘티댓글': [], '찬양편성': [], '연습일정': [], '특별예배': [] };
const rowsOf = (tab) => (TABS[tab] = TABS[tab] || []);
const stub = (p, ex) => { const f = require.resolve(path.join(ROOT, p)); require.cache[f] = { id: f, filename: f, loaded: true, exports: ex }; };
const quiet = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : async () => null) });
stub('lib/sheetsDb', new Proxy({
  readAll: async (tab) => rowsOf(tab).map((r, i) => Object.assign({ __row: i + 2 }, r)),
  appendRow: async (tab, obj) => { rowsOf(tab).push(Object.assign({}, obj)); return {}; },
  appendRows: async (tab, objs) => { objs.forEach((o) => rowsOf(tab).push(Object.assign({}, o))); return objs.length; },
  updateRow: async (tab, row, obj) => { const t = rowsOf(tab); t[row - 2] = Object.assign({}, obj); delete t[row - 2].__row; return {}; },
  updateCells: async (tab, cells) => { cells.forEach((c) => { rowsOf(tab)[c.row - 2][c.header] = c.value; }); return {}; },
  deleteRow: async (tab, row) => { rowsOf(tab).splice(row - 2, 1); return {}; },
  invalidate: () => {}, folderId: () => 'FOLDER', getSetting: async (k, f) => f,
}, { get: (t, k) => (k in t ? t[k] : async () => null) }));
stub('lib/googleAuth', new Proxy({}, { get: () => () => ({}) }));
stub('lib/sheetHeaders', { queue: () => 0, settle: async () => null });
stub('lib/notify', new Proxy({}, { get: () => () => {} }));
let ME = '김리더';
const tcPath = require.resolve(path.join(ROOT, 'lib/teamContext'));
const realTc = require(tcPath);
require.cache[tcPath] = { id: tcPath, filename: tcPath, loaded: true, exports: Object.assign({}, realTc, { resolve: async () => ({ current: TEAM, teams: [TEAM], member: { 이름: ME, 이메일: ME + '@test' }, isAdmin: false }), teamSwitcher: () => '' }) };

(async () => {
  const express = require('express');
  const week = require(path.join(ROOT, 'lib/weekUtil'));
  const contiLog = require(path.join(ROOT, 'lib/contiLog'));
  const app = express();
  app.use(express.urlencoded({ extended: true })); app.use(express.json());
  app.use((req, res, next) => { req.session = { uid: ME + '@test' }; next(); });
  app.use(require(path.join(ROOT, 'routes/conti')));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const sun = week.normalizeDate(null);
  const post = (p, body) => fetch(BASE + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-PH-Partial': '1' }, body: new URLSearchParams(Object.assign({ team: TEAM, date: sun }, body)).toString() });
  const getHtml = async () => { const r = await fetch(BASE + '/conti?team=' + TEAM + '&date=' + sun + '&partial=1', { headers: { 'X-PH-Partial': '1' } }); const j = await r.json().catch(() => null); return (j && j.html) || ''; };
  const badge = async () => (await (await fetch(BASE + '/conti/changes.json?team=' + TEAM)).json()).n;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('■ 처음 — 변경 없음');
  ME = '김리더';
  let html = await getHtml();
  ok(html.length > 500, '콘티 화면이 그려짐', html.length);
  ok(!/cn-chg"/.test(html), '처음엔 알림 카드 없음');
  ok(rowsOf('콘티확인').some((r) => r['이름'] === '김리더' && r['대상'] === sun), '처음 열면 확인 시각이 저장됨');
  await sleep(15);

  console.log('■ 다른 사람(이영희)이 콘티를 바꿈');
  ME = '이영희';
  await post('/conti/songs', { 구분: '콘티', 제목: '주 은혜임을', Key: 'G' });
  await post('/conti/songs', { 구분: '콘티', 제목: '나는 믿네', Key: 'D' });
  const songs = rowsOf('찬양콘티');
  ok(songs.length >= 2, '곡 2개 추가됨', songs.map((r) => r['제목']));
  const s1 = songs.find((r) => r['제목'] === '주 은혜임을');
  await post('/conti/songs/edit', { __row: String(songs.indexOf(s1) + 2), ID: s1['ID'], 구분: '콘티', 순서: s1['순서'], 제목: '주 은혜임을', Key: 'A', 팀: '', BPM: '72' });
  await post('/conti/songs/reorder', { ids: songs.filter((r) => r['구분'] === '콘티').map((r) => r['ID']).reverse().join(',') });
  const log = rowsOf('콘티변경기록');
  ok(log.filter((r) => r['종류'] === '추가').length === 2, '추가 2건 기록', log.map((r) => r['종류']));
  ok(log.some((r) => r['종류'] === '수정' && r['항목'] === 'Key' && r['이전'] === 'G' && r['이후'] === 'A'), 'Key G → A 수정 기록');
  ok(log.some((r) => r['종류'] === '수정' && r['항목'] === 'BPM' && r['이후'] === '72'), 'BPM 수정 기록');
  ok(log.some((r) => r['종류'] === '순서'), '순서 변경 기록');
  ok(log.every((r) => r['변경자'] === '이영희' && r['대상'] === sun), '변경자 · 대상 기록');
  await post('/conti/songs/edit', { __row: String(songs.indexOf(s1) + 2), ID: s1['ID'], 구분: '콘티', 순서: s1['순서'], 제목: '주 은혜임을', Key: 'A', 팀: '', BPM: '72' });
  ok(rowsOf('콘티변경기록').length === log.length, '바뀐 게 없으면 기록 안 함');

  console.log('■ 내가(김리더) 열기 전 — 메뉴 숫자 · 알림 · 곡 표시');
  ME = '김리더';
  const n1 = await badge();
  ok(n1 >= 4, '메뉴 숫자가 못 본 변경 수를 셈', n1);
  ok((await badge()) === n1, '숫자만 세고 확인 처리는 안 함');
  html = await getHtml();
  ok(/cn-chg"/.test(html) && /콘티에 바뀐 게 있어요/.test(html), '맨 위 알림 카드');
  ok(/Key/.test(html) && /<s class="cn-out">G<\/s>/.test(html), '"Key G → A" 내용이 보임');
  ok((html.match(/cn-newchip/g) || []).length >= 2, '곡 카드에 "새 곡 / 수정" 표시');
  ok(/이영희/.test(html), '바꾼 사람 이름');
  ok((await badge()) === 0, '열고 나면 메뉴 숫자 0');
  html = await getHtml();
  ok(!/cn-chg"/.test(html) && !/cn-newchip/.test(html), '다시 열면 알림 · 표시가 사라짐');
  await sleep(15);

  console.log('■ 내가 바꾼 것은 알리지 않음 · 삭제 · 다른 주는 따로');
  await post('/conti/songs', { 구분: '콘티', 제목: '내가 넣은 곡', Key: 'E' });
  ok((await badge()) === 0, '내 변경은 숫자에 안 잡힘');
  ME = '이영희';
  const mine = rowsOf('찬양콘티').find((r) => r['제목'] === '내가 넣은 곡');
  await post('/conti/songs/delete', { __row: String(rowsOf('찬양콘티').indexOf(mine) + 2) });
  ok(rowsOf('콘티변경기록').some((r) => r['종류'] === '삭제' && r['곡'] === '내가 넣은 곡'), '삭제 기록');
  ME = '김리더';
  ok((await badge()) === 1, '다른 사람이 지운 건 숫자 1');
  html = await getHtml();
  ok(/빠졌어요/.test(html), '"빠졌어요" 알림');
  const other = week.shiftWeek(sun, 1);
  const r2 = await fetch(BASE + '/conti?team=' + TEAM + '&date=' + other + '&partial=1', { headers: { 'X-PH-Partial': '1' } });
  ok(!/cn-chg"/.test(((await r2.json()) || {}).html || ''), '다른 주 콘티에는 이 알림이 안 보임');

  server.close();
  console.log('\n' + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
