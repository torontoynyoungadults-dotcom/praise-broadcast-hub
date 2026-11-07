/**
 * V13 스케쥴 — 시안(Schedule 카드 / ScheduleTable 표 / ScheduleCalendar 달력)대로 그리기.
 * hubport.js 의 schedTab 을 감쌉니다. 위 "내 일정"(흑녹), 보기 탭, 카드 = 한 줄 요약(누르면 포지션 아이콘 칸 · 칸을 누르면 배정),
 * 표 = 날짜 고정 · 내 악기부터 · 내 자리 표시, 달력 = 한 달 격자 + 고른 날 자세히. 아래 변경 기록 · PDF · 엑셀.
 * 데이터 · 서버 함수 · 배정(stCell) · 자세히(stDay) · 안 되는 날(stOffCard · offTap) 은 그대로 씁니다.
 */
(function () {
  if (typeof schedTab !== 'function' || window.__v13sched) return;
  window.__v13sched = true;
  var orig = schedTab;
  var BCAST13 = { 음향: 1, PPT: 1, 방송총괄: 1 };                  // 방송 자리는 잠시 빼고 보여 줌 (스케쥴 전체)
  if (window.D && D.positions) D.positions = D.positions.filter(function (p) { return !BCAST13[p.key]; });
  var SH = { 인도자: '인도', 남성싱어: '남싱', 여성싱어: '여싱', 어쿠기타: '어쿠', 방송총괄: '방송총괄' };
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var CARD_ORDER = ['피아노', '신디', '드럼', '베이스', '일렉', '어쿠기타', '남성싱어', '여성싱어', '음향', 'PPT', '방송총괄'];
  var GROUP_OF = { 인도자: '싱어', 남성싱어: '싱어', 여성싱어: '싱어', 피아노: '세션', 신디: '세션', 드럼: '세션', 베이스: '세션', 일렉: '세션', 어쿠기타: '세션', 음향: '방송', PPT: '방송', 방송총괄: '방송' };
  var KIND_COLS = { sing: ['인도자', '남성싱어', '여성싱어'], keys: ['피아노', '신디'], drum: ['드럼'], bass: ['베이스'], egt: ['일렉'], agt: ['어쿠기타'] };
  var ICONS = (window.__HUB__ && window.__HUB__.icons13) || {};
  var TIMES = (window.__HUB__ && window.__HUB__.times) || {};
  try { ST.onlyTbd = localStorage.getItem('ph.st.onlyTbd') === '1'; } catch (e) { ST.onlyTbd = false; }
  try { ST.view = localStorage.getItem('ph.st.view13') || 'card'; } catch (e) { ST.view = 'card'; }
  if (ST.view !== 'card' && ST.view !== 'table' && ST.view !== 'cal') ST.view = 'card';
  try { ST.order13 = localStorage.getItem('ph.st.order13') || 'mine'; } catch (e) { ST.order13 = 'mine'; }

  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dot(d) { var p = String(d).split('-'); return p[1] + '.' + p[2]; }
  function posMap() { var m = {}; (D.positions || []).forEach(function (p) { m[p.key] = p; }); return m; }
  function cols() { var c = []; stGroups().forEach(function (g) { c = c.concat(g[1]); }); return c; }
  function lab(p) { var k = typeof p === 'string' ? p : p.key; return SH[k] || (typeof p === 'string' ? p : p.label); }
  function mine(r) { return cols().filter(function (p) { return (r.slots[p.key] || []).indexOf(D.who) !== -1; }); }
  function tbd(r) { return cols().filter(function (p) { return !(r.slots[p.key] || []).length; }); }
  function lead(r) { var n = (r.slots['인도자'] || [])[0]; return n ? shortName(n, '인도자') : ''; }
  function pracTxt(r, done) { var p = r.practice; if (!p) return '연습 미정'; if (p.none) return '연습 없음'; if (p.unset || !p.date) return '연습 미정'; return '연습 ' + md(p.date) + (done && p.date < today() ? ' 마침' : ''); }
  function times() { var a = []; if (TIMES.rehearsal) a.push('리허설 ' + TIMES.rehearsal); if (TIMES.worship) a.push('예배 ' + TIMES.worship); return a.join(' · '); }
  function offOf(key) { return (ST.mine || []).filter(function (x) { return x.date === key; })[0] || null; }
  function dday(d) { var n = Math.round((dt(d) - dt(today())) / 864e5); return n === 0 ? 'D-day' : n > 0 ? 'D-' + n : ''; }
  function q(s) { return esc(jsq(s)); }
  function ic(k) { return ICONS[k] ? '<svg class="pi13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true">' + ICONS[k] + '</svg>' : ''; }
  function names(r, k, full) { return (r.slots[k] || []).map(function (n) { return full ? dispName(n) : shortName(n, k); }); }

  window.st13View = function (v) { ST.view = v; try { localStorage.setItem('ph.st.view13', v); } catch (e) {} render(); };
  window.st13Tbd = function (on) { ST.onlyTbd = !!on; try { localStorage.setItem('ph.st.onlyTbd', on ? '1' : '0'); } catch (e) {} render(); };
  window.st13Order = function (v) { ST.order13 = v; try { localStorage.setItem('ph.st.order13', v); } catch (e) {} render(); };
  window.st13Open = function (key) { ST.open13 = ST.open13 === key ? '' : key; render(); };
  window.st13Pick = function (key) { ST.calSel = key; render(); var e = document.getElementById('s13-calsel'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  window.st13Cal = function (d) { ST.calMon = (ST.calMon || today().slice(0, 7)); var p = ST.calMon.split('-'); var x = new Date(Number(p[0]), Number(p[1]) - 1 + d, 1); ST.calMon = x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2); render(); };

  function shownRows() { var rows = stShown(); if (ST.onlyTbd) rows = rows.filter(function (r) { return tbd(r).length; }); return rows; }

  /* 보기 탭 — 세 보기 모두 흑녹 띠 안 (같은 모양) */
  function tabs(dark) {
    return '<div class="s13-tabs' + (dark ? ' dark' : '') + '" role="tablist" aria-label="보기">' + [['card', '카드'], ['table', '표'], ['cal', '달력']].map(function (v) {
      return '<button type="button" role="tab" aria-selected="' + (ST.view === v[0]) + '" class="' + (ST.view === v[0] ? 'on' : '') + '" onclick="st13View(\'' + v[0] + '\')">' + v[1] + '</button>';
    }).join('') + '</div>';
  }

  /* 위 — 내 일정 (흑녹) */
  function topMine() {
    var t = today(), html = '';
    if (D.who) {
      var up = (ST.rows || []).filter(function (r) { return r.date >= t && mine(r).length; }).slice(0, 4);
      var offs = (ST.mine || []).filter(function (x) { return (x.day || x.date) >= t; });
      html = '<h1 id="s13-mine-h">내 일정</h1><div class="s13-mis">' + (up.length ? up.map(function (r) {
        return '<button type="button" class="s13-mi" onclick="st13View(\'card\');ST.open13=\'' + q(r.key) + '\';render();setTimeout(function(){var e=document.getElementById(\'s13-' + q(r.key) + '\');if(e)e.scrollIntoView({block:\'center\'});},30)">' +
          '<span class="d">' + dot(r.date) + '</span><span class="m"><b>' + esc(mine(r).map(lab).join(' · ')) + (r.event ? ' · ' + esc(r.event.name) : '') + '</b><small>' + esc(pracTxt(r, true) + (r.event ? '' : ' · ' + times())) + '</small></span><span class="n">' + dday(r.date) + '</span></button>';
      }).join('') : '<p class="s13-none">앞으로 서는 날이 없어요</p>') + '</div>' +
        '<div class="s13-offs"><span class="k">안 되는 날</span>' + (offs.length ? offs.slice(0, 8).map(function (x) { return '<span class="c">' + esc(md(x.day || x.date)) + '</span>'; }).join('') : '<span class="z">없음</span>') +
        '<button type="button" class="s13-fix" onclick="offToggle()" aria-expanded="' + (!!ST.offOpen) + '">' + (ST.offOpen ? '접기' : (offs.length ? '고치기' : '날짜 고르기')) + '</button></div>' +
        (ST.offOpen ? '<div class="s13-offcard">' + stOffCard() + '</div>' : '') +
        '<a class="s13-genlink" href="/schedule/generate?team=' + encodeURIComponent(HUB.team || '') + '"><span><small>2주마다 금요일 · 금요찬양기도회 · 공휴일 빼고</small>연습 일정 미리 만들기</span><i>›</i></a>' + '<div class="s13-cal2"><button type="button" data-mysched data-team="' + esc(HUB.team || '') + '">내 일정 캘린더 구독</button><a href="/cal/google/connect?team=' + encodeURIComponent(HUB.team || '') + '">구글 캘린더 연동</a></div>';
    }
    return '<section class="s13-top" aria-labelledby="s13-mine-h">' + html + tabs(true) + '</section>';
  }

  function rangeSel() { return '<label><span>기간</span><select onchange="stRange(this.value)">' + ST_RANGES.map(function (x) { return '<option value="' + x[0] + '"' + (ST.range === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>'; }

  /* 카드 */
  function cards() {
    var people = (D.members || []).map(function (m) { return m.name; });
    var top = '<div class="s13-filt">' + rangeSel() +
      '<label><span>사람 강조</span><select onchange="ST.hl=this.value;render();"><option value="">없음</option>' + people.map(function (n) { return '<option value="' + esc(n) + '"' + (n === ST.hl ? ' selected' : '') + '>' + esc(dispName(n)) + (n === D.who ? ' (나)' : '') + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="s13-chk"><input type="checkbox"' + (ST.onlyTbd ? ' checked' : '') + ' onchange="st13Tbd(this.checked)"><span>미정 자리 있는 날만 보기</span></label>';
    var rows = shownRows(), t = today(), pm = posMap();
    if (!rows.length) return top + '<p class="s13-empty">이 기간에 보여 줄 날이 없어요.</p>';
    if (ST.open13 === undefined) { var f = rows.filter(function (r) { return r.date >= t && mine(r).length; })[0] || rows.filter(function (r) { return r.date >= t; })[0]; ST.open13 = f ? f.key : ''; }
    var out = '', last = '';
    rows.forEach(function (r) {
      var mo = r.date.slice(0, 7);
      if (mo !== last) { if (last) out += '</section>'; last = mo; out += '<section class="s13-mon"><h2><span>' + Number(mo.split('-')[1]) + '월</span>' + (mo.slice(0, 4) !== t.slice(0, 4) ? '<small>' + mo.slice(0, 4) + '</small>' : '') + '<i></i></h2>'; }
      var my = mine(r), mo2 = offOf(r.key), td = tbd(r), open = ST.open13 === r.key;
      var tag = my.length ? '<span class="tag on">나 ' + esc(my.map(lab).join(' · ')) + '</span>' : mo2 ? '<span class="tag">' + esc(stMineTag(mo2, r)) + '</span>' : '';
      var wd = r.event ? DOW[dt(r.date).getDay()] + ' · ' + esc(r.event.name) : '주일';
      var sub = (open && my.length && !r.event) ? [pracTxt(r), times()].filter(Boolean).join(' · ')
        : [pracTxt(r), td.length ? '미정 ' + td.map(lab).join(' · ') : ''].filter(Boolean).join(' · ');
      var head = '<button type="button" class="s13-rh" onclick="st13Open(\'' + q(r.key) + '\')" aria-expanded="' + open + '"><span class="d"><b>' + dot(r.date) + '</b><small>' + wd + '</small></span>' +
        '<span class="m"><span>' + (lead(r) ? '인도 ' + esc(lead(r)) : '<em>인도 미정</em>') + '</span><small>' + esc(sub) + '</small></span>' + tag + '</button>';
      if (!open) { out += '<div class="s13-row' + (r.event ? ' ev' : '') + (r.date < t ? ' past' : '') + '" id="s13-' + esc(r.key) + '">' + head + '</div>'; return; }
      var off = offMap(r.off), edit = D.canEdit && !ST.pick;
      var keys = CARD_ORDER.filter(function (k) { return pm[k]; }).concat((D.positions || []).map(function (p) { return p.key; }).filter(function (k) { return k !== '인도자' && CARD_ORDER.indexOf(k) < 0; }));
      var cells = keys.map(function (k) {
        var ns = r.slots[k] || [], me = ns.indexOf(D.who) !== -1;
        return '<div class="c' + (me ? ' me' : '') + (ns.length ? '' : ' tbd') + (k === '여성싱어' ? ' w2' : '') + (edit ? ' ed' : '') + '"' + (edit ? ' role="button" tabindex="0" onclick="stCell(\'' + q(r.key) + '\',\'' + q(k) + '\')"' : '') + '>' +
          '<dt>' + ic(k) + esc(lab(k)) + '</dt><dd>' + (ns.length ? ns.map(function (n) { return '<span class="' + (off[n] ? 'off' : '') + (n === ST.hl ? ' hl' : '') + '">' + esc(shortName(n, k)) + '</span>'; }).join(' · ') : '미정') + '</dd></div>';
      }).join('');
      out += '<article class="s13-row open' + (r.event ? ' ev' : '') + '" id="s13-' + esc(r.key) + '">' + head + '<dl class="s13-grid">' + cells + '</dl>' +
        '<div class="s13-foot"><span>' + (r.off.length ? '안 되는 사람 · ' + r.off.map(function (x) { return esc(shortName(x.name)); }).join(' · ') : '안 되는 사람 없음') + '</span>' +
        (D.canEdit ? '<button type="button" onclick="stPractice(\'' + q(r.key) + '\')">연습일</button>' : '') +
        '<button type="button" class="u" onclick="goWeek(\'' + q(r.key) + '\')">콘티 보기</button></div></article>';
    });
    return top + '<div class="s13-cards">' + out + (last ? '</section>' : '') + '</div>';
  }

  /* 표 */
  function myCols() {
    var kind = typeof stViewerKind === 'function' ? stViewerKind() : '', s = {};
    (KIND_COLS[kind] || []).forEach(function (k) { s[k] = 1; });
    (ST.rows || []).forEach(function (r) { mine(r).forEach(function (p) { s[p.key] = 1; }); });
    return s;
  }
  function table() {
    var groups = ST.order13 === 'mine' && typeof stViewGroups === 'function' ? stViewGroups() : stGroups();
    var mc = myCols();
    if (ST.order13 === 'mine') groups = groups.map(function (g) { var a = g[1].slice(); a.sort(function (x, y) { return (mc[y.key] ? 1 : 0) - (mc[x.key] ? 1 : 0); }); return [g[0], a]; });
    var cs = []; groups.forEach(function (g) { cs = cs.concat(g[1]); });
    var top = '<div class="s13-filt">' + rangeSel() + '<label><span>칸 순서</span><select onchange="st13Order(this.value)"><option value="mine"' + (ST.order13 === 'mine' ? ' selected' : '') + '>내 악기부터</option><option value="base"' + (ST.order13 !== 'mine' ? ' selected' : '') + '>기본 순서</option></select></label></div>' +
      '<p class="s13-hint2">옆으로 밀면 ' + groups.slice(1).map(function (g) { return g[0]; }).concat(['안 되는 사람']).join(' · ') + '이 나와요. 날짜 칸은 고정돼요.</p>';
    var rows = shownRows(), t = today(), edit = D.canEdit && !ST.pick;
    if (!rows.length) return top + '<p class="s13-empty">보여 줄 날이 없어요.</p>';
    var h1 = '<tr><th class="dc" rowspan="2">날짜</th>' + groups.map(function (g) { return '<th class="g" colspan="' + g[1].length + '">' + esc(g[0]) + '</th>'; }).join('') + '<th class="g offh" rowspan="2">안 되는 사람</th></tr>';
    var h2 = '<tr>' + cs.map(function (p) { return '<th class="' + (mc[p.key] ? 'my' : '') + '">' + esc(lab(p)) + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r) {
      var my = mine(r).length, off = offMap(r.off);
      return '<tr class="' + (r.date < t ? 'past' : '') + '"><th class="dc' + (my ? ' mine' : '') + '" scope="row" onclick="stDay(\'' + q(r.key) + '\')"><b>' + dot(r.date) + '</b><small>' + esc(r.event ? r.event.name : pracTxt(r)) + '</small></th>' +
        cs.map(function (p) {
          var ns = r.slots[p.key] || [], me = ns.indexOf(D.who) !== -1;
          return '<td class="' + (me ? 'me' : '') + (ns.length ? '' : ' tbd') + (edit ? ' ed' : '') + '"' + (edit ? ' onclick="stCell(\'' + q(r.key) + '\',\'' + q(p.key) + '\')"' : '') + '>' +
            (ns.length ? ns.map(function (n) { return '<span class="' + (off[n] ? 'off' : '') + (n === ST.hl && !me ? ' hl' : '') + '">' + esc(shortName(n, p.key)) + '</span>'; }).join('') : '') + '</td>';
        }).join('') +
        '<td class="offc">' + r.off.map(function (x) { return '<span>' + esc(shortName(x.name)) + '</span>'; }).join('') + '</td></tr>';
    }).join('');
    return top + '<div class="s13-tw"><table class="s13-t"><thead>' + h1 + h2 + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="s13-lg"><span><i class="a"></i> 내 자리</span><span><i class="m"></i> 내가 서는 날</span><span class="t">빈칸 · 아직 정해지지 않은 자리</span></p>' +
      '<p class="s13-hint">아이패드 · 컴퓨터에서는 옆으로 밀지 않아도 모든 칸이 한 번에 보여요.' + (D.canEdit ? ' 칸을 눌러 바로 배정할 수 있어요.' : '') + '</p>';
  }

  /* 달력 */
  function calSel(r) {
    if (!r) return '';
    var my = mine(r), mo = offOf(r.key), pm = posMap();
    var line = function (k, arr) { return arr.length ? '<div class="r"><span class="k">' + k + '</span><span class="v">' + arr.join(' · ') + '</span></div>' : ''; };
    var grp = function (g, withLab) { return CARD_ORDER.concat(['인도자']).filter(function (k) { return GROUP_OF[k] === g && pm[k] && k !== '인도자'; }).map(function (k) { var ns = names(r, k); return ns.length ? (withLab ? esc(lab(k)) + ' ' : '') + esc(ns.join(' · ')) : (withLab ? '<em>' + esc(lab(k)) + ' 미정</em>' : ''); }).filter(Boolean); };
    var title = my.length ? esc(my.map(lab).join(' · ')) + '로 섬겨요' : mo ? '안 된다고 알렸어요' : '섬기지 않는 날이에요';
    var sub = [r.event ? '' : times(), pracTxt(r, true)].filter(Boolean).join(' · ');
    return '<article class="s13-sel" id="s13-calsel"><div class="h"><div class="d"><small>' + (r.event ? esc(r.event.name) : '주일') + '</small><b>' + dot(r.date) + '</b></div><div class="t"><b>' + title + '</b><small>' + esc(sub) + '</small></div></div>' +
      '<div class="b">' + line('인도', names(r, '인도자', true).map(esc).length ? names(r, '인도자', true).map(esc) : ['<em>미정</em>']) +
        line('싱어', [].concat(names(r, '남성싱어'), names(r, '여성싱어')).map(esc)) + line('세션', grp('세션', true)) + line('방송', grp('방송', true)) +
        '<div class="acts"><button type="button" onclick="goWeek(\'' + q(r.key) + '\')">콘티 보기</button>' +
        (D.who ? '<button type="button" onclick="offTap(\'' + q(r.key) + '\')">' + (mo ? '안 되는 날 취소' : '이 날 안 된다고 알리기') + '</button>' : '') + '</div><p class="msg" id="offCardMsg"></p></div></article>';
  }
  function cal() {
    var t = today();
    ST.calMon = ST.calMon || t.slice(0, 7);
    var p = ST.calMon.split('-'), y = Number(p[0]), m = Number(p[1]) - 1;
    var first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
    var by = {}; (ST.rows || []).forEach(function (r) { (by[r.date] = by[r.date] || []).push(r); });
    var prac = {}; (ST.rows || []).forEach(function (r) { var pp = r.practice; if (pp && pp.date && !pp.none && !pp.unset) (prac[pp.date] = prac[pp.date] || []).push(r); });
    if (!ST.calSel) { var f = (ST.rows || []).filter(function (r) { return r.date >= t && mine(r).length; })[0] || (ST.rows || []).filter(function (r) { return r.date >= t; })[0]; ST.calSel = f ? f.key : ''; }
    var cells = '';
    for (var i = 0; i < 42; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== m) break;
      var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      var other = d.getMonth() !== m, rs = by[ds] || [], pr = prac[ds] || [];
      var meOn = rs.some(function (r) { return mine(r).length; });
      var inner = '<b>' + d.getDate() + '</b>' + (ds === t ? '<small>오늘</small>' : '') +
        rs.map(function (r) { var my = mine(r); return '<small>' + (r.event ? esc(String(r.event.name).slice(0, 5)) : '주일') + '</small>' + (my.length ? '<small class="me">' + esc(my.map(lab).join('·')) + '</small>' : offOf(r.key) ? '<small class="off">나 불가</small>' : ''); }).join('') +
        (pr.length ? '<small class="pr">연습</small>' : '');
      var key = rs[0] ? rs[0].key : '';
      var cls = 'dc' + (other ? ' o' : '') + (meOn ? ' on' : '') + (ds === t ? ' today' : '') + (key && key === ST.calSel ? ' sel' : '') + (ds < t ? ' past' : '');
      cells += key ? '<button type="button" class="' + cls + '" onclick="st13Pick(\'' + q(key) + '\')" aria-pressed="' + (key === ST.calSel) + '">' + inner + '</button>'
        : pr.length ? '<button type="button" class="' + cls + '" onclick="st13Pick(\'' + q(pr[0].key) + '\')">' + inner + '</button>' : '<span class="' + cls + '">' + inner + '</span>';
    }
    return '<section class="s13-calv"><div class="s13-calh"><button type="button" onclick="st13Cal(-1)" aria-label="이전 달">‹</button><span><b>' + (m + 1) + '</b><small>' + y + '</small></span><button type="button" onclick="st13Cal(1)" aria-label="다음 달">›</button></div>' +
      '<div class="s13-dow">' + DOW.map(function (w, i) { return '<span' + (i === 0 || i === 5 ? ' class="k"' : '') + '>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="s13-days">' + cells + '</div>' +
      '<p class="s13-lg"><span><i class="a"></i> 내가 서는 날</span><span><i class="b"></i> 연습</span><span><i class="c"></i> 오늘</span></p>' +
      calSel(stRow(ST.calSel)) + '</section>';
  }

  function bottom() {
    var team = encodeURIComponent(HUB.team || '');
    return '<div class="s13-bot"><a href="/schedule/history?team=' + team + '">변경 기록</a><button type="button" onclick="hubDoc(\'hubScheduleDoc\',[TOKEN,ST.range],\'stDocMsg\')">PDF로 받기</button>' +
      (D.committee ? '<a href="/schedule/import?team=' + team + '">엑셀 올리기 · 관리</a>' : '<span></span>') + '</div><p class="msg docmsg" id="stDocMsg"></p>' +
      '';
  }


  /* ---- 칸을 눌렀을 때 — 배정 시트 (V13) ---- */
  var BC_ROLE = /^(음향|PPT|방송총괄)/;
  function pk13Btn(m, p, picked, off) {
    var on = picked.indexOf(m.name) !== -1, why = off[m.name];
    var role = why ? why : (m.role ? m.role.split(' · ')[0] : '');
    return '<button type="button" class="pk13-p' + (on ? ' on' : '') + (why ? ' off' : '') + '" aria-pressed="' + on + '" onclick="stToggle(\'' + q(m.name) + '\')">' +
      face(m.name) + '<span class="pk13-n"><b>' + esc(on && p.key === LEAD_KEY ? leadTitle(m.name) : dispName(m.name)) + '</b>' + (role ? '<small>' + esc(role) + '</small>' : '') + '</span>' +
      (on ? '<i class="pk13-ck" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i>' : '') + '</button>';
  }
  window.drawStPicker = drawStPicker = function () {
    var box = el('stpk');
    if (!box || !ST.cell) return;
    var r = stRow(ST.cell.key);
    var p = D.positions.filter(function (x) { return x.key === ST.cell.pos; })[0];
    if (!r || !p) return;
    var picked = r.slots[p.key] || [], off = offMap(r.off);
    var fit = [], rest = [], no = [], guest = [], kn = known();
    D.members.forEach(function (m) {
      if (off[m.name]) no.push(m);
      else if (m.fit.indexOf(p.key) !== -1) fit.push(m);
      else if (!BC_ROLE.test(m.role || '') || picked.indexOf(m.name) !== -1) rest.push(m);
    });
    picked.forEach(function (n) { if (!kn[n]) guest.push({ name: n, role: '객원', fit: [] }); });
    var grp = function (t, list, cls) { return list.length ? '<section class="pk13-g' + (cls ? ' ' + cls : '') + '"><h4>' + t + '<span>' + list.length + '</span></h4><div class="pk13-l">' + list.map(function (m) { return pk13Btn(m, p, picked, off); }).join('') + '</div></section>' : ''; };
    var d = String(r.key || r.date || '').slice(0, 10), isD = /^\d{4}-\d{2}-\d{2}$/.test(d);
    box.className = 'stpk pk13';
    box.innerHTML =
      '<header class="pk13-h">' +
        '<div class="pk13-d">' + (isD ? '<b>' + dot(d) + '</b><span>' + (DOW[dt(d).getDay()] === '일' ? '주일' : DOW[dt(d).getDay()] + '요일') + '</span>' : '<span>' + stTitle(r) + '</span>') + '</div>' +
        '<h3>' + ic(p.key) + esc(p.label) + '</h3>' +
        '<p>' + (picked.length ? '지금 ' + picked.map(function (n) { return esc(dispName(n)); }).join(' · ') : '아직 비어 있어요') + ' · ' + (p.multi ? '여러 명 고를 수 있어요' : '누르면 바로 들어가요') + '</p>' +
      '</header>' +
      grp('이 포지션 담당', fit) + grp('그 외 팀원', rest) + grp('객원', guest) + grp('안 되는 사람', no, 'no') +
      '<section class="pk13-g pk13-gs"><h4>다른 팀에서 찾기</h4>' +
        '<input type="search" id="stgsQ" class="pk13-in" placeholder="이름 · 전화번호 · 셀 · 영문이름" maxlength="30" autocomplete="off" oninput="gsInput(\'stgs\',\'stToggle\')">' +
        '<div class="pk13-l gsres" id="stgsRes"></div></section>' +
      '<section class="pk13-g pk13-gs"><h4>명단에 없는 분</h4><div class="pk13-add">' +
        '<input type="text" id="stGuest" class="pk13-in" placeholder="이름" maxlength="20" onkeydown="if(event.key===\'Enter\')stToggle(this.value.trim())">' +
        '<button type="button" onclick="stToggle(val(\'stGuest\'))">추가</button></div></section>' +
      (p.multi || picked.length ? '<div class="pk13-done"><button type="button" onclick="YC.close()">완료</button></div>' : '');
  };

  window.schedTab = schedTab = function () {
    if (!ST.rows) return orig();
    var body = ST.view === 'table' ? table() : ST.view === 'cal' ? cal() : cards();
    return '<div class="s13 v-' + ST.view + '">' + topMine() + '<div class="s13-main">' + body + '<p class="msg" id="stMsg"></p>' + bottom() + '</div></div>';
  };
})();
