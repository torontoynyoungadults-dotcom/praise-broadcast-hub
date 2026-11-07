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
    var search = c === 'repo' ? '<div class="l13-q"><label for="rpQ" class="l13-ql">곡 찾기</label><input type="search" id="rpQ" placeholder="제목 · 원곡팀 · 주제 · 메모로 찾기" value="' + esc((RP && RP.q) || '') + '" oninput="RP.q=this.value;RP.more=60;rpRedraw();"></div>' : '';
    return '<section class="l13-top"><div class="l13-h"><h1>' + t[0] + '</h1><span>' + sub + '</span></div>' + search + '</section>' +
      '<div class="l13-tabs" role="tablist" aria-label="라이브러리 보기">' + LIB_VIEWS.map(function (v, i) {
        return '<button type="button" role="tab" class="' + (libOn(v) ? 'on' : '') + '" aria-selected="' + libOn(v) + '" onclick="libGo(' + i + ')">' + v[2] + '</button>';
      }).join('') + '</div>';
  };
  if (typeof repoTab === 'function') {
    var origRepo = repoTab;
    window.repoTab = repoTab = function () {
      var h = origRepo();
      h = h.replace(/<div class="lib-search">[\s\S]*?<\/div>/, '').replace(/<p class="lib-sum">[\s\S]*?<\/p>/, '');
      return h;
    };
  }
  if (typeof rpCard === 'function') {
    window.rpCard = rpCard = function (s) {
      var open = !!RP.open[s.id], l = s.last || {};
      var sub = [s.team || '원곡팀 비어 있음', l.bpm ? l.bpm + ' BPM' : '', s.sheets.length ? '악보 ' + s.sheets.length : '', s.hasLyrics ? '가사' : ''].filter(Boolean).map(esc).join(' · ');
      var h = '<div class="rp-card l13-song' + (open ? ' open' : '') + (RP.sel[s.id] ? ' picked' : '') + '" data-id="' + esc(s.id) + '"><div class="rp-row">' +
        (D.canEdit ? '<label class="lpick" title="콘티에 넣을 곡 고르기"><input type="checkbox" aria-label="' + esc(s.title) + ' 선택"' + (RP.sel[s.id] ? ' checked' : '') + ' onchange="rpPick(this)"><i></i></label>' : '') +
        '<button type="button" class="rp-main" onclick="rpToggle(this)" aria-expanded="' + open + '">' +
          '<span class="t"><b>' + esc(s.title) + '</b><small>' + sub + '</small></span>' +
          '<span class="k"><b>' + esc(String(l.key || '').replace(/\s*-+>\s*/g, '→')) + '</b><small>' + (s.uses ? s.uses + '회 · ' + esc(rpDay(s.lastDate)) : '기록 없음') + '</small></span>' +
        '</button></div>';
      if (open) h += rpDetail(s);
      return h + '</div>';
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
})();
