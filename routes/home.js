const express = require('express');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const ui = require('../lib/uiIcons');

const router = express.Router();

router.get('/', async (req, res) => {
  if (!req.session) {
    const err = req.query.err ? `<p class="ph-msg err">${pageShell.esc(req.query.err)}</p>` : '';
    const hero = pageShell.hero({
      eyebrow: '토론토영락교회',
      title: 'YN 3부찬양팀 허브',
      sub: '구글 계정으로 로그인하면 소속 찬양팀의 콘티 · 공지 · 스케줄 · 라이브러리를 볼 수 있어요.',
    });
    const content = `
    ${hero}
    <div class="ph-card">
      <a class="ph-btn pri" href="/auth/google">Google로 로그인</a>
      ${err}
    </div>`;
    return res.type('html').send(await pageShell.render(content, { title: 'YN 3부찬양팀 허브' }));
  }

  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  const { isAdmin, roles, current: team } = ctx;

  // V13 홈 — 로그인하면 먼저 "이번 주 나의 일정 + 바로가기"를 보여 줌 (예전처럼 바로 예배 콘티로: ?go=conti)
  if (team && ctx.teams.length) {
    const q = req.query.team && ctx.teams.includes(String(req.query.team)) ? `?team=${encodeURIComponent(String(req.query.team))}` : '';
    if (req.query.go === 'conti') return spa.redirect(req, res, '/conti' + q);
    const name = String((ctx.member && ctx.member['이름']) || '').trim();
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dateKo = `${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}요일`;
    const greet = now.getDay() === 0 || now.getDay() === 6 ? '평안한 주말 보내세요' : '평안한 한 주 보내세요';
    const qs = q || (team ? `?team=${encodeURIComponent(team)}` : '');
    const tile = (href, title, sub, icon) => `<a class="hm-tile" href="${href}${qs}">${ui.icon(icon)}<span><b>${pageShell.esc(title)}</b><small>${pageShell.esc(sub)}</small></span></a>`;
    const hero = pageShell.hero({ eyebrow: dateKo, title: `${name}님,`, sub: greet });
    const content = `
  ${pageShell.hubNav('', team)}
  ${hero}
  <section class="hm-go" aria-label="바로가기">
    ${tile('/conti', '예배 콘티', '이번 주일 콘티 · 라이브 악보', 'music')}
    ${tile('/practice-conti', '연습 콘티', '금요일 연습 · 함께 연습하는 주일', 'calendar')}
    ${tile('/schedule', '스케줄표', '내가 서는 날 · 안 되는 날', 'calendar')}
    ${tile('/library', '라이브러리', '곡 · 악보 · 녹음 · 통계', 'page')}
    ${tile('/events', '주일 외 찬양', '성탄절 · 송구영신 · 특별 예배', 'star')}
  </section>
  <a class="hm-cta" href="/conti${qs}"><span><small>이번 주일</small>예배 콘티 보기</span>${ui.icon('next')}</a>`;
    // TODO(redesign): 다음 섬김 D-day · 준비 체크(콘티·악보·연습·곡 듣기) · 안 되는 날 빠르게 알리기 · 팀 소식
    return spa.send(req, res, content, { title: 'YN 3부찬양팀 허브' });
  }

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
