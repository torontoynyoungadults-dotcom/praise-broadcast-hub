/**
 * 드라이브 화면 (routes/drive.js) — 이 폴더에서 이름 찾기 · 파일을 누르면 화면 안에서 바로 재생/보기.
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
})();
