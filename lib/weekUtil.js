/** 주일(일요일) 날짜 계산 — 예배콘티 · 스케줄표 등 "이번 주" 개념이 필요한 기능에서 공용으로 씁니다. */
const TZ = 'America/Toronto';

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // en-CA => YYYY-MM-DD
}

function isValidDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

/** 입력이 없거나 잘못됐으면 "다가오는(또는 오늘) 주일"을 돌려줍니다 */
function normalizeDate(input) {
  if (isValidDateStr(input)) return input;
  const today = todayStr();
  const d = new Date(today + 'T12:00:00'); // 정오로 고정 — DST 경계에서도 요일 계산이 안 틀어지게
  const day = d.getDay(); // 0=일요일
  const addDays = day === 0 ? 0 : (7 - day);
  d.setDate(d.getDate() + addDays);
  return d.toISOString().slice(0, 10);
}

function shiftWeek(dateStr, deltaWeeks) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + deltaWeeks * 7);
  return d.toISOString().slice(0, 10);
}

/** 2026-10-04(주일) 같은 표시용 문자열 */
function labelKo(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${dateStr} (${days[d.getDay()]})`;
}

/** 10/4(주일)·10/3(토) 같은 짧은 표시용 문자열 — 스케줄표 주차 제목(연습일 - 주일) 등 공간이 좁은 곳에 씀.
 * sundayLabel: true면 일요일을 "(일)" 대신 "(주일)"로 */
function shortKo(dateStr, sundayLabel) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const day = d.getDay();
  const dayLabel = (day === 0 && sundayLabel) ? '주일' : days[day];
  return `${d.getMonth() + 1}/${d.getDate()}(${dayLabel})`;
}

module.exports = { todayStr, isValidDateStr, normalizeDate, shiftWeek, labelKo, shortKo };
