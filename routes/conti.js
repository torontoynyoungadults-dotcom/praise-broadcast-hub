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
const avatar = require('../lib/avatar');
const { POSITION_GROUPS, ALL_POSITIONS, canonicalPosition } = require('../lib/positions');
const { positionIconSvg } = require('../lib/positionIcons');
const rosterPicker = require('../lib/rosterPicker');
// public/worship/formb.js(church-app)를 그대로 옮긴 파일 — Node에서도 그대로 동작(UMD)하므로 서버 쪽 "보기 좋게" 표시에도 재사용
const YNForm = require('../public/js/formb.js');

const router = express.Router();

/** 곡이 바뀌면 열려 있는 라이브 악보에 알림 (church-app 의 songs:changed) — server.js 가 routes/live.js 의 함수를 넣어 줌 */
let liveNotify = () => {};
function setLiveNotify(fn) { if (typeof fn === 'function') liveNotify = fn; }
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

/** 날짜 모드(보통 주일)인지, 행사 모드(특별예배 하나에 묶인 완전히 별도 콘티)인지.
 * 행사ID가 있으면 행사 모드 — 같은 날짜라도 주일예배와 콘티·편성·악보·녹음·댓글이 전혀 섞이지 않습니다. */
function scopeFrom(b) {
  return { event: String((b && (b.event || b['행사ID'])) || '').trim(), date: week.normalizeDate(b && b.date) };
}
function inScope(row, scope) {
  return scope.event ? row['행사ID'] === scope.event : (row['날짜'] === scope.date && !row['행사ID']);
}
/** 새 행을 만들 때 공통으로 넣는 날짜·행사ID 칸 */
function scopeFields(scope) { return { '날짜': scope.date, '행사ID': scope.event || '' }; }
/** 폼에 넣는 숨은 입력 — date는 항상, event는 행사 모드일 때만 */
function scopeHidden(scope) { return `<input type="hidden" name="date" value="${esc(scope.date)}">${scope.event ? `<input type="hidden" name="event" value="${esc(scope.event)}">` : ''}`; }
/** 이미 저장된 행(r)을 근거로 그 행이 속한 화면으로 돌아가는 숨은 입력 — scope를 몰라도 행 자신의 날짜·행사ID로 충분 */
function rowHidden(r) { return `<input type="hidden" name="date" value="${esc(r['날짜'])}">${r['행사ID'] ? `<input type="hidden" name="event" value="${esc(r['행사ID'])}">` : ''}`; }
function contiUrl(team, scope) {
  const qs = new URLSearchParams({ team });
  if (scope.event) qs.set('event', scope.event); else qs.set('date', scope.date);
  return `/conti?${qs.toString()}`;
}
function backTo(req, res, team, scope) {
  spa.redirect(req, res, contiUrl(team, scope));
}

/* ---------- 주일 편성 (church-app의 "이 주의 편성" — 이번 주 포지션 배정) ---------- */
async function teamRoster(team) {
  const members = await sheetsDb.readAll('회원');
  return members.filter((m) => String(m['소속팀'] || '').split(',').map((s) => s.trim()).includes(team)).map((m) => m['이름']).filter(Boolean);
}

function lineupCell(scope, team, posKey, names, roster, infoMap) {
  const rosterObjs = Object.keys(infoMap).map((n) => ({ 이름: n, 역할: infoMap[n].역할 }));
  const chip = (n) => `<span class="ph-namechip${roster.indexOf(n.이름) === -1 ? ' guest' : ''}" title="${esc(n.이름)}">${avatar.avatarHtml(n.이름, infoMap[n.이름] || {}, 'md')}<span class="ph-chipname">${esc(avatar.givenName(n.이름))}</span></span>`;
  const chips = names.length ? names.map(chip).join('') : '<span class="ph-namechip none"><span class="ph-dash">—</span></span>';
  const assignedRows = names.map((n) => `<div class="ph-assignedrow">${avatar.avatarHtml(n.이름, infoMap[n.이름] || {}, 'sm')}<span>${esc(n.이름)}</span>
      <form method="post" action="/conti/lineup/unassign">
        <input type="hidden" name="__row" value="${n.__row}"><input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}
        <button type="submit" aria-label="빼기">✕ 빼기</button>
      </form></div>`).join('');
  return `<details class="ph-poscell">
    <summary class="ph-possummary">
      <span class="ph-pos-head"><span class="ph-posicon">${positionIconSvg(posKey)}</span><span class="ph-poslabel">${esc(posKey)}</span></span>
      <span class="ph-posnames">${chips}</span>
    </summary>
    <div class="ph-posbody">
      ${assignedRows ? `<div class="ph-posassigned">${assignedRows}</div>` : ''}
      <form method="post" action="/conti/lineup/assign" class="ph-assignform">
        <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="포지션" value="${esc(posKey)}">
        ${rosterPicker.pickerFields(rosterObjs, posKey)}
        <button type="submit">추가</button>
      </form>
    </div>
  </details>`;
}

