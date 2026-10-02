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
const { prefixOf } = require('../lib/prefix');
const sheetsDb = require('../lib/sheetsDb');
const driveStore = require('../lib/driveStore');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const week = require('../lib/weekUtil');
const spa = require('../lib/spa');
const avatar = require('../lib/avatar');
const honorific = require('../lib/honorific');
const shortNames = require('../lib/shortName');
const guestGate = require('../lib/guestGate');
const { POSITION_GROUPS, ALL_POSITIONS, canonicalPosition } = require('../lib/positions');
const { positionIconSvg } = require('../lib/positionIcons');
const rosterPicker = require('../lib/rosterPicker');
// public/worship/formb.js(church-app)를 그대로 옮긴 파일 — Node에서도 그대로 동작(UMD)하므로 서버 쪽 "보기 좋게" 표시에도 재사용
const YNForm = require('../public/js/formb.js');

const ui = require('../lib/uiIcons');
const prac = require('../lib/practice');
const kakaoLib = require('../lib/kakao');
const youtube = require('../lib/youtube');
const sheetSearch = require('../lib/sheetSearch');
const pkgPdf = require('../lib/pkgPdf');
const fileBytes = require('../lib/fileBytes');
const pageSpec = require('../lib/pageSpec');
const liveStore = require('../lib/liveStore');
const guestLink = require('../lib/guestLink');
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

/** 날짜 모드(보통 주일)인지, 행사 모드(주일 외 찬양 하나에 묶인 완전히 별도 콘티)인지.
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
  const isP = (n) => honorific.isPastorRoles((infoMap[n] || {}).역할);       // 목회자: 칩에는 "윤 목사님", 그 밖에는 "윤정환 목사님"
  const shortOf = shortNames.shortFn(Object.keys(infoMap).filter((n) => !isP(n)));       // 같은 이름이면 조희 · 김희 처럼 성을 붙임
  const chipName = (n) => (isP(n) ? String(n).charAt(0) + honorific.SUFFIX : shortOf(n));
  const chip = (n) => `<span class="ph-namechip${roster.indexOf(n.이름) === -1 ? ' guest' : ''}${isP(n.이름) ? ' pastor' : ''}" title="${esc(isP(n.이름) ? n.이름 + honorific.SUFFIX : n.이름)}">${avatar.avatarHtml(n.이름, infoMap[n.이름] || {}, 'md')}<span class="ph-chipname">${esc(chipName(n.이름))}</span></span>`;
  const chips = names.length ? names.map(chip).join('') : '<span class="ph-namechip none"><span class="ph-dash">—</span></span>';
  const assignedRows = names.map((n) => `<div class="ph-assignedrow">${avatar.avatarHtml(n.이름, infoMap[n.이름] || {}, 'sm')}<span>${esc(isP(n.이름) ? n.이름 + honorific.SUFFIX : n.이름)}</span>
      <form method="post" action="/conti/lineup/unassign">
        <input type="hidden" name="__row" value="${n.__row}"><input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}
        <button type="submit" aria-label="빼기">${ui.icon('close')} 빼기</button>
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

async function lineupCard(team, scope, byPos, roster, infoMap, eventName, isAdmin) {
  // 스케줄표의 "카드" 보기와 같은 모양 — 머리(날짜) + 3칸 격자 한 장. 칸을 누르면 그 칸이 한 줄 전체로 펼쳐져 배정 · 해제 (스케줄표 카드보다 글씨 · 사진을 조금 크게)
  const keys = ALL_POSITIONS.slice();
  const cells = keys.map((k) => lineupCell(scope, team, k, byPos[k] || [], roster, infoMap)).join('')
    + '<div class="lu-fill" aria-hidden="true"></div>'.repeat((3 - keys.length % 3) % 3);
  const head = scope.event
    ? `<b>${esc(week.shortKo(scope.date, true))}</b>${eventName ? `<span class="lu-evn">${esc(eventName)}</span>` : ''}`
    : `<b>${esc(week.shortKo(scope.date, true))}</b>`;
  return `<div class="ph-card lu-card">
    <h2 class="ph-h2">주일 편성</h2>
    <div class="lu${scope.event ? ' ev' : ''}">
      <div class="lu-head">${head}<span class="lu-hint">칸을 누르면 바로 배정해요</span></div>
      <div class="lu-grid">${cells}</div>
    </div>
    <p class="ph-sub" style="margin-top:10px;">${isAdmin ? `<a href="/roster?team=${encodeURIComponent(team)}">팀원관리 →</a>` : ''}${scope.event ? '' : `${isAdmin ? ' · ' : ''}<a href="/schedule?team=${encodeURIComponent(team)}">스케줄표에서 여러 주 한눈에 보기 →</a>`}</p>
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
  await honorific.prime(team);                                            // 목사님 호칭(댓글 · 올린 사람)을 위해
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

/* 솔로 칸은 없앴습니다 (입력 · 표시 모두). 시트의 '솔로' 열은 옛 기록 때문에 그대로 두고 새로 적지 않습니다. */

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

/** 유튜브 — 링크 칸 + "유튜브에서 찾기": 새 창이 아니라 이 칸 바로 밑에 검색 결과가 펼쳐지고, 미리보기를 보고 고르면 링크가 들어갑니다
 *  (public/js/conti-tools.js 가 붙임 · 서버는 /conti/youtube 가 검색) */
