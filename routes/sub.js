/**
 * 대신 서 줄 사람 찾기 (/sub) — 나에게 온 부탁("제가 설게요") · 내가 한 부탁(취소) · (관리자) 편성에 반영.
 * 부탁은 스케줄표 "내가 안 되는 날" 칸에서 올립니다 (public/hub/hubshim.js → lib/hubApi.js subRequestCreate → lib/subRequest.js).
 */
const express = require('express');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const guestAccess = require('../lib/guestAccess');
const sub = require('../lib/subRequest');

const router = express.Router();
const esc = pageShell.esc;
const WD = ['주일', '월', '화', '수', '목', '금', '토'];
const md = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? `${Number(m[2])}/${Number(m[3])}(${WD[new Date(d + 'T12:00:00').getDay()]})` : String(d || ''); };

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length || guestAccess.isGuest(ctx.member)) return res.redirect('/');
  req.ctx = ctx;
  next();
}
const who = (req) => ({ team: req.ctx.current, name: String(req.ctx.member['이름'] || '').trim(), email: String(req.ctx.member['이메일'] || ''), admin: !!req.ctx.isAdmin });

router.get('/sub', requireTeam, async (req, res) => {
  const u = who(req), team = u.team;
  const b = await sub.board(team, u.name, u.admin);
  const form = (action, id, label, cls, confirmMsg) => `<form method="post" action="/sub/${action}"${confirmMsg ? ` onsubmit="return confirm('${confirmMsg}')"` : ''}><input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="id" value="${esc(id)}"><button type="submit" class="sub-btn${cls ? ' ' + cls : ''}">${label}</button></form>`;
  const when = (x) => `<span class="sub-d"><b>${esc(md(x.date))}</b><small>${esc(x.ev || '주일')}</small></span>`;
  const card = (x, right, sub2) => `<div class="sub-row">${when(x)}<span class="sub-t"><b>${esc(x.pos)}</b><small>${sub2}</small></span>${right}</div>`;
  const stateTxt = (x) => x.state === '요청' ? '답을 기다리는 중' : x.state === '수락' ? `${esc(x.to)}님이 설게요 · 관리자 확인 중` : x.state === '완료' ? `${esc(x.to)}님으로 바뀌었어요` : esc(x.state);
  const sec = (title, list, empty) => `<section class="ph-card sub-sec"><h2 class="ph-h2">${title}</h2>${list.length ? `<div class="sub-list">${list.join('')}</div>` : `<p class="ph-sub">${empty}</p>`}</section>`;
  const msg = { ok: '고마워요! 편성에 바로 반영했어요.', done: '편성에 반영했어요.', cancel: '부탁을 취소했어요.' }[String(req.query.m || '')] || '';
  const errMsg = String(req.query.err || '').slice(0, 120);
  const content = `
  ${pageShell.hubNav('schedule', team)}
  ${pageShell.hero({ eyebrow: `${team} · 스케줄`, title: '대신 서 줄 사람 찾기', sub: '서는 날이 안 되면 스케줄의 "내가 안 되는 날"에서 부탁을 올려요' })}
  ${msg ? `<p class="ph-msg ok">${esc(msg)}</p>` : ''}${errMsg ? `<p class="ph-msg err">${esc(errMsg)}</p>` : ''}
  ${u.admin && b.pending.length ? sec('편성에 반영하기', b.pending.map((x) => card(x, form('approve', x.id, '편성 바꾸기', 'pri'), `${esc(x.from)} → <b>${esc(x.to)}</b>`)), '') : ''}
  ${sec('나에게 온 부탁', b.forMe.map((x) => card(x, form('accept', x.id, '제가 설게요', 'pri', '이 날 대신 서면 편성이 바로 바뀌어요. 설게요?'), `${esc(x.from)}님이 어려워요${x.why && x.why !== '개인 사정' ? ' · ' + esc(x.why) : ''}`)), '지금은 없어요.')}
  ${sec('내가 한 부탁', b.mine.map((x) => card(x, x.state === '완료' ? '' : form('cancel', x.id, '취소', '', '이 부탁을 취소할까요?'), stateTxt(x))), '없어요. 스케줄에서 서는 날을 "안 되는 날"로 누르면 부탁을 올릴 수 있어요.')}
  ${b.taken.length ? sec('내가 대신 서기로 한 날', b.taken.map((x) => card(x, '', x.state === '완료' ? `${esc(x.from)}님 대신 · 편성 반영됨` : `${esc(x.from)}님 대신`)), '') : ''}
  <p class="sub-back"><a href="/schedule?team=${encodeURIComponent(team)}">‹ 스케줄로</a></p>`;
  spa.send(req, res, content, { title: '대신 서 줄 사람 찾기' });
});

function act(fn, okKey) {
  return async (req, res) => {
    const want = String((req.body && req.body.team) || ''), team = req.ctx.teams.includes(want) ? want : req.ctx.current;
    const back = (q) => spa.redirect(req, res, `/sub?team=${encodeURIComponent(team)}&${q}`);
    try { await fn(Object.assign(who(req), { team }), String((req.body && req.body.id) || '')); back('m=' + okKey); }
    catch (e) { if (!e.user) console.error('[대신 서기]', e); back('err=' + encodeURIComponent(e.user ? e.message : '처리하지 못했어요. 다시 해 주세요.')); }
  };
}
router.post('/sub/accept', requireTeam, act(sub.accept, 'ok'));
router.post('/sub/approve', requireTeam, act(sub.approve, 'done'));
router.post('/sub/cancel', requireTeam, act(sub.cancel, 'cancel'));

module.exports = router;
