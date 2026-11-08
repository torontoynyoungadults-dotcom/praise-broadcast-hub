/**
 * 모든 페이지가 공유하는 뼈대: 머리말(제목 + 다크/라이트 · 글자크기 · 새로고침) + 내용 + 바닥글.
 * 바닥글 태그라인은 '설정' 시트의 '태그라인' 값을 쓰고, 없으면 기본값을 씁니다(관리자가 나중에 설정 화면에서 바꿀 수 있게 될 자리).
 */
const fs = require('fs');
const path = require('path');
const sheetsDb = require('./sheetsDb');
const ui = require('./uiIcons');
const { THEME_BOOT } = require('./themeBoot');
const weekUtil = require('./weekUtil');
const { ALL_POSITIONS } = require('./positions');

const DEFAULT_TAGLINE = '소망이 넘치는 교회';

/**
 * 정적 파일(css/js)은 1시간 캐시(server.js의 express.static maxAge)를 쓰는데,
 * 배포할 때마다 파일 이름이 그대로라 브라우저가 옛날 버전을 계속 쓰는 문제가 있었음
 * ("디자인이 안 먹힌 것처럼 보이는" 원인). 파일의 실제 수정시각을 쿼리스트링에 붙여서
 * 내용이 바뀌면 자동으로 새 주소가 되게 함 — 수동으로 버전을 올릴 필요 없음.
 */
function assetVersion(relPath) {
  try { return String(Math.floor(fs.statSync(path.join(__dirname, '..', 'public', relPath)).mtimeMs)); }
  catch (e) { return String(Date.now()); }
}
const CSS_V = assetVersion('css/app.css');
const V13_V = assetVersion('css/v13.css');
const POLISH_V = assetVersion('css/polish.css');   // 마지막 손질 레이어 (맨 마지막에 읽음)
const JS_V = assetVersion('js/theme.js');
const SPA_V = assetVersion('js/spa.js');
const FORMB_V = assetVersion('js/formb.js');
const CONTITOOLS_V = assetVersion('js/conti-tools.js');
const LOGO_V = assetVersion('img/church-logo.png');
const DRIVE_V = assetVersion('js/drive.js');   // 드라이브 — 파일 보기 창 · 콘티에 연결 (예배콘티 녹음의 "영상 보기"도)   // 교회 로고 (맨 위 · 인쇄용 PDF 표지)
const RECPLAYER_V = assetVersion('js/recplayer.js');
const LISTEN_V = assetVersion('js/listen.js');
const VISIT_V = assetVersion('js/visit.js');
const SHEETSEARCH_V = assetVersion('js/sheetsearch.js');
const SHEETHDR_V = assetVersion('js/sheethdr.js');
const PKGPREVIEW_V = assetVersion('js/pkgpreview.js');
const OFFLINE_V = assetVersion('js/offline.js');
const FLOATBAR_V = assetVersion('js/floatbar.js');   // 떠 있는 라이브 악보 바 — 스크롤 따라 비켜 주기
const A2HS_V = assetVersion('js/a2hs.js');
const NOTIFY_V = assetVersion('js/notify.js');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/**
 * church-app의 Worship.html 탭 바(TABS)에 해당하는, 다섯 기능을 오가는 공통 탭 바.
 * 로그인 후 모든 화면(허브 홈 포함) 맨 위에 붙어서, 어떤 화면에서든 같은 탭으로 바로 전환할 수 있게 함.
 * @param {string} active - 'conti' | 'notices' | 'schedule' | 'library' | 'equipment' | 'drive' | '' (허브 홈 등 해당 없음)
 * @param {string} team
 */
