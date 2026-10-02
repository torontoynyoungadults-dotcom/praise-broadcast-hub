/**
 * 악보 쪽에서 "위쪽 제목 · 순서 머리글"을 찾아 잘라낼 영역을 계산합니다 (원본 PDF 는 건드리지 않고, 쪽을 새 PDF 에 올릴 때 이 영역만 보이게).
 *  · PDFium 으로 쪽을 작은 그림으로 그려서 → 가로로 길게 이어진 줄(오선) 묶음이 처음 나오는 곳을 찾고,
 *    그 위쪽에 오선이 없는 글 덩어리(제목 · 순서 · 곡 정보)가 충분히 떨어져 있으면 그 덩어리만 뺍니다.
 *  · 오선이 없는 코드 악보(가사 + 코드)는 "맨 위 짧은 한 덩어리 + 큰 빈 줄" 일 때만 제목으로 봅니다.
 *  · 확신이 없으면 자르지 않습니다 (악보가 잘리는 것보다 제목이 남는 쪽이 낫습니다).
 *  · 가로는 내용이 있는 폭만 남겨 인쇄 때 악보가 더 크게 들어가도록 합니다.
 */
let _lib = null;
async function pdfium() { if (!_lib) { const m = await import('@hyzyla/pdfium'); _lib = await m.PDFiumLibrary.init(); } return _lib; }   // PDFium(WASM) — pdf.js 보다 스캔 악보를 수십 배 빠르게 그림

const RENDER_W = 1400;            // 분석용 그림 가로 픽셀
const DARK = 200;                // 이 밝기보다 어두우면 "잉크" (스캔 · 축소된 얇은 오선도 잡도록 넉넉히)

