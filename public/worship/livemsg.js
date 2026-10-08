/**
 * 요청 메시지 — 라이브 악보에서 방송팀에 "말 없이" 부탁하기 + 나에게 온 메시지 띄우기
 * ------------------------------------------------------------
 *  · 위 막대의 [요청] 단추 → 아래 창: 싱어 모니터 · 악기(P16) · 자막 · 직접 입력
 *      싱어 모니터  "3번 모니터에서 드럼 볼륨 올려주세요."   (내 모니터 번호는 이 기기에 기억)
 *      악기 P16     "P16 5번 (베이스) 볼륨 키워주세요."     (채널 이름마다 번호를 기억)
 *      자막         "발코니 TV 가사 켜 주세요."
 *      직접 입력    방송팀 · 찬양팀 전체 · 접속한 사람 한 명에게
 *  · 보내면 방송팀 화면(/conti/stage)에 크게 뜨고, 방송팀이 [확인]을 누르면 보낸 사람 화면에 "확인했어요" 가 뜹니다.
 *  · 나에게 온 메시지(이름 · 찬양팀 전체)는 악보 위에 카드로 — [확인]을 누르면 닫히고 보낸 사람에게 알려 줍니다.
 *    방송팀 보기 링크(읽기 전용)로 연 화면은 방송팀이므로 방송팀 앞 요청도 띄웁니다.
 *  · 서버는 lib/realtime.js 의 'msg' · 'msg:ack' (저장하지 않고 방 메모리에 최근 15분만)
 * practice.js 가 YNLiveMsg.attach(P) 를 부릅니다. Node(시험)에서는 글 만드는 함수(compose)만 씁니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.YNLiveMsg = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var doc = root && root.document;

  var INST = ['드럼', '베이스', '일렉', '피아노', '신디', '어쿠', '메트로놈', '토크백'];
  var P16 = ['드럼', '베이스', '일렉', '피아노', '야마하신디', '노드신디', '모조오르간', '어쿠', '포디움 마이크', '무선마이크', '싱어', '메트로놈', '토크백'];
  var SUBS = ['발코니 TV 가사 켜 주세요.'];
  var SINGERS = ['인도자', '남성싱어', '여성싱어', '알토'];
  var MICS = 10;

  /* ---------- 보낼 글 (시험에서도 씀) ---------- */
  function n(v) { v = parseInt(v, 10); return v >= 1 && v <= 99 ? v : 0; }
  var compose = {
    /** target: { t:'mic'|'singer'|'inst', v } */
    mon: function (mon, target, up) {
      if (!n(mon) || !target || !target.v) return '';
      var what = target.t === 'mic' ? n(target.v) + '번 마이크' : String(target.v);
      return n(mon) + '번 모니터에서 ' + what + ' 볼륨 ' + (up ? '올려' : '내려') + '주세요.';
    },
    p16: function (ch, name, up) {
      if (!name) return '';
      return 'P16 ' + (n(ch) ? n(ch) + '번 (' + name + ')' : name) + ' 볼륨 ' + (up ? '키워' : '줄여') + '주세요.';
    }
  };
  if (!root) return { compose: compose, INST: INST, P16: P16, SUBS: SUBS };

  var LS = 'ph.msg.';
  function ls(k, v) {
    try { if (v === undefined) return root.localStorage.getItem(LS + k); if (v === null) root.localStorage.removeItem(LS + k); else root.localStorage.setItem(LS + k, String(v)); } catch (e) { /* 막힌 브라우저 */ }
    return null;
  }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hhmm(t) { var d = new Date(t); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function hon(nm) { try { return root.YNHon ? root.YNHon.name(nm) : nm; } catch (e) { return nm; } }
  var ICON = '<svg class="pv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg>';

  function attach(P) {
    if (!P || !P.el || P.__lm) return null;
    P.__lm = true;
    var el = P.el, opts = P.opts || {}, ro = !!opts.readOnly;
    var lineup = Array.isArray(opts.lineup) ? opts.lineup : [];
    var st = { tab: ls('tab') || 'mon', target: null, p16: ls('p16last') || '', to: 'bc', status: '' };
    if (['mon', 'p16', 'sub', 'free'].indexOf(st.tab) < 0) st.tab = 'mon';
    var mine = {};                                      // 내가 보낸 메시지 id → 글 (확인 알림용)
    var seen = {};                                      // 이미 띄운 받은 메시지
    try { seen = JSON.parse(root.sessionStorage.getItem(LS + 'seen') || '{}') || {}; } catch (e) { seen = {}; }

    function rt() { return P.rt ? P.rt() : null; }
    function me() { var r = rt(); return r && r.me ? r.me.name : String(opts.me || ''); }
    function peers() { var r = rt(); return r && r.peers ? r.peers : []; }
    function stages() { return peers().filter(function (p) { return p.stage || p.name === '방송팀'; }).length; }

    /* ---------- 위 막대 단추 ---------- */
    var btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'pv-b pv-msgbtn'; btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    btn.title = ro ? '찬양팀에 메시지 보내기' : '방송팀에 요청 보내기 (모니터 · P16 · 자막)';
    btn.innerHTML = ICON + '<span class="pv-tx"> 요청</span>';
    var top = el.querySelector('.pv-top'), anchor = el.querySelector('.pv-flts') || el.querySelector('.pv-fsbtn');
    if (top) top.insertBefore(btn, anchor && anchor.parentNode === top ? anchor : null);

    var pop = doc.createElement('div'); pop.className = 'lm-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '요청 메시지');
    var inbox = doc.createElement('div'); inbox.className = 'lm-inbox'; inbox.setAttribute('aria-live', 'assertive');
    el.appendChild(pop); el.appendChild(inbox);

    /* ---------- 받는 사람 목록 ---------- */
    function people() {
      var on = {}, out = [], self = me();
      peers().forEach(function (p) { if (p.name && !p.stage && p.name !== '방송팀' && p.name !== self) on[p.name] = 1; });
      Object.keys(on).forEach(function (nm) { out.push({ name: nm, on: true }); });
      lineup.forEach(function (x) { if (x.name && x.name !== self && !on[x.name] && !out.some(function (o) { return o.name === x.name; })) out.push({ name: x.name, on: false }); });
      return out;
    }
    function singerNames() {
      var out = [];
      lineup.forEach(function (x) { if (SINGERS.indexOf(x.pos) >= 0 && out.indexOf(x.name) < 0) out.push(x.name); });
      return out;
    }

    /* ---------- 창 그리기 ---------- */
    function chip(attr, label, on, extra) { return '<button type="button" class="lm-chip' + (on ? ' on' : '') + (extra || '') + '" ' + attr + '>' + h(label) + '</button>'; }
    function monBody() {
      var mon = ls('mon') || '', t = st.target, sing = singerNames();
      var mics = ''; for (var i = 1; i <= MICS; i++) mics += chip('data-tg="mic" data-v="' + i + '"', i + '번', t && t.t === 'mic' && +t.v === i);
      var prevUp = compose.mon(mon, t, true);
      return '<div class="lm-row"><label class="lm-lab" for="lmMon">내 모니터</label><div class="lm-num"><button type="button" class="lm-step" data-m="mon-" aria-label="번호 줄이기">−</button>' +
          '<input id="lmMon" class="lm-in lm-monin" type="number" inputmode="numeric" min="1" max="99" placeholder="번호" value="' + h(mon) + '"><span class="lm-unit">번</span>' +
          '<button type="button" class="lm-step" data-m="mon+" aria-label="번호 늘리기">+</button></div><small class="lm-hint">처음 한 번만 — 이 기기에 기억해요</small></div>' +
        '<div class="lm-grp"><h5>마이크 번호</h5><div class="lm-chips">' + mics + '</div></div>' +
        '<div class="lm-grp"><h5>싱어</h5><div class="lm-chips">' + (sing.length ? sing.map(function (nm) { return chip('data-tg="singer" data-v="' + h(nm) + '"', hon(nm), t && t.t === 'singer' && t.v === nm); }).join('') : '<span class="lm-empty">이번 주 편성에 싱어가 없어요 — 마이크 번호나 직접 입력을 써 주세요</span>') + '</div></div>' +
        '<div class="lm-grp"><h5>악기</h5><div class="lm-chips">' + INST.map(function (x) { return chip('data-tg="inst" data-v="' + h(x) + '"', x, t && t.t === 'inst' && t.v === x); }).join('') + '</div></div>' +
        '<div class="lm-prev">' + (prevUp ? h(prevUp.replace(/ 올려주세요\.$/, ' …')) : (n(mon) ? '대상을 고르세요' : '먼저 내 모니터 번호를 넣어 주세요')) + '</div>' +
        '<div class="lm-acts"><button type="button" class="lm-go up" data-m="mon-up"' + (prevUp ? '' : ' disabled') + '>▲ 올려주세요</button><button type="button" class="lm-go down" data-m="mon-down"' + (prevUp ? '' : ' disabled') + '>▼ 내려주세요</button></div>';
    }
    function p16Body() {
      var name = st.p16, ch = name ? (ls('p16.' + name) || '') : '';
      var ok = !!compose.p16(ch, name, true);
      return '<div class="lm-grp"><h5>채널 이름</h5><div class="lm-chips">' + P16.map(function (x) { var c = ls('p16.' + x); return chip('data-p16="' + h(x) + '"', x + (c ? ' · ' + c : ''), name === x); }).join('') + '</div></div>' +
        '<div class="lm-row"><label class="lm-lab" for="lmCh">채널 번호</label><div class="lm-num"><button type="button" class="lm-step" data-m="ch-" aria-label="번호 줄이기">−</button>' +
          '<input id="lmCh" class="lm-in lm-chin" type="number" inputmode="numeric" min="1" max="99" placeholder="번호" value="' + h(ch) + '"' + (name ? '' : ' disabled') + '><span class="lm-unit">번</span>' +
          '<button type="button" class="lm-step" data-m="ch+" aria-label="번호 늘리기"' + (name ? '' : ' disabled') + '>+</button></div><small class="lm-hint">채널마다 이 기기에 기억해요</small></div>' +
        '<div class="lm-prev">' + (ok ? h(compose.p16(ch, name, true).replace(/ 키워주세요\.$/, ' …')) : '채널 이름을 고르세요') + '</div>' +
        '<div class="lm-acts"><button type="button" class="lm-go up" data-m="p16-up"' + (ok ? '' : ' disabled') + '>▲ 키워주세요</button><button type="button" class="lm-go down" data-m="p16-down"' + (ok ? '' : ' disabled') + '>▼ 줄여주세요</button></div>';
    }
    function subBody() {
      return '<div class="lm-big">' + SUBS.map(function (x, i) { return '<button type="button" class="lm-go wide" data-sub="' + i + '">' + h(x) + '</button>'; }).join('') + '</div>' +
        '<p class="lm-hint">누르면 바로 방송팀 화면에 떠요.</p>';
    }
    function freeBody() {
      var ppl = people(), recent = [];
      try { recent = JSON.parse(ls('recent') || '[]') || []; } catch (e) { recent = []; }
      var opt = function (v, label, dis) { return '<option value="' + h(v) + '"' + (st.to === v ? ' selected' : '') + (dis ? ' disabled' : '') + '>' + h(label) + '</option>'; };
      return '<div class="lm-row"><label class="lm-lab" for="lmTo">받는 사람</label><select id="lmTo" class="lm-in lm-to">' +
          opt('bc', '방송팀 (방송팀 화면)') + opt('team', '찬양팀 전체 (라이브 악보)') +
          ppl.map(function (p) { return opt(p.name, hon(p.name) + (p.on ? '' : ' — 접속 안 함'), !p.on); }).join('') + '</select></div>' +
        '<textarea class="lm-in lm-text" rows="3" maxlength="200" placeholder="예) 2절부터 인도자 마이크가 작아요"></textarea>' +
        '<div class="lm-acts"><button type="button" class="lm-go wide" data-m="free">보내기</button></div>' +
        (recent.length ? '<div class="lm-grp"><h5>최근 보낸 글 (누르면 다시 보냄)</h5><div class="lm-chips">' + recent.map(function (r, i) { return chip('data-recent="' + i + '"', r.text + (r.to !== 'bc' ? ' → ' + (r.to === 'team' ? '찬양팀' : r.to) : ''), false, ' lm-rc'); }).join('') + '</div></div>' : '');
    }
    var TABS = [['mon', '싱어 모니터'], ['p16', '악기 P16'], ['sub', '자막'], ['free', '직접 입력']];
    function draw() {
      if (pop.hidden) return;
      var ns = stages(), r = rt(), online = !!(r && r.online);
      var conn = !online ? '<span class="lm-conn bad">실시간 연결이 없어요 — 보낼 수 없어요</span>'
        : ns ? '<span class="lm-conn ok">방송팀 화면 ' + ns + '대 연결됨</span>' : '<span class="lm-conn warn">방송팀 화면이 아직 안 열렸어요 (열면 15분 안의 요청이 떠요)</span>';
      var tabs = ro ? [['free', '직접 입력']] : TABS;
      if (ro) st.tab = 'free';
      var body = st.tab === 'p16' ? p16Body() : st.tab === 'sub' ? subBody() : st.tab === 'free' ? freeBody() : monBody();
      pop.innerHTML = '<div class="lm-card"><div class="lm-hd"><b>' + (ro ? '메시지 보내기' : '방송팀에 요청') + '</b>' + conn + '<button type="button" class="lm-x" data-m="close" aria-label="닫기">✕</button></div>' +
        '<div class="lm-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="lm-tab' + (st.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '" aria-selected="' + (st.tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
        '<div class="lm-body">' + body + '</div>' + (st.status ? '<div class="lm-status">' + st.status + '</div>' : '') + '</div>';
    }
    function open(b) {
      pop.hidden = !b; btn.setAttribute('aria-expanded', b ? 'true' : 'false'); btn.classList.toggle('on', !!b);
      if (b) { st.status = ''; draw(); }
    }

    /* ---------- 보내기 ---------- */
    function send(to, text, kind) {
      var r = rt();
      if (!text) return;
      if (!r || !r.online || !r.sendMsg) { P.toast('실시간 연결이 없어 보내지 못했어요. 잠시 후 다시 해 주세요.', true); return; }
      st.status = '<span class="lm-sending">보내는 중… "' + h(text) + '"</span>'; draw();
      r.sendMsg({ to: to, text: text, kind: kind || '' }).then(function (res) {
        var m = res && res.msg; if (m) mine[m.id] = m;
        var who = to === 'bc' ? '방송팀' : to === 'team' ? '찬양팀' : hon(to);
        st.status = '<span class="lm-sent" data-id="' + h(m ? m.id : '') + '">✓ ' + h(who) + '에 보냈어요 — 확인을 기다리는 중 · "' + h(text) + '"</span>'; draw();
        P.toast(who + '에 보냈어요: ' + text, false, 2200);
        if (kind === 'free' || to !== 'bc') {
          var recent = []; try { recent = JSON.parse(ls('recent') || '[]') || []; } catch (e) { recent = []; }
          recent = [{ to: to, text: text }].concat(recent.filter(function (x) { return !(x.text === text && x.to === to); })).slice(0, 6);
          ls('recent', JSON.stringify(recent));
        }
      }, function (e) { st.status = '<span class="lm-err">보내지 못했어요: ' + h(e && e.message || '') + '</span>'; draw(); P.toast('보내지 못했어요: ' + (e && e.message || ''), true); });
    }

    pop.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button') : null; if (!t || !pop.contains(t)) return;
      var tab = t.getAttribute('data-tab'); if (tab) { st.tab = tab; ls('tab', tab); st.status = ''; draw(); return; }
      var tg = t.getAttribute('data-tg'); if (tg) { var v = t.getAttribute('data-v'); st.target = st.target && st.target.t === tg && String(st.target.v) === v ? null : { t: tg, v: v }; draw(); return; }
      var p16 = t.getAttribute('data-p16'); if (p16 != null) { st.p16 = st.p16 === p16 ? '' : p16; ls('p16last', st.p16 || null); draw(); var ci = pop.querySelector('.lm-chin'); if (ci && st.p16 && !ci.value) ci.focus(); return; }
      var sb = t.getAttribute('data-sub'); if (sb != null) { send('bc', SUBS[+sb], 'sub'); return; }
      var rc = t.getAttribute('data-recent'); if (rc != null) { var list = []; try { list = JSON.parse(ls('recent') || '[]'); } catch (x) {} var it = list[+rc]; if (it) send(it.to, it.text, 'free'); return; }
      var m = t.getAttribute('data-m'); if (!m) return;
      if (m === 'close') return open(false);
      if (m === 'mon-' || m === 'mon+') { var cur = n(ls('mon')) || 0; cur = Math.max(1, Math.min(99, cur + (m === 'mon+' ? 1 : -1))); ls('mon', cur); draw(); return; }
      if (m === 'ch-' || m === 'ch+') { if (!st.p16) return; var c = n(ls('p16.' + st.p16)) || 0; c = Math.max(1, Math.min(99, c + (m === 'ch+' ? 1 : -1))); ls('p16.' + st.p16, c); draw(); return; }
      if (m === 'mon-up' || m === 'mon-down') { send('bc', compose.mon(ls('mon'), st.target, m === 'mon-up'), 'mon'); return; }
      if (m === 'p16-up' || m === 'p16-down') { send('bc', compose.p16(ls('p16.' + st.p16), st.p16, m === 'p16-up'), 'p16'); return; }
      if (m === 'free') {
        var ta = pop.querySelector('.lm-text'), to = (pop.querySelector('.lm-to') || {}).value || 'bc', txt = ta ? ta.value.trim() : '';
        if (!txt) { P.toast('보낼 글을 적어 주세요.', true); if (ta) ta.focus(); return; }
        st.to = to; send(to, txt, 'free'); return;
      }
    });
    pop.addEventListener('input', function (e) {
      var t = e.target;
      if (t.classList.contains('lm-monin')) { var v = n(t.value); ls('mon', v || null); refreshPrev(); }
      else if (t.classList.contains('lm-chin') && st.p16) { var c = n(t.value); ls('p16.' + st.p16, c || null); refreshPrev(); }
    });
    pop.addEventListener('change', function (e) { if (e.target.classList.contains('lm-to')) st.to = e.target.value; });
    /** 숫자를 치는 중에는 창 전체를 다시 그리지 않고 미리보기 · 단추만 (입력칸 커서가 튀지 않게) */
    function refreshPrev() {
      var pv = pop.querySelector('.lm-prev'), ups = pop.querySelectorAll('.lm-go.up, .lm-go.down'), txt = '';
      if (st.tab === 'mon') txt = compose.mon(ls('mon'), st.target, true).replace(/ 올려주세요\.$/, ' …');
      else if (st.tab === 'p16') txt = compose.p16(ls('p16.' + st.p16), st.p16, true).replace(/ 키워주세요\.$/, ' …');
      if (pv) pv.textContent = txt || (st.tab === 'mon' ? (n(ls('mon')) ? '대상을 고르세요' : '먼저 내 모니터 번호를 넣어 주세요') : '채널 이름을 고르세요');
      Array.prototype.forEach.call(ups, function (b) { b.disabled = !txt; });
    }
    btn.addEventListener('click', function () { open(pop.hidden); });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); open(false); } }, true);

    /* ---------- 받은 메시지 ---------- */
    function forMe(m) {
      if (!m || m.from === me() && !m.fromStage) return false;
      if (m.to === 'team') return true;
      if (m.to === 'bc') return ro;                    // 방송팀 보기 링크로 연 화면 = 방송팀
      return m.to === me();
    }
    function markSeen(id) { seen[id] = 1; try { var k = Object.keys(seen); if (k.length > 80) k.slice(0, k.length - 80).forEach(function (x) { delete seen[x]; }); root.sessionStorage.setItem(LS + 'seen', JSON.stringify(seen)); } catch (e) {} }
    function showCard(m) {
      if (seen[m.id] || inbox.querySelector('[data-id="' + m.id + '"]')) return;
      markSeen(m.id);
      var c = doc.createElement('div');
      c.className = 'lm-card2' + (m.to === 'team' ? ' team' : '') + (m.to === 'bc' ? ' bc' : '');
      c.setAttribute('data-id', m.id); c.setAttribute('role', 'alert');
      c.innerHTML = '<div class="lm-from">' + h(m.fromStage ? '방송팀' + (m.from && m.from !== '방송팀' ? ' (' + hon(m.from) + ')' : '') : hon(m.from)) +
          ' <small>' + (m.to === 'team' ? '→ 찬양팀 전체' : m.to === 'bc' ? '→ 방송팀' : '→ 나') + ' · ' + hhmm(m.t) + '</small></div>' +
        '<div class="lm-txt">' + h(m.text) + '</div><button type="button" class="lm-ok" data-ack="' + h(m.id) + '">확인</button>';
      inbox.insertBefore(c, inbox.firstChild);
      while (inbox.children.length > 3) inbox.removeChild(inbox.lastChild);
      try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate([60, 40, 60]); } catch (e) {}
      if (m.to === 'team') setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 20000);
    }
    inbox.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-ack]') : null; if (!b) return;
      var id = b.getAttribute('data-ack'), card = b.closest('.lm-card2'), r = rt();
      if (card) card.parentNode.removeChild(card);
      if (r && r.online && r.ackMsg) r.ackMsg(id).catch(function () {});
    });
    P.on('msg', function (m) { if (forMe(m)) showCard(m); else if (m && mine[m.id] == null && m.from === me()) mine[m.id] = m; });
    P.on('msg:ack', function (a) {
      if (!a) return;
      var m = mine[a.id];
      if (m && (a.by !== me() || a.stage)) {
        var who = a.stage ? '방송팀' + (a.by && a.by !== '방송팀' ? '(' + hon(a.by) + ')' : '') : hon(a.by);
        P.toast('✓ ' + who + ' 확인: ' + m.text, false, 3200);
        var s = pop.querySelector('.lm-sent[data-id="' + a.id + '"]');
        if (s) { st.status = '<span class="lm-ack">✓ ' + h(who) + ' 확인했어요 · "' + h(m.text) + '"</span>'; draw(); }
      }
    });
    P.on('joined', function (r) {
      var t = Date.now();
      ((r && r.msgs) || []).forEach(function (m) { if (!m.ack && forMe(m) && t - m.t < 5 * 60 * 1000) showCard(m); });
    });
    ['peers', 'state'].forEach(function (nm) { P.on(nm, function () { if (!pop.hidden) { var a = doc.activeElement; if (!(a && pop.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) draw(); } }); });
    return { open: open, send: send, state: st };
  }

  return { attach: attach, compose: compose, INST: INST, P16: P16, SUBS: SUBS };
}));
