/**
 * V11 테마 — church-app CSS 의 색(보라 · 주황 · 청록 · 남색 슬레이트 · 분홍)을 이 앱의 "청록 + 연한 주황 · 노랑" 팔레트로 바꾸는 규칙.
 *   · tools/port-church-hub.js 가 yn.css 를 만들 때 쓰고 (church-app 원본은 그대로 두고 만들 때만 바꿈),
 *     public/worship/hub.css · live-base.css 도 같은 규칙으로 한 번 옮겨 놓았습니다 (node tools/theme-remap.js <파일> …).
 *   · 색 하나하나가 아니라 "색 계열" 로 바꿉니다: 보라 · 주황 · (church-app 밝은 화면의) 청록 = 강조색 → 산호 주황,
 *     남색 슬레이트 · 거의 검정 = 진한 청록 숲색, 분홍 · 자주 → 살구 · 세이지, 빨강은 부드러운 붉은 계열 그대로.
 *   · 한 번만 지나가는 규칙이라 결과 색은 다시 돌려도 같습니다 (결과 색이 다시 바뀌지 않게 계열마다 겹치지 않음).
 */
const fs = require('fs');

/* ---------- 팔레트 (app.css 의 토큰과 같은 값) ---------- */
const P = {
  coral: '#F39E70',      // 강조 칸(단추 · 선택) — 어두운/밝은 화면 공통
  coralInk: '#A94B1F',   // 밝은 화면에서 글씨로 쓰는 진한 산호
  onCoral: '#17302A',    // 산호 칸 위 글씨 — 진한 숲색 (대비 5:1 이상)
};

/* 정확히 이 색이면 이 값으로 (church-app 의 이름 있는 색들). 나머지는 아래 계열 규칙 */
const EXACT = {
  // church-app 밝은 화면의 청록 강조 → 산호 (칸 · 글씨 · 칸 위 글씨)
  '#46BDC6': P.coral, '#2FA3AD': '#C45E30', '#0B6E77': P.coralInk, '#06363B': P.onCoral, '#05353A': P.onCoral,
  '#5CCAD2': '#F5B48C', '#7FD6DD': '#F7C6A4', '#0E6E77': P.coralInk, '#0E7490': P.coralInk, '#0B3A40': P.onCoral, '#0F2A2E': '#12302A',
  '#5F8A90': '#7F9C93',
  // 옅은 청록 바탕 → 옅은 살구
  '#CCF1F4': '#FDE6D6', '#064E55': '#7A3A17', '#ECFEFF': '#FFF6EF', '#F3FCFD': '#FFFAF6', '#E7F6F8': '#FFF0E6',
  '#EDFAFB': '#FFF6EF', '#DDF3F6': '#FDE8D9', '#D9F1F4': '#FCE3D2', '#E0F2FE': '#E6F3EE',
  // church-app 어두운 화면의 주황 → 부드러운 산호 · 살구
  '#FF8A2A': '#F4A272', '#FF8A2B': '#F4A272', '#FF8A3D': '#F4A272', '#FFB066': '#F7C49B', '#FF9D47': '#F8B684', '#FF7A1C': '#F2966B', '#FF7A1A': '#F2966B',
  // 보라 강조 → 산호
  '#6C4FD3': '#F2A074', '#8E73F2': '#F4A87C', '#A78BFA': '#F7C39B', '#F4F0FF': '#FFF1E6',
  // 연한 보라 · 분홍 바탕 → 크림 · 살구
  '#F3EEFF': '#FFF1E6', '#ECE9F7': '#F6EEE4', '#E4D7FF': '#FBE3CF', '#E2D9FF': '#FBE3CF', '#D9CEFF': '#F9D9BF', '#C9BAFF': '#F7CDAB',
  '#B8A6FF': '#F7C49B', '#B7A6F2': '#F0B58B', '#FBFAFF': '#FFFAF5', '#FFD6EA': '#FFE3CF', '#F4F4F8': '#F4F1E8',
  // 보라 글씨 → 진한 산호 · 숲색
  '#7A4FB5': '#A94B1F', '#5B3FC0': '#A94B1F', '#5B21B6': '#A94B1F', '#6D28D9': '#A94B1F', '#3E2C8F': '#7A3A17', '#1E1B4B': '#12332B',
  // 초록은 산호 · 청록과 구분되게 맑은 풀색 · 민트로
  '#5DFF9A': '#86E0B0', '#7FE0A9': '#8FDCB4', '#C8F7D8': '#D6F2DE', '#7BD88F': '#9ADE9A',
  // 빨강 — 분홍 기운 없는 부드러운 붉은색
  '#E11D48': '#D24A40', '#DC2626': '#CF473E', '#FF6B6B': '#F27A70', '#FF8A8A': '#F58E84', '#FF8F8F': '#F58E84',
  '#FFB9B9': '#F8B4A6', '#FFB0B0': '#F8B0A2', '#FFB3B3': '#F8B4A6', '#FFC2C2': '#F9C2B6', '#FFD2D2': '#FAD0C6', '#FFD0D0': '#FAD0C6',
  '#FFB4A8': '#F7B5A2', '#FFB3A6': '#F7B5A2', '#FDECEC': '#FBECE6', '#FFFBFA': '#FFFAF6', '#FFF6F3': '#FFF6F0',
  '#E6C9C5': '#E5CFC2', '#B91C1C': '#B8352B', '#E0554C': '#D5584C', '#F0654F': '#E4694F',
};
const EXACT_RGB = { '244,114,182': '198,213,143' };   // #F472B6 분홍 → 세이지
// rgba(…) 로 쓴 같은 색도 위 표와 똑같이 (16진수 표의 색을 3개짜리 숫자로 풀어 둠)
Object.keys(EXACT).forEach((k) => {
  const n = parseInt(k.slice(1), 16), t = parseInt(EXACT[k].slice(1), 16);
  EXACT_RGB[`${n >> 16},${(n >> 8) & 255},${n & 255}`] = `${t >> 16},${(t >> 8) & 255},${t & 255}`;
});