const HUB_TABS = [
  ['conti', '/conti', '주일콘티'],
  ['practice', '/practice-conti', '연습콘티'],
  ['schedule', '/schedule', '스케쥴'],
  ['events', '/events', '주일 외'],
  // ['notices', '/notices', '공지 및 모임'],      // 잠시 메뉴에서 뺌 (주소 /notices · /equipment 는 그대로 열림)
  // ['equipment', '/equipment', '장비 · 수리'],
  ['library', '/library', '라이브러리'],
];                       // 팀원관리는 맨 위 배너의 "내 정보 수정" 옆으로 (heroWho)
const GUEST_HIDE = ['practice', 'events', 'equipment', 'library'];   // 객원 멤버에게는 닫힌 메뉴
function hubNav(active, team) {
  const qs = team ? `?team=${encodeURIComponent(team)}` : '';
  return `<nav class="ph-hubnav" id="ph-hubnav" aria-label="메뉴"><div class="ph-hubnav-in">${HUB_TABS.map(([key, href, label]) =>
    `<a class="ph-hubtab${active === key ? ' on' : ''}" href="${href}${qs}" data-ph-tab="${key}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`).join('')}<!--ph:admintab:${active === 'admin' || active === 'roster' ? 'on' : ''}--></div></nav>`;
}

/**
 * 주보 표지 느낌의 "산 너머 여명" 일러스트 배너. 라이트=일출 / 다크=황혼으로 CSS 변수만 바뀌는
 * 하나의 SVG를 공유합니다(이미지 파일 없이, 순수 SVG + CSS 변수). church-app과 다른, 이 앱만의 비주얼.
 * @param {{eyebrow?:string, title:string, sub?:string}} o
 */
function hero(o) {
  if (o && o.barOnly) return `<div class="ph-hero ph-hero-baronly">
    <div class="ph-bar"><a class="ph-brand" href="/" aria-label="YN 3부찬양팀 허브 처음으로"><i>YN Praise</i><b>YN 3부 찬양팀</b></a><!--ph:hero-top--></div>
  </div><!--/ph-hero-->`;
  // V13 — 예전 큰 머리(제목 · 안내 상자) 대신: 위는 바만, 메뉴 아래에 흑녹 제목 띠 (관리 · 음향 · 팀원관리 · 사용설명서 등 모든 화면)
  const eyebrow = o.eyebrow ? `<small>${esc(o.eyebrow)}</small>` : '';
  const sub = o.sub ? `<p>${esc(o.sub)}</p>` : '';
  return `<div class="ph-hero ph-hero-baronly">
    <div class="ph-bar"><a class="ph-brand" href="/" aria-label="YN 3부찬양팀 허브 처음으로"><i>YN Praise</i><b>YN 3부 찬양팀</b></a><!--ph:hero-top--></div>
  </div><!--/ph-hero--><section class="v13-ptitle">${eyebrow}<h1>${esc(o.title)}</h1>${sub}</section>`;
}

/* ---------------------------------------------------------------- 맨 위 배너 꾸미기
 * 배너(산 그림) 안 오른쪽 위: 글자 크기 · 밝은/어두운 화면 스위치 · 새로고침 (public/js/theme.js 가 눌림을 받음)
 * 배너 아래쪽: 프로필 사진 + "OOO님, 환영합니다" + 내 정보 수정 · (관리자) 관리
 * 메뉴(ph-hubnav)는 늘 배너 바로 아래로 옮깁니다. 배너가 없는 화면에는 기본 배너를 붙입니다. */
