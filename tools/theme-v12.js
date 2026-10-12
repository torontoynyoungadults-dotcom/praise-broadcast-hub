/**
 * V12 테마 "Evergreen & Brass" — V11 산호 주황 계열을 새 팔레트로 옮기는 두 번째 단계.
 *   · tools/theme-remap.js(V11) 다음에 지나갑니다: port-church-hub.js 가 yn.css 를 만들 때 remapCss → remapV12 순서로.
 *   · 이미 만들어 둔 파일은 제자리에서: node tools/theme-v12.js public/hub/yn.css public/worship/hub.css …
 *   · 같은 산호색이라도 규칙이 어느 화면 것인지에 따라 다르게 바꿉니다 (postcss 로 규칙마다 판단):
 *       어두운 화면 규칙 → 샴페인 골드 (칸 위 글씨는 먹색 #1A160E)
 *       밝은 화면 규칙(html[data-theme="light"] …) → 칸은 상록 #1F4A3F (그 위 글씨는 상아 #FBF8F1) · 글씨는 진한 황동 #8A5F22 · 옅은 바탕은 옅은 상록
 *   · 한 번 지나간 결과는 다시 돌려도 그대로입니다 (새 색은 산호 계열 판정에 걸리지 않음).
 */
const fs = require('fs');
const path = require('path');
let postcss;
try { postcss = require('postcss'); } catch (e) { postcss = require(path.join(__dirname, '..', 'node_modules', 'postcss')); }

const GOLD = '#D6B97F', ON_GOLD = '#1A160E';
const EVERGREEN = '#1F4A3F', ON_EVERGREEN = '#FBF8F1', BRASS_INK = '#8A5F22', INK = '#15211D';

function hex2rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
const hx = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
const rgb2hex = (c) => '#' + c.map(hx).join('');
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
  }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** V11 산호 · 살구 · 주황 계열인가 (빨강 · 분홍 · 갈색 그림자는 제외) */
function isCoral(r, g, b) {
  const [h, s, l] = rgb2hsl(r, g, b);
  return h >= 15 && h <= 38 && s >= 0.5 && l >= 0.3 && l <= 0.93 && !(r === 255 && g === 255);
}
/** 산호 칸 위 글씨로 쓰던 진한 숲색 */
const ON_CORAL = new Set(['#17302A', '#153B31', '#12302A']);

/* 자주 쓰던 값은 정확히 (나머지는 계열 규칙) */
const DARK_EXACT = {
  '#F39E70': '#D6B97F', '#F2966B': '#CDAE70', '#F4A272': '#D6B97F', '#F4A87C': '#DCC08C', '#F2A074': '#D2B377', '#F7BC84': '#E2CB9C',
  '#F1AA81': '#D9BD88', '#EF9F70': '#D3B57B', '#E28841': '#C29E5C', '#E28154': '#BF9A58', '#F5B48C': '#E0C796', '#FF8A2A': '#D6B97F',
  '#FF9D47': '#DCC08C', '#FF7A1C': '#CDAE70', '#FFB066': '#E2CB9C', '#F7C49B': '#E6D3A8', '#F8B684': '#E2CB9C', '#F8C9A6': '#E8D7B0',
  '#F7CEB8': '#EADBBE', '#FFD3B0': '#EEDFC0', '#C45E30': '#B8955A', '#A94B1F': '#C9A869', '#AF4A1F': '#C9A869', '#813B1D': '#A88A52',
};
const LIGHT_EXACT = {
  '#F39E70': EVERGREEN, '#F2966B': '#1B4238', '#F4A272': EVERGREEN, '#F4A87C': '#2A5C4F', '#F2A074': '#245247', '#F7BC84': '#3A6B5E',
  '#F1AA81': '#2A5C4F', '#EF9F70': '#245247', '#E28841': EVERGREEN, '#E28154': EVERGREEN, '#F5B48C': '#2E6356', '#FF8A2A': EVERGREEN,
  '#A94B1F': BRASS_INK, '#AF4A1F': BRASS_INK, '#C45E30': '#183D33', '#813B1D': '#6E4B1A',
  '#F7C49B': '#D3DED8', '#F8B684': '#CBD9D2', '#F8C9A6': '#DAE4DF', '#F7CEB8': '#E1E9E5', '#FFD3B0': '#E6EDE9',
};
/* 옅은 살구 바탕 → 따뜻한 상아 (두 화면 공통) */
const TINT = { '#FFF1E6': '#F3F1EA', '#FFF6EF': '#F7F5F0', '#FFFAF6': '#FBFAF7', '#FDE6D6': '#ECF0EC', '#FBE3CF': '#E8EEEA', '#FBECE6': '#F3EFE9', '#FDEBDD': '#EEF2EF' };

