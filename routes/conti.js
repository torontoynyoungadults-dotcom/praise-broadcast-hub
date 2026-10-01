/**
 * 예배콘티 — church-app의 예배콘티를 가져오되:
 *  - "이주의 말씀"(성경구절) 기능은 뺌
 *  - "가사도구"는 뺌
 *  - 녹음은 유지하지만 드라이브 폴더 자동 스캔/자동링크는 빼고, 직접 업로드 또는 링크 입력으로 대체
 *  - church-app처럼 "주일 편성"(이번 주 포지션 배정)도 콘티 화면 안에 바로 둠 (더 상세한 여러 주 보기·
 *    "안 되는 날"은 스케줄표 화면에 — 같은 찬양편성 시트를 함께 씀)
 * 로그인 없이 보는 공개 링크(팀+주차 단위, 읽기 전용)도 이 파일에서 함께 처리합니다.
 */
const express = require('express');
const upload = require('../lib/upload');
const sheetsDb = require('../lib/sheetsDb');
const driveStore = require('../lib/driveStore');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const week = require('../lib/weekUtil');
const spa = require('../lib/spa');
const { POSITION_GROUPS } = require('../lib/positions');

const router = express.Router();
const esc = pageShell.esc;

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length) {
    return spa.send(req, res,
      `${pageShell.hubNav('conti', '')}<div class="ph-card"><p class="ph-sub">아직 소속된 찬양팀이 없어요. 관리자에게 문의해주세요.</p><a class="ph-btn" href="/">← 허브로</a></div>`,
      { title: '예배콘티' },
    );
  }
  req.ctx = ctx;
  next();
}

function backTo(req, res, team, date) {
  spa.redirect(req, res, `/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}`);
}

/* ---------- 주일 편성 (church-app의 "이 주의 편성" — 이번 주 포지션 배정) ---------- */
async function teamRoster(team) {
  const members = await sheetsDb.readAll('회원');
  return members.filter((m) => String(m['소속팀'] || '').split(',').map((s) => s.trim()).includes(team)).map((m) => m['이름']).filter(Boolean);
}

function lineupCell(date, team, posKey, names, roster) {
  return `<div class="ph-poscell">
    <div class="ph-poslabel">${esc(posKey)}</div>
    <div class="ph-posnames">${names.length ? names.map((n) => `<span class="ph-namechip${roster.indexOf(n.이름) === -1 ? ' guest' : ''}">${esc(n.이름)}
      <form method="post" action="/conti/lineup/unassign" style="display:inline;">
        <input type="hidden" name="__row" value="${n.__row}"><input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
        <button type="submit" aria-label="빼기">&times;</button>
      </form></span>`).join('') : '<span class="ph-namechip none">미정</span>'}</div>
    <form method="post" action="/conti/lineup/assign" class="ph-assignform">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}"><input type="hidden" name="포지션" value="${esc(posKey)}">
      <input type="text" name="이름" list="ph-roster" placeholder="+ 이름" maxlength="20">
      <button type="submit">추가</button>
    </form>
  </div>`;
}

async function lineupCard(team, date) {
  const [assignRows, roster] = await Promise.all([sheetsDb.readAll('찬양편성'), teamRoster(team)]);
  const rows = assignRows.filter((r) => r['팀ID'] === team && r['날짜'] === date);
  const byPos = {};
  rows.forEach((r) => { (byPos[r['포지션']] = byPos[r['포지션']] || []).push({ 이름: r['이름'], __row: r.__row }); });
  const groups = POSITION_GROUPS.map(([label, keys]) => `
    <div class="ph-posgroup">
      <div class="ph-posgrouplabel">${esc(label)}</div>
      <div class="ph-posrow">${keys.map((k) => lineupCell(date, team, k, byPos[k] || [], roster)).join('')}</div>
    </div>`).join('');
  return `<div class="ph-card">
    <h2 class="ph-h2">주일 편성</h2>
    <datalist id="ph-roster">${roster.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    ${groups}
    <p class="ph-sub" style="margin-top:8px;"><a href="/schedule?team=${encodeURIComponent(team)}">스케줄표에서 여러 주 한눈에 보기 →</a></p>
  </div>`;
}