const ICON = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5a6 6 0 1 1 12 0c0 4.6 1.8 5.9 1.8 5.9H4.2S6 14.1 6 9.5z"/><path d="M10 19.2a2.2 2.2 0 0 0 4 0"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/></svg>',
};
function heroTools(who) {
  const bell = who && who.name ? `<button type="button" class="ph-hero-btn ph-bell" data-ph-act="bell" aria-label="알림" title="알림">${ICON.bell}<i class="ph-bell-dot" aria-hidden="true"></i></button>` : '';
  return `<div class="ph-hero-tools">
      <button type="button" class="ph-themesw" data-ph-act="theme" role="switch" aria-checked="false" aria-label="밝은 화면">
        <span class="ph-themesw-i dark">${ICON.moon}</span><span class="ph-themesw-i light">${ICON.sun}</span><span class="ph-themesw-knob"></span>
      </button>
      <button type="button" class="ph-hero-btn" data-ph-act="refresh" aria-label="새로고침" title="새로고침">${ICON.refresh}</button>
      ${bell}
      ${heroMe(who)}
    </div>`;
}
/** 머리 오른쪽 위 프로필 사진 — 누르면 내 메뉴(아래에서 올라옴). 관리자에게만 관리 */
function heroMe(who) {
  if (!who || !who.name) return '';
  const ini = esc(String(who.name).charAt(0));
  const face = who.photo
    ? `<img src="${esc(who.photo)}" alt="" onerror="this.replaceWith(document.createTextNode('${ini}'))">`
    : ini;
  const tq = who.team ? '?team=' + encodeURIComponent(who.team) : '';
  return `<details class="ph-me"><summary class="ph-bar-me" aria-label="내 메뉴 · ${esc(who.name)}">${face}</summary>
      <div class="ph-me-sheet" role="dialog" aria-label="내 메뉴">
        <div class="ph-me-head"><span class="ph-me-av">${face}</span><span><b>${esc(who.name)}</b><small>${esc(who.team || '')}${who.isAdmin ? ' · 관리자' : ''}</small></span></div>
        <nav class="ph-me-list"><a href="/profile">내 정보 · 사진 · 포지션</a><a href="/schedule${tq}">내가 안 되는 날</a><a href="/guide">사용설명서 · 홈 화면에 추가하는 법</a></nav>
        ${who.isAdmin ? `<nav class="ph-me-list ph-me-admin"><small>관리자에게만 보여요</small><a href="/roster${tq}">관리 · 팀원</a><a href="/admin">설정 · 자동 안내 · 방송팀 링크</a></nav>` : ''}
        <a class="ph-me-out" href="/logout">로그아웃</a>
      </div></details>`;
}
function heroWho(who) {
  if (!who || !who.name) return '';
  const ini = esc(String(who.name).charAt(0));
  const face = who.photo   // 사진이 안 열리면 첫 글자로
    ? `<img src="${esc(who.photo)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="ph-who-ini" style="display:none">${ini}</span>`
    : `<span class="ph-who-ini">${ini}</span>`;
  return `<div class="ph-hero-who">
        <a class="ph-who-me" href="/profile" title="내 정보 수정" aria-label="내 정보 수정"><span class="ph-who-av">${face}</span><span class="ph-who-edit" aria-hidden="true">${ui.icon('pencil')}</span></a>
        <span class="ph-who-hi">${who.pastor ? `<b>${esc(who.name)} 목사</b>, 환영합니다` : `<b>${esc(who.name)}</b>님, 환영합니다`}</span>
        <span class="ph-who-links"><a href="/guide" class="ph-who-guide">사용설명서</a>${who.isAdmin ? `<a href="/roster${who.team ? '?team=' + encodeURIComponent(who.team) : ''}" class="ph-who-admin">관리</a>` : ''}<a href="/logout">로그아웃</a></span>
      </div>
      <nav class="ph-who-links-v13" aria-label="내 메뉴"><a href="/guide">사용설명서</a>${who.isAdmin ? `<a href="/roster${who.team ? '?team=' + encodeURIComponent(who.team) : ''}">관리</a>` : ''}<a href="/logout">로그아웃</a></nav>`;
}
/** 배너 안 "이번 주 연습" 한 줄 — 서는지 안 서는지를 이름과 함께 (눌러서 연습 콘티로) */
function practiceNotice(who) {
  const p = who && who.practice;
  if (!p || !p.head) return '';
  const line = (l) => `<span class="ph-who-prac-det"><span class="ph-who-prac-k">${esc(l.k)}</span>${esc(l.text)}${l.pos && l.pos.length ? `<span class="ph-who-prac-pos">${l.pos.map(esc).join(' · ')}</span>` : ''}</span>`;
  return `<div class="ph-who-prac ${esc(p.state)}">
        <a class="ph-who-prac-link" href="${esc(p.href)}">
          <span class="ph-who-prac-dot" aria-hidden="true"></span>
          <span class="ph-who-prac-txt"><b class="ph-who-prac-head">${esc(p.head)}</b>${(p.lines || []).map(line).join('')}</span>
        </a>
      </div>`;
}
function decorate(content, who) {
  let html = String(content || '');
  if (html.indexOf('<!--/ph-hero-->') === -1 && html.indexOf('ph-hero-tools') === -1) {
    html = hero({ eyebrow: (who && who.team) || '', title: 'YN 3부찬양팀 허브' }) + html;
  }
  if (who && who.guest) GUEST_HIDE.forEach((k) => { html = html.replace(new RegExp(`<a class="ph-hubtab[^"]*"[^>]*data-ph-tab="${k}"[^>]*>[^<]*</a>`, 'g'), ''); });
  // V13 — 관리 탭: 관리자에게만 (라이브러리 옆)
  html = html.replace(/<!--ph:admintab:(on)?-->/g, (m, on) => (who && who.name && !who.guest ? `<a class="ph-hubtab ph-hubtab-admin${on ? ' on' : ''}" href="/admin" data-ph-tab="admin"${on ? ' aria-current="page"' : ''}>관리</a>` : ''));
  html = html.replace('<!--ph:hero-top-->', heroTools(who)).replace('<!--ph:hero-who-->', heroWho(who) + practiceNotice(who));
  // 메뉴는 배너 바로 아래
  const navAt = html.indexOf('<nav class="ph-hubnav"');
  const heroEnd = html.indexOf('<!--/ph-hero-->');
  if (navAt !== -1 && heroEnd !== -1 && navAt < heroEnd) {
    const navEnd = html.indexOf('</nav>', navAt) + '</nav>'.length;
    const nav = html.slice(navAt, navEnd);
    html = html.slice(0, navAt) + html.slice(navEnd);
    const he = html.indexOf('<!--/ph-hero-->') + '<!--/ph-hero-->'.length;
    html = html.slice(0, he) + nav + html.slice(he);
  }
  return html;
}

