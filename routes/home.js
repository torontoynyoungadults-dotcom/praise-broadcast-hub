const express = require('express');
const pageShell = require('../lib/pageShell');
const sheetsDb = require('../lib/sheetsDb');

const router = express.Router();

router.get('/', async (req, res) => {
  if (!req.session) {
    const err = req.query.err ? `<p class="ph-msg err">${pageShell.esc(req.query.err)}</p>` : '';
    const content = `
    <div class="ph-card">
      <h1 class="ph-h1">찬양방송팀 허브</h1>
      <p class="ph-sub">구글 계정으로 로그인하면 소속 찬양팀의 콘티 · 공지 · 스케줄 · 라이브러리를 볼 수 있어요.</p>
      <a class="ph-btn pri" href="/auth/google">Google로 로그인</a>
      ${err}
    </div>`;
    return res.type('html').send(await pageShell.render(content, { title: '찬양방송팀 허브' }));
  }

  const member = await sheetsDb.findOne('회원', '이메일', req.session.email);
  if (!member) {
    // 세션은 있지만 명부에서 지워진 경우 등 — 다시 로그인하게 합니다
    return res.redirect('/logout');
  }
  const isAdmin = String(member['관리자여부']).toUpperCase() === 'TRUE';
  const teams = String(member['소속팀'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const roles = String(member['역할'] || '').split(',').map((s) => s.trim()).filter(Boolean);

  const content = `
  <div class="ph-card">
    <h1 class="ph-h1">${pageShell.esc(teams[0] || '찬양팀')} 허브</h1>
    <p class="ph-sub">${pageShell.esc(member['이름'])}님, 환영합니다! (${pageShell.esc(roles.join(' · ') || '역할 미지정')})</p>
    <p class="ph-sub">예배콘티 · 공지및모임 · 스케줄표 · 라이브러리 · 장비·수리는 다음 단계에서 이어서 만듭니다. 지금은 로그인/가입 골격이 동작하는 것만 확인하는 단계예요.</p>
    ${isAdmin ? '<a class="ph-btn" href="/admin">관리자 화면</a>' : ''}
    <a class="ph-btn" href="/logout">로그아웃</a>
  </div>`;
  res.type('html').send(await pageShell.render(content, { title: `${teams[0] || '찬양팀'} 허브` }));
});

router.get('/admin', async (req, res) => {
  if (!req.session) return res.redirect('/');
  const member = await sheetsDb.findOne('회원', '이메일', req.session.email);
  if (!member || String(member['관리자여부']).toUpperCase() !== 'TRUE') return res.redirect('/');
  const content = `
  <div class="ph-card">
    <h1 class="ph-h1">관리자</h1>
    <p class="ph-sub">찬양팀 추가/제거 · 멤버 관리 · 드라이브 설정 화면은 다음 단계에서 만듭니다.</p>
    <a class="ph-btn" href="/">← 허브로</a>
  </div>`;
  res.type('html').send(await pageShell.render(content, { title: '관리자' }));
});

module.exports = router;
