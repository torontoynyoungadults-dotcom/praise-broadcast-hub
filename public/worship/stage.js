/**
 * 방송팀 화면 — 악보 없이 "지금 곡 · 송폼 · 콘티 순서 · 요청 메시지" 만 아주 크게 (routes/live.js renderStage)
 * ------------------------------------------------------------
 *  · 지금 곡: 라이브 악보의 페이지 컨트롤이 넘기는 곡(nav) · 리드가 콜아웃한 송폼 칸(lead)을 실시간으로 따라갑니다.
 *    아무도 리드하지 않으면 화면에서 곡을 눌러(또는 ◀ ▶) 직접 바꿉니다. 다음 신호가 오면 다시 따라갑니다.
 *  · 송폼: 전체 순서를 늘 보여 주고, 콜아웃(Enter · V/C/B 단축키 · 송폼 칸 누르기)이 오면 그 칸이 깜빡이고 밝게 남습니다.
 *  · 요청 메시지: 찬양팀이 라이브 악보의 [요청]으로 보낸 것(받는 사람 '방송팀')이 화면 위에 크게 뜹니다 — [확인]을 누르면
 *    다른 방송팀 화면에서도 닫히고, 보낸 사람 화면에 "확인했어요" 가 뜹니다. 소리(켜고 끄기) · 진동(되는 기기만).
 *  · 방송팀도 찬양팀 전체 · 한 사람에게 글을 보낼 수 있습니다 (✉ 보내기).
 * 서버 약속: lib/realtime.js (join · nav · lead · cue · msg · msg:ack · songs:changed · song) + /api/worshipSongsOf
 */
