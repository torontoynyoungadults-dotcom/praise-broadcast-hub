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
const { ROLE_OPTIONS } = require('../lib/schema');
const ui = require('../lib/uiIcons');

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

function roleChips(myRoles) {
  return `<div class="ph-chips">${ROLE_OPTIONS.map((r) => `<label class="ph-chip"><input type="checkbox" name="역할" value="${r}"${myRoles.includes(r) ? ' checked' : ''}><span>${avatar.roleIcon(r)} ${r}</span></label>`).join('')}</div>`;
}

function personRow(name, info, isAdmin) {
  const myRoles = String(info.역할 || '').split(',').map((s) => s.trim()).filter(Boolean);
  const isPastor = myRoles.includes('목회자');
  const nameHtml = `${esc(name)}${isPastor ? '<small>목사님</small>' : ''}`;
  const status = info.가입
    ? `<span class="ph-rr-st ok" title="가입완료">${ui.icon('check')}<i>가입</i></span>`
    : '<span class="ph-rr-st wait" title="가입 대기중"><i>대기</i></span>';
  const roles = myRoles.length
    ? `<span class="ph-rr-roles">${myRoles.map((r) => `<span class="ph-roletag">${avatar.roleIcon(r)}<i>${esc(r)}</i></span>`).join('')}</span>`
    : '<span class="ph-rr-roles empty">역할 없음</span>';
  const row = `${avatar.avatarHtml(name, info, 'md')}
      <span class="ph-rr-name">${nameHtml}</span>
      ${roles}
      ${status}`;
  let editForm = '';
  if (isAdmin && info.가입) {
    // 이미 가입한 사람은 사진·성별은 본인이 직접 수정하고(내 정보), 관리자는 역할만 여기서 정해줄 수 있음.
    editForm = `
      <form method="post" action="/roster/member-role" class="ph-inlineform">
        <input type="hidden" name="__row" value="${info.가입행}">
        <input type="hidden" name="team" value="${esc(info.__team || '')}">
        <label>역할 (여러 개 가능)</label>
        ${roleChips(myRoles)}
        <button class="ph-btn pri" type="submit">저장</button>
      </form>
      ${info.명단행 ? `<form method="post" action="/roster/delete" onsubmit="return confirm('명단에서 ${esc(name)}님을 뺄까요? (이미 가입한 사람은 가입이 취소되지 않아요)')">
        <input type="hidden" name="__row" value="${info.명단행}"><input type="hidden" name="team" value="${esc(info.__team || '')}">
        <button class="ph-btn" type="submit" style="margin-top:6px;">명단에서 빼기</button>
      </form>` : ''}`;
  } else if (isAdmin && info.명단행) {
    // 아직 가입 전인 사람 — 관리자가 성별·사진·역할을 전부 미리 정해둘 수 있음(가입하면 역할은 그대로 물려받음).
    editForm = `
      <form method="post" action="/roster/update" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="__row" value="${info.명단행}">
        <input type="hidden" name="team" value="${esc(info.__team || '')}">
        <label>성별</label>
        <div class="ph-chips">
          <label class="ph-chip"><input type="radio" name="성별" value="남"${info.성별 === '남' ? ' checked' : ''}><span>남</span></label>
          <label class="ph-chip"><input type="radio" name="성별" value="여"${info.성별 === '여' ? ' checked' : ''}><span>여</span></label>
        </div>
        <label>역할 (여러 개 가능)</label>
        ${roleChips(myRoles)}
        <label>사진 교체 (선택)</label>
        <input type="file" name="사진" accept="image/*">
        <button class="ph-btn pri" type="submit">저장</button>
      </form>
      <form method="post" action="/roster/delete" onsubmit="return confirm('명단에서 ${esc(name)}님을 뺄까요?')">
        <input type="hidden" name="__row" value="${info.명단행}"><input type="hidden" name="team" value="${esc(info.__team || '')}">
        <button class="ph-btn" type="submit" style="margin-top:6px;">명단에서 빼기</button>
      </form>`;
  }
  // 한 줄 — 사진 · 이름 · 역할 · 가입여부 · 수정 단추. 관리자는 줄을 누르면 아래로 수정 칸이 펼쳐짐.
  if (editForm) {
    return `<details class="ph-rr ph-rosteritem">
      <summary>${row}<span class="ph-rr-edit" aria-label="수정">${ui.icon('pencil')}</span></summary>
      <div class="ph-rr-form">${editForm}</div>
    </details>`;
  }
  return `<div class="ph-rr ph-rosteritem"><div class="ph-rr-line">${row}</div></div>`;
}

router.get('/roster', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const infoMap = await avatar.teamInfoMap(team);
  const rosterCount = Object.values(infoMap).filter((i) => i.명단행).length;

  const names = Object.keys(infoMap).sort((a, b) => a.localeCompare(b, 'ko')); // 가나다 순

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
        <label>역할 (여러 개 가능 — 나중에 가입할 때 본인이 따로 고르지 않으면 이 값을 그대로 물려받아요)</label>
        ${roleChips([])}
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
    <p class="ph-sub" style="margin:0 0 ${ctx.isAdmin ? '4px' : '0'};">회원가입 때 적은 이름이 이 명단과 같아야 가입이 돼요${rosterCount ? '' : ' (이 팀은 아직 명단이 없어서 지금은 누구나 가입할 수 있어요)'}.</p>
    ${addForm}
  </div>

  <div class="ph-card top-accent">
    <h2 class="ph-h2">팀원 (${names.length}명)</h2>
    <div class="ph-rrlist">${names.length ? names.map((n) => personRow(n, { ...infoMap[n], __team: team }, ctx.isAdmin)).join('') : '<p class="ph-sub">아직 등록된 팀원이 없어요.</p>'}</div>
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
  const roles = [].concat(b['역할'] || []).filter(Boolean);
  let photoUrl = '';
  try { if (req.file) photoUrl = await driveStore.uploadPublic('팀원사진', req.file); } catch (e) { console.error('[팀원사진 업로드 실패]', e.message); }
  await sheetsDb.appendRow('팀원명단', {
    'ID': 'M' + Date.now().toString(36), '팀ID': team, '이름': name, '성별': gender, '사진': photoUrl,
    '등록시각': new Date().toISOString(), '역할': roles.join(','),
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
      const roles = [].concat(b['역할'] || []).filter(Boolean);
      await sheetsDb.updateRow('팀원명단', row, { ...found, '성별': gender, '사진': photoUrl, '역할': roles.join(',') });
    }
  }
  backTo(req, res, team);
});

// 이미 가입한 사람의 역할만 관리자가 여기서 바로 정해줄 수 있게(사진·성별은 본인이 /profile에서 직접 관리).
router.post('/roster/member-role', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (!req.ctx.isAdmin) return backTo(req, res, team);
  const row = Number(b.__row);
  if (row) {
    const rows = await sheetsDb.readAll('회원');
    const found = rows.find((r) => r.__row === row);
    if (found) {
      const roles = [].concat(b['역할'] || []).filter(Boolean);
      await sheetsDb.updateRow('회원', row, { ...found, '역할': roles.join(',') });
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