/* ---------- 조회(읽기) 공통 — 로그인 화면과 공개 화면이 함께 씁니다 ---------- */
async function loadWeek(team, date) {
  const [songs, metaRows, sheets, recs, comments] = await Promise.all([
    sheetsDb.readAll('찬양콘티'),
    sheetsDb.readAll('콘티메타'),
    sheetsDb.readAll('악보저장소'),
    sheetsDb.readAll('녹음'),
    sheetsDb.readAll('콘티댓글'),
  ]);
  const mine = (rows) => rows.filter((r) => r['팀ID'] === team && r['날짜'] === date);
  const list = mine(songs);
  const order = (a, b) => Number(a['순서'] || 0) - Number(b['순서'] || 0);
  return {
    conti: list.filter((r) => r['구분'] !== '결단').sort(order),
    final: list.filter((r) => r['구분'] === '결단').sort(order),
    meta: metaRows.find((r) => r['팀ID'] === team && r['날짜'] === date) || null,
    sheets: mine(sheets),
    recs: mine(recs),
    comments: mine(comments).sort((a, b) => String(a['작성시각']).localeCompare(String(b['작성시각']))),
  };
}

/** '솔로' 칸(JSON 문자열) ↔ [{name,part}] 배열 */
function parseSolo(str) {
  if (!str) return [];
  try { const a = JSON.parse(str); return Array.isArray(a) ? a.filter((x) => x && x.name) : []; } catch (e) { return []; }
}
function soloFromBody(b) {
  const names = [].concat(b['솔로_이름'] || []);
  const parts = [].concat(b['솔로_파트'] || []);
  const out = [];
  names.forEach((n, i) => { n = String(n || '').trim(); if (n) out.push({ name: n, part: String(parts[i] || '').trim() }); });
  return out;
}
function soloRowHtml(r) {
  r = r || { name: '', part: '' };
  return `<div class="ph-solorow">
    <input type="text" name="솔로_이름[]" placeholder="누가" value="${esc(r.name || '')}">
    <input type="text" name="솔로_파트[]" placeholder="어디 (예: 1절 · 브릿지)" value="${esc(r.part || '')}">
  </div>`;
}
function soloFieldsHtml(solo) {
  const rows = (solo || []).slice();
  while (rows.length < 3) rows.push({ name: '', part: '' });
  return `<div class="ph-field">
    <label>솔로 <span style="font-weight:600;">(있으면 — 방송팀이 마이크를 올립니다)</span></label>
    <div class="ph-solorows">${rows.map(soloRowHtml).join('')}</div>
    <button type="button" class="ph-btn" data-add-solo>+ 솔로 추가</button>
  </div>`;
}
/** 리스트 어디서든 '+ 솔로 추가' 버튼을 한 번만 걸어두면 동작하는 위임 스크립트 */
const SOLO_ROWS_SCRIPT = `<script>
(function(){
  if (window.__phSoloRowsBound) return; window.__phSoloRowsBound = true;
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add-solo]'); if (!btn) return;
    e.preventDefault();
    var wrap = btn.previousElementSibling; if (!wrap) return;
    var rows = wrap.querySelectorAll('.ph-solorow'); var last = rows[rows.length - 1];
    var clone = last.cloneNode(true);
    clone.querySelectorAll('input').forEach(function (i) { i.value = ''; });
    wrap.appendChild(clone);
  });
})();
</script>`;

