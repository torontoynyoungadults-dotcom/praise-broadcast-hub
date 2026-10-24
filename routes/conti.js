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
const nas = require('../lib/nas');
const shortNames = require('../lib/shortName');
const guestGate = require('../lib/guestGate');
const guestAccess = require('../lib/guestAccess');
const { POSITION_GROUPS, POSITION_ROWS, ALL_POSITIONS, canonicalPosition } = require('../lib/positions');
const { orderOf } = require('../lib/songKind');
const { positionIconSvg } = require('../lib/positionIcons');
const rosterPicker = require('../lib/rosterPicker');
const schedLog = require('../lib/scheduleLog');
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
const sheetHeaders = require('../lib/sheetHeaders');
const pkgDrive = require('../lib/pkgDrive');
const liveStore = require('../lib/liveStore');
const ytForm = require('../lib/ytForm');
const soundSetup = require('../lib/soundSetup');
/* 유튜브 송폼 태그 화면 파일(public/worship/ytform.js)의 버전 — 이어 듣기 상자가 처음 열릴 때 불러옴 */
const YTFORM_V = (() => { try { return String(Math.floor(require('fs').statSync(require('path').join(__dirname, '..', 'public', 'worship', 'ytform.js')).mtimeMs)); } catch (e) { return String(Date.now()); } })();
const guestLink = require('../lib/guestLink');
const timeSettings = require('../lib/timeSettings');
const closingHymn = require('../lib/closingHymn');
const practiceView = require('../lib/practiceView');
const notify = require('../lib/notify');
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
/** 콘티에 곡이 올라왔다고 팀에 알림 (모아서 한 번 · 실패해도 저장에는 영향 없음) */
function tellSong(req, team, scope, title) {
  try { notify.contiSongAdded(team, scope, title, String(req.ctx.member['이름'] || ''), String(req.ctx.member['이메일'] || '')); } catch (e) { console.error('[콘티 알림 예약 실패]', e && e.message); }
}
/** 한 곡에 악보가 여러 개일 때 순서 — 시트의 줄 순서 (▲▼ 로 바꾸면 줄 내용을 서로 바꿈 · 라이브 악보와 같은 순서) */
const sheetOrder = (a, b) => (a.__row || 0) - (b.__row || 0);
function backTo(req, res, team, scope) {
  const back = String((req.body && req.body.back) || '');
  if (/^\/practice-conti\?[^\s<>"]*$/.test(back)) return spa.redirect(req, res, back);      // 연습 콘티에서 고쳤으면 그 화면으로
  spa.redirect(req, res, contiUrl(team, scope));
}
/** 연습 콘티 화면의 폼에 "돌아올 곳"을 넣어 줌 — 예배 콘티와 같은 폼 · 같은 저장을 그대로 쓰고, 저장 뒤에는 연습 콘티로 */
function withBack(html, back) {
  const hid = `<input type="hidden" name="back" value="${esc(back)}">`;
  return html.replace(/(<form\b[^>]*\bmethod="post"[^>]*>)/g, `$1${hid}`);
}

/* ---------- 주일 편성 (church-app의 "이 주의 편성" — 이번 주 포지션 배정) ---------- */
async function teamRoster(team) {
  const members = await sheetsDb.readAll('회원');
  return members.filter((m) => String(m['소속팀'] || '').split(',').map((s) => s.trim()).includes(team)).map((m) => m['이름']).filter(Boolean);
}

/** 주일 편성 이름 아래 — 마이크 라인 · 인이어 번호 작은 배지 (직접 그린 선 아이콘 + 번호) */
const IO_ICON = {
  mic: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.6" y="1.6" width="4.8" height="8" rx="2.4"/><path d="M3.4 7.6a4.6 4.6 0 0 0 9.2 0M8 12.2v2.4"/></svg>',
  iem: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 9.6a3.3 3.3 0 1 1 3.9-3.2c0 1.6-1.4 2-1.4 3.4 0 1.5-1 2.6-2.4 2.6"/><circle cx="6.4" cy="6.5" r="1" class="k"/><path d="M11.6 4.2c.9.9 1.4 2 1.4 3.3s-.5 2.4-1.4 3.3"/></svg>',
};
function ioBadges(parts) {
  if (!parts || !parts.length) return '';
  return `<span class="lu-io">${parts.map((p) => `<span class="lu-b ${p.k}" title="${p.k === 'mic' ? '마이크 라인' : '인이어'} ${esc(p.v)}">${IO_ICON[p.k]}<i>${p.k === 'mic' ? 'MIC' : 'IEM'}</i><b>${esc(p.v)}</b></span>`).join('')}</span>`;
}
function lineupCell(scope, team, posKey, names, roster, infoMap, snd) {
  const rosterObjs = Object.keys(infoMap).map((n) => ({ 이름: n, 역할: infoMap[n].역할, 객원: !!infoMap[n].객원 }));   // 객원은 팀원 선택에서 추천에 안 넣고 따로 모음
  const lead = honorific.isLeadPos(posKey);       // 인도자 칸에 들어간 이름은 누구든(객원 포함) "OOO 목사"
  const isP = (n) => lead || honorific.isPastorRoles((infoMap[n] || {}).역할);       // 목회자: 칩에는 "윤 목사", 그 밖에는 "윤정환 목사"
  const shortOf = shortNames.shortFn(Object.keys(infoMap).filter((n) => !honorific.isPastorRoles((infoMap[n] || {}).역할)));       // 같은 이름이면 조희 · 김희 처럼 성을 붙임
  const chipName = (n) => (isP(n) ? honorific.withTitle(n) : shortOf(n));       // 목회자 · 인도자는 항상 "윤정환 목사"(줄이지 않음)
  const chip = (n) => `<span class="ph-namechip${roster.indexOf(n.이름) === -1 ? ' guest' : ''}${isP(n.이름) ? ' pastor' : ''}" title="${esc(isP(n.이름) ? honorific.withTitle(n.이름) : n.이름)}">${avatar.avatarHtml(n.이름, infoMap[n.이름] || {}, 'md', { noBadge: true })}<span class="ph-chipname">${esc(chipName(n.이름))}</span>${ioBadges(soundSetup.partsFor(snd, posKey, n.이름))}</span>`;
  const chips = names.length ? names.map(chip).join('') : '<span class="ph-namechip none"><span class="ph-dash">—</span></span>';
  const assignedRows = names.map((n) => `<div class="ph-assignedrow">${avatar.avatarHtml(n.이름, infoMap[n.이름] || {}, 'sm', { noBadge: true })}<span>${esc(isP(n.이름) ? honorific.withTitle(n.이름) : n.이름)}</span>
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
  // 줄마다 한 묶음 — 싱어 4칸 / 드럼 · 베이스 · 일렉 / 피아노 · 신디 · 어쿠기타 / 음향 · PPT · 방송총괄 (12칸 격자에서 4칸 줄은 3씩, 3칸 줄은 4씩)
  const snd = await soundSetup.get(team).catch(() => null);
  const cells = POSITION_ROWS.map((row) => row.map((k) => lineupCell(scope, team, k, byPos[k] || [], roster, infoMap, snd).replace('<details class="ph-poscell"', `<details class="ph-poscell lu-w${row.length}"`)).join('')).join('');
  const head = scope.event
    ? `<b>${esc(week.shortKo(scope.date, true))}</b>${eventName ? `<span class="lu-evn">${esc(eventName)}</span>` : ''}`
    : `<b>${esc(week.shortKo(scope.date, true))}</b>`;
  return `<div class="ph-card lu-card">
    <h2 class="ph-h2">주일 편성</h2>
    <div class="lu${scope.event ? ' ev' : ''}">
      <div class="lu-head">${head}<span class="lu-hint">칸을 누르면 바로 배정해요</span></div>
      <div class="lu-grid">${cells}</div>
    </div>
    <p class="ph-sub" style="margin-top:10px;">${[`<a href="/sound?team=${encodeURIComponent(team)}">마이크 · 인이어 번호 →</a>`, isAdmin ? `<a href="/roster?team=${encodeURIComponent(team)}">팀원관리 →</a>` : '', scope.event ? '' : `<a href="/schedule?team=${encodeURIComponent(team)}">스케줄표에서 여러 주 한눈에 보기 →</a>`].filter(Boolean).join(' · ')}</p>
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
  await honorific.prime(team);                                            // 목사 호칭(댓글 · 올린 사람)을 위해
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
    conti: list.filter((r) => r['구분'] !== '결단' && r['구분'] !== '폐회송').sort(order),
    final: list.filter((r) => r['구분'] === '결단').sort(order),
    closing: list.filter((r) => r['구분'] === '폐회송').sort(order),
    sheets: mine(sheets),
    recs: mine(recs),
    comments: mine(comments).sort((a, b) => String(a['작성시각']).localeCompare(String(b['작성시각']))),
  };
}

/** 폐회송 — "관리"에서 정해 둔 기본값을 이번 주 콘티에 아직 없으면 자동으로 넣어 둡니다.
 *  한 번 들어간 뒤로는(이미 있으면) 다시 넣지 않아서, 그 주만 따로 고쳐도(또는 1년에 한 번 바뀌어도) 다음 주엔 다시 기본값으로 돌아옵니다.
 *  주일 외 찬양(행사)은 순서가 달라질 수 있어 자동으로 넣지 않습니다. */
async function ensureClosingHymn(team, scope) {
  if (scope.event) return;
  try {
    const def = await closingHymn.get(team);
    if (!def) return;
    const rows = await sheetsDb.readAll('찬양콘티', { fresh: true });
    const has = rows.some((r) => r['팀ID'] === team && inScope(r, scope) && r['구분'] === '폐회송');
    if (has) return;
    const sid = 'C' + Date.now().toString(36);
    await sheetsDb.appendRow('찬양콘티', {
      'ID': sid, '팀ID': team, ...scopeFields(scope), '구분': '폐회송', '순서': 1,
      '제목': def['제목'], '팀': def['팀'], 'Key': def['Key'], '유튜브': def['유튜브'], '송폼': def['송폼'], 'BPM': def['BPM'], '비고': def['비고'],
      '만든시각': new Date().toISOString(),
    });
    // "관리"에서 미리 올려 둔 기본 악보가 있으면 그대로 복사해 이번 주 곡(sid)에 묶어 둡니다.
    const defSheets = await closingHymn.getSheets(team);
    for (const f of defSheets) {
      await sheetsDb.appendRow('악보저장소', {
        'ID': 'F' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), '팀ID': team, ...scopeFields(scope),
        '제목': f['제목'], '파일링크': f['링크'], '올린사람': '관리(폐회송 기본 악보)', '올린시각': new Date().toISOString(), '곡ID': sid,
      });
    }
  } catch (e) { console.error('[폐회송 자동 추가 실패]', e.message); }
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
/** 송폼 — 글자 한 줄 (회색 칸 안) */
function formChips(form) {
  const toks = form ? YNForm.parse(form) : [];
  if (!toks.length) return form ? `<p class="cn-ftext">${esc(form)}</p>` : '';
  // 송폼은 글자로 한 줄 — "Intro (8마디) › V1 › C ×2 › Itld (4마디) › …" (길면 다음 줄로)
  const one = (t) => {
    if (t.k === 'KeyUp') return 'Key ↑';
    const code = t.k === 'C(Voice)' ? 'C (Voice)' : t.k;
    return code + (t.bars ? ` (${t.bars}마디)` : '') + (t.rep > 1 ? ` ×${t.rep}` : '');
  };
  // 화살표는 앞 칸에 붙여서 — 줄이 바뀔 때 줄 맨 앞에 › 가 오지 않게
  return `<p class="cn-ftext" aria-label="송폼">${toks.map((t, i) => `<span class="cn-ft">${esc(one(t))}${i < toks.length - 1 ? '<i aria-hidden="true">›</i>' : ''}</span>`).join(' ')}</p>`;
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

/** 이 악보를 라이브 악보 화면에서 바로 열어 필기 — 라이브 악보와 똑같은 필기 도구 · 저장(팀 공유 / 나만 보기)을 그대로 씀.
 *  필기는 (팀 · 악보 파일 · 예배) 마다 저장되므로 콘티 화면에서 연 필기와 라이브 악보에서 연 필기는 같은 것 */
function annoHref(f) {
  const qs = new URLSearchParams({ team: f['팀ID'] });
  if (f['행사ID']) qs.set('event', f['행사ID']); else qs.set('date', f['날짜']);
  qs.set('sheet', liveStore.sheetIdOf(f['팀ID'], f['파일링크']));
  return `/conti/practice?${qs.toString()}`;
}
/** 이미 올린 곡 악보 — 자르기 · 머리말 다시 적용 단추 (public/js/sheethdr.js 가 자르기 창을 엶) */
function reformatBtn(f) {
  if (!f || !f['파일링크'] || !f['곡ID']) return '';
  const src = reformatSource(f);
  const qs = new URLSearchParams({ team: f['팀ID'], row: String(f.__row) });
  if (f['행사ID']) qs.set('event', f['행사ID']); else qs.set('date', f['날짜']);
  return `<button type="button" class="ph-annolink" data-sheet-reformat data-team="${esc(f['팀ID'])}" data-date="${esc(f['날짜'])}" data-event="${esc(f['행사ID'] || '')}" data-row="${f.__row}"
    data-src="/conti/sheets/source?${esc(qs.toString())}" data-crop="${esc(src.crop)}" data-header="${src.header ? 1 : 0}" data-headed="${src.headed ? 1 : 0}" data-name="${esc(f['제목'] || '악보')}"
    title="이 악보의 가장자리를 쪽마다 자르고, 인쇄용 PDF처럼 머리말을 달아요">${ui.icon('page')} 자르기·헤더</button>`;
}
function annoLink(f) {
  if (!f || !f['파일링크']) return '';
  return `<a class="ph-annolink" href="${esc(annoHref(f))}" title="라이브 악보에서 이 악보에 필기">${ui.icon('pencil')} 필기</a>`;
}

/** 한 곡에 악보가 여러 개일 때 순서 바꾸기 ◀ ▶ (올린 순서 = 보이는 순서 · 맨 앞 악보가 정식 머리말) */
function moveBtns(f, i, n) {
  const one = (dir, ok, glyph, label) => (ok ? `<form method="post" action="/conti/sheets/move" style="display:inline;"><input type="hidden" name="__row" value="${f.__row}"><input type="hidden" name="team" value="${esc(f['팀ID'])}">${rowHidden(f)}<input type="hidden" name="dir" value="${dir}"><button class="ph-row-mv" type="submit" title="${label}" aria-label="${label}">${glyph}</button></form>` : '');
  return one('up', i > 0, '▲', '위로') + one('down', i < n - 1, '▼', '아래로');
}
/** 화면에서 바로 펼쳐 볼 악보 주소 — 이 앱 주소(/sheet/<id>)로 열어야 권한 확인 · R2 를 거침. 곡별 쪽이 정해져 있으면 그 쪽만 */
function sheetViewSrc(f) {
  const spec = String(f['쪽'] || '').trim();
  if (spec) return liveStore.openHref(f['팀ID'], f['파일링크'], spec, f['제목']);
  return '/sheet/' + liveStore.sheetIdOf(f['팀ID'], f['파일링크']);
}
const CHEV = '<svg class="cn-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
/** 곡 카드 아래 — [악보 보기 N] 단추 하나. 누르면 이 곡에 붙은 악보가 화면에 쭉 펼쳐지고(쪽마다 그림),
 *  악보마다 머리줄에 필기 · 자르기·헤더 · 순서 · 빼기. 악보가 없으면 "+ 이 곡 악보 올리기"만.
 *  opts.tools: 고칠 수 없는 화면(연습 콘티)에서도 필기 단추는 보이게 */
function songSheetsHtml(s, sheets, editable, extra, opts) {
  const mine = (sheets || []).filter((f) => f['곡ID'] === s['ID']);
  const tools = editable || (opts && opts.tools);
  const files = mine.map((f, i) => {
    const pages = f['쪽'] || (splitOrigin(f) || {}).spec || '';
    const open = liveStore.openHref(f['팀ID'], f['파일링크'], f['쪽'], s['제목'] || f['제목']);
    const del = editable ? `<form method="post" action="/conti/sheets/delete" class="cn-svdel" onsubmit="return confirm('이 악보를 지울까요?')">
      <input type="hidden" name="__row" value="${f.__row}"><input type="hidden" name="team" value="${esc(f['팀ID'])}">${rowHidden(f)}
      <button class="ph-row-del" type="submit" title="이 악보 빼기" aria-label="이 악보 빼기">${ui.icon('close')}</button></form>` : '';
    return `<div class="cn-sv" data-cn-sv data-src="${esc(sheetViewSrc(f))}" data-name="${esc(f['제목'] || '악보')}">
      <div class="cn-svh">
        <a class="cn-svt" href="${esc(open)}" target="_blank" rel="noopener" title="새 창에서 열기">${ui.icon('page')}<b>${esc(f['제목'] || '악보')}</b>${pages ? `<small>${esc(pages)}쪽</small>` : ''}${mine.length > 1 ? `<small>${i + 1}/${mine.length}</small>` : ''}</a>
        <span class="cn-svacts">${tools ? annoLink(f) + reformatBtn(f) : ''}${editable && mine.length > 1 ? moveBtns(f, i, mine.length) : ''}${del}</span>
      </div>
      <div class="cn-svpages" data-cn-svpages><p class="cn-svwait">악보 불러오는 중…</p></div>
    </div>`;
  }).join('');
  const addForm = editable ? `<details class="ph-add ph-songsheet-add">
    <summary>+ 이 곡 악보 올리기</summary>
    <form method="post" action="/conti/sheets" enctype="multipart/form-data" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
      <input type="hidden" name="곡ID" value="${esc(s['ID'])}">
      <input type="file" name="파일" accept=".pdf,image/*" multiple>
      <input type="text" name="제목" placeholder="제목 (비워 두면 파일 이름이 제목이 돼요)">
      <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
      <label class="ph-hdrchk"><input type="checkbox" name="header" value="1" data-sheet-hdr> 헤더 자동 추가 <small>(제목 · 원곡팀 · KEY · BPM · 송폼 머리말을 달고, 악보의 제목 · 여백은 자동으로 잘라요. 끄면 올린 그대로)</small></label>
      <button type="button" class="ph-btn" data-sheet-hdr-crop hidden>${ui.icon('page')} 자르기 조정</button><input type="hidden" name="crop" value="">
      <button class="ph-btn pri" type="submit">올리기</button>
    </form>
    <button type="button" class="ph-btn" data-sheet-search data-team="${esc(s['팀ID'])}" data-song="${esc(s['ID'])}" data-date="${esc(s['날짜'])}" data-event="${esc(s['행사ID'] || '')}" data-q="${esc(s['제목'] || '')}">${ui.icon('search')} 웹에서 악보 찾기</button>
  </details>` : '';
  if (!mine.length && !addForm && !extra) return '';
  const btn = mine.length ? `<button type="button" class="cn-svbtn" data-cn-svopen aria-expanded="false">${ui.icon('page')}<span>악보 보기</span><b>${mine.length}</b>${CHEV}</button>` : '';
  const panel = mine.length ? `<div class="cn-svpanel" data-cn-svpanel hidden>${files}${addForm}</div>` : '';
  return `<div class="ph-songsheets"><div class="cn-acts">${btn}${mine.length ? '' : addForm}${extra || ''}</div>${panel}</div>`;
}

/** 이 예배의 유튜브 이어 듣기 — 콘티 순서대로 곡마다 올린 링크를 이어서 재생하고(설교 후 찬양은 맨 뒤), 유튜브가 만들어 주는 임시 재생목록(watch_videos)으로도 열 수 있게
 *  (public/js/conti-tools.js 의 [data-cn-yplay] 가 플레이어를 붙임) */
const YT_MARK = '<svg class="cn-ytmark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.6" y="5.2" width="18.8" height="13.6" rx="4.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10.2 9.4v5.2l4.6-2.6z" fill="currentColor"/></svg>';
function ytPlayAllHtml(w, team) {
  const all = [].concat((w.conti || []).map((s, i) => ({ s, k: '콘티', n: i + 1 })), (w.final || []).map((s) => ({ s, k: '설교 후', n: 0 })), (w.closing || []).map((s) => ({ s, k: '폐회송', n: 0 })));
  const items = [];
  all.forEach((x) => { const id = youtube.idOf(x.s['유튜브']); if (id && !items.some((y) => y.id === id)) items.push({ id, t: String(x.s['제목'] || '').trim() || '제목 없음', k: x.k, n: x.n }); });
  if (!items.length) return '';
  const missing = all.filter((x) => !youtube.idOf(x.s['유튜브'])).length;
  const open = 'https://www.youtube.com/watch_videos?video_ids=' + items.slice(0, 50).map((x) => x.id).join(',');
  return `<div class="cn-yplay" data-cn-yplay data-items="${esc(JSON.stringify(items))}" data-team="${esc(team || '')}" data-ytv="${esc(YTFORM_V)}">
    <div class="cn-yplay-bar">
      <button type="button" class="cn-ybig" data-cn-yplay-open aria-expanded="false">${YT_MARK}<span>유튜브 이어 듣기</span><small>${items.length}곡</small></button>
      <a class="cn-ybig" href="${esc(open)}" target="_blank" rel="noopener" title="유튜브가 한 번에 재생목록으로 열어줘요 (유튜브 앱 · 화면을 꺼도 계속)">${YT_MARK}<span>유튜브에서 한 번에 열기</span></a>
    </div>
    ${missing ? `<p class="cn-ymiss">링크 없는 ${missing}곡은 빠져요</p>` : ''}
    <div class="cn-yplayer" data-cn-yplayer hidden></div>
  </div>`;
}

/** 카카오톡 콘티 요약 글 — 부를 이름(목회자 · 인도자는 "OOO 목사")으로 채운 한 예배 자료 (예배 콘티 · 연습 콘티 같이 씀) */
function kakaoFor({ date, scope, eventRow, pinfo, w, byPos, infoMap }) {
  const honor = (n, pos) => honorific.forPos(pos, n, honorific.isPastorRoles((infoMap[n] || {}).역할));
  const slotNames = {}; Object.keys(byPos).forEach((k) => { slotNames[k] = byPos[k].map((x) => honor(x.이름, k)); });
  return kakaoLib.kakaoText({
    date, event: scope.event && eventRow ? { name: eventRow['이름'] } : null, practice: pinfo && pinfo.p && pinfo.p.date && !pinfo.p.none ? pinfo.p : null, slots: slotNames,
    songs: w.conti.map((r) => ({ title: r['제목'], team: r['팀'], key: r['Key'], form: kakaoLib.formText(r['송폼']), note: r['비고'], link: r['유튜브'] })),
    finals: w.final.map((r) => ({ title: r['제목'], key: r['Key'], link: r['유튜브'] })),
    closings: w.closing.map((r) => ({ title: r['제목'], key: r['Key'], link: r['유튜브'] })),
  });
}

/** 콘티 맨 위 도구 상자 — 예배 콘티 · 연습 콘티가 같이 씀.
 *  ① 라이브 악보(주) · 방송팀 화면  ② 인쇄용 PDF · 카톡 요약 · 오프라인  ③ 유튜브 이어 듣기 · 유튜브에서 한 번에 열기
 *  카톡 · 오프라인 · 이어 듣기 단추는 가장 가까운 .ph-card 안의 칸을 찾아 쓰므로, 한 화면에 여러 개(연습 콘티) 있어도 따로 동작 */
function contiToolbox({ team, scope, date, eventRow, w, kakao, stage }) {
  const q = scope.event ? 'event=' + encodeURIComponent(scope.event) : 'date=' + encodeURIComponent(date);
  const liveHref = `/conti/practice?team=${encodeURIComponent(team)}&${q}`;
  const nSheets = new Set(w.sheets.filter((s) => s['파일링크']).map((s) => s['파일링크'])).size;
  const liveBtn = `<a class="ph-btn pri ph-livebtn" href="${liveHref}" title="라이브 악보 — 필기 · 메트로놈 · 함께 보기 화면을 엽니다">${ui.icon('note')} 라이브 악보<small>${nSheets ? `악보 ${nSheets}개 · ` : ''}필기 · 메트로놈 · 함께 보기</small></a>`;
  const stageBtn = stage ? `<a class="ph-btn ph-stagebtn" href="${liveHref.replace('/conti/practice?', '/conti/stage?')}" title="방송팀 화면 — 지금 곡 · 송폼 · 콜아웃 위치 · 찬양팀 요청을 크게 봅니다">${ui.icon('media')} 방송팀 화면<small>지금 곡 · 송폼 · 요청 메시지 크게</small></a>` : '';
  const has = w.conti.length || w.final.length || w.closing.length;
  const pkgHref = `/conti/package.pdf?team=${encodeURIComponent(team)}&${q}`;
  const pkgBtn = has ? `<button type="button" class="cn-mini cn-pkgbtn" data-pkg-open data-href="${esc(pkgHref)}" data-title="${esc(scope.event && eventRow ? eventRow['이름'] : week.shortKo(date, true))} 인쇄용 PDF" title="표지 + 곡별 머리말 + 악보 · US Letter 흑백 인쇄용 PDF — 미리보고 다운로드">${ui.icon('download')} 인쇄용 PDF 패키지</button>` : '';
  const kakaoBtn = w.conti.length ? `<button type="button" class="cn-mini cn-kakaobtn" data-cn-kakao>${ui.icon('clipboard')} 카카오톡 콘티 요약 복사</button>` : '';
  const offBtn = `<button type="button" class="cn-mini cn-offbtn" data-cn-offopen data-team="${esc(team)}" data-date="${esc(date)}" data-event="${esc(scope.event)}" aria-expanded="false">${ui.icon('download')} 오프라인용 다운로드</button>`;
  const yt = ytPlayAllHtml(w, team);
  return `<div class="ph-livebtns${stage ? '' : ' one'}">${liveBtn}${stageBtn}</div>
    <div class="cn-toolrow">${pkgBtn}${kakaoBtn}${offBtn}</div>
    ${yt}
    <div class="cn-offpanel" data-cn-offpanel hidden></div>
    ${w.conti.length && kakao ? `<details class="cn-kakaopv" data-cn-kakaopv><summary>카톡에 붙여 넣을 글 미리보기</summary><textarea readonly rows="12" data-cn-kakaotxt aria-label="카카오톡 콘티 요약">${esc(kakao)}</textarea></details>` : ''}
    <p class="ph-msg cn-toolmsg" data-cn-toolmsg role="status"></p>`;
}

/** 곡 카드 — 청년부 앱처럼: ① 순서 · 제목 · Key · BPM ② 원곡팀 · 유튜브 ③ 송폼 ④ 설명 */
function songCard(s, { editable, roster, byPos, sheets, tagSet, index, kind, bigForm, jumps, sheetTools }) {
  const isFinal = kind === '결단';
  const isClosing = kind === '폐회송';
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
  const jp = jumps && jumps[s['ID']];                                        // 녹음 · 영상에서 이 곡이 시작하는 곳부터
  const jumpBtn = jp ? `<button type="button" class="cn-recjump" data-rp-jump="${esc(jp.src)}" data-rp-t="${jp.t}" title="${jp.kind} ${jp.video ? '영상' : '녹음'} — 이 곡 시작(${mmss(jp.t)})부터 재생">${ui.icon(jp.video ? 'play' : 'headphones')}<span>${jp.video ? '영상' : '녹음'} ${mmss(jp.t)}</span></button>` : '';
  const keyCell = s['Key'] ? `<span class="cn-cell key"><i>KEY</i><b>${esc(s['Key'])}</b></span>` : '';
  const bpmCell = bpm ? `<span class="cn-cell bpm"><i>BPM</i><b>${esc(bpm)}</b></span>` : '';
  const ytBtn = yt ? `<a class="cn-cell cn-ytlink yt" href="${esc(yt)}" target="_blank" rel="noopener" title="유튜브 영상" aria-label="유튜브 영상">${YT_MARK}</a>` : '';
  const info = keyCell + bpmCell + ytBtn + jumpBtn;
  return `<div class="cn-song${isFinal ? ' fin' : ''}${isClosing ? ' clo' : ''}" id="song-${esc(s['ID'])}" data-song="${esc(s['ID'])}">
    <div class="cn-shead">
      <span class="cn-no">${isFinal ? ui.icon('cross') : isClosing ? ui.icon('pray') : esc(index)}</span>
      <span class="cn-tb"><span class="cn-ti">${esc(s['제목'] || '(제목 없음)')}</span>${s['팀'] ? `<span class="cn-team">${esc(s['팀'])}</span>` : ''}</span>
      ${info ? `<div class="cn-info" aria-label="곡 정보">${info}</div>` : ''}
      ${editable && !isFinal && !isClosing ? `<button type="button" class="cn-grip" data-cn-grip aria-label="끌어서 순서 바꾸기 (위·아래 방향키로도 옮겨요)" title="끌어서 순서 바꾸기"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.3"/><circle cx="10.5" cy="3.5" r="1.3"/><circle cx="5.5" cy="8" r="1.3"/><circle cx="10.5" cy="8" r="1.3"/><circle cx="5.5" cy="12.5" r="1.3"/><circle cx="10.5" cy="12.5" r="1.3"/></svg></button>` : ''}
    </div>
    ${s['송폼'] ? `<div class="cn-sec cn-sec-form"><span class="cn-lab">송폼</span>${bigForm ? formBig(s['송폼'] || '') : formChips(s['송폼'] || '')}</div>` : ''}
    ${s['비고'] ? `<div class="cn-snote">${noteHtml(s['비고'], tagSet)}</div>` : ''}
    ${songSheetsHtml(s, sheets, editable, edit, { tools: sheetTools })}
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
const DOW_KO = ['주일', '월', '화', '수', '목', '금', '토'];
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
    d.songs.sort((a, b) => (orderOf(a['구분']) - orderOf(b['구분'])) || Number(a['순서'] || 0) - Number(b['순서'] || 0));
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
      ${d.songs.map((r) => `<label class="cn-ichk"><input type="checkbox" name="곡" value="${esc(r['ID'])}"><span class="t">${r['구분'] === '결단' ? '<em>결단</em>' : r['구분'] === '폐회송' ? '<em>폐회송</em>' : ''}${esc(r['제목'])}</span><span class="m">${esc(meta(r))}</span></label>`).join('')}</div>
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
  const label = kind === '결단' ? '설교 후 찬양' : kind === '폐회송' ? '폐회송' : '콘티';
  const uid = `new${kind === '결단' ? 'f' : kind === '폐회송' ? 'x' : 'c'}`;
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
    ${editable ? annoLink(s) : ''}
    ${editable ? `<form method="post" action="/conti/sheets/delete" onsubmit="return confirm('이 악보를 지울까요?')">
      <input type="hidden" name="__row" value="${s.__row}">
      <input type="hidden" name="team" value="${esc(s['팀ID'])}">${rowHidden(s)}
      <button class="ph-row-del" type="submit" title="삭제" aria-label="삭제">${ui.icon('close')}</button>
    </form>` : ''}
  </div>`;
}

/** 패키지 악보 한 개를 곡별로 나누는 칸 — PDF 의 쪽을 곡마다 정해 두면 그 쪽 범위가 곡(곡ID)에 묶여 저장돼, 다른 주 콘티에 그 곡을 넣을 때 악보가 따라와요.
 *  (쪽을 자동으로 찾는 일은 public/js/conti-tools.js [data-cn-split] 가 PDF 글자에서 곡 제목을 찾아 채워 줌 — 고칠 수 있음) */
/** 머리말 · 자르기를 적용해 다시 만든 곡 악보 줄 — 메모에 원본 링크 · 쪽 · 자르기 · 머리말 여부를 남겨 둠 (lib/sheetHeaders.js).
 *  (화면의 "저장됨" 표시 · 다시 나누기 · 인쇄용 PDF 가 원본을 그대로 쓰는 데 씀) → { spec, link(원본), crop, header } | null */
function splitOrigin(row) {
  const h = sheetHeaders.parse(row);
  return h ? { spec: h.spec, link: h.src, crop: h.crop, header: h.header } : null;
}

function splitPanel(team, scope, s, songs, allSheets) {
  if (!songs || !songs.length || !s['파일링크']) return '';
  const id = liveStore.sheetIdOf(team, s['파일링크']);
  const saved = {};
  (songs || []).forEach((g) => { saved[g.id] = ''; });
  (allSheets || []).forEach((f) => {
    if (!f['곡ID'] || !Object.prototype.hasOwnProperty.call(saved, f['곡ID'])) return;
    const o = splitOrigin(f);
    if (o && o.link === s['파일링크']) saved[f['곡ID']] = o.spec;                       // 헤더를 달아 저장한 곡
    else if (f['파일링크'] === s['파일링크'] && f['쪽']) saved[f['곡ID']] = f['쪽'];     // 원본 쪽 그대로 저장한 곡
  });
  const has = Object.keys(saved).some((k) => saved[k]);
  return `<details class="ph-add cn-split" data-cn-split data-src="/sheet/${esc(id)}" data-has="${has ? 1 : 0}">
    <summary>${ui.icon('page')} 곡별로 나누기${has ? ' · 저장됨' : ''}</summary>
    <form method="post" action="/conti/sheets/split" class="cn-splitform">
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="파일링크" value="${esc(s['파일링크'])}">
      <p class="ph-sub cn-splithint" data-cn-splithint>곡마다 이 악보의 몇 쪽인지 적어 주세요 (예: 1-2 · 3 · 4,6). 저장하면 곡에 묶여 다음에도 그 곡을 넣을 때 따라와요.</p>
      <div class="cn-splitrows">${songs.map((g, i) => `<label class="cn-splitrow"><span class="cn-splitn">${g.kind === '결단' ? '결단' : g.kind === '폐회송' ? '폐회송' : i + 1}</span><span class="cn-splitt">${esc(g.title)}</span><input type="text" inputmode="text" name="쪽_${esc(g.id)}" data-cn-pages="${esc(g.title)}" value="${esc(saved[g.id])}" placeholder="쪽" maxlength="40" aria-label="${esc(g.title)} 쪽"></label>`).join('')}</div>
      <label class="ph-hdrchk cn-splithdr"><input type="checkbox" name="header" value="1" checked> 헤더 달기 <small>(인쇄용 PDF처럼 곡마다 번호 · 제목 – 원곡팀 · KEY · BPM · 송폼 머리말을 단 악보로 저장해요. 끄면 원본 쪽 그대로)</small></label>
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
    ${editable ? '<p class="ph-sub">이번 주 콘티 전체를 한 패키지(PDF 한 개)로 올린 뒤 <b>곡별로 나누기</b>를 누르면, 곡마다 쪽이 정해져 그 곡에 묶여요. <b>헤더 달기</b>(기본 켜짐)를 두면 곡마다 인쇄용 PDF처럼 머리말을 단 악보로 저장돼요. 곡 목록의 "+ 이 곡 악보 올리기"로 곡별로 따로 올려도 돼요.</p>' : ''}
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

/** '녹음' 카드의 "NAS 열기" 주소 — NAS_OPEN_URL (비우면 숨김) · 없으면 QuickConnect 주소. 새 창으로 NAS 화면이 열려서 파일이 앱(Render)을 거치지 않아요 */
function nasOpenUrl() {
  const v = process.env.NAS_OPEN_URL;
  if (v != null) return /^https?:\/\//i.test(v.trim()) ? v.trim() : '';
  return 'https://' + (process.env.NAS_QUICKCONNECT_ID || 'youngnakmedia') + '.quickconnect.to';
}
/** NAS 로그인 안내 글 — Render 환경변수 NAS_LOGIN_HINT (예: 아이디: praise3 · 비밀번호: …). 코드 · 저장소에는 비밀번호를 두지 않고, 객원 멤버에게는 보이지 않아요 */
function nasLoginHint() { return String(process.env.NAS_LOGIN_HINT || '').trim().slice(0, 200); }
/** 녹음의 재생 주소 — 드라이브에 올린 파일은 이 앱 주소(/audio/<id>, 되감기 · 빠르기 조절 가능), 그 밖의 링크는 그대로. 유튜브 링크는 오디오 파일이 아니라서 '' */
function recSrc(r) {
  const link = String(r['링크'] || '');
  const nasUrl = nas.playUrl(link);                        // 드라이브(미디어팀 NAS)에서 연결한 녹음 — /drive/file (Range 지원)
  if (nasUrl) return nasUrl;
  const id = liveStore.audioIdOf(link);
  if (id) return '/audio/' + id;
  if (!/^https?:\/\//i.test(link) || youtube.idOf(link) || /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\//i.test(link)) return '';
  return link;
}
/** 녹음 한 줄 아래 작은 글 — 드라이브 파일은 "드라이브" 표시 (영상은 녹음 플레이어 안에서 화면까지 보임) */
function recExtra(r, src) {
  const p = nas.pathOfLink(r['링크']);
  if (p) {
    const name = p.split('/').pop(), kind = nas.kindOf(name);
    return ` · 드라이브${kind === 'video' ? ' · 영상' : ''}`;
  }
  return src ? ` · <a class="ph-li-link" href="${esc(r['링크'])}" target="_blank" rel="noopener">새 창</a>` : ' · 유튜브 등 링크는 새 창에서 열려요';
}
/** 녹음의 곡 시작 위치 — '녹음'.구간 JSON [{t, id, k}] (시간순 · 최대 60개) */
function cleanMarks(v) {
  let a = v;
  if (typeof a === 'string') { try { a = JSON.parse(a || '[]'); } catch (e) { a = []; } }
  const out = [];
  (Array.isArray(a) ? a : []).forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const t = Math.round(Number(x.t) * 10) / 10;
    if (!Number.isFinite(t) || t < 0 || t > 36000) return;
    out.push({ t, id: String(x.id == null ? '' : x.id).slice(0, 40), k: String(x.k == null ? '' : x.k).replace(/[\r\n]/g, ' ').trim().slice(0, 60) });
  });
  out.sort((a2, b2) => a2.t - b2.t);
  return out.slice(0, 60);
}
const mmss = (t) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); };
/** 이 예배의 곡 목록 — 녹음 플레이어에서 곡 위치를 찍을 때 고르는 목록 */
const songsForMarks = (w) => [].concat(w.conti, w.final, w.closing).map((x) => ({ id: String(x['ID'] || ''), k: String(x['제목'] || '제목 없음') }));
/** 곡 카드의 "▶ 영상 3:25" — 곡 ID → 그 곡이 시작하는 녹음 위치 (예배 녹음 · 영상을 먼저) */
function songJumps(recs) {
  const out = {};
  const rank = (r) => (r['구분'] === '예배' ? 0 : 2) + (nas.kindOf(String(nas.pathOfLink(r['링크']) || r['링크'] || '').split('/').pop()) === 'video' ? 0 : 1);
  recs.slice().sort((a, b) => rank(a) - rank(b)).forEach((r) => {
    const src = recSrc(r); if (!src) return;
    const video = nas.kindOf(String(nas.pathOfLink(r['링크']) || '').split('/').pop()) === 'video';
    cleanMarks(r['구간']).forEach((m) => { if (m.id && !out[m.id]) out[m.id] = { src, t: m.t, video, kind: r['구분'] === '예배' ? '예배' : '연습' }; });
  });
  return out;
}
function recItem(r, editable, songs) {
  const src = recSrc(r), title = String(r['제목'] || '녹음');
  const marks = cleanMarks(r['구간']);
  const data = src ? ` data-rp-id="${esc(r['ID'] || '')}" data-rp-team="${esc(r['팀ID'] || '')}" data-rp-marks="${esc(JSON.stringify(marks))}"${songs ? ` data-rp-songs="${esc(JSON.stringify(songs))}"` : ''}${editable ? ' data-rp-edit="1"' : ''}` : '';
  const chips = src && marks.length ? `<div class="rp-marks-row">${marks.map((m) => `<button type="button" class="rp-mark" data-rp-pick data-rp-t="${m.t}" title="${esc(m.k)} — ${mmss(m.t)} 부터">${esc(m.k || '곡')} <b>${mmss(m.t)}</b></button>`).join('')}</div>` : '';
  return `<div class="ph-list-item rp-item"${src ? ` data-rp-src="${esc(src)}" data-rp-title="${esc(title)}" data-rp-by="${esc(honorific.forTeam(r['팀ID'], r['올린사람'] || ''))}"${data}` : ''}>
    ${src ? `<button type="button" class="rp-playbtn" data-rp-pick title="재생" aria-label="${esc(title)} 재생"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg></button>` : ''}
    <div class="ph-li-main">${src ? `<button type="button" class="rp-name" data-rp-pick>${esc(title)}</button>` : `<a class="ph-li-link strong" href="${esc(r['링크'])}" target="_blank" rel="noopener">${ui.icon('headphones')} ${esc(title)}</a>`}
      <div class="ph-li-sub">${esc(honorific.forTeam(r['팀ID'], r['올린사람'] || ''))}${recExtra(r, src)}</div>${chips}</div>
    ${editable ? `<form method="post" action="/conti/recordings/delete" onsubmit="return confirm('이 녹음을 지울까요?')">
      <input type="hidden" name="__row" value="${r.__row}">
      <input type="hidden" name="team" value="${esc(r['팀ID'])}">${rowHidden(r)}
      <button class="ph-row-del" type="submit" title="삭제" aria-label="삭제">${ui.icon('close')}</button>
    </form>` : ''}
  </div>`;
}

/* ================= 연습일 — 이 예배(주일 · 행사)를 언제 연습하는지 (스케줄표에서 정함 · lib/practice.js) ================= */
const DOW = ['주일', '월', '화', '수', '목', '금', '토'];
const mdDow = (d) => { const x = new Date(d + 'T12:00:00'); return `${x.getMonth() + 1}월 ${x.getDate()}일(${DOW[x.getDay()]})`; };
async function practiceInfo(team, scope, date) {
  const rows = (await sheetsDb.readAll('연습일정')).filter((r) => r['팀ID'] === team);
  const key = scope.event ? 'ev-' + scope.event : date;
  const ts = await timeSettings.get(team);
  const p = prac.practiceFor(key, date, rows, timeSettings.practiceNote(ts));
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

  await ensureClosingHymn(team, scope);
  const w = await loadWeek(team, scope);

  let dayBanner = '';
  const allAssignRows = (await sheetsDb.readAll('찬양편성')).filter((r) => r['팀ID'] === team);
  const evs = (await specialServices(team)).map((e) => ({ id: e['ID'], name: String(e['이름'] || '주일 외 찬양'), date: e['날짜'] }));
  // 달력 띠 — 주일 외 찬양(부흥회 등)는 같은 날짜라도 날짜 칸 옆에 따로 (눌러서 오감)
  const pracRows = (await sheetsDb.readAll('연습일정')).filter((r) => r['팀ID'] === team);
  const strip = pageShell.weekStrip({ basePath: '/conti', team, date, assignRows: allAssignRows, events: evs, pracRows, activeEvent: scope.event ? scope.event : '' });
  if (scope.event) {
    dayBanner = `<div class="ph-card ph-eventsbanner">
      <p class="ph-sub">${esc(eventRow['이름'])} 콘티예요 — 주일예배와는 별도 기록입니다. <a href="/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}">이 날짜의 주일예배 콘티 보기 →</a></p>
      <p class="ph-sub"><a href="/events?team=${encodeURIComponent(team)}">← 주일 외 찬양 목록으로</a></p>
    </div>`;
  }

  const hero = pageShell.hero(scope.event
    ? { eyebrow: `${team} · 주일 외 찬양 콘티`, title: eventRow['이름'], sub: week.labelKo(date) }
    : { eyebrow: `${team} · 예배콘티`, title: '예배콘티', sub: week.labelKo(date) });
  const { byPos, roster, infoMap } = await weekAssignments(team, scope);
  const lineup = await lineupCard(team, scope, byPos, roster, infoMap, scope.event ? eventRow['이름'] : '', ctx.isAdmin);
  const pinfo = await practiceInfo(team, scope, date);
  const practice = practiceCard(team, pinfo);
  const hist = await historyFor(team, scope);
  const tagSet = ALL_POSITIONS.concat(roster).sort((a, b) => b.length - a.length);
  const markSongs = songsForMarks(w);                                     // 녹음 플레이어 — 곡 시작 위치 찍기
  const songCtx = { editable: true, roster, byPos, sheets: w.sheets, tagSet, jumps: songJumps(w.recs) };
  const kakao = kakaoFor({ date, scope, eventRow, pinfo, w, byPos, infoMap });

  const content = `
  ${pageShell.hubNav('conti', team)}
  ${hero}
  ${strip}
  ${dayBanner}
  ${practice}
  ${(() => {
    const switcher = teamContext.teamSwitcher(ctx, { keep: scope.event ? { event: scope.event } : { date } });
    return `<div class="ph-card cn-toolcard">${switcher}${contiToolbox({ team, scope, date, eventRow, w, kakao, stage: true })}</div>`;
  })()}

  ${lineup}


  <div class="ph-card top-accent">
    <div class="cn-cardhead"><h2 class="ph-h2">콘티</h2>${w.conti.length > 1 ? `<button type="button" class="cn-mini" data-cn-reorder>${ui.icon('pencil')} 순서 바꾸기</button>` : ''}</div>
    ${w.conti.length > 1 ? `<form method="post" action="/conti/songs/reorder" class="cn-rbar" data-cn-rbar hidden>
      <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="ids" value="" data-cn-rids>
      <p class="cn-rhint">손잡이를 끌어서 순서를 바꾼 뒤 <b>순서 저장</b>을 눌러 주세요.</p>
      <div class="cn-rbtns"><button type="button" class="cn-mini" data-cn-rcancel>취소</button><button type="submit" class="cn-mini pri">순서 저장</button></div>
    </form>` : ''}
    <div class="cn-songs" data-cn-sortable>${w.conti.length ? w.conti.map((s, i) => songCard(s, Object.assign({ index: i + 1, kind: '콘티' }, songCtx))).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div>
    ${songForm('콘티', team, scope, roster, byPos, hist)}
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">설교 후 찬양</h2>
    <div class="cn-songs">${w.final.length ? w.final.map((s) => songCard(s, Object.assign({ index: 1, kind: '결단' }, songCtx))).join('') : '<p class="ph-sub">아직 없어요. 한 곡만 올릴 수 있어요.</p>'}</div>
    ${w.final.length ? '' : sameAsHtml(team, scope, w.conti) + songForm('결단', team, scope, roster, byPos, null)}
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">폐회송</h2>
    <p class="ph-sub">축도 직전에 부르는 곡이에요. "관리"에서 기본값을 정해두면 매주 자동으로 들어가요 — 이번 주만 다르면 아래에서 고쳐 주세요.</p>
    <div class="cn-songs">${w.closing.length ? w.closing.map((s) => songCard(s, Object.assign({ index: 1, kind: '폐회송' }, songCtx))).join('') : '<p class="ph-sub">아직 없어요. "관리"에서 폐회송을 정해주세요. 한 곡만 올릴 수 있어요.</p>'}</div>
    ${w.closing.length ? '' : songForm('폐회송', team, scope, roster, byPos, null)}
  </div>

  ${packageSheetsCard(team, scope, w.sheets, true, w.conti.concat(w.final).concat(w.closing).map((r) => ({ id: r['ID'], title: String(r['제목'] || '제목 없음'), kind: r['구분'] })))}

  <div class="ph-card">
    <h2 class="ph-h2">녹음</h2>
    ${nasOpenUrl() ? `<p class="ph-sub" style="margin:-4px 0 10px;"><a class="ph-li-link" href="${esc(nasOpenUrl())}" target="_blank" rel="noopener">NAS 열기 ↗</a> — 옛 녹음 · 영상은 NAS 화면에서 직접 찾아 들어요 (앱 대역폭을 쓰지 않아요).${nasLoginHint() && !guestAccess.isGuest(req.ctx.member) ? `<br><span class="ph-sub">${esc(nasLoginHint())}</span>` : ''}</p>` : ''}
    <h3 class="ph-h3">연습 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] !== '예배').length ? w.recs.filter((r) => r['구분'] !== '예배').map((r) => recItem(r, true, markSongs)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <h3 class="ph-h3">예배 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] === '예배').length ? w.recs.filter((r) => r['구분'] === '예배').map((r) => recItem(r, true, markSongs)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
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

/* ================= 연습 콘티 — 연습일 기준으로 묶어 보기 (한 번에 2주치를 연습하면 그 날짜에 두 콘티가 함께) ================= */
/**
 * 스케줄표에서 "캘린더에 추가" — 내가 서는 예배 하나의 연습(kind=prac) 또는 예배 당일(kind=sun)을 따로.
 *  ?team&key(주일 날짜 · ev-ID)&kind=prac|sun&to=google|ics  →  구글이면 구글 캘린더로 보내고, ics 면 캘린더 파일
 */
/** 내가 서는 예배(주일 · 행사) 당일 일정 — 리허설 모임부터 예배 끝(시작 + 1시간 30분)까지 */
function serveEvent(team, t, st, ts, evRow, base) {
  const isEv = !!t.event, tname = practiceView.targetName(t);
  const worship = timeSettings.parse(evRow && evRow['예배시간']) || ts.worship;
  const meet = timeSettings.parse(evRow && evRow['리허설시간']) || (isEv ? '' : ts.rehearsal) || worship;
  const [h, m] = worship.split(':').map(Number), em = Math.min(23 * 60 + 59, h * 60 + m + 90);
  const end = `${String(Math.floor(em / 60)).padStart(2, '0')}:${String(em % 60).padStart(2, '0')}`;
  const url = base + contiUrl(team, { event: t.event, date: t.date });
  return { title: `${team} ${isEv ? t.name : '주일예배'} 찬양${st.pos.length ? ' (' + st.pos.join(' · ') + ')' : ''}`, date: t.date, time: meet, end, place: ts.place || '',
    details: [meet !== worship ? `리허설 모임 ${timeSettings.fmt(meet)} · 예배 ${timeSettings.fmt(worship)}` : `예배 ${timeSettings.fmt(worship)}`, st.pos.length ? '내 포지션: ' + st.pos.join(' · ') : '', '콘티: ' + url].filter(Boolean).join('\n'),
    url, alarm: `${tname} 찬양`, uid: `serve-${t.key}-${team.replace(/[^A-Za-z0-9가-힣]/g, '')}@praise-broadcast-hub` };
}

/** 나의 스케줄 — 앞으로 (기본 3개월) 내가 서는 주일 · 행사와 그 연습일. 스케줄표의 "나의 스케줄" 창이 읽음.
 *  id = 'sun:<예배키>' | 'prac:<연습 날짜>' (한 금요일에 2주치를 연습하면 연습은 한 번) */
async function mySchedule(req, months) {
  const team = req.ctx.current, me = String(req.ctx.member['이름'] || '').trim();
  const today = week.todayStr();
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const r = await scheduleOf(team, me, today, prac.addDays(today, Math.round(30.5 * months)), base);
  r.items.forEach((it) => { delete it.ev; });
  return Object.assign(r, { feed: feedUrls(team, me, base) });
}
/** 이 사람이 [from, to] 에 서는 주일 · 행사와 연습 — 화면 목록 · 캘린더 구독(ics) 이 같이 씀. it.ev = 캘린더 일정 */
async function scheduleOf(team, me, today, to, base) {
  const [assignAll, offAll, evs, ts, gs] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), specialServices(team), timeSettings.get(team), practiceView.groups(team, today, to)]);
  const A = assignAll.filter((r) => r['팀ID'] === team), O = offAll.filter((r) => r['팀ID'] === team);
  const out = [];
  const targets = [];
  for (let d = today; d <= to; d = prac.addDays(d, 1)) if (new Date(d + 'T12:00:00').getDay() === 0) targets.push({ key: d, date: d, event: '', name: '' });
  evs.filter((e) => prac.isDate(e['날짜']) && e['날짜'] >= today && e['날짜'] <= to).forEach((e) => targets.push({ key: 'ev-' + e['ID'], date: e['날짜'], event: String(e['ID']), name: String(e['이름'] || '주일 외 찬양'), row: e }));
  targets.forEach((t) => {
    const st = practiceView.standing(me, t, A, O);
    if (!st.pos.length) return;
    const offSun = O.some((r) => String(r['날짜']) === t.key && String(r['이름'] || '').trim() === me && String(r['구분'] || '').trim() !== '연습');
    const ev = serveEvent(team, t, st, ts, t.row || null, base);
    out.push({ id: 'sun:' + t.key, kind: 'sun', date: t.date, time: ev.time, title: t.event ? `${t.name}` : `${practiceView.md(t.date)} 주일`,
      detail: `${t.event ? '주일 외 찬양' : '3부 예배'} · ${st.pos.join(' · ')}${ev.time ? ' · ' + timeSettings.fmt(ev.time) + ' 모임' : ''}`, off: offSun, google: practiceView.googleCalUrl(ev), ev });
  });
  gs.forEach((g) => {
    const mine = g.targets.map((t) => Object.assign({ t }, practiceView.standing(me, t, A, O))).filter((x) => x.pos.length);
    if (!mine.length) return;
    const ev = practiceView.calEvent(team, g, mine.map((x) => ({ name: practiceView.targetName(x.t), pos: x.pos })), base);
    ev.uid = `practice-${g.date}-${team.replace(/[^A-Za-z0-9가-힣]/g, '')}@praise-broadcast-hub`;
    const dd = new Date(g.date + 'T12:00:00');
    out.push({ id: 'prac:' + g.date, kind: 'prac', date: g.date, time: g.time, title: `${practiceView.md(g.date)} ${DOW[dd.getDay()]}요일 연습`,
      detail: [timeSettings.fmt(g.time), g.place, mine.map((x) => practiceView.targetName(x.t)).join(' · ') + ' 콘티'].filter(Boolean).join(' · '),
      off: mine.every((x) => x.off), google: practiceView.googleCalUrl(ev), ev });
  });
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'prac' ? -1 : 1));
  return { team, me, items: out };
}
router.get('/cal/mine', requireTeam, async (req, res) => {
  try { res.set('Cache-Control', 'private, no-store'); res.json({ ok: true, result: await mySchedule(req, Math.min(6, Math.max(1, Number(req.query.months) || 3))) }); }
  catch (e) { console.error('[나의 스케줄]', e && e.message); res.status(500).json({ ok: false, error: '불러오지 못했어요.' }); }
});
/* ---------- 캘린더 구독 (자동 연동) — 캘린더 앱이 몇 시간마다 이 주소를 다시 읽어서, 스케줄이 바뀌면 캘린더도 바뀜.
 * 캘린더 앱은 로그인을 못 하므로 (팀 · 이름) 서명으로 확인. 지난 2주 ~ 앞으로 6개월, 불가로 표시한 날은 빠짐 */
function feedSig(team, name) {
  return require('crypto').createHmac('sha256', String(process.env.SESSION_SECRET || 'dev')).update(['feed', team, name].join('|')).digest('hex').slice(0, 24);
}
function feedUrls(team, name, base) {
  const q = new URLSearchParams({ team, n: name, s: feedSig(team, name) }).toString();
  const https = String(base || '').replace(/\/+$/, '') + '/cal/feed.ics?' + q;
  const webcal = https.replace(/^https?:\/\//, 'webcal://');
  return {
    https, webcal,
    google: 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal),
    outlook: 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(https) + '&name=' + encodeURIComponent(`영락 ${String(team).replace(/\s+/g, '')} · ${name}`),
  };
}
router.get('/cal/feed.ics', async (req, res) => {
  const team = String(req.query.team || ''), name = String(req.query.n || '');
  if (!team || !name || String(req.query.s || '') !== feedSig(team, name)) return res.status(403).type('text').send('링크가 올바르지 않아요.');
  try {
    const today = week.todayStr(), base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const r = await scheduleOf(team, name, prac.addDays(today, -14), prac.addDays(today, 183), base);
    const evs = r.items.filter((it) => !it.off).map((it) => it.ev);
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900', 'Content-Disposition': 'inline; filename="schedule.ics"' });
    res.send(practiceView.icsText(evs, { name: `영락 ${team.replace(/\s+/g, '')} · ${name}`, refresh: 'PT3H' }));
  } catch (e) { console.error('[캘린더 구독]', e && e.message); res.status(500).type('text').send('잠시 후 다시 시도해 주세요.'); }
});
/** 나의 스케줄에서 고른 일정들을 캘린더 파일 하나로 — ?ids=sun:2026-10-25,prac:2026-10-23 (아이폰 · 맥 캘린더 · 구글 캘린더 가져오기) */
router.get('/cal/mine.ics', requireTeam, async (req, res) => {
  const team = req.ctx.current, me = String(req.ctx.member['이름'] || '').trim();
  const want = new Set(String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 60));
  if (!want.size) return res.status(400).type('text').send('넣을 일정을 골라 주세요.');
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const [assignAll, offAll, ts] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), timeSettings.get(team)]);
  const A = assignAll.filter((r) => r['팀ID'] === team), O = offAll.filter((r) => r['팀ID'] === team);
  const evs = [];
  for (const id of want) {
    const [kind, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
    if (kind === 'sun') {
      const isEv = /^ev-/.test(key), evRow = isEv ? await specialServiceById(team, key.slice(3)) : null;
      if (isEv ? !evRow : !prac.isDate(key)) continue;
      const t = isEv ? { key, date: evRow['날짜'], event: String(evRow['ID']), name: String(evRow['이름'] || '주일 외 찬양') } : { key, date: key, event: '', name: '' };
      const st = practiceView.standing(me, t, A, O);
      if (st.pos.length) evs.push(serveEvent(team, t, st, ts, evRow, base));
    } else if (kind === 'prac' && prac.isDate(key)) {
      const g = (await practiceView.groups(team, key, key))[0]; if (!g) continue;
      const mine = g.targets.map((t) => Object.assign({ t }, practiceView.standing(me, t, A, O))).filter((x) => x.pos.length);
      if (!mine.length) continue;
      const ev = practiceView.calEvent(team, g, mine.map((x) => ({ name: practiceView.targetName(x.t), pos: x.pos })), base);
      ev.uid = `practice-${g.date}-${team.replace(/[^A-Za-z0-9가-힣]/g, '')}@praise-broadcast-hub`;
      evs.push(ev);
    }
  }
  if (!evs.length) return res.status(404).type('text').send('넣을 일정이 없어요.');
  evs.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="my-schedule-${evs[0].date}.ics"` });
  res.send(practiceView.icsText(evs));
});

