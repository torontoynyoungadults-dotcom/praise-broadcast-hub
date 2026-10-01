/* church-app public/worship/stats.js 그대로 (떠 있는 창을 .yn 안에 띄우도록 1곳만 고침 — tools/port-church-hub.js) */
/**
 * 통계 자세히 보기 팝업 (다크 글래스모피즘) — 기존 YC.sheet(밝은 시트)를 대신합니다
 * ------------------------------------------------------------
 *  · 계산(누가 몇 번 · 어떤 Key)은 Worship.html 의 기존 코드(statItems · lineup …)가 그대로 하고, 이 파일은 "보여주기"만 맡습니다
 *  · YNStats.list({title, sub, rows:[{name, n, unit?}], onRow(i)})    한 사람/팀의 곡 목록 (막대그래프)
 *  · YNStats.song({title, sub, tiles:[[값, 이름]], spark:{labels,values}, groups:[{label, chips:[[이름, 횟수]]}], dates:[{date, soon, meta}]})   곡 하나 자세히
 *  · 목록에서 곡을 누르면 같은 팝업 안에서 넘어가고, "‹ 뒤로"로 목록에 돌아옵니다 (겹겹이 쌓이지 않음)
 *  · 접근성: role=dialog · Esc/바깥 누르면 닫힘 · 키보드 포커스 가둠 · 아래로 쓸어내려 닫기(터치) · 움직임 줄이기 설정 존중
 */
