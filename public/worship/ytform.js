/**
 * 유튜브 송폼 태그 (v9.6) — 곡마다 올린 유튜브를 들으면서 Intro · V1 · C · B · Itld … 가 시작하는 곳을 표시해 두고,
 * 언제든 그 부분부터 바로 듣거나(누르면 이동) 그 구간만 반복해서 연습합니다.
 * ------------------------------------------------------------
 *  · 태그는 영상(유튜브 영상 ID)마다 팀에 하나 — 한 사람이 저장하면 팀 모두에게 보이고, 다음에 같은 곡(같은 영상)을 콘티에 넣어도 그대로 보입니다.
 *  · 보기: 칩을 누르면 그 부분부터 재생 · 지금 듣는 구간이 밝게 표시 · 「구간 반복」을 켜면 지금 구간만 반복
 *  · 편집(「✎ 태그 달기」): 들으면서 V1 · C · B … 를 누르면 지금 위치에 태그 → 칩을 골라 ◀ ▶ 0.5초씩 · 지금 위치로 · 삭제 → 「저장」
 *  · 화면 · 저장 방식과 무관한 모듈: 플레이어(time · seek · play · duration)와 저장(load · save)을 받아서 씁니다
 *    (라이브 악보의 유튜브 창 public/worship/ytplayer.js · 허브의 「유튜브 이어 듣기」가 함께 씀)
 *  · 순수 함수(clean · sectionAt · fmt · kindOf)는 Node 시험에서도 씁니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNYtForm = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LABELS = ['Intro', 'V1', 'V2', 'V3', 'PC', 'C', 'B', 'Itld', 'Inst', 'Tag', 'Out'];
  var MAX_TAGS = 80, MAX_T = 36000;
  var LABEL_RE = /[^A-Za-z0-9가-힣 .+\-()#']/g;

  function kindOf(k) {
    k = String(k || '').trim();
    if (/^(V|Verse|절|\d+절)/i.test(k)) return 'v';
    if (/^(PC|Pre)/i.test(k)) return 'pc';
    if (/^(C|Ch|Chorus|후렴)/i.test(k)) return 'c';
    if (/^(B|Br|Bridge|브릿지)/i.test(k)) return 'b';
    if (/^(Intro|Out|End|Ending|Outro|인트로|엔딩)/i.test(k)) return 'io';
    if (/^(Itld|Inter|Inst|간주|Solo)/i.test(k)) return 'it';
    return 'x';
  }
  /** 콘티 송폼(예: "Intro - V1 - C - V2 - C x2 - B - C - Out") → 태그 단추 이름들 (처음 나온 순서 · 겹치면 하나).
   *  송폼에 V 만 있으면 V, V4 까지 있으면 V4 — 송폼에 적힌 그대로. 송폼이 비어 있으면 [] (기본 단추를 씀) */
  function labelsFromForm(form) {
    var out = [], seen = {};
    String(form || '').split(/[\s,\/·|>→›\-–—]+/).forEach(function (raw) {
      var k = cleanLabel(String(raw).replace(/[x×*]\s*\d+$/i, '').replace(/\(\s*\d+\s*\)$/, ''));
      if (!k || /^[x×*]?\d+$/i.test(k)) return;
      var key = k.toLowerCase(); if (seen[key]) return; seen[key] = 1; out.push(k);
    });
    return out.slice(0, 24);
  }
  function cleanLabel(k) { return String(k == null ? '' : k).replace(LABEL_RE, '').replace(/\s+/g, ' ').trim().slice(0, 12); }
  /** 태그 목록 다듬기 — [{ t: 초(0.1 단위), k: 이름 }] 시간순 · 같은 시각 같은 이름은 하나 · 최대 80개 */
  function clean(tags) {
    var out = [], seen = {};
    (Array.isArray(tags) ? tags : []).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var t = Math.round(Number(x.t) * 10) / 10, k = cleanLabel(x.k);
      if (!isFinite(t) || t < 0 || t > MAX_T || !k) return;
      var key = t + '|' + k; if (seen[key]) return; seen[key] = 1;
      out.push({ t: t, k: k });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out.slice(0, MAX_TAGS);
  }
  /** 지금 시각이 들어 있는 구간(태그) 번호 — 첫 태그 앞이면 -1 */
  function sectionAt(tags, t) {
    var i = -1; if (t == null || !isFinite(t)) return -1;
    for (var n = 0; n < tags.length; n++) { if (tags[n].t <= t + 0.05) i = n; else break; }
    return i;
  }
  function fmt(sec) {
    sec = Math.max(0, +sec || 0); var m = Math.floor(sec / 60), s = Math.floor(sec - m * 60), d = Math.floor((sec * 10) % 10);
    return m + ':' + (s < 10 ? '0' : '') + s + (d ? '.' + d : '');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function same(a, b) { return JSON.stringify(clean(a)) === JSON.stringify(clean(b)); }

  var CSS = '.ytf{margin-top:10px;padding:10px 11px 11px;border-radius:12px;border:1px solid rgba(128,128,128,.32);background:rgba(128,128,128,.08);font-size:13px;line-height:1.45}' +
    '.ytf-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.ytf-head b{font-size:13.5px}.ytf-meta{font-size:11.5px;opacity:.7}.ytf-sp{flex:1}' +
    '.ytf button{font:inherit;cursor:pointer;color:inherit}' +
    '.ytf-b{min-height:34px;padding:5px 11px;border-radius:99px;border:1px solid rgba(128,128,128,.4);background:rgba(128,128,128,.12);font-weight:700;font-size:12.5px}' +
    '.ytf-b.on{background:#FF8A3D;border-color:#FF8A3D;color:#1A0E05}.ytf-b.pri{background:#FF8A3D;border-color:#FF8A3D;color:#1A0E05}.ytf-b:disabled{opacity:.45;cursor:default}' +
    '.ytf-bar{position:relative;height:12px;margin:9px 0 2px;border-radius:99px;background:rgba(128,128,128,.2);overflow:hidden;cursor:pointer}' +
    '.ytf-seg{position:absolute;top:0;bottom:0;border-right:1px solid rgba(0,0,0,.25);opacity:.75}.ytf-seg.on{opacity:1}' +
    '.ytf-now{position:absolute;top:-2px;bottom:-2px;width:2px;background:currentColor;opacity:.85;pointer-events:none}' +
    '.ytf-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '.ytf-chip{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:4px 11px 4px 9px;border-radius:10px;border:1px solid rgba(128,128,128,.35);border-left:4px solid var(--c,#888);background:rgba(128,128,128,.1);font-weight:800;font-size:13px}' +
    '.ytf-chip small{font-weight:600;opacity:.7;font-variant-numeric:tabular-nums;font-size:11.5px}' +
    '.ytf-chip.on{background:var(--c,#888);color:#111;border-color:var(--c,#888)}.ytf-chip.on small{opacity:.85}.ytf-chip.sel{outline:2px solid #FF8A3D;outline-offset:1px}' +
    '.k-v{--c:#5AA9F0}.k-pc{--c:#46BDC6}.k-c{--c:#FF9F4A}.k-b{--c:#B48CF2}.k-io{--c:#8FCB6E}.k-it{--c:#E9C46A}.k-x{--c:#A8A8A8}' +
    '.ytf-pal{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px;padding-top:9px;border-top:1px dashed rgba(128,128,128,.35)}' +
    '.ytf-pal .ytf-b{min-width:46px;border-left:4px solid var(--c,#888);border-radius:9px}' +
    '.ytf-own{display:flex;gap:5px;flex:1 1 170px;min-width:0}.ytf-own input{flex:1;min-width:0;min-height:34px;border-radius:9px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;padding:0 9px;font:inherit}' +
    '.ytf-tools{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:8px}.ytf-tools span{font-weight:800;margin-right:2px}' +
    '.ytf-empty{margin:8px 0 0;font-size:12.5px;opacity:.78}.ytf-msg{margin-top:6px;font-size:12px;min-height:0}.ytf-msg:empty{display:none}.ytf-msg.bad{color:#E5484D}.ytf-msg.ok{color:#2EA66B}' +
    '.ytf-help{margin:6px 0 0;font-size:11.5px;opacity:.7}';
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('yn-ytf-css')) return;
    var s = document.createElement('style'); s.id = 'yn-ytf-css'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
  }

  /**
   * mount(host, o) → { setVid(vid, title), refresh(), state(), destroy() }
   *   o.vid · o.title · o.songForm (콘티 송폼 — 태그 단추를 송폼에 적힌 것으로. 없으면 기본 단추)
   *   o.player : { time() → 초, seek(t), play(), duration() → 초 }    (영상이 준비되기 전에는 time() 이 null 이어도 됨)
   *   o.api    : { load(vid) → Promise<{ tags, by, at }>, save(vid, title, tags, baseAt) → Promise<{ tags, by, at }> }
   *   o.canEdit (기본 true) — false 면 보기 · 이동 · 반복만
   */
  function mount(host, o) {
    o = o || {};
    injectCss();
    var st = { labels: labelsFromForm(o.songForm), vid: o.vid || '', title: o.title || '', tags: [], by: '', at: 0, edit: false, draft: null, sel: -1, loop: false, loopI: -1, cur: -1,
      loaded: false, busy: false, dead: false, msg: '', bad: false, timer: 0, lastPaintCur: -2, own: '' };
    var canEdit = o.canEdit !== false;
    var box = document.createElement('div'); box.className = 'ytf'; host.appendChild(box);

    function P() { return o.player || {}; }
    function now() { try { var t = P().time ? P().time() : null; return t == null || !isFinite(t) ? null : +t; } catch (e) { return null; } }
    function dur() { try { var d = P().duration ? +P().duration() : 0; return isFinite(d) && d > 0 ? d : 0; } catch (e) { return 0; } }
    function seek(t, play) { try { if (P().seek) P().seek(t); if (play !== false && P().play) P().play(); } catch (e) { /* 영상 준비 전 */ } }
    function list() { return st.edit ? st.draft : st.tags; }
    function say(t, bad, ok) { st.msg = t || ''; st.bad = !!bad; st.ok = !!ok; var m = box.querySelector('.ytf-msg'); if (m) { m.textContent = st.msg; m.className = 'ytf-msg' + (bad ? ' bad' : ok ? ' ok' : ''); } }

    function barHtml(tags) {
      var d = dur(); if (!d || !tags.length) return '';
      var s = '';
      tags.forEach(function (x, i) {
        var end = i + 1 < tags.length ? tags[i + 1].t : d, l = Math.max(0, Math.min(100, x.t / d * 100)), w = Math.max(0.4, Math.min(100 - l, (end - x.t) / d * 100));
        s += '<span class="ytf-seg k-' + kindOf(x.k) + (i === st.cur ? ' on' : '') + '" data-i="' + i + '" style="left:' + l + '%;width:' + w + '%;background:var(--c)" title="' + esc(x.k + ' ' + fmt(x.t)) + '"></span>';
      });
      var t = now(); if (t != null) s += '<span class="ytf-now" style="left:' + Math.max(0, Math.min(100, t / d * 100)) + '%"></span>';
      return '<div class="ytf-bar" role="presentation">' + s + '</div>';
    }
    function draw() {
      if (st.dead) return;
      var tags = list(), metaTxt = st.by ? '팀 공유 · ' + esc(st.by) + (st.at ? ' · ' + new Date(st.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '') : (st.loaded ? '팀 공유' : '불러오는 중…');
      var h = '<div class="ytf-head"><b>송폼 구간</b><span class="ytf-meta">' + metaTxt + '</span><span class="ytf-sp"></span>';
      if (!st.edit) {
        if (st.tags.length) h += '<button type="button" class="ytf-b' + (st.loop ? ' on' : '') + '" data-a="loop" aria-pressed="' + st.loop + '" title="지금 듣는 구간(다음 태그 전까지)만 반복">🔁 구간 반복</button>';
        if (canEdit) h += '<button type="button" class="ytf-b" data-a="edit">✎ ' + (st.tags.length ? '태그 고치기' : '태그 달기') + '</button>';
      } else {
        h += '<button type="button" class="ytf-b pri" data-a="save"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? '저장 중…' : '저장 (팀 공유)') + '</button><button type="button" class="ytf-b" data-a="cancel">취소</button>';
      }
      h += '</div>' + barHtml(tags);
      if (tags.length) {
        h += '<div class="ytf-chips">' + tags.map(function (x, i) {
          return '<button type="button" class="ytf-chip k-' + kindOf(x.k) + (i === st.cur ? ' on' : '') + (st.edit && i === st.sel ? ' sel' : '') + '" data-i="' + i + '" title="' + (st.edit ? '골라서 고치기 (그 위치로 이동)' : '여기부터 듣기') + '">' + esc(x.k) + ' <small>' + fmt(x.t) + '</small></button>';
        }).join('') + '</div>';
      } else if (st.loaded) {
        h += '<p class="ytf-empty">' + (st.edit ? '영상을 들으면서 아래 V1 · C · B … 를 누르면 지금 위치에 태그가 붙어요.' : '아직 송폼 태그가 없어요.' + (canEdit ? ' 「✎ 태그 달기」를 누르고 들으면서 V · C · B 를 눌러 두면, 팀 모두가 언제든 그 부분부터 바로 들을 수 있어요.' : '')) + '</p>';
      }
      if (st.edit) {
        h += '<div class="ytf-pal" role="group" aria-label="지금 위치에 태그 붙이기">' + (st.labels.length ? st.labels : LABELS).map(function (k) { return '<button type="button" class="ytf-b k-' + kindOf(k) + '" data-add="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') +
          '<span class="ytf-own"><input type="text" maxlength="12" placeholder="직접 (예: C2, Vamp)" value="' + esc(st.own) + '" aria-label="태그 이름 직접 쓰기"><button type="button" class="ytf-b" data-a="own">＋</button></span></div>';
        var s = st.sel >= 0 ? st.draft[st.sel] : null;
        if (s) h += '<div class="ytf-tools"><span>' + esc(s.k) + ' ' + fmt(s.t) + '</span><button type="button" class="ytf-b" data-n="-0.5">◀ 0.5초</button><button type="button" class="ytf-b" data-n="0.5">0.5초 ▶</button><button type="button" class="ytf-b" data-a="here">지금 위치로</button><button type="button" class="ytf-b" data-a="del">삭제</button></div>';
        h += '<p class="ytf-help">태그는 그 부분이 "시작하는 곳"이에요. 다음 태그 전까지가 한 구간입니다. 저장하면 이 영상을 쓰는 모든 콘티에서 팀 모두에게 보여요.</p>';
      }
      h += '<div class="ytf-msg' + (st.bad ? ' bad' : st.ok ? ' ok' : '') + '" role="status">' + esc(st.msg) + '</div>';
      box.innerHTML = h;
      st.lastPaintCur = st.cur;
    }
    /* 0.25초마다: 지금 구간 표시 · 구간 반복 */
    function tick() {
      if (st.dead) return;
      var t = now(), tags = list(); if (t == null) return;
      var i = sectionAt(tags, t);
      if (st.loop && !st.edit && st.loopI >= 0 && st.tags[st.loopI]) {
        var a = st.tags[st.loopI].t, b = st.loopI + 1 < st.tags.length ? st.tags[st.loopI + 1].t : dur();
        if (b && t >= b - 0.15 && t < b + 3) { seek(a); i = st.loopI; }
        else if (t < a - 1 || t > b + 3) st.loopI = i;                         // 사용자가 다른 곳으로 옮겼으면 그 구간을 반복
      }
      if (i !== st.cur) {                                                         // 칸만 다시 칠함 (전체를 다시 그리면 직접 쓰던 태그 이름 칸이 사라짐)
        st.cur = i;
        Array.prototype.forEach.call(box.querySelectorAll('.ytf-chip,.ytf-seg'), function (c) { c.classList.toggle('on', +c.getAttribute('data-i') === i); });
      }
      var nowEl = box.querySelector('.ytf-now'), d = dur();
      if (!nowEl && d && tags.length && !(document.activeElement && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) { draw(); return; }   // 영상 길이를 알게 되면 막대를 그림
      if (nowEl && d) nowEl.style.left = Math.max(0, Math.min(100, t / d * 100)) + '%';
    }
    st.timer = setInterval(tick, 250);

    function load() {
      if (!o.api || !o.api.load || !st.vid) { st.loaded = true; draw(); return; }
      var vid = st.vid;
      Promise.resolve(o.api.load(vid)).then(function (r) {
        if (st.dead || vid !== st.vid) return;
        r = r || {}; st.tags = clean(r.tags); st.by = r.by || ''; st.at = +r.at || 0; st.loaded = true; draw();
      }, function (e) { if (st.dead || vid !== st.vid) return; st.loaded = true; say((e && e.message) || '송폼 태그를 불러오지 못했어요.', true); draw(); });
    }
    function startEdit() { st.edit = true; st.draft = st.tags.map(function (x) { return { t: x.t, k: x.k }; }); st.sel = -1; st.loop = false; say(''); draw(); }
    function stopEdit() { st.edit = false; st.draft = null; st.sel = -1; draw(); }
    function addTag(k) {
      k = cleanLabel(k); if (!k) return;
      var t = now(); if (t == null) { say('영상을 재생한 뒤에 눌러 주세요.', true); return; }
      t = Math.round(t * 10) / 10;
      st.draft.push({ t: t, k: k }); st.draft = clean(st.draft);
      st.sel = -1; st.draft.forEach(function (x, i) { if (x.t === t && x.k === k) st.sel = i; });
      say(k + ' — ' + fmt(t) + ' 에 붙였어요'); draw();
    }
    function nudge(d) {
      var s = st.draft[st.sel]; if (!s) return;
      var t = Math.max(0, Math.round((s.t + d) * 10) / 10), k = s.k;
      s.t = t; st.draft = clean(st.draft); st.draft.forEach(function (x, i) { if (x.t === t && x.k === k) st.sel = i; });
      seek(t); draw();
    }
    function save() {
      if (st.busy) return;
      var tags = clean(st.draft);
      if (same(tags, st.tags)) { stopEdit(); say('바뀐 것이 없어요.'); return; }
      if (!o.api || !o.api.save) { say('저장할 수 없어요.', true); return; }
      st.busy = true; draw();
      var vid = st.vid;
      Promise.resolve(o.api.save(vid, st.title, tags, st.at)).then(function (r) {
        st.busy = false; if (st.dead || vid !== st.vid) return;
        r = r || {}; st.tags = clean(r.tags || tags); st.by = r.by || st.by; st.at = +r.at || Date.now();
        st.edit = false; st.draft = null; st.sel = -1; say('저장했어요 — 팀 모두에게 보여요.', false, true); draw();
      }, function (e) { st.busy = false; if (st.dead) return; say((e && e.message) || '저장하지 못했어요.', true); draw(); });
    }

    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button,.ytf-seg,.ytf-bar') : null; if (!b || b.disabled) return;
      var a = b.getAttribute('data-a');
      if (b.classList.contains('ytf-bar')) { var d0 = dur(); if (!d0) return; var r = b.getBoundingClientRect(); seek(Math.max(0, (e.clientX - r.left) / r.width * d0)); return; }
      if (b.hasAttribute('data-i')) {
        var i = +b.getAttribute('data-i'), x = list()[i]; if (!x) return;
        if (st.edit) { st.sel = st.sel === i ? -1 : i; seek(x.t); draw(); return; }
        st.loopI = i; st.cur = i; seek(x.t); draw(); return;
      }
      if (b.hasAttribute('data-add')) { addTag(b.getAttribute('data-add')); return; }
      if (b.hasAttribute('data-n')) { nudge(+b.getAttribute('data-n')); return; }
      if (a === 'loop') { st.loop = !st.loop; var tt = now(); st.loopI = st.loop ? Math.max(0, sectionAt(st.tags, tt == null ? 0 : tt)) : -1; if (st.loop && tt == null) seek(st.tags[0].t); say(st.loop ? '지금 구간만 반복해요 — 다른 칩을 누르면 그 구간을 반복' : ''); draw(); }
      else if (a === 'edit') startEdit();
      else if (a === 'cancel') { if (!same(st.draft, st.tags) && typeof confirm === 'function' && !confirm('고친 태그를 저장하지 않고 닫을까요?')) return; stopEdit(); say(''); }
      else if (a === 'save') save();
      else if (a === 'own') { var inp = box.querySelector('.ytf-own input'); st.own = ''; addTag(inp ? inp.value : ''); }
      else if (a === 'here') { var s = st.draft[st.sel], t1 = now(); if (s && t1 != null) { nudge(Math.round(t1 * 10) / 10 - s.t); } }
      else if (a === 'del') { if (st.sel >= 0) { st.draft.splice(st.sel, 1); st.sel = -1; draw(); } }
    });
    box.addEventListener('input', function (e) { if (e.target && e.target.closest && e.target.closest('.ytf-own')) st.own = e.target.value; });
    box.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.closest && e.target.closest('.ytf-own')) { e.preventDefault(); st.own = ''; addTag(e.target.value); } });

    draw(); load();
    return {
      setVid: function (vid, title, songForm) { if (songForm !== undefined) { st.labels = labelsFromForm(songForm); if (vid === st.vid && st.edit) draw(); } if (vid === st.vid) return; st.vid = vid || ''; st.title = title || ''; st.tags = []; st.by = ''; st.at = 0; st.loaded = false; st.edit = false; st.draft = null; st.sel = -1; st.loop = false; st.loopI = -1; st.cur = -1; say(''); draw(); load(); },
      refresh: load,
      state: function () { return { vid: st.vid, tags: st.tags.slice(), edit: st.edit, draft: st.draft ? st.draft.slice() : null, by: st.by, at: st.at, loop: st.loop, cur: st.cur, loaded: st.loaded }; },
      destroy: function () { st.dead = true; clearInterval(st.timer); try { box.remove(); } catch (e) { /* 무시 */ } }
    };
  }

  return { LABELS: LABELS, MAX_TAGS: MAX_TAGS, clean: clean, cleanLabel: cleanLabel, labelsFromForm: labelsFromForm, sectionAt: sectionAt, fmt: fmt, kindOf: kindOf, mount: mount };
}));