router.get('/cal/serve', requireTeam, async (req, res) => {
  const team = req.ctx.current, key = String(req.query.key || '').trim(), kind = req.query.kind === 'prac' ? 'prac' : 'sun';
  const isEvKey = /^ev-/.test(key);
  const evRow = isEvKey ? await specialServiceById(team, key.slice(3)) : null;
  if (isEvKey ? !evRow : !prac.isDate(key)) return res.status(400).type('text').send('날짜를 확인해주세요.');
  const t = isEvKey ? { key, date: evRow['날짜'], event: String(evRow['ID']), name: String(evRow['이름'] || '주일 외 찬양') } : { key, date: key, event: '', name: '' };
  const me = String(req.ctx.member['이름'] || '').trim();
  const [assignAll, offAll, pracAll, ts] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), sheetsDb.readAll('연습일정'), timeSettings.get(team)]);
  const A = assignAll.filter((r) => r['팀ID'] === team), O = offAll.filter((r) => r['팀ID'] === team);
  const st = practiceView.standing(me, t, A, O);
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const tname = practiceView.targetName(t);
  let ev;
  if (kind === 'prac') {
    const p = prac.practiceFor(key, t.date, pracAll.filter((r) => r['팀ID'] === team), timeSettings.practiceNote(ts));
    if (p.none || p.unset || !p.date) return res.status(404).type('text').send('이 예배는 연습일이 정해지지 않았어요.');
    const w = practiceView.whenOf(p.note, ts);
    ev = practiceView.calEvent(team, { date: p.date, time: w.time, place: w.place, targets: [t] }, st.pos.length ? [{ name: tname, pos: st.pos }] : null, base);
  } else {
    ev = serveEvent(team, t, st, ts, evRow, base);
  }
  if (req.query.to === 'google') return res.redirect(practiceView.googleCalUrl(ev));
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${kind === 'prac' ? 'practice' : 'worship'}-${t.date}.ics"` });
  res.send(practiceView.icsText(ev));
});

