/**
 * 드라이브 — 미디어팀 NAS(Synology) 의 파일을 앱 안에서 둘러보고 바로 열기 (영상 · 음악 · 사진 · PDF),
 * 그리고 녹음 · 영상 파일을 날짜별 예배콘티의 "연습 녹음" · "예배 녹음" 으로 연결하기.
 *   GET  /drive?p=/…[&to=날짜|ev:행사ID]  폴더 목록 (to 가 있으면 "이 예배에 연결" 모드 — 콘티의 "드라이브에서 고르기")
 *   GET  /drive/file?p=/…/파일[&dl=1]     파일 열기 (Range 지원 — 영상 · 음악 건너뛰기) · dl=1 이면 내려받기
 *   POST /drive/link                      파일을 그 예배의 녹음으로 연결 → '녹음' 시트에 링크 "nas:/…" 한 줄 (지우기는 콘티 녹음 칸의 ✕)
 * 연결된 녹음은 콘티 · 라이브 악보 · 라이브러리 아카이브에서 이 앱의 녹음 플레이어(public/js/recplayer.js)로 재생됩니다.
 * 로그인한 팀원만. 객원 멤버는 드라이브 화면은 못 열고, 자기 팀 콘티에 연결된 파일만 재생할 수 있습니다 (lib/guestGate.js).
 */
const express = require('express');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const ui = require('../lib/uiIcons');
const sheetsDb = require('../lib/sheetsDb');
const week = require('../lib/weekUtil');
const guestAccess = require('../lib/guestAccess');
const nas = require('../lib/nas');

const router = express.Router();
const esc = pageShell.esc;
const LINKABLE = ['audio', 'video'];                    // 녹음으로 연결할 수 있는 파일

async function requireMember(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  req.ctx = ctx;
  next();
}

