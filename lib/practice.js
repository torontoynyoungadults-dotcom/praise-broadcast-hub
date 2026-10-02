/**
 * 연습일 — 예배(주일 · 행사)마다 따로 정합니다.
 *
 *  · 기본은 주일 바로 전 금요일(주일 − 2일). 행사는 기본 연습일이 없고(미정) 정하면 그 날짜가 보입니다.
 *  · 바꾼 것은 '연습일정' 시트에 한 줄씩: 날짜 = 연습하는 날, 대상 = 어느 예배의 연습인지(주일 날짜 또는 'ev-행사ID'), 비고 = 메모 · '연습 없음'.
 *    그래서 한 번의 금요일에 두 주일치(또는 주일 + 행사)를 함께 연습하는 것도 줄을 따로 두면 됩니다 (같은 날짜 · 다른 대상).
 *  · 예전 줄(대상 칸이 비어 있음)은 "그 날짜 뒤 첫 주일의 연습"으로 읽습니다 — 이미 쌓인 자료가 그대로 보입니다.
 *  · 고를 수 있는 날짜: 그 예배 당일부터 28일 전까지 (한 금요일에 2주치를 하는 경우까지 넉넉히).
 */
const NO_PRACTICE = '연습 없음';
const MAX_BACK = 28;
const isEvKey = (k) => /^ev-/.test(k);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function addDays(d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }

/**
 * @param {string} key  주일 날짜 또는 'ev-<행사ID>'
 * @param {string} date 그 예배 날짜
 * @param {object[]} rows 이 팀의 연습일정 줄들
 * @returns {{date:string, note:string, auto:boolean, none:boolean, unset:boolean}}
 */
function practiceFor(key, date, rows, defNote) {
  defNote = isEvKey(key) ? '' : String(defNote || '');
  const isEv = /^ev-/.test(key);
  const mine = rows.filter((r) => String(r['대상'] || '').trim() === key);
  let r = mine.length ? mine[mine.length - 1] : null;
  if (!r && !isEv) {                                      // 예전 줄 — 그 날짜 뒤 첫 주일의 연습
    const from = addDays(date, -7);
    const hit = rows.filter((x) => !String(x['대상'] || '').trim() && isDate(x['날짜']) && x['날짜'] < date && x['날짜'] >= from)
      .sort((a, b) => a['날짜'].localeCompare(b['날짜']));
    if (hit.length) r = hit[hit.length - 1];
  }
  if (!r) return isEv ? { date: '', note: '', auto: true, none: false, unset: true } : { date: addDays(date, -2), note: defNote, auto: true, none: false, unset: false };
  const note = String(r['비고'] || '').trim();
  if (note === NO_PRACTICE) return { date: isEv ? '' : addDays(date, -2), note: '', auto: false, none: true, unset: false };
  return { date: String(r['날짜']), note: note || defNote, auto: false, none: false, unset: false };
}

/** 이 예배의 연습으로 읽히는 줄들 (대상이 이 예배이거나, 예전 줄로서 이 주일 창 안) — 지우기 · 바꾸기에 씀 */
function rowsOf(key, date, rows) {
  const isEv = /^ev-/.test(key);
  const from = addDays(date, -7);
  return rows.filter((x) => {
    const t = String(x['대상'] || '').trim();
    if (t) return t === key;
    return !isEv && isDate(x['날짜']) && x['날짜'] < date && x['날짜'] >= from;
  });
}

/** 고를 수 있는 날짜 범위 [min, max] */
function windowOf(date) { return [addDays(date, -MAX_BACK), date]; }

module.exports = { NO_PRACTICE, MAX_BACK, practiceFor, rowsOf, windowOf, addDays, isDate };