/** 이번 주(또는 이 행사)의 포지션 배정(byPos)과 팀 명단(roster) — 주일 편성 카드와 @태그 칩이 함께 씁니다 */
async function weekAssignments(team, scope) {
  const [assignRows, roster, infoMap] = await Promise.all([sheetsDb.readAll('찬양편성'), teamRoster(team), avatar.teamInfoMap(team)]);
  const rows = assignRows.filter((r) => r['팀ID'] === team && inScope(r, scope));
  const byPos = {};
  rows.forEach((r) => { const p = canonicalPosition(r['포지션']); (byPos[p] = byPos[p] || []).push({ 이름: r['이름'], __row: r.__row }); });
  return { byPos, roster, infoMap };
}

async function lineupCard(team, scope, byPos, roster, infoMap) {
  const groups = POSITION_GROUPS.map(([label, keys]) => `
    <div class="ph-posgroup">
      <div class="ph-posgrouplabel"><span>${esc(label)}</span></div>
      <div class="ph-posrow">${keys.map((k) => lineupCell(scope, team, k, byPos[k] || [], roster, infoMap)).join('')}</div>
    </div>`).join('');
  return `<div class="ph-card">
    <h2 class="ph-h2">주일 편성</h2>
    ${groups}
    <p class="ph-sub" style="margin-top:8px;"><a href="/roster?team=${encodeURIComponent(team)}">팀원관리 →</a>${scope.event ? '' : ` · <a href="/schedule?team=${encodeURIComponent(team)}">스케줄표에서 여러 주 한눈에 보기 →</a>`}</p>
  </div>`;
}

/* ---------- 주일 외 서는 날(성탄절 · 송구영신예배 · 특별새벽기도 · 부흥회 · 철야기도회 등) ----------
 * 목록 카드·추가/삭제는 이제 별도 메뉴(routes/events.js, "행사" 탭)에서 관리합니다.
 * 여기서는 (1) 콘티 화면에서 "그 행사"(event= 쿼리)의 이름·날짜를 찾고, (2) 어떤 날짜에 행사가
 * 함께 있는지(주일예배 화면에 "행사도 있어요" 안내를 보여주려고) 조회하는 용도로만 씁니다. */
async function specialServices(team) {
  const rows = await sheetsDb.readAll('특별예배');
  return rows.filter((r) => r['팀ID'] === team).sort((a, b) => a['날짜'].localeCompare(b['날짜']));
}

async function specialServiceById(team, id) {
  if (!id) return null;
  const row = await sheetsDb.findOne('특별예배', 'ID', id);
  return (row && row['팀ID'] === team) ? row : null;
}

