/* 자동 생성 — tools/port-church-hub.js. church-app 원본 함수 그대로 (바꾼 곳은 그 도구의 PATCHES). 직접 고치지 마세요.
 * 이 앱 쪽 연결은 public/hub/hubshim.js 에 있습니다. */
/* ===== views/Worship.html ===== */
var WD = ['일', '월', '화', '수', '목', '금', '토'];

function el(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

function jsq(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function hubDoc(fn, args, msgId) {
  var m = msgId ? el(msgId) : null;
  var put = function (t, k) { if (m) { m.className = 'msg docmsg' + (k ? ' ' + k : ''); m.textContent = t || ''; } else if (t) { alert(t); } };
  put('보고서를 준비하는 중…');
  callServer(fn, args, function (doc) {
    if (!window.YNDocView || !YNDocView.open) { put('미리보기 도구를 불러오지 못했습니다. 새로고침해 주세요.', 'err'); return; }
    put('');
    YNDocView.open({ html: doc.html, title: doc.title, landscape: !!doc.landscape, filename: (doc.filename || 'report') + '_' + new Date().toISOString().slice(0, 10) });
  }, function (e) { put((e && e.message) || '보고서를 만들지 못했습니다.', 'err'); });
}

function docBtn(label, call) {
  return '<button type="button" class="btn mini docbtn" onclick="' + call + '">📄 ' + label + '</button>';
}

function say(id, t, k) { var m = el(id); if (!m) return; m.className = 'msg' + (k ? ' ' + k : ''); m.textContent = t || ''; }

function fail(e) { alert(e && e.message ? e.message : '처리에 실패했습니다.'); }

function val(id) { var x = el(id); return x ? x.value.trim() : ''; }

function isEv(k) { return /^ev-/.test(String(k || '')); }

var ICON = {
  mic:   '<path d="M12 3.5a2.6 2.6 0 0 1 2.6 2.6v5a2.6 2.6 0 1 1-5.2 0v-5A2.6 2.6 0 0 1 12 3.5z"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3"/>',
  piano: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v8M12 5v8M16 5v8"/>',
  synth: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="7.5" cy="12" r="1.6"/><path d="M12 15V9M16 15V9M19 13.5v-3"/>',
  drum:  '<ellipse cx="12" cy="8" rx="8" ry="3.2"/><path d="M4 8v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V8"/><path d="M6.5 17.5L4 21M17.5 17.5L20 21"/>',
  bass:  '<path d="M14.5 3.5l6 6"/><path d="M13 6.5l4.5 4.5"/><path d="M12.5 10.5a4.5 4.5 0 1 0-4 4"/><circle cx="9" cy="15" r="4"/>',
  egt:   '<path d="M20.5 3.5l-6 6"/><path d="M15.5 4.5l4 4"/><path d="M13 11a5 5 0 1 0-3 3.4"/><path d="M6.5 14.5c-2 2-3 4.5-2 5.5s3.5 0 5.5-2"/>',
  agt:   '<path d="M19.5 4.5l-5.5 5.5"/><circle cx="10" cy="15" r="5.5"/><circle cx="10" cy="15" r="1.8"/>',
  voice: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/>',
  media: '<rect x="2.5" y="6" width="13" height="12" rx="2.2"/><path d="M15.5 10.5l6-3v9l-6-3z"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  ppt:   '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M12 16.5v3.5M8.5 20h7"/><path d="M7 9h6M7 12h9"/>',
  codi:  '<path d="M9 4.5h6a1 1 0 0 1 1 1V7H8V5.5a1 1 0 0 1 1-1z"/><path d="M8 6H6.5A1.5 1.5 0 0 0 5 7.5v12A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 6H16"/><path d="M8.5 12l2 2 4-4"/>',
  pray:  '<path d="M12 21V11.5"/><path d="M12 11.5c0-3.2-1.6-6.2-4-8-.8 3.6-.4 7.6 1.6 10.4"/><path d="M12 11.5c0-3.2 1.6-6.2 4-8 .8 3.6.4 7.6-1.6 10.4"/><path d="M8 21h8"/>',
  play:  '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10.5 9.2l5 2.8-5 2.8z" fill="currentColor" stroke="none"/>'
};

function ico(k, cls) {
  /* v8.3 — 직접 그린 아이콘 세트(icons.js)가 있으면 그것을, 없으면 아래 옛 모양을 씁니다 */
  var svg = (window.YNIcon && YNIcon.has(k)) ? YNIcon.get(k) : (window.YNIcon && !ICON[k] ? YNIcon.get('voice') : '');
  if (!svg) svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICON[k] || ICON.voice) + '</svg>';
  return '<span class="' + (cls || 'si') + '">' + svg + '</span>';
}

function dt(s) { var p = String(s).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }

function fmtDate(d) {
  var p = String(d).split('-');
  return Number(p[1]) + '월 ' + Number(p[2]) + '일';
}

function fmtDay(d) { return fmtDate(d) + ' (' + WD[dt(d).getDay()] + ')'; }

function fmtRange(a, b) { return (!b || b === a) ? fmtDay(a) : fmtDay(a) + ' – ' + fmtDay(b); }

function shortAt(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(String(v || ''));
  return m ? (Number(m[2]) + '/' + Number(m[3]) + ' ' + m[4]) : String(v || '');
}

function md(d) { var p = String(d).split('-'); return Number(p[1]) + '/' + Number(p[2]); }

function offMap(list) {
  var o = {};
  (list || (W && W.off) || []).forEach(function (x) { o[x.name] = x.reason || '불가'; });
  return o;
}

var FACE = null;

function face(n) {
  if (!FACE) {
    FACE = {};
    D.members.forEach(function (m) { FACE[m.name] = m.photo || ''; });
  }
  var p = FACE[n];
  var ch = esc(String(n || '?').charAt(0));
  // 사진이 열리지 않으면 첫 글자로 바꿔 끼웁니다
  return p
    ? '<img class="fc" src="' + esc(p) + '" alt="" ' +
      'onerror="this.outerHTML=&quot;<span class=\'fc\'>' + ch + '</span>&quot;">'
    : '<span class="fc">' + ch + '</span>';
}

function shortName(n) {
  n = String(n || '').trim();
  return /^[가-힣]{3}$/.test(n) ? n.slice(1) : n;
}

function known() {
  var k = {};
  D.members.forEach(function (m) { k[m.name] = 1; });
  return k;
}

function pickGroups(p, picked, off, fn) {
  var 우선 = [], 나머지 = [], 불가 = [], 손님 = [];
  D.members.forEach(function (m) {
    if (off[m.name]) 불가.push(m);
    else (m.fit.indexOf(p.key) !== -1 ? 우선 : 나머지).push(m);
  });
  var kn = known();
  picked.forEach(function (n) { if (!kn[n]) 손님.push({ name: n, role: '객원', fit: [] }); });

  function btn(m) {
    var on = picked.indexOf(m.name) !== -1;
    var why = off[m.name];
    return '<button type="button" class="pick' + (on ? ' on' : '') + (why ? ' off' : '') +
      '" onclick="' + fn + '(\'' + esc(jsq(m.name)) + '\')">' + face(m.name) + esc(dispName(m.name)) +
      (why ? '<i>' + esc(why) + '</i>' : (m.role ? '<i>' + esc(m.role.split(' · ')[0]) + '</i>' : '')) + '</button>';
  }
  function group(label, list, cls) {
    if (!list.length) return '';
    return '<div class="pgroup' + (cls ? ' ' + cls : '') + '"><div class="gl">' + label + '</div>' +
      '<div class="pwrap">' + list.map(btn).join('') + '</div></div>';
  }
  return group(p.bcast ? '방송팀' : '이 포지션 담당', 우선) +
    group('그 외 팀원', 나머지) +
    group('객원', 손님) +
    group('Unavailable · ' + 불가.length + '명', 불가, 'offg');
}

var GS_TIMER = null, GS_SEQ = 0;

function guestBox(pre, fn) {
  return '<div class="pgroup gsbox"><div class="gl">객원 · 다른 팀에서 찾기</div>' +
    '<div class="addrow"><input type="text" id="' + pre + 'Q" placeholder="이름 · 전화번호 · 셀 · 영문이름" maxlength="30" autocomplete="off" ' +
      'oninput="gsInput(\'' + pre + '\',\'' + fn + '\')"></div>' +
    '<div class="pwrap gsres" id="' + pre + 'Res"></div></div>';
}

function gsPicked(fn) {
  if (fn === 'stToggle') {
    var r = ST.cell ? stRow(ST.cell.key) : null;
    return (r && ST.cell && r.slots[ST.cell.pos]) || [];
  }
  return (W && W.slots && W.slots[openPos]) || [];
}

function gsInput(pre, fn) {
  var q = (el(pre + 'Q').value || '').trim();
  var box = el(pre + 'Res');
  clearTimeout(GS_TIMER);
  if (!q) { box.innerHTML = ''; return; }
  var my = ++GS_SEQ;
  GS_TIMER = setTimeout(function () {
    callServer('worshipGuestSearch', [TOKEN, q], function (r) {
      if (my !== GS_SEQ || !el(pre + 'Res')) return;
      gsDraw(pre, fn, r || {});
    }, function (e) {
      if (my !== GS_SEQ || !el(pre + 'Res')) return;
      el(pre + 'Res').innerHTML = '<span class="gsempty err">' + esc((e && e.message) || '찾지 못했습니다.') + '</span>';
    });
  }, 200);
}

function gsFace(g) {
  var ch = esc(String(g.name || '?').charAt(0));
  return g.photo
    ? '<img class="fc" src="' + esc(g.photo) + '" alt="" onerror="this.outerHTML=&quot;<span class=\'fc\'>' + ch + '</span>&quot;">'
    : '<span class="fc">' + ch + '</span>';
}

function gsDraw(pre, fn, r) {
  var box = el(pre + 'Res');
  var picked = gsPicked(fn);
  var list = r.list || [];
  var html = list.map(function (g) {
    var meta = [g.cell, g.tail ? '···' + g.tail : ''].filter(Boolean).join(' ');
    return '<button type="button" class="pick gsp' + (picked.indexOf(g.name) !== -1 ? ' on' : '') + '" onclick="' + fn + '(\'' + esc(jsq(g.name)) + '\')">' +
      gsFace(g) + esc(g.name) + (meta ? '<i>' + esc(meta) + '</i>' : '') + '</button>';
  }).join('');
  if (!list.length) {
    html = '<span class="gsempty">' + ((r.hint || []).length
      ? esc(r.hint.join(', ')) + ' — 이미 팀원입니다. 위 팀원 목록에서 고르세요.'
      : '다른 팀에도 일치하는 분이 없습니다. 아래에서 직접 입력하세요.') + '</span>';
  } else if (r.total > list.length) {
    html += '<span class="gsempty">그 밖에 ' + (r.total - list.length) + '명 — 검색어를 더 적어 주세요.</span>';
  }
  box.innerHTML = html;
}

function nextPick(p, cur, name) {
  cur = cur.slice();
  var i = cur.indexOf(name);
  if (i !== -1) cur.splice(i, 1);
  else if (p.multi) cur.push(name);
  else cur = [name];
  return cur;
}

function ytId(url) {
  var m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/.exec(String(url || ''));
  return m ? m[1] : '';
}

var REC_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

function recCard(r, date, compact) {
  var canDel = !compact && (D.canEdit || D.committee || (D.who && r.by === D.who));
  var meta = [r.by, r.at ? md(r.at) : ''].filter(function (x) { return x; }).join(' · ');
  var w = r.kind === '예배';
  var sub = [w ? '예배' : '연습', meta].filter(function (x) { return x; }).join(' · ');
  return '<div class="rec"' + (r.play ? ' data-src="' + esc(r.play) + '" data-title="' + esc(r.title) + '" data-sub="' + esc(sub) + '" data-open="' + esc(r.url || '') + '"' : '') + '>' +
    '<div class="rech"><span class="recic' + (w ? ' w' : '') + '">' + REC_ICO + '</span>' +
      '<div class="rect"><b>' + esc(r.title) + '</b><span>' +
        (compact ? '<i class="rkind' + (w ? ' w' : '') + '">' + (w ? '예배' : '연습') + '</i>' : '') + esc(meta) + '</span></div>' +
      (r.play ? '<button type="button" class="rec-play" onclick="YNPlayer.playFrom(this)" aria-label="재생"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg><span>재생</span></button>' : '') +
    '</div>' +
    (r.play
      ? '<div class="recfoot"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">드라이브에서 열기 ↗</a>' +
          (canDel ? '<button type="button" class="del" onclick="dropRec(\'' + esc(jsq(r.id)) + '\')">삭제</button>' : '') + '</div>'
      : '<a class="reclink" href="' + esc(r.url) + '" target="_blank" rel="noopener">▶ 링크에서 듣기</a>' +
        (canDel ? '<div class="recfoot"><button type="button" class="del" onclick="dropRec(\'' + esc(jsq(r.id)) + '\')">삭제</button></div>' : '')) +
  '</div>';
}

var ST = { rows: null, mine: [], hl: '', pick: null, cell: null, range: 'next3',
  // 기본은 카드, 한눈에 넓게 보려면 테이블로 바꿔 볼 수 있습니다
  view: 'table' };

var ST_RANGES = [['next3', '앞으로 3개월'], ['next6', '앞으로 6개월'], ['around', '앞뒤 3개월'], ['past3', '지난 3개월'], ['past6', '지난 6개월'], ['past12', '지난 1년']];

function stGroups() {
  var has = {}, out = [];
  D.positions.forEach(function (p) { has[p.key] = p; });
  var used = {};
  ST_GROUPS.forEach(function (g) {
    var cols = g[1].filter(function (k) { return has[k]; }).map(function (k) { used[k] = 1; return has[k]; });
    if (cols.length) out.push([g[0], cols]);
  });
  var rest = D.positions.filter(function (p) { return !used[p.key]; });
  if (rest.length) out.push(['기타', rest]);
  return out;
}

function loadSched() {
  callServer('worshipSchedule', [TOKEN, ST.range], function (r) {
      ST.rows = r.rows; ST.mine = r.mine || [];
      if (!ST.hl && D.who) ST.hl = D.who;
      if (TAB === 'sched') render();
    }, function (e) {
      if (TAB === 'sched') el('body').innerHTML = '<div class="panel"><p class="empty">' + esc(e.message || '불러오지 못했습니다.') + '</p></div>';
    });
}

function stRange(v) {
  ST.range = v; ST.rows = null; ST.pick = null;
  render(); loadSched();
}

function stRow(key) { return (ST.rows || []).filter(function (r) { return r.key === key; })[0]; }

function stSync(w) {
  var r = stRow(w.date);
  if (r) { r.slots = w.slots; r.off = w.off || []; r.verse = (w.paper || {}).verse || r.verse; }
}

function stTitle(r) {
  return r.event ? esc(r.event.name) : fmtDate(r.date) + ' 주일';
}

function schedTab() {
  if (!ST.rows) {
    return '<div class="panel"><p class="hint" style="margin-top:0;">' +
      esc((ST_RANGES.filter(function (x) { return x[0] === ST.range; })[0] || ST_RANGES[0])[1]) + ' 스케줄을 불러오는 중…</p>' +
      '<i class="skel line" style="width:55%;"></i><i class="skel line" style="width:85%;"></i>' +
      '<i class="skel line" style="width:70%;"></i><i class="skel line" style="width:40%;"></i></div>';
  }
  var groups = stGroups();
  var cols = [];
  groups.forEach(function (g) { cols = cols.concat(g[1]); });
  var kn = known();
  var picking = !!ST.pick;
  var mineSet = {};
  ST.mine.forEach(function (x) { mineSet[x.date] = x; });

  var head1 = '<tr class="g"><th class="dc" rowspan="2">날짜</th>' +
    groups.map(function (g) { return '<th colspan="' + g[1].length + '">' + g[0] + '</th>'; }).join('') +
    '<th class="offc" rowspan="2">불가</th>' + stXHead() + '</tr>';
  var head2 = '<tr>' + cols.map(function (p) { return '<th>' + esc(ST_SHORT[p.key] || p.label) + '</th>'; }).join('') + '</tr>';

  var lastMonth = '', body = '';
  ST.rows.forEach(function (r) {
    var mo = r.date.slice(0, 7);
    if (mo !== lastMonth) {
      lastMonth = mo;
      body += '<tr class="mrow"><td class="dc">' + Number(mo.split('-')[1]) + '월</td><td colspan="' + (cols.length + 3) + '"></td></tr>';
    }
    var off = offMap(r.off);
    var sel = picking && ST.pick.indexOf(r.key) !== -1;
    var mineOff = mineSet[r.key];
    var dateCell = '<td class="dc' + (r.event ? ' ev' : '') + (sel ? ' sel' : '') + (mineOff ? ' mineoff' : '') +
      '" onclick="' + (picking ? 'stPickDay' : 'stDay') + '(\'' + r.key + '\')">' +
      (picking ? '<span class="ck">' + (sel ? '✓' : '') + '</span>' : '') +
      stPracShort(r) + '<b>' + WD[dt(r.date).getDay()] + ' ' + md(r.date) + '</b>' +
      '<span class="dcn">' + (r.event ? esc(r.event.name) : '') + (mineOff ? (r.event ? ' · ' : '') + stMineTag(mineOff, r) : '') + '</span></td>';

    var cells = cols.map(function (p) {
      var names = r.slots[p.key] || [];
      var inner = names.length ? names.map(function (n) {
        var cls = 'tn' + (off[n] ? ' off' : '') + (n === ST.hl ? ' hl' : '') + (kn[n] ? '' : ' guest');
        return '<span class="' + cls + '" title="' + esc(n + (off[n] ? ' — ' + off[n] : '')) + '">' + esc(shortName(n)) + '</span>';
      }).join('') : '<span class="tn none">·</span>';
      var edit = D.canEdit && !picking;
      return '<td class="c' + (edit ? ' ed' : '') + '"' +
        (edit ? ' onclick="stCell(\'' + r.key + '\',\'' + p.key + '\')"' : '') + '>' + inner + '</td>';
    }).join('');

    var offCell = '<td class="offc" onclick="stDay(\'' + r.key + '\')">' + (r.off.length
      ? r.off.map(function (x) { return stOffTn(x, r); }).join('')
      : '') + '</td>';

    body += '<tr class="r' + (r.event ? ' evr' : '') + '">' + dateCell + cells + offCell + stXCells(r) + '</tr>';
  });

  var people = D.members.map(function (m) { return m.name; });
  var hlSel = '<select class="hlsel" onchange="ST.hl=this.value;render();">' +
    '<option value="">사람 강조 없음</option>' +
    people.map(function (n) { return '<option value="' + esc(n) + '"' + (n === ST.hl ? ' selected' : '') + '>' + esc(dispName(n)) + (n === D.who ? ' (나)' : '') + '</option>'; }).join('') +
    '</select>';

  var bar = picking
    ? '<div class="stbar"><div class="stbar-in">' +
        '<div class="stbar-t">' + (ST.pick.length ? ST.pick.length + '개 날짜 선택됨' : '아래 표에서 안 되는 날짜를 누르세요') + '</div>' +
        stPartSeg() + '<div class="addrow"><input type="text" id="offReason" placeholder="사유 — 예: 출장 · 시험 · 가족 행사" maxlength="100" ' +
          'onkeydown="if(event.key===\'Enter\')saveOff()">' +
          '<button class="btn" onclick="ST.pick=null;render();">취소</button>' +
          '<button class="btn accent" onclick="saveOff()">저장</button></div>' +
        '<p class="msg" id="offMsg" style="margin:6px 0 0;min-height:0;"></p></div></div>'
    : '';

  var viewSeg = '<div class="seg stseg">' + [['card', '카드'], ['table', '테이블']].map(function (v) {
    return '<button type="button" class="' + (ST.view === v[0] ? 'on' : '') + '" onclick="ST.view=\'' + v[0] + '\';render();">' + v[1] + '</button>';
  }).join('') + '</div>';

  var rangeSel = '<select class="rangesel" onchange="stRange(this.value)">' + ST_RANGES.map(function (x) {
    return '<option value="' + x[0] + '"' + (ST.range === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
  }).join('') + '</select>';

  return '<div class="panel stpanel"><div class="sechead"><span class="chip">스케줄표</span>' + stOffBtn(picking) + viewSeg + '</div>' + stMinePanel(picking) +
      '<div class="sttools">' + rangeSel + hlSel + '</div>' +
      '<div class="docbar" style="margin:0 4px 8px;">' + docBtn('스케줄표 PDF 미리보기 · 다운로드', 'hubDoc(\'hubScheduleDoc\',[TOKEN,ST.range],\'stDocMsg\')') + '<p class="msg docmsg" id="stDocMsg"></p></div>' +
      '<p class="hint">' + (picking ? '안 되는 날짜를 눌러 고른 뒤 위 칸에 사유를 적고 저장하세요.'
        : (D.canEdit ? '칸을 누르면 바로 배정합니다. 날짜를 누르면 그날 자세히 볼 수 있어요.'
                     : '날짜를 누르면 그날 편성과 불가 사유를 볼 수 있어요.')) +
        ' <span class="lg"><span class="tn off">불가</span> <span class="tn hl">강조</span> <span class="tn guest">객원</span></span></p>' +
      bar +
      (ST.view === 'card' ? stCards(groups, kn, picking, mineSet)
        : '<div class="stwrap"><table class="st"><thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody></table></div>') +
      '<p class="msg" id="stMsg"></p>' +
    '</div>';
}

function stCards(groups, kn, picking, mineSet) {
  var lastMonth = '', out = '';
  ST.rows.forEach(function (r) {
    var mo = r.date.slice(0, 7);
    if (mo !== lastMonth) { lastMonth = mo; out += '<p class="stmon">' + Number(mo.split('-')[0]) + '년 ' + Number(mo.split('-')[1]) + '월</p>'; }
    var off = offMap(r.off);
    var sel = picking && ST.pick.indexOf(r.key) !== -1;
    var mineOff = mineSet[r.key];
    var edit = D.canEdit && !picking;
    var d = dt(r.date);
    out += '<div class="stc' + (r.event ? ' ev' : '') + (sel ? ' sel' : '') + '">' +
      '<button type="button" class="stch" onclick="' + (picking ? 'stPickDay' : 'stDay') + '(\'' + r.key + '\')">' +
        (picking ? '<span class="ck">' + (sel ? '✓' : '') + '</span>' : '') +
        stPracHtml(r) + '<b>' + md(r.date) + '</b><span class="wd">' + (r.event ? WD[d.getDay()] : '(주일)') + '</span>' +
        (r.event ? '<span class="evn">' + esc(r.event.name) + '</span>' : '') +
        '<span class="sp"></span>' +
        (mineOff ? '<span class="mo">' + stMineTag(mineOff, r) + '</span>' : '') +
        (r.off.length ? '<span class="oc">불가 ' + r.off.length + '</span>' : '') +
        '<span class="go">&rsaquo;</span></button>' +
      [groups.reduce(function (a, g) { return a.concat(g[1]); }, [])].map(function (cols) {
        return '<div class="stcg">' + cols.map(function (p) {
          var names = r.slots[p.key] || [];
          return '<div class="stcc' + (edit ? ' ed' : '') + (names.length ? '' : ' vac') + '"' +
            (edit ? ' onclick="stCell(\'' + r.key + '\',\'' + p.key + '\')"' : '') + '>' +
            '<span class="pl">' + ico(p.icon, 'pi') + esc(ST_SHORT[p.key] || p.label) + '</span>' +
            (names.length ? names.map(function (n) {
              var cls = 'tp' + (off[n] ? ' off' : '') + (n === ST.hl ? ' hl' : '') + (kn[n] ? '' : ' guest');
              return '<span class="' + cls + '" title="' + esc(n + (off[n] ? ' — 불가: ' + off[n] : '')) + '">' + face(n) + '<span class="t">' + esc(shortName(n)) + '</span></span>';
            }).join('') : '<span class="tn none">—</span>') + '</div>';
        }).join('') + '</div>';
      }).join('') +
      (r.off.length ? '<div class="stoff">불가 · ' + r.off.map(function (x) {
        return '<b>' + esc(dispName(x.name)) + '</b> ' + esc(stOffWhy(x, r));
      }).join(' · ') + '</div>' : '') +
    '</div>';
  });
  return '<div class="stcards">' + out + '</div>';
}

function stDay(key) {
  var r = stRow(key);
  if (!r) return;
  var off = offMap(r.off);
  var mine = ST.mine.filter(function (x) { return x.date === key; })[0];
  var lines = stGroups().map(function (g) {
    return g[1].map(function (p) {
      var names = r.slots[p.key] || [];
      return '<div class="yc-r"><span class="stpl">' + esc(p.label) + '</span><div class="v">' +
        (names.length ? names.map(function (n) { return '<span class="nm' + (off[n] ? ' off' : '') + '">' + face(n) + esc(dispName(n)) + '</span>'; }).join(' ')
                      : '<span class="tbd">미정</span>') + '</div></div>';
    }).join('');
  }).join('');

  var html = '<div class="yc-h"><h3>' + stTitle(r) + '</h3></div>' +
    (r.event ? '<p class="stsub">' + esc(fmtRange(r.event.date, r.event.endDate)) + (r.event.place ? ' · ' + esc(r.event.place) : '') + '</p>' : '') +
    (r.verse ? '<div class="verse" style="margin-bottom:10px;"><div class="vq">' + esc(r.verse) + '</div></div>' : '') +
    (r.off.length ? '<div class="offbar"><b>불가</b><br>' + r.off.map(function (x) { return esc(dispName(x.name)) + ' — ' + esc(stOffWhy(x, r)); }).join('<br>') + '</div>' : '') +
    lines + stPracBox(r) +
    stMeBox(r, key, mine) +
    '<div class="yc-acts"><button class="btn dark" onclick="YC.close();goWeek(\'' + esc(jsq(key)) + '\')">이 날 예배 준비 열기 &rsaquo;</button></div>';
  YC.sheet(html, {});
}

function stCell(key, pos) {
  ST.cell = { key: key, pos: pos };
  YC.sheet('<div class="stpk" id="stpk"></div>', {});
  drawStPicker();
}

function drawStPicker() {
  var box = el('stpk');
  if (!box || !ST.cell) return;
  var r = stRow(ST.cell.key);
  var p = D.positions.filter(function (x) { return x.key === ST.cell.pos; })[0];
  if (!r || !p) return;
  box.innerHTML = '<div class="yc-h"><h3>' + stTitle(r) + ' · ' + esc(p.label) + '</h3></div>' +
    '<p class="stsub">' + (p.multi ? '여러 명 고를 수 있습니다' : '한 명 — 누르면 바로 들어갑니다') + ' · 바로 저장됩니다</p>' +
    pickGroups(p, r.slots[p.key] || [], offMap(r.off), 'stToggle') +
    guestBox('stgs', 'stToggle') +
    '<div class="pgroup" style="margin-bottom:0;"><div class="gl">객원 직접 입력 <span class="gsnote">명단에 없는 분</span></div>' +
      '<div class="addrow"><input type="text" id="stGuest" placeholder="이름" maxlength="20" ' +
        'onkeydown="if(event.key===\'Enter\')stToggle(this.value.trim())">' +
      '<button class="btn accent" onclick="stToggle(val(\'stGuest\'))">추가</button></div></div>' +
    (p.multi || (r.slots[p.key] || []).length ? '<div class="yc-acts"><button class="btn" onclick="YC.close()">완료</button></div>' : '');
}

function stToggle(name) {
  if (!name || !ST.cell) return;
  var r = stRow(ST.cell.key);
  var p = D.positions.filter(function (x) { return x.key === ST.cell.pos; })[0];
  var cur = nextPick(p, r.slots[p.key] || [], name);
  r.slots[p.key] = cur;
  if (CACHE[r.key]) CACHE[r.key].slots[p.key] = cur;
  if (!p.multi && cur.length) YC.close(); else drawStPicker();
  render();
  say('stMsg', '저장하는 중…');
  callServer('setWorshipSlot', [TOKEN, r.key, p.key, cur], function (w) { apply(w); if (TAB === 'sched') { render(); say('stMsg', '저장했습니다.', 'ok'); } }, function (e) { say('stMsg', e.message || '저장하지 못했습니다.', 'err'); });
}

function stPickDay(key) {
  if (ST.mine.filter(function (x) { return x.date === key; }).length) { clearOff(key); return; }
  var i = ST.pick.indexOf(key);
  if (i === -1) ST.pick.push(key); else ST.pick.splice(i, 1);
  var reason = val('offReason');
  render();
  if (el('offReason')) el('offReason').value = reason;
}

function offOne(key) {
  var r = val('dayReason');
  if (!r) { el('dayReason').focus(); return; }
  YC.close();
  markOff([key], r);
}

function saveOff() {
  var r = val('offReason');
  if (!ST.pick || !ST.pick.length) { say('offMsg', '날짜를 먼저 골라주세요.', 'err'); return; }
  if (!r) { say('offMsg', '사유를 적어주세요.', 'err'); el('offReason').focus(); return; }
  say('offMsg', '저장하는 중…');
  markOff(ST.pick.slice(), r);
}

function markOff(keys, reason) {
  callServer('setMyUnavailableMany', [TOKEN, keys, reason], function (mine) {
      ST.mine = mine; D.mine = mine; ST.pick = null;
      keys.forEach(function (k) { patchOff(k, reason); });
      render();
      say('stMsg', keys.length + '개 날짜를 불가로 표시했습니다.', 'ok');
    }, function (e) { say('offMsg', e.message || '저장하지 못했습니다.', 'err'); say('stMsg', e.message || '', 'err'); });
}

function clearOff(key) {
  YC.close();
  callServer('removeMyUnavailable', [TOKEN, key], function (mine) { ST.mine = mine; D.mine = mine; patchOff(key, null); render(); }, fail);
}

function patchOff(key, reason) {
  function fix(list) {
    list = (list || []).filter(function (x) { return x.name !== D.who; });
    if (reason) list.push({ name: D.who, reason: reason });
    return list;
  }
  var r = stRow(key);
  if (r) r.off = fix(r.off);
  if (CACHE[key]) { CACHE[key].off = fix(CACHE[key].off); countUp(CACHE[key]); }
  else D.weeks = D.weeks.map(function (x) {
    if (x.date !== key) return x;
    return { date: x.date, day: x.day, event: x.event, filled: x.filled, need: x.need, off: Math.max(0, x.off + (reason ? 1 : -1)) };
  });
  renderWeeks();
}

var SS = { data: null, items: null, first: null, names: null, teams: null,
  range: 'all', kind: 'all', lead: '', q: '', view: 'song', more: false, rows: [] };

function loadStats() {
  callServer('worshipStats', [TOKEN], function (d) { SS.data = d; statPrep(); if (TAB === 'stats') render(); }, function (e) {
      if (TAB === 'stats') el('body').innerHTML = '<div class="panel"><p class="empty">' + esc(e.message || '불러오지 못했습니다.') + '</p></div>';
    });
}

function songNorm(t) {
  var s = String(t || '').toLowerCase();
  var a = s.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^0-9a-z가-힣ㄱ-ㆎ]/g, '');
  return a || s.replace(/[^0-9a-z가-힣ㄱ-ㆎ]/g, '') || s;
}

