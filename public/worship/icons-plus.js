/**
 * 찬양방송팀 허브 — 직접 그린 아이콘 추가분 (icons.js 의 YNIcon 과 같은 규칙: 24×24 · 선 1.65 · 둥근 끝 · 윤곽 + 은은한 면 + 포인트)
 * church-app 의 icons.js 에 없는 몇 개(검색 · 사진 · 헤드폰 · 반복 · 폴더 · 목사 · 팀원 …)를 더합니다. icons.js 다음에 불러옵니다.
 *   YNIcon.get('search')  ·  YI('search') (= YNIcon.get 의 짧은 이름 — 이 앱 화면 코드가 씀)
 */
(function (root) {
  'use strict';
  var base = root.YNIcon || { get: function () { return ''; }, has: function () { return false; }, names: function () { return []; } };
  var X = {
    search: '<circle class="f" cx="10.5" cy="10.5" r="5.8"/><path d="M15 15l5 5"/>',
    image: '<rect class="f" x="3.5" y="5" width="17" height="14" rx="2.6"/><circle class="k" cx="9" cy="10" r="1.5"/><path d="M4.2 17l4.8-4.4 3.8 3.4 2.8-2.4 4.4 3.6"/>',
    headphones: '<path d="M4.5 14.5V12a7.5 7.5 0 0 1 15 0v2.5"/><rect class="f" x="3.5" y="13.5" width="4.2" height="6.6" rx="1.9"/><rect class="f" x="16.3" y="13.5" width="4.2" height="6.6" rx="1.9"/>',
    repeat: '<path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H18M15.5 4.5L18 7l-2.5 2.5"/><path d="M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6M8.5 19.5L6 17l2.5-2.5"/>',
    folder: '<path class="f" d="M3.5 7.6a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    book: '<path class="f" d="M12 6.8C10 5.3 7 4.8 4 5.2v12.6c3-.4 6 .1 8 1.6 2-1.5 5-2 8-1.6V5.2c-3-.4-6 .1-8 1.6z"/><path d="M12 6.8v12.6"/>',
    cross: '<path class="f" d="M10.2 3.6h3.6v5.2h5.2v3.6h-5.2v8h-3.6v-8H5V8.8h5.2z"/>',
    pencil: '<path class="f" d="M5 19l.9-4L16.8 4a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L9 18.1z"/><path d="M14.6 6.4l3 3"/>',
    check: '<path d="M5.5 12.5l4.2 4.2L18.5 7.8"/>',
    mic2: '<rect class="f" x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7v3"/>',
    clipboard: '<path class="f" d="M9 4.6h6a1 1 0 0 1 1 1V7H8V5.6a1 1 0 0 1 1-1z"/><path d="M8 6H6.6A1.6 1.6 0 0 0 5 7.6v11.8A1.6 1.6 0 0 0 6.6 21h10.8a1.6 1.6 0 0 0 1.6-1.6V7.6A1.6 1.6 0 0 0 17.4 6H16"/>',
    wallet: '<path class="f" d="M4 8.2a2.4 2.4 0 0 1 2.4-2.4H18v3.2"/><rect class="f" x="3.5" y="8" width="17" height="11.5" rx="2.6"/><circle class="k" cx="16.4" cy="13.8" r="1.2"/>',
    folder2: '<path class="f" d="M4 5.6h5.6l2 2.4H20v10.4H4z"/>',
    user: '<circle class="f" cx="12" cy="8.2" r="3.5"/><path class="f" d="M5.2 20c.4-3.9 3.1-6.2 6.8-6.2s6.4 2.3 6.8 6.2z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    tent: '<path class="f" d="M12 4.2l8.6 14.6H3.4z"/><path d="M12 4.2v14.6M9.4 18.8L12 13.5l2.6 5.3"/>',
    wrench: '<path class="f" d="M14.6 5.2a4.4 4.4 0 0 0-5.3 5.7l-5.1 5.1a1.9 1.9 0 0 0 2.7 2.7l5.1-5.1a4.4 4.4 0 0 0 5.7-5.3l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    bell: '<path class="f" d="M6.2 16.6V11a5.8 5.8 0 0 1 11.6 0v5.6l1.5 1.8H4.7z"/><path d="M10 20.4a2.2 2.2 0 0 0 4 0"/>',
    megaphone: '<path class="f" d="M4 10.2h3.6L16 5.4v13.2l-8.4-4.8H4z"/><path d="M7.6 14l1.2 5.2"/><path d="M18.6 9.6a3.6 3.6 0 0 1 0 4.8"/>',
    broadcast: '<circle class="k" cx="12" cy="12" r="1.9"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.4 9.4 0 0 0 0 13.2M18.6 5.4a9.4 9.4 0 0 1 0 13.2"/>',
    lightbulb: '<path class="f" d="M12 3.6a5.6 5.6 0 0 0-3.4 10.1c.6.5.9 1.1.9 1.8v.4h5v-.4c0-.7.3-1.3.9-1.8A5.6 5.6 0 0 0 12 3.6z"/><path d="M9.8 19h4.4M10.6 21h2.8"/>'
  };
  function get(name, cls) {
    if (X[name]) return '<svg class="yi yi-' + name + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + X[name] + '</svg>';
    return base.get(name, cls);
  }
  root.YNIcon = {
    get: get,
    has: function (n) { return !!X[n] || base.has(n); },
    names: function () { return base.names().concat(Object.keys(X)); }
  };
  root.YI = get;
})(typeof window !== 'undefined' ? window : this);
