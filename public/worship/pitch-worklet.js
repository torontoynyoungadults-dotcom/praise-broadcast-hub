/**
 * 키(음높이) 바꾸기 DSP — AudioWorklet 처리기 "yn-pitch-shifter"  (audio-shift.js 가 불러 씁니다)
 * ------------------------------------------------------------
 *  방식: WSOLA(파형 맞춰 겹쳐 잇기) 로 소리 길이를 p 배 늘린 다음(음높이는 그대로),
 *        그것을 p 배 빠르게 읽어(리샘플) 음높이만 p 배로 만듭니다.  →  길이 · 박자는 그대로, 음높이만 p = 2^(반음/12) 배.
 *   1) 늘이기  : 창 길이 N(≈40ms, 한 조각) · 합성 간격 Hs = N/2 · 분석 간격 Ha = Hs / p.
 *                조각마다 "앞 조각이 자연스럽게 이어질 자리" 근처(±Δ ≈ 14ms) 에서 파형이 가장 비슷한 자리를 찾아(상호상관)
 *                한 조각을 Hann 창으로 잘라 겹쳐 더합니다 (Hann 창 50% 겹침의 합은 늘 1 — 소리 크기가 출렁이지 않음).
 *   2) 읽기    : 늘어난 소리를 p 칸씩 3차(Catmull-Rom) 보간으로 읽습니다.
 *  · 지연: 약 (N + 2Δ) / 표본화율 ≈ 0.06~0.09 초 (곡 재생에는 영향 없음)
 *  · 스테레오: 두 채널이 같은 자리(왼+오른 합으로 찾은 자리)를 써서 좌우 위치가 흔들리지 않습니다.
 *  · 이 파일은 AudioWorkletGlobalScope 에서도, Node(시험) 에서도 읽힙니다 (WsolaShifter 만 순수 JS).
 */
