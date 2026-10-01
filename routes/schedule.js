/**
 * 스케줄표 — church-app의 "스케줄표"(주차별 포지션 편성 + 내가 안 되는 날)를 그대로.
 * - 포지션별로 누가 서는지 여러 주 한눈에 보고, 눌러서 배정/해제합니다.
 * - 누구나 자신의 "안 되는 날"을 사유와 함께 미리 표시해 둘 수 있습니다(팀장이 편성할 때 참고).
 * - church-app처럼 "기간"(앞으로 6개월 · 앞뒤 3개월 · 지난 3/6/12개월)을 골라 보고,
 *   "사람 강조"로 한 사람 이름만 눈에 띄게 할 수 있습니다. 팀 소속이 아닌 이름은 "객원"으로 표시됩니다.
 * (church-app의 "테이블 보기"는 빼고 카드 보기만 둡니다.)
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const week = require('../lib/weekUtil');
const { POSITION_GROUPS, canonicalPosition } = require('../lib/positions');
const spa = require('../lib/spa');
const avatar = require('../lib/avatar');
const rosterPicker = require('../lib/rosterPicker');

const router = express.Router();
const esc = pageShell.esc;

/** church-app의 ST_RANGES — "몇 달 치를 볼지" (주 단위로 근사: 1개월 ≈ 4.345주) */
const RANGE_PRESETS = [
  ['next6', '앞으로 6개월', 0, 6],
  ['around', '앞뒤 3개월', 3, 3],
  ['past3', '지난 3개월', 3, 0],
  ['past6', '지난 6개월', 6, 0],
  ['past12', '지난 1년', 12, 0],
];
function rangeWeeks(key) {
  const p = RANGE_PRESETS.find((x) => x[0] === key) || RANGE_PRESETS[0];
  const weeksBack = Math.round(p[2] * 4.345);
  const weeksForward = Math.round(p[3] * 4.345);
  return { key: p[0], label: p[1], weeksBack, count: Math.max(1, weeksBack + weeksForward) || 1 };
}

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

async function teamInfoList(team) {
  const infoMap = await avatar.teamInfoMap(team);
  const names = Object.keys(infoMap).sort((a, b) => a.localeCompare(b, 'ko'));
  return { infoMap, names };
}

