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
    levels: 'mid',
    mode: 'clean'          // 보정 세기 — clean(PDF처럼 깔끔하게) · sharp(선명하게) · bold(아주 진하게) · soft(자연스럽게: 예전 방식)
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
        var f32 = true; try { f32 = tf.env().getBool('WEBGL_RENDER_FLOAT32_ENABLED'); } catch (e) { f32 = true; }
        if (!f32) throw new Error('이 기기의 그래픽은 AI 계산 정밀도가 모자라 (점이 찍히거나 글자가 깨질 수 있어) 일반 보정으로 합니다.');
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

  /* ---------------------------------------------------------------- 선명하게 · 아주 진하게 (v12)
   * 악보는 「흰 종이 위 검은 잉크」라서, 사진처럼 부드럽게 다듬기보다 잉크 · 종이를 또렷이 갈라 주는 쪽이 훨씬 잘 보입니다.
   *  ① 3×3 중앙값으로 잡티만 지우고(가장자리는 그대로) ② 큰 반경 언샤프로 글자 · 음표 윤곽을 세우고
   *  ③ 오츠(Otsu) 문턱 둘레만 1~2px 부드럽게 남기고 잉크는 새까맣게 · 종이는 새하얗게
   *  ④ 가는 획(코드 · 가사 · 오선)을 아주 조금 굵게 ⑤ 외딴 점(먼지 · 얼룩) 지우기 */
  function median3(g, w, h) {
    var o = new Uint8ClampedArray(g.length), a = new Array(9);
    o.set(g);
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var i = y * w + x, k = 0;
      for (var dy = -w; dy <= w; dy += w) { a[k++] = g[i + dy - 1]; a[k++] = g[i + dy]; a[k++] = g[i + dy + 1]; }
      for (var p = 1; p < 9; p++) { var v = a[p], q = p - 1; while (q >= 0 && a[q] > v) { a[q + 1] = a[q]; q--; } a[q + 1] = v; }
      o[i] = a[4];
    }
    return o;
  }
  /** 상자 흐림 (가로 → 세로, 누적합 — 반경에 상관없이 빠름) */
  function boxBlur(g, w, h, r) {
    var t = new Float32Array(g.length), o = new Float32Array(g.length), x, y, s, n = 2 * r + 1;
    for (y = 0; y < h; y++) {
      var row = y * w; s = 0;
      for (x = -r; x <= r; x++) s += g[row + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) { t[row + x] = s / n; s += g[row + Math.min(w - 1, x + r + 1)] - g[row + Math.max(0, x - r)]; }
    }
    for (x = 0; x < w; x++) {
      s = 0;
      for (y = -r; y <= r; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) { o[y * w + x] = s / n; s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; }
    }
    return o;
  }
  function otsu(g) {
    var hist = new Float64Array(256), n = 0, i;
    for (i = 0; i < g.length; i += 2) { hist[g[i]]++; n++; }
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sb = 0, wb = 0, best = 0, t = 128;
    for (i = 0; i < 256; i++) {
      wb += hist[i]; if (!wb) continue; var wf = n - wb; if (!wf) break;
      sb += i * hist[i]; var mb = sb / wb, mf = (sum - sb) / wf, between = wb * wf * (mb - mf) * (mb - mf);
      if (between > best) { best = between; t = i; }
    }
    return t;
  }
  /** 회색 침식(3×3 최솟값을 섞음) — 어두운 획이 사방으로 조금 굵어짐. k: 0~1 */
  function embolden(g, w, h, k) {
    var o = new Uint8ClampedArray(g.length); o.set(g);
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var i = y * w + x, m = g[i], v;
      v = g[i - 1]; if (v < m) m = v; v = g[i + 1]; if (v < m) m = v; v = g[i - w]; if (v < m) m = v; v = g[i + w]; if (v < m) m = v;
      v = g[i - w - 1]; if (v < m) m = v; v = g[i - w + 1]; if (v < m) m = v; v = g[i + w - 1]; if (v < m) m = v; v = g[i + w + 1]; if (v < m) m = v;
      o[i] = g[i] + (m - g[i]) * k;
    }
    return o;
  }
  /** 외딴 점 지우기 — 진한 점들을 이어진 덩어리로 묶어, 아주 작은 덩어리(먼지 · 잡티)만 하얗게. 스타카토 · 점음표는 이보다 커서 남음 */
  function despeckle(g, w, h, thr, minA) {
    var n = g.length, lab = new Int32Array(n), par = [0], area = [0], i, x, y, nxt = 1;
    function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; if (g[i] >= thr) continue;
      var up = y ? lab[i - w] : 0, lf = x ? lab[i - 1] : 0, ul = x && y ? lab[i - w - 1] : 0, ur = y && x < w - 1 ? lab[i - w + 1] : 0, m = 0;
      [up, lf, ul, ur].forEach(function (L) { if (L) { L = find(L); if (!m) m = L; else if (L !== m) { if (L < m) { par[m] = L; m = L; } else par[L] = m; } } });
      if (!m) { m = nxt++; par.push(m); area.push(0); }
      lab[i] = m;
    }
    for (i = 0; i < n; i++) if (lab[i]) area[find(lab[i])]++;
    for (i = 0; i < n; i++) if (lab[i] && area[find(lab[i])] < minA) {          // 지운 점 둘레의 옅은 테두리까지 하얗게
      g[i] = 255;
    }
    return g;
  }
  /** 잉크 모드 마무리 — mode: 'sharp' | 'bold', scale: 원본 대비 몇 배 키웠는지 (획 굵기 기준) */
  function inkFinish(g, w, h, mode, scale) {
    var bold = mode === 'bold';
    var r = Math.max(2, Math.round(1.6 * Math.max(1, scale))), bl = boxBlur(g, w, h, r), amt = bold ? 1.6 : 1.3, i, n = g.length;
    for (i = 0; i < n; i++) { var v = g[i] + (g[i] - bl[i]) * amt; g[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    // 잉크 · 종이 밝기를 재고, 종이보다 조금이라도 어두운 것(옅은 회색 가사 · 코드 포함)은 거듭제곱 곡선으로 진하게.
    // 문턱 하나로 자르지 않아 회색 글자가 부서지지 않고, 가장자리는 부드럽게 남음.
    var hist = new Uint32Array(256), cnt = 0; for (i = 0; i < n; i += 3) { hist[g[i]]++; cnt++; }
    var pct = function (p) { var want = cnt * p, c = 0; for (var v = 0; v < 256; v++) { c += hist[v]; if (c >= want) return v; } return 255; };
    var ink = pct(0.005), paper = pct(0.6), t = otsu(g);
    // 어둡기 d = (종이 − 값) / (종이 − 잉크). d 가 a 아래면 종이(흰색), b 위면 잉크(검정), 그 사이는 부드럽게.
    // 문턱을 낮게 잡아 옅은 회색 글자의 가운데도 까맣게 되고, 종이 잡티(아주 옅음)는 하얗게 남음.
    var clean = mode === 'clean', a = bold ? 0.07 : clean ? 0.12 : 0.10, b2 = bold ? 0.38 : clean ? 0.48 : 0.44, span = Math.max(30, paper - ink), lut = new Uint8ClampedArray(256), lo = paper - span * b2, hi = paper - span * a;
    for (var v2 = 0; v2 < 256; v2++) { var d = (paper - v2) / span, f = Math.max(0, Math.min(1, (d - a) / (b2 - a))); lut[v2] = Math.round(255 * (1 - f * f * (3 - 2 * f))); }
    for (i = 0; i < n; i++) g[i] = lut[g[i]];
    if (!clean) g = embolden(g, w, h, bold ? 0.5 : 0.15);
    despeckle(g, w, h, 170, Math.max(6, Math.round(1.6 * scale * scale)));
    return { g: g, lv: { ink: ink, paper: paper, lo: lo, hi: hi, t: t, mode: mode } };
  }

  /**
   * 그림 한 장(캔버스) → 키운 회색 그림 (보정 세기와 상관없는 앞부분 — 세기만 바꿀 때는 이것을 다시 씀)
   */
  /**
   * AI 결과 검사 — 2배 그림을 다시 반으로 줄여 원래 그림과 견줘 봄. 그래픽 칩의 정밀도 문제(일부 iPad · Mac)로
   * 점이 찍히거나 줄 · 글자가 끊긴 결과가 나오면 원래와 크게 달라지므로 그 쪽은 AI 를 쓰지 않음.
   */
  function aiLooksRight(g, up, w, h) {
    var W2 = w * 2, n = 0, sum = 0, big = 0;
    for (var y = 0; y < h; y += 2) for (var x = 0; x < w; x += 2) {
      var i = (2 * y) * W2 + 2 * x, a = (up[i] + up[i + 1] + up[i + W2] + up[i + W2 + 1]) / 4, d = Math.abs(a - g[y * w + x]);
      sum += d; n++; if (d > 70) big++;
    }
    var mae = sum / Math.max(1, n), frac = big / Math.max(1, n);
    AI.check = { mae: Math.round(mae * 10) / 10, frac: Math.round(frac * 10000) / 10000 };
    return mae < 9 && frac < 0.006;
  }
  function upscaleCanvas(src, opt) {
    opt = opt || {};
    var w = src.width, h = src.height, long = Math.max(w, h), want = Math.min(CFG.target / long, 4), useAi = opt.ai && want >= CFG.aiMin && AI.model;
    var g = flatten(canvasGray(src), w, h);                                       // (중앙값 거르기는 쓰지 않음 — 1px 짜리 음표 줄기 · 마디선 · 오선을 지워 점선처럼 만듦. 잡티는 마지막에 덩어리 크기로 지움)
    var step = useAi && !AI.slow ? aiUpscale(g, w, h, opt.onTick, opt.isStop).then(function (up) {
      if (up === 'slow') return { g: g, w: w, h: h, ai: false, slow: true };
      if (!up) return null;
      if (!aiLooksRight(g, up, w, h)) { AI.bad = true; return { g: g, w: w, h: h, ai: false, bad: true }; }      // 기기 탓으로 AI 결과가 깨졌으면 버리고 일반 확대로
      return { g: up, w: w * 2, h: h * 2, ai: true };
    })
      : Promise.resolve({ g: g, w: w, h: h, ai: false });
    return step.then(function (r) {
      if (!r) return null;
      var W = Math.round(w * Math.max(1, want)), H = Math.round(h * Math.max(1, want)), cv = grayToCanvas(r.g, r.w, r.h);
      if (cv.width !== W || cv.height !== H) { var c2 = resizeCanvas(cv, W, H); if (c2 !== cv) { free(cv); cv = c2; } }
      var g2 = canvasGray(cv); free(cv);
      return { g: g2, W: W, H: H, ai: r.ai, slow: !!r.slow, bad: !!r.bad, scale: W / w, want: want };
    });
  }
  /** 키운 회색 그림 → 보정 세기대로 마무리한 캔버스 (원본 base.g 는 건드리지 않음) */
  /* ---------------------------------------------------------------- PDF 처럼 깔끔하게 (v12.1)
   * 스캔 · 사진 악보를 「컴퓨터로 만든 악보」처럼: ① 기울기 바로잡기 ② 잉크 · 종이 가르기 ③ 오선을 찾아 지우고
   * 같은 굵기의 곧은 선으로 새로 긋기 ④ 음표 · 글자 가장자리의 울퉁불퉁함을 매끈하게 ⑤ 먼지 지우기.
   * 글자를 다른 글꼴로 바꾸지는 않음 (잘못 읽으면 가사 · 코드가 틀려지므로) — 모양은 그대로 두고 가장자리만 다듬음. */
  /** 기울기(도) — 진한 점들을 조금씩 기울여 가로줄 모으기가 가장 뚜렷한 각도 */
  function skewAngle(g, w, h) {
    var k = Math.max(1, Math.floor(w / 1000)), sw = Math.floor(w / k), sh = Math.floor(h / k), pts = [];
    for (var y = 0; y < sh; y++) for (var x = 0; x < sw; x++) if (g[(y * k) * w + x * k] < 110) pts.push(x, y);
    if (pts.length < 400) return 0;
    var best = 0, bestA = 0, base0 = 0, rows = new Float64Array(sh + 400);
    for (var a = -3; a <= 3.0001; a += 0.1) {
      var t = Math.tan(a * Math.PI / 180); rows.fill(0);
      for (var i = 0; i < pts.length; i += 2) { var yy = Math.round(pts[i + 1] + pts[i] * t) + 200; if (yy >= 0 && yy < rows.length) rows[yy]++; }
      var sc = 0; for (var j = 0; j < rows.length; j++) sc += rows[j] * rows[j];
      if (Math.abs(a) < 0.01) base0 = sc;
      if (sc > best) { best = sc; bestA = a; }
    }
    return Math.abs(bestA) < 0.15 || best < base0 * 1.12 || Math.abs(bestA) > 2.95 ? 0 : bestA;       // 확실히 나아질 때만 · 끝값(±3°)은 잘못 잡은 것
  }
  function rotateGray(g, w, h, deg) {
    var src = grayToCanvas(g, w, h), cv = doc.createElement('canvas'); cv.width = w; cv.height = h;
    var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.imageSmoothingQuality = 'high';
    cx.translate(w / 2, h / 2); cx.rotate(deg * Math.PI / 180); cx.drawImage(src, -w / 2, -h / 2);
    free(src); var out = canvasGray(cv); free(cv); return out;
  }
  /**
   * 오선(긴 가로줄) 찾기 → [{ pts:[[x,y]...], t }] — 찾은 줄은 g 에서 지움 (음표와 겹친 곳은 남김)
   *  줄마다 64px 마다 가운데 높이를 재서, 사진이 살짝 휘어도 따라감
   */
  function staffLines(g, w, h, scale, also) {
    var L = Math.round(w * 0.04), cov = new Float32Array(h), x, y;
    for (y = 0; y < h; y++) {
      var r = y * w, run = 0, sum = 0;
      for (x = 0; x <= w; x++) { if (x < w && g[r + x] < 128) run++; else { if (run >= L) sum += run; run = 0; } }
      cov[y] = sum;
    }
    var bands = [], y0 = -1;
    for (y = 0; y <= h; y++) {
      var on = y < h && cov[y] > w * 0.25;
      if (on && y0 < 0) y0 = y;
      if (!on && y0 >= 0) { bands.push([y0, y - 1]); y0 = -1; }
    }
    var maxT = Math.max(5, Math.round(scale * 3.2));
    var edge = Math.round(h * 0.015);
    bands = bands.filter(function (b) { return b[1] - b[0] + 1 <= maxT && b[0] > edge && b[1] < h - edge; });      // 종이 위아래 가장자리 그림자는 오선이 아님
    if (!bands.length) return [];
    var ts = bands.map(function (b) { return b[1] - b[0] + 1; }).sort(function (a, b) { return a - b; }), T = Math.max(2, ts[Math.floor(ts.length / 2)]);
    var lines = [];
    bands.forEach(function (b) {
      var top = Math.max(0, b[0] - 2), bot = Math.min(h - 1, b[1] + 2), colOn = new Uint8Array(w);
      for (x = 0; x < w; x++) for (y = top; y <= bot; y++) if (g[y * w + x] < 128) { colOn[x] = 1; break; }
      var gap = Math.round(w * 0.015), segs = [], s0 = -1, last = -1;
      for (x = 0; x < w; x++) if (colOn[x]) { if (s0 < 0) s0 = x; else if (x - last > gap) { segs.push([s0, last]); s0 = x; } last = x; }
      if (s0 >= 0) segs.push([s0, last]);
      segs.filter(function (sg) { return sg[1] - sg[0] > w * 0.12; }).forEach(function (sg) {
        var pts = [], step = 64;
        for (var cx = sg[0]; cx <= sg[1]; cx += step) {
          var x1 = Math.min(sg[1], cx + step), ys = 0, n = 0;
          for (var xx = cx; xx <= x1; xx += 2) {                                  // 이 칸에서 줄만 있는 곳(위아래로 짧은 곳)의 가운데
            var a = -1, z = -1;
            for (y = top; y <= bot; y++) if (g[y * w + xx] < 128) { if (a < 0) a = y; z = y; }
            if (a >= 0 && z - a + 1 <= T + 2) { ys += (a + z) / 2; n++; }
          }
          if (n >= 3) pts.push([cx === sg[0] ? sg[0] : Math.min(sg[1], cx + step / 2), ys / n]);
        }
        if (pts.length < 2) return;
        pts[0][0] = sg[0]; pts[pts.length - 1][0] = sg[1];
        lines.push({ pts: pts, t: T, x0: sg[0], x1: sg[1], top: top, bot: bot });
      });
    });
    // 줄 지우기 — 세로로 짧게(줄 굵기만큼)만 칠해진 곳. 음표 · 줄기와 겹친 곳은 그대로
    lines.forEach(function (ln) {
      for (x = ln.x0; x <= ln.x1; x++) {
        var a = -1, z = -1;
        for (y = Math.max(0, ln.top - 1); y <= Math.min(h - 1, ln.bot + 1); y++) if (g[y * w + x] < 170) { if (a < 0) a = y; z = y; }
        if (a < 0) continue;
        var up = a - 1, dn = z + 1;
        var touch = (up >= 0 && g[up * w + x] < 128) || (dn < h && g[dn * w + x] < 128);
        if (!touch && z - a + 1 <= T + 3) for (y = Math.max(0, a - 1); y <= Math.min(h - 1, z + 1); y++) { g[y * w + x] = 255; if (also) also[y * w + x] = 255; }
      }
    });
    return lines;
  }
  /** 가장자리 매끈하게 — 살짝 흐린 뒤 다시 또렷한 문턱 (울퉁불퉁한 계단 · 깨진 테두리가 매끈한 곡선이 됨) */
  function smoothEdges(g, w, h, scale) {
    var r = 1, b = boxBlur(g, w, h, r), i;
    var lo = 60, hi = 195;
    for (i = 0; i < g.length; i++) { var f = Math.max(0, Math.min(1, (b[i] - lo) / (hi - lo))); g[i] = Math.round(255 * f * f * (3 - 2 * f)); }
    return g;
  }
  /**
   * 동네마다 문턱을 따로 (Sauvola) — 흰 종이 위 가는 선은 옅어도 잉크로 살리고, 빽빽한 작은 글자 사이 틈은 열어 둠.
   * 결과는 문턱 둘레만 부드러운(안티에일리어싱) 잉크 / 종이 그림
   */
  function sauvola(g, w, h, r, paper, ink) {
    var W1 = w + 1, S = new Float64Array(W1 * (h + 1)), Q = new Float64Array(W1 * (h + 1)), x, y;
    for (y = 0; y < h; y++) { var rs = 0, rq = 0; for (x = 0; x < w; x++) { var v = g[y * w + x]; rs += v; rq += v * v; S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs; Q[(y + 1) * W1 + x + 1] = Q[y * W1 + x + 1] + rq; } }
    var o = new Uint8ClampedArray(w * h), k = 0.2, R = 128, floorT = paper - (paper - ink) * 0.12, band = Math.max(10, (paper - ink) * 0.09);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), N = (y1 - y0) * (x1 - x0);
        var s = S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0], q = Q[y1 * W1 + x1] - Q[y0 * W1 + x1] - Q[y1 * W1 + x0] + Q[y0 * W1 + x0];
        var m = s / N, sd = Math.sqrt(Math.max(0, q / N - m * m)), t = m * (1 + k * (sd / R - 1));
        if (t > floorT) t = floorT;                                                // 빈 종이의 잡티는 잉크로 보지 않음
        var f = (g[y * w + x] - t) / band + 0.5; f = f < 0 ? 0 : f > 1 ? 1 : f;
        o[y * w + x] = Math.round(255 * f * f * (3 - 2 * f));
      }
    }
    return o;
  }
  function cleanFinish(base) {
    var W = base.W, H = base.H, n = W * H, sc = base.scale, i, g0 = new Uint8ClampedArray(base.g);
    var bl = boxBlur(g0, W, H, Math.max(2, Math.round(1.2 * sc)));                 // 윤곽 세우기 (언샤프)
    for (i = 0; i < n; i++) { var u = g0[i] + (g0[i] - bl[i]) * 0.9; g0[i] = u < 0 ? 0 : u > 255 ? 255 : u; }
    var hist = new Uint32Array(256), cnt = 0; for (i = 0; i < n; i += 3) { hist[g0[i]]++; cnt++; }
    var pct = function (p) { var want = cnt * p, c = 0; for (var v = 0; v < 256; v++) { c += hist[v]; if (c >= want) return v; } return 255; };
    var ink = pct(0.005), paper = pct(0.6), span = Math.max(30, paper - ink);
    // 선 찾기용: 옅은 오선까지 잉크로 (어둡기 0.3 이상) · 내용용: 어둡기 0.5 를 가운데로 부드럽게 (작은 가사 글자가 뭉치지 않게)
    var gL = new Uint8ClampedArray(n), lutL = new Uint8ClampedArray(256);
    for (var v = 0; v < 256; v++) lutL[v] = (paper - v) / span > 0.25 ? 0 : 255;
    for (i = 0; i < n; i++) gL[i] = lutL[g0[i]];
    var g = inkFinish(new Uint8ClampedArray(base.g), W, H, 'clean', sc).g;      // 내용: 「선명하게」와 같은 잉크 곡선 (굵게 하지는 않음) — 가는 줄기 · 임시표(#, b)가 끊기지 않게
    var ang = skewAngle(gL, W, H); if (ang) { gL = rotateGray(gL, W, H, ang); g = rotateGray(g, W, H, ang); }
    var lines = staffLines(gL, W, H, sc, g);
    var fin = { lv: { ink: ink, paper: paper } };
    g = smoothEdges(g, W, H, sc);
    despeckle(g, W, H, 170, Math.max(8, Math.round(2 * sc * sc)));
    var m = Math.max(3, Math.round(sc * 1.5)), x, y;                               // 종이 가장자리(그림자 · 테두리)는 하얗게
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (y < m || y >= H - m || x < m || x >= W - m) g[y * W + x] = 255;
    var cv = grayToCanvas(g, W, H), cx = cv.getContext('2d');
    cx.fillStyle = '#000'; cx.strokeStyle = '#000'; cx.lineCap = 'butt'; cx.lineJoin = 'round';
    lines.forEach(function (ln) {                                                  // 오선을 같은 굵기의 곧은 선으로
      cx.lineWidth = ln.t; cx.beginPath();
      var p = ln.pts, ys = p.map(function (q) { return q[1]; });
      var sm = ys.map(function (v, i) { var a = ys[Math.max(0, i - 1)], c = ys[Math.min(ys.length - 1, i + 1)]; return (a + 2 * v + c) / 4; });
      cx.moveTo(p[0][0], sm[0] + 0.5); for (var i = 1; i < p.length; i++) cx.lineTo(p[i][0], sm[i] + 0.5);
      cx.stroke();
    });
    return { cv: cv, ai: base.ai, slow: base.slow, bad: base.bad, scale: sc, lv: fin.lv, mode: 'clean', skew: ang, lines: lines.length };
  }

  function finishBase(base, mode) {
    mode = mode || CFG.mode || 'sharp';
    if (mode === 'clean') return cleanFinish(base);
    var W = base.W, H = base.H, g2 = new Uint8ClampedArray(base.g), lv;
    if (mode === 'soft') {
      if (CFG.denoise !== false) g2 = soften(g2, W, H);                         // 종이 잡티 · JPEG 얼룩을 살짝 눌러 가는 선(오선)이 점선처럼 끊기지 않게
      if (!base.ai && base.want > 1.15) g2 = unsharp(g2, W, H, 0.6);
      lv = levels(g2);
    } else { var fin = inkFinish(g2, W, H, mode, base.scale); g2 = fin.g; lv = fin.lv; }
    return { cv: grayToCanvas(g2, W, H), ai: base.ai, slow: base.slow, bad: base.bad, scale: base.scale, lv: lv, mode: mode };
  }

  /**
   * 그림 한 장(캔버스) → 보정한 캔버스 { cv, ai, scale, lv }
   *   opt.ai = true 이면 AI 를 써 보고(못 쓰면 일반 확대), onTick(0~1) · isStop()
   */
  function processCanvas(src, opt) {
    opt = opt || {};
    return upscaleCanvas(src, opt).then(function (base) { return base ? finishBase(base, opt.mode) : null; });
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
      return { kind: 'image', pages: [{ i: 1, raster: true, w: W, h: H, srcLong: Math.max(r.cv.width, r.cv.height), get: function (long) { if (!long || long >= Math.max(r.cv.width, r.cv.height)) { var cp = doc.createElement('canvas'); cp.width = r.cv.width; cp.height = r.cv.height; cp.getContext('2d').drawImage(r.cv, 0, 0); return Promise.resolve(cp); } /* 늘 복사본 — 보정이 끝나 지워도 비교 화면의 원본은 남게 */ return Promise.resolve(resizeCanvas(r.cv, Math.round(r.cv.width * long / Math.max(r.cv.width, r.cv.height)), Math.round(r.cv.height * long / Math.max(r.cv.width, r.cv.height)))); } }], bytes: u8 };
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



  /* ================================================================ V874 — Claude (정해진 계정만, o.claude 가 있을 때)
     · text   : 기기 보정을 한 뒤, Claude 가 읽은 코드 · 제목 · Key · 섹션 글자를 깨끗한 글꼴로 같은 자리에 다시 씀
                (그 글자의 잉크 덩어리를 찾아 크기 · 폭을 맞추고, 둘레에 다른 잉크(음표 줄기 등)가 닿아 있으면 건드리지 않음)
     · engrave: (실험) Claude 가 악보 전체를 ABC 악보 글로 옮기고, abcjs 로 새로 그려 Letter 쪽으로 나눔 */
  var ABCJS_URL = '/vendor/abcjs/abcjs-basic-min.js';            // abcjs 6.4.4 (MIT) — 이 앱에서 직접 (새로 그리기를 누를 때만 내려받음)
  function abcjsLib() { return loadScript(ABCJS_URL, function () { return !!root.ABCJS; }).then(function () { return root.ABCJS; }); }
  function jpegOf(cv, long, q) {
    var k = Math.min(1, long / Math.max(cv.width, cv.height)), c = cv;
    if (k < 1) c = resizeCanvas(cv, Math.round(cv.width * k), Math.round(cv.height * k));
    var u = c.toDataURL('image/jpeg', q || 0.85); if (c !== cv) free(c); return u;
  }
  /** (cx, cy) 근처 글자의 잉크 상자 [px] — 글자 높이 hEst. 못 찾거나 둘레에 다른 잉크가 붙어 있으면 null */
  function inkBox(cv, cx, cy, hEst) {
    var W = cv.width, H = cv.height; hEst = Math.max(8, hEst);
    var x0 = Math.max(0, Math.round(cx - 7 * hEst)), x1 = Math.min(W, Math.round(cx + 7 * hEst)), y0 = Math.max(0, Math.round(cy - 1.8 * hEst)), y1 = Math.min(H, Math.round(cy + 1.8 * hEst));
    var bw = x1 - x0, bh = y1 - y0; if (bw < 10 || bh < 10) return null;
    var d = cv.getContext('2d').getImageData(x0, y0, bw, bh).data, ink = new Uint8Array(bw * bh), x, y, i;
    for (y = 0; y < bh; y++) { var rowN = 0; for (x = 0; x < bw; x++) { i = (y * bw + x) * 4; if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 150) { ink[y * bw + x] = 1; rowN++; } } if (rowN > bw * 0.55) for (x = 0; x < bw; x++) ink[y * bw + x] = 2; }      // 2 = 오선 같은 긴 가로줄
    var ry = Math.round(cy - y0), rx = cx - x0, band = Math.round(hEst * 0.8), col = new Uint8Array(bw);
    for (x = 0; x < bw; x++) for (y = Math.max(0, ry - band); y < Math.min(bh, ry + band); y++) if (ink[y * bw + x] === 1) { col[x] = 1; break; }
    var gap = Math.max(2, Math.round(hEst * 0.42)), groups = [], a0 = -1, last = -1;
    for (x = 0; x < bw; x++) if (col[x]) { if (a0 < 0 || x - last > gap) { if (a0 >= 0) groups.push([a0, last]); a0 = x; } last = x; }
    if (a0 >= 0) groups.push([a0, last]);
    var best = null, bd = 1e9; groups.forEach(function (g) { var dd = rx < g[0] ? g[0] - rx : rx > g[1] ? rx - g[1] : 0; if (dd < bd) { bd = dd; best = g; } });
    if (!best || bd > hEst * 1.1 || best[0] <= 1 || best[1] >= bw - 2) return null;
    var yt = bh, yb = -1;
    for (x = best[0]; x <= best[1]; x++) for (y = Math.max(0, ry - Math.round(hEst * 1.5)); y < Math.min(bh, ry + Math.round(hEst * 1.5)); y++) if (ink[y * bw + x] === 1) { if (y < yt) yt = y; if (y > yb) yb = y; }
    var gh = yb - yt + 1; if (yb < 0 || gh < hEst * 0.45 || gh > hEst * 2.1 || yt <= 1 || yb >= bh - 2) return null;
    /* 둘레(2~4px 바깥)에 다른 잉크가 닿아 있으면 — 음표 줄기 · 이음줄과 붙은 글자 — 건드리지 않음 */
    var ring = 0, ringN = 0, m = 3;
    for (y = yt - m; y <= yb + m; y++) for (x = best[0] - m; x <= best[1] + m; x++) {
      if (y < 0 || y >= bh || x < 0 || x >= bw) continue;
      if (y >= yt - 1 && y <= yb + 1 && x >= best[0] - 1 && x <= best[1] + 1) continue;
      ringN++; if (ink[y * bw + x] === 1) ring++;
    }
    if (ringN && ring / ringN > 0.03) return null;
    return { x: x0 + best[0], y: y0 + yt, w: best[1] - best[0] + 1, h: gh };
  }
  var FONT_LAT = '"Helvetica Neue",Helvetica,Arial,sans-serif', FONT_KO = '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",' + FONT_LAT;
  /** 다시 쓰기 — items = [{t, k, x, y, h}] (0~1). 바꾼 개수 */
  function overlayText(cv, items) {
    var c = cv.getContext('2d'), W = cv.width, H = cv.height, n = 0, done = [];
    (items || []).forEach(function (it) {
      var t = String(it.t || '').trim(); if (!t || t.length > 40) return;
      var hEst = (it.h > 0.002 && it.h < 0.08 ? it.h : 0.014) * H, b = inkBox(cv, it.x * W, it.y * H, hEst);
      if (!b) return;
      if (done.some(function (q) { return b.x < q.x + q.w && q.x < b.x + b.w && b.y < q.y + q.h && q.y < b.y + b.h; })) return;
      var ko = /[ㄱ-ㆎ가-힣]/.test(t), cap = ko ? 0.86 : 0.72, wt = it.k === 'title' ? 800 : it.k === 'lyric' ? 500 : 700;
      if (it.k === 'lyric' && !ko && /[gjpqy]/.test(t)) return;                                       // 영어 가사 중 아래로 내려가는 글자(g · y …)가 있는 낱말은 기준선을 맞추기 어려워 그대로 둠
      if (it.k === 'lyric' && !ko && /[a-z]/.test(t) && !/[bdfhklt]/.test(t)) cap = 0.53;                         // 영어 소문자만(x-height) 인 낱말
      var fs = b.h / cap; c.font = wt + ' ' + fs + 'px ' + (ko ? FONT_KO : FONT_LAT);
      var tw = c.measureText(t).width; if (!tw) return;
      var sx = b.w / tw; if (sx < 0.55 || sx > 1.9) return;                                    // 글자 수가 안 맞으면 (잘못 읽었거나 다른 글자) 그대로 둠
      if (sx < 0.85) { fs *= sx / 0.85; c.font = wt + ' ' + fs + 'px ' + (ko ? FONT_KO : FONT_LAT); tw = c.measureText(t).width; sx = Math.min(1.15, b.w / tw); }
      sx = Math.max(0.85, Math.min(1.15, sx));
      var pad = Math.max(2, Math.round(b.h * 0.12));
      c.fillStyle = '#ffffff'; c.fillRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      c.save(); c.translate(b.x, b.y + b.h); c.scale(sx, 1); c.fillStyle = '#000000'; c.textBaseline = 'alphabetic'; c.fillText(t, 0, 0); c.restore();
      done.push(b); n++;
    });
    return n;
  }
  /** V876 — 음표 머리 다듬기: 기기 안 악보 인식(omr.js)으로 찾은 검은 머리 자리에, 실제로 잉크가 꽉 차 있으면 반듯한 타원으로 다시 칠함.
      (빈 머리 · 확실하지 않은 곳은 건드리지 않음) — 바꾼 개수 */
  function polishNotes(cv) {
    var OMR = root.YNOmr; if (!OMR || !OMR.analyze) return 0;
    var W = cv.width, H = cv.height, c = cv.getContext('2d'), img = c.getImageData(0, 0, W, H), d = img.data, om, n = 0;
    try { om = OMR.analyze(d, W, H, {}); } catch (e) { return 0; }
    var dark = function (x, y) { if (x < 0 || y < 0 || x >= W || y >= H) return false; var i = (y * W + x) * 4; return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 120; };
    (om.notes || []).forEach(function (nt) {
      var st = om.staves[nt.staff]; if (!st || nt.open) return;
      var sp = st.sp, cx = Math.round(nt.x), cy = Math.round(nt.y); if (!dark(cx, cy)) return;
      var l = cx, r = cx; while (l > cx - sp * 1.2 && dark(l - 1, cy)) l--; while (r < cx + sp * 1.2 && dark(r + 1, cy)) r++;
      var w = r - l + 1; if (w < sp * 0.85 || w > sp * 1.75) return;                          // 머리 폭이 아니면 (줄기 · 덩어리) 그대로
      var rx = w / 2, ry = Math.max(sp * 0.38, Math.min(sp * 0.52, rx * 0.72)), ex = (l + r) / 2, hit = 0, tot = 0, a, b;
      for (b = -ry * 0.8; b <= ry * 0.8; b += 1.5) for (a = -rx * 0.8; a <= rx * 0.8; a += 1.5) { if ((a * a) / (rx * rx) + (b * b) / (ry * ry) > 0.64) continue; tot++; if (dark(Math.round(ex + a), Math.round(cy + b))) hit++; }
      if (!tot || hit / tot < 0.82) return;                                                     // 속이 꽉 찬 검은 머리만
      c.save(); c.translate(ex, cy); c.rotate(-0.33); c.beginPath(); c.ellipse(0, 0, rx * 0.98, ry, 0, 0, Math.PI * 2); c.fillStyle = '#000'; c.fill(); c.restore(); n++;
    });
    return n;
  }
  /** ABC → Letter 쪽 그림들 (흰 줄에서 나눔) — [canvas] */
  function engravePages(abc, onSay) {
    return abcjsLib().then(function (A) {
      var host = doc.createElement('div'); host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1600px;background:#fff';
      doc.body.appendChild(host);
      try {
        A.renderAbc(host, abc, { staffwidth: 1400, scale: 1.25, paddingtop: 10, paddingbottom: 10, paddingleft: 10, paddingright: 10, add_classes: true, format: { titlefont: '"Helvetica Neue" 26 bold', gchordfont: '"Helvetica Neue" 15 bold', vocalfont: '"Apple SD Gothic Neo","Noto Sans KR",Helvetica 14', annotationfont: '"Helvetica Neue" 13 bold' }, wrap: { minSpacing: 1.7, maxSpacing: 2.7, preferredMeasuresPerLine: 4 } });
      } catch (e) { host.remove(); throw new Error('새로 그리지 못했어요: ' + ((e && e.message) || e)); }
      var svg = host.querySelector('svg'); if (!svg) { host.remove(); throw new Error('새로 그리지 못했어요.'); }
      var vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number), sw = vb[2] || svg.getBoundingClientRect().width, sh = vb[3] || svg.getBoundingClientRect().height;
      svg.setAttribute('width', sw); svg.setAttribute('height', sh); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      var xml = new root.XMLSerializer().serializeToString(svg); host.remove();
      return new Promise(function (ok, no) {
        var im = new root.Image(); im.onload = function () { ok(im); }; im.onerror = function () { no(new Error('새로 그린 악보를 그림으로 바꾸지 못했어요.')); };
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      }).then(function (im) {
        var PW = 1700, PH = 2200, M = 110, CW = PW - 2 * M, CH = PH - 2 * M, k = CW / sw, TH = Math.ceil(sh * k);
        var tall = doc.createElement('canvas'); tall.width = CW; tall.height = TH; var tc = tall.getContext('2d'); tc.fillStyle = '#fff'; tc.fillRect(0, 0, CW, TH); tc.drawImage(im, 0, 0, CW, TH);
        /* 줄이 짧게 그려졌으면 (마디가 적은 곡) 실제 내용 폭에 맞춰 키움 — 최대 1.6배 */
        (function fit() {
          var dd = tc.getImageData(0, 0, CW, TH).data, minX = CW, maxX = -1, xx, yy;
          for (yy = 0; yy < TH; yy += 3) for (xx = 0; xx < CW; xx += 2) { if (dd[(yy * CW + xx) * 4] < 200) { if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; } }
          if (maxX < 0) return; var cw = maxX - minX + 1, f = Math.min(1.6, (CW - 4) / cw); if (f < 1.08) return;
          var k2 = k * f, TH2 = Math.ceil(sh * k2), t2 = doc.createElement('canvas'); t2.width = CW; t2.height = TH2; var c2 = t2.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, CW, TH2);
          c2.drawImage(im, -minX * f + 2, 0, sw * k2, TH2); free(tall); tall = t2; tc = c2; TH = TH2;
        }());
        var data = tc.getImageData(0, 0, CW, TH).data, blank = new Uint8Array(TH), y, x;
        for (y = 0; y < TH; y++) { var ok2 = 1; for (x = 0; x < CW; x += 2) { var i = (y * CW + x) * 4; if (data[i] < 235) { ok2 = 0; break; } } blank[y] = ok2; }
        var pages = [], start = 0;
        while (start < TH) {
          var end = Math.min(TH, start + CH);
          if (end < TH) { var cut = -1; for (y = end; y > start + CH * 0.45; y--) if (blank[y]) { cut = y; break; } if (cut > 0) end = cut; }
          var pc = doc.createElement('canvas'); pc.width = PW; pc.height = PH; var cc = pc.getContext('2d'); cc.fillStyle = '#fff'; cc.fillRect(0, 0, PW, PH);
          cc.drawImage(tall, 0, start, CW, end - start, M, M, CW, end - start); pages.push(pc);
          start = end; while (start < TH && blank[start]) start++;
          if (pages.length > 12) break;
        }
        free(tall); return pages;
      });
    });
  }
  function buildPdfFrom(jpgs) {
    return pdflib().then(function (L) {
      return L.PDFDocument.create().then(function (d) {
        var chain = Promise.resolve();
        jpgs.forEach(function (j) { chain = chain.then(function () { return d.embedJpg(j).then(function (im) { var pg = d.addPage([612, 792]); pg.drawImage(im, { x: 0, y: 0, width: 612, height: 792 }); }); }); });
        return chain.then(function () { d.setProducer('YN 악보 새로 그리기 (Claude · abcjs)'); return d.save({ useObjectStreams: true }); });
      });
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
    '.sf-st{margin-top:6px;color:var(--dim);font-size:13px;min-height:19px;white-space:pre-line;overflow-wrap:anywhere}.sf-st.bad{color:#ff7b72;font-weight:700}' +
    '.sf-mode .sf-ml{font-weight:800;color:var(--dim);margin-right:2px}.sf-mode small{font-weight:600;opacity:.75}.sf-mh{flex-basis:100%;color:var(--dim);font-size:12.5px}' +
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
    var MODES = [['clean', 'PDF처럼 깔끔하게'], ['sharp', '선명하게'], ['bold', '아주 진하게'], ['soft', '자연스럽게']], MODE0 = 'clean';
    try { var mm = root.localStorage.getItem('yn.sf.mode2'); if (mm === 'soft' || mm === 'sharp' || mm === 'bold' || mm === 'clean') MODE0 = mm; } catch (e) { /* 무시 */ }
    var CL = typeof o.claude === 'function' ? o.claude : null, CMODES = [['off', '기기 보정만'], ['text', '+ Claude 다듬기 (음표 · 코드 · 가사)'], ['engrave', '실험: 새로 그리기']], CM0 = 'text';
    try { var cm = root.localStorage.getItem('yn.sf.claude'); if (cm === 'off' || cm === 'text' || cm === 'engrave') CM0 = cm; } catch (e) { /* 무시 */ }
    var st = { cmode: CL ? CM0 : 'off', cl: [], eng: null, mode: MODE0, base: [], stop: false, src: null, res: [], page: 0, zoom: false, cx: 0.5, cy: 0.35, wipe: 0.5, busy: false, done: false, info: null, prevTok: 0 };
    var back = doc.createElement('div'); back.className = 'sf-back';
    back.innerHTML = '<div class="sf" role="dialog" aria-modal="true" aria-label="악보 화질 보정">' +
      '<div class="sf-h"><b>✨ 악보 화질 보정</b><span class="sf-name">' + esc(o.name || '') + '</span><button type="button" class="sf-x" data-a="close" aria-label="닫기">✕</button></div>' +
      '<div class="sf-warn">⚠ <b>컴퓨터 또는 iPad Pro 에서 하세요.</b> 휴대폰 · 일반 iPad 는 메모리가 모자라 멈추거나 아주 느릴 수 있어요. 예배 중에는 하지 말고 <b>미리</b> 해 두세요. 원본은 지우지 않고 보관하며, 필기는 그대로 옮겨집니다.</div>' +
      '<div class="sf-b">' +
        '<div class="sf-stage"><canvas class="sf-cv"></canvas><span class="sf-lb l">원본</span><span class="sf-lb r">보정본</span><div class="sf-empty" data-r="empty">보정 시작을 누르면 쪽마다 보정해서 원본과 나란히 보여 드려요.</div></div>' +
        '<div class="sf-row"><button type="button" class="sf-btn sm" data-a="prev" aria-label="이전 쪽">◀</button><span class="sf-pg" data-r="pg">–</span><button type="button" class="sf-btn sm" data-a="next" aria-label="다음 쪽">▶</button>' +
          '<input type="range" min="0" max="100" value="50" data-r="wipe" aria-label="원본 · 보정본 경계"><button type="button" class="sf-btn sm" data-a="zoom" aria-pressed="false">🔍 확대</button></div>' +
        '<div class="sf-row sf-mode" role="radiogroup" aria-label="보정 세기"><span class="sf-ml">세기</span>' + MODES.map(function (m) { return '<button type="button" class="sf-btn sm' + (st.mode === m[0] ? ' on' : '') + '" role="radio" aria-checked="' + (st.mode === m[0]) + '" data-a="mode" data-m="' + m[0] + '">' + m[1] + (m[0] === 'clean' ? ' <small>(추천)</small>' : '') + '</button>'; }).join('') +
          '<span class="sf-mh" data-r="mh"></span></div>' +
        (CL ? '<div class="sf-row sf-mode" role="radiogroup" aria-label="Claude"><span class="sf-ml">Claude <small>(나만)</small></span>' + CMODES.map(function (m) { return '<button type="button" class="sf-btn sm' + (st.cmode === m[0] ? ' on' : '') + '" role="radio" aria-checked="' + (st.cmode === m[0]) + '" data-a="cmode" data-m="' + m[0] + '">' + m[1] + (m[0] === 'text' ? ' <small>(추천)</small>' : '') + '</button>'; }).join('') + '<span class="sf-mh" data-r="ch"></span></div>' : '') +
        '<label class="sf-chk"><input type="checkbox" data-r="ai"> AI 2배 키우기 (실험) <small>해상도가 아주 낮은 악보만 · 결과가 이상하면 자동으로 일반 보정 · 보통은 끄고 하세요</small></label>' +
        '<div class="sf-prog"><div class="sf-bar"><i data-r="bar"></i></div><div class="sf-st" data-r="st" role="status" aria-live="polite"></div></div>' +
      '</div>' +
      '<div class="sf-f"><button type="button" class="sf-btn" data-a="revert" hidden>원본으로 되돌리기</button><span class="sp"></span><button type="button" class="sf-btn" data-a="close">닫기</button>' +
        '<button type="button" class="sf-btn" data-a="dl" hidden>PDF 내려받기</button><button type="button" class="sf-btn pri" data-a="start">보정 시작</button><button type="button" class="sf-btn pri" data-a="apply" hidden>보정본으로 바꾸기</button></div>' +
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
      else if (a === 'mode') setMode(b.getAttribute('data-m'));
      else if (a === 'cmode') setCMode(b.getAttribute('data-m'));
      else if (a === 'dl') download();
      else if (a === 'start') start();
      else if (a === 'apply') apply();
      else if (a === 'revert') revert();
    });
    function onKey(e) { if (e.key === 'Escape' && !st.busy) { e.stopPropagation(); close(); } else e.stopPropagation(); }
    back.addEventListener('keydown', onKey, true);

    function lock(on) { st.busy = on; ['start', 'apply', 'revert', 'dl'].forEach(function (a) { var x = btn(a); if (x) x.disabled = on; }); [].forEach.call(back.querySelectorAll('[data-a="mode"],[data-a="cmode"]'), function (x) { x.disabled = on; }); }
    var MODE_HINT = { clean: '오선은 같은 굵기의 곧은 선으로 새로 긋고, 기울기를 바로잡고, 음표 · 코드 · 가사 가장자리를 매끈하게 — 컴퓨터로 만든 PDF 악보처럼', soft: '예전 방식 — 원본 느낌 그대로 살짝만', sharp: '음표 · 코드 · 가사를 또렷하고 진하게 · 종이는 하얗게', bold: '흐리거나 작은 글씨를 더 굵고 진하게 (빽빽한 악보는 글자가 뭉칠 수 있어요)' };
    function paintMode() {
      [].forEach.call(back.querySelectorAll('[data-a="mode"]'), function (x) { var on = x.getAttribute('data-m') === st.mode; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
      $('[data-r="mh"]').textContent = MODE_HINT[st.mode] || '';
    }
    /** 세기 바꾸기 — 이미 키워 둔 그림(st.base)이 있으면 AI 를 다시 돌리지 않고 마무리만 새로 (쪽마다 1~2초) */
    function setMode(m) {
      if (st.busy || m === st.mode) return;
      st.mode = m; paintMode(); try { root.localStorage.setItem('yn.sf.mode2', m); } catch (e) { /* 무시 */ }
      var idx = st.base.map(function (b, i) { return b ? i : -1; }).filter(function (i) { return i >= 0; });
      if (!idx.length) { if (st.res.some(function (x) { return x && x.jpg; })) { btn('apply').hidden = true; btn('start').hidden = false; btn('start').disabled = false; btn('start').textContent = '이 세기로 다시 보정'; st.res = st.res.map(function () { return null; }); after = null; showPage(st.page); say('세기를 바꿨어요. 「이 세기로 다시 보정」을 눌러 주세요.'); } return; }
      lock(true); prog(0); var n = 0, chain = Promise.resolve();
      idx.forEach(function (i) {
        chain = chain.then(function () {
          say('「' + MODES.filter(function (x) { return x[0] === m; })[0][1] + '」로 다시 만드는 중… ' + (n + 1) + ' / ' + idx.length);
          return frame().then(function () { var out = finishBase(st.base[i], m); if (st.cmode === 'text' && st.cl[i]) { polishNotes(out.cv); overlayText(out.cv, st.cl[i].filter(function (x) { return x.k !== 'lyric'; })); overlayText(out.cv, st.cl[i].filter(function (x) { return x.k === 'lyric'; })); } return toJpeg(out.cv, CFG.jpegQ).then(function (jpg) { free(out.cv); st.res[i] = { jpg: jpg, ai: out.ai }; }); })
            .then(function () { n++; prog(n / idx.length); if (st.page === i) showPage(i); });
        });
      });
      chain.then(function () { lock(false); say('세기를 바꿨어요. 원본과 비교해 보고 「보정본으로 바꾸기」를 눌러 주세요.'); }, function (e) { lock(false); say((e && e.message) || '다시 만들지 못했습니다.', true); });
    }
    paintMode();

    var CM_HINT = { off: '예전처럼 이 기기에서만 보정해요.', text: '기기 보정 뒤 ① 검은 음표 머리를 반듯한 모양으로 다시 칠하고 ② Claude 가 읽은 코드 · 제목 · Key · 섹션 · 가사를 깨끗한 글꼴로 같은 자리에 다시 써요. 음 높이 · 자리는 그대로라 틀릴 일이 거의 없어요.', engrave: '실험 — Claude 가 악보 전체(음표 · 코드 · 가사)를 옮겨 적어 새로 그려요. 음표 · 리듬이 틀릴 수 있으니 원본과 꼭 비교하세요. 쪽 나눔이 달라져 필기 자리는 맞지 않을 수 있어요.' };
    function paintCMode() {
      if (!CL) return;
      [].forEach.call(back.querySelectorAll('[data-a="cmode"]'), function (x) { var on = x.getAttribute('data-m') === st.cmode; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
      var e = $('[data-r="ch"]'); if (e) e.textContent = CM_HINT[st.cmode] || '';
      [].forEach.call(back.querySelectorAll('.sf-mode:not([aria-label="Claude"]) .sf-btn, [data-r="ai"]'), function (x) { x.disabled = st.cmode === 'engrave' || st.busy; });
    }
    function setCMode(m) {
      if (st.busy || m === st.cmode) return;
      st.cmode = m; try { root.localStorage.setItem('yn.sf.claude', m); } catch (e) { /* 무시 */ } paintCMode();
      if (st.res.some(function (x) { return x && x.jpg; }) || st.eng) {
        st.res = st.res.map(function () { return null; }); st.eng = null; after = null; showPage(st.page);
        btn('apply').hidden = true; btn('dl').hidden = true; btn('start').hidden = false; btn('start').disabled = false; btn('start').textContent = '이 방식으로 다시 보정'; say('방식을 바꿨어요. 「이 방식으로 다시 보정」을 눌러 주세요.');
      }
    }
    /** text 방식 — 이 쪽 그림에 Claude 글자 다시 쓰기 (읽은 결과는 쪽마다 기억해 세기만 바꿀 때 다시 묻지 않음) */
    function claudeText(cv, idx) {
      st.noteN = (st.noteN || 0) + polishNotes(cv);                                                // 음표 머리 (기기 안 — Claude 를 부르지 않음)
      var got;
      if (st.cl[idx]) got = Promise.resolve(st.cl[idx]);
      else {
        var img = jpegOf(cv, 1568, 0.85);
        got = CL('labels', { image: img }).then(function (r) { return (r && r.items) || []; }, function (e) { st.clErr = (e && e.message) || ''; return []; })
          .then(function (lab) { say('Claude 가 가사를 읽는 중…'); return CL('lyrics', { image: img }).then(function (r) { return lab.concat((r && r.items) || []); }, function (e) { st.lyErr = (e && e.message) || '가사는 읽지 못했어요'; return lab; }); })
          .then(function (all) { st.cl[idx] = all; return all; });
      }
      return got.then(function (items) {
        var lab = items.filter(function (x) { return x.k !== 'lyric'; }), ly = items.filter(function (x) { return x.k === 'lyric'; });
        var a = overlayText(cv, lab), b = overlayText(cv, ly); st.clN = (st.clN || 0) + a; st.lyN = (st.lyN || 0) + b; return a + b;
      });
    }
    paintCMode();
    function close() {
      st.stop = true; st.base = []; root.removeEventListener('resize', onResize);
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
      if (st.cmode === 'engrave' && CL) return startEngrave();
      lock(true); st.stop = false; AI.slow = false; st.base = []; st.clN = 0; st.lyN = 0; st.noteN = 0; st.clErr = ''; st.lyErr = ''; prog(0); say('악보를 불러오는 중…');
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
                return upscaleCanvas(c, { ai: useAi && !!AI.model, isStop: function () { return st.stop; }, onTick: function (f) { prog((n + f) / r.length); } }).then(function (base) {
                  free(c); if (!base) return;
                  if (r.length <= 12) st.base[idx] = base;                                      // 세기만 바꿀 때 다시 씀 (쪽이 많으면 메모리 때문에 두지 않음)
                  var out = finishBase(base, st.mode);
                  if (out.slow && !aiNote) aiNote = '이 기기에서 AI 가 느려 일반 보정으로 바꿨어요';
                  if (out.bad && !aiNote) aiNote = 'AI 결과가 이 기기에서 깨져 보여 일반 보정으로 했어요';
                  var clStep = st.cmode === 'text' && CL ? (say((n + 1) + ' / ' + r.length + ' 쪽 — 음표를 다듬고, Claude 가 코드 · 제목을 읽는 중…'), claudeText(out.cv, idx).catch(function (e) { st.clErr = (e && e.message) || 'Claude 가 읽지 못했어요'; })) : Promise.resolve();
                  return clStep.then(function () { return toJpeg(out.cv, CFG.jpegQ); }).then(function (jpg) { free(out.cv); st.res[idx] = { jpg: jpg, ai: out.ai }; });
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
            say(ok ? '보정을 마쳤어요 (' + ok + '쪽). 경계를 옮기거나 🔍 확대로 원본과 비교한 뒤 「보정본으로 바꾸기」를 눌러 주세요.' + (aiNote ? ' · ' + aiNote : '') + (st.cmode === 'text' && CL ? '\n음표 머리 ' + (st.noteN || 0) + '개 다듬음 · 코드 · 제목 ' + (st.clN || 0) + '개 · 가사 ' + (st.lyN || 0) + '자를 깨끗한 글자로 다시 씀' + (st.clErr ? '\n⚠ 코드 · 제목: ' + st.clErr : '') + (st.lyErr ? '\n⚠ 가사: ' + st.lyErr : '') : '') : '보정한 쪽이 없어요.', !ok);
          });
        })
        .catch(function (e) { lock(false); say((e && e.message) || '보정하지 못했습니다.', true); });
    }

    /* engrave 방식 — 사진 쪽들을 Claude 에 보내 ABC 로 받고, 새로 그린 Letter 쪽들로 (비교 화면: 같은 순서의 쪽끼리) */
    function startEngrave() {
      lock(true); st.stop = false; st.engErr = ''; prog(0.05); say('악보를 불러오는 중…');
      root.fetch(o.fetchUrl, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('악보를 불러오지 못했습니다.'); return r.arrayBuffer(); })
        .then(function (ab) { return openSource(new Uint8Array(ab)); })
        .then(function (src) {
          st.src = src; st.res = src.pages.map(function () { return null; });
          var idx = src.pages.map(function (p, i) { return i; }).slice(0, 6); src.pages.forEach(function (p) { p.raster = true; });
          showPage(idx[0]); prog(0.15); say('Claude 에 보낼 그림을 만드는 중…');
          return idx.reduce(function (pr, i) { return pr.then(function (arr) { var p = src.pages[i]; return p.get(Math.min(p.srcLong || 2000, 1800)).then(function (c) { arr.push(jpegOf(c, 1568, 0.85)); free(c); return arr; }); }); }, Promise.resolve([]));
        })
        .then(function (imgs) {
          /* 한 쪽씩 — 첫 쪽에서 머리말(X · T · M · L · Q · K)을 받고, 다음 쪽은 음표 줄만 받아 이어 붙임 (길어서 잘리지 않게) */
          var abc = '', header = '', n = imgs.length; st.trunc = false;
          return imgs.reduce(function (pr, img, i) {
            return pr.then(function () {
              if (st.stop) return;
              prog(0.25 + 0.5 * i / n); say('Claude 가 ' + (n > 1 ? (i + 1) + ' / ' + n + '쪽을 ' : '') + '옮겨 적는 중… (쪽마다 20초 ~ 1분)');
              return CL('engrave', { images: [img], part: i, total: n, header: header }).then(function (r) {
                if (i === 0) { abc = r.abc; header = r.header || ''; } else abc += '\n' + r.abc;
                if (r.truncated) st.trunc = true;
              }, function (e) { if (i === 0) throw e; st.trunc = true; st.engErr = (e && e.message) || ''; });      // 두 번째 쪽부터 실패하면 거기까지만
            });
          }, Promise.resolve()).then(function () { return abc; });
        })
        .then(function (abc) { prog(0.8); say('새로 그리는 중…'); st.abc = abc; return engravePages(abc); })
        .then(function (pages) {
          return pages.reduce(function (pr, pc) { return pr.then(function (arr) { return toJpeg(pc, 0.9).then(function (j) { free(pc); arr.push(j); return arr; }); }); }, Promise.resolve([]));
        })
        .then(function (jpgs) {
          st.eng = { jpgs: jpgs };
          st.res = st.src.pages.map(function (p, i) { return jpgs[i] ? { jpg: jpgs[i] } : null; });
          lock(false); prog(1); showPage(st.page);
          btn('start').hidden = true; btn('apply').hidden = false; btn('apply').disabled = false; btn('dl').hidden = false;
          say('새로 그렸어요 (' + jpgs.length + '쪽). 원본과 꼭 비교해 보세요 — 음표 · 리듬이 틀린 곳이 있으면 쓰지 마세요. 「PDF 내려받기」로 따로 받아 둘 수도 있어요.' + (jpgs.length !== st.src.pages.length ? ' (쪽 수가 원본과 달라요: ' + st.src.pages.length + ' → ' + jpgs.length + ')' : '') + (st.trunc ? '\n⚠ 일부 쪽은 끝까지 옮기지 못했어요' + (st.engErr ? ' (' + st.engErr + ')' : '') + ' — 원본과 비교해 빠진 곳을 확인해 주세요.' : ''));
          paintCMode();
        })
        .catch(function (e) { lock(false); prog(0); say((e && e.message) || '새로 그리지 못했습니다.', true); paintCMode(); });
    }
    function download() {
      if (!st.eng) return; lock(true);
      buildPdfFrom(st.eng.jpgs).then(function (bytes) {
        var a = doc.createElement('a'), url = root.URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        a.href = url; a.download = String(o.name || '악보').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]/g, '_') + ' (새로 그림).pdf'; doc.body.appendChild(a); a.click();
        setTimeout(function () { root.URL.revokeObjectURL(url); a.remove(); }, 1500); lock(false); say('PDF 를 내려받았어요.');
      }, function (e) { lock(false); say((e && e.message) || '만들지 못했습니다.', true); });
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
      if (st.eng && !root.confirm('새로 그린 악보로 바꿀까요?\n원본은 보관되어 되돌릴 수 있지만, 쪽 나눔이 달라 필기 자리가 맞지 않을 수 있어요.')) { lock(false); say(''); return; }
      function build() {
        return (st.eng ? buildPdfFrom(st.eng.jpgs) : buildPdf(st.src, st.res)).then(function (bytes) {
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
  root.YNSheetFix._engine = { polishNotes: polishNotes, overlayText: overlayText, inkBox: inkBox, engravePages: engravePages, CFG: CFG, AI: AI, aiLoad: aiLoad, aiFree: aiFree, aiUpscale: aiUpscale, flatten: flatten, levels: levels, toGray: toGray, processCanvas: processCanvas, upscaleCanvas: upscaleCanvas, finishBase: finishBase, inkFinish: inkFinish, aiLooksRight: aiLooksRight, cleanFinish: cleanFinish, skewAngle: skewAngle, staffLines: staffLines, openSource: openSource, buildPdf: buildPdf, toJpeg: toJpeg, grayToCanvas: grayToCanvas, resizeCanvas: resizeCanvas, free: free, pdfjs: pdfjs, isPdf: isPdf };
})(typeof window !== 'undefined' ? window : this);
