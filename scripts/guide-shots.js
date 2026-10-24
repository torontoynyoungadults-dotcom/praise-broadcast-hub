/**
 * 사용설명서 그림 다시 만들기 — public/guide-img/*.jpg (밝은 화면 · 번호 표시)
 *   NODE_PATH=$(npm root -g) node scripts/guide-shots.js [그림이름 …]
 * 구글 시트 · 로그인 없이: 시트는 아래 견본 데이터(메모리), 로그인은 관리자 한 명으로 대신하고 실제 서버(server.js)를 띄워 찍습니다.
 * 그림마다: 주소 · 폭 · 찍을 부분(clip) · 번호 붙일 곳(marks) — 번호 순서가 routes/guide.js 의 설명 순서와 같아야 해요.
 */
process.env.SESSION_SECRET = 'guide-shots-secret-guide-shots-secret';
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT || '3997';
process.env.TZ = 'America/Toronto';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'guide-img');
const week = require(path.join(ROOT, 'lib/weekUtil'));

/* ---------------------------------------------------------------- 견본 데이터 */
const TEAM = '3부 찬양팀';
const sun = week.normalizeDate(null), sun2 = week.shiftWeek(sun, 1);
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const ME = 'hanyj123@gmail.com';
const ppl = [['한윤종', '인도자'], ['이영희', '여싱'], ['박철수', '건반'], ['최지민', '드럼'], ['정하늘', '베이스'], ['김다윗', '일렉'], ['윤정환', '목회자'], ['서은혜', '여싱'], ['강민수', '드럼'], ['오세훈', '남싱'], ['임소라', '건반'], ['조은비', '음향']];
const TABS = {
  '찬양팀': [{ ID: 't1', 팀명: TEAM, 활성여부: 'TRUE' }],
  '회원': ppl.map(([n, r], i) => ({ ID: 'm' + i, 이메일: i ? 'u' + i + '@example.com' : ME, 이름: n, 소속팀: TEAM, 역할: r, 관리자여부: i ? '' : 'TRUE', 성별: /여싱|음향/.test(r) ? '여' : '남' })),
  '팀원명단': ppl.map(([n, r], i) => ({ ID: 'r' + i, 팀ID: TEAM, 이름: n, 성별: /여싱|음향/.test(r) ? '여' : '남', 역할: r, 등록시각: '' })).concat([{ ID: 'rx', 팀ID: TEAM, 이름: '문지호', 성별: '남', 역할: '일렉', 등록시각: '' }]),
  '설정': [],
};
const SONGS = [
  ['주님의 은혜', 'G', 'Intro:4-V1-C-V2-C-B-C-C(Voice)-End', '72', 'dQw4w9WgXcQ', '어노인팅', '두 번째 후렴은 드럼 빼고 · 마지막 후렴 반복'],
  ['Way Maker', 'E', 'Intro-V1-V2-C-C-B×2-C', '68', 'abcdefghijk', 'Sinach', ''],
  ['Holy Forever', 'A', 'V1-C-V2-C-B-C', '72', 'zyxwvutsrqp', 'Bethel', ''],
  ['예수 우리 왕이여', 'D', 'V-C-C', '100', '', '', ''],
];
TABS['찬양콘티'] = [];
[sun, sun2].forEach((d, w) => SONGS.forEach((s, i) => TABS['찬양콘티'].push({ ID: 'c' + w + i, 팀ID: TEAM, 날짜: d, 구분: '콘티', 순서: String(i + 1), 제목: s[0], Key: s[1], 유튜브: s[4] ? 'https://youtu.be/' + s[4] : '', 송폼: s[2], BPM: s[3], 비고: s[6], 팀: s[5], 솔로: '', 행사ID: '' })));
TABS['찬양콘티'].push({ ID: 'f1', 팀ID: TEAM, 날짜: sun, 구분: '결단', 순서: '1', 제목: '나를 받으옵소서', Key: 'C', 유튜브: '', 송폼: 'V-C', BPM: '70', 비고: '', 팀: '', 솔로: '', 행사ID: '' });
TABS['악보저장소'] = [];
['c00', 'c01', 'c02', 'c10', 'c11'].forEach((id, i) => TABS['악보저장소'].push({ ID: 's' + i, 팀ID: TEAM, 날짜: i < 3 ? sun : sun2, 제목: SONGS[i % 3][0], 파일링크: 'https://example.com/sheet' + i + '.pdf', 올린사람: '한윤종', 올린시각: '', 곡ID: id, 행사ID: '' }));
TABS['악보저장소'].push({ ID: 's9', 팀ID: TEAM, 날짜: sun, 제목: '주님의 은혜 (2)', 파일링크: 'https://example.com/sheet9.pdf', 올린사람: '한윤종', 올린시각: '1', 곡ID: 'c00', 행사ID: '' });
TABS['찬양편성'] = [];
let k = 0;
const lineups = [
  [sun, ['인도자', '한윤종'], ['남성싱어', '오세훈'], ['여성싱어', '이영희'], ['알토', '서은혜'], ['드럼', '최지민'], ['베이스', '정하늘'], ['일렉', '김다윗'], ['피아노', '박철수'], ['신디', '임소라'], ['음향', '조은비']],
  [sun2, ['인도자', '윤정환'], ['남성싱어', '한윤종'], ['여성싱어', '서은혜'], ['드럼', '강민수'], ['베이스', '정하늘'], ['피아노', '박철수'], ['음향', '조은비']],
  [week.shiftWeek(sun, 2), ['인도자', '한윤종'], ['드럼', '최지민'], ['피아노', '임소라'], ['일렉', '김다윗']],
  [week.shiftWeek(sun, 3), ['인도자', '윤정환'], ['신디', '한윤종'], ['드럼', '강민수']],
  [week.shiftWeek(sun, 4), ['인도자', '한윤종'], ['베이스', '정하늘']],
];
lineups.forEach(([d, ...a]) => a.forEach(([p, n]) => TABS['찬양편성'].push({ ID: 'a' + (k++), 팀ID: TEAM, 날짜: d, 포지션: p, 이름: n, 행사ID: '' })));
TABS['연습일정'] = [{ ID: 'p1', 팀ID: TEAM, 날짜: addDays(sun, -2), 비고: '', 등록시각: '', 대상: sun }, { ID: 'p2', 팀ID: TEAM, 날짜: addDays(sun, -2), 비고: '', 등록시각: '', 대상: sun2 }];
TABS['불가일정'] = [{ ID: 'u1', 팀ID: TEAM, 이름: '김다윗', 날짜: sun2, 사유: '출장', 등록시각: '', 구분: '' }];
TABS['녹음'] = [{ ID: 'rec1', 팀ID: TEAM, 날짜: sun, 구분: '연습', 제목: `${Number(addDays(sun, -2).slice(5, 7))}/${Number(addDays(sun, -2).slice(8))} 금요일 연습`, 링크: 'https://youtu.be/dQw4w9WgXcQ', 올린사람: '박철수', 올린시각: '1', 행사ID: '', 구간: '' }];
TABS['특별예배'] = [{ ID: 'ev1', 팀ID: TEAM, 날짜: addDays(sun, 40), 이름: '성탄 감사예배', 등록시각: '', 예배시간: '19:30', 리허설시간: '18:00' }, { ID: 'ev2', 팀ID: TEAM, 날짜: addDays(sun, 47), 이름: '송구영신예배', 등록시각: '', 예배시간: '23:00', 리허설시간: '21:30' }];
TABS['스케줄변경기록'] = [{ ID: 'l1', 팀ID: TEAM, 시각: new Date().toISOString(), 변경자: '이영희', 대상: sun2, 날짜: sun2, 행사: '', 종류: '편성', 포지션: '피아노', 사람: '', 이전: '임소라', 이후: '박철수' }];