function lev1(a, b) {
  if (a === b) return true;
  var la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  var i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return diff + (la - i) + (lb - j) <= 1;
}

function statPrep() {
  var d = SS.data;
  var items = d.songs.map(function (x) {
    return { key: x[0], date: x[1], kind: x[2], title: x[3], team: x[4], mkey: x[5], n: songNorm(x[3]) };
  });
  var cnt = {};
  items.forEach(function (i) { cnt[i.n] = (cnt[i.n] || 0) + 1; });
  var keys = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || a.localeCompare(b); });
  var canon = {};
  keys.forEach(function (k, idx) {
    canon[k] = k;
    if (k.length < 5) return;
    for (var j = 0; j < idx; j++) {
      var o = keys[j];
      if (canon[o] === o && o.length >= 5 && lev1(k, o)) { canon[k] = o; break; }
    }
  });
  // 보여줄 이름 — 가장 많이 쓴 표기 / 팀 — 가장 많이 적힌 팀
  var spell = {}, team = {};
  items.forEach(function (i) {
    i.c = canon[i.n];
    var s = spell[i.c] = spell[i.c] || {};
    s[i.title] = (s[i.title] || 0) + 1;
    if (i.team) { var t = team[i.c] = team[i.c] || {}; t[i.team] = (t[i.team] || 0) + 1; }
  });
  // 같은 횟수면 띄어쓰기 · 대문자가 살아 있는 표기를 고릅니다 (waymaker 보다 Way Maker)
  function top(o) {
    return Object.keys(o || {}).sort(function (a, b) {
      return o[b] - o[a] || b.length - a.length || (/[A-Z]/.test(b) ? 1 : 0) - (/[A-Z]/.test(a) ? 1 : 0);
    })[0] || '';
  }
  SS.names = {}; SS.teams = {}; SS.spell = spell;
  Object.keys(spell).forEach(function (c) { SS.names[c] = top(spell[c]); SS.teams[c] = top(team[c]); });
  // 곡마다 처음 부른 날
  SS.first = {};
  items.forEach(function (i) { if (!SS.first[i.c] || i.date < SS.first[i.c]) SS.first[i.c] = i.date; });
  SS.items = items;
}

