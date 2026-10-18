/**
 * 스케줄표 — "마지막으로 본 뒤 바뀐 칸" 강조 (손으로 쓴 파일 · hubshim.js 다음에 읽힘)
 * ------------------------------------------------------------
 * 스케줄표를 열면 서버(worshipScheduleChanges · lib/scheduleLog.js)가 마지막으로 연 뒤 다른 사람이 바꾼 것들을 돌려주고
 * 확인 시각을 지금으로 바꿉니다 — 그래서 강조는 "처음 볼 때"만, 이 화면을 연 동안에만 보입니다.
 *  · 바뀐 편성 칸 · 날짜 · 불가 칸에 강조 테두리 + 점, 칸에 손을 대면(또는 누르면) 이전 → 이후 · 누가 · 언제
 *  · 스케줄표 위에 "새 변경 N건" 띠 — 펼쳐서 목록 보기 · "확인" 으로 강조 끄기 · 변경 기록 전체 화면으로
 * church-app 화면 코드(hubport.js)는 손대지 않고, 그린 뒤(render)에 칸의 onclick(stCell · stDay)으로 위치를 찾아 덧칠합니다.
 */
(function () {
  if (!window.ST || typeof window.render !== 'function') return;
  var CH = { map: null, items: [], open: false, off: false };

  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function names(s) { return String(s || '').split(/\s*,\s*/).filter(Boolean); }
  function when(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var now = new Date(), mins = Math.round((now - d) / 60000);
    if (mins < 1) return '방금';
    if (mins < 60) return mins + '분 전';
    if (mins < 60 * 24) return Math.round(mins / 60) + '시간 전';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function target(x) {
    var p = String(x.date || '').split('-');
    var d = p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) : '';
    return x.ev ? (d ? d + ' ' : '') + x.ev : d + ' 주일';
  }
  function posName(k) { return (window.ST_SHORT && ST_SHORT[k]) || k; }
  function who(n) { return typeof dispName === 'function' ? dispName(n) : n; }
  /** 편성 이전 → 이후 — 빠진 사람 · 들어온 사람 */
  function assignDiffHtml(b, a) {
    var bn = names(b), an = names(a);
    var gone = bn.filter(function (n) { return an.indexOf(n) < 0; }), add = an.filter(function (n) { return bn.indexOf(n) < 0; });
    var out = [];
    gone.forEach(function (n) { out.push('<s class="chg-out">' + e(who(n)) + '</s>'); });
    add.forEach(function (n) { out.push('<b class="chg-in">' + e(who(n)) + '</b>'); });
    if (!out.length) return e(b || '비움') + ' → ' + e(a || '비움');
    return (gone.length && add.length ? out.slice(0, gone.length).join(' ') + ' → ' + out.slice(gone.length).join(' ') : out.join(' ')) +
      (gone.length && !add.length ? ' 빠짐' : '') + (add.length && !gone.length ? ' 들어옴' : '');
  }
  function line(x) {
    var what;
    if (x.kind === '편성') what = '<span class="chg-k">' + e(posName(x.pos)) + '</span> ' + assignDiffHtml(x.before, x.after);
    else if (x.kind === '불가') what = '<span class="chg-k">불가</span> ' + e(who(x.person)) + ' — ' + (x.after ? e(x.after) : '<s class="chg-out">' + e(x.before) + '</s> 해제');
    else if (x.kind === '연습') what = '<span class="chg-k">연습일</span> ' + e(x.before || '—') + ' → <b class="chg-in">' + e(x.after || '—') + '</b>';
    else what = e(x.kind) + ' ' + e(x.before) + ' → ' + e(x.after);
    return what;
  }
  function tipText(x) {
    var t = x.kind === '편성' ? posName(x.pos) + ': ' + (x.before || '비움') + ' → ' + (x.after || '비움')
      : x.kind === '불가' ? x.person + ' 불가: ' + (x.after || '해제 (' + x.before + ')')
      : '연습일: ' + (x.before || '—') + ' → ' + (x.after || '—');
    return t + ' · ' + x.by + ' · ' + when(x.at);
  }

  /** 서버가 준 목록 → 예배 키마다 { pos:{포지션: 건}, off:[], prac:[], all:[] } — 같은 칸을 여러 번 바꿨으면 처음 이전 · 마지막 이후로 합침 */
  function build(items) {
    var m = {};
    items.forEach(function (x) {
      var k = m[x.key] = m[x.key] || { pos: {}, off: [], prac: [], all: [] };
      if (x.kind === '편성') {
        var c = k.pos[x.pos];
        if (c) { c.after = x.after; c.at = x.at; if (c.byList.indexOf(x.by) < 0) c.byList.push(x.by); c.by = c.byList.join(', '); }
        else k.pos[x.pos] = { kind: x.kind, key: x.key, date: x.date, ev: x.ev, pos: x.pos, before: x.before, after: x.after, by: x.by, byList: [x.by], at: x.at };
      } else if (x.kind === '불가') k.off.push(x);
      else if (x.kind === '연습') k.prac.push(x);
    });
    Object.keys(m).forEach(function (key) {                       // 바꿨다가 되돌린 칸은 빼기
      var k = m[key];
      Object.keys(k.pos).forEach(function (p) {
        var c = k.pos[p];
        if (names(c.before).sort().join('|') === names(c.after).sort().join('|')) delete k.pos[p];
      });
      k.all = Object.keys(k.pos).map(function (p) { return k.pos[p]; }).concat(k.prac, k.off);
      if (!k.all.length) delete m[key];
    });
    return m;
  }
  function count() { var n = 0; Object.keys(CH.map || {}).forEach(function (k) { n += CH.map[k].all.length; }); return n; }

  function keyOf(node, re) { var m = re.exec(node.getAttribute('onclick') || ''); return m ? m : null; }
  var RE_CELL = /stCell\('([^']*)','([^']*)'\)/, RE_DAY = /st(?:Day|PickDay)\('([^']*)'\)/;

  function banner() {
    var n = count();
    if (!n) return null;
    var keys = Object.keys(CH.map).sort(function (a, b) {
      var x = CH.map[a].all[0], y = CH.map[b].all[0];
      return String(x.date).localeCompare(String(y.date));
    });
    var list = '';
    if (CH.open) {
      list = '<ul class="chg-list">' + keys.map(function (k) {
        return CH.map[k].all.map(function (x) {
          return '<li><span class="chg-t">' + e(target(x)) + '</span><span class="chg-w">' + line(x) + '</span><span class="chg-by">' + e(who(x.by)) + ' · ' + e(when(x.at)) + '</span></li>';
        }).join('');
      }).join('') + '</ul>';
    }
    var div = document.createElement('div');
    div.className = 'chg-banner' + (CH.open ? ' open' : '');
    div.innerHTML = '<div class="chg-row"><span class="chg-dot"></span><b>마지막으로 본 뒤 바뀐 곳 ' + n + '건</b>' +
      '<span class="chg-sp"></span>' +
      '<button type="button" class="chg-btn" data-a="open">' + (CH.open ? '접기' : '자세히') + '</button>' +
      '<button type="button" class="chg-btn" data-a="ok">확인</button></div>' + list +
      '<a class="chg-more" href="/schedule/history?team=' + encodeURIComponent((window.HUB && HUB.team) || '') + '">변경 기록 전체 보기 ›</a>';
    div.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-a]'); if (!b) return;
      if (b.getAttribute('data-a') === 'open') CH.open = !CH.open; else CH.off = true;
      render();
    });
    return div;
  }

  function decorate() {
    if (TAB !== 'sched' || !ST.rows || !CH.map || CH.off) return;
    var body = el('body'); if (!body) return;
    var panel = body.querySelector('.stpanel');
    var b = banner();
    if (b && panel) {
      var head = panel.querySelector('.sechead');
      if (head && head.nextSibling) panel.insertBefore(b, head.nextSibling); else panel.insertBefore(b, panel.firstChild);
    }
    body.querySelectorAll('[onclick*="stCell("]').forEach(function (n) {
      var m = keyOf(n, RE_CELL); if (!m) return;
      var k = CH.map[m[1]], c = k && k.pos[m[2]];
      if (!c) return;
      n.classList.add('chg');
      n.setAttribute('title', tipText(c));
      var an = names(c.after);
      n.querySelectorAll('.tn, .tp').forEach(function (t) {           // 새로 들어온 이름은 따로 표시
        var nm = (t.getAttribute('title') || '').split(' — ')[0];
        if (an.indexOf(nm) >= 0 && names(c.before).indexOf(nm) < 0) t.classList.add('chg-new');
      });
    });
    body.querySelectorAll('[onclick*="stDay("], [onclick*="stPickDay("]').forEach(function (n) {
      var m = keyOf(n, RE_DAY); if (!m) return;
      var k = CH.map[m[1]]; if (!k) return;
      if (n.classList.contains('offc')) { if (k.off.length) { n.classList.add('chg'); n.setAttribute('title', k.off.map(tipText).join('\n')); } return; }
      n.classList.add('chg-day');
      n.setAttribute('title', '바뀐 곳 ' + k.all.length + '건 — 눌러서 보기');
    });
    // 카드 보기 — 불가 줄 · 연습일
    body.querySelectorAll('.stc').forEach(function (card) {
      var h = card.querySelector('.stch'); if (!h) return;
      var m = keyOf(h, RE_DAY); var k = m && CH.map[m[1]]; if (!k) return;
      card.classList.add('chg-card');
      if (k.off.length) { var o = card.querySelector('.stoff'); if (o) o.classList.add('chg'); }
    });
  }

  var baseRender = window.render;
  window.render = function () {
    baseRender.apply(this, arguments);
    try { decorate(); } catch (err) { if (window.console) console.error('[변경 강조]', err); }
  };

  /** 날짜를 눌러 여는 자세히 시트에도 그날 바뀐 것 */
  var baseDay = window.stDay;
  if (typeof baseDay === 'function') {
    window.stDay = function (key) {
      baseDay.apply(this, arguments);
      var k = CH.map && !CH.off && CH.map[key];
      if (!k) return;
      var sh = document.querySelector('#ynPortal .yc-sh'); if (!sh) return;
      var box = document.createElement('div');
      box.className = 'chg-daybox';
      box.innerHTML = '<b>마지막으로 본 뒤 바뀐 것</b><ul>' + k.all.map(function (x) {
        return '<li>' + line(x) + ' <span class="chg-by">' + e(who(x.by)) + ' · ' + e(when(x.at)) + '</span></li>';
      }).join('') + '</ul>';
      var h = sh.querySelector('.yc-h');
      if (h && h.nextSibling) sh.insertBefore(box, h.nextSibling); else sh.appendChild(box);
    };
  }

  function load() {
    if (!window.TOKEN || !D || !D.who) return;
    callServer('worshipScheduleChanges', [TOKEN], function (r) {
      CH.items = (r && r.items) || [];
      CH.map = build(CH.items);
      if (TAB === 'sched') render();
    }, function () { /* 강조는 덤 */ });
  }
  window.SCHED_CHANGES = CH;
  if (TAB === 'sched') load();
})();