const rowsOf = (t) => (TABS[t] = TABS[t] || []);
const withRow = (t) => rowsOf(t).map((r, i) => Object.assign({ __row: i + 2 }, r));
const mock = {
  readAll: async (t) => withRow(t), findWhere: async (t, p) => withRow(t).find(p) || null,
  findOne: async (t, c, v) => withRow(t).find((r) => String(r[c]) === String(v)) || null,
  appendRow: async (t, o) => { rowsOf(t).push(Object.assign({}, o)); return {}; },
  appendRows: async (t, os) => { os.forEach((o) => rowsOf(t).push(Object.assign({}, o))); return os.length; },
  updateRow: async (t, row, o) => { const a = rowsOf(t); a[row - 2] = Object.assign({}, o); delete a[row - 2].__row; return {}; },
  updateCells: async () => ({}), deleteRow: async (t, row) => { rowsOf(t).splice(row - 2, 1); return {}; },
  deleteRows: async (t, rows) => { rows.slice().sort((a, b) => b - a).forEach((r) => rowsOf(t).splice(r - 2, 1)); return {}; },
  invalidate: () => {}, folderId: () => 'F', getSetting: async (key, f) => f, spreadsheetId: async () => 'S', ensureTabs: async () => {},
};
const put = (rel, exports) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
put('lib/sheetsDb', mock);
put('lib/googleAuth', new Proxy({}, { get: () => () => ({}) }));
const realSession = require(path.join(ROOT, 'lib/session'));
put('lib/session', Object.assign({}, realSession, { middleware: (req, res, next) => { req.session = req.headers['x-anon'] ? null : { email: ME }; next(); } }));