function youtubeFieldHtml(current) {
  return `<div class="cn-yt" data-cn-yt>
    <div class="cn-ytrow">
      <input type="text" name="유튜브" value="${esc(current || '')}" placeholder="유튜브 링크 붙여넣기 (선택)" inputmode="url" autocomplete="off" data-cn-ytlink>
      <button type="button" class="cn-mini cn-ytbtn" data-cn-ytopen aria-expanded="false">${ui.icon('search')} 유튜브에서 찾기</button>
    </div>
    <div class="cn-ytpick" data-cn-ytpick></div>
    <div class="cn-ytpanel" data-cn-ytpanel hidden></div>
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

/** 설명 글 → 안전한 HTML — @태그(@일렉 · @이름)는 배지로, 줄바꿈은 CSS(pre-wrap)가 살림 */
function noteHtml(text, tagSet) {
  const out = []; let at = 0; const t = String(text || '');
  const re = /(^|[^A-Za-z0-9_])@([A-Za-z0-9가-힣_]+)/g; let m;
  while ((m = re.exec(t))) {
    const start = m.index + m[1].length;
    out.push(esc(t.slice(at, start)));
    // 포지션 · 팀원 이름 중 가장 긴 앞부분을 배지로 (뒤에 조사가 붙어도 "@일렉은" → 배지 + 은)
    const raw = m[2]; let hit = '';
    (tagSet || []).forEach((n) => { if (raw.startsWith(n) && n.length > hit.length) hit = n; });
    const len = hit ? hit.length : raw.length;
    out.push(`<span class="cn-mt${hit ? '' : ' cn-mt-none'}">@${esc(raw.slice(0, len))}</span>`);
    at = start + 1 + len; re.lastIndex = at;
  }
  out.push(esc(t.slice(at)));
  return out.join('');
}

/** 송폼 → 칩 (눈에 잘 띄게 — V · C · B 색 구분, 한글 이름 · 반복 · 마디 수) */
function formChips(form) {
  const toks = form ? YNForm.parse(form) : [];
  if (!toks.length) return form ? `<div class="cn-sform"><span class="cn-fc cn-fc-etc"><b>${esc(form)}</b></span></div>` : '';
  const cls = (k) => (/^V\d?$/.test(k) ? 'v' : /^PC\d?$/.test(k) ? 'pc' : /^C\d?$/.test(k) ? 'c' : /^B\d?$/.test(k) ? 'b' : /^(Intro|Out|Itld|Inst|Coda|End)$/.test(k) ? 'io' : 'etc');
  return `<div class="cn-sform" aria-label="송폼">${toks.map((t) => {
    const ko = t.custom ? '' : YNForm.label(t.k, 'ko');
    return `<span class="cn-fc cn-fc-${cls(t.k)}" title="${esc(ko || t.k)}"><b>${esc(t.k)}</b>${ko && ko !== t.k ? `<i>${esc(ko)}</i>` : ''}${t.bars ? `<small>${t.bars}마디</small>` : ''}${t.rep > 1 ? `<em>×${t.rep}</em>` : ''}</span>`;
  }).join('<span class="cn-arrow" aria-hidden="true">›</span>')}</div>`;
}

/** 방송팀 보기용 큰 송폼 — 순서 번호 · 큼직한 글씨 · 색 구분. 순서(송폼)가 방송에서 가장 중요해서 한눈에 읽히게 */
function formBig(form) {
  const toks = form ? YNForm.parse(form) : [];
  if (!toks.length) return form ? `<div class="cn-bigform"><span class="cn-bf cn-bf-etc"><b>${esc(form)}</b></span></div>` : '<div class="cn-bigform"><span class="cn-bf-none">송폼 없음</span></div>';
  const cls = (k) => (/^V\d?$/.test(k) ? 'v' : /^PC\d?$/.test(k) ? 'pc' : /^C\d?$/.test(k) ? 'c' : /^B\d?$/.test(k) ? 'b' : /^(Intro|Out|Itld|Inst|Coda|End)$/.test(k) ? 'io' : 'etc');
  return `<ol class="cn-bigform" aria-label="송폼 순서">${toks.map((t, i) => {
    const ko = t.custom ? '' : YNForm.label(t.k, 'ko');
    return `<li class="cn-bf cn-bf-${cls(t.k)}"><span class="cn-bf-n">${i + 1}</span><b>${esc(t.k)}</b>${ko && ko !== t.k ? `<i>${esc(ko)}</i>` : ''}${t.rep > 1 ? `<em>×${t.rep}</em>` : ''}${t.bars ? `<small>${t.bars}마디</small>` : ''}</li>`;
  }).join('')}</ol>`;
}

/** 곡 한 줄 밑에 붙는 "이 곡 전용 악보" — 콘티 패키지 악보(packageSheetsCard)와는 별개로, 특정 곡(곡ID)에 묶인 것만. */
function songSheetsHtml(s, sheets, editable, extra) {
  const mine = (sheets || []).filter((f) => f['곡ID'] === s['ID']);
  const list = mine.map((f) => `<span class="ph-songsheet"><a class="ph-li-link" href="${esc(liveStore.openHref(f['팀ID'], f['파일링크'], f['쪽'], s['제목'] || f['제목']))}" target="_blank" rel="noopener">${ui.icon('page')} ${esc(f['제목'] || '악보')}${f['쪽'] ? ` <small class="ph-pr">${esc(f['쪽'])}쪽</small>` : ''}</a>${editable ? `<form method="post" action="/conti/sheets/delete" style="display:inline;" onsubmit="return confirm('이 악보를 지울까요?')">
    <input type="hidden" name="__row" value="${f.__row}"><input type="hidden" name="team" value="${esc(f['팀ID'])}">${rowHidden(f)}
    <button class="ph-row-del" type="submit" title="삭제" aria-label="삭제">${ui.icon('close')}</button>
  </form>` : ''}</span>`).join('');
  const addForm = editable ? `<details class="ph-add ph-songsheet-add">
    <summary>+ 이 곡 악보 올리기</summary>
    <form method="post" action="/conti/sheets" enctype="multipart/form-data" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
      <input type="hidden" name="곡ID" value="${esc(s['ID'])}">
      <input type="file" name="파일" accept=".pdf,image/*" multiple>
      <input type="text" name="제목" placeholder="제목 (비워 두면 파일 이름이 제목이 돼요)">
      <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
      <button class="ph-btn pri" type="submit">올리기</button>
    </form>
    <button type="button" class="ph-btn" data-sheet-search data-team="${esc(s['팀ID'])}" data-song="${esc(s['ID'])}" data-date="${esc(s['날짜'])}" data-event="${esc(s['행사ID'] || '')}" data-q="${esc(s['제목'] || '')}">${ui.icon('search')} 웹에서 악보 찾기</button>
  </details>` : '';
  if (!list && !addForm && !extra) return '';
  return `<div class="ph-songsheets">${list}${addForm}${extra || ''}</div>`;
}

/** 이 예배의 유튜브 이어 듣기 — 콘티 순서대로 곡마다 올린 링크를 이어서 재생하고(설교 후 찬양은 맨 뒤), 유튜브가 만들어 주는 임시 재생목록(watch_videos)으로도 열 수 있게
 *  (public/js/conti-tools.js 의 [data-cn-yplay] 가 플레이어를 붙임) */
function ytPlayAllHtml(w) {
  const all = [].concat((w.conti || []).map((s, i) => ({ s, k: '콘티', n: i + 1 })), (w.final || []).map((s) => ({ s, k: '설교 후', n: 0 })));
  const items = [];
  all.forEach((x) => { const id = youtube.idOf(x.s['유튜브']); if (id && !items.some((y) => y.id === id)) items.push({ id, t: String(x.s['제목'] || '').trim() || '제목 없음', k: x.k, n: x.n }); });
  if (!items.length) return '';
  const missing = all.filter((x) => !youtube.idOf(x.s['유튜브'])).length;
  const open = 'https://www.youtube.com/watch_videos?video_ids=' + items.slice(0, 50).map((x) => x.id).join(',');
  return `<div class="cn-yplay" data-cn-yplay data-items="${esc(JSON.stringify(items))}">
    <div class="cn-yplay-bar">
      <button type="button" class="cn-mini" data-cn-yplay-open aria-expanded="false">${ui.icon('play')} 유튜브로 이어 듣기 · ${items.length}곡</button>
      <a class="cn-mini" href="${esc(open)}" target="_blank" rel="noopener" title="유튜브가 한 번에 재생목록으로 열어줘요 (유튜브 앱 · 화면을 꺼도 계속)">${ui.icon('link')} 유튜브에서 한 번에 열기</a>
      ${missing ? `<span class="ph-sub">링크 없는 ${missing}곡은 빠져요</span>` : ''}
    </div>
    <div class="cn-yplayer" data-cn-yplayer hidden></div>
  </div>`;
}

/** 곡 카드 — 청년부 앱처럼: ① 순서 · 제목 · Key · BPM ② 원곡팀 · 유튜브 ③ 송폼 ④ 설명 */
function songCard(s, { editable, roster, byPos, sheets, tagSet, index, kind, bigForm }) {
  const isFinal = kind === '결단';
  const yt = s['유튜브'] ? ytLinkOf(s['유튜브']) : '';
  const bpm = String(s['BPM'] || '').trim();
  const edit = editable ? `<details class="ph-row-edit cn-edit">
      <summary title="수정">${ui.icon('pencil')} 수정</summary>
      <form method="post" action="/conti/songs/edit" class="ph-inlineform">
        <input type="hidden" name="__row" value="${s.__row}">
        <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
        <input type="hidden" name="ID" value="${esc(s['ID'])}"><input type="hidden" name="만든시각" value="${esc(s['만든시각'] || '')}">
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
        <button class="ph-btn pri" type="submit">저장</button>
      </form>
      <form method="post" action="/conti/songs/delete" onsubmit="return confirm('이 곡을 지울까요?')">
        <input type="hidden" name="__row" value="${s.__row}">
        <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
        <button class="ph-row-del" type="submit" style="width:100%;" title="삭제">${ui.icon('close')} 이 곡 삭제</button>
      </form>
    </details>` : '';
  const ytBtn = yt ? `<a class="cn-ytlink" href="${esc(yt)}" target="_blank" rel="noopener" title="YouTube" aria-label="YouTube">${ui.icon('play')}<span>YouTube</span></a>` : '';
  return `<div class="cn-song${isFinal ? ' fin' : ''}" id="song-${esc(s['ID'])}" data-song="${esc(s['ID'])}">
    <div class="cn-shead">
      <span class="cn-no">${isFinal ? ui.icon('cross') : esc(index)}</span>
      <span class="cn-tb"><span class="cn-ti">${esc(s['제목'] || '(제목 없음)')}</span>${s['팀'] ? `<span class="cn-team">${esc(s['팀'])}</span>` : ''}</span>
      <span class="cn-badges">${s['Key'] ? `<span class="cn-kb key" title="Key">${esc(s['Key'])}</span>` : ''}${bpm ? `<span class="cn-kb bpm" title="BPM">${esc(bpm)}<small>BPM</small></span>` : ''}${ytBtn}</span>
    </div>
    ${bigForm ? formBig(s['송폼'] || '') : formChips(s['송폼'] || '')}
    ${s['비고'] ? `<div class="cn-snote">${noteHtml(s['비고'], tagSet)}</div>` : ''}
    ${songSheetsHtml(s, sheets, editable, edit)}
  </div>`;
}
/** 방송팀(PPT) 보기 전용 링크 칸 — 링크가 있으면 보여 주고 복사, 관리자는 만들기 · 새로 바꾸기 */
function guestPanel(req, team, scope, token, isAdmin, open) {
  if (!token && !isAdmin) return '';
  const url = token ? `${req.protocol}://${req.get('host')}${prefixOf(req)}/b/${token}` : '';
  const form = (label, confirmMsg, cls) => `<form method="post" action="/conti/guest-link" class="cn-glform"${confirmMsg ? ` onsubmit="return confirm('${confirmMsg}')"` : ''}>
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<button class="cn-mini${cls || ''}" type="submit">${label}</button></form>`;
  return `<details class="cn-guestlink"${token && !open ? '' : ' open'}>
    <summary>${ui.icon('link')} 방송팀 보기 링크</summary>
    <p class="ph-sub">로그인 없이 <b>예배 콘티 · 스케줄표</b> 두 화면만 볼 수 있는 링크예요. 고칠 수는 없고 댓글만 남길 수 있어요.</p>
    ${token ? `<div class="cn-glrow"><input type="text" readonly value="${esc(url)}" aria-label="방송팀 보기 링크" onfocus="this.select()">
        <button type="button" class="cn-mini" data-cn-copy="${esc(url)}">${ui.icon('clipboard')} 복사</button></div>
      <p class="ph-msg cn-toolmsg" data-cn-copymsg role="status"></p>` : '<p class="ph-sub">아직 만들지 않았어요.</p>'}
    ${isAdmin ? (token ? form('새 링크로 바꾸기', '새 링크로 바꾸면 예전 링크는 바로 쓸 수 없어요. 바꿀까요?') : form('링크 만들기', '', ' ph-pri')) : ''}
  </details>`;
}
const ytLinkOf = (link) => { link = String(link || '').trim(); return /^[A-Za-z0-9_-]{11}$/.test(link) ? 'https://youtu.be/' + link : link; };
/** 링크는 http(s) 만 걸어 줍니다 (javascript: 같은 주소 방지) */
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

