/* church-app public/budget/docview.js 그대로 */
/**
 * 문서 미리보기 · PDF 저장 · 인쇄 (브라우저가 직접 그립니다)
 *   YNDocView.open({ html, filename, title, landscape })
 *
 * 왜 브라우저에서? — 서버(구글 문서 변환)가 만든 PDF 는 표가 줄어들고 열 너비가 무너졌습니다.
 *   이 창은 서버가 준 문서 HTML 을 그대로 Letter 용지 모양으로 보여 주고 (미리보기),
 *   "PDF 저장" 은 같은 화면을 Letter 쪽 단위로 잘라 (줄 사이에서만 자르고, 이어지는 쪽에는 표 머리글을 다시 붙임) PDF 로 만듭니다. (여러 쪽을 한 번에 그린 뒤 잘라 쓰므로 긴 문서도 빠르고, 시간이 너무 걸리면 멈추지 않고 안내합니다.)
 *   "인쇄" 는 브라우저 인쇄 (용지 · 여백은 문서가 정해 둠).
 */
(function (root) {
  'use strict';
  var PX = 96 / 25.4;                                   // 1mm = 3.78px
  function mm(n) { return Math.round(n * PX); }
  function loadScript(src, ready) {
    return new Promise(function (resolve, reject) {
      if (ready()) return resolve();
      var s = document.createElement('script'); s.src = src;
      var tm = setTimeout(function () { reject(new Error('PDF 도구를 불러오는 데 너무 오래 걸립니다. 인터넷 연결을 확인해 주세요.')); }, 20000);
      s.onload = function () { clearTimeout(tm); ready() ? resolve() : reject(new Error('스크립트를 불러오지 못했습니다.')); };
      s.onerror = function () { clearTimeout(tm); reject(new Error('스크립트를 불러오지 못했습니다: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function libs() {
    /* jsPDF 는 꼭 필요, html2canvas 는 예비 (직접 그리기가 안 될 때만) 라서 못 불러와도 계속합니다 */
    return Promise.all([
      loadScript('/vendor/jspdf.umd.min.js', function () { return !!(root.jspdf && root.jspdf.jsPDF); }),
      loadScript('/vendor/html2canvas.min.js', function () { return typeof root.html2canvas === 'function'; }).catch(function () { return null; })
    ]);
  }
  function css() {
    if (document.getElementById('ydvCss')) return;
    var st = document.createElement('style'); st.id = 'ydvCss';
    st.textContent =
      '.ydv{position:fixed;inset:0;z-index:400;display:flex;flex-direction:column;background:#7d7d7d;font-family:inherit}' +
      '.ydv-bar{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Malgun Gothic",sans-serif;flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(18,18,26,.96);color:#fff;border-bottom:1px solid rgba(255,255,255,.14)}' +
      '.ydv-bar b{flex:1;min-width:0;font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.ydv-bar small{font-weight:600;opacity:.65;margin-left:6px;font-size:11px}' +
      '.ydv-b{appearance:none;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;border-radius:999px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}' +
      '.ydv-b.pri{background:#ff8a3d;border-color:#ff8a3d;color:#1a1208}' +
      '.ydv-b:disabled{opacity:.55;cursor:default}' +
      '.ydv-body{flex:1;overflow:auto;padding:12px 0 28px;-webkit-overflow-scrolling:touch}' +
      '.ydv-wrap{margin:0 auto;position:relative}' +
      '.ydv-fr{border:0;background:#fff;transform-origin:0 0;display:block;box-shadow:0 2px 16px rgba(0,0,0,.5)}' +
      '.ydv-msg{flex:none;text-align:center;font-size:12px;color:#fff;background:rgba(18,18,26,.96);padding:0 12px 8px;min-height:0}' +
      'html[data-theme="light"] .ydv-bar,html[data-theme="light"] .ydv-msg{background:rgba(255,255,255,.97);color:#111;border-bottom-color:#ccc}' +
      'html[data-theme="light"] .ydv-b{background:#f1f1f1;border-color:#999;color:#111}' +
      'html[data-theme="light"] .ydv-b.pri{background:#ff8a3d;border-color:#d96a1c;color:#1a1208}';
    document.head.appendChild(st);
  }

  /** 문서 안에서 "여기서는 잘라도 된다" 는 위치를 모읍니다 (body 위쪽 기준 px) */
  function plan(doc, land) {
    var body = doc.body, top0 = body.getBoundingClientRect().top;
    var contentW = land ? mm(251) : mm(188);
    var pageW = land ? mm(279.4) : mm(215.9), pageH = land ? mm(215.9) : mm(279.4);
    var mx = mm(14), mt = mm(15), mb = mm(17);
    var usable = pageH - mt - mb, total = Math.ceil(body.scrollHeight);
    var cand = [], heads = new Map();
    Array.prototype.forEach.call(doc.querySelectorAll('table'), function (t) {
      var th = t.querySelector('thead'); if (!th) return;
      var r = th.getBoundingClientRect(); heads.set(t, { y: Math.round(r.top - top0), h: Math.ceil(r.height) });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('h2, table, .box, tr'), function (el) {
      var y = Math.round(el.getBoundingClientRect().top - top0);
      if (el.tagName === 'TR') {
        var tb = el.closest('table'); if (!tb || tb.classList.contains('sign') || el.closest('thead')) return;
        var rows = tb.tBodies[0] ? tb.tBodies[0].rows : [];
        if (rows.length <= 8) return;                                   // 작은 표는 한 덩어리로 (두세 줄만 다음 쪽으로 넘어가지 않게)
        if (heads.has(tb) && rows[0] === el) return;                   // 머리글 바로 뒤 첫 줄 앞에서는 자르지 않음 (제목 · 머리글만 남는 것 방지)
        cand.push({ y: y, table: heads.has(tb) ? tb : null });
      } else if (el.tagName === 'TABLE') {
        var pv = el.previousElementSibling; if (pv && pv.tagName === 'H2') return;   // 제목 바로 뒤의 표 앞에서는 자르지 않음 (제목이 혼자 남는 것 방지)
        cand.push({ y: y, table: null });
      } else cand.push({ y: y, table: null });
    });
    cand.sort(function (a, b) { return a.y - b.y; });
    var forced = [];                                                      // 클래스 pb 가 붙은 칸은 늘 새 쪽에서 시작 (셀마다 한 장 등)
    Array.prototype.forEach.call(doc.querySelectorAll('.pb'), function (el) { var y = Math.round(el.getBoundingClientRect().top - top0); if (y > 40) forced.push(y); });
    forced.sort(function (a, b) { return a - b; });
    var pages = [], start = 0, hdr = null, guard = 0;
    while (start < total - 2 && guard++ < 200) {
      var res = hdr ? hdr.h : 0, limit = start + usable - res, end, nextHdr = null;
      var fb = null; forced.forEach(function (y) { if (fb === null && y > start + 40 && y <= limit) fb = y; });
      if (fb !== null) { end = fb; }
      else if (total <= limit) end = total;
      else {
        var best = null;
        cand.forEach(function (c) { if (c.y > start + 40 && c.y <= limit && (!best || c.y >= best.y)) best = c; });
        if (best) { end = best.y; nextHdr = best.table ? heads.get(best.table) : null; } else end = limit;
      }
      pages.push({ start: start, end: end, hdr: hdr });
      start = end; hdr = nextHdr;
    }
    if (!pages.length) pages.push({ start: 0, end: Math.max(total, 10), hdr: null });
    return { pages: pages, contentW: contentW, pageW: pageW, pageH: pageH, mx: mx, mt: mt, mb: mb };
  }

  function frameFor(html, w) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-same-origin allow-modals');
      f.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;width:' + w + 'px;height:800px;visibility:hidden';
      f.onload = function () { resolve(f); };
      f.onerror = function () { reject(new Error('문서를 준비하지 못했습니다.')); };
      f.srcdoc = html; document.body.appendChild(f);
    });
  }

  /* ------------------------------------------------------------------
   * v7.0 — 직접 그리기 (html2canvas 없이)
   *   미리보기와 같은 화면(숨긴 iframe)에서 글자 · 배경 · 테두리 · 사진의 위치를 브라우저에게 물어 그 자리에 그대로 캔버스에 그립니다.
   *   html2canvas 는 문서를 통째로 복제해서 큰 캔버스에 그리느라 아이폰 · 아이패드에서 "PDF 만드는 중"에 멈추곤 했습니다.
   *   여기서는 쪽마다 작은 캔버스(Letter 한 장)만 쓰므로 기기와 상관없이 빠릅니다. 이 길이 실패하면 예전 방식(html2canvas)으로 다시 시도합니다.
   * ------------------------------------------------------------------ */
  function rgba(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    var a = p.length > 3 ? p[3] : 1; if (!(a > 0)) return null;
    return a >= 1 ? 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')' : 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
  }
  function collect(doc, win) {
    var br = doc.body.getBoundingClientRect(), L0 = br.left, T0 = br.top, ops = [], chars = 0;
    var sameOrigin = function (u) { try { return /^(data:|blob:)/i.test(u) || new URL(u, win.location.href).origin === root.location.origin; } catch (e) { return false; } };
    function textOps(node, cs) {
      var str = node.nodeValue || ''; if (!/\S/.test(str)) return;
      var rg = doc.createRange(), font = (cs.fontStyle === 'italic' ? 'italic ' : '') + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      var color = rgba(cs.color) || '#111', up = /uppercase/.test(cs.textTransform), ul = /underline/.test(cs.textDecorationLine || cs.textDecoration || ''), lt = /line-through/.test(cs.textDecorationLine || cs.textDecoration || '');
      var ls = cs.letterSpacing && cs.letterSpacing !== 'normal' ? parseFloat(cs.letterSpacing) || 0 : 0;
      var run = null, i = 0;
      function flush() {
        if (!run) return;
        ops.push({ k: 't', x: run.x, y: run.y, w: run.w, h: run.h, s: run.s, font: font, color: color, ls: ls, ul: ul, lt: lt }); run = null;
      }
      while (i < str.length) {
        var cp = str.codePointAt(i), len = cp > 0xffff ? 2 : 1, ch = str.substr(i, len);
        if (/\s/.test(ch)) { flush(); i += len; continue; }
        rg.setStart(node, i); rg.setEnd(node, i + len);
        var rs = rg.getClientRects(), rc = rs && rs[0];
        if (!rc || (rc.width === 0 && rc.height === 0)) { flush(); i += len; continue; }
        var x = rc.left - L0, y = rc.top - T0;
        if (run && Math.abs(y - run.y) < 3 && x >= run.x - 1 && x - (run.x + run.w) < 4) { run.s += up ? ch.toUpperCase() : ch; run.w = x + rc.width - run.x; }
        else { flush(); run = { x: x, y: y, w: rc.width, h: rc.height, s: up ? ch.toUpperCase() : ch }; }
        chars++; i += len;
      }
      flush();
    }
    function walk(el, vis) {
      var tag = el.tagName; if (/^(SCRIPT|STYLE|HEAD|META|LINK|TITLE|NOSCRIPT|TEMPLATE)$/.test(tag)) return;
      var cs = win.getComputedStyle(el); if (cs.display === 'none') return;
      var shown = vis && cs.visibility !== 'hidden';
      var r = el.getBoundingClientRect(), x = r.left - L0, y = r.top - T0, w = r.width, h = r.height;
      if (shown && w > 0 && h > 0 && el !== doc.documentElement) {
        var bg = rgba(cs.backgroundColor), rad = 0, br0 = cs.borderTopLeftRadius || '';
        if (/%/.test(br0)) rad = Math.min(w, h) * (parseFloat(br0) / 100); else rad = parseFloat(br0) || 0;
        if (bg && el !== doc.body) ops.push({ k: 'r', x: x, y: y, w: w, h: h, c: bg, rad: rad });
        var bt = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0, bl = parseFloat(cs.borderLeftWidth) || 0, brr = parseFloat(cs.borderRightWidth) || 0;
        var on = function (side) { var st = cs['border' + side + 'Style']; return st && st !== 'none' && st !== 'hidden'; };
        if (rad > 1 && bt > 0 && bt === bb && bt === bl && bt === brr && on('Top')) ops.push({ k: 'ring', x: x, y: y, w: w, h: h, bw: bt, c: rgba(cs.borderTopColor) || '#111', rad: rad });
        else {
          if (bt > 0 && on('Top') && rgba(cs.borderTopColor)) ops.push({ k: 'r', x: x, y: y, w: w, h: bt, c: rgba(cs.borderTopColor), rad: 0 });
          if (bb > 0 && on('Bottom') && rgba(cs.borderBottomColor)) ops.push({ k: 'r', x: x, y: y + h - bb, w: w, h: bb, c: rgba(cs.borderBottomColor), rad: 0 });
          if (bl > 0 && on('Left') && rgba(cs.borderLeftColor)) ops.push({ k: 'r', x: x, y: y, w: bl, h: h, c: rgba(cs.borderLeftColor), rad: 0 });
          if (brr > 0 && on('Right') && rgba(cs.borderRightColor)) ops.push({ k: 'r', x: x + w - brr, y: y, w: brr, h: h, c: rgba(cs.borderRightColor), rad: 0 });
        }
        if (tag === 'IMG' && el.complete && el.naturalWidth > 0 && sameOrigin(el.currentSrc || el.src)) ops.push({ k: 'i', x: x + bl, y: y + bt, w: w - bl - brr, h: h - bt - bb, img: el, rad: rad, fit: cs.objectFit });
        if (tag === 'CANVAS') ops.push({ k: 'i', x: x, y: y, w: w, h: h, img: el, rad: 0, fit: 'fill' });
      }
      if (tag === 'IMG' || tag === 'CANVAS' || tag === 'SVG' || tag === 'svg') return;
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { if (shown) textOps(c, cs); }
        else if (c.nodeType === 1) walk(c, shown);
      }
    }
    walk(doc.body, true);
    return { ops: ops, chars: chars };
  }
  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function paint(g, ops, y0, y1) {
    var asc = {};
    ops.forEach(function (o) {
      if (o.y + o.h <= y0 || o.y >= y1) return;
      if (o.k === 'r') { g.fillStyle = o.c; if (o.rad > 0.5) { roundRect(g, o.x, o.y, o.w, o.h, o.rad); g.fill(); } else g.fillRect(o.x, o.y, o.w, o.h); }
      else if (o.k === 'ring') { g.strokeStyle = o.c; g.lineWidth = o.bw; roundRect(g, o.x + o.bw / 2, o.y + o.bw / 2, o.w - o.bw, o.h - o.bw, o.rad - o.bw / 2); g.stroke(); }
      else if (o.k === 'i') {
        g.save(); if (o.rad > 0.5) { roundRect(g, o.x, o.y, o.w, o.h, o.rad); g.clip(); }
        var iw = o.img.naturalWidth || o.img.width, ih = o.img.naturalHeight || o.img.height, dx = o.x, dy = o.y, dw = o.w, dh = o.h;
        if (o.fit === 'cover' && iw && ih) { var s2 = Math.max(o.w / iw, o.h / ih); dw = iw * s2; dh = ih * s2; dx = o.x + (o.w - dw) / 2; dy = o.y + (o.h - dh) / 2; }
        else if (o.fit === 'contain' && iw && ih) { var s3 = Math.min(o.w / iw, o.h / ih); dw = iw * s3; dh = ih * s3; dx = o.x + (o.w - dw) / 2; dy = o.y + (o.h - dh) / 2; }
        try { g.drawImage(o.img, dx, dy, dw, dh); } catch (e) { /* 그릴 수 없는 사진은 건너뜀 */ }
        g.restore();
      } else if (o.k === 't') {
        g.font = o.font; g.fillStyle = o.color; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
        if ('letterSpacing' in g) g.letterSpacing = o.ls ? o.ls + 'px' : '0px';
        var a = asc[o.font];
        if (a === undefined) { var m = g.measureText('Mg'); a = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : parseFloat(o.font.replace(/^.*?(\d+(?:\.\d+)?)px.*$/, '$1')) * 0.82; asc[o.font] = a; }
        var by = o.y + a + Math.max(0, (o.h - (o.h)) / 2);
        g.fillText(o.s, o.x, by);
        if (o.ul) g.fillRect(o.x, by + 1.5, o.w, Math.max(0.7, o.h / 14));
        if (o.lt) g.fillRect(o.x, by - o.h * 0.3, o.w, Math.max(0.7, o.h / 14));
      }
    });
  }
  function nativePdf(doc, win, P, n, sc, land, o, onProgress) {
    if (root.__ydvNoNative) throw new Error('직접 그리기 꺼짐 (시험용)');
    var col = collect(doc, win);
    if (!col.ops.length) throw new Error('그릴 내용을 찾지 못했습니다.');
    var jsPDF = root.jspdf.jsPDF, pdf = new jsPDF({ orientation: land ? 'l' : 'p', unit: 'pt', format: 'letter', compress: true });
    var wpt = pdf.internal.pageSize.getWidth(), hpt = pdf.internal.pageSize.getHeight(), i = 0;
    var FONT = '"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",Arial,sans-serif';
    function next() {
      if (i >= n) return Promise.resolve();
      if (onProgress) onProgress(i + 1, n);
      var pg = P.pages[i], h = pg.end - pg.start, hh = pg.hdr ? pg.hdr.h : 0;
      var cv = document.createElement('canvas'); cv.width = Math.round(P.pageW * sc); cv.height = Math.round(P.pageH * sc);
      var g = cv.getContext('2d'); if (!g) throw new Error('캔버스를 만들지 못했습니다.');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.setTransform(sc, 0, 0, sc, 0, 0);
      if (pg.hdr) { g.save(); g.beginPath(); g.rect(P.mx, P.mt, P.contentW, hh); g.clip(); g.translate(P.mx, P.mt - pg.hdr.y); paint(g, col.ops, pg.hdr.y, pg.hdr.y + hh); g.restore(); }
      g.save(); g.beginPath(); g.rect(P.mx, P.mt + hh, P.contentW, h); g.clip(); g.translate(P.mx, P.mt + hh - pg.start); paint(g, col.ops, pg.start, pg.end); g.restore();
      g.fillStyle = '#111'; g.fillRect(P.mx, P.pageH - mm(12), P.contentW, 1);
      g.fillStyle = '#444'; g.font = '10px ' + FONT; g.textBaseline = 'alphabetic';
      g.textAlign = 'left'; g.fillText(String(o.title || ''), P.mx, P.pageH - mm(8));
      g.textAlign = 'right'; g.fillText((i + 1) + ' / ' + n, P.pageW - P.mx, P.pageH - mm(8));
      if (i > 0) pdf.addPage('letter', land ? 'l' : 'p');
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wpt, hpt, undefined, 'FAST');
      cv.width = cv.height = 0;
      i++; return new Promise(function (r) { setTimeout(r, 0); }).then(next);
    }
    return next().then(function () { return { pdf: pdf, pages: n, engine: 'native' }; });
  }

  function makePdf(o, onProgress) {
    var land = !!o.landscape;
    return libs().then(function () { return frameFor(o.html, land ? mm(251) : mm(188)); }).then(function (f) {
      var doc = f.contentDocument, win = f.contentWindow;
      doc.body.classList.add('cap');
      var fonts = doc.fonts && doc.fonts.ready ? Promise.race([doc.fonts.ready, new Promise(function (r) { setTimeout(r, 2500); })]) : Promise.resolve();
      return fonts.then(function () { return new Promise(function (r) { setTimeout(r, 60); }); }).then(function () {
        f.style.height = Math.ceil(doc.body.scrollHeight) + 40 + 'px';
        var P = plan(doc, land), n = P.pages.length, sc = n > 12 ? 1.6 : 2;
        var done = function (r) { f.remove(); return r; };
        /* 1) 직접 그리기 — 빠르고 기기를 가리지 않음. 2) 실패하면 html2canvas */
        var first;
        try { first = nativePdf(doc, win, P, n, sc, land, o, onProgress); } catch (e) { first = Promise.reject(e); }
        return first.then(done, function (err) {
          try { console.warn('PDF 직접 그리기 실패 → html2canvas 로 다시 시도:', err && err.message); } catch (x) {}
          return html2canvasPdf(doc, P, n, sc, land, o, onProgress).then(done, function (e) { f.remove(); throw e; });
        });
      });
    });
  }

  /* 예전 방식 (html2canvas) — 직접 그리기가 안 될 때만 */
  function html2canvasPdf(doc, P, n, sc, land, o, onProgress) {
    if (!root.html2canvas) return Promise.reject(new Error('PDF 도구를 불러오지 못했습니다.'));
    {
      {
        var jsPDF = root.jspdf.jsPDF, pdf = new jsPDF({ orientation: land ? 'l' : 'p', unit: 'pt', format: 'letter', compress: true });
        var wpt = pdf.internal.pageSize.getWidth(), hpt = pdf.internal.pageSize.getHeight();
        var cache = {};
        /* 시간 제한 — 기기가 느려도 "만드는 중"에서 영원히 멈추지 않게 */
        function withTimeout(p, ms, what) {
          return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error(what + ' — 시간이 너무 오래 걸립니다. 문서가 길면 "인쇄" → "PDF로 저장"을 써 주세요.')); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
          });
        }
        function grab(y, h, keep) {
          var key = y + ':' + h; if (cache[key]) return Promise.resolve(cache[key]);
          return withTimeout(root.html2canvas(doc.body, { scale: sc, y: y, height: h, width: P.contentW, windowWidth: P.contentW, backgroundColor: '#ffffff', logging: false, useCORS: true, imageTimeout: 4000 }), 90000, '쪽 그리기')
            .then(function (c) { if (keep) cache[key] = c; return c; });
        }
        /* 쪽마다 문서 전체를 다시 읽지 않도록, 이어진 쪽 여러 장 분량을 한 번에 그려 잘라 씁니다 */
        var stripPx = Math.floor(11000 / sc), strip = null;
        function stripFor(i) {
          if (strip && i >= strip.a && i <= strip.b) return Promise.resolve(strip);
          var a = i, b = i, y0 = P.pages[a].start;
          while (b + 1 < n && P.pages[b + 1].end - y0 <= stripPx) b++;
          var y1 = P.pages[b].end;
          return grab(y0, y1 - y0).then(function (c) { strip = { a: a, b: b, y0: y0, canvas: c }; return strip; });
        }
        var i = 0;
        function next() {
          if (i >= n) return Promise.resolve();
          var pg = P.pages[i], h = pg.end - pg.start;
          if (onProgress) onProgress(i + 1, n);
          return (pg.hdr ? grab(pg.hdr.y, pg.hdr.h, true) : Promise.resolve(null)).then(function (hc) {
            return stripFor(i).then(function (st) {
              var cv = document.createElement('canvas'); cv.width = Math.round(P.pageW * sc); cv.height = Math.round(P.pageH * sc);
              var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
              var y = P.mt * sc;
              if (hc) { g.drawImage(hc, P.mx * sc, y); y += hc.height; }
              var ratio = st.canvas.height / (P.pages[st.b].end - st.y0);
              g.drawImage(st.canvas, 0, Math.round((pg.start - st.y0) * ratio), st.canvas.width, Math.round(h * ratio), P.mx * sc, y, st.canvas.width, Math.round(h * ratio));
              g.fillStyle = '#444'; g.font = (10 * sc) + 'px "Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",Arial,sans-serif';
              g.textBaseline = 'alphabetic';
              var fy = (P.pageH - mm(8)) * sc;
              g.fillStyle = '#111'; g.fillRect(P.mx * sc, (P.pageH - mm(12)) * sc, P.contentW * sc, 1 * sc);
              g.fillStyle = '#444'; g.textAlign = 'left'; g.fillText(String(o.title || ''), P.mx * sc, fy);
              g.textAlign = 'right'; g.fillText((i + 1) + ' / ' + n, (P.pageW - P.mx) * sc, fy);
              if (i > 0) pdf.addPage('letter', land ? 'l' : 'p');
              pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wpt, hpt, undefined, 'FAST');
              i++; return new Promise(function (r) { setTimeout(r, 0); }).then(next);
            });
          });
        }
        return next().then(function () { return { pdf: pdf, pages: n, engine: 'html2canvas' }; });
      }
    }
  }

  function open(o) {
    css();
    var land = !!o.landscape, pw = land ? mm(279.4) : mm(215.9);
    var ov = document.createElement('div'); ov.className = 'ydv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '문서 미리보기');
    ov.innerHTML = '<div class="ydv-bar"><b></b><button class="ydv-b pri" data-a="pdf" type="button">PDF 저장</button><button class="ydv-b" data-a="print" type="button">인쇄</button><button class="ydv-b" data-a="close" type="button" aria-label="닫기">✕</button></div>' +
      '<div class="ydv-msg" id="ydvMsg"></div><div class="ydv-body"><div class="ydv-wrap"><iframe class="ydv-fr" title="문서 미리보기" sandbox="allow-same-origin allow-modals"></iframe></div></div>';
    ov.querySelector('b').innerHTML = '';
    ov.querySelector('b').appendChild(document.createTextNode(o.title || '문서'));
    var sm = document.createElement('small'); sm.textContent = land ? 'Letter 가로' : 'Letter 세로'; ov.querySelector('b').appendChild(sm);
    document.body.appendChild(ov);
    var prevOv = document.body.style.overflow; document.body.style.overflow = 'hidden';
    var fr = ov.querySelector('iframe'), wrap = ov.querySelector('.ydv-wrap'), body = ov.querySelector('.ydv-body'), msg = ov.querySelector('#ydvMsg');
    function fit() {
      var k = Math.min(1, (body.clientWidth - 16) / pw); if (!(k > 0)) k = 1;
      var h = 0; try { h = Math.ceil(fr.contentDocument.documentElement.scrollHeight); } catch (e) {}
      fr.style.width = pw + 'px'; fr.style.height = h + 'px'; fr.style.transform = 'scale(' + k + ')';
      wrap.style.width = Math.round(pw * k) + 'px'; wrap.style.height = Math.round(h * k) + 'px';
    }
    fr.onload = function () { fit(); setTimeout(fit, 250); };
    fr.srcdoc = o.html;
    var onResize = function () { fit(); }; root.addEventListener('resize', onResize);
    function close() { root.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey, true); document.body.style.overflow = prevOv; ov.remove(); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    var busy = false;
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return; var a = b.getAttribute('data-a');
      if (a === 'close') return close();
      if (a === 'print') { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (x) { msg.textContent = '인쇄 창을 열지 못했습니다.'; } return; }
      if (a === 'pdf') {
        if (busy) return; busy = true; b.disabled = true; var t0 = b.textContent;
        makePdf({ html: o.html, landscape: land, title: o.title }, function (i, n) { b.textContent = 'PDF 만드는 중 ' + i + '/' + n; msg.textContent = ''; })
          .then(function (r) {
            var name = String(o.filename || 'document').replace(/[\\\/:*?"<>|]/g, '_'); if (!/\.pdf$/i.test(name)) name += '.pdf';
            var blob = r.pdf.output('blob'), a2 = document.createElement('a'), url = URL.createObjectURL(blob);
            a2.href = url; a2.download = name; document.body.appendChild(a2); a2.click();
            setTimeout(function () { a2.remove(); }, 1500);
            /* 아이패드 · 아이폰은 자동 내려받기를 막는 경우가 있어, 눌러서 열 수 있는 링크를 남겨 둡니다 */
            msg.textContent = 'PDF ' + r.pages + '쪽을 만들었습니다. 내려받기가 시작되지 않으면 → ';
            var lk = document.createElement('a'); lk.href = url; lk.target = '_blank'; lk.rel = 'noopener'; lk.download = name; lk.textContent = 'PDF 열기 / 저장'; lk.style.cssText = 'color:#ffb066;font-weight:800;text-decoration:underline';
            msg.appendChild(lk);
          })
          .catch(function (e) { msg.textContent = (e && e.message) || 'PDF를 만들지 못했습니다. "인쇄" → "PDF로 저장"을 써 주세요.'; })
          .then(function () { busy = false; b.disabled = false; b.textContent = t0; });
      }
    });
    return { close: close, makePdf: function () { return makePdf({ html: o.html, landscape: land, title: o.title }); } };
  }

  root.YNDocView = { open: open, makePdf: makePdf, _plan: plan };
})(window);
