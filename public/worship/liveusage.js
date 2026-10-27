/**
 * liveusage.js — 라이브 악보 사용 기록 (V1310)
 *
 *  YNLiveUsage.mount(P)   ← practice.js 가 패널을 만든 뒤 부릅니다
 *
 *  기록: 라이브 악보를 보는 동안 30초마다 "보는 중" 신호를 서버(/api/liveUsageBeat)에 보냅니다.
 *        · 화면이 보이는 시간만 셉니다 (다른 앱으로 가거나 화면이 꺼진 동안은 빠짐). 손을 대지 않아도 화면이 켜져 있으면 셈.
 *        · 처음 열 때 · 화면을 벗어날 때 · 닫을 때도 바로 보냅니다. 실패해도 화면에는 아무 영향이 없습니다.
 *  보기: 서버가 "앱 관리자" 라고 답한 사람(hanyj123@gmail.com)에게만 ⋯ 메뉴에 「라이브 악보 사용 기록」이 생깁니다.
 *        (서버도 /api/liveUsageList 에서 다시 확인 — 주소를 알아도 다른 사람은 못 봄)
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var BEAT_MS = 30000;
  function I(n) { return root.YNIcon ? root.YNIcon.get(n) : ''; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function device() {
    var ua = navigator.userAgent || '', touch = (navigator.maxTouchPoints || 0) > 1;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'ipad';
    if (/iPhone|iPod/.test(ua)) return 'iphone';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'aphone' : 'atab';
    if (/Macintosh/.test(ua)) return 'mac';
    return 'pc';
  }
  function post(fn, args) {
    return root.fetch('/api/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: args }), keepalive: true, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || '요청하지 못했어요.'); return j.result; });
  }

  /* ============================================================ 기록 */
  function mount(P) {
    if (!P || !P.el || !P.opts || !P.opts.token || !root.fetch) return null;
    var token = P.opts.token, room = String(P.opts.room || ''), id = sid(), dev = device(), dead = false, opened = false, owner = false;
    var label = /라이브 악보/.test(doc.title || '') ? String(doc.title).replace(/\s*라이브 악보\s*$/, '').trim() : '';
    var acc = 0, since = 0, timer = 0;
    function visible() { return doc.visibilityState !== 'hidden'; }
    function take() { var now = Date.now(); if (since) { acc += now - since; since = now; } return now; }
    function send(end) {
      take();
      var ms = Math.min(acc, 90000), body = { sid: id, room: room, label: label, ms: ms, open: !opened, end: !!end, dev: dev };
      acc = 0; opened = true;
      return post('liveUsageBeat', [token, body]).then(function (r) { if (r && r.owner && !owner) { owner = true; addMenu(); } }, function () { acc += ms; });
    }
    function onVis() {
      if (dead) return;
      if (visible()) { if (!since) since = Date.now(); }
      else { take(); since = 0; send(false); }
    }
    function onHide() { if (!dead) { take(); since = 0; send(true); } }
    since = visible() ? Date.now() : 0;
    send(false);
    timer = setInterval(function () { if (!dead && since) send(false); }, BEAT_MS);
    doc.addEventListener('visibilitychange', onVis);
    root.addEventListener('pagehide', onHide);
    P.on('close', function () {
      if (dead) return; take(); since = 0; send(true); dead = true;
      clearInterval(timer); doc.removeEventListener('visibilitychange', onVis); root.removeEventListener('pagehide', onHide);
      closeView();
    });

    /* ---------- 관리자: ⋯ 메뉴에 「라이브 악보 사용 기록」 ---------- */
    var menuBtn = null;
    function addMenu() {
      if (menuBtn || dead) return;
      var acts = P.el.querySelector('.pv-acts'); if (!acts) return;
      menuBtn = doc.createElement('button'); menuBtn.type = 'button'; menuBtn.className = 'pv-b lu-actbtn';
      menuBtn.title = '라이브 악보 사용 기록 — 누가 언제 몇 분 봤는지 (앱 관리자만)'; menuBtn.setAttribute('aria-label', '라이브 악보 사용 기록');
      menuBtn.innerHTML = (I('timer') || I('calendar')) + '<span class="pv-mt">라이브 악보 사용 기록</span>';
      menuBtn.addEventListener('click', function (e) { e.stopPropagation(); openView(P, token, function () { take(); return post('liveUsageBeat', [token, { sid: id, room: room, label: label, ms: Math.min(acc, 90000), open: false, dev: dev }]).then(function () { acc = 0; }, function () {}); }); });
      acts.appendChild(menuBtn);
    }
    P.liveUsage = { open: function () { if (owner) openView(P, token); }, owner: function () { return owner; } };
    return P.liveUsage;
  }

  /* ============================================================ 보기 (관리자) */
  var view = null;
  function closeView() { if (view && view.parentNode) view.parentNode.removeChild(view); view = null; }
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  function dayLabel(d) { var p = d.split('-'), dt = new Date(+p[0], +p[1] - 1, +p[2]); return (+p[1]) + '월 ' + (+p[2]) + '일 (' + WD[dt.getDay()] + ')'; }
  function mins(sec) { var m = Math.round(sec / 60); return sec < 30 ? '1분 미만' : m < 60 ? m + '분' : Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : ''); }
  function contiName(r) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.room || '');
    if (m) return (+m[2]) + '/' + (+m[3]) + ' 콘티';
    return r.label || r.room || '—';
  }
  function addDays(day, n) { var p = day.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2] + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function css() {
    if (doc.getElementById('yn-lu-css')) return;
    var st = doc.createElement('style'); st.id = 'yn-lu-css';
    st.textContent =
      '.lu-back{position:absolute;inset:0;z-index:72;background:rgba(0,0,0,.45);display:flex;align-items:stretch;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom))}' +
      '.lu{--a:var(--lg-a,#CFAE6E);--a-soft:var(--lg-a-soft,rgba(207,174,110,.15));--a-edge:var(--lg-a-edge,rgba(211,182,124,.45));--a-text:var(--lg-a-text,#E3D0AB);--ink:var(--lg-ink,#F5F5F7);--sub:var(--lg-sub,#A9ABB6);--dim:var(--lg-dim,#6F7280);--edge:var(--lg-edge,rgba(255,255,255,.1));--ctl:var(--lg-ctl,rgba(255,255,255,.055));' +
        'width:min(760px,100%);display:flex;flex-direction:column;min-height:0;border-radius:22px;background:var(--lg-sheet,#14161c);color:var(--ink);border:1px solid var(--edge);box-shadow:var(--lg-shine,none),var(--lg-shadow,0 18px 50px rgba(0,0,0,.55));font:500 14px/1.45 Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;overflow:hidden}' +
      '.lu *{box-sizing:border-box}.lu button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.lu button:focus-visible{outline:2px solid var(--a);outline-offset:2px}' +
      '.lu-hd{flex:none;padding:18px 20px 14px;border-bottom:1px solid var(--edge)}' +
      '.lu-t{display:flex;align-items:center;gap:10px}.lu-t h3{flex:1;margin:0;font-size:18px;font-weight:800;letter-spacing:-.01em}' +
      '.lu-x{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:var(--ctl);display:inline-flex;align-items:center;justify-content:center}' +
      '.lu-x svg,.lu-x .yi{width:18px;height:18px}' +
      '.lu-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px}' +
      '.lu-seg{display:inline-flex;padding:3px;border-radius:12px;background:var(--ctl);border:1px solid var(--edge)}' +
      '.lu-seg button{min-height:34px;padding:0 14px;border:0;border-radius:9px;background:transparent;font-weight:700;font-size:13.5px;color:var(--sub)}' +
      '.lu-seg button.on{background:var(--a-soft);color:var(--a-text);box-shadow:inset 0 0 0 1px var(--a-edge)}' +
      '.lu-sum{display:flex;gap:22px;margin-top:14px;font-size:13px;color:var(--sub)}.lu-sum b{display:block;font-size:22px;font-weight:800;color:var(--ink);letter-spacing:-.02em;font-variant-numeric:tabular-nums}' +
      '.lu-bd{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:6px 12px 16px}' +
      '.lu-msg{padding:40px 16px;text-align:center;color:var(--sub)}' +
      '.lu-grp{border-bottom:1px solid var(--edge)}.lu-grp:last-child{border-bottom:0}' +
      '.lu-gh{width:100%;display:flex;align-items:center;gap:12px;padding:14px 8px;border:0;background:transparent;text-align:left;border-radius:12px}' +
      '.lu-gh:active{background:var(--ctl)}' +
      '.lu-gt{flex:1;min-width:0;font-weight:700;font-size:15px}.lu-gt small{display:block;margin-top:1px;font-weight:500;font-size:12.5px;color:var(--sub)}' +
      '.lu-gn{flex:none;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:14px}.lu-gn small{display:block;font-weight:500;font-size:12px;color:var(--sub)}' +
      '.lu-chev{flex:none;color:var(--dim);transition:transform .15s}.lu-grp.open .lu-chev{transform:rotate(90deg)}' +
      '.lu-rows{display:none;margin:0 0 12px;padding:0;list-style:none}.lu-grp.open .lu-rows{display:block}' +
      '.lu-r{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) auto;gap:2px 14px;align-items:baseline;padding:10px 12px;margin:0 0 2px;border-radius:12px;background:var(--ctl)}' +
      '.lu-rn{font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lu-rc{min-width:0;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}' +
      '.lu-rm{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}' +
      '.lu-rs{grid-column:1 / -1;font-size:12.5px;color:var(--sub);font-variant-numeric:tabular-nums}' +
      '.lu-bar{height:4px;margin-top:6px;border-radius:2px;background:var(--edge);overflow:hidden}.lu-bar i{display:block;height:100%;background:var(--a);border-radius:2px}' +
      '.lu-ft{flex:none;padding:10px 20px 14px;border-top:1px solid var(--edge);font-size:12px;color:var(--dim)}' +
      '@media (max-width:520px){.lu-back{padding:0}.lu{border-radius:0;border:0}.lu-r{grid-template-columns:minmax(0,1fr) auto}.lu-rc{grid-column:1 / -1;grid-row:2}}' +
      '@media (prefers-reduced-motion:reduce){.lu-chev{transition:none}}';
    doc.head.appendChild(st);
  }

  var RANGES = [['5w', '최근 5주', 34], ['3m', '3개월', 91], ['1y', '1년', 364]];
  function openView(P, token, before) {
    css(); closeView();
    var st = { by: 'day', range: '5w', data: null, err: '', open: {} };
    view = doc.createElement('div'); view.className = 'lu-back';
    view.innerHTML = '<section class="lu" role="dialog" aria-modal="true" aria-labelledby="luTitle">' +
      '<header class="lu-hd"><div class="lu-t"><h3 id="luTitle">라이브 악보 사용 기록</h3><button type="button" class="lu-x" data-x="1" aria-label="닫기">' + (I('close') || '✕') + '</button></div>' +
      '<div class="lu-ctl"><div class="lu-seg" role="group" aria-label="보기"><button type="button" data-by="day">날짜별</button><button type="button" data-by="person">사람별</button></div>' +
      '<div class="lu-seg" role="group" aria-label="기간">' + RANGES.map(function (r) { return '<button type="button" data-rg="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="lu-sum"></div></header>' +
      '<div class="lu-bd"><p class="lu-msg">불러오는 중…</p></div>' +
      '<footer class="lu-ft">화면이 켜져 있던 시간만 셉니다 (다른 앱 · 화면 꺼짐 제외) · 1년 보관 · 이 화면은 앱 관리자만 볼 수 있어요</footer></section>';
    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'keydown'].forEach(function (k) { view.addEventListener(k, function (e) { if (k !== 'keydown' || e.key !== 'Escape') e.stopPropagation(); }, { passive: k !== 'keydown' }); });
    view.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeView(); } });
    view.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target === view) { closeView(); return; }
      var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
      if (b.dataset.x) { closeView(); return; }
      if (b.dataset.by) { st.by = b.dataset.by; st.open = {}; paint(); return; }
      if (b.dataset.rg) { st.range = b.dataset.rg; load(); return; }
      if (b.dataset.g != null) { st.open[b.dataset.g] = !st.open[b.dataset.g]; var g = b.closest('.lu-grp'); g.classList.toggle('open', !!st.open[b.dataset.g]); b.setAttribute('aria-expanded', st.open[b.dataset.g] ? 'true' : 'false'); }
    });
    P.el.appendChild(view);
    var bd = view.querySelector('.lu-bd'), sum = view.querySelector('.lu-sum');
    try { view.querySelector('.lu-x').focus({ preventScroll: true }); } catch (e) { /* 덤 */ }

    function load() {
      paintCtl(); bd.innerHTML = '<p class="lu-msg">불러오는 중…</p>'; sum.innerHTML = '';
      var days = RANGES.filter(function (r) { return r[0] === st.range; })[0][2];
      var go = function () { return post('liveUsageList', [token, { days: days }]); };
      Promise.resolve(before ? before() : null).then(go).then(function (r) { if (!view) return; st.data = r; st.err = ''; paint(); }, function (e) { if (!view) return; st.err = e.message || '불러오지 못했어요.'; paint(); });
    }
    function paintCtl() {
      Array.prototype.forEach.call(view.querySelectorAll('[data-by]'), function (b) { b.classList.toggle('on', b.dataset.by === st.by); b.setAttribute('aria-pressed', b.dataset.by === st.by ? 'true' : 'false'); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-rg]'), function (b) { b.classList.toggle('on', b.dataset.rg === st.range); b.setAttribute('aria-pressed', b.dataset.rg === st.range ? 'true' : 'false'); });
    }
    function paint() {
      paintCtl();
      if (st.err) { bd.innerHTML = '<p class="lu-msg">' + h(st.err) + '</p>'; sum.innerHTML = ''; return; }
      var rows = (st.data && st.data.rows) || [];
      var people = {}, total = 0, dayset = {};
      rows.forEach(function (r) { people[(r.email || r.name).toLowerCase()] = 1; total += r.sec; dayset[r.d] = 1; });
      sum.innerHTML = '<div><b>' + Object.keys(people).length + '명</b>본 사람</div><div><b>' + Object.keys(dayset).length + '일</b>사용한 날</div><div><b>' + mins(total).replace('1분 미만', '0분') + '</b>모두 합친 시간</div>';
      if (!rows.length) { bd.innerHTML = '<p class="lu-msg">이 기간에 라이브 악보를 본 기록이 없어요. 기록은 이 기능을 올린 뒤부터 쌓여요.</p>'; return; }
      var groups = {}, order = [];
      rows.forEach(function (r) {
        var k = st.by === 'day' ? r.d : (r.email || r.name).toLowerCase();
        if (!groups[k]) { groups[k] = { k: k, rows: [], sec: 0, who: {}, name: r.name, days: {} }; order.push(k); }
        var g = groups[k]; g.rows.push(r); g.sec += r.sec; g.who[(r.email || r.name).toLowerCase()] = 1; g.days[r.d] = 1;
      });
      if (st.by === 'person') order.sort(function (a, b) { return groups[b].sec - groups[a].sec; });
      else order.sort(function (a, b) { return b.localeCompare(a); });
      bd.innerHTML = order.map(function (k) {
        var g = groups[k], max = 1; g.rows.forEach(function (r) { if (r.sec > max) max = r.sec; });
        var title = st.by === 'day' ? dayLabel(k) : h(g.name), sub = st.by === 'day' ? Object.keys(g.who).length + '명' : Object.keys(g.days).length + '일 · ' + g.rows.length + '번 기록';
        var items = g.rows.slice().sort(function (a, b) { return st.by === 'day' ? b.sec - a.sec : (b.d + b.last).localeCompare(a.d + a.last); }).map(function (r) {
          var who = st.by === 'day' ? h(r.name) + (r.kind && r.kind !== '팀원' ? ' <small style="font-weight:500;color:var(--sub)">' + h(r.kind) + '</small>' : '') : h(dayLabel(r.d));
          return '<li class="lu-r"><span class="lu-rn">' + who + '</span><span class="lu-rc">' + h(contiName(r)) + '</span><span class="lu-rm">' + mins(r.sec) + '</span>' +
            '<span class="lu-rs">' + h((r.first || '') + (r.last && r.last !== r.first ? '–' + r.last : '')) + (r.n > 1 ? ' · ' + r.n + '번 열었음' : '') + (r.dev ? ' · ' + h(r.dev) : '') + (r.team ? ' · ' + h(r.team) : '') +
            '<span class="lu-bar" aria-hidden="true"><i style="width:' + Math.max(2, Math.round(r.sec / max * 100)) + '%"></i></span></span></li>';
        }).join('');
        var op = !!st.open[k];
        return '<div class="lu-grp' + (op ? ' open' : '') + '"><button type="button" class="lu-gh" data-g="' + h(k) + '" aria-expanded="' + (op ? 'true' : 'false') + '">' +
          '<span class="lu-gt">' + title + '<small>' + sub + '</small></span><span class="lu-gn">' + mins(g.sec) + '<small>합계</small></span>' +
          '<span class="lu-chev" aria-hidden="true"><svg viewBox="0 0 12 12" width="12" height="12"><path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>' +
          '<ul class="lu-rows">' + items + '</ul></div>';
      }).join('');
    }
    load();
  }

  root.YNLiveUsage = { mount: mount };
}(typeof window !== 'undefined' ? window : this));
