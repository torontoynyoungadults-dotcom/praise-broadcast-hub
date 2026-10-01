const express = require('express');
const multer = require('multer');
const { loginClient } = require('../lib/googleAuth');
const session = require('../lib/session');
const sheetsDb = require('../lib/sheetsDb');
const driveStore = require('../lib/driveStore');
const pageShell = require('../lib/pageShell');
const { ROLE_OPTIONS } = require('../lib/schema');

// defParamCharset: 'utf8' 중요 — 안 넣으면 한글 필드 이름(이름/전화번호/소속팀 등)이
// 깨진 채로 들어와서 req.body에서 값을 못 찾습니다 (busboy 기본값은 필드 이름을 latin1로 해석함).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  defParamCharset: 'utf8',
});
const router = express.Router();

function redirectUri() {
  const base = String(process.env.BASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('BASE_URL 환경변수가 필요합니다.');
  return base + '/auth/google/callback';
}

router.get('/auth/google', (req, res) => {
  try {
    const client = loginClient(redirectUri());
    const state = session.signState({ n: Math.random().toString(36).slice(2) });
    const url = client.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
    });
    res.redirect(url);
  } catch (e) {
    res.status(500).send('구글 로그인 설정이 아직 안 되어 있습니다: ' + e.message);
  }
});

router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?err=' + encodeURIComponent('구글 로그인이 취소되었습니다.'));
  if (!session.verifyState(String(state || ''))) return res.redirect('/?err=' + encodeURIComponent('로그인 시간이 지났습니다. 다시 시도해주세요.'));
  try {
    const client = loginClient(redirectUri());
    const { tokens } = await client.getToken(String(code || ''));
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_LOGIN_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email_verified) throw new Error('구글 계정의 이메일이 확인되지 않았습니다.');
    const email = String(payload.email).trim().toLowerCase();

    const member = await sheetsDb.findOne('회원', '이메일', email);
    if (member) {
      session.login(res, { email, name: member['이름'] });
      return res.redirect('/');
    }
    session.setPendingEmail(res, email);
    // 구글 계정의 이름·사진을 가입폼에 미리 채워줄 수 있게 짧게 전달
    const hint = encodeURIComponent(JSON.stringify({ name: payload.name || '', picture: payload.picture || '' }));
    res.redirect('/signup?hint=' + hint);
  } catch (e) {
    console.error('[구글 로그인 실패]', e.message);
    res.redirect('/?err=' + encodeURIComponent('구글 로그인에 실패했습니다. 다시 시도해주세요.'));
  }
});

router.get('/signup', async (req, res) => {
  const email = session.getPendingEmail(req);
  if (!email) return res.redirect('/');
  let hint = {};
  try { hint = JSON.parse(req.query.hint || '{}'); } catch (e) {}
  const teams = await sheetsDb.readAll('찬양팀');
  const teamOptions = teams.filter((t) => String(t['활성여부']).toUpperCase() !== 'FALSE')
    .map((t) => `<option value="${pageShell.esc(t['팀명'])}">${pageShell.esc(t['팀명'])}</option>`).join('')
    || '<option value="">(아직 등록된 찬양팀이 없습니다 — 관리자에게 문의해주세요)</option>';

  const hero = pageShell.hero({
    eyebrow: '첫 방문이시네요',
    title: '회원가입',
    sub: `${email} 계정으로 바로 가입하고 이용하실 수 있어요.`,
  });
  const content = `
  ${hero}
  <div class="ph-card">
    <form method="post" action="/signup" enctype="multipart/form-data">
      <div class="ph-field">
        <label>이름</label>
        <input type="text" name="이름" required value="${pageShell.esc(hint.name || '')}">
      </div>
      <div class="ph-field">
        <label>전화번호</label>
        <input type="tel" name="전화번호" id="ph-phone" required placeholder="416-777-1004" inputmode="numeric" maxlength="12">
      </div>
      <div class="ph-field">
        <label>소속 찬양팀</label>
        <select name="소속팀" required>${teamOptions}</select>
      </div>
      <div class="ph-field">
        <label>역할 (여러 개 선택 가능)</label>
        <div class="ph-chips">
          ${ROLE_OPTIONS.map((r, i) => `<label class="ph-chip"><input type="checkbox" name="역할" value="${r}"><span>${r}</span></label>`).join('')}
        </div>
      </div>
      <div class="ph-field">
        <label>프로필 사진 (선택)</label>
        <input type="file" name="프로필사진" accept="image/*">
      </div>
      <button class="ph-btn pri" type="submit">가입하고 시작하기</button>
      <p class="ph-msg err">${pageShell.esc(req.query.e || '')}</p>
    </form>
  </div>
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
  res.type('html').send(await pageShell.render(content, { title: '회원가입' }));
});

router.post('/signup', upload.single('프로필사진'), async (req, res) => {
  const email = session.getPendingEmail(req);
  if (!email) return res.redirect('/');
  const body = req.body || {};
  const name = String(body['이름'] || '').trim();
  const phone = String(body['전화번호'] || '').trim();
  const team = String(body['소속팀'] || '').trim();
  const roles = [].concat(body['역할'] || []).filter(Boolean);
  const missing = [];
  if (!name) missing.push('이름');
  if (!phone) missing.push('전화번호');
  if (!team) missing.push('소속 찬양팀');
  if (missing.length) {
    return res.redirect('/signup?e=' + encodeURIComponent(missing.join(' · ') + ' 칸이 비어 있어요. (' + missing.join(', ') + ')'));
  }
  let photoUrl = '';
  try { if (req.file) photoUrl = await driveStore.uploadPublic('프로필사진', req.file); }
  catch (e) { console.error('[프로필사진 업로드 실패]', e.message); }

  await sheetsDb.appendRow('회원', {
    'ID': 'U' + Date.now().toString(36),
    '이메일': email, '이름': name, '전화번호': phone, '소속팀': team,
    '역할': roles.join(','), '프로필사진': photoUrl, '관리자여부': 'FALSE',
    '가입일': new Date().toISOString().slice(0, 10),
  });
  session.clearPendingEmail(res);
  session.login(res, { email, name });
  res.redirect('/');
});

router.get('/logout', (req, res) => { session.logout(res); res.redirect('/'); });

module.exports = router;
