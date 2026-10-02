/**
 * 스케줄 엑셀 가져오기 (관리자) — 미리 짜 둔 편성표(.xlsx)를 스케줄표로 옮기는 화면.
 *   GET  /schedule/import          올리기 화면
 *   POST /schedule/import/preview  엑셀을 읽어 "무엇이 들어가는지" 미리보기 (이름 맞추기 점검표 포함)
 *   POST /schedule/import/apply    확인 후 시트에 반영 (편성 + 불참)
 *   GET  /schedule/import/template  엑셀 템플릿 내려받기 (빈 것 · 지금 편성을 채운 것) — 만드는 법: lib/scheduleTemplate.js
 * 읽는 규칙은 lib/scheduleImport.js. 이미 있는 편성은 기본으로 건드리지 않고(채우기), "엑셀대로 덮어쓰기"를 고르면 그 날 · 포지션만 엑셀대로 바꿉니다.
 */
const crypto = require('crypto');
const express = require('express');
const upload = require('../lib/upload');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const avatar = require('../lib/avatar');
const week = require('../lib/weekUtil');
const hubApi = require('../lib/hubApi');
const imp = require('../lib/scheduleImport');
const tpl = require('../lib/scheduleTemplate');
const honorific = require('../lib/honorific');

const router = express.Router();
const esc = pageShell.esc;

/** 올린 엑셀을 30분 동안만 서버 기억에 둡니다 (미리보기 → 반영 사이) */
const HOLD = new Map();
function hold(buf, team) {
  const now = Date.now();
  HOLD.forEach((v, k) => { if (now - v.at > 30 * 60 * 1000) HOLD.delete(k); });
  const id = crypto.randomBytes(12).toString('hex');
  HOLD.set(id, { buf, team, at: now });
  return id;
}

async function requireAdmin(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.isAdmin) return res.status(403).type('text').send('관리자만 쓸 수 있는 화면입니다.');
  if (!ctx.current) return res.redirect('/');
  req.ctx = ctx;
  next();
}

const PART = { all: '연습 · 주일', prac: '금요일 연습', sun: '주일' };
const STATUS = { ok: '', mapped: '', guess: '추정', ambiguous: '확인 필요', unknown: '명단에 없음' };
const dayKo = (d) => week.labelKo(d).replace(/^\d{4}-/, '');

function page(req, res, body, title) {
  return spa.send(req, res, `${pageShell.hubNav('schedule', req.ctx.current)}
  ${pageShell.hero({ eyebrow: `${req.ctx.current} · 스케줄표`, title: '엑셀로 스케줄 올리기', sub: '미리 짜 둔 편성표를 한 번에 옮겨요' })}
  <div class="si">${body}</div>`, { title: title || '스케줄 엑셀 올리기' });
}

