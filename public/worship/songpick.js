/**
 * v9.8 — 라이브 악보: "곡 기준" 악보 고르기 (순수 계산 · 화면과 무관 · 브라우저와 Node 양쪽에서 동작)
 * ------------------------------------------------------------
 * 예전: 악보 파일을 고르면 그 파일의 페이지에서 곡이 정해졌습니다 (파일 → 곡).
 * 지금: 곡을 고르면 그 곡의 악보가 열리고, 곡에 악보가 여러 개면 그중 하나를 고릅니다 (곡 → 악보).
 *
 *  YNSongPick.analyze(ctx) → { cands, chosen, rank, alt, sheets }
 *    ctx = {
 *      sheets: [{ id, name, mine? }],            지금 악보 목록 (콘티 순서)
 *      songs:  [{ title }],                       콘티(+결단) 곡 목록
 *      ord(f)              → 올린 순서 번호      (같은 조건일 때 앞에 올린 악보가 기본)
 *      pinned(i)           → { id, page } | null  이 곡에 "고른" 악보 (팀 또는 내 설정)
 *      splitPage(f, i)     → 0 | 페이지               「곡별 악보로 저장」 해 둔 페이지 범위의 첫 페이지
 *      manualPage(f, i)    → 0 | 페이지               직접 연결해 둔 페이지 ↔ 곡 연결의 첫 페이지
 *      nameSong(f)         → 곡 번호 | -1         파일 이름에 곡 제목이 든 곡
 *    }
 *    cands[i]   곡 i 의 후보 악보 [{ idx, id, page, how }] — how: 0 고른 것 · 1 곡별 저장 · 2 직접 연결 · 3 파일 이름. 맨 앞이 기본 악보
 *    chosen[i]  곡 i 에 쓸 악보 (고른 것 → 곡별 저장 → 직접 연결 → 파일 이름 → 올린 순서) · 없으면 null
 *    rank[id]   그 악보가 "쓰이는" 첫 곡 번호 (어느 곡에도 안 쓰이면 없음)
 *    mine[i]    곡 i 에 붙인 「나만 보는 악보」 [{ idx, id, page:1, how:4 }] — 팀 악보 뒤에 넘김 순서로 (ctx.mineSong(f) → 곡 번호 | -1)
 *    alt[id]    "대체 악보" — 어느 곡의 후보이지만 어느 곡에도 안 쓰이는 악보. 값 = 그 곡에서 쓰는 악보의 번호
 *
 * 페이지를 넘겨 악보 끝에 닿으면 다음 "곡의 악보"로 갑니다. 같은 곡의 다른(대체) 악보로 넘어가지 않습니다.
 * 이 파일이 없거나 계산이 실패해도 practice.js 는 예전 방식(목록 순서대로)으로 동작합니다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.YNSongPick = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function page1(v) { v = Math.round(Number(v)); return v >= 1 && v <= 500 ? v : 1; }

  /** 곡 i 의 후보 악보 — 맨 앞이 기본 */
  function candidates(ctx, i) {
    var song = (ctx.songs || [])[i]; if (!song) return [];
    var pin = ctx.pinned ? ctx.pinned(i) : null, out = [];
    (ctx.sheets || []).forEach(function (f, idx) {
      if (!f || !f.id || f.mine) return;                            // 나만 보는 악보는 후보가 아니라 곡 뒤에 붙는 「내 악보」 (아래 analyze 의 mine)
      var how = -1, pg = 1;
      if (pin && pin.id === f.id) { how = 0; pg = page1(pin.page); }
      else if (ctx.sheetOut && ctx.sheetOut(f)) return;              // 2026-11 — 「콘티 밖 (맨 뒤)」 로 정해 둔 악보 (고른 것이 아니면 어느 곡에도 안 붙음)
      else {
        var sp = ctx.splitPage ? ctx.splitPage(f, i) : 0;
        if (sp > 0) { how = 1; pg = sp; }
        else {
          var mp = ctx.manualPage ? ctx.manualPage(f, i) : 0;
          if (mp > 0) { how = 2; pg = mp; }
          else if (ctx.nameSong && ctx.nameSong(f) === i) { how = 3; pg = 1; }
        }
      }
      if (how >= 0) out.push({ idx: idx, id: f.id, page: pg, how: how });
    });
    var ord = ctx.ord || function () { return 0; };
    out.sort(function (a, b) { return (a.how - b.how) || (ord(ctx.sheets[a.idx]) - ord(ctx.sheets[b.idx])) || (a.idx - b.idx); });
    return out;
  }

  function analyze(ctx) {
    var songs = ctx.songs || [], cands = [], chosen = [], rank = {}, candOf = {}, used = {};
    for (var i = 0; i < songs.length; i++) {
      var c = candidates(ctx, i);
      cands.push(c); chosen.push(c.length ? c[0] : null);
      for (var k = 0; k < c.length; k++) if (candOf[c[k].id] == null) candOf[c[k].id] = i;
      if (c.length) { used[c[0].id] = 1; if (rank[c[0].id] == null) rank[c[0].id] = i; }
    }
    /* 2026-11 — 나만 보는 악보를 곡에 붙여 두면(ctx.mineSong) 그 곡의 팀 악보 뒤에 넘김 순서로 들어갑니다 (대체 악보가 아님).
       그 곡에 팀 악보가 없으면 내 악보가 그 곡의 악보가 됩니다. 어느 곡에도 안 붙인 악보는 맨 뒤 */
    var mine = []; for (var mi = 0; mi < songs.length; mi++) mine.push([]);
    if (ctx.mineSong) (ctx.sheets || []).forEach(function (f, idx) {
      if (!f || !f.id || !f.mine) return;
      var si = ctx.mineSong(f); if (!(si >= 0 && si < songs.length)) return;
      var e = { idx: idx, id: f.id, page: 1, how: 4 }; mine[si].push(e);
      if (rank[f.id] == null) rank[f.id] = si;
      if (!chosen[si]) chosen[si] = e;
    });
    var alt = {};
    Object.keys(candOf).forEach(function (id) { if (!used[id]) { var ch = chosen[candOf[id]]; alt[id] = ch ? ch.idx : -1; } });
    return { cands: cands, chosen: chosen, rank: rank, alt: alt, mine: mine, sheets: ctx.sheets || [] };
  }

  /** 지금 악보(cur)에서 dir(+1 다음 · -1 이전) 쪽으로 가는 "곡 흐름"의 악보 번호 — 없으면 -1.
   *  대체 악보를 보는 중이면 그 곡 자리(쓰는 악보)를 기준으로 앞 · 뒤를 잡습니다. */
  function neighbor(an, cur, dir) {
    var sheets = an.sheets, f = sheets[cur], pos = cur;
    if (f && an.alt[f.id] != null && an.alt[f.id] >= 0) pos = an.alt[f.id];
    for (var j = pos + dir; j >= 0 && j < sheets.length; j += dir) {
      var g = sheets[j]; if (g && an.alt[g.id] == null) return j;
    }
    return -1;
  }

  /** 지금 악보 다음부터 돌아가며 미리 받아 둘 악보 번호 (대체 악보는 건너뜀) */
  function upcoming(an, cur, max) {
    var sheets = an.sheets, out = [], n = sheets.length;
    for (var k = 1; k < n && out.length < max; k++) {
      var j = (cur + k) % n, g = sheets[j]; if (g && an.alt[g.id] == null) out.push(j);
    }
    return out;
  }

  return { analyze: analyze, candidates: candidates, neighbor: neighbor, upcoming: upcoming };
}));