function songRow(s, { editable }) {
  const solo = parseSolo(s['솔로']);
  const bits = [s['팀'], s['Key'] && `Key ${s['Key']}`, s['송폼'], s['BPM'] && `${s['BPM']} BPM`].filter(Boolean).join(' · ');
  return `<div class="ph-list-item">
    <div class="ph-li-main">
      <div class="ph-li-title">${esc(s['제목'] || '(제목 없음)')}</div>
      ${bits ? `<div class="ph-li-sub">${esc(bits)}</div>` : ''}
      ${s['유튜브'] ? `<a class="ph-li-link" href="${esc(s['유튜브'])}" target="_blank" rel="noopener">▶ 유튜브</a>` : ''}
      ${solo.length ? `<div class="ph-solo-badges">🎤 솔로 — ${solo.map((x) => esc(x.name) + (x.part ? `<em>${esc(x.part)}</em>` : '')).join(', ')}</div>` : ''}
      ${s['비고'] ? `<div class="ph-li-note">${esc(s['비고'])}</div>` : ''}
    </div>
    ${editable ? `<details class="ph-row-edit">
      <summary title="수정">⋯</summary>
      <form method="post" action="/conti/songs/edit" class="ph-inlineform">
        <input type="hidden" name="__row" value="${s.__row}">
        <input type="hidden" name="team" value="${esc(s['팀ID'])}"><input type="hidden" name="date" value="${esc(s['날짜'])}">
        <input type="hidden" name="구분" value="${esc(s['구분'])}"><input type="hidden" name="순서" value="${esc(s['순서'])}">
        <input type="text" name="제목" value="${esc(s['제목'])}" placeholder="곡 제목" required>
        <div class="ph-inline3">
          <input type="text" name="팀" value="${esc(s['팀'] || '')}" placeholder="원곡팀">
          <input type="text" name="Key" value="${esc(s['Key'] || '')}" placeholder="Key">
          <input type="text" name="BPM" value="${esc(s['BPM'] || '')}" placeholder="BPM" inputmode="numeric">
        </div>
        <input type="text" name="송폼" value="${esc(s['송폼'] || '')}" placeholder="송폼 (예: V1-C-V2-C-B-C)">
        <input type="text" name="유튜브" value="${esc(s['유튜브'] || '')}" placeholder="유튜브 링크">
        <input type="text" name="비고" value="${esc(s['비고'] || '')}" placeholder="설명 — 간주·전조·반복 등">
        ${soloFieldsHtml(solo)}
        <button class="ph-btn pri" type="submit">저장</button>
      </form>
      <form method="post" action="/conti/songs/delete" onsubmit="return confirm('이 곡을 지울까요?')">
        <input type="hidden" name="__row" value="${s.__row}">
        <input type="hidden" name="team" value="${esc(s['팀ID'])}"><input type="hidden" name="date" value="${esc(s['날짜'])}">
        <button class="ph-row-del" type="submit" style="width:100%;" title="삭제">✕ 이 곡 삭제</button>
      </form>
    </details>` : ''}
  </div>`;
}

/** 콘티 맨 위 — 방송팀이 한눈에 보는 솔로 순서 (콘티 + 결단찬양 합산) */
function soloSummaryBox(conti, final) {
  const rows = [];
  conti.forEach((s, i) => parseSolo(s['솔로']).forEach((x) => rows.push([`${i + 1}`, s['제목'], x])));
  final.forEach((s) => parseSolo(s['솔로']).forEach((x) => rows.push(['결단', s['제목'], x])));
  if (!rows.length) return '';
  return `<div class="ph-solosum">
    <div class="ssh">🎤 방송팀 체크 — 솔로 마이크</div>
    ${rows.map((r) => `<div class="ph-ssrow"><span class="sst">${esc(r[0])}</span><b>${esc(r[1])}</b> — ${esc(r[2].name)}${r[2].part ? `<em>${esc(r[2].part)}</em>` : ''}</div>`).join('')}
  </div>`;
}

