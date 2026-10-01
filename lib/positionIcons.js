/**
 * 포지션 아이콘 — 이모지 대신 직접 그린 심플한 라인 일러스트(스트로크 기반, currentColor).
 * 전부 24x24 뷰박스, 한 가지 선굵기로 통일해서 아이콘 배지 안에서 톤이 맞게 둠.
 */
const ICONS = {
  // 건반류
  피아노: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 5v8M11 5v8M15 5v8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3 13h18" stroke="currentColor" stroke-width="1.6"/></svg>`,
  신디: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 7v5M10 7v5M13.5 7v5M17 7v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="4" r="1.3" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="4" r="1.3" stroke="currentColor" stroke-width="1.4"/><circle cx="17" cy="4" r="1.3" stroke="currentColor" stroke-width="1.4"/></svg>`,
  // 현악/타악
  드럼: `<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="8" rx="8" ry="3" stroke="currentColor" stroke-width="1.6"/><path d="M4 8v6c0 1.66 3.58 3 8 3s8-1.34 8-3V8" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 4.5L5 1.5M15.5 4.5L19 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  베이스: `<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="16" r="4.3" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="16" r="1.3" stroke="currentColor" stroke-width="1.3"/><path d="M11.8 13.2L18 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.6 7.4l2.9-1.1M16.9 9.4l2.6-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  일렉: `<svg viewBox="0 0 24 24" fill="none"><path d="M8 15.5c-2 1.8-3 3-3.3 4a1 1 0 001.3 1.3c1-.3 2.2-1.3 4-3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="9.3" cy="14.2" r="3.1" stroke="currentColor" stroke-width="1.6"/><path d="M11.5 12L18 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.8 8.2l2.7-1M17 10.2l2.6-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  어쿠기타: `<svg viewBox="0 0 24 24" fill="none"><path d="M13.5 10.5c2.3 2.3 3.5 4.7 3.5 6.6 0 2.3-1.8 4.1-4 4.1-2.5 0-5-2.1-5-5.2 0-1.9 1.2-4 3.5-6.3" stroke="currentColor" stroke-width="1.6"/><circle cx="13.3" cy="16.6" r="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M12 10.8L18 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.6 5.6l2.7-.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  // 보컬
  인도자: `<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="10" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0012 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 17v3.5M9 20.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4 5l1.3 1.3M20 5l-1.3 1.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  남성싱어: `<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="10" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0012 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 17v3.5M9 20.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  여성싱어: `<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="10" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0012 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 17v3M9.5 20.5h5M12 20v1.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5.3 9.3L4 8M18.7 9.3L20 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  알토: `<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="10" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0012 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 17v3.5M9 20.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3.5 13.5l1.8 1.8M20.5 13.5l-1.8 1.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  // 방송
  음향: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 13a8 8 0 0116 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="2.5" y="13" width="4" height="6" rx="1.6" stroke="currentColor" stroke-width="1.5"/><rect x="17.5" y="13" width="4" height="6" rx="1.6" stroke="currentColor" stroke-width="1.5"/></svg>`,
  PPT: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4.5" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M9 20.5h6M12 16.5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7 12.2l2.6-3 2 2.2L15.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  코디: `<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="4.5" width="14" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><rect x="9" y="3" width="6" height="3" rx="1.2" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 11.5h7M8.5 15h7M8.5 18h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  // 토요일
  기도인도: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 20.5c0-3.4 1.8-5.6 4-7.6 2.2 2 4 4.2 4 7.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 20.5h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 9c0-1.8 1.3-3.3 3-3.3s3 1.5 3 3.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
};

/** 못 찾은 포지션을 위한 기본(점) 아이콘 */
const FALLBACK = `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/></svg>`;

function positionIconSvg(posKey) {
  return ICONS[posKey] || FALLBACK;
}

module.exports = { positionIconSvg };
