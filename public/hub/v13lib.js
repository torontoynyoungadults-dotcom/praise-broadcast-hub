/**
 * V13 라이브러리 — 시안(Library · LibraryArchive · LibraryStats)대로: 위 흑녹 제목(+ 곡 찾기), 글자 탭, 곡 한 줄(제목 · 팀 · BPM · 악보 | Key · 횟수).
 * 데이터 · 서버 함수 · 펼침(rpDetail) · 콘티에 넣기(rpDock) 는 그대로.
 */
(function () {
  if (window.__v13lib || typeof libNav !== 'function') return;
  window.__v13lib = true;
  var TOP = {
    repo: ['라이브러리', ''],
    date: ['지난 콘티', '날짜를 누르면 그날 콘티 · 악보 · 녹음이 모두 열려요'],
    file: ['악보 파일', '올려 둔 악보를 곡 · 날짜로 찾아요'],
    rec: ['녹음', '연습 · 예배 녹음을 날짜별로 들어요'],
    stats: ['콘티 통계', '많이 부른 곡 · 원곡 팀 · 인도자 · 월별']
  };
  function cur() { if (TAB === 'repo') return 'repo'; if (TAB === 'stats') return 'stats'; return (AR && AR.view) || 'date'; }
  window.libNav = libNav = function () {
    var c = cur(), t = TOP[c] || TOP.repo, sub = t[1];
    if (c === 'stats' && typeof SS !== 'undefined' && SS.data && typeof statItems === 'function') { try { var li = statItems(), dist = {}; li.forEach(function (i) { dist[i.c] = 1; }); sub = '<b>' + li.length + '</b> 부른 곡 · 서로 다른 곡 <b>' + Object.keys(dist).length + '</b>'; } catch (e) { /* 숫자 없이 */ } }
    if (c === 'repo' && RP && RP.data) { var s = RP.data.songs || []; sub = '<b>' + s.length + '</b> 곡 · 악보 있는 곡 ' + s.filter(function (x) { return x.sheets.length; }).length; }
    var nf = typeof rpFilterCount === 'function' ? rpFilterCount() : 0;
    var search = c === 'repo' ? '<div class="l13-q"><label for="rpQ" class="l13-ql">곡 찾기</label><input type="search" id="rpQ" placeholder="제목 · 원곡팀 · 가사 한 줄로 찾기" value="' + esc((RP && RP.q) || '') + '" oninput="RP.q=this.value;RP.more=60;rpRedraw();"><button type="button" class="l13-fb' + (RP && RP.fopen ? ' on' : '') + '" aria-label="필터" aria-expanded="' + !!(RP && RP.fopen) + '" onclick="RP.fopen=!RP.fopen;render();"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>' + (nf ? '<i>' + nf + '</i>' : '') + '</button></div>' : '';
    return '<section class="l13-top"><div class="l13-h"><h1>' + t[0] + '</h1><span>' + sub + '</span></div>' + search + '</section>' +
      '<div class="l13-tabs" role="tablist" aria-label="라이브러리 보기">' + LIB_VIEWS.map(function (v, i) {
        return '<button type="button" role="tab" class="' + (libOn(v) ? 'on' : '') + '" aria-selected="' + libOn(v) + '" onclick="libGo(' + i + ')">' + v[2] + '</button>';
      }).join('') + '</div>';
  };
  if (typeof repoTab === 'function') {
    var origRepo = repoTab;
    window.repoTab = repoTab = function () {
      if (RP.err || !RP.data) return origRepo();
      var f = RP.data.facets, n = rpFilterCount();
      var chip = function (on, label, js) { return '<button type="button" class="l13-chip' + (on ? ' on' : '') + '" aria-pressed="' + !!on + '" onclick="' + js + '">' + label + '</button>'; };
      var sorts = [['recent', '최근 부른 순'], ['uses', '많이 부른 순'], ['title', '가나다 순']];
      return '<div class="l13-repo">' +
        '<div class="l13-chips">' + sorts.map(function (x) { return chip(RP.sort === x[0], x[1], 'RP.sort=\'' + x[0] + '\';render();'); }).join('') +
          chip(RP.onlySheet, '악보 있는 곡만', 'RP.onlySheet=!RP.onlySheet;RP.more=60;render();') +
          (D.canEdit ? chip(RP.up, '+ 악보 PDF', 'RP.up=!RP.up;render();') : '') + '</div>' +
        (RP.fopen ? '<div class="l13-filters">' +
          '<label><span>Key</span><select onchange="RP.key=this.value;rpRedraw();">' + rpOpts(f.keys, RP.key, '모든 Key') + '</select></label>' +
          '<label><span>원곡팀</span><select onchange="RP.team=this.value;rpRedraw();">' + rpOpts(f.teams, RP.team, '모든 원곡팀') + '</select></label>' +
          '<label><span>주제</span><select onchange="RP.theme=this.value;rpRedraw();">' + rpOpts(f.themes, RP.theme, '모든 주제') + '</select></label>' +
          '<label><span>인도자</span><select onchange="RP.leader=this.value;rpRedraw();">' + rpOpts(f.leaders, RP.leader, '모든 인도자', true) + '</select></label>' +
          (n ? '<button type="button" class="l13-clear" onclick="RP.key=RP.team=RP.theme=RP.leader=\'\';RP.onlySheet=false;render();">필터 지우기</button>' : '') + '</div>' : '') +
        (RP.up && D.canEdit ? '<div class="l13-up">' + rpUpForm() + '</div>' : '') +
        '<div id="rpList">' + rpList() + '</div>' +
        '<p class="l13-note">곡을 누르면 지난 Key · 송폼 · 악보 · 가사 · 부른 날이 한 화면에 열려요.' + (D.canEdit ? ' 체크하면 아래에서 바로 콘티에 넣을 수 있어요.' : '') + '</p>' +
        '<div id="rpDock">' + rpDock() + '</div></div>';
    };
  }
  if (typeof rpList === 'function') {
    window.rpList = rpList = function () {
      var list = rpSongs();
      if (!list.length) return '<p class="l13-empty">조건에 맞는 곡이 없어요.</p>';
      var shown = list.slice(0, RP.more || 60);
      return '<ul class="l13-list">' + shown.map(rpCard).join('') + '</ul>' +
        (list.length > shown.length ? '<button type="button" class="l13-more" onclick="RP.more=(RP.more||60)+60;rpRedraw();">더 보기 · ' + (list.length - shown.length) + '곡 남음</button>' : '');
    };
  }
  if (typeof rpDock === 'function') {
    window.rpDock = rpDock = function () {
      var n = Object.keys(RP.sel).length;
      if (!D.canEdit || !n) return '';
      var date = DATE || D.nextWeek || D.thisWeek || '';
      return '<div class="l13-dock" role="region" aria-label="고른 곡 콘티에 넣기"><div class="r1"><b>' + n + '</b><span>곡 선택됨</span><label><input type="checkbox"' + (RP.attach ? ' checked' : '') + ' onchange="RP.attach=this.checked"> 악보도 함께</label><button type="button" class="x" onclick="RP.sel={};render();" aria-label="선택 지우기">지우기</button></div>' +
        '<div class="r2"><label><span>넣을 곳</span><select onchange="RP.kind=this.value"><option value="콘티"' + (RP.kind === '콘티' ? ' selected' : '') + '>' + esc(md(date)) + ' 콘티</option><option value="결단"' + (RP.kind === '결단' ? ' selected' : '') + '>' + esc(md(date)) + ' 설교 후 찬양</option></select></label><button type="button" class="go" onclick="rpUse()">콘티에 넣기</button></div><p class="msg" id="rpMsg"></p></div>';
    };
  }
  if (typeof rpCard === 'function') {
    window.rpCard = rpCard = function (s) {
      var open = !!RP.open[s.id], l = s.last || {};
      var noTeam = !s.team;
      var sub = [s.team || '원곡팀 비어 있음', l.bpm ? l.bpm + ' BPM' : '', s.sheets.length ? '악보 ' + s.sheets.length : '', s.hasLyrics ? '가사' : ''].filter(Boolean).map(esc).join(' · ');
      var h = '<li class="rp-card l13-song' + (open ? ' open' : '') + (RP.sel[s.id] ? ' picked' : '') + '" data-id="' + esc(s.id) + '"><div class="rp-row">' +
        (D.canEdit ? '<label class="lpick" title="콘티에 넣을 곡 고르기"><input type="checkbox" aria-label="' + esc(s.title) + ' 선택"' + (RP.sel[s.id] ? ' checked' : '') + ' onchange="rpPick(this)"><i></i></label>' : '') +
        '<button type="button" class="rp-main" onclick="rpToggle(this)" aria-expanded="' + open + '">' +
          '<span class="t"><b>' + esc(s.title) + '</b><small' + (noTeam ? ' class="warn"' : '') + '>' + sub + '</small></span>' +
          '<span class="k"><b>' + esc(String(l.key || '').replace(/\s*-+>\s*/g, '→')) + '</b><small>' + (s.uses ? s.uses + '회 · ' + esc(rpDay(s.lastDate)) : '기록 없음') + '</small></span>' +
        '</button></div>';
      if (open) h += rpDetail(s);
      return h + '</li>';
    };
  }

  var AIC = {rec: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3.5" y="14" width="4" height="6"/><rect x="16.5" y="14" width="4" height="6"/></svg>', file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 15.5h6M9 19h3"/></svg>', info: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17"/><path d="M12 11v6M12 7.5v.5"/></svg>', open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>'};
  if (typeof arCard === 'function') {
    window.arCard = arCard = function (d) {
      var dd = dt(d.date), k = esc(jsq(d.key));
      var songs = d.songs.filter(function (s) { return s.kind !== '폐회송'; }).map(function (s) { return '<span class="s">' + esc(s.title) + (s.key ? ' <i>' + esc(String(s.key).replace(/\s*-+>\s*/g, '→')) + '</i>' : '') + '</span>'; }).join('');
      var hasClose = d.songs.some(function (s) { return s.kind === '폐회송'; });
      var sub = [d.event ? esc(d.event.name || '') : '', d.lead.length ? '인도 ' + esc(d.lead.map(function (n) { return typeof dispSlot === 'function' ? dispSlot(n, '인도자') : n; }).join(', ')) : '', hasClose ? '폐회송 포함' : ''].filter(Boolean).join(' · ');
      var recs = d.recs || [];
      return '<article class="a13">' +
        '<button type="button" class="a13-d" onclick="goWeek(\'' + k + '\')" aria-label="' + esc(d.date) + ' 콘티 열기"><b>' + dd.getDate() + '</b><small>' + (d.event ? WD[dd.getDay()] : '주일') + '</small></button>' +
        '<div class="a13-b">' + (songs ? '<div class="a13-songs">' + songs + '</div>' : '<p class="a13-none">' + (d.files.length ? '콘티 없이 악보만 있어요' : '콘티 없음') + '</p>') +
          (sub ? '<p class="a13-sub">' + sub + '</p>' : '') +
          '<p class="a13-links">' + (recs.length ? '<button type="button" class="a13-ic" onclick="this.closest(\'.a13\').classList.toggle(\'recs\')" aria-label="녹음 ' + recs.length + '개">' + AIC.rec + '<span>녹음</span><b>' + recs.length + '</b></button>' : '') +
            (d.files.length ? '<button type="button" class="a13-ic" onclick="this.closest(\'.a13\').classList.toggle(\'files\')" aria-label="악보 ' + d.files.length + '개">' + AIC.file + '<span>악보</span><b>' + d.files.length + '</b></button>' : '') +
            (typeof ldOpen === 'function' ? '<button type="button" class="a13-ic"' + ldBtnAttrs(d.key, '') + '>' + AIC.info + '<span>자세히</span></button>' : '') +
            '<button type="button" class="a13-ic go" onclick="goWeek(\'' + k + '\')"><span>열기</span>' + AIC.open + '</button></p>' +
          (d.files.length ? '<div class="a13-files afiles">' + d.files.map(fileChip).join('') + '</div>' : '') +
          (recs.length ? '<div class="a13-recs arrecs">' + recs.map(function (r) { return recCard(r, d.key, true); }).join('') + '</div>' : '') +
        '</div></article>';
    };
  }

  /* 날짜별 — 시안(LibraryArchive): 거르기 칩 · 달마다 머리 · 한 줄 콘티 */
  if (typeof archiveTab === 'function' && typeof arDays === 'function') {
    var origArch = archiveTab, origDays = arDays;
    AR.f13 = AR.f13 || 'all';
    window.arDays = arDays = function () {
      var ds = origDays();
      if (AR.view !== 'date' && AR.view) return ds;
      if (AR.f13 === 'rec') return ds.filter(function (d) { return (d.recs || []).length; });
      if (AR.f13 === 'file') return ds.filter(function (d) { return d.files.length; });
      if (AR.f13 === 'ev') return ds.filter(function (d) { return !!d.event; });
      return ds;
    };
    window.archiveTab = archiveTab = function () {
      if (!AR.data || (AR.view && AR.view !== 'date')) return origArch();
      var chip = function (k, label) { return '<button type="button" class="l13-chip' + (AR.f13 === k ? ' on' : '') + '" aria-pressed="' + (AR.f13 === k) + '" onclick="AR.f13=\'' + k + '\';AR.more=30;render();">' + label + '</button>'; };
      return '<div class="l13-repo l13-arch"><div class="l13-chips">' + chip('all', '전부') + chip('rec', '녹음 있는 날') + chip('file', '악보 있는 날') + chip('ev', '주일 외 예배') + '</div>' +
        '<div class="l13-filters"><label><span>기간</span><select onchange="AR.range=this.value;AR.more=30;render();">' + AR_RANGES.map(function (r) { return '<option value="' + r[0] + '"' + (AR.range === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
          '<label><span>곡 찾기</span><input type="search" value="' + esc(AR.q || '') + '" placeholder="곡 · 팀 · 파일 이름" oninput="AR.q=this.value;AR.more=30;arRedraw();"></label></div>' +
        '<div id="arBody">' + arBody() + '</div>' +
        '<button type="button" class="l13-more" onclick="arExport()">엑셀로 내려받기</button><p class="msg" id="arMsg"></p></div>';
    };
    var origBody = arBody;
    window.arBody = arBody = function () {
      if (AR.view && AR.view !== 'date') return origBody();
      var days = arDays(); if (!days.length) return '<p class="l13-empty">찾는 기록이 없어요.</p>';
      var today = AR.data.today;
      var up = days.filter(function (d) { return d.date > today; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
      var past = days.filter(function (d) { return d.date <= today; });
      var list = up.concat(AR.range === 'up' ? [] : past.slice(0, AR.more || 30)), out = '', last = '';
      list.forEach(function (d) {
        var mo = d.date.slice(0, 7);
        if (mo !== last) { if (last) out += '</section>'; last = mo; out += '<section class="a13-mon" aria-label="' + mo.slice(0, 4) + '년 ' + Number(mo.slice(5)) + '월"><h2><span>' + Number(mo.slice(5)) + '월</span>' + (mo.slice(0, 4) !== today.slice(0, 4) ? '<small>' + mo.slice(0, 4) + '</small>' : '') + '<i></i></h2>'; }
        out += arCard(d);
      });
      if (last) out += '</section>';
      return out + (past.length > (AR.more || 30) && AR.range !== 'up' ? '<button type="button" class="l13-more" onclick="AR.more=(AR.more||30)+20;arRedraw();">더 보기 · ' + (past.length - (AR.more || 30)) + '번 남음</button>' : '');
    };
  }

  /* 통계 — 시안(LibraryStats): 기간 4칸 · 구분 · 인도자 · 곡 찾기, 종류 탭, PDF */
  if (typeof statsTab === 'function') {
    var origStats = statsTab;
    window.statsTab = statsTab = function () {
      if (!SS.data || (!SS.items.length && !Object.keys(SS.data.svcDates || {}).length)) return origStats();
      var leads = {}; SS.items.forEach(function (i) { lineup(i.key).lead.forEach(function (n) { leads[n] = 1; }); });
      var rad = function (k, v, label) { return '<button type="button" role="radio" aria-checked="' + (SS[k] === v) + '" class="' + (SS[k] === v ? 'on' : '') + '" onclick="SS.' + k + '=\'' + v + '\';SS.more=false;render();">' + label + '</button>'; };
      var views = [['song', '곡 순위'], ['team', '원곡 팀'], ['lead', '인도자'], ['people', '사람'], ['month', '월별']];
      return '<div class="l13-repo l13-stats">' +
        '<div class="l13-seg4" role="radiogroup" aria-label="기간">' + rad('range', '3', '3개월') + rad('range', '6', '6개월') + rad('range', '12', '1년') + rad('range', 'all', '전체') + '</div>' +
        '<div class="l13-filters"><label><span>구분</span><select onchange="SS.kind=this.value;SS.more=false;render();">' + [['all', '전체'], ['콘티', '콘티'], ['결단', '설교 후 찬양']].map(function (x) { return '<option value="' + x[0] + '"' + (SS.kind === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
          '<label><span>인도자</span><select onchange="SS.lead=this.value;SS.more=false;render();"><option value="">전체</option>' + Object.keys(leads).sort().map(function (n) { return '<option value="' + esc(n) + '"' + (SS.lead === n ? ' selected' : '') + '>' + esc(leadTitle(n)) + '</option>'; }).join('') + '</select></label>' +
          '<label class="w2"><span>곡 찾기</span><input type="search" id="ssq" value="' + esc(SS.q || '') + '" placeholder="곡 · 팀" oninput="SS.q=this.value;SS.more=false;statRedraw();"></label></div>' +
        '<div class="l13-vt" role="tablist" aria-label="통계 종류">' + views.map(function (v) { return '<button type="button" role="tab" aria-selected="' + (SS.view === v[0]) + '" class="' + (SS.view === v[0] ? 'on' : '') + '" onclick="SS.view=\'' + v[0] + '\';SS.more=false;render();">' + v[1] + '</button>'; }).join('') + '</div>' +
        '<div class="panel l13-sb" id="ssBody">' + statView(statItems()) + '</div>' +
        '<button type="button" class="l13-more" onclick="hubDoc(\'hubStatsDoc\',[TOKEN,SS.range===\'all\'?\'\':SS.range,SS.kind,SS.lead,SS.q],\'ssDocMsg\')">PDF로 받기 (지금 고른 조건)</button><p class="msg docmsg" id="ssDocMsg"></p>' +
        '<p class="l13-note">띄어쓰기 · 대소문자 · 한 글자 오타는 같은 곡으로 묶었어요. 사람 · 인도자는 편성이 입력된 예배 기준이에요.</p></div>';
    };
  }

  /* 자세히 시트 — 테마: 흑녹 머리(날짜) · 콘티 · 섬긴 사람(포지션 아이콘 · 사진) · 악보 · 녹음 · 두 단추 */
  if (typeof ldShow === 'function') {
    var IC13 = (window.__HUB__ && window.__HUB__.icons13) || {};
    var pic = function (k) { return IC13[k] ? '<svg class="pi13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true">' + IC13[k] + '</svg>' : ''; };
    var SHL = { 인도자: '인도', 남성싱어: '남싱', 여성싱어: '여싱', 어쿠기타: '어쿠' };
    window.ldShow = ldShow = function (r, swapOnly) {
      var key = r.key, want = ldNorm(LD.song), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(r.date || '')), dd = m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
      var lead = (r.slots && (r.slots['인도자'] || r.slots.lead)) || [];
      var me = want ? (r.songs || []).filter(function (x) { return ldNorm(x.title) === want; })[0] : null;
      var h = '<div class="ld13">' +
        '<header class="ld13-h"><div class="d"><small>' + (r.event ? esc(r.event.kind || '행사') : '주일') + '</small><b>' + (m ? m[2] + '.' + m[3] : esc(r.date)) + '</b><small>' + (m ? m[1] + ' · ' + '일월화수목금토'.charAt(dd.getDay()) + '요일' : '') + '</small></div>' +
          '<div class="t"><b>' + (r.event ? esc(r.event.name) : '주일 3부 예배') + '</b><small>' + esc([lead.length ? '인도 ' + lead.map(ldLead).join(', ') : '', (r.songs || []).length ? (r.songs || []).length + '곡' : ''].filter(Boolean).join(' · ')) + '</small></div></header>';
      var sec = function (t, n, body) { return '<section class="ld13-s"><h4><span>' + t + '</span>' + (n ? '<em>' + n + '</em>' : '') + '<i></i></h4>' + body + '</section>'; };
      if ((r.songs || []).length) {
        var no = 0;
        h += sec('그날 콘티', '', '<ol class="ld13-songs">' + r.songs.map(function (x) {
          var fin = x.kind === '결단', clo = x.kind === '폐회송', yt = ldYt(x.link); if (!fin && !clo) no++;
          return '<li class="' + (me && x === me ? 'on' : '') + '"><span class="n">' + (fin ? '<i>후</i>' : clo ? '<i>폐</i>' : no) + '</span><span class="m"><b>' + esc(x.title) + '</b><small>' + esc([x.team, x.bpm ? x.bpm + ' BPM' : '', fin ? '설교 후 찬양' : clo ? '폐회송' : ''].filter(Boolean).join(' · ')) + '</small>' + (x.form ? '<small class="f">' + esc(String(x.form).split(/\s*[-,>›]\s*/).filter(Boolean).join(' › ')) + '</small>' : '') + '</span>' +
            '<span class="k">' + esc(String(x.key || '').replace(/\s*-+>\s*/g, '→')) + '</span>' + (yt ? '<a class="yt" href="https://www.youtube.com/watch?v=' + esc(yt) + '" target="_blank" rel="noopener" aria-label="' + esc(x.title) + ' 유튜브"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></a>' : '') + '</li>';
        }).join('') + '</ol>');
      }
      var groups = typeof stGroups === 'function' ? stGroups() : [['편성', D.positions || []]];
      var rows = '';
      groups.forEach(function (g) { g[1].forEach(function (p) {
        var ns = ((r.slots || {})[p.key] || []); if (!ns.length) return;
        rows += '<div class="r"><span class="l">' + pic(p.key) + esc(SHL[p.key] || p.label) + '</span><span class="v">' + ns.map(function (n) { return '<span class="p">' + (typeof face === 'function' ? face(n) : '') + '<span>' + esc(ldIsLead(p.key) ? ldLead(n) : ldName(n)) + '</span></span>'; }).join('') + '</span></div>';
      }); });
      h += sec('섬긴 사람', '', rows ? '<div class="ld13-people">' + rows + '</div>' : '<p class="ld13-none">편성 기록이 없어요.</p>');
      if ((r.files || []).length) h += sec('악보', r.files.length, '<div class="ld13-files">' + r.files.map(function (f) { return ldFileLink(f, key, AIC.file + '<span>' + esc(f.name) + (f.range ? ' <small>' + esc(f.range) + '쪽</small>' : '') + '</span>', 'ld13-file'); }).join('') + '</div>');
      if ((r.recs || []).length && typeof recCard === 'function') h += sec('녹음', r.recs.length, '<div class="ld13-recs arrecs">' + r.recs.map(function (x) { return recCard(x, key, true); }).join('') + '</div>');
      if (r.verse) h += sec('그 주의 말씀', '', '<blockquote class="ld13-v">' + esc(r.verse) + (r.verseTitle ? '<cite>' + esc(r.verseTitle) + '</cite>' : '') + '</blockquote>');
      var lq = /^ev-/.test(key) ? 'event=' + encodeURIComponent(key.slice(3)) : 'date=' + encodeURIComponent(key);
      h += '<div class="ld13-acts"><button type="button" onclick="YC.close();goWeek(\'' + esc(jsq(key)) + '\')">콘티 열기</button>' + ((r.recs || []).length ? '<a href="/conti/listen?team=' + encodeURIComponent(HUB.team || '') + '&' + lq + '">' + AIC.rec + '녹음 듣기</a>' : '') + '</div></div>';
      var sh = document.querySelector('.yc-ov.on .yc-sh .ld[aria-busy]') || document.querySelector('.yc-ov .yc-sh .ld[aria-busy]');
      sh = sh && sh.closest('.yc-sh');
      if (sh) { sh.innerHTML = '<button type="button" class="yc-x ld13-x" onclick="YC.close()" aria-label="닫기">&times;</button>' + h; sh.classList.add('ld13-sh'); }
      else if (!swapOnly) { YC.sheet(h, {}); var s2 = document.querySelector('.yc-ov.on .yc-sh'); if (s2) s2.classList.add('ld13-sh'); }
      try { if (window.YNPlayer && YNPlayer.mark) YNPlayer.mark(); } catch (e) {}
    };
  }
})();