/* ---------- 조회(읽기) 공통 — 로그인 화면과 공개 화면이 함께 씁니다 ---------- */
async function loadWeek(team, scope) {
  const [songs, sheets, recs, comments] = await Promise.all([
    sheetsDb.readAll('찬양콘티'),
    sheetsDb.readAll('악보저장소'),
    sheetsDb.readAll('녹음'),
    sheetsDb.readAll('콘티댓글'),
  ]);
  const mine = (rows) => rows.filter((r) => r['팀ID'] === team && inScope(r, scope));
  const list = mine(songs);
  const order = (a, b) => Number(a['순서'] || 0) - Number(b['순서'] || 0);
  return {
    conti: list.filter((r) => r['구분'] !== '결단').sort(order),
    final: list.filter((r) => r['구분'] === '결단').sort(order),
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

/* ---------- 송폼 빌더 — church-app처럼 칩을 눌러 Intro-V1-C-... 순서를 조립 (public/js/formb.js가 그림) ---------- */
function songFormBuilderHtml(current, uid) {
  const inputId = `ph-sform-${esc(uid)}`;
  return `<div class="ph-field">
    <label>송폼</label>
    <input type="text" id="${inputId}" name="송폼" class="ph-songform-value" value="${esc(current || '')}" placeholder="송폼 (예: V1-C-V2-C-B-C)">
    <details class="ph-sfbuilder">
      <summary>송폼 빌더</summary>
      <div class="ph-sfb" data-ph-sfb-host data-ph-sfb-input="${inputId}">
        <p class="ph-sub">빌더를 불러오는 중…</p>
      </div>
    </details>
  </div>`;
}

/** 유튜브 링크 입력 + "이 제목으로 유튜브 검색" 보조 링크 (church-app처럼 — 검색 API 없이 검색 결과 페이지로 보냄) */
function youtubeFieldHtml(current) {
  return `<div class="ph-titlerow">
    <input type="text" name="유튜브" value="${esc(current || '')}" placeholder="유튜브 링크 (선택)">
    <a href="#" class="cn-mini cn-ytbtn" data-ph-ytsearch target="_blank" rel="noopener">▶ YouTube 검색 (여러 버전 비교)</a>
  </div>`;
}

/** @태그 — 설명 칸에 포지션/멤버 이름을 빠르게 넣는 칩 (church-app의 "@일렉 · @피아노 · @홍길동") + 지금 누가 받는지 미리보기 */
function atTagsHtml(roster, byPos) {
  byPos = byPos || {};
  const slotsForJs = {};
  const posChips = ALL_POSITIONS.map((p) => {
    const who = (byPos[p] || []).map((n) => n.이름 || n).filter(Boolean);
    slotsForJs[p] = who;
    return `<button type="button" class="cn-chip${who.length ? '' : ' off'}" data-attag="@${esc(p)}" title="${esc(who.length ? who.join(', ') : '이번 주 배정 없음')}">@${esc(p)}</button>`;
  }).join('');
  const peopleChips = (roster || []).map((n) => `<button type="button" class="cn-chip name" data-attag="@${esc(n)}">@${esc(n)}</button>`).join('');
  return `<div class="cn-mention" data-ph-attags data-ph-attag-slots='${esc(JSON.stringify(slotsForJs))}' data-ph-attag-roster='${esc(JSON.stringify(roster || []))}'>
    <div class="cn-chips"><span class="cn-chips-t">@ 태그</span>${posChips}${peopleChips}</div>
    <div class="cn-pvs" data-ph-attag-preview></div>
  </div>`;
}

/** 곡 한 줄 밑에 붙는 "이 곡 전용 악보" — 콘티 패키지 악보(packageSheetsCard)와는 별개로, 특정 곡(곡ID)에 묶인 것만. */
function songSheetsHtml(s, sheets, editable) {
  const mine = (sheets || []).filter((f) => f['곡ID'] === s['ID']);
  const list = mine.map((f) => `<span class="ph-songsheet"><a class="ph-li-link" href="${esc(f['파일링크'])}" target="_blank" rel="noopener">📄 ${esc(f['제목'] || '악보')}</a>${editable ? `<form method="post" action="/conti/sheets/delete" style="display:inline;" onsubmit="return confirm('이 악보를 지울까요?')">
    <input type="hidden" name="__row" value="${f.__row}"><input type="hidden" name="team" value="${esc(f['팀ID'])}">${rowHidden(f)}
    <button class="ph-row-del" type="submit" title="삭제">✕</button>
  </form>` : ''}</span>`).join('');
  const addForm = editable ? `<details class="ph-add ph-songsheet-add">
    <summary>+ 이 곡 악보 올리기</summary>
    <form method="post" action="/conti/sheets" enctype="multipart/form-data" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
      <input type="hidden" name="곡ID" value="${esc(s['ID'])}">
      <input type="hidden" name="제목" value="${esc(s['제목'] || '악보')}">
      <input type="file" name="파일" accept=".pdf,image/*">
      <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
      <button class="ph-btn pri" type="submit">올리기</button>
    </form>
  </details>` : '';
  if (!list && !addForm) return '';
  return `<div class="ph-songsheets">${list}${addForm}</div>`;
}

function songRow(s, { editable, roster, byPos, sheets }) {
  const solo = parseSolo(s['솔로']);
  const formPretty = s['송폼'] ? YNForm.pretty(s['송폼']) : '';
  const bits = [s['팀'], s['Key'] && `Key ${s['Key']}`, formPretty, s['BPM'] && `${s['BPM']} BPM`].filter(Boolean).join(' · ');
  return `<div class="ph-list-item">
    <div class="ph-li-main">
      <div class="ph-li-title">${esc(s['제목'] || '(제목 없음)')}</div>
      ${bits ? `<div class="ph-li-sub">${esc(bits)}</div>` : ''}
      ${s['유튜브'] ? `<a class="ph-li-link" href="${esc(s['유튜브'])}" target="_blank" rel="noopener">▶ 유튜브</a>` : ''}
      ${solo.length ? `<div class="ph-solo-badges">🎤 솔로 — ${solo.map((x) => esc(x.name) + (x.part ? `<em>${esc(x.part)}</em>` : '')).join(', ')}</div>` : ''}
      ${s['비고'] ? `<div class="ph-li-note">${esc(s['비고'])}</div>` : ''}
      ${songSheetsHtml(s, sheets, editable)}
    </div>
    ${editable ? `<details class="ph-row-edit">
      <summary title="수정">⋯</summary>
      <form method="post" action="/conti/songs/edit" class="ph-inlineform">
        <input type="hidden" name="__row" value="${s.__row}">
        <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
        <input type="hidden" name="구분" value="${esc(s['구분'])}"><input type="hidden" name="순서" value="${esc(s['순서'])}">
        <input type="text" name="제목" value="${esc(s['제목'])}" placeholder="곡 제목" required>
        <div class="ph-inline3">
          <input type="text" name="팀" value="${esc(s['팀'] || '')}" placeholder="원곡팀">
          <input type="text" name="Key" value="${esc(s['Key'] || '')}" placeholder="Key">
          <input type="text" name="BPM" value="${esc(s['BPM'] || '')}" placeholder="BPM" inputmode="numeric">
        </div>
        ${songFormBuilderHtml(s['송폼'], `s${s.__row}`)}
        <div class="ph-field"><label>유튜브</label>${youtubeFieldHtml(s['유튜브'])}</div>
        <label>설명</label>
        <textarea name="비고" rows="3" placeholder="간주 · 전조 · 반복 등 — 세션을 부르려면 @일렉 · @피아노 · @홍길동">${esc(s['비고'] || '')}</textarea>
        ${atTagsHtml(roster, byPos)}
        ${soloFieldsHtml(solo)}
        <button class="ph-btn pri" type="submit">저장</button>
      </form>
      <form method="post" action="/conti/songs/delete" onsubmit="return confirm('이 곡을 지울까요?')">
        <input type="hidden" name="__row" value="${s.__row}">
        <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
        <button class="ph-row-del" type="submit" style="width:100%;" title="삭제">✕ 이 곡 삭제</button>
      </form>
    </details>` : ''}
  </div>`;
}

/** 콘티 맨 위 — 방송팀이 한눈에 보는 솔로 순서 (콘티 + 결단찬양 합산) */
function soloSummaryBox(conti, final) {
  const rows = [];
  conti.forEach((s, i) => parseSolo(s['솔로']).forEach((x) => rows.push([`${i + 1}`, s['제목'], x])));
  final.forEach((s) => parseSolo(s['솔로']).forEach((x) => rows.push(['설교 후', s['제목'], x])));
  if (!rows.length) return '';
  return `<div class="ph-solosum">
    <div class="ssh">🎤 방송팀 체크 — 솔로 마이크</div>
    ${rows.map((r) => `<div class="ph-ssrow"><span class="sst">${esc(r[0])}</span><b>${esc(r[1])}</b> — ${esc(r[2].name)}${r[2].part ? `<em>${esc(r[2].part)}</em>` : ''}</div>`).join('')}
  </div>`;
}

function songForm(kind, team, scope, roster, byPos) {
  const label = kind === '결단' ? '설교 후 찬양' : '콘티';
  const uid = `new${kind === '결단' ? 'f' : 'c'}`;
  return `
  <details class="ph-add">
    <summary>+ ${label} 한꺼번에 올리기</summary>
    <form method="post" action="/conti/songs/bulk" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="구분" value="${kind}">
      <p class="ph-sub">한 줄에 한 곡씩, <b>제목 - 원곡팀 - Key</b> 순서로 붙여넣으세요. 원곡팀·Key는 생략해도 됩니다.</p>
      <textarea name="목록" rows="5" placeholder="주님의 사랑 - 마커스 - G
은혜 - - A" style="width:100%;padding:10px 13px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg-2);color:var(--ink);font-size:15px;font-family:inherit;"></textarea>
      <button class="ph-btn pri" type="submit">한 번에 추가</button>
    </form>
  </details>
  <details class="ph-add">
    <summary>+ ${label} 하나하나 올리기</summary>
    <form method="post" action="/conti/songs" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="구분" value="${kind}">
      <input type="text" name="제목" placeholder="곡 제목" required>
      <div class="ph-inline3">
        <input type="text" name="팀" placeholder="원곡팀 (예: 마커스)">
        <input type="text" name="Key" placeholder="Key (예: G)">
        <input type="text" name="BPM" placeholder="BPM" inputmode="numeric">
      </div>
      ${songFormBuilderHtml('', uid)}
      <div class="ph-field"><label>유튜브</label>${youtubeFieldHtml('')}</div>
      <label>설명</label>
      <textarea name="비고" rows="3" placeholder="간주 · 전조 · 반복 등 — 세션을 부르려면 @일렉 · @피아노 · @홍길동"></textarea>
      ${atTagsHtml(roster, byPos)}
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
      <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
      <button class="ph-row-del" type="submit" title="삭제">✕</button>
    </form>` : ''}
  </div>`;
}

/** 패키지(콘티 전체) 악보 — 특정 곡(곡ID)에 안 묶인 것들만. 콘티 목록 바로 아래 카드로 둠. */
function packageSheetsCard(team, scope, sheets, editable) {
  const pkg = (sheets || []).filter((s) => !s['곡ID']);
  return `<div class="ph-card">
    <h2 class="ph-h2">악보</h2>
    <p class="ph-sub">이번 주 콘티 전체를 한 패키지로 올려두거나, 곡 목록에서 "+ 이 곡 악보 올리기"로 곡별로 올릴 수 있어요.</p>
    <div class="ph-list">${pkg.length ? pkg.map((s) => sheetItem(s, editable)).join('') : '<p class="ph-sub">아직 올라온 패키지 악보가 없어요.</p>'}</div>
    ${editable ? `<details class="ph-add">
      <summary>+ 전체 콘티 악보(패키지) 올리기</summary>
      <form method="post" action="/conti/sheets" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}
        <input type="text" name="제목" placeholder="예: ${esc(week.labelKo(scope.date))} 콘티 전체 악보" required>
        <input type="file" name="파일" accept=".pdf,image/*">
        <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
        <button class="ph-btn pri" type="submit">올리기</button>
      </form>
    </details>` : ''}
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
      <input type="hidden" name="team" value="${esc(r['팀ID'])}">${rowHidden(r)}
      <button class="ph-row-del" type="submit" title="삭제">✕</button>
    </form>` : ''}
  </div>`;
}

/* ================= 로그인 화면 ================= */
router.get('/conti', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;

  // event= 쿼리가 있고 실제로 이 팀의 특별예배면 "행사 모드" — 같은 날짜라도 주일예배와 완전히 분리된
  // 콘티·편성·악보·녹음·댓글. 없거나 못 찾으면 보통 때처럼 날짜 모드.
  const eventRow = await specialServiceById(team, String(req.query.event || '').trim());
  const date = eventRow ? eventRow['날짜'] : week.normalizeDate(req.query.date);
  const scope = { event: eventRow ? eventRow['ID'] : '', date };

  const w = await loadWeek(team, scope);

  let strip = '';
  let dayBanner = '';
  if (!scope.event) {
    const allAssignRows = (await sheetsDb.readAll('찬양편성')).filter((r) => r['팀ID'] === team && !r['행사ID']);
    strip = pageShell.weekStrip({ basePath: '/conti', team, date, assignRows: allAssignRows });
    const todaysEvents = (await specialServices(team)).filter((e) => e['날짜'] === date);
    if (todaysEvents.length) {
      dayBanner = `<div class="ph-card ph-eventsbanner">
        <p class="ph-sub">이 날 행사도 있어요 — 콘티·편성은 주일예배와 서로 다른 별도 기록이에요.</p>
        <div class="ph-list">${todaysEvents.map((e) => `<div class="ph-list-item"><div class="ph-li-main">
          <a class="ph-li-link strong" href="/conti?team=${encodeURIComponent(team)}&event=${encodeURIComponent(e['ID'])}">🎪 ${esc(e['이름'])} 콘티 보기 →</a>
        </div></div>`).join('')}</div>
      </div>`;
    }
  } else {
    dayBanner = `<div class="ph-card ph-eventsbanner">
      <p class="ph-sub">🎪 행사 콘티예요 — 주일예배와는 별도 기록입니다. <a href="/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}">이 날짜의 주일예배 콘티 보기 →</a></p>
      <p class="ph-sub"><a href="/events?team=${encodeURIComponent(team)}">← 행사 목록으로</a></p>
    </div>`;
  }

  const publicUrl = `/public/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}`;

  const hero = pageShell.hero(scope.event
    ? { eyebrow: `${team} · 행사 콘티`, title: eventRow['이름'], sub: week.labelKo(date) }
    : { eyebrow: `${team} · 예배콘티`, title: '예배콘티', sub: week.labelKo(date) });
  const { byPos, roster, infoMap } = await weekAssignments(team, scope);
  const lineup = await lineupCard(team, scope, byPos, roster, infoMap);

  const content = `
  ${pageShell.hubNav('conti', team)}
  ${hero}
  ${strip}
  ${dayBanner}
  ${(() => {
    const switcher = teamContext.teamSwitcher(ctx, { keep: scope.event ? { event: scope.event } : { date } });
    // 라이브 악보 (church-app 그대로) — 주일예배는 날짜, 행사는 행사 콘티 그대로 엽니다 (서로 다른 방 · 다른 필기 범위)
    const liveHref = scope.event
      ? `/conti/practice?team=${encodeURIComponent(team)}&event=${encodeURIComponent(scope.event)}`
      : `/conti/practice?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}`;
    const nSheets = new Set(w.sheets.filter((s) => s['파일링크']).map((s) => s['파일링크'])).size;
    const liveBtn = `<a class="ph-btn pri ph-livebtn" style="margin-top:12px;" href="${liveHref}" title="라이브 악보 — 필기 · 메트로놈 · 함께 보기 화면을 엽니다">▶ 라이브 악보<small>${nSheets ? `악보 ${nSheets}개 · ` : ''}필기 · 메트로놈 · 함께 보기</small></a>`;
    const extras = liveBtn + (scope.event ? '' : `
    <p class="ph-msg" style="margin-top:10px;"><a href="${publicUrl}" target="_blank" rel="noopener">🔗 로그인 없이 보는 공개 링크</a></p>`);
    if (!switcher && !extras) return '';
    return `<div class="ph-card">${switcher}${extras}</div>`;
  })()}

  ${lineup}

  ${soloSummaryBox(w.conti, w.final)}

  <div class="ph-card top-accent">
    <h2 class="ph-h2">콘티</h2>
    <div class="ph-list">${w.conti.length ? w.conti.map((s) => songRow(s, { editable: true, roster, byPos, sheets: w.sheets })).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div>
    ${songForm('콘티', team, scope, roster, byPos)}
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">설교 후 찬양</h2>
    <div class="ph-list">${w.final.length ? w.final.map((s) => songRow(s, { editable: true, roster, byPos, sheets: w.sheets })).join('') : '<p class="ph-sub">아직 없어요. 한 곡만 올릴 수 있어요.</p>'}</div>
    ${w.final.length ? '' : songForm('결단', team, scope, roster, byPos)}
  </div>

  ${packageSheetsCard(team, scope, w.sheets, true)}

  <div class="ph-card">
    <h2 class="ph-h2">녹음</h2>
    <h3 class="ph-h3">연습 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] !== '예배').length ? w.recs.filter((r) => r['구분'] !== '예배').map((r) => recItem(r, true)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <h3 class="ph-h3">예배 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] === '예배').length ? w.recs.filter((r) => r['구분'] === '예배').map((r) => recItem(r, true)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 녹음 올리기</summary>
      <form method="post" action="/conti/recordings" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}
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
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}
      <input type="text" name="내용" placeholder="댓글을 남겨보세요" required>
      <button class="ph-btn" type="submit">등록</button>
    </form>
  </div>
  ${SOLO_ROWS_SCRIPT}
  `;
  spa.send(req, res, content, { title: scope.event ? `${team} ${eventRow['이름']}` : `${team} 예배콘티` });
});

