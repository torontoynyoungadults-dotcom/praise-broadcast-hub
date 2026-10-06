/**
 * 예배콘티 화면의 세 가지 보조 도구를 붙입니다(church-app의 conti.js / formb.js 자리):
 *  1) 송폼 빌더 — [data-ph-sfb-host] 빈 칸에 YNForm.mount()로 칩 빌더를 그려 넣고,
 *     바뀔 때마다 짝이 되는 숨은 input[name="송폼"]에 저장 문자열을 반영합니다.
 *  2) 유튜브 — "유튜브에서 찾기"를 누르면 새 창이 아니라 입력칸 바로 밑에 검색 결과가 펼쳐지고, 미리보기 후 "선택" 하면 링크가 들어갑니다 ([data-cn-yt]).
 *     링크를 붙여 넣으면 제목 · 채널을 보여 주고 미리보기도 됩니다.
 *     그 밖에: 이전 콘티 가져오기([data-cn-import]) · 설교 후 찬양 "마지막 곡과 같아요"([data-cn-same]) · 카카오톡 콘티 요약 복사([data-cn-kakao]) · 오프라인용 다운로드 패널([data-cn-offopen]).
 *  3) @태그 칩 — [data-attag] 를 누르면 같은 폼의 textarea[name="비고"] 에 "@이름"을 끼워 넣습니다.
 * SPA 조각 교체(ph:content-updated) 후에도 다시 불러서 새로 들어온 칸에 붙습니다.
 */