const OUTPUTS = new Set([GOLD, ON_GOLD, EVERGREEN, ON_EVERGREEN, BRASS_INK, INK, '#A67C3A', '#C9A869', '#3A6B5E',
  ...Object.values(DARK_EXACT), ...Object.values(LIGHT_EXACT), ...Object.values(TINT)]);
function mapHex(key, light) {
  if (OUTPUTS.has(key)) return key;                 // 이미 V12 색 — 그대로 (다시 돌려도 같은 결과)
  if (TINT[key]) return TINT[key];
  const ex = (light ? LIGHT_EXACT : DARK_EXACT)[key]; if (ex) return ex;
  const [r, g, b] = hex2rgb(key);
  if (!isCoral(r, g, b)) return key;
  const [, , l] = rgb2hsl(r, g, b);
  if (!light) return rgb2hex(hsl2rgb(40, 0.5, clamp(l, 0.42, 0.9)));            // 같은 밝기의 샴페인 골드 (색상 40° — 산호 판정 밖)
  if (l < 0.5) return BRASS_INK;                                                  // 글씨 — 진한 황동
  if (l < 0.82) return rgb2hex(hsl2rgb(164, 0.4, clamp(0.2 + (l - 0.5) * 0.3, 0.2, 0.3)));   // 칸 — 상록
  return rgb2hex(hsl2rgb(150, 0.14, clamp(l, 0.86, 0.96)));                        // 옅은 바탕 — 옅은 상록
}
function mapRgbTriplet(r, g, b, light) {
  const key = rgb2hex([r, g, b]);
  const to = mapHex(key, light);
  return to === key ? null : hex2rgb(to);
}

function recolorValue(v, light, rule) {
  v = v.replace(/(#|%23)([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g, (m, pre, h) => {
    const full = (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).toUpperCase();
    const key = '#' + full;
    let to = mapHex(key, light);
    if (ON_CORAL.has(key) && rule) to = rule.__onCoral ? (light ? ON_EVERGREEN : ON_GOLD) : (light ? (key === '#17302A' ? INK : key) : ON_GOLD);
    if (to === key) return m;
    return pre + (h === h.toLowerCase() && h.length === 6 ? to.slice(1).toLowerCase() : to.slice(1));
  });
  const trip = (m, a, r, c1, g, c2, b) => { const o = mapRgbTriplet(+r, +g, +b, light); return o ? a + o[0] + c1 + o[1] + c2 + o[2] : m; };
  v = v.replace(/(rgba?\(\s*)(\d{1,3})(\s*,\s*)(\d{1,3})(\s*,\s*)(\d{1,3})/g, trip);
  v = v.replace(/(-rgb\s*[:,]\s*)(\d{1,3})(\s*,\s*)(\d{1,3})(\s*,\s*)(\d{1,3})/g, trip);
  return v;
}
const isLightSel = (sel) => /data-theme=["']?light/.test(sel);

/** 규칙에 산호 칸(배경 · 테두리)이 있는가 — 그 규칙의 진한 숲색 글씨는 "칸 위 글씨" */
function hasCoralFill(rule) {
  let yes = false;
  rule.walkDecls(/^(background|background-color|background-image|border-color)$/, (d) => {
    const re = /#([0-9a-fA-F]{6})(?![0-9a-zA-Z])|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})|var\(--(accent|tone|lt-or|g-a|v6-a|c-a)\)/g; let m;
    while ((m = re.exec(d.value))) {
      if (m[5]) { yes = true; break; }
      const c = m[1] ? hex2rgb(m[1]) : [+m[2], +m[3], +m[4]];
      if (isCoral(c[0], c[1], c[2])) { yes = true; break; }
    }
  });
  return yes;
}

function remapV12(css) {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    const light = isLightSel(rule.selector);
    rule.__onCoral = hasCoralFill(rule);
    rule.walkDecls((d) => {
      if (d.parent !== rule) return;
      const nv = recolorValue(d.value, light, rule);
      if (nv !== d.value) d.value = nv;
    });
  });
  return root.toString();
}

module.exports = { remapV12, mapHex };

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('사용: node tools/theme-v12.js <css 파일> …  (제자리에서 고침)'); process.exit(1); }
  files.forEach((f) => { const a = fs.readFileSync(f, 'utf8'); const b = remapV12(a); fs.writeFileSync(f, b); console.log(f, a === b ? '(변화 없음)' : '다시 칠함'); });
}
