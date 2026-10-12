/**
 * 라이브 악보 v10 — 도구 창 (YNToolPop)
 * ------------------------------------------------------------
 *  (1) stylePop  : 색 · 굵기 · 글꼴 · 글자 크기 · 글자 바탕/테두리를 한 곳에서 고르는 작은 창.
 *                  도구 막대를 접었거나(태블릿) 폰 화면이어도 떠 있는 "색 단추"(qchip)로 언제든 열 수 있습니다.
 *                  화면 가장자리를 넘지 않게 자리를 잡고(좁은 화면은 아래쪽 시트), 바깥을 누르거나 Esc 로 닫힙니다.
 *  (2) symPicker : 기호 + 음표 · 쉼표를 하나로 합친 팔레트. 위쪽 막대를 끌어 어디든 옮기고(기기에 기억),
 *                  ▾ 로 접고, 분류(음표 · 쉼표 · 임시표 · 셈여림 · 아티큘레이션 · 반복 · 표시)를 눌러 바꿉니다.
 *                  기호 그림은 처음 한 번만 그려 그림 주소(dataURL)로 기억 — 열 때마다 캔버스를 수십 개 만들지 않습니다.
 *
 *  성능 원칙: 매 프레임 하는 일 없음 · 끌기는 transform(합성만) · 이벤트는 위임 하나 · 닫으면 DOM 을 숨기기만.
 *  화면(practice.js)이 상태를 들고 있고, 이 파일은 그리기 · 입력만 맡습니다.
 */
