/**
 * 라이브 악보 — church-app(청년부 앱, yntoronto.2026 v6)의 "라이브 악보" 화면을 그대로 옮긴 것.
 * ------------------------------------------------------------
 * 화면 코드(public/worship/*.js · hub.css · cues/ · vendor/pdfjs …)는 church-app 파일을 한 글자도 바꾸지 않고 가져왔고,
 * 여기서는 그 화면이 부르는 서버 쪽 약속을 church-app 과 똑같이 맞춰 줍니다.
 *
 *   GET  /conti/practice?team=&date=  (또는 &event=행사ID)   라이브 악보 화면 (YNPractice.open 을 바로 엶)
 *   GET  /sheet/:id                    악보 파일 (같은 출처여야 필기 · PDF 저장이 됨) — 드라이브는 그대로 흘려보내고, 다른 주소는 대신 받아 줌
 *   GET  /audio/:id                    팀 녹음 (키 바꿔 듣기) — 드라이브 녹음만
 *   POST /api/worshipTimerGet · worshipTimerCmd                예배 타이머 (웹소켓이 막혔을 때의 대체 통로, lib/realtime.js 와 같은 상태)
 *   POST /api/worshipAnnoLoad · worshipAnnoSaveMine            필기 읽기 · 나만 보기 필기 저장
 *   POST /api/worshipCfgLoad · worshipCfgSave                  쪽↔곡 연결 · 곡별 메트로놈 · 나만 보는 곡 정보 · 따라가기
 *   POST /api/worshipSongsOf · worshipSongPatch                곡 목록 다시 받기 · BPM/송폼/유튜브 링크 고치기 ('찬양콘티' 그 줄)
 *   모든 /api/* 는 church-app 처럼 { args:[token, …] } → { ok, result } | { ok:false, error } 입니다.
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const week = require('../lib/weekUtil');
const liveStore = require('../lib/liveStore');
const honorific = require('../lib/honorific');
const pageSpec = require('../lib/pageSpec');
const pdfPart = require('../lib/pdfPart');
const guestAccess = require('../lib/guestAccess');
const liveAuth = require('../lib/liveAuth');
const session = require('../lib/session');
const guestLink = require('../lib/guestLink');
const hubApi = require('../lib/hubApi');
const { serviceAuth } = require('../lib/googleAuth');

const router = express.Router();
const esc = pageShell.esc;
const LIVE_V = 'ca83-8';                 // church-app v8.3 화면 파일 — 바꾸면 브라우저가 새로 받음

let rt = null;                           // server.js 가 realtime 을 붙인 뒤 넣어 줌
function setRealtime(x) { rt = x; }

/* ================================================================ 화면 */
async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  req.ctx = ctx;
  next();
}

/** 악보 · 녹음 파일 — 로그인한 팀원, 또는 방송팀 보기 링크로 라이브 악보를 연 브라우저(ph_bview 쿠키 · 그 팀 것만) */
const VIEW_COOKIE = 'ph_bview';
async function fileAccess(req, res, next) {
  let ctx = null;
  if (req.session) ctx = await teamContext.resolve(req).catch(() => null);
  let viewTeam = null;
  try {
    const d = session.verifyState(session.parseCookies(req)[VIEW_COOKIE], liveAuth.MAX_AGE_MS);
    if (d && d.k === 'bview' && d.t) viewTeam = await guestLink.teamOf(d.t);       // 링크를 새로 바꾸면 바로 막힘
  } catch (e) { viewTeam = null; }
  if (!ctx && !viewTeam) return req.session ? res.redirect('/logout') : res.status(401).send('로그인이 필요합니다.');
  req.ctx = ctx ? Object.assign({}, ctx, { teams: viewTeam && !ctx.teams.includes(viewTeam) ? ctx.teams.concat(viewTeam) : ctx.teams }) : { teams: [viewTeam] };
  next();
}
/** 방송팀 보기 링크로 연 브라우저에 파일 열람 쿠키를 심음 */
function grantView(res, token) { session.setCookie(res, VIEW_COOKIE, session.signState({ k: 'bview', t: token }), liveAuth.MAX_AGE_MS); }

