/**
 * 객원 공유 링크 (/g/<열쇠>) — 로그인 없이 그날 콘티만 (서버 시험 · 브라우저 없이)
 *   node scripts/test-guest-day-link.js
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.repeat(4);
process.env.NODE_ENV = 'test';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const TEAM = 'Kairos';
const TABS = { '회원': [], '찬양팀': [{ '팀명': TEAM, '활성여부': 'TRUE' }], '설정': [], '찬양콘티': [], '악보저장소': [], '녹음': [], '콘티댓글': [], '찬양편성': [], '연습일정': [], '특별예배': [] };
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

(async () => {
  const express = require('express');
  const week = require(path.join(ROOT, 'lib/weekUtil'));
  const dayLink = require(path.join(ROOT, 'lib/guestDayLink'));
  const guestAccess = require(path.join(ROOT, 'lib/guestAccess'));
  const liveAuth = require(path.join(ROOT, 'lib/liveAuth'));
  const session = require(path.join(ROOT, 'lib/session'));
  const app = express();
  app.use(express.urlencoded({ extended: true })); app.use(express.json());
  app.use(session.middleware);
  app.use(require(path.join(ROOT, 'routes/live')));
  app.use(require(path.join(ROOT, 'routes/guest')));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const sun = week.normalizeDate(null), next = week.normalizeDate(new Date(new Date(sun + 'T12:00:00').getTime() + 7 * 864e5).toISOString().slice(0, 10));
  const song = (date, title, id) => ({ 'ID': id, '팀ID': TEAM, '날짜': date, '행사ID': '', '구분': '콘티', '순서': '1', '제목': title, '송폼': 'V C' });
  rowsOf('찬양콘티').push(song(sun, '오늘의곡', 'S1'), song(next, '다음주곡', 'S2'));
  rowsOf('악보저장소').push({ 'ID': 'A1', '팀ID': TEAM, '날짜': sun, '행사ID': '', '제목': '오늘악보', '파일링크': 'https://drive.google.com/file/d/AAAAAAAAAAAAAAAAAAAA/view', '곡ID': 'S1' },
    { 'ID': 'A2', '팀ID': TEAM, '날짜': next, '행사ID': '', '제목': '다음악보', '파일링크': 'https://drive.google.com/file/d/BBBBBBBBBBBBBBBBBBBB/view', '곡ID': 'S2' });

  console.log('■ 열쇠 만들기');
  const t1 = await dayLink.ensure(TEAM, sun);
  ok(/^[A-Za-z0-9_-]{16,64}$/.test(t1), '열쇠가 만들어짐');
  ok((await dayLink.ensure(TEAM, sun)) === t1, '같은 날은 같은 열쇠 (두 번 만들지 않음)');
  ok((await dayLink.resolve(t1)).room === sun, '열쇠 → 그 날');
  ok((await dayLink.resolve('x'.repeat(24))) === null, '모르는 열쇠는 닫힘');

  console.log('■ /g/<열쇠>/conti — 그 날만');
  const get = (p, h) => fetch(BASE + p, { redirect: 'manual', headers: h || {} });
  let r = await get('/g/' + t1);
  ok(r.status === 302 && /\/g\/.+\/conti$/.test(r.headers.get('location')), '열쇠 주소 → 콘티로');
  r = await get('/g/' + t1 + '/conti'); let html = await r.text(); if (r.status !== 200) console.log(r.status, html.replace(/<[^>]+>/g, ' ').slice(0, 500));
  ok(r.status === 200 && html.indexOf('오늘의곡') >= 0, '그 날 곡이 보임');
  r = await get('/g/' + t1 + '/conti?date=' + next); html = await r.text();
  ok(html.indexOf('오늘의곡') >= 0 && html.indexOf('다음주곡') < 0, '주소에 다른 날짜를 넣어도 그 날 것만');
  ok(!/ph-weekstrip|class="gs-evs"/.test(html), '다른 날로 가는 달력 띠 · 행사 목록이 없음');
  ok(/라이브 악보/.test(html) && !/스케줄표<\/a>/.test(html), '메뉴는 콘티 · 라이브 악보만');
  ok((await get('/g/' + t1 + '/schedule')).status === 404 && (await get('/g/' + t1 + '/guide')).status === 404, '스케줄표 · 사용설명서는 닫힘');
  ok((await get('/g/' + 'x'.repeat(24) + '/conti')).status === 404, '틀린 열쇠는 404');
  ok((await get('/b/' + t1 + '/conti')).status === 404, '객원 열쇠로 방송팀 주소는 안 열림');

  console.log('■ 댓글');
  r = await fetch(BASE + '/g/' + t1 + '/comments', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: '홍객원', content: '안녕하세요', date: next }) });
  const cm = rowsOf('콘티댓글')[0];
  ok(cm && cm['이름'] === '홍객원 (객원)' && cm['날짜'] === sun, '댓글은 그 날로, 이름 뒤에 (객원)', cm);

  console.log('■ 라이브 악보 열쇠 (토큰)');
  const tok = liveAuth.mintDay(TEAM, sun, t1);
  const u = liveAuth.verify(tok);
  ok(u.guest && u.canEdit && u.gday && u.gday.room === sun, '객원 토큰 — 팀원처럼 쓰되 그 날만', u);
  await guestAccess.ensure(u);
  ok(guestAccess.roomOk(u, sun) === true, '그 날 방은 열림');
  ok(guestAccess.roomOk(u, next) === false, '다른 날 방은 닫힘');
  ok(guestAccess.roomOk(u, sun + '~개인') === true, '같은 날의 개인 방(~)은 열림');
  console.log('■ 링크를 새로 바꾸면 바로 막힘');
  const t2 = await dayLink.regenerate(TEAM, sun);
  let blocked = false; try { await guestAccess.ensure(u); } catch (e) { blocked = true; }
  ok(t2 !== t1 && blocked, '예전 열쇠 토큰은 /api 에서 막힘');
  ok((await get('/g/' + t1 + '/conti')).status === 404 && (await get('/g/' + t2 + '/conti')).status === 200, '예전 주소 404 · 새 주소 열림');

  console.log('■ 파일 — 그 날 것만');
  const ck = 'ph_gview=' + encodeURIComponent(session.signState({ k: 'gview', t: t2 }));
  const liveStore = require(path.join(ROOT, 'lib/liveStore'));
  const idOf = (row) => liveStore.sheetIdOf(row['팀ID'], row['파일링크']);
  r = await get('/sheet/' + idOf(rowsOf('악보저장소')[1]), { cookie: ck });
  ok(r.status === 404, '다른 날의 악보는 404');
  r = await get('/sheet/' + idOf(rowsOf('악보저장소')[0]), { cookie: ck });
  ok(r.status !== 404 && r.status !== 401, '그 날의 악보는 통과 (파일 읽기 단계로)', r.status);
  r = await get('/sheet/' + idOf(rowsOf('악보저장소')[0]));
  ok(r.status === 401 || r.status === 302, '쿠키 없이는 열리지 않음', r.status);

  console.log('■ 라이브 악보 화면 · /api');
  r = await get('/g/' + t2 + '/live'); html = await r.text();
  ok(r.status === 200 && /__RT_PRE__/.test(html) && /ph_gview=/.test(r.headers.get('set-cookie') || ''), '라이브 악보가 열리고 파일 열람 쿠키가 심김', r.status);
  const m = /"token":"([^"]+)"/.exec(html); const ut = m && liveAuth.verify(m[1]);
  ok(ut && ut.gday && ut.gday.room === sun && ut.guest, '화면에 실린 토큰 = 그 날 객원 토큰');
  ok(/"ro":false/.test(html) || !/"ro":true/.test(html), '읽기 전용이 아님 (필기 · 클릭 가능)');
  const api = (fn, args) => fetch(BASE + '/api/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) }).then((x) => x.json());
  let a = await api('worshipSongsOf', [m[1], next]);
  ok(a.ok === false && /서는 날|열 수/.test(a.error || ''), '다른 날 곡 정보는 막힘', a);
  a = await api('worshipRepoSave', [m[1], {}]);
  ok(a.ok === false && /쓸 수 없는/.test(a.error || ''), '라이브러리 같은 기능은 막힘', a);
  a = await api('worshipSongsOf', [m[1], sun]);
  ok(a.ok === true, '그 날 곡 정보는 열림', a);

  server.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
