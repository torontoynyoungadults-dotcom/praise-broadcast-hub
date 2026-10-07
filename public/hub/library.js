/* church-app public/worship/library.js 그대로 (떠 있는 창을 .yn 안에 띄우도록 3곳만 고침 — tools/port-church-hub.js) */
/* 찬양방송팀 허브 v6.9 — "라이브러리" 탭 메뉴 + 녹음 플레이어(YNPlayer)
 *  · 통계 · 아카이브 · 악보 Repository 는 한 탭("라이브러리") 안의 줄 메뉴로 전환합니다 (데이터 · 서버 함수는 그대로).
 *  · YNPlayer — 화면 아래에 붙는 음악 재생 도구: 재생/멈춤 · 15초 뒤로/앞으로 · 이전/다음 곡 · 속도(음높이 유지) · A-B 구간 반복 · 소리 크기.
 *    한 번에 한 곡만 재생되고, 화면을 다시 그리거나 탭을 옮겨도 끊기지 않습니다 (잠금 화면 · 이어폰 단추도 지원). */

/* ================= 라이브러리 줄 메뉴 ================= */
var LIB_VIEWS = [
  ['repo', null, '곡 · 악보', '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'],
  ['archive', 'date', '날짜별', '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'],
  ['archive', 'file', '악보 파일', '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'],
  ['archive', 'rec', '녹음', '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'],
  ['stats', null, '통계', '<path d="M5 20V10M12 20V4M19 20v-7"/>']
];
function libOn(v) { return TAB === v[0] && (v[1] === null || (AR && AR.view === v[1])); }
function libNav() {
  return '<div class="libnav" role="tablist" aria-label="라이브러리">' + LIB_VIEWS.map(function (v, i) {
    return '<button type="button" role="tab" class="' + (libOn(v) ? 'on' : '') + '" aria-selected="' + (libOn(v) ? 'true' : 'false') + '" onclick="libGo(' + i + ')">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + v[3] + '</svg><span>' + v[2] + '</span></button>';
  }).join('') + '</div>';
}
function libGo(i) {
  var v = LIB_VIEWS[i];
  if (v[1]) { AR.view = v[1]; AR.more = 30; }
  tab(v[0]);
}

