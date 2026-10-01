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

  /* ------------------------------------------------------------ AudioWorklet 등록 */
  if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
    registerProcessor('yn-pitch-shifter', class extends AudioWorkletProcessor {
      constructor(o) {
        super();
        var po = (o && o.processorOptions) || {}, me = this;
        this.s = new WsolaShifter(sampleRate, { ratio: po.ratio == null ? 1 : po.ratio });
        this.port.onmessage = function (e) {
          var d = e && e.data; if (!d) return;
          if (d.type === 'ratio') me.s.setRatio(d.value);
          else if (d.type === 'stats') me.port.postMessage({ type: 'stats', underruns: me.s.underruns, ratio: me.s.ratio });
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

  if (typeof module === 'object' && module.exports) module.exports = { WsolaShifter: WsolaShifter };
  else if (root) root.YNWsolaShifter = WsolaShifter;
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this)));