/* ---------- 색 변환 도우미 ---------- */
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l, d];
}
function hsl2rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round((v + m) * 255))));
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();
const toHex = (rgb) => '#' + rgb.map(hex2).join('');

/** 계열 규칙 — [r,g,b] → [r,g,b] (바꿀 게 없으면 그대로) */
function mapRgb(r, g, b) {
  const [h, s, l, d] = rgb2hsl(r, g, b);
  const chroma = d;                                                   // 0 ~ 1
  if (l < 0.012 || l > 0.985) return [r, g, b];                       // 순수 검정 · 흰색
  // 1) 거의 회색 — 아주 어두운 면(밤 배경 · 어두운 유리)만 청록 숲색으로, 밝은 회색은 따뜻한 크림 그대로
  if (chroma < 0.04) {
    if (l < 0.2) return hsl2rgb(168, 0.3, l);
    if (l >= 0.85 && h >= 195 && h < 262 && chroma > 0.008) return hsl2rgb(150, 0.28, l);   // 푸르스름한 흰색 → 연한 민트 흰색
    return [r, g, b];
  }
  // 2) 남색 · 슬레이트 (파랑이지만 채도가 낮은 것) → 청록 숲색 / 연한 민트 흰색
  if (h >= 195 && h < 262 && chroma < 0.2) {
    if (l < 0.3) return hsl2rgb(166, 0.36, l);
    if (l > 0.9) return hsl2rgb(150, 0.22, l);
    return hsl2rgb(165, 0.14, l);
  }
  // 3) 진짜 파랑 (정보 · 하늘색 칩, 보라 기운이 없는 것) — 그대로
  if (h >= 195 && h < 246) return [r, g, b];
  // 4) 보라 · 남보라 · 자주 · 분홍 (246–340): 어두운 건 숲색 글씨, 밝은 건 크림 살구, 중간은 산호
  if (h >= 246 && h < 340) {
    if (l < 0.25) return hsl2rgb(166, 0.36, l);
    if (l > 0.88) return hsl2rgb(28, 0.85, l);
    return hsl2rgb(20, clamp(s * 0.85, 0.5, 0.85), l);
  }
  // 5) 빨강 (340–360 · 0–10) — 분홍 기운을 걷어 낸 붉은색
  if (h >= 340 || h < 10) {
    if (l > 0.78) return hsl2rgb(10, clamp(s * 0.8, 0.4, 0.85), l);
    return hsl2rgb(5, clamp(s * 0.88, 0.4, 0.8), l);
  }
  // 6) 채도 낮은 따뜻한 회색 · 베이지 · 아주 옅은 살구는 그대로 (크림 바탕 · 회색 글씨로 어울림)
  if (h >= 10 && h < 60 && chroma < 0.13) return l < 0.2 ? hsl2rgb(168, 0.3, l) : [r, g, b];
  // 6b) 주황 · 갈색 (10–45) → 산호 계열 (어두운 갈색은 산호 칸 위 숲색 글씨 / 진한 산호 글씨)
  if (h >= 10 && h < 45) {
    if (l < 0.2) return hsl2rgb(166, 0.4, clamp(l * 1.5 + 0.03, 0.07, 0.2));
    if (l < 0.27 && s > 0.7) return hsl2rgb(166, 0.36, 0.2);
    if (l < 0.46) return hsl2rgb(18, clamp(s * 0.8, 0.45, 0.7), l);
    return hsl2rgb(17 + (h - 17) * 0.45, clamp(s * 0.8, 0.3, 0.86), clamp(l + (l > 0.5 && l < 0.75 ? 0.07 : 0), 0, 0.97));
  }
  // 7) 청록 · 시안 (170–195) — church-app 밝은 화면 강조색의 변주 → 산호 (어두운 건 숲색)
  if (h >= 170 && h < 195 && chroma >= 0.1) {
    if (l < 0.2) return hsl2rgb(166, 0.4, l);
    if (l < 0.46) return hsl2rgb(18, 0.62, l);
    if (l > 0.9) return hsl2rgb(28, 0.85, l);
    return hsl2rgb(21, 0.8, l);
  }
  return [r, g, b];                                                   // 노랑 · 초록 등은 그대로
}

