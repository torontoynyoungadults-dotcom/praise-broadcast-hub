/**
 * 스케줄표 · 라이브러리 — church-app 화면 코드(public/hub/hubport.js · library.js · stats.js …)를 이 앱에 연결하는 손으로 쓴 부분.
 * ------------------------------------------------------------
 * church-app 의 찬양 허브(views/Worship.html)는 한 화면 안에서 전역 TOKEN · D · TAB · render() · tab() · callServer() 를 씁니다.
 * 여기서 같은 이름을 똑같은 약속으로 만들어 주고, 이 앱에만 있는 것만 더합니다:
 *   · 포지션 이름 · 묶음 (이 앱의 lib/positions.js — 피아노 · 신디 · … · 알토 · 음향 · PPT · 코디. 토요일 기도인도는 없음)
 *   · 연습일 — church-app 은 "주일 전날(토)" 을 그냥 보여주지만, 이 앱의 3부 팀은 주일 바로 전 금요일이 기본이고 자주 바뀌므로
 *     눌러서 바꿀 수 있습니다 (stPracHtml · stPractice · stPracBox — 서버 worshipPracticeSet)
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
  ['세션', ['피아노', '신디', '베이스', '일렉', '어쿠기타', '드럼']],
  ['싱어', ['인도자', '남성싱어', '여성싱어', '알토']],
  ['방송', ['음향', 'PPT', '코디']]
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

/* ---------------------------------------------------------------- 연습일 (이 앱) */
function stPracLabel(p) {
  if (!p || p.none) return '연습 없음';
  return md(p.date) + '(' + WD[dt(p.date).getDay()] + ')';
}
/** 카드 머리 "10/2(금) – 10/4 (주일)" 의 앞부분 — 눌러서 바꾸기 */
function stPracHtml(r) {
  var p = r.practice || null;
  var cls = 'sat stpr' + (p && p.none ? ' none' : '') + (p && !p.auto && !p.none ? ' set' : '');
  var tip = D.canEdit ? '연습일 바꾸기' : '연습일';
  return '<span class="' + cls + '" role="button" tabindex="0" title="' + tip + '" aria-label="' + esc(tip + ' — ' + stPracLabel(p)) + '"' +
    (D.canEdit ? ' onclick="event.stopPropagation();stPractice(\'' + esc(jsq(r.key)) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();event.stopPropagation();stPractice(\'' + esc(jsq(r.key)) + '\')}"' : '') +
    '>' + esc(stPracLabel(p)) + ' –</span>';
}
/** 테이블 보기의 날짜 칸 */
function stPracShort(r) {
  var p = r.practice || null;
  var t = !p || p.none ? '연습 없음' : WD[dt(p.date).getDay()] + ' ' + md(p.date);
  return '<span class="sd stpr' + (p && p.none ? ' none' : '') + '"' + (D.canEdit ? ' onclick="event.stopPropagation();stPractice(\'' + esc(jsq(r.key)) + '\')" title="연습일 바꾸기"' : '') + '>' + esc(t) + '</span>';
}
/** 날짜 자세히 시트 안의 연습 줄 */
function stPracBox(r) {
  if (r.event) return '';
  var p = r.practice || null;
  return '<div class="yc-r stprrow"><span class="stpl">연습</span><div class="v"><span class="stprv' + (p && p.none ? ' none' : '') + '">' +
    (p && !p.none ? esc(fmtDay(p.date)) : '연습 없음') + (p && p.note ? ' · ' + esc(p.note) : '') + '</span>' +
    (D.canEdit ? ' <button type="button" class="btn mini" onclick="YC.close();stPractice(\'' + esc(jsq(r.key)) + '\')">바꾸기</button>' : '') + '</div></div>';
}
/** 'YYYY-MM-DD' + n일 (현지 날짜 그대로) */
function stDayPlus(d, n) {
  var x = new Date(String(d) + 'T12:00:00'); x.setDate(x.getDate() + n);
  var p2 = function (v) { return (v < 10 ? '0' : '') + v; };
  return x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate());
}
function stPractice(key) {
  var r = stRow(key); if (!r || r.event) return;   // 행사에는 연습일이 없습니다 (주일만)
  var p = r.practice || {}, def = r.practiceDefault || '';
  YC.sheet('<div class="yc-h"><h3>연습일 · ' + esc(fmtDate(r.date)) + ' 주일</h3></div>' +
    '<p class="stsub">기본은 주일 바로 전 금요일' + (def ? ' (' + esc(fmtDay(def)) + ')' : '') + '입니다. 바뀌면 여기서 고치세요 — 팀 모두에게 바로 보입니다.</p>' +
    '<div class="f"><label>연습 날짜</label><input type="date" id="prDate" value="' + esc(p.none ? def : (p.date || def)) + '" min="' + esc(stDayPlus(r.date, -7)) + '" max="' + esc(stDayPlus(r.date, -1)) + '"></div>' +
    '<div class="f"><label>메모 <span class="gsnote">선택 — 장소 · 시간 등</span></label><input type="text" id="prNote" maxlength="60" value="' + esc(p.note || '') + '" placeholder="예: 오후 7시 · 본당"></div>' +
    '<div class="yc-acts"><button type="button" class="btn accent" onclick="stPracSave(\'' + esc(jsq(key)) + '\',\'set\')">저장</button></div>' +
    '<div class="yc-acts" style="margin-top:8px;">' +
      (p.auto ? '' : '<button type="button" class="btn" onclick="stPracSave(\'' + esc(jsq(key)) + '\',\'reset\')">기본(금요일)으로</button>') +
      (p.none ? '' : '<button type="button" class="btn" onclick="stPracSave(\'' + esc(jsq(key)) + '\',\'none\')">이 주는 연습 없음</button>') + '</div>' +
    '<p class="msg" id="prMsg"></p>', {});
}
function stPracSave(key, mode) {
  var body = { mode: mode };
  if (mode === 'set') {
    body.date = val('prDate'); body.note = val('prNote');
    if (!body.date) { say('prMsg', '날짜를 골라주세요.', 'err'); return; }
  }
  say('prMsg', '저장하는 중…');
  callServer('worshipPracticeSet', [TOKEN, key, body], function (res) {
    var r = stRow(key); if (r && res) r.practice = res.practice;
    YC.close(); render(); say('stMsg', '연습일을 저장했습니다.', 'ok');
  }, function (e) { say('prMsg', (e && e.message) || '저장하지 못했습니다.', 'err'); });
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
