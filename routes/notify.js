/**
 * 알림 (종 아이콘) — 화면은 public/js/notify.js
 *   GET  /notify/state?team=        받은 알림 · 보낼 수 있는 악보 · 푸시 공개키
 *   POST /notify/subscribe          이 기기에서 알림 받기 켜기
 *   POST /notify/unsubscribe        이 기기 알림 끄기
 *   POST /notify/send               알림 보내기 (악보를 골라서 / 직접 적어서)
 */
const express = require('express');
const notify = require('../lib/notify');
const teamContext = require('../lib/teamContext');
const guestAccess = require('../lib/guestAccess');
const router = express.Router();

const lastSend = new Map();          // 이메일 → 마지막으로 보낸 시각 (실수로 연달아 누르는 것 막기)

async function me(req, res) {
  if (!req.session) { res.status(401).json({ ok: false, error: '로그인이 필요해요.' }); return null; }
  const ctx = await teamContext.resolve(req);
  if (!ctx || !ctx.member) { res.status(401).json({ ok: false, error: '로그인이 필요해요.' }); return null; }
  return ctx;
}
const fail = (res, e, code) => { console.error('[알림]', e && e.message); res.status(code || 500).json({ ok: false, error: (e && e.expose && e.message) || '알림을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }); };

router.get('/notify/state', async (req, res) => {
  try {
    const ctx = await me(req, res); if (!ctx) return;
    const team = ctx.current;
    const guest = guestAccess.isGuest(ctx.member);
    const [key, items, pending] = await Promise.all([
      notify.publicKey().catch(() => ''),
      team ? notify.inbox(team) : [],
      team && !guest ? notify.pendingSheets(team) : [],
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, key, team, items, pending, canSend: !!team && !guest, subscribed: await notify.hasSub(String(ctx.member['이메일']).toLowerCase(), String(req.query.ep || '')).catch(() => false) });
  } catch (e) { fail(res, e); }
});

router.post('/notify/subscribe', async (req, res) => {
  try {
    const ctx = await me(req, res); if (!ctx) return;
    await notify.subscribe(String(ctx.member['이메일']).toLowerCase(), (req.body || {}).subscription, req.get('user-agent'));
    res.json({ ok: true });
  } catch (e) { e.expose = /올바르지/.test(e.message); fail(res, e, e.expose ? 400 : 500); }
});

router.post('/notify/unsubscribe', async (req, res) => {
  try {
    const ctx = await me(req, res); if (!ctx) return;
    await notify.unsubscribe(String(ctx.member['이메일']).toLowerCase(), String((req.body || {}).endpoint || ''));
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.post('/notify/send', async (req, res) => {
  try {
    const ctx = await me(req, res); if (!ctx) return;
    const b = req.body || {};
    const team = String(b.team || '').trim();
    if (!team || !ctx.teams.includes(team) || guestAccess.isGuest(ctx.member)) return res.status(403).json({ ok: false, error: '이 팀에는 알림을 보낼 수 없어요.' });
    const email = String(ctx.member['이메일']).toLowerCase();
    if (Date.now() - (lastSend.get(email) || 0) < 8000) return res.status(429).json({ ok: false, error: '방금 보냈어요. 잠시 후 다시 눌러 주세요.' });
    const ids = Array.from(new Set([].concat(b.ids || []).map((x) => String(x))))
      .slice(0, 30);
    const note = String(b.message || '').trim().slice(0, 140);
    const by = String(ctx.member['이름'] || '');
    let n;
    if (ids.length) {
      const all = await notify.pendingSheets(team);
      const picked = all.filter((s) => ids.indexOf(s.id) >= 0);
      if (!picked.length) return res.status(400).json({ ok: false, error: '고른 악보를 찾지 못했어요. 목록을 새로 불러와 주세요.' });
      const first = picked[0];
      const titles = picked.slice(0, 4).map((s) => s.title.replace(/\.(pdf|png|jpe?g)$/i, '')).join(', ') + (picked.length > 4 ? ` 외 ${picked.length - 4}개` : '');
      n = {
        kind: '악보', title: '악보가 업데이트됐어요', body: note ? `${titles} — ${note}` : titles,
        url: notify.contiLink(team, first.event ? { event: first.event } : { date: first.date }), targets: picked.map((s) => s.id),
      };
    } else if (note) {
      n = { kind: '직접', title: '찬양팀 알림', body: note, url: notify.contiLink(team, {}) };
    } else return res.status(400).json({ ok: false, error: '보낼 악보를 고르거나 메시지를 적어 주세요.' });
    lastSend.set(email, Date.now());
    const r = await notify.send(team, Object.assign(n, { by, byEmail: email }));
    res.json({ ok: true, sent: r.sent, people: r.people, failed: r.failed });
  } catch (e) { fail(res, e); }
});

if (process.env.NODE_ENV === 'test') router.__resetLimit = () => lastSend.clear();      // 시험에서만
module.exports = router;
