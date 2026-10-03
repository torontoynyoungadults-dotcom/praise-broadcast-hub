/**
 * 찬양콘티 '구분' 칸 값을 셋 중 하나로 읽습니다 — 콘티(설교 전) | 결단(설교 후 찬양) | 폐회송(축도 직전).
 * 옛 기록 · 안 적힌 칸은 '콘티'로 읽습니다.
 */
const KINDS = ['콘티', '결단', '폐회송'];
const ORDER = { 콘티: 0, 결단: 1, 폐회송: 2 };   // 예배 순서 — 콘티 화면 · PDF · 라이브 악보가 모두 이 순서로 보여 줍니다

function kindOf(v) { return v === '결단' ? '결단' : (v === '폐회송' ? '폐회송' : '콘티'); }
function orderOf(kind) { return ORDER[kindOf(kind)]; }

module.exports = { KINDS, kindOf, orderOf };
