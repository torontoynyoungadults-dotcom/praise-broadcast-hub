/**
 * 행사 — "주일 외 서는 날"(성탄절 · 송구영신예배 · 특별새벽기도 · 부흥회 · 철야기도회 등)을
 * 예배콘티 화면에서 분리해 독립된 메뉴로 둔 화면입니다(church-app 청년부 앱의 "행사" 탭과 같은 역할).
 * 저장 형식·데이터(주일 외 찬양 시트)는 그대로이고, 보여주는 위치만 바뀌었습니다.
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const week = require('../lib/weekUtil');
const spa = require('../lib/spa');

const ui = require('../lib/uiIcons');
const router = express.Router();
const esc = pageShell.esc;

const SPECIAL_SERVICE_SUGGESTIONS = ['성탄절 예배', '송구영신예배', '특별새벽기도', '부흥회', '철야기도회'];

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length) {
    return spa.send(req, res,
      `${pageShell.hubNav('events', '')}<div class="ph-card"><p class="ph-sub">아직 소속된 찬양팀이 없어요. 관리자에게 문의해주세요.</p><a class="ph-btn" href="/">← 허브로</a></div>`,
      { title: '주일 외 찬양' },
    );
  }
  req.ctx = ctx;
  next();
}

function backTo(req, res, team) {
  spa.redirect(req, res, `/events?team=${encodeURIComponent(team)}`);
}

async function specialServices(team) {
  const rows = await sheetsDb.readAll('특별예배');
  return rows.filter((r) => r['팀ID'] === team).sort((a, b) => a['날짜'].localeCompare(b['날짜']));
}

const timeSettings = require('../lib/timeSettings');
const tsub = (s) => { const a = []; if (s['예배시간']) a.push('예배 ' + timeSettings.fmt(s['예배시간'])); if (s['리허설시간']) a.push('당일 리허설 ' + timeSettings.fmt(s['리허설시간'])); return a.length ? ' · ' + esc(a.join(' · ')) : ''; };

function eventItem(s, team, isAdmin) {
  return `<div class="ph-list-item">
    <div class="ph-li-main">
      <a class="ph-li-link strong" href="/conti?team=${encodeURIComponent(team)}&event=${encodeURIComponent(s['ID'])}">${esc(s['이름'])} 콘티 보기 →</a>
      <div class="ph-li-sub">${esc(week.labelKo(s['날짜']))}${tsub(s)}</div>
    </div>
    ${isAdmin ? `<details class="ph-row-edit">
      <summary title="수정">⋯</summary>
      <form method="post" action="/events/add" class="ph-inlineform">
        <input type="hidden" name="__row" value="${s.__row}"><input type="hidden" name="team" value="${esc(team)}">
        <input type="date" name="날짜" value="${esc(s['날짜'])}" required>
        <input type="text" name="이름" list="ph-special-suggest" value="${esc(s['이름'])}" maxlength="40" required>
        <label class="ph-sub">예배 시간 <input type="text" name="예배시간" value="${esc(timeSettings.fmt(s['예배시간']))}" placeholder="예: 오후 5시" maxlength="20" style="width:9em;"></label>
        <label class="ph-sub">당일 리허설 시간 <input type="text" name="리허설시간" value="${esc(timeSettings.fmt(s['리허설시간']))}" placeholder="예: 오후 4시" maxlength="20" style="width:9em;"></label>
        <button class="ph-btn pri" type="submit">저장</button>
      </form>
      <form method="post" action="/events/delete" onsubmit="return confirm('${esc(s['이름'])}(${esc(s['날짜'])}) 표시를 지울까요? (콘티 내용 자체는 안 지워져요)')">
        <input type="hidden" name="__row" value="${s.__row}"><input type="hidden" name="team" value="${esc(team)}">
        <button class="ph-row-del" type="submit" style="width:100%;" title="삭제">${ui.icon('close')} 이 주일 외 찬양 삭제</button>
      </form>
    </details>` : ''}
  </div>`;
}

router.get('/events', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const today = week.todayStr();
  const list = await specialServices(team);
  const upcoming = list.filter((s) => s['날짜'] >= today);
  const past = list.filter((s) => s['날짜'] < today);

  const addForm = ctx.isAdmin ? `
    <details class="ph-add">
      <summary>+ 주일 외 서는 날 추가 (성탄절 · 송구영신예배 등)</summary>
      <form method="post" action="/events/add" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">
        <input type="date" name="날짜" required>
        <input type="text" name="이름" list="ph-special-suggest" placeholder="예: 성탄절 예배" maxlength="40" required>
        <label class="ph-sub">예배 시간 <input type="text" name="예배시간" placeholder="예: 오후 5시" maxlength="20" style="width:9em;"></label>
        <label class="ph-sub">당일 리허설 시간 <input type="text" name="리허설시간" placeholder="예: 오후 4시" maxlength="20" style="width:9em;"></label>
        <datalist id="ph-special-suggest">${SPECIAL_SERVICE_SUGGESTIONS.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
        <button class="ph-btn pri" type="submit">추가</button>
      </form>
    </details>` : '';

  const hero = pageShell.hero({ eyebrow: `${team} · 주일 외 찬양`, title: '주일 외 찬양', sub: '주일이 아닌 예배입니다. 주일과 똑같이 편성·콘티·악보를 준비합니다.' });

  const content = `
  ${pageShell.hubNav('events', team)}
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx, { keep: {} })}
    <h2 class="ph-h2">다가오는 주일 외 찬양</h2>
    <div class="ph-list">${upcoming.length ? upcoming.map((s) => eventItem(s, team, ctx.isAdmin)).join('') : '<p class="ph-sub">아직 등록된 날이 없어요. 성탄절·송구영신예배·특별새벽기도·부흥회·철야기도회 등을 추가해두면 그 날짜의 예배콘티로 바로 갈 수 있어요.</p>'}</div>
    ${addForm}
  </div>

  ${past.length ? `<div class="ph-card">
    <h2 class="ph-h2">지난 주일 외 찬양</h2>
    <div class="ph-list">${past.map((s) => eventItem(s, team, ctx.isAdmin)).join('')}</div>
  </div>` : ''}
  `;
  spa.send(req, res, content, { title: `${team} 주일 외 찬양` });
});

router.post('/events/add', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (!req.ctx.isAdmin) return backTo(req, res, team);
  const date = week.normalizeDate(b['날짜']);
  const name = String(b['이름'] || '').trim();
  const editRow = Number(b.__row) || 0;
  const tm = (v) => timeSettings.parse(v);
  const wt = tm(b['예배시간']), rt = tm(b['리허설시간']);
  if (date && name) {
    if (editRow) {
      // 기존 행사 수정 — 날짜라도 다른 행사와 같아질 수 있으므로 덮어쓰기(upsert)는 하지 않고 이 행만 바꿉니다.
      const rows = await sheetsDb.readAll('특별예배');
      const existing = rows.find((r) => r.__row === editRow && r['팀ID'] === team);
      if (existing) await sheetsDb.updateRow('특별예배', editRow, { ...existing, '날짜': date, '이름': name, '예배시간': wt, '리허설시간': rt });
    } else {
      // 새 행사 추가 — 같은 날짜에 주일예배와 행사가, 또는 행사가 여러 개 겹칠 수 있으므로 항상 새 행으로 추가합니다.
      await sheetsDb.appendRow('특별예배', { 'ID': 'S' + Date.now().toString(36), '팀ID': team, '날짜': date, '이름': name, '등록시각': new Date().toISOString(), '예배시간': wt, '리허설시간': rt });
    }
  }
  backTo(req, res, team);
});

router.post('/events/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (req.ctx.isAdmin) {
    const row = Number(b.__row);
    if (row) { try { await sheetsDb.deleteRow('특별예배', row); } catch (e) { console.error('[주일 외 찬양 삭제 실패]', e.message); } }
  }
  backTo(req, res, team);
});

module.exports = router;
