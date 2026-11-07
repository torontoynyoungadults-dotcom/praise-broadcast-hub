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

  if (typeof arCard === 'function') {
    window.arCard = arCard = function (d) {
      var dd = dt(d.date), k = esc(jsq(d.key));
      var songs = d.songs.map(function (s) { return '<span class="s">' + esc(s.title) + (s.key ? ' <i>' + esc(String(s.key).replace(/\s*-+>\s*/g, '→')) + '</i>' : '') + '</span>'; }).join('');
      var hasClose = d.songs.some(function (s) { return s.kind === '폐회송'; });
      var sub = [d.event ? esc(d.event.name || '') : '', d.lead.length ? '인도 ' + esc(d.lead.map(function (n) { return typeof dispSlot === 'function' ? dispSlot(n, '인도자') : n; }).join(', ')) : '', hasClose ? '폐회송 포함' : ''].filter(Boolean).join(' · ');
      var recs = d.recs || [];
      return '<article class="a13">' +
        '<button type="button" class="a13-d" onclick="goWeek(\'' + k + '\')" aria-label="' + esc(d.date) + ' 콘티 열기"><b>' + dd.getDate() + '</b><small>' + (d.event ? WD[dd.getDay()] : '주일') + '</small></button>' +
        '<div class="a13-b">' + (songs ? '<div class="a13-songs">' + songs + '</div>' : '<p class="a13-none">' + (d.files.length ? '콘티 없이 악보만 있어요' : '콘티 없음') + '</p>') +
          (sub ? '<p class="a13-sub">' + sub + '</p>' : '') +
          '<p class="a13-links">' + (recs.length ? '<button type="button" onclick="this.closest(\'.a13\').classList.toggle(\'recs\')">녹음 ' + recs.length + '</button>' : '') +
            (d.files.length ? '<button type="button" onclick="this.closest(\'.a13\').classList.toggle(\'files\')">악보 ' + d.files.length + '</button>' : '') +
            (typeof ldOpen === 'function' ? '<button type="button"' + ldBtnAttrs(d.key, '') + '>자세히</button>' : '') +
            '<button type="button" onclick="goWeek(\'' + k + '\')">열기</button></p>' +
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
})();
