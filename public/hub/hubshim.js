/**
 * 스케줄표 · 라이브러리 — church-app 화면 코드(public/hub/hubport.js · library.js · stats.js …)를 이 앱에 연결하는 손으로 쓴 부분.
 * ------------------------------------------------------------
 * church-app 의 찬양 허브(views/Worship.html)는 한 화면 안에서 전역 TOKEN · D · TAB · render() · tab() · callServer() 를 씁니다.
 * 여기서 같은 이름을 똑같은 약속으로 만들어 주고, 이 앱에만 있는 것만 더합니다:
 *   · 포지션 이름 · 묶음 (이 앱의 lib/positions.js — 피아노 · 신디 · … · 알토 · 음향 · PPT · 방송총괄. 토요일 기도인도는 없음)
 *   · 연습일 — church-app 은 "주일 전날(토)" 을 그냥 보여주지만, 이 앱의 3부 팀은 주일 바로 전 금요일이 기본이고 자주 바뀌므로
 *     예배(주일 · 행사)마다 눌러서 바꿀 수 있고, 한 번에 여러 예배를 같이 연습하는 날도 정할 수 있습니다
 *     (stPracHtml · stPractice · stPracBox — 서버 worshipPracticeSet)
 *   · 스케줄표 제목 옆 "내가 안 되는 날" 단추 (stOffBtn · stMinePanel) · 목회자 호칭 "윤정환 목사" (dispName · shortName)
 *   · 날짜를 눌러 "이 날 예배 준비 열기" → 이 앱의 예배콘티 화면으로
 *   · 떠 있는 창(아래에서 올라오는 시트 · 녹음 플레이어 · 통계 팝업)은 .yn 안(ynPortal)에 띄워 church-app 모양 그대로
 */
/* eslint-disable no-unused-vars */
var HUB = window.__HUB__ || {};
var TOKEN = HUB.token || '';
var D = HUB.D || { who: '', canEdit: false, positions: [], members: [], weeks: [], events: [], today: '', nextWeek: '' };
D.weeks = D.weeks || []; D.events = D.events || [];
var CACHE = {};
var W = null;
var DATE = D.nextWeek || D.thisWeek || '';
var TAB = HUB.tab || 'sched';
var LIBTABS = ['repo', 'archive', 'stats'];
var LB = { last: 'repo' };

/* 스케줄표 칸 순서 — church-app ST_GROUPS 자리 (이 앱 포지션 이름) */
var ST_GROUPS = [
  ['싱어', ['인도자', '남성싱어', '여성싱어', '알토']],
  ['세션', ['드럼', '베이스', '일렉', '피아노', '신디', '어쿠기타']],
  ['방송', ['음향', 'PPT', '방송총괄']]
];
var ST_SHORT = { 인도자: '인도', 남성싱어: '남싱', 여성싱어: '여싱', 어쿠기타: '어쿠' };

/* ---------------------------------------------------------------- 서버 호출 (church-app public/app.js 와 같은 약속) */
function callServer(name, args, onOk, onFail) {
  function bad(e) { if (onFail) onFail(e); else if (window.console) console.error('[' + name + ']', e); }
  fetch('/api/' + encodeURIComponent(name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ args: args || [] })
  }).then(function (res) {
    return res.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) {
        if (res.status === 413) throw new Error('파일이 너무 큽니다. 더 작은 파일로 다시 시도해주세요.');
        throw new Error('서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요. (' + res.status + ')');
      }
    });
  }).then(function (d) {
    if (d && d.ok) { if (onOk) onOk(d.result); } else bad(new Error((d && d.error) || '처리하지 못했습니다.'));
  }, function (e) {
    bad(navigator.onLine === false ? new Error('인터넷 연결을 확인해주세요.') : (e instanceof Error && /[가-힣]/.test(e.message) ? e : new Error('서버에 연결하지 못했습니다.')));
  });
}
callServer.pending = function () { return 0; };

/* ---------------------------------------------------------------- .yn 안 */
function ynRoot() { return document.querySelector('.yn.yn-main') || document.body; }
function ynPortal() {
  var p = document.getElementById('ynPortal');
  if (!p) { p = document.createElement('div'); p.id = 'ynPortal'; p.className = 'yn yn-portal'; document.body.appendChild(p); }
  return p;
}

/* ---------------------------------------------------------------- 아래에서 올라오는 시트 — church-app views/Theme.html YC.sheet · YC.close 그대로 (.yn 안에) */
var YC = (function () {
  var ov = null;
  function sheet(inner, o) {
    close(true);
    o = o || {};
    var style = (o.color ? '--c:' + o.color + ';' : '') + (o.rgb ? '--c-rgb:' + o.rgb + ';' : '');
    ov = document.createElement('div');
    ov.className = 'yc-ov';
    ov.innerHTML = '<div class="yc-sh" style="' + style + '" onclick="event.stopPropagation()">' +
      '<div class="yc-grab"></div><button type="button" class="yc-x" onclick="YC.close()" aria-label="닫기">&times;</button>' +
      inner + '</div>';
    ov.onclick = function () { close(); };
    ynPortal().appendChild(ov);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { if (ov) ov.classList.add('on'); });
  }
  function close(now) {
    if (!ov) return;
    var x = ov; ov = null;
    document.body.style.overflow = '';
    if (now) { x.remove(); return; }
    x.classList.remove('on');
    setTimeout(function () { x.remove(); }, 200);
  }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
  return { sheet: sheet, close: close };
})();

