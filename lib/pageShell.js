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
const JS_V = assetVersion('js/theme.js');
const SPA_V = assetVersion('js/spa.js');
const FORMB_V = assetVersion('js/formb.js');
const CONTITOOLS_V = assetVersion('js/conti-tools.js');
const LOGO_V = assetVersion('img/church-logo.png');   // 교회 로고 (맨 위 · 인쇄용 PDF 표지)
const RECPLAYER_V = assetVersion('js/recplayer.js');
const SHEETSEARCH_V = assetVersion('js/sheetsearch.js');
const SHEETHDR_V = assetVersion('js/sheethdr.js');
const PKGPREVIEW_V = assetVersion('js/pkgpreview.js');
const OFFLINE_V = assetVersion('js/offline.js');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/**
 * church-app의 Worship.html 탭 바(TABS)에 해당하는, 다섯 기능을 오가는 공통 탭 바.
 * 로그인 후 모든 화면(허브 홈 포함) 맨 위에 붙어서, 어떤 화면에서든 같은 탭으로 바로 전환할 수 있게 함.
 * @param {string} active - 'conti' | 'notices' | 'schedule' | 'library' | 'equipment' | '' (허브 홈 등 해당 없음)
 * @param {string} team
 */
const HUB_TABS = [
  ['conti', '/conti', '예배 콘티'],
  ['schedule', '/schedule', '스케줄표'],
  ['events', '/events', '주일 외 찬양'],
  ['notices', '/notices', '공지 및 모임'],
  ['equipment', '/equipment', '장비 · 수리'],
  ['library', '/library', '라이브러리'],
];                       // 팀원관리는 맨 위 배너의 "내 정보 수정" 옆으로 (heroWho)
const GUEST_HIDE = ['events', 'equipment', 'library'];   // 객원 멤버에게는 닫힌 메뉴
function hubNav(active, team) {
  const qs = team ? `?team=${encodeURIComponent(team)}` : '';
  return `<nav class="ph-hubnav" id="ph-hubnav" aria-label="메뉴"><div class="ph-hubnav-in">${HUB_TABS.map(([key, href, label]) =>
    `<a class="ph-hubtab${active === key ? ' on' : ''}" href="${href}${qs}" data-ph-tab="${key}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div></nav>`;
}

/**
 * 주보 표지 느낌의 "산 너머 여명" 일러스트 배너. 라이트=일출 / 다크=황혼으로 CSS 변수만 바뀌는
 * 하나의 SVG를 공유합니다(이미지 파일 없이, 순수 SVG + CSS 변수). church-app과 다른, 이 앱만의 비주얼.
 * @param {{eyebrow?:string, title:string, sub?:string}} o
 */