function extraHidden(rangeKey, hl, view) {
  return `${rangeKey ? `<input type="hidden" name="range" value="${esc(rangeKey)}">` : ''}${hl ? `<input type="hidden" name="hl" value="${esc(hl)}">` : ''}${view ? `<input type="hidden" name="view" value="${esc(view)}">` : ''}`;
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

function practiceCard(team, list, isAdmin, rangeKey, hl, view) {
  const today = week.todayStr();
  const upcoming = list.filter((p) => p['날짜'] >= today);
  const past = list.filter((p) => p['날짜'] < today);
  const row = (p) => `<div class="ph-list-item">
    <div class="ph-li-main"><div class="ph-li-title">🎹 ${esc(week.labelKo(p['날짜']))}</div>${p['비고'] ? `<div class="ph-li-sub">${esc(p['비고'])}</div>` : ''}</div>
    ${isAdmin ? `<form method="post" action="/schedule/practice/delete"><input type="hidden" name="__row" value="${p.__row}"><input type="hidden" name="team" value="${esc(team)}">${extraHidden(rangeKey, hl, view)}
      <button class="ph-row-del" type="submit" title="삭제">✕</button></form>` : ''}
  </div>`;
  const addForm = isAdmin ? `
    <details class="ph-add">
      <summary>+ 연습 날짜 직접 추가/수정</summary>
      <form method="post" action="/schedule/practice/add" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">${extraHidden(rangeKey, hl, view)}
        <input type="date" name="날짜" required>
        <input type="text" name="비고" placeholder="비고 (예: 10/4·10/11 콘티 연습)" maxlength="60">
        <button class="ph-btn pri" type="submit">추가</button>
      </form>
    </details>
    <details class="ph-add">
      <summary>+ 자동으로 채우기 (격주 금요일, 마지막주 제외)</summary>
      <form method="post" action="/schedule/practice/autofill" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">${extraHidden(rangeKey, hl, view)}
        <label>시작일(비우면 다음 금요일부터)</label>
        <input type="date" name="시작일">
        <label>기간</label>
        <select name="개월수"><option value="1">1개월</option><option value="3" selected>3개월</option><option value="6">6개월</option></select>
        <label class="ph-checkline"><input type="checkbox" name="격주" value="1" checked> 격주로 (2주에 한 번)</label>
        <label class="ph-checkline"><input type="checkbox" name="마지막금요일제외" value="1" checked> 매달 마지막 금요일은 제외</label>
        <button class="ph-btn pri" type="submit">만들기 (이미 있는 날짜는 건너뜀)</button>
      </form>
    </details>` : '';
  return `<div class="ph-card">
    <h2 class="ph-h2">연습 일정</h2>
    ${upcoming.length ? `<div class="ph-list">${upcoming.map(row).join('')}</div>` : '<p class="ph-sub">예정된 연습 날짜가 없어요.</p>'}
    ${past.length ? `<details class="ph-add"><summary>지난 연습 보기 (${past.length})</summary><div class="ph-list" style="margin-top:8px;">${past.map(row).join('')}</div></details>` : ''}
    ${addForm}
  </div>`;
}

function positionCell(date, posKey, names, roster, offSet, hl, rangeKey, view) {
  const rosterObjs = roster.names.map((n) => ({ 이름: n, 역할: (roster.infoMap[n] || {}).역할 }));
  return `<div class="ph-poscell">
    <div class="ph-poslabel">${esc(posKey)}</div>
    <div class="ph-posnames">
      ${names.length ? names.map((n) => {
        const isGuest = roster.names.indexOf(n.이름) === -1;
        const isOff = offSet.has(n.이름);
        const isHl = hl && n.이름 === hl;
        const cls = ['ph-namechip', isOff ? 'off' : '', isGuest ? 'guest' : '', isHl ? 'hl' : ''].filter(Boolean).join(' ');
        return `<span class="${cls}" title="${esc(n.이름)}${isOff ? ' — 불가' : ''}${isGuest ? ' (객원)' : ''}">${avatar.avatarHtml(n.이름, roster.infoMap[n.이름] || {}, 'sm')}${esc(avatar.givenName(n.이름))}
        <form method="post" action="/schedule/unassign" style="display:inline;">
          <input type="hidden" name="__row" value="${n.__row}"><input type="hidden" name="team" value="${esc(n.팀)}">
          <input type="hidden" name="date" value="${esc(date)}">${extraHidden(rangeKey, hl, view)}
          <button type="submit" aria-label="빼기">&times;</button>
        </form></span>`;
      }).join('') : '<span class="ph-namechip none">미정</span>'}
    </div>
    <form method="post" action="/schedule/assign" class="ph-assignform">
      <input type="hidden" name="team" value="${esc(roster.team)}"><input type="hidden" name="date" value="${esc(date)}"><input type="hidden" name="포지션" value="${esc(posKey)}">${extraHidden(rangeKey, hl, view)}
      ${rosterPicker.pickerFields(rosterObjs, posKey)}
      <button type="submit">추가</button>
    </form>
  </div>`;
}

function dateCard(d, roster, meName, hl, rangeKey, view) {
  const byPos = {};
  d.assign.forEach((r) => { const p = canonicalPosition(r['포지션']); (byPos[p] = byPos[p] || []).push({ 이름: r['이름'], __row: r.__row, 팀: r['팀ID'] }); });
  const offSet = new Set(d.off.map((o) => o['이름']));
  const groups = POSITION_GROUPS.map(([label, keys]) => `
    <div class="ph-posgroup">
      <div class="ph-posgrouplabel">${esc(label)}</div>
      <div class="ph-posrow">${keys.map((k) => positionCell(d.date, k, byPos[k] || [], roster, offSet, hl, rangeKey, view)).join('')}</div>
    </div>`).join('');

  const myOff = d.off.find((o) => o['이름'] === meName);
  const offLine = d.off.length
    ? `<div class="ph-offline">🙅 불가 — ${d.off.map((o) => `<b>${esc(o['이름'])}</b>${o['사유'] ? `<em>${esc(o['사유'])}</em>` : ''}`).join(', ')}</div>`
    : '';
  const practiceLine = (d.practice || []).length
    ? `<div class="ph-practiceline">${d.practice.map((p) => `🎹 연습 — ${esc(week.labelKo(p['날짜']))}${p['비고'] ? `<em>${esc(p['비고'])}</em>` : ''}`).join(' · ')}</div>`
    : '';

  return `<div class="ph-card ph-weekcard" id="d-${esc(d.date)}">
    <div class="ph-weektitle">${esc(week.labelKo(d.date))}</div>
    ${practiceLine}
    ${groups}
    ${offLine}
    ${myOff
      ? `<form method="post" action="/schedule/off/clear" class="ph-inlineform" style="margin-top:8px;">
          <input type="hidden" name="__row" value="${myOff.__row}"><input type="hidden" name="team" value="${esc(roster.team)}">${extraHidden(rangeKey, hl, view)}
          <button class="ph-btn" type="submit">내 "안 돼요" 표시 지우기</button>
        </form>`
      : `<details class="ph-add" style="margin-top:8px;">
          <summary>+ 이 날 저는 안 돼요</summary>
          <form method="post" action="/schedule/off" class="ph-inlineform">
            <input type="hidden" name="team" value="${esc(roster.team)}"><input type="hidden" name="date" value="${esc(d.date)}">${extraHidden(rangeKey, hl, view)}
            <input type="text" name="사유" placeholder="사유 (예: 출장 · 시험 · 가족 행사)" maxlength="100">
            <button class="ph-btn pri" type="submit">표시</button>
          </form>
        </details>`}
  </div>`;
}

/**
 * church-app의 "테이블" 보기 — 포지션 그룹별로 날짜×포지션 표를 한눈에(가로 스크롤), 한 사람 한 줄.
 * 칸을 눌러 바로 고치는 카드 보기와 달리, 여기는 훑어보기 전용 — 날짜를 누르면 카드 보기의 그 주로 이동.
 */
function tableView(days, roster, hl, rangeKey, team) {
  const jumpQs = (date) => {
    const qs = new URLSearchParams({ team, view: 'card' });
    if (rangeKey) qs.set('range', rangeKey);
    if (hl) qs.set('hl', hl);
    return `/schedule?${qs.toString()}#d-${encodeURIComponent(date)}`;
  };
  const tables = POSITION_GROUPS.map(([label, keys]) => {
    const rows = days.map((d) => {
      const byPos = {};
      d.assign.forEach((r) => { const p = canonicalPosition(r['포지션']); (byPos[p] = byPos[p] || []).push(r['이름']); });
      const cells = keys.map((k) => {
        const names = byPos[k] || [];
        return `<td>${names.length ? names.map((n) => `<span class="ph-tblname${hl && n === hl ? ' hl' : ''}" title="${esc(n)}">${avatar.avatarHtml(n, roster.infoMap[n] || {}, 'sm')}${esc(avatar.givenName(n))}</span>`).join('') : '<span class="ph-tbldash">–</span>'}</td>`;
      }).join('');
      return `<tr><th><a href="${jumpQs(d.date)}">${esc(week.labelKo(d.date))}</a></th>${cells}</tr>`;
    }).join('');
    return `<div class="ph-tblwrap">
      <div class="ph-tblcaption">${esc(label)}</div>
      <table class="ph-sctable"><thead><tr><th></th>${keys.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');
  return `<div class="ph-card">${tables}</div>`;
}

router.get('/schedule', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const rangeKey = RANGE_PRESETS.some((x) => x[0] === req.query.range) ? req.query.range : 'next6';
  const { label: rangeLabel, weeksBack, count: weeksCount } = rangeWeeks(rangeKey);
  const from = week.shiftWeek(week.normalizeDate(null), -weeksBack);
  const dates = Array.from({ length: weeksCount }, (_, i) => week.shiftWeek(from, i));
  const hl = String(req.query.hl || '').trim();
  const view = req.query.view === 'table' ? 'table' : 'card';

  const [assignRows, offRows, myPractice] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), practiceDates(team)]);
  const myAssign = assignRows.filter((r) => r['팀ID'] === team);
  const myOffAll = offRows.filter((r) => r['팀ID'] === team);
  const { infoMap, names: rosterNames } = await teamInfoList(team);
  const roster = { team, names: rosterNames, infoMap };

  const days = dates.map((date) => ({
    date,
    assign: myAssign.filter((r) => r['날짜'] === date),
    off: myOffAll.filter((r) => r['날짜'] === date),
    // 그 주일 직전 7일 안에 있는 연습 날짜를 그 주 카드에 묶어서 보여줌(대게 2주에 한 번, 바로 다음 주일 콘티 연습)
    practice: myPractice.filter((p) => p['날짜'] < date && p['날짜'] >= week.shiftWeek(date, -1)),
  }));

  const meName = ctx.member['이름'];
  const today = week.todayStr();
  const myOffUpcoming = myOffAll.filter((r) => r['이름'] === meName && r['날짜'] >= today).sort((a, b) => a['날짜'].localeCompare(b['날짜']));

  const hero = pageShell.hero({ eyebrow: `${team} · 스케줄표`, title: '스케줄표', sub: rangeLabel });
  const strip = pageShell.weekStrip({ basePath: '/schedule', team, date: week.normalizeDate(null), assignRows: myAssign, extraQuery: `&range=${encodeURIComponent(rangeKey)}${hl ? `&hl=${encodeURIComponent(hl)}` : ''}&view=${view}` });

  const rangeSelect = `<form method="get" class="ph-inlineform" style="gap:8px;flex-direction:row;flex-wrap:wrap;">
    <input type="hidden" name="team" value="${esc(team)}">${hl ? `<input type="hidden" name="hl" value="${esc(hl)}">` : ''}${view ? `<input type="hidden" name="view" value="${esc(view)}">` : ''}
    <select name="range" onchange="this.form.submit()">${RANGE_PRESETS.map(([k, label]) => `<option value="${k}"${k === rangeKey ? ' selected' : ''}>${label}</option>`).join('')}</select>
    <select name="hl" onchange="this.form.submit()"><option value="">사람 강조 없음</option>
      ${rosterNames.map((n) => `<option value="${esc(n)}"${n === hl ? ' selected' : ''}>${esc(n)}${n === meName ? ' (나)' : ''}</option>`).join('')}
    </select>
  </form>`;

  const viewQs = (v) => { const qs = new URLSearchParams({ team, range: rangeKey, view: v }); if (hl) qs.set('hl', hl); return `/schedule?${qs.toString()}`; };
  const viewToggle = `<div class="ph-viewtoggle">
    <a class="ph-vtbtn${view === 'card' ? ' on' : ''}" href="${viewQs('card')}">카드</a>
    <a class="ph-vtbtn${view === 'table' ? ' on' : ''}" href="${viewQs('table')}">테이블</a>
  </div>`;

  const content = `
  ${pageShell.hubNav('schedule', team)}
  ${hero}
  ${strip}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx, { keep: { range: rangeKey, hl, view } })}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      ${rangeSelect}
      ${viewToggle}
    </div>
    <p class="ph-sub" style="margin-top:8px;">${view === 'table' ? '날짜를 누르면 카드 보기에서 그 주를 바로 볼 수 있어요.' : '팀원 선택에서 고르거나 객원 이름을 직접 입력해 바로 배정됩니다. 이름 옆 ✕로 뺄 수 있어요. 팀 소속이 아닌 이름은 "객원"으로 표시돼요.'}</p>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">내가 안 되는 날</h2>
    ${myOffUpcoming.length
      ? `<div class="ph-list">${myOffUpcoming.map((o) => `<div class="ph-list-item">
          <div class="ph-li-main"><div class="ph-li-title">${esc(week.labelKo(o['날짜']))}</div>${o['사유'] ? `<div class="ph-li-sub">${esc(o['사유'])}</div>` : ''}</div>
          <form method="post" action="/schedule/off/clear"><input type="hidden" name="__row" value="${o.__row}"><input type="hidden" name="team" value="${esc(team)}">
            ${extraHidden(rangeKey, hl, view)}
            <button class="ph-row-del" type="submit" title="해제">✕</button></form>
        </div>`).join('')}</div>`
      : '<p class="ph-sub">표시해 둔 날이 없어요. 미리 적어두면 편성할 때 바로 보여요.</p>'}
    <details class="ph-add">
      <summary>+ 다른 날짜도 표시하기</summary>
      <form method="post" action="/schedule/off" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">
        ${extraHidden(rangeKey, hl, view)}
        <input type="date" name="date" required>
        <input type="text" name="사유" placeholder="사유 (예: 출장 · 시험 · 가족 행사)" maxlength="100">
        <button class="ph-btn pri" type="submit">표시</button>
      </form>
    </details>
  </div>

  ${practiceCard(team, myPractice, ctx.isAdmin, rangeKey, hl, view)}

  ${view === 'table' ? tableView(days, roster, hl, rangeKey, team) : days.map((d) => dateCard(d, roster, meName, hl, rangeKey, view)).join('')}
  `;
  spa.send(req, res, content, { title: `${team} 스케줄표` });
});

router.post('/schedule/assign', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const pos = String(b['포지션'] || '').trim();
  const name = rosterPicker.resolveName(b);
  if (pos && name) {
    const dup = (await sheetsDb.readAll('찬양편성')).find((r) => r['팀ID'] === team && r['날짜'] === date && canonicalPosition(r['포지션']) === canonicalPosition(pos) && r['이름'] === name);
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
