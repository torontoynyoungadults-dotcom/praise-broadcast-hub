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
    extra: req.ctx.isAdmin ? `<div class="ph-adminrow"><a class="ph-mini" href="/schedule/import?team=${encodeURIComponent(team)}">엑셀로 스케줄 올리기</a></div>` : '',
  });
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
