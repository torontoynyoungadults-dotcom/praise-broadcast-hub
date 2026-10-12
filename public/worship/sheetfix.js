/**
 * 악보 화질 보정 (v12) — 사진 · 스캔 악보를 브라우저에서 보정해 새 파일로 바꿔 끼웁니다.
 * ============================================================
 * · 예배 중이 아니라 "올린 뒤 미리" 하는 작업입니다. 라이브 악보는 이 파일을 열 때까지 아무것도 불러오지 않습니다
 *   (TensorFlow.js · AI 모델 · pdf-lib 는 보정 창을 열 때만 내려받고, 창을 닫으면 그래픽 메모리까지 모두 돌려줍니다).
 * · 무거운 계산은 올리는 사람의 컴퓨터 · iPad Pro 에서만 합니다 — 서버는 결과 PDF 를 받아 바꿔 끼우기만 합니다.
 *
 * 쪽마다 하는 일 (사진 · 스캔 쪽만 — 글자 · 선으로 된 PDF 쪽은 이미 선명해서 그대로 둡니다)
 *   ① 회색으로 · 종이 배경 고르게 (누런 종이 · 그림자 · 얼룩 → 흰 바탕, 블록마다 종이 밝기를 재서 나눔)
 *   ② 해상도가 모자라면 AI 2배 (ESRGAN-slim · 128px 조각씩, 조각 사이 이음매가 생기지 않게 겹쳐서) — 그 뒤 목표 크기로
 *   ③ 음표 · 선은 더 진하게, 종이는 하얗게 (부드러운 문턱 — 가장자리 계단 현상 없이)
 *   쪽 크기(가로 · 세로 비율)와 내용 자리는 그대로 → 0~1 비율로 저장된 필기 · 화음이 같은 자리에 맞습니다. (기울기 보정은 하지 않음)
 *
 * YNSheetFix.open({ id, name, fetchUrl, info(), apply(pdfBytes) → Promise<{fileId}>, revert() → Promise<{fileId}>, onDone(newId) })
 * YNSheetFix._engine — 시험용 (process · flatten · levels · aiUpscale …)
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var URLS = { tf: '/vendor/tfjs/tf.min.js', model: '/vendor/upscale/esrgan-slim-x2/model.json', pdfjs: '/vendor/pdfjs/pdf.min.js', pdfjsW: '/vendor/pdfjs/pdf.worker.min.js', pdflib: '/vendor/pdf-lib.min.js' };
  var CFG = {
    target: 3000,          // 결과 쪽의 긴 변 (iPad Pro 12.9 세로 화면 2732px 보다 조금 크게)
    maxSrc: 2000,          // PDF 쪽을 그림으로 그릴 때 긴 변 최대 (AI 입력 — 클수록 느림)
    minSrc: 900,
    aiMin: 1.45,           // 목표까지 이만큼 이상 키워야 하면 AI 2배 (아니면 일반 확대)
    patch: 128, pad: 10,   // AI 조각 · 겹침
    jpegQ: 0.9, maxBytes: 19 * 1048576,
    aiMaxMs: 70000,        // 한 쪽에 AI 가 이보다 오래 걸릴 것 같으면 (느린 기기) 그 쪽부터 일반 보정으로 — 멈춘 것처럼 보이지 않게
    levels: 'mid'
  };

  /* ---------------------------------------------------------------- 불러오기 */
  var loaded = {};
  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (ok, no) {
      var s = doc.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { test() ? ok() : no(new Error('도구를 불러오지 못했습니다.')); };
      s.onerror = function () { delete loaded[src]; no(new Error('도구를 내려받지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      doc.head.appendChild(s);
    });
    return loaded[src];
  }
  function pdfjs() { return loadScript(URLS.pdfjs, function () { return !!root.pdfjsLib; }).then(function () { try { root.pdfjsLib.GlobalWorkerOptions.workerSrc = URLS.pdfjsW; } catch (e) { /* 무시 */ } return root.pdfjsLib; }); }
  function pdflib() { return loadScript(URLS.pdflib, function () { return !!root.PDFLib; }).then(function () { return root.PDFLib; }); }

  /* ---------------------------------------------------------------- AI (TensorFlow.js · WebGL) */
  var AI = { tf: null, model: null, why: '' };
  function aiLoad() {
    if (AI.model) return Promise.resolve(AI);
    return loadScript(URLS.tf, function () { return !!root.tf; }).then(function () {
      var tf = root.tf;
      return tf.setBackend('webgl').then(function (ok) {
        if (!ok || tf.getBackend() !== 'webgl') throw new Error('이 기기는 그래픽 가속(WebGL)을 쓸 수 없어 AI 보정을 건너뜁니다.');
        try { tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', 0); } catch (e) { /* 텍스처를 바로 돌려줌 (iPad 메모리) */ }
        return tf.ready();
      }).then(function () { return tf.loadLayersModel(URLS.model); }).then(function (m) { AI.tf = tf; AI.model = m; return AI; });
    });
  }
  /** 그래픽 메모리까지 모두 돌려줌 — 창을 닫을 때 (같은 탭에서 라이브 악보를 계속 써도 무겁지 않게) */
  function aiFree() {
    var tf = AI.tf || root.tf; AI.model && AI.model.dispose(); AI.model = null; AI.tf = null;
    if (!tf) return;
    try { tf.disposeVariables(); } catch (e) { /* 무시 */ }
    try { tf.engine().reset(); } catch (e) { /* 백엔드(WebGL 문맥 · 텍스처)를 모두 정리 — 등록은 남아 있어 다음에 다시 쓸 수 있음 */ }
  }
  function frame() { return new Promise(function (r) { (root.requestAnimationFrame || setTimeout)(function () { r(); }, 0); }); }

  /**
   * AI 2배 — gray(w×h, 0~255) → 2w×2h. 128px 조각을 앞뒤로 pad 만큼 겹쳐 넣고 가운데만 붙임 (이음매 없음).
   * onTick(0~1) 진행률 · isStop() 이면 중단(null) · 너무 느리면 'slow' (처음 몇 조각으로 한 쪽 걸리는 시간을 짐작)
   */
  function aiUpscale(gray, w, h, onTick, isStop) {
    var tf = AI.tf, model = AI.model, P = CFG.patch, D = CFG.pad, W2 = w * 2, H2 = h * 2;
    var out = new Uint8ClampedArray(W2 * H2), nx = Math.ceil(w / P), ny = Math.ceil(h / P), total = nx * ny, done = 0;
    var tiles = []; for (var ty = 0; ty < ny; ty++) for (var tx = 0; tx < nx; tx++) tiles.push([tx, ty]);
    var t0 = Date.now();
    function one(i) {
      if (i >= tiles.length) return Promise.resolve(out);
      if (isStop && isStop()) return Promise.resolve(null);
      var tx = tiles[i][0], ty = tiles[i][1];
      var x0 = tx * P, y0 = ty * P, x1 = Math.min(w, x0 + P), y1 = Math.min(h, y0 + P);
      var sx0 = Math.max(0, x0 - D), sy0 = Math.max(0, y0 - D), sx1 = Math.min(w, x1 + D), sy1 = Math.min(h, y1 + D), pw = sx1 - sx0, ph = sy1 - sy0;
      var buf = new Float32Array(pw * ph * 3), k = 0;
      for (var y = sy0; y < sy1; y++) { var row = y * w; for (var x = sx0; x < sx1; x++) { var v = gray[row + x]; buf[k++] = v; buf[k++] = v; buf[k++] = v; } }
      var t = tf.tidy(function () { return model.predict(tf.tensor4d(buf, [1, ph, pw, 3])); });
      return t.data().then(function (d) {
        t.dispose();
        var ow = pw * 2, ox0 = (x0 - sx0) * 2, oy0 = (y0 - sy0) * 2, cw = (x1 - x0) * 2, chh = (y1 - y0) * 2;
        for (var yy = 0; yy < chh; yy++) {
          var src = ((oy0 + yy) * ow + ox0) * 3, dst = (y0 * 2 + yy) * W2 + x0 * 2;
          for (var xx = 0; xx < cw; xx++, src += 3) out[dst + xx] = (d[src] + d[src + 1] + d[src + 2]) / 3;
        }
        done++; if (onTick) onTick(done / total);
        if (done === 4 && total > 12 && (Date.now() - t0) / done * total > CFG.aiMaxMs) { AI.slow = true; return 'slow'; }
        return (done % 6 === 0 ? frame() : Promise.resolve()).then(function () { return one(i + 1); });
      });
    }
    return one(0);
  }

  /* ---------------------------------------------------------------- 화소 처리 (회색 0~255) */
  function toGray(img) {
    var d = img.data, n = img.width * img.height, g = new Uint8ClampedArray(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var a = d[j + 3] / 255;                                                      // 투명한 곳은 흰 종이로
      g[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) * a + 255 * (1 - a);
    }
    return g;
  }
  /**
   * 종이 배경 고르게 — 블록마다 밝은 쪽 90% 값(=종이)을 재고, 이웃 블록과 섞어 부드러운 배경판을 만든 뒤 나눔.
   * 큰 검은 칸(제목 상자 등)이 하얗게 날아가지 않게 이웃 블록의 종이 값을 빌리고, 전체 종이 밝기의 60% 아래로는 내리지 않음.
   */
  function flatten(g, w, h) {
    var B = Math.max(16, Math.round(Math.max(w, h) / 90)), gw = Math.ceil(w / B), gh = Math.ceil(h / B);
    var grid = new Float32Array(gw * gh), hist = new Uint32Array(256);
    for (var by = 0; by < gh; by++) for (var bx = 0; bx < gw; bx++) {
      hist.fill(0); var x0 = bx * B, y0 = by * B, x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B), n = 0;
      for (var y = y0; y < y1; y += 2) { var r = y * w; for (var x = x0; x < x1; x += 2) { hist[g[r + x]]++; n++; } }
      var want = n * 0.9, c = 0, v = 0; for (; v < 256; v++) { c += hist[v]; if (c >= want) break; }
      grid[by * gw + bx] = Math.min(255, v);
    }
    var dil = new Float32Array(gw * gh), sm = new Float32Array(gw * gh), i, j, k;
    for (j = 0; j < gh; j++) for (i = 0; i < gw; i++) {                              // 3×3 최댓값 (종이 빌리기)
      var m = 0; for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) { var a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < gw && b < gh && grid[b * gw + a] > m) m = grid[b * gw + a]; }
      dil[j * gw + i] = m;
    }
    for (j = 0; j < gh; j++) for (i = 0; i < gw; i++) {                              // 3×3 평균 (부드럽게)
      var s = 0, cnt = 0; for (dj = -1; dj <= 1; dj++) for (di = -1; di <= 1; di++) { a = i + di; b = j + dj; if (a >= 0 && b >= 0 && a < gw && b < gh) { s += dil[b * gw + a]; cnt++; } }
      sm[j * gw + i] = s / cnt;
    }
    var sorted = Array.prototype.slice.call(sm).sort(function (p, q) { return p - q; }), paper = sorted[Math.floor(sorted.length / 2)] || 255, floor = Math.max(40, paper * 0.6);
    for (k = 0; k < sm.length; k++) if (sm[k] < floor) sm[k] = floor;
    var out = new Uint8ClampedArray(w * h);
    for (y = 0; y < h; y++) {
      var fy = (y + 0.5) / B - 0.5, j0 = Math.max(0, Math.min(gh - 1, Math.floor(fy))), j1 = Math.min(gh - 1, j0 + 1), ty = Math.max(0, Math.min(1, fy - j0));
      for (x = 0; x < w; x++) {
        var fx = (x + 0.5) / B - 0.5, i0 = Math.max(0, Math.min(gw - 1, Math.floor(fx))), i1 = Math.min(gw - 1, i0 + 1), tx = Math.max(0, Math.min(1, fx - i0));
        var bg = (sm[j0 * gw + i0] * (1 - tx) + sm[j0 * gw + i1] * tx) * (1 - ty) + (sm[j1 * gw + i0] * (1 - tx) + sm[j1 * gw + i1] * tx) * ty;
        out[y * w + x] = g[y * w + x] * 255 / bg;
      }
    }
    return out;
  }
  /** 음표 · 선은 진하게, 종이는 하얗게 — 부드러운 문턱(smoothstep) 이라 가장자리가 계단처럼 깨지지 않음 */
  function levels(g) {
    var hist = new Uint32Array(256), n = g.length, i;
    for (i = 0; i < n; i += 3) hist[g[i]]++;
    var tot = Math.ceil(n / 3), pct = function (p) { var want = tot * p, c = 0; for (var v = 0; v < 256; v++) { c += hist[v]; if (c >= want) return v; } return 255; };
    var mode = CFG.levels || 'mid', ink = pct(0.01), paper = pct(0.5), lut = new Uint8ClampedArray(256), hi, lo, mix;
    if (mode === 'hard') { hi = Math.max(ink + 40, Math.min(250, paper * 0.94)); lo = ink + (hi - ink) * 0.22; mix = 1; }
    else if (mode === 'mid') { hi = Math.max(ink + 40, Math.min(250, paper * 0.96)); lo = ink + (hi - ink) * 0.08; mix = 0.75; }
    else { hi = Math.max(ink + 40, Math.min(252, paper * 0.97)); lo = ink; mix = 0.45; }
    for (var v = 0; v < 256; v++) { var t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); lut[v] = Math.round(255 * (t * (1 - mix) + t * t * (3 - 2 * t) * mix)); }
    for (i = 0; i < n; i++) g[i] = lut[g[i]];
    return { ink: ink, paper: paper, lo: lo, hi: hi };
  }
  function grayToCanvas(g, w, h) {
    var cv = doc.createElement('canvas'); cv.width = w; cv.height = h;
    var cx = cv.getContext('2d'), img = cx.createImageData(w, h), d = img.data;
    for (var i = 0, j = 0; i < g.length; i++, j += 4) { var v = g[i]; d[j] = v; d[j + 1] = v; d[j + 2] = v; d[j + 3] = 255; }
    cx.putImageData(img, 0, 0); return cv;
  }
  /** 캔버스 크기 바꾸기 (브라우저의 고품질 보간) — 두 배 넘게 줄일 때는 반씩 나눠서 (흐려지지 않게) */
  function resizeCanvas(cv, W, H) {
    var cur = cv;
    while (cur.width / 2 >= W && cur.height / 2 >= H) { var hv = doc.createElement('canvas'); hv.width = Math.round(cur.width / 2); hv.height = Math.round(cur.height / 2); var hx = hv.getContext('2d'); hx.imageSmoothingQuality = 'high'; hx.drawImage(cur, 0, 0, hv.width, hv.height); if (cur !== cv) free(cur); cur = hv; }
    if (cur.width === W && cur.height === H) return cur;
    var o = doc.createElement('canvas'); o.width = W; o.height = H; var ox = o.getContext('2d'); ox.imageSmoothingEnabled = true; ox.imageSmoothingQuality = 'high'; ox.drawImage(cur, 0, 0, W, H);
    if (cur !== cv) free(cur); return o;
  }
  /** 일반 확대 뒤 살짝 선명하게 (언샤프 마스크) — AI 를 쓰지 않을 때 */
  function unsharp(g, w, h, amt) {
    var o = new Uint8ClampedArray(g.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { o[i] = g[i]; continue; }
      var bl = (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1] + 2 * g[i - 1] + 4 * g[i] + 2 * g[i + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) / 16;
      o[i] = g[i] + (g[i] - bl) * amt;
    }
    return o;
  }
  /** 3×3 가우시안 (1 2 1) — 확대한 뒤라 글자 굵기에는 거의 영향 없음 */
  function soften(g, w, h) {
    var o = new Uint8ClampedArray(g.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { o[i] = g[i]; continue; }
      o[i] = (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1] + 2 * g[i - 1] + 4 * g[i] + 2 * g[i + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) / 16;
    }
    return o;
  }
  function canvasGray(cv) { return toGray(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)); }
  function free(cv) { try { cv.width = 1; cv.height = 1; } catch (e) { /* 무시 */ } }
  function toJpeg(cv, q) {
    return new Promise(function (ok, no) {
      if (cv.toBlob) cv.toBlob(function (b) { if (!b) return no(new Error('그림을 만들지 못했습니다.')); b.arrayBuffer().then(function (ab) { ok(new Uint8Array(ab)); }, no); }, 'image/jpeg', q);
      else { try { var s = atob(cv.toDataURL('image/jpeg', q).split(',')[1]), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); ok(u); } catch (e) { no(e); } }
    });
  }

  /**
   * 그림 한 장(캔버스) → 보정한 캔버스 { cv, ai, scale, lv }
   *   opt.ai = true 이면 AI 를 써 보고(못 쓰면 일반 확대), onTick(0~1) · isStop()
   */
  function processCanvas(src, opt) {
    opt = opt || {};
    var w = src.width, h = src.height, long = Math.max(w, h), want = Math.min(CFG.target / long, 4), useAi = opt.ai && want >= CFG.aiMin && AI.model;
    var g = flatten(canvasGray(src), w, h);
    var step = useAi && !AI.slow ? aiUpscale(g, w, h, opt.onTick, opt.isStop).then(function (up) { return up === 'slow' ? { g: g, w: w, h: h, ai: false, slow: true } : up ? { g: up, w: w * 2, h: h * 2, ai: true } : null; })
      : Promise.resolve({ g: g, w: w, h: h, ai: false });
    return step.then(function (r) {
      if (!r) return null;
      var W = Math.round(w * Math.max(1, want)), H = Math.round(h * Math.max(1, want)), cv = grayToCanvas(r.g, r.w, r.h);
      if (cv.width !== W || cv.height !== H) { var c2 = resizeCanvas(cv, W, H); if (c2 !== cv) { free(cv); cv = c2; } }
      var g2 = canvasGray(cv);
      if (CFG.denoise !== false) g2 = soften(g2, W, H);                         // 종이 잡티 · JPEG 얼룩을 살짝 눌러 가는 선(오선)이 점선처럼 끊기지 않게
      if (!r.ai && want > 1.15) g2 = unsharp(g2, W, H, 0.6);
      var lv = levels(g2); free(cv);
      return { cv: grayToCanvas(g2, W, H), ai: r.ai, slow: !!r.slow, scale: W / w, lv: lv };
    });
  }

  /* ---------------------------------------------------------------- 파일 → 쪽 */
  function isPdf(u8) { return u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46; }
  /** PDF 쪽이 사진 · 스캔(큰 그림)인지 — 큰 그림이 없으면 글자 · 선으로 된 쪽이라 이미 선명함 → { raster, imgLong } */
  function pageKind(page, lib) {
    return page.getOperatorList().then(function (ops) {
      var O = lib.OPS, big = 0, long = 0;
      for (var i = 0; i < ops.fnArray.length; i++) {
        var f = ops.fnArray[i];
        if (f === O.paintImageXObject || f === O.paintJpegXObject || f === O.paintInlineImageXObject || f === O.paintImageXObjectRepeat) {
          var a = ops.argsArray[i] || [], iw = +a[1] || 0, ih = +a[2] || 0;
          if (f === O.paintInlineImageXObject && a[0]) { iw = a[0].width || 0; ih = a[0].height || 0; }
          if (iw * ih >= 250000) { big++; long = Math.max(long, iw, ih); }
        }
      }
      return { raster: big > 0, imgLong: long };
    });
  }
  function renderPage(page, longPx) {
    var vp1 = page.getViewport({ scale: 1 }), s = longPx / Math.max(vp1.width, vp1.height), vp = page.getViewport({ scale: s });
    var cv = doc.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () { return { cv: cv, w: vp1.width, h: vp1.height }; });
  }
  function imageToCanvas(u8) {
    var blob = new Blob([u8]);
    var p = root.createImageBitmap ? root.createImageBitmap(blob) : new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { no(new Error('그림을 열지 못했습니다.')); }; im.src = URL.createObjectURL(blob); });
    return p.then(function (bm) {
      var w = bm.width, hh = bm.height, k = Math.min(1, CFG.maxSrc * 1.5 / Math.max(w, hh)), cv = doc.createElement('canvas');
      cv.width = Math.round(w * k); cv.height = Math.round(hh * k);
      var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bm, 0, 0, cv.width, cv.height);
      try { bm.close && bm.close(); } catch (e) { /* 무시 */ }
      return { cv: cv, iw: w, ih: hh };
    });
  }

  /**
   * 파일 바이트 → 쪽 목록 [{ i, raster, w, h(포인트), get() → 원본 캔버스 }] — 그림 파일이면 한 쪽
   */
  function openSource(u8) {
    if (isPdf(u8)) {
      return pdfjs().then(function (lib) { return lib.getDocument({ data: u8.slice() }).promise.then(function (pdf) {
        var pages = [], chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) (function (n) {
          chain = chain.then(function () { return pdf.getPage(n); }).then(function (pg) {
            return pageKind(pg, lib).then(function (k) {
              var vp = pg.getViewport({ scale: 1 }), srcLong = Math.max(CFG.minSrc, Math.min(CFG.maxSrc, k.imgLong || CFG.maxSrc));
              pages.push({ i: n, raster: k.raster, w: vp.width, h: vp.height, srcLong: srcLong, get: function (long) { return renderPage(pg, long || srcLong).then(function (r) { return r.cv; }); } });
            });
          });
        })(i);
        return chain.then(function () { return { kind: 'pdf', pdf: pdf, pages: pages, bytes: u8 }; });
      }); });
    }
    return imageToCanvas(u8).then(function (r) {
      var W = 612, H = Math.round(612 * r.cv.height / r.cv.width * 100) / 100;            // 쪽 크기(포인트) — 그림 비율 그대로
      return { kind: 'image', pages: [{ i: 1, raster: true, w: W, h: H, srcLong: Math.max(r.cv.width, r.cv.height), get: function (long) { if (!long || long >= Math.max(r.cv.width, r.cv.height)) return Promise.resolve(r.cv); return Promise.resolve(resizeCanvas(r.cv, Math.round(r.cv.width * long / Math.max(r.cv.width, r.cv.height)), Math.round(r.cv.height * long / Math.max(r.cv.width, r.cv.height)))); } }], bytes: u8 };
    });
  }
  /** 보정한 쪽(JPEG) + 그대로 둘 쪽(원본 PDF 쪽 복사) → 새 PDF — 쪽 크기는 원본과 똑같이 */
  function buildPdf(src, results, q) {
    return pdflib().then(function (L) {
      var out, base = null;
      return L.PDFDocument.create().then(function (d) {
        out = d;
        return src.kind === 'pdf' ? L.PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false }).then(function (b) { base = b; }) : null;
      }).then(function () {
        var chain = Promise.resolve();
        src.pages.forEach(function (p, idx) {
          chain = chain.then(function () {
            var r = results[idx];
            if (r && r.jpg) return out.embedJpg(r.jpg).then(function (im) { var pg = out.addPage([p.w, p.h]); pg.drawImage(im, { x: 0, y: 0, width: p.w, height: p.h }); });
            if (base) return out.copyPages(base, [p.i - 1]).then(function (cp) { out.addPage(cp[0]); });
          });
        });
        return chain;
      }).then(function () { out.setProducer('YN 악보 화질 보정'); return out.save({ useObjectStreams: true }); });
    });
  }


  /* ================================================================ 보정 창 */
  var CSS = '.sf-back{position:fixed;inset:0;z-index:2147483000;background:rgba(6,8,12,.62);display:flex;align-items:center;justify-content:center;padding:max(10px,env(safe-area-inset-top)) 10px max(10px,env(safe-area-inset-bottom));-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
    '.sf{--bg:#16171d;--sf:#1f2129;--ln:rgba(255,255,255,.12);--ink:#f3f3f6;--dim:#a2a6b4;--a:#ff9a4d;width:min(980px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:20px;background:var(--bg);color:var(--ink);border:1px solid var(--ln);box-shadow:0 30px 80px rgba(0,0,0,.55);font:500 14px/1.45 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",sans-serif;overflow:hidden}' +
    'html[data-theme=light] .sf{--bg:#fff;--sf:#f4f5f8;--ln:rgba(18,22,34,.12);--ink:#151821;--dim:#5d6372;--a:#d86a1c}' +
    '.sf-h{display:flex;align-items:center;gap:10px;padding:14px 16px 10px}.sf-h b{font-size:17px;font-weight:850}.sf-h .sf-name{flex:1;min-width:0;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.sf-x{width:38px;height:38px;border-radius:50%;border:1px solid var(--ln);background:var(--sf);color:var(--ink);font-size:16px;cursor:pointer}' +
    '.sf-warn{margin:0 16px 10px;padding:10px 12px;border-radius:12px;background:rgba(255,170,60,.12);border:1px solid rgba(255,170,60,.45);color:var(--ink);font-size:13px}.sf-warn b{color:var(--a)}' +
    '.sf-b{flex:1;min-height:0;overflow:auto;padding:0 16px 8px}' +
    '.sf-stage{position:relative;border-radius:14px;background:#8a8d96;overflow:hidden;touch-action:none;height:min(58vh,620px)}.sf-cv{display:block;width:100%;height:100%}' +
    '.sf-lb{position:absolute;top:8px;padding:3px 9px;border-radius:99px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:800;pointer-events:none}.sf-lb.l{left:8px}.sf-lb.r{right:8px}' +
    '.sf-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:#fff;font-weight:700;background:rgba(0,0,0,.25)}' +
    '.sf-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.sf-row input[type=range]{flex:1;min-width:140px;accent-color:var(--a)}' +
    '.sf-btn{height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--ln);background:var(--sf);color:var(--ink);font:inherit;font-weight:750;cursor:pointer;touch-action:manipulation}.sf-btn:disabled{opacity:.45;cursor:default}' +
    '.sf-btn.pri{background:var(--a);border-color:transparent;color:#1a0f05}.sf-btn.sm{height:36px;padding:0 11px}.sf-btn.on{border-color:var(--a);color:var(--a)}' +
    '.sf-pg{min-width:64px;text-align:center;font-weight:800;font-variant-numeric:tabular-nums}' +
    '.sf-prog{margin-top:10px}.sf-bar{height:8px;border-radius:99px;background:var(--sf);overflow:hidden;border:1px solid var(--ln)}.sf-bar i{display:block;height:100%;width:0;background:var(--a);transition:width .2s}' +
    '.sf-st{margin-top:6px;color:var(--dim);font-size:13px;min-height:19px}.sf-st.bad{color:#ff7b72;font-weight:700}' +
    '.sf-chk{display:flex;align-items:center;gap:8px;margin-top:10px;color:var(--ink);font-size:13.5px}.sf-chk small{color:var(--dim)}' +
    '.sf-f{display:flex;align-items:center;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--ln)}.sf-f .sp{flex:1}' +
    '@media (max-width:560px){.sf-stage{height:46vh}.sf-f{flex-wrap:wrap}}';
  function css() { if (doc.getElementById('sf-css')) return; var st = doc.createElement('style'); st.id = 'sf-css'; st.textContent = CSS; doc.head.appendChild(st); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** 폰은 막음 (메모리) · 그 밖의 기기는 경고만 — iPad Pro 와 다른 iPad 는 브라우저가 구별해 주지 않음 */
  function deviceOk() {
    var sw = Math.min(root.screen ? root.screen.width : 9999, root.screen ? root.screen.height : 9999);
    var coarse = !!(root.matchMedia && root.matchMedia('(pointer:coarse)').matches);
    return !(coarse && sw < 700);
  }

  var cur = null;
  /**
   * o = { id, name, fetchUrl, info() → Promise<{fixed, headed, why}>, apply(pdfBytes) → Promise<{fileId}>, revert() → Promise<{fileId}>, onDone(newId, how) }
   */
  function open(o) {
    if (cur) return cur;
    css();
    var st = { stop: false, src: null, res: [], page: 0, zoom: false, cx: 0.5, cy: 0.35, wipe: 0.5, busy: false, done: false, info: null, prevTok: 0 };
    var back = doc.createElement('div'); back.className = 'sf-back';
    back.innerHTML = '<div class="sf" role="dialog" aria-modal="true" aria-label="악보 화질 보정">' +
      '<div class="sf-h"><b>✨ 악보 화질 보정</b><span class="sf-name">' + esc(o.name || '') + '</span><button type="button" class="sf-x" data-a="close" aria-label="닫기">✕</button></div>' +
      '<div class="sf-warn">⚠ <b>컴퓨터 또는 iPad Pro 에서 하세요.</b> 휴대폰 · 일반 iPad 는 메모리가 모자라 멈추거나 아주 느릴 수 있어요. 예배 중에는 하지 말고 <b>미리</b> 해 두세요. 원본은 지우지 않고 보관하며, 필기는 그대로 옮겨집니다.</div>' +
      '<div class="sf-b">' +
        '<div class="sf-stage"><canvas class="sf-cv"></canvas><span class="sf-lb l">원본</span><span class="sf-lb r">보정본</span><div class="sf-empty" data-r="empty">보정 시작을 누르면 쪽마다 보정해서 원본과 나란히 보여 드려요.</div></div>' +
        '<div class="sf-row"><button type="button" class="sf-btn sm" data-a="prev" aria-label="이전 쪽">◀</button><span class="sf-pg" data-r="pg">–</span><button type="button" class="sf-btn sm" data-a="next" aria-label="다음 쪽">▶</button>' +
          '<input type="range" min="0" max="100" value="50" data-r="wipe" aria-label="원본 · 보정본 경계"><button type="button" class="sf-btn sm" data-a="zoom" aria-pressed="false">🔍 확대</button></div>' +
        '<label class="sf-chk"><input type="checkbox" data-r="ai" checked> AI 2배 키우기 <small>해상도가 낮은 쪽만 · 기기가 느리면 자동으로 일반 보정</small></label>' +
        '<div class="sf-prog"><div class="sf-bar"><i data-r="bar"></i></div><div class="sf-st" data-r="st" role="status" aria-live="polite"></div></div>' +
      '</div>' +
      '<div class="sf-f"><button type="button" class="sf-btn" data-a="revert" hidden>원본으로 되돌리기</button><span class="sp"></span><button type="button" class="sf-btn" data-a="close">닫기</button>' +
        '<button type="button" class="sf-btn pri" data-a="start">보정 시작</button><button type="button" class="sf-btn pri" data-a="apply" hidden>보정본으로 바꾸기</button></div>' +
    '</div>';
    doc.body.appendChild(back);
    var $ = function (s) { return back.querySelector(s); };
    var cv = $('.sf-cv'), stage = $('.sf-stage'), stEl = $('[data-r="st"]'), bar = $('[data-r="bar"]'), pgEl = $('[data-r="pg"]'), emptyEl = $('[data-r="empty"]');
    function say(t, bad) { stEl.textContent = t || ''; stEl.className = 'sf-st' + (bad ? ' bad' : ''); }
    function prog(f) { bar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
    function btn(a) { return back.querySelector('.sf-f [data-a="' + a + '"]'); }
    function rasterIdx() { return st.src ? st.src.pages.map(function (p, i) { return p.raster ? i : -1; }).filter(function (i) { return i >= 0; }) : []; }
    function paintPg() { var r = rasterIdx(), k = r.indexOf(st.page); pgEl.textContent = r.length ? (k + 1) + ' / ' + r.length : '–'; }

    /* 원본 · 보정본을 한 캔버스에 — 왼쪽은 원본, 경계(슬라이더) 오른쪽은 보정본. 확대면 그 자리를 2.5배로 */
    var before = null, after = null, drawT = 0;
    function draw() {
      drawT = 0;
      var W = stage.clientWidth, H = stage.clientHeight, dpr = Math.min(2, root.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var cx = cv.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.fillStyle = '#8a8d96'; cx.fillRect(0, 0, W, H);
      var ref = after || before; if (!ref) return;
      var iw = ref.width, ih = ref.height, k = Math.min(W / iw, H / ih) * (st.zoom ? 2.5 : 1), dw = iw * k, dh = ih * k;
      var ox = st.zoom ? W / 2 - st.cx * dw : (W - dw) / 2, oy = st.zoom ? H / 2 - st.cy * dh : (H - dh) / 2;
      if (st.zoom) { ox = Math.min(0, Math.max(W - dw, ox)); oy = Math.min(0, Math.max(H - dh, oy)); }
      var split = after ? W * st.wipe : W;
      cx.imageSmoothingQuality = 'high';
      if (before) { cx.save(); cx.beginPath(); cx.rect(0, 0, split, H); cx.clip(); cx.drawImage(before, ox, oy, dw, dh); cx.restore(); }
      if (after) { cx.save(); cx.beginPath(); cx.rect(split, 0, W - split, H); cx.clip(); cx.drawImage(after, ox, oy, dw, dh); cx.restore();
        cx.fillStyle = '#ff9a4d'; cx.fillRect(split - 1.5, 0, 3, H); }
    }
    function redraw() { if (!drawT) drawT = (root.requestAnimationFrame || setTimeout)(draw); }
    function showPage(i) {
      if (!st.src) return; st.page = i; paintPg();
      var tok = ++st.prevTok, p = st.src.pages[i], r = st.res[i];
      var long = Math.round(Math.max(stage.clientWidth, stage.clientHeight) * Math.min(2, root.devicePixelRatio || 1) * 1.6);
      p.get(Math.min(p.srcLong, long)).then(function (c) {
        if (tok !== st.prevTok) return;
        before = c; if (!(r && r.jpg)) after = null; emptyEl.style.display = r && r.jpg ? 'none' : ''; emptyEl.textContent = r && r.err ? r.err : (st.busy ? '이 쪽을 보정하는 중…' : '보정 시작을 누르면 쪽마다 보정해서 원본과 나란히 보여 드려요.'); redraw();
        if (r && r.jpg) return (root.createImageBitmap ? root.createImageBitmap(new Blob([r.jpg], { type: 'image/jpeg' })) : Promise.reject()).then(function (bm) { if (tok === st.prevTok) { after = bm; emptyEl.style.display = 'none'; redraw(); } });
      }).catch(function () { /* 미리보기만 못 그림 */ });
    }

    /* 끌기 = 확대했을 때 옮겨 보기 · 확대가 아니면 경계 옮기기 */
    var drag = null;
    stage.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, cx: st.cx, cy: st.cy }; try { stage.setPointerCapture(e.pointerId); } catch (x) {} if (!st.zoom && after) { st.wipe = Math.max(0, Math.min(1, (e.clientX - stage.getBoundingClientRect().left) / stage.clientWidth)); $('[data-r="wipe"]').value = String(Math.round(st.wipe * 100)); redraw(); } });
    stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (st.zoom) { var ref = after || before; if (!ref) return; var k = Math.min(stage.clientWidth / ref.width, stage.clientHeight / ref.height) * 2.5; st.cx = Math.max(0, Math.min(1, drag.cx - (e.clientX - drag.x) / (ref.width * k))); st.cy = Math.max(0, Math.min(1, drag.cy - (e.clientY - drag.y) / (ref.height * k))); }
      else if (after) { st.wipe = Math.max(0, Math.min(1, (e.clientX - stage.getBoundingClientRect().left) / stage.clientWidth)); $('[data-r="wipe"]').value = String(Math.round(st.wipe * 100)); }
      redraw();
    });
    ['pointerup', 'pointercancel'].forEach(function (n) { stage.addEventListener(n, function () { drag = null; }); });
    $('[data-r="wipe"]').addEventListener('input', function (e) { st.wipe = (+e.target.value) / 100; redraw(); });
    var onResize = function () { redraw(); }; root.addEventListener('resize', onResize);

    back.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-a]'); if (!b || b.disabled) return;
      var a = b.getAttribute('data-a'), r = rasterIdx(), k = r.indexOf(st.page);
      if (a === 'close') close();
      else if (a === 'prev' && k > 0) showPage(r[k - 1]);
      else if (a === 'next' && k >= 0 && k < r.length - 1) showPage(r[k + 1]);
      else if (a === 'zoom') { st.zoom = !st.zoom; b.classList.toggle('on', st.zoom); b.setAttribute('aria-pressed', st.zoom ? 'true' : 'false'); redraw(); }
      else if (a === 'start') start();
      else if (a === 'apply') apply();
      else if (a === 'revert') revert();
    });
    function onKey(e) { if (e.key === 'Escape' && !st.busy) { e.stopPropagation(); close(); } else e.stopPropagation(); }
    back.addEventListener('keydown', onKey, true);

    function lock(on) { st.busy = on; ['start', 'apply', 'revert'].forEach(function (a) { var x = btn(a); if (x) x.disabled = on; }); }
    function close() {
      st.stop = true; root.removeEventListener('resize', onResize);
      try { if (before && before.close) before.close(); if (after && after.close) after.close(); } catch (e) { /* 무시 */ }
      before = after = null; st.res = []; st.src = null;
      aiFree();                                                                                  // 그래픽 메모리까지 돌려줌
      try { back.remove(); } catch (e) { /* 무시 */ }
      cur = null;
    }

    /* 처음 — 기기 · 이 악보의 상태 */
    if (!deviceOk()) {
      emptyEl.textContent = '휴대폰에서는 화질 보정을 할 수 없어요. 컴퓨터나 iPad Pro 에서 열어 주세요.';
      btn('start').disabled = true; say('휴대폰은 메모리가 모자라 보정할 수 없어요.', true);
    }
    (o.info ? Promise.resolve(o.info()) : Promise.resolve({})).then(function (inf) {
      st.info = inf || {};
      if (st.info.fixed && o.revert) btn('revert').hidden = false;
      if (st.info.fixed) { btn('start').disabled = true; say('이미 화질 보정을 한 악보예요. 원본으로 되돌릴 수 있어요.'); }
      else if (st.info.headed) { btn('start').disabled = true; say(st.info.why || '머리말을 단 악보는 먼저 「자르기 · 머리말」에서 원본으로 되돌린 뒤 보정하고, 머리말을 다시 달아 주세요.', true); }
    }, function () { /* 상태를 몰라도 보정은 할 수 있음 */ });

    function start() {
      lock(true); st.stop = false; AI.slow = false; prog(0); say('악보를 불러오는 중…');
      var useAi = $('[data-r="ai"]').checked, aiNote = '';
      root.fetch(o.fetchUrl, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('악보를 불러오지 못했습니다.'); return r.arrayBuffer(); })
        .then(function (ab) { return openSource(new Uint8Array(ab)); })
        .then(function (src) {
          st.src = src; st.res = src.pages.map(function () { return null; });
          var r = rasterIdx(); if (!r.length) { lock(false); btn('start').disabled = true; emptyEl.textContent = '이 악보는 글자 · 선으로 된 PDF 라 이미 선명해요. 보정할 필요가 없어요.'; say(''); return null; }
          showPage(r[0]);
          return (useAi ? aiLoad().catch(function (e) { aiNote = (e && e.message) || 'AI 를 쓸 수 없어 일반 보정으로 합니다.'; }) : Promise.resolve()).then(function () { return r; });
        })
        .then(function (r) {
          if (!r) return;
          var chain = Promise.resolve(), n = 0;
          r.forEach(function (idx) {
            chain = chain.then(function () {
              if (st.stop) return;
              var p = st.src.pages[idx]; say((n + 1) + ' / ' + r.length + ' 쪽 보정 중…' + (aiNote ? ' (' + aiNote + ')' : ''));
              return p.get(p.srcLong).then(function (c) {
                return processCanvas(c, { ai: useAi && !!AI.model, isStop: function () { return st.stop; }, onTick: function (f) { prog((n + f) / r.length); } }).then(function (out) {
                  free(c); if (!out) return;
                  if (out.slow && !aiNote) aiNote = '이 기기에서 AI 가 느려 일반 보정으로 바꿨어요';
                  return toJpeg(out.cv, CFG.jpegQ).then(function (jpg) { free(out.cv); st.res[idx] = { jpg: jpg, ai: out.ai }; });
                });
              }).catch(function (e) { st.res[idx] = { err: '이 쪽은 보정하지 못했어요 — 원본 그대로 둡니다. (' + ((e && e.message) || '') + ')' }; })
                .then(function () { n++; prog(n / r.length); if (st.page === idx) showPage(idx); return frame(); });
            });
          });
          return chain.then(function () {
            if (st.stop) return;
            lock(false); aiFree();                                                                // 계산이 끝나면 AI 메모리는 바로 돌려줌
            var ok = st.res.filter(function (x) { return x && x.jpg; }).length;
            btn('start').hidden = true; btn('apply').hidden = !ok; btn('apply').disabled = !ok;
            say(ok ? '보정을 마쳤어요 (' + ok + '쪽). 경계를 옮기거나 🔍 확대로 원본과 비교한 뒤 「보정본으로 바꾸기」를 눌러 주세요.' + (aiNote ? ' · ' + aiNote : '') : '보정한 쪽이 없어요.', !ok);
          });
        })
        .catch(function (e) { lock(false); say((e && e.message) || '보정하지 못했습니다.', true); });
    }
    function shrink(q) {                                                                         // 파일이 너무 크면 화질(JPEG)을 조금 낮춰 다시
      var chain = Promise.resolve();
      st.res.forEach(function (r) {
        if (!r || !r.jpg) return;
        chain = chain.then(function () { return root.createImageBitmap(new Blob([r.jpg], { type: 'image/jpeg' })).then(function (bm) { var c = doc.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0); try { bm.close(); } catch (e) {} return toJpeg(c, q).then(function (j) { free(c); r.jpg = j; }); }); });
      });
      return chain;
    }
    function apply() {
      lock(true); say('새 PDF 를 만드는 중…');
      var tries = [0.84, 0.76, 0.68];
      function build() {
        return buildPdf(st.src, st.res).then(function (bytes) {
          if (bytes.length <= CFG.maxBytes || !tries.length) return bytes;
          say('파일이 커서 조금 줄이는 중…'); return shrink(tries.shift()).then(build);
        });
      }
      build().then(function (bytes) {
        if (bytes.length > CFG.maxBytes) throw new Error('보정한 파일이 너무 커요 (' + Math.round(bytes.length / 1048576) + 'MB). 쪽 수가 많으면 곡별로 나눈 뒤 보정해 주세요.');
        say('올리는 중… (' + (bytes.length / 1048576).toFixed(1) + 'MB)');
        return o.apply(bytes);
      }).then(function (r) {
        say('바꿨어요! 필기는 그대로 옮겨졌어요.'); var id = r && r.fileId;
        close(); if (o.onDone) o.onDone(id, 'fix');
      }).catch(function (e) { lock(false); say((e && e.message) || '바꾸지 못했습니다.', true); });
    }
    function revert() {
      if (!root.confirm('화질 보정 전의 원본으로 되돌릴까요? (필기는 그대로 옮겨집니다)')) return;
      lock(true); say('원본으로 되돌리는 중…');
      Promise.resolve(o.revert()).then(function (r) { close(); if (o.onDone) o.onDone(r && r.fileId, 'revert'); }, function (e) { lock(false); say((e && e.message) || '되돌리지 못했습니다.', true); });
    }
    cur = { close: close, el: back, _st: st };
    setTimeout(redraw, 0);
    return cur;
  }

  root.YNSheetFix = root.YNSheetFix || {};
  root.YNSheetFix.open = open;
  root.YNSheetFix.current = function () { return cur; };
  root.YNSheetFix._engine = { CFG: CFG, AI: AI, aiLoad: aiLoad, aiFree: aiFree, aiUpscale: aiUpscale, flatten: flatten, levels: levels, toGray: toGray, processCanvas: processCanvas, openSource: openSource, buildPdf: buildPdf, toJpeg: toJpeg, grayToCanvas: grayToCanvas, resizeCanvas: resizeCanvas, free: free, pdfjs: pdfjs, isPdf: isPdf };
})(typeof window !== 'undefined' ? window : this);