function songForm(kind, team, date) {
  const label = kind === '결단' ? '결단찬양' : '콘티';
  return `
  <details class="ph-add">
    <summary>+ ${label} 한꺼번에 올리기</summary>
    <form method="post" action="/conti/songs/bulk" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}"><input type="hidden" name="구분" value="${kind}">
      <p class="ph-sub">한 줄에 한 곡씩, <b>제목 - 원곡팀 - Key</b> 순서로 붙여넣으세요. 원곡팀·Key는 생략해도 됩니다.</p>
      <textarea name="목록" rows="5" placeholder="주님의 사랑 - 마커스 - G
은혜 - - A" style="width:100%;padding:10px 13px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg-2);color:var(--ink);font-size:15px;font-family:inherit;"></textarea>
      <button class="ph-btn pri" type="submit">한 번에 추가</button>
    </form>
  </details>
  <details class="ph-add">
    <summary>+ ${label} 하나하나 올리기</summary>
    <form method="post" action="/conti/songs" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}"><input type="hidden" name="구분" value="${kind}">
      <input type="text" name="제목" placeholder="곡 제목" required>
      <div class="ph-inline3">
        <input type="text" name="팀" placeholder="원곡팀 (예: 마커스)">
        <input type="text" name="Key" placeholder="Key (예: G)">
        <input type="text" name="BPM" placeholder="BPM" inputmode="numeric">
      </div>
      <input type="text" name="송폼" placeholder="송폼 (예: V1-C-V2-C-B-C)">
      <input type="text" name="유튜브" placeholder="유튜브 링크 (선택)">
      <input type="text" name="비고" placeholder="설명 — 간주·전조·반복 등 (선택)">
      ${soloFieldsHtml([])}
      <button class="ph-btn pri" type="submit">추가</button>
    </form>
  </details>`;
}

function sheetItem(s, editable) {
  return `<div class="ph-list-item">
    <div class="ph-li-main"><a class="ph-li-link strong" href="${esc(s['파일링크'])}" target="_blank" rel="noopener">📄 ${esc(s['제목'] || '악보')}</a>
      <div class="ph-li-sub">${esc(s['올린사람'] || '')}</div></div>
    ${editable ? `<form method="post" action="/conti/sheets/delete" onsubmit="return confirm('이 악보를 지울까요?')">
      <input type="hidden" name="__row" value="${s.__row}">
      <input type="hidden" name="team" value="${esc(s['팀ID'])}"><input type="hidden" name="date" value="${esc(s['날짜'])}">
      <button class="ph-row-del" type="submit" title="삭제">✕</button>
    </form>` : ''}
  </div>`;
}

function commentItem(c) {
  return `<div class="ph-list-item"><div class="ph-li-main">
    <div class="ph-li-title">${esc(c['이름'] || '익명')}</div>
    <div class="ph-li-note">${esc(c['내용'] || '')}</div>
  </div></div>`;
}

function recItem(r, editable) {
  return `<div class="ph-list-item">
    <div class="ph-li-main"><a class="ph-li-link strong" href="${esc(r['링크'])}" target="_blank" rel="noopener">🎧 ${esc(r['제목'] || '녹음')}</a>
      <div class="ph-li-sub">${esc(r['올린사람'] || '')}</div></div>
    ${editable ? `<form method="post" action="/conti/recordings/delete" onsubmit="return confirm('이 녹음을 지울까요?')">
      <input type="hidden" name="__row" value="${r.__row}">
      <input type="hidden" name="team" value="${esc(r['팀ID'])}"><input type="hidden" name="date" value="${esc(r['날짜'])}">
      <button class="ph-row-del" type="submit" title="삭제">✕</button>
    </form>` : ''}
  </div>`;
}