(function (root) {
  'use strict';

  function nextPow2(x) { var p = 1; while (p < x) p <<= 1; return p; }

  /**
   * new WsolaShifter(sampleRate, { ratio })   ratio = 음높이 배수 (2^(반음/12))
   * process(inL, inR, outL, outR, n) — 입력 n 표본을 받아 출력 n 표본을 채웁니다 (입력이 끊기면 null · 0 으로 채움)
   */
  function WsolaShifter(sr, opt) {
    opt = opt || {};
    var self = this;
    self.sr = sr || 44100;
    self.N = Math.max(512, Math.min(8192, nextPow2(Math.round(0.04 * self.sr))));       // 조각(창) 길이 — 44.1k · 48k 에서 2048
    self.Hs = self.N >> 1;
    self.delta = Math.round(0.014 * self.sr);                                            // 찾는 범위 ± (표본)
    self.RB = nextPow2(self.N * 8);  self.MB = nextPow2(self.N * 8);                    // 링 버퍼 크기 (입력 · 늘린 소리)
    self.inb = [new Float32Array(self.RB), new Float32Array(self.RB)];
    self.mid = [new Float32Array(self.MB), new Float32Array(self.MB)];
    self.win = new Float32Array(self.N);
    for (var i = 0; i < self.N; i++) self.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / self.N);     // 주기형 Hann
    self.mono = new Float32Array(self.N + 2 * self.delta + 8);
    self.wpos = 0;                    // 지금까지 받은 입력 표본 수 (절대 위치)
    self.mavail = 0;                  // 늘린 소리에서 "다 만들어진" 표본 수
    self.rpos = 0;                    // 늘린 소리를 읽는 위치 (소수)
    self.k = 0;                       // 다음에 만들 조각 번호
    self.nominal = self.delta;        // 다음 조각의 기준 입력 위치 (Ha 씩 전진)
    self.prev = -1;                   // 앞 조각이 고른 입력 위치 (-1: 아직 없음)
    self.primed = false;
    self.ratio = 1; self.setRatio(opt.ratio == null ? 1 : opt.ratio);
    self.underruns = 0;
  }
  WsolaShifter.prototype.setRatio = function (r) { r = +r; if (!isFinite(r) || r < 0.5) r = 0.5; else if (r > 2) r = 2; this.ratio = r; };

  /** 입력 위치 a 부터 한 조각(가운데 합) 을 꺼내 상관을 계산할 때 쓰는 접근 도우미 */
  WsolaShifter.prototype._mono = function (pos, len, out) {
    var m = this.RB - 1, L = this.inb[0], R = this.inb[1], i;
    for (i = 0; i < len; i++) { var j = (pos + i) & m; out[i] = L[j] + R[j]; }
  };

  /** 조각 하나를 골라 늘린 소리에 겹쳐 더함 — 입력이 충분히 쌓였을 때만 */
  WsolaShifter.prototype._grain = function () {
    var N = this.N, Hs = this.Hs, D = this.delta, m = this.RB - 1, mm = this.MB - 1, p = this.ratio;
    var Ha = Hs / p, nom = this.nominal, ni = Math.round(nom), i, c;
    if (this.wpos < ni + D + N + 2) return false;                               // 입력이 아직 모자람
    var pick = ni;
    if (this.prev >= 0 && Math.abs(p - 1) > 1e-9) {
      var tpos = this.prev + Hs;                                                // 앞 조각이 이어질 자연스러운 자리
      var M = Hs, tmpl = this.mono, cand = this.mono2 || (this.mono2 = new Float32Array(this.N + 2 * this.delta + 8));
      this._mono(tpos, M, tmpl);
      var et = 0; for (i = 0; i < M; i += 4) et += tmpl[i] * tmpl[i];
      var lo = Math.max(ni - D, this.wpos - this.RB + N + 4), hi = ni + D;
      if (lo > hi) lo = hi;
      if (et > 1e-9) {
        // 후보 구간 전체를 한 번 꺼내 둠 (lo .. hi + M)
        var span = hi - lo + M; if (span > cand.length) span = cand.length;
        this._mono(lo, span, cand);
        var best = -1e9, bs = ni, s, ss, cr, ec, sc;
        for (s = lo; s <= hi; s += 2) {
          ss = s - lo; cr = 0; ec = 0;
          for (i = 0; i < M; i += 4) { var a = cand[ss + i]; cr += a * tmpl[i]; ec += a * a; }
          sc = cr / Math.sqrt(ec * et + 1e-12) - 0.03 * Math.abs(s - ni) / D;       // 기준 위치에서 멀수록 조금 감점
          if (sc > best) { best = sc; bs = s; }
        }
        var lo2 = Math.max(lo, bs - 2), hi2 = Math.min(hi, bs + 2);
        for (s = lo2; s <= hi2; s++) {
          ss = s - lo; cr = 0; ec = 0;
          for (i = 0; i < M; i += 2) { var a2 = cand[ss + i]; cr += a2 * tmpl[i]; ec += a2 * a2; }
          sc = cr / Math.sqrt(ec * et * 2 + 1e-12) - 0.03 * Math.abs(s - ni) / D;
          if (sc > best) { best = sc; bs = s; }
        }
        pick = bs;
      }
    }
    // 겹쳐 더하기: 앞 절반은 앞 조각의 뒤 절반 위에 더하고, 뒤 절반은 새로 씀
    var base = this.k * Hs, w = this.win, mid = this.mid, inb = this.inb;
    for (c = 0; c < 2; c++) {
      var src = inb[c], dst = mid[c];
      for (i = 0; i < Hs; i++) dst[(base + i) & mm] += src[(pick + i) & m] * w[i];
      for (i = Hs; i < N; i++) dst[(base + i) & mm] = src[(pick + i) & m] * w[i];
    }
    this.prev = pick; this.k++; this.nominal = nom + Ha; this.mavail = this.k * Hs;
    return true;
  };

  WsolaShifter.prototype.process = function (inL, inR, outL, outR, n) {
    var m = this.RB - 1, i, c;
    // 1) 입력을 링에 쌓음 (모노 입력이면 양쪽 채널에 같은 소리)
    for (i = 0; i < n; i++) {
      var a = inL ? inL[i] : 0, b = inR ? inR[i] : a;
      var j = (this.wpos + i) & m; this.inb[0][j] = a; this.inb[1][j] = b;
    }
    this.wpos += n;
    // 2) 조각을 만들 수 있는 만큼 만듦 (한 번에 너무 많이 만들지 않게 상한)
    var guard = 8; while (guard-- > 0 && this._grain()) { /* 계속 */ }
    // 3) 늘린 소리를 p 칸씩 읽어 출력
    var p = this.ratio, mm = this.MB - 1, mid0 = this.mid[0], mid1 = this.mid[1], rp = this.rpos;
    if (!this.primed) { if (this.mavail >= this.N * 2) { this.primed = true; rp = this.rpos = 0; } }
    for (i = 0; i < n; i++) {
      if (!this.primed || rp + 3 >= this.mavail) { outL[i] = 0; outR[i] = 0; if (this.primed) this.underruns++; continue; }
      var i0 = Math.floor(rp), t = rp - i0, k0 = (i0 - 1) & mm, k1 = i0 & mm, k2 = (i0 + 1) & mm, k3 = (i0 + 2) & mm;
      for (c = 0; c < 2; c++) {
        var d = c ? mid1 : mid0, y0 = d[k0], y1 = d[k1], y2 = d[k2], y3 = d[k3];
        var v = y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
        if (c) outR[i] = v; else outL[i] = v;
      }
      rp += p;
    }
    this.rpos = rp;
    // 오래된 표본이 링에서 덮이기 전에 읽는 자리가 뒤처지지 않게: 너무 뒤처지면(입력이 끊겼다 이어진 경우) 앞으로 당김
    if (this.primed && this.mavail - rp > this.MB - this.N * 2) this.rpos = this.mavail - this.N * 2;
  };

  /** 채널 하나짜리 편의 함수 (시험용): 전체 신호를 128 표본씩 흘려 넣고 결과를 돌려줌 */
  WsolaShifter.run = function (sr, ratio, input, block) {
    block = block || 128;
    var s = new WsolaShifter(sr, { ratio: ratio }), out = new Float32Array(input.length), oL = new Float32Array(block), oR = new Float32Array(block);
    for (var o = 0; o < input.length; o += block) {
      var n = Math.min(block, input.length - o);
      s.process(input.subarray(o, o + n), input.subarray(o, o + n), oL, oR, n);
      out.set(oL.subarray(0, n), o);
    }
    return { out: out, underruns: s.underruns, shifter: s };
  };

    /**
     * V898 — PvShifter: 위상 보코더 + 위상 묶기(identity phase locking). WsolaShifter 와 같은 약속 (process · setRatio) + setVocal.
     *  · 창 4096(≈85ms @48k) · 75% 겹침. 봉우리(배음)마다 순간 주파수로 위상을 이어 가고, 사이 칸은 봉우리에 묶어 → 지속음이 흔들리지 않음
     *    (WSOLA 는 조각을 이어 붙이는 자리 때문에 지속음 크기가 초당 몇 번 2% 쯤 출렁여 "우는" 소리가 났음 — 시험: scripts 의 측정 참고)
     *  · 보컬 줄이기(setVocal 0~1): 왼 · 오른이 같은(가운데) 소리를 목소리 대역(150Hz ~ 8kHz)에서만 줄임 — 양옆 악기 · 베이스는 거의 그대로.
     *    모노 녹음은 모든 소리가 가운데라 줄이지 않음 (this.mono)
     */
  function PvShifter(sr, opt) {
    opt = opt || {};
    var s = this; s.sr = sr || 44100;
    s.N = s.sr > 64000 ? 8192 : 4096;                  // 창 ≈ 85ms (48k)
    s.Hs = s.N >> 2;                                   // 합성 간격 = N/4 (75% 겹침)
    s.half = s.N >> 1;
    s.RB = 1 << 17; s.MB = 1 << 17;
    s.inb = [new Float32Array(s.RB), new Float32Array(s.RB)];
    s.mid = [new Float32Array(s.MB), new Float32Array(s.MB)];
    s.win = new Float32Array(s.N); for (var i = 0; i < s.N; i++) s.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / s.N);
    s.norm = 1 / 1.5;                                  // Hann² 75% 겹침 합 = 1.5
    s.re = new Float32Array(s.N); s.im = new Float32Array(s.N);
    s.prevPh = [new Float32Array(s.half + 1), new Float32Array(s.half + 1)];
    s.sumPh = [new Float32Array(s.half + 1), new Float32Array(s.half + 1)];
    s.outPh = new Float32Array(s.half + 1); s.peak = new Int32Array(s.half + 1); s.magSum = new Float32Array(s.half + 1);
    var H1 = s.half + 1;
    s.mg = [new Float32Array(H1), new Float32Array(H1)]; s.pp = [new Float32Array(H1), new Float32Array(H1)];
    s.xr = [new Float32Array(H1), new Float32Array(H1)]; s.xi = [new Float32Array(H1), new Float32Array(H1)];
    s.vg = new Float32Array(H1).fill(1); s.vocal = opt.vocal ? +opt.vocal : 0; s.sideE = 0; s.midE = 0; s.mono = false;
    // FFT 준비
    var lg = 0; while ((1 << lg) < s.N) lg++; s.lg = lg;
    s.rev = new Uint32Array(s.N); for (i = 0; i < s.N; i++) { var r = 0, x = i; for (var b = 0; b < lg; b++) { r = (r << 1) | (x & 1); x >>= 1; } s.rev[i] = r; }
    s.cos = new Float32Array(s.half); s.sin = new Float32Array(s.half); for (i = 0; i < s.half; i++) { s.cos[i] = Math.cos(2 * Math.PI * i / s.N); s.sin[i] = Math.sin(2 * Math.PI * i / s.N); }
    s.wpos = 0; s.k = 0; s.apos = 0; s.prevA = -1; s.mavail = 0; s.rpos = 0; s.primed = false; s.first = true;
    s.ratio = 1; s.setRatio(opt.ratio == null ? 1 : opt.ratio); s.underruns = 0;
  }
  PvShifter.prototype.setRatio = function (r) { r = +r; if (!isFinite(r) || r < 0.5) r = 0.5; else if (r > 2) r = 2; this.ratio = r; };
  PvShifter.prototype._fft = function (re, im, inv) {
    var N = this.N, rev = this.rev, i, j, t;
    for (i = 0; i < N; i++) { j = rev[i]; if (j > i) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (var size = 2; size <= N; size <<= 1) {
      var hs = size >> 1, step = N / size;
      for (i = 0; i < N; i += size) {
        for (j = 0; j < hs; j++) {
          var k = j * step, wr = this.cos[k], wi = inv ? this.sin[k] : -this.sin[k];
          var a = i + j, b = a + hs, tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
  PvShifter.prototype.setVocal = function (v) { v = +v; this.vocal = isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; };
  PvShifter.prototype._frame = function () {
    var N = this.N, Hs = this.Hs, half = this.half, p = this.ratio, Ha = Hs / p, m = this.RB - 1, mm = this.MB - 1, TWO = 2 * Math.PI;
    var a = Math.round(this.apos); if (this.wpos < a + N + 1) return false;
    var hop = this.prevA < 0 ? Math.round(Ha) : a - this.prevA; if (hop <= 0) hop = 1;
    var base = this.k * Hs, c, i, re = this.re, im = this.im, w = this.win;
    for (c = 0; c < 2; c++) {
      var src = this.inb[c], M2 = this.mg[c], P2 = this.pp[c], X = this.xr[c], Y = this.xi[c];
      for (i = 0; i < N; i++) { re[i] = src[(a + i) & m] * w[i]; im[i] = 0; }
      this._fft(re, im, false);
      for (i = 0; i <= half; i++) { X[i] = re[i]; Y[i] = im[i]; M2[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); P2[i] = Math.atan2(im[i], re[i]); }
    }
    /* 보컬 줄이기 — 가운데(왼 = 오른)에 있는 소리를 목소리 대역(약 150Hz ~ 8kHz)에서만 줄임. 베이스 · 킥 · 높은 심벌은 그대로 */
    var vg = this.vg, L0 = this.mg[0], R0 = this.mg[1];
    if (this.vocal > 0) {
      var es = 0, em = 0;
      for (i = 1; i <= half; i++) { var dr = this.xr[0][i] - this.xr[1][i], di = this.xi[0][i] - this.xi[1][i], sr2 = this.xr[0][i] + this.xr[1][i], si2 = this.xi[0][i] + this.xi[1][i]; es += dr * dr + di * di; em += sr2 * sr2 + si2 * si2; }
      this.sideE = this.sideE * 0.95 + es * 0.05; this.midE = this.midE * 0.95 + em * 0.05;
      this.mono = this.midE > 1e-9 && this.sideE < this.midE * 2e-4;                 // 모노 녹음이면 줄이지 않음 (모든 소리가 가운데라 다 줄어 버림)
      for (i = 0; i <= half; i++) {
        var g = 1;
        if (!this.mono) {
          var f = i * this.sr / N, band = f < 120 ? 0 : f < 200 ? (f - 120) / 80 : f < 7000 ? 1 : f < 10000 ? (10000 - f) / 3000 : 0;
          if (band > 0) {
            var den = L0[i] * L0[i] + R0[i] * R0[i];
            if (den > 1e-12) {
              var cr = (this.xr[0][i] * this.xr[1][i] + this.xi[0][i] * this.xi[1][i]) * 2 / den;     // 1 = 완전히 가운데 · 같은 위상
              var cen = cr > 0 ? cr * cr * cr * cr : 0;
              g = 1 - this.vocal * 0.85 * band * cen;
            }
          }
        }
        vg[i] = vg[i] * 0.55 + g * 0.45;                                            // 시간 방향으로 부드럽게 (지글거림 줄임)
      }
    } else { for (i = 0; i <= half; i++) vg[i] = 1; this.mono = false; }
    var ms = this.magSum, pk = this.peak, np = 0;
    for (i = 0; i <= half; i++) ms[i] = L0[i] + R0[i];
    for (i = 2; i < half - 1; i++) if (ms[i] > ms[i - 1] && ms[i] >= ms[i + 1] && ms[i] > ms[i - 2] && ms[i] >= ms[i + 2]) pk[np++] = i;
    for (c = 0; c < 2; c++) {
      var M = this.mg[c], P = this.pp[c], prev = this.prevPh[c], sum = this.sumPh[c], out = this.outPh, q;
      for (q = 0; q < np; q++) {                                                     // 봉우리: 순간 주파수로 위상 진행
        i = pk[q]; var om = TWO * i / N, d = P[i] - prev[i] - om * hop; d -= TWO * Math.round(d / TWO);
        sum[i] = this.first ? P[i] : sum[i] + (om + d / hop) * Hs;
      }
      var qi = 0;
      for (i = 0; i <= half; i++) {
        if (np === 0) { var om2 = TWO * i / N, d2 = P[i] - prev[i] - om2 * hop; d2 -= TWO * Math.round(d2 / TWO); sum[i] = this.first ? P[i] : sum[i] + (om2 + d2 / hop) * Hs; out[i] = sum[i]; continue; }
        while (qi < np - 1 && pk[qi + 1] - i < i - pk[qi]) qi++;                       // 가장 가까운 봉우리에 위상을 묶음 (identity phase locking)
        var r0 = pk[qi]; out[i] = sum[r0] + (P[i] - P[r0]);
      }
      for (i = 0; i <= half; i++) prev[i] = P[i];
      for (i = 0; i <= half; i++) { var mg2 = M[i] * vg[i]; re[i] = mg2 * Math.cos(out[i]); im[i] = mg2 * Math.sin(out[i]); }
      for (i = 1; i < half; i++) { re[N - i] = re[i]; im[N - i] = -im[i]; }
      this._fft(re, im, true);
      var dst = this.mid[c], gn = this.norm / N;
      for (i = 0; i < N - Hs; i++) dst[(base + i) & mm] += re[i] * w[i] * gn;
      for (i = N - Hs; i < N; i++) dst[(base + i) & mm] = re[i] * w[i] * gn;
    }
    this.first = false; this.prevA = a; this.apos += Ha; this.k++; this.mavail = this.k * Hs;
    return true;
  };
  PvShifter.prototype.process = function (inL, inR, outL, outR, n) {
    var m = this.RB - 1, i, c;
    for (i = 0; i < n; i++) { var a = inL ? inL[i] : 0, b = inR ? inR[i] : a, j = (this.wpos + i) & m; this.inb[0][j] = a; this.inb[1][j] = b; }
    this.wpos += n;
    var guard = 6; while (guard-- > 0 && this._frame()) { /* 계속 */ }
    var p = this.ratio, mm = this.MB - 1, mid0 = this.mid[0], mid1 = this.mid[1], rp = this.rpos, lag = this.N; // 겹쳐 더하기가 끝난 곳까지만 읽음
    var ready = this.mavail;
    if (!this.primed) { if (ready >= this.N) { this.primed = true; rp = this.rpos = 0; } }
    for (i = 0; i < n; i++) {
      if (!this.primed || rp + 3 >= ready) { outL[i] = 0; outR[i] = 0; if (this.primed) this.underruns++; continue; }
      var i0 = Math.floor(rp), t = rp - i0, k0 = (i0 - 1) & mm, k1 = i0 & mm, k2 = (i0 + 1) & mm, k3 = (i0 + 2) & mm;
      for (c = 0; c < 2; c++) {
        var d = c ? mid1 : mid0, y0 = d[k0], y1 = d[k1], y2 = d[k2], y3 = d[k3];
        var v = y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
        if (c) outR[i] = v; else outL[i] = v;
      }
      rp += p;
    }
    this.rpos = rp;
    if (this.primed && ready - rp > this.MB - this.N * 4) this.rpos = ready - this.N * 2;
  };

  /* ------------------------------------------------------------ AudioWorklet 등록 */
  if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
    registerProcessor('yn-pitch-shifter', class extends AudioWorkletProcessor {
      constructor(o) {
        super();
        var po = (o && o.processorOptions) || {}, me = this;
        this.s = po.engine === 'wsola' ? new WsolaShifter(sampleRate, { ratio: po.ratio == null ? 1 : po.ratio }) : new PvShifter(sampleRate, { ratio: po.ratio == null ? 1 : po.ratio, vocal: po.vocal || 0 });      // V898 — 기본은 위상 보코더
        this.port.onmessage = function (e) {
          var d = e && e.data; if (!d) return;
          if (d.type === 'ratio') me.s.setRatio(d.value);
          else if (d.type === 'vocal') { if (me.s.setVocal) me.s.setVocal(d.value); }
          else if (d.type === 'stats') me.port.postMessage({ type: 'stats', underruns: me.s.underruns, ratio: me.s.ratio, mono: !!me.s.mono });
        };
      }
      process(inputs, outputs) {
        var inp = inputs[0], out = outputs[0]; if (!out || !out.length) return true;
        var l = inp && inp[0] ? inp[0] : null, r = inp && inp[1] ? inp[1] : l;
        var oL = out[0], oR = out[1], n = oL.length;
        if (!oR) { if (!this._t || this._t.length < n) this._t = new Float32Array(n); oR = this._t; }
        this.s.process(l, r, oL, oR, n);
        return true;
      }
    });
  }

  if (typeof module === 'object' && module.exports) module.exports = { WsolaShifter: WsolaShifter, PvShifter: PvShifter };
  else if (root) { root.YNWsolaShifter = WsolaShifter; root.YNPvShifter = PvShifter; }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this)));