/* church-app 밝은 화면은 청록 #46BDC6 을 "글씨 색" 으로도 썼습니다 (흰 바탕에서 대비가 낮음). 산호로 바뀐 뒤에도 같은 문제가 없도록
   글씨 · 선 색(color · fill · stroke)으로 쓰인 연한 산호(#F39E70)는 진한 산호(#A94B1F)로 */
function inkFix(css) {
  return css.replace(/((?:^|[;{\s])(?:color|fill|stroke|-webkit-text-fill-color)\s*:\s*)#F39E70\b/gi, (m, a) => a + P.coralInk);
}

/* 산호 칸(배경이 산호 · 살구인 규칙) 위의 흰 글씨 → 진한 숲색 (흰 글씨는 산호 위에서 대비 2:1 정도라 안 보임) */
const CORALS = /background(?:-color)?\s*:[^;{}]*#(?:F4A87C|F2A074|F4A272|F39E70|F2966B|F8B684|F7C49B|F5B48C)/i;
function onCoralFix(css) {
  return css.replace(/\{[^{}]*\}/g, (body) => CORALS.test(body)
    ? body.replace(/((?:^|[;{\s])color\s*:\s*)#(?:fff|ffffff)\b(\s*!important)?/gi, (m, a, imp) => a + P.onCoral + (imp || ''))
    : body);
}

/* church-app 밝은 화면의 "청록 → 진한 청록" 그라데이션이 "산호 → 진한 산호(갈색 기운)" 가 되면 무겁고 글씨 대비도 모자랍니다.
   끝 색을 진한 산호 대신 부드러운 살구로 (칸 위 글씨는 진한 숲색 그대로 잘 읽힘) */
function softenGradients(css) {
  return css.replace(/linear-gradient\(([^,()]+),\s*(#[0-9a-fA-F]{6}),\s*#(?:A94B1F|C45E30|BE5528)\)/gi,
    (m, dir, from) => `linear-gradient(${dir}, ${from.toUpperCase() === '#F39E70' ? '#F7BC84' : '#F8C9A6'}, ${from})`);
}

/* ---------- CSS 문자열 전체에 적용 ---------- */
function remapCss(css) {
  const seen = (m, fn) => fn(m);
  // #RRGGBB / #RGB (그리고 SVG data URI 속 %23RRGGBB)
  css = css.replace(/(#|%23)([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g, (m, pre, hx) => {
    const full = hx.length === 3 ? hx.split('').map((c) => c + c).join('') : hx;
    const key = '#' + full.toUpperCase();
    const to = EXACT[key] || toHex(mapRgb(parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)));
    if (to === key) return m;
    return pre + (pre === '#' && hx === hx.toLowerCase() && hx.length === 6 ? to.slice(1).toLowerCase() : to.slice(1));
  });
  // rgb(…) · rgba(…)
  css = css.replace(/(rgba?\(\s*)(\d{1,3})(\s*,\s*)(\d{1,3})(\s*,\s*)(\d{1,3})/g, (m, a, r, c1, g, c2, b) => {
    const key = `${r},${g},${b}`;
    const o = EXACT_RGB[key] ? EXACT_RGB[key].split(',').map(Number) : mapRgb(+r, +g, +b);
    return a + o[0] + c1 + o[1] + c2 + o[2];
  });
  // 변수에 담은 3개짜리 숫자 (--g-a-rgb: 255, 138, 42 · var(--tone-rgb, 210,81,31))
  css = css.replace(/(-rgb\s*[:,]\s*)(\d{1,3})(\s*,\s*)(\d{1,3})(\s*,\s*)(\d{1,3})/g, (m, a, r, c1, g, c2, b) => {
    const key = `${r},${g},${b}`;
    const o = EXACT_RGB[key] ? EXACT_RGB[key].split(',').map(Number) : mapRgb(+r, +g, +b);
    return a + o[0] + c1 + o[1] + c2 + o[2];
  });
  return softenGradients(onCoralFix(inkFix(css)));
}

module.exports = { remapCss, inkFix, onCoralFix, softenGradients, mapRgb, PALETTE: P };

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('사용: node tools/theme-remap.js <css 파일> …  (제자리에서 고침)'); process.exit(1); }
  files.forEach((f) => { const a = fs.readFileSync(f, 'utf8'); const b = remapCss(a); fs.writeFileSync(f, b); console.log(f, a === b ? '(변화 없음)' : '다시 칠함'); });
}
