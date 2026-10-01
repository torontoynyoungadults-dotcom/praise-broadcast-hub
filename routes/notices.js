/**
 * 공지 및 모임 — church-app의 "공지사항"에 "토요모임"의 기도제목 나누기 기능을 흡수해서 하나로 합침.
 * (행사 탭 · 토요모임의 나머지 기능은 사용자 요청으로 제외)
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');

const ui = require('../lib/uiIcons');
const honorific = require('../lib/honorific');
const router = express.Router();
const esc = pageShell.esc;

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length) return res.redirect('/');
  req.ctx = ctx;
  next();
}

function backTo(req, res, team, filter) {
  spa.redirect(req, res, `/notices?team=${encodeURIComponent(team)}${filter ? `&filter=${encodeURIComponent(filter)}` : ''}`);
}

function item(n) {
  const kindChip = n['구분'] === '기도제목' ? `${ui.icon('pray')} 기도제목` : `${ui.icon('bell')} 공지`;
  return `<div class="ph-list-item ph-notice${String(n['고정']).toUpperCase() === 'TRUE' ? ' pinned' : ''}">
    <div class="ph-li-main">
      <div class="ph-li-sub">${kindChip}${String(n['고정']).toUpperCase() === 'TRUE' ? ' · 고정' : ''}</div>
      ${n['제목'] ? `<div class="ph-li-title">${esc(n['제목'])}</div>` : ''}
      <div class="ph-li-note" style="white-space:pre-wrap;">${esc(n['내용'])}</div>
      <div class="ph-li-sub" style="margin-top:6px;">${esc(honorific.forTeam(n['팀ID'], n['올린사람'] || ''))}</div>
    </div>
    <div class="ph-row-actions">
      <form method="post" action="/notices/pin">
        <input type="hidden" name="__row" value="${n.__row}"><input type="hidden" name="team" value="${esc(n['팀ID'])}">
        <input type="hidden" name="to" value="${String(n['고정']).toUpperCase() === 'TRUE' ? '' : 'TRUE'}">
        <button class="ph-row-del" type="submit" title="고정" aria-label="고정">${ui.icon('pin', String(n['고정']).toUpperCase() === 'TRUE' ? 'on' : '')}</button>
      </form>
      <form method="post" action="/notices/delete" onsubmit="return confirm('삭제할까요?')">
        <input type="hidden" name="__row" value="${n.__row}"><input type="hidden" name="team" value="${esc(n['팀ID'])}">
        <button class="ph-row-del" type="submit" title="삭제" aria-label="삭제">${ui.icon('close')}</button>
      </form>
    </div>
  </div>`;
}

router.get('/notices', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  await honorific.prime(team);
  const filter = ['공지', '기도제목'].includes(req.query.filter) ? req.query.filter : '';
  const all = (await sheetsDb.readAll('공지및모임')).filter((r) => r['팀ID'] === team);
  const list = (filter ? all.filter((r) => r['구분'] === filter) : all)
    .sort((a, b) => {
      const ap = String(a['고정']).toUpperCase() === 'TRUE' ? 1 : 0, bp = String(b['고정']).toUpperCase() === 'TRUE' ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return String(b['올린시각']).localeCompare(String(a['올린시각']));
    });

  const hero = pageShell.hero({ eyebrow: `${team} · 공지 및 모임`, title: '공지 및 모임', sub: '공지사항과 기도제목을 함께 나눠요.' });
  const tab = (key, label) => `<a class="pv-tab${filter === key ? ' on' : ''}" href="/notices?team=${encodeURIComponent(team)}${key ? `&filter=${encodeURIComponent(key)}` : ''}">${label}</a>`;

  const content = `
  ${pageShell.hubNav('notices', team)}
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx, { keep: { filter } })}
    <div class="pv-songtabs" style="margin-bottom:0;">${tab('', '전체')}${tab('공지', '공지')}${tab('기도제목', '기도제목')}</div>
  </div>

  <div class="ph-card top-accent">
    <div class="ph-list">${list.length ? list.map(item).join('') : '<p class="ph-sub">아직 올라온 글이 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 새로 쓰기</summary>
      <form method="post" action="/notices" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">
        <select name="구분"><option value="공지">공지</option><option value="기도제목">기도제목</option></select>
        <input type="text" name="제목" placeholder="제목 (선택)">
        <textarea name="내용" rows="3" placeholder="내용을 적어주세요" required style="width:100%;padding:10px 13px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg-2);color:var(--ink);font-size:15px;font-family:inherit;"></textarea>
        <button class="ph-btn pri" type="submit">올리기</button>
      </form>
    </details>
  </div>
  `;
  spa.send(req, res, content, { title: `${team} 공지 및 모임` });
});

router.post('/notices', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const content = String(b['내용'] || '').trim();
  if (content) {
    await sheetsDb.appendRow('공지및모임', {
      'ID': 'N' + Date.now().toString(36), '팀ID': team, '구분': b['구분'] === '기도제목' ? '기도제목' : '공지',
      '제목': b['제목'] || '', '내용': content, '고정': 'FALSE',
      '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
    });
  }
  backTo(req, res, team);
});

router.post('/notices/pin', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) {
    const rows = await sheetsDb.readAll('공지및모임');
    const found = rows.find((r) => r.__row === row);
    if (found) await sheetsDb.updateRow('공지및모임', row, { ...found, '고정': b.to === 'TRUE' ? 'TRUE' : 'FALSE' });
  }
  backTo(req, res, b.team);
});

router.post('/notices/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('공지및모임', row); } catch (e) { console.error('[공지삭제 실패]', e.message); } }
  backTo(req, res, b.team);
});

module.exports = router;