/* ================= 로그인 화면 ================= */
router.get('/conti', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const date = week.normalizeDate(req.query.date);
  const w = await loadWeek(team, date);

  const nav = `<div class="ph-weeknav">
    <a class="ph-icon-btn" href="/conti?team=${encodeURIComponent(team)}&date=${week.shiftWeek(date, -1)}">‹</a>
    <form method="get" class="ph-weekdate"><input type="hidden" name="team" value="${esc(team)}">
      <input type="date" name="date" value="${esc(date)}" onchange="this.form.submit()"></form>
    <a class="ph-icon-btn" href="/conti?team=${encodeURIComponent(team)}&date=${week.shiftWeek(date, 1)}">›</a>
  </div>`;

  const publicUrl = `/public/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}`;

  const hero = pageShell.hero({ eyebrow: `${team} · 예배콘티`, title: '예배콘티', sub: week.labelKo(date) });
  const lineup = await lineupCard(team, date);

  const content = `
  ${pageShell.hubNav('conti', team)}
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx, { keep: { date } })}
    ${nav}
    <a class="ph-btn pri" style="margin-top:12px;" href="/conti/practice?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}">🎤 연습 화면 열기 (라이브 악보 · 메트로놈)</a>
    <p class="ph-msg" style="margin-top:10px;"><a href="${publicUrl}" target="_blank" rel="noopener">🔗 로그인 없이 보는 공개 링크</a></p>
  </div>

  ${lineup}

  ${soloSummaryBox(w.conti, w.final)}

  <div class="ph-card top-accent">
    <h2 class="ph-h2">콘티</h2>
    <div class="ph-list">${w.conti.length ? w.conti.map((s) => songRow(s, { editable: true })).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div>
    ${songForm('콘티', team, date)}
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">결단찬양</h2>
    <div class="ph-list">${w.final.length ? w.final.map((s) => songRow(s, { editable: true })).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    ${songForm('결단', team, date)}
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">이번 주 정보</h2>
    <form method="post" action="/conti/meta" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
      <div class="ph-field"><label>토요연습시간</label><input type="text" name="토요연습시간" placeholder="예: 토요일 오후 2시" value="${esc(w.meta && w.meta['토요연습시간'] || '')}"></div>
      <div class="ph-field"><label>유튜브 재생목록</label><input type="text" name="유튜브재생목록" placeholder="연습용 유튜브 재생목록 링크" value="${esc(w.meta && w.meta['유튜브재생목록'] || '')}"></div>
      <div class="ph-field"><label>방송팀 요청</label><input type="text" name="방송팀요청" placeholder="방송팀에 전달할 요청사항" value="${esc(w.meta && w.meta['방송팀요청'] || '')}"></div>
      <button class="ph-btn" type="submit">저장</button>
    </form>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">악보</h2>
    <div class="ph-list">${w.sheets.length ? w.sheets.map((s) => sheetItem(s, true)).join('') : '<p class="ph-sub">아직 올라온 악보가 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 악보 올리기</summary>
      <form method="post" action="/conti/sheets" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
        <input type="text" name="제목" placeholder="곡 제목" required>
        <input type="file" name="파일" accept=".pdf,image/*">
        <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
        <button class="ph-btn pri" type="submit">올리기</button>
      </form>
    </details>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">녹음</h2>
    <h3 class="ph-h3">연습 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] !== '예배').length ? w.recs.filter((r) => r['구분'] !== '예배').map((r) => recItem(r, true)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <h3 class="ph-h3">예배 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] === '예배').length ? w.recs.filter((r) => r['구분'] === '예배').map((r) => recItem(r, true)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 녹음 올리기</summary>
      <form method="post" action="/conti/recordings" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
        <input type="text" name="제목" placeholder="녹음 제목" required>
        <select name="구분"><option value="연습">연습 녹음</option><option value="예배">예배 녹음</option></select>
        <input type="file" name="파일" accept="audio/*">
        <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
        <button class="ph-btn pri" type="submit">올리기</button>
      </form>
    </details>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">댓글</h2>
    <div class="ph-list">${w.comments.length ? w.comments.map(commentItem).join('') : '<p class="ph-sub">아직 댓글이 없어요.</p>'}</div>
    <form method="post" action="/conti/comments" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
      <input type="text" name="내용" placeholder="댓글을 남겨보세요" required>
      <button class="ph-btn" type="submit">등록</button>
    </form>
  </div>
  ${SOLO_ROWS_SCRIPT}
  `;
  spa.send(req, res, content, { title: `${team} 예배콘티` });
});