function uploadForm(team, msg) {
  const year = week.todayStr().slice(0, 4);
  const T = encodeURIComponent(team);
  const next = week.normalizeDate(null);
  return `
  ${msg ? `<div class="ph-card"><p class="ph-sub" style="color:var(--bad);">${esc(msg)}</p></div>` : ''}
  <form class="ph-card si-card top-accent" method="get" action="/schedule/import/template">
    <h2 class="ph-h2">1. 엑셀 템플릿 받기</h2>
    <p class="ph-sub">주일마다 한 줄이고, 포지션이 칸으로 나뉜 표예요. 칸에 이름을 적고(목록에서 골라도 돼요), 못 오는 사람은 <b>불참</b> 칸에 적어요.
      같은 이름이 있으면 스케줄표에는 <b>조희 · 김희</b> 처럼 성을 붙여 보여요.</p>
    <input type="hidden" name="team" value="${esc(team)}">
    <label class="si-row"><span>이 날짜부터</span><input type="date" name="from" value="${esc(next)}"></label>
    <label class="si-row"><span>몇 주</span><select name="weeks"><option value="8">8주</option><option value="13" selected>13주 (3개월)</option><option value="26">26주 (6개월)</option><option value="52">52주 (1년)</option></select></label>
    <fieldset class="si-modes">
      <label><input type="radio" name="fill" value="" checked> <b>빈 템플릿</b> <small>날짜만 들어 있어요</small></label>
      <label><input type="radio" name="fill" value="1"> <b>지금 스케줄 채워서 받기</b> <small>이미 적힌 편성 · 불참이 들어 있어서, 고쳐서 다시 올릴 수 있어요</small></label>
    </fieldset>
    <div class="si-actions"><button class="ph-btn" type="submit">엑셀 템플릿 다운로드</button></div>
  </form>
  <form class="ph-card si-card" method="post" action="/schedule/import/preview?team=${T}" enctype="multipart/form-data">
    <h2 class="ph-h2">2. 채운 엑셀 올리기</h2>
    <p class="ph-sub">위 템플릿(날짜 · 포지션 칸 표)을 그대로 올리면 돼요. 예전처럼 첫 줄이 <b>날짜 · 포지션 · 이름</b> 인 세로 표도 읽어요 — 이때 포지션이 <b>비고(불참/기타)</b> 인 줄의 이름 칸은 메모로 보고
      <b>"조희 연습X, 다현x"</b> 처럼 <b>이름 + X</b> 를 불참으로 읽어요 (이름 앞뒤에 "연습"이 붙으면 금요일 연습만 불참, 사유는 없어도 돼요).
      이름은 두 글자여도 팀원 명단에서 찾아 맞춰요 (조희 → 조희영).</p>
    <label class="si-row"><span>엑셀 파일 (.xlsx)</span><input type="file" name="file" accept=".xlsx" required></label>
    <label class="si-row"><span>이 날짜부터</span><input type="date" name="from" value="${year}-01-01"></label>
    <fieldset class="si-modes">
      <label><input type="radio" name="mode" value="fill" checked> <b>빈 곳만 채우기</b> <small>이미 적힌 편성은 그대로 두고, 없는 것만 더해요</small></label>
      <label><input type="radio" name="mode" value="replace"> <b>엑셀대로 덮어쓰기</b> <small>엑셀에 나온 날 · 포지션은 엑셀대로 바꿔요 (표에서는 이름이 적힌 줄의 빈 칸은 비워요)</small></label>
    </fieldset>
    <label class="si-row si-col"><span>빠진 불참 직접 적기 <small>(선택 · 한 줄에 하나: <code>2026-02-08 지혜</code> · 금요일만이면 끝에 <code>연습</code>)</small></span>
      <textarea name="manual" rows="3" placeholder="2026-02-08 지혜&#10;2026-02-06 지혜 연습"></textarea></label>
    <div class="si-actions"><button class="ph-btn" type="submit">미리보기</button><a class="ph-btn ghost" href="/schedule?team=${T}">취소</a></div>
  </form>`;
}

/** 템플릿 내려받기 (/schedule 아래는 SPA 이동 대상이 아니라 폼이 그대로 파일 다운로드로 나감) */
router.get('/schedule/import/template', requireAdmin, async (req, res) => {
  const team = req.ctx.current;
  const q = req.query || {};
  const from = week.isValidDateStr(q.from) ? q.from : week.normalizeDate(null);
  const weeks = Math.min(Math.max(parseInt(q.weeks, 10) || 13, 1), 104);
  const dates = tpl.sundays(from, weeks);
  const [info, allAssign, allOff] = await Promise.all([avatar.teamInfoMap(team), q.fill ? sheetsDb.readAll('찬양편성', { fresh: true }) : [], q.fill ? sheetsDb.readAll('불가일정', { fresh: true }) : []]);
  const inRange = new Set(dates);
  const members = Object.keys(info).map((name) => ({ name, role: String(info[name].역할 || '').split(',').map((s) => s.trim()).filter(Boolean).join(' · '), pastor: honorific.isPastorRoles(info[name].역할) }));
  const assign = q.fill ? allAssign.filter((r) => r['팀ID'] === team && !r['행사ID'] && inRange.has(String(r['날짜']))).map((r) => ({ date: String(r['날짜']), pos: String(r['포지션'] || '').trim(), name: String(r['이름'] || '').trim() })).filter((a) => a.name) : [];
  const off = q.fill ? allOff.filter((r) => r['팀ID'] === team && inRange.has(String(r['날짜']))).map((r) => ({ date: String(r['날짜']), name: String(r['이름'] || '').trim(), part: tpl.partOf(r['구분']), reason: String(r['사유'] || '') })).filter((x) => x.name) : [];
  const buf = tpl.build({ team, dates, members, assign, off });
  const fname = `${team} 스케줄${q.fill ? '' : ' 템플릿'} ${dates[0]}~.xlsx`;
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="schedule-template.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`,
    'Cache-Control': 'no-store',
  });
  res.send(buf);
});