/* ---------------------------------------------------------------- 화면 그리기 · 탭 (church-app render · tab 자리) */
function render() {
  var body = el('body'); if (!body) return;
  var html = '';
  if (TAB === 'sched') html = schedTab();
  else if (TAB === 'stats') html = statsTab();
  else if (TAB === 'archive') html = archiveTab();
  else if (TAB === 'repo') html = repoTab();
  if (LIBTABS.indexOf(TAB) >= 0 && window.libNav) html = libNav() + html;
  body.innerHTML = html;
  try { if (window.YNPlayer) YNPlayer.mark(); } catch (e) { /* 플레이어가 없어도 그림 */ }
}
function tab(t) {
  if (t === 'lib') t = LB.last || 'repo';
  if (LIBTABS.indexOf(t) >= 0) LB.last = t;
  TAB = t;
  render();
  if (t === 'sched' && !ST.rows) loadSched();
  if (t === 'stats' && !SS.data) loadStats();
  if (t === 'archive' && !AR.data) loadArchive();
  if (t === 'repo' && !RP.data) loadRepo();
  try {                                               // 새로고침해도 같은 보기로
    var u = new URL(location.href);
    if (LIBTABS.indexOf(t) >= 0) { u.searchParams.set('v', t === 'archive' ? (AR.view || 'date') : t); history.replaceState(history.state, '', u.toString()); }
  } catch (e) { /* 주소를 못 바꿔도 화면은 그대로 */ }
  window.scrollTo(0, 0);
}

/** "이 날 예배 준비 열기" · 아카이브의 "열기" — 이 앱의 예배콘티 화면으로 */
function goWeek(key) {
  key = String(key || '');
  var q = '?team=' + encodeURIComponent(HUB.team || '');
  location.href = '/conti' + q + (isEv(key) ? '&event=' + encodeURIComponent(key.slice(3)) : '&date=' + encodeURIComponent(key));
}
/** 서버가 돌려준 한 주(편성 · 불가) — 스케줄표 줄에 반영 (church-app apply 자리) */
function apply(w) { if (w && w.date) stSync(w); }
function countUp() {}
function renderWeeks() {}
/** church-app 의 "주일 전날(토)" — 이 앱은 연습일을 따로 씀 (stPracHtml) */
function satOf(d) { var x = dt(d); x.setDate(x.getDate() - 1); return (x.getMonth() + 1) + '/' + x.getDate(); }

/* ---------------------------------------------------------------- 이름 — 목회자는 "윤정환 목사" (이 앱) */
function isPastor(n) {
  n = String(n || '').trim();
  return (D.members || []).some(function (m) { return m.name === n && m.pastor; });
}
/** 이름 그대로 + 목회자면 " 목사" (인도는 대개 목회자라 "정환"이 아니라 "윤정환 목사"으로) */
function dispName(n) { n = String(n || '').trim(); return isPastor(n) ? n + ' 목사' : n; }
/** "A, B" 처럼 쉼표로 이어진 이름들 각각에 호칭 */
function dispList(str) { return String(str || '').split(/\s*,\s*/).filter(Boolean).map(dispName).join(', '); }
/** 인도자 자리에 들어간 이름은 누구든(객원 포함) "강산 목사" — 이미 "목사" 가 붙어 있으면 그대로 (서버쪽: lib/honorific.js withTitle) */
var LEAD_KEY = '인도자';
function leadTitle(n) { n = String(n || '').trim(); return n && !/목사(님)?\s*$/.test(n) ? n + ' 목사' : n; }
/** 자리(포지션 키)까지 알 때의 호칭 — 인도자 자리면 항상 "목사", 아니면 목회자일 때만 */
function dispSlot(n, key) { return key === LEAD_KEY ? leadTitle(n) : dispName(n); }
/** 인도자 이름들(쉼표로 이어진 글) 각각에 "목사" */
function leadList(str) { return String(str || '').split(/\s*,\s*/).filter(Boolean).map(leadTitle).join(', '); }
/** church-app 은 세 글자 이름의 성을 떼어 "정환"으로 줄여 씁니다 — 목회자만 성 · 호칭을 다 씁니다.
 *  줄였더니 다른 사람과 같아지면(조희영 · 김희영 → 희영) 성 + 이름 첫 글자로 (조희 · 김희), 그래도 같으면 이름 전체.
 *  같은 규칙의 서버쪽: lib/shortName.js (주일 편성 칩) */
var _shortC = { m: null, r: null, map: null };
function shortMapOf() {
  var rows = (typeof ST !== 'undefined' && ST && ST.rows) || null, mem = D.members || [];
  if (_shortC.map && _shortC.m === mem && _shortC.r === rows) return _shortC.map;
  var seen = {}, names = [];
  var add = function (n) { n = String(n || '').trim(); if (n && !seen[n] && !isPastor(n)) { seen[n] = 1; names.push(n); } };
  mem.forEach(function (m) { add(m.name); });
  (rows || []).forEach(function (r) {
    Object.keys(r.slots || {}).forEach(function (k) { (r.slots[k] || []).forEach(add); });
    (r.off || []).forEach(function (x) { add(x.name); });
  });
  var ko3 = function (n) { return /^[가-힣]{3}$/.test(n); };
  var cnt = function (list) { var c = {}; list.forEach(function (x) { c[x] = (c[x] || 0) + 1; }); return c; };
  var first = {}, out = {};
  names.forEach(function (n) { first[n] = ko3(n) ? n.slice(1) : n; });
  var c1 = cnt(names.map(function (n) { return first[n]; }));
  names.forEach(function (n) { out[n] = ko3(n) && c1[first[n]] > 1 ? n.slice(0, 2) : first[n]; });
  var c2 = cnt(names.map(function (n) { return out[n]; }));
  names.forEach(function (n) { if (ko3(n) && c2[out[n]] > 1) out[n] = n; });
  _shortC = { m: mem, r: rows, map: out };
  return out;
}
function shortName(n, key) {
  n = String(n || '').trim();
  if (key === LEAD_KEY) return leadTitle(n);       // 인도자 자리 — 줄이지 않고 "강산 목사"
  if (isPastor(n)) return n + ' 목사';
  var m = shortMapOf();
  return Object.prototype.hasOwnProperty.call(m, n) ? m[n] : (/^[가-힣]{3}$/.test(n) ? n.slice(1) : n);
}

