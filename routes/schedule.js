/**
 * 스케줄표 — church-app(청년부 앱) 찬양 허브의 "스케줄표" 탭을 그대로 옮긴 화면 (public/hub/* · lib/hubApi.js).
 * 카드 · 테이블 보기, 기간(앞으로 3 · 6개월 · 앞뒤 3개월 · 지난 3 · 6 · 12개월), 사람 강조, 칸을 눌러 배정, 날짜를 눌러 자세히,
 * 내가 안 되는 날(여러 날짜 한 번에), 스케줄표 PDF. 이 앱만의 것: 연습일(기본 주일 전 금요일, 눌러서 바꾸기).
 * 아래 POST 라우트들은 예전 화면 · 다른 곳의 링크와 호환되도록 남겨 둡니다.
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const week = require('../lib/weekUtil');
const { canonicalPosition } = require('../lib/positions');
const spa = require('../lib/spa');
const rosterPicker = require('../lib/rosterPicker');
const hubPage = require('../lib/hubPage');
const schedLog = require('../lib/scheduleLog');
const honorific = require('../lib/honorific');
const avatar = require('../lib/avatar');
const ui = require('../lib/uiIcons');
const esc = pageShell.esc;

const router = express.Router();

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length) {
    return spa.send(req, res,
      `${pageShell.hubNav('schedule', '')}<div class="ph-card"><p class="ph-sub">아직 소속된 찬양팀이 없어요. 관리자에게 문의해주세요.</p><a class="ph-btn" href="/">← 허브로</a></div>`,
      { title: '스케줄표' },
    );
  }
  req.ctx = ctx;
  next();
}

function backTo(req, res, team, b) {
  b = b || {};
  const qs = new URLSearchParams({ team: team || '' });
  if (b.range) qs.set('range', b.range);
  if (b.hl) qs.set('hl', b.hl);
  if (b.view) qs.set('view', b.view);
  spa.redirect(req, res, `/schedule?${qs.toString()}`);
}

/* ---------- 연습 일정 (보통 격주 금요일, 맨 마지막 금요일 제외 — 바뀔 수 있어서 자유롭게 추가·삭제) ---------- */
async function practiceDates(team) {
  const rows = await sheetsDb.readAll('연습일정');
  return rows.filter((r) => r['팀ID'] === team).sort((a, b) => a['날짜'].localeCompare(b['날짜']));
}

