/**
 * 화면 켜짐 유지 (세션 / 연습이 열려 있는 동안 기기가 잠들거나 화면이 꺼지지 않게)
 * ------------------------------------------------------------
 * ① Screen Wake Lock API (Chrome · Edge · Safari 16.4+ · Firefox 126+ · 안드로이드 · 아이폰/아이패드 · Mac · Windows)
 *    - 탭이 숨겨지면 브라우저가 자동으로 풀어 버리므로, 다시 보이는 순간 (visibilitychange · pageshow) 다시 잡습니다.
 *    - 잠금이 스스로 풀리면('release') 화면이 보이는 중이면 곧바로 다시 잡습니다.
 * ② 예비 방법 (API 가 없거나 거절될 때 — 옛 iOS · 일부 삼성/안드로이드 브라우저): 소리 · 화면 없는 아주 작은 동영상을 반복 재생합니다.
 *    브라우저는 "동영상이 재생 중"이면 화면을 끄지 않습니다 (NoSleep 방식). 동영상은 사용자가 화면을 누른 순간에만 시작할 수 있어서,
 *    처음 시작이 막히면 다음 터치 · 클릭 · 키 입력에서 다시 시도합니다.
 * 브라우저와 Node(시험) 양쪽에서 쓰는 파일입니다 — 브라우저 부분은 window 가 있을 때만 움직입니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNWake = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmJ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHabWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUVzdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAK/+EAF2dCwArZBCbARAAAAwAEAAADACg8SJkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAVwAAAFcAAAAAYc3R0cwAAAAAAAAABAAAABQAACAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAAo8AAAAKAAAACwAAAAoAAAAKAAAAFHN0Y28AAAAAAAAAAQAAA2gAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAACwG1kYXQAAAJwBgX//2zcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj01IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAF2WIhAR8mKAANiMnJyddddddddddddeAAAAABkGaOAj4RgAAAAdBmlQCPhGAAAAABkGaYBDwjAAAAAZBmoA/wjA=';
  var WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJKEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggI07AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYgbPDPCibsBzZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCBQLqBQJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYgbPDPCibsBzWfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVAj+eBAKOqgQAAgPACAJ0BKkAAQAAARwiFhYiFhIgCAgAGcDxCYAqyIPcwAP7/q1CAo5aBAMgA0QEAARAQABgAGFgv9AAIjoAAo5aBAZAA0QEAARAQABgAGFgv9AAIjoAAo5aBAlgA0QEAARAQABgAGFgv9AAIjoAAo5aBAyAA0QEAARAQABgAGFgv9AAIjoAAHFO7a5G7j7OBALeK94EB8YIBn/CBAw==';

  /** create({ win, onChange(state) }) → { acquire, release, state, destroy } — win 을 주입하면 시험할 수 있습니다 */
  function create(opt) {
    opt = opt || {};
    var win = opt.win || (typeof window !== 'undefined' ? window : null);
    var doc = win && win.document;
    var nav = win && win.navigator;
    var wanted = false, sentinel = null, video = null, mode = 'none', pending = false, destroyed = false, retryBound = false;

    function emit() { try { if (opt.onChange) opt.onChange(state()); } catch (e) { /* 무시 */ } }
    function state() { return { wanted: wanted, mode: mode, active: mode !== 'none', api: !!(nav && nav.wakeLock && nav.wakeLock.request), video: !!(video && !video.paused) }; }
    function visible() { return !doc || doc.visibilityState !== 'hidden'; }

    /* ---------- ② 예비: 아주 작은 동영상 ---------- */
    function ensureVideo() {
      if (video || !doc) return video;
      try {
        var v = doc.createElement('video');
        v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', ''); v.setAttribute('loop', ''); v.setAttribute('aria-hidden', 'true'); v.setAttribute('tabindex', '-1');
        v.muted = true; v.loop = true; v.playsInline = true;
        v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:-1;';
        var src1 = doc.createElement('source'); src1.src = MP4; src1.type = 'video/mp4';
        var src2 = doc.createElement('source'); src2.src = WEBM; src2.type = 'video/webm';
        v.appendChild(src1); v.appendChild(src2);
        doc.body.appendChild(v); video = v;
      } catch (e) { video = null; }
      return video;
    }
    function playVideo() {
      var v = ensureVideo(); if (!v) return false;
      try {
        var p = v.play();
        if (p && p.then) { p.then(function () { if (wanted && !sentinel) { mode = 'video'; emit(); } }, function () { bindRetry(); }); }
        else if (wanted && !sentinel) { mode = 'video'; emit(); }
        return true;
      } catch (e) { bindRetry(); return false; }
    }
    /** 사용자가 처음 화면을 눌러야 재생이 허락되는 브라우저 — 눌렀을 때 한 번 더 시도 */
    function retry() {
      if (destroyed || !wanted) { unbindRetry(); return; }
      if (!sentinel) { requestApi(true); }
      if (mode === 'none' || (mode === 'video' && video && video.paused)) playVideo();
      if (mode !== 'none') unbindRetry();
    }
    function bindRetry() {
      if (retryBound || !doc) return; retryBound = true;
      ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (n) { doc.addEventListener(n, retry, true); });
    }
    function unbindRetry() {
      if (!retryBound || !doc) return; retryBound = false;
      ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (n) { doc.removeEventListener(n, retry, true); });
    }

    /* ---------- ① Wake Lock API ---------- */
    function requestApi(fromRetry) {
      if (destroyed || !wanted || sentinel || pending || !visible()) return;
      if (!(nav && nav.wakeLock && nav.wakeLock.request)) { if (!fromRetry) playVideo(); return; }
      pending = true;
      var pr;
      try { pr = nav.wakeLock.request('screen'); } catch (e) { pending = false; playVideo(); return; }
      pr.then(function (l) {
        pending = false;
        if (destroyed || !wanted) { try { l.release(); } catch (e) { /* 무시 */ } return; }
        sentinel = l; mode = 'api';
        if (video) { try { video.pause(); } catch (e) { /* 무시 */ } }                     // API 가 되면 동영상은 필요 없음
        try { l.addEventListener('release', function () { if (sentinel === l) { sentinel = null; mode = 'none'; emit(); if (wanted && visible()) requestApi(); } }); } catch (e) { /* 무시 */ }
        emit();
      }, function () {
        pending = false;                                                              // 배터리 절약 모드 · 권한 거절 등 → 예비 방법
        if (wanted) { playVideo(); bindRetry(); }
      });
    }
    function onVisible() { if (wanted && visible()) { if (!sentinel) requestApi(); if (video && video.paused && mode !== 'api') playVideo(); } }
    if (doc) { doc.addEventListener('visibilitychange', onVisible); }
    if (win && win.addEventListener) { win.addEventListener('pageshow', onVisible); win.addEventListener('focus', onVisible); }

    function acquire() {
      if (destroyed) return state();
      wanted = true; requestApi(); emit(); return state();
    }
    function release() {
      wanted = false; unbindRetry();
      var l = sentinel; sentinel = null; mode = 'none';
      if (l) { try { l.release(); } catch (e) { /* 이미 풀림 */ } }
      if (video) { try { video.pause(); if (video.parentNode) video.parentNode.removeChild(video); } catch (e) { /* 무시 */ } video = null; }
      emit(); return state();
    }
    function destroy() {
      release(); destroyed = true;
      if (doc) doc.removeEventListener('visibilitychange', onVisible);
      if (win && win.removeEventListener) { win.removeEventListener('pageshow', onVisible); win.removeEventListener('focus', onVisible); }
    }
    return { acquire: acquire, release: release, state: state, destroy: destroy };
  }
  return { create: create };
}));
