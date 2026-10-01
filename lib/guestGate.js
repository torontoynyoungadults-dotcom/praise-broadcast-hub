/**
 * 접근 관리 (server.js 에서 라우트들 앞에 한 번) —
 *   1) 관리자가 "접속 일시 중지"한 회원은 로그아웃시키고 안내 문구와 함께 로그인 화면으로
 *   2) 객원 멤버는 라이브러리 · 행사 · 장비 · 팀원관리 · 관리 화면을 못 열고, 예배콘티(라이브 악보 포함)는 스케줄에 서는 날만 엽니다.
 *      (공지 및 모임 · 스케줄표 · 내 정보는 늘 열림) — 서는 날이 아닌 날을 열면 "서는 날" 목록을 보여 줍니다.
 */
const sheetsDb = require('./sheetsDb');
const session = require('./session');
const week = require('./weekUtil');
const pageShell = require('./pageShell');
const spa = require('./spa');
const teamContext = require('./teamContext');
const guestAccess = require('./guestAccess');

const esc = pageShell.esc;
const BLOCKED = /^\/(library|events|equipment|roster|admin|schedule\/import)(\/|$)/;
const SUSP_MSG = '접속이 일시 중지되었어요. 관리자에게 문의해주세요.';

const scopeOf = (req) => {
  const q = req.query || {}, b = (req.body && typeof req.body === 'object') ? req.body : {};
  return { event: String(q.event || b.event || b['행사ID'] || '').trim(), date: week.normalizeDate(q.date || b.date) };
};
const isMultipart = (req) => /multipart\/form-data/i.test(req.get('content-type') || '');
const hasScope = (req) => { const q = req.query || {}; return !!(q.event || q.date); };

/** 이 사람이 서는 날 목록 → [{ label, href, sort }] (다가오는 날 먼저) */
async function serveDays(team, member) {
  const rooms = Array.from(await guestAccess.servingRooms(team, member['이름']));
  const evs = new Map((await sheetsDb.readAll('특별예배')).filter((e) => e['팀ID'] === team).map((e) => [e['ID'], e]));
  const today = week.todayStr();
  const T = encodeURIComponent(team);
  const list = [];
  rooms.forEach((r) => {
    if (r.startsWith('ev-')) {
      const e = evs.get(r.slice(3)); if (!e) return;
      list.push({ date: e['날짜'], label: `${week.labelKo(e['날짜'])} · ${e['이름']}`, href: `/conti?team=${T}&event=${encodeURIComponent(e['ID'])}` });
    } else list.push({ date: r, label: week.labelKo(r), href: `/conti?team=${T}&date=${encodeURIComponent(r)}` });
  });
  const up = list.filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = list.filter((x) => x.date < today).sort((a, b) => b.date.localeCompare(a.date));
  return { up, past };
}

async function blockedPage(req, res, ctx, member, team) {
  const { up, past } = await serveDays(team, member);
  const li = (x) => `<a class="ph-li-link strong" href="${esc(x.href)}">${esc(x.label)} →</a>`;
  const content = `${pageShell.hubNav('conti', team)}
  ${pageShell.hero({ eyebrow: `${team} · 객원 멤버`, title: '예배 콘티', sub: '스케줄에 서는 날에만 콘티를 볼 수 있어요' })}
  <div class="ph-card"><p class="ph-sub">이 날은 스케줄에 없어서 콘티를 열 수 없어요. 서는 날을 눌러 주세요.</p></div>
  <div class="ph-card top-accent"><h2 class="ph-h2">서는 날</h2>
    ${up.length ? up.slice(0, 12).map((x) => `<div class="ph-list-item"><div class="ph-li-main">${li(x)}</div></div>`).join('') : '<p class="ph-sub">앞으로 서는 날이 아직 없어요. 스케줄이 정해지면 여기에 나타나요.</p>'}
  </div>
  ${past.length ? `<div class="ph-card"><h2 class="ph-h2">지난 서는 날</h2>${past.slice(0, 6).map((x) => `<div class="ph-list-item"><div class="ph-li-main">${li(x)}</div></div>`).join('')}</div>` : ''}`;
  res.status(403);
  return spa.send(req, res, content, { title: '예배콘티' });
}

async function middleware(req, res, next) {
  try {
    if (!req.session || /\.[a-z0-9]{2,5}$/i.test(req.path) || /^\/(logout|auth|healthz|photo|sheet|audio|socket\.io)(\/|$)/.test(req.path)) return next();
    const member = await sheetsDb.findOne('회원', '이메일', req.session.email);
    if (!member) return next();
    if (guestAccess.isSuspended(member)) {
      session.logout(res);
      if (req.method === 'GET' && !spa.isPartial(req)) return res.redirect('/?err=' + encodeURIComponent(SUSP_MSG));
      return res.status(403).json({ error: SUSP_MSG, redirect: '/?err=' + encodeURIComponent(SUSP_MSG) });
    }
    if (!guestAccess.isGuest(member)) return next();
    const p = req.path;
    const isGet = req.method === 'GET';
    if (BLOCKED.test(p)) {
      if (isGet) return spa.redirect(req, res, '/conti');
      return res.status(403).type('text').send('객원 멤버는 쓸 수 없는 기능이에요.');
    }
    if (/^\/conti(\/|$)/.test(p)) {
      if (p === '/conti/offline-plan') return res.status(403).json({ error: '객원 멤버는 쓸 수 없는 기능이에요.' });
      if (!isGet && isMultipart(req)) return next();                   // 파일이 달린 전송은 파일을 받은 뒤 afterUpload 가 확인
      const ctx = await teamContext.resolve(req);
      if (!ctx || !ctx.current) return next();
      const team = ctx.current;
      if (isGet && (p === '/conti') && !hasScope(req)) {               // 날짜 없이 열면 → 가장 가까운 서는 날로
        const { up, past } = await serveDays(team, member);
        const go = up[0] || past[0];
        if (go) return spa.redirect(req, res, go.href);
        return blockedPage(req, res, ctx, member, team);
      }
      if (!(await guestAccess.canSee(member, team, scopeOf(req)))) {
        if (isGet) return blockedPage(req, res, ctx, member, team);
        return res.status(403).type('text').send('스케줄에 서는 날만 쓸 수 있어요.');
      }
    }
    next();
  } catch (e) { console.error('[접근 확인 실패]', e.message); next(); }
}

/** 파일 업로드(multer) 뒤에 — 객원 멤버가 서는 날이 아닌 곳에 올리지 못하게 */
async function afterUpload(req, res, next) {
  try {
    if (!req.session) return next();
    const member = await sheetsDb.findOne('회원', '이메일', req.session.email);
    if (!guestAccess.isGuest(member)) return next();
    const ctx = await teamContext.resolve(req);
    const team = (req.body && req.body.team) || (ctx && ctx.current);
    if (await guestAccess.canSee(member, team, scopeOf(req))) return next();
    return res.status(403).type('text').send('스케줄에 서는 날만 쓸 수 있어요.');
  } catch (e) { return res.status(500).type('text').send('확인하지 못했어요.'); }
}

module.exports = { middleware, afterUpload, serveDays };