/* ---------- 이전 콘티에서 가져오기 (곡 입력 위쪽) ---------- */
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDay = (d) => { const x = new Date(d + 'T12:00:00'); return `${x.getMonth() + 1}월 ${x.getDate()}일(${DOW_KO[x.getDay()]})`; };
const songNorm = (t) => String(t || '').toLowerCase().replace(/[\s\-_.·,!?'"()\[\]]/g, '');
/** 지난 콘티들(예배별) + 곡 검색용 전체 곡 목록 — 이 예배(scope) 자신은 뺌 */
async function historyFor(team, scope) {
  const [songs, evs] = await Promise.all([sheetsDb.readAll('찬양콘티'), specialServices(team)]);
  const evName = new Map(evs.map((e) => [e['ID'], e['이름']]));
  const mine = songs.filter((r) => r['팀ID'] === team && String(r['제목'] || '').trim() && !inScope(r, scope));
  const days = new Map();
  mine.forEach((r) => {
    const k = r['행사ID'] ? 'ev-' + r['행사ID'] : String(r['날짜']);
    if (!days.has(k)) days.set(k, { key: k, date: String(r['날짜']), name: r['행사ID'] ? (evName.get(r['행사ID']) || '주일 외 찬양') : '', songs: [] });
    days.get(k).songs.push(r);
  });
  const list = Array.from(days.values()).map((d) => {
    d.songs.sort((a, b) => (a['구분'] === b['구분'] ? 0 : (a['구분'] === '결단' ? 1 : -1)) || Number(a['순서'] || 0) - Number(b['순서'] || 0));
    return d;
  }).sort((a, b) => {
    // 이 예배보다 앞선 날짜(지난 콘티)를 최근 순으로 먼저, 미리 짜 둔 뒤 날짜는 그 아래에 가까운 순으로
    const pa = a.date < scope.date ? 0 : 1, pb = b.date < scope.date ? 0 : 1;
    return pa - pb || (pa === 0 ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
  });
  // 곡 검색용 — 같은 제목은 가장 최근 기록 하나만
  const seen = new Map();
  list.forEach((d) => d.songs.forEach((r) => { const n = songNorm(r['제목']); if (n && !seen.has(n)) seen.set(n, { id: r['ID'], t: String(r['제목']), tm: String(r['팀'] || ''), k: String(r['Key'] || ''), b: String(r['BPM'] || ''), d: d.date, e: d.name }); }));
  return { days: list, songs: Array.from(seen.values()).slice(0, 500) };
}
function importHtml(team, scope, kind, hist) {
  const label = (d) => `${fmtDay(d.date)}${d.name ? ' · ' + d.name : ' 주일'}`;
  const meta = (r) => [r['Key'], r['BPM'] && `${r['BPM']}BPM`, r['팀']].filter(Boolean).join(' · ');
  const days = hist.days.slice(0, 12).map((d) => `<details class="cn-iday">
      <summary><b>${esc(label(d))}</b><span>${d.songs.length}곡</span></summary>
      <div class="cn-ibody"><button type="button" class="cn-mini" data-cn-pickall>이 콘티 전체 선택</button>
      ${d.songs.map((r) => `<label class="cn-ichk"><input type="checkbox" name="곡" value="${esc(r['ID'])}"><span class="t">${r['구분'] === '결단' ? '<em>결단</em>' : ''}${esc(r['제목'])}</span><span class="m">${esc(meta(r))}</span></label>`).join('')}</div>
    </details>`).join('');
  return `<details class="ph-add cn-add cn-import" data-cn-import>
    <summary>${ui.icon('folder')} 이전 콘티에서 가져오기</summary>
    <form method="post" action="/conti/songs/import" class="ph-inlineform cn-importform">
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="구분" value="${kind}">
      ${hist.days.length ? `<input type="search" class="cn-isearch" placeholder="곡 제목으로 찾기 (지난 콘티 전체)" data-cn-isearch autocomplete="off">
      <div class="cn-ihist" data-cn-ihist>${days}</div>
      <div class="cn-ifound" data-cn-ifound hidden></div>
      <div class="cn-iopts">
        <label><input type="checkbox" name="악보" value="1" checked> 곡 악보도 함께</label>
        <label><input type="checkbox" name="설명" value="1"> 설명도 함께</label>
      </div>
      <button class="ph-btn pri" type="submit">선택한 곡 가져오기</button>
      <script type="application/json" data-cn-idata>${JSON.stringify(hist.songs).replace(/</g, '\\u003c')}</script>` : '<p class="ph-sub">아직 가져올 지난 콘티가 없어요.</p>'}
    </form>
  </details>`;
}

/** 설교 후 찬양 — "콘티 마지막 곡과 같아요" 체크하면 오늘 콘티에서 골라 그대로 가져옴 */
function sameAsHtml(team, scope, conti) {
  if (!conti.length) return '';
  const last = conti[conti.length - 1];
  return `<form method="post" action="/conti/songs/import" class="cn-same" data-cn-same>
    <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="구분" value="결단"><input type="hidden" name="악보" value="1">
    <label class="cn-samechk"><input type="checkbox" data-cn-sametoggle><span>콘티 마지막 곡과 같아요</span><em>${esc(last['제목'])}</em></label>
    <div class="cn-samebody" hidden>
      <p class="ph-sub">오늘 콘티에서 한 곡을 골라 그대로 가져옵니다 (Key · 송폼 · 유튜브 · 악보까지).</p>
      ${conti.map((r, i) => `<label class="cn-ichk"><input type="radio" name="곡" value="${esc(r['ID'])}"${r === last ? ' checked' : ''}><span class="t"><b>${i + 1}</b>${esc(r['제목'])}</span><span class="m">${esc([r['Key'], r['BPM'] && `${r['BPM']}BPM`].filter(Boolean).join(' · '))}</span></label>`).join('')}
      <button class="ph-btn pri" type="submit">설교 후 찬양으로 넣기</button>
    </div>
  </form>`;
}

function songForm(kind, team, scope, roster, byPos, hist) {
  const label = kind === '결단' ? '설교 후 찬양' : '콘티';
  const uid = `new${kind === '결단' ? 'f' : 'c'}`;
  return `
  ${kind === '콘티' && hist ? importHtml(team, scope, kind, hist) : ''}
  <details class="ph-add">
    <summary>+ ${label} 하나하나 올리기</summary>
    <form method="post" action="/conti/songs" enctype="multipart/form-data" class="ph-inlineform">
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
      <div class="ph-field cn-newsheet"><label>악보 (PDF · 사진, 여러 개 가능 · 선택)</label>
        <input type="file" name="파일" accept=".pdf,image/*" multiple>
        <input type="text" name="링크" placeholder="또는 악보 링크 (파일 대신)">
        <button type="button" class="ph-btn" data-sheet-search data-pick="1">${ui.icon('search')} 웹에서 악보 찾기</button><span class="ss-picked" hidden></span></div>
      <button class="ph-btn pri" type="submit">추가</button>
    </form>
  </details>
  <details class="ph-add">
    <summary>+ ${label} 한꺼번에 올리기</summary>
    <form method="post" action="/conti/songs/bulk" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="구분" value="${kind}">
      <p class="ph-sub">한 줄에 한 곡씩, <b>제목 - 원곡팀 - Key</b> 순서로 붙여넣으세요. 원곡팀·Key는 생략해도 됩니다.</p>
      <textarea name="목록" rows="5" placeholder="주님의 사랑 - 마커스 - G
은혜 - - A" style="width:100%;padding:10px 13px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg-2);color:var(--ink);font-size:15px;font-family:inherit;"></textarea>
      <button class="ph-btn pri" type="submit">한 번에 추가</button>
    </form>
  </details>`;
}

function sheetItem(s, editable) {
  return `<div class="ph-list-item">
    <div class="ph-li-main"><a class="ph-li-link strong" href="${esc(s['파일링크'])}" target="_blank" rel="noopener">${ui.icon('page')} ${esc(s['제목'] || '악보')}</a>
      <div class="ph-li-sub">${esc(honorific.forTeam(s['팀ID'], s['올린사람'] || ''))}</div></div>
    ${editable ? `<form method="post" action="/conti/sheets/delete" onsubmit="return confirm('이 악보를 지울까요?')">
      <input type="hidden" name="__row" value="${s.__row}">
      <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
      <button class="ph-row-del" type="submit" title="삭제" aria-label="삭제">${ui.icon('close')}</button>
    </form>` : ''}
  </div>`;
}

/** 패키지 악보 한 개를 곡별로 나누는 칸 — PDF 의 쪽을 곡마다 정해 두면 그 쪽 범위가 곡(곡ID)에 묶여 저장돼, 다른 주 콘티에 그 곡을 넣을 때 악보가 따라와요.
 *  (쪽을 자동으로 찾는 일은 public/js/conti-tools.js [data-cn-split] 가 PDF 글자에서 곡 제목을 찾아 채워 줌 — 고칠 수 있음) */
function splitPanel(team, scope, s, songs, allSheets) {
  if (!songs || !songs.length || !s['파일링크']) return '';
  const id = liveStore.sheetIdOf(team, s['파일링크']);
  const saved = {};
  (songs || []).forEach((g) => { saved[g.id] = ''; });
  (allSheets || []).forEach((f) => { if (f['파일링크'] === s['파일링크'] && f['곡ID'] && f['쪽'] && Object.prototype.hasOwnProperty.call(saved, f['곡ID'])) saved[f['곡ID']] = f['쪽']; });
  const has = Object.keys(saved).some((k) => saved[k]);
  return `<details class="ph-add cn-split" data-cn-split data-src="/sheet/${esc(id)}" data-has="${has ? 1 : 0}">
    <summary>${ui.icon('page')} 곡별로 나누기${has ? ' · 저장됨' : ''}</summary>
    <form method="post" action="/conti/sheets/split" class="cn-splitform">
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="파일링크" value="${esc(s['파일링크'])}">
      <p class="ph-sub cn-splithint" data-cn-splithint>곡마다 이 악보의 몇 쪽인지 적어 주세요 (예: 1-2 · 3 · 4,6). 저장하면 곡에 묶여 다음에도 그 곡을 넣을 때 따라와요.</p>
      <div class="cn-splitrows">${songs.map((g, i) => `<label class="cn-splitrow"><span class="cn-splitn">${g.kind === '결단' ? '결단' : i + 1}</span><span class="cn-splitt">${esc(g.title)}</span><input type="text" inputmode="text" name="쪽_${esc(g.id)}" data-cn-pages="${esc(g.title)}" value="${esc(saved[g.id])}" placeholder="쪽" maxlength="40" aria-label="${esc(g.title)} 쪽"></label>`).join('')}</div>
      <div class="cn-splitbtns"><button type="button" class="cn-mini" data-cn-splitauto>제목으로 자동 찾기</button><button class="ph-btn pri" type="submit">곡별로 저장</button></div>
    </form>
  </details>`;
}

/** 패키지(콘티 전체) 악보 — 특정 곡(곡ID)에 안 묶인 것들만. 콘티 목록 바로 아래 카드로 둠. songs 를 주면 "곡별로 나누기"가 붙음 */
function packageSheetsCard(team, scope, sheets, editable, songs) {
  const pkg = (sheets || []).filter((s) => !s['곡ID']);
  const canSplit = editable && songs && songs.length;
  return `<div class="ph-card">
    <h2 class="ph-h2">악보</h2>
    ${editable ? '<p class="ph-sub">이번 주 콘티 전체를 한 패키지(PDF 한 개)로 올린 뒤 <b>곡별로 나누기</b>를 누르면, 곡마다 쪽이 정해져 그 곡에 묶여요. 곡 목록의 "+ 이 곡 악보 올리기"로 곡별로 따로 올려도 돼요.</p>' : ''}
    <div class="ph-list">${pkg.length ? pkg.map((s) => sheetItem(s, editable) + (canSplit ? splitPanel(team, scope, s, songs, sheets) : '')).join('') : '<p class="ph-sub">아직 올라온 패키지 악보가 없어요.</p>'}</div>
    ${editable ? `<details class="ph-add">
      <summary>+ 전체 콘티 악보(패키지) 올리기</summary>
      <form method="post" action="/conti/sheets" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}
        <input type="file" name="파일" accept=".pdf,image/*" multiple>
        <input type="text" name="제목" placeholder="제목 (비워 두면 파일 이름이 제목이 돼요)">
        <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
        <button class="ph-btn pri" type="submit">올리기</button>
      </form>
    </details>` : ''}
  </div>`;
}

function commentItem(c) {
  return `<div class="ph-list-item"><div class="ph-li-main">
    <div class="ph-li-title">${esc(honorific.forTeam(c['팀ID'], c['이름'] || '익명'))}</div>
    <div class="ph-li-note">${esc(c['내용'] || '')}</div>
  </div></div>`;
}

/** 녹음의 재생 주소 — 드라이브에 올린 파일은 이 앱 주소(/audio/<id>, 되감기 · 빠르기 조절 가능), 그 밖의 링크는 그대로. 유튜브 링크는 오디오 파일이 아니라서 '' */
function recSrc(r) {
  const link = String(r['링크'] || '');
  const id = liveStore.driveIdOf(link);
  if (id) return '/audio/' + id;
  if (!/^https?:\/\//i.test(link) || youtube.idOf(link) || /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\//i.test(link)) return '';
  return link;
}
function recItem(r, editable) {
  const src = recSrc(r), title = String(r['제목'] || '녹음');
  return `<div class="ph-list-item rp-item"${src ? ` data-rp-src="${esc(src)}" data-rp-title="${esc(title)}" data-rp-by="${esc(honorific.forTeam(r['팀ID'], r['올린사람'] || ''))}"` : ''}>
    ${src ? `<button type="button" class="rp-playbtn" data-rp-pick title="재생" aria-label="${esc(title)} 재생"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg></button>` : ''}
    <div class="ph-li-main">${src ? `<button type="button" class="rp-name" data-rp-pick>${esc(title)}</button>` : `<a class="ph-li-link strong" href="${esc(r['링크'])}" target="_blank" rel="noopener">${ui.icon('headphones')} ${esc(title)}</a>`}
      <div class="ph-li-sub">${esc(honorific.forTeam(r['팀ID'], r['올린사람'] || ''))}${src ? ` · <a class="ph-li-link" href="${esc(r['링크'])}" target="_blank" rel="noopener">새 창</a>` : ' · 유튜브 등 링크는 새 창에서 열려요'}</div></div>
    ${editable ? `<form method="post" action="/conti/recordings/delete" onsubmit="return confirm('이 녹음을 지울까요?')">
      <input type="hidden" name="__row" value="${r.__row}">
      <input type="hidden" name="team" value="${esc(r['팀ID'])}">${rowHidden(r)}
      <button class="ph-row-del" type="submit" title="삭제" aria-label="삭제">${ui.icon('close')}</button>
    </form>` : ''}
  </div>`;
}

/* ================= 연습일 — 이 예배(주일 · 행사)를 언제 연습하는지 (스케줄표에서 정함 · lib/practice.js) ================= */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const mdDow = (d) => { const x = new Date(d + 'T12:00:00'); return `${x.getMonth() + 1}월 ${x.getDate()}일(${DOW[x.getDay()]})`; };
async function practiceInfo(team, scope, date) {
  const rows = (await sheetsDb.readAll('연습일정')).filter((r) => r['팀ID'] === team);
  const key = scope.event ? 'ev-' + scope.event : date;
  const p = prac.practiceFor(key, date, rows);
  const together = [];
  if (p.date && !p.none) {
    const evs = await specialServices(team);
    const cands = [];
    for (let i = 0; i <= 42; i++) {
      const d = prac.addDays(p.date, i);
      if (new Date(d + 'T12:00:00').getDay() === 0) cands.push({ key: d, date: d, name: '' });
    }
    evs.forEach((e) => { if (e['날짜'] >= p.date && e['날짜'] <= prac.addDays(p.date, 42)) cands.push({ key: 'ev-' + e['ID'], date: e['날짜'], name: e['이름'] }); });
    cands.forEach((c) => {
      if (c.key === key) return;
      const q = prac.practiceFor(c.key, c.date, rows);
      if (!q.none && q.date === p.date) together.push(c.name ? c.name : `${Number(c.date.slice(5, 7))}/${Number(c.date.slice(8, 10))} 주일`);
    });
  }
  return { p, together };
}
function practiceCard(team, info) {
  const { p, together } = info;
  const href = `/schedule?team=${encodeURIComponent(team)}`;
  let main;
  if (p.none) main = '<span class="ph-pr-none">이 예배는 연습이 없어요</span>';
  else if (p.unset || !p.date) main = '<span class="ph-pr-none">연습일이 아직 정해지지 않았어요</span>';
  else main = `<b>${esc(mdDow(p.date))}</b>${p.note ? `<span class="ph-pr-note">${esc(p.note)}</span>` : ''}`;
  return `<div class="ph-card ph-practicecard">
    <div class="ph-pr-row">
      <span class="ph-pr-ic">${ui.icon('metronome')}</span>
      <div class="ph-pr-main"><span class="ph-pr-label">연습일</span>${main}
        ${together.length ? `<span class="ph-pr-with">같은 날 함께 연습 · ${together.map(esc).join(' · ')}</span>` : ''}</div>
      <a class="ph-pr-edit" href="${href}">스케줄표에서 바꾸기 ${ui.icon('next')}</a>
    </div>
  </div>`;
}

/* ================= 로그인 화면 ================= */
router.get('/conti', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;

  // event= 쿼리가 있고 실제로 이 팀의 주일 외 찬양면 "행사 모드" — 같은 날짜라도 주일예배와 완전히 분리된
  // 콘티·편성·악보·녹음·댓글. 없거나 못 찾으면 보통 때처럼 날짜 모드.
  const eventRow = await specialServiceById(team, String(req.query.event || '').trim());
  const date = eventRow ? eventRow['날짜'] : week.normalizeDate(req.query.date);
  const scope = { event: eventRow ? eventRow['ID'] : '', date };

  const w = await loadWeek(team, scope);

  let dayBanner = '';
  const allAssignRows = (await sheetsDb.readAll('찬양편성')).filter((r) => r['팀ID'] === team);
  const evs = (await specialServices(team)).map((e) => ({ id: e['ID'], name: String(e['이름'] || '주일 외 찬양'), date: e['날짜'] }));
  // 달력 띠 — 주일 외 찬양(부흥회 등)는 같은 날짜라도 날짜 칸 옆에 따로 (눌러서 오감)
  const strip = pageShell.weekStrip({ basePath: '/conti', team, date, assignRows: allAssignRows, events: evs, activeEvent: scope.event ? scope.event : '' });
  if (scope.event) {
    dayBanner = `<div class="ph-card ph-eventsbanner">
      <p class="ph-sub">${esc(eventRow['이름'])} 콘티예요 — 주일예배와는 별도 기록입니다. <a href="/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}">이 날짜의 주일예배 콘티 보기 →</a></p>
      <p class="ph-sub"><a href="/events?team=${encodeURIComponent(team)}">← 주일 외 찬양 목록으로</a></p>
    </div>`;
  }

  const guestToken = await guestLink.tokenFor(team).catch(() => '');

  const hero = pageShell.hero(scope.event
    ? { eyebrow: `${team} · 주일 외 찬양 콘티`, title: eventRow['이름'], sub: week.labelKo(date) }
    : { eyebrow: `${team} · 예배콘티`, title: '예배콘티', sub: week.labelKo(date) });
  const { byPos, roster, infoMap } = await weekAssignments(team, scope);
  const lineup = await lineupCard(team, scope, byPos, roster, infoMap, scope.event ? eventRow['이름'] : '', ctx.isAdmin);
  const pinfo = await practiceInfo(team, scope, date);
  const practice = practiceCard(team, pinfo);
  const hist = await historyFor(team, scope);
  const tagSet = ALL_POSITIONS.concat(roster).sort((a, b) => b.length - a.length);
  const songCtx = { editable: true, roster, byPos, sheets: w.sheets, tagSet };
  // 카카오톡 요약 — 부를 이름(목회자는 "OOO 목사")으로 채운 한 주 자료
  const honor = (n) => (honorific.isPastorRoles((infoMap[n] || {}).역할) ? n + honorific.SUFFIX : n);
  const slotNames = {}; Object.keys(byPos).forEach((k) => { slotNames[k] = byPos[k].map((x) => honor(x.이름)); });
  const kakao = kakaoLib.kakaoText({
    date, event: scope.event ? { name: eventRow['이름'] } : null, practice: pinfo.p && pinfo.p.date && !pinfo.p.none ? pinfo.p : null, slots: slotNames,
    songs: w.conti.map((r) => ({ title: r['제목'], team: r['팀'], key: r['Key'], form: kakaoLib.formText(r['송폼']), note: r['비고'], link: r['유튜브'] })),
    finals: w.final.map((r) => ({ title: r['제목'], key: r['Key'], link: r['유튜브'] })),
  });

  const content = `
  ${pageShell.hubNav('conti', team)}
  ${hero}
  ${strip}
  ${dayBanner}
  ${practice}
  ${(() => {
    const switcher = teamContext.teamSwitcher(ctx, { keep: scope.event ? { event: scope.event } : { date } });
    // 라이브 악보 (church-app 그대로) — 주일예배는 날짜, 행사는 행사 콘티 그대로 엽니다 (서로 다른 방 · 다른 필기 범위)
    const liveHref = scope.event
      ? `/conti/practice?team=${encodeURIComponent(team)}&event=${encodeURIComponent(scope.event)}`
      : `/conti/practice?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}`;
    const nSheets = new Set(w.sheets.filter((s) => s['파일링크']).map((s) => s['파일링크'])).size;
    const liveBtn = `<a class="ph-btn pri ph-livebtn" style="margin-top:12px;" href="${liveHref}" title="라이브 악보 — 필기 · 메트로놈 · 함께 보기 화면을 엽니다">${ui.icon('note')} 라이브 악보<small>${nSheets ? `악보 ${nSheets}개 · ` : ''}필기 · 메트로놈 · 함께 보기</small></a>`;
    const offBtn = `<button type="button" class="cn-mini cn-offbtn" data-cn-offopen data-team="${esc(team)}" data-date="${esc(date)}" data-event="${esc(scope.event)}" aria-expanded="false">${ui.icon('download')} 오프라인용 다운로드</button>`;
    const kakaoBtn = w.conti.length ? `<button type="button" class="cn-mini cn-kakaobtn" data-cn-kakao>${ui.icon('clipboard')} 카카오톡 콘티 요약 복사</button>` : '';
    const pkgHref = `/conti/package.pdf?team=${encodeURIComponent(team)}&${scope.event ? 'event=' + encodeURIComponent(scope.event) : 'date=' + encodeURIComponent(date)}`;
    const pkgBtn = w.conti.length || w.final.length ? `<button type="button" class="cn-mini cn-pkgbtn" data-pkg-open data-href="${esc(pkgHref)}" data-title="${esc(scope.event ? eventRow['이름'] : week.shortKo(date, true))} 인쇄용 PDF" title="표지 + 곡별 머리말 + 악보 · US Letter 흑백 인쇄용 PDF — 미리보고 다운로드">${ui.icon('download')} 인쇄용 PDF 패키지</button>` : '';
    const extras = liveBtn + `<div class="cn-toolrow">${pkgBtn}${kakaoBtn}${offBtn}</div>
    ${guestPanel(req, team, scope, guestToken, ctx.isAdmin, req.query.gl === '1')}
    <div class="cn-offpanel" data-cn-offpanel hidden></div>
    ${w.conti.length ? `<details class="cn-kakaopv" data-cn-kakaopv><summary>카톡에 붙여 넣을 글 미리보기</summary><textarea readonly rows="12" data-cn-kakaotxt aria-label="카카오톡 콘티 요약">${esc(kakao)}</textarea></details><p class="ph-msg cn-toolmsg" data-cn-toolmsg role="status"></p>` : '<p class="ph-msg cn-toolmsg" data-cn-toolmsg role="status"></p>'}`;
    if (!switcher && !extras) return '';
    return `<div class="ph-card">${switcher}${extras}</div>`;
  })()}

  ${lineup}

  ${(() => { const y = ytPlayAllHtml(w); return y ? `<div class="ph-card cn-ycard"><h2 class="ph-h2">유튜브 이어 듣기</h2><p class="ph-sub" style="margin:-4px 0 10px;">곡마다 올린 유튜브 링크를 콘티 순서대로 이어서 들어요.</p>${y}</div>` : ''; })()}

  <div class="ph-card top-accent">
    <h2 class="ph-h2">콘티</h2>
    <div class="cn-songs">${w.conti.length ? w.conti.map((s, i) => songCard(s, Object.assign({ index: i + 1, kind: '콘티' }, songCtx))).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div>
    ${songForm('콘티', team, scope, roster, byPos, hist)}
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">설교 후 찬양</h2>
    <div class="cn-songs">${w.final.length ? w.final.map((s) => songCard(s, Object.assign({ index: 1, kind: '결단' }, songCtx))).join('') : '<p class="ph-sub">아직 없어요. 한 곡만 올릴 수 있어요.</p>'}</div>
    ${w.final.length ? '' : sameAsHtml(team, scope, w.conti) + songForm('결단', team, scope, roster, byPos, null)}
  </div>

  ${packageSheetsCard(team, scope, w.sheets, true, w.conti.concat(w.final).map((r) => ({ id: r['ID'], title: String(r['제목'] || '제목 없음'), kind: r['구분'] })))}

  <div class="ph-card">
    <h2 class="ph-h2">녹음</h2>
    <h3 class="ph-h3">연습 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] !== '예배').length ? w.recs.filter((r) => r['구분'] !== '예배').map((r) => recItem(r, true)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <h3 class="ph-h3">예배 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] === '예배').length ? w.recs.filter((r) => r['구분'] === '예배').map((r) => recItem(r, true)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 녹음 올리기</summary>
      <form method="post" action="/conti/recordings" enctype="multipart/form-data" class="ph-inlineform" data-rec-form>
        <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}
        <input type="text" name="제목" placeholder="녹음 제목 (비워 두면 파일 이름 · 링크 제목이 자동으로 들어가요)">
        <select name="구분"><option value="연습">연습 녹음</option><option value="예배">예배 녹음</option></select>
        <input type="file" name="파일" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.aac">
        <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신) — 유튜브 · 드라이브 · 음원 주소">
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
  `;
  spa.send(req, res, content, { title: scope.event ? `${team} ${eventRow['이름']}` : `${team} 예배콘티` });
});

/* 라이브 악보(/conti/practice)는 routes/live.js 로 옮겼습니다 — church-app 의 라이브 악보를 그대로 씁니다. */

/** 인쇄용 PDF 패키지 — 표지(연습 일시 · 멤버 · 콘티 · 유튜브 QR) + 곡마다 머리말/악보/꼬리말, US Letter 흑백.  ?crop=0 이면 악보 위 제목 자르기를 끔 */
async function makePackage(req, onProgress) {
  {
    const t0 = Date.now();
    const team = req.ctx.current;
    const eventRow = await specialServiceById(team, String(req.query.event || '').trim());
    const date = eventRow ? eventRow['날짜'] : week.normalizeDate(req.query.date);
    const scope = { event: eventRow ? eventRow['ID'] : '', date };
    const w = await loadWeek(team, scope);
    const { byPos, infoMap } = await weekAssignments(team, scope);
    const pinfo = await practiceInfo(team, scope, date);
    const honor = (n) => (honorific.isPastorRoles((infoMap[n] || {}).역할) ? n + honorific.SUFFIX : n);
    const members = ALL_POSITIONS.map((k) => ({ pos: k, names: (byPos[k] || []).map((x) => honor(x.이름)) })).filter((m) => m.names.length);
    const used = new Set();
    const cache = new Map();
    const bytesOf = (link) => { if (!cache.has(link)) cache.set(link, fileBytes.get(link)); return cache.get(link); };   // 한 번만, 동시에 받음
    const links = new Set(); w.sheets.forEach((f) => { if (f['파일링크']) links.add(f['파일링크']); });
    let fetchedN = 0;
    links.forEach((l) => { bytesOf(l).then(() => { fetchedN++; onProgress(0.02 + 0.28 * (fetchedN / links.size), '악보 받는 중 (' + fetchedN + '/' + links.size + ')'); }); });
    onProgress(0.02, '악보 받는 중');
    const all = [].concat(w.conti.map((s, i) => ({ s, kind: '콘티', no: i + 1 })), w.final.map((s) => ({ s, kind: '결단', no: 1 })));
    const songs = [];
    for (const x of all) {
      const mine = w.sheets.filter((f) => f['곡ID'] === x.s['ID'] && f['파일링크']).sort((a, b) => String(a['올린시각']).localeCompare(String(b['올린시각'])));
      const sheets = [];
      for (const f of mine) { used.add(f['파일링크']); const buf = await bytesOf(f['파일링크']); if (buf) sheets.push({ buf, spec: String(f['쪽'] || ''), crop: String(f['자르기'] || '') }); }
      songs.push({ no: x.no, kind: x.kind, title: String(x.s['제목'] || '').trim(), team: String(x.s['팀'] || '').trim(), key: String(x.s['Key'] || '').trim(), bpm: String(x.s['BPM'] || '').trim(),
        form: kakaoLib.formText(x.s['송폼']), note: String(x.s['비고'] || '').trim(), sheets });
    }
    const extra = [];
    for (const f of w.sheets.filter((r) => !r['곡ID'] && r['파일링크'] && !used.has(r['파일링크']))) {
      used.add(f['파일링크']); const buf = await bytesOf(f['파일링크']);
      if (buf) extra.push({ title: String(f['제목'] || '악보'), sheets: [{ buf, spec: String(f['쪽'] || '') }] });
    }
    const ids = []; all.forEach((x) => { const id = youtube.idOf(x.s['유튜브']); if (id && ids.indexOf(id) === -1) ids.push(id); });
    const qrUrl = ids.length === 1 ? 'https://youtu.be/' + ids[0] : ids.length ? 'https://www.youtube.com/watch_videos?video_ids=' + ids.slice(0, 50).join(',') : '';
    const tFetched = Date.now();
    const pr = pinfo.p && (pinfo.p.none || pinfo.p.date) ? pinfo.p : null;
    const pdf = await pkgPdf.build({
      church: process.env.CHURCH_NAME || '토론토영락교회', team, date, eventName: eventRow ? String(eventRow['이름'] || '') : '',
      title: eventRow ? String(eventRow['이름'] || '') + ' 찬양 콘티' : '주일예배 찬양 콘티',
      practice: pr ? { date: pr.date, note: pr.note, none: pr.none } : null, members, songs, extra, qrUrl, qrCount: ids.length, crop: String(req.query.crop) !== '0', onProgress,
    }, sheetSearch.imagesToPdf);
    console.log(`[PDF 패키지] ${team} ${date} — 악보 받기 ${tFetched - t0}ms · 만들기 ${Date.now() - tFetched}ms · ${(pdf.length / 1024) | 0}KB`);
    const name = `${team} 콘티 ${date}${eventRow ? ' ' + eventRow['이름'] : ''}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim();
    const sig = pkgSig({ w, members, pr, title: eventRow ? String(eventRow['이름'] || '') : '', date });
    return { pdf, name, sig, date, event: scope.event };
  }
}

/** 지금 콘티 · 악보 · 편성 · 연습 상태의 지문 — 확정한 PDF 를 만들 때와 같은지 비교해서 "확정 이후 바뀜"을 알려 줌 */
function pkgSig({ w, members, pr, title, date }) {
  const meta = (f) => [f['파일링크'], f['쪽'] || '', f['자르기'] || ''].join('|');
  const all = [].concat(w.conti, w.final);
  const songs = all.map((s) => [s['ID'], s['제목'], s['팀'], s['Key'], s['BPM'], kakaoLib.formText(s['송폼']), s['비고'], s['유튜브'],
    w.sheets.filter((f) => f['곡ID'] === s['ID'] && f['파일링크']).sort((a, b) => String(a['올린시각']).localeCompare(String(b['올린시각']))).map(meta)]);
  const extra = w.sheets.filter((r) => !r['곡ID'] && r['파일링크']).map(meta);
  return require('crypto').createHash('sha1').update(JSON.stringify([pkgPdf.LAYOUT_V, title, date, pr && [pr.date, pr.note, pr.none], members, songs, extra])).digest('hex');
}
async function pkgContext(req) {
  const team = req.ctx.current;
  const eventRow = await specialServiceById(team, String((req.query && req.query.event) || (req.body && req.body.event) || '').trim());
  const date = eventRow ? eventRow['날짜'] : week.normalizeDate((req.query && req.query.date) || (req.body && req.body.date));
  return { team, eventRow, date, scope: { event: eventRow ? eventRow['ID'] : '', date } };
}
async function savedRow(team, scope) {
  return (await sheetsDb.readAll('확정PDF')).find((r) => r['팀ID'] === team && r['날짜'] === scope.date && String(r['행사ID'] || '') === (scope.event || '')) || null;
}

const pkgJobs = new Map();                      // 만드는 중인 PDF — 진행률을 화면에 보여 주려고 (10분 뒤 정리)
function sendPdf(res, r) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(r.pdf.length), 'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.name)}.pdf` });
  res.send(r.pdf);
}
router.get('/conti/package/start', requireTeam, (req, res) => {
  res.set('Cache-Control', 'no-store');
  for (const [k, j] of pkgJobs) if (Date.now() - j.at > 600000) pkgJobs.delete(k);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job = { at: Date.now(), team: req.ctx.current, pct: 0, label: '준비 중', done: false, err: false, result: null };
  pkgJobs.set(id, job);
  makePackage(req, (p, label) => { if (p > job.pct) job.pct = Math.min(0.99, p); if (label) job.label = label; })
    .then((r) => { job.result = r; job.pct = 1; job.done = true; job.label = '완료'; })
    .catch((e) => { console.error('[PDF 패키지 실패]', e && e.stack || e); job.err = true; job.done = true; });
  res.json({ id });
});
router.get('/conti/package/status', requireTeam, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const j = pkgJobs.get(String(req.query.id || ''));
  if (!j || j.team !== req.ctx.current) return res.status(404).json({ gone: true });
  res.json({ pct: Math.round(j.pct * 100), label: j.label, done: j.done, err: j.err });
});