/* 라이브 악보(/conti/practice)는 routes/live.js 로 옮겼습니다 — church-app 의 라이브 악보를 그대로 씁니다. */

router.post('/conti/lineup/assign', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const pos = String(b['포지션'] || '').trim();
  const name = rosterPicker.resolveName(b);
  if (pos && name) {
    const dup = (await sheetsDb.readAll('찬양편성')).find((r) => r['팀ID'] === team && inScope(r, scope) && canonicalPosition(r['포지션']) === canonicalPosition(pos) && r['이름'] === name);
    if (!dup) await sheetsDb.appendRow('찬양편성', { 'ID': 'A' + Date.now().toString(36), '팀ID': team, ...scopeFields(scope), '포지션': pos, '이름': name });
  }
  backTo(req, res, team, scope);
});

router.post('/conti/lineup/unassign', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('찬양편성', row); } catch (e) { console.error('[편성 삭제 실패]', e.message); } }
  backTo(req, res, b.team, scopeFrom(b));
});

router.post('/conti/songs', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const kind = b['구분'] === '결단' ? '결단' : '콘티';
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team, scope);
  const all = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && inScope(r, scope) && r['구분'] === kind);
  // 설교 후 찬양(결단)은 곡 하나만 — 이미 있으면 새로 추가하지 않음(기존 곡을 지우고 다시 올려야 함)
  if (kind === '결단' && all.length >= 1) return backTo(req, res, team, scope);
  await sheetsDb.appendRow('찬양콘티', {
    'ID': 'C' + Date.now().toString(36), '팀ID': team, ...scopeFields(scope), '구분': kind,
    '순서': all.length + 1, '제목': title, '팀': b['팀'] || '', 'Key': b['Key'] || '', '유튜브': b['유튜브'] || '',
    '송폼': b['송폼'] || '', 'BPM': b['BPM'] || '', '비고': b['비고'] || '', '만든시각': new Date().toISOString(),
    '솔로': JSON.stringify(soloFromBody(b)),
  });
  liveNotify(team, scope, 'saveWorshipSong');
  backTo(req, res, team, scope);
});

