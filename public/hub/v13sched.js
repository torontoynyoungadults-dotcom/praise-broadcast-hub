/**
 * V13 스케줄표 — 시안(Schedule / ScheduleTable / ScheduleCalendar)대로 그리기.
 * hubport.js 의 schedTab 을 감싸서: 위 "내 일정"(흑녹), 보기 탭 카드 · 표 · 달력, 기간 · 사람 강조, "미정 자리 있는 날만",
 * 카드 = 한 줄 요약(누르면 펼쳐서 편성 칸 — 칸을 누르면 배정), 달력 = 한 달 격자, 아래 변경 기록 · PDF · 엑셀.
 * 데이터 · 서버 함수 · 배정(stCell) · 자세히(stDay) · 안 되는 날(stOffCard) 은 그대로 씁니다.
 */
(function () {
  if (typeof schedTab !== 'function' || window.__v13sched) return;
  window.__v13sched = true;
  var orig = schedTab;
  var SH = { 인도자: '인도', 남성싱어: '남싱', 여성싱어: '여싱', 어쿠기타: '어쿠' };
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  try { ST.onlyTbd = localStorage.getItem('ph.st.onlyTbd') === '1'; } catch (e) { ST.onlyTbd = false; }
  try { var v0 = localStorage.getItem('ph.st.view13'); if (v0) ST.view = v0; else ST.view = 'card'; } catch (e) { ST.view = 'card'; }
  if (ST.view !== 'card' && ST.view !== 'table' && ST.view !== 'cal') ST.view = 'card';

  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dot(d) { var p = String(d).split('-'); return p[1] + '.' + p[2]; }
  function cols() { var c = []; stGroups().forEach(function (g) { c = c.concat(g[1]); }); return c; }
  function lab(p) { return SH[p.key] || p.label; }
  function mine(r) { return cols().filter(function (p) { return (r.slots[p.key] || []).indexOf(D.who) !== -1; }); }
  function tbd(r) { return cols().filter(function (p) { return !(r.slots[p.key] || []).length; }); }
  function lead(r) { var n = (r.slots['인도자'] || [])[0]; return n ? shortName(n, '인도자') : ''; }
  function pracTxt(r) { var p = r.practice; return !p || p.none ? (p && p.none ? '연습 없음' : '연습 미정') : (p.unset || !p.date ? '연습 미정' : '연습 ' + md(p.date) + (p.date < today() ? ' 마침' : '')); }
  function offOf(key) { return (ST.mine || []).filter(function (x) { return x.date === key; })[0] || null; }
  function dday(d) { var a = dt(d), b = dt(today()); var n = Math.round((a - b) / 864e5); return n === 0 ? 'D-day' : n > 0 ? 'D-' + n : ''; }
  function q(s) { return esc(jsq(s)); }

  window.st13View = function (v) { ST.view = v; try { localStorage.setItem('ph.st.view13', v); } catch (e) {} render(); };
  window.st13Tbd = function (on) { ST.onlyTbd = !!on; try { localStorage.setItem('ph.st.onlyTbd', on ? '1' : '0'); } catch (e) {} render(); };
  window.st13Open = function (key) { ST.open13 = ST.open13 === key ? '' : key; render(); };
  window.st13Cal = function (d) { ST.calMon = (ST.calMon || today().slice(0, 7)); var p = ST.calMon.split('-'); var x = new Date(Number(p[0]), Number(p[1]) - 1 + d, 1); ST.calMon = x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2); render(); };

  function shownRows() {
    var rows = stShown();
    if (ST.onlyTbd) rows = rows.filter(function (r) { return tbd(r).length; });
    return rows;
  }

  /* 위 — 내 일정 (흑녹) */
  function topMine() {
    if (!D.who) return '';
    var t = today();
    var up = (ST.rows || []).filter(function (r) { return r.date >= t && mine(r).length; }).slice(0, 4);
    var offs = (ST.mine || []).filter(function (x) { return (x.day || x.date) >= t; });
    var items = up.length ? up.map(function (r) {
      var p = r.practice;
      return '<button type="button" class="s13-mi" onclick="st13Open(\'' + q(r.key) + '\');setTimeout(function(){var e=document.getElementById(\'s13-' + q(r.key) + '\');if(e)e.scrollIntoView({block:\'center\'});},30)">' +
        '<span class="d">' + dot(r.date) + '</span><span class="m"><b>' + esc(mine(r).map(lab).join(' · ')) + (r.event ? ' · ' + esc(r.event.name) : '') + '</b><small>' + esc(pracTxt(r)) + '</small></span><span class="n">' + dday(r.date) + '</span></button>';
    }).join('') : '<p class="s13-none">앞으로 서는 날이 없어요</p>';
    return '<section class="s13-top" aria-labelledby="s13-mine-h"><h1 id="s13-mine-h">내 일정</h1><div class="s13-mis">' + items + '</div>' +
      '<div class="s13-offs"><span class="k">안 되는 날</span>' + (offs.length ? offs.slice(0, 8).map(function (x) { return '<span class="c">' + esc(md(x.day || x.date)) + '</span>'; }).join('') : '<span class="z">없음</span>') +
      '<button type="button" class="s13-fix" onclick="offToggle()" aria-expanded="' + (!!ST.offOpen) + '">' + (ST.offOpen ? '접기' : (offs.length ? '고치기' : '날짜 고르기')) + '</button></div>' +
      (ST.offOpen ? '<div class="s13-offcard">' + stOffCard() + '</div>' : '') +
      '<div class="s13-cal2"><button type="button" data-mysched data-team="' + esc(HUB.team || '') + '">내 일정 캘린더에 넣기</button><a href="/cal/google/connect?team=' + encodeURIComponent(HUB.team || '') + '">구글 캘린더 연동</a></div></section>';
  }

  function tools() {
    var people = (D.members || []).map(function (m) { return m.name; });
    return '<div class="s13-tabs" role="tablist" aria-label="보기">' + [['card', '카드'], ['table', '표'], ['cal', '달력']].map(function (v) {
      return '<button type="button" role="tab" aria-selected="' + (ST.view === v[0]) + '" class="' + (ST.view === v[0] ? 'on' : '') + '" onclick="st13View(\'' + v[0] + '\')">' + v[1] + '</button>';
    }).join('') + '</div>' +
      '<div class="s13-filt"><label><span>기간</span><select onchange="stRange(this.value)">' + ST_RANGES.map(function (x) { return '<option value="' + x[0] + '"' + (ST.range === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
      '<label><span>사람 강조</span><select onchange="ST.hl=this.value;render();"><option value="">없음</option>' + people.map(function (n) { return '<option value="' + esc(n) + '"' + (n === ST.hl ? ' selected' : '') + '>' + esc(dispName(n)) + (n === D.who ? ' (나)' : '') + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="s13-chks"><label><input type="checkbox"' + (ST.onlyTbd ? ' checked' : '') + ' onchange="st13Tbd(this.checked)"> 미정 자리 있는 날만 보기</label>' +
      (D.who ? '<label><input type="checkbox"' + (ST.onlyMine ? ' checked' : '') + ' onchange="stOnlyMine(this.checked)"> 내가 서는 날만</label>' : '') + '</div>';
  }

  /* 카드 — 한 줄 요약, 펼친 날은 편성 칸 */
  function cards() {
    var rows = shownRows(), t = today();
    if (!rows.length) return '<p class="s13-empty">이 기간에 보여 줄 날이 없어요.</p>';
    if (ST.open13 === undefined) { var f = rows.filter(function (r) { return r.date >= t && mine(r).length; })[0] || rows.filter(function (r) { return r.date >= t; })[0]; ST.open13 = f ? f.key : ''; }
    var out = '', last = '';
    rows.forEach(function (r) {
      var mo = r.date.slice(0, 7);
      if (mo !== last) { if (last) out += '</section>'; last = mo; out += '<section class="s13-mon"><h2><span>' + Number(mo.split('-')[1]) + '월</span>' + (mo.slice(0, 4) !== t.slice(0, 4) ? '<small>' + mo.slice(0, 4) + '</small>' : '') + '<i></i></h2>'; }
      var my = mine(r), mo2 = offOf(r.key), td = tbd(r), open = ST.open13 === r.key;
      var tag = my.length ? '<span class="tag on">나 ' + esc(my.map(lab).join(' · ')) + '</span>' : mo2 ? '<span class="tag">' + esc(stMineTag(mo2, r)) + '</span>' : '';
      var wd = r.event ? DOW[dt(r.date).getDay()] + ' · ' + esc(r.event.name) : '주일';
      var sub = [pracTxt(r), td.length ? '미정 ' + td.map(lab).join(' · ') : ''].filter(Boolean).join(' · ');
      var head = '<button type="button" class="s13-rh" onclick="st13Open(\'' + q(r.key) + '\')" aria-expanded="' + open + '"><span class="d"><b>' + dot(r.date) + '</b><small>' + wd + '</small></span>' +
        '<span class="m"><span>' + (lead(r) ? '인도 ' + esc(lead(r)) : '<em>인도 미정</em>') + '</span><small>' + esc(sub) + '</small></span>' + tag + '</button>';
      if (!open) { out += '<div class="s13-row' + (r.event ? ' ev' : '') + (r.date < t ? ' past' : '') + '" id="s13-' + esc(r.key) + '">' + head + '</div>'; return; }
      var off = offMap(r.off), edit = D.canEdit && !ST.pick;
      var cells = cols().map(function (p) {
        var names = r.slots[p.key] || [], me = names.indexOf(D.who) !== -1;
        return '<div class="c' + (me ? ' me' : '') + (names.length ? '' : ' tbd') + (names.length > 2 ? ' w2' : '') + (edit ? ' ed' : '') + '"' + (edit ? ' role="button" tabindex="0" onclick="stCell(\'' + q(r.key) + '\',\'' + q(p.key) + '\')"' : '') + '>' +
          '<dt>' + esc(lab(p)) + '</dt><dd>' + (names.length ? names.map(function (n) { return '<span class="' + (off[n] ? 'off' : '') + (n === ST.hl ? ' hl' : '') + '">' + esc(shortName(n, p.key)) + '</span>'; }).join(' · ') : '미정') + '</dd></div>';
      }).join('');
      out += '<article class="s13-row open' + (r.event ? ' ev' : '') + '" id="s13-' + esc(r.key) + '">' + head +
        '<dl class="s13-grid">' + cells + '</dl>' +
        '<div class="s13-foot"><span>' + (r.off.length ? '안 되는 사람 · ' + r.off.map(function (x) { return esc(shortName(x.name)); }).join(' · ') : '안 되는 사람 없음') + '</span>' +
        (D.canEdit ? '<button type="button" onclick="stPractice(\'' + q(r.key) + '\')">연습일</button>' : '') +
        '<button type="button" onclick="stDay(\'' + q(r.key) + '\')">자세히</button><button type="button" onclick="goWeek(\'' + q(r.key) + '\')">콘티 보기</button></div></article>';
    });
    return '<div class="s13-cards">' + out + (last ? '</section>' : '') + '</div>';
  }

  /* 달력 — 한 달 격자 */
  function cal() {
    var t = today();
    ST.calMon = ST.calMon || t.slice(0, 7);
    var p = ST.calMon.split('-'), y = Number(p[0]), m = Number(p[1]) - 1;
    var first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
    var by = {}; (ST.rows || []).forEach(function (r) { (by[r.date] = by[r.date] || []).push(r); });
    var prac = {}; (ST.rows || []).forEach(function (r) { var pp = r.practice; if (pp && pp.date && !pp.none && !pp.unset) { (prac[pp.date] = prac[pp.date] || []).push(r); } });
    var cells = '';
    for (var i = 0; i < 42; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== m) break;
      var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      var other = d.getMonth() !== m, rs = by[ds] || [], pr = prac[ds] || [];
      var meOn = rs.some(function (r) { return mine(r).length; }), meOff = rs.some(function (r) { return offOf(r.key); });
      var inner = '<b>' + d.getDate() + '</b>' + (ds === t ? '<small>오늘</small>' : '') +
        rs.map(function (r) { var my = mine(r), td = tbd(r); return '<small>' + (r.event ? esc(String(r.event.name).slice(0, 5)) : '주일') + '</small>' + (my.length ? '<small class="me">' + esc(my.map(lab).join('·')) + '</small>' : offOf(r.key) ? '<small class="off">불가</small>' : td.length ? '<small class="tbd">미정 ' + td.length + '</small>' : ''); }).join('') +
        (pr.length ? '<small class="pr">연습</small>' : '');
      var key = rs[0] ? rs[0].key : (pr[0] ? pr[0].key : '');
      cells += key ? '<button type="button" class="dc' + (other ? ' o' : '') + (meOn ? ' on' : '') + (meOff ? ' offd' : '') + (ds === t ? ' today' : '') + '" onclick="' + (rs[0] ? 'stDay' : 'stDay') + '(\'' + q(key) + '\')">' + inner + '</button>'
        : '<span class="dc' + (other ? ' o' : '') + (ds === t ? ' today' : '') + '">' + inner + '</span>';
    }
    return '<section class="s13-calv"><div class="s13-calh"><button type="button" onclick="st13Cal(-1)" aria-label="이전 달">‹</button><span><b>' + (m + 1) + '</b><small>' + y + '</small></span><button type="button" onclick="st13Cal(1)" aria-label="다음 달">›</button></div>' +
      '<div class="s13-dow">' + DOW.map(function (w, i) { return '<span' + (i === 0 || i === 5 ? ' class="k"' : '') + '>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="s13-days">' + cells + '</div>' +
      '<p class="s13-lg"><span><i class="a"></i> 내가 서는 날</span><span><i class="b"></i> 연습</span><span><i class="c"></i> 미정 자리</span></p>' +
      '<p class="s13-hint">기간 밖의 달은 비어 보여요 — 위 기간을 넓혀 보세요.</p></section>';
  }

  function bottom() {
    var team = encodeURIComponent(HUB.team || '');
    return '<div class="s13-bot"><a href="/schedule/history?team=' + team + '">변경 기록</a><button type="button" onclick="hubDoc(\'hubScheduleDoc\',[TOKEN,ST.range],\'stDocMsg\')">PDF로 받기</button>' +
      (D.committee ? '<a href="/schedule/import?team=' + team + '">엑셀 올리기 · 관리</a>' : '<span></span>') + '</div><p class="msg docmsg" id="stDocMsg"></p>' +
      (D.committee ? '<a class="s13-gen" href="/schedule/generate?team=' + team + '"><span><small>관리자</small>' + (new Date().getMonth() >= 9 ? (new Date().getFullYear() + 1) + ' ' : '') + '연습 일정 미리 만들기</span><i>›</i></a>' : '');
  }

  window.schedTab = schedTab = function () {
    if (!ST.rows) return orig();
    var body;
    if (ST.view === 'table') {
      var keep = ST.onlyMine, rowsKeep = ST.rows;
      if (ST.onlyTbd) ST.rows = ST.rows.filter(function (r) { return tbd(r).length; });
      var h = orig(); ST.rows = rowsKeep; ST.onlyMine = keep;
      var a = h.indexOf('<div class="stwrap">'), b = h.indexOf('</table></div>', a);
      body = a >= 0 && b > a ? h.slice(a, b + 14) : '<p class="s13-empty">보여 줄 날이 없어요.</p>';
      var bar = h.indexOf('<div class="stbar">');
      if (bar >= 0) body = h.slice(bar, h.indexOf('</div></div>', bar) + 12) + body;
    } else body = ST.view === 'cal' ? cal() : cards();
    return '<div class="s13">' + topMine() + '<div class="s13-main">' + tools() + body + '<p class="msg" id="stMsg"></p>' + bottom() + '</div></div>';
  };
})();
