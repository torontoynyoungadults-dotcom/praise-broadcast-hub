/**
 * 예배콘티 화면의 세 가지 보조 도구를 붙입니다(church-app의 conti.js / formb.js 자리):
 *  1) 송폼 빌더 — [data-ph-sfb-host] 빈 칸에 YNForm.mount()로 칩 빌더를 그려 넣고,
 *     바뀔 때마다 짝이 되는 숨은 input[name="송폼"]에 저장 문자열을 반영합니다.
 *  2) 유튜브 검색 보조 링크 — [data-ph-ytsearch] 를 누르면 같은 폼의 제목·팀 값으로 검색 결과를 새 탭에 엽니다.
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

  function wireYoutubeSearch(root) {
    root.querySelectorAll('[data-ph-ytsearch]:not([data-ph-yt-on])').forEach(function (a) {
      a.setAttribute('data-ph-yt-on', '1');
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        var form = a.closest('form') || a.closest('.ph-list-item') || document;
        var title = form.querySelector('input[name="제목"]');
        var team = form.querySelector('input[name="팀"]');
        var q = [title && title.value.trim(), team && team.value.trim()].filter(Boolean).join(' ');
        var url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q || '찬양');
        window.open(url, '_blank', 'noopener');
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

  function mountAll() {
    var root = document;
    mountFormBuilders(root);
    wireYoutubeSearch(root);
    wireAtTags(root);
    wireAtTagPreview(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
  document.addEventListener('ph:content-updated', mountAll);
})();
