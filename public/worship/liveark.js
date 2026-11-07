/**
 * liveark.js — 라이브 악보 Ark (2026-11 시안) 덧붙임 기능
 *
 *  YNLiveArk.mount(P)   ← practice.js 가 떠 있는 창 · 클릭 바를 만든 뒤 부릅니다 (P = 연습 화면이 패널에 주는 통로)
 *
 *  · 메시지 보내기 (P.liveMsg)  찬양팀 전체 · 방송팀 · 나(기록만)에게 짧은 메시지 — 모니터 요청(채널 + 키워/줄여 …) · 자주 쓰는 말 · 직접 입력.
 *                               서버 logic/livemsg.js 가 저장하고 같은 방(웹소켓 'livemsg')에 알립니다. 받는 화면은 오른쪽 위에 카드로 띄웁니다.
 *  · 연습 녹음 (P.liveRec)      이 기기의 마이크로 연습을 녹음 → 바로 듣기 · 파일로 저장 (서버에 올리지 않음)
 *  · 곡 고르기 팝업            위 막대 「♫ 자동 · 1. 곡」 을 누르면 콘티 곡 목록 (자동 / 직접 고르기) — 기존 목록(select)을 그대로 움직입니다
 *  · 휴대폰 아래 막대 · 패널 빠른 줄   페이지 넘기기 · BPM · 클릭 · 키 (기존 단추와 같은 동작)
 *
 *  모두 덤입니다 — 여기서 실패해도 악보 · 필기 · 실시간은 그대로 동작합니다.
 */
