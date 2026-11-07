/**
 * V13 포지션 아이콘 — 섬기는 이 · 스케줄표에서 자리 이름 앞에. 가는 선(1.4) · 각진 끝 · 금색(currentColor).
 */
const P = {
  인도자: '<rect x="9" y="2.5" width="6" height="9" rx="3"/><path d="M6 9.5a6 6 0 0 0 12 0M12 15.5V21M8 21h8"/>',
  남성싱어: '<circle cx="15.5" cy="7.5" r="3.5"/><path d="M13 10l-7.5 8.5 1.5 1.5L15.5 12"/>',
  여성싱어: '<circle cx="13.5" cy="8.5" r="3.5"/><path d="M11 11l-6.5 7.5 1.5 1.5L14 13.5M19 3.5c1.3 1.3 1.3 3.7 0 5M21 1.8c2.3 2.3 2.3 6.1 0 8.4"/>',
  드럼: '<ellipse cx="12" cy="11" rx="8" ry="3"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M8 13.7v6M16 13.7v6M5 3l6 6.5M19 3l-6 6.5"/>',
  베이스: '<path d="M22 2l-9.5 9.5"/><path d="M12.5 11.5c-1-1-2.5-.9-3.3.1L6 14.8c-1.6 1.6-1.6 4 0 5.4 1.5 1.4 3.7 1.3 5.2-.1l3.2-3.2c1-1 1-2.6 0-3.5z"/><path d="M7.8 16.2l2 2M17.5 3.5l1.5-1.5M19.5 5.5l1.5-1.5M16 5l1.5 1.5M18 7l1.5 1.5"/>',
  일렉: '<path d="M20.5 3.5l-7 7M19 2l3 3"/><path d="M13.5 10.5c-1-1-2.6-1-3.4.1l-.6.9-2.4.4c-2.2.4-3.6 2.3-3.2 4.4.3 1.6 1.4 2.8 2.9 3.2 2.1.6 4.2-.6 4.8-2.6l.5-1.9 1-.7c1.1-.8 1.2-2.6.4-3.8z"/><path d="M6.8 14.2l3 3M8.8 12.4l2.8 2.8"/>',
  피아노: '<rect x="2.5" y="5" width="19" height="14"/><path d="M7 19v-5M12 19v-5M17 19v-5"/><path d="M5.5 5v9h3V5M10.5 5v9h3V5M15.5 5v9h3V5" fill="currentColor" stroke="none" opacity=".9"/>',
  신디: '<rect x="2.5" y="6" width="19" height="12"/><path d="M2.5 12h19M6.5 12v6M10.5 12v6M14.5 12v6M18.5 12v6"/><circle cx="6.5" cy="9" r="1"/><circle cx="10.5" cy="9" r="1"/><path d="M14 9h5"/>',
  어쿠기타: '<path d="M18 2.5l3.5 3.5-6 6"/><path d="M14 10c-1.4-1.4-3.4-1.2-4.4.1-.5.6-.6 1.4-1.5 1.7-1.8.5-3.6.8-4.6 2.2-1.6 2.1-.9 5 1 6.5 1.6 1.4 4.3 1.6 6-.2 1.2-1.2 1.3-2.9 1.9-4.4.4-.9 1.2-1 1.8-1.6 1.2-1.2 1.2-3 -.2-4.3z"/><circle cx="9" cy="15" r="1.6"/>',
  음향: '<path d="M5 3v18M12 3v18M19 3v18"/><rect x="3" y="13" width="4" height="3" fill="currentColor"/><rect x="10" y="6" width="4" height="3" fill="currentColor"/><rect x="17" y="10" width="4" height="3" fill="currentColor"/>',
  PPT: '<rect x="2.5" y="3.5" width="19" height="12.5"/><path d="M12 16v4M8 21h8M6.5 7.5h7M6.5 10.5h11M6.5 13h5"/>',
  방송총괄: '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="13" width="4" height="6"/><rect x="17.5" y="13" width="4" height="6"/><path d="M19.5 19c0 1.7-2.5 2.5-5.5 2.5h-1.5"/>',
};
function icon(pos) {
  const d = P[pos] || '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5"/>';
  return `<svg class="pi13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${d}</svg>`;
}
module.exports = { icon, P };
