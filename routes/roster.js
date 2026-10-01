/**
 * 팀원관리 — 관리자가 "이 팀에 있어야 할 사람" 명단(팀원명단 시트)을 미리 적어 두는 화면.
 * 회원가입 때 적은 이름이 이 명단(같은 팀)과 같으면 바로 팀원으로 받아들여지고(routes/auth.js),
 * 다르면 가입이 막힙니다 — 그래서 이 화면이 그 "허락 명단"을 관리하는 곳입니다.
 * 팀원 전체(가입했든 아직 안 했든)를 아이콘(성별)+사진+이름으로 한눈에 봄 — 관리자만 추가/수정/삭제 가능.
 */
const express = require('express');
const upload = require('../lib/upload');
const sheetsDb = require('../lib/sheetsDb');
const driveStore = require('../lib/driveStore');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const avatar = require('../lib/avatar');

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

function backTo(req, res, team) { spa.redirect(req, res, `/roster?team=${encodeURIComponent(team)}`); }

function personRow(name, info, rosterRow, isAdmin) {
  const statusChip = info.가입 ? '<span class="ph-badge" style="margin:0;">가입완료</span>' : '<span class="ph-badge" style="margin:0;background:var(--glass-2);color:var(--dim);border-color:var(--line);">가입 대기중</span>';
  const adminForm = (isAdmin && rosterRow) ? `
    <details class="ph-row-edit">
      <summary>⋯</summary>
      <form method="post" action="/roster/update" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="__row" value="${rosterRow}">
        <input type="hidden" name="team" value="${esc(info.__team || '')}">
        <label>성별</label>
        <div class="ph-chips">
          <label class="ph-chip"><input type="radio" name="성별" value="남"${info.성별 === '남' ? ' checked' : ''}><span>남</span></label>
          <label class="ph-chip"><input type="radio" name="성별" value="여"${info.성별 === '여' ? ' checked' : ''}><span>여</span></label>
        </div>
        <label>사진 교체 (선택)</label>
        <input type="file" name="사진" accept="image/*">
        <button class="ph-btn pri" type="submit">저장</button>
      </form>
      <form method="post" action="/roster/delete" onsubmit="return confirm('명단에서 ${esc(name)}님을 뺄까요? (이미 가입한 사람은 가입이 취소되지 않아요)')">
        <input type="hidden" name="__row" value="${rosterRow}"><input type="hidden" name="team" value="${esc(info.__team || '')}">
        <button class="ph-btn" type="submit" style="margin-top:6px;">명단에서 빼기</button>
      </form>
    </details>` : '';
  return `<div class="ph-list-item ph-rosteritem">
    <div class="ph-li-main" style="display:flex;align-items:center;gap:12px;">
      ${avatar.avatarHtml(name, info, 'lg')}
      <div>
        <div class="ph-li-title">${esc(name)}</div>
        <div class="ph-li-sub" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;">${statusChip}</div>
      </div>
    </div>
    ${adminForm}
  </div>`;
}

