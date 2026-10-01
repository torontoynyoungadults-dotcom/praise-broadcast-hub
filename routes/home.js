const express = require('express');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');

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
  const { member, isAdmin, roles, current: team } = ctx;

  const hero = pageShell.hero({
    eyebrow: isAdmin ? '관리자' : (roles.join(' · ') || '팀원'),
    title: `${team || '찬양팀'} 허브`,
    sub: `${member['이름']}님, 환영합니다!`,
  });
  const navLink = (href, label, ready) => ready
    ? `<a class="ph-btn" href="${href}">${label}</a>`
    : `<span class="ph-btn" style="opacity:.45;pointer-events:none;">${label} (준비중)</span>`;
  const content = `
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx)}
    <div class="ph-navgrid">
      ${navLink(`/conti?team=${encodeURIComponent(team)}`, '🎵 예배콘티', true)}
      ${navLink(`/notices?team=${encodeURIComponent(team)}`, '📋 공지 및 모임', true)}
      ${navLink(`/schedule?team=${encodeURIComponent(team)}`, '🗓 스케줄표', true)}
      ${navLink(`/library?team=${encodeURIComponent(team)}`, '🗂 라이브러리', true)}
      ${navLink(`/equipment?team=${encodeURIComponent(team)}`, '🔧 장비·수리', true)}
    </div>
  </div>
  <div class="ph-card">
    ${isAdmin ? '<a class="ph-btn" href="/admin">관리자 화면</a>' : ''}
    <a class="ph-btn" href="/logout">로그아웃</a>
  </div>`;
  res.type('html').send(await pageShell.render(content, { title: `${team || '찬양팀'} 허브` }));
});

// /admin 은 routes/admin.js 가 맡습니다 (찬양팀 · 멤버 · 태그라인 관리).

module.exports = router;
