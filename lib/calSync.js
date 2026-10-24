/**
 * 구글 캘린더 연동 — 각자 한 번 구글에서 동의하면, 앱이 그 사람 구글 계정에 팀 캘린더(예: 「3부찬양팀」)를 따로 하나 만들고
 * 거기에 내가 서는 연습 · 주일 예배 · 행사를 넣고, 편성 · 시간이 바뀌면 고치거나 지웁니다 (30분마다 + 연동 직후).
 *  · 권한은 calendar.app.created — 앱이 만든 캘린더만 다룰 수 있음 (그 사람의 다른 캘린더는 읽지도 못함)
 *  · 그 캘린더를 사용자가 지우면 다음 동기화 때 다시 만듦. 연동 해제하면 그 캘린더를 통째로 지움
 *
 *  · OAuth 클라이언트는 로그인용(GOOGLE_LOGIN_CLIENT_ID/SECRET)을 같이 씀 — 리디렉션도 /auth/google/callback 그대로
 *    (state 에 cal:1 이 있으면 routes/auth.js 가 이리로 넘김). 권한: calendar.events (민감한 권한 — 구글 콘솔에서 테스트 사용자로 등록)
 *  · 우리 일정은 extendedProperties.private.ynhub = 팀 표시로 구분 — 그 사람이 직접 만든 일정은 건드리지 않음
 *  · 일정 ID 는 그 일정의 uid 로 정해져서(같은 연습 = 같은 ID) 두 번 들어가지 않음
 *  · 토큰은 '구글캘린더' 탭에 SESSION_SECRET 으로 암호화해 저장
 */
const crypto = require('crypto');
const { google } = require('googleapis');
const sheetsDb = require('./sheetsDb');
const week = require('./weekUtil');
const prac = require('./practice');
const pv = require('./practiceView');
const { loginClient } = require('./googleAuth');

const TAB = '구글캘린더';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created'];
const calName = (team) => String(team || '').replace(/\s+/g, '');
const base = () => String(process.env.BASE_URL || '').replace(/\/+$/, '');
const redirectUri = () => base() + '/auth/google/callback';
const available = () => !!(process.env.GOOGLE_LOGIN_CLIENT_ID && process.env.GOOGLE_LOGIN_CLIENT_SECRET && base() && process.env.HUB_SSO !== '1');

/* ---------- 토큰 암호화 (AES-256-GCM, 열쇠 = SESSION_SECRET 에서) */
const key = () => crypto.createHash('sha256').update('calsync|' + String(process.env.SESSION_SECRET || 'dev')).digest();
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
function open(sealed) {
  try {
    const [iv, tag, enc] = String(sealed || '').split('.').map((x) => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (e) { return ''; }
}

const teamTag = (team) => crypto.createHash('sha1').update('ynhub|' + team).digest('hex').slice(0, 12);
const eventId = (team, uid) => 'ph' + crypto.createHash('sha1').update(team + '|' + uid).digest('hex');   // 구글 일정 ID 는 base32hex(0-9 · a-v)만 — 'ph' + 16진수

async function rowOf(email, team) {
  return (await sheetsDb.readAll(TAB, { fresh: true })).find((r) => String(r['이메일']).toLowerCase() === String(email).toLowerCase() && r['팀ID'] === team) || null;
}
async function saveRow(email, team, patch) {
  const hit = await rowOf(email, team);
  const row = Object.assign({ '이메일': email, '팀ID': team, '구글계정': '', '토큰': '', '연동시각': '', '마지막동기화': '', '상태': '', '캘린더ID': '' }, hit || {}, patch);
  delete row.__row;
  if (hit) await sheetsDb.updateRow(TAB, hit.__row, row); else await sheetsDb.appendRow(TAB, row);
  return row;
}

/** 연동 시작 주소 (구글 동의 화면) */
function connectUrl(session, email, team) {
  const client = loginClient(redirectUri());
  return client.generateAuthUrl({
    access_type: 'offline', prompt: 'consent', scope: SCOPES,
    state: session.signState({ cal: 1, e: email, t: team }), login_hint: email,
  });
}

/** 구글에서 돌아왔을 때 (routes/auth.js) — 토큰 저장하고 바로 한 번 넣기 */
async function finish(code, st) {
  const client = loginClient(redirectUri());
  const { tokens } = await client.getToken(String(code || ''));
  if (!tokens.refresh_token) throw new Error('구글에서 연동 권한을 받지 못했어요. 다시 시도해 주세요.');
  if (!String(tokens.scope || '').includes('calendar')) throw new Error('캘린더 권한에 체크하지 않으셨어요. 다시 연동하면서 캘린더 항목을 체크해 주세요.');
  const old = await rowOf(st.e, st.t);
  if (old && old['토큰'] && !old['캘린더ID']) await cleanPrimary(old, st.t);              // 예전 방식(내 캘린더에 바로)으로 넣은 일정은 지움
  let gmail = '';
  try { const t = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_LOGIN_CLIENT_ID }); gmail = String(t.getPayload().email || ''); } catch (e) { /* 표시용 */ }
  await saveRow(st.e, st.t, { '구글계정': gmail, '토큰': seal(tokens.refresh_token), '연동시각': new Date().toISOString(), '상태': '연동', '캘린더ID': old && old['캘린더ID'] ? old['캘린더ID'] : '' });
  return syncOne(st.e, st.t).catch((e) => { console.error('[구글 캘린더 첫 동기화]', e && e.message); return null; });
}

