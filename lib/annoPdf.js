/**
 * 라이브 악보 필기 → 인쇄용 PDF 에 그대로 (펜 · 형광펜 · 글자 · 코드 · 기호 · 음표 · 송폼 라벨)
 * ------------------------------------------------------------
 * 화면이 쓰는 그리기 코드(public/worship/anno.js 의 drawItem)를 그대로 쓰고, 그 코드가 부르는 canvas 2D 함수들을
 * PDF(pdf-lib) 그리기로 바꿔 주는 작은 "가짜 canvas" 를 넘깁니다 — 화면에서 보던 모양 그대로 인쇄됩니다.
 *
 *   drawAnnos(page, items, place, fonts)
 *     page  : pdf-lib PDFPage (인쇄용 PDF 의 쪽)
 *     items : 그 원본 쪽의 필기 항목들 (좌표는 원본 쪽에 대한 0~1 비율)
 *     place : 원본 쪽이 이 PDF 쪽에 놓인 자리 — { ox, oy, pw, ph, clip:{x,y,w,h} }
 *             ox, oy = 원본 쪽 왼쪽 위 모서리의 자리(PDF 쪽 왼쪽 위 기준, 아래로 +), pw, ph = 원본 쪽 전체가 차지할 크기(pt),
 *             clip = 실제로 그려진 악보 영역 (PDF 좌표, 아래 기준) — 잘려 나간 곳의 필기는 그리지 않음
 *     fonts : { bold, semi, italic } pdf-lib 글꼴
 */
const { pushGraphicsState, popGraphicsState, rectangle, clip, endPath, rgb, LineCapStyle } = require('pdf-lib');
const YA = require('../public/worship/anno.js');

function parseColor(s) {
  s = String(s || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) { const h = m[1]; return { c: rgb(parseInt(h[0] + h[0], 16) / 255, parseInt(h[1] + h[1], 16) / 255, parseInt(h[2] + h[2], 16) / 255), a: 1 }; }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) { const h = m[1]; return { c: rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255), a: 1 }; }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { c: rgb(Math.min(1, +m[1] / 255), Math.min(1, +m[2] / 255), Math.min(1, +m[3] / 255)), a: m[4] == null ? 1 : Math.max(0, Math.min(1, +m[4])) };
  if (s === 'transparent') return { c: rgb(0, 0, 0), a: 0 };
  return { c: rgb(0, 0, 0), a: 1 };
}

