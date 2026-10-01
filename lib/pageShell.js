/**
 * 모든 페이지가 공유하는 뼈대: 머리말(제목 + 다크/라이트 · 글자크기 · 새로고침) + 내용 + 바닥글.
 * 바닥글 태그라인은 '설정' 시트의 '태그라인' 값을 쓰고, 없으면 기본값을 씁니다(관리자가 나중에 설정 화면에서 바꿀 수 있게 될 자리).
 */
const sheetsDb = require('./sheetsDb');

const DEFAULT_TAGLINE = '소망이 넘치는 교회';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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

module.exports = { render, esc };