function lineup(k) { return (SS.data.lineups || {})[k] || { lead: [], people: [] }; }

function cutoff() {
  if (SS.range === 'all') return '';
  var t = dt(SS.data.today);
  t.setMonth(t.getMonth() - Number(SS.range));
  return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
}

function statItems() {
  var from = cutoff(), q = SS.q ? songNorm(SS.q) : '';
  return SS.items.filter(function (i) {
    if (from && i.date < from) return false;
    if (SS.kind !== 'all' && i.kind !== SS.kind) return false;
    if (SS.lead && lineup(i.key).lead.indexOf(SS.lead) === -1) return false;
    if (q && i.c.indexOf(q) === -1 && songNorm(SS.teams[i.c]).indexOf(q) === -1) return false;
    return true;
  });
}

function bump(o, k, i) {
  var x = o[k] = o[k] || { name: k, n: 0, keys: {}, songs: {}, last: '' };
  x.n++; x.keys[i.key] = 1; x.songs[i.c] = (x.songs[i.c] || 0) + 1;
  if (i.date > x.last) x.last = i.date;
}

function sortN(o) {
  return Object.keys(o).map(function (k) { return o[k]; })
    .sort(function (a, b) { return b.n - a.n || b.last.localeCompare(a.last) || a.name.localeCompare(b.name); });
}