/** 메일 속 "아이폰 캘린더" 링크 — 로그인 없이 (서명으로 확인) */
router.get('/practice-cal.ics', async (req, res) => {
  const team = String(req.query.team || ''), pd = String(req.query.pd || ''), name = String(req.query.n || '');
  const reminder = require('../lib/practiceReminder');
  if (!team || !prac.isDate(pd) || !name || String(req.query.s || '') !== reminder.calSig(team, pd, name)) return res.status(403).type('text').send('링크가 올바르지 않아요.');
  const g = (await practiceView.groups(team, pd, pd))[0];
  if (!g) return res.status(404).type('text').send('그 날짜에 정해진 연습이 없어요.');
  const [assignAll, offAll] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정')]);
  const A = assignAll.filter((r) => r['팀ID'] === team), O = offAll.filter((r) => r['팀ID'] === team);
  const mine = g.targets.map((t) => Object.assign({ t }, practiceView.standing(name, t, A, O))).filter((x) => x.pos.length && !x.off).map((x) => ({ name: practiceView.targetName(x.t), pos: x.pos }));
  const ev = practiceView.calEvent(team, g, mine, process.env.BASE_URL || `${req.protocol}://${req.get('host')}`);
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="practice-${pd}.ics"` });
  res.send(practiceView.icsText(ev));
});

/** 연습 일정 .ics — 아이폰 · 맥 캘린더에 바로 추가 (내가 서는 콘티 이름 · 내 포지션을 적음) */
router.get('/practice-conti/calendar.ics', requireTeam, async (req, res) => {
  const team = req.ctx.current, pd = String(req.query.pd || '');
  if (!prac.isDate(pd)) return res.status(400).type('text').send('날짜를 확인해주세요.');
  const g = (await practiceView.groups(team, pd, pd))[0];
  if (!g) return res.status(404).type('text').send('그 날짜에 정해진 연습이 없어요.');
  const me = String(req.ctx.member['이름'] || '').trim();
  const [assignAll, offAll] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정')]);
  const A = assignAll.filter((r) => r['팀ID'] === team), O = offAll.filter((r) => r['팀ID'] === team);
  const mine = g.targets.map((t) => Object.assign({ t }, practiceView.standing(me, t, A, O))).filter((x) => x.pos.length && !x.off)
    .map((x) => ({ name: practiceView.targetName(x.t), pos: x.pos }));
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const ev = practiceView.calEvent(team, g, mine, base);
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="practice-${pd}.ics"` });
  res.send(practiceView.icsText(ev));
});