/**
 * church-app처럼 여러 주를 가로로 넘겨보는 달력 띠 — 예배콘티·스케줄표의 날짜 이동에 씀.
 * 각 칸에 "그 주 몇 자리나 찼는지"(예: 7/13)를 작게 보여주고, 날짜를 누르면 바로 그 주로 이동.
 * @param {{basePath:string, team:string, date:string, assignRows:object[], extraQuery?:string}} o
 */
function weekStrip(o) {
  const extra = o.extraQuery || '';
  const total = ALL_POSITIONS.length;
  const todayWeek = weekUtil.normalizeDate(null);
  const events = (o.events || []).filter((e) => e && e.date);
  const evId = o.activeEvent || '';
  // 주일 외 찬양(부흥회 등)를 보고 있을 때는 그 날이 속한 주일(일요일)을 가운데로
  let center = o.date;
  if (evId) { const x = new Date(o.date + 'T12:00:00'); x.setDate(x.getDate() - x.getDay()); center = x.toISOString().slice(0, 10); }
  // 날짜 아래 작은 글씨 = 그 주일의 연습일 ("연습 10/23" · 연습 없음) — lib/practice.js
  const prac = require('./practice');
  const pracLabel = (d) => {
    const p = prac.practiceFor(d, d, o.pracRows || [], '');
    if (p.none) return '연습 없음';
    return p.date ? `연습 ${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8, 10))}` : '';
  };
  const cells = [];
  for (let i = -3; i <= 3; i++) {
    const d = weekUtil.shiftWeek(center, i);
    const dd = new Date(d + 'T12:00:00');
    const filled = new Set((o.assignRows || []).filter((r) => r['날짜'] === d && !r['행사ID']).map((r) => r['포지션'])).size;
    const href = `${o.basePath}?team=${encodeURIComponent(o.team)}&date=${encodeURIComponent(d)}${extra}`;
    const on = d === center && !evId;
    cells.push(`<a class="ph-wstrip-cell${on ? ' on' : ''}" href="${href}"${on ? ' aria-current="page"' : ''}>
      <span class="ph-wstrip-month">${dd.getMonth() + 1}월</span>
      <span class="ph-wstrip-day">${dd.getDate()}</span>
      <span class="ph-wstrip-ratio" title="편성 ${filled}/${total}칸">${pracLabel(d)}</span>
    </a>`);
    // 그 주(일요일~토요일)에 있는 주일 외 찬양은 날짜 칸 바로 옆에 따로 — 날짜는 그대로, 아래 글씨만 예배 이름
    const end = weekUtil.shiftWeek(d, 1);
    events.filter((e) => e.date >= d && e.date < end).sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
      const ed = new Date(e.date + 'T12:00:00');
      const eon = evId && String(e.id) === String(evId);
      cells.push(`<a class="ph-wstrip-cell ph-wstrip-ev${eon ? ' on' : ''}" href="${o.basePath}?team=${encodeURIComponent(o.team)}&event=${encodeURIComponent(e.id)}"${eon ? ' aria-current="page"' : ''} title="${esc(e.name)}">
      <span class="ph-wstrip-month">${ed.getMonth() + 1}월</span>
      <span class="ph-wstrip-day">${ed.getDate()}</span>
      <span class="ph-wstrip-evname">${esc(e.name)}</span>
    </a>`);
    });
  }
  const jumpHref = `${o.basePath}?team=${encodeURIComponent(o.team)}&date=${encodeURIComponent(todayWeek)}${extra}`;
  return `<div class="ph-wstrip">
    <div class="ph-wstrip-scroll">
      ${cells.join('')}
      <a class="ph-wstrip-cell ph-wstrip-jump${center === todayWeek ? ' on' : ''}" href="${jumpHref}">
        <span class="ph-wstrip-jumpicon">${ui.icon('pin')}</span><span class="ph-wstrip-jumplabel">다음<br>주일</span>
      </a>
      <form method="get" class="ph-wstrip-cell ph-wstrip-cal">
        <input type="hidden" name="team" value="${esc(o.team)}">
        <label class="ph-wstrip-callabel">${ui.icon('calendar')}<input type="date" name="date" value="${esc(center)}" onchange="this.form.submit()"></label>
      </form>
    </div>
  </div>`;
}

