/**
 * 방송팀(PPT) 보기 전용 링크 — 로그인 없이 "예배 콘티 · 스케줄표" 두 화면만 봅니다.
 *   GET  /b/<열쇠>            → 예배 콘티로
 *   GET  /b/<열쇠>/conti      그 주(또는 행사) 콘티 — 곡 · 송폼 · 설명 · 유튜브 · 악보 링크 · 댓글 (고칠 수 없음)
 *   GET  /b/<열쇠>/schedule   스케줄표 — 주별 포지션 편성 · 연습일 (고칠 수 없음)
 *   POST /b/<열쇠>/comments   댓글만 남길 수 있음 (이름 + 내용, 짧은 시간에 너무 많이 올리면 잠깐 막음)
 * 열쇠는 lib/guestLink.js (설정 시트). 이 파일의 화면은 로그인 정보를 읽지 않고, 위 세 가지 외에는 아무것도 열지 않습니다.
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const week = require('../lib/weekUtil');
const ui = require('../lib/uiIcons');
const guestLink = require('../lib/guestLink');
const honorific = require('../lib/honorific');
const hubApi = require('../lib/hubApi');
const prac = require('../lib/practice');
const { ALL_POSITIONS, canonicalPosition } = require('../lib/positions');
const { positionIconSvg } = require('../lib/positionIcons');
const conti = require('./conti');
const live = require('./live');

const router = express.Router();
const esc = pageShell.esc;
const S = () => conti.shared;

const DOW = ['주일', '월', '화', '수', '목', '금', '토'];
const md = (d) => { const x = new Date(d + 'T12:00:00'); return `${x.getMonth() + 1}/${x.getDate()}`; };
const mdDow = (d) => `${md(d)}(${DOW[new Date(d + 'T12:00:00').getDay()]})`;

/** 열쇠 확인 — 맞지 않으면 안내 화면 */
async function gate(req, res, next) {
  const team = await guestLink.teamOf(req.params.token).catch(() => null);
  if (!team) {
    res.status(404).set('Cache-Control', 'no-store').type('html').send(await pageShell.render(
      `${pageShell.hero({ eyebrow: 'YN찬양팀Hub', title: '링크를 열 수 없어요', sub: '주소가 바뀌었거나 올바르지 않아요.' })}
       <div class="ph-card"><p class="ph-sub">찬양팀 담당자에게 새 링크를 받아주세요.</p></div>`, { title: '링크를 열 수 없어요', head: '<meta name="robots" content="noindex">' }));
    return;
  }
  req.guest = { team, token: req.params.token, base: `/b/${req.params.token}` };
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  next();
}