router.get('/schedule/import', requireAdmin, async (req, res) => { await page(req, res, uploadForm(req.ctx.current)); });

async function knownNames(team) { return Object.keys(await avatar.teamInfoMap(team)); }

router.post('/schedule/import/preview', requireAdmin, (req, res, next) => upload.single('file')(req, res, (e) => (e ? next(e) : next())), async (req, res) => {
  const team = req.ctx.current;
  const f = req.file;
  if (!f || !f.buffer || !f.buffer.length) return page(req, res, uploadForm(team, '엑셀 파일을 골라주세요.'));
  let parsed;
  try { parsed = imp.parseWorkbook(f.buffer); } catch (e) { return page(req, res, uploadForm(team, e.message || '엑셀을 읽지 못했어요.')); }
  if (!parsed.assign.length && !parsed.notes.length && !parsed.direct.length) return page(req, res, uploadForm(team, '읽을 수 있는 줄이 없어요. 첫 줄이 "날짜 · 포지션 · 이름" 인지 확인해주세요.'));
  const from = week.isValidDateStr((req.body || {}).from) ? req.body.from : '';
  const mode = (req.body || {}).mode === 'replace' ? 'replace' : 'fill';
  const manual = String((req.body || {}).manual || '').slice(0, 4000);
  const known = await knownNames(team);
  const an = imp.analyze(parsed, { known, from, manual });
  const [existingAssign, existingOff] = await Promise.all([sheetsDb.readAll('찬양편성', { fresh: true }), sheetsDb.readAll('불가일정', { fresh: true })]);
  const pl = imp.plan(an, { map: {}, mode, existingAssign, existingOff, team });
  const token = hold(f.buffer, team);
  await page(req, res, previewHtml({ team, token, from, mode, manual, an, pl, known, fileName: f.originalname }));
});