router.get('/practice-conti', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const isGuest = guestAccess.isGuest(ctx.member);
  const today = week.todayStr();
  let gs = await practiceView.groups(team, prac.addDays(today, -21), prac.addDays(today, 56));
  if (isGuest) {                                                         // 객원 멤버는 서는 예배만
    for (const g of gs) {
      const ok = [];
      for (const t of g.targets) if (await guestAccess.canSee(ctx.member, team, { event: t.event, date: t.date })) ok.push(t);
      g.targets = ok;
    }
    gs = gs.filter((g) => g.targets.length);
  }
  const want = prac.isDate(req.query.pd) ? String(req.query.pd) : '';
  const cur = gs.find((g) => g.date === want) || gs.find((g) => g.date >= today) || gs[gs.length - 1] || null;
  const q = (d) => `/practice-conti?team=${encodeURIComponent(team)}&pd=${encodeURIComponent(d)}`;
  const me = String(ctx.member['이름'] || '').trim();

  // 날짜 띠 — 예배콘티의 달력 띠와 같은 모양, 칸 아래에는 "몇 주치"를 적음
  const strip = gs.length ? `<div class="ph-wstrip pc-strip"><div class="ph-wstrip-scroll">${gs.map((g) => {
    const dd = new Date(g.date + 'T12:00:00'), on = cur && g.date === cur.date;
    const sub = g.targets.length > 1 ? `${g.targets.length}개 콘티` : (g.targets[0].event ? g.targets[0].name : `${Number(g.targets[0].date.slice(5, 7))}/${Number(g.targets[0].date.slice(8, 10))} 주일`);
    return `<a class="ph-wstrip-cell pc-cell${on ? ' on' : ''}${g.date < today ? ' past' : ''}${g.targets.length > 1 ? ' multi' : ''}" href="${q(g.date)}"${on ? ' aria-current="page"' : ''}>
      <span class="ph-wstrip-month">${dd.getMonth() + 1}월 · ${DOW[dd.getDay()]}</span>
      <span class="ph-wstrip-day">${dd.getDate()}</span>
      <span class="ph-wstrip-ratio">${esc(sub)}</span>
    </a>`; }).join('')}</div></div>` : '';

  let body;
  if (!cur) {
    body = `<div class="ph-card"><p class="ph-sub">지난 3주 · 앞으로 8주 안에 정해진 연습이 없어요. 연습일은 <a href="/schedule?team=${encodeURIComponent(team)}">스케줄표</a>에서 정해요.</p></div>`;
  } else {
    const [assignAll, offAll, infoMap] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), avatar.teamInfoMap(team)]);
    const A = assignAll.filter((r) => r['팀ID'] === team), O = offAll.filter((r) => r['팀ID'] === team);
    const head = `<div class="ph-card ph-practicecard pc-head">
      <div class="ph-pr-row">
        <span class="ph-pr-ic">${ui.icon('metronome')}</span>
        <div class="ph-pr-main"><span class="ph-pr-label">연습</span><b>${esc(mdDow(cur.date))}</b>${cur.note ? `<span class="ph-pr-note">${esc(cur.note)}</span>` : ''}
          <span class="ph-pr-with">${cur.targets.length > 1 ? `이 날 ${cur.targets.length}개 콘티를 함께 연습해요 · ` : ''}${cur.targets.map((t) => esc(practiceView.targetName(t))).join(' · ')}</span></div>
        <a class="ph-pr-edit" href="/schedule?team=${encodeURIComponent(team)}">스케줄표에서 바꾸기 ${ui.icon('next')}</a>
      </div>
      <div class="pc-cal"><span class="pc-callab">${ui.icon('calendar')} 캘린더에 추가</span>
        <a class="cn-mini" href="/practice-conti/calendar.ics?team=${encodeURIComponent(team)}&pd=${encodeURIComponent(cur.date)}">아이폰 · 맥 캘린더</a>
        <a class="cn-mini" href="${esc(practiceView.googleCalUrl(practiceView.calEvent(team, cur, null, process.env.BASE_URL || `${req.protocol}://${req.get('host')}`)))}" target="_blank" rel="noopener">구글 캘린더</a></div>
    </div>`;
    const cards = [];
    for (const t of cur.targets) {
      const scope = { event: t.event, date: t.date };
      const eventRow = t.event ? await specialServiceById(team, t.event) : null;
      const w = await loadWeek(team, scope);
      const { byPos, roster, infoMap: wInfo } = await weekAssignments(team, scope);
      const pinfo = await practiceInfo(team, scope, t.date);
      const tagSet = ALL_POSITIONS.concat(roster).sort((a, b) => b.length - a.length);
      const songCtx = { editable: true, roster, byPos, sheets: w.sheets, tagSet, jumps: songJumps(w.recs) };
      const hist = await historyFor(team, scope);
      // 이 연습에 오는 사람 — 편성된 사람 중 '연습 불참'(또는 둘 다 불참)이 아닌 사람
      const inT = (r) => (t.event ? r['행사ID'] === t.event : (!r['행사ID'] && r['날짜'] === t.date));
      const offNames = new Set(O.filter((r) => String(r['날짜']) === t.key && String(r['구분'] || '').trim() !== '예배').map((r) => String(r['이름'] || '').trim()));
      const people = [];
      ALL_POSITIONS.forEach((p) => A.filter((r) => inT(r) && canonicalPosition(String(r['포지션'] || '').trim()) === p).forEach((r) => {
        const n = String(r['이름'] || '').trim(); if (!n) return;
        const ex = people.find((x) => x.name === n); if (ex) { if (!ex.pos.includes(p)) ex.pos.push(p); return; }
        people.push({ name: n, pos: [p], off: offNames.has(n) });
      }));
      const chip = (x) => `<span class="pc-person${x.off ? ' off' : ''}${x.name === me ? ' me' : ''}" title="${esc(x.pos.join(' · '))}${x.off ? ' — 연습 불참' : ''}">${avatar.avatarHtml(x.name, infoMap[x.name] || {}, 'sm', { noBadge: true })}<span class="pc-pn">${esc(honorific.isPastorRoles((infoMap[x.name] || {}).역할) || x.pos.some((p) => honorific.isLeadPos(p)) ? honorific.withTitle(x.name) : x.name)}</span><span class="pc-pp">${esc(x.pos.join(' · '))}</span></span>`;
      const coming = people.filter((x) => !x.off), away = people.filter((x) => x.off);
      const contiHref = contiUrl(team, scope);
      const kakao = kakaoFor({ date: t.date, scope, eventRow, pinfo, w, byPos, infoMap: wInfo });
      const sec = (title, list, extra) => (list.length || extra ? `<div class="pc-sec"><h3>${title}</h3>${list.length ? `<div class="cn-songs">${list.join('')}</div>` : '<p class="ph-sub">아직 올라온 곡이 없어요.</p>'}${extra || ''}</div>` : '');
      const songsHtml = sec('콘티', w.conti.map((s, i) => songCard(s, Object.assign({ index: i + 1, kind: '콘티' }, songCtx))), `<div class="pc-add">${songForm('콘티', team, scope, roster, byPos, hist)}</div>`)
        + sec('설교 후 찬양', w.final.map((s) => songCard(s, Object.assign({ index: 1, kind: '결단' }, songCtx))))
        + sec('폐회송', w.closing.map((s) => songCard(s, Object.assign({ index: 1, kind: '폐회송' }, songCtx))));
      cards.push(withBack(`<section class="ph-card pc-target" aria-label="${esc(practiceView.targetName(t))} 콘티">
        <div class="pc-thead">
          <div><h2 class="ph-h2">${esc(practiceView.targetName(t))} 콘티</h2><p class="pc-tdate">${esc(week.labelKo(t.date))}${cur.targets.length > 1 ? ` · ${cur.targets.indexOf(t) + 1} / ${cur.targets.length}` : ''}</p></div>
          <div class="pc-tlinks"><a class="cn-mini" href="${contiHref}">예배 콘티에서 열기 ${ui.icon('next')}</a></div>
        </div>
        <div class="cn-toolcard">${contiToolbox({ team, scope, date: t.date, eventRow, w, kakao, stage: true })}</div>
        ${people.length ? `<div class="pc-people">${coming.map(chip).join('')}${away.length ? `<span class="pc-awaylab">연습 불참</span>${away.map(chip).join('')}` : ''}</div>` : '<p class="ph-sub">아직 편성이 없어요.</p>'}
        ${songsHtml}
        ${(() => {
          const prs = w.recs.filter((r) => r['구분'] !== '예배'), marks = songsForMarks(w);
          return `<div class="pc-sec pc-recs"><h3>연습 녹음</h3>
          <div class="ph-list">${prs.length ? prs.map((r) => recItem(r, false, marks)).join('') : '<p class="ph-sub">아직 올린 연습 녹음이 없어요.</p>'}</div>
          <details class="ph-add">
            <summary>+ 연습 녹음 올리기</summary>
            <form method="post" action="/conti/recordings" enctype="multipart/form-data" class="ph-inlineform" data-rec-form>
              <input type="hidden" name="team" value="${esc(team)}">${scopeHidden(scope)}<input type="hidden" name="구분" value="연습">
              <input type="text" name="제목" placeholder="녹음 제목 (비워 두면 파일 이름 · 링크 제목이 자동으로 들어가요)">
              <input type="file" name="파일" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.aac">
              <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신) — 유튜브 · 드라이브 · 음원 주소">
              <button class="ph-btn pri" type="submit">올리기</button>
            </form>
          </details></div>`;
        })()}
      </section>`, q(cur.date)));
    }
    body = head + cards.join('');
  }

  const content = `
  ${pageShell.hubNav('practice', team)}
  ${pageShell.hero({ eyebrow: `${team} · 연습 콘티`, title: '연습 콘티', sub: cur ? week.labelKo(cur.date) : '' })}
  ${strip}
  ${teamContext.teamSwitcher(ctx, {}) ? `<div class="ph-card">${teamContext.teamSwitcher(ctx, {})}</div>` : ''}
  ${body}`;
  spa.send(req, res, content, { title: `${team} 연습 콘티` });
});

/* 라이브 악보(/conti/practice)는 routes/live.js 로 옮겼습니다 — church-app 의 라이브 악보를 그대로 씁니다. */

/** 인쇄용 PDF 패키지 — 표지(연습 일시 · 멤버 · 콘티 · 유튜브 QR) + 곡마다 머리말/악보/꼬리말, US Letter 흑백.  ?crop=0 이면 악보 위 제목 자르기를 끔 */
/** 커버에 찍는 시간 — 주일은 관리의 기본값, 주일 외 찬양은 그 행사에 적은 값 */
async function timesFor(team, eventRow) {
  if (eventRow) return { worship: timeSettings.fmt(eventRow['예배시간']), rehearsal: timeSettings.fmt(eventRow['리허설시간']) };
  const ts = await timeSettings.get(team);
  return { worship: timeSettings.fmt(ts.worship), rehearsal: timeSettings.fmt(ts.rehearsal) };
}
/** 라이브 악보에 쓴 팀 필기(「곡에 계속」 + 「이 날짜만」, 나만 보기는 빼고) → { 쪽번호: [항목] } · 없으면 null */
function teamAnnos(team, scope, link) {
  try {
    const id = liveStore.sheetIdOf(team, link);
    const items = liveStore.readLayer(team, id, 'song', '*').concat(liveStore.readLayer(team, id, liveStore.roomOf(scope), '*'));
    if (!items.length) return null;
    const by = {};
    items.forEach((it) => { const pg = Number(it.pg) || 1; (by[pg] = by[pg] || []).push(it); });
    return by;
  } catch (e) { return null; }
}
async function makePackage(req, onProgress) {
  {
    const t0 = Date.now();
    const team = req.ctx.current;
    const eventRow = await specialServiceById(team, String(req.query.event || '').trim());
    const date = eventRow ? eventRow['날짜'] : week.normalizeDate(req.query.date);
    const scope = { event: eventRow ? eventRow['ID'] : '', date };
    await ensureClosingHymn(team, scope);
    const w = await loadWeek(team, scope);
    const { byPos, infoMap } = await weekAssignments(team, scope);
    const pinfo = await practiceInfo(team, scope, date);
    const honor = (n, pos) => honorific.forPos(pos, n, honorific.isPastorRoles((infoMap[n] || {}).역할));       // 인도자 자리는 누구든 "OOO 목사"
    const members = ALL_POSITIONS.map((k) => ({ pos: k, names: (byPos[k] || []).map((x) => honor(x.이름, k)) })).filter((m) => m.names.length);
    const annoOn =String(req.query.anno) !== '0';                // 라이브 악보 필기도 넣기 (기본) — ?anno=0 이면 악보만
    if (annoOn) { try { const fl = req.app.get('rtFlush'); if (fl) fl(); } catch (e) { /* 실시간 필기 먼저 저장 — 안 되면 저장된 것까지만 */ } try { await liveStore.loadAnnos(); } catch (e) { /* 필기 없이 */ } }
    const annosOf = (link) => (annoOn ? teamAnnos(team, scope, link) : null);
    const used = new Set();
    const cache = new Map();
    const bytesOf = (link) => { if (!cache.has(link)) cache.set(link, fileBytes.get(link)); return cache.get(link); };   // 한 번만, 동시에 받음
    const links = new Set(); w.sheets.forEach((f) => { if (f['파일링크']) links.add(f['파일링크']); });
    let fetchedN = 0;
    links.forEach((l) => { bytesOf(l).then(() => { fetchedN++; onProgress(0.02 + 0.28 * (fetchedN / links.size), '악보 받는 중 (' + fetchedN + '/' + links.size + ')'); }); });
    onProgress(0.02, '악보 받는 중');
    const all = [].concat(w.conti.map((s, i) => ({ s, kind: '콘티', no: i + 1 })), w.final.map((s) => ({ s, kind: '결단', no: 1 })), w.closing.map((s) => ({ s, kind: '폐회송', no: 1 })));
    const songs = [];
    for (const x of all) {
      const mine = w.sheets.filter((f) => f['곡ID'] === x.s['ID'] && f['파일링크']).sort(sheetOrder);
      const sheets = [];
      for (const f of mine) {
        const o = splitOrigin(f);
        if (o && o.header) {                 // 콘티에서 이미 머리말을 단 악보 — 자르거나 머리말을 또 달지 않고 그 쪽 그대로 (쪽 번호만 패키지 기준으로)
          used.add(f['파일링크']); used.add(o.link);
          const hb = await bytesOf(f['파일링크']);
          if (hb) { sheets.push({ buf: hb, asIs: true, annos: annosOf(f['파일링크']) }); continue; }
        }
        if (o) {
          used.add(f['파일링크']); used.add(o.link);
          const fa = annosOf(f['파일링크']);                            // 자른 악보에 필기가 있으면 — 필기 좌표가 그 자른 악보 기준이라 그 파일로
          if (fa) { const fb = await bytesOf(f['파일링크']); if (fb) { sheets.push({ buf: fb, spec: '', crop: '', annos: fa }); continue; } }
          const ob = await bytesOf(o.link); if (ob) { sheets.push({ buf: ob, spec: o.spec, crop: o.crop || '' }); continue; }   // 자르기만 한 악보 — 원본 + 자르기
        }
        used.add(f['파일링크']); const buf = await bytesOf(f['파일링크']);
        if (buf) sheets.push({ buf, spec: String(f['쪽'] || ''), crop: String(f['자르기'] || ''), asIs: !String(f['쪽'] || '').trim() && await pkgPdf.isHeadedSheet(buf), annos: annosOf(f['파일링크']) });   // 예전에 "헤더 자동 추가"로 올린 악보도 알아봄
      }
      songs.push({ no: x.no, kind: x.kind, title: String(x.s['제목'] || '').trim(), team: String(x.s['팀'] || '').trim(), key: String(x.s['Key'] || '').trim(), bpm: String(x.s['BPM'] || '').trim(),
        form: kakaoLib.formText(x.s['송폼']), note: String(x.s['비고'] || '').trim(), sheets });
    }
    const extra = [];
    for (const f of w.sheets.filter((r) => !r['곡ID'] && r['파일링크'] && !used.has(r['파일링크']))) {
      used.add(f['파일링크']); const buf = await bytesOf(f['파일링크']);
      if (buf) extra.push({ title: String(f['제목'] || '악보'), sheets: [{ buf, spec: String(f['쪽'] || ''), annos: annosOf(f['파일링크']) }] });
    }
    const ids = []; all.forEach((x) => { const id = youtube.idOf(x.s['유튜브']); if (id && ids.indexOf(id) === -1) ids.push(id); });
    const qrUrl = ids.length === 1 ? 'https://youtu.be/' + ids[0] : ids.length ? 'https://www.youtube.com/watch_videos?video_ids=' + ids.slice(0, 50).join(',') : '';
    const tFetched = Date.now();
    const pr = pinfo.p && (pinfo.p.none || pinfo.p.date) ? pinfo.p : null;
    const times = await timesFor(team, eventRow);
    const pdf = await pkgPdf.build({
      church: process.env.CHURCH_NAME || '토론토영락교회', team, date, eventName: eventRow ? String(eventRow['이름'] || '') : '',
      title: eventRow ? String(eventRow['이름'] || '') + ' 찬양 콘티' : '주일예배 찬양 콘티',
      practice: pr ? { date: pr.date, note: pr.note, none: pr.none } : null, times, members, songs, extra, qrUrl, qrCount: ids.length, crop: String(req.query.crop) !== '0', annos: annoOn, onProgress,
    }, sheetSearch.imagesToPdf);
    console.log(`[PDF 패키지] ${team} ${date} — 악보 받기 ${tFetched - t0}ms · 만들기 ${Date.now() - tFetched}ms · ${(pdf.length / 1024) | 0}KB`);
    const name = `${team} 콘티 ${date}${eventRow ? ' ' + eventRow['이름'] : ''}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim();
    const sig = pkgSig({ w, members, pr, times, title: eventRow ? String(eventRow['이름'] || '') : '', date, team, scope });
    return { pdf, name, sig, date, event: scope.event };
  }
}

