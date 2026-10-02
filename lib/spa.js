/**
 * 예배콘티 · 공지및모임 · 스케줄표 · 라이브러리 · 장비·수리를 한 페이지 안에서 탭처럼 오가게 하는 공통 장치.
 * church-app의 Worship.html은 탭을 눌러도 페이지가 다시 로드되지 않고(TABS/tab()/render()), 그 자리에서
 * 내용만 바뀜 — 이 앱은 Express 라우트가 여러 개(각자 풀 페이지)라서, 같은 느낌을 내려고
 * "이 요청이 탭 전환(ajax)인지, 그냥 페이지를 여는 것인지"를 구분해서 응답을 다르게 보냄:
 *   - 탭 전환(ajax)  → JSON { html, title } 또는 (POST 후) { redirect }
 *   - 그냥 페이지 열기 → 지금처럼 완전한 HTML 한 장
 * 클라이언트 쪽 전환 로직은 public/js/spa.js 에 있음.
 */
const pageShell = require('./pageShell');

function isPartial(req) {
  return req.query.partial === '1' || req.get('X-PH-Partial') === '1';
}

/** 맨 위 배너에 넣을 "누가 보고 있나" (사진 · 이름 · 관리자) — 로그인 안 했으면 null */
async function whoOf(req) {
  if (!req.session) return null;
  let ctx = req.ctx;
  if (!ctx) { try { ctx = await require('./teamContext').resolve(req); } catch (e) { ctx = null; } }
  if (!ctx || !ctx.member) return null;
  const hon = require('./honorific'), name = String(ctx.member['이름'] || '');
  const pastor = hon.isPastorRoles(ctx.member['역할']) || (ctx.current ? (await hon.pastorSet(ctx.current)).has(name) : false);   // 목회자는 "윤정환 목사"
  return { name, pastor, guest: require('./guestAccess').isGuest(ctx.member), photo: require('./photo').src(ctx.member['프로필사진'] || ''), isAdmin: !!ctx.isAdmin, team: ctx.current || '' };
}

/** GET 핸들러 맨 끝에서: 탭 전환 중이면 JSON 조각, 아니면 풀 페이지 */
async function send(req, res, content, opts = {}) {
  const who = await whoOf(req);
  const html = pageShell.decorate(content, who);
  if (isPartial(req)) return res.json({ html, title: opts.title || '' });
  const wrapped = `<div id="ph-tabbody">${html}</div>`;
  res.type('html').send(await pageShell.render(wrapped, Object.assign({}, opts, { who })));
}

/** POST 핸들러 맨 끝에서: 탭 전환 중이면 이동할 주소만 JSON으로, 아니면 기존처럼 302 리다이렉트 */
function redirect(req, res, url) {
  if (isPartial(req)) return res.json({ redirect: url });
  res.redirect(url);
}

module.exports = { isPartial, send, redirect, whoOf };