function statsTab() {
  if (!SS.data) {
    return '<div class="panel"><i class="skel line" style="width:50%;"></i><i class="skel line" style="width:80%;"></i>' +
      '<i class="skel line" style="width:65%;"></i></div>';
  }
  if (!SS.items.length) {
    return '<div class="panel"><span class="chip">콘티 통계</span><p class="empty">아직 입력된 콘티가 없습니다.</p></div>';
  }
  var list = statItems();
  var from = cutoff();

  // 요약
  var svc = {}, dist = {}, fresh = {};
  list.forEach(function (i) {
    svc[i.key] = 1; dist[i.c] = 1;
    if (!from || SS.first[i.c] >= from) fresh[i.c] = 1;
  });
  var tiles = '<div class="sstiles two">' +
    tile(list.length, '총 곡 수') + tile(Object.keys(dist).length, '서로 다른 곡') + '</div>';

  // 거르기 — 한 줄
  var leads = {};
  SS.items.forEach(function (i) { lineup(i.key).lead.forEach(function (n) { leads[n] = 1; }); });
  var filters = '<div class="ssf">' +
    seg('range', [['3', '3개월'], ['6', '6개월'], ['12', '1년'], ['all', '전체']]) +
    seg('kind', [['all', '전체'], ['콘티', '콘티'], ['결단', '결단찬양']]) +
    '<select onchange="SS.lead=this.value;SS.more=false;render();"><option value="">인도자 전체</option>' +
      Object.keys(leads).sort().map(function (n) {
        return '<option value="' + esc(n) + '"' + (SS.lead === n ? ' selected' : '') + '>' + esc(dispName(n)) + '</option>';
      }).join('') + '</select>' +
    '<input type="search" id="ssq" placeholder="곡 · 팀 검색" value="' + esc(SS.q) + '" ' +
      'oninput="SS.q=this.value;SS.more=false;statRedraw();">' +
    '</div>';

  var views = [['song', '곡 순위'], ['team', '원곡 팀'], ['lead', '인도자'], ['people', '사람'], ['month', '월별']];
  var vtabs = '<div class="tabs subtabs ssv">' + views.map(function (v) {
    return '<button type="button" class="' + (SS.view === v[0] ? 'on' : '') + '" onclick="SS.view=\'' + v[0] + '\';SS.more=false;render();">' + v[1] + '</button>';
  }).join('') + '</div>';

  return '<div class="panel"><span class="chip">콘티 통계</span>' +
      '<p class="hint">입력된 콘티 전체 기준입니다 (앞으로 부를 곡 포함). 띄어쓰기 · 대소문자 · 한 글자 오타는 같은 곡으로 묶었습니다.</p>' +
      filters + tiles +
      '<div class="docbar">' + docBtn('통계 PDF 미리보기 · 다운로드', 'hubDoc(\'hubStatsDoc\',[TOKEN,SS.range===\'all\'?\'\':SS.range],\'ssDocMsg\')') + '<p class="msg docmsg" id="ssDocMsg"></p></div></div>' +
    vtabs + '<div class="panel" id="ssBody">' + statView(list) + '</div>';
}

function statRedraw() {
  if (el('ssBody')) el('ssBody').innerHTML = statView(statItems());
}

function tile(v, l) { return '<div class="sst"><b>' + v + '</b><span>' + l + '</span></div>'; }

function seg(k, opts) {
  return '<div class="seg">' + opts.map(function (o) {
    return '<button type="button" class="' + (SS[k] === o[0] ? 'on' : '') + '" onclick="SS.' + k + '=\'' + o[0] + '\';SS.more=false;render();">' + o[1] + '</button>';
  }).join('') + '</div>';
}

function bars(rows, fmtName, fmtSub, unit) {
  if (!rows.length) return '<p class="empty">조건에 맞는 곡이 없습니다.</p>';
  var max = rows[0].n || 1;
  var show = SS.more ? rows : rows.slice(0, 20);
  SS.rows = rows;
  return show.map(function (r, i) {
    return '<button type="button" class="srow" onclick="statOpen(' + i + ')" title="' + esc(fmtName(r)) + ' — ' + r.n + unit + '">' +
      '<span class="rk">' + (i + 1) + '</span>' +
      '<span class="sb"><span class="stt">' + esc(fmtName(r)) + '</span>' +
        (fmtSub ? '<span class="sm">' + fmtSub(r) + '</span>' : '') +
        '<span class="trk"><span class="fill" style="width:' + Math.max(3, Math.round(r.n / max * 100)) + '%"></span></span></span>' +
      '<span class="sn">' + r.n + '<small>' + unit + '</small></span></button>';
  }).join('') +
  (rows.length > 20 && !SS.more ? '<button class="btn full" style="margin-top:10px;" onclick="SS.more=true;statRedraw();">' + (rows.length - 20) + '개 더 보기</button>' : '');
}

function topSongs(o, k) {
  return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, k || 3)
    .map(function (c) { return esc(SS.names[c]); }).join(', ');
}

function statView(list) {
  var g = {};
  if (SS.view === 'song') {
    list.forEach(function (i) { bump(g, i.c, i); });
    return bars(sortN(g), function (r) { return SS.names[r.name]; },
      function (r) { return [SS.teams[r.name], (r.last > SS.data.today ? '예정 ' : '최근 ') + md(r.last)].filter(function (x) { return x; }).map(esc).join(' · '); }, '회');
  }
  if (SS.view === 'team') {
    list.forEach(function (i) { bump(g, SS.teams[i.c] || '팀 미입력', i); });
    return bars(sortN(g), function (r) { return r.name; },
      function (r) { return Object.keys(r.songs).length + '곡 · ' + topSongs(r.songs, 2); }, '회');
  }
  if (SS.view === 'lead') {
    list.forEach(function (i) { lineup(i.key).lead.forEach(function (n) { bump(g, n, i); }); });
    var rows = sortN(g).map(function (r) { r.n = Object.keys(r.keys).length; return r; })
      .sort(function (a, b) { return b.n - a.n; });
    return rows.length ? bars(rows, function (r) { return dispName(r.name); },
      function (r) { return Object.keys(r.songs).length + '곡 · 자주: ' + topSongs(r.songs, 2); }, '번 인도')
      : '<p class="empty">편성에 인도자가 적힌 예배가 없습니다.</p>';
  }
  if (SS.view === 'people') {
    list.forEach(function (i) { lineup(i.key).people.forEach(function (n) { bump(g, n, i); }); });
    var pr = sortN(g).map(function (r) { r.n = Object.keys(r.keys).length; return r; })
      .sort(function (a, b) { return b.n - a.n; });
    return pr.length ? bars(pr, function (r) { return r.name; },
      function (r) { return Object.keys(r.songs).length + '곡 함께 · 자주: ' + topSongs(r.songs, 2); }, '번 섬김')
      : '<p class="empty">편성 기록이 없습니다.</p>';
  }
  // 월별 — 한 달에 부른 곡 수
  var m = {};
  list.forEach(function (i) { var k = i.date.slice(0, 7); m[k] = (m[k] || 0) + 1; });
  var ks = Object.keys(m).sort().slice(-18);
  if (!ks.length) return '<p class="empty">조건에 맞는 곡이 없습니다.</p>';
  var max = Math.max.apply(null, ks.map(function (k) { return m[k]; }));
  return '<p class="sect" style="margin-top:0;">한 달에 부른 곡 수</p><div class="mchart">' + ks.map(function (k) {
    var p = k.split('-');
    return '<div class="mcol" title="' + Number(p[0]) + '년 ' + Number(p[1]) + '월 — ' + m[k] + '곡">' +
      '<span class="mv">' + m[k] + '</span>' +
      '<span class="mbar" style="height:' + Math.max(4, Math.round(m[k] / max * 120)) + 'px"></span>' +
      '<span class="ml">' + Number(p[1]) + '월</span></div>';
  }).join('') + '</div>';
}

