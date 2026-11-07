/**
 * V13 녹음 듣기 화면 (/conti/listen) — 파형(눌러서 이동) · 속도 · 15초 앞뒤 · 재생 · 반복(지금 곡 / A-B 구간) · 곡별로 듣기(곡 시작 위치).
 * 곡 시작 위치 저장은 기존 /conti/recordings/marks 를 그대로 씁니다. 탭 전환(spa) 뒤에도 다시 붙도록 ph:content-updated 를 들음.
 */
(function () {
  var RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5];
  function fmt(t) { if (!isFinite(t) || t < 0) t = 0; t = Math.floor(t); var m = Math.floor(t / 60), s = t % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14"/><rect x="13.8" y="5" width="4.2" height="14"/></svg>';

  function init() {
    var root = document.querySelector('[data-ls13]');
    if (!root || root._ls) return;
    root._ls = true;
    var D; try { D = JSON.parse(root.getAttribute('data-ls13')); } catch (e) { return; }
    try { if (window.PHRec && window.PHRec.pause) window.PHRec.pause(); } catch (e) { /* 떠 있는 플레이어 없어도 됨 */ }
    var au = root.querySelector('[data-ls-audio]'), wave = root.querySelector('[data-ls-wave]');
    var tEl = root.querySelector('[data-ls-t]'), dEl = root.querySelector('[data-ls-d]'), abEl = root.querySelector('[data-ls-ab]');
    var nowEl = root.querySelector('[data-ls-now]'), posEl = root.querySelector('[data-ls-pos]'), msg = root.querySelector('[data-ls-msg]');
    var panel = root.querySelector('[data-ls-reppanel]'), songsBox = document.querySelector('[data-ls-songs]');
    var btn = function (n) { return root.querySelector('[data-ls="' + n + '"]'); };
    var rate = 1; try { rate = Number(localStorage.getItem('ph.ls.rate')) || 1; } catch (e) {}
    var A = null, B = null, songLoop = false, marks = (D.marks || []).slice().sort(function (a, b) { return a.t - b.t; });

    // 파형 — 실제 소리 대신 녹음마다 같은 모양(가벼움). 막대 48개
    var N = 48, seed = hash(D.id || D.src), bars = '';
    for (var i = 0; i < N; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; var hgt = 28 + (seed % 72); bars += '<i style="height:' + hgt + '%"></i>'; }
    wave.innerHTML = bars + '<b class="hd"></b><span class="abz"></span>';
    var barEls = wave.querySelectorAll('i'), head = wave.querySelector('.hd'), abz = wave.querySelector('.abz');

    function say(t) { if (msg) msg.textContent = t || ''; }
    function dur() { return au.duration && isFinite(au.duration) ? au.duration : 0; }
    function curMark(t) { var m = null; marks.forEach(function (x, n) { if (x.t <= t + 0.2) m = { i: n, m: x }; }); return m; }
    function segEnd(n) { return n + 1 < marks.length ? marks[n + 1].t : dur(); }
    function paint() {
      var d = dur(), t = au.currentTime || 0, p = d ? t / d : 0;
      tEl.textContent = fmt(t); dEl.textContent = fmt(d);
      var on = Math.round(p * N);
      for (var k = 0; k < N; k++) barEls[k].classList.toggle('on', k < on);
      head.style.left = (p * 100) + '%';
      wave.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      if (A != null && d) { abz.style.left = (A / d * 100) + '%'; abz.style.width = (((B != null ? B : d) - A) / d * 100) + '%'; abz.hidden = false; } else abz.hidden = true;
      abEl.textContent = songLoop ? '지금 곡 반복' : A != null ? 'A ' + fmt(A) + ' ~ ' + (B != null ? 'B ' + fmt(B) : '…') : '';
      var cm = curMark(t);
      if (cm && D.songs) {
        var sg = D.songs.filter(function (s) { return s.id === cm.m.id; })[0];
        nowEl.textContent = (sg && sg.k) || cm.m.k || D.title;
        if (posEl) posEl.textContent = (cm.i + 1) + ' / ' + marks.length + '곡 · ';
      }
      if (songsBox) songsBox.querySelectorAll('[data-ls-row]').forEach(function (r) { r.classList.toggle('on', !!cm && r.getAttribute('data-ls-row') === String(cm.m.id || cm.m.k)); });
    }
    function setRate(r) { rate = r; au.playbackRate = r; btn('rate').innerHTML = (r === 1 ? '1.0' : String(r)) + '<i>×</i>'; try { localStorage.setItem('ph.ls.rate', String(r)); } catch (e) {} }
    function play() { au.play().catch(function () { say('재생을 시작하지 못했어요. 한 번 더 눌러 주세요.'); }); }
    function seek(t) { var d = dur(); au.currentTime = Math.max(0, d ? Math.min(d - 0.2, t) : t); paint(); }

    au.addEventListener('loadedmetadata', function () { setRate(rate); paint(); });
    au.addEventListener('timeupdate', function () {
      var t = au.currentTime;
      if (songLoop) { var cm = curMark(t); if (cm && t >= segEnd(cm.i) - 0.15) seek(cm.m.t); }
      else if (A != null && B != null && t >= B) seek(A);
      paint();
    });
    au.addEventListener('play', function () { btn('play').innerHTML = PAUSE; btn('play').setAttribute('aria-label', '일시정지'); });
    au.addEventListener('pause', function () { btn('play').innerHTML = PLAY; btn('play').setAttribute('aria-label', '재생'); });
    au.addEventListener('ended', function () { if (A != null) { seek(A); play(); } });

    function wavePos(e) { var r = wave.getBoundingClientRect(); var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; return Math.max(0, Math.min(1, x / r.width)); }
    wave.addEventListener('click', function (e) { var d = dur(); if (d) seek(wavePos(e) * d); });
    wave.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') seek(au.currentTime - 5); if (e.key === 'ArrowRight') seek(au.currentTime + 5); });

    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ls]'); if (!b) return;
      var a = b.getAttribute('data-ls');
      if (a === 'play') { if (au.paused) play(); else au.pause(); }
      else if (a === 'back') seek(au.currentTime - 15);
      else if (a === 'fwd') seek(au.currentTime + 15);
      else if (a === 'rate') { var n = RATES.indexOf(rate); setRate(RATES[(n + 1) % RATES.length]); }
      else if (a === 'rep') { var open = panel.hidden; panel.hidden = !open; b.setAttribute('aria-expanded', String(open)); }
      else if (a === 'song') { if (!marks.length) { say('곡 시작 위치가 없어요 — 아래 "곡별로 듣기"에서 표시해 주세요.'); return; } songLoop = !songLoop; A = B = null; say(songLoop ? '지금 곡만 계속 반복해요.' : ''); }
      else if (a === 'a') { songLoop = false; A = au.currentTime; if (B != null && B <= A) B = null; say('구간 시작 ' + fmt(A) + ' — 끝나는 곳에서 "B 끝"을 눌러요.'); }
      else if (a === 'b') { if (A == null) A = 0; if (au.currentTime <= A + 0.5) { say('B(끝)는 A(시작)보다 뒤여야 해요.'); return; } B = au.currentTime; songLoop = false; say('구간 반복 중이에요.'); if (au.paused) { seek(A); play(); } }
      else if (a === 'clear') { A = B = null; songLoop = false; say('반복을 해제했어요.'); }
      btn('rep').classList.toggle('on', songLoop || A != null);
      paint();
    });

    // 곡별로 듣기
    function drawSongs() {
      if (!songsBox) return;
      var byId = {}; marks.forEach(function (m) { if (m.id && byId[m.id] == null) byId[m.id] = m.t; });
      var rows = (D.songs || []).map(function (s, n) { return { id: s.id, k: s.k, sub: [s.key, s.bpm].filter(Boolean).join(' · '), t: byId[s.id], n: n + 1 }; });
      marks.forEach(function (m) { if (!m.id || !(D.songs || []).some(function (s) { return s.id === m.id; })) rows.push({ id: m.id || m.k, k: m.k || '곡', sub: '', t: m.t, n: rows.length + 1 }); });
      songsBox.innerHTML = rows.map(function (r) {
        return '<div class="ls13-song" data-ls-row="' + esc(r.id) + '">' +
          '<button type="button" class="go"' + (r.t != null ? ' data-go="' + r.t + '"' : ' disabled') + '><span class="n">' + r.n + '</span><span class="m"><b>' + esc(r.k) + '</b><small>' + esc(r.sub) + '</small></span><span class="t' + (r.t != null ? '' : ' none') + '">' + (r.t != null ? fmt(r.t) : '위치 없음') + '</span></button>' +
          (D.edit ? '<button type="button" class="set" data-set="' + esc(r.id) + '" data-k="' + esc(r.k) + '">여기서 시작</button>' : '') + '</div>';
      }).join('') || '<p class="ls13-hint">이 주 콘티 곡이 없어요.</p>';
    }
    if (songsBox && !songsBox._ls) {
      songsBox._ls = true;
      songsBox.addEventListener('click', function (e) {
        var g = e.target.closest('[data-go]'); if (g) { seek(Number(g.getAttribute('data-go'))); if (au.paused) play(); return; }
        var s = e.target.closest('[data-set]'); if (!s) return;
        var id = s.getAttribute('data-set'), k = s.getAttribute('data-k');
        var rest = marks.filter(function (m) { return (m.id || m.k) !== id; });
        rest.push({ t: Math.round(au.currentTime * 10) / 10, id: (D.songs || []).some(function (x) { return x.id === id; }) ? id : '', k: k });
        rest.sort(function (a, b) { return a.t - b.t; });
        var prev = marks; marks = rest; drawSongs(); paint();
        fetch((window.PH_BASE || '') + '/conti/recordings/marks', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: D.team, id: D.id, marks: rest }) })
          .then(function (r) { return r.json(); }).then(function (d) { if (!d || !d.ok) throw new Error((d && d.error) || ''); marks = d.marks || rest; drawSongs(); paint(); })
          .catch(function (er) { marks = prev; drawSongs(); paint(); alertMsg((er && er.message) || '곡 위치를 저장하지 못했어요.'); });
      });
    }
    function alertMsg(t) { say(t); panel.hidden = false; }
    drawSongs();

    var share = document.querySelector('[data-ls="share"]');
    if (share && !share._ls) { share._ls = true; share.addEventListener('click', function () { var u = location.href; if (navigator.share) navigator.share({ title: D.title, url: u }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { share.querySelector('span').textContent = '링크 복사됨'; }); }); }
    setRate(rate); paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('ph:content-updated', init);
})();
