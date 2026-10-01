#!/usr/bin/env node
/**
 * 청년부 앱(church-app · yntoronto.2026)의 "스케줄표" · "라이브러리" 화면을 이 앱으로 옮겨 오는 도구.
 * ------------------------------------------------------------
 *   node tools/port-church-hub.js [church-app 폴더]      (기본: ../yntoronto.2026)
 *
 * 손으로 다시 쓰지 않고, church-app 원본에서 그대로 뽑아 옵니다 — 원본이 바뀌면 이 도구를 다시 돌리면 됩니다.
 *   1) public/hub/yn.css        Worship.html <style> + Theme.html <style> 전부 + public/worship/hub.css 를 church-app 과 같은 순서로 이어 붙이고,
 *                               모든 규칙을 .yn 안으로 가둡니다 (body · :root → .yn). 그래서 이 앱의 다른 화면 · 맨 위 배너 · 메뉴에는 영향이 없습니다.
 *   2) public/hub/hubport.js    Worship.html · repo.js 에서 스케줄표 · 아카이브 · 통계 · 악보 Repository 함수들을 이름으로 골라 그대로 뽑고,
 *                               꼭 필요한 곳(연습일 표시 · 떠 있는 창을 .yn 안에 띄우기)만 PATCHES 로 고칩니다 (바꾼 곳은 모두 아래 목록에 있음).
 *   3) public/hub/{library,stats,icons,docview}.js · public/vendor/{html2canvas,xlsx.mini}.min.js — 그대로 (떠 있는 창 위치만 고침)
 * 이 앱에만 있는 부분(서버 호출 연결 · 화면 그리기 · 연습일 바꾸기 · 포지션 이름)은 public/hub/hubshim.js 에 있습니다 (손으로 쓴 파일).
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const postcss = require('postcss');

const SRC = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'yntoronto.2026'));
const OUT = path.join(__dirname, '..', 'public', 'hub');
const VENDOR = path.join(__dirname, '..', 'public', 'vendor');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/\r\n/g, '\n');
fs.mkdirSync(OUT, { recursive: true });

function blocks(html, tag) {
  const out = []; const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'); let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/* ================================================================ 1. CSS */
const worshipHtml = read('views/Worship.html');
const themeHtml = read('views/Theme.html');
const cssSrc = [
  '/* ===== views/Worship.html <style> ===== */\n' + blocks(worshipHtml, 'style')[0],
  '/* ===== views/Theme.html <style> ===== */\n' + blocks(themeHtml, 'style').join('\n'),
  '/* ===== public/worship/hub.css ===== */\n' + read('public/worship/hub.css'),
].join('\n');