(function (root) {
  'use strict';
  var doc = root.document, B = root.__STAGE__ || {};
  var LS = 'ph.stage.';
  function ls(k, v) { try { if (v === undefined) return root.localStorage.getItem(LS + k); root.localStorage.setItem(LS + k, String(v)); } catch (e) {} return null; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hhmm(t) { var d = new Date(t); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  var F = root.YNForm || null;

  /* ---------- 송폼 칸 ↔ 콜아웃 이름 (practice.js 의 CUE_MAP · cueForToken 과 같은 규칙) ---------- */
  var CUE_MAP = { V: 'v1', V1: 'v1', V2: 'v2', V3: 'v3', V4: 'v4', 'C(Voice)': 'cvoice', C: 'c', C2: 'c2', C3: 'c3', PC: 'pc', PC2: 'pc2', B: 'b', B1: 'b', B2: 'b2', Intro: 'intro',
    Itld: 'itld', Inst: 'inst', Out: 'end', End: 'end', Coda: 'end', Vamp: 'vamp', Turn: 'vamp', Solo: 'solo', Break: 'break', Prayer: 'prayer', KeyUp: 'keyup', Tag: 'tag',
    RepC: 'repc', HalfC: 'halfc', LastL: 'lastl', Once: 'once', OneBar: 'onebar', LastC: 'lastc', VOnly: 'vonly', Drums: 'drums', Build: 'build', Down: 'die', Ferm: 'ferm', Slow: 'slow', Hold: 'hold', BigEnd: 'bigend' };
  function cueOfToken(toks, i) {
    var k = String((toks[i] || {}).k || '').trim(); if (!k) return null;
    if (/^v$/i.test(k)) { var n = 1; for (var j = 0; j < i; j++) if (/^v$/i.test(String((toks[j] || {}).k || '').trim())) n++; return 'v' + Math.min(n, 4); }
    var m = k.match(/^v(\d)$/i); if (m) return +m[1] >= 1 && +m[1] <= 4 ? 'v' + m[1] : 'v4';
    if (CUE_MAP[k]) return CUE_MAP[k];
    var low = k.toLowerCase(); for (var key in CUE_MAP) if (key.toLowerCase() === low) return CUE_MAP[key];
    return null;
  }
  /** 콜아웃 이름(c · v2 · repc …)이 송폼의 몇 번째 칸인지 — 지금 칸 다음부터 찾고, 없으면 처음부터 */
  var CUE_ALIAS = { repc: ['c', 'c2', 'c3'], halfc: ['c'], lastc: ['c', 'c2', 'c3'], cvoice: ['c'], v1: ['v1'], c: ['c', 'cvoice'] };
  function tokenForCue(toks, cue, from) {
    cue = String(cue || '').replace(/~m\d+$/, '').toLowerCase(); if (!cue || !toks.length) return -1;
    var want = [cue].concat(CUE_ALIAS[cue] || []), N = toks.length;
    for (var pass = 0; pass < 2; pass++) {
      for (var d = 0; d < N; d++) {
        var i = ((from == null ? -1 : from) + 1 + d) % N, c = cueOfToken(toks, i) || String((toks[i] || {}).k || '').toLowerCase();
        if (pass === 0 ? c === cue : want.indexOf(c) >= 0) return i;
      }
    }
    return -1;
  }
  function tokensOf(s) {
    var f = s && String(s.form || '').trim(); if (!f) return [];
    try { if (F && F.parse) return F.parse(f).filter(function (t) { return t && t.k; }); } catch (e) {}
    return f.split(/\s*[-–>,\/]\s*|\s+/).filter(Boolean).map(function (k) { return { k: k }; });
  }
  function disp(k) { try { return F && F.disp ? F.disp(k) : k; } catch (e) { return k; } }
  function koLabel(t) { if (t.custom) return ''; try { var l = F && F.label ? F.label(t.k, 'ko') : ''; return l && l !== t.k ? l : ''; } catch (e) { return ''; } }
  function kindLabel(s, i, songs) {
    if (!s) return '';
    if (s.kind === '결단') return '설교 후 찬양';
    if (s.kind === '폐회송') return '폐회송';
    var n = songs.filter(function (x) { return x.kind !== '결단' && x.kind !== '폐회송'; }).length;
    return '콘티 ' + (s.seq || i + 1) + ' / ' + n;
  }

  /* ---------- 상태 ---------- */
  var S = {
    songs: Array.isArray(B.songs) ? B.songs : [], cur: 0, fi: -1, src: '', by: '', manual: false,
    msgs: [], log: [], sound: ls('sound') !== '0', unlocked: false, panel: '', lastCue: { k: '', t: 0 }, leadBpm: null
  };
  var rt = null, wake = null, actx = null;

  function callServer(name, args) {
    return fetch('/api/' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ args: args || [] }) })
      .then(function (r) { return r.json(); }).then(function (d) { if (!d || !d.ok) throw new Error((d && d.error) || '처리하지 못했습니다.'); return d.result; });
  }

  /* ---------- 화면 ---------- */
  var el = doc.createElement('div');
  el.className = 'st';
  el.innerHTML =
    '<header class="st-top">' +
      '<a class="st-tb st-back" href="' + h(B.back || '/conti') + '" aria-label="닫기 (예배콘티로)" title="닫기">✕</a>' +
      '<div class="st-ttl"><b>' + h(B.label || '') + '</b><small>' + h(B.team || '') + ' · 방송팀 화면</small></div>' +
      '<span class="st-conn" data-st="conn">연결 중…</span>' +
      '<div class="st-tbs">' +
        '<button type="button" class="st-tb" data-a="send" title="찬양팀에 메시지 보내기"><span aria-hidden="true">✉</span><em> 보내기</em></button>' +
        '<button type="button" class="st-tb" data-a="log" title="받은 요청 기록"><span aria-hidden="true">☰</span><em> 기록</em><i class="st-badge" hidden></i></button>' +
        '<button type="button" class="st-tb" data-a="sound" aria-pressed="false" title="요청이 올 때 소리"></button>' +
        '<button type="button" class="st-tb st-fsb" data-a="fs" title="전체 화면" aria-label="전체 화면">⛶</button>' +
      '</div>' +
    '</header>' +
    '<main class="st-main">' +
      '<section class="st-now" aria-live="polite">' +
        '<div class="st-pos"><span class="st-kind"></span><span class="st-follow"></span></div>' +
        '<h1 class="st-title"></h1>' +
        '<div class="st-meta"></div>' +
        '<div class="st-formwrap"><div class="st-formhd"><b>송폼</b><small class="st-formhint"></small></div><ol class="st-form"></ol></div>' +
        '<div class="st-navs"><button type="button" class="st-nb" data-a="prev">◀ 이전 곡</button><button type="button" class="st-nb" data-a="next">다음 곡 ▶</button></div>' +
      '</section>' +
      '<aside class="st-list"><h2>콘티 순서</h2><ol class="st-songs"></ol></aside>' +
    '</main>' +
    '<div class="st-msgs" aria-live="assertive"></div>' +
    '<div class="st-sheet" hidden></div>' +
    '<div class="st-tap" hidden>화면을 한 번 눌러 주세요 — 요청이 올 때 소리가 나고, 화면이 꺼지지 않아요</div>';
  function $(s) { return el.querySelector(s); }

  function songAt(i) { return S.songs[i] || null; }
  function paintNow() {
    var s = songAt(S.cur), toks = tokensOf(s);
    $('.st-kind').textContent = s ? kindLabel(s, S.cur, S.songs) : (S.songs.length ? '' : '');
    $('.st-follow').textContent = !rt || !rt.online ? '' : S.manual ? '직접 고른 곡' : S.by ? S.by + ' 화면을 따라가는 중' : '';
    var t = $('.st-title');
    t.textContent = s ? (s.title || '제목 없음') : (S.songs.length ? '' : '이 예배에 아직 곡이 없어요');
    var len = t.textContent.length; t.classList.toggle('long', len > 12); t.classList.toggle('xlong', len > 22);
    var bpm = S.leadBpm && S.leadBpm.song === S.cur ? S.leadBpm.bpm : (s && s.bpm);
    $('.st-meta').innerHTML = s ? [
      ['KEY', s.key || '—', ''], ['BPM', bpm || '—', 'bpm'], ['버전', s.team || '—', 'wide']
    ].map(function (m) { return '<div class="st-m ' + m[2] + '"><small>' + m[0] + '</small><b>' + h(m[1]) + '</b></div>'; }).join('') : '';
    $('.st-formhint').textContent = toks.length ? (S.fi >= 0 ? (S.fi + 1) + ' / ' + toks.length + ' 칸' : '콜아웃하면 그 칸이 깜빡여요') : '';
    $('.st-form').innerHTML = toks.length ? toks.map(function (x, i) {
      var ko = koLabel(x), call = F && F.isCall && F.isCall(x.k);
      return '<li class="st-fc' + (i === S.fi ? ' cur' : i < S.fi ? ' done' : '') + (call ? ' call' : '') + '" data-i="' + i + '"><span class="st-fn">' + (i + 1) + '</span><b>' + h(disp(x.k)) + '</b>' +
        (x.rep > 1 ? '<em>×' + x.rep + '</em>' : '') + (x.bars ? '<i>' + x.bars + '마디</i>' : '') + (ko ? '<small>' + h(ko) + '</small>' : '') + '</li>';
    }).join('') : '<li class="st-noform">' + (s ? '송폼이 없는 곡이에요' : '') + '</li>';
    $('.st-navs [data-a="prev"]').disabled = S.cur <= 0;
    $('.st-navs [data-a="next"]').disabled = S.cur >= S.songs.length - 1;
  }
  function paintList() {
    $('.st-songs').innerHTML = S.songs.map(function (s, i) {
      var head = s.kind === '결단' ? '설교 후' : s.kind === '폐회송' ? '폐회송' : String(s.seq || i + 1);
      return '<li><button type="button" class="st-song' + (i === S.cur ? ' on' : i < S.cur ? ' done' : '') + '" data-song="' + i + '"><span class="st-sn">' + h(head) + '</span><span class="st-st"><b>' + h(s.title || '제목 없음') + '</b>' +
        '<small>' + h([s.key ? 'Key ' + s.key : '', s.bpm ? s.bpm + ' BPM' : ''].filter(Boolean).join(' · ')) + '</small></span></button></li>';
    }).join('') || '<li class="st-noform">아직 곡이 없어요</li>';
  }
  function paint() { paintNow(); paintList(); }
  function flash(i) {
    var c = el.querySelector('.st-fc[data-i="' + i + '"]'); if (!c) return;
    c.classList.remove('say'); void c.offsetWidth; c.classList.add('say');
    setTimeout(function () { c.classList.remove('say'); }, 2600);
    try { c.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch (e) {}
  }

  /* ---------- 곡 · 송폼 위치 ---------- */
  function setCur(i, src, by) {
    if (!(i >= 0 && i < S.songs.length)) return;
    var changed = i !== S.cur;
    S.cur = i; if (changed) S.fi = -1;
    S.manual = src === 'manual'; if (src !== 'manual') { S.src = src; S.by = by || S.by; }
    paint();
    if (changed) { var b = el.querySelector('.st-song.on'); try { b && b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
  }
  function fresh(t) { return !!(t && rt && rt.serverNow && Math.abs(rt.serverNow() - t) < 6000); }
  function onLead(st, initial) {
    if (!st) return;
    if (st.song >= 0 && st.song < S.songs.length && st.song !== S.cur) setCur(st.song, 'lead', st.by);
    else if (st.by) { S.by = st.by; S.manual = false; }
    if (st.bpm >= 30 && st.song >= 0) S.leadBpm = { song: st.song, bpm: st.bpm };
    var isFresh = !initial && fresh(st.t);
    if (st.fi >= 0 && st.song === S.cur) {
      var moved = st.fi !== S.fi; S.fi = st.fi; paintNow();
      if (isFresh && moved) flash(S.fi);
    } else if (st.cue && isFresh) cueHit(st.cue);
    else paintNow();
  }
  function cueHit(cue) {
    var t = Date.now(); if (S.lastCue.k === cue && t - S.lastCue.t < 900) return;   // lead · cue 가 같은 콜아웃을 두 번 알려 줄 때
    S.lastCue = { k: cue, t: t };
    var toks = tokensOf(songAt(S.cur)), i = tokenForCue(toks, cue, S.fi);
    if (i < 0) return;
    S.fi = i; paintNow(); flash(i);
  }
  function onNav(n) { if (n && n.song >= 0 && n.song < S.songs.length) setCur(n.song, 'nav', rt && rt.leader ? rt.leader : ''); }

  /* ---------- 요청 메시지 ---------- */
  function isForStage(m) { return m && m.to === 'bc'; }
  function addLog(m) { if (!S.log.some(function (x) { return x.id === m.id; })) S.log.unshift(m); if (S.log.length > 60) S.log.length = 60; paintBadge(); if (S.panel === 'log') drawSheet(); }
  function paintBadge() { var n = S.msgs.length, b = $('.st-badge'); b.hidden = !n; b.textContent = n; }
  function paintMsgs() {
    var box = $('.st-msgs');
    el.classList.toggle('alert', S.msgs.length > 0);
    box.innerHTML = S.msgs.slice(0, 3).map(function (m, k) {
      return '<div class="st-msg' + (k ? ' sm' : '') + '" data-id="' + h(m.id) + '" role="alert"><div class="st-mfrom"><b>' + h(m.from || '') + '</b> <small>' + hhmm(m.t) + (k === 0 && S.msgs.length > 1 ? ' · 대기 ' + S.msgs.length + '개' : '') + '</small></div>' +
        '<div class="st-mtext">' + h(m.text) + '</div><button type="button" class="st-mok" data-ack="' + h(m.id) + '">확인</button></div>';
    }).join('');
    paintBadge();
  }
  function onMsg(m, quiet) {
    if (!m) return;
    addLog(m);
    if (!isForStage(m) || m.ack) return;
    if (S.msgs.some(function (x) { return x.id === m.id; })) return;
    S.msgs.unshift(m); paintMsgs();
    if (!quiet) { beep(); try { if (root.navigator.vibrate) root.navigator.vibrate([120, 60, 120]); } catch (e) {} }
  }
  function onAck(a) {
    if (!a) return;
    S.msgs = S.msgs.filter(function (x) { return x.id !== a.id; });
    S.log.forEach(function (x) { if (x.id === a.id) x.ack = { by: a.by, t: a.t }; });
    paintMsgs(); if (S.panel === 'log') drawSheet();
  }
  function ack(id) {
    onAck({ id: id, by: rt && rt.me ? rt.me.name : '방송팀', t: Date.now() });
    if (rt && rt.online) rt.ackMsg(id).catch(function () {});
  }

  /* 소리 — 화면을 한 번 누른 뒤에만 낼 수 있어요 (브라우저 규칙) */
  function unlock() {
    if (S.unlocked) return; S.unlocked = true; $('.st-tap').hidden = true;
    try { var AC = root.AudioContext || root.webkitAudioContext; if (AC) { actx = actx || new AC(); if (actx.resume) actx.resume(); } } catch (e) {}
    try { if (wake) wake.acquire(); } catch (e) {}
    paintSound();
  }
  function beep() {
    if (!S.sound || !actx) return;
    try {
      var t0 = actx.currentTime;
      [[0, 880], [0.22, 1175]].forEach(function (x) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = x[1]; g.gain.setValueAtTime(0.0001, t0 + x[0]);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + x[0] + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + x[0] + 0.2);
        o.connect(g); g.connect(actx.destination); o.start(t0 + x[0]); o.stop(t0 + x[0] + 0.22);
      });
    } catch (e) {}
  }
  function paintSound() {
    var b = $('[data-a="sound"]');
    b.setAttribute('aria-pressed', S.sound ? 'true' : 'false'); b.classList.toggle('off', !S.sound);
    b.innerHTML = '<span aria-hidden="true">' + (S.sound ? '🔔' : '🔕') + '</span><em> ' + (S.sound ? '소리 켬' : '소리 끔') + '</em>';
  }

  /* ---------- 아래 창 (보내기 · 기록) ---------- */
  function people() {
    var out = [], on = {}, self = rt && rt.me ? rt.me.name : '';
    (rt && rt.peers || []).forEach(function (p) { if (p.name && !p.stage && p.name !== '방송팀' && p.name !== self) on[p.name] = 1; });
    Object.keys(on).forEach(function (n) { out.push({ name: n, on: true }); });
    (B.lineup || []).forEach(function (x) { if (x.name && !on[x.name] && x.name !== self && !out.some(function (o) { return o.name === x.name; })) out.push({ name: x.name, on: false, pos: x.pos }); });
    return out;
  }
  function drawSheet() {
    var sh = $('.st-sheet');
    if (!S.panel) { sh.hidden = true; sh.innerHTML = ''; return; }
    sh.hidden = false;
    if (S.panel === 'send') {
      var to = S.sendTo || 'team';
      var opt = function (v, l, dis) { return '<option value="' + h(v) + '"' + (to === v ? ' selected' : '') + (dis ? ' disabled' : '') + '>' + h(l) + '</option>'; };
      sh.innerHTML = '<div class="st-card"><div class="st-chd"><b>메시지 보내기</b><button type="button" class="st-x" data-a="close" aria-label="닫기">✕</button></div>' +
        '<label class="st-lab">받는 사람<select class="st-in st-to">' + opt('team', '찬양팀 전체 (라이브 악보)') +
          people().map(function (p) { return opt(p.name, p.name + (p.on ? '' : ' — 접속 안 함'), !p.on); }).join('') + '</select></label>' +
        '<textarea class="st-in st-text" rows="3" maxlength="200" placeholder="예) 인도자 마이크 배터리 교체할게요 — 30초만 기다려 주세요"></textarea>' +
        '<button type="button" class="st-send" data-a="dosend">보내기</button><p class="st-sres" role="status"></p></div>';
      var ta = sh.querySelector('.st-text'); if (ta) setTimeout(function () { ta.focus(); }, 30);
    } else {
      sh.innerHTML = '<div class="st-card"><div class="st-chd"><b>받은 요청 · 메시지</b><button type="button" class="st-x" data-a="close" aria-label="닫기">✕</button></div>' +
        (S.log.length ? '<ul class="st-log">' + S.log.map(function (m) {
          var dir = m.to === 'bc' ? '→ 방송팀' : m.to === 'team' ? '→ 찬양팀' : '→ ' + m.to;
          return '<li class="' + (m.ack ? 'ok' : m.to === 'bc' ? 'wait' : '') + '"><div><b>' + h(m.from) + '</b> <small>' + h(dir) + ' · ' + hhmm(m.t) + '</small></div><p>' + h(m.text) + '</p>' +
            (m.ack ? '<small class="st-acked">✓ ' + h(m.ack.by) + ' 확인 ' + hhmm(m.ack.t) + '</small>' : m.to === 'bc' ? '<button type="button" class="st-mok sm" data-ack="' + h(m.id) + '">확인</button>' : '') + '</li>';
        }).join('') + '</ul>' : '<p class="st-empty">아직 받은 요청이 없어요.</p>') + '</div>';
    }
  }
  function doSend() {
    var sh = $('.st-sheet'), ta = sh.querySelector('.st-text'), to = (sh.querySelector('.st-to') || {}).value || 'team', txt = ta ? ta.value.trim() : '', res = sh.querySelector('.st-sres');
    if (!txt) { res.textContent = '보낼 글을 적어 주세요.'; return; }
    if (!rt || !rt.online) { res.textContent = '실시간 연결이 없어 보내지 못했어요.'; return; }
    S.sendTo = to; res.textContent = '보내는 중…';
    rt.sendMsg({ to: to, text: txt, kind: 'free' }).then(function () { res.textContent = '✓ 보냈어요'; ta.value = ''; }, function (e) { res.textContent = '보내지 못했어요: ' + (e && e.message || ''); });
  }

  el.addEventListener('click', function (e) {
    unlock();
    var t = e.target.closest ? e.target.closest('[data-a],[data-song],[data-ack],.st-fc') : null; if (!t) return;
    if (t.hasAttribute('data-ack')) { ack(t.getAttribute('data-ack')); return; }
    if (t.hasAttribute('data-song')) { setCur(+t.getAttribute('data-song'), 'manual'); return; }
    if (t.classList.contains('st-fc')) { S.fi = +t.getAttribute('data-i'); paintNow(); flash(S.fi); return; }   // 방송팀이 직접 위치를 맞출 때 (이 화면에서만)
    var a = t.getAttribute('data-a');
    if (a === 'prev') setCur(S.cur - 1, 'manual');
    else if (a === 'next') setCur(S.cur + 1, 'manual');
    else if (a === 'sound') { S.sound = !S.sound; ls('sound', S.sound ? '1' : '0'); paintSound(); if (S.sound) beep(); }
    else if (a === 'fs') { try { if (doc.fullscreenElement) doc.exitFullscreen(); else doc.documentElement.requestFullscreen(); } catch (x) {} }
    else if (a === 'send' || a === 'log') { S.panel = S.panel === a ? '' : a; drawSheet(); }
    else if (a === 'close') { S.panel = ''; drawSheet(); }
    else if (a === 'dosend') doSend();
  });
  el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.classList.contains('st-text')) doSend(); });
  doc.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Escape' && S.panel) { S.panel = ''; drawSheet(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') setCur(S.cur + 1, 'manual');
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setCur(S.cur - 1, 'manual');
    else if ((e.key === 'Enter' || e.key === ' ') && S.msgs.length) { e.preventDefault(); ack(S.msgs[0].id); }
  });
  doc.addEventListener('pointerdown', unlock, { once: true });

  /* ---------- 연결 ---------- */
  function paintConn() {
    var c = $('[data-st="conn"]'), s = rt ? rt.state : 'unavailable';
    var txt = s === 'online' ? '실시간 연결됨' : s === 'connecting' ? '연결 중…' : s === 'denied' ? '열 수 없음 — 화면을 다시 열어 주세요' : s === 'unavailable' ? '실시간 연결 안 됨' : '연결 끊김 — 다시 연결 중';
    if (s === 'online' && rt.leader) txt += ' · 페이지 컨트롤 ' + rt.leader;
    c.textContent = txt; c.className = 'st-conn ' + (s === 'online' ? 'ok' : s === 'connecting' || s === 'offline' ? 'warn' : 'bad');
    paintNow();
  }
  function refetch() {
    callServer('worshipSongsOf', [B.token, B.room]).then(function (r) {
      var cur = songAt(S.cur), title = cur && cur.title;
      S.songs = (r && r.songs) || [];
      var k = -1; if (title) S.songs.forEach(function (s, i) { if (k < 0 && s.title === title) k = i; });
      if (k >= 0) S.cur = k; else if (S.cur >= S.songs.length) S.cur = Math.max(0, S.songs.length - 1);
      paint();
    }).catch(function () {});
  }
  function connect() {
    if (!root.YNRT || !B.room) { paintConn(); return; }
    rt = root.YNRT.create({ token: B.token, room: B.room, stage: true });
    rt.on('state', paintConn); rt.on('leader', paintConn); rt.on('peers', function () { if (S.panel === 'send' && !$('.st-sheet').contains(doc.activeElement)) drawSheet(); });
    rt.on('joined', function (r) {
      paintConn();
      if (r.nav && r.nav.song >= 0) onNav(r.nav);
      if (r.lead) onLead(r.lead, true);
      (r.msgs || []).forEach(function (m) { onMsg(m, true); });
      if (S.msgs.length) beep();
    });
    rt.on('nav', onNav);
    rt.on('lead', function (st) { onLead(st, false); });
    rt.on('cue', function (c) { if (c && c.label && fresh(c.t)) cueHit(c.label); });
    rt.on('msg', function (m) { onMsg(m, false); });
    rt.on('msg:ack', onAck);
    rt.on('songs:changed', refetch);
    rt.on('song', function (m) {
      if (!m || !m.patch) return;
      S.songs.forEach(function (s) { if (s.kind === m.kind && +s.seq === +m.seq) { if (m.patch.bpm != null) s.bpm = m.patch.bpm; if (m.patch.form != null) s.form = m.patch.form; if (m.patch.link != null) s.link = m.patch.link; } });
      paint();
    });
    rt.connect();
  }

  function boot() {
    var fb = doc.getElementById('stFallback'); if (fb) fb.remove();
    doc.body.appendChild(el);
    if (!(doc.documentElement.requestFullscreen)) $('.st-fsb').style.display = 'none';
    try { wake = root.YNWake ? root.YNWake.create({}) : null; if (wake) wake.acquire(); } catch (e) { wake = null; }
    $('.st-tap').hidden = false;
    paintSound(); paint(); connect(); paintConn();
  }
  root.YNStage = { state: function () { return S; }, rt: function () { return rt; }, tokenForCue: tokenForCue, tokensOf: tokensOf };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
