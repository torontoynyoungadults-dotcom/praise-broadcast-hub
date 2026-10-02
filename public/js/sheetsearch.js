/* 웹에서 악보 찾기 — "웹에서 악보 찾기" 버튼([data-sheet-search])을 누르면 검색 창이 떠서
   곡 제목으로 이미지를 찾고, 고른 이미지(여러 장 가능, 고른 순서 = 쪽 순서)를 서버가 PDF 한 개로 묶어 악보로 저장합니다. */
(function () {
  if (window.__phSheetSearch) return; window.__phSheetSearch = true;
  var root = null, ctx = null, picked = [], start = 1, busy = false, inApp = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel) { return root.querySelector(sel); }

  function build() {
    root = document.createElement('div');
    root.className = 'ss-back';
    root.innerHTML = '<div class="ss-box" role="dialog" aria-modal="true" aria-label="웹에서 악보 찾기">' +
      '<div class="ss-head"><b>웹에서 악보 찾기</b><button type="button" class="ss-close" data-ss="close">닫기</button></div>' +
      '<div class="ss-find"><input type="search" class="ss-q2" placeholder="곡 제목 (예: 주님은 나의 목자 코드 악보)" autocomplete="off">' +
      '<button type="button" class="ph-btn pri" data-ss="google">구글 이미지에서 찾기</button><button type="button" class="ph-btn" data-ss="naver">네이버</button></div>' +
      '<ol class="ss-steps"><li>위 버튼으로 이미지 검색 탭을 열어요.</li><li>마음에 드는 악보 이미지를 열고 <b>이미지 주소 복사</b>(PC: 우클릭, 모바일: 길게 누르기)를 해요.</li><li>아래 칸에 붙여넣고 <b>추가</b>를 눌러요. (여러 장은 한 줄에 하나씩)</li></ol>' +
      '<div class="ss-paste"><textarea class="ss-urls" rows="2" placeholder="https://… 이미지 주소를 붙여넣기 (한 줄에 하나)"></textarea><button type="button" class="ph-btn pri" data-ss="addurl">추가</button></div>' +
      '<form class="ss-bar" data-ss="form" hidden><input type="search" class="ss-q" placeholder="곡 제목 (예: 주님은 나의 목자 코드 악보)" autocomplete="off"><button class="ph-btn pri" type="submit">찾기</button></form>' +
      '<p class="ss-note">인터넷에 있는 이미지라 화질이 다를 수 있어요. 추가한 순서가 쪽 순서이고(카드를 누르면 선택 해제), 한 개의 악보 PDF로 저장돼요. 팀 연습용으로만 써 주세요. JPG · PNG만 돼요. 이미지를 파일로 저장했다면 \'악보 올리기\'로 올려도 돼요.</p>' +
      '<div class="ss-msg" role="status"></div><div class="ss-grid"></div>' +
      '<div class="ss-more" hidden><button type="button" class="ph-btn" data-ss="more">더 보기</button></div>' +
      '<div class="ss-foot"><input type="text" class="ss-title" placeholder="저장할 이름 (비워 두면 곡 제목)"><button type="button" class="ph-btn pri" data-ss="save" disabled>선택한 0장 악보로 저장</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) return close();
      var t = e.target.closest('[data-ss]'); if (t) {
        var a = t.getAttribute('data-ss');
        if (a === 'close') close(); else if (a === 'more') run(true); else if (a === 'save') save();
        else if (a === 'google') webFind('https://www.google.com/search?tbm=isch&q='); else if (a === 'naver') webFind('https://search.naver.com/search.naver?where=image&query='); else if (a === 'addurl') addUrls();
        return;
      }
      var c = e.target.closest('.ss-card'); if (c) toggle(c);
    });
    $('.ss-q2').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); webFind('https://www.google.com/search?tbm=isch&q='); } });
    $('[data-ss="form"]').addEventListener('submit', function (e) { e.preventDefault(); run(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && root.classList.contains('on')) close(); });
  }

  function open(btn) {
    if (!root) build();
    var pf = btn.hasAttribute('data-pick') ? btn.closest('form') : null;       // 새 곡 추가 폼 안 — 곡이 아직 없으니 고른 주소만 폼에 담아 둠
    if (pf) { ctx = { form: pf, btn: btn }; var ti = pf.querySelector('input[name="제목"]'); var q0 = ti ? ti.value.trim() : ''; init(q0, q0); return; }
    ctx = { team: btn.getAttribute('data-team'), song: btn.getAttribute('data-song') || '', date: btn.getAttribute('data-date') || '', event: btn.getAttribute('data-event') || '' };
    var q = btn.getAttribute('data-q') || '';
    init(q, q);
  }
  function init(q, titleVal) {
    picked = []; start = 1;
    $('.ss-q').value = q ? q + ' 코드 악보' : '';
    $('.ss-q2').value = q ? q + ' 코드 악보' : ''; $('.ss-urls').value = '';
    if (inApp === null) {                                  // 서버에 검색 키가 있으면(구글/Brave) 앱 안 검색도 보여 줌
      fetch('/conti/sheetsearch?q=', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
        .then(function (d) { inApp = d.configured !== false; $('[data-ss="form"]').hidden = !inApp; }).catch(function () { inApp = false; });
    } else $('[data-ss="form"]').hidden = !inApp;
    $('.ss-title').value = titleVal;
    $('.ss-title').hidden = !!ctx.form;
    $('.ss-grid').innerHTML = ''; $('.ss-more').hidden = true; msg(''); sync();
    root.classList.add('on'); document.body.classList.add('ss-open');
    if (q && inApp) run(false); else $('.ss-q2').focus();
  }
  function close() { if (root) root.classList.remove('on'); document.body.classList.remove('ss-open'); }
  function msg(t, bad) { var m = $('.ss-msg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); }

  function sync() {
    picked.forEach(function () {});
    var cards = root.querySelectorAll('.ss-card');
    Array.prototype.forEach.call(cards, function (c) {
      var i = picked.indexOf(c.getAttribute('data-url')), b = c.querySelector('.ss-no');
      c.classList.toggle('on', i >= 0); b.textContent = i >= 0 ? String(i + 1) : '';
    });
    var s = $('[data-ss="save"]'); s.disabled = !picked.length; s.textContent = '선택한 ' + picked.length + '장 악보로 저장';
  }
  function toggle(c) {
    var u = c.getAttribute('data-url'), i = picked.indexOf(u);
    if (i >= 0) picked.splice(i, 1); else if (picked.length < 12) picked.push(u); else msg('한 번에 12장까지 고를 수 있어요.', true);
    sync();
  }

  function run(more) {
    if (busy) return;
    var q = $('.ss-q').value.trim(); if (!q) return;
    if (!more) { start = 1; $('.ss-grid').innerHTML = ''; }
    busy = true; msg('찾는 중…');
    fetch('/conti/sheetsearch?q=' + encodeURIComponent(q) + '&start=' + start, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        busy = false;
        if (d.configured === false) { msg(''); $('.ss-grid').innerHTML = '<div class="ss-setup"><b>검색 키 설정이 아직 안 돼 있어요.</b><br>관리자가 Render 환경변수에 <code>BRAVE_SEARCH_KEY</code> (또는 <code>GOOGLE_CSE_KEY</code> 와 <code>GOOGLE_CSE_ID</code>) 를 넣으면 이 기능이 켜져요. 그동안은 파일이나 링크로 올려 주세요.</div>'; $('.ss-more').hidden = true; return; }
        if (d.error) { msg(d.error, true); return; }
        var items = d.items || [];
        if (!items.length && !more) { msg('찾은 이미지가 없어요. 검색어를 바꿔 보세요 (예: 곡 제목 + 악보).'); $('.ss-more').hidden = true; return; }
        msg(''); var g = $('.ss-grid');
        items.forEach(function (it) {
          var c = document.createElement('div'); c.className = 'ss-card'; c.setAttribute('data-url', it.url); c.setAttribute('role', 'button'); c.tabIndex = 0;
          c.innerHTML = '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(it.thumb) + '"><span class="ss-no"></span><small>' + esc(it.source) + (it.w ? ' · ' + it.w + '×' + it.h : '') + '</small>';
          c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c); } });
          g.appendChild(c);
        });
        start += 10; $('.ss-more').hidden = !items.length || start > 91; sync();
      })
      .catch(function () { busy = false; msg('검색하지 못했어요. 잠시 뒤 다시 해 주세요.', true); });
  }

  function webFind(base) {
    var q = $('.ss-q2').value.trim(); if (!q) { msg('곡 제목을 먼저 적어 주세요.', true); $('.ss-q2').focus(); return; }
    msg(''); window.open(base + encodeURIComponent(q), '_blank', 'noopener');
  }
  /** 붙여넣은 이미지 주소 → 카드로 추가(추가한 순서 = 쪽 순서, 자동 선택) */
  function addUrls() {
    var lines = $('.ss-urls').value.split(/[\s]+/).map(function (x) { return x.trim(); }).filter(Boolean), added = 0, bad = 0;
    lines.forEach(function (u) {
      if (!/^https:\/\//i.test(u)) { bad++; return; }
      if (picked.indexOf(u) >= 0) return;
      if (picked.length >= 12) { msg('한 번에 12장까지 고를 수 있어요.', true); return; }
      var c = document.createElement('div'); c.className = 'ss-card'; c.setAttribute('data-url', u); c.setAttribute('role', 'button'); c.tabIndex = 0;
      c.innerHTML = '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(u) + '"><span class="ss-no"></span><small>' + esc((u.split('/')[2] || '').slice(0, 40)) + '</small>';
      c.querySelector('img').addEventListener('error', function () { this.style.display = 'none'; c.querySelector('small').textContent = '미리보기 없음 · ' + c.querySelector('small').textContent; });
      c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c); } });
      $('.ss-grid').appendChild(c); picked.push(u); added++;
      checkUrl(c, u);
    });
    if (added) { $('.ss-urls').value = ''; msg(''); } else if (bad) msg('https:// 로 시작하는 이미지 주소를 붙여넣어 주세요.', true);
    sync();
  }

  /** 서버가 이 주소의 이미지를 실제로 받을 수 있는지 확인 — 안 되면 카드에 이유를 쓰고 선택에서 뺌 */
  function checkUrl(c, u) {
    fetch('/conti/sheetsearch/check?url=' + encodeURIComponent(u), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) return;
      var i = picked.indexOf(u); if (i >= 0) picked.splice(i, 1);
      c.classList.add('bad'); c.querySelector('small').textContent = d.error || '가져올 수 없어요'; c.querySelector('small').style.whiteSpace = 'normal'; sync();
    }).catch(function () {});
  }

  function save() {
    if (!picked.length) return;
    if (ctx.form) {                                      // 새 곡 폼: 곡을 추가할 때 함께 저장됨
      Array.prototype.forEach.call(ctx.form.querySelectorAll('input[data-ss-url]'), function (n) { n.remove(); });
      picked.forEach(function (u) { var i = document.createElement('input'); i.type = 'hidden'; i.name = 'url'; i.value = u; i.setAttribute('data-ss-url', '1'); ctx.form.appendChild(i); });
      var tag = ctx.btn.parentNode.querySelector('.ss-picked'); if (tag) { tag.hidden = false; tag.textContent = '웹 악보 ' + picked.length + '장 선택됨 — 추가를 누르면 저장돼요'; }
      return close();
    }
    var f = document.createElement('form'); f.method = 'post'; f.action = '/conti/sheets/fromweb'; f.style.display = 'none';
    function add(n, v) { var i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); }
    add('team', ctx.team); add('곡ID', ctx.song); add('date', ctx.date); if (ctx.event) add('event', ctx.event);
    add('제목', $('.ss-title').value.trim());
    picked.forEach(function (u) { add('url', u); });
    document.body.appendChild(f); close(); f.requestSubmit ? f.requestSubmit() : f.submit();
    setTimeout(function () { f.remove(); }, 4000);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-sheet-search]') : null;
    if (b) { e.preventDefault(); open(b); }
  });
})();
