/**
 * 스케줄표 · 주일 편성처럼 자리가 좁은 곳에 쓰는 "줄인 이름".
 *   · 세 글자 한글 이름은 성을 떼고 이름만:       정지원 → 지원
 *   · 줄였더니 다른 사람과 같아지면 성 + 이름 첫 글자:  조희영 · 김희영 → 조희 · 김희
 *   · 그래도 같으면(조희영 · 조희정 · 김희영 · 김희정 처럼 서로 얽힌 경우) 줄이지 않고 이름 전체
 *   · 그 밖의 이름(두 글자 · 영어 · 네 글자)은 그대로
 * 화면 쪽 같은 규칙은 public/hub/hubshim.js 의 shortName (D.members 로 계산).
 */
const isKo3 = (n) => /^[가-힣]{3}$/.test(n);

/** @param {Iterable<string>} names  같은 팀 · 같은 화면에 나오는 모든 이름  @returns {Map<string,string>} 이름 → 줄인 이름 */
function shortMap(names) {
  const all = Array.from(new Set(Array.from(names || []).map((n) => String(n || '').trim()).filter(Boolean)));
  const out = new Map();
  const count = (list) => { const c = new Map(); list.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return c; };
  // 1차: 성 떼기. 줄인 이름이 (줄이지 않는) 다른 이름과도 겹치는지까지 본다
  const first = new Map();
  all.forEach((n) => first.set(n, isKo3(n) ? n.slice(1) : n));
  const c1 = count(Array.from(first.values()));
  all.forEach((n) => out.set(n, c1.get(first.get(n)) > 1 && isKo3(n) ? n.slice(0, 2) : first.get(n)));
  // 2차: 성 + 첫 글자로 바꿨는데도 겹치면 이름 전체
  const c2 = count(Array.from(out.values()));
  all.forEach((n) => { if (isKo3(n) && c2.get(out.get(n)) > 1) out.set(n, n); });
  return out;
}

/** 이름 목록 → (이름) => 줄인 이름 (목록에 없는 이름은 그 자리에서 세 글자면 성만 뗌) */
function shortFn(names) {
  const m = shortMap(names);
  return (n) => { n = String(n || '').trim(); return m.has(n) ? m.get(n) : (isKo3(n) ? n.slice(1) : n); };
}

module.exports = { shortMap, shortFn };