function previewHtml(o) {
  const { team, an, pl } = o;
  const names = an.names;
  const nameRows = names.map((n, i) => `
    <tr class="si-${n.status}">
      <td><b>${esc(n.raw)}</b><input type="hidden" name="raw_${i}" value="${esc(n.raw)}"></td>
      <td>→</td>
      <td>${n.cands && n.cands.length > 1 ? `<select name="to_${i}">${n.cands.map((c) => `<option value="${esc(c)}"${c === n.name ? ' selected' : ''}>${esc(c)}</option>`).join('')}<option value="">건너뛰기</option></select>`
        : `<input type="text" name="to_${i}" value="${esc(n.name)}" list="si-members" placeholder="${n.status === 'unknown' && n.where === '불참' ? '이름을 적어주세요 (비우면 건너뜀)' : ''}" maxlength="20">`}</td>
      <td><small>${esc(n.where)} ${n.count}건${STATUS[n.status] ? ` · <em>${STATUS[n.status]}</em>` : ' · 자동 맞춤'}</small></td>
    </tr>`).join('');
  const byDate = new Map();
  an.assign.forEach((a) => { (byDate.get(a.date) || byDate.set(a.date, []).get(a.date)).push(a); });
  const dateRows = Array.from(byDate.entries()).slice(0, 80).map(([d, list]) =>
    `<tr><td>${esc(dayKo(d))}</td><td>${list.map((a) => `<span class="si-chip">${esc(a.pos)} ${esc(a.name)}</span>`).join('')}</td></tr>`).join('');
  const absRows = an.absences.slice(0, 200).map((a) => `<tr class="si-${a.status}"><td>${esc(dayKo(a.date))}</td><td>${esc(a.name || a.raw)}${a.name && a.name !== a.raw ? ` <small>(${esc(a.raw)})</small>` : ''}</td><td>${PART[a.part]}</td><td>${esc(a.reason)}</td></tr>`).join('');
  const noteRows = an.notes.map((n) => `<tr><td>${esc(dayKo(n.date))}</td><td>${esc(n.text)}</td></tr>`).join('');
  return `
  <div class="ph-card si-card top-accent">
    <h2 class="ph-h2">2. 이대로 올릴까요?</h2>
    <p class="ph-sub"><b>${esc(o.fileName || '엑셀')}</b> · ${esc(o.from || '처음')}부터 · ${o.mode === 'replace' ? '엑셀대로 덮어쓰기' : '빈 곳만 채우기'}</p>
    <div class="si-sum">
      <div><b>${pl.add.length}</b><span>편성 새로 넣음</span></div>
      <div><b>${pl.keep.length}</b><span>이미 있음 (그대로)</span></div>
      <div><b>${pl.del.length}</b><span>편성 바꿈 (지움)</span></div>
      <div><b>${pl.off.length}</b><span>불참 새로 넣음</span></div>
      <div><b>${pl.conflict.length}</b><span>자리 겹쳐 건너뜀</span></div>
    </div>
    ${an.before ? `<p class="ph-sub">${esc(o.from)} 이전 ${an.before}줄은 건너뛰었어요.</p>` : ''}
    ${an.skipped.length ? `<details class="si-det"><summary>건너뛴 줄 ${an.skipped.length}개</summary><ul>${an.skipped.slice(0, 50).map((s) => `<li>${esc(s.row)} — ${esc(s.why)}</li>`).join('')}</ul></details>` : ''}
  </div>
  <form method="post" action="/schedule/import/apply?team=${encodeURIComponent(team)}">
    <input type="hidden" name="token" value="${esc(o.token)}"><input type="hidden" name="from" value="${esc(o.from)}"><input type="hidden" name="mode" value="${esc(o.mode)}"><input type="hidden" name="manual" value="${esc(o.manual)}">
    <input type="hidden" name="n" value="${names.length}">
    ${names.length ? `<div class="ph-card si-card"><h3 class="ph-h3">이름 확인 (${names.length})</h3>
      <p class="ph-sub">엑셀의 짧은 이름을 팀원 이름으로 맞췄어요. <b>추정 · 확인 필요 · 명단에 없음</b> 은 한 번 봐주세요. 불참에서 이름을 비우면 그 사람 불참은 넣지 않아요.</p>
      <table class="si-tbl"><tbody>${nameRows}</tbody></table>
      <datalist id="si-members">${o.known.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>` : ''}
    <div class="ph-card si-card"><h3 class="ph-h3">불참 (${an.absences.length})</h3>
      ${an.absences.length ? `<table class="si-tbl"><thead><tr><th>날짜</th><th>이름</th><th>범위</th><th>사유</th></tr></thead><tbody>${absRows}</tbody></table>${an.absences.length > 200 ? `<p class="ph-sub">앞 200건만 보여요.</p>` : ''}` : '<p class="ph-sub">불참이 없어요.</p>'}
      <details class="si-det"><summary>불참 메모 원문 ${an.notes.length}주 — 빠진 것이 없는지 보세요</summary><table class="si-tbl"><tbody>${noteRows}</tbody></table></details>
    </div>
    <div class="ph-card si-card"><h3 class="ph-h3">편성 (${an.assign.length}칸 · ${byDate.size}주)</h3>
      <details class="si-det"><summary>주별로 보기</summary><table class="si-tbl"><tbody>${dateRows}</tbody></table>${byDate.size > 80 ? '<p class="ph-sub">앞 80주만 보여요.</p>' : ''}</details>
    </div>
    <div class="si-actions"><button class="ph-btn" type="submit">스케줄표에 올리기</button><a class="ph-btn ghost" href="/schedule/import?team=${encodeURIComponent(team)}">처음으로</a></div>
  </form>`;
}

router.post('/schedule/import/apply', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const team = req.ctx.current;
  const held = HOLD.get(String(b.token || ''));
  if (!held || held.team !== team) return page(req, res, uploadForm(team, '올린 엑셀이 만료됐어요 (30분). 다시 올려주세요.'));
  const parsed = imp.parseWorkbook(held.buf);
  const from = week.isValidDateStr(b.from) ? b.from : '';
  const mode = b.mode === 'replace' ? 'replace' : 'fill';
  const manual = String(b.manual || '').slice(0, 4000);
  const known = await knownNames(team);
  const an = imp.analyze(parsed, { known, from, manual });
  const map = {};
  const n = Math.min(Number(b.n) || 0, 500);
  for (let i = 0; i < n; i++) { const raw = String(b['raw_' + i] || ''); if (raw) map[raw] = String(b['to_' + i] == null ? '' : b['to_' + i]).trim().slice(0, 20); }
  let result;
  try { result = await applyPlan(team, an, map, mode); }
  catch (e) { console.error('[스케줄 가져오기 실패]', e); return page(req, res, uploadForm(team, '시트에 올리는 중 문제가 생겼어요: ' + (e.message || e))); }
  HOLD.delete(String(b.token));
  const r = result;
  await page(req, res, `<div class="ph-card si-card top-accent"><h2 class="ph-h2">올렸어요</h2>
    <div class="si-sum"><div><b>${r.added}</b><span>편성 넣음</span></div><div><b>${r.kept}</b><span>이미 있어 그대로</span></div><div><b>${r.removed}</b><span>편성 바꿈</span></div><div><b>${r.off}</b><span>불참 넣음</span></div><div><b>${r.conflict}</b><span>겹쳐 건너뜀</span></div></div>
    ${r.conflictList.length ? `<details class="si-det" open><summary>겹쳐서 건너뛴 자리</summary><ul>${r.conflictList.slice(0, 40).map((c) => `<li>${esc(dayKo(c.date))} ${esc(c.pos)} — 엑셀 ${esc(c.name)} / 이미 ${esc(c.have)}</li>`).join('')}</ul><p class="ph-sub">엑셀대로 바꾸려면 "엑셀대로 덮어쓰기"로 다시 올리세요.</p></details>` : ''}
    <div class="si-actions"><a class="ph-btn" href="/schedule?team=${encodeURIComponent(team)}">스케줄표 보기</a></div></div>`, '스케줄 올림');
});

