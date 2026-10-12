/* 라이브러리 — 날짜 하나 자세히 보기 (v12 · church-app 과 praise-broadcast-hub 가 같은 파일을 씁니다)
 *  곡 · 악보의 「지난 콘티 기록」, 아카이브(날짜별 · 곡별)에서 날짜를 누르면 아래에서 시트가 올라와
 *  그날 선 사람(편성) · 콘티(Key · BPM · 송폼 · 솔로 · 설명) · 악보 · 녹음을 한눈에 보여 줍니다.
 *  서버: worshipDayDetail(token, key) — 읽기 전용, 누를 때만 한 번 부르고 잠깐 기억해 둡니다.
 *  허브 전역 TOKEN · D · esc · jsq · callServer · YC · stGroups · face · songNorm · recCard · goWeek 를 씁니다
 *  (praise 는 sheetLink · dispName, church 는 openLibSheet 가 있으면 악보를 라이브 악보로 엽니다). */
var LD = { cache: {}, at: {}, seq: 0, key: '', song: '' };
var LD_TTL = 120000;

function ldName(n) { return typeof dispName === 'function' ? dispName(n) : n; }
function ldNorm(t) { return typeof songNorm === 'function' ? songNorm(t) : String(t || '').replace(/\s+/g, '').toLowerCase(); }
function ldDay(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  if (!m) return String(d || '');
  var w = '일월화수목금토'.charAt(new Date(+m[1], +m[2] - 1, +m[3], 12).getDay());
  return (+m[1]) + '년 ' + (+m[2]) + '월 ' + (+m[3]) + '일 (' + w + ')';
}

/** 버튼에서 — data-k(예배 키) · data-t(곡 제목, 선택) */
function ldOpenBtn(b) { ldOpen(b.getAttribute('data-k'), b.getAttribute('data-t') || ''); }
function ldBtnAttrs(key, title) { return ' data-k="' + esc(key) + '"' + (title ? ' data-t="' + esc(title) + '"' : '') + ' onclick="ldOpenBtn(this)"'; }

function ldOpen(key, song) {
  key = String(key || ''); if (!key) return;
  LD.key = key; LD.song = song || '';
  var seq = ++LD.seq;
  var hit = LD.cache[key] && Date.now() - LD.at[key] < LD_TTL ? LD.cache[key] : null;
  if (hit) { ldShow(hit); return; }
  YC.sheet('<div class="yc-h"><h3>' + esc(/^\d{4}-/.test(key) ? ldDay(key) : '예배 기록') + '</h3></div>' +
    '<div class="ld" aria-busy="true"><i class="skel line" style="width:60%;"></i><i class="skel line" style="width:90%;"></i><i class="skel line" style="width:75%;"></i><i class="skel line" style="width:85%;"></i></div>', {});
  callServer('worshipDayDetail', [TOKEN, key], function (r) {
    LD.cache[key] = r; LD.at[key] = Date.now();
    if (seq === LD.seq) ldShow(r, true);
  }, function (e) {
    if (seq !== LD.seq) return;
    var box = document.querySelector('.yc-sh .ld');
    if (box) box.outerHTML = '<div class="ld"><p class="msg err">' + esc((e && e.message) || '불러오지 못했습니다.') + '</p>' +
      '<button type="button" class="btn mini"' + ldBtnAttrs(key, LD.song) + '>다시 불러오기</button></div>';
  });
}