/** 빌드번호 — 맨 아래 구석에 아주 작게 (어느 버전이 떠 있는지 확인용) */
const BUILD = (() => {
  let c = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7);
  if (!c) { try { c = require('child_process').execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { c = 'dev'; } }
  let t = '';
  try { t = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ''); } catch (e) {}
  return /^[A-Za-z0-9]+$/.test(c) ? c + (t ? ' · ' + t : '') : 'dev';
})();
const BUILD_HTML = '<div id="phBuild" aria-hidden="true" style="position:fixed;right:4px;bottom:2px;z-index:2147483000;font:8px/1 ui-monospace,Menlo,monospace;color:#888;opacity:.45;pointer-events:none;user-select:none">#' + esc(BUILD) + '</div>';

async function footerHtml() {
  let tagline = DEFAULT_TAGLINE;
  try { tagline = (await sheetsDb.getSetting('태그라인', DEFAULT_TAGLINE)) || DEFAULT_TAGLINE; } catch (e) { /* DB 미설정 상태에서도 페이지는 떠야 함 */ }
  return `<footer class="ph-footer">
    <a class="ph-foot-logo" href="https://www.ynchurch.com/" target="_blank" rel="noopener" aria-label="해외한인장로회 토론토영락교회 홈페이지"><img class="ph-flogo ph-flogo-w" src="/img/church-logo-white.png?v=${LOGO_V}" alt="해외한인장로회 토론토영락교회" width="1200" height="412" loading="lazy" decoding="async"><img class="ph-flogo ph-flogo-b" src="/img/church-logo.png?v=${LOGO_V}" alt="" aria-hidden="true" width="1200" height="412" loading="lazy" decoding="async"></a>
    <div class="tag">${esc(tagline)}</div>
    <div><a href="tel:+14164940191">(416) 494-0191</a> · <a href="https://maps.google.com/?q=650+McNicoll+Ave+Toronto+ON+M2H+2E1" target="_blank" rel="noopener">650 McNicoll Ave. Toronto, ON M2H 2E1</a></div>
    <div>담임목사: 전대혁</div>
    <div><button type="button" class="ph-a2hs-link" data-a2hs>홈 화면에 추가하는 법</button></div>
    <div><a href="https://www.ynchurch.com/" target="_blank" rel="noopener">www.ynchurch.com</a></div>
  </footer>`;
}