(function (root) {
  'use strict';
  var doc = root.document;

  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lsGet(k) { try { return root.localStorage.getItem('yn.tp.' + k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null || v === '') root.localStorage.removeItem('yn.tp.' + k); else root.localStorage.setItem('yn.tp.' + k, v); } catch (e) { /* 저장이 막힌 브라우저 */ } }
  function okHex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }
  function isLight(c) { var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ''); return !!m && (parseInt(m[1], 16) * 0.3 + parseInt(m[2], 16) * 0.59 + parseInt(m[3], 16) * 0.11) > 200; }

  /* ------------------------------------------------------------ 최근에 고른 내 색 (직접 고른 색만 · 최대 6개) */
  function recentColors() { try { var a = JSON.parse(lsGet('recent') || '[]'); return Array.isArray(a) ? a.filter(okHex).slice(0, 6) : []; } catch (e) { return []; } }
  function pushRecent(c) { if (!okHex(c)) return; c = c.toLowerCase(); var a = recentColors().filter(function (x) { return x.toLowerCase() !== c; }); a.unshift(c); lsSet('recent', JSON.stringify(a.slice(0, 6))); }

  /* ============================================================ (1) 색 · 굵기 창 */
  /**
   * stylePop({ host, ctx })
   *   host = 창을 넣을 뿌리 요소 (.pv) — 창은 host 기준 absolute
   *   ctx  = { model() → 아래 모양, set(key, value) → 바꾸기 }
   *   model: { kind:'ink'|'text'|'sym'|'stroke', tool, title, color, colors[], moreColors[], names{},
   *            width, wRange:[a,b], wPresets[], slots[], slot, size, sRange:[a,b], font, fonts[{k,n}], bg, bd, bgColors[], bdColors[], locked }
   */
  function stylePop(o) {
    var host = o.host, ctx = o.ctx, el = doc.createElement('div'), anchor = null, open = false, sliding = false;
    el.className = 'tp-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '색 · 굵기'); el.hidden = true;
    host.appendChild(el);

    function sw(c, on, attr, names) {
      var nm = (names && names[c]) || c;
      return '<button type="button" class="tp-sw' + (on ? ' on' : '') + (isLight(c) ? ' lt' : '') + '" ' + attr + '="' + c + '" style="--c:' + c + '" title="' + h(nm) + '" aria-label="' + h(nm) + '" aria-pressed="' + !!on + '"></button>';
    }
    function fillPct(v, r) { return Math.round(clamp((v - r[0]) / ((r[1] - r[0]) || 1), 0, 1) * 1000) / 10; }
    function lineSvg(w, col) { var t = clamp(w, 0.6, 22); return '<svg viewBox="0 0 120 28" aria-hidden="true"><path d="M8 18 C 34 4, 58 26, 84 12 S 108 10, 112 14" fill="none" stroke="' + col + '" stroke-width="' + t.toFixed(1) + '" stroke-linecap="round"' + (col && col !== '#ffffff' ? '' : ' class="tp-ln-w"') + '/></svg>'; }
    function render() {
      var m = ctx.model(); if (!m) { hide(); return; }
      var lk = m.locked ? ' disabled' : '', cur = (m.color || '').toLowerCase(), rec = recentColors(), html = '';
      html += '<div class="tp-head"><b>' + h(m.title || '스타일') + '</b><button type="button" class="tp-x" data-tp="close" aria-label="닫기" title="닫기">✕</button></div>';
      if (m.colors && m.colors.length) {
        var all = m.colors.concat((m.moreColors || []).filter(function (c) { return m.colors.indexOf(c) < 0; }));
        html += '<div class="tp-sec"><div class="tp-lb">색</div><div class="tp-sws">' + all.map(function (c) { return sw(c, c.toLowerCase() === cur, 'data-col', m.names); }).join('') +
          '<label class="tp-sw tp-cust" title="직접 고르기" aria-label="색 직접 고르기"><input type="color" data-tp="cust" value="' + (okHex(cur) ? cur : '#e53935') + '"' + lk + '><span>+</span></label></div>' +
          (rec.length ? '<div class="tp-subl">최근에 고른 색</div><div class="tp-sws">' + rec.map(function (c) { return sw(c, c.toLowerCase() === cur, 'data-col', null); }).join('') + '</div>' : '') + '</div>';
      }
      if (m.kind === 'ink' && m.wRange) {
        var r = m.wRange, step = r[1] < 0.03 ? 0.0001 : 0.0005;
        html += '<div class="tp-sec"><div class="tp-lb">굵기<span class="tp-prev">' + lineSvg(m.dot || 3, m.tool === 'white' ? '#ffffff' : (m.color || '#111')) + '</span></div>' +
          '<div class="tp-wps">' + (m.wPresets || []).map(function (v, i) { var on = Math.abs(v - m.width) < 1e-6; return '<button type="button" class="tp-wp' + (on ? ' on' : '') + '" data-w="' + v + '" title="' + (m.wNames && m.wNames[i] ? h(m.wNames[i]) : '굵기') + '" aria-pressed="' + on + '"><i style="--s:' + (m.dots ? m.dots[i] : 4) + 'px"></i></button>'; }).join('') + '</div>' +
          '<input class="tp-range" type="range" data-tp="w" min="' + r[0] + '" max="' + r[1] + '" step="' + step + '" value="' + m.width + '" style="--fill:' + fillPct(m.width, r) + '%" aria-label="굵기 세밀하게">' +
          (m.slots ? '<div class="tp-slots"><span class="tp-mini">저장 칸</span>' + m.slots.map(function (v, i) { return '<button type="button" class="tp-slot' + (i === m.slot ? ' on' : '') + '" data-slot="' + i + '" aria-pressed="' + (i === m.slot) + '" title="굵기 칸 ' + (i + 1) + ' — 고른 굵기가 이 칸에 저장됩니다">' + (i + 1) + '</button>'; }).join('') + '</div>' : '') + '</div>';
      }
      if (m.kind === 'text' && m.fonts) {
        html += '<div class="tp-sec"><div class="tp-row"><label class="tp-fl"><span class="tp-lb">글꼴</span><select data-tp="font"' + lk + '>' + m.fonts.map(function (f) { return '<option value="' + h(f.k) + '"' + (f.k === m.font ? ' selected' : '') + '>' + h(f.n) + '</option>'; }).join('') + '</select></label></div>' +
          '<div class="tp-fprev" style="font-family:' + h(m.fontCss || 'inherit') + ';color:' + h(okHex(m.color) ? m.color : '#111') + '">가나다라 마바사 ABC abc 123</div></div>';
      }
      if (m.kind === 'text' || m.kind === 'sym') {
        var sr = m.sRange || [0.012, 0.08], sv = Math.round(m.size * 1000), sp = m.sPresets || [];
        html += '<div class="tp-sec"><div class="tp-lb">크기<span class="tp-step"><button type="button" data-tp="sz-" aria-label="작게"' + lk + '>−</button><output>' + sv + '</output><button type="button" data-tp="sz+" aria-label="크게"' + lk + '>+</button></span></div>' +
          '<div class="tp-szps">' + sp.map(function (v, i) { var on = Math.abs(v - sv) < 0.5; return '<button type="button" class="tp-szp' + (on ? ' on' : '') + '" data-sz="' + v + '" aria-pressed="' + on + '" title="크기 ' + v + '"' + lk + '><span style="font-size:' + (11 + i * 3) + 'px">가</span></button>'; }).join('') + '</div>' +
          '<input class="tp-range" type="range" data-tp="sz" min="' + Math.round(sr[0] * 1000) + '" max="' + Math.round(sr[1] * 1000) + '" step="1" value="' + sv + '" style="--fill:' + fillPct(sv / 1000, sr) + '%" aria-label="크기 세밀하게"' + lk + '></div>';
      }
      if (m.kind === 'text') {
        var bgOn = okHex(m.bg), bdOn = okHex(m.bd);
        html += '<div class="tp-sec"><div class="tp-tg"><button type="button" class="tp-tog' + (bgOn ? ' on' : '') + '" data-tp="bg" aria-pressed="' + bgOn + '"' + lk + '><i class="tp-ico-bg"></i>바탕</button>' +
          '<button type="button" class="tp-tog' + (bdOn ? ' on' : '') + '" data-tp="bd" aria-pressed="' + bdOn + '"' + lk + '><i class="tp-ico-bd"></i>테두리</button>' +
          '<span class="tp-sample" style="' + (bgOn ? 'background:' + m.bg + ';' : '') + (bdOn ? 'box-shadow:inset 0 0 0 1.6px ' + m.bd + ';' : '') + 'color:' + (m.color || '#111') + '">Aa 가</span></div>' +
          (bgOn ? '<div class="tp-subl">바탕색</div><div class="tp-sws">' + (m.bgColors || []).map(function (c) { return sw(c, c.toLowerCase() === m.bg.toLowerCase(), 'data-bg', m.names); }).join('') + '<label class="tp-sw tp-cust" aria-label="바탕색 직접 고르기"><input type="color" data-tp="custbg" value="' + m.bg + '"' + lk + '><span>+</span></label></div>' : '') +
          (bdOn ? '<div class="tp-subl">테두리색</div><div class="tp-sws">' + (m.bdColors || []).map(function (c) { return sw(c, c.toLowerCase() === m.bd.toLowerCase(), 'data-bd', m.names); }).join('') + '<label class="tp-sw tp-cust" aria-label="테두리색 직접 고르기"><input type="color" data-tp="custbd" value="' + m.bd + '"' + lk + '><span>+</span></label></div>' : '') + '</div>';
      }
      if (m.locked) html += '<p class="tp-note">다른 사람이 쓴 필기라 바꿀 수 없습니다.</p>';
      el.innerHTML = html;
    }
    /** 자리 — 단추 아래(안 되면 위), 화면 밖으로 나가지 않게. 좁은 화면은 아래쪽 시트 */
    function place() {
      if (!open) return;
      var hr = host.getBoundingClientRect(), W = hr.width || root.innerWidth, H = hr.height || root.innerHeight, narrow = W < 560;
      var vt = Math.max(0, -hr.top), vb = Math.min(H, root.innerHeight - hr.top);                            // 화면에 실제로 보이는 띠 (host 가 화면보다 길어도 창은 화면 안에)
      if (!(vb - vt > 120)) { vt = 0; vb = H; }
      el.classList.toggle('tp-sheet', narrow);
      if (narrow) { el.style.left = el.style.top = ''; el.style.maxHeight = Math.round((vb - vt) * 0.62) + 'px'; return; }
      if (anchor && !anchor.isConnected) anchor = host.querySelector('[data-a="style"]') || null;                 // 도구 막대를 다시 그려 단추가 바뀌었으면 새 단추 기준
      var w = el.offsetWidth || 300, hh = el.offsetHeight || 260, a = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      if (a && !a.width && !a.height) a = null;
      var x = a ? a.left - hr.left + a.width / 2 - w / 2 : (W - w) / 2, y = a ? a.bottom - hr.top + 8 : 60;
      hh = Math.min(hh, vb - vt - 16);
      if (a && y + hh > vb - 8) { var up = a.top - hr.top - hh - 8; y = up >= vt + 8 ? up : Math.max(vt + 8, vb - hh - 8); }
      if (a && a.left - hr.left > W * 0.7 && a.top - hr.top > 40 && a.height > a.width * 1.5) { x = a.left - hr.left - w - 8; y = a.top - hr.top; }     // 오른쪽 세로 막대 옆
      el.style.maxHeight = Math.round(vb - vt - 16) + 'px';
      el.style.left = Math.round(clamp(x, 8, Math.max(8, W - w - 8))) + 'px'; el.style.top = Math.round(clamp(y, vt + 8, Math.max(vt + 8, vb - hh - 8))) + 'px';
      fit(); if (root.requestAnimationFrame) root.requestAnimationFrame(fit);                              // 그린 뒤 실제 크기로 한 번 더 — 글꼴이 늦게 와서 창이 커져도 화면 밖으로 안 나가게
    }
    function fit() {
      if (!open || el.classList.contains('tp-sheet')) return;
      var r = el.getBoundingClientRect(), lim = root.innerHeight - 8, top = parseFloat(el.style.top) || 0;
      if (r.bottom > lim) el.style.top = Math.max(8, Math.round(top - (r.bottom - lim))) + 'px';
    }
    function show(a) { anchor = a || anchor; open = true; render(); el.hidden = false; place(); root.requestAnimationFrame(function () { el.classList.add('in'); }); doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', onKey, true); }
    function hide() { if (!open) return; open = false; el.classList.remove('in'); el.hidden = true; doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', onKey, true); if (o.onHide) try { o.onHide(); } catch (e) { /* 무시 */ } }
    function outside(e) { if (el.contains(e.target) || (anchor && anchor.contains && anchor.contains(e.target))) return; if (e.target.closest && e.target.closest('.an-editor,[data-a="style"],.tp-qchip')) return; hide(); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); hide(); } }
    function refresh() { if (!open || sliding) return; var ae = doc.activeElement, keep = ae && el.contains(ae) && ae.tagName === 'SELECT'; if (keep) return; render(); place(); }

    /* 글자를 치는 중에 단추를 눌러도 입력칸의 포커스를 뺏지 않음 (고르는 칸 · 색 칸은 예외) */
    el.addEventListener('pointerdown', function (e) { var t = e.target; if (t.closest && t.closest('button') && !t.closest('label')) e.preventDefault(); });
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.disabled) return;
      var d = b.dataset;
      if (d.tp === 'close') { hide(); return; }
      if (d.col) { ctx.set('color', d.col); }
      else if (d.bg) { ctx.set('bg', d.bg); }
      else if (d.bd) { ctx.set('bd', d.bd); }
      else if (d.w != null) { ctx.set('width', +d.w); }
      else if (d.slot != null) { ctx.set('slot', +d.slot); }
      else if (d.tp === 'sz-' || d.tp === 'sz+') { ctx.set('size', d.tp === 'sz+' ? 1 : -1); }
      else if (d.sz != null) { ctx.set('sizeTo', +d.sz / 1000); }
      else if (d.tp === 'bg' || d.tp === 'bd') { var m = ctx.model(); ctx.set(d.tp, okHex(m[d.tp]) ? '' : (d.tp === 'bg' ? (m.lastBg || '#fff3b0') : (m.lastBd || '#111111'))); }
      render(); place();
    });
    el.addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset.tp === 'sz') { sliding = true; ctx.set('sizeTo', +t.value / 1000, true); var m2 = ctx.model(); if (m2 && m2.sRange) t.style.setProperty('--fill', fillPct(+t.value / 1000, m2.sRange) + '%'); var ou = el.querySelector('.tp-step output'); if (ou) ou.textContent = t.value; return; }
      if (t.dataset.tp === 'w') { sliding = true; ctx.set('width', +t.value, true); var pv = el.querySelector('.tp-prev'); var m = ctx.model(); if (m && m.wRange) t.style.setProperty('--fill', fillPct(+t.value, m.wRange) + '%'); if (pv && m) pv.innerHTML = lineSvg(m.dot || 3, m.tool === 'white' ? '#ffffff' : (m.color || '#111')); }
    });
    el.addEventListener('change', function (e) {
      var t = e.target, k = t.dataset.tp;
      if (k === 'sz') { sliding = false; ctx.set('sizeTo', +t.value / 1000); render(); return; }
      if (k === 'w') { sliding = false; ctx.set('width', +t.value); render(); return; }
      if (k === 'font') { ctx.set('font', t.value); render(); return; }
      if (k === 'cust' || k === 'custbg' || k === 'custbd') { if (!okHex(t.value)) return; pushRecent(t.value); ctx.set(k === 'cust' ? 'color' : k === 'custbg' ? 'bg' : 'bd', t.value.toLowerCase()); render(); place(); }
    });
    root.addEventListener('resize', function () { if (open) place(); });
    return { el: el, show: show, hide: hide, toggle: function (a) { if (open) hide(); else show(a); }, refresh: refresh, isOpen: function () { return open; }, contains: function (n) { return !!n && el.contains(n); } };
  }

  /* ============================================================ 떠 있는 색 단추 (도구 막대를 접었을 때 · 폰) */
  function qchip(o) {
    var b = doc.createElement('button'); b.type = 'button'; b.className = 'tp-qchip'; b.hidden = true;
    b.setAttribute('aria-label', '색 · 굵기 바꾸기'); b.title = '색 · 굵기 바꾸기';
    b.innerHTML = '<i class="tp-qdot"></i>';
    o.host.appendChild(b);
    b.addEventListener('pointerdown', function (e) { e.stopPropagation(); e.preventDefault(); });
    b.addEventListener('click', function (e) { e.stopPropagation(); o.onTap(b); });
    var last = '';
    return {
      el: b,
      set: function (s) {
        var sig = s ? (s.show ? 1 : 0) + s.color + '|' + s.dot + '|' + (s.hl ? 1 : 0) : '0';
        if (sig === last) return; last = sig;
        if (!s || !s.show) { b.hidden = true; return; }
        b.hidden = false; b.style.setProperty('--c', s.color || '#111'); b.style.setProperty('--s', clamp(s.dot || 8, 4, 20) + 'px'); b.classList.toggle('hl', !!s.hl); b.classList.toggle('lt', isLight(s.color));
      }
    };
  }

  /* ============================================================ (2) 기호 · 음표 팔레트 */
  var CATS = [
    { id: 'note', n: '음표' }, { id: 'rest', n: '쉼표' }, { id: 'acc', n: '임시표' }, { id: 'dyn', n: '셈여림' },
    { id: 'art', n: '연주법' }, { id: 'nav', n: '반복 · 구조' }, { id: 'mark', n: '표시' }
  ];
  var CAT_OF = {
    sharp: 'acc', flat: 'acc', natural: 'acc', 'g:sharp': 'acc', 'g:flat': 'acc',
    cresc: 'dyn', decresc: 'dyn',
    accent: 'art', staccato: 'art', tenuto: 'art', fermata: 'art', breath: 'art', tie: 'art',
    segno: 'nav', coda: 'nav', repeatStart: 'nav', repeatEnd: 'nav', 'dyn:dc': 'nav', 'dyn:ds': 'nav', 'dyn:tocoda': 'nav', 'dyn:fine': 'nav',
    'g:quarter': 'note', 'g:eighth': 'note'
  };
  function catOf(k) {
    if (CAT_OF[k]) return CAT_OF[k];
    if (k.indexOf('n:r') === 0) return 'rest';
    if (k.indexOf('n:') === 0) return 'note';
    if (k.indexOf('dyn:') === 0) return 'dyn';
    return 'mark';
  }
  var ICONS = {};
  function iconOf(k, drawItem, stretch) {
    if (ICONS[k]) return ICONS[k];
    try {
      var c = doc.createElement('canvas'); c.width = c.height = 80;
      var g = c.getContext('2d'), sz = k === 'n:16b' ? 0.25 : k === 'n:3' ? 0.32 : (k === 'n:hd' || k === 'n:ho') ? 0.85 : k.indexOf('dyn:') === 0 ? (k.length > 6 ? 0.3 : 0.44) : 0.42;
      drawItem(g, { t: 'sym', k: k, c: '#16161c', x: stretch[k] ? 0.14 : 0.5, y: 0.52, sz: sz, w2: 0.72 }, 80, 80);
      ICONS[k] = c.toDataURL('image/png'); c.width = c.height = 0;
    } catch (e) { ICONS[k] = ''; }
    return ICONS[k];
  }

  /**
   * symPicker({ el, symbols, drawItem, stretch, current(), onPick(k), onClose(), toast(t) })
   *   el = 팔레트를 담을 칸 (악보 화면 안의 .pv-sympop — 기존 터치 예외 처리를 그대로 받음)
   */
  function symPicker(o) {
    var el = o.el, built = false, cat = lsGet('symcat') || '', d = null, folded = lsGet('symfold') === '1';
    el.classList.add('tp-symv2'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '기호 · 음표');
    function list(c) { return o.symbols.filter(function (s) { return catOf(s.k) === c; }); }
    function cats() { return CATS.filter(function (c) { return list(c.id).length; }); }
    function nameOf(k) { var s = o.symbols.filter(function (x) { return x.k === k; })[0]; return s ? s.n : ''; }
    function build() {
      built = true;
      if (!cat || !cats().some(function (c) { return c.id === cat; })) cat = catOf(o.current() || 'n:4');
      el.innerHTML = '<div class="tp-symhead" title="끌어서 옮기기 · 두 번 누르면 처음 자리로"><span class="tp-grip" aria-hidden="true"></span><b>기호 · 음표</b><span class="tp-cur"></span>' +
        '<button type="button" class="tp-ib" data-sp="fold" aria-label="접기 / 펼치기" title="접기 / 펼치기"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '<button type="button" class="tp-ib" data-sp="close" aria-label="닫기" title="기호 도구 끝내기"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>' +
        '<div class="tp-cats" role="tablist"></div><div class="tp-grid" role="listbox" aria-label="기호"></div>';
      paintCats(); paintGrid(); paintCur();
    }
    function paintCats() { el.querySelector('.tp-cats').innerHTML = cats().map(function (c) { return '<button type="button" role="tab" class="tp-cat' + (c.id === cat ? ' on' : '') + '" data-cat="' + c.id + '" aria-selected="' + (c.id === cat) + '">' + h(c.n) + '</button>'; }).join(''); }
    function paintGrid() {
      var cur = o.current();
      el.querySelector('.tp-grid').innerHTML = list(cat).map(function (s) {
        var src = iconOf(s.k, o.drawItem, o.stretch);
        return '<button type="button" role="option" class="tp-sym' + (s.k === cur ? ' on' : '') + '" data-k="' + h(s.k) + '" title="' + h(s.n) + '" aria-label="' + h(s.n) + '" aria-selected="' + (s.k === cur) + '">' + (src ? '<img alt="" draggable="false" src="' + src + '">' : '<span>' + h(s.n) + '</span>') + '</button>';
      }).join('');
    }
    function paintCur() { var c = el.querySelector('.tp-cur'); if (c) c.textContent = nameOf(o.current()); }
    function setFold(f) { folded = !!f; el.classList.toggle('folded', folded); lsSet('symfold', folded ? '1' : ''); }
    /* 자리: 처음에는 악보 화면 오른쪽 위 (가리는 부분 최소). 옮기면 비율로 기억 */
    /* 자리 기준 = 악보 화면(o.bounds). 팔레트는 스크롤되지 않는 칸에 두어(악보를 밀어도 제자리) left/top 은 그 칸 기준으로 바꿔 씀 */
    function box() { var b = o.bounds || el.offsetParent || el.parentNode, r = b.getBoundingClientRect(), q = (el.offsetParent || el.parentNode).getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width || root.innerWidth, h: r.height || root.innerHeight, ox: r.left - q.left, oy: r.top - q.top }; }
    function place() {
      var B = box(), w = el.offsetWidth || 300, hh = el.offsetHeight || 60, p = null;
      try { p = JSON.parse(lsGet('sympos') || 'null'); } catch (e) { p = null; }
      var x = p && isFinite(p.x) ? p.x * B.w : B.w - w - 12, y = p && isFinite(p.y) ? p.y * B.h : 12;
      if (!p && o.avoid) {                                                                   // 처음 자리: 떠 있는 도구 막대 등과 겹치지 않게 그 아래로
        try { (o.avoid() || []).forEach(function (n) { if (!n || !n.getBoundingClientRect) return; var r = n.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; var L = r.left - B.l, R = r.right - B.l, T = r.top - B.t, Bo = r.bottom - B.t; if (R > x && L < x + w && Bo > y && T < y + 60) y = Bo + 8; }); } catch (e) { /* 무시 */ }
      }
      el.style.left = Math.round(B.ox + clamp(x, 6, Math.max(6, B.w - w - 6))) + 'px';
      el.style.top = Math.round(B.oy + clamp(y, 6, Math.max(6, B.h - Math.min(hh, 56) - 6))) + 'px';
      el.style.transform = '';
    }
    el.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button') : null; if (!t) return;
      if (t.dataset.sp === 'fold') { setFold(!folded); place(); return; }
      if (t.dataset.sp === 'close') { if (o.onClose) o.onClose(); return; }
      if (t.dataset.cat) { cat = t.dataset.cat; lsSet('symcat', cat); if (folded) setFold(false); paintCats(); paintGrid(); place(); return; }
      if (t.dataset.k) {
        o.onPick(t.dataset.k);
        Array.prototype.forEach.call(el.querySelectorAll('.tp-sym'), function (x) { var on = x === t; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
        paintCur();
      }
    });
    /* 끌기 — transform 으로만 움직여(합성만) 끄는 동안 레이아웃 계산 없음, 놓을 때 자리를 저장 */
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation();                                                                   // 팔레트를 눌러도 악보 쪽 넘기기 · 필기가 시작되지 않게
      var bar = e.target.closest ? e.target.closest('.tp-symhead') : null;
      if (!bar || e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var r = el.getBoundingClientRect(), B = box();
      d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, l: r.left - B.l, t: r.top - B.t, w: r.width, B: B, moved: false, dx: 0, dy: 0 };
      try { bar.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (!d || e.pointerId !== d.id) return;
      var dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true; el.classList.add('dragging');
      d.dx = clamp(dx, 6 - d.l, d.B.w - d.w - 6 - d.l); d.dy = clamp(dy, 6 - d.t, d.B.h - 50 - d.t);
      el.style.transform = 'translate3d(' + d.dx + 'px,' + d.dy + 'px,0)';
      e.preventDefault();
    });
    function end(e) {
      if (!d || (e && e.pointerId !== d.id)) return;
      if (d.moved) { var L = d.l + d.dx, T = d.t + d.dy; el.style.transform = ''; el.style.left = (d.B.ox + L) + 'px'; el.style.top = (d.B.oy + T) + 'px'; lsSet('sympos', JSON.stringify({ x: +(L / d.B.w).toFixed(4), y: +(T / d.B.h).toFixed(4) })); }
      el.classList.remove('dragging'); d = null;
    }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', function (e) { if (!(e.target.closest && e.target.closest('.tp-symhead')) || e.target.closest('button')) return; lsSet('sympos', ''); place(); if (o.toast) o.toast('팔레트를 처음 자리로 옮겼습니다.'); });
    root.addEventListener('resize', function () { if (el.style.display !== 'none' && built) place(); });
    return {
      show: function (k) {
        if (!built) build();
        if (k) { var c = catOf(k); if (c !== cat) { cat = c; paintCats(); paintGrid(); } }
        setFold(folded); el.style.display = 'block'; paintCur(); place();
      },
      hide: function () { el.style.display = 'none'; d = null; },
      sync: function () { if (!built) return; paintGrid(); paintCur(); },
      catOf: catOf
    };
  }

  root.YNToolPop = { stylePop: stylePop, qchip: qchip, symPicker: symPicker, catOf: catOf, CATS: CATS, pushRecent: pushRecent };
}(typeof self !== 'undefined' ? self : this));
