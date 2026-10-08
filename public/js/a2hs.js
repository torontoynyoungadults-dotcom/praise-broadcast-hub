/**
 * 홈 화면에 추가 안내 — 처음 들어온 폰·태블릿에 "앱처럼 쓰는 법"을 기기에 맞게 보여 줍니다.
 *
 *   · 이미 홈 화면 앱으로 열었으면(standalone) 아무것도 안 합니다 (바닥글의 안내 링크도 감춤).
 *   · 처음 한 번 아래에서 올라옴 → "닫기" 는 7일 뒤에 다시, "다시 보지 않기" 는 영영 안 뜸 (이 기기 localStorage).
 *   · 아이폰 · 아이패드 · 갤럭시(안드로이드) 탭이 있고, 쓰는 기기에 맞는 탭이 먼저 열립니다. 틀리면 직접 눌러 바꿀 수 있어요.
 *   · 카카오톡 · 인스타그램 같은 앱 안 브라우저는 홈 화면 추가가 안 되므로 "Safari / Chrome 으로 열기" 부터 안내하고 주소 복사 단추를 둡니다.
 *   · 안드로이드 크롬이 "설치" 를 허락하면(beforeinstallprompt) "지금 설치" 단추가 바로 뜹니다.
 *   · 언제든 바닥글의 "홈 화면에 추가하는 법" (data-a2hs) 으로 다시 열 수 있습니다.
 *   · window.YNInstall.open(tab?) / .env() — 열기 · 기기 판별(테스트용)
 */