function statOpen(i) {
  var r = SS.rows[i];
  if (!r) return;
  if (SS.view === 'song') return songSheet(r.name);
  var title = SS.view === 'team' ? r.name : r.name + (SS.view === 'lead' ? ' · 인도한 곡' : ' · 함께한 곡');
  var songs = Object.keys(r.songs).map(function (c) { return { name: c, n: r.songs[c], last: '' }; })
    .sort(function (a, b) { return b.n - a.n; });
  var max = songs.length ? songs[0].n : 1;
  if (window.YNStats) {                                     // 다크 글래스 팝업 (Step 2) — 계산은 위 그대로, 보여주기만 새것
    YNStats.list({ title: title, sub: rangeLabel() + ' · ' + songs.length + '곡',
      rows: songs.map(function (s) { return { name: SS.names[s.name], n: s.n, unit: '회' }; }),
      onRow: function (k) { if (songs[k]) songSheet(songs[k].name); } });
    return;
  }
  YC.sheet('<div class="yc-h"><h3>' + esc(title) + '</h3></div>' +
    '<p class="stsub">' + esc(rangeLabel()) + ' · ' + songs.length + '곡</p>' +
    songs.map(function (s) {
      return '<button type="button" class="srow" onclick="songSheet(\'' + esc(jsq(s.name)) + '\')">' +
        '<span class="sb"><span class="stt">' + esc(SS.names[s.name]) + '</span>' +
        '<span class="trk"><span class="fill" style="width:' + Math.max(3, Math.round(s.n / max * 100)) + '%"></span></span></span>' +
        '<span class="sn">' + s.n + '<small>회</small></span></button>';
    }).join(''), {});
}

function rangeLabel() {
  return { '3': '최근 3개월', '6': '최근 6개월', '12': '최근 1년', all: '전체 기간' }[SS.range] +
    (SS.kind !== 'all' ? ' · ' + SS.kind : '') + (SS.lead ? ' · 인도 ' + SS.lead : '');
}

function songSheet(c) {
  var mine = statItems().filter(function (i) { return i.c === c; });
  var all = SS.items.filter(function (i) { return i.c === c; });
  var lead = {}, ppl = {}, keys = {};
  mine.forEach(function (i) {
    var l = lineup(i.key);
    l.lead.forEach(function (n) { lead[n] = (lead[n] || 0) + 1; });
    l.people.forEach(function (n) { ppl[n] = (ppl[n] || 0) + 1; });
    if (i.mkey) keys[i.mkey] = (keys[i.mkey] || 0) + 1;
  });
  function chips(o, unit) {
    var ks = Object.keys(o).sort(function (a, b) { return o[b] - o[a]; });
    return ks.length ? '<div class="sschips">' + ks.slice(0, 16).map(function (k) {
      return '<span class="ssc">' + esc(dispName(k)) + ' <b>' + o[k] + unit + '</b></span>';
    }).join('') + '</div>' : '<p class="empty" style="margin:4px 0 0;">기록 없음</p>';
  }
  var spells = Object.keys(SS.spell[c] || {});
  var dates = mine.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
  var evs = SS.data.events || {};

  if (window.YNStats) {                                     // 다크 글래스 팝업 (Step 2)
    var top = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, 16); };
    var pairs = function (o, unit) { return top(o).map(function (k) { return [k, o[k] + unit]; }); };
    // 최근 12개월 월별 횟수 (오늘 기준)
    var t0 = dt(SS.data.today), labels = [], values = [], idx = {};
    for (var m = 11; m >= 0; m--) {
      var d0 = new Date(t0.getFullYear(), t0.getMonth() - m, 1), k0 = d0.getFullYear() + '-' + ('0' + (d0.getMonth() + 1)).slice(-2);
      idx[k0] = values.length; labels.push((d0.getMonth() + 1) + '월'); values.push(0);
    }
    all.forEach(function (i) { var k1 = i.date.slice(0, 7); if (idx[k1] != null && i.date <= SS.data.today) values[idx[k1]]++; });
    YNStats.song({
      title: SS.names[c], sub: (SS.teams[c] ? SS.teams[c] + ' · ' : '') + '처음 ' + fmtDate(SS.first[c]),
      tiles: [[mine.length, rangeLabel()], [all.length, '전체 기간']], spark: { labels: labels, values: values },
      groups: (spells.length > 1 ? [{ label: '함께 묶은 표기', chips: spells.map(function (x) { return [x, SS.spell[c][x]]; }) }] : []).concat([
        { label: '인도자', chips: pairs(lead, '회') }, { label: 'KEY', chips: pairs(keys, '회') }, { label: '함께 섬긴 사람', chips: top(ppl).map(function (k) { return [k, ppl[k]]; }) }]),
      dates: dates.map(function (i) {
        var l = lineup(i.key).lead.join(', ');
        return { date: i.date.replace(/-/g, '.'), soon: i.date > SS.data.today,
          meta: (evs[i.key] ? evs[i.key] : '주일') + (i.kind === '결단' ? ' · 결단' : '') + (l ? ' · 인도 ' + l : '') + (i.mkey ? ' · ' + i.mkey : '') };
      })
    });
    return;
  }

  YC.sheet('<div class="yc-h"><h3>' + esc(SS.names[c]) + '</h3></div>' +
    '<p class="stsub">' + (SS.teams[c] ? esc(SS.teams[c]) + ' · ' : '') + '처음 ' + esc(fmtDate(SS.first[c])) + '</p>' +
    '<div class="sstiles sm">' + tile(mine.length, rangeLabel()) + tile(all.length, '전체 기간') + '</div>' +
    (spells.length > 1 ? '<p class="gl2">함께 묶은 표기</p><div class="sschips">' + spells.map(function (s) {
      return '<span class="ssc">' + esc(s) + ' <b>' + SS.spell[c][s] + '</b></span>'; }).join('') + '</div>' : '') +
    '<p class="gl2">인도자</p>' + chips(lead, '회') +
    '<p class="gl2">Key</p>' + chips(keys, '회') +
    '<p class="gl2">함께 섬긴 사람</p>' + chips(ppl, '') +
    '<p class="gl2">부른 날</p>' +
    dates.map(function (i) {
      var l = lineup(i.key).lead.join(', ');
      return '<div class="ssd"><span class="sdd">' + esc(i.date.replace(/-/g, '.')) + (i.date > SS.data.today ? ' <b class="soon">예정</b>' : '') + '</span>' +
        '<span class="sdm">' + (evs[i.key] ? esc(evs[i.key]) : '주일') + (i.kind === '결단' ? ' · 결단' : '') +
          (l ? ' · 인도 ' + esc(l) : '') + (i.mkey ? ' · ' + esc(i.mkey) : '') + '</span></div>';
    }).join(''), {});
}

var AR = { data: null, view: 'date', q: '', year: '', more: 30, songs: null, range: 'now' };

var AR_RANGES = [['now', '최근 3개월 + 다음 주일'], ['up', '다가오는 예배'], ['recent', '최근 3개월'], ['older', '그 이전'], ['all', '전체']];

function arCut() {
  var t = dt(AR.data.today); t.setMonth(t.getMonth() - 3);
  return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
}

function arNext() {
  var today = AR.data.today, best = '';
  AR.data.days.forEach(function (d) { if (d.date > today && (!best || d.date < best)) best = d.date; });
  return best;
}

function arInRange(d) {
  var today = AR.data.today, cut = arCut();
  if (AR.range === 'now') return (d.date <= today && d.date >= cut) || d.date === arNext();
  if (AR.range === 'up') return d.date > today;
  if (AR.range === 'recent') return d.date <= today && d.date >= cut;
  if (AR.range === 'older') return d.date < cut;
  return true;
}

function loadArchive() {
  callServer('worshipArchive', [TOKEN], function (d) { AR.data = d; AR.songs = null; if (TAB === 'archive') render(); }, function (e) {
      if (TAB === 'archive') el('body').innerHTML = '<div class="panel"><p class="empty">' + esc(e.message || '불러오지 못했습니다.') + '</p></div>';
    });
}

function archiveTab() {
  if (!AR.data) {
    return '<div class="panel"><i class="skel line" style="width:50%;"></i><i class="skel line" style="width:85%;"></i>' +
      '<i class="skel line" style="width:65%;"></i></div>';
  }
  var years = {};
  AR.data.days.forEach(function (d) { years[d.date.slice(0, 4)] = 1; });
  var rec = AR.view === 'rec';
  return '<div class="panel libctl">' +
      '<div class="ssf">' +
        '<select onchange="AR.year=this.value;AR.more=30;arRedraw();"><option value="">전체 연도</option>' +
          Object.keys(years).sort().reverse().map(function (y) {
            return '<option value="' + y + '"' + (AR.year === y ? ' selected' : '') + '>' + y + '년</option>';
          }).join('') + '</select>' +
        '<input type="search" placeholder="' + (rec ? '녹음 제목 · 곡 · 올린 사람 검색' : '곡 · 팀 · 파일 이름 검색') + '" value="' + esc(AR.q) + '" oninput="AR.q=this.value;AR.more=30;arRedraw();">' +
      '</div>' +
      '<div class="ssf" style="margin-top:8px;"><div class="seg">' + AR_RANGES.map(function (r) {
          return '<button type="button" class="' + (AR.range === r[0] ? 'on' : '') + '" onclick="AR.range=\'' + r[0] + '\';AR.more=30;render();">' + r[1] + '</button>';
        }).join('') + '</div>' +
        '<button class="btn mini" onclick="arExport()">엑셀로 내려받기</button></div>' +
      '<p class="msg" id="arMsg"></p></div>' +
    '<div id="arBody">' + arBody() + '</div>';
}

function needScript(src, ready, done) {
  if (ready()) return done();
  var t = document.createElement('script');
  t.src = src; t.onload = done; t.onerror = function () { say('arMsg', '파일 도구를 불러오지 못했습니다. 새로고침 후 다시 해주세요.', 'err'); };
  document.head.appendChild(t);
}