/* ================= 녹음 플레이어 ================= */
var YNPlayer = (function () {
  var a = new Audio(), cur = null, queue = [], qi = -1, dock = null, A = null, B = null, seeking = false;
  var RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
  var rate = 1; try { rate = parseFloat(localStorage.getItem('ynRate')) || 1; } catch (e) {}
  a.preload = 'metadata';
  function keepPitch() { try { a.preservesPitch = true; a.webkitPreservesPitch = true; a.mozPreservesPitch = true; } catch (e) {} }
  function t(s) { if (!isFinite(s) || s < 0) s = 0; s = Math.floor(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function $(id) { return document.getElementById(id); }
  var ICO = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5h4.5"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 6.2v11.6a.8.8 0 0 1-1.3.6L10.4 12.6a.8.8 0 0 1 0-1.2l8.3-5.8a.8.8 0 0 1 1.3.6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 6.2v11.6a.8.8 0 0 0 1.3.6l8.3-5.8a.8.8 0 0 0 0-1.2L5.3 5.6A.8.8 0 0 0 4 6.2z"/></svg>'
  };
  function build() {
    if (dock) return dock;
    dock = document.createElement('div');
    dock.className = 'plr'; dock.id = 'plr'; dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', '녹음 플레이어');
    dock.innerHTML =
      '<div class="plr-top"><div class="plr-cover" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
        '<div class="plr-t"><b id="plrT"></b><span id="plrS"></span></div>' +
        '<a class="plr-open" id="plrO" target="_blank" rel="noopener" title="드라이브에서 열기">↗</a>' +
        '<button type="button" class="plr-x" aria-label="닫기" onclick="YNPlayer.close()">✕</button></div>' +
      '<div class="plr-seek"><span id="plrC">0:00</span><input type="range" id="plrR" min="0" max="1000" step="1" value="0" aria-label="재생 위치"><span id="plrD">-:--</span></div>' +
      '<div class="plr-ctl">' +
        '<button type="button" class="plr-b sm" id="plrP" aria-label="이전 곡" onclick="YNPlayer.step(-1)">' + ICO.prev + '</button>' +
        '<button type="button" class="plr-b" aria-label="15초 뒤로" onclick="YNPlayer.skip(-15)">' + ICO.back + '<em>15</em></button>' +
        '<button type="button" class="plr-b main" id="plrPP" aria-label="재생" onclick="YNPlayer.toggle()">' + ICO.play + '</button>' +
        '<button type="button" class="plr-b" aria-label="15초 앞으로" onclick="YNPlayer.skip(15)">' + ICO.fwd + '<em>15</em></button>' +
        '<button type="button" class="plr-b sm" id="plrN" aria-label="다음 곡" onclick="YNPlayer.step(1)">' + ICO.next + '</button></div>' +
      '<div class="plr-opt"><div class="plr-spd" id="plrSp" role="group" aria-label="재생 속도"></div>' +
        '<button type="button" class="plr-ab" id="plrAB" onclick="YNPlayer.ab()">A–B 반복</button>' +
        '<label class="plr-vol" title="소리 크기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/></svg><input type="range" id="plrV" min="0" max="100" value="100" aria-label="소리 크기"></label></div>' +
      '<p class="plr-err" id="plrE" hidden></p>';
    ynPortal().appendChild(dock);
    $('plrR').addEventListener('input', function () { seeking = true; $('plrC').textContent = t(this.value / 1000 * (a.duration || 0)); paintSeek(this.value / 1000); });
    $('plrR').addEventListener('change', function () { if (a.duration) a.currentTime = this.value / 1000 * a.duration; seeking = false; });
    $('plrV').addEventListener('input', function () { a.volume = this.value / 100; });
    paintRates();
    return dock;
  }
  function paintRates() {
    var sp = $('plrSp'); if (!sp) return;
    sp.innerHTML = [0.75, 1, 1.25, 1.5].map(function (r) { return '<button type="button" class="' + (rate === r ? 'on' : '') + '" onclick="YNPlayer.setRate(' + r + ')">' + r + '×</button>'; }).join('') +
      '<select aria-label="속도 더 고르기" onchange="YNPlayer.setRate(parseFloat(this.value))">' + RATES.map(function (r) { return '<option value="' + r + '"' + (rate === r ? ' selected' : '') + '>' + r + '×</option>'; }).join('') + '</select>';
  }
  function paintSeek(p) { var r = $('plrR'); if (r) r.style.setProperty('--p', (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%'); }
  function paintPlay() { var b = $('plrPP'); if (dock) dock.classList.toggle('playing', !a.paused); if (!b) return; b.innerHTML = a.paused ? ICO.play : ICO.pause; b.setAttribute('aria-label', a.paused ? '재생' : '멈춤'); mark(); }
  function paintAB() {
    var b = $('plrAB'); if (!b) return;
    b.classList.toggle('on', A !== null);
    b.textContent = A === null ? 'A–B 반복' : (B === null ? 'A ' + t(A) + ' → 끝 지점 찍기' : 'A ' + t(A) + ' – B ' + t(B) + ' ✕');
  }
  function mark() {
    if (ph()) { markPH(ph().current(), ph().playing()); return; }
    var src = cur && cur.src;
    Array.prototype.forEach.call(document.querySelectorAll('.rec[data-src]'), function (n) {
      var on = !!src && n.getAttribute('data-src') === src;
      n.classList.toggle('playing', on && !a.paused);
      n.classList.toggle('cued', on);
      var pb = n.querySelector('.rec-play'); if (pb) pb.innerHTML = (on && !a.paused ? ICO.pause + '<span>멈춤</span>' : ICO.play + '<span>' + (on ? '이어서' : '재생') + '</span>');
    });
  }
  function load(item) {
    build(); cur = item; A = B = null; paintAB();
    $('plrT').textContent = item.title || '녹음'; $('plrS').textContent = item.sub || '';
    var o = $('plrO'); o.href = item.open || '#'; o.style.display = item.open ? '' : 'none';
    $('plrE').hidden = true;
    dock.classList.add('on'); ynRoot().classList.add('plr-on');
    a.src = item.src; a.playbackRate = rate; keepPitch();
    $('plrR').value = 0; paintSeek(0); $('plrC').textContent = '0:00'; $('plrD').textContent = '-:--';
    $('plrP').disabled = qi <= 0; $('plrN').disabled = qi < 0 || qi >= queue.length - 1;
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: item.title || '녹음', artist: item.sub || '찬양방송팀', album: '청년1부 찬양팀' });
        navigator.mediaSession.setActionHandler('play', function () { a.play(); });
        navigator.mediaSession.setActionHandler('pause', function () { a.pause(); });
        navigator.mediaSession.setActionHandler('seekbackward', function () { skip(-15); });
        navigator.mediaSession.setActionHandler('seekforward', function () { skip(15); });
        navigator.mediaSession.setActionHandler('previoustrack', qi > 0 ? function () { step(-1); } : null);
        navigator.mediaSession.setActionHandler('nexttrack', qi >= 0 && qi < queue.length - 1 ? function () { step(1); } : null);
      }
    } catch (e) {}
    var p = a.play(); if (p && p.catch) p.catch(function () { paintPlay(); });
  }
  function itemOf(n) {
    return { src: n.getAttribute('data-src'), title: n.getAttribute('data-title'), sub: n.getAttribute('data-sub'), open: n.getAttribute('data-open') };
  }
  /* 앱의 떠 있는 플레이어(public/js/recplayer.js · window.PHRec)가 있으면 그걸로 — 끌어서 옮기고, 다른 화면으로 가도 이어서 들음 */
  function ph() { return window.PHRec || null; }
  function markPH(src, playing) {
    Array.prototype.forEach.call(document.querySelectorAll('.rec[data-src]'), function (n) {
      var on = !!src && n.getAttribute('data-src') === src;
      n.classList.toggle('playing', on && playing); n.classList.toggle('cued', on);
      var pb = n.querySelector('.rec-play'); if (pb) pb.innerHTML = (on && playing ? ICO.pause + '<span>멈춤</span>' : ICO.play + '<span>' + (on ? '이어서' : '재생') + '</span>');
    });
  }
  document.addEventListener('ph:rec', function (e) { if (ph()) markPH(e.detail && e.detail.src, e.detail && e.detail.playing); });
  function playFrom(btn) {
    var card = btn.closest('.rec'); if (!card) return;
    if (ph()) {
      var s0 = card.getAttribute('data-src');
      if (ph().current() === s0) { ph().toggle(); return; }
      var sc = card.closest('.panel') || document, ns = Array.prototype.slice.call(sc.querySelectorAll('.rec[data-src]'));
      ph().play(ns.map(function (n) { return { src: n.getAttribute('data-src'), title: n.getAttribute('data-title') || '녹음', by: n.getAttribute('data-sub') || '' }; }), ns.indexOf(card));
      return;
    }
    var src = card.getAttribute('data-src');
    if (cur && cur.src === src) { toggle(); return; }
    var scope = card.closest('.panel') || document;
    var nodes = Array.prototype.slice.call(scope.querySelectorAll('.rec[data-src]'));
    queue = nodes.map(itemOf); qi = nodes.indexOf(card);
    load(queue[qi]);
  }
  function toggle() { if (!cur) return; if (a.paused) { var p = a.play(); if (p && p.catch) p.catch(function () {}); } else a.pause(); }
  function skip(n) { if (!cur) return; var d = a.duration || 0; a.currentTime = Math.max(0, Math.min(d || 1e9, a.currentTime + n)); }
  function step(n) { var i = qi + n; if (i < 0 || i >= queue.length) return; qi = i; load(queue[i]); }
  function setRate(r) { rate = r; a.playbackRate = r; keepPitch(); try { localStorage.setItem('ynRate', String(r)); } catch (e) {} paintRates(); }
  function ab() {
    if (!cur) return;
    if (A === null) A = a.currentTime; else if (B === null) { B = a.currentTime; if (B <= A + 0.5) { B = null; return; } a.currentTime = A; } else { A = B = null; }
    paintAB();
  }
  function close() { a.pause(); a.removeAttribute('src'); try { a.load(); } catch (e) {} cur = null; queue = []; qi = -1; if (dock) dock.classList.remove('on'); ynRoot().classList.remove('plr-on'); mark(); }
  a.addEventListener('play', paintPlay); a.addEventListener('pause', paintPlay);
  a.addEventListener('loadedmetadata', function () { var d = $('plrD'); if (d) d.textContent = t(a.duration); });
  a.addEventListener('timeupdate', function () {
    if (B !== null && a.currentTime >= B) { a.currentTime = A; return; }
    if (seeking || !a.duration) return;
    var p = a.currentTime / a.duration; $('plrR').value = Math.round(p * 1000); paintSeek(p); $('plrC').textContent = t(a.currentTime);
  });
  a.addEventListener('ended', function () { if (qi >= 0 && qi < queue.length - 1) step(1); else paintPlay(); });
  a.addEventListener('error', function () {
    var e = $('plrE'); if (!e || !cur) return;
    e.hidden = false; e.innerHTML = '이 파일은 여기서 바로 재생되지 않습니다. ' + (cur.open ? '오른쪽 위 ↗ 로 드라이브에서 열어 들어주세요.' : '');
  });
  return { playFrom: playFrom, toggle: toggle, skip: skip, step: step, setRate: setRate, ab: ab, close: close, mark: mark };
})();
