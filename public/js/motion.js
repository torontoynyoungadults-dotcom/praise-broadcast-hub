/* 소소한 움직임 — 변경기록 · 콘티 · 스케줄 · 홈에서 "뭔가 바뀌었다"를 짧게(0.3~0.6초) 보여 줍니다.
 *   1) 변경기록: 줄이 위에서부터 차르르 · 새 기록은 형광펜 · 이전 값에 펜으로 줄 긋고 → 새 값 등장 · 되돌린 줄은 줄이 거꾸로 풀리고 「되돌림」 도장
 *   2) 콘티: 「새 곡」 도장 꾹 · 「수정」 톡 · 곡 순서가 바뀌면(되돌리기 등) 카드가 새 자리로 미끄러짐 · 악보/녹음 지우면 종이처럼 구겨지고 안내 한 줄
 *   3) 스케줄: 미정이던 칸에 이름이 손글씨처럼 써짐 · 같은 날 다른 칸으로 옮긴 이름은 폴짝 날아감
 *   4) 홈: 「다음 섬김」 날짜가 바뀌면 달력 넘기듯 한 장
 * 휴대폰 "동작 줄이기"를 켜 두면 아무것도 움직이지 않습니다. 라이브 악보(예배 화면)에는 이 파일을 싣지 않습니다. */
