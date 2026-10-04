/**
 * 가벼운 악보 인식(OMR) — 오선 찾기 · 오선 지우기 · 멜로디 음표(머리) 찾기 (Step 13)
 * ------------------------------------------------------------
 *  화면(캔버스)을 몰라도 되는 순수 계산입니다: 입력은 RGBA 픽셀(캔버스 getImageData 결과 모양) 하나뿐이고, 브라우저와 Node(시험)에서 같은 코드가 돕니다.
 *  1) 흑백으로 바꿈(Otsu · 사진이면 국소 평균)
 *  2) 오선: 가로로 "긴 줄"만 세어(가사 글자 줄은 짧은 획뿐이라 걸러짐) 5줄씩 간격이 고른 묶음을 찾음
 *  3) 오선 지우기: 선 위 픽셀이 위아래로 이어져 있으면(음표 · 줄기) 남기고, 선만 있으면 지움
 *  4) 음표 머리: 가로 열기(줄기 · 마디선 제거) → 세로 닫기(빈 머리(2분음표)의 속을 채움) → 덩어리 찾기 → 크기 · 채움 · 줄기로 판별
 *  5) 길이 짐작: 빈 머리 / 줄기 / 꼬리(깃발 · 빔) / 점으로 음표 길이(박)를 짐작
 *  한계: 정면으로 찍은 PDF · 스캔 기준입니다(기울어진 사진은 오선을 못 찾을 수 있음). 틀린 곳은 화면에서 손으로 고칩니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNOmr = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }

  /* ------------------------------------------------------------ 1) 흑백 */
  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h), i, j;
    for (i = 0, j = 0; i < g.length; i++, j += 4) {
      var a = rgba[j + 3]; var lum = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
      g[i] = a < 255 ? Math.round(lum * a / 255 + 255 * (1 - a / 255)) : Math.round(lum);         // 투명한 곳은 흰 종이로
    }
    return g;
  }
  function otsu(gray) {
    var hist = new Array(256).fill(0), i, n = gray.length;
    for (i = 0; i < n; i++) hist[gray[i]]++;
    var sum = 0, sumB = 0, wB = 0, best = 0, thr = 128;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; var wF = n - wB; if (!wF) break;
      sumB += i * hist[i]; var mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    return thr;
  }
  /** 1 = 잉크(검은 부분). opt.adaptive 이면 사진처럼 조명이 고르지 않은 그림을 위해 국소 평균과 비교 */
  function binarize(gray, w, h, opt) {
    opt = opt || {};
    var out = new Uint8Array(w * h), i, thr = otsu(gray);
    if (!opt.adaptive) { for (i = 0; i < out.length; i++) out[i] = gray[i] <= thr ? 1 : 0; return out; }
    var r = Math.max(7, Math.round(w / 60)), integ = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += gray[y * w + x]; integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row; } }
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), area = (x1 - x0) * (y1 - y0);
        var mean = (integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0]) / area;
        out[y * w + x] = gray[y * w + x] < mean * 0.86 && gray[y * w + x] <= Math.min(230, thr + 40) ? 1 : 0;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ 2) 오선 */
  /** 오선 목록: [{ lines:[y×5], top, bottom, sp, thick, x0, x1 }] (위에서 아래로, 픽셀 단위) */
  function detectStaves(bin, w, h) {
    var minRun = Math.max(24, Math.round(w * 0.08)), score = new Float32Array(h), y, x;
    for (y = 0; y < h; y++) {
      var run = 0, gap = 0, tot = 0, base = y * w;
      for (x = 0; x < w; x++) {
        if (bin[base + x]) { run += gap + 1; gap = 0; }
        else if (run && gap < 2) gap++;
        else { if (run >= minRun) tot += run; run = 0; gap = 0; }
      }
      if (run >= minRun) tot += run;
      score[y] = tot;
    }
    var cand = [], thr = Math.max(minRun * 1.5, w * 0.2);
    y = 0;
    while (y < h) {
      if (score[y] >= thr) {
        var y0 = y, ws = 0, wy = 0, last = y;
        while (y < h && (score[y] >= thr || (y - last) <= 1)) { if (score[y] >= thr) { ws += score[y]; wy += score[y] * y; last = y; } y++; }
        cand.push({ y: wy / ws, thick: last - y0 + 1, y0: y0, y1: last });
      } else y++;
    }
    var staves = [], i = 0;
    while (i + 4 < cand.length) {
      var ys = [cand[i].y, cand[i + 1].y, cand[i + 2].y, cand[i + 3].y, cand[i + 4].y], sp = (ys[4] - ys[0]) / 4, ok = sp >= 4 && sp <= 60, k;
      for (k = 0; ok && k < 4; k++) if (Math.abs((ys[k + 1] - ys[k]) - sp) > 0.22 * sp + 1.5) ok = false;
      for (k = 0; ok && k < 5; k++) if (cand[i + k].thick > sp * 0.6) ok = false;
      if (!ok) { i++; continue; }
      var th = median([cand[i].thick, cand[i + 1].thick, cand[i + 2].thick, cand[i + 3].thick, cand[i + 4].thick]);
      // 좌우 끝: 가운데 줄의 긴 잉크 범위
      var mid = Math.round(ys[2]), xa = w, xb = 0;
      for (var dy = -1; dy <= 1; dy++) { var yy = clamp(mid + dy, 0, h - 1); for (x = 0; x < w; x++) if (bin[yy * w + x]) { if (x < xa) xa = x; break; } for (x = w - 1; x >= 0; x--) if (bin[yy * w + x]) { if (x > xb) xb = x; break; } }
      staves.push({ lines: ys, top: ys[0], bottom: ys[4], sp: sp, thick: th, x0: xa, x1: xb });
      i += 5;
    }
    return staves;
  }
  /** 오선들을 "단"(system) 으로 묶고, 각 단의 맨 위 오선을 멜로디 오선으로 표시 (피아노 큰 보표의 아래 줄이 멜로디로 읽히지 않게) */
  function groupSystems(staves) {
    var sys = -1, prev = null;
    staves.forEach(function (s) {
      if (!prev || (s.top - prev.bottom) / s.sp >= 5.5) { sys++; s.melody = true; } else s.melody = false;
      s.sys = sys; prev = s;
    });
    return staves;
  }

  /* ------------------------------------------------------------ 3) 오선 지우기 */
  /** 오선 주변 띠를 잘라 오선을 지운 작은 그림을 돌려줌 { bmp, bw, bh, ox, oy } — 좌표는 (원본 x − ox, 원본 y − oy) */
  function stripStaff(bin, w, h, st, wide) {
    var pad = Math.round(st.sp * 3.6), oy = Math.max(0, Math.round(st.top - pad)), ey = Math.min(h, Math.round(st.bottom + pad) + 1);
    var ox = Math.max(0, st.x0 - 1), ex = Math.min(w, st.x1 + 2), bw = ex - ox, bh = ey - oy, bmp = new Uint8Array(bw * bh), x, y, k;
    for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) bmp[y * bw + x] = bin[(y + oy) * w + x + ox];
    var half = Math.max(1, Math.ceil(st.thick / 2)) + 1, mg = Math.max(2, Math.round(st.thick * 1.5) + 1);
    /* V849 — 줄 위아래를 살펴보는 거리를 음표 머리 반지름보다 작게 (작은 · 흐린 악보에서 "줄 위의 음표" 머리가 둘로 갈라지던 문제) · 덧줄(위 · 아래 3칸)도 같은 방법으로 지움 */
    var reach = wide ? half + mg : Math.max(half + 1, Math.min(half + mg, Math.round(st.sp * 0.3)));
    var rows = st.lines.map(function (v) { return v; });
    for (k = 1; k <= 3; k++) { rows.push(st.lines[0] - k * st.sp); rows.push(st.lines[4] + k * st.sp); }
    for (k = 0; k < rows.length; k++) {
      var ly = Math.round(rows[k]) - oy, ya = ly - reach, yb = ly + reach;
      if (ly < 0 || ly >= bh) continue;
      for (x = 0; x < bw; x++) {
        var above = ya >= 0 && bin[(ya + oy) * w + x + ox], below = yb < bh && bin[(yb + oy) * w + x + ox];
        if (k >= 5 && !(bmp[ly * bw + x])) continue;
        if (above || below) continue;                                              // 선 위아래로 잉크가 이어지면 음표 · 줄기의 일부 → 남김
        for (y = ly - half; y <= ly + half; y++) if (y >= 0 && y < bh) bmp[y * bw + x] = 0;
      }
    }
    return { bmp: bmp, bw: bw, bh: bh, ox: ox, oy: oy };
  }

  /* ------------------------------------------------------------ 4) 음표 머리 */
  function hopen(src, bw, bh, kw) {
    var out = new Uint8Array(src.length), er = new Uint8Array(src.length), x, y, cum = new Int32Array(bw + 1);
    for (y = 0; y < bh; y++) {
      var b = y * bw; cum[0] = 0; for (x = 0; x < bw; x++) cum[x + 1] = cum[x] + src[b + x];
      for (x = 0; x + kw <= bw; x++) er[b + x] = (cum[x + kw] - cum[x]) === kw ? 1 : 0;
      var c2 = new Int32Array(bw + 1); for (x = 0; x < bw; x++) c2[x + 1] = c2[x] + er[b + x];
      for (x = 0; x < bw; x++) { var lo = Math.max(0, x - kw + 1); out[b + x] = (c2[x + 1] - c2[lo]) > 0 ? 1 : 0; }
    }
    return out;
  }
  /** 세로 닫기(반지름 r): 위아래 2r 칸 이하의 틈을 메움 — 빈 머리(2분음표)의 위 · 아래 호를 이어 하나의 덩어리로 */
  function vclose(src, bw, bh, r) {
    var dil = new Uint8Array(src.length), out = new Uint8Array(src.length), x, y, cum = new Int32Array(bh + 1), c2 = new Int32Array(bh + 1);
    for (x = 0; x < bw; x++) {
      cum[0] = 0; for (y = 0; y < bh; y++) cum[y + 1] = cum[y] + src[y * bw + x];
      for (y = 0; y < bh; y++) { var lo = Math.max(0, y - r), hi = Math.min(bh, y + r + 1); dil[y * bw + x] = (cum[hi] - cum[lo]) > 0 ? 1 : 0; }
      c2[0] = 0; for (y = 0; y < bh; y++) c2[y + 1] = c2[y] + dil[y * bw + x];
      for (y = 0; y < bh; y++) { var l2 = y - r, h2 = y + r + 1; out[y * bw + x] = (l2 >= 0 && h2 <= bh && (c2[h2] - c2[l2]) === 2 * r + 1) ? 1 : 0; }
    }
    return out;
  }
  /** 세로 열기(반지름 r): 위아래로 2r+1 칸보다 얇은 것(붙임줄 · 가는 곡선)을 지움 */
  function vopen(src, bw, bh, r) {
    var er = new Uint8Array(src.length), out = new Uint8Array(src.length), x, y, cum = new Int32Array(bh + 1), c2 = new Int32Array(bh + 1);
    for (x = 0; x < bw; x++) {
      cum[0] = 0; for (y = 0; y < bh; y++) cum[y + 1] = cum[y] + src[y * bw + x];
      for (y = 0; y < bh; y++) { var lo = y - r, hi = y + r + 1; er[y * bw + x] = (lo >= 0 && hi <= bh && cum[hi] - cum[lo] === 2 * r + 1) ? 1 : 0; }
      c2[0] = 0; for (y = 0; y < bh; y++) c2[y + 1] = c2[y] + er[y * bw + x];
      for (y = 0; y < bh; y++) { var l2 = Math.max(0, y - r), h2 = Math.min(bh, y + r + 1); out[y * bw + x] = (c2[h2] - c2[l2]) > 0 ? 1 : 0; }
    }
    return out;
  }
  function components(bmp, bw, bh) {
    var lab = new Int32Array(bmp.length), comps = [], stack = [], x, y, n = 0;
    for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
      var idx = y * bw + x; if (!bmp[idx] || lab[idx]) continue;
      n++; var c = { id: n, x0: x, x1: x, y0: y, y1: y, area: 0, sx: 0, sy: 0 };
      stack.length = 0; stack.push(idx); lab[idx] = n;
      while (stack.length) {
        var p = stack.pop(), px = p % bw, py = (p - px) / bw;
        c.area++; c.sx += px; c.sy += py; if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px; if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          var ni = ny * bw + nx; if (bmp[ni] && !lab[ni]) { lab[ni] = n; stack.push(ni); }
        }
      }
      comps.push(c);
    }
    return comps;
  }
  function inkAt(s, x, y) { return x >= 0 && y >= 0 && x < s.bw && y < s.bh && s.bmp[y * s.bw + x] ? 1 : 0; }
  /** 열 x 에서 (x, y) 부터 위(dir = −1) 또는 아래(+1) 로 이어진 잉크 길이 (픽셀) */
  function vrun(s, x, y, dir, max) { var n = 0; while (n < max && inkAt(s, x, y + dir * n)) n++; return n; }

  /** 음표 하나의 특징을 원본(오선 지운) 그림에서 읽음: 빈 머리 · 줄기 · 꼬리(깃발/빔) 개수 · 점 */
  function readNote(s, cx, cy, sp, hw, lineRows, lineHalf) {
    // 머리 한가운데가 비어 있으면 빈 머리(2분 · 온음표). 오선이 구멍을 가로질러 지나가는 줄은 무시하고,
    // 가운데에서 위 · 아래로 0.35칸 안에 "비어 있는(선이 아닌) 픽셀"이 각각 2개 이상 있으면 구멍이 있는 것으로 봄
    var open = false, dx, dy, ci, reach = Math.max(3, Math.round(sp * 0.35));
    function isLine(y) { for (var li = 0; li < lineRows.length; li++) if (Math.abs(y - lineRows[li]) <= lineHalf) return true; return false; }
    for (ci = -1; ci <= 1 && !open; ci++) {
      var px = Math.round(cx + ci * sp * 0.12), wu = 0, wd = 0;
      for (dy = 1; dy <= reach; dy++) {
        if (!isLine(Math.round(cy) - dy) && !inkAt(s, px, Math.round(cy) - dy)) wu++;
        if (!isLine(Math.round(cy) + dy) && !inkAt(s, px, Math.round(cy) + dy)) wd++;
      }
      if (wu >= 2 && wd >= 2) open = true;
    }
    var x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
    // 줄기: 머리 왼쪽 · 오른쪽 가장자리 열에서 위 또는 아래로 길게 이어진 잉크
    var need = Math.round(sp * 2.5), stemDir = 0, stemX = 0, best = 0, col, side, edge = Math.round(sp * 0.3), inner = Math.round(sp * 0.36);
    for (side = 0; side < 2; side++) {
      var lo = side === 0 ? x0 - edge : x1 - inner, hi = side === 0 ? x0 + inner : x1 + edge;      // 줄기는 머리 왼쪽(아래 줄기) · 오른쪽(위 줄기) 가장자리 근처 — 그림 크기 · 번짐에 따라 몇 픽셀 어긋나므로 넉넉히 훑음
      for (col = lo; col <= hi; col++) {
        var up = 0, dn = 0, kk, kmax = Math.round(sp * 0.55);                          // V849 — 줄기가 머리 한가운데가 아니라 위 · 아래 모서리에 붙은 경우(흔함)도
        for (kk = 0; kk <= kmax; kk += 1) {
          var u1 = vrun(s, col, Math.round(cy) - kk, -1, Math.round(sp * 5.2)); if (u1) up = Math.max(up, u1 + kk);
          var d1 = vrun(s, col, Math.round(cy) + kk, 1, Math.round(sp * 5.2)); if (d1) dn = Math.max(dn, d1 + kk);
        }
        if (up >= need && up > best) { best = up; stemDir = -1; stemX = col; }
        if (dn >= need && dn > best) { best = dn; stemDir = 1; stemX = col; }
      }
    }
    var stem = stemDir !== 0, flags = 0;
    if (stem && !open || (stem && open)) {
      // 꼬리: 줄기 끝에서 머리 쪽으로 2.2칸 안에서, 줄기 옆(오른쪽 · 왼쪽) 세로줄을 훑어 잉크 "띠"가 몇 개인지 셈 (깃발 · 빔 1개 = 8분, 2개 = 16분)
      var tipY = Math.round(cy) + stemDir * (best - 1), off = Math.round(sp * 0.5) + 3, bands = 0, sideIdx;
      for (sideIdx = 0; sideIdx < 2; sideIdx++) {
        var xx = sideIdx === 0 ? stemX + off : stemX - off, run = 0, cnt = 0, len = Math.round(sp * 2.2), k3;
        for (k3 = 0; k3 <= len; k3++) {
          var on = inkAt(s, xx, tipY - stemDir * k3) || inkAt(s, xx + 1, tipY - stemDir * k3);
          if (on) run++; else { if (run >= Math.max(2, Math.round(sp * 0.12))) cnt++; run = 0; }
        }
        if (run >= Math.max(2, Math.round(sp * 0.12))) cnt++;
        if (cnt > bands) bands = cnt;
      }
      flags = Math.min(2, bands);
    }
    // 점(붙임점): 머리 오른쪽 조금 떨어진 곳(선 위에 앉은 음표는 점이 위쪽 칸에 찍힘)의 작은 잉크 덩어리
    var dotInk = 0, dotTot = 0, ax;
    for (ax = Math.round(cx + hw + sp * 0.25); ax <= Math.round(cx + hw + sp * 0.85); ax++) for (dy = -Math.round(sp * 0.7); dy <= Math.round(sp * 0.3); dy++) { dotTot++; dotInk += inkAt(s, ax, Math.round(cy) + dy); }
    var dotFrac = dotTot > 0 ? dotInk / dotTot : 0, dot = dotFrac > 0.07 && dotFrac < 0.5;
    return { open: open, stem: stem, stemDir: stemDir, stemX: stemX, flags: flags, dot: dot };
  }

  /** 오선 하나에서 음표 머리를 찾음: [{ x, y, step, open, stem, flags, dot, w, h }] (픽셀). step: 아래 첫째 줄 = 0, 한 칸마다 +1 (위로) */
  function detectNotes(bin, w, h, st, opt) {
    opt = opt || {};
    var s = stripStaff(bin, w, h, st, !!opt.wide), sp = st.sp, kw = Math.max(3, Math.round(sp * 0.55)), kh = Math.max(1, Math.round(sp * 0.32));
    var op = hopen(s.bmp, s.bw, s.bh, kw), cl = vclose(op, s.bw, s.bh, kh), comps = components(cl, s.bw, s.bh), out = [];
    var skipX = (opt.skipLeft != null ? opt.skipLeft : st.x0 + sp * 3.4) - s.ox;
    var bottomY = st.bottom - s.oy, half = sp / 2, lineRows = st.lines.map(function (y) { return Math.round(y) - s.oy; }), lineHalf = Math.max(1, Math.ceil(st.thick / 2)) + 1;
    /* V849 — 붙임줄 · 이음줄(가는 곡선)이 머리에 붙어 커진 덩어리는, 가는 것을 지우는 세로 열기를 한 뒤 다시 나눠 봄 */
    var more = [];
    comps.forEach(function (c) {
      var cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1, fill = c.area / (cw * ch);
      var bigOne = (cw > 2.0 * sp && fill < 0.6) || (cw > 3.1 * sp && ch <= 2.6 * sp) || (ch > 1.55 * sp && ch <= 2.8 * sp && cw >= 0.9 * sp && cw <= 6 * sp);
      if (!bigOne) return;
      var bw2 = cw, bh2 = ch, sub = new Uint8Array(bw2 * bh2), xx, yy;
      for (yy = 0; yy < bh2; yy++) for (xx = 0; xx < bw2; xx++) sub[yy * bw2 + xx] = cl[(c.y0 + yy) * s.bw + c.x0 + xx];
      var vo = vopen(sub, bw2, bh2, Math.max(1, Math.round(sp * 0.2)));
      components(vo, bw2, bh2).forEach(function (q) {
        // 남은 이음줄 끝을 떼고 머리 부분(가장 넓은 줄의 55% 이상인 줄들)만
        var rw = [], yy3, xx3, mx = 0; for (yy3 = q.y0; yy3 <= q.y1; yy3++) { var n3 = 0; for (xx3 = q.x0; xx3 <= q.x1; xx3++) n3 += vo[yy3 * bw2 + xx3]; rw.push(n3); if (n3 > mx) mx = n3; }
        var ya3 = 0, yb3 = rw.length - 1; while (ya3 < yb3 && rw[ya3] < 0.55 * mx) ya3++; while (yb3 > ya3 && rw[yb3] < 0.55 * mx) yb3--;
        var area3 = 0; for (yy3 = ya3; yy3 <= yb3; yy3++) area3 += rw[yy3];
        more.push({ x0: q.x0 + c.x0, x1: q.x1 + c.x0, y0: q.y0 + ya3 + c.y0, y1: q.y0 + yb3 + c.y0, area: Math.max(area3, 1), sub: true });
      });
    });
    function ledgerAt(px, ly) {
      var best = 0;
      for (var dy = -2; dy <= 2; dy++) { var yy = Math.round(ly + dy), run = 0; if (yy < 0 || yy >= h) continue; for (var xx = Math.round(px - 1.2 * sp); xx <= Math.round(px + 1.2 * sp); xx++) { if (xx >= 0 && xx < w && bin[yy * w + xx]) { run++; if (run > best) best = run; } else run = 0; } }
      return best >= 1.4 * sp;
    }
    function rectish(c) {                                                              // 빔 조각(네모)인가 — 머리(타원)는 위 · 아래 끝줄이 가운데보다 훨씬 좁음
      var ch = c.y1 - c.y0 + 1, wAt = function (yy) { var n = 0; for (var xx = c.x0; xx <= c.x1; xx++) n += cl[yy * s.bw + xx] ? 1 : 0; return n; };
      var mid = wAt(Math.round((c.y0 + c.y1) / 2)), a2 = wAt(c.y0 + Math.round(ch * 0.12)), b2 = wAt(c.y1 - Math.round(ch * 0.12));
      return mid > 0 && a2 >= 0.88 * mid && b2 >= 0.88 * mid;
    }
    comps.concat(more).forEach(function (c) {
      var cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1, fill = c.area / (cw * ch);
      if (ch < 0.62 * sp || ch > 1.55 * sp || cw < 0.92 * sp || cw > 3.1 * sp || fill < 0.5) return;                // (코드 글자 · 박자 숫자는 머리보다 좁음)
      if (cw > 2.0 * sp && fill < 0.6) return;                                           // 긴 덩어리는 빔 · 이음줄일 가능성이 큼 — 머리 두 개가 붙은 것만 둘로 나눔
      if (fill >= 0.975 && !c.sub) return;                                                 // V849 — 꽉 찬 네모 = 16분음표 빔 두 줄 조각 (머리는 타원이라 모서리가 빔)
      var n = cw > 2.0 * sp ? 2 : 1, k;
      for (k = 0; k < n; k++) {
        var segW = cw / n, cx = c.x0 + segW * (k + 0.5), cy = (c.y0 + c.y1) / 2;
        if (cx < skipX) continue;
        var step = Math.round((bottomY - cy) / half);
        if (step < -5 || step > 13) continue;                                              // 덧줄 두 개 안쪽만 (그 밖은 코드 글자 · 가사)
        if ((step >= 10 || step <= -2) && !ledgerAt(cx + s.ox, step >= 10 ? st.top - sp : st.bottom + sp)) continue;   // V849 — 오선 밖 음은 덧줄이 있어야 (빔 조각을 머리로 읽지 않게)
        var f = readNote(s, cx, cy, sp, Math.min(segW, 1.3 * sp) / 2, lineRows, lineHalf);
        if (!f.stem && !f.open) continue;                                                // 온음표가 아니면 줄기가 있어야 음표로 봄 (열쇠 · 임시표 조각 걸러내기)
        if (!f.stem && f.open && (cw > 1.9 * sp || cw < 1.15 * sp)) continue;               // 줄기 없는 빈 머리(온음표)는 폭이 머리 1.15~1.9칸 — 그보다 좁으면 글자 · 숫자
        out.push({ x: cx + s.ox, y: cy + s.oy, step: step, open: f.open, stem: f.stem, flags: f.flags, dot: f.dot, w: Math.min(segW, 1.6 * sp), h: ch, sx: f.stemX, sd: f.stemDir });
      }
    });
    // 꼬리(깃발) 덩어리가 머리로 잘못 잡히는 것 거르기: 다른 음표의 줄기 위에 그 줄기 방향으로 1.4~4.4칸 떨어져 얹혀 있으면(같은 줄기 열) 머리가 아니라 그 음표의 꼬리
    out = out.filter(function (a) {
      if (!a.stem) return true;
      return !out.some(function (b) { var d = (a.y - b.y) * b.sd; return b !== a && b.stem && Math.abs(b.sx - a.sx) <= 0.3 * sp && d > 1.4 * sp && d < 4.4 * sp && b.w * b.h > a.w * a.h; });
    });
    out.forEach(function (n) { delete n.sx; delete n.sd; });
    out.sort(function (a, b) { return a.x - b.x; });
    return out;
  }

  /** 음표 길이(박) 짐작 — 4분음표 = 1박. 빈 머리 + 줄기 = 2박 · 줄기 없는 빈 머리 = 4박 · 꼬리 1개 = 0.5박 · 2개 = 0.25박 · 점 = ×1.5.
   *  뒤 음표와의 간격이 유난히 넓으면(쉼표) restAfter(박) 를 붙임. notes 는 한 오선의 음표 (x 순서) */
  function estimateBeats(notes) {
    var unit = [];
    notes.forEach(function (n, i) {
      var b = n.open ? (n.stem ? 2 : 4) : n.flags >= 2 ? 0.25 : n.flags === 1 ? 0.5 : 1;
      if (n.dot) b *= 1.5;
      n.beats = b; n.restAfter = 0;
      if (i + 1 < notes.length && b === 1 && !n.dot) unit.push(notes[i + 1].x - n.x);
    });
    var q = median(unit);
    if (q > 0) notes.forEach(function (n, i) {
      if (i + 1 >= notes.length) return;
      var gap = notes[i + 1].x - n.x;
      if (gap > 1.85 * q * Math.max(1, n.beats) && gap > q * 1.9) n.restAfter = Math.min(4, Math.round((gap / q - n.beats) * 2) / 2);
    });
    return notes;
  }

  /* ------------------------------------------------------------ 6) 조표 (V849)
     음자리표(오선보다 큰 덩어리) 바로 뒤에 이어지는 ♯ · ♭ 덩어리를 셉니다.
       ♯ = 오선 1.3칸 이상 긴 세로 획이 둘 · ♭ = 왼쪽에 긴 세로 획 하나 + 아래쪽이 불룩(둥근 배)
     첫 기호의 자리도 확인합니다 (♯ 는 맨 윗줄 F5 근처에서, ♭ 은 가운데 줄 B4 근처에서 시작).
     반환 { n: 샵 수(+) · 플랫 수(−) · 0, endX: 조표가 끝나는 x(픽셀), conf: 0~1 } */
  function detectKeySig(bin, w, h, st) {
    var sp = st.sp, half = sp / 2, th = Math.max(1, Math.ceil(st.thick / 2)) + 1;
    var top = Math.max(0, Math.round(st.top - 3 * sp)), bot = Math.min(h - 1, Math.round(st.bottom + 3 * sp));
    var xa = Math.max(0, Math.round(st.x0)), xb = Math.min(w - 1, Math.round(st.x0 + 16 * sp));
    function isLineRow(y) { for (var k = 0; k < 5; k++) if (Math.abs(y - st.lines[k]) <= th) return true; return false; }
    /* 1) 세로 획: 열마다 이어진 잉크(1칸 틈은 이어 봄) 1.2칸 이상 → 옆 열과 겹치면 한 획 */
    var strokes = [], open = [], x, y;
    for (x = xa; x <= xb; x++) {
      var runs = [], ys = -1, last = -1;
      for (y = top; y <= bot + 2; y++) {
        var on = y <= bot && bin[y * w + x];
        if (on) { if (ys < 0) ys = y; last = y; }
        else if (ys >= 0 && y - last > 2) { if (last - ys + 1 >= 1.2 * sp) runs.push([ys, last]); ys = -1; }
      }
      var next = [];
      runs.forEach(function (r) {
        var hit = null;
        for (var i = 0; i < open.length; i++) { var o = open[i]; var ov = Math.min(o.y1, r[1]) - Math.max(o.y0, r[0]); if (ov > 0.5 * Math.min(o.y1 - o.y0, r[1] - r[0])) { hit = o; break; } }
        if (hit) { open.splice(open.indexOf(hit), 1); hit.x1 = x; hit.y0 = Math.min(hit.y0, r[0]); hit.y1 = Math.max(hit.y1, r[1]); hit.len = Math.max(hit.len, r[1] - r[0] + 1); next.push(hit); }
        else { var ns = { x0: x, x1: x, y0: r[0], y1: r[1], len: r[1] - r[0] + 1 }; strokes.push(ns); next.push(ns); }
      });
      open = next;
    }
    strokes.forEach(function (k) { k.w = k.x1 - k.x0 + 1; });
    /* 2) 음자리표: 맨 앞쪽의 아주 긴 획(4.2칸 이상) — 그 덩어리(오선을 지운 그림에서)의 오른쪽 끝까지 */
    var s = stripStaff(bin, w, h, st), xr = Math.min(s.bw, Math.round(st.x0 - s.ox + 6 * sp)), sub = new Uint8Array(xr * s.bh);
    for (y = 0; y < s.bh; y++) for (x = 0; x < xr; x++) sub[y * xr + x] = s.bmp[y * s.bw + x];
    var big = components(sub, xr, s.bh).filter(function (c) { return (c.y1 - c.y0 + 1) >= 4.2 * sp; }).sort(function (a, b) { return a.x0 - b.x0; })[0];
    var clefEnd;
    if (big) clefEnd = big.x1 + s.ox;
    else {
      var clef = strokes.filter(function (k) { return k.len >= 4.2 * sp && k.x0 < st.x0 + 5 * sp; })[0];
      if (!clef) return { n: 0, endX: null, conf: 0 };
      clefEnd = clef.x1 + 1.0 * sp;
    }
    if (big && big.x1 - big.x0 > 3.6 * sp) clefEnd = big.x0 + s.ox + 2.8 * sp;          // 조표가 음자리표에 붙어 버린 경우
    /* 3) 음자리표 뒤 획들: ♯ = 가까운 두 획 · ♭ = 획 하나 + 오른쪽 아래 둥근 배. 마디줄 · 줄기(3.4칸↑) · 박자표(같은 자리 위아래 두 획) · 먼 틈에서 멈춤 */
    var cand = strokes.filter(function (k) { return k.x0 > clefEnd && k.x0 <= xb; }).sort(function (a, b) { return a.x0 - b.x0; });
    function bowl(k) {
      var ink = 0, tot = 0, xx, yy;
      for (xx = k.x1 + 1; xx <= k.x1 + Math.round(0.7 * sp); xx++) for (yy = Math.round(k.y1 - 0.9 * sp); yy <= k.y1; yy++) { if (isLineRow(yy)) continue; tot++; if (xx < w && yy >= 0 && yy < h && bin[yy * w + xx]) ink++; }
      var up = 0, ut = 0;
      for (xx = k.x1 + 1; xx <= k.x1 + Math.round(0.7 * sp); xx++) for (yy = k.y0; yy <= Math.round(k.y0 + 0.6 * sp); yy++) { if (isLineRow(yy)) continue; ut++; if (xx < w && yy >= 0 && yy < h && bin[yy * w + xx]) up++; }
      return tot && ink / tot > 0.16 && (ut ? up / ut : 0) < ink / tot * 0.6;
    }
    var list = [], prevEnd = clefEnd, i = 0;
    while (i < cand.length && list.length < 7) {
      var k = cand[i];
      if (k.x0 - prevEnd > 1.8 * sp) break;
      if (k.len > 3.4 * sp || k.w > 0.5 * sp) break;
      if (k.len < 1.3 * sp) { i++; continue; }
      var twin = cand.filter(function (q) { return q !== k && Math.abs(q.x0 - k.x0) <= 0.3 * sp && (q.y0 > k.y1 || q.y1 < k.y0); })[0];
      if (twin) break;                                                                    // 박자표 (4/4 의 4 두 개)
      var nb = cand[i + 1];
      if (nb && nb.x0 - k.x1 <= 0.7 * sp && nb.x0 - k.x1 >= 1 && Math.abs(nb.len - k.len) <= 0.8 * sp && Math.abs((nb.y0 + nb.y1) - (k.y0 + k.y1)) / 2 <= 0.7 * sp && nb.len <= 3.4 * sp) {
        list.push({ t: 1, step: Math.round((st.bottom - (Math.min(k.y0, nb.y0) + Math.max(k.y1, nb.y1)) / 2) / half), x1: nb.x1 + 0.3 * sp }); prevEnd = nb.x1; i += 2; continue;
      }
      if (bowl(k)) { list.push({ t: -1, step: Math.round((st.bottom - (k.y1 - 0.45 * sp)) / half), x1: k.x1 + 0.75 * sp }); prevEnd = k.x1 + 0.6 * sp; i++; continue; }
      break;
    }
    if (list.length) { var t0 = list[0].t; list = list.filter(function (a) { return a.t === t0; }); }
    if (!list.length) return { n: 0, endX: clefEnd, conf: 0.4 };
    var t = list[0].t, want = t > 0 ? [8, 5, 9, 6, 3, 7, 4] : [4, 7, 3, 6, 2, 5, 1], hitN = 0;
    list.forEach(function (a, j) { if (Math.abs(a.step - want[j]) <= 1) hitN++; });
    return { n: t * list.length, endX: Math.round(list[list.length - 1].x1), conf: Math.round(hitN / list.length * 100) / 100 };
  }
  /** 여러 오선의 조표를 모아 가장 많이 나온 값 (멜로디 오선 우선) */
  function voteKeySig(staves) {
    var tally = {}, best = null;
    staves.forEach(function (st) { var k = st.keySig; if (!k || k.conf < 0.4) return; var key = String(k.n); tally[key] = (tally[key] || 0) + (st.melody ? 2 : 1) * (0.5 + k.conf); });
    Object.keys(tally).forEach(function (key) { if (!best || tally[key] > tally[best]) best = key; });
    if (best == null) return null;
    var tot = 0; Object.keys(tally).forEach(function (key) { tot += tally[key]; });
    return { n: +best, conf: Math.round(tally[best] / tot * 100) / 100, votes: tally };
  }

  /** 한 번에: RGBA 픽셀 → { staves, notes, w, h }. 음표는 staff(오선 번호) · 멜로디 오선(melody)에서 찾은 것만 (모든 오선을 원하면 opt.allStaves) */
  function analyze(rgba, w, h, opt) {
    opt = opt || {};
    var gray = toGray(rgba, w, h), bin = binarize(gray, w, h, { adaptive: !!opt.adaptive });
    var staves = groupSystems(detectStaves(bin, w, h)), notes = [];
    if (!opt.adaptive && staves.length < 2) {                                           // V849 — 스캔을 넣은 PDF · 그늘진 사진: 전체 기준으로 오선이 안 보이면 국소 기준으로 다시
      var bin2 = binarize(gray, w, h, { adaptive: true }), st2 = groupSystems(detectStaves(bin2, w, h));
      if (st2.length > staves.length) { bin = bin2; staves = st2; }
    }
    /* V849 — 흐린(작은 그림을 키운) 악보는 오선 한 줄이 연한 회색이라 못 찾는 일이 많아, 오선만은 더 너그러운 기준으로도 찾아 봄 */
    var thrL = Math.min(236, otsu(gray) + (255 - otsu(gray)) * 0.55), binL = new Uint8Array(gray.length), q;
    for (q = 0; q < gray.length; q++) binL[q] = gray[q] <= thrL ? 1 : 0;
    var stL = groupSystems(detectStaves(binL, w, h));
    if (stL.length > staves.length) staves = stL;
    staves.forEach(function (st) { try { st.keySig = detectKeySig(bin, w, h, st); } catch (e) { st.keySig = null; } });
    staves.forEach(function (st, si) {
      var o2 = opt; if (st.keySig && st.keySig.endX != null && opt.skipLeft == null) { o2 = {}; for (var kk in opt) o2[kk] = opt[kk]; o2.skipLeft = st.keySig.endX + 0.5 * st.sp; }   // V849 — 조표가 끝난 자리부터 음표
      var list = detectNotes(bin, w, h, st, o2);
      /* V849 — 오선을 지우는 두 방법(가까이 · 넓게 살핌)으로 각각 찾아 합침: 줄 위의 머리 · 칸 안의 빈 머리를 모두 살림 */
      var o3 = {}; for (var k3 in o2) o3[k3] = o2[k3]; o3.wide = true;
      detectNotes(bin, w, h, st, o3).forEach(function (n2) { if (!list.some(function (n1) { return Math.abs(n1.x - n2.x) < 0.6 * st.sp && Math.abs(n1.y - n2.y) < 0.6 * st.sp; })) list.push(n2); });
      list.sort(function (a, b) { return a.x - b.x; });
      estimateBeats(list);
      list.forEach(function (n) { n.staff = si; notes.push(n); });
    });
    return { staves: staves, notes: notes, w: w, h: h, keySig: voteKeySig(staves) };
  }
  /** 조표 개수(샵 · 플랫 수)에 따른 악보 앞부분(음자리표 + 조표) 폭 — 그 왼쪽의 음표 "후보"는 무시하는 데 씀 (오선 간격 단위) */
  function headerSpaces(sigCount) { return 3.6 + 1.2 * Math.abs(sigCount || 0); }

  return { toGray: toGray, binarize: binarize, detectStaves: detectStaves, groupSystems: groupSystems, stripStaff: stripStaff, detectNotes: detectNotes, estimateBeats: estimateBeats, analyze: analyze, headerSpaces: headerSpaces, detectKeySig: detectKeySig, voteKeySig: voteKeySig };
}));