/** 확정해 둔 PDF 가 있는지 (+ 확정 이후 콘티 · 악보 · 편성이 바뀌었는지) */
router.get('/conti/package/saved', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { team, eventRow, date, scope } = await pkgContext(req);
    const row = await savedRow(team, scope);
    if (!row) return res.json({ saved: false });
    const w = await loadWeek(team, scope);
    const { byPos, infoMap } = await weekAssignments(team, scope);
    const honor = (n) => (honorific.isPastorRoles((infoMap[n] || {}).역할) ? n + honorific.SUFFIX : n);
    const members = ALL_POSITIONS.map((k) => ({ pos: k, names: (byPos[k] || []).map((x) => honor(x.이름)) })).filter((m) => m.names.length);
    const pinfo = await practiceInfo(team, scope, date);
    const pr = pinfo.p && (pinfo.p.none || pinfo.p.date) ? pinfo.p : null;
    const sig = pkgSig({ w, members, pr: pr && { date: pr.date, note: pr.note, none: pr.none }, title: eventRow ? String(eventRow['이름'] || '') : '', date });
    res.json({ saved: true, by: row['확정자'], at: row['확정시각'], stale: sig !== row['시그니처'] });
  } catch (e) { console.error('[확정 PDF 확인 실패]', e.message); res.json({ saved: false }); }
});

