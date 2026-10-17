/**
 * 드라이브 화면 (routes/drive.js) — 이 폴더에서 이름 찾기 · 파일을 누르면 화면 안에서 바로 재생/보기 · "콘티에 연결" 창.
 * 모든 화면에 불러옵니다 (lib/pageShell.js) — 예배콘티 녹음 칸의 "영상 보기"([data-dv-open])도 같은 창으로 엽니다.
 *   영상 · 음악: <video>/<audio> (서버가 Range 를 넘겨 줘서 중간으로 건너뛰기 가능)
 *   사진: <img> · PDF: <iframe>   그 밖의 파일은 그냥 내려받기 (서버가 그린 링크 그대로)
 */
(function () {
  'use strict';
  if (window.__dvBound) return; window.__dvBound = true;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---- 이 폴더에서 이름 찾기 ---- */
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t.classList || !t.classList.contains('dv-filter')) return;
    var q = t.value.trim().toLowerCase(), shown = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.dv-row'), function (r) {
      var hit = !q || (r.getAttribute('data-name') || '').indexOf(q) !== -1;
      r.hidden = !hit; if (hit) shown++;
    });
    var none = document.querySelector('.dv-none'); if (none) none.hidden = shown > 0;
  });

  /* ---- 재생/보기 창 ---- */
  var ov = null, lastFocus = null;
  function close() {
    if (!ov) return;
    var m = ov.querySelector('video,audio'); if (m) { try { m.pause(); m.removeAttribute('src'); m.load(); } catch (e) {} }
    ov.remove(); ov = null; document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  function open(a) {
    close(); lastFocus = a;
    var kind = a.getAttribute('data-dv-open'), src = a.getAttribute('data-dv-src'), dl = a.getAttribute('data-dv-dl'), title = a.getAttribute('data-dv-title') || '';
    var media = kind === 'video' ? '<video class="dv-media" src="' + esc(src) + '" controls autoplay playsinline preload="metadata"></video>'
      : kind === 'audio' ? '<div class="dv-audiowrap"><audio class="dv-media" src="' + esc(src) + '" controls autoplay preload="metadata"></audio></div>'
      : kind === 'image' ? '<img class="dv-media" src="' + esc(src) + '" alt="' + esc(title) + '">'
      : '<iframe class="dv-media dv-pdf" src="' + esc(src) + '" title="' + esc(title) + '"></iframe>';
    ov = document.createElement('div');
    ov.className = 'dv-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title);
    ov.innerHTML = '<div class="dv-box dv-' + esc(kind) + '"><div class="dv-head"><b class="dv-title">' + esc(title) + '</b>' +
      '<a class="ph-btn dv-dl" href="' + esc(dl) + '">내려받기</a><a class="ph-btn dv-new" href="' + esc(src) + '" target="_blank" rel="noopener">새 창</a>' +
      '<button type="button" class="ph-btn dv-x" aria-label="닫기">✕</button></div>' + media +
      '<p class="dv-err" hidden>이 파일은 브라우저에서 바로 재생되지 않아요. "내려받기"로 받아서 열어 주세요.</p></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov || (e.target.closest && e.target.closest('.dv-x'))) close(); });
    var m = ov.querySelector('.dv-media');
    if (m && kind !== 'pdf') m.addEventListener('error', function () { var er = ov && ov.querySelector('.dv-err'); if (er) er.hidden = false; }, true);
    document.body.appendChild(ov); document.body.style.overflow = 'hidden';
    var x = ov.querySelector('.dv-x'); if (x) x.focus();
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target.closest ? e.target.closest('a[data-dv-open]') : null;
    if (!a) return;
    e.preventDefault(); open(a);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  /* ---- 콘티에 연결 — 날짜(또는 주일 외 찬양) · 연습/예배 · 제목을 골라 POST /drive/link ---- */
  function linkDialog(btn) {
    close(); lastFocus = btn;
    var card = btn.closest('.dv-card') || document.querySelector('.dv-card') || document.body;
    var team = card.getAttribute('data-dv-team') || '', to = card.getAttribute('data-dv-to') || '', toLabel = card.getAttribute('data-dv-to-label') || '';
    var evs = []; try { evs = JSON.parse(card.getAttribute('data-dv-events') || '[]'); } catch (e) { evs = []; }
    var kind = btn.getAttribute('data-dv-kind') === '예배' ? '예배' : '연습';
    var where = to
      ? '<p class="dv-fixed"><b>' + esc(toLabel) + '</b> 에 연결해요</p><input type="hidden" name="to" value="' + esc(to) + '">'
      : '<label class="dv-fl">어느 예배?<select name="event" class="dv-ev"><option value="">주일예배 — 아래 날짜</option>' +
          evs.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.label) + '</option>'; }).join('') + '</select></label>' +
        '<label class="dv-fl dv-datefl">날짜 (주일)<input type="date" name="date" required value="' + esc(btn.getAttribute('data-dv-date') || '') + '"></label>';
    ov = document.createElement('div');
    ov.className = 'dv-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '콘티에 연결');
    ov.innerHTML = '<form class="dv-box dv-linkbox" method="post" action="/drive/link">' +
      '<div class="dv-head"><b class="dv-title">콘티에 연결</b><button type="button" class="ph-btn dv-x" aria-label="닫기">✕</button></div>' +
      '<p class="dv-fname">' + esc(btn.getAttribute('data-dv-name') || '') + '</p>' +
      '<input type="hidden" name="team" value="' + esc(team) + '"><input type="hidden" name="p" value="' + esc(btn.getAttribute('data-dv-link') || '') + '">' +
      where +
      '<div class="dv-fl">구분<div class="dv-seg">' +
        '<label><input type="radio" name="구분" value="연습"' + (kind === '연습' ? ' checked' : '') + '> 연습 녹음</label>' +
        '<label><input type="radio" name="구분" value="예배"' + (kind === '예배' ? ' checked' : '') + '> 예배 녹음</label></div></div>' +
      '<label class="dv-fl">제목<input type="text" name="제목" maxlength="80" value="' + esc(btn.getAttribute('data-dv-title-def') || '') + '"></label>' +
      '<button type="submit" class="ph-btn pri dv-submit">연결하기</button>' +
      '<p class="dv-hint">연결하면 그 날 예배콘티의 녹음 칸에 들어가고, 앱의 녹음 플레이어로 재생돼요. 파일은 NAS 에 그대로 있어요.</p></form>';
    ov.addEventListener('click', function (e) { if (e.target === ov || (e.target.closest && e.target.closest('.dv-x'))) close(); });
    var ev = ov.querySelector('.dv-ev'), dfl = ov.querySelector('.dv-datefl');
    if (ev && dfl) ev.addEventListener('change', function () { var on = !ev.value; dfl.hidden = !on; dfl.querySelector('input').required = on; });
    ov.querySelector('form').addEventListener('submit', function () { var b = ov && ov.querySelector('.dv-submit'); if (b) { b.disabled = true; b.textContent = '연결하는 중…'; } });
    document.body.appendChild(ov); document.body.style.overflow = 'hidden';
    var first = ov.querySelector('select, input[type=date], .dv-submit'); if (first) first.focus();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-dv-link]') : null;
    if (!b) return;
    e.preventDefault(); linkDialog(b);
  });

  /* ---- 콘티 「녹음 찾기」 — GET /drive/suggest 로 이 예배의 녹음일 만한 파일을 받아 추천 목록 · 미리 듣기 · 바로 연결 ---- */
  function suggestHtml(d, team) {
    if (!d.ok) return '<p class="dv-sg-msg bad">' + esc(d.error || '찾지 못했어요.') + '</p>';
    var head = '<div class="dv-sg-head"><b>' + esc(d.target.label) + '</b> 녹음일 만한 파일' + (d.items.length ? ' ' + d.items.length + '개' : '') +
      '<span class="dv-sg-scan">폴더 ' + d.scanned.dirs + '개 · 녹음 · 영상 ' + d.scanned.files + '개를 살펴봤어요' + (d.scanned.truncated ? ' (일부)' : '') + '</span></div>';
    if (!d.items.length) return head + '<p class="dv-sg-msg">날짜가 맞는 파일을 찾지 못했어요. 파일 이름에 날짜(예: 2026-10-18)가 있거나 그 주에 올린 파일을 찾아요. "드라이브에서 직접 고르기"로 골라 주세요.</p>';
    return head + '<div class="dv-sg-list">' + d.items.map(function (x) {
      var other = x.kind === '예배' ? '연습' : '예배';
      return '<div class="dv-sg-item' + (x.linked ? ' linked' : '') + '">' +
        '<div class="dv-sg-main"><b class="dv-sg-name">' + esc(x.name) + '</b>' +
          '<span class="dv-sg-sub">' + esc([x.media === 'video' ? '영상' : '녹음', x.folder, x.date, x.size].filter(Boolean).join(' · ')) + '</span>' +
          '<span class="dv-sg-why">' + x.reasons.map(function (r) { return '<i>' + esc(r) + '</i>'; }).join('') + '</span></div>' +
        '<div class="dv-sg-acts">' +
          '<button type="button" class="dv-sg-play" data-dv-preview="' + esc(x.play) + '" data-dv-title="' + esc(x.title) + '">미리 듣기</button>' +
          (x.linked ? '<span class="dv-sg-done">연결됨</span>' :
          '<form method="post" action="/drive/link" class="dv-sg-form">' +
            '<input type="hidden" name="team" value="' + esc(team) + '"><input type="hidden" name="p" value="' + esc(x.path) + '">' +
            '<input type="hidden" name="to" value="' + esc(d.target.to) + '"><input type="hidden" name="제목" value="' + esc(x.title) + '">' +
            '<button type="submit" name="구분" value="' + esc(x.kind) + '" class="pri">' + esc(x.kind) + ' 녹음으로 연결</button>' +
            '<button type="submit" name="구분" value="' + esc(other) + '">' + (other === '예배' ? '예배로' : '연습으로') + '</button></form>') +
        '</div></div>';
    }).join('') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-dv-suggest]') : null;
    if (!b) return;
    e.preventDefault();
    var box = b.parentNode && b.parentNode.parentNode ? b.parentNode.parentNode.querySelector('.dv-sugg') : null;
    if (!box) return;
    if (!box.hidden && box.getAttribute('data-done')) { box.hidden = true; box.removeAttribute('data-done'); return; }   // 다시 누르면 접기
    var team = b.getAttribute('data-team') || '';
    box.hidden = false; box.innerHTML = '<p class="dv-sg-msg">드라이브에서 찾는 중… (폴더가 많으면 조금 걸려요)</p>';
    b.disabled = true;
    var q = '?team=' + encodeURIComponent(team) + '&to=' + encodeURIComponent(b.getAttribute('data-to') || '') + '&prac=' + encodeURIComponent(b.getAttribute('data-prac') || '');
    fetch((window.PH_BASE || '') + '/drive/suggest' + q, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { box.innerHTML = suggestHtml(d, team); box.setAttribute('data-done', '1'); })
      .catch(function () { box.innerHTML = '<p class="dv-sg-msg bad">드라이브에 연결하지 못했어요. 잠시 뒤에 다시 눌러 주세요.</p>'; })
      .then(function () { b.disabled = false; });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-dv-preview]') : null;
    if (!b) return;
    e.preventDefault();
    var src = b.getAttribute('data-dv-preview'), title = b.getAttribute('data-dv-title') || '미리 듣기';
    if (window.PHRec) { if (window.PHRec.current() === src) window.PHRec.toggle(); else window.PHRec.play([{ src: src, title: title, by: '드라이브 · 미리 듣기' }], 0); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f.classList || !f.classList.contains('dv-sg-form')) return;
    Array.prototype.forEach.call(f.querySelectorAll('button'), function (x) { x.disabled = true; });
    var s = e.submitter; if (s) { var h = document.createElement('input'); h.type = 'hidden'; h.name = s.name; h.value = s.value; f.appendChild(h); s.textContent = '연결하는 중…'; }
  }, true);
})();
