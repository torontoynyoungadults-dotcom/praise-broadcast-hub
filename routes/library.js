/**
 * 라이브러리 — church-app(청년부 앱) 찬양 허브의 "라이브러리" 탭을 그대로 (곡 · 악보 / 날짜별 / 악보 파일 / 녹음 / 통계).
 * 화면은 church-app 코드(public/hub/*), 서버 함수는 lib/hubApi.js. 이 파일은 화면 틀만 엽니다.
 *   /library?v=repo|date|file|rec|stats   (기본: 곡 · 악보)
 */
const express = require('express');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const hubPage = require('../lib/hubPage');

const router = express.Router();

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length) {
    return spa.send(req, res,
      `${pageShell.hubNav('library', '')}<div class="ph-card"><p class="ph-sub">아직 소속된 찬양팀이 없어요. 관리자에게 문의해주세요.</p><a class="ph-btn" href="/">← 허브로</a></div>`,
      { title: '라이브러리' },
    );
  }
  req.ctx = ctx;
  next();
}

const VIEWS = { repo: ['repo', ''], date: ['archive', 'date'], file: ['archive', 'file'], rec: ['archive', 'rec'], song: ['archive', 'song'], stats: ['stats', ''] };

router.get('/library', requireTeam, async (req, res) => {
  const team = req.ctx.current;
  const [tab, view] = VIEWS[String(req.query.v || '')] || VIEWS.repo;
  await hubPage.send(req, res, {
    nav: 'library', tab, view, title: `${team} 라이브러리`,
    hero: { eyebrow: `${team} · 라이브러리`, title: '라이브러리', sub: '곡 · 악보 · 지난 콘티 · 녹음 · 통계를 한곳에서' },
  });
});

module.exports = router;