function nextFriday(fromStr) {
  const d = new Date((fromStr || week.todayStr()) + 'T12:00:00');
  const add = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function isLastFridayOfMonth(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const next = new Date(d); next.setDate(d.getDate() + 7);
  return next.getMonth() !== d.getMonth();
}

/** 시작일부터 금요일마다 후보를 만들고, 마지막주 금요일은 빼고, 격주면 하나 걸러 하나만 남김 */
function generatePracticeDates(startStr, months, biweekly, skipLastFriday) {
  const start = nextFriday(startStr);
  const end = new Date(start + 'T12:00:00'); end.setMonth(end.getMonth() + Number(months || 3));
  const endStr = end.toISOString().slice(0, 10);
  const all = [];
  let d = start;
  while (d <= endStr) {
    if (!skipLastFriday || !isLastFridayOfMonth(d)) all.push(d);
    d = week.shiftWeek(d, 1);
  }
  return biweekly ? all.filter((_, i) => i % 2 === 0) : all;
}

/* 스케줄표 화면 — church-app(청년부 앱) 찬양 허브의 "스케줄표" 탭을 그대로 (카드 · 테이블 · 기간 · 사람 강조 · 칸 눌러 배정 ·
 * 날짜 눌러 자세히 · 내가 안 되는 날 · PDF). 화면은 public/hub/*, 서버 함수는 lib/hubApi.js.
 * 이 앱만의 것: 연습일 — 기본은 주일 바로 전 금요일이고, 카드 머리의 연습일을 눌러 바꿉니다 (worshipPracticeSet).
 * 아래 POST 라우트들은 예전 화면 · 다른 곳의 링크와 호환되도록 남겨 둡니다. */
router.get('/schedule', requireTeam, async (req, res) => {
  const team = req.ctx.current;
  await hubPage.send(req, res, {
    nav: 'schedule', tab: 'sched', title: `${team} 스케줄표`,
    hero: { eyebrow: `${team} · 스케줄표`, title: '스케줄표', sub: '포지션 편성 · 연습일 · 내가 안 되는 날' },
    extra: `<div class="ph-adminrow st-toolrow"><a class="ph-mini" href="/schedule/history?team=${encodeURIComponent(team)}">${ui.icon('timer')} 변경 기록</a>${req.ctx.isAdmin ? `<a class="ph-mini" href="/schedule/import?team=${encodeURIComponent(team)}">${ui.icon('download')} 엑셀로 스케줄 올리기</a>` : ''}<button type="button" class="ph-mini pri" data-mysched data-team="${pageShell.esc(team)}">${ui.icon('calendar')} 나의 스케줄</button></div>`,
  });
});

/* ---------- 변경 기록 — 누가 · 언제 · 어느 예배의 무엇을 바꿨는지 (lib/scheduleLog.js) ---------- */
const H_DAYS = [['7', '지난 7일'], ['30', '지난 30일'], ['90', '지난 3개월'], ['365', '지난 1년'], ['all', '전체']];
const H_KINDS = [['', '모든 종류'], ['편성', '편성'], ['불가', '안 되는 날'], ['연습', '연습일']];
const TZ = 'America/Toronto';
const WDK = ['일', '월', '화', '수', '목', '금', '토'];
function hDay(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d);
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function hTime(iso) { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d); }
function hDayLabel(ymd) {
  const today = hDay(new Date().toISOString()), yest = hDay(new Date(Date.now() - 864e5).toISOString());
  const x = new Date(ymd + 'T12:00:00');
  const base = `${x.getMonth() + 1}월 ${x.getDate()}일 (${WDK[x.getDay()]})`;
  return ymd === today ? '오늘 · ' + base : ymd === yest ? '어제 · ' + base : (x.getFullYear() !== new Date().getFullYear() ? x.getFullYear() + '년 ' : '') + base;
}
function hTarget(r) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date);
  const d = m ? `${Number(m[2])}/${Number(m[3])}(${WDK[new Date(r.date + 'T12:00:00').getDay()]})` : '';
  return r.ev ? `${d} ${r.ev}`.trim() : `${d} 주일`;
}
const splitNames = (t) => String(t || '').split(/\s*,\s*/).filter(Boolean);
function hWhat(r, nm) {
  if (r.kind === '편성') {
    const b = splitNames(r.before), a = splitNames(r.after);
    const out = b.filter((n) => !a.includes(n)).map((n) => `<s class="sh-out">${esc(nm(n, r.pos))}</s>`);
    const add = a.filter((n) => !b.includes(n)).map((n) => `<b class="sh-in">${esc(nm(n, r.pos))}</b>`);
    const verb = out.length && add.length ? `${out.join(' ')} → ${add.join(' ')}` : out.length ? `${out.join(' ')} 빠짐` : `${add.join(' ')} 들어옴`;
    return `<span class="sh-k">${esc(r.pos)}</span> ${verb}${a.length > 1 || (b.length > 1) ? ` <span class="sh-now">지금: ${esc(a.map((n) => nm(n, r.pos)).join(', ') || '비움')}</span>` : ''}`;
  }
  if (r.kind === '불가') {
    return `<span class="sh-k sh-k-off">안 되는 날</span> <b>${esc(nm(r.person))}</b> ` + (r.after
      ? (r.before ? `${esc(r.before)} → <b class="sh-in">${esc(r.after)}</b>` : `표시 · ${esc(r.after)}`)
      : `<s class="sh-out">${esc(r.before)}</s> 해제`);
  }
  if (r.kind === '연습') return `<span class="sh-k sh-k-prac">연습일</span> ${esc(r.before || '—')} → <b class="sh-in">${esc(r.after || '—')}</b>`;
  return `${esc(r.kind)} ${esc(r.before)} → ${esc(r.after)}`;
}