function ldFileLink(f, key, inner, cls) {
  if (typeof sheetLink === 'function') return sheetLink(f, 'date', inner, cls);                 // praise — 라이브 악보 주소
  if (typeof openLibSheet === 'function' && f.id) {
    return '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(f.url) + '" onclick="event.preventDefault();YC.close(true);openLibSheet(\'' + esc(jsq(f.id)) + '\',\'' + esc(jsq(key)) + '\',\'' + esc(jsq(f.name || '')) + '\')" title="라이브 악보로 열기">' + inner + '</a>';
  }
  return '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(f.href || f.url) + '" target="_blank" rel="noopener">' + inner + '</a>';
}
function ldFileChip(f, key, hot) {
  var pdf = f.pdf != null ? !!f.pdf : !/\.(png|jpe?g|gif|webp|heic)$/i.test(f.name || '');
  return ldFileLink(f, key, '<span class="ic">' + (pdf ? 'PDF' : 'IMG') + '</span><span class="fn">' + esc(f.name) + (f.range ? ' <small>' + esc(f.range) + '쪽</small>' : '') + '</span>', 'afile' + (hot ? ' ld-hot' : ''));
}
function ldYt(link) { var m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/.exec(String(link || '')); return m ? m[1] : ''; }
function ldSolo(a) { return (a || []).map(function (y) { return ldName(y.name || '') + (y.part ? ' (' + y.part + ')' : ''); }).join(', '); }

/** 곡 이름이 들어간 악보 = 그 곡 악보 */
function ldFilesFor(r, title) {
  var t = ldNorm(title);
  if (!t) return [];
  return (r.files || []).filter(function (f) {
    var fn = ldNorm(String(f.name || '').replace(/\.[a-z0-9]+$/i, ''));
    return fn && (fn.indexOf(t) !== -1 || (fn.length >= 2 && t.indexOf(fn) !== -1));
  });
}

function ldShow(r, swapOnly) {
  var key = r.key, want = ldNorm(LD.song);
  var lead = (r.slots && (r.slots.lead || r.slots['인도자'])) || [];      // church: lead · praise: 인도자
  var title = r.event ? '<span class="evtag">' + esc(r.event.kind || '행사') + '</span>' + esc(r.event.name) : esc(ldDay(r.date));
  var sub = [r.event ? ldDay(r.date) : '', r.event && r.event.place, lead.length ? '인도 ' + lead.map(ldName).join(', ') : ''].filter(Boolean);
  var h = '<div class="yc-h"><h3>' + title + '</h3></div>' + (sub.length ? '<p class="stsub ld-sub">' + sub.map(esc).join(' · ') + '</p>' : '') + '<div class="ld">';

  // 1) 고른 곡 — 그날 이 곡은 어떻게 했는지
  var me = want ? (r.songs || []).filter(function (s) { return ldNorm(s.title) === want; })[0] : null;
  if (!me && want) me = (r.songs || []).filter(function (s) { var n = ldNorm(s.title); return n && (n.indexOf(want) !== -1 || want.indexOf(n) !== -1); })[0] || null;
  if (me) {
    var mf = ldFilesFor(r, me.title), yt = ldYt(me.link), solo = ldSolo(me.solo);
    h += '<section class="ld-song"><div class="ld-st"><b>' + esc(me.title) + '</b>' + (me.team ? '<em>' + esc(me.team) + '</em>' : '') + (me.kind === '결단' ? '<span class="kb fin">결단</span>' : '') + '</div>' +
      '<div class="ld-kv">' + [['Key', me.key], ['BPM', me.bpm], ['송폼', me.form], ['솔로', solo]].filter(function (x) { return x[1]; }).map(function (x) {
        return '<span><small>' + x[0] + '</small><b>' + esc(x[1]) + '</b></span>'; }).join('') + '</div>' +
      (me.note ? '<p class="ld-note">' + esc(me.note) + '</p>' : '') +
      ((mf.length || yt) ? '<div class="afiles">' + mf.map(function (f) { return ldFileChip(f, key, true); }).join('') +
        (yt ? '<a class="afile ld-yt" href="https://www.youtube.com/watch?v=' + esc(yt) + '" target="_blank" rel="noopener"><span class="ic">▶</span><span class="fn">YouTube</span></a>' : '') + '</div>' : '') +
      '</section>';
  }

  // 2) 그날 선 사람
  var groups = typeof stGroups === 'function' ? stGroups() : [['편성', (D.positions || [])]];
  var people = groups.map(function (g) {
    var rows = g[1].filter(function (p) { return ((r.slots || {})[p.key] || []).length; }).map(function (p) {
      return '<div class="yc-r"><span class="stpl">' + esc(p.label) + '</span><div class="v">' + r.slots[p.key].map(function (n) {
        return '<span class="nm">' + (typeof face === 'function' ? face(n) : '') + esc(ldName(n)) + '</span>'; }).join(' ') + '</div></div>';
    }).join('');
    return rows ? '<div class="ld-g"><div class="ld-gl">' + esc(g[0]) + '</div>' + rows + '</div>' : '';
  }).join('');
  h += '<div class="sv-sub">그날 선 사람</div>' + (people || '<p class="hint">편성 기록이 없습니다.</p>');

  // 3) 그날 콘티
  if ((r.songs || []).length) {
    var n = 0;
    h += '<div class="sv-sub">그날 콘티 · ' + r.songs.length + '곡</div><div class="ld-list">' + r.songs.map(function (s) {
      var fin = s.kind === '결단', on = me && s === me, yt = ldYt(s.link), solo = ldSolo(s.solo);
      if (!fin) n++;
      var meta = [s.key && 'Key ' + s.key, s.bpm && s.bpm + ' BPM', s.form, solo && '솔로 ' + solo].filter(Boolean);
      return '<div class="arsong ld-row' + (on ? ' on' : '') + '"><span class="no' + (fin ? ' fin' : '') + '">' + (fin ? '결' : n) + '</span>' +
        '<span class="at">' + esc(s.title) + (s.team ? '<em>' + esc(s.team) + '</em>' : '') + (meta.length ? '<small class="ld-meta">' + meta.map(esc).join(' · ') + '</small>' : '') + '</span>' +
        (yt ? '<a class="yt" href="https://www.youtube.com/watch?v=' + esc(yt) + '" target="_blank" rel="noopener" aria-label="YouTube">▶</a>' : '') + '</div>';
    }).join('') + '</div>';
  } else h += '<div class="sv-sub">그날 콘티</div><p class="hint">콘티 기록이 없습니다.</p>';

  // 4) 악보 · 녹음 · 말씀
  if ((r.files || []).length) h += '<div class="sv-sub">그날 악보 · ' + r.files.length + '</div><div class="afiles">' + r.files.map(function (f) { return ldFileChip(f, key, false); }).join('') + '</div>';
  if ((r.recs || []).length && typeof recCard === 'function') h += '<div class="sv-sub">녹음 · ' + r.recs.length + '</div><div class="arrecs">' + r.recs.map(function (x) { return recCard(x, key, true); }).join('') + '</div>';
  if (r.verse) h += '<div class="sv-sub">그 주의 말씀</div><div class="verse"><div class="vq">' + esc(r.verse) + (r.verseTitle ? ' — ' + esc(r.verseTitle) : '') + '</div></div>';

  h += '</div><div class="yc-acts"><button class="btn dark" onclick="YC.close();goWeek(\'' + esc(jsq(key)) + '\')">이 날 예배 준비 열기 &rsaquo;</button></div>';
  var sh = document.querySelector('.yc-ov.on .yc-sh .ld[aria-busy]') || document.querySelector('.yc-ov .yc-sh .ld[aria-busy]');      // 불러오는 중 시트가 떠 있으면 그 자리만 바꿔 (다시 올라오는 깜빡임 없이)
  sh = sh && sh.closest('.yc-sh');
  if (sh) sh.innerHTML = '<div class="yc-grab"></div><button type="button" class="yc-x" onclick="YC.close()" aria-label="닫기">&times;</button>' + h;
  else if (!swapOnly) YC.sheet(h, {});           // 불러오는 사이 시트를 닫았으면 다시 띄우지 않음
  else return;
  try { if (window.YNPlayer && YNPlayer.mark) YNPlayer.mark(); } catch (e) {}
}