/** 곡 제목·Key·BPM 등을 수정 (church-app처럼 삭제 후 다시 올리지 않아도 됩니다) */
router.post('/conti/songs/edit', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const row = Number(b.__row);
  const title = String(b['제목'] || '').trim();
  if (row && title) {
    try {
      await sheetsDb.updateRow('찬양콘티', row, {
        'ID': b['ID'] || '', '팀ID': team, ...scopeFields(scope), '구분': b['구분'] === '결단' ? '결단' : '콘티',
        '순서': b['순서'] || 0, '제목': title, '팀': b['팀'] || '', 'Key': b['Key'] || '', '유튜브': b['유튜브'] || '',
        '송폼': b['송폼'] || '', 'BPM': b['BPM'] || '', '비고': b['비고'] || '', '만든시각': b['만든시각'] || new Date().toISOString(),
        '솔로': JSON.stringify(soloFromBody(b)),
      });
    } catch (e) { console.error('[콘티 수정 실패]', e.message); }
  }
  liveNotify(team, scope, 'saveWorshipSong');
  backTo(req, res, team, scope);
});

/** 한꺼번에 올리기 — 한 줄에 "제목 - 원곡팀 - Key" */
router.post('/conti/songs/bulk', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const kind = b['구분'] === '결단' ? '결단' : '콘티';
  let lines = String(b['목록'] || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length) {
    const all = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && inScope(r, scope) && r['구분'] === kind);
    // 설교 후 찬양(결단)은 곡 하나만 — 이미 있으면 건너뛰고, 없으면 첫 줄 하나만 반영
    if (kind === '결단') lines = all.length >= 1 ? [] : lines.slice(0, 1);
    let seq = all.length;
    for (const ln of lines) {
      const parts = ln.replace(/^\d+[.)]\s*/, '').split(/\s+[-–|]\s+|\t/);
      const title = (parts[0] || '').trim();
      if (!title) continue;
      seq += 1;
      await sheetsDb.appendRow('찬양콘티', {
        'ID': 'C' + Date.now().toString(36) + seq, '팀ID': team, ...scopeFields(scope), '구분': kind, '순서': seq,
        '제목': title, '팀': (parts[1] || '').trim(), 'Key': (parts[2] || '').trim(), '유튜브': '',
        '송폼': '', 'BPM': '', '비고': '', '만든시각': new Date().toISOString(), '솔로': '[]',
      });
    }
  }
  liveNotify(team, scope, 'saveWorshipSongs');
  backTo(req, res, team, scope);
});