router.get('/schedule/history', requireTeam, async (req, res) => {
  const team = req.ctx.current;
  const q = req.query || {};
  const days = H_DAYS.some(([k]) => k === q.days) ? q.days : '30';
  const kind = H_KINDS.some(([k]) => k === q.kind) ? q.kind : '';
  const who = String(q.who || '').trim().slice(0, 40);
  const [h, info] = await Promise.all([
    schedLog.history(team, { days: days === 'all' ? 0 : Number(days), kind, who, limit: 500 }),
    avatar.teamInfoMap(team).catch(() => ({})),
    honorific.prime(team).catch(() => null),
  ]);
  const nm = (n, pos) => (pos ? honorific.forSlot(team, pos, n) : honorific.forTeam(team, n));
  const people = Array.from(new Set(Object.keys(info || {}).concat(h.people.filter((p) => !schedLog.isAuto(p)).map((p) => p.replace(/ \(엑셀\)$/, ''))))).sort((a, b) => a.localeCompare(b, 'ko'));
  const sel = (name, opts, cur) => `<select name="${name}" onchange="this.form.requestSubmit ? this.form.requestSubmit() : this.form.submit()">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const filters = `<form class="sh-filters" method="get" action="/schedule/history">
    <input type="hidden" name="team" value="${esc(team)}">
    ${sel('days', H_DAYS, days)}${sel('kind', H_KINDS, kind)}${sel('who', [['', '모든 사람']].concat(people.map((p) => [p, honorific.forTeam(team, p)])), who)}
    <noscript><button class="ph-mini" type="submit">보기</button></noscript></form>`;

  let list = '';
  if (!h.items.length) {
    list = `<div class="ph-card"><p class="ph-sub" style="margin:0;">${h.total || who || kind || days !== 'all' ? '이 조건에 맞는 변경이 없어요.' : '아직 기록된 변경이 없어요. 이제부터 스케줄표 · 콘티 편성에서 바꾸는 것이 여기에 쌓입니다.'}</p></div>`;
  } else {
    const groups = [];
    h.items.forEach((r) => { const d = hDay(r.at); let g = groups[groups.length - 1]; if (!g || g.d !== d) groups.push(g = { d, rows: [] }); g.rows.push(r); });
    list = groups.map((g) => `<section class="sh-day"><h3 class="sh-dh">${esc(hDayLabel(g.d))}</h3><ul class="sh-list">${g.rows.map((r) => {
      const auto = schedLog.isAuto(r.by), byName = r.by.replace(/ \(엑셀\)$/, '');
      return `<li class="sh-item">
        <span class="sh-time">${esc(hTime(r.at))}</span>
        <div class="sh-body">
          <div class="sh-top"><a class="sh-target" href="/schedule?team=${encodeURIComponent(team)}${r.date < week.todayStr() ? '&amp;range=around' : ''}">${esc(hTarget(r))}</a></div>
          <div class="sh-what">${hWhat(r, nm)}</div>
          <div class="sh-by">${auto ? '⚙︎ ' + esc(r.by) : `바꾼 사람 · <b>${esc(honorific.forTeam(team, byName))}</b>${byName !== r.by ? ' (엑셀 올리기)' : ''}`}</div>
        </div></li>`;
    }).join('')}</ul></section>`).join('') +
      (h.total > h.items.length ? `<p class="ph-sub" style="text-align:center;">최근 ${h.items.length}건만 보여요 (모두 ${h.total}건) — 기간이나 사람을 좁혀 보세요.</p>` : '');
  }

  const css = `<style>
    .sh-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 12px}
    .sh-filters{display:flex;gap:8px;flex-wrap:wrap}
    .sh-filters select{font:inherit;font-size:.88rem;padding:7px 10px;border-radius:10px;border:1px solid var(--line-hi);background:var(--glass);color:var(--ink);max-width:100%}
    .sh-count{font-size:.82rem;color:var(--dim)}
    .sh-day{margin:0 0 14px}
    .sh-dh{font-size:.8rem;font-weight:800;letter-spacing:.02em;color:var(--sub);margin:0 2px 6px}
    .sh-list{list-style:none;margin:0;padding:0;background:var(--glass);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--card-shadow);overflow:hidden}
    .sh-item{display:grid;grid-template-columns:64px 1fr;gap:10px;padding:11px 14px;border-top:1px solid var(--line)}
    .sh-item:first-child{border-top:0}
    .sh-time{font-size:.78rem;color:var(--dim);font-variant-numeric:tabular-nums;padding-top:2px;white-space:nowrap}
    .sh-body{min-width:0}
    .sh-target{font-weight:800;font-size:.92rem;color:var(--ink);text-decoration:none}
    .sh-target:hover{color:var(--accent-ink)}
    .sh-what{margin-top:3px;font-size:.9rem;line-height:1.5;color:var(--ink);overflow-wrap:anywhere}
    .sh-by{margin-top:3px;font-size:.78rem;color:var(--sub)}
    .sh-k{display:inline-block;font-size:.72rem;font-weight:800;padding:1px 7px;border-radius:6px;margin-right:2px;background:rgba(var(--accent-rgb),.18);color:var(--accent-ink);vertical-align:1px}
    .sh-k-off{background:rgba(234,123,110,.16);color:var(--bad)}
    .sh-k-prac{background:rgba(var(--mint-rgb),.2);color:var(--mint-ink)}
    .sh-in{color:var(--good);font-weight:800}
    .sh-out{color:var(--bad);opacity:.85}
    .sh-now{font-size:.78rem;color:var(--dim)}
    @media (max-width:520px){.sh-item{grid-template-columns:1fr;gap:2px}.sh-time{padding:0}}
  </style>`;

  await spa.send(req, res, `${css}
    ${pageShell.hubNav('schedule', team)}
    ${pageShell.hero({ eyebrow: `${team} · 스케줄표`, title: '변경 기록', sub: '누가 · 언제 · 어느 예배의 무엇을 바꿨는지' })}
    ${teamContext.teamSwitcher(req.ctx) ? `<div class="ph-card ph-teamcard">${teamContext.teamSwitcher(req.ctx)}</div>` : ''}
    <div class="sh-bar"><a class="ph-mini" href="/schedule?team=${encodeURIComponent(team)}">← 스케줄표</a>${filters}</div>
    <p class="sh-count">${h.total}건</p>
    ${list}`, { title: `${team} 스케줄 변경 기록` });
});

router.post('/schedule/assign', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const pos = String(b['포지션'] || '').trim();
  const name = rosterPicker.resolveName(b);
  if (pos && name) {
    const dup = (await sheetsDb.readAll('찬양편성')).find((r) => r['팀ID'] === team && r['날짜'] === date && !r['행사ID'] && canonicalPosition(r['포지션']) === canonicalPosition(pos) && r['이름'] === name);
    if (!dup) {
      await sheetsDb.appendRow('찬양편성', { 'ID': 'A' + Date.now().toString(36), '팀ID': team, '날짜': date, '포지션': pos, '이름': name });
    }
  }
  backTo(req, res, team, b);
});

router.post('/schedule/unassign', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('찬양편성', row); } catch (e) { console.error('[편성 삭제 실패]', e.message); } }
  backTo(req, res, b.team, b);
});

router.post('/schedule/off', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const name = req.ctx.member['이름'];
  const reason = String(b['사유'] || '').trim() || '불가';
  const existing = await sheetsDb.findWhere('불가일정', (r) => r['팀ID'] === team && r['날짜'] === date && r['이름'] === name);
  if (existing) await sheetsDb.updateRow('불가일정', existing.__row, { ...existing, '사유': reason, '등록시각': new Date().toISOString() });
  else await sheetsDb.appendRow('불가일정', { 'ID': 'O' + Date.now().toString(36), '팀ID': team, '이름': name, '날짜': date, '사유': reason, '등록시각': new Date().toISOString() });
  backTo(req, res, team, b);
});

router.post('/schedule/off/clear', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('불가일정', row); } catch (e) { console.error('[불가 해제 실패]', e.message); } }
  backTo(req, res, b.team, b);
});

router.post('/schedule/practice/add', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (req.ctx.isAdmin) {
    const date = week.normalizeDate(b['날짜']);
    const note = String(b['비고'] || '').trim();
    if (date) {
      const existing = await sheetsDb.findWhere('연습일정', (r) => r['팀ID'] === team && r['날짜'] === date);
      if (existing) await sheetsDb.updateRow('연습일정', existing.__row, { ...existing, '비고': note });
      else await sheetsDb.appendRow('연습일정', { 'ID': 'P' + Date.now().toString(36), '팀ID': team, '날짜': date, '비고': note, '등록시각': new Date().toISOString() });
    }
  }
  backTo(req, res, team, b);
});

router.post('/schedule/practice/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  if (req.ctx.isAdmin) {
    const row = Number(b.__row);
    if (row) { try { await sheetsDb.deleteRow('연습일정', row); } catch (e) { console.error('[연습일정 삭제 실패]', e.message); } }
  }
  backTo(req, res, b.team, b);
});

/** 주차 카드 헤더에서 바로 연습 날짜를 바꾸는 라우트 — "그 주일 직전 7일" 창 안에 있는 연습 하나를 찾아 업데이트/삭제/새로 만듦
 * (GET /schedule에서 카드별로 연습을 묶는 것과 같은 창을 씀: 기준일(주일) 직전 7일) */
router.post('/schedule/practice/set', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (req.ctx.isAdmin) {
    const serviceDate = week.normalizeDate(b['기준일']);
    const clear = !!b['지우기'];
    const newDate = (!clear && week.isValidDateStr(b['날짜'])) ? b['날짜'] : '';
    const note = String(b['비고'] || '').trim();
    const windowStart = week.shiftWeek(serviceDate, -1);
    const existing = await sheetsDb.findWhere('연습일정', (r) => r['팀ID'] === team && r['날짜'] < serviceDate && r['날짜'] >= windowStart);
    if (newDate) {
      const dupAtNewDate = await sheetsDb.findWhere('연습일정', (r) => r['팀ID'] === team && r['날짜'] === newDate && (!existing || r.__row !== existing.__row));
      if (!dupAtNewDate) {
        if (existing) await sheetsDb.updateRow('연습일정', existing.__row, { ...existing, '날짜': newDate, '비고': note });
        else await sheetsDb.appendRow('연습일정', { 'ID': 'P' + Date.now().toString(36), '팀ID': team, '날짜': newDate, '비고': note, '등록시각': new Date().toISOString() });
      }
    } else if (existing) {
      try { await sheetsDb.deleteRow('연습일정', existing.__row); } catch (e) { console.error('[연습일정 삭제 실패]', e.message); }
    }
  }
  backTo(req, res, team, b);
});

router.post('/schedule/practice/autofill', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (req.ctx.isAdmin) {
    const startStr = week.isValidDateStr(b['시작일']) ? b['시작일'] : null;
    const months = Number(b['개월수']) || 3;
    const biweekly = !!b['격주'];
    const skipLast = !!b['마지막금요일제외'];
    const candidates = generatePracticeDates(startStr, months, biweekly, skipLast);
    const existing = new Set((await practiceDates(team)).map((r) => r['날짜']));
    for (const date of candidates) {
      if (!existing.has(date)) {
        await sheetsDb.appendRow('연습일정', { 'ID': 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), '팀ID': team, '날짜': date, '비고': '', '등록시각': new Date().toISOString() });
      }
    }
  }
  backTo(req, res, team, b);
});

module.exports = router;