/** 방금 만든 PDF(job)를 확정 — 드라이브에 저장하고, 다음부터는 이 파일을 바로 내려받음 (이미 있으면 교체) */
router.post('/conti/package/confirm', requireTeam, async (req, res) => {
  try {
    const { team, scope } = await pkgContext(req);
    const j = pkgJobs.get(String((req.body || {}).job || ''));
    if (!j || j.team !== team || !j.result || j.result.date !== scope.date || (j.result.event || '') !== (scope.event || '')) return res.status(400).json({ ok: false, msg: '만든 PDF를 찾지 못했어요. 다시 만들어 주세요.' });
    const link = await driveStore.uploadPrivate('인쇄용PDF', { originalname: `${j.result.name}.pdf`, mimetype: 'application/pdf', buffer: j.result.pdf });
    const old = await savedRow(team, scope);
    const row = { 'ID': 'P' + Date.now().toString(36), '팀ID': team, '날짜': scope.date, '행사ID': scope.event || '', '파일링크': link, '시그니처': j.result.sig, '확정자': req.ctx.member['이름'], '확정시각': new Date().toISOString(), '파일명': j.result.name };
    if (old) { await sheetsDb.updateRow('확정PDF', old.__row, row); driveStore.removeByLink(old['파일링크']); } else await sheetsDb.appendRow('확정PDF', row);
    res.json({ ok: true, by: row['확정자'], at: row['확정시각'] });
  } catch (e) { console.error('[PDF 확정 실패]', e && e.stack || e); res.status(500).json({ ok: false, msg: '확정하지 못했어요. 잠시 뒤 다시 해 주세요.' }); }
});