/** canvas 2D 의 필요한 부분만 — 좌표는 "PDF 쪽 왼쪽 위 기준, 아래로 +" (pt) */
function makeCtx(page, fonts, base) {
  const H = page.getHeight();
  const st = { m: [1, 0, 0, 1, base.ox, base.oy], lineWidth: 1, strokeStyle: '#000', fillStyle: '#000', globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter' };
  const stack = [];
  let path = '', hasPt = false, cur = null;
  const T = (x, y) => { const m = st.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
  const scaleOf = () => Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2])) || 1;
  const n = (v) => (Math.round(v * 100) / 100).toString();
  const add = (cmd, pts) => { path += cmd + pts.map((p) => n(p[0]) + ' ' + n(p[1])).join(' ') + ' '; };
  const lineToPt = (x, y) => { const p = T(x, y); if (!hasPt) { add('M', [p]); hasPt = true; } else add('L', [p]); cur = [x, y]; };
  function arcPts(cx, cy, rx, ry, rot, a0, a1, ccw) {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = sweep % (2 * Math.PI) + 2 * Math.PI;
    if (ccw && sweep > 0) sweep = sweep % (2 * Math.PI) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI - 1e-6) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    const k = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    const cr = Math.cos(rot || 0), sr = Math.sin(rot || 0);
    for (let i = 0; i <= k; i++) {
      const a = a0 + sweep * i / k, ex = rx * Math.cos(a), ey = ry * Math.sin(a);
      lineToPt(cx + ex * cr - ey * sr, cy + ex * sr + ey * cr);
    }
  }
  const capOf = () => (st.lineCap === 'round' ? LineCapStyle.Round : st.lineCap === 'square' ? LineCapStyle.Projecting : LineCapStyle.Butt);
  function paint(p, mode) {
    if (!p.trim()) return;
    if (mode === 'fill') {
      const col = parseColor(st.fillStyle), op = col.a * st.globalAlpha; if (op <= 0.001) return;
      page.drawSvgPath(p, { x: 0, y: H, color: col.c, opacity: op, borderWidth: 0 });
    } else {
      const col = parseColor(st.strokeStyle), op = col.a * st.globalAlpha; if (op <= 0.001) return;
      page.drawSvgPath(p, { x: 0, y: H, borderColor: col.c, borderOpacity: op, borderWidth: Math.max(0.2, st.lineWidth * scaleOf()), borderLineCap: capOf() });
    }
  }
  function fontPick(str) {
    const f = String(st.font || ''), sizeM = /([\d.]+)px/.exec(f), size = sizeM ? +sizeM[1] : 10;
    const bold = /\b(700|800|900|bold)\b/.test(f);
    const order = /italic/.test(f) && fonts.italic ? [fonts.italic, bold ? fonts.bold : fonts.semi] : [bold ? fonts.bold : fonts.semi, fonts.bold, fonts.semi];
    for (const ft of order) { if (!ft) continue; try { ft.encodeText(String(str)); return { ft, size }; } catch (e) { /* 이 글꼴에 없는 글자 — 다음 글꼴 */ } }
    return null;
  }
  const ctx = {
    get lineWidth() { return st.lineWidth; }, set lineWidth(v) { st.lineWidth = +v || 1; },
    get strokeStyle() { return st.strokeStyle; }, set strokeStyle(v) { st.strokeStyle = v; },
    get fillStyle() { return st.fillStyle; }, set fillStyle(v) { st.fillStyle = v; },
    get globalAlpha() { return st.globalAlpha; }, set globalAlpha(v) { st.globalAlpha = Math.max(0, Math.min(1, +v)); },
    get font() { return st.font; }, set font(v) { st.font = String(v); },
    get textAlign() { return st.textAlign; }, set textAlign(v) { st.textAlign = v; },
    get textBaseline() { return st.textBaseline; }, set textBaseline(v) { st.textBaseline = v; },
    get lineCap() { return st.lineCap; }, set lineCap(v) { st.lineCap = v; },
    get lineJoin() { return st.lineJoin; }, set lineJoin(v) { st.lineJoin = v; },
    shadowColor: 'transparent', shadowBlur: 0,
    save() { stack.push(Object.assign({}, st, { m: st.m.slice() })); },
    restore() { const s = stack.pop(); if (s) Object.assign(st, s); },
    translate(x, y) { const m = st.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; },
    scale(sx, sy) { const m = st.m; m[0] *= sx; m[1] *= sx; m[2] *= sy; m[3] *= sy; },
    rotate(a) { const m = st.m, c = Math.cos(a), s = Math.sin(a); const [a0, b0, c0, d0] = m; m[0] = a0 * c + c0 * s; m[1] = b0 * c + d0 * s; m[2] = -a0 * s + c0 * c; m[3] = -b0 * s + d0 * c; },
    beginPath() { path = ''; hasPt = false; cur = null; },
    closePath() { if (hasPt) path += 'Z '; },
    moveTo(x, y) { add('M', [T(x, y)]); hasPt = true; cur = [x, y]; },
    lineTo(x, y) { lineToPt(x, y); },
    bezierCurveTo(a, b, c, d, x, y) { if (!hasPt) ctx.moveTo(a, b); add('C', [T(a, b), T(c, d), T(x, y)]); cur = [x, y]; },
    quadraticCurveTo(a, b, x, y) { if (!hasPt) ctx.moveTo(a, b); add('Q', [T(a, b), T(x, y)]); cur = [x, y]; },
    arc(cx, cy, r, a0, a1, ccw) { arcPts(cx, cy, r, r, 0, a0, a1, !!ccw); },
    ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) { arcPts(cx, cy, rx, ry, rot, a0, a1, !!ccw); },
    rect(x, y, w, h) { ctx.moveTo(x, y); lineToPt(x + w, y); lineToPt(x + w, y + h); lineToPt(x, y + h); ctx.closePath(); },
    roundRect(x, y, w, h, r) {
      r = Math.max(0, Math.min(+r || 0, w / 2, h / 2));
      ctx.moveTo(x + r, y); lineToPt(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); lineToPt(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); lineToPt(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); lineToPt(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    },
    stroke() { paint(path, 'stroke'); },
    fill() { paint(path, 'fill'); },
    fillRect(x, y, w, h) { const keep = [path, hasPt, cur]; path = ''; hasPt = false; ctx.rect(x, y, w, h); paint(path, 'fill'); [path, hasPt, cur] = keep; },
    strokeRect(x, y, w, h) { const keep = [path, hasPt, cur]; path = ''; hasPt = false; ctx.rect(x, y, w, h); paint(path, 'stroke'); [path, hasPt, cur] = keep; },
    clearRect() {},
    measureText(s) { const f = fontPick(s); return { width: f ? f.ft.widthOfTextAtSize(String(s), f.size) : String(s).length * 6 }; },
    strokeText() { /* 화면의 흰 테두리(번짐 방지) — 인쇄에서는 생략 */ },
    fillText(s, x, y) {
      s = String(s == null ? '' : s); if (!s) return;
      const f = fontPick(s); if (!f) return;
      const col = parseColor(st.fillStyle), op = col.a * st.globalAlpha; if (op <= 0.001) return;
      const w = f.ft.widthOfTextAtSize(s, f.size);
      let lx = x, ly = y;
      if (st.textAlign === 'center') lx -= w / 2; else if (st.textAlign === 'right' || st.textAlign === 'end') lx -= w;
      if (st.textBaseline === 'middle') ly += f.size * 0.36; else if (st.textBaseline === 'top' || st.textBaseline === 'hanging') ly += f.size * 0.8; else if (st.textBaseline === 'bottom') ly -= f.size * 0.2;
      const p = T(lx, ly), sc = scaleOf(), ang = Math.atan2(st.m[1], st.m[0]) * 180 / Math.PI;
      try { page.drawText(s, { x: p[0], y: H - p[1], size: f.size * sc, font: f.ft, color: col.c, opacity: op, rotate: { type: 'degrees', angle: -ang } }); } catch (e) { /* 그릴 수 없는 글자 */ }
    },
  };
  return ctx;
}

const KINDS = { pen: 1, hl: 1, text: 1, sym: 1, fbox: 1 };

/** 필기를 그 쪽에 — 형광펜을 먼저(밑에), 나머지를 위에 (화면과 같은 순서) */
function drawAnnos(page, items, place, fonts) {
  const list = (items || []).filter((it) => it && KINDS[it.t]);
  if (!list.length) return 0;
  const c = place.clip;
  if (c) page.pushOperators(pushGraphicsState(), rectangle(c.x, c.y, c.w, c.h), clip(), endPath());
  let n = 0;
  const ctx = makeCtx(page, fonts, place);
  list.filter((it) => it.t === 'hl').concat(list.filter((it) => it.t !== 'hl')).forEach((it) => {
    try { YA.drawItem(ctx, it, place.pw, place.ph); n++; } catch (e) { /* 항목 하나가 이상해도 나머지는 그림 */ }
  });
  if (c) page.pushOperators(popGraphicsState());
  return n;
}

module.exports = { drawAnnos, makeCtx, parseColor };
