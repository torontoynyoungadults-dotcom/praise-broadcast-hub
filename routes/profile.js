/**
 * 내 정보 수정 — 본인이 직접 전화번호·성별·프로필사진·역할을 고칠 수 있는 화면.
 * 이름·소속팀은 여기서 못 바꿉니다: 이름은 찬양편성·불가일정·콘티댓글·악보필기·공지 등 여러 시트에서
 * "그 사람"을 가리키는 키로 그대로 쓰이고 있어서(별도 ID로 연결돼 있지 않음) 스스로 바꾸면 과거 기록이
 * 전부 어긋나 버립니다 — 이름을 꼭 바꿔야 하면 관리자에게 요청해서 시트에서 직접 고쳐야 합니다.
 * 소속팀도 팀원 명단(화이트리스트)과 맞물려 있어 관리자(/admin)가 관리합니다.
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

const router = express.Router();
const esc = pageShell.esc;

async function requireLogin(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  req.ctx = ctx;
  next();
}

router.get('/profile', requireLogin, async (req, res) => {
  const ctx = req.ctx;
  const m = ctx.member;
  const myRoles = String(m['역할'] || '').split(',').map((s) => s.trim()).filter(Boolean);

  const hero = pageShell.hero({ eyebrow: '내 정보', title: '내 정보 수정', sub: '전화번호·성별·사진·역할을 직접 고칠 수 있어요.' });
  const content = `
  ${pageShell.hubNav('', ctx.current)}
  ${hero}
  <div class="ph-card">
    <div class="ph-field">
      <label>이름 · 소속팀 (변경 필요하면 관리자에게 문의)</label>
      <div class="ph-li-main" style="display:flex;align-items:center;gap:12px;">
        ${avatar.avatarHtml(m['이름'], { 사진: m['프로필사진'], 성별: m['성별'] }, 'lg')}
        <div>
          <div class="ph-li-title">${esc(m['이름'])}</div>
          <div class="ph-li-sub">${esc(ctx.teams.join(' · ') || m['소속팀'])}</div>
        </div>
      </div>
    </div>
    <form method="post" action="/profile" enctype="multipart/form-data">
      <div class="ph-field">
        <label>성별</label>
        <div class="ph-chips">
          <label class="ph-chip"><input type="radio" name="성별" value="남"${m['성별'] === '남' ? ' checked' : ''} required><span>남</span></label>
          <label class="ph-chip"><input type="radio" name="성별" value="여"${m['성별'] === '여' ? ' checked' : ''} required><span>여</span></label>
        </div>
      </div>
      <div class="ph-field">
        <label>전화번호</label>
        <input type="tel" name="전화번호" id="ph-phone" required value="${esc(m['전화번호'] || '')}" placeholder="416-777-1004" inputmode="numeric" maxlength="12">
      </div>
      <div class="ph-field">
        <label>역할 (여러 개 가능)</label>
        <div class="ph-chips">${ROLE_OPTIONS.map((r) => `<label class="ph-chip"><input type="checkbox" name="역할" value="${r}"${myRoles.includes(r) ? ' checked' : ''}><span>${avatar.roleIcon(r)} ${r}</span></label>`).join('')}</div>
      </div>
      <div class="ph-field">
        <label>프로필 사진 교체 (선택)</label>
        <input type="file" name="프로필사진" accept="image/*">
      </div>
      <button class="ph-btn pri" type="submit">저장</button>
      <p class="ph-msg ${req.query.ok ? '' : 'err'}">${esc(req.query.ok ? '저장했어요.' : (req.query.e || ''))}</p>
    </form>
  </div>
  <div class="ph-card"><a class="ph-btn" href="/">← 허브로</a></div>
  <script>
    (function () {
      var el = document.getElementById('ph-phone');
      if (!el) return;
      el.addEventListener('input', function () {
        var d = el.value.replace(/\\D/g, '').slice(0, 10);
        var out = d;
        if (d.length > 6) out = d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
        else if (d.length > 3) out = d.slice(0, 3) + '-' + d.slice(3);
        el.value = out;
      });
    })();
  </script>`;
  spa.send(req, res, content, { title: '내 정보 수정' });
});

router.post('/profile', requireLogin, upload.single('프로필사진'), async (req, res) => {
  const m = req.ctx.member;
  const b = req.body || {};
  const gender = String(b['성별'] || '').trim();
  const phone = String(b['전화번호'] || '').trim();
  const roles = [].concat(b['역할'] || []).filter(Boolean);
  if (!['남', '여'].includes(gender) || !phone) {
    return res.redirect('/profile?e=' + encodeURIComponent('성별과 전화번호는 꼭 입력해주세요.'));
  }
  let photoUrl = m['프로필사진'] || '';
  try { if (req.file) photoUrl = await driveStore.uploadPublic('프로필사진', req.file); }
  catch (e) { console.error('[프로필사진 업로드 실패]', e.message); }

  await sheetsDb.updateRow('회원', m.__row, {
    ...m, '성별': gender, '전화번호': phone, '역할': roles.join(','), '프로필사진': photoUrl,
  });
  res.redirect('/profile?ok=1');
});

module.exports = router;
