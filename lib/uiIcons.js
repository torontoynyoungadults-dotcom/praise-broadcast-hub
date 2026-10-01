/**
 * 서버가 그리는 화면(예배콘티 · 팀원 · 공지 …)에서 쓰는 아이콘 — 이모티콘 대신 직접 그린 선 아이콘.
 * 청년부 라이브 악보 앱의 새 아이콘 세트(public/worship/icons.js · icons-plus.js)를 그대로 읽어 씁니다 (한 곳에서 그림 → 어디서나 같은 모양).
 * 사용: ui.icon('mic') → '<svg class="yi yi-mic" …>' (크기는 글자 크기를 따라감 — public/css/app.css 의 .yi)
 */
const fs = require('fs');
const path = require('path');

const win = {};
['icons.js', 'icons-plus.js'].forEach((f) => {
  // eslint-disable-next-line no-new-func
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'public', 'worship', f), 'utf8'))(win);
});
const YN = win.YNIcon;

/** 이름 → 아이콘 (없는 이름은 점 하나 'tag') */
function icon(name, extra) { return YN.has(name) ? YN.get(name, extra) : YN.get('tag', extra); }

/** 팀원 역할(lib/schema.js ROLE_OPTIONS) → 아이콘 이름 */
const ROLE_ICON = {
  인도자: 'mic', 남싱: 'voice', 여싱: 'voice', 건반: 'piano', 드럼: 'drum', 베이스: 'bass', 일렉: 'egt', 어쿠기타: 'agt',
  음향: 'sound', PPT: 'ppt', 목회자: 'cross', 총무: 'clipboard', 회계: 'wallet', 기타: 'tag',
};
const roleIcon = (r, extra) => icon(ROLE_ICON[r] || 'tag', extra);

module.exports = { icon, roleIcon, ROLE_ICON, names: () => YN.names() };