/* ================= 연습 화면 (라이브 악보 보기 · 메트로놈, Socket.io 실시간 동기화) ================= */
router.get('/conti/practice', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const date = week.normalizeDate(req.query.date);
  const w = await loadWeek(team, date);
  const songs = [...w.conti, ...w.final].map((s) => ({
    title: s['제목'] || '(제목 없음)', team: s['팀'] || '', key: s['Key'] || '', bpm: Number(s['BPM']) || 0,
    youtube: s['유튜브'] || '', note: s['비고'] || '', solo: parseSolo(s['솔로']),
  }));
  const sheets = w.sheets.map((s) => ({ id: String(s.__row), title: s['제목'] || '악보', link: s['파일링크'] || '' }));
  const roomId = `practice:${team}::${date}`;
  const hero = pageShell.hero({ eyebrow: `${team} · 연습 화면`, title: '연습 화면', sub: week.labelKo(date) });

  const content = `
  ${hero}
  <div class="ph-card">
    <a class="ph-btn" href="/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}">← 예배콘티로</a>
    <p class="ph-sub" style="margin-top:10px;">같은 링크를 연 모든 기기에 곡 선택·악보·메트로놈이 실시간으로 함께 바뀝니다.</p>
  </div>

  <div class="ph-card top-accent" id="pv-songwrap">
    <h2 class="ph-h2">곡</h2>
    <div class="pv-songtabs" id="pv-songtabs"></div>
    <div class="pv-stage" id="pv-stage"></div>
    <div class="pv-sheetpicker" id="pv-sheetpicker"></div>
  </div>

  <div class="ph-card" id="pv-metro">
    <h2 class="ph-h2">메트로놈</h2>
    <div class="pv-metrorow">
      <button class="ph-icon-btn" id="pv-bpmdown" type="button">−</button>
      <div class="pv-bpm"><span id="pv-bpmnum">80</span><span class="pv-bpmlabel">BPM</span></div>
      <button class="ph-icon-btn" id="pv-bpmup" type="button">+</button>
      <div class="pv-beat" id="pv-beat"></div>
    </div>
    <div class="pv-metrobtns">
      <button class="ph-btn pri" id="pv-startstop" type="button">▶ 시작</button>
      <button class="ph-btn" id="pv-tap" type="button">탭으로 템포 맞추기</button>
    </div>
  </div>
  <script>window.PV_DATA = ${JSON.stringify({ room: roomId, songs, sheets }).replace(/</g, '\\u003c')};</script>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/js/practice.js" defer></script>
  `;
  res.type('html').send(await pageShell.render(content, { title: `${team} 연습 화면` }));
});

router.post('/conti/lineup/assign', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const pos = String(b['포지션'] || '').trim();
  const name = String(b['이름'] || '').trim();
  if (pos && name) {
    const dup = (await sheetsDb.readAll('찬양편성')).find((r) => r['팀ID'] === team && r['날짜'] === date && r['포지션'] === pos && r['이름'] === name);
    if (!dup) await sheetsDb.appendRow('찬양편성', { 'ID': 'A' + Date.now().toString(36), '팀ID': team, '날짜': date, '포지션': pos, '이름': name });
  }
  backTo(req, res, team, date);
});

router.post('/conti/lineup/unassign', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('찬양편성', row); } catch (e) { console.error('[편성 삭제 실패]', e.message); } }
  backTo(req, res, b.team, week.normalizeDate(b.date));
});