function calApi(row) {
  const refresh = open(row['토큰']);
  if (!refresh) throw Object.assign(new Error('토큰을 읽지 못했어요.'), { gone: true });
  const auth = loginClient(redirectUri());
  auth.setCredentials({ refresh_token: refresh });
  return google.calendar({ version: 'v3', auth });
}
/** 팀 캘린더 — 없거나 지워졌으면 새로 만들고 ID 를 저장 */
async function teamCalendar(cal, row, email, team, fresh) {
  if (row['캘린더ID'] && !fresh) return row['캘린더ID'];
  const r = await cal.calendars.insert({ requestBody: { summary: calName(team), description: `영락 ${calName(team)} — 내가 서는 연습 · 주일 예배 · 행사 (찬양팀 허브가 자동으로 맞춤)`, timeZone: pv.TZ } });
  const id = r.data.id;
  await saveRow(email, team, { '캘린더ID': id });
  row['캘린더ID'] = id;
  return id;
}
/** 예전(내 캘린더에 바로 넣던 때) 일정 지우기 — 그 토큰에 권한이 있을 때만 */
async function cleanPrimary(row, team) {
  try {
    const cal = calApi(row);
    const res = await cal.events.list({ calendarId: 'primary', privateExtendedProperty: 'ynhub=' + teamTag(team), maxResults: 250, singleEvents: true });
    for (const e of res.data.items || []) await cal.events.delete({ calendarId: 'primary', eventId: e.id }).catch(() => {});
  } catch (e) { /* 권한 없음 — 그대로 */ }
}
const memberName = async (email) => {
  const m = (await sheetsDb.readAll('회원')).find((r) => String(r['이메일']).toLowerCase() === String(email).toLowerCase());
  return m ? String(m['이름'] || '').trim() : '';
};

/** 일정 하나 → 구글 일정 */
function body(team, ev, url) {
  const end = ev.end ? { date: ev.date, time: ev.end } : pv.endOf(ev.date, ev.time);
  const b = {
    summary: ev.title, location: pv.calLocation(ev.place), description: ev.details,
    start: { dateTime: `${ev.date}T${ev.time}:00`, timeZone: pv.TZ }, end: { dateTime: `${end.date}T${end.time}:00`, timeZone: pv.TZ },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
    source: { title: `영락 ${String(team).replace(/\s+/g, '')}`, url: url || base() },
    status: 'confirmed',
  };
  const h = crypto.createHash('sha1').update(JSON.stringify(b)).digest('hex').slice(0, 16);
  b.extendedProperties = { private: { ynhub: teamTag(team), h } };
  return b;
}