(function () {
  if (window.YNInstall) return;
  var KEY = 'ph.a2hs', SNOOZE_MS = 7 * 86400000, SHOW_DELAY = 1800;
  var ua = navigator.userAgent || '';

  function lsGet() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function lsSet(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 막혀 있어도 안내는 동작 */ } }

  /* ---------- 기기 · 브라우저 판별 ---------- */
  function env() {
    var iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    var iPhone = /iPhone|iPod/.test(ua);
    var ios = iPad || iPhone;
    var android = /Android/.test(ua);
    var kind = ios ? (/CriOS/.test(ua) ? 'chrome' : /EdgiOS/.test(ua) ? 'edge' : /FxiOS/.test(ua) ? 'firefox' : 'safari')
      : android ? (/SamsungBrowser/.test(ua) ? 'samsung' : /Firefox/.test(ua) ? 'firefox' : /EdgA/.test(ua) ? 'edge' : 'chrome') : 'desktop';
    var inapp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|BAND\/|; wv\)|Snapchat|MicroMessenger/i.test(ua) ||
      (ios && !/Safari\//.test(ua));                                  // 아이폰 앱 안 화면은 UA 에 Safari/ 가 없음
    var standalone = false;
    try { standalone = !!(navigator.standalone || (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches))); } catch (e) {}
    return { ios: ios, iPad: iPad, iPhone: iPhone, android: android, mobile: ios || android, kind: kind, inapp: inapp, standalone: standalone,
      tab: iPad ? 'ipad' : iPhone ? 'iphone' : android ? 'android' : 'iphone' };
  }

  /* ---------- 그림 (인라인 SVG — 눈에 익은 단추 모양) ---------- */
  var I = {
    share: '<svg class="a2-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M12 3 8 7M12 3l4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dots: '<svg class="a2-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>',
    hdots: '<svg class="a2-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
    menu: '<svg class="a2-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    plus: '<svg class="a2-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    phone: '<svg class="a2-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 18.5h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };
  function ol(steps) { return '<ol class="a2-steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>'; }

  var TABS = {
    iphone: { label: '아이폰', html: function (e) {
      var note = e.kind === 'chrome' || e.kind === 'edge' || e.kind === 'firefox'
        ? '<p class="a2-note">지금 쓰는 앱은 Safari 가 아니지만 같은 방법으로 돼요. 공유 버튼은 <b>주소창 오른쪽</b>에 있어요. (안 되면 Safari 로 열어 주세요.)</p>' : '';
      return ol([
        '<b>Safari</b> 로 이 페이지를 열어 둔 채, 화면 <b>아래 가운데</b>(또는 주소창 옆)의 공유 버튼 ' + I.share + ' 을 눌러요. 안 보이면 ' + I.hdots + ' 를 누르고 <b>공유</b>를 골라요.',
        '나오는 메뉴를 <b>위로 밀어 올려</b> <b>홈 화면에 추가</b> ' + I.plus + ' 를 눌러요.',
        '<b>웹 앱으로 열기</b>가 켜져 있는지 보고, 오른쪽 위 <b>추가</b>를 누르면 끝! 홈 화면에 <b>YN찬양팀Hub</b> 아이콘이 생겨요.'
      ]) + note;
    } },
    ipad: { label: '아이패드', html: function (e) {
      var note = e.kind === 'chrome' || e.kind === 'edge' || e.kind === 'firefox'
        ? '<p class="a2-note">Safari 가 아니어도 주소창 오른쪽의 공유 버튼에서 같은 방법으로 돼요.</p>' : '';
      return ol([
        '<b>Safari</b> 로 이 페이지를 열고, 화면 <b>오른쪽 위</b> 주소창 옆의 공유 버튼 ' + I.share + ' 을 눌러요. 안 보이면 ' + I.hdots + ' 를 먼저 눌러요.',
        '<b>홈 화면에 추가</b> ' + I.plus + ' 를 눌러요. (목록을 아래로 밀면 나와요)',
        '이름이 <b>YN찬양팀Hub</b> 로 되어 있는지 보고 오른쪽 위 <b>추가</b>를 누르면 끝!'
      ]) + note;
    } },
    android: { label: '갤럭시', html: function (e) {
      var chrome = '<section class="a2-sub' + (e.kind !== 'samsung' ? ' on' : '') + '"><h4>크롬(Chrome)</h4>' + ol([
        '화면 <b>오른쪽 위</b>의 메뉴 ' + I.dots + ' 를 눌러요. (갤럭시 탭은 주소창 오른쪽)',
        '<b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요.',
        '한 번 더 <b>설치</b>(또는 <b>추가</b>)를 누르면 끝! 앱 서랍과 홈 화면에 아이콘이 생겨요.'
      ]) + '</section>';
      var samsung = '<section class="a2-sub' + (e.kind === 'samsung' ? ' on' : '') + '"><h4>삼성 인터넷</h4>' + ol([
        '화면 <b>아래 오른쪽</b>의 메뉴 ' + I.menu + ' 를 눌러요.',
        '<b>페이지 추가</b>(또는 <b>현재 페이지 추가</b>)를 누르고 <b>홈 화면</b>을 골라요.',
        '<b>추가</b>를 누르면 끝! 홈 화면에 아이콘이 생겨요.'
      ]) + '</section>';
      return e.kind === 'samsung' ? samsung + chrome : chrome + samsung;
    } }
  };

  /* ---------- 창 ---------- */
  var root = null, deferred = null, state = { tab: 'iphone', manual: false };

  function inappWarn(e) {
    if (!e.inapp) return '';
    var to = e.ios ? 'Safari' : 'Chrome';
    return '<div class="a2-warn"><b>지금은 카카오톡 · 인스타 같은 앱 안에서 열린 화면이에요.</b> 여기서는 홈 화면에 추가가 안 돼요. ' +
      '오른쪽 위(또는 아래) <b>' + I.hdots + ' / ' + I.dots + '</b> 를 눌러 <b>다른 브라우저로 열기</b> → <b>' + to + '</b> 를 고르거나, 아래 단추로 주소를 복사해 ' + to + ' 에 붙여 넣어 주세요.' +
      '<button type="button" class="a2-copy" data-a2="copy">주소 복사</button></div>';
  }
  function body() {
    var e = env(), t = TABS[state.tab];
    var tabs = Object.keys(TABS).map(function (k) {
      return '<button type="button" role="tab" class="a2-tab' + (k === state.tab ? ' on' : '') + '" data-a2tab="' + k + '" aria-selected="' + (k === state.tab) + '">' + TABS[k].label + '</button>';
    }).join('');
    var install = (deferred && state.tab === 'android')
      ? '<button type="button" class="a2-install" data-a2="install">지금 설치하기</button><p class="a2-note">또는 아래 방법으로 직접 추가할 수도 있어요.</p>' : '';
    return '<div class="a2-head"><span class="a2-badge">' + I.phone + '</span><div><h3 id="a2-t">홈 화면에 추가하면 앱처럼 열려요</h3>' +
      '<p>주소창 없이 한 번에 열리고, 콘티·라이브 악보가 더 빨라요.</p></div></div>' +
      inappWarn(e) +
      '<div class="a2-tabs" role="tablist">' + tabs + '</div>' +
      '<div class="a2-panel" role="tabpanel">' + install + t.html(e) + '</div>' +
      '<div class="a2-foot">' + (state.manual ? '' : '<button type="button" class="a2-never" data-a2="never">다시 보지 않기</button>') +
      '<button type="button" class="a2-close" data-a2="close">' + (state.manual ? '닫기' : '나중에') + '</button></div>';
  }
  function close(how) {
    if (!root) return;
    var st = lsGet();
    if (how === 'never') st.no = 1;
    else if (!state.manual) st.t = Date.now() + SNOOZE_MS;
    if (!state.manual) lsSet(st);
    root.classList.remove('on');
    var r = root; root = null;
    setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 220);
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(ev) { if (ev.key === 'Escape') close(); }
  function open(tab, manual) {
    if (root) return;
    var e = env();
    state = { tab: TABS[tab] ? tab : e.tab, manual: !!manual };
    root = document.createElement('div');
    root.className = 'ph-a2hs';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'a2-t');
    root.innerHTML = '<div class="a2-back" data-a2="close"></div><div class="a2-card">' + body() + '</div>';
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(function () { root && root.classList.add('on'); });
    if (!manual) { var st = lsGet(); st.seen = Date.now(); lsSet(st); }
  }
  function rerender() { if (root) root.querySelector('.a2-card').innerHTML = body(); }

  function copyUrl(btn) {
    var u = location.origin + '/';
    function done(ok) { btn.textContent = ok ? '복사됐어요 ✓' : '길게 눌러 복사해 주세요'; if (!ok) btn.outerHTML = '<input class="a2-url" readonly value="' + u + '" onfocus="this.select()">'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var open_ = t.closest && t.closest('[data-a2hs]');
    if (open_) { ev.preventDefault(); open(null, true); return; }
    if (!root || !root.contains(t)) return;
    var tab = t.closest('[data-a2tab]');
    if (tab) { state.tab = tab.getAttribute('data-a2tab'); rerender(); return; }
    var b = t.closest('[data-a2]'); if (!b) return;
    var act = b.getAttribute('data-a2');
    if (act === 'close' || act === 'never') close(act);
    else if (act === 'copy') copyUrl(b);
    else if (act === 'install' && deferred) {
      var d = deferred; deferred = null;
      d.prompt();
      (d.userChoice || Promise.resolve({})).then(function (c) { if (c && c.outcome === 'accepted') { var st = lsGet(); st.no = 1; lsSet(st); close('never'); } else rerender(); });
    }
  });

  window.addEventListener('beforeinstallprompt', function (ev) { ev.preventDefault(); deferred = ev; rerender(); });
  window.addEventListener('appinstalled', function () { var st = lsGet(); st.no = 1; lsSet(st); deferred = null; if (root) close('never'); });

  /* ---------- 처음 한 번 자동으로 ---------- */
  function hideLinksIfInstalled() {
    if (!env().standalone) return;
    var s = document.createElement('style'); s.textContent = '[data-a2hs]{display:none!important}';
    document.head.appendChild(s);
  }
  function auto() {
    var e = env();
    if (!e.mobile || e.standalone) return;
    if (/^\/(b\/|conti\/practice|live|sheet|audio)/.test(location.pathname)) return;      // 방송팀 보기 링크 · 라이브 악보 화면에서는 방해하지 않음
    var st = lsGet();
    if (st.no || (st.t && st.t > Date.now())) return;
    setTimeout(function () {
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;                       // 글 쓰는 중이면 방해하지 않음
      if (document.hidden) return;
      open(null, false);
    }, SHOW_DELAY);
  }

  window.YNInstall = { open: function (tab) { open(tab, true); }, env: env, reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} } };
  hideLinksIfInstalled();
  auto();
})();
