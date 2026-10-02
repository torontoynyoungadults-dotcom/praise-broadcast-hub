/**
 * 스케줄표(주차별 편성)에서 쓰는 포지션 목록 — church-app 예배콘티의 "주일 편성"과 같은 포지션 체계입니다.
 */
const POSITION_GROUPS = [
  ['세션', ['피아노', '신디', '드럼', '베이스', '일렉', '어쿠기타']],
  ['싱어', ['인도자', '남성싱어', '여성싱어', '알토']],
  ['방송', ['음향', 'PPT', '방송총괄']],
];

const ALL_POSITIONS = POSITION_GROUPS.reduce((a, g) => a.concat(g[1]), []);

// "피아노" 포지션은 예전엔 "건반"이라는 이름으로 저장돼 있었음 — 이름만 바꾸고 이미 배정된
// 기존 데이터(찬양편성.포지션='건반')는 그대로 "피아노" 칸에 묶여 보이게 하는 호환용 별칭.
const POSITION_ALIASES = { 피아노: ['건반'], 방송총괄: ['코디'] };
/** 찬양편성 행의 포지션 값을 지금 쓰는 이름(별칭 반영)으로 바꿔줌 — byPos 묶을 때 공용으로 씀 */
function canonicalPosition(pos) {
  for (const canon of Object.keys(POSITION_ALIASES)) {
    if (POSITION_ALIASES[canon].includes(pos)) return canon;
  }
  return pos;
}

// 주일 편성·팀원관리에서 포지션 이름 앞에 붙이는 작은 아이콘 — 이모티콘 대신 직접 그린 선 아이콘(lib/uiIcons.js).
const POSITION_ICON_NAME = {
  피아노: 'piano', 신디: 'synth', 드럼: 'drum', 베이스: 'bass', 일렉: 'egt', 어쿠기타: 'agt',
  인도자: 'mic', 남성싱어: 'voice', 여성싱어: 'voice', 알토: 'voice',
  음향: 'sound', PPT: 'ppt', 방송총괄: 'codi', 기도인도: 'pray',
};
function positionIcon(posKey) { return require('./uiIcons').icon(POSITION_ICON_NAME[posKey] || 'user'); }

// 스케줄표·주일편성에서 "이 자리엔 이 역할(lib/schema.js ROLE_OPTIONS)인 사람이 어울린다"는 힌트 —
// 배정 칸의 팀원 선택 목록에서 역할이 맞는 사람을 위로 올려 보여주는 데 씀(회원.역할 기준).
// 피아노/신디/알토는 역할 목록엔 따로 없어서(역할은 "건반"·"여싱"만), 그 역할로 추천함.
const POSITION_ROLE_HINT = {
  피아노: ['건반'], 신디: ['건반'],
  드럼: ['드럼'], 베이스: ['베이스'], 일렉: ['일렉'], 어쿠기타: ['어쿠기타'],
  인도자: ['인도자'], 남성싱어: ['남싱'], 여성싱어: ['여싱'], 알토: ['여싱'],
  음향: ['음향'], PPT: ['PPT'], 방송총괄: ['총무'],
  기도인도: ['목회자'],
};

module.exports = { POSITION_GROUPS, ALL_POSITIONS, POSITION_ICON_NAME, positionIcon, POSITION_ROLE_HINT, POSITION_ALIASES, canonicalPosition };