(function (root) {
  'use strict';
  var doc = root.document;
  function I(n) { return root.YNIcon ? root.YNIcon.get(n) : ''; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return root.localStorage.getItem('yn.pv.' + k); root.localStorage.setItem('yn.pv.' + k, v); } catch (e) { /* 저장이 막힌 브라우저 */ } return null; }
  function ago(t) { var s = Math.max(0, Math.round((Date.now() - (+t || 0)) / 1000)); return s < 45 ? '방금' : s < 3600 ? Math.round(s / 60) + '분 전' : s < 86400 ? Math.round(s / 3600) + '시간 전' : Math.round(s / 86400) + '일 전'; }
  function call(P, fn, args) {
    var o = P.opts || {};
    if (o.callServer) return new Promise(function (res, rej) { o.callServer(fn, args, res, function (e) { rej(e instanceof Error ? e : new Error((e && e.message) || String(e || '요청하지 못했어요.'))); }); });
    return root.fetch('/api/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: args }), credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || '요청하지 못했어요.'); return j.result; });
  }
  /** 창 안에서 누른 것이 악보 · 단축키로 새지 않게 */
  function guard(node) {
    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'wheel'].forEach(function (k) { node.addEventListener(k, function (e) { e.stopPropagation(); }, { passive: true }); });
    node.addEventListener('keydown', function (e) { if (e.key !== 'Escape') e.stopPropagation(); });
  }

  var TO = [['all', '찬양팀 전체', '라이브 악보'], ['bcast', '방송팀', '방송팀 화면'], ['me', '나', '기록만']];
  var TO_LABEL = { all: '찬양팀 전체', bcast: '방송팀', me: '나' };
  var CHANNELS = ['인도자', '남성싱어', '여성싱어', '피아노', '신디', '일렉', '어쿠', '베이스', '드럼', '클릭', '토크백'];
  var ACTS = ['키워', '줄여', '올려', '내려'];
  var PHRASES = ['발코니 TV 가사 켜 주세요.', '자막 넘겨 주세요.', '클릭 줄여 주세요.', '무선마이크 확인'];

  /* ============================================================ 메시지 */
  function mountMsg(P) {
    var el = P.el, btn = el.querySelector('.pv-msgbtn'), badge = btn ? btn.querySelector('.pv-msgn') : null;
    var st = { to: 'all', chan: '', act: '', text: '', items: null, me: '', unread: 0, view: 'send', busy: false, sent: {} };
    var back = null, card = null, cardT = 0;
    function myName() { var rt = P.rt && P.rt(); return (rt && rt.me && rt.me.name) || st.me || ''; }
    function soundOn() { return ls('msgsnd') !== '0'; }
    function composed() {
      var t = String(st.text || '').trim(); if (t) return t;
      if (st.chan && st.act) return st.chan + ' ' + st.act + ' 주세요.';
      return '';
    }
    function setBadge() { if (badge) badge.textContent = st.unread ? String(Math.min(st.unread, 9)) : ''; }
    function load() {
      if (!P.opts.token || !P.opts.room) return Promise.resolve(null);
      return call(P, 'liveMsgList', [P.opts.token, P.opts.room]).then(function (r) { st.items = (r && r.items) || []; st.me = (r && r.me) || st.me; if (back) paint(); return r; }, function () { if (!st.items) st.items = []; if (back) paint(); });
    }
    function paint() {
      if (!back) return;
      var box = back.querySelector('.ak-mbody');
      if (st.view === 'log') {
        var list = st.items || [];
        box.innerHTML = '<div class="ak-mlog">' + (st.items == null ? '<p class="ak-mnote">불러오는 중…</p>' : list.length ? list.map(function (x) {
          return '<div class="ak-mlrow"><span class="ak-av">' + h(String(x.by || '?').slice(0, 1)) + '</span><div><b>' + h(x.by) + ' <i>→ ' + h(TO_LABEL[x.to] || '') + '</i></b><span>' + h(x.text) + '</span></div><small>' + h(ago(x.at)) + '</small></div>';
        }).join('') : '<p class="ak-mnote">아직 오늘 주고받은 메시지가 없어요.</p>') + '</div>' +
          '<div class="ak-mfoot"><button type="button" class="ak-link" data-k="back">‹ 메시지 쓰기</button></div>';
        return;
      }
      var msg = composed();
      box.innerHTML =
        '<div class="ak-mlbl">받는 곳</div>' +
        '<div class="ak-seg3" role="radiogroup" aria-label="받는 곳">' + TO.map(function (t) { return '<button type="button" role="radio" aria-checked="' + (st.to === t[0]) + '" class="' + (st.to === t[0] ? 'on' : '') + '" data-to="' + t[0] + '">' + h(t[1]) + '<small>' + h(t[2]) + '</small></button>'; }).join('') + '</div>' +
        '<div class="ak-mlbl">모니터 요청 · 채널</div>' +
        '<div class="ak-chips">' + CHANNELS.map(function (c) { return '<button type="button" class="ak-chip' + (st.chan === c ? ' on' : '') + '" data-ch="' + h(c) + '" aria-pressed="' + (st.chan === c) + '">' + h(c) + '</button>'; }).join('') + '</div>' +
        '<div class="ak-chips ak-acts">' + ACTS.map(function (a) { return '<button type="button" class="ak-chip' + (st.act === a ? ' o' : '') + '" data-act="' + a + '" aria-pressed="' + (st.act === a) + '">' + a + '</button>'; }).join('') + '<span class="ak-mhint">채널을 고르고 키워 · 줄여를 누르세요</span></div>' +
        '<div class="ak-mprev' + (msg ? '' : ' empty') + '" aria-live="polite">' + (msg ? '→ ' + h(TO_LABEL[st.to]) + ' · <b>「' + h(msg) + '」</b>' : '보낼 말을 고르거나 적어 주세요') + '</div>' +
        '<div class="ak-mlbl">자주 쓰는 말</div>' +
        '<div class="ak-chips">' + phrases().map(function (p) { return '<button type="button" class="ak-chip" data-ph="' + h(p) + '">' + h(p) + '</button>'; }).join('') + '</div>' +
        '<form class="ak-msend" autocomplete="off"><input type="text" class="ak-min" maxlength="140" placeholder="직접 입력" aria-label="직접 입력" value="' + h(st.text) + '" enterkeyhint="send"><button type="submit" class="ak-go"' + (st.busy ? ' disabled' : '') + '>' + I('send') + (st.busy ? '보내는 중…' : '보내기') + '</button></form>' +
        '<div class="ak-mfoot"><button type="button" class="ak-link" data-k="log">받은 요청 기록 · ' + (st.items ? st.items.length : '…') + '</button>' +
          '<button type="button" class="ak-link" data-k="snd" aria-pressed="' + soundOn() + '">요청이 올 때 소리 ' + (soundOn() ? '켬' : '끔') + '</button></div>';
    }
    function phrases() { var mine = []; try { mine = JSON.parse(ls('msgrec') || '[]') || []; } catch (e) { mine = []; } return mine.concat(PHRASES).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 8); }
    function remember(t) { if (PHRASES.indexOf(t) >= 0 || t.length > 40) return; var mine = []; try { mine = JSON.parse(ls('msgrec') || '[]') || []; } catch (e) { mine = []; } mine = [t].concat(mine.filter(function (x) { return x !== t; })).slice(0, 4); ls('msgrec', JSON.stringify(mine)); }
    function open() {
      if (back) { close(); return; }
      st.view = 'send'; st.unread = 0; setBadge();
      back = doc.createElement('div'); back.className = 'ak-modal'; back.setAttribute('role', 'presentation');
      back.innerHTML = '<section class="ak-mbox" role="dialog" aria-modal="true" aria-labelledby="akMsgT"><header class="ak-mh">' + I('msg') + '<b id="akMsgT">찬양팀에 메시지 보내기</b><button type="button" class="ak-x" data-k="x" aria-label="닫기">' + I('close') + '</button></header><div class="ak-mbody"></div></section>';
      guard(back);
      back.addEventListener('click', onClick); back.addEventListener('input', onInput); back.addEventListener('submit', onSubmit);
      back.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
      el.appendChild(back); if (btn) btn.setAttribute('aria-pressed', 'true');
      paint(); load();
      try { back.querySelector('.ak-x').focus({ preventScroll: true }); } catch (e) { /* 덤 */ }
    }
    function close() { if (back && back.parentNode) back.parentNode.removeChild(back); back = null; if (btn) { btn.setAttribute('aria-pressed', 'false'); try { btn.focus({ preventScroll: true }); } catch (e) { /* 덤 */ } } }
    function onInput(e) { if (e.target && e.target.classList.contains('ak-min')) { st.text = e.target.value; var pv = back.querySelector('.ak-mprev'), m = composed(); pv.className = 'ak-mprev' + (m ? '' : ' empty'); pv.innerHTML = m ? '→ ' + h(TO_LABEL[st.to]) + ' · <b>「' + h(m) + '」</b>' : '보낼 말을 고르거나 적어 주세요'; } }
    function onClick(e) {
      if (e.target === back) { close(); return; }
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.type === 'submit') return;
      var k = b.getAttribute('data-k');
      if (k === 'x') { close(); return; }
      if (k === 'log') { st.view = 'log'; paint(); load(); return; }
      if (k === 'back') { st.view = 'send'; paint(); return; }
      if (k === 'snd') { ls('msgsnd', soundOn() ? '0' : '1'); paint(); return; }
      if (b.hasAttribute('data-to')) { st.to = b.getAttribute('data-to'); }
      else if (b.hasAttribute('data-ch')) { var c = b.getAttribute('data-ch'); st.chan = st.chan === c ? '' : c; st.text = ''; if (!st.act && st.chan) st.act = '키워'; }
      else if (b.hasAttribute('data-act')) { var a = b.getAttribute('data-act'); st.act = st.act === a ? '' : a; st.text = ''; }
      else if (b.hasAttribute('data-ph')) { st.text = b.getAttribute('data-ph'); st.chan = ''; st.act = ''; }
      else return;
      paint();
    }
    function onSubmit(e) {
      e.preventDefault(); if (st.busy) return;
      var t = composed(); if (!t) { P.toast('보낼 말을 고르거나 적어 주세요.', true, 1800); return; }
      if (!P.opts.token || !P.opts.room) { P.toast('이 화면에서는 메시지를 보낼 수 없어요.', true); return; }
      st.busy = true; paint();
      call(P, 'liveMsgSend', [P.opts.token, P.opts.room, { to: st.to, text: t }]).then(function (r) {
        st.busy = false; if (st.text) remember(st.text);
        if (r && r.item) { st.sent[r.item.id] = 1; if (r.item.by) st.me = r.item.by; st.items = [r.item].concat((st.items || []).filter(function (x) { return x.id !== r.item.id; })); }
        st.text = ''; st.chan = ''; st.act = '';
        var who = r && r.toLabel ? r.toLabel : TO_LABEL[st.to];
        P.toast(st.to === 'me' ? '기록해 두었어요' : (who + '에 보냈어요' + (r && r.recipients === 0 ? ' (편성된 방송팀이 없어요)' : '')), false, 1800);
        close();
      }, function (er) { st.busy = false; paint(); P.toast((er && er.message) || '보내지 못했어요.', true); });
    }
    /* ---- 받기 ---- */
    function beep() {
      try {
        var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
        var ac = beep.ac || (beep.ac = new AC()), t = ac.currentTime;
        [0, 0.16].forEach(function (d, i) { var o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = i ? 1175 : 880; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.14); o.connect(g); g.connect(ac.destination); o.start(t + d); o.stop(t + d + 0.16); });
      } catch (e) { /* 소리는 덤 */ }
    }
    function show(item) {
      if (!card) { card = doc.createElement('button'); card.type = 'button'; card.className = 'ak-msgcard'; card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite'); guard(card); card.addEventListener('click', function () { hide(); open(); }); el.appendChild(card); }
      card.innerHTML = '<small>' + h(item.by || '') + ' → ' + h(TO_LABEL[item.to] || '찬양팀') + ' · ' + h(ago(item.at)) + '</small><b>' + h(item.text) + '</b>';
      card.hidden = false; card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
      clearTimeout(cardT); cardT = setTimeout(hide, 9000);
    }
    function hide() { clearTimeout(cardT); if (card) card.hidden = true; }
    function onLive(item) {
      if (!item || !item.text || (P.opts.room && item.room && item.room !== P.opts.room)) return;
      var me = myName();
      if (st.items && !st.items.some(function (x) { return x.id === item.id; })) st.items.unshift(item);
      if (st.sent[item.id] || (me && item.by === me)) return;                    // 내가 보낸 것 (웹소켓이 응답보다 먼저 와도 아래 이름으로 걸러짐)
      if (item.to === 'bcast' && (!me || (item.names || []).indexOf(me) < 0)) return;      // 방송팀에게만 간 것
      if (item.to === 'me') return;
      show(item); if (soundOn()) beep();
      if (!back) { st.unread++; setBadge(); } else paint();
    }
    var hooked = null;
    function hook() { var rt = P.rt && P.rt(); if (!rt || rt === hooked) return; hooked = rt; rt.on('livemsg', onLive); }
    hook(); P.on('joined', hook); P.on('conn', hook);
    P.on('close', function () { close(); hide(); if (card && card.parentNode) card.parentNode.removeChild(card); });
    return { open: open, close: close, _onLive: onLive, state: function () { return { to: st.to, unread: st.unread, items: st.items ? st.items.length : null }; } };
  }

  /* ============================================================ 연습 녹음 (이 기기에만) */
  function mountRec(P) {
    var el = P.el, box = null, rec = null, chunks = [], stream = null, t0 = 0, tick = 0, url = '', mime = '';
    function can() { return !!(root.MediaRecorder && root.navigator && root.navigator.mediaDevices && root.navigator.mediaDevices.getUserMedia); }
    function mmss(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function paint(state, msg) {
      if (!box) return;
      var song = (P.song && P.song()) || null;
      box.querySelector('.ak-rb').innerHTML =
        '<div class="ak-rt"><b>' + (state === 'rec' ? '<i class="ak-rdot"></i>녹음 중' : state === 'done' ? '녹음 완료' : '연습 녹음') + '</b><span class="ak-rtime">' + (state === 'rec' ? mmss(Date.now() - t0) : '') + '</span></div>' +
        '<p class="ak-mnote">' + h(msg || (state === 'done' ? '들어 보고 마음에 들면 저장하세요. 저장하지 않으면 닫을 때 사라져요.' : (song ? '「' + song.title + '」 — ' : '') + '이 기기의 마이크로 녹음해요. 서버에 올리지 않아요.')) + '</p>' +
        (state === 'done' && url ? '<audio controls src="' + url + '"></audio>' : '') +
        '<div class="ak-rrow">' + (state === 'rec' ? '<button type="button" class="ak-go" data-r="stop">' + '■ 멈춤</button>'
          : state === 'done' ? '<button type="button" class="ak-btn" data-r="again">다시 녹음</button><button type="button" class="ak-go k" data-r="save">' + I('download') + '저장</button>'
          : '<button type="button" class="ak-go" data-r="start">' + I('rec') + '녹음 시작</button>') + '</div>';
    }
    function open() {
      if (!can()) { P.toast('이 기기 · 브라우저에서는 녹음을 쓸 수 없어요.', true); return; }
      if (box) return;
      box = doc.createElement('section'); box.className = 'ak-rec'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '연습 녹음');
      box.innerHTML = '<header>' + I('rec') + '<b>연습 녹음</b><button type="button" class="ak-x" data-r="x" aria-label="닫기">' + I('close') + '</button></header><div class="ak-rb"></div>';
      guard(box); el.appendChild(box);
      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return; var r = b.getAttribute('data-r');
        if (r === 'x') close(); else if (r === 'start' || r === 'again') start(); else if (r === 'stop') stop(); else if (r === 'save') save();
      });
      paint('idle');
    }
    function start() {
      clean();
      root.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }).then(function (s) {
        if (!box) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; chunks = [];
        var types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', ''];
        mime = ''; for (var i = 0; i < types.length; i++) { if (!types[i] || (root.MediaRecorder.isTypeSupported && root.MediaRecorder.isTypeSupported(types[i]))) { mime = types[i]; break; } }
        rec = mime ? new root.MediaRecorder(s, { mimeType: mime }) : new root.MediaRecorder(s);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () { var b = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }); url = URL.createObjectURL(b); stopStream(); paint('done'); };
        rec.start(1000); t0 = Date.now(); paint('rec');
        clearInterval(tick); tick = setInterval(function () { var tt = box && box.querySelector('.ak-rtime'); if (tt) tt.textContent = mmss(Date.now() - t0); }, 500);
      }, function () { paint('idle', '마이크를 쓸 수 없어요. 브라우저에서 마이크 권한을 허용해 주세요.'); });
    }
    function stop() { clearInterval(tick); try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { stopStream(); paint('idle'); } }
    function stopStream() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } }
    function save() {
      if (!url) return;
      var song = (P.song && P.song()) || null, d = new Date(), ext = /mp4/.test(mime) ? 'm4a' : 'webm';
      var name = ((song && song.title) || '라이브 악보').replace(/[\\/:*?"<>|]/g, '_') + ' 연습 녹음 ' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + '.' + ext;
      var a = doc.createElement('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
      P.toast('녹음을 저장했어요', false, 1600);
    }
    function clean() { clearInterval(tick); stopStream(); if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* 덤 */ } url = ''; } rec = null; chunks = []; }
    function close() { stop(); clean(); if (box && box.parentNode) box.parentNode.removeChild(box); box = null; }
    P.on('close', close);
    return { open: open, close: close };
  }

  /* ============================================================ 곡 고르기 팝업 — 첫 칸(콘티 곡) 을 누르면 콘티 순서 목록 (2026-11) */
  function mountSongPop(P) {
    var el = P.el, ss = el.querySelector('.pv-songsel'), ps = el.querySelector('.pv-pagesongsel');
    if (!ss || !(P.songs || []).length) return null;
    var wrap = doc.createElement('span'); wrap.className = 'ak-sswrap'; ss.parentNode.insertBefore(wrap, ss); wrap.appendChild(ss);
    var pop = doc.createElement('div'); pop.className = 'ak-songpop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '콘티 곡 고르기');
    var hit = doc.createElement('button'); hit.type = 'button'; hit.className = 'ak-pswhit'; hit.setAttribute('aria-label', '콘티 곡 고르기'); hit.setAttribute('aria-haspopup', 'dialog'); hit.tabIndex = -1;
    wrap.appendChild(hit); el.appendChild(pop); guard(pop);
    function kindOf(s) { return s.kind === '결단' ? '결단' : '찬양'; }
    function opt(sel, v) { return !!sel && Array.prototype.some.call(sel.options, function (o) { return o.value === v; }); }
    function paint() {
      var cur = P.songIdx ? P.songIdx() : -1, list = P.songs || [];
      var title = P.opts.roomLabel ? String(P.opts.roomLabel) + ' · 예배콘티' : '예배콘티';
      var sheetSel = el.querySelector('.pv-sheetsel');
      pop.innerHTML = '<div class="ak-sp-h"><b>' + h(title) + '</b><small class="ak-sp-sub">올린 순서 · 곡을 고르면 그 곡의 악보로</small></div>' +
        '<div class="ak-sp-list">' + list.map(function (s, i) {
          var m = [s.key, s.bpm].filter(function (x) { return x; }).join(' · ');
          return '<button type="button" class="ak-sp-row' + (i === cur ? ' on' : '') + '" data-i="' + i + '"' + (i === cur ? ' aria-current="true"' : '') + '><span class="n">' + (i + 1) + '</span><span class="t"><b>' + h(s.title) + '</b><small>' + h(kindOf(s)) + '</small></span><span class="m">' + h(m) + '</span></button>';
        }).join('') + '</div>' +
        '<div class="ak-sp-f">페이지를 넘기면 1번 곡 악보 → 2번 곡 … 순서로 넘어가요' +
          (opt(sheetSel, '__links') ? '<button type="button" data-o="__links">곡별 악보 연결</button>' : '') + (opt(sheetSel, '__pagesong') ? '<button type="button" data-o="__pagesong">이 페이지의 곡</button>' : '') + '</div>';
    }
    function place() {
      var r = wrap.getBoundingClientRect(), er = el.getBoundingClientRect(), w = Math.min(420, er.width - 16);
      pop.style.width = w + 'px'; pop.style.top = Math.round(r.bottom - er.top + 6) + 'px';
      pop.style.left = Math.round(Math.max(8, Math.min(er.width - w - 8, r.left - er.left))) + 'px';
    }
    function fire(sel, v) { if (!sel) return; sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    function open(on) {
      on = on == null ? pop.hidden : !!on;
      if (on) { paint(); place(); }
      pop.hidden = !on; hit.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    hit.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); open(); });
    pop.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
      if (b.dataset.o) { open(false); fire(el.querySelector('.pv-sheetsel'), b.dataset.o); return; }
      if (b.dataset.i != null) { open(false); fire(ss, String(+b.dataset.i)); }
    });
    void ps;
    function outside(e) { if (pop.hidden) return; var t = e.target; if (t && t.closest && (t.closest('.ak-songpop') || t.closest('.ak-sswrap'))) return; open(false); }
    doc.addEventListener('pointerdown', outside, true);
    function onKey(e) { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); open(false); } }
    doc.addEventListener('keydown', onKey, true);
    ['song', 'page', 'sheet', 'songs'].forEach(function (n) { P.on(n, function () { if (!pop.hidden) paint(); }); });
    P.on('close', function () { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', onKey, true); });
    return { open: open };
  }

  /* ============================================================ 휴대폰 아래 막대 · 패널 빠른 줄 */
  function mountPhone(P) {
    var el = P.el, top = el.querySelector('.pv-top');
    var bar = doc.createElement('div'); bar.className = 'ak-pbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '페이지 · 클릭');
    bar.innerHTML = '<button type="button" class="ak-pb" data-a="prev" aria-label="이전 페이지">' + I('prev') + '</button><span class="ak-ppg">1/1</span><button type="button" class="ak-pb" data-a="next" aria-label="다음 페이지">' + I('next') + '</button>' +
      '<span class="ak-sp"></span><button type="button" class="ak-pbpm" aria-label="BPM — 클릭 패널 열기"><b>–</b></button><button type="button" class="ak-pgo" aria-label="클릭 시작 / 멈춤"></button><button type="button" class="ak-pkey" aria-label="키 — 화음 패널 열기">–</button>';
    el.appendChild(bar);
    var conn = doc.createElement('button'); conn.type = 'button'; conn.className = 'pv-b ak-pconn'; conn.setAttribute('aria-label', '함께 — 실시간 연결'); conn.innerHTML = '<i></i>';
    var pb = top && top.querySelector('.pv-panelbtn'); if (top) top.insertBefore(conn, pb || null);
    var quick = doc.createElement('div'); quick.className = 'ak-quick'; quick.setAttribute('role', 'group'); quick.setAttribute('aria-label', '키 · 영상 · 메시지');
    quick.innerHTML = '<button type="button" data-a="ks-down" aria-label="키 반음 내리기">−1</button><button type="button" class="ak-qkey" data-a="ks-reset" aria-label="지금 키">Key</button><button type="button" data-a="ks-up" aria-label="키 반음 올리기">+1</button><button type="button" class="ak-qyt" aria-label="유튜브 참고 영상">' + I('ytv') + '</button><button type="button" data-a="msg" aria-label="메시지 보내기">' + I('msg') + '</button>';
    var side = el.querySelector('.pv-side'); if (side) side.appendChild(quick);
    function metro() { try { return P.metroState ? P.metroState() : null; } catch (e) { return null; } }
    function sync() {
      if (!el.classList.contains('pv-compact')) return;
      var pg = el.querySelector('.pv-pg'), pos = el.querySelector('.ak-pos'), pt = pos ? String(pos.textContent || '').split(' · ')[0] : '';
      bar.querySelector('.ak-ppg').innerHTML = (pt ? '<small>' + h(pt) + '</small>' : '') + h(pg ? pg.textContent.replace(/\s+/g, '') : '');
      var m = metro(), bpm = m && m.bpm ? Math.round(m.bpm) : ((P.song && P.song() && +P.song().bpm) || 0), run = !!(m && m.running);
      bar.querySelector('.ak-pbpm b').textContent = bpm || '–';
      var go = bar.querySelector('.ak-pgo'); go.classList.toggle('on', run); go.innerHTML = run ? '<i class="sq"></i>멈춤' : '<i class="tri"></i>클릭';
      var kl = el.querySelector('.pv-keyctl .pv-kslbl'), kt = kl ? String(kl.textContent || '').replace(/^Key\s*/, '') : '';
      bar.querySelector('.ak-pkey').textContent = kt || '–'; quick.querySelector('.ak-qkey').textContent = kl ? kl.textContent : 'Key';
      var c = el.querySelector('.pv-conn'); conn.className = 'pv-b ak-pconn ' + (c ? c.className.replace(/pv-chip|pv-conn/g, '') : ''); conn.title = c ? c.title : '';
      var yb = el.querySelector('.pv-ytbtn'); quick.querySelector('.ak-qyt').hidden = !yb || yb.style.display === 'none';
    }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.dataset.a) return;       // data-a 는 practice.js 가 처리 (페이지 넘김)
      if (b.classList.contains('ak-pgo')) { var r = P.metroKey ? P.metroKey('toggle') : null; if (r && r.locked) P.toast('다른 분이 클릭 컨트롤 중이에요.', true, 1400); setTimeout(sync, 60); }
      else if (b.classList.contains('ak-pbpm')) P.showTab('metro');
      else if (b.classList.contains('ak-pkey')) P.showTab('harmony');
    });
    conn.addEventListener('click', function () { P.showTab('together'); });
    quick.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('.ak-qyt') : null; if (b) { var yb = el.querySelector('.pv-ytbtn'); if (yb) yb.click(); } });
    ['page', 'sheet', 'song', 'metro', 'conn', 'layout', 'cfg', 'bpmview'].forEach(function (n) { P.on(n, function () { setTimeout(sync, 0); }); });
    var iv = setInterval(sync, 700);
    P.on('close', function () { clearInterval(iv); });
    sync();
    return { sync: sync };
  }

  /* ============================================================ 필기 도구 막대 둘째 줄 (시안 LiveAnno) — 나만 보기 / 팀에 보이기 · 곡에 계속 / 이 날 콘티만 · 저장 상태 */
  function mountToolsRow(P) {
    var row = null;
    function paint() {
      if (!row) return;
      var ly = P.getLayer ? P.getLayer() : 'team', sc = P.getScope ? P.getScope() : 'song', st = P.status ? P.status() : {};
      Array.prototype.forEach.call(row.querySelectorAll('[data-ly]'), function (b) { var on = b.dataset.ly === ly; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      Array.prototype.forEach.call(row.querySelectorAll('[data-sc]'), function (b) { var on = b.dataset.sc === sc; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.disabled = b.dataset.sc === 'date' && !P.opts.room; });
      var s = st.unsent ? '보내는 중 · ' + st.unsent : st.minePending ? '저장 대기 · ' + st.minePending : st.savedAt ? '저장됨 · ' + ago(st.savedAt) : st.conn === 'online' ? '실시간 저장' : '이 기기에 저장';
      row.querySelector('.ak-tsave').textContent = s;
    }
    function attach(host) {
      if (!host || host.querySelector('.ak-trow')) { paint(); return; }
      row = doc.createElement('div'); row.className = 'ak-trow'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', '필기 보이는 곳 · 붙는 곳');
      row.innerHTML = '<button type="button" class="ak-tc" data-ly="mine">' + I('lock') + '나만 보기</button><button type="button" class="ak-tc" data-ly="team">' + I('together') + '팀에 보이기</button><i class="ak-tsep"></i>' +
        '<button type="button" class="ak-tc" data-sc="song">곡에 계속</button><button type="button" class="ak-tc" data-sc="date">이 날 콘티만</button><span class="ak-tsave"></span>';
      row.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return; e.stopPropagation();
        if (b.dataset.ly && P.setLayer) P.setLayer(b.dataset.ly); else if (b.dataset.sc && P.setScope) P.setScope(b.dataset.sc);
        paint();
      });
      host.appendChild(row); paint();
    }
    var tools = P.el.querySelector('.pv-tools'); attach(tools);
    P.on('toolsrender', function (host) { attach(host); });
    ['layer', 'scope', 'sync', 'conn', 'annochange'].forEach(function (n) { P.on(n, function () { setTimeout(paint, 0); }); });
    return { paint: paint };
  }

  function mount(P) {
    if (!P || !P.el) return null;
    var out = {};
    try { P.liveMsg = out.msg = mountMsg(P); } catch (e) { if (root.console) root.console.warn('[liveark msg]', e); }
    try { P.liveRec = out.rec = mountRec(P); } catch (e) { if (root.console) root.console.warn('[liveark rec]', e); }
    try { out.songPop = mountSongPop(P); } catch (e) { if (root.console) root.console.warn('[liveark song]', e); }
    try { out.phone = mountPhone(P); } catch (e) { if (root.console) root.console.warn('[liveark phone]', e); }
    try { out.tools = mountToolsRow(P); } catch (e) { if (root.console) root.console.warn('[liveark tools]', e); }
    return out;
  }

  root.YNLiveArk = { mount: mount, CHANNELS: CHANNELS, PHRASES: PHRASES };
}(typeof window !== 'undefined' ? window : this));