/* ---------------------------------------------------------------- 연습일 (이 앱) — 예배(주일 · 행사)마다 따로, 한 번에 여러 예배도 */
function stPracLabel(p) {
  if (!p) return '연습 미정';
  if (p.none) return '연습 없음';
  if (p.unset || !p.date) return '연습 미정';
  return md(p.date) + '(' + WD[dt(p.date).getDay()] + ')';
}
/** 같은 날 연습하는 다른 예배 — "11/2 주일 · 부흥회" */
function stPracWith(r) {
  return ((r && r.practiceWith) || []).map(function (x) { return x.name ? x.name : md(x.date) + ' 주일'; }).join(' · ');
}
/** 카드 머리 앞부분 "연습 10/2(금)" — 눌러서 바꾸기 */
function stPracHtml(r) {
  var p = r.practice || null;
  var cls = 'sat stpr' + (p && (p.none || p.unset) ? ' none' : '') + (p && !p.auto && !p.none ? ' set' : '');
  var tip = D.canEdit ? '연습일 바꾸기' : '연습일';
  var w = stPracWith(r);
  return '<span class="' + cls + '" role="button" tabindex="0" title="' + esc(tip + (w ? ' — 같은 날 연습: ' + w : '')) + '" aria-label="' + esc(tip + ' — ' + stPracLabel(p)) + '"' +
    (D.canEdit ? ' onclick="event.stopPropagation();stPractice(\'' + esc(jsq(r.key)) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();event.stopPropagation();stPractice(\'' + esc(jsq(r.key)) + '\')}"' : '') +
    '>' + (p && !p.none && !p.unset && p.date ? '<i class="prl">연습</i>' : '') + esc(stPracLabel(p)) + (w ? '<i class="prw" title="같은 날 연습: ' + esc(w) + '">+' + r.practiceWith.length + '</i>' : '') + '</span>';
}
/** 날짜 자세히 시트 — 내가 서는 날이면 연습 · 예배를 따로 캘린더에 넣기 (구글 / 아이폰 · 맥) */
function stCalBox(r) {
  if (!D.who || !Object.keys(r.slots || {}).some(function (k) { return (r.slots[k] || []).indexOf(D.who) !== -1; })) return '';
  var base = (window.PH_BASE || '') + '/cal/serve?team=' + encodeURIComponent(HUB.team || '') + '&key=' + encodeURIComponent(r.key);
  var p = r.practice || null, hasPrac = p && !p.none && !p.unset && p.date;
  function row(label, when, kind) {
    return '<div class="stcal-r"><span class="stcal-l"><b>' + esc(label) + '</b>' + esc(when) + '</span>' +
      '<a class="btn mini" href="' + esc(base + '&kind=' + kind + '&to=google') + '" target="_blank" rel="noopener">구글</a>' +
      '<a class="btn mini" href="' + esc(base + '&kind=' + kind + '&to=ics') + '">아이폰 · 맥</a></div>';
  }
  return '<div class="stme stcal"><div class="gl">내 캘린더에 넣기</div>' +
    (hasPrac ? row('연습', WD[dt(p.date).getDay()] + ' ' + md(p.date), 'prac') : '') +
    row(r.event ? '예배' : '주일', (r.event ? WD[dt(r.date).getDay()] + ' ' : '') + md(r.date), 'sun') + '</div>';
}
/** 테이블 보기의 날짜 칸 위 작은 줄 */
function stPracShort(r) {
  var p = r.practice || null;
  var t = !p || p.none || p.unset || !p.date ? stPracLabel(p) : '연습 ' + WD[dt(p.date).getDay()] + ' ' + md(p.date);
  var w = stPracWith(r);
  return '<span class="sd stpr' + (p && (p.none || p.unset) ? ' none' : '') + '"' + (D.canEdit ? ' onclick="event.stopPropagation();stPractice(\'' + esc(jsq(r.key)) + '\')"' : '') +
    ' title="' + esc((D.canEdit ? '연습일 바꾸기' : '연습일') + (w ? ' — 같은 날 연습: ' + w : '')) + '">' + esc(t) + (w ? ' <i class="prw">+' + r.practiceWith.length + '</i>' : '') + '</span>';
}
/** 날짜 자세히 시트 안의 연습 줄 */
function stPracBox(r) {
  var p = r.practice || null, w = stPracWith(r);
  var none = !p || p.none || p.unset || !p.date;
  return '<div class="yc-r stprrow"><span class="stpl">연습</span><div class="v"><span class="stprv' + (none ? ' none' : '') + '">' +
    (none ? esc(stPracLabel(p)) : esc(fmtDay(p.date))) + (p && p.note ? ' · ' + esc(p.note) : '') + '</span>' +
    (w ? '<span class="stprw">같은 날 연습 · ' + esc(w) + '</span>' : '') +
    (D.canEdit ? ' <button type="button" class="btn mini" onclick="YC.close();stPractice(\'' + esc(jsq(r.key)) + '\')">바꾸기</button>' : '') + '</div></div>';
}
/** 테이블의 가로 화면용 칸 — 맨 앞에 연습(날짜 · 메모 · 같이 연습하는 예배), 맨 뒤에 곡 수. 세로 화면 · 폰에서는 CSS 로 숨기고
 *  날짜 칸 위 작은 줄(stPracShort)로 연습일을 보여 줌 — 어느 화면이든 연습일이 주일보다 앞에 */
function stDcHead() { return '<span class="dch-n">날짜</span><span class="dch-w">주일</span>'; }
function stXFrontHead() { return '<th class="xc pc" rowspan="2">연습</th>'; }
function stXFrontMonth(mo) { return '<td class="xc pc">' + Number(String(mo).split('-')[1]) + '월</td>'; }
function stXFront(r) {
  var p = r.practice || null, w = stPracWith(r);
  var none = !p || p.none || p.unset || !p.date;
  return '<td class="xc pc' + (D.canEdit ? ' ed' : '') + (none ? ' none' : '') + '"' + (D.canEdit ? ' onclick="stPractice(\'' + esc(jsq(r.key)) + '\')"' : '') +
    ' title="' + esc((D.canEdit ? '연습일 바꾸기' : '연습일') + (w ? ' — 같은 날 연습: ' + w : '')) + '">' +
    (none ? '<span class="pn">' + esc(stPracLabel(p)) + '</span>' : '<b>' + WD[dt(p.date).getDay()] + ' ' + md(p.date) + '</b>') +
    (p && p.note && !none ? '<i>' + esc(p.note) + '</i>' : '') + (w ? '<em>+' + r.practiceWith.length + ' 함께</em>' : '') + '</td>';
}
function stXHead() { return '<th class="xc xs" rowspan="2">곡</th>'; }
function stXCells(r) {
  return '<td class="xc xs" onclick="stDay(\'' + esc(jsq(r.key)) + '\')">' + (r.songs ? '<b>' + r.songs + '</b>곡' : '<span class="pn">—</span>') + '</td>';
}
/** 'YYYY-MM-DD' + n일 (현지 날짜 그대로) */
function stDayPlus(d, n) {
  var x = new Date(String(d) + 'T12:00:00'); x.setDate(x.getDate() + n);
  var p2 = function (v) { return (v < 10 ? '0' : '') + v; };
  return x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate());
}
var PR_BACK = 28;                                    // 연습일은 그 예배 당일부터 28일 전까지 (한 금요일에 2주치 · 3주치 연습)
function stRowName(r) { return r.event ? r.event.name : fmtDate(r.date) + ' 주일'; }
/** 연습 날짜 고르는 시트 — 기본 금요일 · 지난 금요일 단추 · 같은 날 연습하는 다른 예배 체크 */
function stPractice(key) {
  var r = stRow(key); if (!r) return;
  var p = r.practice || {}, def = r.practiceDefault || '';
  var cur = p.none || p.unset || !p.date ? (def || stDayPlus(r.date, -2)) : p.date;
  var lo = stDayPlus(r.date, -PR_BACK);
  /* 고를 수 있는 금요일들 — 그 예배 직전 금요일부터 거꾸로 */
  var fri = [], x = r.date;
  for (var i = 0; i < 30 && fri.length < 4; i++) { x = stDayPlus(x, -1); if (x < lo) break; if (dt(x).getDay() === 5) fri.push(x); }
  var others = (ST.rows || []).filter(function (o) { return o.key !== key; });
  var chk = others.map(function (o) {
    var on = r.practice && o.practice && r.practice.date && o.practice.date === r.practice.date && !r.practice.none && !o.practice.none ? ' checked' : '';
    return '<label class="prchk" data-key="' + esc(o.key) + '" data-date="' + esc(o.date) + '"><input type="checkbox" value="' + esc(o.key) + '"' + on + '>' +
      '<span class="pcn"><b>' + esc(stRowName(o)) + '</b>' + (o.event ? '<i>' + md(o.date) + '(' + WD[dt(o.date).getDay()] + ')</i>' : '') + '</span>' +
      '<em class="pcs">' + (o.practice && o.practice.date && !o.practice.none ? '연습 ' + md(o.practice.date) : '연습 ' + (o.practice && o.practice.none ? '없음' : '미정')) + '</em></label>';
  }).join('');
  YC.sheet('<div class="yc-h"><h3>연습일 · ' + esc(stRowName(r)) + '</h3></div>' +
    '<p class="stsub">' + (r.event ? '이 예배의 연습 날짜를 정하세요.' : '기본은 주일 바로 전 금요일' + (def ? ', ' + esc(fmtDay(def)) : '') + '입니다.') +
      ' 한 번에 여러 예배를 연습하는 날이면 아래에서 함께 고르세요. 팀 모두에게 바로 보입니다.</p>' +
    '<div class="f"><label>연습 날짜 <span class="gsnote">' + md(lo) + ' ~ ' + md(r.date) + ' 안에서</span></label>' +
      '<input type="date" id="prDate" value="' + esc(cur) + '" min="' + esc(lo) + '" max="' + esc(r.date) + '" oninput="stPracSync(\'' + esc(jsq(key)) + '\')"></div>' +
    (fri.length ? '<div class="prfri">' + fri.map(function (f, i) {
      return '<button type="button" class="chipbtn" onclick="el(\'prDate\').value=\'' + f + '\';stPracSync(\'' + esc(jsq(key)) + '\')">' + (i === 0 ? '직전 ' : '') + '금 ' + md(f) + '</button>';
    }).join('') + '</div>' : '') +
    '<div class="f"><label>메모 <span class="gsnote">선택 — 장소 · 시간 등</span></label><input type="text" id="prNote" maxlength="60" value="' + esc(p.note || '') + '" placeholder="예: 오후 7시 · 본당"></div>' +
    (chk ? '<div class="f"><label>같은 날 연습하는 다른 예배도 <span class="gsnote">체크하면 함께 저장돼요</span></label><div class="prlist">' + chk + '</div></div>' : '') +
    '<div class="yc-acts"><button type="button" class="btn accent" onclick="stPracSave(\'' + esc(jsq(key)) + '\',\'set\')">저장</button></div>' +
    '<div class="yc-acts" style="margin-top:8px;">' +
      (p.auto && !p.unset ? '' : '<button type="button" class="btn" onclick="stPracSave(\'' + esc(jsq(key)) + '\',\'reset\')">' + (r.event ? '연습일 지우기' : '기본(금요일)으로') + '</button>') +
      (p.none ? '' : '<button type="button" class="btn" onclick="stPracSave(\'' + esc(jsq(key)) + '\',\'none\')">' + (r.event ? '연습 없음' : '이 주는 연습 없음') + '</button>') + '</div>' +
    '<p class="msg" id="prMsg"></p>', {});
  stPracSync(key);
}
/** 고른 연습 날짜가 다른 예배의 범위(그 예배 당일 ~ 28일 전) 밖이면 그 예배 체크를 막음 */
function stPracSync(key) {
  var d = val('prDate');
  Array.prototype.forEach.call(document.querySelectorAll('.prchk'), function (lb) {
    var od = lb.getAttribute('data-date'), box = lb.querySelector('input');
    var ok = !!d && d <= od && d >= stDayPlus(od, -PR_BACK);
    box.disabled = !ok; if (!ok) box.checked = false;
    lb.classList.toggle('dis', !ok);
  });
}
function stPracSave(key, mode) {
  var body = { mode: mode };
  if (mode === 'set') {
    body.date = val('prDate'); body.note = val('prNote');
    if (!body.date) { say('prMsg', '날짜를 골라주세요.', 'err'); return; }
    body.also = Array.prototype.map.call(document.querySelectorAll('.prchk input:checked'), function (c) { return c.value; });
  }
  say('prMsg', '저장하는 중…');
  callServer('worshipPracticeSet', [TOKEN, key, body], function (res) {
    if (res && res.updated) Object.keys(res.updated).forEach(function (k) { var rr = stRow(k); if (rr) rr.practice = res.updated[k]; });
    stPracLink();
    YC.close(); render(); say('stMsg', '연습일을 저장했습니다.', 'ok');
  }, function (e) { say('prMsg', (e && e.message) || '저장하지 못했습니다.', 'err'); });
}
/** 서버가 보내는 practiceWith 를 저장한 뒤에도 같게 — 같은 날 연습하는 예배끼리 서로 묶음 */
function stPracLink() {
  var by = {};
  (ST.rows || []).forEach(function (r) { if (r.practice && r.practice.date && !r.practice.none && !r.practice.unset) (by[r.practice.date] = by[r.practice.date] || []).push(r); });
  (ST.rows || []).forEach(function (r) {
    var g = r.practice && r.practice.date && !r.practice.none && !r.practice.unset ? by[r.practice.date] : null;
    r.practiceWith = g ? g.filter(function (x) { return x !== r; }).map(function (x) { return { key: x.key, date: x.date, name: x.event ? x.event.name : '' }; }) : [];
  });
}