function hero(o) {
  const eyebrow = o.eyebrow ? `<span class="ph-hero-eyebrow">${esc(o.eyebrow)}</span>` : '';
  const sub = o.sub ? `<p class="ph-hero-sub">${esc(o.sub)}</p>` : '';
  return `<div class="ph-hero">
    <svg class="ph-hero-art" viewBox="0 0 800 280" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
      <defs>
        <linearGradient id="phSky" x1="0" y1="0" x2="0" y2="1">
          <stop class="ph-stop-sky1" offset="0%"/>
          <stop class="ph-stop-sky2" offset="55%"/>
          <stop class="ph-stop-sky3" offset="100%"/>
        </linearGradient>
        <radialGradient id="phSun" cx="50%" cy="50%" r="50%">
          <stop class="ph-stop-glow" offset="0%"/>
          <stop class="ph-stop-glow" offset="100%" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="800" height="280" fill="url(#phSky)"/>
      <circle cx="585" cy="160" r="150" fill="url(#phSun)"/>
      <circle class="ph-fill-sun" cx="585" cy="160" r="40"/>
      <!-- 토론토 — 호숫가 스카이라인과 CN 타워 -->
      <path class="ph-fill-mtn1" d="M0,206 L0,115 L16,115 L16,159 L37,159 L37,139 L66,139 L66,125 L88,125 L88,138 L118,138 L118,133 L146,133 L146,157 L177,157 L177,128 L200,128 L200,169 L229,169 L229,143 L257,143 L257,122 L290,122 L290,140 L308,140 L308,129 L341,129 L341,136 L369,136 L369,116 L401,116 L401,151 L455,151 L455,154 L498,154 L498,182 L603,182 L603,160 L627,160 L627,169 L659,169 L659,151 L682,151 L682,115 L710,115 L710,162 L735,162 L735,154 L758,154 L758,146 L781,146 L781,139 L800,139 L800,280 L0,280 Z"/>
      <path class="ph-fill-mtn2" d="M0,238 L0,202 L24,202 L24,192 L53,192 L53,184 L81,184 L81,189 L105,189 L105,182 L127,182 L127,195 L156,195 L156,201 L181,201 L181,197 L204,197 L204,195 L223,195 L223,173 L250,173 L250,176 L266,176 L266,194 L281,194 L281,209 L297,209 L297,202 L327,202 L327,206 L351,206 L351,186 L372,186 L372,171 L388,171 L388,173 L416,173 L416,172 L444,172 L444,200 L470,200 L470,201 L484,201 L484,212 L499,212 L499,202 L523,202 L523,220 L602,220 L602,173 L622,173 L622,190 L638,190 L638,172 L652,172 L652,171 L676,171 L676,172 L690,172 L690,169 L707,169 L707,182 L730,182 L730,202 L748,202 L748,187 L765,187 L765,178 L780,178 L780,181 L800,181 L800,280 L0,280 Z"/>
      <g class="ph-fill-mtn2" transform="translate(-95 0)">
        <path d="M548,252 L556,122 L557,98 L558.6,72 L561.4,72 L563,98 L564,122 L572,252 Z"/>
        <path d="M542,120 L578,120 L582,125 L577,131 L543,131 L538,125 Z"/>
        <path d="M552,105 L568,105 L570,110 L550,110 Z"/>
        <rect x="559.2" y="30" width="1.6" height="44"/>
      </g>
      <g class="ph-fill-win"><rect x="471" y="238" width="2" height="2.4"/><rect x="484" y="235" width="2" height="2.4"/><rect x="528" y="238" width="2" height="2.4"/><rect x="202" y="229" width="2" height="2.4"/><rect x="532" y="235" width="2" height="2.4"/><rect x="652" y="238" width="2" height="2.4"/><rect x="198" y="226" width="2" height="2.4"/><rect x="465" y="232" width="2" height="2.4"/><rect x="153" y="226" width="2" height="2.4"/><rect x="559" y="226" width="2" height="2.4"/><rect x="617" y="235" width="2" height="2.4"/><rect x="471" y="238" width="2" height="2.4"/><rect x="673" y="229" width="2" height="2.4"/><rect x="646" y="226" width="2" height="2.4"/><rect x="549" y="226" width="2" height="2.4"/><rect x="68" y="226" width="2" height="2.4"/><rect x="202" y="229" width="2" height="2.4"/><rect x="622" y="226" width="2" height="2.4"/><rect x="483" y="232" width="2" height="2.4"/><rect x="459" y="238" width="2" height="2.4"/><rect x="208" y="238" width="2" height="2.4"/><rect x="247" y="232" width="2" height="2.4"/><rect x="519" y="226" width="2" height="2.4"/><rect x="686" y="226" width="2" height="2.4"/><rect x="476" y="232" width="2" height="2.4"/><rect x="424" y="238" width="2" height="2.4"/><rect x="93" y="232" width="2" height="2.4"/><rect x="330" y="229" width="2" height="2.4"/><rect x="533" y="232" width="2" height="2.4"/><rect x="38" y="226" width="2" height="2.4"/><rect x="584" y="226" width="2" height="2.4"/><rect x="418" y="226" width="2" height="2.4"/><rect x="305" y="235" width="2" height="2.4"/><rect x="76" y="226" width="2" height="2.4"/><rect x="709" y="226" width="2" height="2.4"/><rect x="226" y="229" width="2" height="2.4"/><rect x="61" y="235" width="2" height="2.4"/><rect x="392" y="235" width="2" height="2.4"/><rect x="437" y="226" width="2" height="2.4"/><rect x="587" y="229" width="2" height="2.4"/><rect x="699" y="232" width="2" height="2.4"/><rect x="352" y="226" width="2" height="2.4"/><rect x="326" y="232" width="2" height="2.4"/><rect x="23" y="235" width="2" height="2.4"/><rect x="784" y="226" width="2" height="2.4"/><rect x="145" y="229" width="2" height="2.4"/></g>
      <path class="ph-fill-mtn3" d="M0,262 C120,251 260,269 400,258 S680,250 800,261 L800,280 L0,280 Z"/>
      <g class="ph-stroke-sun" stroke-width="1.6" stroke-linecap="round"><path d="M535,254 H640"/><path d="M557,260 H625"/><path d="M573,266 H615"/></g>
    </svg>
    <!--ph:hero-top-->
    <div class="ph-hero-text">
      ${eyebrow}
      <p class="ph-hero-title">${esc(o.title)}</p>
      ${sub}
      <!--ph:hero-who-->
    </div>
  </div><!--/ph-hero-->`;
}

/* ---------------------------------------------------------------- 맨 위 배너 꾸미기
 * 배너(산 그림) 안 오른쪽 위: 글자 크기 · 밝은/어두운 화면 스위치 · 새로고침 (public/js/theme.js 가 눌림을 받음)
 * 배너 아래쪽: 프로필 사진 + "OOO님, 환영합니다" + 내 정보 수정 · (관리자) 관리
 * 메뉴(ph-hubnav)는 늘 배너 바로 아래로 옮깁니다. 배너가 없는 화면에는 기본 배너를 붙입니다. */
