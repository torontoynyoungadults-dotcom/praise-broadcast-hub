/* 연습 화면 — 라이브 악보 보기 · 메트로놈. 같은 방(team+date)에 있는 모든 기기와 Socket.io로 실시간 동기화됩니다. */
(function () {
  var DATA = window.PV_DATA || { room: '', songs: [], sheets: [] };
  var state = { songIdx: 0, sheetId: null, metro: { bpm: 80, running: false, startedAt: 0 } };

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  var socket = (typeof io === 'function') ? io() : null;
  if (socket) {
    socket.on('connect', function () { socket.emit('join', DATA.room); });
    socket.on('state', function (s) { state = s; render(); syncMetro(); });
  }
  function send(patch) { if (socket) socket.emit('update', patch); }

  function render() {
    var tabs = document.getElementById('pv-songtabs');
    if (!DATA.songs.length) {
      tabs.innerHTML = '<p class="ph-sub">오늘 등록된 곡이 없어요. 예배콘티에서 먼저 곡을 추가해주세요.</p>';
    } else {
      tabs.innerHTML = DATA.songs.map(function (s, i) {
        return '<button type="button" class="pv-tab' + (i === state.songIdx ? ' on' : '') + '" data-i="' + i + '">' + esc(s.title) + '</button>';
      }).join('');
      Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
        b.onclick = function () { send({ songIdx: Number(b.dataset.i), sheetId: null }); };
      });
    }

    var stage = document.getElementById('pv-stage');
    var sheet = state.sheetId ? DATA.sheets.filter(function (x) { return x.id === state.sheetId; })[0] : null;
    if (sheet) {
      var isImg = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(sheet.link) || /drive\.google\.com\/uc/.test(sheet.link);
      stage.innerHTML = isImg
        ? '<img class="pv-sheetimg" src="' + sheet.link + '" alt="' + esc(sheet.title) + '">'
        : '<a class="ph-btn pri" href="' + sheet.link + '" target="_blank" rel="noopener">📄 ' + esc(sheet.title) + ' 열기</a>';
    } else {
      var s = DATA.songs[state.songIdx];
      stage.innerHTML = s
        ? '<div class="pv-songinfo"><div class="pv-songtitle">' + esc(s.title) + '</div>'
          + '<div class="pv-songmeta">' + [s.key && ('Key ' + s.key), s.bpm && (s.bpm + ' BPM')].filter(Boolean).map(esc).join(' · ') + '</div>'
          + (s.youtube ? '<a class="ph-li-link" href="' + esc(s.youtube) + '" target="_blank" rel="noopener">▶ 유튜브</a>' : '')
          + (s.note ? '<div class="ph-li-note">' + esc(s.note) + '</div>' : '') + '</div>'
        : '<p class="ph-sub">곡을 추가하면 여기 보여요.</p>';
    }

    var picker = document.getElementById('pv-sheetpicker');
    picker.innerHTML = DATA.sheets.length
      ? '<div class="pv-sheetlist">' + DATA.sheets.map(function (s) {
        return '<button type="button" class="pv-sheetbtn' + (state.sheetId === s.id ? ' on' : '') + '" data-id="' + s.id + '">📄 ' + esc(s.title) + '</button>';
      }).join('') + (state.sheetId ? '<button type="button" class="pv-sheetbtn" id="pv-sheetclose">✕ 악보 닫기</button>' : '') + '</div>'
      : '';
    Array.prototype.forEach.call(picker.querySelectorAll('.pv-sheetbtn[data-id]'), function (b) {
      b.onclick = function () { send({ sheetId: b.dataset.id }); };
    });
    var closeBtn = document.getElementById('pv-sheetclose');
    if (closeBtn) closeBtn.onclick = function () { send({ sheetId: null }); };

    document.getElementById('pv-bpmnum').textContent = state.metro.bpm;
    document.getElementById('pv-startstop').textContent = state.metro.running ? '■ 정지' : '▶ 시작';
  }

  /* ---------- 메트로놈 소리 + 박자 표시 ---------- */
  var audioCtx = null;
  function actx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
  function clickSound(strong) {
    var ac = actx();
    var o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = strong ? 1400 : 1000;
    o.connect(g); g.connect(ac.destination);
    var t = ac.currentTime;
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.start(t); o.stop(t + 0.08);
  }

  var beatTimer = null;
  function syncMetro() {
    if (beatTimer) { clearTimeout(beatTimer); clearInterval(beatTimer); beatTimer = null; }
    var beatEl = document.getElementById('pv-beat');
    if (!state.metro.running || !state.metro.bpm) { if (beatEl) beatEl.classList.remove('on'); return; }
    var interval = 60000 / state.metro.bpm;
    var elapsed = Date.now() - state.metro.startedAt;
    var nextBeatIdx = Math.max(0, Math.ceil(elapsed / interval));
    function fire() {
      clickSound(nextBeatIdx % 4 === 0);
      if (beatEl) { beatEl.classList.add('on'); setTimeout(function () { beatEl.classList.remove('on'); }, 90); }
      nextBeatIdx++;
    }
    var delay = Math.max(0, (nextBeatIdx * interval) - elapsed);
    beatTimer = setTimeout(function () {
      fire();
      beatTimer = setInterval(fire, interval);
    }, delay);
  }

  document.getElementById('pv-bpmup').onclick = function () { send({ metro: { bpm: Math.min(240, (state.metro.bpm || 80) + 1) } }); };
  document.getElementById('pv-bpmdown').onclick = function () { send({ metro: { bpm: Math.max(30, (state.metro.bpm || 80) - 1) } }); };
  document.getElementById('pv-startstop').onclick = function () {
    if (state.metro.running) send({ metro: { running: false } });
    else send({ metro: { running: true, startedAt: Date.now() } });
  };
  var taps = [];
  document.getElementById('pv-tap').onclick = function () {
    var now = Date.now();
    taps = taps.filter(function (t) { return now - t < 2000; });
    taps.push(now);
    if (taps.length >= 2) {
      var intervals = [];
      for (var i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      var avg = intervals.reduce(function (a, b) { return a + b; }, 0) / intervals.length;
      send({ metro: { bpm: Math.max(30, Math.min(240, Math.round(60000 / avg))) } });
    }
  };

  render();
})();