const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function applyPlan(team, an, map, mode) {
  return hubApi.serial('assign|' + team, () => hubApi.serial('off|' + team, async () => {
    const [existingAssign, existingOff] = await Promise.all([sheetsDb.readAll('찬양편성', { fresh: true }), sheetsDb.readAll('불가일정', { fresh: true })]);
    const pl = imp.plan(an, { map, mode, existingAssign, existingOff, team });
    // 편성
    await sheetsDb.deleteRows('찬양편성', pl.del.map((d) => d.row));
    await sheetsDb.appendRows('찬양편성', pl.add.map((a) => ({ 'ID': rid('A'), '팀ID': team, '날짜': a.date, '포지션': a.pos, '이름': a.name, '행사ID': '' })));
    // 불참 — 같은 사람 · 날짜의 옛 줄과 합쳐 다시 씀
    const offRows = existingOff.filter((r) => r['팀ID'] === team);
    const OFFPART = { '': 'all', '연습': 'prac', '예배': 'sun' };
    const delRows = [], newRows = [];
    const bySlot = new Map();
    pl.off.forEach((o) => { const k = o.date + '|' + o.name; const e = bySlot.get(k) || bySlot.set(k, { date: o.date, name: o.name, prac: '', sun: '' }).get(k); if (o.part !== 'sun' && !e.prac) e.prac = o.reason; if (o.part !== 'prac' && !e.sun) e.sun = o.reason; });
    bySlot.forEach((e) => {
      const old = offRows.filter((r) => String(r['날짜']) === e.date && String(r['이름']) === e.name);
      old.forEach((r) => { const part = OFFPART[String(r['구분'] || '').trim()] || 'all', why = String(r['사유'] || '불참'); if (part !== 'sun' && !e.prac) e.prac = why; if (part !== 'prac' && !e.sun) e.sun = why; delRows.push(r.__row); });
      const base = { '팀ID': team, '이름': e.name, '날짜': e.date, '등록시각': new Date().toISOString() };
      if (e.prac && e.sun && e.prac === e.sun) newRows.push(Object.assign({ 'ID': rid('O'), '사유': e.prac, '구분': '' }, base));
      else { if (e.prac) newRows.push(Object.assign({ 'ID': rid('O'), '사유': e.prac, '구분': '연습' }, base)); if (e.sun) newRows.push(Object.assign({ 'ID': rid('O'), '사유': e.sun, '구분': '예배' }, base)); }
    });
    await sheetsDb.deleteRows('불가일정', delRows);
    await sheetsDb.appendRows('불가일정', newRows);
    return { added: pl.add.length, kept: pl.keep.length, removed: pl.del.length, off: pl.off.length, conflict: pl.conflict.length, conflictList: pl.conflict };
  }));
}

module.exports = router;