const ICON = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/></svg>',
};
function heroTools() {
  return `<div class="ph-hero-tools">
      <button type="button" class="ph-themesw" data-ph-act="theme" role="switch" aria-checked="false" aria-label="밝은 화면">
        <span class="ph-themesw-i dark">${ICON.moon}</span><span class="ph-themesw-i light">${ICON.sun}</span><span class="ph-themesw-knob"></span>
      </button>
      <button type="button" class="ph-hero-btn" data-ph-act="refresh" aria-label="새로고침" title="새로고침">${ICON.refresh}</button>
    </div>`;
}
function heroWho(who) {
  if (!who || !who.name) return '';
  const ini = esc(String(who.name).charAt(0));
  const face = who.photo   // 사진이 안 열리면 첫 글자로
    ? `<img src="${esc(who.photo)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="ph-who-ini" style="display:none">${ini}</span>`
    : `<span class="ph-who-ini">${ini}</span>`;
  return `<div class="ph-hero-who">
        <span class="ph-who-av">${face}</span>
        <span class="ph-who-hi">${who.pastor ? `<b>${esc(who.name)} 목사</b>, 환영합니다` : `<b>${esc(who.name)}</b>님, 환영합니다`}</span>
        <span class="ph-who-links"><a href="/profile">내 정보 수정</a><a href="/guide" class="ph-who-guide">사용설명서</a>${who.isAdmin ? `<a href="/roster${who.team ? '?team=' + encodeURIComponent(who.team) : ''}" class="ph-who-admin">관리</a>` : ''}<a href="/logout">로그아웃</a></span>
      </div>`;
}
function decorate(content, who) {
  let html = String(content || '');
  if (html.indexOf('<!--/ph-hero-->') === -1 && html.indexOf('ph-hero-tools') === -1) {
    html = hero({ eyebrow: (who && who.team) || '', title: '찬양방송팀 허브' }) + html;
  }
  if (who && who.guest) GUEST_HIDE.forEach((k) => { html = html.replace(new RegExp(`<a class="ph-hubtab[^"]*"[^>]*data-ph-tab="${k}"[^>]*>[^<]*</a>`, 'g'), ''); });
  html = html.replace('<!--ph:hero-top-->', heroTools()).replace('<!--ph:hero-who-->', heroWho(who));
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
      <span class="ph-wstrip-ratio">${filled}/${total}</span>
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
    <div class="tag">${esc(tagline)}</div>
    <div><a href="tel:+14164940191">(416) 494-0191</a> · <a href="https://maps.google.com/?q=650+McNicoll+Ave+Toronto+ON+M2H+2E1" target="_blank" rel="noopener">650 McNicoll Ave. Toronto, ON M2H 2E1</a></div>
    <div>해외한인장로회 토론토영락교회 · 담임목사: 전대혁</div>
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
<title>${esc(title)}</title>
<link rel="manifest" href="/site.webmanifest">
<link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="theme-color" content="#BFE6DA">
<meta name="application-name" content="YN찬양팀Hub">
<meta name="apple-mobile-web-app-title" content="YN찬양팀Hub">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preload" as="style" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"></noscript>
<link rel="stylesheet" href="/css/app.css?v=${CSS_V}">
<script>${THEME_BOOT}</script>
<script>(function(){try{var d=document.documentElement,f=parseInt(localStorage.getItem('ph.fs')||'0',10);if(f)d.setAttribute('data-fs',String(f));d.style.setProperty('--font-scale',String({'-1':0.9,'0':1,'1':1.12,'2':1.25,'3':1.4}[f]||1));}catch(e){}})();</script>
${opts.head || ''}
</head>
<body>
<main class="ph-wrap">
<header class="ph-brand" role="banner"><img class="ph-brand-logo ph-brand-w" src="/img/church-logo-white.png?v=${LOGO_V}" alt="해외한인장로회 토론토영락교회" width="1200" height="412" decoding="async"><img class="ph-brand-logo ph-brand-b" src="/img/church-logo.png?v=${LOGO_V}" alt="" aria-hidden="true" width="1200" height="412" decoding="async"></header>
${decorate(content, opts.who || null)}
${footer}
</main>
${BUILD_HTML}
<script src="/js/theme.js?v=${JS_V}" defer></script>
<script src="/js/spa.js?v=${SPA_V}" defer></script>
<script src="/js/formb.js?v=${FORMB_V}" defer></script>
<script src="/js/offline.js?v=${OFFLINE_V}" defer></script>
<script src="/js/conti-tools.js?v=${CONTITOOLS_V}" defer></script>
<script src="/js/recplayer.js?v=${RECPLAYER_V}" defer></script>
<script src="/js/sheetsearch.js?v=${SHEETSEARCH_V}" defer></script>
<script src="/js/sheethdr.js?v=${SHEETHDR_V}" defer></script>
<script src="/js/pkgpreview.js?v=${PKGPREVIEW_V}" defer></script>
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
