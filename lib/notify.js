/**
 * 알림 — 종 아이콘의 "받은 알림" 목록 + 폰 푸시(웹 푸시).
 *   · 콘티 곡이 올라오면 자동 알림 (곡을 여러 개 연달아 올려도 한 번만 — 잠깐 모았다가 보냄)
 *   · 악보 업데이트는 종 안에서 보낼 악보를 골라 "알림 보내기" 를 눌렀을 때만
 *   · 받은 알림은 시트 '알림' 탭, 기기 구독은 '알림구독' 탭
 *   · VAPID 키: 환경변수(VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY)가 있으면 그것을, 없으면 처음 한 번 만들어 '설정' 탭에 보관
 * 알림이 실패해도 콘티 · 악보 저장에는 영향이 없게 — 부르는 쪽은 await 하지 않고 .catch 만 붙입니다.
 */
const crypto = require('crypto');
const webpush = require('web-push');
const sheetsDb = require('./sheetsDb');

const AUTO_WAIT_MS = 5 * 60 * 1000;             // 콘티 곡을 처음 올린 뒤 5분 — 그 사이 올린 곡을 모아 한꺼번에 한 번만 보냄
const SCHED_WAIT_MS = 2 * 60 * 1000;            // 스케줄 편성이 바뀐 사람에게는 2분 모아서 한 번 (고치는 중에 계속 울리지 않게)
const KEEP_INBOX = 40;                           // 목록에 보여줄 최근 알림 수
const SUBJECT = 'mailto:' + (process.env.VAPID_CONTACT || 'office@ynchurch.org');

let _keys = null, _keysP = null;
async function vapidKeys() {
  if (_keys) return _keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    _keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return _keys;
  }
  if (!_keysP) _keysP = (async () => {
    let pub = await sheetsDb.getSetting('VAPID공개키', ''), pri = await sheetsDb.getSetting('VAPID비밀키', '');
    if (!pub || !pri) {
      const fresh = await sheetsDb.findOne('설정', '키', 'VAPID공개키');      // 동시에 두 번 만들지 않게 한 번 더 읽음
      if (!fresh) {
        const k = webpush.generateVAPIDKeys();
        await sheetsDb.appendRow('설정', { '키': 'VAPID공개키', '값': k.publicKey, '설명': '알림(푸시) 서명 공개키 — 지우면 모두 알림을 다시 켜야 합니다' });
        await sheetsDb.appendRow('설정', { '키': 'VAPID비밀키', '값': k.privateKey, '설명': '알림(푸시) 서명 비밀키 — 남에게 보여주지 마세요' });
        pub = k.publicKey; pri = k.privateKey;
      } else { sheetsDb.invalidate('설정'); pub = await sheetsDb.getSetting('VAPID공개키', ''); pri = await sheetsDb.getSetting('VAPID비밀키', ''); }
    }
    _keys = { publicKey: String(pub), privateKey: String(pri) };
    return _keys;
  })().finally(() => { _keysP = null; });
  return _keysP;
}
async function publicKey() { return (await vapidKeys()).publicKey; }