/** 지금 콘티 · 악보 · 편성 · 연습 상태의 지문 — 확정한 PDF 를 만들 때와 같은지 비교해서 "확정 이후 바뀜"을 알려 줌 */
function pkgSig({ w, members, pr, times, title, date, team, scope }) {
  const meta = (f) => [f['파일링크'], f['쪽'] || '', f['자르기'] || ''].join('|');
  const all = [].concat(w.conti, w.final, w.closing);
  const songs = all.map((s) => [s['ID'], s['제목'], s['팀'], s['Key'], s['BPM'], kakaoLib.formText(s['송폼']), s['비고'], s['유튜브'],
    w.sheets.filter((f) => f['곡ID'] === s['ID'] && f['파일링크']).sort(sheetOrder).map(meta)]);
  const extra = w.sheets.filter((r) => !r['곡ID'] && r['파일링크']).map(meta);
  // 라이브 악보 팀 필기도 지문에 — 확정한 뒤 필기를 고치면 "확정 이후 바뀜"
  const annos = team ? w.sheets.filter((f) => f['파일링크']).map((f) => { const a = teamAnnos(team, scope, f['파일링크']); return a ? [f['파일링크'], Object.keys(a).map((k) => a[k].map((it) => it.id + ':' + (it.ts || '')).join(',')).join('|')] : null; }).filter(Boolean) : [];
  return require('crypto').createHash('sha1').update(JSON.stringify([pkgPdf.LAYOUT_V, title, date, pr && [pr.date, pr.note, pr.none], times || null, members, songs, extra, annos])).digest('hex');
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
    const honor = (n, pos) => honorific.forPos(pos, n, honorific.isPastorRoles((infoMap[n] || {}).역할));       // 인도자 자리는 누구든 "OOO 목사"
    const members = ALL_POSITIONS.map((k) => ({ pos: k, names: (byPos[k] || []).map((x) => honor(x.이름, k)) })).filter((m) => m.names.length);
    const pinfo =await practiceInfo(team, scope, date);
    const pr = pinfo.p && (pinfo.p.none || pinfo.p.date) ? pinfo.p : null;
    const times = await timesFor(team, eventRow);
    try { await liveStore.loadAnnos(); } catch (e) { /* 필기 없이 비교 */ }
    const sig = pkgSig({ w, members, pr: pr && { date: pr.date, note: pr.note, none: pr.none }, times, title: eventRow ? String(eventRow['이름'] || '') : '', date, team, scope });
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

/** 인쇄용 PDF → 관리 > 설정에서 정한 구글 드라이브 폴더에 올리기. job(방금 만든 것) 또는 saved=1(확정본).
 *  같은 콘티(팀 + 날짜 · 행사)는 같은 파일을 덮어씀 (lib/pkgDrive.js) */
router.post('/conti/package/drive', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (guestAccess.isGuest(req.ctx.member)) return res.status(403).json({ ok: false, msg: '객원 멤버는 쓸 수 없는 기능이에요.' });
    const { team, scope } = await pkgContext(req);
    const b = req.body || {};
    let pdf = null, name = '';
    if (b.job) {
      const j = pkgJobs.get(String(b.job));
      if (j && j.team === team && j.result && j.result.date === scope.date && (j.result.event || '') === (scope.event || '')) { pdf = j.result.pdf; name = j.result.name; }
    } else if (b.saved) {
      const row = await savedRow(team, scope);
      if (row) { pdf = await fileBytes.get(row['파일링크']); name = String(row['파일명'] || '콘티'); }
    }
    if (!pdf) return res.status(400).json({ ok: false, msg: '올릴 PDF를 찾지 못했어요. PDF를 다시 만든 뒤 올려 주세요.' });
    const r = await pkgDrive.upload(team, scope, name, pdf);
    res.json({ ok: true, link: r.link, name: r.name, replaced: r.replaced, folder: r.folder });
  } catch (e) {
    if (!e.setup) console.error('[인쇄용 PDF 드라이브 올리기 실패]', e && e.message);
    res.status(e.setup ? 409 : 500).json({ ok: false, setup: !!e.setup, msg: (e && e.message) || '구글 드라이브에 올리지 못했어요.' });
  }
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
    const all = [].concat(w.conti.map((s, i) => ({ s, no: i + 1 })), w.final.map((s) => ({ s, no: '+' })), w.closing.map((s) => ({ s, no: '+' })));
    const out = [];
    all.forEach((x) => {
      w.sheets.filter((f) => f['곡ID'] === x.s['ID'] && f['파일링크']).sort(sheetOrder)
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
    if (!dup) {
      const before = (await sheetsDb.readAll('찬양편성', { fresh: true })).filter((r) => r['팀ID'] === team && inScope(r, scope) && canonicalPosition(r['포지션']) === canonicalPosition(pos)).map((r) => String(r['이름'] || '').trim());
      await sheetsDb.appendRow('찬양편성', { 'ID': 'A' + Date.now().toString(36), '팀ID': team, ...scopeFields(scope), '포지션': pos, '이름': name });
      await logLineup(req, team, scope, pos, before, before.concat([name]));
    }
  }
  backTo(req, res, team, scope);
});

