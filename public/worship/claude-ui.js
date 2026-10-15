/**
 * V873 — 라이브 악보 Claude AI (정해진 계정에서만 — 서버 lib/claudeAi.js 가 확인)
 * ------------------------------------------------------------
 * 「⋯」 메뉴에 "Claude AI" 단추를 붙이고(쓸 수 있는 계정일 때만), 떠 있는 창에서
 *   A. 놓친 코드 찾기 — 이 페이지 그림을 Claude 가 읽어 자동 인식이 놓친 코드를 넣음 (다르게 읽은 코드는 골라서 바꾸기)
 *   B. 코드 악보 만들기 — 이 곡 페이지들을 가사 + 코드(ChordPro)로 옮기고, 바꾼 키로 보여 주기 · 인쇄 · 복사
 *   C. 곡 정보 읽기 — Key · BPM · 박자 · 송폼 → 곡 정보 / 원래 조에 넣기
 *   D. 악보에 대고 묻기 — 작은 대화창
 * 가볍게: 창을 열 때만 그림을 만들고, 서버에 묻는 것도 누를 때만. 다른 분 화면에는 아무것도 생기지 않습니다.
 */
(function (root) {
  'use strict';
  var doc = root.document;
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function I(n) { return root.YNIcon ? root.YNIcon.get(n) : ''; }
  var CP_CSS =
    '.yn-cp{font:600 16px/1.25 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",Helvetica,Arial,sans-serif;color:#16130e}.yn-cp h1{margin:0 0 2px;font-size:22px}.yn-cp .meta{color:#7a6f5c;font-size:13px;margin-bottom:12px}' +
    '.yn-cp .sec{margin:16px 0 4px;font-weight:800;font-size:13px;color:#a35a12;text-transform:none}.yn-cp .ln{margin:2px 0 6px;white-space:normal}.yn-cp .sg{display:inline-flex;flex-direction:column;vertical-align:bottom;white-space:pre}' +
    '.yn-cp .sg b{min-height:1.15em;font-size:14.5px;font-weight:800;color:#b4530b;padding-right:6px}.yn-cp .sg i{font-style:normal}.yn-cp .ln.ch .sg b{font-size:15.5px;padding-right:14px}';
  var CSS =
    '.pv-aip{position:absolute;right:14px;top:70px;z-index:58;width:min(400px,calc(100% - 24px));max-height:calc(100% - 90px);display:flex;flex-direction:column;border-radius:18px;background:rgba(14,18,22,.97);color:#f4f1ec;border:1px solid rgba(255,255,255,.16);box-shadow:0 18px 50px rgba(0,0,0,.55);font:600 14px/1.5 -apple-system,"Apple SD Gothic Neo",Helvetica,Arial,sans-serif;overflow:hidden}' +
    '.pv-compact .pv-aip{left:8px;right:8px;width:auto;top:auto;bottom:8px;max-height:78%}' +
    '.pv-aip .hd{display:flex;align-items:center;gap:8px;padding:11px 12px 9px 14px;border-bottom:1px solid rgba(255,255,255,.1)}.pv-aip .hd b{font-size:15px;flex:1}.pv-aip .hd small{font-weight:600;color:#a9a39a;font-size:12px}' +
    '.pv-aip .hd button{width:34px;height:34px;border-radius:10px;border:0;background:rgba(255,255,255,.08);color:inherit;display:flex;align-items:center;justify-content:center}' +
    '.pv-aip .bd{overflow:auto;padding:12px 14px 14px;-webkit-overflow-scrolling:touch}' +
    '.pv-aip .acts{display:grid;grid-template-columns:1fr;gap:7px}' +
    '.pv-aip .act{display:flex;align-items:center;gap:10px;text-align:left;min-height:46px;padding:8px 12px;border-radius:13px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:inherit;font:inherit}' +
    '.pv-aip .act .yi{width:22px;height:22px;color:var(--ai-acc,#D6B97F);flex:none}.pv-aip .act span{display:block}.pv-aip .act small{display:block;font-weight:500;color:#a9a39a;font-size:12px;line-height:1.35}' +
    '.pv-aip .act:disabled{opacity:.5}' +
    '.pv-aip .out{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);font-size:13.5px;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}.pv-aip .out:empty{display:none}.pv-aip .out.bad{border-color:rgba(255,120,120,.6);color:#ffb3b3}' +
    '.pv-aip .out .row{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;white-space:normal}.pv-aip .out button,.pv-aip .chat button{min-height:36px;padding:0 13px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.09);color:inherit;font:700 13px -apple-system,Helvetica,Arial,sans-serif}' +
    '.pv-aip .out button.pri,.pv-aip .chat button.pri{background:var(--ai-acc,#D6B97F);color:#14110b;border-color:transparent}' +
    '.pv-aip .out table{border-collapse:collapse;margin-top:2px;white-space:normal}.pv-aip .out td{padding:3px 12px 3px 0;vertical-align:top}.pv-aip .out td:first-child{color:#a9a39a;font-weight:600}' +
    '.pv-aip .spin{display:inline-block;width:14px;height:14px;margin-right:7px;vertical-align:-2px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:var(--ai-acc,#D6B97F);animation:pvaisp .8s linear infinite}@keyframes pvaisp{to{transform:rotate(360deg)}}' +
    '.pv-aip h5{margin:14px 0 6px;font-size:12.5px;color:var(--ai-acc,#D6B97F);letter-spacing:.02em}' +
    '.pv-aip .msgs{display:flex;flex-direction:column;gap:7px}.pv-aip .msg{padding:8px 11px;border-radius:12px;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}.pv-aip .msg.u{align-self:flex-end;background:rgba(214,185,127,.2);max-width:88%}.pv-aip .msg.a{background:rgba(255,255,255,.06);max-width:96%}' +
    '.pv-aip .chat{display:flex;gap:7px;margin-top:8px}.pv-aip .chat textarea{flex:1;min-height:40px;max-height:120px;resize:none;padding:9px 11px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:inherit;font:600 15px/1.4 -apple-system,Helvetica,Arial,sans-serif}' +
    '.pv-aip .chat button{width:44px;padding:0;display:flex;align-items:center;justify-content:center}.pv-aip .chat button .yi{width:20px;height:20px}' +
    '.pv-aich{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(8,10,12,.62);padding:14px}' +
    '.pv-aich .box{width:min(820px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:18px;background:#fffdf8;color:#16130e;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden}' +
    '.pv-aich .tb{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e8e1d3;background:#f6f1e6}.pv-aich .tb b{flex:1;min-width:140px;font:800 15px -apple-system,Helvetica,Arial,sans-serif}' +
    '.pv-aich .tb button{min-height:36px;padding:0 12px;border-radius:10px;border:1px solid #d9cfbc;background:#fff;color:#16130e;font:700 13px -apple-system,Helvetica,Arial,sans-serif}.pv-aich .tb button[aria-pressed=true]{background:#16130e;color:#fff;border-color:#16130e}' +
    '.pv-aich .sheet{overflow:auto;padding:18px 22px 30px}' +
    CP_CSS +
    'html[data-theme=light] .pv-aip{background:rgba(255,255,255,.98);color:#16130e;border-color:rgba(15,23,42,.14)}html[data-theme=light] .pv-aip .hd button,html[data-theme=light] .pv-aip .act,html[data-theme=light] .pv-aip .out,html[data-theme=light] .pv-aip .out button,html[data-theme=light] .pv-aip .chat textarea,html[data-theme=light] .pv-aip .chat button{background:#f5f6f8;border-color:rgba(15,23,42,.14);color:#16130e}' +
    'html[data-theme=light] .pv-aip .act small,html[data-theme=light] .pv-aip .hd small,html[data-theme=light] .pv-aip .out td:first-child{color:#5b6472}html[data-theme=light] .pv-aip .msg.a{background:#f1f3f5}html[data-theme=light] .pv-aip .msg.u{background:rgba(14,124,134,.12)}' +
    'html[data-theme=light] .pv-aip{--ai-acc:#0E7C86}html[data-theme=light] .pv-aip .out button.pri,html[data-theme=light] .pv-aip .chat button.pri{color:#fff}' +
    '.pv-worship .pv-aibtn{display:none!important}';

  function injectCss() { if (doc.getElementById('yn-claude-css')) return; var s = doc.createElement('style'); s.id = 'yn-claude-css'; s.textContent = CSS; doc.head.appendChild(s); }

  /* ---------------- ChordPro → 화면 (키 바꾸기는 harmony-core 로) ---------------- */
  function parseCP(text) {
    var out = { title: '', key: '', lines: [] };
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var ln = raw.replace(/\s+$/, ''); if (!ln.trim()) { out.lines.push({ blank: 1 }); return; }
      var m = /^\s*\{\s*([a-z_]+)\s*:\s*(.*?)\s*\}\s*$/i.exec(ln);
      if (m) { var k = m[1].toLowerCase(); if (k === 'title' || k === 't') out.title = m[2]; else if (k === 'key') out.key = m[2]; else if (k === 'comment' || k === 'c' || k === 'start_of_chorus' || k === 'soc') out.lines.push({ sec: m[2] || (k.indexOf('chorus') >= 0 || k === 'soc' ? 'Chorus' : '') }); return; }
      if (/^\s*\{/.test(ln)) return;
      var segs = [], re = /\[([^\]]*)\]/g, last = 0, cur = { c: '', t: '' }, mm;
      while ((mm = re.exec(ln))) { cur.t += ln.slice(last, mm.index); if (cur.c || cur.t) segs.push(cur); cur = { c: mm[1], t: '' }; last = re.lastIndex; }
      cur.t += ln.slice(last); if (cur.c || cur.t) segs.push(cur);
      out.lines.push({ segs: segs, chordOnly: segs.every(function (s) { return !s.t.trim(); }) });
    });
    return out;
  }
  function renderCP(cp, semis, flats, HC, keyLabel) {
    var tr = function (c) { if (!semis || !HC) return c; var t = HC.transposeChord(c, semis, flats); return t || c; };
    var html = '<div class="yn-cp"><h1>' + h(cp.title || '') + '</h1><div class="meta">' + h(keyLabel || '') + '</div>';
    cp.lines.forEach(function (L) {
      if (L.blank) return;
      if (L.sec != null) { html += '<div class="sec">' + h(L.sec) + '</div>'; return; }
      html += '<div class="ln' + (L.chordOnly ? ' ch' : '') + '">' + L.segs.map(function (s) { return '<span class="sg"><b>' + h(s.c ? tr(s.c) : '') + '</b><i>' + h(s.t || (s.c ? ' ' : '')) + '</i></span>'; }).join('') + '</div>';
    });
    return html + '</div>';
  }
  function cpText(cp, semis, flats, HC) {
    var tr = function (c) { if (!semis || !HC) return c; return HC.transposeChord(c, semis, flats) || c; }, out = [];
    if (cp.title) out.push('{title: ' + cp.title + '}');
    cp.lines.forEach(function (L) { if (L.blank) out.push(''); else if (L.sec != null) out.push('{comment: ' + L.sec + '}'); else out.push(L.segs.map(function (s) { return (s.c ? '[' + tr(s.c) + ']' : '') + s.t; }).join('')); });
    return out.join('\n');
  }

  function attach(P, o) {
    if (!P || !P.callServer || !P.opts || !P.opts.token || P.opts.readOnly) return null;
    var el = o.el, toast = o.toast || function () {}, HC = root.YNHarmony, st = { open: false, busy: false, hist: [], imgPg: null, left: null, enabled: false };
    function call(task, payload) {
      return new Promise(function (res, rej) { P.callServer('worshipClaude', [P.opts.token, task, payload || {}], function (r) { if (r && r.left != null) st.left = r.left; res(r); }, function (e) { rej(e instanceof Error ? e : new Error((e && e.message) || String(e || '실패'))); }); });
    }
    call('status').then(function (r) {
      if (!r || !r.allowed) return;
      st.enabled = !!r.enabled; injectCss(); addButton();
      if (st.enabled) P.claude = function (task, payload) { return call(task, payload); };       // V874 — 악보 화질 보정(sheetfix.js)도 Claude 를 씀 (이 계정에서만)
    }, function () { /* 쓸 수 없는 계정 · 서버 없음 → 아무것도 하지 않음 */ });

    var btn = null, pane = null;
    function addButton() {
      var acts = el.querySelector('.pv-acts'); if (!acts || acts.querySelector('.pv-aibtn')) return;
      btn = doc.createElement('button'); btn.className = 'pv-b pv-aibtn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Claude AI'); btn.title = 'Claude AI — 놓친 코드 찾기 · 코드 악보 · 곡 정보 · 묻기';
      btn.innerHTML = I('ai') + '<span class="pv-mt">Claude AI</span>';
      acts.insertBefore(btn, acts.querySelector('.pv-prepbtn') || acts.firstChild);
      btn.addEventListener('click', function (e) { e.stopPropagation(); try { el.classList.remove('pv-moreopen', 'pv-drawopen'); } catch (x) {} toggle(true); });
    }
    function hz() { try { var t = P.ensureTab('harmony'); return t && t._ui; } catch (e) { return null; } }
    function fileId() { var f = P.file && P.file(); return (f && f.id) || ''; }

    /** 지금 악보의 한 페이지를 JPEG 로 (긴 변 max px) */
    function pageImage(pg, max) {
      return P.pageSize(pg).then(function (sz) {
        var sc = Math.min(3, (max || 1568) / Math.max(sz.w, sz.h)), cv = doc.createElement('canvas');
        return P.renderPageTo(cv, pg, sc).then(function () { var u = cv.toDataURL('image/jpeg', 0.84); cv.width = cv.height = 0; return u; });
      });
    }
    function songPages() {
      var n = (P.pages && P.pages()) || 1, si = P.songIdx ? P.songIdx() : -1, out = [], pg;
      if (P.pageSong && si != null && si >= 0) for (pg = 1; pg <= n; pg++) if (P.pageSong(pg) === si) out.push(pg);
      if (!out.length) out.push(P.page());
      if (out.indexOf(P.page()) < 0) out = [P.page()];
      return out.slice(0, 4);
    }
    function keyNow() {
      var ui = hz(), S = ui && ui._state, semis = 0, flats = false, okey = null, tkey = null;
      if (S && S.okey) { okey = S.okey; tkey = S.tkey; semis = S.semis || 0; flats = !!S.flats; }
      else if (P.keyShift) semis = P.keyShift() || 0;
      return { semis: semis, flats: flats, okey: okey, tkey: tkey };
    }

    function toggle(on) {
      if (!on) { if (pane) pane.remove(); pane = null; st.open = false; return; }
      if (pane) { pane.remove(); pane = null; }
      st.open = true; pane = doc.createElement('div'); pane.className = 'pv-aip'; pane.setAttribute('role', 'dialog'); pane.setAttribute('aria-label', 'Claude AI');
      pane.innerHTML = '<div class="hd">' + I('ai') + '<b>Claude AI</b><small class="lf"></small><button type="button" data-k="x" aria-label="닫기">' + I('close') + '</button></div>' +
        '<div class="bd">' +
          (st.enabled ? '' : '<div class="out bad">서버에 Claude API 키가 아직 없습니다 — Render 의 환경 변수 ANTHROPIC_API_KEY 에 키를 넣으면 바로 켜집니다.</div>') +
          '<div class="acts">' +
            '<button type="button" class="act" data-k="chords">' + I('chord') + '<span>놓친 코드 찾기<small>이 페이지를 Claude 가 다시 읽어 빠진 코드를 넣어요</small></span></button>' +
            '<button type="button" class="act" data-k="chart">' + I('page') + '<span>코드 악보 만들기<small>이 곡을 가사 + 코드로 — 바꾼 키로 보기 · 인쇄</small></span></button>' +
            '<button type="button" class="act" data-k="info">' + I('form') + '<span>곡 정보 읽기<small>Key · BPM · 박자 · 송폼</small></span></button>' +
          '</div><div class="out" aria-live="polite"></div>' +
          '<h5>악보에 대고 묻기</h5><div class="msgs"></div>' +
          '<div class="chat"><textarea rows="1" placeholder="예: 브릿지 베이스 라인 어떻게 가요?" aria-label="질문"></textarea><button type="button" class="pri" data-k="ask" aria-label="보내기">' + I('send') + '</button></div>' +
        '</div>';
      el.appendChild(pane); paintLeft(); paintMsgs();
      ['pointerdown', 'touchstart', 'keydown', 'wheel'].forEach(function (n) { pane.addEventListener(n, function (e) { e.stopPropagation(); }, { passive: true }); });
      pane.addEventListener('click', function (e) {
        e.stopPropagation(); var b = e.target.closest && e.target.closest('button'); if (!b) return; var k = b.getAttribute('data-k');
        if (k === 'x') toggle(false); else if (k === 'chords') doChords(); else if (k === 'chart') doChart(false); else if (k === 'info') doInfo(); else if (k === 'ask') doAsk();
        else if (k === 'diff') { var ui = hz(); var n = ui ? ui.setChordTexts(st.diff || []) : 0; out(n ? 'AI 가 읽은 코드로 ' + n + '개를 바꿨어요. (화음 탭 「되돌리기」로 되돌릴 수 있어요)' : '바꿀 코드가 없어요.'); }
        else if (k === 'undo') { var u2 = hz(); if (u2 && u2.undo) u2.undo(); out('되돌렸어요.'); }
        else if (k === 'applyinfo') applyInfo(); else if (k === 'applykey') applyKey(); else if (k === 'chartagain') doChart(true);
      });
      var ta = pane.querySelector('textarea');
      ta.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doAsk(); } });
      ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
    }
    function $(s) { return pane && pane.querySelector(s); }
    function paintLeft() { var e = $('.lf'); if (e) e.textContent = st.left != null ? '오늘 ' + st.left + '번 남음' : ''; }
    function out(html, bad, raw) { var e = $('.out'); if (!e) return; e.className = 'out' + (bad ? ' bad' : ''); if (raw) e.innerHTML = html; else e.textContent = html; paintLeft(); }
    function busy(on, msg) {
      st.busy = on; Array.prototype.forEach.call(pane ? pane.querySelectorAll('.act,[data-k=ask]') : [], function (b) { b.disabled = !!on; });
      if (on) out('<span class="spin"></span>' + h(msg || 'Claude 가 악보를 보는 중…'), false, true);
    }
    function fail(e) { busy(false); out((e && e.message) || String(e), true); }

    /* ---------- A. 놓친 코드 찾기 ---------- */
    function ensureAnalyzed(ui) {
      var pg = P.page(), f = fileId();
      if (ui.hasPage(f, pg)) return Promise.resolve();
      busy(true, '먼저 이 페이지의 오선 · 코드를 읽는 중…');
      ui._analyze([pg], false, false);
      var t0 = Date.now();
      return new Promise(function (res, rej) { (function w() { if (!pane) return rej(new Error('닫혔습니다.')); if (!ui._state.busy && ui.hasPage(f, pg)) return res(); if (Date.now() - t0 > 120000) return rej(new Error('이 페이지 분석이 끝나지 않았어요. 화음 탭에서 「이 페이지 분석」을 눌러 주세요.')); if (!ui._state.busy && Date.now() - t0 > 3000 && !ui.hasPage(f, pg)) return rej(new Error('이 페이지를 분석하지 못했어요.')); setTimeout(w, 300); }()); });
    }
    function doChords() {
      if (st.busy) return; var ui = hz(); if (!ui) return out('화음 도구를 불러오지 못했습니다.', true);
      var pg = P.page(), f = fileId();
      ensureAnalyzed(ui).then(function () {
        busy(true, 'Claude 가 이 페이지의 코드를 읽는 중… (10 ~ 30초)');
        var pd = ui._state.data.pages[String(pg)], known = (pd.chords || []).map(function (c) { return { t: c.text, x: c.x + c.w / 2, y: c.y + c.h / 2 }; });
        return pageImage(pg, 1568).then(function (img) { return call('chords', { image: img, known: known }); });
      }).then(function (r) {
        if (!r) return; if (fileId() !== f || P.page() !== pg) { busy(false); return out('그 사이 페이지가 바뀌어 넣지 않았어요. 다시 눌러 주세요.', true); }
        return ui.addAiChords(r.chords || []).then(function (a) {
          busy(false); st.diff = a.diff;
          var msg = 'Claude 가 코드 ' + (r.chords || []).length + '개를 읽었어요.\n' + (a.added ? '· 빠진 코드 ' + a.added + '개를 넣었어요 (점선 칩 = AI 가 넣은 코드 — 틀리면 길게 눌러 고치기).' : '· 새로 넣을 코드는 없어요.') + '\n· 자동 인식과 같은 코드 ' + a.same + '개';
          if (a.diff.length) msg += '\n· 다르게 읽은 코드 ' + a.diff.length + '개: ' + a.diff.slice(0, 8).map(function (d) { return d.from + ' → ' + d.to; }).join(', ') + (a.diff.length > 8 ? ' …' : '');
          out(h(msg) + '<div class="row">' + (a.diff.length ? '<button type="button" class="pri" data-k="diff">다르게 읽은 것을 AI 쪽으로 바꾸기</button>' : '') + (a.added ? '<button type="button" data-k="undo">넣은 코드 되돌리기</button>' : '') + '</div>', false, true);
          if (a.added) toast('Claude 가 빠진 코드 ' + a.added + '개를 넣었어요');
        });
      }).catch(fail);
    }

    /* ---------- B. 코드 악보 만들기 ---------- */
    function cacheKey(pgs) { return 'yn.pv.ai.chart.' + fileId() + ':' + pgs.join(','); }
    function doChart(again) {
      if (st.busy) return; var pgs = songPages(), key = cacheKey(pgs), song = P.song && P.song(), hit = null;
      if (!again) { try { hit = root.localStorage.getItem(key); } catch (e) { hit = null; } }
      if (hit) { showChart(hit, pgs); out('저장해 둔 코드 악보를 열었어요.' + '<div class="row"><button type="button" data-k="chartagain">새로 만들기</button></div>', false, true); return; }
      busy(true, 'Claude 가 ' + pgs.length + '페이지를 가사 + 코드로 옮기는 중… (20 ~ 60초)');
      Promise.all(pgs.map(function (p) { return pageImage(p, pgs.length > 2 ? 1400 : 1568); })).then(function (imgs) {
        return call('chart', { images: imgs, title: (song && song.title) || '' });
      }).then(function (r) {
        busy(false); if (!r || !r.chordpro) return out('코드 악보를 만들지 못했어요.', true);
        try { root.localStorage.setItem(key, r.chordpro); } catch (e) { /* 공간 부족 */ }
        out('코드 악보를 만들었어요.' + '<div class="row"><button type="button" data-k="chartagain">새로 만들기</button></div>', false, true);
        showChart(r.chordpro, pgs);
      }).catch(fail);
    }
    function showChart(text, pgs) {
      var cp = parseCP(text), K = keyNow(), okey = HC && cp.key ? HC.parseKey(cp.key) : null;
      var semis = K.semis, view = semis ? 'to' : 'orig';
      var tkey = okey && HC ? { tonic: ((okey.tonic + semis) % 12 + 12) % 12, minor: okey.minor } : null, flats = tkey ? HC.keyUsesFlats(tkey) : K.flats;
      var wrap = doc.createElement('div'); wrap.className = 'pv-aich';
      var lab = function (v) { return v === 'orig' ? '원래 키' + (okey ? ' ' + HC.keyName(okey) : '') : '바꾼 키' + (tkey ? ' ' + HC.keyName(tkey) : '') + ' (' + (semis > 0 ? '+' : '') + semis + ')'; };
      function paint() {
        var s = view === 'to' ? semis : 0, f = view === 'to' ? flats : (okey ? HC.keyUsesFlats(okey) : false);
        wrap.querySelector('.sheet').innerHTML = renderCP(cp, s, f, HC, 'Key ' + (view === 'to' && tkey ? HC.keyName(tkey) : (okey ? HC.keyName(okey) : cp.key || '?')) + ' · Claude 가 옮겨 적음 — 틀린 곳은 원본 악보로 확인해 주세요');
        Array.prototype.forEach.call(wrap.querySelectorAll('[data-v]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === view ? 'true' : 'false'); });
      }
      wrap.innerHTML = '<div class="box" role="dialog" aria-label="코드 악보"><div class="tb"><b>' + h(cp.title || ((P.song && P.song()) || {}).title || '코드 악보') + '</b>' +
        '<button type="button" data-v="orig">' + h(lab('orig')) + '</button>' + (semis ? '<button type="button" data-v="to">' + h(lab('to')) + '</button>' : '') +
        '<button type="button" data-a="print">인쇄 · PDF</button><button type="button" data-a="copy">복사</button><button type="button" data-a="x">닫기</button></div><div class="sheet"></div></div>';
      doc.body.appendChild(wrap); paint();
      ['pointerdown', 'touchstart', 'keydown', 'wheel'].forEach(function (n) { wrap.addEventListener(n, function (e) { e.stopPropagation(); if (n === 'keydown' && e.key === 'Escape') wrap.remove(); }, { passive: n !== 'keydown' }); });
      wrap.addEventListener('click', function (e) {
        if (e.target === wrap) { wrap.remove(); return; }
        var b = e.target.closest && e.target.closest('button'); if (!b) return;
        if (b.getAttribute('data-v')) { view = b.getAttribute('data-v'); paint(); return; }
        var a = b.getAttribute('data-a');
        if (a === 'x') wrap.remove();
        else if (a === 'copy') { var t = cpText(cp, view === 'to' ? semis : 0, flats, HC); try { root.navigator.clipboard.writeText(t).then(function () { toast('ChordPro 로 복사했어요'); }, function () { toast('복사하지 못했어요', true); }); } catch (x) { toast('복사하지 못했어요', true); } }
        else if (a === 'print') {
          var w = root.open('', '_blank'); if (!w) { toast('팝업이 막혀 인쇄 창을 열지 못했어요', true); return; }
          w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + h(cp.title || '코드 악보') + '</title><style>@page{size:letter;margin:14mm}body{margin:0}' + CP_CSS + '.yn-cp .ln{break-inside:avoid}</style></head><body>' + wrap.querySelector('.sheet').innerHTML + '<script>setTimeout(function(){print()},300)<\/script></body></html>');
          w.document.close();
        }
      });
    }

    /* ---------- C. 곡 정보 읽기 ---------- */
    function doInfo() {
      if (st.busy) return; var pg = songPages()[0], song = P.song && P.song();
      busy(true, 'Claude 가 Key · BPM · 송폼을 읽는 중…');
      pageImage(pg, 1568).then(function (img) { return call('info', { image: img, title: (song && song.title) || '' }); }).then(function (r) {
        busy(false); st.info = r;
        var rows = [['제목', r.title], ['Key', r.key], ['BPM', r.bpm || ''], ['박자', r.time], ['송폼', r.form]].filter(function (x) { return x[1]; });
        out('<table>' + rows.map(function (x) { return '<tr><td>' + h(x[0]) + '</td><td>' + h(x[1]) + '</td></tr>'; }).join('') + '</table>' + (r.note ? '<div style="margin-top:6px;opacity:.8">' + h(r.note) + '</div>' : '') +
          '<div class="row">' + ((r.bpm || r.form) && song ? '<button type="button" class="pri" data-k="applyinfo">BPM · 송폼을 곡 정보에 저장</button>' : '') + (r.key ? '<button type="button" data-k="applykey">원래 조를 ' + h(r.key) + ' 로</button>' : '') + '</div>', false, true);
      }).catch(fail);
    }
    function applyInfo() {
      var r = st.info, i = P.songIdx ? P.songIdx() : -1; if (!r || i == null || i < 0 || !P.saveSongInfo) return;
      var patch = {}; if (r.bpm) patch.bpm = String(r.bpm); if (r.form) patch.form = r.form;
      P.saveSongInfo(i, patch, function (ok) { out(ok ? '곡 정보에 저장했어요.' : '저장하지 못했어요.', !ok); });
    }
    function applyKey() {
      var r = st.info, ui = hz(); if (!r || !r.key || !ui || !HC || !HC.parseKey(r.key)) return out('이 Key 를 읽지 못했어요.', true);
      ui._state.data.orig = HC.keyName(HC.parseKey(r.key)); delete ui._state.data.target; ui._commit();
      out('화음 탭의 원래 조를 ' + HC.keyName(HC.parseKey(r.key)) + ' 로 정했어요. 키를 바꾸면 이 조 기준으로 옮겨요.');
    }

    /* ---------- D. 묻기 ---------- */
    function paintMsgs() {
      var e = $('.msgs'); if (!e) return;
      e.innerHTML = st.hist.map(function (m) { return '<div class="msg ' + (m.role === 'user' ? 'u' : 'a') + '">' + h(m.text) + '</div>'; }).join('');
      var bd = $('.bd'); if (bd) bd.scrollTop = bd.scrollHeight;
    }
    function doAsk() {
      if (st.busy) return; var ta = $('textarea'), q = ta && ta.value.trim(); if (!q) return;
      var pg = P.page(), f = fileId(), ui = hz(), S = ui && ui._state, K = keyNow(), song = P.song && P.song();
      var pd = S && S.data && S.data.pages[String(pg)], chords = pd ? pd.chords.filter(function (c) { return c.parsed || (HC && HC.parseChord(c.text)); }).map(function (c) { return c.text; }).join(' ') : '';
      var keyInfo = K.okey && HC ? '악보 ' + HC.keyName(K.okey) + (K.semis ? ' → 지금 ' + HC.keyName(K.tkey) + ' (' + (K.semis > 0 ? '+' : '') + K.semis + ')' : '') : (K.semis ? '연습 키 ' + (K.semis > 0 ? '+' : '') + K.semis : '');
      var needImg = st.imgPg !== f + ':' + pg;
      st.hist.push({ role: 'user', text: q }); ta.value = ''; ta.style.height = ''; paintMsgs();
      busy(true, 'Claude 가 답을 쓰는 중…');
      (needImg ? pageImage(pg, 1400) : Promise.resolve('')).then(function (img) {
        return call('ask', { q: q, image: img || '', history: st.hist.slice(0, -1).slice(-8), title: (song && song.title) || '', keyInfo: keyInfo, chords: chords });
      }).then(function (r) {
        busy(false); out(''); st.imgPg = f + ':' + pg;
        st.hist.push({ role: 'assistant', text: (r && r.answer) || '(답이 없어요)' }); if (st.hist.length > 20) st.hist = st.hist.slice(-20); paintMsgs();
      }).catch(function (e) { st.hist.pop(); paintMsgs(); if (ta) ta.value = q; fail(e); });
    }

    P.on('close', function () { toggle(false); try { if (btn) btn.remove(); } catch (e) {} });
    P.on('worship', function (on) { if (on) toggle(false); });
    return { open: function () { toggle(true); }, close: function () { toggle(false); }, _st: st, _parse: parseCP, _render: renderCP };
  }

  root.YNClaude = { attach: attach, parseCP: parseCP, renderCP: renderCP };
}(typeof self !== 'undefined' ? self : this));
