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

// 스케줄표·주일편성에서 "이 자리엔 이 역할(lib/schema.js ROLE_OPTIONS)인 사람이 어울린다"는 힌트 —
// 배정 칸의 팀원 선택 목록에서 역할이 맞는 사람을 위로 올려 보여주는 데 씀(회원.역할 기준).
const POSITION_ROLE_HINT = {
  건반: ['피아노'], 신디: ['신디'],
  드럼: ['드럼'], 베이스: ['베이스'], 일렉: ['일렉'], 어쿠기타: ['어쿠기타'],
  인도자: ['인도자'], 남성싱어: ['남싱'], 여성싱어: ['여싱', '알토'],
  음향: ['음향'], PPT: ['PPT'], 코디: ['총무'],
  기도인도: ['목회자'],
};

module.exports = { POSITION_GROUPS, ALL_POSITIONS, POSITION_ICONS, positionIcon, POSITION_ROLE_HINT };
