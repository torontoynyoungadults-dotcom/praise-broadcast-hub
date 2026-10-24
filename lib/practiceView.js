/**
 * 연습일 기준으로 묶어 보기 — "연습 콘티" 탭과 맨 위 배너의 "이번 주 연습 안내"가 함께 씁니다.
 *
 *  · 연습일은 예배(주일 · 행사)마다 따로 정해져 있습니다(lib/practice.js). 여기서는 거꾸로
 *    "이 연습 날에 어떤 예배들의 콘티를 연습하나"로 묶습니다 — 한 금요일에 2주치를 연습하면 두 예배가 한 묶음.
 *  · '연습 없음' · 날짜 미정인 예배는 빠집니다.
 */
const sheetsDb = require('./sheetsDb');
const prac = require('./practice');
const week = require('./weekUtil');
const timeSettings = require('./timeSettings');
const { canonicalPosition } = require('./positions');

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const md = (d) => { const x = new Date(d + 'T12:00:00'); return `${x.getMonth() + 1}월 ${x.getDate()}일`; };
const dowOf = (d) => new Date(d + 'T12:00:00').getDay();

/** 예배 하나의 이름 — "10월 25일 주일" · "부흥회(11월 1일)" */
function targetName(t) { return t.event ? `${t.name}(${md(t.date)})` : `${md(t.date)} 주일`; }

/**
 * 연습 날짜가 [from, to] 안에 있는 연습들 — 날짜 순.
 * @returns {Promise<{date:string, note:string, targets:{key:string,date:string,event:string,name:string}[]}[]>}
 */
async function groups(team, from, to) {
  const [rows, evRows, ts] = await Promise.all([
    sheetsDb.readAll('연습일정'), sheetsDb.readAll('특별예배'), timeSettings.get(team)]);
  const mine = rows.filter((r) => r['팀ID'] === team);
  const defNote = timeSettings.practiceNote(ts);
  const last = prac.addDays(to, prac.MAX_BACK);                 // 연습일은 예배보다 최대 28일 앞 — 그만큼 뒤 예배까지 봄
  const cands = [];
  for (let d = from; d <= last; d = prac.addDays(d, 1)) if (dowOf(d) === 0) cands.push({ key: d, date: d, event: '', name: '' });
  evRows.filter((e) => e['팀ID'] === team && prac.isDate(e['날짜']) && e['날짜'] >= from && e['날짜'] <= last)
    .forEach((e) => cands.push({ key: 'ev-' + e['ID'], date: e['날짜'], event: String(e['ID']), name: String(e['이름'] || '주일 외 찬양') }));
  const by = new Map();
  cands.forEach((c) => {
    const p = prac.practiceFor(c.key, c.date, mine, defNote);
    if (p.none || p.unset || !p.date || p.date < from || p.date > to) return;
    const g = by.get(p.date) || by.set(p.date, { date: p.date, note: '', time: '', place: '', targets: [] }).get(p.date);
    if (!g.note && p.note) g.note = p.note;
    g.targets.push(c);
  });
  const out = Array.from(by.values()).sort((a, b) => a.date.localeCompare(b.date));
  out.forEach((g) => { const w = whenOf(g.note || defNote, ts); g.time = w.time; g.place = w.place; });
  out.forEach((g) => g.targets.sort((a, b) => a.date.localeCompare(b.date) || (a.event ? 1 : 0) - (b.event ? 1 : 0)));
  return out;
}

/**
 * 연습 안내 문구("오후 6시 30분 본당" · "저녁 7시 반 소예배실" 등)에서 시작 시각과 장소를 읽음 — 캘린더 일정용.
 * 시각을 못 읽으면 관리의 기본 연습 시간, 장소를 못 읽으면 기본 장소.
 */