router.get('/conti/package.pdf', requireTeam, async (req, res) => {
  try {
    if (req.query.saved) {
      const { team, scope } = await pkgContext(req);
      const row = await savedRow(team, scope);
      const buf = row ? await fileBytes.get(row['파일링크']) : null;
      if (!buf) return res.status(404).type('text').send('확정한 PDF를 찾지 못했어요.');
      return sendPdf(res, { pdf: buf, name: String(row['파일명'] || '콘티') });
    }
    if (req.query.job) {
      const j = pkgJobs.get(String(req.query.job));
      if (!j || j.team !== req.ctx.current || !j.result) return res.status(404).type('text').send('만든 PDF를 찾지 못했어요. 다시 만들어 주세요.');
      return sendPdf(res, j.result);
    }
    sendPdf(res, await makePackage(req, () => {}));
  } catch (e) {
    console.error('[PDF 패키지 실패]', e && e.stack || e);
    if (!res.headersSent) res.status(500).type('text').send('PDF 패키지를 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
  }
});

/** 악보 영역 조정용 — 이 콘티의 곡별 악보 목록(JSON) */
router.get('/conti/package/areas', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const team = req.ctx.current;
    const eventRow = await specialServiceById(team, String(req.query.event || '').trim());
    const date = eventRow ? eventRow['날짜'] : week.normalizeDate(req.query.date);
    const w = await loadWeek(team, { event: eventRow ? eventRow['ID'] : '', date });
    const all = [].concat(w.conti.map((s, i) => ({ s, no: i + 1 })), w.final.map((s) => ({ s, no: '+' })));
    const out = [];
    all.forEach((x) => {
      w.sheets.filter((f) => f['곡ID'] === x.s['ID'] && f['파일링크']).sort((a, b) => String(a['올린시각']).localeCompare(String(b['올린시각'])))
        .forEach((f) => out.push({ row: f.__row, no: x.no, title: String(x.s['제목'] || ''), name: String(f['제목'] || ''), spec: String(f['쪽'] || ''), crop: pkgPdf.parseCrop(f['자르기']) }));
    });
    res.json({ sheets: out });
  } catch (e) { res.status(500).json({ sheets: [] }); }
});

/** 악보 영역 조정용 — 악보 원본 파일(PDF · 사진 → PDF) */
router.get('/conti/sheets/raw', requireTeam, async (req, res) => {
  try {
    const row = Number(req.query.row);
    const f = (await sheetsDb.readAll('악보저장소')).find((r) => r.__row === row && r['팀ID'] === req.ctx.current);
    const buf = f && f['파일링크'] ? await fileBytes.get(f['파일링크']) : null;
    if (!buf) return res.status(404).type('text').send('악보를 불러오지 못했어요.');
    let out = buf;
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') { try { out = await sheetSearch.imagesToPdf([buf]); } catch (e) { return res.status(415).type('text').send('지원하지 않는 파일이에요.'); } }
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=300' }).send(out);
  } catch (e) { res.status(500).type('text').send('오류'); }
});