(function () {
  'use strict';
  var reduce = function () { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간 없음 — 움직임만 빠짐 */ } },
  };
  var ss = {
    take: function (k) { try { var v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch (e) { return null; } },
    put: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  };

  /* ---------------------------------------------------------------- 공통: 잠깐 떴다 사라지는 안내 한 줄 */
  function toast(text) {
    var t = document.createElement('div');
    t.className = 'mo-toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3100);
  }

  /* ---------------------------------------------------------------- 1) 변경기록 */
  function history() {
    var list = document.querySelector('.cn-hist .cn-h-list:not([data-mo])');
    if (!list) return;
    list.setAttribute('data-mo', '1');
    if (reduce()) return;
    var undid = '';
    try { undid = new URL(location.href).searchParams.get('undid') || ''; } catch (e) {}
    $$('.cn-h-item', list).forEach(function (li, i) {
      li.style.setProperty('--mo-i', Math.min(i, 18));
      li.classList.add('mo-in');
      if (undid && li.getAttribute('data-hid') === undid) li.classList.add('mo-undid');
    });
    list.classList.add('mo-go');
    var hit = undid && list.querySelector('.mo-undid');
    if (hit) setTimeout(function () { hit.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 200);
  }

  /* ---------------------------------------------------------------- 2) 곡 카드 순서가 바뀌면 미끄러지기 (화면을 다시 불러오기 전후 위치 비교) */
  var before = null;
  document.addEventListener('ph:before-swap', function () {
    before = { path: location.pathname, at: {}, order: [] };
    $$('[data-song]').forEach(function (el) {
      var r = el.getBoundingClientRect(), id = el.getAttribute('data-song');
      before.at[id] = r.top + window.scrollY; before.order.push(id);
    });
  });
  function slideSongs() {
    var b = before; before = null;
    if (!b || b.path !== location.pathname || reduce()) return;
    var els = $$('[data-song]'), order = els.map(function (el) { return el.getAttribute('data-song'); });
    var same = b.order.filter(function (id) { return order.indexOf(id) !== -1; });
    var now = order.filter(function (id) { return same.indexOf(id) !== -1; });
    if (same.join('|') === now.join('|')) return;                              // 순서가 그대로면 움직이지 않음
    els.forEach(function (el) {
      var id = el.getAttribute('data-song');
      if (!(id in b.at) || same.indexOf(id) === now.indexOf(id)) return;
      var dy = b.at[id] - (el.getBoundingClientRect().top + window.scrollY);
      if (Math.abs(dy) < 4 || Math.abs(dy) > 2400) return;
      el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.3,1.25,.5,1)' });
    });
  }

  /* 악보 · 녹음 지우기 — 확인창에서 「확인」을 눌러 spa.js 가 실제로 보냈을 때만(form.__phSent) 구겨지는 모양 + 다음 화면에서 안내 */
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM' || !f.__phSent) return;
    f.__phSent = false;
    var act = f.getAttribute('action') || '';
    var kind = /\/conti\/sheets\/delete$/.test(act) ? '악보' : /\/conti\/recordings\/delete$/.test(act) ? '녹음' : '';
    if (!kind) return;
    ss.put('mo-toast', '지운 ' + kind + (kind === '악보' ? '는' : '은') + ' 변경기록에서 되돌릴 수 있어요');
    if (reduce()) return;
    var card = f.closest('.cn-sv') || f.closest('.ph-list-item');
    if (card) card.classList.add('mo-crumple');
  });

  /* ---------------------------------------------------------------- 3) 스케줄 — [data-mk]="날짜키|포지션" 칸, [data-mn]="이름" */
  var lastRects = {};
  function schedule() {
    var cells = $$('[data-mk]');
    if (!cells.length) return;
    var team = ''; try { team = new URL(location.href).searchParams.get('team') || ''; } catch (e) {}
    var key = 'mo-sched:' + team + ':' + location.pathname;
    var prev = store.get(key) || {}, next = Object.assign({}, prev), first = !Object.keys(prev).length;
    var rects = {}, budget = 14, quiet = reduce();
    cells.forEach(function (c) {
      var mk = c.getAttribute('data-mk');
      var names = $$('[data-mn]', c).map(function (s) { return s.getAttribute('data-mn'); });
      $$('[data-mn]', c).forEach(function (s) { rects[mk.split('|')[0] + '|' + s.getAttribute('data-mn')] = { mk: mk, r: s.getBoundingClientRect() }; });
      var old = prev[mk];
      next[mk] = names;
      if (first || quiet || !old || budget <= 0) return;
      $$('[data-mn]', c).forEach(function (s) {
        var n = s.getAttribute('data-mn');
        if (old.indexOf(n) !== -1 || budget <= 0) return;
        budget--;
        var from = lastRects[mk.split('|')[0] + '|' + n];
        if (from && from.mk !== mk) {                                            // 같은 날 다른 칸에서 옮겨 옴 → 폴짝
          var r = s.getBoundingClientRect(), dx = from.r.left - r.left, dy = from.r.top - r.top;
          s.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(' + dx / 2 + 'px,' + (dy / 2 - 22) + 'px)', offset: 0.5 }, { transform: 'none' }], { duration: 560, easing: 'ease-out' });
        } else {                                                                 // 미정 → 이름: 손글씨처럼
          s.classList.remove('mo-write'); void s.offsetWidth; s.classList.add('mo-write');
        }
      });
    });
    lastRects = rects;
    store.set(key, next);
  }
  var schedT = 0;
  function schedSoon() { clearTimeout(schedT); schedT = setTimeout(schedule, 40); }

  /* ---------------------------------------------------------------- 4) 홈 — 다음 섬김 날짜가 바뀌면 한 장 넘기기 */
  function home() {
    var d = document.querySelector('.hm-next-d:not([data-mo])');
    if (!d) return;
    d.setAttribute('data-mo', '1');
    var now = d.textContent.trim(), was = store.get('mo-next');
    store.set('mo-next', now);
    if (!was || was === now || reduce()) return;
    var o = document.createElement('span'), n = document.createElement('span');
    o.className = 'mo-old'; o.textContent = was; o.setAttribute('aria-hidden', 'true');
    n.className = 'mo-new'; n.textContent = now;
    d.textContent = ''; d.appendChild(o); d.appendChild(n);
    d.classList.add('mo-flip');
    var dd = document.querySelector('.hm-dday');
    if (dd) dd.classList.add('mo-flip2');
  }

  function run() {
    history();
    slideSongs();
    home();
    schedSoon();
    var msg = ss.take('mo-toast');
    if (msg) toast(msg);
  }
  document.addEventListener('ph:content-updated', run);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  // 스케줄은 화면 안에서 다시 그려지므로(칸 배정 · 보기 바꾸기) 바뀔 때마다 비교
  try { new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) { if (ms[i].addedNodes.length) { schedSoon(); return; } } }).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