/* 악보 · 견본 PDF (오선만 그린 2쪽) */
function samplePdf() {
  const { PDFDocument, rgb } = require('pdf-lib');
  return (async () => {
    const doc = await PDFDocument.create();
    for (let p = 0; p < 2; p++) {
      const pg = doc.addPage([612, 792]);
      for (let y = 660; y > 100; y -= 76) for (let l = 0; l < 5; l++) pg.drawLine({ start: { x: 54, y: y - l * 8 }, end: { x: 558, y: y - l * 8 }, thickness: 0.8, color: rgb(0.15, 0.15, 0.15) });
      for (let y = 660; y > 100; y -= 76) for (let x = 90; x < 540; x += 34) pg.drawEllipse({ x: x + (p * 7) % 20, y: y - 8 - ((x / 34 + y / 76) % 5) * 4, xScale: 4.5, yScale: 3.4, color: rgb(0.1, 0.1, 0.1) });
    }
    return Buffer.from(await doc.save());
  })();
}
let PDF = null;
const realFetch = global.fetch;
global.fetch = async (u, o) => { if (/example\.com/.test(String(u))) return new Response(PDF, { headers: { 'content-type': 'application/pdf' } }); return realFetch(u, o); };

/* ---------------------------------------------------------------- 그림 목록 */
const W = 1000;
const SHOTS = {
  login: { url: '/', anon: true, clip: ['.ph-hero', '.ph-card'], marks: ['a[href="/auth/google"]'] },
  menu: { url: '/conti', clip: ['.ph-hero', '#ph-hubnav'], marks: ['.ph-who-me', '.ph-who-guide', '#ph-hubnav', '.ph-themesw', '[data-ph-act="refresh"]'] },
  profile: { url: '/profile', clip: ['.ph-card'] },
  conti_top: { url: '/conti', clip: ['.ph-wstrip', '.cn-toolcard'], marks: ['.ph-practicecard', '.ph-livebtn', '.ph-stagebtn', '.cn-pkgbtn', '.cn-kakaobtn', '.cn-offbtn', '[data-cn-yplay-open]', '.cn-yplay-bar a.cn-ybig'] },
  lineup: { url: '/conti', clip: ['.lu-card'] },
  song: { url: '/conti', before: async (p) => { await p.click('#song-c00 [data-cn-svopen]'); await p.waitForTimeout(1500); },
    clip: ['#song-c00'], maxH: 820,
    marks: ['#song-c00 .cn-shead .cn-tb', '#song-c00 .cn-info', '#song-c00 .cn-daw', '#song-c00 [data-cn-svopen]', '#song-c00 .cn-sv .ph-annolink[href]', '#song-c00 .cn-sv [data-sheet-reformat]', '#song-c00 .cn-edit > summary'] },
  addsong: { url: '/conti', clip: ['[data-cn-import]', '[data-cn-import] + details + details'], pad: 12,
    marks: ['[data-cn-import] > summary', '[data-cn-import] + details > summary', '[data-cn-import] + details + details > summary'] },
  practice: { url: '/practice-conti', clip: ['.pc-strip', '.pc-target'], maxH: 1000,
    marks: ['.pc-strip .ph-wstrip-cell.on', '.pc-head', '.pc-target .pc-thead', '.pc-target .cn-toolcard', '.pc-target .pc-people'] },
  practice_rec: { url: '/practice-conti', clip: ['.pc-target .pc-recs'], pad: 12 },
  schedule: { url: '/schedule', wait: '.st', clip: ['.st-toolrow', '.stpanel'], maxH: 1050,
    marks: ['[data-mysched]', '.st-toolrow a[href^="/schedule/history"]', '.offcard', '.stseg', 'th.xc.pc', 'th.dc'] },
  mysched: { url: '/schedule', wait: '.st', w: 640, before: async (p) => { await p.click('[data-mysched]'); await p.waitForSelector('.msd-it'); await p.waitForTimeout(300); },
    clip: ['.msd'], marks: ['.msd-it', '.msd-all', '[data-msd-google]', '[data-msd-ics]'] },
  events: { url: '/events', clip: ['.ph-card'], maxH: 520 },
  library: { url: '/library', wait: '#body .panel', clip: ['.yn-main'], maxH: 800 },
  roster: { url: '/roster', clip: ['.ph-admintabs', '.ph-rrlist'], maxH: 900, marks: ['.ph-admintabs', 'details.ph-add > summary', '.ph-rrlist'] },
  live_1: { url: '/conti/practice', w: 1180, h: 820, full: true, wait: '.pv-b', settle: 2500,
    marks: ['.pv-songsel', '.pv-b[data-a="next"]', '.pv-follow', '.pv-msgbtn', '.pv-metbtn', '.pv-kslbl', '.pv-ytbtn', '.pv-panelbtn'] },
  live_2: { url: '/conti/practice', w: 1180, h: 820, full: true, wait: '.pv-b', settle: 2500,
    before: async (p) => { const b = await p.$('.pv-toolsbtn'); if (b) await b.click(); else await p.click('text=도구 열기'); await p.waitForTimeout(600); },
    marks: ['.pv-tool[title^="이동"]', '.pv-tool[title^="펜"]', '.pv-tool[title^="형광펜"]', '.pv-tool[title^="글자"]', '.pv-tool[title^="기호"]', '.pv-tool[title^="지우개"]', '.pv-tool[data-a="undo"]', '.pv-pill.scope'] },
  admin: { url: '/admin', before: async (p) => { await p.click('.rm-now summary'); await p.waitForTimeout(200); }, clip: ['#practice-mail'],
    marks: ['#practice-mail .ph-list-item form[action$="toggle"]', '#practice-mail a[href*="preview"]', '#practice-mail .rm-now > summary'] },
};