/** 악보 영역 저장 — crop: "왼쪽,위,오른쪽,아래" 를 0~1 비율로(쪽 전체 = 0,0,1,1). 비우거나 전체면 자동으로 되돌림 */
router.post('/conti/sheets/crop', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  const c = pkgPdf.parseCrop(b.crop);
  try {
    const f = (await sheetsDb.readAll('악보저장소', { fresh: true })).find((r) => r.__row === row && r['팀ID'] === req.ctx.current);
    if (!f) return res.status(404).json({ ok: false });
    await sheetsDb.updateRow('악보저장소', row, Object.assign({}, f, { '자르기': c ? [c.l, c.t, c.r, c.b].map((x) => x.toFixed(4)).join(',') : '' }));
    res.json({ ok: true, crop: c });
  } catch (e) { console.error('[악보 영역 저장 실패]', e.message); res.status(500).json({ ok: false }); }
});

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

router.post('/conti/songs', requireTeam, upload.array('파일', 12), guestGate.afterUpload, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const kind = b['구분'] === '결단' ? '결단' : '콘티';
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team, scope);
  const all = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && inScope(r, scope) && r['구분'] === kind);
  // 설교 후 찬양(결단)은 곡 하나만 — 이미 있으면 새로 추가하지 않음(기존 곡을 지우고 다시 올려야 함)
  if (kind === '결단' && all.length >= 1) return backTo(req, res, team, scope);
  const sid = 'C' + Date.now().toString(36);
  await sheetsDb.appendRow('찬양콘티', {
    'ID': sid, '팀ID': team, ...scopeFields(scope), '구분': kind,
    '순서': all.length + 1, '제목': title, '팀': b['팀'] || '', 'Key': b['Key'] || '', '유튜브': b['유튜브'] || '',
    '송폼': b['송폼'] || '', 'BPM': b['BPM'] || '', '비고': b['비고'] || '', '만든시각': new Date().toISOString(),
  });
  // 곡을 만들 때 악보(PDF · 사진 · 링크)도 함께 — 만든 곡에 바로 묶임. 악보 제목은 파일 이름
  try {
    const wf = await webSheetFile(b.url, title);          // 웹에서 찾아 고른 악보 이미지 → PDF 한 개
    if (wf) req.files = (req.files || []).concat([wf]);
    await saveSheetsFrom(req, team, scope, sid, { 'Key': b['Key'] || '', 'BPM': b['BPM'] || '' }, true);
  } catch (e) { console.error('[곡 악보 저장 실패]', e.message); }
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
      // 그 줄의 원래 ID · 옛 솔로 기록은 그대로 둡니다 (ID 가 바뀌면 "이 곡 전용 악보"가 곡에서 떨어져 나감)
      const old = (await sheetsDb.readAll('찬양콘티', { fresh: true })).find((r) => r.__row === row && r['팀ID'] === team) || {};
      await sheetsDb.updateRow('찬양콘티', row, {
        'ID': b['ID'] || old['ID'] || '', '팀ID': team, ...scopeFields(scope), '구분': b['구분'] === '결단' ? '결단' : '콘티',
        '순서': b['순서'] || old['순서'] || 0, '제목': title, '팀': b['팀'] || '', 'Key': b['Key'] || '', '유튜브': b['유튜브'] || '',
        '송폼': b['송폼'] || '', 'BPM': b['BPM'] || '', '비고': b['비고'] || '', '만든시각': b['만든시각'] || old['만든시각'] || new Date().toISOString(),
        '솔로': old['솔로'] || '',
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

/** 파일 이름에서 제목 — 확장자를 떼고, 올릴 때 붙는 숫자_ 같은 군더더기 없이 */
function titleFromFile(name) {
  let t = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  try { if (/Ã|Â|ì|ë|ê/.test(t) && !/[가-힣]/.test(t)) t = Buffer.from(t, 'latin1').toString('utf8'); } catch (e) { /* 그대로 */ }
  return t.slice(0, 80);
}
function titleFromLink(link) {
  try { const u = new URL(link); const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || ''); return titleFromFile(last) || u.hostname.replace(/^www\./, ''); } catch (e) { return '악보'; }
}
/** 웹에서 고른 이미지 주소들 → PDF 한 개 파일 객체({originalname,mimetype,buffer}). 주소가 없으면 null */
async function webSheetFile(urlsIn, title) {
  const urls = [].concat(urlsIn || []).map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, sheetSearch.MAX_IMAGES);
  if (!urls.length) return null;
  const bufs = [];
  for (const u of urls) bufs.push(await sheetSearch.fetchImage(u));
  const name = String(title || '').trim().slice(0, 80) || '악보';
  return { originalname: name.replace(/[\\/:*?"<>|]/g, ' ') + '.pdf', mimetype: 'application/pdf', buffer: await sheetSearch.imagesToPdf(bufs) };
}
/** 올라온 악보 파일(들) · 링크를 악보저장소에 한 줄씩 저장 — 곡ID 가 있으면 그 곡 전용 악보. 저장한 개수를 돌려줌 */
async function saveSheetsFrom(req, team, scope, songId, extra, ignoreTyped) {
  const b = req.body || {};
  const typed = ignoreTyped ? '' : String(b['제목'] || '').trim();   // 곡을 만들 때의 '제목'은 곡 제목이라 악보 제목으로 쓰지 않음
  const files = (req.files || []).filter((f) => f && f.buffer && f.buffer.length);
  const jobs = [];
  for (const f of files) {
    try { jobs.push({ title: (files.length === 1 && typed) || titleFromFile(f.originalname) || typed || '악보', link: await driveStore.uploadPublic('악보', f) }); }
    catch (e) { console.error('[악보 업로드 실패]', e.message); }
  }
  const link = String(b['링크'] || '').trim();
  if (!jobs.length && link) jobs.push({ title: typed || titleFromLink(link), link });
  for (let k = 0; k < jobs.length; k++) {
    await sheetsDb.appendRow('악보저장소', Object.assign({
      'ID': 'F' + Date.now().toString(36) + k + Math.random().toString(36).slice(2, 4), '팀ID': team, ...scopeFields(scope), '제목': jobs[k].title,
      '파일링크': jobs[k].link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
      '곡ID': String(songId || '').trim(),
    }, extra || {}));
  }
  return jobs.length;
}
/** 악보 올리기 — 제목은 안 써도 됩니다: 파일 이름이 제목이 되고(파일 여러 개를 한 번에도 가능), 링크만 넣으면 주소에서 따옴 */
router.post('/conti/sheets', requireTeam, upload.array('파일', 12), guestGate.afterUpload, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  await saveSheetsFrom(req, team, scope, b['곡ID']);
  backTo(req, res, team, scope);
});

/** 웹에서 악보 이미지 찾기 — 검색 결과(JSON). 키가 없으면 configured:false 로 알려 줘서 화면이 설정 안내를 보여 줌 */
router.get('/conti/sheetsearch', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!sheetSearch.configured()) return res.json({ configured: false, items: [] });
  try { res.json({ configured: true, items: await sheetSearch.search(req.query.q, req.query.start) }); }
  catch (e) {
    console.error('[악보 검색 실패]', e.message);
    res.json({ configured: true, items: [], error: e.code === 'QUOTA' ? '오늘 검색 가능 횟수를 다 썼어요. 내일 다시 해 주세요.' : '검색하지 못했어요. 잠시 뒤 다시 해 주세요.' });
  }
});

/** 고른 이미지(들)를 받아 PDF 한 개로 묶어 악보로 저장 — 곡ID 가 있으면 그 곡 전용 */
router.post('/conti/sheets/fromweb', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  try {
    const f = await webSheetFile(b.url, b['제목']);
    if (f) { req.files = [f]; await saveSheetsFrom(req, team, scope, b['곡ID'], null, false); }
  } catch (e) { console.error('[웹 악보 저장 실패]', e.message); }
  backTo(req, res, team, scope);
});

/** 패키지 악보를 곡별로 나누기 — 곡마다 "쪽_<곡ID>" 로 쪽 범위('3-5,8')를 받아, 그 파일 + 곡ID + 쪽 줄로 저장합니다 (라이브 악보 "곡별 악보로 저장" 과 같은 모양 → 라이브러리 · 다른 주 콘티로 곡을 가져올 때 쪽도 따라감).
 *  다시 저장하면 이 파일의 이전 곡별 저장(그 곡들)은 바뀝니다. 쪽을 비운 곡은 그 곡의 이 파일 연결이 지워집니다. */
router.post('/conti/sheets/split', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const link = String(b['파일링크'] || '').trim();
  if (!team || !req.ctx.teams.includes(team) || !link) return backTo(req, res, team, scope);
  try {
    const [songRows, sheetRows] = await Promise.all([sheetsDb.readAll('찬양콘티', { fresh: true }), sheetsDb.readAll('악보저장소', { fresh: true })]);
    const songs = new Map(songRows.filter((r) => r['팀ID'] === team && inScope(r, scope)).map((r) => [r['ID'], r]));
    const pkg = sheetRows.find((r) => r['팀ID'] === team && inScope(r, scope) && r['파일링크'] === link && !r['곡ID']);
    if (pkg) {
      const plan = [];
      Object.keys(b).forEach((k) => {
        if (k.indexOf('쪽_') !== 0) return;
        const song = songs.get(k.slice(2)); if (!song) return;
        plan.push({ song, spec: pageSpec.cleanSpec(b[k]) });
      });
      const ids = new Set(plan.map((p) => p.song['ID']));
      const olds = sheetRows.filter((r) => r['팀ID'] === team && inScope(r, scope) && r['파일링크'] === link && r['곡ID'] && ids.has(r['곡ID']) && String(r['쪽'] || '').trim()).map((r) => r.__row);
      if (olds.length) await sheetsDb.deleteRows('악보저장소', olds);
      const base = Date.now().toString(36);
      let n = 0;
      for (const p of plan) {
        if (!p.spec) continue;
        await sheetsDb.appendRow('악보저장소', {
          'ID': 'F' + base + n++ + Math.random().toString(36).slice(2, 4), '팀ID': team, ...scopeFields(scope), '제목': String(pkg['제목'] || '악보'),
          '파일링크': link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(), '곡ID': p.song['ID'],
          'Key': String(p.song['Key'] || ''), 'BPM': String(p.song['BPM'] || ''), '인도자': '', '쪽수': pageSpec.specPages(p.spec).length, '메모': '', '저장소날짜': '', '쪽': p.spec,
        });
      }
      liveNotify(team, scope, 'saveSheetSplit');
    }
  } catch (e) { console.error('[악보 곡별 나누기 실패]', e.message); }
  backTo(req, res, team, scope);
});

