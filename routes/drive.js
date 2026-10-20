/**
 * 미디어팀 NAS(Synology) — 예전에 콘티에 연결해 둔 "음원" 녹음을 재생하는 길만 남겨 둡니다.
 *   GET /drive/file?p=/…/파일[&dl=1]   파일 열기 (Range 지원 — 음악 건너뛰기) · dl=1 이면 내려받기
 * 드라이브 메뉴(폴더 둘러보기) · 녹음 찾기 · 콘티에 연결 은 없앴고, 영상은 재생하지 않습니다 (서버를 거쳐 흘려보내서 Render 대역폭을 많이 씀).
 * 로그인한 팀원만. 객원 멤버는 자기 팀 콘티에 연결된 파일만 재생할 수 있습니다 (lib/guestGate.js).
 */
const express = require('express');
const teamContext = require('../lib/teamContext');
const sheetsDb = require('../lib/sheetsDb');
const guestAccess = require('../lib/guestAccess');
const nas = require('../lib/nas');

const router = express.Router();

async function requireMember(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  req.ctx = ctx;
  next();
}

router.get('/drive/file', requireMember, async (req, res) => {
  try {
    const p = nas.cleanPath(req.query.p);
    if (nas.kindOf(p) === 'video') return res.status(410).type('text').send('영상 재생은 더 이상 지원하지 않아요.');
    if (guestAccess.isGuest(req.ctx.member)) {                         // 객원 — 자기 팀 콘티에 연결된 파일만
      const ok = (await sheetsDb.readAll('녹음')).some((r) => req.ctx.teams.includes(r['팀ID']) && nas.pathOfLink(r['링크']) === p);
      if (!ok) return res.status(403).type('text').send('볼 수 없는 파일이에요.');
    }
    await nas.stream(req.query.p, res, req.get('range') || '', req.query.dl === '1');
  } catch (e) {
    if (!e.user) console.error('[드라이브 파일]', e);
    if (!res.headersSent) res.status(e.code === 'NAS_NOT_FOUND' || e.code === 'NAS_FILE' ? 404 : 502).type('text').send(e.user ? e.message : '파일을 열지 못했어요.');
    else res.destroy();
  }
});

module.exports = router;
