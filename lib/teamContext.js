/**
 * 로그인한 회원이 "지금 보고 있는 찬양팀"을 정합니다.
 * - 일반 회원: 본인이 가입할 때 선택한 소속팀(들)만 볼 수 있음
 * - 관리자: 모든 활성 찬양팀을 볼 수 있음 (+ 본인 소속팀이 맨 앞)
 * - ?team=팀명 쿼리로 다른(본인이 볼 수 있는) 팀으로 전환 가능 — 예배콘티·공지및모임 등 모든 탭이 공유
 */
const sheetsDb = require('./sheetsDb');
const pageShell = require('./pageShell');

async function resolve(req) {
  if (!req.session) return null;
  const member = await sheetsDb.findOne('회원', '이메일', req.session.email);
  if (!member) return null;
  const isAdmin = String(member['관리자여부']).toUpperCase() === 'TRUE';
  const own = String(member['소속팀'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  let teams = own;
  if (isAdmin) {
    const allTeams = await sheetsDb.readAll('찬양팀');
    const active = allTeams.filter((t) => String(t['활성여부']).toUpperCase() !== 'FALSE').map((t) => t['팀명']).filter(Boolean);
    const seen = new Set();
    teams = [...own, ...active].filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  }
  const requested = String(req.query.team || '').trim();
  const current = (requested && teams.includes(requested)) ? requested : (teams[0] || '');
  const roles = String(member['역할'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { member, isAdmin, teams, current, roles };
}

/** 소속팀이 2개 이상이거나 관리자일 때 보여줄 팀 전환 드롭다운(GET 폼, 현재 쿼리스트링 유지) */
function teamSwitcher(ctx, opts = {}) {
  if (!ctx || ctx.teams.length < 2) return '';
  const keep = opts.keep || {}; // 전환할 때 같이 유지할 다른 쿼리 (예: date)
  const hidden = Object.keys(keep).filter((k) => keep[k] != null && keep[k] !== '')
    .map((k) => `<input type="hidden" name="${pageShell.esc(k)}" value="${pageShell.esc(keep[k])}">`).join('');
  const options = ctx.teams.map((t) => `<option value="${pageShell.esc(t)}"${t === ctx.current ? ' selected' : ''}>${pageShell.esc(t)}</option>`).join('');
  return `<form method="get" class="ph-teamswitch">${hidden}
    <select name="team" onchange="this.form.submit()">${options}</select>
  </form>`;
}

module.exports = { resolve, teamSwitcher };
