/**
 * 라이브 악보 토큰 — church-app 의 화면은 모든 서버 호출(웹소켓 접속 · /api/*)에 token 을 실어 보냅니다.
 * 이 앱은 쿠키 세션이라, 라이브 악보 화면을 열 때 서버가 "이 사람 · 이 팀" 을 담은 서명 토큰을 만들어 화면에 넣어 줍니다.
 *  · 서명: SESSION_SECRET HMAC (lib/session 과 같은 방식) — 화면에서 고칠 수 없음
 *  · 3일 뒤 만료 (화면을 새로 열면 새 토큰)
 *  · 확인은 동기 — lib/realtime.js(church-app 그대로)의 auth(token) 가 동기라서
 *
 * 권한 — 이 앱은 팀원 누구나 콘티를 고칠 수 있으므로(routes/conti.js), church-app 의 "찬양 편집 권한(canEdit) = 리드 권한(canLead)" 규칙을
 * 그대로 따라 팀원이면 canEdit · canLead 모두 true 입니다 (페이지 컨트롤 · 클릭 컨트롤을 맡을 수 있고, 팀 필기 · 팀 설정을 바꿀 수 있음).
 */
const session = require('./session');

const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

function mint(member, team, isAdmin) {
  const name = String((member && member['이름']) || '').trim() || '팀원';
  return session.signState({ k: 'live', email: String((member && member['이메일']) || ''), team: String(team || ''), name, admin: !!isAdmin });
}

/** → { name, team, email, canEdit, canLead, committee, admin } — 틀리면 Error (church-app 찬양소켓인증_ 과 같은 모양) */
function verify(token) {
  const d = session.verifyState(String(token || ''), MAX_AGE_MS);
  if (!d || d.k !== 'live' || !d.team || !d.name) throw new Error('라이브 악보를 다시 열어주세요. (접속 정보가 만료되었습니다)');
  return { name: d.name, team: d.team, email: d.email || '', canEdit: true, canLead: true, committee: !!d.admin, admin: !!d.admin };
}

module.exports = { mint, verify, MAX_AGE_MS };