/* ---------------------------------------------------------------- 찍기 */
async function shoot(br, base, name, o) {
  const ctx = await br.newContext({ viewport: { width: o.w || W, height: o.h || 900 }, deviceScaleFactor: 1, locale: 'ko-KR', extraHTTPHeaders: o.anon ? { 'x-anon': '1' } : {} });
  await ctx.addInitScript(() => { try { localStorage.setItem('ph.theme', 'light'); localStorage.setItem('ph.themeMode', 'manual'); localStorage.setItem('ph.themeUntil', String(Date.now() + 864e5)); localStorage.setItem('ph.a2hs.never', '1'); localStorage.setItem('ph.st.onlyMine', '0'); localStorage.setItem('ynTheme', 'light'); } catch (e) {} });
  const p = await ctx.newPage();
  const url = base + o.url + (o.url.includes('?') ? '&' : '?') + 'team=' + encodeURIComponent(TEAM);
  await p.goto(url, { waitUntil: 'networkidle' });
  if (o.wait) await p.waitForSelector(o.wait, { timeout: 15000 });
  await p.addStyleTag({ content: '.ph-a2hs, #phBuild, .ph-ver, [class*="build-tag"], .ph-nt-toast { display: none !important; } *, *::before, *::after { transition: none !important; animation: none !important; }' });
  if (o.settle) await p.waitForTimeout(o.settle);
  if (o.before) await o.before(p);
  await p.waitForTimeout(400);
  if (process.env.PROBE) console.log(await p.evaluate((q) => Array.from(document.querySelectorAll(q)).filter((e) => e.getBoundingClientRect().width).map((e) => (e.className + ' | ' + (e.getAttribute('data-a') || '') + ' | ' + (e.getAttribute('title') || e.textContent || '').trim().slice(0, 30))).join('\n'), process.env.PROBE));
  // 번호 표시 — 주황 테두리 + 번호 동그라미 (페이지 위에 덧그림)
  const marks = await p.evaluate((sels) => {
    const out = [];
    sels.forEach((sel, i) => {
      const el = Array.from(document.querySelectorAll(sel)).find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!el) { out.push(sel); return; }
      const r = el.getBoundingClientRect(), sx = window.scrollX, sy = window.scrollY;
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${r.left + sx - 4}px;top:${r.top + sy - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid #F76707;border-radius:12px;z-index:2147483000;pointer-events:none;box-sizing:border-box;`;
      const n = document.createElement('div');
      n.textContent = String(i + 1);
      n.style.cssText = `position:absolute;left:${r.left + sx - 16}px;top:${r.top + sy - 16}px;width:28px;height:28px;border-radius:50%;background:#F76707;color:#fff;font:800 15px/28px -apple-system,sans-serif;text-align:center;z-index:2147483001;box-shadow:0 0 0 2px #fff;pointer-events:none;`;
      document.body.appendChild(box); document.body.appendChild(n);
    });
    return out;
  }, o.marks || []);
  if (marks.length) console.log(`  ! ${name}: 못 찾은 곳 ${marks.join(' | ')}`);
  const clip = o.full ? { x: 0, y: 0, width: o.w || W, height: o.h || 900 } : await p.evaluate(({ sels, pad }) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    sels.forEach((sel) => {
      const el = Array.from(document.querySelectorAll(sel)).find((x) => x.getBoundingClientRect().height > 0);
      if (!el) return;
      const r = el.getBoundingClientRect();
      x1 = Math.min(x1, r.left + scrollX); y1 = Math.min(y1, r.top + scrollY); x2 = Math.max(x2, r.right + scrollX); y2 = Math.max(y2, r.bottom + scrollY);
    });
    if (!isFinite(x1)) return null;
    return { x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad), width: Math.min(document.documentElement.scrollWidth, x2 + pad) - Math.max(0, x1 - pad), height: y2 - y1 + 2 * pad };
  }, { sels: o.clip || [], pad: o.pad == null ? 22 : o.pad });
  if (!clip) { console.log(`  ✗ ${name}: 찍을 곳을 못 찾음`); await ctx.close(); return; }
  if (o.maxH && clip.height > o.maxH) clip.height = o.maxH;
  const png = await p.screenshot({ clip, fullPage: !o.full, type: 'jpeg', quality: 86 });
  fs.writeFileSync(path.join(OUT, name + '.jpg'), png);
  console.log(`  ✓ ${name}.jpg ${Math.round(clip.width)}×${Math.round(clip.height)}`);
  await ctx.close();
}

(async () => {
  PDF = await samplePdf();
  require(path.join(ROOT, 'server.js'));
  await new Promise((r) => setTimeout(r, 1500));
  const { chromium } = require('playwright');
  const br = await chromium.launch();
  const base = 'http://127.0.0.1:' + process.env.PORT;
  const want = process.argv.slice(2);
  for (const [name, o] of Object.entries(SHOTS)) if (!want.length || want.includes(name)) await shoot(br, base, name, o);
  await br.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