function arExport() {
  var head = ['날짜', '예배', '인도자', '곡 제목', '찬양팀', 'Key', '악보 링크'];
  var rows = [], links = [];
  arDays().slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (d) {
    var name = d.event ? d.event.name : '주일예배';
    var songs = d.songs.slice().sort(function (a, b) { return (a.kind === b.kind ? 0 : (a.kind === '결단' ? 1 : -1)) || a.seq - b.seq; });
    var used = {};
    var fileFor = function (title) {
      var t = songNorm(title);
      return d.files.filter(function (f) {
        var fn = songNorm(f.name.replace(/\.[a-z0-9]+$/i, ''));
        return fn && (fn.indexOf(t) !== -1 || t.indexOf(fn) !== -1);
      });
    };
    songs.forEach(function (x, i) {
      var fs = fileFor(x.title); fs.forEach(function (f) { used[f.id] = 1; });
      rows.push([d.date, name + (x.kind === '결단' ? ' (결단)' : ''), d.lead.join(', '), x.title, x.team, x.key, '']);
      links.push(fs);
    });
    // 곡 이름과 이어지지 않은 악보는 그날 첫 줄에 붙입니다
    var rest = d.files.filter(function (f) { return !used[f.id]; });
    if (!songs.length && (rest.length || d.lead.length)) { rows.push([d.date, name, d.lead.join(', '), '', '', '', '']); links.push(rest); }
    else if (rest.length) { var at = rows.length - songs.length; links[at] = (links[at] || []).concat(rest); }
  });
  if (!rows.length) { say('arMsg', '내보낼 콘티가 없습니다.', 'err'); return; }
  rows.forEach(function (r, i) { r[6] = (links[i] || []).map(function (f) { return f.url; }).join('\n'); });
  say('arMsg', '엑셀 파일을 만드는 중…');
  needScript('/vendor/xlsx.mini.min.js', function () { return !!window.XLSX; }, function () {
    try {
      var ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
      rows.forEach(function (r, i) {
        var f = (links[i] || [])[0];
        if (f) { var c = ws[XLSX.utils.encode_cell({ r: i + 1, c: 6 })]; if (c) c.l = { Target: f.url }; }
      });
      ws['!cols'] = [{ wch: 11 }, { wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 6 }, { wch: 48 }];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '콘티');
      var label = (AR_RANGES.filter(function (r) { return r[0] === AR.range; })[0] || ['', '전체'])[1];
      XLSX.writeFile(wb, '찬양콘티_' + label.replace(/\s/g, '') + '_' + D.today + '.xlsx');
      say('arMsg', rows.length + '줄을 엑셀로 내려받았습니다.', 'ok');
    } catch (e) { say('arMsg', '엑셀을 만들지 못했습니다: ' + e.message, 'err'); }
  });
}

function arRedraw() { if (el('arBody')) el('arBody').innerHTML = arBody(); }

function arDays() {
  var q = AR.q ? songNorm(AR.q) : '';
  return AR.data.days.filter(function (d) {
    if (!arInRange(d)) return false;
    if (AR.year && d.date.slice(0, 4) !== AR.year) return false;
    if (!q) return true;
    return d.songs.some(function (s) { return songNorm(s.title).indexOf(q) !== -1 || songNorm(s.team).indexOf(q) !== -1; }) ||
      d.files.some(function (f) { return songNorm(f.name).indexOf(q) !== -1; }) ||
      (d.recs || []).some(function (r) { return songNorm(r.title).indexOf(q) !== -1; }) ||
      (d.event && songNorm(d.event.name).indexOf(q) !== -1);
  });
}

function arTitle(d) {
  return d.event ? esc(d.event.name)
                 : esc(d.date.replace(/-/g, '.')) + ' 주일';
}

function fileChip(f) {
  var pdf = f.pdf != null ? !!f.pdf : /\.pdf$/i.test(f.name);
  return '<a class="afile" href="' + esc(f.url) + '" target="_blank" rel="noopener">' +
    '<span class="ic">' + (pdf ? 'PDF' : 'IMG') + '</span><span class="fn">' + esc(f.name) + '</span></a>';
}

function arBody() {
  var days = arDays();
  if (!days.length) return '<div class="panel"><p class="empty">찾는 기록이 없습니다.</p></div>';
  if (AR.view === 'song') return arSongs(days);
  if (AR.view === 'file') return arFiles(days);
  if (AR.view === 'rec') return arRecs(days);

  // 다가오는 예배(가까운 순) → 지난 예배(최근 순), 전부 이어서 보여줍니다
  var today = AR.data.today;
  var up = days.filter(function (d) { return d.date > today; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  var past = days.filter(function (d) { return d.date <= today; });
  var more = past.length > AR.more;
  return (up.length ? '<p class="seclabel2">다가오는 예배 · ' + up.length + '</p>' + up.map(arCard).join('') : '') +
    (AR.range === 'up' ? '' : '<p class="seclabel2">지난 예배 · ' + past.length + '</p>' +
    (past.length ? past.slice(0, AR.more).map(arCard).join('') : '<div class="panel"><p class="empty">이 기간의 기록이 없습니다.</p></div>')) +
    (more ? '<button class="btn full" style="margin:2px 0 12px;" onclick="AR.more+=20;arRedraw();">더 보기 (' + (past.length - AR.more) + ')</button>' : '');
}

function arCard(d) {
    var sub = [d.event ? fmtRange(d.date, d.date) : '', d.lead.length ? '인도 ' + d.lead.join(', ') : '']
      .filter(function (x) { return x; }).join(' · ');
    return '<div class="panel arday">' +
      '<div class="arh"><div class="art">' + arTitle(d) + '</div>' +
        '<button class="btn mini" onclick="goWeek(\'' + esc(jsq(d.key)) + '\')">열기 &rsaquo;</button></div>' +
      (sub ? '<p class="ars">' + esc(sub) + '</p>' : '') +
      (d.songs.length ? d.songs.map(function (s, i) {
        var yt = ytId(s.link);
        return '<div class="arsong"><span class="no' + (s.kind === '결단' ? ' fin' : '') + '">' + (s.kind === '결단' ? '결' : (i + 1)) + '</span>' +
          '<span class="at">' + esc(s.title) + (s.team ? '<em>' + esc(s.team) + '</em>' : '') + '</span>' +
          ((s.solo || []).length ? '<span class="kb solok">솔로</span>' : '') +
          (s.key ? '<span class="kb">' + esc(s.key) + '</span>' : '') +
          (yt ? '<a class="yt" href="https://www.youtube.com/watch?v=' + esc(yt) + '" target="_blank" rel="noopener" aria-label="YouTube">▶</a>' : '') +
          '</div>';
      }).join('') : (d.files.length ? '<p class="empty" style="margin:6px 0;">콘티 없이 악보만 있습니다.</p>' : '')) +
      (d.files.length ? '<div class="afiles">' + d.files.map(fileChip).join('') + '</div>' : '') +
      ((d.recs || []).length ? '<div class="arrecs">' + d.recs.map(function (r) { return recCard(r, d.key, true); }).join('') + '</div>' : '') +
    '</div>';
}

function arSongs(days) {
  var g = {}, order = [];
  days.forEach(function (d) {
    d.songs.forEach(function (s) {
      var n = songNorm(s.title);
      var c = null;
      for (var i = 0; i < order.length && !c; i++) {
        var o = order[i];
        if (o === n || (n.length >= 5 && o.length >= 5 && lev1(n, o))) c = o;
      }
      if (!c) { c = n; order.push(n); g[c] = { titles: {}, team: '', keys: {}, uses: [], link: '', files: {} }; }
      var x = g[c];
      x.titles[s.title] = (x.titles[s.title] || 0) + 1;
      if (!x.team && s.team) x.team = s.team;
      if (s.key) x.keys[s.key] = (x.keys[s.key] || 0) + 1;
      if (!x.link && ytId(s.link)) x.link = s.link;
      x.uses.push({ key: d.key, date: d.date });
      // 파일 이름에 곡 이름이 들어 있으면 이 곡 악보로 봅니다
      d.files.forEach(function (f) {
        var fn = songNorm(f.name.replace(/\.[a-z0-9]+$/i, ''));
        if (fn.indexOf(c) !== -1 || (fn.length >= 2 && c.indexOf(fn) !== -1)) x.files[f.id] = f;
      });
    });
  });
  var list = order.map(function (c) {
    var x = g[c];
    x.title = Object.keys(x.titles).sort(function (a, b) { return x.titles[b] - x.titles[a] || b.length - a.length; })[0];
    return x;
  }).sort(function (a, b) { return a.title.localeCompare(b.title, 'ko'); });

  var more = list.length > AR.more * 2;
  return '<div class="panel"><p class="ars" style="margin-top:0;">' + list.length + '곡 · 가나다순</p>' +
    list.slice(0, AR.more * 2).map(function (x) {
      var files = Object.keys(x.files).map(function (k) { return x.files[k]; });
      var yt = ytId(x.link);
      return '<div class="arsg">' +
        '<div class="arsgh"><span class="at">' + esc(x.title) + (x.team ? '<em>' + esc(x.team) + '</em>' : '') + '</span>' +
          '<span class="cnt">' + x.uses.length + '회</span></div>' +
        '<div class="arsgm">' +
          Object.keys(x.keys).map(function (k) { return '<span class="kb">' + esc(k) + '</span>'; }).join('') +
          (yt ? '<a class="ytl" href="https://www.youtube.com/watch?v=' + esc(yt) + '" target="_blank" rel="noopener">▶ YouTube</a>' : '') +
        '</div>' +
        (files.length ? '<div class="afiles">' + files.map(fileChip).join('') + '</div>' : '') +
        '<div class="adates">' + x.uses.slice(0, 10).map(function (u) {
          return '<button type="button" onclick="goWeek(\'' + esc(jsq(u.key)) + '\')">' + md(u.date) + '</button>';
        }).join('') + (x.uses.length > 10 ? '<span>외 ' + (x.uses.length - 10) + '번</span>' : '') + '</div>' +
      '</div>';
    }).join('') +
    (more ? '<button class="btn full" style="margin-top:10px;" onclick="AR.more+=12;arRedraw();">더 보기</button>' : '') +
  '</div>';
}

function arRecs(days) {
  var rows = [];
  days.forEach(function (d) { (d.recs || []).forEach(function (r) { rows.push({ d: d, r: r }); }); });
  if (!rows.length) return '<div class="panel"><p class="empty">올라온 녹음이 없습니다.</p></div>';
  var more = rows.length > AR.more;
  return '<div class="panel arrecs"><p class="ars" style="margin-top:0;">녹음 ' + rows.length + '개 · 최근 순</p>' +
    rows.slice(0, AR.more).map(function (x) {
      return '<div class="arrech"><button class="by linkish" onclick="goWeek(\'' + esc(jsq(x.d.key)) + '\')">' +
        (x.d.event ? esc(x.d.event.name) : md(x.d.date) + ' 주일') + ' &rsaquo;</button></div>' + recCard(x.r, x.d.key, true);
    }).join('') +
    (more ? '<button class="btn full" style="margin-top:10px;" onclick="AR.more+=20;arRedraw();">더 보기</button>' : '') +
  '</div>';
}

function arFiles(days) {
  var q = AR.q ? songNorm(AR.q) : '';
  var rows = [];
  days.forEach(function (d) {
    d.files.forEach(function (f) {
      if (q && songNorm(f.name).indexOf(q) === -1 && !d.songs.some(function (s) { return songNorm(s.title).indexOf(q) !== -1; })) return;
      rows.push({ d: d, f: f });
    });
  });
  if (!rows.length) return '<div class="panel"><p class="empty">올라온 악보가 없습니다.</p></div>';
  var more = rows.length > AR.more * 3;
  return '<div class="panel"><p class="ars" style="margin-top:0;">악보 ' + rows.length + '개 · 최근 순</p>' +
    rows.slice(0, AR.more * 3).map(function (r) {
      var pdf = r.f.pdf != null ? !!r.f.pdf : /\.pdf$/i.test(r.f.name);
      return '<div class="fileitem card"><span class="ic">' + (pdf ? 'PDF' : 'IMG') + '</span>' +
        '<a href="' + esc(r.f.url) + '" target="_blank" rel="noopener">' + esc(r.f.name) + '</a>' +
        '<button class="by linkish" onclick="goWeek(\'' + esc(jsq(r.d.key)) + '\')">' +
          (r.d.event ? esc(r.d.event.name) : md(r.d.date)) + (r.f.kind === '결단' ? ' · 결단' : '') + '</button></div>';
    }).join('') +
    (more ? '<button class="btn full" style="margin-top:10px;" onclick="AR.more+=12;arRedraw();">더 보기</button>' : '') +
  '</div>';
}

/* ===== public/worship/repo.js (악보 Repository) ===== */
var RP = { fopen: false, more: 60, data: null, err: '', q: '', key: '', team: '', theme: '', leader: '', sort: 'recent', onlySheet: false, open: {}, sel: {}, kind: '콘티', attach: true, editSong: '', editSheet: '', up: false };

function rpAdd(date, n) { var d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); }

function rpNl(s) { return esc(s).replace(/\n/g, '<br>'); }

function rpDay(d) { var p = String(d || '').split('-'); return p.length === 3 ? (+p[1]) + '/' + (+p[2]) : ''; }

function loadRepo() {
  RP.err = '';
  callServer('worshipRepoSongs', [TOKEN], function (r) { RP.data = r; if (TAB === 'repo') render(); },
    function (e) { RP.err = (e && e.message) || '불러오지 못했습니다.'; if (TAB === 'repo') render(); });
}

function rpSongs() {
  var d = RP.data; if (!d) return [];
  var q = RP.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  var list = d.songs.filter(function (s) {
    if (RP.onlySheet && !s.sheets.length) return false;
    if (RP.key && !(s.keys && s.keys[RP.key]) && !s.sheets.some(function (x) { return x.key === RP.key; })) return false;
    if (RP.team && s.team !== RP.team) return false;
    if (RP.theme && String(s.theme).split(/\s*,\s*/).indexOf(RP.theme) < 0) return false;
    if (RP.leader && !(s.leaders && s.leaders[RP.leader]) && !s.sheets.some(function (x) { return x.leader === RP.leader; })) return false;
    var hay = (s.title + ' ' + s.team + ' ' + s.theme + ' ' + s.memo).toLowerCase();
    return q.every(function (w) { return hay.indexOf(w) >= 0; });
  });
  if (RP.sort === 'title') list.sort(function (a, b) { return a.title.localeCompare(b.title, 'ko'); });
  else if (RP.sort === 'uses') list.sort(function (a, b) { return b.uses - a.uses || String(b.lastDate).localeCompare(a.lastDate); });
  else list.sort(function (a, b) { return String(b.lastDate).localeCompare(String(a.lastDate)) || b.sheets.length - a.sheets.length; });
  return list;
}

function rpOpts(map, cur, all) {
  return '<option value="">' + all + '</option>' + Object.keys(map).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).map(function (k) {
    return '<option value="' + esc(k) + '"' + (cur === k ? ' selected' : '') + '>' + esc(dispName(k)) + '</option>'; }).join('');
}

