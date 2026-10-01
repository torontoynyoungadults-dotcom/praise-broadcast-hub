/**
 * 스케줄표(주차별 편성)에서 쓰는 포지션 목록 — church-app 예배콘티의 "주일 편성"과 같은 포지션 체계입니다.
 */
const POSITION_GROUPS = [
  ['싱어', ['인도자', '남성싱어', '여성싱어']],
  ['세션', ['건반', '신디', '드럼', '베이스', '일렉', '어쿠기타']],
  ['방송', ['음향', 'PPT', '코디']],
  ['기도', ['기도인도']],
];

const ALL_POSITIONS = POSITION_GROUPS.reduce((a, g) => a.concat(g[1]), []);

module.exports = { POSITION_GROUPS, ALL_POSITIONS };