function whenOf(note, ts) {
  const s = String(note || '').trim();
  let time = '', rest = s;
  const m = /((?:오전|오후|저녁|낮|밤|아침)\s*)?(\d{1,2})\s*(?::\s*(\d{2})|시(?:\s*(\d{1,2})\s*분|\s*(반))?)/.exec(s);
  if (m) {
    const ap = /오후|저녁|밤/.test(m[1] || '') ? '오후 ' : /오전|아침/.test(m[1] || '') ? '오전 ' : (m[1] || '').includes('낮') ? '오후 ' : '';
    const mi = m[3] || m[4] || (m[5] ? '30' : '0');
    time = timeSettings.parse(`${ap}${m[2]}시 ${mi}분`);
    rest = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/^[\s·,-]+|[\s·,-]+$/g, '').trim();
  }
  return { time: time || (ts && ts.practice) || '18:30', place: rest || (ts && ts.place) || '' };
}

/** 그 예배(target)에 이 사람이 서는지 · 연습에 못 온다고 했는지 */
function standing(name, target, assignRows, offRows) {
  const inT = (r) => (target.event ? r['행사ID'] === target.event : (!r['행사ID'] && r['날짜'] === target.date));
  const pos = [];
  assignRows.filter((r) => inT(r) && String(r['이름'] || '').trim() === name).forEach((r) => { const p = canonicalPosition(String(r['포지션'] || '').trim()); if (p && !pos.includes(p)) pos.push(p); });
  const off = offRows.some((r) => String(r['날짜']) === target.key && String(r['이름'] || '').trim() === name && String(r['구분'] || '').trim() !== '예배');
  return { pos, off };
}

