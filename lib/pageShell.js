/**
 * 모든 페이지가 공유하는 뼈대: 머리말(제목 + 다크/라이트 · 글자크기 · 새로고침) + 내용 + 바닥글.
 * 바닥글 태그라인은 '설정' 시트의 '태그라인' 값을 쓰고, 없으면 기본값을 씁니다(관리자가 나중에 설정 화면에서 바꿀 수 있게 될 자리).
 */
const sheetsDb = require('./sheetsDb');

const DEFAULT_TAGLINE = '소망이 넘치는 교회';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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
          <stop offset="0%" stop-color="var(--hero-sky-1)"/>
          <stop offset="55%" stop-color="var(--hero-sky-2)"/>
          <stop offset="100%" stop-color="var(--hero-sky-3)"/>
        </linearGradient>
        <radialGradient id="phSun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="var(--hero-sun-glow)"/>
          <stop offset="100%" stop-color="var(--hero-sun-glow)" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="800" height="280" fill="url(#phSky)"/>
      <circle cx="610" cy="130" r="140" fill="url(#phSun)"/>
      <circle cx="610" cy="130" r="44" fill="var(--hero-sun)"/>
      <path d="M0,200 L90,140 L170,185 L250,120 L340,175 L430,115 L520,170 L610,130 L700,178 L800,140 L800,280 L0,280 Z" fill="var(--hero-mtn-1)"/>
      <path d="M0,230 L120,178 L210,215 L310,162 L400,205 L500,152 L600,200 L700,166 L800,210 L800,280 L0,280 Z" fill="var(--hero-mtn-2)"/>
      <path d="M0,260 L140,212 L260,246 L380,197 L500,240 L620,202 L720,236 L800,206 L800,280 L0,280 Z" fill="var(--hero-mtn-3)"/>
    </svg>
    <div class="ph-hero-text">
      ${eyebrow}
      <p class="ph-hero-title">${esc(o.title)}</p>
      ${sub}
    </div>
  </div>`;
}

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
  const title = opts.title || '찬양방송팀 허브';
  const footer = await footerHtml();
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<link rel="stylesheet" href="/css/app.css">
</head>
<body>
<header class="ph-topbar">
  <div class="ph-title">🎵 ${esc(title)}</div>
  <div class="ph-tools"></div>
</header>
<main class="ph-wrap">
${content}
${footer}
</main>
<script src="/js/theme.js" defer></script>
</body>
</html>`;
}

module.exports = { render, esc, hero };