router.get('/roster', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const [infoMap, rosterRows] = await Promise.all([
    avatar.teamInfoMap(team),
    sheetsDb.readAll('팀원명단'),
  ]);
  const myRosterRows = rosterRows.filter((r) => r['팀ID'] === team);
  const rowByName = {};
  myRosterRows.forEach((r) => { rowByName[r['이름']] = r.__row; });

  const names = Object.keys(infoMap).sort((a, b) => {
    const ai = infoMap[a], bi = infoMap[b];
    if (ai.가입 !== bi.가입) return ai.가입 ? -1 : 1; // 가입완료 먼저
    return a.localeCompare(b, 'ko');
  });

  const hero = pageShell.hero({ eyebrow: `${team} · 팀원관리`, title: '팀원관리', sub: '팀원 명단을 관리하고, 가입 현황을 한눈에 봐요.' });
  const addForm = ctx.isAdmin ? `
    <details class="ph-add">
      <summary>+ 팀원 추가 (명단에 미리 등록)</summary>
      <form method="post" action="/roster/add" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">
        <input type="text" name="이름" placeholder="한글 3글자 이름 (예: 홍길동)" maxlength="3" required>
        <div class="ph-chips">
          <label class="ph-chip"><input type="radio" name="성별" value="남" required><span>남</span></label>
          <label class="ph-chip"><input type="radio" name="성별" value="여" required><span>여</span></label>
        </div>
        <input type="file" name="사진" accept="image/*">
        <button class="ph-btn pri" type="submit">명단에 추가</button>
        <p class="ph-msg err">${esc(req.query.e || '')}</p>
      </form>
    </details>` : '';

  const content = `
  ${pageShell.hubNav('roster', team)}
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx, {})}
    <p class="ph-sub" style="margin:0 0 ${ctx.isAdmin ? '4px' : '0'};">회원가입 때 적은 이름이 이 명단과 같아야 가입이 돼요${myRosterRows.length ? '' : ' (이 팀은 아직 명단이 없어서 지금은 누구나 가입할 수 있어요)'}.</p>
    ${addForm}
  </div>

  <div class="ph-card top-accent">
    <h2 class="ph-h2">팀원 (${names.length}명)</h2>
    <div class="ph-list">${names.length ? names.map((n) => personRow(n, { ...infoMap[n], __team: team }, rowByName[n], ctx.isAdmin)).join('') : '<p class="ph-sub">아직 등록된 팀원이 없어요.</p>'}</div>
  </div>
  `;
  spa.send(req, res, content, { title: `${team} 팀원관리` });
});

router.post('/roster/add', requireTeam, upload.single('사진'), async (req, res) => {
  if (!req.ctx.isAdmin) return backTo(req, res, (req.body || {}).team);
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const name = String(b['이름'] || '').trim();
  const gender = String(b['성별'] || '').trim();
  if (!team) return res.redirect('/roster');
  if (!/^[가-힣]{3}$/.test(name)) return res.redirect(`/roster?team=${encodeURIComponent(team)}&e=${encodeURIComponent('이름은 한글 3글자로 적어주세요 (예: 홍길동).')}`);
  if (!['남', '여'].includes(gender)) return res.redirect(`/roster?team=${encodeURIComponent(team)}&e=${encodeURIComponent('성별을 선택해주세요.')}`);
  const dup = (await sheetsDb.readAll('팀원명단')).find((r) => r['팀ID'] === team && r['이름'] === name);
  if (dup) return res.redirect(`/roster?team=${encodeURIComponent(team)}&e=${encodeURIComponent(`'${name}'님은 이미 명단에 있어요.`)}`);
  let photoUrl = '';
  try { if (req.file) photoUrl = await driveStore.uploadPublic('팀원사진', req.file); } catch (e) { console.error('[팀원사진 업로드 실패]', e.message); }
  await sheetsDb.appendRow('팀원명단', {
    'ID': 'M' + Date.now().toString(36), '팀ID': team, '이름': name, '성별': gender, '사진': photoUrl,
    '등록시각': new Date().toISOString(),
  });
  backTo(req, res, team);
});

router.post('/roster/update', requireTeam, upload.single('사진'), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (!req.ctx.isAdmin) return backTo(req, res, team);
  const row = Number(b.__row);
  if (row) {
    const rows = await sheetsDb.readAll('팀원명단');
    const found = rows.find((r) => r.__row === row);
    if (found) {
      let photoUrl = found['사진'] || '';
      try { if (req.file) photoUrl = await driveStore.uploadPublic('팀원사진', req.file); } catch (e) { console.error('[팀원사진 업로드 실패]', e.message); }
      const gender = ['남', '여'].includes(b['성별']) ? b['성별'] : found['성별'];
      await sheetsDb.updateRow('팀원명단', row, { ...found, '성별': gender, '사진': photoUrl });
    }
  }
  backTo(req, res, team);
});

router.post('/roster/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (!req.ctx.isAdmin) return backTo(req, res, team);
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('팀원명단', row); } catch (e) { console.error('[팀원명단 삭제 실패]', e.message); } }
  backTo(req, res, team);
});

module.exports = router;