/* ---------------------------------------------------------------- 맨 위 배너 — 이번 주(월~주일) 연습 · 주일 안내 */
/** "18:30" → "6:30PM" */
function enTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]}${h < 12 ? 'AM' : 'PM'}`;
}
const mdS = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const targetShort = (t) => (t.event ? t.name : `${mdS(t.date)} 주일`);
/** 주일(date)에 이 사람이 서는 포지션 — '주일 불참' · '둘 다 불참'이면 off */
function sundayStanding(name, date, A, O) {
  const pos = [];
  A.filter((r) => !r['행사ID'] && r['날짜'] === date && String(r['이름'] || '').trim() === name).forEach((r) => { const p = canonicalPosition(String(r['포지션'] || '').trim()); if (p && !pos.includes(p)) pos.push(p); });
  const off = O.some((r) => String(r['날짜']) === date && String(r['이름'] || '').trim() === name && String(r['구분'] || '').trim() !== '연습');
  return { pos, off };
}

/**
 * 맨 위 배너 — 이번 주(월요일 ~ 그 주 주일) 기준으로 연습 · 주일을 함께 알려 줌.
 *   ① 연습 있음(+ 주일도 섬기면 주일 줄)  ② 연습은 없지만 주일은 섬김  ③ 연습이 지난 뒤 토 · 일: 이번 주일은 섬기는 주
 *   ④ 연습 불참 + 주일 섬김  ⑤ 둘 다 없음 → 다음 연습 · 다음 주일
 * @returns {Promise<null|{state:'on'|'off'|'free', head:string, href:string, lines:{k:string,text:string,pos:string[]}[]}>}
 */
async function weekNotice(team, name) {
  if (!team || !name) return null;
  const today = week.todayStr();
  const mon = prac.addDays(today, -((dowOf(today) + 6) % 7)), sun = prac.addDays(mon, 6);
  const [gsWeek, assign, offs, ts] = await Promise.all([groups(team, mon, sun), sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), timeSettings.get(team)]);
  const A = assign.filter((r) => r['팀ID'] === team), O = offs.filter((r) => r['팀ID'] === team);
  const mineIn = (g) => g.targets.map((t) => Object.assign({ t }, standing(name, t, A, O))).filter((x) => x.pos.length);
  const upcoming = gsWeek.filter((g) => g.date >= today);
  const myPrac = upcoming.map((g) => ({ g, mine: mineIn(g).filter((x) => !x.off) })).find((x) => x.mine.length);
  const offPrac = upcoming.map((g) => ({ g, mine: mineIn(g).filter((x) => x.off) })).find((x) => x.mine.length);
  const su = sundayStanding(name, sun, A, O), sunOn = su.pos.length && !su.off;
  const dayOf = (d) => WD_FULL[dowOf(d)];
  const pracDay = (upcoming[0] && dayOf(upcoming[0].date)) || '금요일';
  const dayTag = (d) => (d === today ? '(오늘)' : d === prac.addDays(today, 1) ? '(내일)' : `(${DOW[dowOf(d)]})`);
  const pracLine = (x) => ({ k: '연습', text: `${mdS(x.g.date)}${dayTag(x.g.date)} ${enTime(x.g.time)} · ${x.mine.map((m) => targetShort(m.t)).join(' · ')} 콘티`, pos: Array.from(new Set([].concat(...x.mine.map((m) => m.pos)))) });
  const sunLine = (d, pos, k) => ({ k: k || '주일', text: `${mdS(d)}${d === today ? '(오늘)' : d === prac.addDays(today, 1) ? '(내일)' : ''} · 리허설 ${enTime(ts.rehearsal)} · 예배 ${enTime(ts.worship)}`, pos });
  const sunHref = `/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(sun)}`;

  if (myPrac) {
    const lines = [pracLine(myPrac)];
    if (sunOn) lines.push(sunLine(sun, su.pos));
    return { state: 'on', head: `이번 주 ${dayOf(myPrac.g.date)} 연습 있습니다`, href: `/practice-conti?team=${encodeURIComponent(team)}&pd=${encodeURIComponent(myPrac.g.date)}`, lines };
  }
  if (sunOn) {
    let head;
    if (today === sun) head = '오늘은 찬양팀으로 섬기는 주일입니다';
    else if (offPrac) head = `이번 주 ${dayOf(offPrac.g.date)} 연습은 불참이지만, 주일은 섬기는 주입니다`;
    else if (upcoming.length || (!gsWeek.length && dowOf(today) >= 1 && dowOf(today) <= 5)) head = `이번 주 ${pracDay} 연습은 없지만, 주일은 섬기는 주입니다`;
    else head = '이번 주일은 찬양팀으로 섬기는 주입니다';
    return { state: 'on', head, href: sunHref, lines: [sunLine(sun, su.pos)] };
  }
  if (offPrac) return { state: 'off', head: `이번 주 ${dayOf(offPrac.g.date)} 연습 — 연습 불참으로 표시했어요`, href: `/practice-conti?team=${encodeURIComponent(team)}&pd=${encodeURIComponent(offPrac.g.date)}`, lines: [] };

  // ⑤ 둘 다 없음 — 다음 연습 · 다음 주일 (앞으로 8주 안)
  const lines = [];
  const later = await groups(team, prac.addDays(sun, 1), prac.addDays(sun, 56));
  const np = later.map((g) => ({ g, mine: mineIn(g).filter((x) => !x.off) })).find((x) => x.mine.length);
  if (np) lines.push(Object.assign(pracLine(np), { k: '다음 연습', text: `${mdS(np.g.date)}(${DOW[dowOf(np.g.date)]}) ${enTime(np.g.time)}` }));
  for (let i = 1; i <= 8; i++) {
    const d = prac.addDays(sun, i * 7), st = sundayStanding(name, d, A, O);
    if (st.pos.length && !st.off) { lines.push(sunLine(d, st.pos, '다음 주일')); break; }
  }
  return { state: 'free', head: '이번 주는 연습도 없고, 섬기는 주일이 아닙니다', href: `/schedule?team=${encodeURIComponent(team)}`, lines };
}
const WD_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/* ---------------------------------------------------------------- 캘린더에 넣기 */
const TZ = 'America/Toronto';
const HOURS = 2;                                                     // 연습 일정 길이 (캘린더 끝 시각)
function endOf(date, time) {
  const [h, mi] = time.split(':').map(Number), e = h + HOURS;
  return e < 24 ? { date, time: `${String(e).padStart(2, '0')}:${String(mi).padStart(2, '0')}` } : { date, time: '23:59' };
}
const stamp = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
/** 일정 하나 — { title, date, time, place, details, url } */
function calEvent(team, g, mine, baseUrl) {
  const names = (mine && mine.length ? mine.map((x) => x.name) : g.targets.map(targetName));
  const pos = mine && mine.length ? Array.from(new Set([].concat(...mine.map((x) => x.pos || [])))) : [];
  const url = (baseUrl || '') + `/practice-conti?team=${encodeURIComponent(team)}&pd=${encodeURIComponent(g.date)}`;
  return {
    title: `${team} 찬양 연습 (${names.join(' · ')} 콘티)`, date: g.date, time: g.time, place: g.place,
    details: [pos.length ? '내 포지션: ' + pos.join(' · ') : '', '연습 콘티: ' + url].filter(Boolean).join('\n'), url,
  };
}
/** 캘린더 위치 — 지도 앱이 알아보도록 교회 주소까지 ("토론토영락교회 본당, 650 McNicoll Ave, Toronto, ON M2H 2E1").
 *  메모에 다른 곳 주소(숫자로 시작하는 번지)를 적었으면 그대로 */
const CHURCH = '토론토영락교회', CHURCH_ADDR = '650 McNicoll Ave, Toronto, ON M2H 2E1';
function calLocation(place) {
  const p = String(place || '').trim();
  if (/\d+\s+[A-Za-z]/.test(p)) return p;
  return `${CHURCH} ${(p || '본당').replace(CHURCH, '').trim() || '본당'}, ${CHURCH_ADDR}`;
}
function googleCalUrl(ev) {
  const e = ev.end ? { date: ev.date, time: ev.end } : endOf(ev.date, ev.time);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: stamp(ev.date, ev.time) + '/' + stamp(e.date, e.time), ctz: TZ, details: ev.details, location: calLocation(ev.place) });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
/** 일정 하나의 VEVENT 줄들 */
function vevent(ev, now) {
  const e = ev.end ? { date: ev.date, time: ev.end } : endOf(ev.date, ev.time);
  const uid = ev.uid || `practice-${ev.date}-${require('crypto').createHash('sha1').update(ev.title).digest('hex').slice(0, 10)}@praise-broadcast-hub`;
  return ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${now}`, `DTSTART;TZID=${TZ}:${stamp(ev.date, ev.time)}`, `DTEND;TZID=${TZ}:${stamp(e.date, e.time)}`,
    `SUMMARY:${icsEsc(ev.title)}`, `LOCATION:${icsEsc(calLocation(ev.place))}`, `DESCRIPTION:${icsEsc(ev.details)}`, `URL:${ev.url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(ev.alarm || '찬양 연습')}`, 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT'];
}
/** .ics 파일 내용 — 아이폰 캘린더 · 아웃룩 · 구글 캘린더 가져오기. 일정 하나(ev) 또는 여러 개(배열). 1시간 전 알림 포함 */
function icsText(evs, cal) {
  const list = Array.isArray(evs) ? evs : [evs];
  const head = cal ? [`X-WR-CALNAME:${icsEsc(cal.name || '')}`, 'X-WR-TIMEZONE:' + TZ].concat(cal.refresh ? [`REFRESH-INTERVAL;VALUE=DURATION:${cal.refresh}`, `X-PUBLISHED-TTL:${cal.refresh}`] : []) : [];
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//YN Praise Hub//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'].concat(head, [
    'BEGIN:VTIMEZONE', `TZID:${TZ}`,
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE'])
    .concat(...list.map((ev) => vevent(ev, now)))
    .concat(['END:VCALENDAR']).join('\r\n') + '\r\n';
}

module.exports = { endOf, TZ, calLocation, groups, weekNotice, standing, targetName, md, whenOf, calEvent, googleCalUrl, icsText, enTime };