/** 이전 콘티에서 가져오기 · 설교 후 찬양을 "콘티 마지막 곡과 같게" — 곡 ID 들을 이 예배(scope)에 그대로 복사 (Key · BPM · 송폼 · 유튜브 · 원곡팀, 선택하면 설명 · 곡 악보까지) */
router.post('/conti/songs/import', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const kind = b['구분'] === '결단' ? '결단' : '콘티';
  const ids = Array.from(new Set([].concat(b['곡'] || []).map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 30);
  const withSheets = String(b['악보'] || '') === '1', withNote = String(b['설명'] || '') === '1';
  if (ids.length && req.ctx.teams.includes(team)) {
    const [all, sheets] = await Promise.all([sheetsDb.readAll('찬양콘티', { fresh: true }), sheetsDb.readAll('악보저장소', { fresh: true })]);
    const here = all.filter((r) => r['팀ID'] === team && inScope(r, scope) && (r['구분'] === '결단' ? '결단' : '콘티') === kind);
    let pick = ids;
    if (kind === '결단') pick = here.length ? [] : ids.slice(0, 1);          // 설교 후 찬양은 한 곡만 — 이미 있으면 건너뜀
    const have = new Set(here.map((r) => songNorm(r['제목'])));
    let seq = here.reduce((m, r) => Math.max(m, Number(r['순서']) || 0), 0), n = 0;
    for (const id of pick) {
      const src = all.find((r) => r['ID'] === id && r['팀ID'] === team);                // 같은 팀의 곡만
      if (!src || !String(src['제목'] || '').trim()) continue;
      const norm = songNorm(src['제목']);
      if (have.has(norm)) continue;                                                    // 같은 제목이 이미 있으면 겹쳐 넣지 않음
      have.add(norm); seq += 1; n += 1;
      const nid = 'C' + Date.now().toString(36) + seq + Math.random().toString(36).slice(2, 4);
      await sheetsDb.appendRow('찬양콘티', {
        'ID': nid, '팀ID': team, ...scopeFields(scope), '구분': kind, '순서': seq, '제목': src['제목'], '팀': src['팀'] || '', 'Key': src['Key'] || '',
        '유튜브': src['유튜브'] || '', '송폼': src['송폼'] || '', 'BPM': src['BPM'] || '', '비고': withNote ? (src['비고'] || '') : '', '만든시각': new Date().toISOString(),
      });
      if (withSheets) {
        const mine = sheets.filter((f) => f['곡ID'] === src['ID'] && f['팀ID'] === team && f['파일링크']);
        for (let k = 0; k < mine.length; k++) {
          await sheetsDb.appendRow('악보저장소', {
            'ID': 'F' + Date.now().toString(36) + seq + k, '팀ID': team, ...scopeFields(scope), '제목': mine[k]['제목'] || '악보', '파일링크': mine[k]['파일링크'],
            '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(), '곡ID': nid,
            'Key': mine[k]['Key'] || '', 'BPM': mine[k]['BPM'] || '', '인도자': mine[k]['인도자'] || '', '쪽수': mine[k]['쪽수'] || '', '메모': mine[k]['메모'] || '',
            '쪽': mine[k]['쪽'] || '',                                                  // 패키지 악보에서 이 곡이 차지하는 쪽 범위도 함께
          });
        }
      }
    }
    if (n) liveNotify(team, scope, 'saveWorshipSongs');
  }
  backTo(req, res, team, scope);
});

/** 오프라인용 다운로드 계획 — 이 예배 앞뒤(지난주 ~ 앞으로 3주)의 콘티 · 라이브 악보 화면 주소와 악보 파일 번호, 미리 받을 도구 파일.
 *  실제로 받는 일은 브라우저(public/js/offline.js)가 하고, 받은 것은 서비스워커(public/sw.js)가 인터넷 없이도 돌려줍니다. */
router.get('/conti/offline-plan', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const team = req.ctx.current;
    const base = week.normalizeDate(req.query.date);
    const evId = String(req.query.event || '').trim();
    const dates = [-7, 0, 7, 14, 21].map((n) => week.shiftWeek(base, n / 7));
    const evs = (await specialServices(team)).filter((e) => e['날짜'] >= dates[0] && e['날짜'] <= dates[dates.length - 1] || e['ID'] === evId);
    const scopes = dates.map((d) => ({ event: '', date: d })).concat(evs.map((e) => ({ event: e['ID'], date: e['날짜'] })));
    const qs = (sc) => `team=${encodeURIComponent(team)}&` + (sc.event ? `event=${encodeURIComponent(sc.event)}` : `date=${encodeURIComponent(sc.date)}`);
    const pages = ['/'].concat(...scopes.map((sc) => [`/conti?${qs(sc)}`, `/conti/practice?${qs(sc)}`]));
    const sheetRows = (await sheetsDb.readAll('악보저장소')).filter((r) => r['팀ID'] === team && r['파일링크'] && scopes.some((sc) => inScope(r, sc)));
    const sheets = Array.from(new Set(sheetRows.map((r) => liveStore.sheetIdOf(team, r['파일링크']))));
    const fs = require('fs'), path = require('path');
    const cues = (() => { try { return fs.readdirSync(path.join(__dirname, '..', 'public', 'worship', 'cues', 'en')).map((f) => '/worship/cues/en/' + f); } catch (e) { return []; } })();
    const extra = ['/site.webmanifest', '/vendor/pdfjs/pdf.min.js', '/vendor/pdfjs/pdf.worker.min.js', '/worship/pitch-worklet.js', '/socket.io/socket.io.js'].concat(cues);
    res.json({ ok: true, team, pages, sheets, extra, weeks: dates });
  } catch (e) { console.error('[오프라인 계획]', e && e.message); res.json({ ok: false, msg: '준비하지 못했습니다.' }); }
});

/** 유튜브 검색 (곡 입력칸 밑에 펼쳐지는 결과) — JSON */
router.get('/conti/youtube', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await youtube.search(req.query.q, req.query.page)); }
  catch (e) { console.error('[유튜브 검색]', e && e.message); res.json({ ok: false, msg: '검색하지 못했습니다.', openUrl: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(String(req.query.q || '')) }); }
});
/** 붙여 넣은 유튜브 주소의 제목 · 채널 — JSON (못 읽으면 title 이 비어 있음) */
router.get('/conti/youtube/info', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json((await youtube.info(req.query.url)) || {}); } catch (e) { res.json({}); }
});

router.post('/conti/sheets/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('악보저장소', row); } catch (e) { console.error('[악보 삭제 실패]', e.message); } }
  backTo(req, res, b.team, scopeFrom(b));
});

/** 제목을 안 적었을 때 — 올린 파일 이름(확장자 빼고) → 유튜브 영상 제목 → 링크 끝 이름 → "녹음" */
async function autoRecTitle(file, link) {
  const clean = (t) => String(t || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (file && file.originalname) { const t = clean(file.originalname); if (t) return t; }
  if (link) {
    try { const i = await youtube.info(link); if (i && i.title) return String(i.title).slice(0, 80); } catch (e) { /* 아래로 */ }
    try { const seg = decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).pop() || ''); const t = clean(seg); if (t && !/^[A-Za-z0-9_-]{20,}$/.test(t)) return t; } catch (e) { /* 아래로 */ }
  }
  return '녹음';
}

router.post('/conti/recordings', requireTeam, upload.single('파일'), guestGate.afterUpload, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  let title = String(b['제목'] || '').trim();
  let link = String(b['링크'] || '').trim();
  try { if (req.file) link = await driveStore.uploadPublic('음원', req.file); } catch (e) { console.error('[녹음 업로드 실패]', e.message); }
  if (!link) return backTo(req, res, team, scope);
  if (!title) title = await autoRecTitle(req.file, String(b['링크'] || '').trim());
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

/* 로그인 없이 보는 화면은 "방송팀 보기 전용 링크"(routes/guest.js · /b/<열쇠>)로 옮겼습니다 — 예전 /public/conti 는 없앴습니다. */

/** 방송팀 보기 링크 만들기 / 새로 바꾸기 (관리자) */
router.post('/conti/guest-link', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (req.ctx.isAdmin && req.ctx.teams.includes(team)) {
    try { await guestLink.regenerate(team); } catch (e) { console.error('[방송팀 링크 저장 실패]', e.message); }
  }
  spa.redirect(req, res, contiUrl(team, scopeFrom(b)) + '&gl=1');            // 만든 직후에는 링크 칸을 펼쳐서 보여 줌
});

module.exports = router;
module.exports.setLiveNotify = setLiveNotify;
// 방송팀 보기 전용 화면(routes/guest.js)이 같은 조회 · 카드 모양을 쓰도록
module.exports.shared = { loadWeek, songCard, packageSheetsCard, commentItem, practiceInfo, practiceCard, specialServices, specialServiceById, scopeFields, formChips };