/**
 * @param {string} content - <body> 안에 들어갈 HTML
 * @param {{title?:string, bodyClass?:string}} opts
 */
async function render(content, opts = {}) {
  const title = opts.title || 'YN찬양팀Hub';
  const footer = await footerHtml();
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:where(html, body, *){touch-action:manipulation}</style>
<title>${esc(title)}</title>
<link rel="manifest" href="/site.webmanifest">
<link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="theme-color" content="#0F1A16">
<meta name="application-name" content="YN찬양팀Hub">
<meta name="apple-mobile-web-app-title" content="YN찬양팀Hub">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preload" as="style" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"></noscript>
<link rel="stylesheet" href="/css/app.css?v=${CSS_V}">
<link rel="stylesheet" href="/css/v13.css?v=${V13_V}">
<script>document.documentElement.setAttribute('data-theme','light');</script>
<script>(function(){try{var d=document.documentElement,f=parseInt(localStorage.getItem('ph.fs')||'0',10);if(f)d.setAttribute('data-fs',String(f));d.style.setProperty('--font-scale',String({'-1':0.9,'0':1,'1':1.12,'2':1.25,'3':1.4}[f]||1));}catch(e){}})();</script>
${opts.head || ''}
<link rel="stylesheet" href="/css/polish.css?v=${POLISH_V}">
</head>
<body>
<main class="ph-wrap">
${decorate(content, opts.who || null)}
${footer}
</main>
${BUILD_HTML}
<script src="/js/theme.js?v=${JS_V}" defer></script>
<script src="/js/spa.js?v=${SPA_V}" defer></script>
<script src="/js/formb.js?v=${FORMB_V}" defer></script>
<script src="/js/offline.js?v=${OFFLINE_V}" defer></script>
<script src="/js/floatbar.js?v=${FLOATBAR_V}" defer></script>
<script src="/js/a2hs.js?v=${A2HS_V}" defer></script>
${opts.who ? `<script src="/js/notify.js?v=${NOTIFY_V}" defer></script>` : ''}
<script src="/js/conti-tools.js?v=${CONTITOOLS_V}" defer></script>
<script src="/js/recplayer.js?v=${RECPLAYER_V}" defer></script>
<script src="/js/listen.js?v=${LISTEN_V}" defer></script>
${opts.who ? `<script src="/js/visit.js?v=${VISIT_V}" defer></script>` : ''}
<script src="/js/sheetsearch.js?v=${SHEETSEARCH_V}" defer></script>
<script src="/js/sheethdr.js?v=${SHEETHDR_V}" defer></script>
<script src="/js/pkgpreview.js?v=${PKGPREVIEW_V}" defer></script>
<script src="/js/drive.js?v=${DRIVE_V}" defer></script>
${opts.scripts || ''}
</body>
</html>`;
}

/** 관리자 전용 — 팀원관리 · 설정을 한 "관리" 안의 두 칸으로 */
function adminTabs(active, team) {
  const q = team ? `?team=${encodeURIComponent(team)}` : '';
  return `<div class="ph-card ph-admintabs"><a class="ph-btn${active === 'roster' ? ' pri' : ''}" href="/roster${q}">팀원관리</a><a class="ph-btn${active === 'admin' ? ' pri' : ''}" href="/admin">설정 · 방송팀 링크</a><a class="ph-btn" href="/">← 허브로</a></div>`;
}
module.exports = { adminTabs, render, esc, hero, hubNav, weekStrip, decorate, assetVersion, BUILD_HTML };
