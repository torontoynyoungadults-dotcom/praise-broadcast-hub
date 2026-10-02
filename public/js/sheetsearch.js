/* 웹에서 악보 찾기 — "웹에서 악보 찾기" 버튼([data-sheet-search])을 누르면 검색 창이 떠서
   곡 제목으로 이미지를 찾고, 고른 이미지(여러 장 가능, 고른 순서 = 쪽 순서)를 서버가 PDF 한 개로 묶어 악보로 저장합니다. */
(function () {
  if (window.__phSheetSearch) return; window.__phSheetSearch = true;
  var root = null, ctx = null, picked = [], start = 1, busy = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel) { return root.querySelector(sel); }

  function build() {
    root = document.createElement('div');
    root.className = 'ss-back';
    root.innerHTML = '<div class="ss-box" role="dialog" aria-modal="true" aria-label="웹에서 악보 찾기">' +
      '<div class="ss-head"><b>웹에서 악보 찾기</b><button type="button" class="ss-close" data-ss="close">닫기</button></div>' +
      '<form class="ss-bar" data-ss="form"><input type="search" class="ss-q" placeholder="곡 제목 (예: 주님은 나의 목자 코드 악보)" autocomplete="off"><button class="ph-btn pri" type="submit">찾기</button></form>' +
      '<p class="ss-note">인터넷에 있는 이미지라 화질이 다를 수 있어요. 마음에 드는 것을 눌러 고르면(여러 장 가능, 고른 순서가 쪽 순서) 한 개의 악보 PDF로 저장돼요. 팀 연습용으로만 써 주세요.</p>' +
      '<div class="ss-msg" role="status"></div><div class="ss-grid"></div>' +
      '<div class="ss-more" hidden><button type="button" class="ph-btn" data-ss="more">더 보기</button></div>' +
      '<div class="ss-foot"><input type="text" class="ss-title" placeholder="저장할 이름 (비워 두면 곡 제목)"><button type="button" class="ph-btn pri" data-ss="save" disabled>선택한 0장 악보로 저장</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) return close();
      var t = e.target.closest('[data-ss]'); if (t) {
        var a = t.getAttribute('data-ss');
        if (a === 'close') close(); else if (a === 'more') run(true); else if (a === 'save') save();
        return;
      }
      var c = e.target.closest('.ss-card'); if (c) toggle(c);
    });
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
    $('.ss-title').value = titleVal;
    $('.ss-title').hidden = !!ctx.form;
    $('.ss-grid').innerHTML = ''; $('.ss-more').hidden = true; msg(''); sync();
    root.classList.add('on'); document.body.classList.add('ss-open');
    if (q) run(false); else $('.ss-q').focus();
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
        if (d.configured === false) { msg(''); $('.ss-grid').innerHTML = '<div class="ss-setup"><b>검색 키 설정이 아직 안 돼 있어요.</b><br>관리자가 Render 환경변수에 <code>GOOGLE_CSE_KEY</code> 와 <code>GOOGLE_CSE_ID</code> 를 넣으면 이 기능이 켜져요. 그동안은 파일이나 링크로 올려 주세요.</div>'; $('.ss-more').hidden = true; return; }
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