/* ---------------------------------------------------------------- 구독 */
function validSub(s) {
  return s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1200
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}
async function subscribe(email, sub, ua) {
  if (!validSub(sub)) throw new Error('알림 구독 정보가 올바르지 않아요.');
  const rows = await sheetsDb.readAll('알림구독', { fresh: true });
  const mine = rows.find((r) => r['주소'] === sub.endpoint);
  const obj = { '이메일': email, '주소': sub.endpoint, 'p256dh': sub.keys.p256dh, 'auth': sub.keys.auth, '등록시각': new Date().toISOString(), '기기': String(ua || '').slice(0, 80) };
  if (mine) { await sheetsDb.updateRow('알림구독', mine.__row, Object.assign({ 'ID': mine['ID'] }, obj)); return; }
  await sheetsDb.appendRow('알림구독', Object.assign({ 'ID': 'N' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex') }, obj));
}
async function unsubscribe(email, endpoint) {
  const rows = (await sheetsDb.readAll('알림구독', { fresh: true })).filter((r) => r['주소'] === endpoint && r['이메일'] === email);
  if (rows.length) await sheetsDb.deleteRows('알림구독', rows.map((r) => r.__row));
}
async function hasSub(email, endpoint) {
  if (!endpoint) return false;
  return (await sheetsDb.readAll('알림구독')).some((r) => r['주소'] === endpoint && r['이메일'] === email);
}

/* ---------------------------------------------------------------- 받는 사람 */
async function teamEmails(team) {
  const members = await sheetsDb.readAll('회원');
  return members.filter((m) => String(m['접속중지']).toUpperCase() !== 'TRUE' && String(m['소속팀'] || '').split(',').map((s) => s.trim()).includes(team))
    .map((m) => String(m['이메일'] || '').toLowerCase()).filter(Boolean);
}

/* ---------------------------------------------------------------- 보내기 */
/**
 * @param {string} team
 * @param {{kind:string,title:string,body:string,url:string,by?:string,byEmail?:string,targets?:string[]}} n
 * @returns {{id:string,sent:number,failed:number,people:number}}
 */
async function send(team, n) {
  const id = 'A' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const at = new Date().toISOString();
  await sheetsDb.appendRow('알림', {
    'ID': id, '팀ID': team, '종류': n.kind, '제목': n.title, '내용': n.body, '링크': n.url, '보낸이': n.by || '', '시각': at,
    '대상': '', '받는이': n.to && n.to.length ? n.to.join(',') : '',
  });
  let sent = 0, failed = 0, people = 0;
  try {
    const k = await vapidKeys();
    webpush.setVapidDetails(SUBJECT, k.publicKey, k.privateKey);
    const emails = new Set(n.to && n.to.length ? n.to.map((x) => String(x).toLowerCase()) : await teamEmails(team));
    if (n.byEmail) emails.delete(String(n.byEmail).toLowerCase());          // 보낸 사람 본인에게는 푸시하지 않음 (목록에는 보임)
    const subs = (await sheetsDb.readAll('알림구독', { fresh: true })).filter((r) => emails.has(String(r['이메일']).toLowerCase()));
    people = new Set(subs.map((r) => String(r['이메일']).toLowerCase())).size;
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: 'ph-' + n.kind + '-' + team, id });
    const dead = [];
    await Promise.all(subs.map(async (r) => {
      try {
        await webpush.sendNotification({ endpoint: r['주소'], keys: { p256dh: r['p256dh'], auth: r['auth'] } }, payload, { TTL: 60 * 60 * 24, urgency: 'high' });
        sent++;
      } catch (e) {
        failed++;
        if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(r.__row);      // 구독이 끝난 기기 — 정리
        else console.error('[푸시 실패]', e && e.statusCode, e && e.message);
      }
    }));
    if (dead.length) { try { await sheetsDb.deleteRows('알림구독', dead); } catch (e) { console.error('[만료 구독 정리 실패]', e && e.message); } }
  } catch (e) { console.error('[알림 보내기 실패 — 목록에는 남음]', e && e.message); }
  return { id, sent, failed, people };
}

/* ---------------------------------------------------------------- 콘티 곡 자동 알림 */
const _pending = new Map();           // 팀|범위 → { titles:[], by, byEmail, timer }
function contiLink(team, scope) {
  const qs = new URLSearchParams({ team });
  if (scope && scope.event) qs.set('event', scope.event); else if (scope && scope.date) qs.set('date', scope.date);
  return '/conti?' + qs.toString();
}
function dayLabel(scope) {
  if (!scope || !scope.date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(scope.date);
  return m ? `${Number(m[2])}/${Number(m[3])}` : '';
}
/** 콘티 곡이 올라왔을 때 부름 — 잠깐 모았다가 한 번에 보냄. 실패해도 조용히 */
function contiSongAdded(team, scope, songTitle, by, byEmail) {
  const key = team + '|' + (scope && (scope.event ? 'ev' + scope.event : scope.date) || '');
  let p = _pending.get(key);
  if (!p) { p = { titles: [], by, byEmail, scope, team }; _pending.set(key, p); }
  if (songTitle && p.titles.indexOf(songTitle) < 0) p.titles.push(songTitle);
  p.by = by || p.by; p.byEmail = byEmail || p.byEmail;
  if (p.timer) return;                                   // 첫 곡부터 5분 — 이미 예약돼 있으면 곡만 더 담음
  p.timer = setTimeout(() => {
    _pending.delete(key);
    const t = p.titles.slice(0, 4).join(', ') + (p.titles.length > 4 ? ` 외 ${p.titles.length - 4}곡` : '');
    const when = dayLabel(p.scope);
    send(team, {
      kind: '콘티', title: `새 콘티 곡이 올라왔어요${when ? ' · ' + when : ''}`, body: t, url: contiLink(team, p.scope), by: p.by, byEmail: p.byEmail,
    }).catch((e) => console.error('[콘티 알림 실패]', e && e.message));
  }, AUTO_WAIT_MS);
  if (p.timer.unref) p.timer.unref();
}
/** 서버가 꺼지기 전에 모아 둔 알림을 바로 보냄 */
function flushPending() {
  const jobs = [];
  const sched = Promise.resolve().then(() => flushAllSched());
  for (const [key, p] of _pending) { clearTimeout(p.timer); _pending.delete(key); jobs.push(p); }
  return Promise.all([sched].concat(jobs.map((p) => {
    const t = p.titles.slice(0, 4).join(', ') + (p.titles.length > 4 ? ` 외 ${p.titles.length - 4}곡` : '');
    const when = dayLabel(p.scope);
    return send(p.team, { kind: '콘티', title: `새 콘티 곡이 올라왔어요${when ? ' · ' + when : ''}`, body: t, url: contiLink(p.team, p.scope), by: p.by, byEmail: p.byEmail }).catch(() => {});
  })));
}

/* ---------------------------------------------------------------- 목록 · 아직 안 알린 악보 */
async function inbox(team, email) {
  const me = String(email || '').toLowerCase();
  const rows = (await sheetsDb.readAll('알림')).filter((r) => r['팀ID'] === team && (!r['받는이'] || String(r['받는이']).toLowerCase().split(',').includes(me)));
  return rows.sort((a, b) => String(b['시각']).localeCompare(String(a['시각']))).slice(0, KEEP_INBOX)
    .map((r) => ({ id: r['ID'], kind: r['종류'], title: r['제목'], body: r['내용'], url: r['링크'], by: r['보낸이'], at: r['시각'] }));
}
/* ---------------------------------------------------------------- 스케줄(편성) 바뀜 → 바뀐 그 사람에게만 */
const _sched = new Map();            // 팀|이메일 → { items: Map(칸 → {added,text}), timer }
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function mdText(d) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); if (!m) return String(d || ''); return Number(m[2]) + '/' + Number(m[3]) + '(' + WD[new Date(d + 'T12:00:00').getDay()] + ')'; }
function flushSched(k) {
  const p = _sched.get(k); if (!p) return Promise.resolve();
  clearTimeout(p.timer); _sched.delete(k);
  const lines = Array.from(p.items.values()).map((x) => x.text);
  if (!lines.length) return Promise.resolve();
  const body = lines.slice(0, 3).join(' · ') + (lines.length > 3 ? ` 외 ${lines.length - 3}건` : '');
  return send(p.team, { kind: '스케줄', title: '내 스케줄이 바뀌었어요', body, url: '/schedule?team=' + encodeURIComponent(p.team), by: p.by, byEmail: '', to: [p.email] })
    .catch((e) => console.error('[스케줄 알림 실패]', e && e.message));
}
/** lib/scheduleLog.js 의 변경 기록(편성)을 받아, 새로 배정되거나 빠진 사람에게만 알림. 자동(고정 배정)이나 본인이 바꾼 것은 제외. 실패해도 조용히 */
async function scheduleChanged(entries) {
  try {
    const list = (entries || []).filter((e) => e && e.kind === '편성' && e.team && !/^자동/.test(String(e.by || '')));
    if (!list.length) return;
    const members = await sheetsDb.readAll('회원');
    for (const e of list) {
      const arr = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
      const b = arr(e.before), a = arr(e.after);
      const when = mdText(e.date) + (e.ev ? ' ' + e.ev : '');
      const who = [].concat(a.filter((x) => b.indexOf(x) < 0).map((n) => [n, true]), b.filter((x) => a.indexOf(x) < 0).map((n) => [n, false]));
      for (const [name, added] of who) {
        if (name === String(e.by || '').trim()) continue;                       // 본인이 바꾼 건 알릴 필요 없음
        const m = members.find((r) => String(r['이름']).trim() === name && String(r['접속중지']).toUpperCase() !== 'TRUE' && String(r['소속팀'] || '').split(',').map((x) => x.trim()).includes(e.team));
        if (!m || !m['이메일']) continue;
        const email = String(m['이메일']).toLowerCase(), k = e.team + '|' + email;
        let p = _sched.get(k);
        if (!p) { p = { team: e.team, email, by: e.by, items: new Map(), timer: null }; _sched.set(k, p); }
        const cell = (e.target || e.key) + '|' + e.pos, prev = p.items.get(cell);
        if (prev && prev.added !== added) p.items.delete(cell);                  // 넣었다가 바로 뺐으면(또는 반대) 없던 일로
        else p.items.set(cell, { added, text: added ? `${when} ${e.pos} 배정` : `${when} ${e.pos}에서 빠짐` });
        if (!p.timer) { p.timer = setTimeout(() => flushSched(k), SCHED_WAIT_MS); if (p.timer.unref) p.timer.unref(); }
      }
    }
  } catch (err) { console.error('[스케줄 알림 준비 실패]', err && err.message); }
}
function flushAllSched() { return Promise.all(Array.from(_sched.keys()).map(flushSched)); }

module.exports = { publicKey, subscribe, unsubscribe, hasSub, send, contiSongAdded, flushPending, scheduleChanged, flushAllSched, inbox, contiLink, teamEmails };