function rpFilterCount() { return (RP.key ? 1 : 0) + (RP.team ? 1 : 0) + (RP.theme ? 1 : 0) + (RP.leader ? 1 : 0) + (RP.onlySheet ? 1 : 0); }

function repoTab() {
  if (RP.err) return '<div class="panel"><p class="msg err">' + esc(RP.err) + '</p></div>';
  if (!RP.data) return '<div class="panel libctl"><i class="skel line" style="width:50%;"></i><i class="skel line" style="width:85%;"></i></div>';
  var f = RP.data.facets, n = rpFilterCount(), songs = RP.data.songs || [];
  var withSheet = songs.filter(function (x) { return x.sheets.length; }).length;
  var sorts = [['recent', '최근 부른 순'], ['uses', '많이 부른 순'], ['title', '가나다 순']];
  return '<div class="panel libctl">' +
    '<div class="lib-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' +
      '<input type="search" id="rpQ" placeholder="곡 · 원곡팀 · 주제 · 메모 검색" value="' + esc(RP.q) + '" oninput="RP.q=this.value;RP.more=60;rpRedraw();"></div>' +
    '<div class="lib-row"><div class="seg">' + sorts.map(function (x) {
        return '<button type="button" class="' + (RP.sort === x[0] ? 'on' : '') + '" onclick="RP.sort=\'' + x[0] + '\';rpRedraw();rpSortPaint(this);">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<button type="button" class="btn mini lib-fbtn' + (n ? ' on' : '') + '" onclick="RP.fopen=!RP.fopen;render();" aria-expanded="' + (RP.fopen ? 'true' : 'false') + '">필터' + (n ? ' <b>' + n + '</b>' : '') + '</button>' +
      (D.canEdit ? '<button type="button" class="btn mini" onclick="RP.up=!RP.up;render();">＋ 악보 PDF</button>' : '') + '</div>' +
    (RP.fopen ? '<div class="lib-filters">' +
      '<select onchange="RP.key=this.value;rpRedraw();">' + rpOpts(f.keys, RP.key, '모든 Key') + '</select>' +
      '<select onchange="RP.team=this.value;rpRedraw();">' + rpOpts(f.teams, RP.team, '모든 원곡팀') + '</select>' +
      '<select onchange="RP.theme=this.value;rpRedraw();">' + rpOpts(f.themes, RP.theme, '모든 주제') + '</select>' +
      '<select onchange="RP.leader=this.value;rpRedraw();">' + rpOpts(f.leaders, RP.leader, '모든 인도자') + '</select>' +
      '<label class="rp-chk"><input type="checkbox"' + (RP.onlySheet ? ' checked' : '') + ' onchange="RP.onlySheet=this.checked;rpRedraw();"> 악보 있는 곡만</label>' +
      (n ? '<button type="button" class="btn mini" onclick="RP.key=RP.team=RP.theme=RP.leader=\'\';RP.onlySheet=false;render();">필터 지우기</button>' : '') + '</div>' : '') +
    (RP.up && D.canEdit ? rpUpForm() : '') +
    '<p class="lib-sum">전체 <b>' + songs.length + '</b>곡 · 악보 있는 곡 <b>' + withSheet + '</b> · 곡을 눌러 지난 설정 · 악보 · 가사를 보고, 체크해서 이번 주 콘티에 바로 넣을 수 있어요.</p></div>' +
    '<div id="rpDock">' + rpDock() + '</div><div id="rpList">' + rpList() + '</div>';
}

function rpRedraw() { var a = el('rpList'); if (a) a.innerHTML = rpList(); var b = el('rpDock'); if (b) b.innerHTML = rpDock(); }

function rpSortPaint(b) { Array.prototype.forEach.call(b.parentNode.children, function (x) { x.classList.toggle('on', x === b); }); }

function rpDock() {
  var n = Object.keys(RP.sel).length;
  if (!D.canEdit) return '';
  return '<div class="panel rp-dock' + (n ? ' on' : '') + '"><b>' + (n ? n + '곡 선택' : '곡을 체크하면 콘티에 넣을 수 있습니다') + '</b>' +
    '<span class="hint">→ ' + esc(DATE || D.nextWeek || D.thisWeek) + '</span>' +
    '<select onchange="RP.kind=this.value"><option value="콘티"' + (RP.kind === '콘티' ? ' selected' : '') + '>콘티</option><option value="결단"' + (RP.kind === '결단' ? ' selected' : '') + '>결단 찬양</option></select>' +
    '<label class="rp-chk"><input type="checkbox"' + (RP.attach ? ' checked' : '') + ' onchange="RP.attach=this.checked"> 악보도 함께</label>' +
    '<button class="btn" ' + (n ? '' : 'disabled ') + 'onclick="rpUse()">콘티에 넣기</button><p class="msg" id="rpMsg"></p></div>';
}

function rpList() {
  var list = rpSongs();
  if (!list.length) return '<div class="panel"><p class="hint" style="margin:0;">조건에 맞는 곡이 없습니다.</p></div>';
  var shown = list.slice(0, RP.more || 60);
  return '<p class="hint rp-cnt">' + list.length + '곡</p><div class="lib-grid">' + shown.map(rpCard).join('') + '</div>' +
    (list.length > shown.length ? '<button class="btn full" style="margin:10px 0 4px;" onclick="RP.more=(RP.more||60)+60;rpRedraw();">더 보기 (' + (list.length - shown.length) + ')</button>' : '');
}

function rpCard(s) {
  var open = !!RP.open[s.id], l = s.last || {};
  var chips = [];
  if (l.key) chips.push('<span class="lc key">' + esc(l.key) + '</span>');
  if (l.bpm) chips.push('<span class="lc">' + esc(l.bpm) + ' BPM</span>');
  if (s.sheets.length) chips.push('<span class="lc sh">악보 ' + s.sheets.length + '</span>');
  if (s.hasLyrics) chips.push('<span class="lc">가사</span>');
  var mono = String(s.title || '?').replace(/^[^0-9A-Za-z가-힣]+/, '').charAt(0) || '♪';
  var h = '<div class="rp-card lsong' + (open ? ' open' : '') + (RP.sel[s.id] ? ' picked' : '') + '" data-id="' + esc(s.id) + '"><div class="rp-row">' +
    (D.canEdit ? '<label class="lpick" title="콘티에 넣을 곡 고르기"><input type="checkbox" aria-label="선택"' + (RP.sel[s.id] ? ' checked' : '') + ' onchange="rpPick(this)"><i></i></label>' : '') +
    '<button type="button" class="rp-main" onclick="rpToggle(this)" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="lmono" aria-hidden="true">' + esc(mono) + '</span>' +
      '<span class="ltx"><b>' + esc(s.title) + '</b><small>' + ([s.team, s.theme].filter(Boolean).map(esc).join(' · ') || '&nbsp;') + '</small>' +
      '<span class="lchips">' + chips.join('') + '</span></span>' +
      '<span class="luse">' + (s.uses ? '<b>' + s.uses + '</b><small>회 · ' + esc(rpDay(s.lastDate)) + '</small>' : '<small>기록 없음</small>') + '</span>' +
    '</button></div>';
  if (open) h += rpDetail(s);
  return h + '</div>';
}

function rpDetail(s) {
  var h = '<div class="rp-det">';
  if (RP.editSong === s.id) {
    h += '<div class="rp-form"><label>원곡팀<input type="text" id="rpTeam" maxlength="60" value="' + esc(s.team) + '"></label>' +
      '<label>주제 (쉼표로 여러 개)<input type="text" id="rpTheme" maxlength="80" value="' + esc(s.theme) + '"></label>' +
      '<label>메모<input type="text" id="rpMemo" maxlength="200" value="' + esc(s.memo) + '"></label>' +
      '<div class="sv-btns"><button class="btn mini" onclick="rpSongSave(this)">저장</button><button class="btn mini" onclick="RP.editSong=\'\';rpRedraw();">취소</button></div><p class="msg" id="rpEM"></p></div>';
  } else {
    h += '<div class="rp-info">' + (s.memo ? '<p>' + rpNl(s.memo) + '</p>' : '') +
      '<p class="hint">Key: ' + (Object.keys(s.keys).map(function (k) { return esc(k) + '(' + s.keys[k] + ')'; }).join(' ') || '—') +
      ' · 인도자: ' + (Object.keys(s.leaders).map(function (k) { return esc(dispName(k)) + '(' + s.leaders[k] + ')'; }).join(' ') || '—') + '</p>' +
      (D.canEdit ? '<button class="btn mini" onclick="rpEditSong(this)">원곡팀 · 주제 · 메모 고치기</button>' : '') + '</div>';
  }
  if (s.sheets.length) {
    h += '<div class="sv-sub">악보 PDF</div>' + s.sheets.map(function (x) {
      if (RP.editSheet === x.id) {
        return '<div class="rp-form" data-sid="' + esc(x.id) + '"><div class="rp-g">' +
          '<label>Key<input type="text" data-f="key" maxlength="8" value="' + esc(x.key) + '"></label>' +
          '<label>BPM<input type="number" data-f="bpm" min="0" max="300" value="' + (x.bpm || '') + '"></label>' +
          '<label>날짜<input type="date" data-f="date" value="' + esc(x.date) + '"></label>' +
          '<label>인도자<input type="text" data-f="leader" maxlength="30" value="' + esc(x.leader) + '"></label>' +
          '<label class="w2">메모<input type="text" data-f="note" maxlength="200" value="' + esc(x.note) + '"></label></div>' +
          '<div class="sv-btns"><button class="btn mini" onclick="rpSheetSave(this)">저장</button><button class="btn mini" onclick="RP.editSheet=\'\';rpRedraw();">취소</button></div><p class="msg"></p></div>';
      }
      return '<div class="rp-sh" data-sid="' + esc(x.id) + '"><a target="_blank" rel="noopener" href="' + esc(x.url) + '">📄 ' + esc(x.name || x.title) + '</a>' +
        '<small>' + [x.key && 'Key ' + x.key, x.bpm && 'BPM ' + x.bpm, x.date && rpDay(x.date), dispList(x.leader), x.range ? x.range + '쪽' : (x.pages && x.pages + '쪽'), x.note].filter(Boolean).map(esc).join(' · ') + '</small>' +
        (D.canEdit ? '<button class="btn mini" onclick="rpEditSheet(this)">정보 고치기</button>' : '') + '</div>';
    }).join('');
  } else h += '<p class="hint">올려 둔 악보 PDF가 없습니다.</p>';
  if (s.history.length) {
    h += '<div class="sv-sub">지난 콘티 기록</div><div class="rp-hist">' + s.history.slice(0, 10).map(function (x) {
      var solo = (x.solo || []).map(function (y) { return (y.name || '') + (y.part ? '(' + y.part + ')' : ''); }).join(', ');
      return '<div class="rp-h"><b>' + esc(x.date) + '</b><span>' + [x.kind === '결단' && '결단', x.key && 'Key ' + x.key, x.bpm && 'BPM ' + x.bpm, x.form, solo && '솔로 ' + solo, x.leader && '인도 ' + dispList(x.leader)].filter(Boolean).map(esc).join(' · ') + '</span>' +
        (x.note ? '<em>' + esc(x.note) + '</em>' : '') + (x.link ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(x.link) + '">▶ 링크</a>' : '') + '</div>';
    }).join('') + '</div>';
  }
  return h + '</div>';
}

function rpId(node) { var c = node.closest('[data-id]'); return c ? c.getAttribute('data-id') : ''; }

function rpSong(id) { return (RP.data.songs || []).filter(function (s) { return s.id === id; })[0]; }

function rpToggle(b) { var id = rpId(b); RP.open[id] = !RP.open[id]; RP.editSong = ''; RP.editSheet = ''; rpRedraw(); }

function rpPick(c) { var id = rpId(c); if (c.checked) RP.sel[id] = 1; else delete RP.sel[id]; var cd = c.closest('.rp-card'); if (cd) cd.classList.toggle('picked', c.checked); var b = el('rpDock'); if (b) b.innerHTML = rpDock(); }

function rpEditSong(b) { RP.editSong = rpId(b); rpRedraw(); }

function rpEditSheet(b) { RP.editSheet = b.closest('[data-sid]').getAttribute('data-sid'); rpRedraw(); }

function rpSongSave(b) {
  var id = rpId(b), s = rpSong(id); b.disabled = true;
  callServer('worshipRepoSongSave', [TOKEN, { title: s.title, team: el('rpTeam').value, theme: el('rpTheme').value, memo: el('rpMemo').value }],
    function () { RP.editSong = ''; loadRepo(); }, function (e) { b.disabled = false; say('rpEM', (e && e.message) || '저장하지 못했습니다.', 'err'); });
}

function rpSheetSave(b) {
  var f = b.closest('[data-sid]'), id = f.getAttribute('data-sid'), v = {};
  Array.prototype.forEach.call(f.querySelectorAll('[data-f]'), function (i) { v[i.getAttribute('data-f')] = i.value; });
  b.disabled = true; var m = f.querySelector('.msg');
  callServer('worshipRepoEdit', [TOKEN, id, v], function () { RP.editSheet = ''; loadRepo(); },
    function (e) { b.disabled = false; if (m) { m.className = 'msg err'; m.textContent = (e && e.message) || '저장하지 못했습니다.'; } });
}

function rpUse() {
  var ids = Object.keys(RP.sel), titles = ids.map(function (i) { var s = rpSong(i); return s ? s.title : ''; }).filter(Boolean);
  if (!titles.length) return;
  var date = DATE || D.nextWeek || D.thisWeek;
  say('rpMsg', '넣는 중…');
  callServer('worshipRepoSongUse', [TOKEN, date, RP.kind, titles, !!RP.attach], function (r) {
    RP.sel = {};
    say('rpMsg', titles.length + '곡을 ' + date + ' ' + RP.kind + '에 넣었습니다' + (r.sheets ? ' (악보 ' + r.sheets + '개 포함)' : '') + ' — 예배콘티 탭에서 확인하세요.', 'ok');
    var b = el('rpList'); if (b) b.innerHTML = rpList();
    try { callServer('getWorshipWeek', [TOKEN, date], function (w) { if (typeof apply === 'function') apply(w); }, function () {}); } catch (e) {}
  }, function (e) { say('rpMsg', (e && e.message) || '넣지 못했습니다.', 'err'); });
}

function rpUpForm() {
  return '<div class="rp-form"><div class="rp-g"><label class="w2">PDF 파일<input type="file" id="rpFile" accept="application/pdf,.pdf"></label>' +
    '<label>곡 제목<input type="text" id="rpUT" maxlength="80"></label><label>Key<input type="text" id="rpUK" maxlength="8"></label>' +
    '<label>날짜<input type="date" id="rpUD" value="' + esc(DATE || D.nextWeek || '') + '"></label><label>인도자<input type="text" id="rpUL" maxlength="30"></label>' +
    '<label>BPM<input type="number" id="rpUB" min="0" max="300"></label><label>쪽수<input type="number" id="rpUP" min="0" max="99"></label>' +
    '<label class="w2">메모<input type="text" id="rpUN" maxlength="200"></label></div>' +
    '<div class="sv-btns"><button class="btn" onclick="rpUpload(this)">올리기</button></div><p class="msg" id="rpUM"></p></div>';
}

function rpUpload(b) {
  var f = el('rpFile').files[0], t = el('rpUT').value.trim();
  if (!f) return say('rpUM', 'PDF 파일을 골라주세요.', 'err');
  if (!t) return say('rpUM', '곡 제목을 적어주세요.', 'err');
  if (f.size > 12 * 1048576) return say('rpUM', 'PDF 가 너무 큽니다 (12MB 이하).', 'err');
  b.disabled = true; say('rpUM', '올리는 중…');
  var rd = new FileReader();
  rd.onerror = function () { b.disabled = false; say('rpUM', '파일을 읽지 못했습니다.', 'err'); };
  rd.onload = function () {
    callServer('worshipRepoSave', [TOKEN, { title: t, date: el('rpUD').value, leader: el('rpUL').value.trim(), key: el('rpUK').value.trim(), bpm: el('rpUB').value,
      pages: el('rpUP').value, note: el('rpUN').value.trim(), source: f.name }, rd.result], function () { RP.up = false; loadRepo(); },
      function (e) { b.disabled = false; say('rpUM', (e && e.message) || '올리지 못했습니다.', 'err'); });
  };
  rd.readAsDataURL(f);
}