function sheetName(s, songTitle) {
  const t = String(s['제목'] || '').trim() || '악보';
  return songTitle && t.indexOf(songTitle) < 0 ? `${songTitle} — ${t}` : t;
}

/** 이 예배(범위)의 악보 · 곡 · 녹음 — church-app 허브의 openPractice() 가 만들던 것과 같은 모양 */
async function liveData(team, scope) {
  const [songRows, sheetRows, recRows] = await Promise.all([sheetsDb.readAll('찬양콘티'), sheetsDb.readAll('악보저장소'), sheetsDb.readAll('녹음')]);
  const room = liveStore.roomOf(scope);
  const songs = await liveStore.songsOf(team, room);
  const { conti, fin } = liveStore.orderedSongs(songRows, team, scope);      // 콘티 화면과 같은 순서
  const ordered = conti.concat(fin);
  const titleById = new Map(ordered.map((r) => [r['ID'], String(r['제목'] || '')]));
  const orderById = new Map(ordered.map((r, i) => [r['ID'], i]));
  const sheets = sheetRows.filter((s) => s['팀ID'] === team && liveStore.inScope(s, scope) && s['파일링크'])
    .map((s) => ({ s, ord: s['곡ID'] && orderById.has(s['곡ID']) ? orderById.get(s['곡ID']) : 1000, at: String(s['올린시각'] || '') }))
    .sort((a, b) => a.ord - b.ord || a.at.localeCompare(b.at));
  // 같은 파일(악보 id)은 한 번만 — 대표 줄은 "쪽"이 없는 줄(패키지 · 곡 전체 악보) 우선. 곡별로 저장해 둔 쪽 범위(쪽)는 쪽 ↔ 곡 연결의 기본값(map)으로
  const byFile = new Map();
  sheets.forEach((x) => { const id = liveStore.sheetIdOf(team, x.s['파일링크']); (byFile.get(id) || byFile.set(id, []).get(id)).push(x.s); });
  const list = [];
  byFile.forEach((rows, id) => {
    const rep = rows.find((r) => !String(r['쪽'] || '').trim()) || rows[0];
    const whole = !String(rep['쪽'] || '').trim();
    const map = {};
    rows.forEach((r) => {
      const idx = orderById.get(r['곡ID']);
      if (idx == null) return;
      pageSpec.specToRanges(r['쪽']).forEach(([a]) => { map[a] = idx; });                       // 그 곡 쪽 범위의 첫 쪽부터 그 곡
    });
    const item = { id, name: whole ? sheetName(rep, titleById.get(rep['곡ID']) || '') : sheetName(rep, '') };
    if (Object.keys(map).length) item.map = map;
    list.push(item);
  });
  const recs = recRows.filter((r) => r['팀ID'] === team && liveStore.inScope(r, scope))
    .map((r) => ({ id: liveStore.driveIdOf(r['링크']), r })).filter((x) => x.id)
    .map(({ id, r }) => ({ title: String(r['제목'] || '녹음'), play: '/audio/' + id, kind: String(r['구분'] || ''), by: String(r['올린사람'] || '') }));
  return { room, songs, sheets: list, recs };
}

async function eventFor(team, id) {
  if (!id) return null;
  const rows = await sheetsDb.readAll('특별예배');
  return rows.find((r) => r['팀ID'] === team && r['ID'] === id) || null;
}

router.get(['/conti/practice', '/conti/live'], requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  if (!team) return res.redirect('/conti');
  const ev = await eventFor(team, String(req.query.event || '').trim());
  const date = ev ? ev['날짜'] : week.normalizeDate(req.query.date);
  const back = ev ? `/conti?team=${encodeURIComponent(team)}&event=${encodeURIComponent(ev['ID'])}` : `/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}`;
  if (guestAccess.isGuest(ctx.member)) await guestAccess.prime(ctx.member, team);     // 객원 멤버 — 이 방(서는 날)을 소켓이 알도록
  return renderLive(req, res, { team, ev, date, back, member: ctx.member, isAdmin: ctx.isAdmin, ro: false });
});