/** 이 사람의 구글 캘린더를 지금 스케줄에 맞춤 — 지난 2주 ~ 앞으로 6개월. 불가로 표시한 날은 빠짐 */
async function syncOne(email, team) {
  const row = await rowOf(email, team);
  if (!row || !row['토큰']) return null;
  const name = await memberName(email);
  if (!name) return null;
  const cal = calApi(row);
  const today = week.todayStr(), from = prac.addDays(today, -14);
  const { scheduleOf } = require('../routes/conti');
  const r = await scheduleOf(team, name, from, prac.addDays(today, 183), base());
  const want = new Map();
  r.items.filter((it) => !it.off).forEach((it) => { const id = eventId(team, it.ev.uid || it.id); want.set(id, body(team, it.ev, it.ev.url)); });
  const have = new Map();
  let pageToken, calId;
  try {
    calId = await teamCalendar(cal, row, email, team);
    try { await cal.calendars.get({ calendarId: calId }); }
    catch (e) { if ([404, 410].includes(e && (e.code || e.status))) calId = await teamCalendar(cal, row, email, team, true); else throw e; }   // 사용자가 캘린더를 지웠으면 다시 만듦
    do {
      const res = await cal.events.list({ calendarId: calId, privateExtendedProperty: 'ynhub=' + teamTag(team), timeMin: new Date(from + 'T00:00:00Z').toISOString(), maxResults: 250, singleEvents: true, pageToken });
      (res.data.items || []).forEach((e) => have.set(e.id, e));
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  } catch (e) { return fail(email, team, e); }
  let added = 0, changed = 0, removed = 0;
  try {
    for (const [id, b] of want) {
      const h = have.get(id);
      if (h && h.extendedProperties && h.extendedProperties.private && h.extendedProperties.private.h === b.extendedProperties.private.h) continue;
      if (h) { await cal.events.update({ calendarId: calId, eventId: id, requestBody: b }); changed++; continue; }
      try { await cal.events.insert({ calendarId: calId, requestBody: Object.assign({ id }, b) }); added++; }
      catch (e) {                                                            // 예전에 지운 같은 ID 가 휴지통에 있으면 되살림
        if (e && (e.code === 409 || e.status === 409)) { await cal.events.update({ calendarId: calId, eventId: id, requestBody: b }); changed++; } else throw e;
      }
    }
    for (const [id] of have) if (!want.has(id)) { await cal.events.delete({ calendarId: calId, eventId: id }).catch(() => {}); removed++; }
  } catch (e) { return fail(email, team, e); }
  await saveRow(email, team, { '마지막동기화': new Date().toISOString(), '상태': '연동' });
  if (added || changed || removed) console.log(`[구글 캘린더] ${team} ${name} — 추가 ${added} · 바뀜 ${changed} · 지움 ${removed}`);
  return { added, changed, removed, total: want.size };
}
async function fail(email, team, e) {
  const msg = (e && (e.response && e.response.data && (e.response.data.error_description || e.response.data.error))) || (e && e.message) || '';
  const code = e && (e.code || e.status), reason = String((e && e.errors && e.errors[0] && e.errors[0].reason) || '');
  const gone = (e && e.gone) || /invalid_grant/i.test(String(msg)) || code === 401 || /insufficient/i.test(String(msg) + reason);
  const apiOff = /accessNotConfigured|has not been used|is disabled/i.test(String(msg) + reason);
  console.error('[구글 캘린더 동기화 실패]', team, email, code, reason, msg);
  if (gone) await saveRow(email, team, { '상태': '끊김' });
  return { error: gone ? '구글 연동이 끊어졌어요. 다시 연동해 주세요.' : apiOff ? '구글 콘솔에서 Google Calendar API 가 아직 꺼져 있어요 (관리자 설정).' : `구글 캘린더에 넣지 못했어요 (${code || '오류'}). 잠시 후 다시 시도해 주세요.`, gone };
}

/** 연동 해제 — 넣었던 일정을 지우고 권한도 돌려줌 */
async function disconnect(email, team) {
  const row = await rowOf(email, team);
  if (!row) return;
  try {
    const cal = calApi(row);
    if (row['캘린더ID']) await cal.calendars.delete({ calendarId: row['캘린더ID'] }).catch(() => {});      // 팀 캘린더를 통째로
    else await cleanPrimary(row, team);
    await loginClient(redirectUri()).revokeToken(open(row['토큰'])).catch(() => {});
  } catch (e) { /* 토큰이 이미 끊긴 경우 — 줄만 지움 */ }
  await sheetsDb.deleteRow(TAB, row.__row);
}

async function status(email, team) {
  if (!available()) return { avail: false };
  const row = await rowOf(email, team);
  return { avail: true, calName: calName(team), connected: !!(row && row['토큰'] && row['상태'] !== '끊김'), broken: !!(row && row['상태'] === '끊김'), account: row ? row['구글계정'] : '', at: row ? row['마지막동기화'] : '' };
}

let running = null;
async function syncAll() {
  const rows = (await sheetsDb.readAll(TAB, { fresh: true })).filter((r) => r['토큰'] && r['상태'] !== '끊김');
  for (const r of rows) { try { await syncOne(r['이메일'], r['팀ID']); } catch (e) { console.error('[구글 캘린더 동기화]', e && e.message); } }
}
function ensure() { if (!running && available()) running = syncAll().catch((e) => console.error('[구글 캘린더 전체 동기화]', e && e.message)).finally(() => { running = null; }); return running; }
/** 30분마다 모두 (서버가 깨어 있는 동안) */
function start() { setTimeout(ensure, 180000); setInterval(ensure, 30 * 60 * 1000).unref(); }

module.exports = { available, connectUrl, finish, syncOne, disconnect, status, start, ensure, eventId, body };