const COMPOUND = /^((?:[a-zA-Z][\w-]*|\*)?(?:\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?|[.#][\w-]+)*)/;
/* 우선순위(specificity)를 church-app 과 똑같이 지키며 .yn 안으로 가둡니다:
 *   보통 선택자 X          → :where(.yn) X            (:where 는 우선순위 0 — 원래 X 그대로)
 *   body …                 → :where(.yn):not(html) …   (:not(html) = 태그 하나만큼 — 원래 body 와 같음)
 *   :root                  → :where(.yn):not(.yn-x)    (클래스 하나만큼 — 원래 :root 와 같음)
 *   html[data-theme=…] …   → html[…] 는 그대로 두고 그 아래만 위처럼
 * (church-app 에는 "body .panel" 이 ".panel" 을 이기는 곳이 있어서, 둘 다 같은 무게가 되면 어두운 화면 유리 카드가 사라집니다) */
const Y = ':where(.yn)', BODY = ':where(.yn):not(html)', ROOT = ':where(.yn):not(.yn-x)';
function bodyPart(rest) {                                      // body 다음에 붙은 .class · :pseudo 를 살리고, ::before 같은 건 맨 뒤로
  const m = rest.match(/^((?:\[[^\]]*\]|:(?!:)[\w-]+(?:\([^)]*\))?|[.#][\w-]+)*)/);
  return BODY.replace(':not(html)', m[1] + ':not(html)') + rest.slice(m[1].length);
}
function scopeSelector(sel) {
  sel = sel.trim();
  if (!sel) return sel;
  if (/^body::?(before|after)\b/.test(sel)) return null;                        // 토론토 지도 바탕 그림 — 이 앱 바탕을 씀
  if (sel === 'html') return BODY;
  if (sel.startsWith(':root')) return ROOT + sel.slice(5);
  if (/^html\b/.test(sel)) {
    const head = sel.match(COMPOUND)[1];                                         // html[data-theme="light"] · html[data-fs="1"]
    const rest = sel.slice(head.length);
    const mb = rest.match(/^(\s*>?\s*)body\b/);
    if (mb) return `${head} ` + bodyPart(rest.slice(mb[0].length));             // html[...] body .x → html[...] :where(.yn):not(html) .x
    if (!rest.trim()) return head === 'html' ? BODY : `${head} ${Y}`;            // html[data-theme="light"] { 변수 } → … :where(.yn)
    return `${head} ${Y}${rest}`;
  }
  if (/^body\b/.test(sel)) return bodyPart(sel.slice(4));                      // body.plr-on · body > .shell · body .panel
  return `${Y} ${sel}`;
}
const root = postcss.parse(cssSrc);
let nRules = 0, nDropped = 0;
root.walkRules((rule) => {
  let p = rule.parent; while (p && p.type !== 'root') { if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return; p = p.parent; }
  const sels = rule.selectors.map(scopeSelector).filter((s) => s !== null && !/:not\(html\)::?(before|after)$/.test(s));   // 지도 바탕(밝은 화면 포함)은 빼고
  if (!sels.length) { rule.remove(); nDropped++; return; }
  rule.selectors = sels; nRules++;
});
/* 색만 이 앱 것으로 — church-app 찬양 허브의 보라(#6C4FD3)를 이 앱의 주황으로 (모양 · 크기 · 배치는 그대로) */
const BRAND = [
  [/#6C4FD3/gi, '#E8703C'], [/108,\s*79,\s*211/g, '232, 112, 60'], [/#A78BFA/gi, '#FFB27A'], [/#F4F0FF/gi, '#FFF1E6'],
  // 어두운 화면의 연보라(고른 곡 테두리 · 강조) → 이 앱 어두운 화면 주황
  [/#8E73F2/gi, '#FF8A3D'], [/142,\s*115,\s*242/g, '255, 138, 61'],
  // 밝은 화면의 청록(church-app v6.1 밝은 화면 메인 색) → 이 앱 밝은 화면 주황 · 글씨용 진한 주황 · 색 칸 위 흰 글씨
  [/#46BDC6/gi, '#E8703C'], [/70,\s*189,\s*198/g, '232, 112, 60'], [/#2FA3AD/gi, '#D9622F'], [/47,\s*163,\s*173/g, '217, 98, 47'],
  [/#0B6E77/gi, '#B24A1C'], [/11,\s*110,\s*119/g, '178, 74, 28'], [/#06363B/gi, '#FFFFFF'], [/#05353A/gi, '#FFFFFF'],
  // 밝은 화면의 옅은 청록 바탕 (키 칩 · 곡 줄 hover · 열린 곡) → 옅은 주황
  [/#CCF1F4/gi, '#FFE4D2'], [/#064E55/gi, '#8A3A12'], [/#ECFEFF/gi, '#FFF4EC'], [/#F3FCFD/gi, '#FFFAF6'], [/#E7F6F8/gi, '#FFEFE3'],
  [/#EDFAFB/gi, '#FFF6EF'], [/#DDF3F6/gi, '#FFE7D6'], [/#D9F1F4/gi, '#FFE2CE'],
];
let css = root.toString();
BRAND.forEach(([re, to]) => { css = css.replace(re, to); });
fs.writeFileSync(path.join(OUT, 'yn.css'),
  '/* 자동 생성 — tools/port-church-hub.js (church-app views/Worship.html · views/Theme.html · public/worship/hub.css 를 .yn 안으로,\n' +
  '   보라 → 이 앱 주황). 직접 고치지 마세요 — 이 앱에서 덧붙이는 규칙은 public/hub/yn-adapt.css */\n' + css + '\n');
console.log(`yn.css — 규칙 ${nRules}개 (.yn 안으로), 뺀 규칙 ${nDropped}개`);

/* ================================================================ 2. JS — 이름으로 뽑기 */
function pick(code, names, label) {
  const ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: 'script' });
  const found = new Map();
  ast.body.forEach((n) => {
    if (n.type === 'FunctionDeclaration' && names.includes(n.id.name)) found.set(n.id.name, code.slice(n.start, n.end));
    if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => { if (names.includes(d.id.name)) found.set(d.id.name, code.slice(n.start, n.end)); });
  });
  const missing = names.filter((x) => !found.has(x));
  if (missing.length) throw new Error(`${label} 에서 못 찾음: ${missing.join(', ')}`);
  return Array.from(new Set(names.map((x) => found.get(x)))).join('\n\n');
}

const WORSHIP_NAMES = [
  // 작은 도구
  'WD', 'el', 'esc', 'jsq', 'hubDoc', 'docBtn', 'say', 'fail', 'val', 'isEv', 'ICON', 'ico',
  'dt', 'fmtDate', 'fmtDay', 'fmtRange', 'shortAt', 'md', 'offMap', 'FACE', 'face', 'shortName', 'known',
  // 사람 고르기 (스케줄표 칸 · 객원 찾기)
  'pickGroups', 'GS_TIMER', 'GS_SEQ', 'guestBox', 'gsPicked', 'gsInput', 'gsFace', 'gsDraw', 'nextPick', 'ytId',
  // 녹음 카드
  'REC_ICO', 'recCard',
  // 스케줄표
  'ST', 'ST_RANGES', 'stGroups', 'loadSched', 'stRange', 'stRow', 'stSync', 'stTitle', 'schedTab', 'stCards', 'stDay', 'stCell',
  'drawStPicker', 'stToggle', 'stPickDay', 'offOne', 'saveOff', 'markOff', 'clearOff', 'patchOff',
  // 콘티 통계
  'SS', 'loadStats', 'songNorm', 'lev1', 'statPrep', 'lineup', 'cutoff', 'statItems', 'bump', 'sortN', 'statsTab', 'statRedraw',
  'tile', 'seg', 'bars', 'topSongs', 'statView', 'statOpen', 'rangeLabel', 'songSheet',
  // 아카이브 (날짜별 · 악보 파일 · 녹음)
  'AR', 'AR_RANGES', 'arCut', 'arNext', 'arInRange', 'loadArchive', 'archiveTab', 'needScript', 'arExport', 'arRedraw', 'arDays',
  'arTitle', 'fileChip', 'arBody', 'arCard', 'arSongs', 'arRecs', 'arFiles',
];
const REPO_NAMES = ['RP', 'rpAdd', 'rpNl', 'rpDay', 'loadRepo', 'rpSongs', 'rpOpts', 'rpFilterCount', 'repoTab', 'rpRedraw', 'rpSortPaint', 'rpDock', 'rpList', 'rpCard',
  'rpDetail', 'rpId', 'rpSong', 'rpToggle', 'rpPick', 'rpEditSong', 'rpEditSheet', 'rpSongSave', 'rpSheetSave', 'rpUse', 'rpUpForm', 'rpUpload'];

const worshipScript = blocks(worshipHtml, 'script').filter((b) => b.indexOf('var TABS') !== -1)[0];
let js = '/* ===== views/Worship.html ===== */\n' + pick(worshipScript, WORSHIP_NAMES, 'Worship.html') +
  '\n\n/* ===== public/worship/repo.js (악보 Repository) ===== */\n' + pick(read('public/worship/repo.js'), REPO_NAMES, 'repo.js');

/** 이 앱에 맞춘 곳 — [설명, 찾을 글, 바꿀 글]. 찾을 글은 정확히 한 번 나와야 합니다 (원본이 바뀌면 여기서 멈춤) */
const PATCHES = [
  ['스케줄표 카드 머리 — 토요일 대신 연습일(보통 주일 전 금요일 · 눌러서 바꾸기)',
    `: '<span class="sat">' + satOf(r.date) + '(토) –</span><b>' + md(r.date) + '</b><span class="wd">(주일)</span>')`,
    `: stPracHtml(r) + '<b>' + md(r.date) + '</b><span class="wd">(주일)</span>')`],
  ['스케줄표 테이블 날짜 칸 — 토요일 대신 연습일',
    `'<span class="sd">토 ' + satOf(r.date) + '</span><b>일 ' + md(r.date) + '</b>'`,
    `stPracShort(r) + '<b>일 ' + md(r.date) + '</b>'`],
  ['날짜 자세히 — 연습일 바꾸기 칸', `lines +\n    (D.who`, `lines + stPracBox(r) +\n    (D.who`],
  ['객원 찾기 — 이 앱은 교적 대신 다른 찬양팀 회원 · 명단에서 찾음 (lib/hubApi.js worshipGuestSearch)', '객원 · 교적에서 찾기', '객원 · 다른 팀에서 찾기'],
  ['객원 찾기 결과 없음 — 위와 같음', '교적에 일치하는 분이 없습니다.', '다른 팀에도 일치하는 분이 없습니다.'],
  ['객원 직접 입력 — 위와 같음', '<span class="gsnote">교적에 없는 분</span>', '<span class="gsnote">명단에 없는 분</span>'],
  ['악보 칩 PDF/IMG — 이 앱 악보는 이름에 확장자가 없어 서버가 알려준 종류로', 'var pdf = /\\.pdf$/i.test(f.name);', 'var pdf = f.pdf != null ? !!f.pdf : /\\.pdf$/i.test(f.name);'],
  ['악보 파일 목록 PDF/IMG — 위와 같음', 'var pdf = /\\.pdf$/i.test(r.f.name);', 'var pdf = r.f.pdf != null ? !!r.f.pdf : /\\.pdf$/i.test(r.f.name);'],
];
PATCHES.forEach(([why, from, to]) => {
  const n = js.split(from).length - 1;
  if (n !== 1) throw new Error(`PATCH "${why}" — 찾을 글이 ${n}번 나옴`);
  js = js.replace(from, () => to);
});
fs.writeFileSync(path.join(OUT, 'hubport.js'),
  '/* 자동 생성 — tools/port-church-hub.js. church-app 원본 함수 그대로 (바꾼 곳은 그 도구의 PATCHES). 직접 고치지 마세요.\n' +
  ' * 이 앱 쪽 연결은 public/hub/hubshim.js 에 있습니다. */\n' + js + '\n');
console.log(`hubport.js — 함수 · 변수 ${WORSHIP_NAMES.length + REPO_NAMES.length}개, 고친 곳 ${PATCHES.length}곳`);

/* ================================================================ 3. 그대로 가져오는 파일 (떠 있는 창만 .yn 안에) */
function copyPatched(rel, out, patches) {
  let s = read(rel);
  (patches || []).forEach(([from, to]) => {
    const n = s.split(from).length - 1;
    if (n < 1) throw new Error(`${rel}: "${from}" 를 못 찾음`);
    s = s.split(from).join(to);
  });
  fs.writeFileSync(out, `/* church-app ${rel} 그대로${patches && patches.length ? ' (떠 있는 창을 .yn 안에 띄우도록 ' + patches.length + '곳만 고침 — tools/port-church-hub.js)' : ''} */\n` + s);
}
copyPatched('public/worship/library.js', path.join(OUT, 'library.js'), [
  ['document.body.appendChild(dock);', 'ynPortal().appendChild(dock);'],
  ["document.body.classList.add('plr-on');", "ynRoot().classList.add('plr-on');"],
  ["document.body.classList.remove('plr-on');", "ynRoot().classList.remove('plr-on');"],
]);
copyPatched('public/worship/stats.js', path.join(OUT, 'stats.js'), [['doc.body.appendChild(ov);', 'ynPortal().appendChild(ov);']]);
copyPatched('public/worship/icons.js', path.join(OUT, 'icons.js'));
copyPatched('public/budget/docview.js', path.join(OUT, 'docview.js'));
/* 가독성 지킴이 — church-app views/Theme.html 의 YNContrast (어두운 유리 위 어두운 글씨처럼 안 보이는 글씨를 스스로 고침).
   church-app 은 화면 전체를 보지만 여기서는 .yn 안쪽만 봅니다 (이 앱 배너 · 메뉴는 손대지 않음) */
{
  let c = blocks(themeHtml, 'script').filter((b) => b.indexOf('window.YNContrast = {') !== -1);
  if (c.length !== 1) throw new Error('Theme.html 가독성 지킴이 스크립트를 못 찾음 (' + c.length + ')');
  c = c[0];
  [
    ['바탕색 — 이 앱 바탕 (--bg)', "? [243, 244, 246] : [25, 25, 25];", "? [251, 246, 238] : [17, 19, 26];"],
    ['.yn 바깥은 보지 않음', "return !!(el && el.closest && el.closest(안봄));", "return !!(el && el.closest && (el.closest(안봄) || !el.closest('.yn')));"],
    ['훑을 칸 — .yn 안쪽만', "function 훑기() {", "function ynCells() {\n    var a = [];\n    Array.prototype.forEach.call(document.querySelectorAll('.yn'), function (r) { if (!r.parentElement || !r.parentElement.closest('.yn')) a = a.concat(칸들(r)); });\n    return a;\n  }\n  function 훑기() {"],
    ['전체 훑기 (조금씩)', "일 = 칸들(document.body);", "일 = ynCells();"],
    ['전체 훑기 (한 번에)', "var 칸 = 칸들(document.body);", "var 칸 = ynCells();"],
  ].forEach(([why, from, to]) => {
    const n = c.split(from).length - 1;
    if (n !== 1) throw new Error(`가독성 지킴이 "${why}" — 찾을 글이 ${n}번 나옴`);
    c = c.replace(from, () => to);
  });
  fs.writeFileSync(path.join(OUT, 'contrast.js'), '/* church-app views/Theme.html 가독성 지킴이 그대로 (.yn 안쪽만 보도록 5곳 고침 — tools/port-church-hub.js). 직접 고치지 마세요. */\n' + c.trim() + '\n');
}
fs.mkdirSync(VENDOR, { recursive: true });
['html2canvas.min.js', 'xlsx.mini.min.js', 'jspdf.umd.min.js'].forEach((f) => fs.copyFileSync(path.join(SRC, 'public', 'vendor', f), path.join(VENDOR, f)));
console.log('library.js · stats.js · icons.js · docview.js · vendor 복사 끝');
