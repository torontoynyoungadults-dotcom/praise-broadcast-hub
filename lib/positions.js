/**
 * 스케줄표(주차별 편성)에서 쓰는 포지션 목록 — church-app 예배콘티의 "주일 편성"과 같은 포지션 체계입니다.
 */
const POSITION_GROUPS = [
  ['세션', ['건반', '신디', '드럼', '베이스', '일렉', '어쿠기타']],
  ['싱어', ['인도자', '남성싱어', '여성싱어']],
  ['방송', ['음향', 'PPT', '코디']],
  ['토요일', ['기도인도']],
];

const ALL_POSITIONS = POSITION_GROUPS.reduce((a, g) => a.concat(g[1]), []);

// 주일 편성·팀원관리에서 포지션 이름 앞에 붙이는 작은 아이콘(글래스 배지에 색 대신 한눈에 들어오게).
const POSITION_ICONS = {
  건반: '🎹', 신디: '🎹', 드럼: '🥁', 베이스: '🎸', 일렉: '🎸', 어쿠기타: '🎸',
  인도자: '🎤', 남성싱어: '🎤', 여성싱어: '🎤',
  음향: '🎚️', PPT: '🖥️', 코디: '📋',
  기도인도: '🙏',
};
function positionIcon(posKey) { return POSITION_ICONS[posKey] || '👤'; }

module.exports = { POSITION_GROUPS, ALL_POSITIONS, POSITION_ICONS, positionIcon };