/** 라이브 악보 화면 — 로그인한 팀원(고칠 수 있음)과 방송팀 보기 링크(읽기 전용, routes/guest.js)가 함께 씀 */
async function renderLive(req, res, o) {
  const { team, ev, date, back } = o;
  const scope = { event: ev ? ev['ID'] : '', date };
  const d = await liveData(team, scope);

  if (!d.sheets.length) {
    const content = `<div class="ph-card"><h2 class="ph-h2">라이브 악보</h2>
      <p class="ph-sub">열 수 있는 악보가 없어요. 먼저 예배콘티에서 악보(PDF · 사진)를 올려주세요.</p>
      <a class="ph-btn" href="${esc(back)}">← 예배콘티로</a></div>`;
    return res.type('html').send(await pageShell.render(content, { title: `${team} 라이브 악보` }));
  }

  const start = String(req.query.sheet || '').trim();
  const boot = {
    token: o.ro ? liveAuth.mintView(team, d.room) : liveAuth.mint(o.member, team, o.isAdmin), room: d.room, me: o.ro ? '방송팀' : String(o.member['이름'] || ''), ro: !!o.ro,
    pastors: Array.from(await honorific.pastorSet(team)),
    sheets: d.sheets, songs: d.songs, recs: d.recs, start: d.sheets.some((s) => s.id === start) ? start : d.sheets[0].id, back,
  };
  const v = `?v=${LIVE_V}`;
  const title = `${team} · ${ev ? ev['이름'] : week.labelKo(date)} 라이브 악보`;
  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0A1311">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="application-name" content="YN찬양팀Hub">
<meta name="apple-mobile-web-app-title" content="YN찬양팀Hub">
<title>${esc(title)}</title>
<link rel="manifest" href="/site.webmanifest">
<link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<script>(function(){try{var t=localStorage.getItem('ph.theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<link rel="stylesheet" href="/worship/live-base.css${v}">
<link rel="stylesheet" href="/worship/hub.css${v}">
<style>
  html, body { min-height: 100%; }
  .lv-fallback { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; max-width: 520px; margin: 18vh auto 0; padding: 0 20px; text-align: center; }
  .lv-fallback a { color: #F4A272; font-weight: 700; }
</style>
</head>
<body>
<div class="lv-fallback" id="lvFallback"><p>라이브 악보를 여는 중…</p><p><a href="${esc(back)}">← 예배콘티로 돌아가기</a></p></div>
<script>window.__LIVE__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
<script>(function(){var P={};((window.__LIVE__||{}).pastors||[]).forEach(function(n){P[n]=1});
window.YNHon={name:function(n){n=String(n||'');return P[n.trim()]?n+' 목사':n},say:function(n){n=String(n||'');return P[n.trim()]?n+' 목사가':n+' 님이'}};})();</script>
<script defer src="/socket.io/socket.io.js"></script>
<script defer src="/worship/icons.js${v}"></script>
<script defer src="/worship/icons-plus.js${v}"></script>
<script defer src="/worship/formb.js${v}"></script>
<script defer src="/worship/wakelock.js${v}"></script>
<script defer src="/worship/metro.js${v}"></script>
<script defer src="/worship/pitch.js${v}"></script>
<script defer src="/worship/harmony-core.js${v}"></script>
<script defer src="/worship/omr.js${v}"></script>
<script defer src="/worship/harmony-ui.js${v}"></script>
<script defer src="/worship/audio-shift.js${v}"></script>
<script defer src="/worship/ytplayer.js${v}"></script>
<script defer src="/worship/rt.js${v}"></script>
<script defer src="/worship/timer.js${v}"></script>
<script defer src="/worship/anno.js${v}"></script>
<script defer src="/worship/practice-panels.js${v}"></script>
<script defer src="/worship/practice.js${v}"></script>
<script defer src="/js/offline.js${v}"></script>
<script defer src="/js/live-boot.js${v}"></script>
</body>
</html>`);
}

/* ================================================================ 악보 · 녹음 파일 */
const BYTES = new Map();                         // id → { buf, type, at } — 최근 악보 몇 개는 메모리에 (church-app 의 memory:true)
const BYTES_MAX = 8, BYTES_ONE_MAX = 30 * 1024 * 1024;
function bytesPut(id, rec) {
  if (rec.buf.length > BYTES_ONE_MAX) return;
  BYTES.delete(id); BYTES.set(id, rec);
  while (BYTES.size > BYTES_MAX) BYTES.delete(BYTES.keys().next().value);
}
async function driveFetch(id, range) {
  const { token } = await serviceAuth().getAccessToken();
  const headers = { Authorization: 'Bearer ' + token };
  if (range) headers.Range = range;
  return fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers });
}
function pipeWeb(res, r, cacheControl) {
  res.status(r.status);
  ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'].forEach((h) => { const v = r.headers.get(h); if (v) res.setHeader(h, v); });
  if (!r.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
  res.setHeader('cache-control', cacheControl);
  const { Readable } = require('stream');
  Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
}

/** 악보 한 개의 바이트 — 메모리 캐시 → 드라이브 / 외부 주소. 실패하면 { status, msg } 를 던짐 */
async function sheetBytes(id, hit) {
  const cached = BYTES.get(id);
  if (cached) { BYTES.delete(id); BYTES.set(id, cached); return cached; }
  const driveId = liveStore.driveIdOf(hit['파일링크']);
  const r = driveId ? await driveFetch(driveId) : await fetch(hit['파일링크'], { redirect: 'follow' });
  if (!r.ok || !r.body) throw Object.assign(new Error('원본 악보를 불러오지 못했습니다.'), { status: r.status === 404 ? 404 : 502 });
  const rec = { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'application/octet-stream' };
  bytesPut(id, rec);
  return rec;
}
async function sheetRowFor(req, id) {
  const rows = await sheetsDb.readAll('악보저장소');
  return rows.find((s) => req.ctx.teams.includes(s['팀ID']) && s['파일링크'] && liveStore.sheetIdOf(s['팀ID'], s['파일링크']) === id) || null;
}

router.get('/sheet/:id', fileAccess, async (req, res) => {
  const id = String(req.params.id || '');
  if (!liveStore.FILE_RE.test(id)) return res.status(404).send('not found');
  try {
    const hit = await sheetRowFor(req, id);
    if (!hit) return res.status(404).send('not found');
    const rec = await sheetBytes(id, hit);
    res.set({ 'Content-Type': rec.type, 'Content-Length': String(rec.buf.length), 'Cache-Control': 'private, max-age=600' });
    res.send(rec.buf);
  } catch (e) {
    console.error('[악보 파일]', id, e && e.message);
    if (!res.headersSent) res.status(e && e.status || 502).send('원본 악보를 불러오지 못했습니다.');
  }
});

/** 패키지 악보에서 한 곡의 쪽만 담은 PDF — /sheet/<악보id>/part?p=3-5,8 (곡별 악보로 저장해 둔 줄을 열 때). PDF 가 아니거나 쪽이 맞지 않으면 원본 그대로 */
const PARTS = new Map(), PARTS_MAX = 40;
router.get('/sheet/:id/part', fileAccess, async (req, res) => {
  const id = String(req.params.id || '');
  if (!liveStore.FILE_RE.test(id)) return res.status(404).send('not found');
  const spec = pageSpec.cleanSpec(req.query.p);
  try {
    const hit = await sheetRowFor(req, id);
    if (!hit) return res.status(404).send('not found');
    const rec = await sheetBytes(id, hit);
    let out = null;
    if (spec && pdfPart.isPdf(rec.buf)) {
      const key = id + '|' + spec + '|' + rec.buf.length;
      out = PARTS.get(key) || null;
      if (!out) {
        out = await pdfPart.extract(rec.buf, spec);
        if (out) { PARTS.set(key, out); while (PARTS.size > PARTS_MAX) PARTS.delete(PARTS.keys().next().value); }
      }
    }
    const name = String(req.query.n || hit['제목'] || '악보').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || '악보';
    res.set({
      'Content-Type': out ? 'application/pdf' : rec.type, 'Content-Length': String((out || rec.buf).length), 'Cache-Control': 'private, max-age=600',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name + (out ? ' (' + spec + '쪽)' : ''))}${out || /pdf/i.test(rec.type) ? '.pdf' : ''}`,
    });
    res.send(out || rec.buf);
  } catch (e) {
    console.error('[악보 일부]', id, e && e.message);
    if (!res.headersSent) res.status(e && e.status || 502).send('악보를 불러오지 못했습니다.');
  }
});

router.get('/audio/:id', fileAccess, async (req, res) => {
  const id = String(req.params.id || '');
  if (!liveStore.FILE_RE.test(id)) return res.status(404).send('not found');
  try {
    const rows = await sheetsDb.readAll('녹음');
    const hit = rows.find((r) => req.ctx.teams.includes(r['팀ID']) && liveStore.driveIdOf(r['링크']) === id);
    if (!hit) return res.status(404).send('not found');
    const r = await driveFetch(id, req.headers.range);
    if (!r.ok && r.status !== 206) return res.status(r.status).send('drive error');
    pipeWeb(res, r, 'private, max-age=3600');
  } catch (e) {
    console.error('[녹음 파일]', id, e && e.message);
    if (!res.headersSent) res.status(500).send('error');
  }
});

/* ================================================================ /api/* (church-app 의 callServer 약속) */
function timerRoute(kind) {
  return (req, res) => {
    const args = Array.isArray(req.body && req.body.args) ? req.body.args : [];
    res.set('Cache-Control', 'no-store');
    if (!rt) return res.json({ ok: false, error: '실시간 서버가 준비되지 않았습니다.' });
    try { res.json(rt.timerHttp(kind, args)); } catch (e) {
      console.error('[worshipTimer]', kind, e && e.message);
      res.json({ ok: false, error: (e && e.message) || '처리하지 못했습니다.' });
    }
  };
}
router.post('/api/worshipTimerGet', timerRoute('get'));
router.post('/api/worshipTimerCmd', timerRoute('cmd'));

const splitChains = new Map();
function serialSplit(key, fn) {
  const prev = splitChains.get(key) || Promise.resolve();
  const job = prev.catch(() => {}).then(fn);
  splitChains.set(key, job);
  return job.finally(() => { if (splitChains.get(key) === job) splitChains.delete(key); });
}

const FNS = {
  /** 필기 읽기 → { team, mine, me, canEdit } (mineOnly 면 team: null — 실시간 서버에서 따로 받음) */
  async worshipAnnoLoad(u, file, scope, mineOnly) {
    await liveStore.loadAnnos();
    return { team: mineOnly ? null : liveStore.readLayer(u.team, file, scope, '*'), mine: liveStore.readLayer(u.team, file, scope, u.name), me: u.name, canEdit: !!u.canEdit };
  },
  /** 나만 보기 필기 저장 */
  async worshipAnnoSaveMine(u, file, scope, items) {
    if (!Array.isArray(items)) throw new Error('필기 형식이 올바르지 않습니다.');
    if (JSON.stringify(items).length > liveStore._internals.CHUNK * 4) throw new Error('필기가 너무 많습니다. 일부를 지운 뒤 저장해주세요.');
    await liveStore.loadAnnos();
    liveStore.writeLayer(u.team, file, scope, u.name, items, u.name);
    return { ok: true, n: items.length };
  },
  /** 연습 화면을 열 때 — 팀 설정 · 내 설정 · 최신 곡 목록 */
  async worshipCfgLoad(u, room) {
    const [team, mine, songs] = await Promise.all([liveStore.cfgRead(u.team, room, '*'), liveStore.cfgRead(u.team, room, u.name), liveStore.songsOf(u.team, room)]);
    return { team, mine, songs, me: u.name, canEdit: !!u.canEdit };
  },
  /** 설정 하나 저장 — team 층은 팀 모두에게 실시간 전달 */
  async worshipCfgSave(u, room, layer, kind, key, value, cid) {
    kind = String(kind || '');
    layer = layer === 'mine' ? 'mine' : 'team';
    if (layer === 'team') {
      if (!u.canEdit) throw new Error('팀 전체에 공유되는 설정은 팀장 · 인도자만 바꿀 수 있습니다. ("나만 보기" 를 켜면 내 설정으로 저장됩니다)');
      if (kind === 'song') throw new Error('곡 정보는 "곡 정보 저장" 으로 바꿔주세요.');
      if (kind === 'follow') throw new Error('따라가기 설정은 나만 저장할 수 있습니다.');
    }
    const clean = await liveStore.cfgSave(u.team, room, layer === 'team' ? '*' : u.name, kind, key, value, u.name);
    key = liveStore._internals.cfgKey(kind, key);
    if (layer === 'team' && rt) rt.broadcast(room, 'cfg', { kind, key, value: clean, by: u.name, cid: String(cid || '').slice(0, 40), layer: 'team' }, u.team);
    return { ok: true, layer, kind, key, value: clean, by: u.name };
  },
  /** 라이브 악보에서 정한 "쪽 ↔ 곡" 을 곡별 악보로 저장 — byIdx = { '곡 번호(0부터)': [쪽, 쪽, …] }.
   *  이 예배의 그 악보 파일(패키지)을 곡마다 "곡ID + 쪽 범위" 줄로 저장해 두면, 콘티 · 라이브러리에서 곡 악보로 쓰이고
   *  다른 주 콘티로 곡을 가져올 때 쪽 범위도 함께 따라가며 라이브 악보에서 쪽 ↔ 곡이 자동으로 연결됩니다. 다시 저장하면 이전 저장을 바꿔 놓습니다. */
  async worshipSheetSplit(u, room, fileId, byIdx) {
    if (!u.canEdit) throw new Error('곡별 악보 저장은 팀장 · 인도자만 할 수 있습니다.');
    const scope = liveStore.scopeOfRoom(room);
    fileId = String(fileId || '').trim();
    if (!fileId || !byIdx || typeof byIdx !== 'object') throw new Error('저장할 내용이 없습니다.');
    return serialSplit(u.team + '\u0001' + room, async () => {
      const [songRows, sheetRows] = await Promise.all([sheetsDb.readAll('찬양콘티', { fresh: true }), sheetsDb.readAll('악보저장소', { fresh: true })]);
      const { conti, fin } = liveStore.orderedSongs(songRows, u.team, scope);
      const ordered = conti.concat(fin);
      const here = sheetRows.filter((r) => r['팀ID'] === u.team && liveStore.inScope(r, scope) && r['파일링크'] && liveStore.sheetIdOf(u.team, r['파일링크']) === fileId);
      const src = here.find((r) => !String(r['쪽'] || '').trim()) || here[0];
      if (!src) throw new Error('이 예배에서 그 악보를 찾지 못했습니다. 화면을 새로 열어주세요.');
      const plan = [];
      Object.keys(byIdx).forEach((k) => {
        const i = Number(k), row = Number.isInteger(i) ? ordered[i] : null, pages = pageSpec.cleanPages(byIdx[k]);
        if (row && pages.length) plan.push({ i, row, pages, spec: pageSpec.pagesToSpec(pages) });
      });
      if (!plan.length) throw new Error('곡에 연결된 쪽이 없습니다. 먼저 "이 쪽부터 곡 선택" 으로 쪽을 곡에 연결해주세요.');
      plan.sort((a, b) => a.i - b.i);
      // 이 파일의 이전 곡별 저장(쪽 있는 줄)은 지우고 새로
      const olds = here.filter((r) => String(r['쪽'] || '').trim()).sort((a, b) => b.__row - a.__row);
      for (const r of olds) await sheetsDb.deleteRow('악보저장소', r.__row);
      const base = Date.now().toString(36);
      for (let n = 0; n < plan.length; n++) {
        const p = plan[n];
        await sheetsDb.appendRow('악보저장소', {
          'ID': 'F' + base + n + Math.random().toString(36).slice(2, 4), '팀ID': u.team, '날짜': src['날짜'] || '', '행사ID': src['행사ID'] || '', '제목': String(src['제목'] || '악보'),
          '파일링크': src['파일링크'], '올린사람': u.name, '올린시각': new Date().toISOString(), '곡ID': p.row['ID'],
          'Key': String(p.row['Key'] || ''), 'BPM': String(p.row['BPM'] || ''), '인도자': '', '쪽수': p.pages.length, '메모': '', '저장소날짜': '', '쪽': p.spec,
        });
      }
      songsChanged(u.team, scope, 'saveSheetSplit');
      return { ok: true, replaced: olds.length, songs: plan.map((p) => ({ title: String(p.row['제목'] || ''), pages: p.spec })) };
    });
  },
  async worshipSongsOf(u, room) { return { songs: await liveStore.songsOf(u.team, room) }; },
  /** 곡 정보(BPM · 송폼 · 유튜브 링크) 일부만 고치기 — 예배콘티의 그 곡 줄이 바뀝니다. 팀 모두에게 실시간 전달 */
  async worshipSongPatch(u, room, kind, seq, patch, cid) {
    if (!u.canEdit) throw new Error('곡 정보는 팀장 · 인도자만 바꿀 수 있습니다.');
    const r = await liveStore.songPatch(u.team, room, kind, seq, patch);
    if (rt) rt.broadcast(room, 'song', { kind: r.song.kind, seq: r.song.seq, patch: r.patch, by: u.name, cid: String(cid || '').slice(0, 40) }, u.team);
    return { ok: true, song: r.song, patch: r.patch, by: u.name };
  },
};

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
router.post('/api/:fn', async (req, res) => {
  const fn = req.params.fn;
  const args = Array.isArray(req.body && req.body.args) ? req.body.args : [];
  res.set('Cache-Control', 'no-store');
  // 라이브 악보(FNS) + 스케줄표 · 라이브러리(lib/hubApi.js) — 둘 다 church-app callServer 약속
  const table = own(FNS, fn) ? FNS : (own(hubApi.FNS, fn) ? hubApi.FNS : null);
  if (!table) return res.json({ ok: false, error: '알 수 없는 요청입니다: ' + fn });
  try {
    const u = liveAuth.verify(args[0]);
    const rest = args.slice(1);
    if (u.ro) {                                           // 방송팀 보기 링크 — 그 예배의 악보 · 필기 · 곡 정보 읽기만
      const RO_OK = { worshipAnnoLoad: -1, worshipCfgLoad: 0, worshipSongsOf: 0 };
      if (!own(RO_OK, fn)) throw new Error('방송팀 보기 링크는 읽기 전용입니다.');
      if (RO_OK[fn] >= 0 && String(rest[RO_OK[fn]] || '') !== u.room) throw new Error('이 링크로는 해당 예배의 라이브 악보만 볼 수 있습니다.');
    }
    if (u.guest) {                                        // 객원 멤버 — 서는 날의 라이브 악보 · 필기 · 설정과 스케줄 보기만
      await guestAccess.ensure(u);
      const ROOM_AT = { worshipAnnoLoad: 1, worshipAnnoSaveMine: 1, worshipCfgLoad: 0, worshipCfgSave: 0, worshipSongsOf: 0, worshipSongPatch: 0, worshipSheetSplit: 0 };
      if (own(ROOM_AT, fn)) { if (!guestAccess.roomOk(u, rest[ROOM_AT[fn]])) throw new Error('객원 멤버는 스케줄에 서는 날만 열 수 있습니다.'); }
      else if (!['worshipSchedule', 'setMyUnavailableMany', 'removeMyUnavailable'].includes(fn)) throw new Error('객원 멤버는 쓸 수 없는 기능입니다.');
    }
    if (fn === 'worshipRepoSongUse') rest.length = 4, rest.push((team, sc) => songsChanged(team, sc, 'saveWorshipSongs'));   // 콘티에 곡을 넣으면 열린 라이브 악보에 알림
    const result = await table[fn](u, ...rest);
    res.json({ ok: true, result });
  } catch (e) {
    if (!(e && e.message && /[가-힣]/.test(e.message))) console.error('[' + fn + ']', e);
    res.json({ ok: false, error: (e && e.message) || String(e) });
  }
});

/** 예배콘티에서 곡을 저장 · 삭제하면 열려 있는 라이브 악보가 곡 목록을 다시 받도록 (church-app 의 songs:changed) */
function songsChanged(team, scope, fn) {
  try { if (rt) rt.broadcast(liveStore.roomOf(scope), 'songs:changed', { t: Date.now(), fn: fn || '' }, String(team || '').trim()); } catch (e) { /* 알림은 덤 */ }
}

module.exports = router;
module.exports.setRealtime = setRealtime;
module.exports.songsChanged = songsChanged;
module.exports.FNS = FNS;
module.exports.renderLive = renderLive;
module.exports.grantView = grantView;
module.exports.liveData = liveData;