/* ---------------------------------------------------------------- v12 내가 안 되는 날 — 한눈에 보고 누르면 끝
 * 스케줄표 위에 늘 보이는 카드. 앞으로의 주일 · 행사가 달마다 날짜 단추로 나오고, 누르면 그 자리에서 "불가"로 저장(화면은 먼저 바뀜),
 * 다시 누르면 지워집니다. 사유는 선택(안 적으면 "개인 사정"). 방금 누른 날 아래 칸에서 "둘 다 · 금요일 연습만 · 주일만" 과 사유를 바꿀 수 있습니다.
 * (예전의 제목 옆 단추 · 날짜 고르기 모드는 없앰 — 날짜를 눌러 여는 자세히 창의 "이 날 저는 어려워요" 는 그대로) */
var OFF_DEFAULT = '개인 사정';
function stOffBtn() { return ''; }
function stMinePanel() { return ''; }
function stOffCard() {
  if (!D.who) return '';
  var mineSet = {}; (ST.mine || []).forEach(function (x) { mineSet[x.date] = x; });
  var rows = (ST.rows || []).filter(function (r) { return r && r.key; });
  if (!rows.length) return '';
  var months = [], cur = null;
  rows.forEach(function (r) { var mo = r.date.slice(0, 7); if (!cur || cur.mo !== mo) { cur = { mo: mo, rows: [] }; months.push(cur); } cur.rows.push(r); });
  var n = rows.filter(function (r) { return mineSet[r.key]; }).length;
  var open = !!ST.offOpen;                                            // v12 — 평소엔 한 줄로 접어 두고, 누르면 펼쳐서 고름
  var marked = rows.filter(function (r) { return mineSet[r.key]; });
  var html = '<div class="panel offcard' + (open ? ' open' : '') + '"><button type="button" class="offc-h offc-tog" aria-expanded="' + open + '" onclick="offToggle()">' +
    '<b>내가 안 되는 날</b>' + (n ? '<span class="offc-n">' + n + '일 표시됨</span>' : '<span class="offc-z">표시한 날 없음</span>') +
    '<span class="offc-go">' + (open ? '접기' : (n ? '고치기' : '날짜 고르기')) + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></button>';
  if (!open) {
    return html + (n ? '<div class="offc-peek">' + marked.slice(0, 6).map(function (r) { return '<span>' + esc(md(r.date)) + (r.event ? ' ' + esc(String(r.event.name || '').slice(0, 6)) : '') + '</span>'; }).join('') +
      (marked.length > 6 ? '<span class="more">+' + (marked.length - 6) + '</span>' : '') + '</div>' : '') + '<p class="msg" id="offCardMsg"></p></div>';
  }
  html += '<p class="offc-hint">안 되는 날을 누르세요 — 바로 저장돼요. 다시 누르면 취소.</p>';
  months.forEach(function (m) {
    html += '<div class="offc-mon"><span class="offc-ml">' + Number(m.mo.split('-')[1]) + '월</span><div class="offc-days">' + m.rows.map(function (r) {
      var mi = mineSet[r.key], on = !!mi, d = dt(r.date);
      var sub = r.event ? esc(String(r.event.name || '행사').slice(0, 6)) : '주일';
      var tag = !on ? '' : mi.part === 'prac' ? (r.event ? '연습' : '금') : mi.part === 'sun' ? (r.event ? '당일' : '주일') : '불가';
      return '<button type="button" class="offd' + (on ? ' on' : '') + (on && mi.part !== 'all' ? ' half' : '') + (r.event ? ' ev' : '') + (ST.offEdit === r.key ? ' cur' : '') + '" aria-pressed="' + on + '" ' +
        'aria-label="' + esc(md(r.date) + ' ' + (r.event ? r.event.name : '주일') + (on ? ' — 안 되는 날로 표시됨 (누르면 취소)' : ' — 누르면 안 되는 날로 표시')) + '" onclick="offTap(\'' + esc(jsq(r.key)) + '\')">' +
        '<b>' + d.getDate() + '</b><small>' + sub + '</small>' + (on ? '<i>' + tag + '</i>' : '') + '</button>';
    }).join('') + '</div></div>';
  });
  var ed = ST.offEdit && mineSet[ST.offEdit] ? mineSet[ST.offEdit] : null, er = ed ? stRow(ST.offEdit) : null;
  if (ed) {
    var k = esc(jsq(ST.offEdit)), why = ed.part === 'prac' ? ed.pr : ed.sr || ed.pr || '';
    html += '<div class="offc-ed"><div class="offc-et"><b>' + esc(er ? (er.event ? er.event.name + ' ' + md(er.date) : md(er.date) + ' 주일') : fmtDate(ed.date)) + '</b> 안 되는 날로 표시했어요</div>' +
      '<div class="offpart"><span class="gl">어느 때가 안 돼요?</span><div class="seg">' + [['all', '둘 다'], ['prac', stPartLbl('prac', er) + '만'], ['sun', (er && er.event ? '당일' : '주일') + '만']].map(function (v) {
        return '<button type="button" class="' + (ed.part === v[0] ? 'on' : '') + '" onclick="offPartSet(\'' + k + '\',\'' + v[0] + '\')">' + esc(v[1]) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="addrow"><input type="text" id="offWhy" maxlength="100" placeholder="사유 (선택) — 예: 출장 · 시험 · 가족 행사" value="' + esc(why === OFF_DEFAULT ? '' : why) + '" onkeydown="if(event.key===\'Enter\')offWhySave(\'' + k + '\')">' +
      '<button type="button" class="btn" onclick="offWhySave(\'' + k + '\')">사유 저장</button></div></div>';
  }
  return html + '<p class="msg" id="offCardMsg"></p></div>';
}
function offDone(mine, keys, msg) { stAfterOff(mine, keys); render(); if (msg) say('offCardMsg', msg, 'ok'); }
function offToggle() { ST.offOpen = !ST.offOpen; if (!ST.offOpen) ST.offEdit = null; render(); }
function offTap(key) {
  var had = stMineOf(key), keep = (ST.mine || []).slice();
  if (had) {                                                          // 다시 누름 → 취소
    ST.mine = keep.filter(function (x) { return x.date !== key; }); if (ST.offEdit === key) ST.offEdit = null; render();
    callServer('removeMyUnavailable', [TOKEN, key, 'all'], function (mine) { offDone(mine, [key], '표시를 지웠어요.'); },
      function (e) { ST.mine = keep; render(); say('offCardMsg', (e && e.message) || '지우지 못했습니다. 다시 눌러 주세요.', 'err'); });
    return;
  }
  var r = stRow(key);                                                 // 누름 → 바로 불가 (금요일 연습 · 주일 둘 다, 화면 먼저)
  ST.mine = keep.concat([{ date: key, day: r ? r.date : key, label: r && r.event ? r.event.name : '', reason: OFF_DEFAULT, part: 'all', pr: OFF_DEFAULT, sr: OFF_DEFAULT }]); ST.offEdit = key; render();
  callServer('setMyUnavailableMany', [TOKEN, [key], OFF_DEFAULT, 'all'], function (mine) { offDone(mine, [key], '저장했어요. 사유는 적지 않아도 돼요.'); },
    function (e) { ST.mine = keep; ST.offEdit = null; render(); say('offCardMsg', (e && e.message) || '저장하지 못했습니다. 다시 눌러 주세요.', 'err'); });
}
/** 둘 다 · 금요일 연습만 · 주일만 — 없앨 쪽만 지우고(서버가 나머지를 남김), 둘 다면 다시 표시 */
function offPartSet(key, part) {
  var m = stMineOf(key); if (!m || m.part === part) return;
  var why = m.sr || m.pr || OFF_DEFAULT;
  say('offCardMsg', '저장하는 중…');
  var fail2 = function (e) { say('offCardMsg', (e && e.message) || '저장하지 못했습니다.', 'err'); };
  if (part === 'all') { callServer('setMyUnavailableMany', [TOKEN, [key], why, 'all'], function (mine) { offDone(mine, [key], '금요일 연습 · 주일 모두 안 되는 날로 바꿨어요.'); }, fail2); return; }
  var drop = part === 'prac' ? 'sun' : 'prac';
  var then = function () { callServer('removeMyUnavailable', [TOKEN, key, drop], function (mine) { offDone(mine, [key], part === 'prac' ? '연습만 안 되는 날로 바꿨어요. (예배는 나올 수 있음)' : '예배만 안 되는 날로 바꿨어요. (연습은 나올 수 있음)'); }, fail2); };
  if (m.part === 'all') then();
  else callServer('setMyUnavailableMany', [TOKEN, [key], why, part], function () { then(); }, fail2);   // 반대쪽만 표시돼 있던 날 — 원하는 쪽을 먼저 표시한 뒤 반대쪽을 지움
}
function offWhySave(key) {
  var m = stMineOf(key), why = val('offWhy') || OFF_DEFAULT;
  say('offCardMsg', '저장하는 중…');
  callServer('setMyUnavailableMany', [TOKEN, [key], why, (m && m.part) || 'all'], function (mine) { ST.offEdit = null; offDone(mine, [key], '사유를 저장했어요.'); },
    function (e) { say('offCardMsg', (e && e.message) || '저장하지 못했습니다.', 'err'); });
}

/* ---------------------------------------------------------------- 안 되는 날 — 금요일 연습 · 주일(행사) 예배를 따로
 * 서버 off 항목: { name, reason, part: 'all' | 'prac' | 'sun', pr (연습 사유), sr (예배 사유) }
 * 내 표시(ST.mine) 항목: { date, day, label, reason, part, pr, sr }  — 금요일은 못 와도 주일은 나올 수 있게 */
function offMap(list) {          // 편성 고르기 · 칸에서 "불가"로 치는 사람 = 예배(주일/행사)를 못 오는 사람 (금요일 연습만 못 오면 불가 아님)
  var o = {};
  (list || (W && W.off) || []).forEach(function (x) { if (x.part === 'prac') return; o[x.name] = x.sr || x.reason || '불가'; });
  return o;
}
function stPartLbl(part, r) {
  if (part === 'prac') return r && r.event ? '연습' : '금요일 연습';
  if (part === 'sun') return r && r.event ? r.event.name : '주일 예배';
  return '';
}
function stOffWhy(x, r) { var l = stPartLbl(x.part, r); return (l ? l + ' 불가 · ' : '') + (x.reason || '불가'); }
function stOffTn(x, r) {
  var tag = x.part === 'prac' ? (r && r.event ? '연습' : '금') : x.part === 'sun' ? (r && r.event ? '당일' : '주') : '';
  return '<span class="tn off' + (x.part === 'prac' ? ' pr' : '') + (x.name === ST.hl ? ' hl' : '') + '" title="' + esc(dispName(x.name) + ' — ' + stOffWhy(x, r)) + '">' +
    esc(shortName(x.name)) + (tag ? '<sup class="ot">' + tag + '</sup>' : '') + '</span>';
}
function stMineTag(m, r) {
  if (m.part === 'prac') return r && r.event ? '나 연습 불가' : '나 금요일 불가';
  if (m.part === 'sun') return r && r.event ? '나 불가' : '나 주일 불가';
  return '나 불가';
}
/** 날짜 고르는 중 — 모두 같은 범위로 저장 */
function stPartSeg() {
  var p = ST.offPart || 'all';
  return '<div class="offpart"><span class="gl">어느 때가 안 돼요?</span><div class="seg">' + [['all', '금요일 · 주일 둘 다'], ['prac', '금요일 연습만'], ['sun', '주일(예배)만']].map(function (v) {
    return '<button type="button" class="' + (p === v[0] ? 'on' : '') + '" onclick="stPart(\'' + v[0] + '\')">' + v[1] + '</button>';
  }).join('') + '</div></div>';
}
function stPart(v) { var r = val('offReason'); ST.offPart = v; render(); if (el('offReason')) el('offReason').value = r; }

/** 내 불가 줄(서버가 돌려준 ST.mine 의 한 항목)을 모든 화면의 r.off 에 반영 */
function patchOff(key, entry) {
  function fix(list) {
    list = (list || []).filter(function (x) { return x.name !== D.who; });
    if (entry) list.push({ name: D.who, reason: entry.reason, part: entry.part, pr: entry.pr || '', sr: entry.sr || '' });
    return list;
  }
  var r = stRow(key);
  if (r) r.off = fix(r.off);
  if (CACHE[key]) { CACHE[key].off = fix(CACHE[key].off); countUp(CACHE[key]); }
  renderWeeks();
}
function stMineOf(key) { return (ST.mine || []).filter(function (x) { return x.date === key; })[0] || null; }
function stAfterOff(mine, keys) {
  ST.mine = mine; D.mine = mine;
  keys.forEach(function (k) { patchOff(k, stMineOf(k)); });
}
function markOff(keys, reason, part) {
  callServer('setMyUnavailableMany', [TOKEN, keys, reason, part || 'all'], function (mine) {
    ST.pick = null; stAfterOff(mine, keys); render();
    say('stMsg', keys.length + '개 날짜를 ' + (part === 'prac' ? '금요일 연습 불가' : part === 'sun' ? '주일 불가' : '불가') + '로 표시했습니다.', 'ok');
  }, function (e) { say('offMsg', e.message || '저장하지 못했습니다.', 'err'); say('stMsg', e.message || '', 'err'); });
}
function clearOff(key, part) {
  YC.close();
  callServer('removeMyUnavailable', [TOKEN, key, part || 'all'], function (mine) { stAfterOff(mine, [key]); render(); }, fail);
}
function saveOff() {
  var r = val('offReason');
  if (!ST.pick || !ST.pick.length) { say('offMsg', '날짜를 먼저 골라주세요.', 'err'); return; }
  if (!r) { say('offMsg', '사유를 적어주세요.', 'err'); el('offReason').focus(); return; }
  say('offMsg', '저장하는 중…');
  markOff(ST.pick.slice(), r, ST.offPart || 'all');
}
/** 이미 표시한 날을 누르면 지우지 않고 자세히 열어 금요일/주일을 따로 고치게 */
function stPickDay(key) {
  if (stMineOf(key)) { stDay(key); return; }
  var i = ST.pick.indexOf(key);
  if (i === -1) ST.pick.push(key); else ST.pick.splice(i, 1);
  var reason = val('offReason');
  render();
  if (el('offReason')) el('offReason').value = reason;
}
/** 날짜 자세히 안 — 이 날 저는 어려워요 (금요일 연습 · 주일 예배 체크) */
function stMeBox(r, key, mine) {
  if (!D.who) return '';
  var k = esc(jsq(key)), pn = stPartLbl('prac', r), sn = stPartLbl('sun', r), st = mine || {};
  var done = '';
  if (st.pr) done += '<div class="mepart"><span><b>' + esc(pn) + '</b> 불가 · ' + esc(st.pr) + '</span><button type="button" class="btn mini" onclick="clearOff(\'' + k + '\',\'prac\')">해제</button></div>';
  if (st.sr) done += '<div class="mepart"><span><b>' + esc(sn) + '</b> 불가 · ' + esc(st.sr) + '</span><button type="button" class="btn mini" onclick="clearOff(\'' + k + '\',\'sun\')">해제</button></div>';
  var chk = '';
  if (!st.pr) chk += '<label class="mechk"><input type="checkbox" id="offPrac" checked><span>' + esc(pn) + '</span></label>';
  if (!st.sr) chk += '<label class="mechk"><input type="checkbox" id="offSun" checked><span>' + esc(sn) + '</span></label>';
  return '<div class="stme">' + (done ? '<div class="gl">내가 표시한 불가</div>' + done : '') +
    (chk ? '<div class="gl">' + (done ? '다른 때도 어려워요' : '이 날 저는 어려워요') + '</div><div class="mechks">' + chk + '</div>' +
      '<div class="addrow"><input type="text" id="dayReason" placeholder="사유 (선택)" maxlength="100" onkeydown="if(event.key===\'Enter\')offOne(\'' + k + '\')">' +
      '<button class="btn accent" onclick="offOne(\'' + k + '\')">표시</button></div><p class="msg" id="dayMsg" style="margin:6px 0 0;min-height:0;"></p>' : '') + '</div>';
}
function offOne(key) {
  var prac = el('offPrac'), sun = el('offSun'), r = val('dayReason');
  var wantP = prac ? prac.checked : false, wantS = sun ? sun.checked : false;
  if (!wantP && !wantS) { say('dayMsg', '금요일 연습이나 주일 예배 중 어느 때가 안 되는지 골라주세요.', 'err'); return; }
  if (!r) r = OFF_DEFAULT;                                          // v12 — 사유는 선택
  var part = wantP && wantS ? 'all' : (wantP ? 'prac' : 'sun');
  // 이미 한쪽을 표시해 둔 날에 나머지를 더하면 서버가 합쳐 줍니다
  YC.close();
  markOff([key], r, part);
}

/* ---------------------------------------------------------------- 시작 */
document.addEventListener('DOMContentLoaded', function () {
  if (!TOKEN) { var b = el('body'); if (b) b.innerHTML = '<div class="panel"><p class="empty">다시 들어와 주세요.</p></div>'; return; }
  if (HUB.view && TAB === 'archive') AR.view = HUB.view;
  tab(TAB);
});

/* 밝은/어두운 화면을 바꾸면 (배너의 스위치 — public/js/theme.js) 글씨색 지킴이를 바로 한 번 — church-app Theme.html 이 테마 바꿀 때 하는 그대로 */
(function () {
  if (!window.MutationObserver) return;
  var last = document.documentElement.getAttribute('data-theme');
  new MutationObserver(function () {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === last) return; last = t;
    try { if (window.YNContrast) YNContrast.now(); } catch (e) { /* 다음 변경 때 다시 */ }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