router.post('/conti/songs', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const kind = b['구분'] === '결단' ? '결단' : '콘티';
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team, date);
  const all = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && r['날짜'] === date && r['구분'] === kind);
  await sheetsDb.appendRow('찬양콘티', {
    'ID': 'C' + Date.now().toString(36), '팀ID': team, '날짜': date, '구분': kind,
    '순서': all.length + 1, '제목': title, '팀': b['팀'] || '', 'Key': b['Key'] || '', '유튜브': b['유튜브'] || '',
    '송폼': b['송폼'] || '', 'BPM': b['BPM'] || '', '비고': b['비고'] || '', '만든시각': new Date().toISOString(),
    '솔로': JSON.stringify(soloFromBody(b)),
  });
  backTo(req, res, team, date);
});

/** 곡 제목·Key·BPM 등을 수정 (church-app처럼 삭제 후 다시 올리지 않아도 됩니다) */
router.post('/conti/songs/edit', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const row = Number(b.__row);
  const title = String(b['제목'] || '').trim();
  if (row && title) {
    try {
      await sheetsDb.updateRow('찬양콘티', row, {
        'ID': b['ID'] || '', '팀ID': team, '날짜': date, '구분': b['구분'] === '결단' ? '결단' : '콘티',
        '순서': b['순서'] || 0, '제목': title, '팀': b['팀'] || '', 'Key': b['Key'] || '', '유튜브': b['유튜브'] || '',
        '송폼': b['송폼'] || '', 'BPM': b['BPM'] || '', '비고': b['비고'] || '', '만든시각': b['만든시각'] || new Date().toISOString(),
        '솔로': JSON.stringify(soloFromBody(b)),
      });
    } catch (e) { console.error('[콘티 수정 실패]', e.message); }
  }
  backTo(req, res, team, date);
});

/** 한꺼번에 올리기 — 한 줄에 "제목 - 원곡팀 - Key" */
router.post('/conti/songs/bulk', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const kind = b['구분'] === '결단' ? '결단' : '콘티';
  const lines = String(b['목록'] || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length) {
    const all = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && r['날짜'] === date && r['구분'] === kind);
    let seq = all.length;
    for (const ln of lines) {
      const parts = ln.replace(/^\d+[.)]\s*/, '').split(/\s+[-–|]\s+|\t/);
      const title = (parts[0] || '').trim();
      if (!title) continue;
      seq += 1;
      await sheetsDb.appendRow('찬양콘티', {
        'ID': 'C' + Date.now().toString(36) + seq, '팀ID': team, '날짜': date, '구분': kind, '순서': seq,
        '제목': title, '팀': (parts[1] || '').trim(), 'Key': (parts[2] || '').trim(), '유튜브': '',
        '송폼': '', 'BPM': '', '비고': '', '만든시각': new Date().toISOString(), '솔로': '[]',
      });
    }
  }
  backTo(req, res, team, date);
});

router.post('/conti/songs/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('찬양콘티', row); } catch (e) { console.error('[콘티 삭제 실패]', e.message); } }
  backTo(req, res, b.team, week.normalizeDate(b.date));
});

router.post('/conti/meta', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const existing = await sheetsDb.findWhere('콘티메타', (r) => r['팀ID'] === team && r['날짜'] === date);
  const row = {
    'ID': existing ? existing['ID'] : 'M' + Date.now().toString(36), '팀ID': team, '날짜': date,
    '토요연습시간': b['토요연습시간'] || '', '유튜브재생목록': b['유튜브재생목록'] || '', '방송팀요청': b['방송팀요청'] || '',
    '수정시각': new Date().toISOString(),
  };
  if (existing) await sheetsDb.updateRow('콘티메타', existing.__row, row);
  else await sheetsDb.appendRow('콘티메타', row);
  backTo(req, res, team, date);
});

router.post('/conti/sheets', requireTeam, upload.single('파일'), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team, date);
  let link = String(b['링크'] || '').trim();
  try { if (req.file) link = await driveStore.uploadPublic('악보', req.file); } catch (e) { console.error('[악보 업로드 실패]', e.message); }
  if (!link) return backTo(req, res, team, date);
  await sheetsDb.appendRow('악보저장소', {
    'ID': 'F' + Date.now().toString(36), '팀ID': team, '날짜': date, '제목': title,
    '파일링크': link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
  });
  backTo(req, res, team, date);
});