/** gray: Uint8 (w*h). → { top, bottom, left, right } 0~1 비율 (내용 영역), 그리고 headerCut(true 면 top 이 제목 아래) */
function analyze(gray, w, h) {
  const rowInk = new Float32Array(h), rowRun = new Float32Array(h);
  const colInk = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    let ink = 0, run = 0, best = 0;
    const o = y * w;
    for (let x = 0; x < w; x++) {
      if (gray[o + x] < DARK) { ink++; run++; colInk[x]++; if (run > best) best = run; } else run = 0;
    }
    rowInk[y] = ink / w; rowRun[y] = best / w;
  }
  const noise = 0.004;
  const inkRow = (y) => rowInk[y] > noise;
  // 내용 범위
  let top = 0, bottom = h - 1;
  while (top < h && !inkRow(top)) top++;
  while (bottom > top && !inkRow(bottom)) bottom--;
  if (top >= bottom) return null;
  let left = 0, right = w - 1;
  const cth = Math.max(2, (bottom - top) * 0.004);
  while (left < w && colInk[left] < cth) left++;
  while (right > left && colInk[right] < cth) right--;

  // 글 덩어리(블록) — 빈 줄이 gapMerge 이상 벌어지면 따로
  const gapMerge = Math.round(h * 0.010);
  const blocks = [];
  let s = -1, last = -1;
  for (let y = top; y <= bottom; y++) {
    if (inkRow(y)) { if (s < 0) s = y; last = y; }
    else if (s >= 0 && y - last > gapMerge) { blocks.push({ a: s, b: last }); s = -1; }
  }
  if (s >= 0) blocks.push({ a: s, b: last });

  // 오선 — 가로 대부분이 잉크인 줄(오선은 음표에 끊겨도 해당)이 짧은 높이 안에 5줄 가까이 모여 있으면 오선 (제목 밑줄 한 줄은 해당 안 됨)
  const lineRow = new Uint8Array(h + 1);
  for (let y = top; y <= bottom; y++) lineRow[y] = (rowRun[y] >= 0.45 || rowInk[y] >= 0.5) ? 1 : 0;
  const win = Math.max(6, Math.round(h * 0.05));
  const lines = [];                                  // 줄 덩어리(붙은 줄은 하나)의 시작 y 와 두께
  for (let y = top; y <= bottom;) {
    if (!lineRow[y]) { y++; continue; }
    let e = y; while (e + 1 <= bottom && lineRow[e + 1]) e++;
    lines.push({ a: y, n: e - y + 1 }); y = e + 1;
  }
  let firstStaff = -1;
  for (let i = 0; i < lines.length && firstStaff < 0; i++) {
    let cl = 0, rows = 0;
    for (let j = i; j < lines.length && lines[j].a - lines[i].a <= win; j++) { cl++; rows += lines[j].n; }
    if (cl >= 3 || (cl >= 2 && rows >= 6)) firstStaff = lines[i].a;
  }

  let cutY = top, cut = false;
  const minGap = h * 0.014;
  if (firstStaff >= 0) {
    // 오선이 처음 나오는 덩어리 앞의 덩어리들 = 후보 머리글
    let bi = blocks.findIndex((b) => firstStaff >= b.a - 2 && firstStaff <= b.b + 2);
    if (bi > 0) {
      let hi = bi - 1;                                  // 머리글 후보의 마지막 덩어리
      const last = blocks[hi];
      // 오선 바로 위에 붙은 짧은 한 줄(코드 · 구간 표시)은 악보의 일부 — 남김
      if (blocks[bi].a - last.b < h * 0.07 && last.b - last.a < h * 0.0135) hi--;
      if (hi >= 0) {
        const gap = blocks[hi + 1].a - blocks[hi].b;
        if (gap >= minGap && blocks[hi].b < h * 0.30) { cutY = blocks[hi + 1].a; cut = true; }
      }
    }
  } else if (blocks.length >= 3) {
    const b0 = blocks[0], g = blocks[1].a - b0.b;
    if (b0.b - b0.a < h * 0.09 && g >= h * 0.025 && b0.b < h * 0.2) { cutY = blocks[1].a; cut = true; }
  }
  if (process.env.SHEETCROP_DEBUG) console.log('crop-debug', JSON.stringify({ h, blocks: blocks.map((b) => [+(b.a / h).toFixed(3), +(b.b / h).toFixed(3)]), lines: lines.map((l) => [+(l.a / h).toFixed(3), l.n]), firstStaff: firstStaff / h, cut, cutY: cutY / h }));
  const pad = Math.round(h * 0.006);
  return {
    top: Math.max(0, (cut ? cutY - pad : top - pad)) / h, bottom: Math.min(h - 1, bottom + pad) / h,
    left: Math.max(0, left - pad) / w, right: Math.min(w - 1, right + pad) / w, headerCut: cut,
  };
}

/** PDF 버퍼 → [{ pageNo, w, h, box:{left,top,right,bottom}(0~1)|null, headerCut }] — pageNos(1부터) 만 분석. budgetMs 를 넘으면 남은 쪽은 건너뜀(자르지 않고 그대로) */
async function detect(buf, pageNos, budgetMs) {
  const lib = await pdfium();
  const t0 = Date.now(), limit = budgetMs || 15000;
  const doc = await lib.loadDocument(buf);
  const out = [];
  try {
    for (const no of pageNos) {
      if (Date.now() - t0 > limit) break;
      if (no < 1 || no > doc.getPageCount()) continue;
      const page = doc.getPage(no - 1);
      const sz = page.getOriginalSize();
      const img = await page.render({ scale: RENDER_W / sz.originalWidth, render: 'bitmap' });
      const cw = img.width, ch = img.height, d = img.data;
      const gray = new Uint8Array(cw * ch);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (d[j + 2] * 299 + d[j + 1] * 587 + d[j] * 114) / 1000;   // BGRA
      let a = null;
      try { a = analyze(gray, cw, ch); } catch (e) { a = null; }
      out.push({ pageNo: no, w: sz.originalWidth, h: sz.originalHeight, box: a, headerCut: !!(a && a.headerCut) });
    }
  } finally { try { doc.destroy(); } catch (e) { /* 무시 */ } }
  return out;
}

module.exports = { detect, analyze };
