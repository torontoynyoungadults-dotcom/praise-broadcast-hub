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
})();