(function () {
  function mountFormBuilders(root) {
    if (!window.YNForm) return;
    var hosts = root.querySelectorAll('[data-ph-sfb-host]:not([data-ph-sfb-on])');
    hosts.forEach(function (host) {
      host.setAttribute('data-ph-sfb-on', '1');
      var inputId = host.getAttribute('data-ph-sfb-input');
      var input = inputId ? document.getElementById(inputId) : null;
      if (!input) return;
      window.YNForm.mount(host, {
        value: input.value,
        onChange: function (str) {
          input.value = str;
          try { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        },
      });
    });
  }

  function wireAtTags(root) {
    root.querySelectorAll('[data-attag]:not([data-attag-on])').forEach(function (btn) {
      btn.setAttribute('data-attag-on', '1');
      btn.addEventListener('click', function () {
        var form = btn.closest('form');
        var note = form ? form.querySelector('textarea[name="비고"]') : null;
        if (!note) return;
        var tag = btn.getAttribute('data-attag');
        var v = note.value, s = note.selectionStart == null ? v.length : note.selectionStart, en = note.selectionEnd == null ? s : note.selectionEnd;
        var before = v.slice(0, s), sp = before && !/\s$/.test(before) ? ' ' : '';
        note.value = before + sp + tag + ' ' + v.slice(en);
        var pos = (before + sp + tag + ' ').length;
        note.focus();
        try { note.setSelectionRange(pos, pos); } catch (e) {}
        try { note.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      });
    });
  }

  /** @태그가 지금 누구를 가리키는지 설명 칸 아래에 미리 보여줍니다 (church-app conti.js의 mountMentions 자리) */
  function wireAtTagPreview(root) {
    root.querySelectorAll('[data-ph-attags]:not([data-ph-attagprev-on])').forEach(function (box) {
      box.setAttribute('data-ph-attagprev-on', '1');
      var form = box.closest('form');
      var note = form ? form.querySelector('textarea[name="비고"]') : null;
      var pv = box.querySelector('[data-ph-attag-preview]');
      if (!note || !pv) return;
      var slots = {}, roster = [];
      try { slots = JSON.parse(box.getAttribute('data-ph-attag-slots') || '{}'); } catch (e) {}
      try { roster = JSON.parse(box.getAttribute('data-ph-attag-roster') || '[]'); } catch (e) {}
      function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
      function resolve(raw) {
        var low = raw.toLowerCase(), best = null;
        Object.keys(slots).forEach(function (pos) {
          var pl = pos.toLowerCase();
          if (pl.length >= 1 && low.indexOf(pl) === 0 && (!best || pl.length > best.len)) best = { len: pl.length, kind: 'pos', names: slots[pos], label: pos };
        });
        roster.forEach(function (n) {
          var nl = String(n).toLowerCase();
          if (nl.length >= 2 && low.indexOf(nl) === 0 && (!best || nl.length >= best.len)) best = { len: nl.length, kind: 'name', names: [n], label: n };
        });
        return best;
      }
      function render() {
        var re = /(^|[^A-Za-z0-9_])@([A-Za-z0-9가-힣_]+)/g, m, seen = {}, rows = [];
        var text = note.value;
        while ((m = re.exec(text))) {
          var raw = m[2], d = resolve(raw);
          var tag = '@' + raw.slice(0, d ? d.len : raw.length);
          if (seen[tag]) continue; seen[tag] = 1;
          if (!d) { rows.push('<div class="cn-pv"><span class="cn-mt cn-mt-none">' + esc(tag) + '</span> <span class="cn-warn">알 수 없는 태그 — 자리(@일렉) 또는 팀원 이름을 써 주세요</span></div>'); continue; }
          var names = (d.names || []).filter(Boolean);
          rows.push('<div class="cn-pv"><span class="cn-mt ' + (d.kind === 'name' ? 'cn-mt-name' : 'cn-mt-v') + '">' + esc(tag) + '</span> ' +
            (names.length ? '→ ' + esc(names.join(', ')) : '<span class="cn-warn">이번 주 편성에 배정된 사람이 없어요</span>') + '</div>');
        }
        pv.innerHTML = rows.join('');
      }
      note.addEventListener('input', render);
      render();
    });
  }

  /* ================================================================ 공통 */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fire(el, type) { try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) {} }
  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.text().then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error('응답을 읽지 못했습니다.'); } });
    });
  }

  /* ================================================================ 유튜브 — 입력칸 바로 밑에 펼쳐지는 검색 · 미리보기 · 선택 */
  var YT_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})/i;
  function ytId(s) {
    s = String(s || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    var m = YT_RE.exec(s); return m ? m[1] : '';
  }
  function fmtDur(sec) {
    sec = Number(sec) || 0; if (!sec) return '';
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') + m : m) + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtViews(n) {
    n = Number(n) || 0; if (!n) return '';
    if (n >= 10000) return '조회수 ' + (n >= 100000 ? Math.round(n / 10000) : (Math.round(n / 1000) / 10)) + '만';
    return '조회수 ' + n.toLocaleString('ko-KR');
  }
  function embed(id) {
    return '<div class="cn-ytembed"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(id) + '?autoplay=1&rel=0&playsinline=1" title="유튜브 미리보기" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
  }
  /** 같은 화면에서 한 번에 한 영상만 미리보기 (다른 것을 켜면 앞의 것은 썸네일로 되돌림) */
  function stopPreviews(except) {
    $$('.cn-ytembed').forEach(function (e) {
      var host = e.parentNode; if (!host || host === except) return;
      if (host.classList.contains('cn-ytcard')) { var th = host.querySelector('.cn-ytthumb'); if (th) th.hidden = false; }
      e.remove();
    });
  }
  function ytCtx(el) {
    var box = el.closest('[data-cn-yt]'); if (!box) return null;
    return { box: box, input: $('[data-cn-ytlink]', box), pick: $('[data-cn-ytpick]', box), panel: $('[data-cn-ytpanel]', box), btn: $('[data-cn-ytopen]', box), form: box.closest('form') };
  }
  function ytQueryOf(c) {
    var f = c.form || document;
    var t = $('input[name="제목"]', f), tm = $('input[name="팀"]', f);
    return [t && t.value.trim(), tm && tm.value.trim()].filter(Boolean).join(' ');
  }
  /** 고른(또는 붙여 넣은) 영상 한 줄 — 썸네일 · 제목 · 채널 · 미리보기 / 지우기 */
  function renderPick(c, id, meta) {
    if (!c.pick) return;
    if (!id) { c.pick.innerHTML = ''; return; }
    meta = meta || {};
    c.pick.setAttribute('data-id', id);
    c.pick.innerHTML = '<div class="cn-ytsel"><button type="button" class="cn-ytthumb sm" data-cn-ytselprev aria-label="미리보기"><img src="https://i.ytimg.com/vi/' + esc(id) + '/mqdefault.jpg" alt="" loading="lazy"><span class="cn-ytplay">▶</span></button>' +
      '<div class="cn-ytinfo"><b>' + esc(meta.title || '선택한 영상') + '</b><span>' + esc(meta.channel || 'youtu.be/' + id) + '</span>' +
      '<div class="cn-ytact"><button type="button" class="cn-mini" data-cn-ytselprev>미리보기</button><button type="button" class="cn-mini" data-cn-ytclear>링크 지우기</button></div></div></div>';
  }
  var infoTimers = [];
  function syncPick(c, force) {
    var id = ytId(c.input.value);
    if (!id) { if (force || c.pick.getAttribute('data-id')) { c.pick.removeAttribute('data-id'); renderPick(c, ''); } return; }
    if (c.pick.getAttribute('data-id') === id && !force) return;
    renderPick(c, id, null);
    var tm = infoTimers.indexOf(c.input); if (tm >= 0) clearTimeout(infoTimers[tm + 1]);
    var t = setTimeout(function () {
      getJson('/conti/youtube/info?url=' + encodeURIComponent('https://youtu.be/' + id)).then(function (d) {
        if (d && d.title && c.pick.getAttribute('data-id') === id) { var open = c.pick.querySelector('.cn-ytembed'); renderPick(c, id, d); if (open) { var th = c.pick.querySelector('.cn-ytsel'); if (th) th.insertAdjacentHTML('afterend', embed(id)); } }
      }).catch(function () {});
    }, 450);
    if (tm >= 0) infoTimers[tm + 1] = t; else infoTimers.push(c.input, t);
  }
  function ytCard(it) {
    var meta = [it.channel, fmtViews(it.views), it.at].filter(Boolean).join(' · ');
    return '<div class="cn-ytcard" data-id="' + esc(it.id) + '" data-title="' + esc(it.title) + '" data-channel="' + esc(it.channel || '') + '">' +
      '<button type="button" class="cn-ytthumb" data-cn-ytprev aria-label="미리보기"><img src="' + esc(it.thumb || ('https://i.ytimg.com/vi/' + it.id + '/mqdefault.jpg')) + '" alt="" loading="lazy">' +
      (it.dur ? '<span class="cn-ytdur">' + fmtDur(it.dur) + '</span>' : '') + '<span class="cn-ytplay">▶</span></button>' +
      '<div class="cn-ytinfo"><b>' + esc(it.title) + '</b><span>' + esc(meta) + '</span>' +
      '<div class="cn-ytact"><button type="button" class="cn-mini" data-cn-ytprev>미리보기</button><button type="button" class="cn-mini pri" data-cn-ytuse>선택</button></div></div></div>';
  }
  function ytSearch(c, more) {
    var panel = c.panel, q = ($('[data-cn-ytq]', panel).value || '').trim(), res = $('[data-cn-ytres]', panel);
    if (!q) { res.innerHTML = '<p class="cn-ytmsg">검색어를 입력해 주세요.</p>'; return; }
    var token = more ? (panel.getAttribute('data-next') || '') : '';
    var seq = String(Date.now()); panel.setAttribute('data-seq', seq);
    if (!more) { res.innerHTML = '<p class="cn-ytmsg">찾는 중…</p>'; panel.removeAttribute('data-next'); }
    else { var mb = $('[data-cn-ytmore]', res); if (mb) { mb.disabled = true; mb.textContent = '불러오는 중…'; } }
    getJson('/conti/youtube?q=' + encodeURIComponent(q) + (token ? '&page=' + encodeURIComponent(token) : '')).then(function (d) {
      if (panel.getAttribute('data-seq') !== seq) return;                                   // 더 새 검색이 있음
      var out = $('.cn-ytlist', res), moreBtn = $('[data-cn-ytmore]', res);
      if (!d || !d.ok) {
        res.innerHTML = '<p class="cn-ytmsg">' + esc((d && d.msg) || '검색하지 못했습니다.') + '</p>' + (d && d.openUrl ? '<a class="cn-mini" href="' + esc(d.openUrl) + '" target="_blank" rel="noopener">유튜브에서 직접 찾기</a>' : '');
        return;
      }
      if (!more || !out) { res.innerHTML = '<div class="cn-ytlist"></div>'; out = $('.cn-ytlist', res); }
      else if (moreBtn) moreBtn.remove();
      if (!d.items.length && !more) { res.innerHTML = '<p class="cn-ytmsg">검색 결과가 없어요. 다른 말로 찾아보세요.</p>'; return; }
      out.insertAdjacentHTML('beforeend', d.items.map(ytCard).join(''));
      if (d.next) { panel.setAttribute('data-next', d.next); res.insertAdjacentHTML('beforeend', '<button type="button" class="cn-mini cn-ytmoreb" data-cn-ytmore>더 보기</button>'); }
      else panel.removeAttribute('data-next');
    }).catch(function () {
      if (panel.getAttribute('data-seq') !== seq) return;
      res.innerHTML = '<p class="cn-ytmsg">' + (navigator.onLine === false ? '인터넷 연결을 확인해 주세요.' : '검색하지 못했습니다. 잠시 뒤 다시 해 주세요.') + '</p>';
    });
  }
  function ytOpen(c) {
    var p = c.panel; if (!p) return;
    if (!p.hidden) { p.hidden = true; c.btn.setAttribute('aria-expanded', 'false'); stopPreviews(); return; }
    if (!p.getAttribute('data-built')) {
      p.setAttribute('data-built', '1');
      p.innerHTML = '<div class="cn-ytbar"><input type="search" data-cn-ytq placeholder="곡 제목 · 가수로 검색" autocomplete="off" enterkeyhint="search"><button type="button" class="cn-mini pri" data-cn-ytgo>검색</button></div>' +
        '<div class="cn-ytres" data-cn-ytres></div>' +
        '<div class="cn-ytfoot"><a class="cn-ytout" data-cn-ytout href="https://www.youtube.com/" target="_blank" rel="noopener">유튜브에서 직접 열기</a><button type="button" class="cn-mini" data-cn-ytclose>닫기</button></div>';
    }
    var q = $('[data-cn-ytq]', p);
    var url = ytQueryOf(c);
    if (url && (!q.value || q.getAttribute('data-auto') === '1')) { q.value = url; q.setAttribute('data-auto', '1'); }
    p.hidden = false; c.btn.setAttribute('aria-expanded', 'true');
    if (q.value.trim() && !$('.cn-ytcard', p)) ytSearch(c, false);
    else if (!q.value.trim()) { try { q.focus(); } catch (e) {} }
  }
  function ytUse(c, card) {
    var id = card.getAttribute('data-id');
    c.input.value = 'https://youtu.be/' + id; fire(c.input, 'input'); fire(c.input, 'change');
    c.pick.setAttribute('data-id', id);
    renderPick(c, id, { title: card.getAttribute('data-title'), channel: card.getAttribute('data-channel') });
    c.panel.hidden = true; c.btn.setAttribute('aria-expanded', 'false'); stopPreviews();
  }

  /* ================================================================ 이전 콘티에서 가져오기 */
  var norm = function (t) { return String(t || '').toLowerCase().replace(/[\s\-_.·,!?'"()\[\]]/g, ''); };
  function importState(box) {
    if (box.__cn) return box.__cn;
    var data = []; try { data = JSON.parse(($('script[data-cn-idata]', box) || {}).textContent || '[]'); } catch (e) {}
    return (box.__cn = { data: data, picked: {} });
  }
  function importCount(box) {
    var ids = {}; $$('.cn-ihist input[name="곡"]:checked', box).forEach(function (i) { ids[i.value] = 1; });
    $$('.cn-ifound input[name="곡"]:checked', box).forEach(function (i) { ids[i.value] = 1; });
    var n = Object.keys(ids).length, btn = $('button[type="submit"]', box);
    if (btn) { if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent); btn.textContent = n ? n + '곡 가져오기' : btn.getAttribute('data-label'); btn.disabled = !n; }
  }
  function importSearch(box) {
    var st = importState(box), q = norm($('[data-cn-isearch]', box).value), hist = $('[data-cn-ihist]', box), found = $('[data-cn-ifound]', box);
    if (!q) { hist.hidden = false; found.hidden = true; found.innerHTML = ''; importCount(box); return; }
    hist.hidden = true; found.hidden = false;
    var hits = st.data.filter(function (s) { return norm(s.t + s.tm).indexOf(q) >= 0; }).slice(0, 40);
    found.innerHTML = hits.length ? hits.map(function (s) {
      var m = [s.k, s.b && s.b + 'BPM', s.tm].filter(Boolean).join(' · ');
      return '<label class="cn-ichk"><input type="checkbox" name="곡" value="' + esc(s.id) + '"' + (st.picked[s.id] ? ' checked' : '') + '><span class="t">' + esc(s.t) + '</span><span class="m">' + esc(m) + '</span><span class="d">' + esc(s.d.slice(5).replace('-', '/') + (s.e ? ' · ' + s.e : '')) + '</span></label>';
    }).join('') : '<p class="ph-sub">검색 결과가 없어요.</p>';
    importCount(box);
  }

  /* ================================================================ 카카오톡 콘티 요약 복사 */
  function toolMsg(card, text, bad) {
    var m = $('[data-cn-toolmsg]', card); if (!m) return;
    m.textContent = text; m.classList.toggle('bad', !!bad); m.classList.toggle('ok', !bad && !!text);
    clearTimeout(m.__t); if (text) m.__t = setTimeout(function () { m.textContent = ''; m.classList.remove('ok', 'bad'); }, 6000);
  }
  /** 링크 한 줄 복사 ([data-cn-copy] = 복사할 글) */
  function copyValue(btn) {
    var text = btn.getAttribute('data-cn-copy') || '', card = btn.closest('.cn-guestlink') || btn.parentNode, msg = $('[data-cn-copymsg]', card), inp = $('input', card);
    function show(t, bad) { if (!msg) return; msg.textContent = t; msg.classList.toggle('bad', !!bad); msg.classList.toggle('ok', !bad); clearTimeout(msg.__t); msg.__t = setTimeout(function () { msg.textContent = ''; msg.classList.remove('ok', 'bad'); }, 5000); }
    function legacy() { try { if (!inp) return false; inp.focus(); inp.select(); inp.setSelectionRange(0, text.length); return !!document.execCommand('copy'); } catch (e) { return false; } }
    function good() { show('링크를 복사했어요.'); }
    function bad() { if (inp) { try { inp.focus(); inp.select(); } catch (e) {} } show('자동 복사가 안 돼요. 링크를 길게 눌러 직접 복사해 주세요.', true); }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) navigator.clipboard.writeText(text).then(good, function () { legacy() ? good() : bad(); });
    else { legacy() ? good() : bad(); }
  }
  function kakaoCopy(btn) {
    var card = btn.closest('.ph-card') || document, ta = $('[data-cn-kakaotxt]', card), pv = $('[data-cn-kakaopv]', card);
    if (!ta) return;
    var text = ta.value;
    function legacy() {
      try { ta.removeAttribute('readonly'); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); var ok = document.execCommand('copy'); ta.setAttribute('readonly', ''); return !!ok; } catch (e) { return false; }
    }
    function good() { toolMsg(card, '복사했어요. 카카오톡에 붙여 넣으세요.'); }
    function bad() { if (pv) pv.open = true; try { ta.focus(); ta.select(); } catch (e) {} toolMsg(card, '자동 복사가 안 돼요. 아래 글을 길게 눌러 직접 복사해 주세요.', true); }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(good, function () { legacy() ? good() : bad(); });
    } else { legacy() ? good() : bad(); }
  }

  /* ================================================================ 오프라인용 다운로드 */
  function mb(b) { b = Number(b) || 0; return b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB'; }
  function when(at) { var d = new Date(at); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function offRender(panel) {
    if (!panel || panel.hidden) return;
    var O = window.YNOff, st = O && O.dl ? O.dl.status() : null, h;
    if (!st) { panel.innerHTML = '<p class="cn-offmsg bad">오프라인 저장 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요.</p>'; return; }
    var rec = st.rec;
    if (!st.supported) h = '<p class="cn-offmsg bad">이 브라우저(또는 http 연결)에서는 오프라인 저장을 쓸 수 없어요. 홈 화면에 추가한 앱이나 최신 크롬 · 사파리에서 열어 주세요.</p>';
    else if (st.state === 'running') {
      h = '<div class="cn-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + st.pct + '"><i style="width:' + st.pct + '%"></i></div>' +
        '<p class="cn-offmsg">' + st.pct + '% · ' + esc(st.msg) + (st.sheets ? ' · 악보 ' + st.sheetsDone + '/' + st.sheets : '') + ' · ' + mb(st.bytes) + '</p>' +
        '<div class="cn-offact"><button type="button" class="cn-mini" data-cn-offcancel>취소</button></div>';
    } else {
      var head = '';
      if (st.state === 'error') head = '<p class="cn-offmsg bad">' + esc(st.msg) + '</p>';
      else if (st.state === 'cancelled') head = '<p class="cn-offmsg">' + esc(st.msg) + '</p>';
      if (rec) {
        h = head + '<p class="cn-offmsg ok">✓ 이 기기에 받아 둠 · ' + when(rec.at) + ' · 악보 ' + (rec.sheets || 0) + '개 · 화면 ' + (rec.pages || 0) + '개 · ' + mb(rec.bytes) +
          (rec.failed ? ' · 못 받은 것 ' + rec.failed + '개' : '') + '</p><p class="cn-offhint">인터넷이 끊겨도 콘티와 라이브 악보가 열려요. 라이브 악보를 열 때마다 빠진 것만 조용히 채워요.</p>' +
          '<div class="cn-offact"><button type="button" class="cn-mini pri" data-cn-offstart>다시 받기</button><button type="button" class="cn-mini" data-cn-offclear>받아 둔 것 지우기</button></div>';
      } else {
        h = head + '<p class="cn-offhint">이 예배 앞뒤(지난주 ~ 3주 뒤)의 콘티 · 라이브 악보 화면과 악보 파일을 이 기기에 저장해요. 와이파이가 약한 예배당에서도 열려요. 와이파이에서 받는 걸 추천해요.</p>' +
          '<div class="cn-offact"><button type="button" class="cn-mini pri" data-cn-offstart>다운로드 시작</button></div>';
      }
    }
    panel.innerHTML = h;
  }
  function offOpts(panel) { return { team: panel.getAttribute('data-team') || '', date: panel.getAttribute('data-date') || '', event: panel.getAttribute('data-event') || '' }; }
  var offBound = false;
  function mountOffline(root) {
    var O = window.YNOff;
    if (!offBound && O && O.dl) { offBound = true; O.dl.on(function () { $$('[data-cn-offpanel]').forEach(offRender); }); }
    $$('[data-cn-offopen]', root).forEach(function (b) {
      if (O && O.dl && O.dl.enabled()) { b.classList.add('cn-on'); b.title = '이 기기에 받아 둔 예배가 있어요'; }
      if (!b.getAttribute('data-cn-refill') && O && O.dl && O.dl.enabled()) {          // 받아 둔 기기에서 콘티를 열면 빠진 것만 조용히 채움 (6시간에 한 번)
        b.setAttribute('data-cn-refill', '1');
        setTimeout(function () { try { O.dl.refill({ team: b.getAttribute('data-team') || '', date: b.getAttribute('data-date') || '', event: b.getAttribute('data-event') || '' }); } catch (e) {} }, 2500);
      }
    });
  }

  /* ================================================================ 한 번만 붙는 위임 이벤트 (SPA 로 화면이 바뀌어도 그대로) */
  function bindDelegated() {
    if (window.__cnToolsBound) return; window.__cnToolsBound = true;
    document.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      var el;
      if ((el = t.closest('[data-cn-ytopen]'))) { e.preventDefault(); var c = ytCtx(el); if (c) ytOpen(c); return; }
      if ((el = t.closest('[data-cn-ytgo]'))) { e.preventDefault(); var c2 = ytCtx(el); if (c2) { var qi = $('[data-cn-ytq]', c2.panel); if (qi) qi.removeAttribute('data-auto'); ytSearch(c2, false); } return; }
      if ((el = t.closest('[data-cn-ytmore]'))) { e.preventDefault(); var c3 = ytCtx(el); if (c3) ytSearch(c3, true); return; }
      if ((el = t.closest('[data-cn-ytclose]'))) { e.preventDefault(); var c4 = ytCtx(el); if (c4) { c4.panel.hidden = true; c4.btn.setAttribute('aria-expanded', 'false'); stopPreviews(); } return; }
      if ((el = t.closest('[data-cn-ytuse]'))) { e.preventDefault(); var c5 = ytCtx(el); var card = el.closest('.cn-ytcard'); if (c5 && card) ytUse(c5, card); return; }
      if ((el = t.closest('[data-cn-ytprev]'))) {                                                  // 결과 카드의 미리보기
        e.preventDefault();
        var card2 = el.closest('.cn-ytcard'); if (!card2) return;
        var had = card2.querySelector('.cn-ytembed');
        stopPreviews(had ? null : card2);
        if (had) { had.remove(); var th = card2.querySelector('.cn-ytthumb'); if (th) th.hidden = false; return; }
        var th2 = card2.querySelector('.cn-ytthumb'); if (th2) th2.hidden = true;
        card2.insertAdjacentHTML('afterbegin', embed(card2.getAttribute('data-id')));
        return;
      }
      if ((el = t.closest('[data-cn-ytselprev]'))) {                                               // 고른 영상의 미리보기
        e.preventDefault();
        var sel = el.closest('[data-cn-ytpick]'); if (!sel) return;
        var cur = sel.querySelector('.cn-ytembed');
        stopPreviews(cur ? null : sel);
        if (cur) { cur.remove(); return; }
        sel.insertAdjacentHTML('beforeend', embed(sel.getAttribute('data-id')));
        return;
      }
      if ((el = t.closest('[data-cn-ytclear]'))) {
        e.preventDefault(); var c6 = ytCtx(el); if (c6) { c6.input.value = ''; fire(c6.input, 'input'); fire(c6.input, 'change'); renderPick(c6, ''); c6.pick.removeAttribute('data-id'); }
        return;
      }
      if ((el = t.closest('[data-cn-pickall]'))) {
        e.preventDefault();
        var body = el.closest('.cn-ibody'), boxes = $$('input[type="checkbox"]', body), all = boxes.every(function (b) { return b.checked; });
        boxes.forEach(function (b) { b.checked = !all; });
        el.textContent = all ? '이 콘티 전체 선택' : '선택 해제';
        var imp = el.closest('[data-cn-import]'); if (imp) importCount(imp);
        return;
      }
      if ((el = t.closest('[data-cn-copy]'))) { e.preventDefault(); copyValue(el); return; }
      if ((el = t.closest('[data-cn-kakao]'))) { e.preventDefault(); kakaoCopy(el); return; }
      if ((el = t.closest('[data-cn-offopen]'))) {
        e.preventDefault();
        var card3 = el.closest('.ph-card') || document, panel = $('[data-cn-offpanel]', card3); if (!panel) return;
        var open = panel.hidden;
        panel.hidden = !open; el.setAttribute('aria-expanded', open ? 'true' : 'false');
        ['team', 'date', 'event'].forEach(function (k) { panel.setAttribute('data-' + k, el.getAttribute('data-' + k) || ''); });
        if (open) offRender(panel);
        return;
      }
      if ((el = t.closest('[data-cn-offstart]'))) { e.preventDefault(); var p1 = el.closest('[data-cn-offpanel]'); if (window.YNOff) window.YNOff.dl.start(offOpts(p1)); return; }
      if ((el = t.closest('[data-cn-offcancel]'))) { e.preventDefault(); if (window.YNOff) window.YNOff.dl.cancel(); return; }
      if ((el = t.closest('[data-cn-offclear]'))) {
        e.preventDefault();
        if (window.YNOff) window.YNOff.dl.clear().then(function () { $$('[data-cn-offopen]').forEach(function (b) { b.classList.remove('cn-on'); b.removeAttribute('title'); }); $$('[data-cn-offpanel]').forEach(offRender); });
        return;
      }
    });
    document.addEventListener('input', function (e) {
      var t = e.target; if (!t || !t.matches) return;
      if (t.matches('[data-cn-ytlink]')) { var c = ytCtx(t); if (c) syncPick(c, false); return; }
      if (t.matches('[data-cn-ytq]')) { t.removeAttribute('data-auto'); return; }
      if (t.matches('[data-cn-isearch]')) { var box = t.closest('[data-cn-import]'); if (box) importSearch(box); return; }
    });
    document.addEventListener('change', function (e) {
      var t = e.target; if (!t || !t.matches) return;
      if (t.matches('[data-cn-import] input[name="곡"]')) {
        var box = t.closest('[data-cn-import]'), st = importState(box);
        if (t.closest('[data-cn-ifound]')) st.picked[t.value] = t.checked;
        importCount(box); return;
      }
      if (t.matches('[data-cn-sametoggle]')) {
        var f = t.closest('[data-cn-same]'), b = f && $('.cn-samebody', f);
        if (b) b.hidden = !t.checked;
        return;
      }
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target; if (!t || !t.matches) return;
      if (t.matches('[data-cn-ytq]') && e.key === 'Enter') { e.preventDefault(); var c = ytCtx(t); if (c) { t.removeAttribute('data-auto'); ytSearch(c, false); } }
      else if (t.matches('[data-cn-isearch]') && e.key === 'Enter') e.preventDefault();
      else if (t.matches('[data-cn-ytlink]') && e.key === 'Enter') e.preventDefault();       // 링크 칸에서 Enter 로 저장되지 않게
    });
    document.addEventListener('submit', function (e) {                                       // 곡을 하나도 안 골랐으면 보내지 않음
      var f = e.target; if (!f || !f.matches) return;
      if (f.matches('.cn-importform') && !$$('input[name="곡"]:checked', f).length) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  /** 새로 들어온 칸 정리 — 링크가 이미 있는 칸은 건드리지 않고, 새 입력 폼만 초기 상태로 */
  function mountConti(root) {
    $$('[data-cn-import]', root).forEach(function (box) { importCount(box); });
  }


  /* ---------- 5) 콘티 순서 바꾸기 — [data-cn-reorder] 를 누르면 곡 카드가 한 줄로 접히고 손잡이(.cn-grip)가 나옵니다.
   *   손잡이를 끌어서(마우스 · 터치 — pointer 이벤트) 또는 손잡이에서 위·아래 방향키로 옮기고, "순서 저장"(폼 제출)을 누르면
   *   서버(/conti/songs/reorder)가 곡 ID 순서를 저장합니다. 폼은 spa.js 가 받아 제자리에서 화면을 다시 불러옴(보던 자리 유지). */
  function bindReorder() {
    if (window.__cnReorderBound) return; window.__cnReorderBound = true;
    var drag = null, scrollTimer = null;
    function boxOf(el) { var c = el.closest('.ph-card'); return c ? c.querySelector('[data-cn-sortable]') : null; }
    function barOf(box) { var c = box.closest('.ph-card'); return c ? c.querySelector('[data-cn-rbar]') : null; }
    function openBtnOf(box) { var c = box.closest('.ph-card'); return c ? c.querySelector('[data-cn-reorder]') : null; }
    function songs(box) { return [].slice.call(box.children).filter(function (c) { return c.classList && c.classList.contains('cn-song'); }); }
    function ids(box) { return songs(box).map(function (c) { return c.getAttribute('data-song') || ''; }); }
    function renumber(box) { songs(box).forEach(function (c, i) { var n = c.querySelector('.cn-no'); if (n) n.textContent = String(i + 1); }); }
    function enter(box) {
      box.__orig = ids(box); box.classList.add('cn-reorder');
      var bar = barOf(box), btn = openBtnOf(box); if (bar) bar.hidden = false; if (btn) btn.hidden = true;
    }
    function leave(box) {
      box.classList.remove('cn-reorder', 'cn-sorting');
      var bar = barOf(box), btn = openBtnOf(box); if (bar) bar.hidden = true; if (btn) btn.hidden = false;
    }
    function restore(box) {
      var by = {}; songs(box).forEach(function (c) { by[c.getAttribute('data-song')] = c; });
      (box.__orig || []).forEach(function (id) { if (by[id]) box.appendChild(by[id]); });
      renumber(box);
    }
    // 끌고 있는 카드를, 포인터가 이웃 카드의 가운데 선을 넘을 때마다 한 칸씩 옮깁니다 (빠르게 끌어도 따라가도록 안정될 때까지 반복)
    function place() {
      if (!drag) return;
      var card = drag.card, box = drag.box, moved = false, guard = 0;
      while (guard++ < 60) {
        var sibs = songs(box), i = sibs.indexOf(card), prev = sibs[i - 1], next = sibs[i + 1], r;
        if (prev && (r = prev.getBoundingClientRect()) && drag.y < r.top + r.height / 2) { box.insertBefore(card, prev); moved = true; continue; }
        if (next && (r = next.getBoundingClientRect()) && drag.y > r.top + r.height / 2) { box.insertBefore(card, next.nextSibling); moved = true; continue; }
        break;
      }
      if (moved) renumber(box);
    }
    function stopDrag() {
      if (!drag) return;
      clearInterval(scrollTimer); scrollTimer = null;
      drag.card.classList.remove('cn-dragging'); drag.box.classList.remove('cn-sorting');
      try { drag.grip.releasePointerCapture(drag.id); } catch (e) {}
      drag = null;
    }
    document.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      var b;
      if ((b = t.closest('[data-cn-reorder]'))) { e.preventDefault(); var box = boxOf(b); if (box) enter(box); return; }
      if ((b = t.closest('[data-cn-rcancel]'))) { e.preventDefault(); var bx = boxOf(b); if (bx) { stopDrag(); restore(bx); leave(bx); } return; }
    });
    document.addEventListener('pointerdown', function (e) {
      var g = e.target && e.target.closest ? e.target.closest('[data-cn-grip]') : null; if (!g) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var card = g.closest('.cn-song'), box = card && card.parentNode;
      if (!box || !box.classList.contains('cn-reorder')) return;
      e.preventDefault();
      try { g.setPointerCapture(e.pointerId); } catch (x) {}
      drag = { card: card, box: box, grip: g, id: e.pointerId, y: e.clientY };
      card.classList.add('cn-dragging'); box.classList.add('cn-sorting');
      clearInterval(scrollTimer);
      scrollTimer = setInterval(function () {                       // 화면 위 · 아래 끝에 가까이 가면 같이 스크롤 (곡이 많은 긴 목록)
        if (!drag) return;
        var h = window.innerHeight || document.documentElement.clientHeight, edge = 70, dy = 0;
        if (drag.y < edge) dy = -Math.ceil((edge - drag.y) / 5); else if (drag.y > h - edge) dy = Math.ceil((drag.y - (h - edge)) / 5);
        if (dy) { window.scrollBy(0, dy); place(); }
      }, 16);
    });
    document.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault(); drag.y = e.clientY; place();
    }, { passive: false });
    ['pointerup', 'pointercancel'].forEach(function (n) {
      document.addEventListener(n, function (e) { if (drag && e.pointerId === drag.id) stopDrag(); });
    });
    document.addEventListener('keydown', function (e) {           // 손잡이에서 ↑ ↓ — 마우스 · 터치 없이도 옮길 수 있게
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      var g = e.target && e.target.closest ? e.target.closest('[data-cn-grip]') : null; if (!g) return;
      var card = g.closest('.cn-song'), box = card && card.parentNode;
      if (!box || !box.classList.contains('cn-reorder')) return;
      e.preventDefault();
      var sibs = songs(box), i = sibs.indexOf(card);
      if (e.key === 'ArrowUp' && sibs[i - 1]) box.insertBefore(card, sibs[i - 1]);
      else if (e.key === 'ArrowDown' && sibs[i + 1]) box.insertBefore(card, sibs[i + 1].nextSibling);
      else return;
      renumber(box); g.focus();
    });
    // 저장 — spa.js 의 제출 처리보다 먼저(capture) 곡 ID 순서를 폼에 담음. 바뀐 게 없으면 보내지 않고 그냥 닫음
    document.addEventListener('submit', function (e) {
      var f = e.target; if (!f || !f.matches || !f.matches('[data-cn-rbar]')) return;
      var box = boxOf(f); if (!box) return;
      var now = ids(box);
      if (now.join(',') === (box.__orig || []).join(',')) { e.preventDefault(); e.stopPropagation(); leave(box); return; }
      var inp = f.querySelector('[data-cn-rids]'); if (inp) inp.value = now.join(',');
    }, true);
  }

  function mountAll() {
    bindDelegated();
    bindReorder();
    var root = document;
    mountFormBuilders(root);
    mountConti(root);
    mountOffline(root);
    wireAtTags(root);
    wireAtTagPreview(root);
    mountYtPlay(root);
    mountSplit(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
  /* ---------- 4) 유튜브 이어 듣기 — 이 예배의 곡들을 콘티 순서대로 한 플레이어에서 이어 재생 ---------- */
  var ytApi = null;                                           // YouTube IFrame API 는 한 번만 불러옴
  function loadYtApi(cb) {
    if (window.YT && window.YT.Player) return cb();
    if (ytApi) return ytApi.push(cb);
    ytApi = [cb];
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () { try { if (prev) prev(); } catch (e) {} var q = ytApi; ytApi = null; q.forEach(function (f) { try { f(); } catch (e) {} }); };
    var s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = function () { var q = ytApi || []; ytApi = null; q.forEach(function (f) { try { f(null); } catch (e) {} }); };
    document.head.appendChild(s);
  }
  function escH(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mountYtPlay(root) {
    root.querySelectorAll('[data-cn-yplay]:not([data-cn-yplay-on])').forEach(function (box) {
      box.setAttribute('data-cn-yplay-on', '1');
      var items = []; try { items = JSON.parse(box.getAttribute('data-items') || '[]'); } catch (e) {}
      var panel = box.querySelector('[data-cn-yplayer]'), btn = box.querySelector('[data-cn-yplay-open]');
      if (!items.length || !panel || !btn) return;
      var player = null, cur = 0, built = false, bad = {};
      function label(it) { return ((it.k === '설교 후' || it.k === '폐회송') ? it.k + ' · ' : '') + it.t; }
      function paint() {
        var now = panel.querySelector('[data-cn-ynow]'); if (now) now.textContent = label(items[cur]);
        panel.querySelectorAll('.cn-yq li').forEach(function (li, i) { li.classList.toggle('on', i === cur); li.classList.toggle('bad', !!bad[i]); var x = li.querySelector('.x'); if (x) x.textContent = bad[i] ? '재생 불가' : (i === cur ? '재생 중' : ''); });
      }
      function play(i, auto) {
        if (i < 0 || i >= items.length) return;
        cur = i; paint();
        if (player && player.loadVideoById) { if (auto === false) player.cueVideoById(items[i].id); else player.loadVideoById(items[i].id); }
      }
      function next(from) { for (var i = (from == null ? cur : from) + 1; i < items.length; i++) if (!bad[i]) return play(i); }
      function prev() { for (var i = cur - 1; i >= 0; i--) if (!bad[i]) return play(i); }
      function build() {
        built = true;
        panel.innerHTML = '<div class="cn-yframe"><div data-cn-yslot></div></div>' +
          '<div class="cn-ynow"><b data-cn-ynow></b><button type="button" class="cn-mini" data-cn-yprev>이전 곡</button><button type="button" class="cn-mini" data-cn-ynext>다음 곡</button></div>' +
          '<ul class="cn-yq">' + items.map(function (it, i) { return '<li><button type="button" data-cn-yi="' + i + '"><span class="n">' + (it.n || it.k || '결단') + '</span><span class="t">' + escH(it.t) + '</span><span class="x"></span></button></li>'; }).join('') + '</ul>' +
          '<p class="ph-sub" data-cn-ymsg hidden></p>';
        paint();
        loadYtApi(function (ok) {
          var msg = panel.querySelector('[data-cn-ymsg]');
          if (ok === null || !window.YT || !window.YT.Player) { msg.hidden = false; msg.textContent = '유튜브 플레이어를 불러오지 못했어요. "유튜브에서 한 번에 열기"를 눌러 주세요.'; return; }
          player = new window.YT.Player(panel.querySelector('[data-cn-yslot]'), {
            videoId: items[cur].id, width: '100%', height: '100%',
            playerVars: { playsinline: 1, rel: 0, autoplay: 1 },
            events: {
              onStateChange: function (e) { if (e.data === 0) next(); },          // 한 곡이 끝나면 다음 곡
              onError: function () { bad[cur] = true; paint(); msg.hidden = false; msg.textContent = '"' + items[cur].t + '" 은(는) 유튜브에서 이 화면 재생을 막아 두었어요 — 다음 곡으로 넘어가요.'; next(); },
            },
          });
        });
      }
      btn.addEventListener('click', function () {
        var open = panel.hidden;
        panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && !built) build();
        if (!open && player && player.pauseVideo) { try { player.pauseVideo(); } catch (e) {} }
        else if (open && player && player.playVideo) { try { player.playVideo(); } catch (e) {} }
      });
      panel.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('button') : null; if (!t) return;
        if (t.hasAttribute('data-cn-yprev')) prev();
        else if (t.hasAttribute('data-cn-ynext')) next();
        else if (t.hasAttribute('data-cn-yi')) { delete bad[Number(t.getAttribute('data-cn-yi'))]; play(Number(t.getAttribute('data-cn-yi'))); }
      });
    });
  }


  /* ---------- 5) 패키지 악보 곡별 나누기 — PDF 글자에서 곡 제목이 처음 나오는 쪽을 찾아 곡마다 쪽 범위를 채워 줌 (고칠 수 있음) ---------- */
  var pdfLoad = null;
  function loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLoad) return pdfLoad;
    pdfLoad = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = '/vendor/pdfjs/pdf.min.js';
      s.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; ok(window.pdfjsLib); } catch (e) { no(e); } };
      s.onerror = function () { pdfLoad = null; no(new Error('load')); };
      document.head.appendChild(s);
    });
    return pdfLoad;
  }
  function normT(t) { return String(t || '').normalize('NFC').toLowerCase().replace(/[\s\-_.·,!?'"()\[\]~:;/\\]+/g, ''); }
  /** 곡마다 시작 쪽(1부터) 찾기 — 앞 곡의 시작 다음 쪽부터 그 곡 제목이 처음 나오는 쪽. 못 찾으면 0 */
  function findStarts(pageTexts, titles) {
    var starts = [], from = 0;
    titles.forEach(function (t) {
      var nt = normT(t), at = 0;
      if (nt) for (var i = from; i < pageTexts.length; i++) { if (pageTexts[i].indexOf(nt) !== -1) { at = i + 1; break; } }
      starts.push(at); if (at) from = at;            // 다음 곡은 이 곡 시작 "다음 쪽"부터 찾음
    });
    return starts;
  }
  function rangesFromStarts(starts, total) {
    var out = starts.map(function () { return ''; });
    var found = []; starts.forEach(function (st, i) { if (st) found.push(i); });
    found.forEach(function (i, k) {
      var a = starts[i], b = k + 1 < found.length ? starts[found[k + 1]] - 1 : total;
      if (b < a) b = a; out[i] = a === b ? String(a) : a + '-' + b;
    });
    return out;
  }
  function mountSplit(root) {
    root.querySelectorAll('[data-cn-split]:not([data-cn-split-on])').forEach(function (box) {
      box.setAttribute('data-cn-split-on', '1');
      var src = box.getAttribute('data-src'), hint = box.querySelector('[data-cn-splithint]'), auto = box.querySelector('[data-cn-splitauto]');
      var inputs = [].slice.call(box.querySelectorAll('[data-cn-pages]')), base = hint ? hint.textContent : '', pdf = null, busy = false;
      function say(t) { if (hint) hint.textContent = t; }
      function run(overwrite) {
        if (busy) return; busy = true; say('악보를 읽는 중…');
        loadPdfjs().then(function (lib) { return pdf ? pdf : lib.getDocument({ url: src, withCredentials: true }).promise; }).then(function (doc) {
          pdf = doc; var n = doc.numPages, jobs = [];
          for (var p = 1; p <= n; p++) jobs.push(doc.getPage(p).then(function (pg) { return pg.getTextContent(); }).then(function (c) { return normT(c.items.map(function (x) { return x.str; }).join('')); }));
          return Promise.all(jobs).then(function (texts) { return { texts: texts, n: n }; });
        }).then(function (r) {
          busy = false;
          if (!r.texts.some(function (t) { return t.length > 3; })) { say('총 ' + r.n + '쪽 — 이 악보는 글자를 읽을 수 없어요(스캔 · 사진). 곡마다 쪽을 직접 적어 주세요.'); return; }
          var titles = inputs.map(function (i) { return i.getAttribute('data-cn-pages'); });
          var res = rangesFromStarts(findStarts(r.texts, titles), r.n), hit = 0, miss = [];
          inputs.forEach(function (inp, i) {
            if (res[i]) { hit++; if (overwrite || !inp.value.trim()) inp.value = res[i]; } else miss.push(titles[i]);
          });
          say('총 ' + r.n + '쪽 · ' + hit + '곡의 쪽을 찾았어요' + (miss.length ? ' — 못 찾은 곡(' + miss.join(', ') + ')은 직접 적어 주세요.' : '.') + ' 맞는지 확인하고 저장하세요.');
        }).catch(function () { busy = false; say('악보를 읽지 못했어요(PDF가 아니거나 불러오지 못함). 곡마다 쪽을 직접 적어 주세요.'); });
      }
      box.addEventListener('toggle', function () { if (box.open && !pdf && box.getAttribute('data-has') !== '1') run(false); });
      if (auto) auto.addEventListener('click', function () { run(true); });
    });
  }

  document.addEventListener('ph:content-updated', mountAll);
})();