router.post('/conti/songs/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('찬양콘티', row); } catch (e) { console.error('[콘티 삭제 실패]', e.message); } }
  liveNotify(b.team, scopeFrom(b), 'removeWorshipSong');
  backTo(req, res, b.team, scopeFrom(b));
});

router.post('/conti/sheets', requireTeam, upload.single('파일'), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team, scope);
  let link = String(b['링크'] || '').trim();
  try { if (req.file) link = await driveStore.uploadPublic('악보', req.file); } catch (e) { console.error('[악보 업로드 실패]', e.message); }
  if (!link) return backTo(req, res, team, scope);
  await sheetsDb.appendRow('악보저장소', {
    'ID': 'F' + Date.now().toString(36), '팀ID': team, ...scopeFields(scope), '제목': title,
    '파일링크': link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
    '곡ID': String(b['곡ID'] || '').trim(),
  });
  backTo(req, res, team, scope);
});

router.post('/conti/sheets/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('악보저장소', row); } catch (e) { console.error('[악보 삭제 실패]', e.message); } }
  backTo(req, res, b.team, scopeFrom(b));
});

router.post('/conti/recordings', requireTeam, upload.single('파일'), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team, scope);
  let link = String(b['링크'] || '').trim();
  try { if (req.file) link = await driveStore.uploadPublic('음원', req.file); } catch (e) { console.error('[녹음 업로드 실패]', e.message); }
  if (!link) return backTo(req, res, team, scope);
  await sheetsDb.appendRow('녹음', {
    'ID': 'R' + Date.now().toString(36), '팀ID': team, ...scopeFields(scope),
    '구분': b['구분'] === '예배' ? '예배' : '연습', '제목': title,
    '링크': link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
  });
  backTo(req, res, team, scope);
});

