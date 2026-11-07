/**
 * 라이브 악보 메시지 — church-app logic/livemsg.js 를 이 앱(구글 시트 DB · 여러 팀)으로 옮긴 것.
 * ------------------------------------------------------------
 *  · 받는 곳  all   = 찬양팀 전체 (그 날 라이브 악보를 연 모두)
 *             bcast = 방송팀 (그 날 편성의 음향 · PPT · 방송총괄) + 보낸 사람
 *             me    = 나 (기록만 — 아무에게도 보내지 않음)
 *  · 보내면 같은 방(웹소켓 'livemsg')에 바로 알리고, 방송팀 화면(/conti/stage)에도 요청 카드로 띄웁니다 (확인 단추 그대로).
 *  · 탭 '라이브메시지' — 날짜(방) · 시각 · 보낸사람 · 받는곳 · 받는사람 · 내용 · 아이디 · 팀ID. 60일 지난 줄은 보낼 때 정리.
 *  · 객원 링크는 보내기 · 목록 모두 막음 (routes/live.js). 방송팀 보기 링크(읽기 전용)는 목록만 — 방송팀 앞 메시지까지 봅니다.
 */
const sheetsDb = require('./sheetsDb');
const liveStore = require('./liveStore');
const { canonicalPosition } = require('./positions');

const TAB = '라이브메시지';
const TO_LABEL = { all: '찬양팀 전체', bcast: '방송팀', me: '나' };
const MAX = 140, KEEP_DAYS = 60;
const BCAST_POS = new Set(['음향', 'PPT', '방송총괄']);

function roomOf(room) {
  room = String(room || '').trim();
  if (!liveStore.ROOM_RE.test(room)) throw new Error('예배(날짜)를 확인해주세요.');
  return room;
}

/** 그 날 방송팀(편성의 음향 · PPT · 방송총괄) 이름들 */
async function bcastNames(team, room) {
  const scope = liveStore.scopeOfRoom(room);
  const out = [];
  (await sheetsDb.readAll('찬양편성')).forEach((r) => {
    if (r['팀ID'] !== team || !liveStore.inScope(r, scope)) return;
    const pos = canonicalPosition(String(r['포지션'] || '').trim()), n = String(r['이름'] || '').trim();
    if (n && BCAST_POS.has(pos) && !out.includes(n)) out.push(n);
  });
  return out;
}

function clean(r) {
  return { id: String(r['아이디'] || ''), room: String(r['날짜'] || ''), at: Number(r['시각']) || 0, by: String(r['보낸사람'] || ''), to: String(r['받는곳'] || 'all'),
    names: String(r['받는사람'] || '') ? String(r['받는사람']).split(',') : [], text: String(r['내용'] || '') };
}

/** 오래된 줄 정리 (보관 60일) — 실패해도 보내기는 그대로 */
async function sweep(now) {
  try {
    const cut = now - KEEP_DAYS * 86400000;
    const rows = (await sheetsDb.readAll(TAB, { fresh: true })).filter((r) => { const t = Number(r['시각']) || 0; return t && t < cut; }).map((r) => r.__row);
    if (rows.length) await sheetsDb.deleteRows(TAB, rows);
  } catch (e) { /* 정리는 덤 */ }
}

/**
 * 메시지 보내기 — msg = { to:'all'|'bcast'|'me', text } → { item, toLabel, recipients }
 * hooks.live(room, item) · hooks.stage(room, { from, to, text }) 는 실시간 알림 (routes/live.js 가 넣어 줌)
 */
async function send(u, room, msg, hooks) {
  if (u.guest) throw new Error('객원 링크로는 메시지를 보낼 수 없어요.');
  if (u.ro) throw new Error('방송팀 보기 링크는 읽기 전용입니다.');
  room = roomOf(room);
  msg = msg && typeof msg === 'object' ? msg : {};
  const to = TO_LABEL[msg.to] ? String(msg.to) : 'all';
  const text = String(msg.text == null ? '' : msg.text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('보낼 말을 적어 주세요.');
  if (text.length > MAX) throw new Error('메시지는 ' + MAX + '자까지 보낼 수 있어요.');
  const me = String(u.name || '').trim() || '팀원';
  let names = to === 'bcast' ? await bcastNames(u.team, room) : [];
  if (to === 'bcast' && !names.includes(me)) names.push(me);
  if (to === 'me') names = [me];
  const now = Date.now(), id = 'm' + now.toString(36) + Math.random().toString(36).slice(2, 6);
  await sheetsDb.appendRow(TAB, { '날짜': room, '시각': String(now), '보낸사람': me, '받는곳': to, '받는사람': names.join(','), '내용': text, '아이디': id, '팀ID': u.team });
  sweep(now);
  const item = { id, room, at: now, by: me, to, names, text };
  if (to !== 'me' && hooks) {
    try { if (hooks.live) hooks.live(room, item); } catch (e) { /* 알림은 덤 */ }
    try { if (hooks.stage) hooks.stage(room, { from: me, to: to === 'bcast' ? 'bc' : 'team', text, kind: 'live' }); } catch (e) { /* 알림은 덤 */ }
  }
  return { item, toLabel: TO_LABEL[to], recipients: to === 'all' ? null : names.length };
}

/** 그 날 메시지 중 나에게 보이는 것 (최근 순, 최대 40) — 모두에게 · 내가 보낸 것 · 나를 받는 사람으로 지정한 것 (방송팀 보기 링크는 방송팀 앞 것도) */
async function list(u, room) {
  if (u.guest) throw new Error('객원 링크로는 메시지를 볼 수 없어요.');
  room = roomOf(room);
  if (u.ro && u.room && u.room !== room) throw new Error('이 링크로는 해당 예배만 볼 수 있습니다.');
  const me = String(u.name || '').trim();
  const [rows, bc] = await Promise.all([sheetsDb.readAll(TAB), bcastNames(u.team, room)]);
  const items = rows.filter((r) => String(r['팀ID'] || '') === u.team).map(clean)
    .filter((x) => x.room === room && (x.to === 'all' || x.by === me || x.names.includes(me) || (u.ro && x.to === 'bcast')))
    .sort((a, b) => b.at - a.at).slice(0, 40);
  return { me, items, bcastNames: bc };
}

module.exports = { send, list, TAB, TO_LABEL };
