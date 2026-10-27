/**
 * clickdock.js — 라이브 악보: 예배 중 클릭(메트로놈) 멈춤 · BPM 조절 컨트롤 (V1300)
 *
 *  YNClickDock.mount(P)   ← practice.js 가 패널을 만든 뒤 부릅니다 (P = 연습 화면이 패널에 주는 통로)
 *
 *  원칙: 「멈춤은 한 번에, BPM 변경은 두 단계로」, 컨트롤이 악보를 가리지 않게.
 *  모든 조작은 기존 경로(P.metroKey)를 지나므로 클릭 컨트롤 잠금 · 팀 동기화 · 팀 전달이 그대로 적용됩니다.
 *
 *  설정(이 기기에만 저장 · localStorage 'yn.cdock'):
 *   pos   'bar'   하단 고정 바 (악보가 바 위로 줄어듦 — 겹치지 않음)
 *         'float' 떠 있는 버튼 (악보 크기 그대로, 아래 모서리 — 손잡이 쪽)
 *         'top'   상단 바에 통합 (지금처럼 위 막대의 클릭 단추)
 *   show  'worship' 예배 모드 · 전체 화면에서만 / 'always' 항상
 *   big   true 크게 + 주변 여백 / false 기본 크기
 *   bpm   'lock' 잠금형: BPM 숫자를 눌러야 −/+ 가 열리고 3초 뒤 자동으로 닫힘 / 'show' 항상 표시
 *   auto  true 곡이 바뀌면 클릭 자동 멈춤 (다음 곡 BPM 은 미리 맞춰 둠) / false 계속 (지금처럼)
 *   keys  true 키보드 단축키 (Space 클릭 · ↑↓ BPM) 켜기 / false 끄기 (페달의 페이지 넘김 키는 그대로)
 *   pkey  클릭 시작/멈춤에 쓸 페달 키 ({k,c} 또는 null)
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var KEY = 'yn.cdock';
  var DEF = { pos: 'bar', show: 'worship', big: true, bpm: 'lock', auto: false, keys: true, pkey: null };
  var CLOSE_MS = 3000;

  function load() {
    var o = {}; try { o = JSON.parse(root.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { o = {}; }
    var c = {}; for (var k in DEF) c[k] = Object.prototype.hasOwnProperty.call(o, k) ? o[k] : DEF[k];
    if (['bar', 'float', 'top'].indexOf(c.pos) < 0) c.pos = DEF.pos;
    if (['worship', 'always'].indexOf(c.show) < 0) c.show = DEF.show;
    if (['lock', 'show'].indexOf(c.bpm) < 0) c.bpm = DEF.bpm;
    c.big = c.big !== false; c.auto = c.auto === true; c.keys = c.keys !== false;
    if (!c.pkey || typeof c.pkey !== 'object' || !(c.pkey.k || c.pkey.c)) c.pkey = null;
    return c;
  }
  function save(c) { try { root.localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* 저장이 막혀도 이번 화면에서는 동작 */ } }
  function I(n) { return root.YNIcon ? root.YNIcon.get(n) : ''; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var SVG_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
  var SVG_STOP = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
  var NOTYPE = { button: 1, checkbox: 1, radio: 1, range: 1, submit: 1, reset: 1, color: 1, file: 1 };
  function isTyping(t) {
    if (!t || !t.tagName) return false; var tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
    return tag === 'INPUT' && !NOTYPE[String(t.type || 'text').toLowerCase()];
  }
  function sameKey(a, e) { return !!a && ((a.c && a.c === e.code) || (!a.c && a.k && a.k === e.key)); }
  function keyName(a) { if (!a) return '없음'; var m = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space', Enter: 'Enter' }; return m[a.k] || a.k || a.c; }
  function pagePedal() { try { return JSON.parse(root.localStorage.getItem('yn.pv.pedal') || 'null'); } catch (e) { return null; } }

  function css() {
    if (doc.getElementById('yn-cdock-css')) return;
    var st = doc.createElement('style'); st.id = 'yn-cdock-css';
    st.textContent =
      '.cd{--cd-bg:rgba(14,16,20,.94);--cd-ink:var(--g-ink,#f8f5f0);--cd-sub:var(--g-sub,#c9c4bb);--cd-line:var(--g-line,rgba(255,255,255,.15));--cd-btn:rgba(255,255,255,.08);--cd-a:var(--lg-a-grad,linear-gradient(135deg,#D9C08D,#CFAE6E));--cd-a-ink:var(--lg-a-ink,#1A0E05);--cd-acc:var(--g-a,#d6b97f);' +
        'display:flex;align-items:center;gap:10px;color:var(--cd-ink);font:600 14px/1.2 Pretendard,-apple-system,"Apple SD Gothic Neo",Helvetica,Arial,sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent}' +
      '.cd[hidden],.cd [hidden]{display:none!important}' +
      '.cd button{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent;cursor:pointer}' +
      '.cd-bar{position:relative;flex:none;z-index:26;min-height:60px;padding:6px 12px calc(6px + env(safe-area-inset-bottom,0px));background:var(--cd-solid,#101216);border-top:1px solid var(--cd-line)}' +
      /* 아래 바가 있으면 접힌 패널 시트(태블릿 · 폰)가 바 뒤로 비치지 않게 */
      '.pv.pv-cdbar:not(.pv-sideopen) .pv-side{visibility:hidden;transition:transform .26s cubic-bezier(.2,.8,.2,1),visibility 0s .26s}' +
      '.cd-float{position:absolute;z-index:26;bottom:calc(14px + env(safe-area-inset-bottom,0px));padding:6px;border-radius:999px;background:var(--cd-bg);border:1px solid var(--cd-line);box-shadow:0 8px 26px rgba(0,0,0,.4)}' +
      '.cd-float.r{right:14px}.cd-float.l{left:14px}' +
      '.cd-go{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;min-width:96px;padding:0 16px;border-radius:14px;border:1.5px solid var(--cd-line);background:var(--cd-btn);font-weight:800;letter-spacing:-.01em}' +
      '.cd-go.on{background:var(--cd-a);color:var(--cd-a-ink);border-color:transparent}' +
      '.cd-go.on.b0{box-shadow:0 0 0 3px rgba(207,174,110,.35)}' +
      '.cd-big .cd-go{height:60px;min-width:128px;font-size:16px;border-radius:16px}.cd-big.cd-bar .cd-go{margin-right:16px}.cd-big.cd-float .cd-go{height:56px;min-width:112px}' +
      '.cd-float .cd-go{border-radius:999px}' +
      '.cd-bpm{display:flex;align-items:center;gap:6px;min-width:0}' +
      '.cd-num{display:inline-flex;align-items:baseline;gap:5px;height:44px;padding:0 12px;border-radius:12px;border:1px solid transparent;background:transparent;font-variant-numeric:tabular-nums}' +
      '.cd-lockbpm .cd-num{border-color:var(--cd-line);background:var(--cd-btn)}' +
      '.cd-num b{font-size:22px;font-weight:800;letter-spacing:-.02em}.cd-num small{font-size:11.5px;font-weight:700;color:var(--cd-sub)}' +
      '.cd-num.chg b{color:var(--cd-acc)}' +
      '.cd-dot{width:9px;height:9px;border-radius:50%;background:var(--cd-line);align-self:center;margin-right:2px;transition:background .06s}' +
      '.cd-dot.on{background:var(--cd-acc)}.cd-dot.on.b0{background:#fff;box-shadow:0 0 8px var(--cd-acc)}' +
      '.cd-st{flex:none;width:44px;height:44px;border-radius:12px;border:1px solid var(--cd-line);background:var(--cd-btn);font-size:22px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}' +
      '.cd-big .cd-st{width:52px;height:52px}' +
      '.cd button:disabled{opacity:.4;cursor:default}' +
      '.cd-note{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--cd-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cd-float .cd-note{display:none}' +
      '.cd-set{flex:none;width:40px;height:40px;margin-left:auto;border-radius:50%;border:0;background:transparent;color:var(--cd-sub);display:inline-flex;align-items:center;justify-content:center}' +
      '.cd-set .yi,.cd-set svg{width:20px;height:20px}.cd-float .cd-set{margin-left:0;width:34px;height:34px}' +
      '.cd-pop{position:absolute;bottom:calc(100% + 8px);display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px;border-radius:16px;background:var(--cd-bg);border:1px solid var(--cd-line);box-shadow:0 10px 30px rgba(0,0,0,.45);max-width:calc(100vw - 24px)}' +
      '.cd-pop[hidden]{display:none!important}.cd-bar .cd-pop{left:12px}.cd-float.r .cd-pop{right:0}.cd-float.l .cd-pop{left:0}' +
      '.cd-pop .cd-st{width:56px;height:52px;font-size:17px;font-weight:800}' +
      '.cd-pop .cd-tx{height:52px;padding:0 14px;border-radius:12px;border:1px solid var(--cd-line);background:var(--cd-btn);font-weight:800;font-size:14px}' +
      '.cd-pop .cd-pv{min-width:64px;text-align:center;font-variant-numeric:tabular-nums;font-size:22px;font-weight:800}' +
      '.cd-pop .cd-bar2{flex-basis:100%;height:3px;border-radius:3px;background:var(--cd-line);overflow:hidden}.cd-pop .cd-bar2 i{display:block;height:100%;width:100%;background:var(--cd-acc);transform-origin:left;}' +
      '.cd-pop .cd-bar2 i.run{transition:transform ' + CLOSE_MS + 'ms linear;transform:scaleX(0)}' +
      '.pv.pv-cdock .pv-fsmc{display:none!important}' +
      '.cd-hst{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:38px;padding:0 8px;border-radius:10px;font-size:18px;font-weight:800}' +
      /* 설정 창 */
      '.cd-back{position:absolute;inset:0;z-index:70;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.cd-sheet{width:min(460px,100%);max-height:calc(100% - 24px);overflow:auto;-webkit-overflow-scrolling:touch;padding:16px;border-radius:20px;background:rgba(16,18,24,.98);color:var(--g-ink,#f8f5f0);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.55);font:600 14px/1.4 Pretendard,-apple-system,"Apple SD Gothic Neo",Helvetica,Arial,sans-serif}' +
      '.cd-sh-h{display:flex;align-items:center;gap:8px}.cd-sh-h b{flex:1;font-size:17px;font-weight:800}' +
      '.cd-sh-x{width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.1);color:inherit;font-size:18px;cursor:pointer}' +
      '.cd-sh-sub{margin:2px 0 10px;font-size:12.5px;color:var(--g-sub,#c9c4bb);font-weight:600}' +
      '.cd-row{padding:10px 0;border-top:1px solid rgba(255,255,255,.08)}.cd-row h6{margin:0 0 7px;font-size:13px;font-weight:800;color:var(--g-sub,#c9c4bb)}' +
      '.cd-seg{display:flex;flex-wrap:wrap;gap:6px}.cd-seg button{flex:1 1 auto;min-height:40px;padding:6px 12px;border-radius:11px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;font-weight:700;font-size:13.5px;line-height:1.25;font-family:inherit;cursor:pointer}' +
      '.cd-seg button.on{background:var(--lg-a-grad,linear-gradient(135deg,#D9C08D,#CFAE6E));color:var(--lg-a-ink,#1A0E05);border-color:transparent}' +
      '.cd-seg button small{display:block;font-size:11px;font-weight:600;opacity:.8}' +
      '.cd-help{margin:6px 0 0;font-size:12px;color:var(--g-sub,#c9c4bb);font-weight:500}' +
      '.cd-learn{color:var(--g-a,#d6b97f)}' +
      '.cd-foot{display:flex;justify-content:space-between;gap:8px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}' +
      '.cd-foot button{min-height:40px;padding:0 14px;border-radius:11px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:inherit;font-weight:800;font-size:13.5px;font-family:inherit;cursor:pointer}' +
      /* 밝은 화면 */
      'html[data-theme=light] .cd{--cd-bg:rgba(255,255,255,.97);--cd-solid:#fff;--cd-ink:#111;--cd-sub:#555;--cd-line:rgba(15,23,42,.16);--cd-btn:rgba(15,23,42,.05)}' +
      'html[data-theme=light] .cd-dot.on.b0{background:#111}' +
      'html[data-theme=light] .cd-sheet{background:#fff;color:#111;border-color:rgba(15,23,42,.14)}html[data-theme=light] .cd-sh-sub,html[data-theme=light] .cd-row h6,html[data-theme=light] .cd-help{color:#555}' +
      'html[data-theme=light] .cd-row,html[data-theme=light] .cd-foot{border-top-color:rgba(15,23,42,.08)}html[data-theme=light] .cd-seg button,html[data-theme=light] .cd-foot button{border-color:rgba(15,23,42,.18);background:rgba(15,23,42,.04)}html[data-theme=light] .cd-sh-x{background:rgba(15,23,42,.08)}';
    doc.head.appendChild(st);
  }

  function mount(P) {
    if (!P || !P.el || !P.metroKey) return null;
    css();
    var el = P.el, cfg = load(), dead = false;
    var main = el.querySelector('.pv-main');
    var dock = doc.createElement('div');
    dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', '클릭 · BPM');
    dock.innerHTML =
      '<button type="button" class="cd-go" aria-pressed="false"><span class="cd-gi">' + SVG_PLAY + '</span><span class="cd-gt">클릭</span></button>' +
      '<div class="cd-bpm">' +
        '<button type="button" class="cd-st cd-dn" aria-label="BPM 1 내리기" title="BPM −1 (누르고 있으면 계속)">−</button>' +
        '<button type="button" class="cd-num" aria-haspopup="true" aria-expanded="false"><i class="cd-dot" aria-hidden="true"></i><b>—</b><small>BPM</small></button>' +
        '<button type="button" class="cd-st cd-up" aria-label="BPM 1 올리기" title="BPM +1 (누르고 있으면 계속)">+</button>' +
      '</div>' +
      '<div class="cd-note" aria-live="polite"></div>' +
      '<button type="button" class="cd-set" aria-label="클릭 · BPM 컨트롤 설정" title="클릭 · BPM 컨트롤 설정">' + (I('sliders') || '⚙') + '</button>' +
      '<div class="cd-pop" role="group" aria-label="BPM 바꾸기" hidden>' +
        '<button type="button" class="cd-st" data-d="-5">−5</button><button type="button" class="cd-st cd-pdn" data-hold="-1">−1</button>' +
        '<span class="cd-pv">—</span>' +
        '<button type="button" class="cd-st cd-pup" data-hold="1">+1</button><button type="button" class="cd-st" data-d="5">+5</button>' +
        '<button type="button" class="cd-tx" data-p="reset">원래 BPM</button><button type="button" class="cd-tx" data-p="save">이 곡에 저장</button>' +
        '<div class="cd-bar2" aria-hidden="true"><i></i></div>' +
      '</div>';
    function q(s) { return dock.querySelector(s); }
    var go = q('.cd-go'), gi = q('.cd-gi'), num = q('.cd-num'), numB = num.querySelector('b'), dot = q('.cd-dot'), dn = q('.cd-dn'), up = q('.cd-up'),
      note = q('.cd-note'), setBtn = q('.cd-set'), pop = q('.cd-pop'), pv = q('.cd-pv'), pbar = q('.cd-bar2 i');

    /* 악보로 터치가 새지 않게: 바 안의 모든 누름은 여기서 끝 (페이지 넘김 · 필기로 처리되지 않음) */
    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'dblclick'].forEach(function (k) { dock.addEventListener(k, function (e) { e.stopPropagation(); }, { passive: true }); });

    /* ---------- 상태 ---------- */
    function state() { try { return P.metroState ? P.metroState() : null; } catch (e) { return null; } }
    function locked() { try { return P.metroLocked ? P.metroLocked() : false; } catch (e) { return false; } }
    function cur() { try { return P.curBpm ? P.curBpm() : null; } catch (e) { return null; } }
    function saved() { try { return P.savedBpm ? P.savedBpm() : null; } catch (e) { return null; } }
    function clickerName() { var rt = P.rt && P.rt(); var n = rt && rt.clicker || ''; return root.YNHon ? root.YNHon.say(n || '다른 사람') : (n || '다른 사람') + ' 님이'; }

    function sync() {
      if (dead) return;
      var st = state(), run = !!(st && st.running), b = cur(), sv = saved(), lk = locked(), chg = !!(b && sv && b !== sv);
      go.classList.toggle('on', run); go.setAttribute('aria-pressed', run ? 'true' : 'false');
      gi.innerHTML = run ? SVG_STOP : SVG_PLAY; q('.cd-gt').textContent = run ? '멈춤' : '클릭';
      go.setAttribute('aria-label', run ? '클릭 멈추기' : '클릭 시작'); go.title = (run ? '클릭 멈추기' : '클릭 시작') + ' (한 번 누르기)';
      go.disabled = lk;
      numB.textContent = b ? String(b) : '—'; pv.textContent = b ? String(b) : '—';
      num.classList.toggle('chg', chg);
      num.title = cfg.bpm === 'lock' ? 'BPM 바꾸기 — 눌러서 열기' : (chg ? '바꾼 BPM — 길게 누르면 원래 BPM(' + sv + ')으로' : 'BPM');
      num.setAttribute('aria-label', (b ? b + ' BPM' : 'BPM') + (chg ? ', 원래 ' + sv : '') + (cfg.bpm === 'lock' ? ' — 눌러서 BPM 바꾸기' : ''));
      dn.disabled = up.disabled = lk; num.disabled = lk && cfg.bpm === 'lock';
      Array.prototype.forEach.call(pop.querySelectorAll('button'), function (x) { x.disabled = lk; });
      var rb = pop.querySelector('[data-p="reset"]'); if (rb) { rb.disabled = lk || !chg; rb.textContent = sv ? '원래 ' + sv : '원래 BPM'; }
      var sb = pop.querySelector('[data-p="save"]'); if (sb) sb.disabled = lk || !chg;
      note.textContent = lk ? clickerName() + ' 클릭 컨트롤 — 자동으로 따라감' : (chg ? '원래 ' + sv + ' BPM · 이번만 바뀜' : '');
      if (lk && !pop.hidden) closePop();
      hsync();
    }
    function beat(e) {
      if (dead) return;
      dot.classList.remove('on', 'b0'); void dot.offsetWidth; dot.classList.add('on'); if (e && e.beat === 0) dot.classList.add('b0');
      go.classList.toggle('b0', !!(e && e.beat === 0));
      clearTimeout(beat.t); beat.t = setTimeout(function () { dot.classList.remove('on', 'b0'); go.classList.remove('b0'); }, 120);
    }

    /* ---------- 시작 / 멈춤: 한 번 누르면 바로 ---------- */
    go.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      var r = P.metroKey('toggle');
      if (r === null) P.toast('클릭 도구를 불러오지 못했습니다.', true);
      else if (r && r.locked) P.toast(clickerName() + ' 클릭 컨트롤입니다.', true, 1600);
      sync();
    });

    /* ---------- BPM ---------- */
    function step(d) {
      var r = P.metroKey('bpm', d);
      if (r === null) P.toast('클릭 도구를 불러오지 못했습니다.', true);
      else if (r && r.locked) P.toast(clickerName() + ' 클릭 컨트롤이라 BPM 을 바꿀 수 없어요.', true, 1400);
      sync(); kick();
    }
    function hold(btn, d) {
      if (P.bpmHold) return P.bpmHold(btn, d, function () { sync(); kick(); });
      btn.addEventListener('click', function (e) { e.stopPropagation(); step(d); });
      return function () {};
    }
    var stops = [hold(dn, -1), hold(up, 1), hold(q('.cd-pdn'), -1), hold(q('.cd-pup'), 1)];
    function resetBpm() {
      var b = cur(), sv = saved(); if (!b || !sv || b === sv) return;
      step(sv - b); P.toast('원래 BPM ' + sv + ' 으로', false, 1000);
    }

    /* 잠금형: 숫자를 눌러야 열리고, 손을 떼고 3초 뒤 자동으로 닫힘 */
    var popT = 0;
    function kick() {
      if (pop.hidden) return;
      clearTimeout(popT); popT = setTimeout(closePop, CLOSE_MS);
      pbar.classList.remove('run'); void pbar.offsetWidth; pbar.classList.add('run');
    }
    function openPop() { if (locked()) { P.toast(clickerName() + ' 클릭 컨트롤입니다.', true, 1400); return; } pop.hidden = false; num.setAttribute('aria-expanded', 'true'); sync(); kick(); }
    function closePop() { clearTimeout(popT); pop.hidden = true; num.setAttribute('aria-expanded', 'false'); pbar.classList.remove('run'); }
    var pressT = 0, longed = false;
    num.addEventListener('pointerdown', function () {
      longed = false; clearTimeout(pressT);
      if (cfg.bpm === 'show') pressT = setTimeout(function () { longed = true; resetBpm(); }, 650);     // 항상 표시형: 길게 누르면 원래 BPM
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (k) { num.addEventListener(k, function () { clearTimeout(pressT); }); });
    num.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      if (longed) { longed = false; return; }
      if (cfg.bpm === 'lock') { if (pop.hidden) openPop(); else closePop(); }
    });
    pop.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.disabled) return;
      if (b.dataset.d) step(+b.dataset.d);
      else if (b.dataset.p === 'reset') { resetBpm(); kick(); }
      else if (b.dataset.p === 'save') {
        var ok = P.saveBpm ? P.saveBpm() : false;
        P.toast(ok !== false ? '이 곡의 BPM 으로 저장했어요' : '저장하지 못했어요', ok === false, 1400);
        setTimeout(sync, 60); kick();
      }
    });
    pop.addEventListener('pointerdown', kick);

    /* ---------- 상단 바 모드: 위 막대 클릭 단추 옆 −/+ (항상 표시형일 때만) ---------- */
    var hb = el.querySelector('.pv-top .pv-metbtn'), hdn = null, hup = null, hstops = [];
    function hsync() {
      var want = cfg.pos === 'top' && cfg.bpm === 'show' && !!hb;
      if (want && !hdn) {
        hdn = doc.createElement('button'); hup = doc.createElement('button');
        hdn.type = hup.type = 'button'; hdn.className = 'pv-b cd-hst'; hup.className = 'pv-b cd-hst';
        hdn.textContent = '−'; hup.textContent = '+'; hdn.setAttribute('aria-label', 'BPM 1 내리기'); hup.setAttribute('aria-label', 'BPM 1 올리기');
        hb.parentNode.insertBefore(hdn, hb); hb.parentNode.insertBefore(hup, hb.nextSibling);
        hstops = [hold(hdn, -1), hold(hup, 1)];
      }
      if (hdn) { hdn.hidden = hup.hidden = !want; hdn.disabled = hup.disabled = locked(); }
    }

    /* ---------- 보이기 · 위치 ---------- */
    function visible() {
      if (cfg.pos === 'top') return false;
      if (cfg.show === 'always') return true;
      try { return !!(P.worship && P.worship()) || !!(P.fullscreen && P.fullscreen()); } catch (e) { return false; }
    }
    function place() {
      if (dead) return;
      var vis = visible(), hand = 'right'; try { hand = P.hand ? P.hand() : 'right'; } catch (e) { /* 기본 */ }
      dock.className = 'cd ' + (cfg.pos === 'float' ? 'cd-float ' + (hand === 'left' ? 'l' : 'r') : 'cd-bar') + (cfg.big ? ' cd-big' : '') + (cfg.bpm === 'lock' ? ' cd-lockbpm' : ' cd-showbpm');
      dn.hidden = up.hidden = cfg.bpm === 'lock';
      if (cfg.bpm !== 'lock') closePop();
      if (cfg.pos === 'float') { if (dock.parentNode !== el || dock.nextSibling) el.appendChild(dock); }
      else if (main && main.parentNode === el) { if (dock.previousSibling !== main) el.insertBefore(dock, main.nextSibling); }
      else if (dock.parentNode !== el) el.appendChild(dock);
      dock.hidden = !vis; if (!vis) closePop();
      el.classList.toggle('pv-cdock', vis); el.classList.toggle('pv-cdbar', vis && cfg.pos === 'bar');
      sync();
    }

    /* ---------- 곡이 바뀌면 클릭 멈춤 (선택) ---------- */
    var lastSong = P.songIdx ? P.songIdx() : -1;
    P.on('song', function () {
      var i = P.songIdx ? P.songIdx() : -1; if (i === lastSong) { sync(); return; }
      var prev = lastSong; lastSong = i; sync();
      if (!cfg.auto || prev < 0 || i < 0 || dead) return;
      var st = state(); if (!st || !st.running || locked()) return;
      var r = P.metroKey('toggle');
      if (r && r.ok !== false) P.toast('곡이 바뀌어 클릭을 멈췄어요 — 다음 곡 BPM 준비됨', false, 1800);
      sync();
    });

    /* ---------- 키보드 · 페달 ---------- */
    var learning = false, padT = 0;
    function onKey(e) {
      if (dead || !doc.body.contains(el)) return;
      if (learning) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { learning = false; paintSheet(); return; }
        var k = { k: e.key, c: e.code || '' }, pp = pagePedal();
        if (pp && (sameKey(pp.n, e) || sameKey(pp.p, e))) { P.toast('이 키는 페이지 넘김 페달에 쓰고 있어요 — 다른 페달을 눌러 주세요', true, 2400); return; }
        if (!pp && /^(ArrowRight|ArrowLeft|PageDown|PageUp)$/.test(e.key)) { P.toast('이 키는 페이지 넘김에 쓰여요 — 다른 페달을 눌러 주세요', true, 2400); return; }
        cfg.pkey = k; save(cfg); learning = false; paintSheet(); P.toast('클릭 페달: ' + keyName(k) + ' — 누르면 클릭 시작 / 멈춤', false, 2200); return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (cfg.pkey && sameKey(cfg.pkey, e)) {
        e.preventDefault(); e.stopPropagation();
        if (e.repeat || Date.now() - padT < 300) return; padT = Date.now();
        var r = P.metroKey('toggle'); if (r && r.locked) P.toast(clickerName() + ' 클릭 컨트롤입니다.', true, 1400); sync(); return;
      }
      if (!cfg.keys && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        var pp2 = pagePedal(); if (pp2 && (sameKey(pp2.n, e) || sameKey(pp2.p, e))) return;      // 페이지 넘김 페달은 그대로
        e.preventDefault(); e.stopPropagation();
      }
    }
    root.addEventListener('keydown', onKey, true);

    /* ---------- 설정 창 ---------- */
    var back = null;
    function seg(name, opts) {
      return '<div class="cd-seg" data-g="' + name + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '">' + h(o[1]) + (o[2] ? '<small>' + h(o[2]) + '</small>' : '') + '</button>'; }).join('') + '</div>';
    }
    function paintSheet() {
      if (!back) return;
      var vals = { pos: cfg.pos, show: cfg.show, big: cfg.big ? '1' : '0', bpm: cfg.bpm, auto: cfg.auto ? '1' : '0', keys: cfg.keys ? '1' : '0' };
      Array.prototype.forEach.call(back.querySelectorAll('.cd-seg[data-g]'), function (g) {
        Array.prototype.forEach.call(g.querySelectorAll('button[data-v]'), function (b) { var on = vals[g.dataset.g] === b.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      });
      var showRow = back.querySelector('[data-row="show"]'); if (showRow) showRow.style.opacity = cfg.pos === 'top' ? '.45' : '';
      var pk = back.querySelector('.cd-pk'); if (pk) { pk.textContent = learning ? '지금 페달(또는 키)을 한 번 누르세요… (Esc 취소)' : '지금: ' + keyName(cfg.pkey); pk.classList.toggle('cd-learn', learning); }
    }
    function openSheet() {
      closePop();
      if (back) { paintSheet(); return; }
      back = doc.createElement('div'); back.className = 'cd-back';
      back.innerHTML =
        '<div class="cd-sheet" role="dialog" aria-modal="true" aria-label="클릭 · BPM 컨트롤 설정">' +
          '<div class="cd-sh-h"><b>클릭 · BPM 컨트롤</b><button type="button" class="cd-sh-x" data-x="1" aria-label="닫기">✕</button></div>' +
          '<p class="cd-sh-sub">이 기기에만 저장돼요. 클릭 컨트롤 잠금 · 팀 동기화는 그대로예요.</p>' +
          '<div class="cd-row"><h6>① 컨트롤 위치</h6>' + seg('pos', [['bar', '하단 고정 바', '악보와 안 겹침'], ['float', '떠 있는 버튼', '악보 크기 그대로'], ['top', '상단 바에 통합', '지금처럼']]) + '</div>' +
          '<div class="cd-row" data-row="show"><h6>보이는 때</h6>' + seg('show', [['worship', '예배 모드 · 전체 화면에서'], ['always', '항상']]) + '</div>' +
          '<div class="cd-row"><h6>② 클릭 버튼</h6>' + seg('big', [['1', '크게 + 여백', '실수 방지'], ['0', '기본 크기']]) + '</div>' +
          '<div class="cd-row"><h6>③ BPM 조절</h6>' + seg('bpm', [['lock', '잠금형', 'BPM 숫자를 눌러 열기 · 3초 뒤 닫힘'], ['show', '항상 표시', '−/+ 늘 보임 · 숫자 길게 = 원래 BPM']]) + '</div>' +
          '<div class="cd-row"><h6>④ 곡이 바뀌면</h6>' + seg('auto', [['0', '클릭 계속', '다음 곡 BPM 으로 (지금처럼)'], ['1', '클릭 멈춤', '다음 곡 BPM 만 준비']]) +
            '<p class="cd-help">메들리처럼 곡이 이어지는 콘티에서는 「클릭 계속」이 안전해요.</p></div>' +
          '<div class="cd-row"><h6>⑤ 키보드 · 페달</h6>' + seg('keys', [['1', '단축키 켜기', 'Space 클릭 · ↑↓ BPM'], ['0', '단축키 끄기']]) +
            '<div class="cd-seg" style="margin-top:8px"><button type="button" data-k="learn">클릭 페달 맞추기</button><button type="button" data-k="clear">클릭 페달 지우기</button></div>' +
            '<p class="cd-help cd-pk"></p><p class="cd-help">블루투스 페달의 남는 버튼 하나를 「클릭 시작 / 멈춤」으로 쓸 수 있어요. 페이지 넘김 페달 키와는 겹치지 않게 맞춰 주세요.</p></div>' +
          '<div class="cd-foot"><button type="button" data-k="def">기본값으로</button><button type="button" data-x="1">닫기</button></div>' +
        '</div>';
      ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown'].forEach(function (k) { back.addEventListener(k, function (e) { e.stopPropagation(); }, { passive: true }); });
      back.addEventListener('click', function (e) {
        e.stopPropagation();
        if (e.target === back) { closeSheet(); return; }
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        if (b.dataset.x) { closeSheet(); return; }
        var g = b.parentNode && b.parentNode.dataset ? b.parentNode.dataset.g : '';
        if (g && b.dataset.v != null) {
          var v = b.dataset.v;
          if (g === 'big' || g === 'auto' || g === 'keys') cfg[g] = v === '1'; else cfg[g] = v;
          save(cfg); place(); paintSheet(); return;
        }
        if (b.dataset.k === 'learn') { learning = true; paintSheet(); }
        else if (b.dataset.k === 'clear') { cfg.pkey = null; learning = false; save(cfg); paintSheet(); }
        else if (b.dataset.k === 'def') { var pk = cfg.pkey; cfg = load(); for (var k in DEF) cfg[k] = DEF[k]; cfg.pkey = pk; save(cfg); place(); paintSheet(); P.toast('기본값으로 되돌렸어요 (클릭 페달은 그대로)', false, 1600); }
      });
      el.appendChild(back); paintSheet();
      var x = back.querySelector('.cd-sh-x'); try { x.focus({ preventScroll: true }); } catch (e) { /* 초점은 덤 */ }
    }
    function closeSheet() { learning = false; if (back && back.parentNode) back.parentNode.removeChild(back); back = null; }
    setBtn.addEventListener('click', function (e) { e.stopPropagation(); openSheet(); });

    /* 「⋯ 더 보기」 · 메뉴 서랍에도 설정 단추 (상단 바 모드에서도 열 수 있게) */
    var acts = el.querySelector('.pv-acts'), actBtn = null;
    if (acts) {
      actBtn = doc.createElement('button'); actBtn.type = 'button'; actBtn.className = 'pv-b cd-actbtn';
      actBtn.title = '클릭 · BPM 컨트롤 (위치 · 크기 · 잠금 · 페달)'; actBtn.setAttribute('aria-label', '클릭 · BPM 컨트롤 설정');
      actBtn.innerHTML = I('metronome') + '<span class="pv-mt">클릭 · BPM 컨트롤 설정</span>';
      actBtn.addEventListener('click', function (e) { e.stopPropagation(); openSheet(); });
      var ws = acts.querySelector('.pv-pedalbtn'); acts.insertBefore(actBtn, ws ? ws.nextSibling : null);
    }

    /* ---------- 연결 ---------- */
    var api = { el: dock, sync: sync, beat: beat, destroy: destroy };
    var unreg = null, poll = 0;
    if (P.metroWidget) unreg = P.metroWidget(api); else poll = setInterval(sync, 500);       // 예전 패널 파일이 캐시에 남아 있어도 동작
    ['worship', 'fs', 'layout'].forEach(function (n) { P.on(n, function () { setTimeout(place, 0); }); });
    ['clicker', 'conn', 'leader', 'followm', 'manual', 'cfg', 'bpmview', 'metro'].forEach(function (n) { P.on(n, function () { setTimeout(sync, 0); }); });
    function destroy() {
      if (dead) return; dead = true;
      clearTimeout(popT); clearInterval(poll); stops.concat(hstops).forEach(function (f) { try { f && f(); } catch (e) { /* 무시 */ } });
      if (unreg) try { unreg(); } catch (e) { /* 무시 */ }
      root.removeEventListener('keydown', onKey, true); closeSheet();
      if (dock.parentNode) dock.parentNode.removeChild(dock);
      if (hdn && hdn.parentNode) hdn.parentNode.removeChild(hdn); if (hup && hup.parentNode) hup.parentNode.removeChild(hup);
      el.classList.remove('pv-cdock', 'pv-cdbar');
    }
    P.on('close', destroy);
    P.clickDock = { open: openSheet, config: function () { return JSON.parse(JSON.stringify(cfg)); } };
    place();
    return api;
  }

  root.YNClickDock = { mount: mount, load: load, DEF: DEF };
}(typeof window !== 'undefined' ? window : this));
