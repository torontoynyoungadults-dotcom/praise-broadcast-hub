/* church-app views/Theme.html 가독성 지킴이 그대로 (.yn 안쪽만 보도록 5곳 고침 — tools/port-church-hub.js). 직접 고치지 마세요. */
/* ============================================================
   가독성 지킴이 — 배경과 글씨가 서로 묻혀 안 보이면 글씨색을 되돌립니다.
   흰 카드 안의 흰 글씨, 노란 뱃지 안의 흰 글씨처럼
   "보이지 않는 글씨" 를 화면이 그려질 때마다 스스로 고칩니다.
   ============================================================ */
(function () {
  var BASE = [25, 25, 25];     // 배경 사진의 대략적인 밝기 (밝은 화면이면 아래 바탕밝기_ 가 바꿉니다)
  function 바탕밝기_() { BASE = document.documentElement.getAttribute('data-theme') === 'light' ? [237, 244, 233] : [13, 26, 25]; }
  바탕밝기_();
  var 진하게 = '#141414';
  var 밝게 = '#FFFFFF';

  function 색뜯기(s) {
    if (!s) return null;
    var m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var n = m[1].split(',').map(parseFloat);
      return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    }
    m = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    return null;
  }

  function 그라디언트색(bi) {
    if (!bi || bi === 'none' || bi.indexOf('gradient') === -1) return null;
    var got = bi.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,6}/g) || [];
    var cols = [];
    for (var i = 0; i < got.length; i++) {
      var c = 색뜯기(got[i]);
      if (c && c[3] > 0.25) cols.push(c);
    }
    if (!cols.length) return null;
    var out = [0, 0, 0];
    for (var k = 0; k < 3; k++) {
      var sum = 0;
      for (var j = 0; j < cols.length; j++) sum += cols[j][k] * cols[j][3] + BASE[k] * (1 - cols[j][3]);
      out[k] = sum / cols.length;
    }
    return [out[0], out[1], out[2], 1];
  }

  function 겹치기(fg, bg) {
    var a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
  }

  function 밝기(c) {
    var f = [];
    for (var i = 0; i < 3; i++) {
      var v = c[i] / 255;
      f.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    }
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }

  function 대비(fg, bg) {
    var L1 = 밝기(겹치기(fg, bg)), L2 = 밝기(bg);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  }

  /* 한 번 훑는 동안 칸마다 계산한 바탕색을 기억합니다 (같은 부모를 칸마다 다시 올라가며 계산하지 않게) */
  var 바탕기억 = null;
  function 바탕(el, hop) {
    hop = hop || 0;
    if (!el || el.nodeType !== 1 || hop > 24) return BASE.slice();
    if (바탕기억 && 바탕기억.has(el)) return 바탕기억.get(el);
    var st = getComputedStyle(el), out;
    var g = 그라디언트색(st.backgroundImage);
    if (g) out = 겹치기(g, BASE);
    else {
      var c = 색뜯기(st.backgroundColor);
      if (c && c[3] >= 1) out = [c[0], c[1], c[2]];
      else {
        var under = 바탕(el.parentElement, hop + 1);
        out = (c && c[3] > 0) ? 겹치기(c, under) : under;
      }
    }
    if (바탕기억) 바탕기억.set(el, out);
    return out;
  }

  function 글자있나(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  }

  var 건너뛸것 = { SCRIPT: 1, STYLE: 1, SVG: 1, PATH: 1, TEXTAREA: 1, OPTION: 1, OPTGROUP: 1, TITLE: 1 };

  /** 한 칸을 살펴보고 필요하면 글씨색을 바꿉니다 (몇 번을 불러도 같은 결과) */
  function 한번(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = el.tagName;
    if (typeof tag !== 'string' || 건너뛸것[tag.toUpperCase()]) return;
    if (!글자있나(el)) return;

    // 우리가 넣었던 색은 지우고 원래 색으로 다시 판단합니다
    if (el.getAttribute('data-ynink')) el.style.removeProperty('color');

    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return;

    var fg = 색뜯기(st.color);
    if (!fg || fg[3] < 0.35) { el.removeAttribute('data-ynink'); return; }

    var bg = 바탕(el);
    var 밝은바탕 = 밝기(bg) >= 0.42;
    // 밝은 바탕은 조금만 흐려도 고치고, 어두운 바탕은 아주 안 보일 때만 손댑니다
    // (어두운 바탕 위의 주황 · 초록 같은 강조색은 그대로 두기 위해서입니다)
    var 기준 = 밝은바탕 ? 4.5 : 3;

    if (대비(fg, bg) >= 기준) { el.removeAttribute('data-ynink'); return; }

    var 검정 = 대비([20, 20, 20, 1], bg), 흰색 = 대비([255, 255, 255, 1], bg);
    if (Math.max(검정, 흰색) < 2.2) { el.removeAttribute('data-ynink'); return; }
    el.style.setProperty('color', 검정 >= 흰색 ? 진하게 : 밝게, 'important');
    el.setAttribute('data-ynink', '1');
  }

  var 감시 = null;
  var 감시설정 = { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] };

  /* 성능 (허브 v5) — 예전에는 무엇이 하나 바뀔 때마다 화면 전체(모든 칸)를 다시 훑었습니다.
     연습 화면의 메트로놈 깜빡임 · 필기 · 알림처럼 1초에 여러 번 바뀌는 곳이 있으면 그때마다 전체를 훑어 화면이 버벅였습니다.
     이제는 ① 바뀐 칸과 그 안쪽만 보고 ② 연습(악보) 화면 · 캔버스 · 깜빡임처럼 우리가 색을 직접 정한 곳은 건너뛰며
     ③ 한 번에 오래 붙잡지 않도록 잘게 나눠(한가한 때) 처리합니다. 결과(글씨색 고치기)는 예전과 같습니다. */
  var 안봄 = '.pv, .pv-flash, .yg-ov, canvas, [data-noink], body.pv-lock > .shell';
  function 안볼곳(el) {
    try { return !!(el && el.closest && (el.closest(안봄) || !el.closest('.yn'))); } catch (e) { return false; }
  }
  var 줄 = [];          // 살펴볼 칸들 (바뀐 곳의 맨 위 칸)
  var 전체 = false;     // 화면 전체를 한 번 훑어야 하는지
  var 한가 = window.requestIdleCallback ? function (f) { return window.requestIdleCallback(f, { timeout: 400 }); } : function (f) { return setTimeout(function () { f({ timeRemaining: function () { return 8; }, didTimeout: true }); }, 16); };

  /** root 와 그 안쪽 칸들 — 건너뛸 곳(연습 화면 · 캔버스 · 가려진 허브 등)은 그 안쪽까지 통째로 뺍니다 */
  function 칸들(root) {
    if (!root || root.nodeType !== 1 || 안볼곳(root)) return [];
    var out = [], stack = [root];
    while (stack.length) {
      var n = stack.pop();
      if (n !== root) { try { if (n.matches && n.matches(안봄)) continue; } catch (e) {} }
      out.push(n);
      for (var c = n.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
    }
    return out;
  }
  function ynCells() {
    var a = [];
    Array.prototype.forEach.call(document.querySelectorAll('.yn'), function (r) { if (!r.parentElement || !r.parentElement.closest('.yn')) a = a.concat(칸들(r)); });
    return a;
  }
  function 훑기() {
    if (!document.body) return;
    전체 = true; 예약(0);
  }
  var 일 = null;        // 지금 처리 중인 칸 목록
  function 처리(deadline) {
    대기 = null;
    if (document.hidden) { 대기 = setTimeout(function () { 예약(0); }, 1000); return; }
    if (!일) {
      if (전체) { 전체 = false; 줄 = []; 일 = ynCells(); }
      else {
        var roots = 줄.splice(0), seen = [];
        roots.forEach(function (r) {                                     // 다른 칸 안에 들어 있는 칸은 한 번만
          if (!r.isConnected) return;
          for (var i = 0; i < seen.length; i++) if (seen[i] === r || seen[i].contains(r)) return;
          seen = seen.filter(function (s) { return !r.contains(s); }); seen.push(r);
        });
        일 = [];
        seen.forEach(function (r) { 일 = 일.concat(칸들(r)); });
      }
    }
    if (감시) { try { 감시.disconnect(); } catch (e) {} }   // 우리 변경이 되돌아오지 않게
    바탕기억 = window.WeakMap ? new WeakMap() : null;
    try {
      var start = Date.now();
      while (일.length) {
        var el = 일.shift();
        try { if (el.isConnected) 한번(el); } catch (e) { /* 한 칸 실패해도 나머지는 계속 봅니다 */ }
        if (일.length && (Date.now() - start) > 10 && !(deadline && deadline.didTimeout && (Date.now() - start) < 30)) break;   // 10ms 넘게 붙잡지 않음
      }
    } catch (e) {
    } finally {
      if (감시) { try { 감시.takeRecords(); 감시.observe(document.body, 감시설정); } catch (e) {} }
    }
    if (일 && 일.length) { 대기 = 한가(처리); return; }
    일 = null;
    if (줄.length || 전체) 예약(0);
  }

  var 대기 = null;
  function 예약(ms) {
    if (대기) return;
    대기 = setTimeout(function () { 대기 = 한가(처리); }, ms == null ? 150 : ms);
  }

  function 시작() {
    전체 = true; 예약();
    // 자료를 나중에 받아 그리는 화면도 놓치지 않도록 몇 번 더 봅니다 (전체)
    var 때 = [1200, 5000];
    for (var i = 0; i < 때.length; i++) setTimeout(function () { 전체 = true; 예약(); }, 때[i]);
    if (!window.MutationObserver) return;
    감시 = new MutationObserver(function (recs) {
      var n = 0;
      for (var i = 0; i < recs.length; i++) {
        var t = recs[i].target;
        if (t && t.nodeType === 3) t = t.parentElement;               // 글자만 바뀐 경우 그 글자를 담은 칸
        if (!t || t.nodeType !== 1 || 안볼곳(t)) continue;
        if (recs[i].type === 'attributes' && t.getAttribute && t.getAttribute('data-ynink') && recs[i].attributeName === 'style') continue;
        줄.push(t); n++;
      }
      if (줄.length > 400) { 줄 = []; 전체 = true; }
      if (n) 예약();
    });
    감시.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    감시설정 = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', 시작);
  else 시작();
  /** v6 — 밝은/어두운 화면을 바꿀 때: 화면 전체를 지금 바로(한 번에) 훑습니다 — 색이 조금씩 바뀌어 보이지 않게 */
  function 지금전체() {
    if (!document.body) return;
    바탕밝기_();
    if (대기) { clearTimeout(대기); try { if (window.cancelIdleCallback) window.cancelIdleCallback(대기); } catch (e) {} 대기 = null; }
    줄 = []; 전체 = false;
    var 칸 = ynCells();
    일 = null;
    if (감시) { try { 감시.disconnect(); } catch (e) {} }
    바탕기억 = window.WeakMap ? new WeakMap() : null;
    try { for (var i = 0; i < 칸.length; i++) { try { if (칸[i].isConnected) 한번(칸[i]); } catch (e) {} } }
    finally { if (감시) { try { 감시.takeRecords(); 감시.observe(document.body, 감시설정); } catch (e) {} } }
  }
  window.YNContrast = { scan: function () { 바탕밝기_(); 훑기(); }, now: 지금전체 };
})();
