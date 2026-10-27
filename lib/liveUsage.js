/**
 * 라이브 악보 사용 기록 (V1310) — 서버 쪽 모으기 · 저장 · 보기 (허브 · 청년부 앱 공통 파일)
 * ------------------------------------------------------------
 *  화면(public/worship/liveusage.js)이 라이브 악보를 보는 동안 30초마다 { sid, room, label, ms, open, end, dev } 를 보냅니다.
 *   · ms = 지난 신호 뒤로 화면이 "보이던" 시간 (다른 앱 · 화면 꺼짐은 빠짐). 한 번에 90초까지만 믿습니다.
 *   · 서버는 메모리에서 (날짜 · 팀 · 사람 · 콘티) 한 줄로 더해 두었다가 FLUSH_MS 마다 저장소에 한 번에 더해 씁니다
 *     (구글 시트 · Postgres 를 신호마다 건드리지 않게). 저장에 실패하면 다음 번에 다시 더합니다.
 *   · 서버가 다시 켜져도 저장소의 줄에 "더하기" 라 지난 기록은 그대로입니다.
 *  서버가 꺼질 때(server.js 의 shutdown)도 flush() 로 남은 몫을 씁니다.
 *  보관 1년 — 하루 한 번 365일 지난 줄을 지웁니다.
 *  보기 — LIVE_USAGE_OWNER (쉼표로 여러 개, 기본 hanyj123@gmail.com) 이메일로 로그인한 사람만.
 *
 *  create({ identify(token) → {name,email,kind,team}, merge(entries, cutoff), read(from, to) → rows })
 */
'use strict';

const TZ = 'America/Toronto';
const FLUSH_MS = 2 * 60 * 1000;
const KEEP_DAYS = 365;
const MAX_BEAT_MS = 90 * 1000;

function owners() { return String(process.env.LIVE_USAGE_OWNER || 'hanyj123@gmail.com').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean); }
function isOwner(u) { return !!(u && u.email && owners().includes(String(u.email).trim().toLowerCase())); }

const fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
function ymd(t) { return fmtDay.format(new Date(t)); }
function hm(t) { return fmtHm.format(new Date(t)).replace(/^24:/, '00:'); }
function addDays(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n || 80);
const DEVS = { ipad: '아이패드', iphone: '아이폰', atab: '안드로이드 태블릿', aphone: '안드로이드 폰', mac: '맥', pc: '컴퓨터' };

function create(adapter) {
  const pending = new Map();          // key → 아직 저장하지 않은 몫
  const who = new Map();              // token → { u, at } (10분 기억)
  let flushing = null, lastClean = '', timer = null;

  async function identify(token) {
    const k = String(token || '');
    const hit = who.get(k);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.u;
    const u = await adapter.identify(k);
    if (who.size > 2000) who.clear();
    who.set(k, { u, at: Date.now() });
    return u;
  }

  /** 화면의 신호 하나 → { ok, owner } */
  async function beat(token, p) {
    const u = await identify(token);
    p = p && typeof p === 'object' ? p : {};
    const ms = Math.max(0, Math.min(MAX_BEAT_MS, Number(p.ms) || 0));
    const room = clean(p.room, 60);
    const now = Date.now(), day = ymd(now), t = hm(now);
    const ident = String(u.email || u.name || '').toLowerCase();
    if (!ident) return { ok: true, owner: false };
    const key = [day, u.team || '', ident, room].join('|');
    let e = pending.get(key);
    if (!e) {
      e = { 날짜: day, 팀: clean(u.team, 40), 이름: clean(u.name, 40), 이메일: clean(u.email, 120), 구분: clean(u.kind, 12), 콘티: room, 콘티이름: '', 처음: '', 마지막: '', 초: 0, 횟수: 0, 기기: '' };
      pending.set(key, e);
    }
    const startAt = p.open ? t : hm(now - ms);
    if (ms > 0 || p.open) { if (!e.처음 || startAt < e.처음) e.처음 = startAt; if (!e.마지막 || t > e.마지막) e.마지막 = t; }
    e.초 += ms / 1000;
    if (p.open) e.횟수 += 1;
    if (p.label) e.콘티이름 = clean(p.label, 80);
    if (DEVS[p.dev]) e.기기 = DEVS[p.dev];
    return { ok: true, owner: isOwner(u) };
  }

  async function flush() {
    if (flushing) return flushing;
    const today = ymd(Date.now());
    const cutoff = lastClean !== today ? addDays(today, -KEEP_DAYS) : '';
    if (!pending.size && !cutoff) return null;
    const batch = Array.from(pending.values()).map((e) => Object.assign({}, e, { 초: Math.round(e.초) }));
    pending.clear();
    flushing = (async () => {
      try { await adapter.merge(batch, cutoff); if (cutoff) lastClean = today; }
      catch (err) {
        console.error('[liveUsage] 저장 실패 — 다음 번에 다시', err && err.message);
        batch.forEach((b) => {                                  // 몫을 되돌려 다음 번에 다시 더함
          const key = [b.날짜, b.팀 || '', String(b.이메일 || b.이름 || '').toLowerCase(), b.콘티 || ''].join('|');
          const cur = pending.get(key);
          if (!cur) pending.set(key, b);
          else { cur.초 += b.초; cur.횟수 += b.횟수; if (b.처음 && (!cur.처음 || b.처음 < cur.처음)) cur.처음 = b.처음; if (b.마지막 > cur.마지막) cur.마지막 = b.마지막; }
        });
      } finally { flushing = null; }
    })();
    return flushing;
  }

  /** 보기 — 관리자만. { rows, today } (아직 저장 안 된 몫도 더해서) */
  async function list(token, q) {
    const u = await identify(token);
    if (!isOwner(u)) throw new Error('앱 관리자만 볼 수 있어요.');
    q = q && typeof q === 'object' ? q : {};
    const today = ymd(Date.now());
    const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const days = Math.max(1, Math.min(KEEP_DAYS, parseInt(q.days, 10) || 34));
    const to = isDay(q.to) ? q.to : today, from = isDay(q.from) ? q.from : addDays(to, -days);
    await flush().catch(() => {});
    const rows = (await adapter.read(from, to)) || [];
    return {
      today, from, to,
      rows: rows.map((r) => ({ d: r.날짜, team: r.팀, name: r.이름, email: r.이메일, kind: r.구분, room: r.콘티, label: r.콘티이름, first: r.처음, last: r.마지막, sec: Math.round(Number(r.초) || 0), n: Math.round(Number(r.횟수) || 0), dev: r.기기 }))
        .sort((a, b) => (b.d + b.last).localeCompare(a.d + a.last)),
    };
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { flush().catch(() => {}); }, FLUSH_MS);
    if (timer.unref) timer.unref();
  }

  return { beat, list, flush, start, isOwner, _pending: pending };
}

module.exports = { create, isOwner, ymd, hm, addDays };