router.post('/conti/sheets/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('악보저장소', row); } catch (e) { console.error('[악보 삭제 실패]', e.message); } }
  backTo(req, res, b.team, week.normalizeDate(b.date));
});

router.post('/conti/recordings', requireTeam, upload.single('파일'), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team, date);
  let link = String(b['링크'] || '').trim();
  try { if (req.file) link = await driveStore.uploadPublic('음원', req.file); } catch (e) { console.error('[녹음 업로드 실패]', e.message); }
  if (!link) return backTo(req, res, team, date);
  await sheetsDb.appendRow('녹음', {
    'ID': 'R' + Date.now().toString(36), '팀ID': team, '날짜': date,
    '구분': b['구분'] === '예배' ? '예배' : '연습', '제목': title,
    '링크': link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
  });
  backTo(req, res, team, date);
});

router.post('/conti/recordings/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('녹음', row); } catch (e) { console.error('[녹음 삭제 실패]', e.message); } }
  backTo(req, res, b.team, week.normalizeDate(b.date));
});

router.post('/conti/comments', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const content = String(b['내용'] || '').trim();
  if (content) {
    await sheetsDb.appendRow('콘티댓글', {
      'ID': 'M' + Date.now().toString(36), '팀ID': team, '날짜': date,
      '이름': req.ctx.member['이름'], '내용': content, '작성시각': new Date().toISOString(),
    });
  }
  backTo(req, res, team, date);
});

/* ================= 로그인 없이 보는 공개 화면 (예배콘티만) ================= */
router.get('/public/conti', async (req, res) => {
  const team = String(req.query.team || '').trim();
  const date = week.normalizeDate(req.query.date);
  if (!team) return res.status(404).type('text').send('팀을 찾을 수 없습니다.');
  const teamRow = await sheetsDb.findOne('찬양팀', '팀명', team);
  if (!teamRow || String(teamRow['활성여부']).toUpperCase() === 'FALSE') {
    return res.status(404).type('text').send('존재하지 않거나 비활성화된 찬양팀입니다.');
  }
  const w = await loadWeek(teamRow['팀명'], date);
  const nav = `<div class="ph-weeknav">
    <a class="ph-icon-btn" href="/public/conti?team=${encodeURIComponent(team)}&date=${week.shiftWeek(date, -1)}">‹</a>
    <div class="ph-weekdate-label">${esc(week.labelKo(date))}</div>
    <a class="ph-icon-btn" href="/public/conti?team=${encodeURIComponent(team)}&date=${week.shiftWeek(date, 1)}">›</a>
  </div>`;
  const hero = pageShell.hero({ eyebrow: `${teamRow['팀명']} · 공개 콘티`, title: '예배콘티', sub: '로그인 없이 보는 공개 화면입니다.' });
  const content = `
  ${hero}
  <div class="ph-card">${nav}</div>
  ${soloSummaryBox(w.conti, w.final)}
  <div class="ph-card top-accent">
    <h2 class="ph-h2">콘티</h2>
    <div class="ph-list">${w.conti.length ? w.conti.map((s) => songRow(s, { editable: false })).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div>
  </div>
  <div class="ph-card">
    <h2 class="ph-h2">결단찬양</h2>
    <div class="ph-list">${w.final.length ? w.final.map((s) => songRow(s, { editable: false })).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
  </div>
  <div class="ph-card">
    <h2 class="ph-h2">악보</h2>
    <div class="ph-list">${w.sheets.length ? w.sheets.map((s) => sheetItem(s, false)).join('') : '<p class="ph-sub">아직 올라온 악보가 없어요.</p>'}</div>
  </div>
  `;
  res.type('html').send(await pageShell.render(content, { title: `${teamRow['팀명']} 예배콘티 (공개)` }));
});

module.exports = router;