router.post('/conti/recordings/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('녹음', row); } catch (e) { console.error('[녹음 삭제 실패]', e.message); } }
  backTo(req, res, b.team, scopeFrom(b));
});

router.post('/conti/comments', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const content = String(b['내용'] || '').trim();
  if (content) {
    await sheetsDb.appendRow('콘티댓글', {
      'ID': 'M' + Date.now().toString(36), '팀ID': team, ...scopeFields(scope),
      '이름': req.ctx.member['이름'], '내용': content, '작성시각': new Date().toISOString(),
    });
  }
  backTo(req, res, team, scope);
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
  const scope = { event: '', date };
  const w = await loadWeek(teamRow['팀명'], scope);
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
    <div class="ph-list">${w.conti.length ? w.conti.map((s) => songRow(s, { editable: false, sheets: w.sheets })).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div>
  </div>
  <div class="ph-card">
    <h2 class="ph-h2">설교 후 찬양</h2>
    <div class="ph-list">${w.final.length ? w.final.map((s) => songRow(s, { editable: false, sheets: w.sheets })).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
  </div>
  ${packageSheetsCard(team, scope, w.sheets, false)}
  `;
  res.type('html').send(await pageShell.render(content, { title: `${teamRow['팀명']} 예배콘티 (공개)` }));
});

module.exports = router;
module.exports.setLiveNotify = setLiveNotify;