(function (root) {
  'use strict';
  var doc = root.document, ov = null, stack = [], opener = null, prevOverflow = '';

  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }

  /* ---------------- 그리기 (순수 함수: 문자열만 만듭니다) ---------------- */
  function listHtml(o) {
    var rows = o.rows || [], max = 1;
    rows.forEach(function (r) { if (num(r.n) > max) max = num(r.n); });
    return '<header class="yg-head"><h3 id="yg-title">' + h(o.title) + '</h3>' + (o.sub ? '<p class="yg-sub">' + h(o.sub) + '</p>' : '') + '</header>' +
      (rows.length ? '<ol class="yg-rows">' + rows.map(function (r, i) {
        var w = Math.max(3, Math.round(num(r.n) / max * 100));
        return '<li><button type="button" class="yg-row" data-row="' + i + '"><span class="yg-rk">' + (i + 1) + '</span>' +
          '<span class="yg-rb"><span class="yg-rt">' + h(r.name) + '</span><span class="yg-trk"><span class="yg-fill" style="width:' + w + '%"></span></span></span>' +
          '<span class="yg-rn">' + num(r.n) + '<small>' + h(r.unit || '회') + '</small></span><span class="yg-go" aria-hidden="true">›</span></button></li>';
      }).join('') + '</ol>' : '<p class="yg-empty">기록이 없습니다.</p>');
  }

  function chipsHtml(list) {
    if (!list || !list.length) return '<p class="yg-none">기록 없음</p>';
    return '<div class="yg-chips">' + list.map(function (c, i) {
      return '<span class="yg-chip' + (i === 0 && list.length > 1 ? ' top' : '') + '">' + h(c[0]) + (c[1] != null && c[1] !== '' ? ' <b>' + h(c[1]) + '</b>' : '') + '</span>';
    }).join('') + '</div>';
  }
  function sparkHtml(sp) {
    if (!sp || !sp.values || sp.values.length < 2) return '';
    var total = 0, max = 1; sp.values.forEach(function (v) { total += num(v); if (num(v) > max) max = num(v); });
    if (!total) return '';
    return '<section class="yg-sec"><h4>월별 횟수</h4><div class="yg-spark" role="img" aria-label="최근 월별로 부른 횟수">' + sp.values.map(function (v, i) {
      return '<div class="yg-sc" title="' + h(sp.labels && sp.labels[i] || '') + ' ' + num(v) + '회"><span class="yg-sv">' + (num(v) || '') + '</span><i style="height:' + (num(v) ? Math.max(6, Math.round(num(v) / max * 100)) : 2) + '%"></i><span class="yg-sl">' + h(sp.labels && sp.labels[i] || '') + '</span></div>';
    }).join('') + '</div></section>';
  }
  function songHtml(o) {
    return '<header class="yg-head"><h3 id="yg-title">' + h(o.title) + '</h3>' + (o.sub ? '<p class="yg-sub">' + h(o.sub) + '</p>' : '') + '</header>' +
      (o.tiles && o.tiles.length ? '<div class="yg-tiles">' + o.tiles.map(function (t) { return '<div class="yg-tile"><b>' + h(t[0]) + '</b><span>' + h(t[1]) + '</span></div>'; }).join('') + '</div>' : '') +
      sparkHtml(o.spark) +
      (o.groups || []).map(function (g) { return '<section class="yg-sec"><h4>' + h(g.label) + '</h4>' + chipsHtml(g.chips) + '</section>'; }).join('') +
      '<section class="yg-sec"><h4>부른 날</h4>' + ((o.dates || []).length ? '<ol class="yg-tl">' + o.dates.map(function (d) {
        return '<li' + (d.soon ? ' class="soon"' : '') + '><time>' + h(d.date) + '</time>' + (d.soon ? '<em>예정</em>' : '') + '<span>' + h(d.meta) + '</span></li>';
      }).join('') + '</ol>' : '<p class="yg-none">기록 없음</p>') + '</section>';
  }

  /* ---------------- 팝업 ---------------- */
  function focusables() { return ov ? Array.prototype.filter.call(ov.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; }) : []; }
  function onKey(e) {
    if (!ov) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      var f = focusables(); if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1], a = doc.activeElement;
      if (e.shiftKey && (a === first || a === ov.querySelector('.yg-sh'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }
  }
  function ensure() {
    if (ov) return;
    opener = doc.activeElement; prevOverflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden';
    ov = doc.createElement('div'); ov.className = 'yg yg-ov';
    ov.innerHTML = '<div class="yg-sh" role="dialog" aria-modal="true" aria-labelledby="yg-title" tabindex="-1"><div class="yg-grab" aria-hidden="true"></div>' +
      '<div class="yg-bar"><button type="button" class="yg-back" hidden>‹ 뒤로</button><button type="button" class="yg-x" aria-label="닫기">×</button></div><div class="yg-body"></div></div>';
    ynPortal().appendChild(ov);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.yg-x').onclick = function () { close(); };
    ov.querySelector('.yg-back').onclick = function () { back(); };
    ov.addEventListener('click', function (e) {
      var r = e.target.closest ? e.target.closest('[data-row]') : null; if (!r || !stack.length) return;
      var top = stack[stack.length - 1]; try { top.opts.onRow && top.opts.onRow(+r.getAttribute('data-row')); } catch (x) { if (root.console) root.console.error(x); }
    });
    /* 아래로 쓸어내려 닫기 (손잡이를 잡고) */
    var sh = ov.querySelector('.yg-sh'), grab = ov.querySelector('.yg-grab'), y0 = null;
    grab.addEventListener('pointerdown', function (e) { y0 = e.clientY; try { grab.setPointerCapture(e.pointerId); } catch (x) {} });
    grab.addEventListener('pointermove', function (e) { if (y0 == null) return; var dy = Math.max(0, e.clientY - y0); sh.style.transform = 'translateY(' + dy + 'px)'; });
    grab.addEventListener('pointerup', function (e) { if (y0 == null) return; var dy = e.clientY - y0; y0 = null; if (dy > 90) close(); else sh.style.transform = ''; });
    doc.addEventListener('keydown', onKey, true);
    root.requestAnimationFrame(function () { if (ov) { ov.classList.add('on'); try { sh.focus({ preventScroll: true }); } catch (x) {} } });
  }
  function paint() {
    if (!ov) return; var top = stack[stack.length - 1];
    ov.querySelector('.yg-body').innerHTML = top.html; ov.querySelector('.yg-body').scrollTop = 0;
    ov.querySelector('.yg-back').hidden = stack.length < 2;
    var t = ov.querySelector('#yg-title'); if (t) t.setAttribute('tabindex', '-1');
  }
  /** html 을 띄웁니다. replace=true 면 쌓지 않고 바꿉니다. */
  function show(html, opts, replace) {
    ensure(); if (replace) stack = [];
    stack.push({ html: html, opts: opts || {} }); paint();
  }
  function back() { if (stack.length > 1) { stack.pop(); paint(); } }
  function close(now) {
    if (!ov) return;
    var x = ov, cbs = stack.map(function (s) { return s.opts.onClose; }); ov = null; stack = [];
    doc.removeEventListener('keydown', onKey, true); doc.body.style.overflow = prevOverflow;
    var done = function () { x.remove(); try { opener && opener.focus && opener.focus(); } catch (e) {} cbs.forEach(function (f) { try { f && f(); } catch (e) {} }); };
    if (now) done(); else { x.classList.remove('on'); setTimeout(done, 200); }
  }

  root.YNStats = {
    list: function (o) { show(listHtml(o || {}), o || {}, !ov); },              // 목록은 새로 시작
    song: function (o) { show(songHtml(o || {}), o || {}, false); },            // 곡 자세히는 위에 쌓음 (열려 있지 않으면 새로)
    close: close, back: back, isOpen: function () { return !!ov; }, listHtml: listHtml, songHtml: songHtml, h: h
  };
}(typeof self !== 'undefined' ? self : this));