function nav(g, active) {
  const tabs = [['conti', `${g.base}/conti`, '예배 콘티'], ['live', `${g.base}/live`, '라이브 악보'], ['schedule', `${g.base}/schedule`, '스케줄표']];
  return `<nav class="ph-hubnav" id="ph-hubnav" aria-label="메뉴"><div class="ph-hubnav-in">${tabs.map(([k, href, label]) =>
    `<a class="ph-hubtab${active === k ? ' on' : ''}" href="${href}"${active === k ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div></nav>`;
}
async function send(req, res, active, hero, body, title) {
  const g = req.guest;
  const content = `${pageShell.hero(hero)}${nav(g, active)}<div class="gs">${body}</div>`;
  res.type('html').send(await pageShell.render(content, { title, head: '<meta name="robots" content="noindex">' }));
}

router.get('/b/:token', gate, (req, res) => res.redirect(req.guest.base + '/conti'));

/* ---------------------------------------------------------------- 라이브 악보 (읽기 전용)
   로그인 없이 그 예배의 라이브 악보 화면을 봅니다 — 악보 · 송폼 · 팀 필기 · 메트로놈 · 인도자가 넘기는 쪽을 따라가기만 하고,
   필기 · 설정 · 곡 정보 · 타이머 · 클릭 컨트롤은 서버가 막습니다 (lib/liveAuth.js mintView · lib/realtime.js). */
router.get('/b/:token/live', gate, async (req, res) => {
  const { team, base, token } = req.guest;
  const sh = S();
  const eventRow = await sh.specialServiceById(team, String(req.query.event || '').trim());
  const date = eventRow ? eventRow['날짜'] : week.normalizeDate(req.query.date);
  const back = `${base}/conti?${eventRow ? 'event=' + encodeURIComponent(eventRow['ID']) : 'date=' + encodeURIComponent(date)}`;
  live.grantView(res, token);                                     // 악보 · 녹음 파일을 이 브라우저에 열어 줌 (링크를 바꾸면 바로 막힘)
  return live.renderLive(req, res, { team, ev: eventRow, date, back, ro: true });
});

/* ---------------------------------------------------------------- 예배 콘티 */
function lineupReadonly(rows, scope, team) {
  const by = {};
  rows.filter((r) => (scope.event ? r['행사ID'] === scope.event : (!r['행사ID'] && r['날짜'] === scope.date))).forEach((r) => {
    const p = canonicalPosition(String(r['포지션'] || '').trim()), n = String(r['이름'] || '').trim();
    if (p && n) (by[p] = by[p] || []).push(honorific.forTeam(team, n));
  });
  const keys = ALL_POSITIONS.filter((k) => by[k] && by[k].length);
  if (!keys.length) return '';
  return `<div class="ph-card"><h2 class="ph-h2">이번 주 편성</h2><div class="gs-line">${keys.map((k) =>
    `<span class="gs-pos"><span class="gs-pi">${positionIconSvg(k)}</span><i>${esc(k)}</i><b>${esc(by[k].join(', '))}</b></span>`).join('')}</div></div>`;
}

router.get('/b/:token/conti', gate, async (req, res) => {
  const { team, base } = req.guest;
  const sh = S();
  const eventRow = await sh.specialServiceById(team, String(req.query.event || '').trim());
  const date = eventRow ? eventRow['날짜'] : week.normalizeDate(req.query.date);
  const scope = { event: eventRow ? eventRow['ID'] : '', date };
  const [w, assign, evs, pinfo] = await Promise.all([sh.loadWeek(team, scope), sheetsDb.readAll('찬양편성'), sh.specialServices(team), sh.practiceInfo(team, scope, date)]);
  // 달력 띠 — 로그인 화면(routes/conti.js)과 똑같은 모양 (±3주 + 주일 외 찬양 칸 + 날짜 직접 고르기)
  const stripEvents = evs.map((e) => ({ id: e['ID'], name: String(e['이름'] || '주일 외 찬양'), date: e['날짜'] }));
  const strip = pageShell.weekStrip({ basePath: `${base}/conti`, team, date, assignRows: assign.filter((r) => r['팀ID'] === team), events: stripEvents, activeEvent: scope.event ? scope.event : '' });
  const dayBanner = scope.event
    ? `<div class="ph-card ph-eventsbanner"><p class="ph-sub">${esc(eventRow['이름'])} 콘티예요 — 주일예배와는 별도 기록입니다. <a href="${base}/conti?date=${encodeURIComponent(date)}">이 날짜의 주일예배 콘티 보기 →</a></p></div>`
    : '';
  const upcoming = evs.filter((e) => e['날짜'] >= week.todayStr()).slice(0, 6);
  const evBox = upcoming.length ? `<div class="gs-evs">${upcoming.map((e) => `<a class="gs-ev${scope.event === e['ID'] ? ' on' : ''}" href="${base}/conti?event=${encodeURIComponent(e['ID'])}">${esc(e['이름'])} <small>${esc(md(e['날짜']))}</small></a>`).join('')}</div>` : '';
  const p = pinfo.p;
  const practice = `<div class="ph-card ph-practicecard"><div class="ph-pr-row"><span class="ph-pr-ic">${ui.icon('metronome')}</span>
      <div class="ph-pr-main"><span class="ph-pr-label">연습일</span>${p.none ? '<span class="ph-pr-none">이 예배는 연습이 없어요</span>' : (p.unset || !p.date ? '<span class="ph-pr-none">아직 정해지지 않았어요</span>' : `<b>${esc(mdDow(p.date))}</b>${p.note ? `<span class="ph-pr-note">${esc(p.note)}</span>` : ''}`)}</div></div></div>`;
  const tagSet = ALL_POSITIONS;
  const card = (s, i, kind) => sh.songCard(s, { editable: false, sheets: w.sheets, tagSet, index: i, kind, bigForm: true });
  const comments = `<div class="ph-card" id="comments">
    <h2 class="ph-h2">댓글</h2>
    <div class="ph-list">${w.comments.length ? w.comments.map(sh.commentItem).join('') : '<p class="ph-sub">아직 댓글이 없어요.</p>'}</div>
    <form method="post" action="${base}/comments" class="ph-inlineform gs-cform">
      <input type="hidden" name="date" value="${esc(date)}">${scope.event ? `<input type="hidden" name="event" value="${esc(scope.event)}">` : ''}
      <input type="text" name="name" placeholder="이름" maxlength="20" required autocomplete="name" data-gs-name>
      <input type="text" name="content" placeholder="댓글을 남겨보세요 (예: 3번 곡 가사 확인 부탁해요)" maxlength="500" required>
      <input type="text" name="website" value="" tabindex="-1" autocomplete="off" aria-hidden="true" class="gs-hp">
      <button class="ph-btn" type="submit">등록</button>
    </form>
    ${req.query.c === 'ok' ? '<p class="ph-msg ok" role="status">댓글을 남겼어요.</p>' : ''}${req.query.c === 'wait' ? '<p class="ph-msg bad" role="status">잠시 후 다시 남겨주세요.</p>' : ''}${req.query.c === 'bad' ? '<p class="ph-msg bad" role="status">이름과 내용을 적어주세요.</p>' : ''}
  </div>`;
  const pkgHref = `${base}/conti/package.pdf?${scope.event ? 'event=' + encodeURIComponent(scope.event) : 'date=' + encodeURIComponent(date)}`;
  const pkgBtn = w.conti.length || w.final.length || w.closing.length
    ? `<button type="button" class="cn-mini cn-pkgbtn" data-pkg-open data-base="${base}/conti" data-readonly="1" data-href="${esc(pkgHref)}" data-title="${esc(scope.event ? eventRow['이름'] : week.shortKo(date, true))} 인쇄용 PDF" title="표지 + 곡별 머리말 + 악보 · US Letter 흑백 인쇄용 PDF — 미리보고 다운로드">${ui.icon('download')} 인쇄용 PDF 패키지</button>`
    : '';
  const body = `
    ${strip}
    ${dayBanner}
    ${evBox ? `<div class="ph-card">${evBox}</div>` : ''}
    ${practice}
    <a class="gs-livebtn" href="${base}/live?${scope.event ? 'event=' + encodeURIComponent(scope.event) : 'date=' + encodeURIComponent(date)}">${ui.icon('page')}<span><b>라이브 악보 열기</b><small>악보 · 송폼 · 메트로놈을 실시간으로 봅니다 (보기 전용)</small></span></a>
    <div class="cn-toolrow">${pkgBtn}</div>
    ${lineupReadonly(assign.filter((r) => r['팀ID'] === team), scope, team)}
    <div class="ph-card top-accent"><h2 class="ph-h2">콘티</h2>
      <div class="cn-songs">${w.conti.length ? w.conti.map((s, i) => card(s, i + 1, '콘티')).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div></div>
    <div class="ph-card"><h2 class="ph-h2">설교 후 찬양</h2>
      <div class="cn-songs">${w.final.length ? w.final.map((s) => card(s, 1, '결단')).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div></div>
    <div class="ph-card"><h2 class="ph-h2">폐회송</h2>
      <div class="cn-songs">${w.closing.length ? w.closing.map((s) => card(s, 1, '폐회송')).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div></div>
    ${w.sheets.some((f) => !f['곡ID']) ? sh.packageSheetsCard(team, scope, w.sheets, false) : ''}
    ${comments}
    <script>(function(){try{var i=document.querySelector('[data-gs-name]');if(!i)return;i.value=localStorage.getItem('gs.name')||'';i.form.addEventListener('submit',function(){try{localStorage.setItem('gs.name',i.value.trim())}catch(e){}});}catch(e){}})();</script>`;
  await send(req, res, 'conti', { eyebrow: `${team} · 방송팀`, title: scope.event ? eventRow['이름'] : '예배 콘티', sub: week.labelKo(date) }, body, `${team} 예배 콘티`);
});

/* 댓글 — 이름 + 내용만. IP 별로 10분에 8개까지, 열쇠 전체로 한 시간에 80개까지 */
const HITS = new Map();
function limited(key, max, ms) {
  const now = Date.now(), list = (HITS.get(key) || []).filter((t) => now - t < ms);
  if (list.length >= max) { HITS.set(key, list); return true; }
  list.push(now); HITS.set(key, list);
  if (HITS.size > 5000) { HITS.forEach((v, k) => { if (!v.length || now - v[v.length - 1] > 3600e3) HITS.delete(k); }); }
  return false;
}
router.post('/b/:token/comments', gate, async (req, res) => {
  const { team, base, token } = req.guest;
  const b = req.body || {};
  const sh = S();
  const eventRow = await sh.specialServiceById(team, String(b.event || '').trim());
  const date = eventRow ? eventRow['날짜'] : week.normalizeDate(b.date);
  const back = (c) => res.redirect(`${base}/conti?${eventRow ? 'event=' + encodeURIComponent(eventRow['ID']) : 'date=' + encodeURIComponent(date)}&c=${c}#comments`);
  if (String(b.website || '').trim()) return back('ok');                                   // 로봇이 채운 칸 — 조용히 무시
  const name = String(b.name || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 20);
  const content = String(b.content || '').replace(/\r/g, '').trim().slice(0, 500);
  if (!name || !content) return back('bad');
  if (limited('ip|' + (req.ip || ''), 8, 10 * 60e3) || limited('tok|' + token, 80, 3600e3)) return back('wait');
  try {
    await sheetsDb.appendRow('콘티댓글', {
      'ID': 'M' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), '팀ID': team, ...sh.scopeFields({ event: eventRow ? eventRow['ID'] : '', date }),
      '이름': name + ' (방송팀)', '내용': content, '작성시각': new Date().toISOString(),
    });
  } catch (e) { console.error('[방송팀 댓글 저장 실패]', e.message); return back('wait'); }
  back('ok');
});

/* ---------------------------------------------------------------- 인쇄용 PDF 패키지 (보기 전용)
   로그인 화면(routes/conti.js)의 makePackage()를 그대로 쓰되, 확정하기 · 악보 영역 조정 같은 "고치는" 기능은 없음 —
   public/js/pkgpreview.js 가 data-readonly="1" 를 보고 그 버튼들을 숨깁니다. */
const guestPkgJobs = new Map();                   // 만드는 중인 PDF — 진행률용 (10분 뒤 정리), 로그인 화면과 별도 보관
function sendGuestPdf(res, r) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(r.pdf.length), 'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.name)}.pdf` });
  res.send(r.pdf);
}
router.get('/b/:token/conti/package/start', gate, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { team } = req.guest;
  for (const [k, j] of guestPkgJobs) if (Date.now() - j.at > 600000) guestPkgJobs.delete(k);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job = { at: Date.now(), team, pct: 0, label: '준비 중', done: false, err: false, result: null };
  guestPkgJobs.set(id, job);
  req.ctx = { current: team };
  S().makePackage(req, (p, label) => { if (p > job.pct) job.pct = Math.min(0.99, p); if (label) job.label = label; })
    .then((r) => { job.result = r; job.pct = 1; job.done = true; job.label = '완료'; })
    .catch((e) => { console.error('[방송팀 PDF 패키지 실패]', e && e.stack || e); job.err = true; job.done = true; });
  res.json({ id });
});
router.get('/b/:token/conti/package/status', gate, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const j = guestPkgJobs.get(String(req.query.id || ''));
  if (!j || j.team !== req.guest.team) return res.status(404).json({ gone: true });
  res.json({ pct: Math.round(j.pct * 100), label: j.label, done: j.done, err: j.err });
});
router.get('/b/:token/conti/package.pdf', gate, async (req, res) => {
  try {
    const j = guestPkgJobs.get(String(req.query.job || ''));
    if (!j || j.team !== req.guest.team || !j.result) return res.status(404).type('text').send('만든 PDF를 찾지 못했어요. 다시 만들어 주세요.');
    sendGuestPdf(res, j.result);
  } catch (e) {
    console.error('[방송팀 PDF 패키지 실패]', e && e.stack || e);
    if (!res.headersSent) res.status(500).type('text').send('PDF 패키지를 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
  }
});

/* ---------------------------------------------------------------- 스케줄표 */
const RANGE_LABEL = { next3: '앞으로 3개월', next6: '앞으로 6개월', past3: '지난 3개월' };
router.get('/b/:token/schedule', gate, async (req, res) => {
  const { team, base } = req.guest;
  const range = RANGE_LABEL[req.query.range] ? req.query.range : 'next3';
  await honorific.prime(team);
  const sched = await hubApi.FNS.worshipSchedule({ name: '', team, canEdit: false, admin: false }, range);
  const poss = hubApi.positions();
  const rows = sched.rows;
  const today = week.todayStr();
  const cards = rows.map((r) => {
    const slots = poss.filter((p) => r.slots[p.key] && r.slots[p.key].length);
    const pr = r.practice;
    const prTxt = pr && pr.none ? '연습 없음' : (pr && pr.date ? `연습 ${mdDow(pr.date)}` : '');
    return `<div class="ph-card gs-week${r.date < today ? ' past' : ''}"><div class="gs-head"><b>${esc(mdDow(r.date))}</b>${r.event ? `<span class="gs-evname">${esc(r.event.name)}</span>` : ''}${prTxt ? `<small>${esc(prTxt)}</small>` : ''}</div>
      ${slots.length ? `<div class="gs-line">${slots.map((p) => `<span class="gs-pos"><span class="gs-pi">${positionIconSvg(p.key)}</span><i>${esc(p.label)}</i><b>${esc(r.slots[p.key].map((n) => honorific.forTeam(team, n)).join(', '))}</b></span>`).join('')}</div>` : '<p class="ph-sub" style="margin:4px 0 0;">아직 편성이 없어요.</p>'}</div>`;
  }).join('');
  const tabs = Object.keys(RANGE_LABEL).map((k) => `<a class="gs-ev${k === range ? ' on' : ''}" href="${base}/schedule?range=${k}">${RANGE_LABEL[k]}</a>`).join('');
  await send(req, res, 'schedule', { eyebrow: `${team} · 방송팀`, title: '스케줄표', sub: '포지션 편성 · 연습일' },
    `<div class="ph-card"><div class="gs-evs">${tabs}</div></div>${cards || '<div class="ph-card"><p class="ph-sub">표시할 일정이 없어요.</p></div>'}`, `${team} 스케줄표`);
});

module.exports = router;