function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
}
function fmtDate(sec) {
  if (!sec) return '';
  return new Date(sec * 1000).toLocaleDateString('sv-SE', { timeZone: 'America/Toronto' });      // 2026-10-17
}
/** 그 날짜(포함) 이후 첫 주일 — 금요일 연습 녹음도 그 주 주일 콘티로 */
function sundayOf(ymd) {
  if (!week.isValidDateStr(ymd)) return week.normalizeDate('');
  const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d.toISOString().slice(0, 10);
}
const ICON = { video: 'play', audio: 'headphones', image: 'image', pdf: 'link', '': 'download' };
const KIND_LABEL = { video: '영상', audio: '음악', image: '사진', pdf: 'PDF' };
const fileHref = (p, dl) => '/drive/file?p=' + encodeURIComponent(p) + (dl ? '&dl=1' : '');
const baseTitle = (name) => String(name || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '녹음';

/* ---------------------------------------------------------------- 연결할 예배 (to=2026-10-18 | to=ev:행사ID) */
async function scopeOfTo(team, to) {
  to = String(to || '').trim();
  if (!to) return null;
  if (to.indexOf('ev:') === 0) {
    const id = to.slice(3);
    const ev = (await sheetsDb.readAll('특별예배')).find((e) => e['팀ID'] === team && String(e['ID']) === id);
    return ev ? { event: id, date: String(ev['날짜'] || ''), label: `${ev['이름'] || '주일 외 찬양'} · ${week.shortKo(ev['날짜'])}`, to } : null;
  }
  return week.isValidDateStr(to) ? { event: '', date: to, label: `${week.shortKo(to, true)} 주일예배`, to } : null;
}
const scopeLabel = (r, evById) => (r['행사ID'] ? `${(evById.get(r['행사ID']) || {})['이름'] || '행사'} ${week.shortKo(r['날짜'])}` : week.shortKo(r['날짜'], true));

/* ---------------------------------------------------------------- 화면 조각 */
function crumbs(p, to) {
  const href = (x) => linkTo(x, to);
  const top = nas.topPath();
  const parts = p ? p.split('/').filter(Boolean) : [];
  const topParts = top ? top.split('/').filter(Boolean).length : 0;
  const out = [`<a href="${esc(href(''))}">드라이브</a>`];
  let acc = '';
  parts.forEach((seg, i) => {
    acc += '/' + seg;
    if (i < topParts) return;                                            // NAS_ROOT 까지는 "드라이브" 하나로
    out.push(i === parts.length - 1 ? `<b>${esc(seg)}</b>` : `<a href="${esc(href(acc))}">${esc(seg)}</a>`);
  });
  return `<nav class="dv-crumbs" aria-label="폴더 위치">${out.join('<span class="dv-sep">/</span>')}</nav>`;
}
function linkTo(p, to) {
  const q = new URLSearchParams();
  if (p && p !== nas.topPath()) q.set('p', p);
  if (to) q.set('to', to);
  const s = q.toString();
  return '/drive' + (s ? '?' + s : '');
}

function row(x, o) {
  if (x.dir) {
    return `<a class="dv-row dir" href="${esc(linkTo(x.path, o.to && o.to.to))}" data-name="${esc(x.name.toLowerCase())}">
      <span class="dv-ic">${ui.icon('folder')}</span><span class="dv-main"><span class="dv-name">${esc(x.name)}</span>${x.mtime ? `<span class="dv-sub">${esc(fmtDate(x.mtime))}</span>` : ''}</span><span class="dv-go">›</span></a>`;
  }
  const kind = nas.kindOf(x.name);
  const linked = o.linked.get(x.path) || [];
  const sub = [KIND_LABEL[kind] || (nas.extOf(x.name) || '파일').toUpperCase(), fmtSize(x.size), fmtDate(x.mtime)].filter(Boolean).join(' · ');
  const open = kind
    ? `<a class="dv-open" href="${esc(fileHref(x.path))}" target="_blank" rel="noopener" data-dv-open="${esc(kind)}" data-dv-src="${esc(fileHref(x.path))}" data-dv-dl="${esc(fileHref(x.path, true))}" data-dv-title="${esc(x.name)}">`
    : `<a class="dv-open" href="${esc(fileHref(x.path, true))}">`;
  const canLink = LINKABLE.includes(kind);
  const linkBtn = canLink
    ? `<button type="button" class="dv-linkbtn${o.to ? ' pri' : ''}" data-dv-link="${esc(x.path)}" data-dv-name="${esc(x.name)}" data-dv-title-def="${esc(baseTitle(x.name))}" data-dv-date="${esc(sundayOf(fmtDate(x.mtime)))}" data-dv-kind="${/예배|service|worship/i.test(x.name) ? '예배' : '연습'}">${o.to ? '이 예배에 연결' : '콘티에 연결'}</button>`
    : '';
  return `<div class="dv-row file" data-name="${esc(x.name.toLowerCase())}">${open}<span class="dv-ic k-${esc(kind || 'other')}">${ui.icon(ICON[kind])}</span><span class="dv-main"><span class="dv-name">${esc(x.name)}</span><span class="dv-sub">${esc(sub)}</span>${linked.length ? `<span class="dv-linked">연결됨 · ${linked.map((l) => esc(l.label)).join(', ')}</span>` : ''}</span><span class="dv-play">${kind === 'video' || kind === 'audio' ? '재생' : kind ? '열기' : '받기'}</span></a>${linkBtn}</div>`;
}

/* ---------------------------------------------------------------- GET /drive */
router.get('/drive', requireMember, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current || '';
  const hero = pageShell.hero({ eyebrow: `${team ? team + ' · ' : ''}드라이브`, title: '드라이브', sub: '미디어팀 NAS — 영상 · 음원 · 사진' });
  let body;
  try {
    const [d, recRows, evRows, to] = await Promise.all([nas.list(req.query.p), sheetsDb.readAll('녹음'), sheetsDb.readAll('특별예배'), scopeOfTo(team, req.query.to)]);
    // 이미 연결된 파일 — 경로 → [이 팀 콘티의 어느 예배 · 연습/예배]
    const evById = new Map(evRows.filter((e) => e['팀ID'] === team).map((e) => [String(e['ID']), e]));
    const linked = new Map();
    recRows.filter((r) => r['팀ID'] === team).forEach((r) => {
      const p = nas.pathOfLink(r['링크']); if (!p) return;
      const qs = new URLSearchParams({ team }); if (r['행사ID']) qs.set('event', r['행사ID']); else qs.set('date', r['날짜']);
      (linked.get(p) || linked.set(p, []).get(p)).push({ label: `${scopeLabel(r, evById)} ${r['구분'] === '예배' ? '예배' : '연습'}`, href: '/conti?' + qs.toString() });
    });
    // 연결 창에서 고를 수 있는 주일 외 찬양 (지난 4달 · 앞으로 2달)
    const today = week.todayStr(), from = week.shiftWeek(today, -17), till = week.shiftWeek(today, 9);
    const events = Array.from(evById.values()).filter((e) => e['날짜'] >= from && e['날짜'] <= till)
      .sort((a, b) => String(b['날짜']).localeCompare(String(a['날짜'])))
      .map((e) => ({ id: String(e['ID']), name: String(e['이름'] || '주일 외 찬양'), date: String(e['날짜']), label: `${e['이름'] || '주일 외 찬양'} · ${week.shortKo(e['날짜'])}` }));

    const parent = d.path && d.path !== nas.topPath() ? d.path.split('/').slice(0, -1).join('/') : null;
    const nFiles = d.items.filter((x) => !x.dir).length, nDirs = d.items.length - nFiles;
    const toBanner = req.query.to
      ? (to
        ? `<div class="dv-tobar">${ui.icon('link')}<span><b>${esc(to.label)}</b> 녹음으로 연결할 파일을 고르세요</span><a class="ph-btn" href="${esc('/conti?' + new URLSearchParams(Object.assign({ team }, to.event ? { event: to.event } : { date: to.date })).toString())}">콘티로 돌아가기</a></div>`
        : '<div class="dv-tobar warn">연결할 예배를 찾지 못했어요. 파일마다 "콘티에 연결"로 날짜를 골라 주세요.</div>')
      : '';
    body = `<div class="ph-card dv-card" data-dv-team="${esc(team)}" data-dv-events="${esc(JSON.stringify(events))}"${to ? ` data-dv-to="${esc(to.to)}" data-dv-to-label="${esc(to.label)}"` : ''}>
      ${req.query.msg ? `<div class="dv-tobar warn" role="alert">${esc(String(req.query.msg).slice(0, 200))}</div>` : ''}
      ${toBanner}
      ${crumbs(d.path, to && to.to)}
      <div class="dv-tools">
        ${parent !== null ? `<a class="ph-btn dv-up" href="${esc(linkTo(parent, to && to.to))}">← 위로</a>` : ''}
        <input type="search" class="dv-filter" placeholder="이 폴더에서 이름 찾기" aria-label="이 폴더에서 이름 찾기" autocomplete="off">
      </div>
      <p class="ph-sub dv-count">${d.path ? `폴더 ${nDirs} · 파일 ${nFiles}` : `공유 폴더 ${nDirs}`}${d.total > d.items.length + 50 ? ' · 일부만 보여요' : ''}</p>
      <div class="dv-list">${d.items.map((x) => row(x, { linked, to })).join('') || '<p class="ph-sub">빈 폴더예요.</p>'}</div>
      <p class="ph-sub dv-none" hidden>찾는 이름이 없어요.</p>
    </div>`;
  } catch (e) {
    if (!e.user) console.error('[드라이브]', e);
    const st = nas.status();
    body = `<div class="ph-card"><h2 class="ph-h2">드라이브를 열지 못했어요</h2><p class="ph-sub">${esc(e.user ? e.message : '잠시 뒤에 다시 시도해주세요.')}</p>
      <a class="ph-btn" href="/drive">다시 시도</a>
      ${ctx.isAdmin ? `<details class="dv-admin"><summary>관리자용 연결 정보</summary><ul>
        <li>아이디: ${esc(st.user)} · 비밀번호(NAS_PASSWORD): ${st.configured ? '설정됨' : '<b>없음</b>'}</li>
        <li>${st.url ? `직접 주소(NAS_URL): ${esc(st.url)}` : `QuickConnect ID: ${esc(st.quickConnectId)}`}${st.root ? ` · 보이는 폴더(NAS_ROOT): ${esc(st.root)}` : ''}</li>
        ${st.tried.length ? `<li>시도한 주소: ${st.tried.map(esc).join(', ')}</li>` : ''}
        <li>QuickConnect 로 안 되면 NAS 의 외부 주소(DDNS, 예: https://youngnakmedia.synology.me:5001)를 Render 환경변수 NAS_URL 에 넣어 주세요.</li>
      </ul></details>` : ''}</div>`;
  }
  const content = `${pageShell.hubNav('drive', team)}${hero}${body}`;
  await spa.send(req, res, content, { title: '드라이브' });      // public/js/drive.js 는 모든 화면에 (lib/pageShell.js)
});

/* ---------------------------------------------------------------- POST /drive/link — 그 예배의 녹음으로 */
router.post('/drive/link', requireMember, async (req, res) => {
  const b = req.body || {};
  const ctx = req.ctx;
  const team = String(b.team || ctx.current || '').trim();
  const back = (msg) => { let u = '/drive'; try { u = linkTo(nas.cleanPath(String(b.p || '').split('/').slice(0, -1).join('/')), String(b.to || '')); } catch (e) { /* 맨 위로 */ } res.redirect(u + (u.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg || '')); };
  try {
    if (!team || !ctx.teams.includes(team)) throw Object.assign(new Error('팀을 확인해주세요.'), { user: true });
    if (guestAccess.isGuest(ctx.member)) throw Object.assign(new Error('객원 멤버는 연결할 수 없어요.'), { user: true });
    const p = nas.cleanPath(b.p);
    if (!p || !LINKABLE.includes(nas.kindOf(p))) throw Object.assign(new Error('녹음 · 영상 파일만 연결할 수 있어요.'), { user: true });
    let scope = await scopeOfTo(team, b.to);
    if (!scope && b.event) scope = await scopeOfTo(team, 'ev:' + String(b.event));
    if (!scope && b.date) scope = await scopeOfTo(team, String(b.date));
    if (!scope) throw Object.assign(new Error('연결할 날짜를 골라주세요.'), { user: true });
    const kind = b['구분'] === '예배' ? '예배' : '연습';
    const title = String(b['제목'] || '').trim().slice(0, 80) || baseTitle(p.split('/').pop());
    const link = nas.linkOf(p);
    const rows = await sheetsDb.readAll('녹음');
    const dup = rows.find((r) => r['팀ID'] === team && r['링크'] === link && String(r['행사ID'] || '') === scope.event && (scope.event || r['날짜'] === scope.date));
    if (!dup) {
      await sheetsDb.appendRow('녹음', {
        'ID': 'R' + Date.now().toString(36), '팀ID': team, '날짜': scope.date, '행사ID': scope.event || '',
        '구분': kind, '제목': title, '링크': link, '올린사람': ctx.member['이름'], '올린시각': new Date().toISOString(),
      });
    }
    const qs = new URLSearchParams({ team }); if (scope.event) qs.set('event', scope.event); else qs.set('date', scope.date);
    res.redirect('/conti?' + qs.toString());
  } catch (e) {
    if (!e.user) console.error('[드라이브 연결]', e);
    back(e.user ? e.message : '연결하지 못했어요. 잠시 뒤에 다시 시도해주세요.');
  }
});

/* ---------------------------------------------------------------- GET /drive/file */
router.get('/drive/file', requireMember, async (req, res) => {
  try {
    if (guestAccess.isGuest(req.ctx.member)) {                         // 객원 — 자기 팀 콘티에 연결된 파일만
      const p = nas.cleanPath(req.query.p);
      const ok = (await sheetsDb.readAll('녹음')).some((r) => req.ctx.teams.includes(r['팀ID']) && nas.pathOfLink(r['링크']) === p);
      if (!ok) return res.status(403).type('text').send('볼 수 없는 파일이에요.');
    }
    await nas.stream(req.query.p, res, req.get('range') || '', req.query.dl === '1');
  } catch (e) {
    if (!e.user) console.error('[드라이브 파일]', e);
    if (!res.headersSent) res.status(e.code === 'NAS_NOT_FOUND' || e.code === 'NAS_FILE' ? 404 : 502).type('text').send(e.user ? e.message : '파일을 열지 못했어요.');
    else res.destroy();
  }
});

module.exports = router;
