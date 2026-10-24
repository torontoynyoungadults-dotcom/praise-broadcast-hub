/**
 * 나의 스케줄 — 스케줄표 위 [나의 스케줄] 단추 (routes/schedule.js)
 *  · 앞으로 3개월 동안 내가 서는 주일(· 주일 외 찬양)과 그 연습일을 한 목록으로 (GET /cal/mine)
 *  · 넣을 날을 체크 → 구글 캘린더(하나씩 열어 추가) 또는 아이폰 · 맥 캘린더 파일(.ics, 한 번에)
 *  · 넣은 날은 이 기기에 기억해 ✓ "추가함"으로 보이고, 다음에 열 때는 아직 안 넣은 날만 체크된 채로 시작
 */
(function () {
  if (window.__phMySched) return;
  window.__phMySched = true;
  var KEY = 'ph.cal.added';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  var st = null;

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function added() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function markAdded(ids) { var a = added(); ids.forEach(function (id) { a[id] = Date.now(); }); try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function md(d) { var x = new Date(d + 'T12:00:00'); return { mon: (x.getMonth() + 1) + '월', day: x.getDate(), dow: DOW[x.getDay()] }; }

  function shell() {
    var d = document.createElement('div');
    d.className = 'msd-back';
    d.innerHTML = '<div class="msd" role="dialog" aria-modal="true" aria-labelledby="msd-h">' +
      '<div class="msd-top"><div class="msd-tr"><h2 id="msd-h">나의 스케줄</h2><button type="button" class="msd-x" data-msd-close aria-label="닫기">' + CLOSE + '</button></div>' +
      '<p class="msd-sub">내가 서는 주일과 연습일을 내 캘린더에 넣어요. 넣을 날만 체크해 주세요.</p></div>' +
      '<div class="msd-bar"><button type="button" class="msd-all" data-msd-all><span class="msd-box"></span>전체 선택</button><span class="msd-cnt" data-msd-cnt></span></div>' +
      '<ul class="msd-list" data-msd-list><li class="msd-wait">불러오는 중…</li></ul>' +
      '<div class="msd-foot" data-msd-foot></div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    return d;
  }
  function close() { if (st && st.el) st.el.remove(); st = null; document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function render() {
    var el = st.el, list = el.querySelector('[data-msd-list]'), a = added();
    if (st.err) { list.innerHTML = '<li class="msd-wait">' + esc(st.err) + '</li>'; return; }
    if (!st.items) return;
    if (!st.items.length) { list.innerHTML = '<li class="msd-wait">앞으로 3개월 안에 내가 서는 날이 없어요.</li>'; el.querySelector('[data-msd-foot]').innerHTML = ''; el.querySelector('.msd-bar').hidden = true; return; }
    var lastMon = '';
    list.innerHTML = st.items.map(function (it) {
      var on = !!st.sel[it.id], d = md(it.date), mon = d.mon, head = '';
      if (mon !== lastMon) { lastMon = mon; head = '<li class="msd-mon">' + esc(mon) + '</li>'; }
      return head + '<li><button type="button" class="msd-it' + (on ? ' on' : '') + (it.off ? ' off' : '') + '" data-msd-it="' + esc(it.id) + '" aria-pressed="' + on + '">' +
        '<span class="msd-box">' + (on ? CHECK : '') + '</span>' +
        '<span class="msd-date"><b>' + d.day + '</b><i>' + d.dow + '</i></span>' +
        '<span class="msd-k ' + it.kind + '">' + (it.kind === 'sun' ? '주일' : '연습') + '</span>' +
        '<span class="msd-tx"><b>' + esc(it.title) + '</b><small>' + esc(it.detail) + (it.off ? ' · 불가로 표시함' : '') + '</small></span>' +
        (a[it.id] ? '<span class="msd-done" title="이 기기에서 캘린더에 넣었어요">' + CHECK + '추가함</span>' : '') +
        '</button></li>';
    }).join('');
    var n = st.items.filter(function (it) { return st.sel[it.id]; }).length, all = n === st.items.length;
    el.querySelector('[data-msd-cnt]').textContent = '앞으로 3개월 · ' + n + '개 선택';
    var ab = el.querySelector('[data-msd-all]'); ab.classList.toggle('on', all); ab.querySelector('.msd-box').innerHTML = all ? CHECK : '';
    var foot = el.querySelector('[data-msd-foot]');
    if (st.google) {
      var picked = st.items.filter(function (it) { return st.sel[it.id]; });
      foot.innerHTML = '<p class="msd-note">구글 캘린더는 한 번에 하나씩 열려요. 차례로 눌러 저장해 주세요.</p>' +
        '<div class="msd-steps">' + picked.map(function (it) {
          var done = !!a[it.id], d = md(it.date);
          return '<a class="msd-step' + (done ? ' done' : '') + '" href="' + esc(it.google) + '" target="_blank" rel="noopener" data-msd-g="' + esc(it.id) + '">' +
            '<span class="msd-box">' + (done ? CHECK : '') + '</span><span>' + d.mon + ' ' + d.day + '일 ' + (it.kind === 'sun' ? '주일' : '연습') + '</span><em>' + (done ? '추가함' : '열기') + '</em></a>';
        }).join('') + '</div>' +
        '<button type="button" class="msd-btn" data-msd-back>목록으로</button>';
    } else {
      foot.innerHTML = '<button type="button" class="msd-btn pri" data-msd-google' + (n ? '' : ' disabled') + '>' +
          '<svg class="msd-gcal" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3" fill="#fff"/><rect x="3" y="4" width="18" height="5" rx="2" fill="rgba(0,0,0,.25)"/><text x="12" y="18" text-anchor="middle" font-size="8" font-weight="700" fill="#1B2420">31</text></svg>' +
          '구글 캘린더에 ' + n + '개 추가</button>' +
        '<button type="button" class="msd-btn" data-msd-ics' + (n ? '' : ' disabled') + '>' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" class="msd-dl"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>아이폰 · 맥 캘린더용 파일 받기 (.ics)</button>' +
        '<p class="msd-note">스케줄이 바뀌면 알림으로 알려 드려요. 바뀐 날은 다시 넣어 주세요.</p>';
    }
  }

  function open(team) {
    if (st) close();
    st = { team: team, el: shell(), items: null, sel: {}, google: false };
    document.addEventListener('keydown', onKey);
    var x = st.el.querySelector('[data-msd-close]'); if (x) x.focus();
    var me = st;
    fetch('/cal/mine?team=' + encodeURIComponent(team), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      if (st !== me) return;
      if (!j || !j.ok) throw new Error((j && j.error) || '불러오지 못했어요.');
      var a = added();
      st.items = j.result.items || [];
      st.items.forEach(function (it) { st.sel[it.id] = !a[it.id] && !it.off; });     // 아직 안 넣은 날 · 불가가 아닌 날만 미리 체크
      if (!st.items.some(function (it) { return st.sel[it.id]; })) st.items.forEach(function (it) { st.sel[it.id] = !it.off; });
      render();
    }).catch(function (e) { if (st !== me) return; st.err = (e && e.message) || '불러오지 못했어요.'; render(); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var b;
    if ((b = t.closest('[data-mysched]'))) { e.preventDefault(); open(b.getAttribute('data-team') || ''); return; }
    if (!st || !st.el.contains(t)) return;
    if (t.closest('[data-msd-close]')) { close(); return; }
    if ((b = t.closest('[data-msd-it]'))) { var id = b.getAttribute('data-msd-it'); st.sel[id] = !st.sel[id]; render(); return; }
    if (t.closest('[data-msd-all]')) { var all = st.items.every(function (it) { return st.sel[it.id]; }); st.items.forEach(function (it) { st.sel[it.id] = !all; }); render(); return; }
    if (t.closest('[data-msd-google]')) { st.google = true; render(); return; }
    if (t.closest('[data-msd-back]')) { st.google = false; render(); return; }
    if ((b = t.closest('[data-msd-g]'))) { markAdded([b.getAttribute('data-msd-g')]); setTimeout(render, 0); return; }     // 링크는 그대로 새 창으로
    if (t.closest('[data-msd-ics]')) {
      var ids = st.items.filter(function (it) { return st.sel[it.id]; }).map(function (it) { return it.id; });
      if (!ids.length) return;
      location.href = '/cal/mine.ics?team=' + encodeURIComponent(st.team) + '&ids=' + encodeURIComponent(ids.join(','));
      markAdded(ids); render();
    }
  });
})();
