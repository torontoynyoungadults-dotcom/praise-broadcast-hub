/**
 * v8.3 — 직접 그린 아이콘 세트 (라이브 악보 · 주일 편성)
 *
 * · 24×24 격자, 선 1.65 · 둥근 끝 · 둥근 꺾임. 같은 가족이 되도록 모두 같은 규칙으로 그렸습니다.
 * · 두 겹: 윤곽선(currentColor) + 은은한 면(.f = 같은 색 16%) + 포인트 점(.k). 글자색을 따라가므로 밝은/어두운 화면, 눌린(주황) 상태에서도 그대로 읽힙니다.
 * · 이모지 대신 쓰므로 기기마다 모양이 달라지지 않고, 크기는 글자 크기(em)를 따라갑니다.
 *
 *   YNIcon.get('pen')            → '<svg class="yi yi-pen" …>…</svg>'
 *   YNIcon.get('pen', 'extra')   → 클래스를 덧붙임
 *   YNIcon.has('pen')            → true
 *   YNIcon.names()               → 이름 목록 (시험 · 미리보기용)
 */
(function (root) {
  'use strict';
  var P = {
    /* ------------ 화면 · 이동 ------------ */
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    prev: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    next: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    up: '<path d="M6 14.5L12 8.5l6 6"/>',
    more: '<circle class="k" cx="6" cy="12" r="1.5"/><circle class="k" cx="12" cy="12" r="1.5"/><circle class="k" cx="18" cy="12" r="1.5"/>',
    fit: '<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/><rect class="f" x="8.5" y="8.5" width="7" height="7" rx="1.4"/>',
    fullscreen: '<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/>',
    crop: '<path d="M7 3.5v13a1 1 0 0 0 1 1h12.5M3.5 7h13a1 1 0 0 1 1 1v12.5"/><rect class="f" x="9.5" y="9.5" width="5" height="5" rx="1"/>',
    spread: '<path class="f" d="M12 6.8C10 5.3 7 4.8 4 5.2v12.6c3-.4 6 .1 8 1.6 2-1.5 5-2 8-1.6V5.2c-3-.4-6 .1-8 1.6z"/><path d="M12 6.8v12.6"/>',
    tablet: '<rect class="f" x="5" y="3" width="14" height="18" rx="3"/><path d="M10.5 17.6h3"/>',
    laptop: '<rect class="f" x="5" y="5" width="14" height="10.5" rx="2"/><path d="M2.8 19h18.4"/>',
    sun: '<circle class="f" cx="12" cy="12" r="3.8"/><path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4"/>',
    moon: '<path class="f" d="M19.8 14.6A8 8 0 1 1 9.4 4.2a6.4 6.4 0 0 0 10.4 10.4z"/>',
    download: '<path d="M12 4v10.5M7.5 10.2l4.5 4.5 4.5-4.5M5 19.5h14"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path class="f" d="M14.5 4.5h3a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-3z" stroke="none"/><path d="M14.5 4.5v15"/>',
    sliders: '<path d="M4 7h8M18 7h2M4 17h2M12 17h8"/><circle class="f" cx="15" cy="7" r="2.4"/><circle class="f" cx="9" cy="17" r="2.4"/>',
    gear: '<circle class="f" cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18"/>',

    /* ------------ 필기 도구 ------------ */
    hand: '<path class="f" d="M8.4 12.2V6.6a1.5 1.5 0 0 1 3 0V11l.1-5.6a1.5 1.5 0 0 1 3 0V11l.1-4a1.5 1.5 0 0 1 3 0v6.8c0 4-2.5 6.7-6.2 6.7-2.3 0-3.7-1-5-2.7L4.6 14.4a1.5 1.5 0 0 1 2.3-1.8z"/>',
    pen: '<path class="f" d="M4.2 19.8l.9-4.3L16 4.6a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.5 18.9z"/><path d="M13.8 6.8l3.4 3.4M4.2 19.8l3.4-.7"/>',
    hl: '<path class="f" d="M9.5 15.8l7-7a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8l-7 7z"/><path d="M9.5 15.8l2.8 2.8-3.4 1-2.2-.1.1-2.1z"/><path d="M14 21h6.5"/>',
    select: '<rect x="3.8" y="3.8" width="11.4" height="11.4" rx="2.2" stroke-dasharray="2.4 2.6"/><path class="f" d="M12.6 12.4l7.6 2.7-3.3 1.5-1.5 3.4z"/>',
    text: '<path d="M5.5 7V5.2h13V7M12 5.2v13.6M9 18.8h6"/>',
    chord: '<rect class="f" x="6" y="4" width="12" height="15" rx="1.2" stroke="none"/><path d="M6 4h12M6 9h12M6 14h12M6 19h12M6 4v15M10 4v15M14 4v15M18 4v15" stroke-width="1.15"/><circle class="k" cx="10" cy="11.5" r="1.7"/><circle class="k" cx="14" cy="16.5" r="1.7"/>',
    note: '<ellipse class="f" cx="8.6" cy="17.4" rx="3.3" ry="2.4" transform="rotate(-20 8.6 17.4)"/><path d="M11.6 16.6V4.6c2.6 1.4 5.6 2.8 5.2 7"/>',
    sharp: '<path d="M9.2 4.5v15M14.8 4v15"/><path d="M6.5 9.4l11-2.8M6.5 17.2l11-2.8" stroke-width="2.3"/>',
    tag: '<path class="f" d="M4 6.5A2.5 2.5 0 0 1 6.5 4h5.6a2.5 2.5 0 0 1 1.8.7l5.4 5.4a2.5 2.5 0 0 1 0 3.5l-5.7 5.7a2.5 2.5 0 0 1-3.5 0l-5.4-5.4a2.5 2.5 0 0 1-.7-1.8z"/><circle class="k" cx="8.4" cy="8.4" r="1.3"/>',
    eraser: '<path class="f" d="M5.2 15.4l8.6-8.6a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8l-6.2 6.2H8.4l-3.2-3.2a1.4 1.4 0 0 1 0-1.8z"/><path d="M9.6 11.6l5.2 5.2M11.6 19.8H20"/>',
    trash: '<path d="M4.8 7h14.4M9.6 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2V7"/><path class="f" d="M6.6 7l.8 11.6a1.7 1.7 0 0 0 1.7 1.6h5.8a1.7 1.7 0 0 0 1.7-1.6L17.4 7z"/><path d="M10.2 10.6v6M13.8 10.6v6"/>',
    undo: '<path d="M9.6 6.2L5 10.8l4.6 4.6"/><path d="M5.4 10.8h8.3a4.9 4.9 0 0 1 0 9.8H10"/>',
    redo: '<path d="M14.4 6.2l4.6 4.6-4.6 4.6"/><path d="M18.6 10.8h-8.3a4.9 4.9 0 0 0 0 9.8H14"/>',
    pin: '<path class="f" d="M9 4h6l-.9 4.6L17 11.8V14H7v-2.2l2.9-3.2z"/><path d="M12 14v6.2"/>',
    calendar: '<rect class="f" x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10.2h16"/><circle class="k" cx="8.6" cy="14.2" r="1"/><circle class="k" cx="12" cy="14.2" r="1"/>',
    lock: '<rect class="f" x="5.5" y="10.5" width="13" height="9.5" rx="2.6"/><path d="M8.6 10.5V8a3.4 3.4 0 0 1 6.8 0v2.5"/><circle class="k" cx="12" cy="15.2" r="1.2"/>',

    /* ------------ 패널 탭 · 떠 있는 창 ------------ */
    form: '<rect class="f" x="3.8" y="5" width="7" height="4.4" rx="1.4"/><rect class="f" x="13.2" y="5" width="7" height="4.4" rx="1.4"/><rect class="f" x="3.8" y="11.8" width="10.4" height="4.4" rx="1.4"/><rect class="f" x="16.2" y="11.8" width="4" height="4.4" rx="1.4"/><path d="M3.8 19.2h16.4"/>',
    metronome: '<path class="f" d="M9.4 3.8h5.2l3 14.6a1.6 1.6 0 0 1-1.6 1.9H8a1.6 1.6 0 0 1-1.6-1.9z"/><path d="M12 15.6L15.4 7"/><circle class="k" cx="14.1" cy="10.2" r="1.3"/><path d="M8.6 20.3h6.8"/>',
    harmony: '<path d="M9.2 17V6.2l9-1.9v11.4"/><path d="M9.2 9.6l9-1.9"/><ellipse class="f" cx="7" cy="17.2" rx="2.4" ry="2" transform="rotate(-18 7 17.2)"/><ellipse class="f" cx="16" cy="15.6" rx="2.4" ry="2" transform="rotate(-18 16 15.6)"/>',
    together: '<circle class="f" cx="9" cy="8.4" r="3.2"/><path class="f" d="M3.4 19.4c.3-3.2 2.6-5.2 5.6-5.2s5.3 2 5.6 5.2z"/><circle cx="17" cy="9.3" r="2.5"/><path d="M15.6 14.4c2.8-.4 4.6 1.2 5 4.1"/>',
    timer: '<circle class="f" cx="12" cy="13.4" r="7.2"/><path d="M12 9.4v4.2l2.7 1.6M9.4 3.6h5.2M12 3.6v2.6"/>',
    note: '<path d="M9.4 17.6V6.4l9.2-2v11.2"/><ellipse class="f" cx="7" cy="17.8" rx="2.6" ry="2.1" transform="rotate(-18 7 17.8)"/><ellipse class="f" cx="16.2" cy="15.8" rx="2.6" ry="2.1" transform="rotate(-18 16.2 15.8)"/>',
    page: '<path class="f" d="M7 3.8h6.6L18 8.2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-12.4a2 2 0 0 1 2-2z"/><path d="M13.4 3.8v4.6H18M8.4 13h6.2M8.4 16.2h4"/>',
    bulb: '<path class="f" d="M12 3.6a5.6 5.6 0 0 0-3.4 10.1c.6.5.9 1.1.9 1.8h5c0-.7.3-1.3.9-1.8A5.6 5.6 0 0 0 12 3.6z"/><path d="M9.6 18.4h4.8M10.6 20.8h2.8"/>',
    piano_small: '<rect class="f" x="3.5" y="5" width="17" height="14" rx="2.4"/><path d="M8.2 12.5V19M12 12.5V19M15.8 12.5V19"/><rect class="k" x="6.8" y="5" width="2.8" height="7.5" rx=".9"/><rect class="k" x="10.6" y="5" width="2.8" height="7.5" rx=".9"/><rect class="k" x="14.4" y="5" width="2.8" height="7.5" rx=".9"/>',

    /* ------------ 주일 편성 (포지션) ------------ */
    mic: '<rect class="f" x="9" y="3.4" width="6" height="10.2" rx="3"/><path d="M6 11.4a6 6 0 0 0 12 0M12 17.4v3.2M9 20.6h6"/><path d="M9 7.6h6" stroke-width="1.2"/>',
    voice: '<circle class="f" cx="12" cy="8.2" r="3.5"/><path class="f" d="M5.2 20c.4-3.9 3.1-6.2 6.8-6.2s6.4 2.3 6.8 6.2z"/>',
    piano: '<rect class="f" x="3" y="5.2" width="18" height="13.6" rx="2.6"/><path d="M7.5 12.4v6.4M12 12.4v6.4M16.5 12.4v6.4"/><rect class="k" x="6.1" y="5.2" width="2.8" height="7.6" rx=".9"/><rect class="k" x="10.6" y="5.2" width="2.8" height="7.6" rx=".9"/><rect class="k" x="15.1" y="5.2" width="2.8" height="7.6" rx=".9"/>',
    synth: '<rect class="f" x="3" y="6.6" width="18" height="11.8" rx="2.6"/><path d="M3 12.2h18M9 12.2v6.2M15 12.2v6.2"/><circle class="k" cx="7.2" cy="9.4" r="1.15"/><circle class="k" cx="10.8" cy="9.4" r="1.15"/><path d="M14.4 9.4h4"/>',
    drum: '<ellipse class="f" cx="12" cy="12" rx="7.6" ry="2.9"/><path d="M4.4 12v5.2c0 1.6 3.4 2.9 7.6 2.9s7.6-1.3 7.6-2.9V12"/><path d="M9.2 15v4.8M14.8 15v4.8"/><path d="M8.2 3.6l3.6 5.4M15.8 3.6L12.2 9"/>',
    bass: '<g transform="rotate(38 12 12)"><rect x="11.1" y="1.8" width="1.8" height="4.6" rx=".7"/><path d="M11.4 6.4V13M12.6 6.4V13"/><path class="f" d="M12 12.4c-1.4-.4-2.8.1-3.1 1.4-.3 1.1.1 1.8-.5 2.6-.9 1-1.7 1.9-1.2 3.2.5 1.5 2.6 2.5 4.8 2.5s4.3-1 4.8-2.5c.5-1.3-.3-2.2-1.2-3.2-.6-.8-.2-1.5-.5-2.6-.3-1.3-1.7-1.8-3.1-1.4z"/><path d="M10.5 17.2h3M10.5 19h3" stroke-width="1.3"/></g>',
    egt: '<g transform="rotate(38 12 12)"><rect x="10.9" y="1.6" width="2.2" height="4.4" rx=".8"/><path d="M11.3 6V12.6M12.7 6V12.6"/><path class="f" d="M12 12c-1.5-.5-3.1.1-3.4 1.6-.2 1 .1 1.5-.4 2.3-.9 1.1-1.8 2.1-1.3 3.4.5 1.4 2.8 2.4 5.1 2.4s4.6-1 5.1-2.4c.5-1.3-.4-2.3-1.3-3.4-.5-.8-.2-1.3-.4-2.3-.3-1.5-1.9-2.1-3.4-1.6z"/><path d="M9.8 16.6h4.4M9.6 18.5h4.8" stroke-width="1.5"/></g>',
    agt: '<g transform="rotate(38 12 12)"><rect x="11" y="1.6" width="2" height="4.4" rx=".8"/><path d="M11.4 6V11.4M12.6 6V11.4"/><path class="f" d="M12 10.6c-1.7 0-3 .9-3.2 2.3-.1 1 .4 1.5.2 2.4-1.5.9-2.4 2.2-2.4 3.5 0 2.2 2.4 3.6 5.4 3.6s5.4-1.4 5.4-3.6c0-1.3-.9-2.6-2.4-3.5-.2-.9.3-1.4.2-2.4-.2-1.4-1.5-2.3-3.2-2.3z"/><circle cx="12" cy="16.4" r="1.7"/></g>',
    media: '<rect class="f" x="3" y="6.4" width="12.6" height="11.2" rx="2.6"/><path class="f" d="M15.6 10.6l5.4-2.8v8.4l-5.4-2.8z"/>',
    sound: '<path class="f" d="M4 9.6h3.4L12 5.6v12.8l-4.6-4H4z"/><path d="M15.4 9.2a4.2 4.2 0 0 1 0 5.6M18.2 6.6a8 8 0 0 1 0 10.8"/>',
    ppt: '<rect class="f" x="3" y="4.2" width="18" height="12" rx="2.4"/><path d="M12 16.2v3.6M8.2 19.8h7.6"/><path d="M7.4 13V10.6M11 13V8.4M14.6 13V9.8M18 13" stroke-width="1.5"/>',
    codi: '<path class="f" d="M9 4.6h6a1 1 0 0 1 1 1V7H8V5.6a1 1 0 0 1 1-1z"/><path d="M8 6H6.6A1.6 1.6 0 0 0 5 7.6v11.8A1.6 1.6 0 0 0 6.6 21h10.8a1.6 1.6 0 0 0 1.6-1.6V7.6A1.6 1.6 0 0 0 17.4 6H16"/><path d="M8.8 13.4l2.2 2.2 4.2-4.4"/>',
    pray: '<path class="f" d="M12 3.2c.9 3.2 5 5.6 5 10.2a5 5 0 0 1-10 0c0-2 .9-3.4 2-4.6.3 1.3.9 2 1.7 2.4C10.2 8 10.6 5.4 12 3.2z"/><path d="M10.2 14.4a2 2 0 0 0 3.6 0" stroke-width="1.3"/>',
    play: '<rect class="f" x="3" y="5.2" width="18" height="13.6" rx="4.4"/><path class="k" d="M10.4 9.2l5 2.8-5 2.8z"/>'
  };
  function get(name, cls) {
    var body = P[name];
    if (!body) return '';
    return '<svg class="yi yi-' + name + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  root.YNIcon = {
    get: get,
    has: function (n) { return !!P[n]; },
    names: function () { return Object.keys(P); }
  };
})(typeof window !== 'undefined' ? window : this);