router.post('/conti/lineup/unassign', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) {
    try {
      const all = await sheetsDb.readAll('찬양편성', { fresh: true });
      const gone = all.find((r) => r.__row === row);
      await sheetsDb.deleteRow('찬양편성', row);
      if (gone && gone['팀ID'] === req.ctx.current) {
        const sc = { event: String(gone['행사ID'] || ''), date: String(gone['날짜'] || '') };
        const pos = canonicalPosition(gone['포지션']);
        const before = all.filter((r) => r['팀ID'] === gone['팀ID'] && inScope(r, sc) && canonicalPosition(r['포지션']) === pos).map((r) => String(r['이름'] || '').trim());
        await logLineup(req, gone['팀ID'], sc, pos, before, all.filter((r) => r !== gone && r['팀ID'] === gone['팀ID'] && inScope(r, sc) && canonicalPosition(r['포지션']) === pos).map((r) => String(r['이름'] || '').trim()));
      }
    } catch (e) { console.error('[편성 삭제 실패]', e.message); }
  }
  backTo(req, res, b.team, scopeFrom(b));
});

/** 콘티 화면의 "주일 편성"에서 바꾼 것도 스케줄 변경 기록에 (lib/scheduleLog.js) */
async function logLineup(req, team, scope, pos, before, after) {
  const key = scope.event ? 'ev-' + scope.event : scope.date;
  await schedLog.log(schedLog.assignEntry(team, String(req.ctx.member['이름'] || ''), { key, date: scope.date, evName: await schedLog.evName(team, scope.event) }, canonicalPosition(pos), before, after));
}

