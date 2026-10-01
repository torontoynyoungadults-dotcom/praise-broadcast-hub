const express = require('express');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');

const router = express.Router();

router.get('/', async (req, res) => {
  if (!req.session) {
    const err = req.query.err ? `<p class="ph-msg err">${pageShell.esc(req.query.err)}</p>` : '';
    const hero = pageShell.hero({
      eyebrow: 'TORONTO · 찬양방송팀',
      title: '찬양방송팀 허브',
      sub: '구글 계정으로 로그인하면 소속 찬양팀의 콘티 · 공지 · 스케줄 · 라이브러리를 볼 수 있어요.',
    });
    const content = `
    ${hero}
    <div class="ph-card">
      <a class="ph-btn pri" href="/auth/google">Google로 로그인</a>
      ${err}
    </div>`;
    return res.type('html').send(await pageShell.render(content, { title: '찬양방송팀 허브' }));
  }

  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  const { isAdmin, roles, current: team } = ctx;

  const hero = pageShell.hero({
    eyebrow: isAdmin ? '관리자' : (roles.join(' · ') || '팀원'),
    title: `${team || '찬양팀'} 허브`,
    sub: '예배 콘티 · 공지 · 스케줄 · 라이브러리를 한곳에서',
  });
  const content = `
  ${pageShell.hubNav('', team)}
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx)}
    <p class="ph-sub">위 메뉴를 눌러 예배 콘티 · 공지 및 모임 · 스케줄표 · 라이브러리 · 장비 · 수리를 오갈 수 있어요.</p>
  </div>
  <div class="ph-card">
    <a class="ph-btn" href="/logout">로그아웃</a>
  </div>`;
  spa.send(req, res, content, { title: `${team || '찬양팀'} 허브` });
});

// /admin 은 routes/admin.js 가 맡습니다 (찬양팀 · 멤버 · 태그라인 관리).

module.exports = router;
