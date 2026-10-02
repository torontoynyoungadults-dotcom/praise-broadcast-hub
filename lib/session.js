/**
 * 아주 단순한 서명 쿠키 세션 — 서버에 세션 저장소를 따로 두지 않습니다(무상태).
 * 쿠키 안에 {이메일, iat}를 JSON으로 담고 HMAC-SHA256 서명을 붙입니다.
 */
const crypto = require('crypto');

const COOKIE_NAME = 'ph_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 180; // 180일

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET 환경변수가 필요합니다.');
  return s;
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

function create(data) {
  const payload = { ...data, iat: Date.now() };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${b64}.${sign(b64)}`;
}

function verify(token, maxAgeMs) {
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  let expected;
  try { expected = sign(b64); } catch (e) { return null; }
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!data || !data.iat || Date.now() - data.iat > (maxAgeMs || MAX_AGE_MS)) return null;
  return data;
}

/** OAuth state 등 — 짧게 사는 서명 토큰 (쿠키가 아니라 URL에 실어 보낼 때) */
function signState(data, maxAgeMs) {
  return create(data); // iat 포함, verify에서 maxAgeMs로 만료 판단
}
function verifyState(token, maxAgeMs) { return verify(token, maxAgeMs || 1000 * 60 * 10); }

function setCookie(res, name, value, maxAgeMs) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  if (maxAgeMs) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; Max-Age=0`);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i === -1) return;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

/** express 미들웨어 — req.session = {email,...} | null 로 채웁니다 */
function middleware(req, res, next) {
  const cookies = parseCookies(req);
  req.session = verify(cookies[COOKIE_NAME]);
  next();
}

function login(res, data) { setCookie(res, COOKIE_NAME, create(data), MAX_AGE_MS); }
function logout(res) { clearCookie(res, COOKIE_NAME); }

/** 가입 중인 이메일을 잠깐(30분) 기억해 두는 별도의 작은 쿠키 (signup 단계에서만 씀) */
const PENDING_COOKIE = 'ph_pending_email';
function setPendingEmail(res, email) { setCookie(res, PENDING_COOKIE, create({ email }), 1000 * 60 * 30); }
function getPendingEmail(req) {
  const cookies = parseCookies(req);
  const data = verify(cookies[PENDING_COOKIE]);
  return data ? data.email : null;
}
function clearPendingEmail(res) { clearCookie(res, PENDING_COOKIE); }

module.exports = { setCookie, middleware, login, logout, setPendingEmail, getPendingEmail, clearPendingEmail, parseCookies, signState, verifyState };