router.post('/conti/songs', requireTeam, upload.array('파일', 12), guestGate.afterUpload, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const kind = b['구분'] === '결단' ? '결단' : b['구분'] === '폐회송' ? '폐회송' : '콘티';
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team, scope);
  const all = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && inScope(r, scope) && r['구분'] === kind);
  // 설교 후 찬양(결단) · 폐회송은 곡 하나만 — 이미 있으면 새로 추가하지 않음(기존 곡을 지우고 다시 올려야 함)
  if ((kind === '결단' || kind === '폐회송') && all.length >= 1) return backTo(req, res, team, scope);
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
  if (kind !== '폐회송') tellSong(req, team, scope, title);
  if ((req.files || []).length) sheetHeaders.queue(team, scope, liveNotify);
  backTo(req, res, team, scope);
});

/** 콘티 곡 순서 바꾸기 — 화면에서 끌어 옮긴 곡 ID 순서(ids, 쉼표로 이음)를 받아 "순서" 칸만 1..n 으로 다시 씁니다.
 *  · 설교 후 찬양 · 폐회송은 곡이 하나뿐이라 대상이 아님 · 그 사이 다른 사람이 추가해서 화면에 없던 곡은 원래 순서대로 뒤에 붙임
 *  · 예전에 곡을 지웠다 추가해서 순서 번호가 겹쳤던 것도 이때 깔끔하게 정리됩니다 */
router.post('/conti/songs/reorder', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  if (!req.ctx.teams.includes(team)) return backTo(req, res, req.ctx.current, scope);
  const ids = String(b.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (ids.length) {
    try {
      const rows = (await sheetsDb.readAll('찬양콘티', { fresh: true }))
        .filter((r) => r['팀ID'] === team && inScope(r, scope) && r['구분'] !== '결단' && r['구분'] !== '폐회송');
      const byId = new Map(rows.map((r) => [String(r['ID']), r]));
      const seen = new Set();
      const ordered = [];
      ids.forEach((id) => { const r = byId.get(id); if (r && !seen.has(id)) { seen.add(id); ordered.push(r); } });
      rows.slice().sort((a, c) => Number(a['순서'] || 0) - Number(c['순서'] || 0))
        .forEach((r) => { if (!seen.has(String(r['ID']))) ordered.push(r); });
      const cells = [];
      ordered.forEach((r, i) => { if (Number(r['순서']) !== i + 1) cells.push({ row: r.__row, header: '순서', value: i + 1 }); });
      if (cells.length) await sheetsDb.updateCells('찬양콘티', cells);
      liveNotify(team, scope, 'saveWorshipSong');
      if (cells.length) await sheetHeaders.settle(sheetHeaders.queue(team, scope, liveNotify), 8000);   // 머리말의 곡 번호도 새 순서로
    } catch (e) { console.error('[콘티 순서 저장 실패]', e.message); }
  }
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
        'ID': b['ID'] || old['ID'] || '', '팀ID': team, ...scopeFields(scope), '구분': b['구분'] === '결단' ? '결단' : b['구분'] === '폐회송' ? '폐회송' : '콘티',
        '순서': b['순서'] || old['순서'] || 0, '제목': title, '팀': b['팀'] || '', 'Key': b['Key'] || '', '유튜브': b['유튜브'] || '',
        '송폼': b['송폼'] || '', 'BPM': b['BPM'] || '', '비고': b['비고'] || '', '만든시각': b['만든시각'] || old['만든시각'] || new Date().toISOString(),
        '솔로': old['솔로'] || '',
      });
    } catch (e) { console.error('[콘티 수정 실패]', e.message); }
  }
  liveNotify(team, scope, 'saveWorshipSong');
  await sheetHeaders.settle(sheetHeaders.queue(team, scope, liveNotify), 8000);   // 제목 · Key · BPM · 송폼이 바뀌었으면 머리말 악보도 새로
  backTo(req, res, team, scope);
});

/** 한꺼번에 올리기 — 한 줄에 "제목 - 원곡팀 - Key" */
router.post('/conti/songs/bulk', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  const kind = b['구분'] === '결단' ? '결단' : b['구분'] === '폐회송' ? '폐회송' : '콘티';
  let lines = String(b['목록'] || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length) {
    const all = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && inScope(r, scope) && r['구분'] === kind);
    // 설교 후 찬양(결단) · 폐회송은 곡 하나만 — 이미 있으면 건너뛰고, 없으면 첫 줄 하나만 반영
    if (kind === '결단' || kind === '폐회송') lines = all.length >= 1 ? [] : lines.slice(0, 1);
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
      if (kind !== '폐회송') tellSong(req, team, scope, title);
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
  if (row && b.team) await sheetHeaders.settle(sheetHeaders.queue(String(b.team).trim(), scopeFrom(b), liveNotify), 8000);   // 뒤 곡들의 번호가 당겨짐
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
    try { jobs.push({ title: (files.length === 1 && typed) || titleFromFile(f.originalname) || typed || '악보', link: await driveStore.uploadPublic('악보', f), memo: f.__memo || '' }); }
    catch (e) { console.error('[악보 업로드 실패]', e.message); }
  }
  const link = String(b['링크'] || '').trim();
  if (!jobs.length && link) jobs.push({ title: typed || titleFromLink(link), link });
  for (let k = 0; k < jobs.length; k++) {
    await sheetsDb.appendRow('악보저장소', Object.assign({
      'ID': 'F' + Date.now().toString(36) + k + Math.random().toString(36).slice(2, 4), '팀ID': team, ...scopeFields(scope), '제목': jobs[k].title,
      '파일링크': jobs[k].link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
      '곡ID': String(songId || '').trim(),
    }, jobs[k].memo ? { '메모': jobs[k].memo } : {}, extra || {}));
  }
  return jobs.length;
}
/** 악보 올리기 — 제목은 안 써도 됩니다: 파일 이름이 제목이 되고(파일 여러 개를 한 번에도 가능), 링크만 넣으면 주소에서 따옴 */
router.post('/conti/sheets', requireTeam, upload.array('파일', 12), guestGate.afterUpload, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  if (b.header === '1') { try { await headerizeFiles(req, team, scope, b['곡ID']); } catch (e) { console.error('[악보 헤더 추가 실패 — 원본 그대로 올림]', e.message); } }
  const n = await saveSheetsFrom(req, team, scope, b['곡ID']);
  if (n) liveNotify(team, scope, 'saveSheets');                       // 열린 라이브 악보 · 방송팀 화면이 새 악보를 받아 가게
  if (n) sheetHeaders.queue(team, scope, liveNotify);                // 머리말의 콘티 전체 쪽 번호(1 / 5)를 새 쪽 수로 — 뒤에서
  backTo(req, res, team, scope);
});

/** "헤더 자동 추가" — 올린 악보 파일마다 곡 정보(제목 · 원곡팀 · KEY · BPM · 송폼) 머리말을 단 PDF 로 바꿔 req.files 에 되돌려 놓음.
 *  곡 정보는 클라이언트 값이 아니라 저장된 곡 줄에서 읽음. 파일 하나가 실패하면 그 파일만 원본 그대로. crop 은 파일 순서대로 "l,t,r,b" 를 | 로 이음 */
async function headerizeFiles(req, team, scope, songId) {
  const files = (req.files || []).filter((f) => f && f.buffer && f.buffer.length);
  if (!files.length) return;
  const rows = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && inScope(r, scope));
  const row = rows.find((r) => r['ID'] === String(songId || '').trim());
  if (!row) return;
  const s = sheetHeaders.songInfo(rows, row);
  const crops = String((req.body || {}).crop || '').split('|');
  // 이 곡에 이미 머리말 악보가 있으면, 새로 올리는 파일은 모두 "이어지는 악보" — 정식 머리말은 곡의 첫 악보 첫 쪽에만
  const mine = (await sheetsDb.readAll('악보저장소')).filter((r) => r['팀ID'] === team && r['곡ID'] === row['ID']);
  const hasHead = sheetHeaders.isCont(mine, null);
  for (let i = 0; i < files.length; i++) {
    const cont = hasHead || i > 0;
    try {
      const pdf = await pkgPdf.buildSongSheet(s, { buf: files[i].buffer, crop: crops[i] || '' }, sheetSearch.imagesToPdf, { cont });
      if (pdf) {
        // 원본은 비공개로 따로 보관 — 나중에 곡 정보(BPM 등)가 바뀌면 머리말을 다시 만들고, 올린 뒤에도 자르기를 다시 할 수 있게
        let src = '';
        try { src = await driveStore.uploadPrivate('악보원본', { buffer: files[i].buffer, mimetype: files[i].mimetype, originalname: files[i].originalname || '악보' }); } catch (e) { console.error('[악보 원본 보관 실패]', e.message); }
        if (src) files[i].__memo = sheetHeaders.encode({ src, spec: '', crop: crops[i] || '', header: true, sig: sheetHeaders.sigOf(s), priv: true, cont });
        files[i].buffer = pdf; files[i].mimetype = 'application/pdf'; files[i].originalname = String(files[i].originalname || '악보').replace(/\.[^.]*$/, '') + '.pdf'; files[i].size = pdf.length;
      }
    } catch (e) { console.error('[악보 헤더 추가 실패]', files[i].originalname, e.message); }
  }
}

/** 헤더 자동 추가 미리보기 — 올릴 파일에서 자동으로 찾은 악보 영역(0~1)을 알려 줌 (화면의 자르기 조정이 이 값에서 시작).
 *  pages=N 이면 1~N 쪽(최대 SHEET_CROP_MAX_PAGES) 모두 → boxes:[...] (못 찾은 쪽은 null). box 는 늘 첫 쪽 (예전 화면과 호환) */
const SHEET_CROP_MAX_PAGES = 20;
router.post('/conti/sheets/detect', requireTeam, upload.single('파일'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const toBox = (d) => (d && d.box ? { l: d.box.left, t: d.box.top, r: d.box.right, b: d.box.bottom } : null);
  try {
    let buf = req.file && req.file.buffer;
    if (!buf) return res.json({ box: null, boxes: [] });
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') buf = await sheetSearch.imagesToPdf([buf]);
    const n = Math.max(1, Math.min(SHEET_CROP_MAX_PAGES, parseInt((req.body || {}).pages, 10) || 1));
    const want = Array.from({ length: n }, (_, i) => i + 1);
    const det = await require('../lib/sheetCrop').detect(buf, want, n > 1 ? 15000 : 8000);
    const boxes = want.map((no) => toBox(det.find((d) => d.pageNo === no)));
    res.json({ box: boxes[0], boxes });
  } catch (e) { res.json({ box: null, boxes: [] }); }
});

/* ---------- 이미 올린 곡 악보에 자르기 · 머리말 다시 적용 ---------- */
/** 이 줄을 고칠 때 쓸 원본 — 이미 머리말 · 자르기를 적용한 악보면 보관해 둔 원본(+ 그 쪽), 아니면 지금 파일(+ 쪽 범위) */
function reformatSource(row) {
  const h = sheetHeaders.parse(row);
  return h ? { src: h.src, spec: h.spec, crop: h.crop, header: h.header, headed: true, priv: h.priv } : { src: row['파일링크'], spec: pageSpec.cleanSpec(row['쪽'] || ''), crop: '', header: true, headed: false, priv: false };
}
async function sheetRowOf(req, team, rowNo) {
  if (!team || !req.ctx.teams.includes(team)) return null;
  const rows = await sheetsDb.readAll('악보저장소', { fresh: true });
  return rows.find((r) => r.__row === Number(rowNo) && r['팀ID'] === team && r['파일링크']) || null;
}
const kindOfBytes = (buf) => (buf.slice(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf'
  : buf[0] === 0xFF && buf[1] === 0xD8 ? 'image/jpeg' : buf.slice(0, 4).toString('hex') === '89504e47' ? 'image/png' : buf.slice(0, 4).toString('latin1') === 'RIFF' ? 'image/webp' : '');

/** 자르기 창에 띄울 원본 바이트 — 쪽 범위가 있으면 그 쪽만 (창의 쪽 번호 = 저장할 자르기 값의 순서) */
router.get('/conti/sheets/source', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const row = await sheetRowOf(req, String(req.query.team || '').trim(), req.query.row);
    if (!row) return res.status(404).type('text').send('악보를 찾지 못했어요.');
    const src = reformatSource(row);
    let buf = await fileBytes.get(src.src);
    if (!buf) return res.status(502).type('text').send('원본 악보를 받지 못했어요.');
    let type = kindOfBytes(buf);
    if (!type) return res.status(415).type('text').send('PDF · 사진 악보만 자를 수 있어요.');
    if (src.spec && type === 'application/pdf') { const part = await require('../lib/pdfPart').extract(buf, src.spec); if (part) buf = part; }
    res.set({ 'Content-Type': type, 'Content-Length': String(buf.length) });
    res.send(buf);
  } catch (e) { console.error('[악보 원본 열기 실패]', e.message); res.status(500).type('text').send('원본 악보를 열지 못했어요.'); }
});

