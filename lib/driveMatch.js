/**
 * 드라이브 녹음 찾기 — 콘티 화면의 「녹음 찾기」 가 NAS 파일들 가운데 이 예배의 연습 녹음 · 예배 녹음일 만한 것을 골라 줍니다.
 * (순수 함수 — 서버 의존 없음. routes/drive.js 의 GET /drive/suggest 가 씀)
 *
 * 점수 단서
 *  · 파일 이름 · 폴더 이름에 적힌 날짜 (2026-10-18 · 20261018 · 261018 · 10.18 · 1018 · 10월 18일)
 *  · 파일 수정 날짜 (NAS 에 올라간/녹화한 날)
 *  · 그 예배 날짜(주일 · 행사) · 그 예배의 연습일
 *  · 파일 이름에 콘티 곡 제목 · 행사 이름 · "예배/주일/연습/리허설" 같은 말
 * 날짜가 맞지 않으면 아무리 이름이 비슷해도 추천하지 않습니다 (다른 주 녹음을 잘못 붙이지 않게).
 */

const DAY = 86400000;
const toMs = (ymd) => Date.parse(ymd + 'T12:00:00Z');
const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((toMs(a) - toMs(b)) / DAY);       // a - b (일)
const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[\s\-_.·,!?'"()\[\]{}~/]+/g, '');

/** 이름에서 날짜 후보 — 연도가 빠진 날짜(10.18 · 10월 18일 · 1018)는 refYears 의 해마다 하나씩. 실제로 있는 날짜만 */
function datesIn(text, refYears) {
  const years = [].concat(refYears);
  const s = String(text || '');
  const out = new Set();
  const add = (y, m, d) => {
    y = Number(y); m = Number(m); d = Number(d);
    if (y < 100) y += 2000;
    if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (ymdOf(toMs(iso)) === iso) out.add(iso);
  };
  let m;
  const re1 = /(?<!\d)(20\d{2})[-_.\s/]?(\d{1,2})[-_.\s/]?(\d{1,2})(?!\d)/g;          // 2026-10-18 · 2026.10.18 · 20261018
  while ((m = re1.exec(s))) {
    if (m[0].replace(/\D/g, '').length === 8 || /[-_.\s/]/.test(m[0])) add(m[1], m[2], m[3]);
  }
  const re2 = /(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/g;                                     // 261018
  while ((m = re2.exec(s))) add(m[1], m[2], m[3]);
  const re3 = /(\d{1,2})\s*월\s*(\d{1,2})\s*일?/g;                                       // 10월 18일
  while ((m = re3.exec(s))) years.forEach((y) => add(y, m[1], m[2]));
  const re4 = /(?<![\d.\-])(\d{1,2})[.\-/](\d{1,2})(?![\d.\-/])/g;                        // 10.18 · 10-18
  while ((m = re4.exec(s))) years.forEach((y) => add(y, m[1], m[2]));
  const re5 = /(?<!\d)(0[1-9]|1[0-2])([0-2]\d|3[01])(?!\d)/g;                             // 1018 (MMDD, 앞뒤 숫자 없음)
  while ((m = re5.exec(s))) years.forEach((y) => add(y, m[1], m[2]));
  return Array.from(out);
}

const SERVICE_WORDS = /(예배|주일|본예배|service|worship|sunday|live)/i;
const PRACTICE_WORDS = /(연습|리허설|rehearsal|practice|합주)/i;

/**
 * @param {{name:string, path:string, mtime:number}} f   NAS 파일 (mtime 초)
 * @param {{date:string, prac?:string, eventName?:string, songs?:string[]}} t  이 예배
 * @returns {{score:number, kind:'연습'|'예배', reasons:string[]}|null}  날짜 단서가 없으면 null
 */
function scoreFile(f, t) {
  const D = t.date, P = t.prac && /^\d{4}-\d{2}-\d{2}$/.test(t.prac) ? t.prac : '';
  const year = Number(D.slice(0, 4));
  const reasons = [];
  let score = 0, dateHit = false, kindVote = 0;            // kindVote > 0 예배 · < 0 연습

  // 1) 이름 · 폴더에 적힌 날짜
  const named = datesIn(String(f.path || f.name || ''), [year, year - 1, year + 1]);      // 연도 없는 날짜(10.18)는 앞뒤 해도 — 1월 초 예배의 12월 연습
  let bestNamed = null;
  named.forEach((d) => {
    const dd = diffDays(d, D);
    let s = 0, why = '', k = 0;
    if (dd === 0) { s = 60; why = '이름에 예배 날짜'; k = 1; }
    else if (P && d === P) { s = 58; why = '이름에 연습 날짜'; k = -1; }
    else if (dd >= -6 && dd <= -1) { s = 40; why = '이름에 그 주 날짜'; k = -1; }
    if (s && (!bestNamed || s > bestNamed.s)) bestNamed = { s, why, k };
  });
  if (bestNamed) { score += bestNamed.s; reasons.push(bestNamed.why); dateHit = true; kindVote += bestNamed.k * 2; }
  else if (named.some((d) => Math.abs(diffDays(d, D)) <= 45)) return null;       // 이름에 다른 날짜(지난주 등)가 분명히 적혀 있으면 — 올린 날이 가까워도 다른 예배 녹음

  // 2) 파일 날짜 (녹화 · 올린 날)
  if (f.mtime) {
    const md = new Date(f.mtime * 1000).toLocaleDateString('sv-SE', { timeZone: 'America/Toronto' });
    const dd = diffDays(md, D);
    let s = 0, why = '', k = 0;
    if (dd === 0) { s = 40; why = '예배 날 올라온 파일'; k = 1; }
    else if (P && md === P) { s = 38; why = '연습 날 올라온 파일'; k = -1; }
    else if (dd >= -6 && dd <= -1) { s = 22; why = '그 주에 올라온 파일'; k = -1; }
    else if (dd >= 1 && dd <= 3) { s = 18; why = '예배 뒤 며칠 안에 올라온 파일'; k = 1; }
    if (s) { score += bestNamed ? Math.round(s / 2) : s; reasons.push(why); dateHit = true; kindVote += k; }
  }
  if (!dateHit) return null;

  // 3) 이름 — 곡 제목 · 행사 이름 · 예배/연습 말
  const nm = norm(f.name) + ' ' + norm(String(f.path || '').split('/').slice(-2, -1)[0] || '');
  const songHits = (t.songs || []).filter((x) => { const k = norm(x); return k.length >= 2 && nm.includes(k); });
  if (songHits.length) { score += Math.min(30, songHits.length * 15); reasons.push('곡 제목 ' + songHits.slice(0, 2).join(' · ')); }
  if (t.eventName) {
    const ev = norm(t.eventName);
    if (ev.length >= 2 && nm.includes(ev)) { score += 20; reasons.push('행사 이름 ' + t.eventName); }
  }
  const raw = String(f.path || f.name || '');
  if (PRACTICE_WORDS.test(raw)) { kindVote -= 3; score += 5; reasons.push('"연습"이 들어간 이름'); }
  else if (SERVICE_WORDS.test(raw)) { kindVote += 3; score += 5; reasons.push('"예배"가 들어간 이름'); }

  return { score, kind: kindVote > 0 ? '예배' : '연습', reasons };
}

/**
 * 파일 목록에서 추천 — 점수 높은 순 (같은 점수면 예배 날짜에 가까운 순) · 최대 limit 개
 * @param {Array<{name,path,mtime,size}>} files
 * @param {object} target  scoreFile 의 t
 * @param {Set<string>} [linked]  이미 이 예배에 연결된 경로 (표시만 — 빼지는 않음)
 */
function suggest(files, target, linked, limit) {
  const out = [];
  files.forEach((f) => {
    const r = scoreFile(f, target);
    if (!r || r.score < 30) return;
    out.push(Object.assign({ name: f.name, path: f.path, mtime: f.mtime || 0, size: f.size || 0, linked: !!(linked && linked.has(f.path)) }, r));
  });
  const near = (x) => (x.mtime ? Math.abs(x.mtime * 1000 - toMs(target.date)) : 1e15);
  out.sort((a, b) => (a.linked - b.linked) || (b.score - a.score) || (near(a) - near(b)));
  return out.slice(0, limit || 8);
}

module.exports = { datesIn, scoreFile, suggest, diffDays };