/** 자르기 · 머리말 적용 저장 — crop("l,t,r,b;…" 쪽마다), header('1' 이면 인쇄용 PDF 와 같은 머리말), revert('1' 이면 원본으로 되돌림).
 *  원본은 그대로 두고 새 PDF 를 만들어 이 줄에 끼우며, 메모에 만든 방법을 남겨 곡 정보가 바뀌면 머리말을 자동으로 다시 만듦 */
router.post('/conti/sheets/reformat', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  try {
    const row = await sheetRowOf(req, team, b.__row);
    if (!row || !row['곡ID'] || !inScope(row, scope)) return backTo(req, res, team, scope);
    const src = reformatSource(row);
    if (b.revert === '1') {
      if (src.headed) {
        let link = src.src, spec = src.spec;
        if (src.priv) {                                       // 비공개로 보관한 원본 — 공개 사본을 만들어 끼움
          const ob = await fileBytes.get(link);
          if (!ob) return backTo(req, res, team, scope);
          link = await driveStore.uploadPublic('악보', { buffer: ob, mimetype: kindOfBytes(ob) || 'application/octet-stream', originalname: String(row['제목'] || '악보') + (kindOfBytes(ob) === 'application/pdf' ? '.pdf' : '') });
        }
        await sheetsDb.updateCells('악보저장소', [{ row: row.__row, header: '파일링크', value: link }, { row: row.__row, header: '쪽', value: spec }, { row: row.__row, header: '메모', value: '' }]);
        liveNotify(team, scope, 'saveSheetSplit');
      }
      return backTo(req, res, team, scope);
    }
    const songs = (await sheetsDb.readAll('찬양콘티', { fresh: true })).filter((r) => r['팀ID'] === team && inScope(r, scope));
    const song = songs.find((r) => r['ID'] === row['곡ID']);
    if (!song) return backTo(req, res, team, scope);
    const buf = await fileBytes.get(src.src);
    if (!buf) { console.error('[자르기 · 머리말 — 원본을 받지 못함]', src.src); return backTo(req, res, team, scope); }
    const header = b.header === '1';
    const crop = String(b.crop || '').slice(0, 4000);
    const info = sheetHeaders.songInfo(songs, song);
    const cont = header && sheetHeaders.isCont((await sheetsDb.readAll('악보저장소', { fresh: true })).filter((r) => r['팀ID'] === team && r['곡ID'] === row['곡ID']), row);
    const pdf = await sheetHeaders.render(info, buf, { spec: src.spec, crop, header, cont });
    if (!pdf) return backTo(req, res, team, scope);
    const link = await sheetHeaders.uploadPdf(song['제목'] || row['제목'], pdf);
    await sheetsDb.updateCells('악보저장소', [
      { row: row.__row, header: '파일링크', value: link }, { row: row.__row, header: '쪽', value: '' },
      { row: row.__row, header: '쪽수', value: '' },
      { row: row.__row, header: '메모', value: sheetHeaders.encode({ src: src.src, spec: src.spec, crop, header, sig: header ? sheetHeaders.sigOf(info) : '', priv: src.priv, cont }) },
    ]);
    liveNotify(team, scope, 'saveSheetSplit');
    sheetHeaders.queue(team, scope, liveNotify);
  } catch (e) { console.error('[자르기 · 머리말 적용 실패]', e.message); }
  backTo(req, res, team, scope);
});

/** 웹에서 악보 이미지 찾기 — 검색 결과(JSON). 키가 없으면 configured:false 로 알려 줘서 화면이 설정 안내를 보여 줌 */
router.get('/conti/sheetsearch', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!sheetSearch.configured()) return res.json({ configured: false, items: [] });
  try { res.json({ configured: true, items: await sheetSearch.search(req.query.q, req.query.start) }); }
  catch (e) {
    console.error('[악보 검색 실패]', e.message);
    // 구글이 돌려준 이유를 그대로 보여 줌 — 키 · 검색엔진 설정 문제는 잠시 뒤 다시 해도 안 되므로 원인을 알려야 고칠 수 있음
    const why = e.status ? ' (검색 서비스 응답 ' + e.status + ': ' + String(e.message || '').slice(0, 160) + ')' : (e.name === 'TimeoutError' ? ' (구글 응답 지연)' : '');
    res.json({ configured: true, items: [], error: e.code === 'QUOTA' ? '오늘 검색 가능 횟수를 다 썼어요. 내일 다시 해 주세요.' : '검색하지 못했어요.' + (e.status === 400 || e.status === 403 || e.status === 404 ? ' 검색 키·검색엔진 설정을 확인해야 해요.' : ' 잠시 뒤 다시 해 주세요.') + why });
  }
});

/** 붙여넣은 이미지 주소 미리 확인 — 서버가 실제로 받아 JPG/PNG 로 쓸 수 있는지 (저장 단계에서 조용히 실패하지 않게) */
router.get('/conti/sheetsearch/check', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { await sheetSearch.imagesToPdf([await sheetSearch.fetchImage(String(req.query.url || '').trim())]); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: /JPG|PNG|이미지|주소|이동/.test(String(e.message)) ? e.message : '이 주소에서 이미지를 가져올 수 없어요 (JPG · PNG 만 가능)' }); }
});

/** 고른 이미지(들)를 받아 PDF 한 개로 묶어 악보로 저장 — 곡ID 가 있으면 그 곡 전용 */
router.post('/conti/sheets/fromweb', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  try {
    const f = await webSheetFile(b.url, b['제목']);
    if (f) { req.files = [f]; if (await saveSheetsFrom(req, team, scope, b['곡ID'], null, false)) liveNotify(team, scope, 'saveSheets'); }
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
      // 이 패키지에서 나눠 둔 예전 줄(원본 쪽 그대로 · 헤더 단 것 모두)을 지우고 새로 씀
      const olds = sheetRows.filter((r) => r['팀ID'] === team && inScope(r, scope) && r['곡ID'] && ids.has(r['곡ID'])
        && ((r['파일링크'] === link && String(r['쪽'] || '').trim()) || ((splitOrigin(r) || {}).link === link))).map((r) => r.__row);
      if (olds.length) await sheetsDb.deleteRows('악보저장소', olds);
      // 헤더 달기 — 곡마다 인쇄용 PDF 와 같은 머리말(번호 · 제목 – 원곡팀 · KEY · BPM · 송폼)을 단 PDF 를 새로 만들어 그 곡에 붙임
      const withHeader = b.header === '1' && plan.some((p) => p.spec);
      const pkgBuf = withHeader ? await fileBytes.get(link) : null;
      if (withHeader && !pkgBuf) console.error('[곡별로 나누기 — 원본을 받지 못해 헤더 없이 저장]', link);
      const base = Date.now().toString(36);
      let n = 0;
      for (const p of plan) {
        if (!p.spec) continue;
        const row = {
          'ID': 'F' + base + n++ + Math.random().toString(36).slice(2, 4), '팀ID': team, ...scopeFields(scope), '제목': String(pkg['제목'] || '악보'),
          '파일링크': link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(), '곡ID': p.song['ID'],
          'Key': String(p.song['Key'] || ''), 'BPM': String(p.song['BPM'] || ''), '인도자': '', '쪽수': pageSpec.specPages(p.spec).length, '메모': '', '저장소날짜': '', '쪽': p.spec,
        };
        if (pkgBuf) {
          try {
            const g = p.song;
            const info = sheetHeaders.songInfo(Array.from(songs.values()), g);
            const pdf = await pkgPdf.buildSongSheet(info, { buf: pkgBuf, spec: p.spec }, sheetSearch.imagesToPdf);
            if (pdf) {
              const title = String(g['제목'] || '').trim() || String(pkg['제목'] || '악보');
              const flink = await driveStore.uploadPublic('악보', { buffer: pdf, mimetype: 'application/pdf', originalname: title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60) + '.pdf', size: pdf.length });
              Object.assign(row, { '제목': title, '파일링크': flink, '쪽': '', '메모': sheetHeaders.encode({ src: link, spec: p.spec, crop: '', header: true, sig: sheetHeaders.sigOf(info) }) });
            }
          } catch (e) { console.error('[곡별로 나누기 — 헤더 달기 실패, 원본 쪽 그대로 저장]', p.song['제목'], e.message); }
        }
        await sheetsDb.appendRow('악보저장소', row);
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
      tellSong(req, team, scope, String(src['제목']).trim());
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
    if (n && withSheets) sheetHeaders.queue(team, scope, liveNotify);
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
/* v9.6 — 유튜브 송폼 태그 (팀 · 영상마다) — 이어 듣기 플레이어 아래 「송폼 구간」 (public/worship/ytform.js) */
router.get('/conti/ytform', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json({ ok: true, result: await ytForm.get(req.ctx.current, req.query.vid) }); } catch (e) { res.json({ ok: false, error: e.user ? e.message : '불러오지 못했어요.' }); }
});
router.post('/conti/ytform', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const b = req.body || {};
  try {
    if (guestAccess.isGuest(req.ctx.member)) throw Object.assign(new Error('객원 멤버는 송폼 태그를 저장할 수 없어요.'), { user: true });
    res.json({ ok: true, result: await ytForm.save(req.ctx.current, String(req.ctx.member['이름'] || '팀원'), b.vid, b.title, b.tags, b.baseAt) });
  } catch (e) { if (!e.user) console.error('[송폼 태그]', e); res.json({ ok: false, error: e.user ? e.message : '저장하지 못했어요.' }); }
});

router.get('/conti/youtube/info', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json((await youtube.info(req.query.url)) || {}); } catch (e) { res.json({}); }
});

/** 한 곡의 악보 순서 바꾸기 — 이웃한 두 악보의 줄 내용을 서로 맞바꿈 (악보 줄 번호가 곧 순서라서, 라이브 악보 · 인쇄용 PDF 도 같이 바뀜) */
router.post('/conti/sheets/move', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const scope = scopeFrom(b);
  try {
    const row = await sheetRowOf(req, team, b.__row);
    if (row && row['곡ID']) {
      const group = (await sheetsDb.readAll('악보저장소', { fresh: true })).filter((r) => r['팀ID'] === team && r['곡ID'] === row['곡ID'] && r['파일링크']).sort((x, y) => x.__row - y.__row);
      const i = group.findIndex((r) => r.__row === row.__row), j = i + (b.dir === 'up' ? -1 : 1);
      if (i >= 0 && group[j]) {
        const A = group[i], B = group[j];
        const strip = (r) => { const o = Object.assign({}, r); delete o.__row; return o; };
        await sheetsDb.updateRow('악보저장소', A.__row, strip(B));
        await sheetsDb.updateRow('악보저장소', B.__row, strip(A));
        liveNotify(team, scope, 'saveSheets');
        await sheetHeaders.settle(sheetHeaders.queue(team, scope, liveNotify), 8000);   // 맨 앞 악보가 바뀌었으면 정식 머리말도 새 맨 앞 악보로
      }
    }
  } catch (e) { console.error('[악보 순서 바꾸기 실패]', e.message); }
  backTo(req, res, team, scope);
});

router.post('/conti/sheets/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('악보저장소', row); liveNotify(String(b.team || '').trim(), scopeFrom(b), 'removeSheet'); } catch (e) { console.error('[악보 삭제 실패]', e.message); } }
  if (row && b.team) await sheetHeaders.settle(sheetHeaders.queue(String(b.team).trim(), scopeFrom(b), liveNotify), 8000);   // 맨 앞 악보를 지웠으면 다음 악보가 정식 머리말을 가짐
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
  const back = String(b.back || '');
  if (/^\/practice-conti\?[^\s]*$/.test(back)) return spa.redirect(req, res, back);      // 연습 콘티에서 올렸으면 그 화면으로
  backTo(req, res, team, scope);
});

/** 녹음 플레이어에서 찍은 곡 시작 위치 저장 — { team, id: 녹음.ID, marks: [{t, id, k}] } → JSON */
router.post('/conti/recordings/marks', requireTeam, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const b = req.body || {};
    const team = String(b.team || '').trim(), id = String(b.id || '').trim();
    if (!team || !req.ctx.teams.includes(team) || !id) return res.status(400).json({ ok: false, error: '녹음을 찾지 못했어요.' });
    const rows = await sheetsDb.readAll('녹음', { fresh: true });
    const row = rows.find((r) => r['팀ID'] === team && String(r['ID']) === id);
    if (!row) return res.status(404).json({ ok: false, error: '녹음을 찾지 못했어요. 새로고침해 주세요.' });
    const marks = cleanMarks(b.marks);
    const next = Object.assign({}, row); delete next.__row;
    next['구간'] = marks.length ? JSON.stringify(marks) : '';
    await sheetsDb.updateRow('녹음', row.__row, next);
    res.json({ ok: true, marks });
  } catch (e) {
    console.error('[녹음 구간 저장 실패]', e && e.message);
    res.status(500).json({ ok: false, error: '저장하지 못했어요. 잠시 뒤에 다시 시도해주세요.' });
  }
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
module.exports.shared = {
  loadWeek, songCard, packageSheetsCard, commentItem, practiceInfo, practiceCard, specialServices, specialServiceById, scopeFields, formChips,
  // 악보 올리기(파일 · 링크 · 웹에서 찾은 이미지 → PDF) — 관리자의 "폐회송 악보 올리기"(routes/admin.js)도 똑같이 씀
  webSheetFile, titleFromFile, titleFromLink,
  // 인쇄용 PDF 패키지 만들기 — 방송팀 보기 전용 화면(routes/guest.js)도 읽기 전용으로 똑같이 씀
  makePackage,
};
