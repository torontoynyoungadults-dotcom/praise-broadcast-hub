/**
 * 팀원 아바타(사진 또는 이니셜) + 성별 아이콘 — 주일 편성 · 팀원관리 화면이 함께 씁니다.
 * "이 이름이 지금 누구인지"는 회원(실제 가입자, 사진 우선)과 팀원명단(관리자가 미리 등록, 아직 미가입이어도
 * 사진/성별을 보여줄 수 있게) 두 시트를 이름 기준으로 합쳐서 판단합니다.
 */
const sheetsDb = require('./sheetsDb');
const photo = require('./photo');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  // 사진이 없을 때 원 안에 보여줄 글자 — 성(姓), 즉 이름 맨 앞글자를 보여줌
  return /^[가-힣]+$/.test(s) ? s.slice(0, 1) : s.slice(0, 2).toUpperCase();
}

/**
 * 스케줄표·주일편성처럼 자리가 좁은 화면에서 "성을 뺀 이름"만 보여줄 때 씀(공간 절약).
 * 원 아바타의 성 글자와 중복되지 않게, 2글자 이상 한글 이름은 맨 앞(성) 한 글자만 뗌.
 */
function givenName(name) {
  const s = String(name || '').trim();
  return /^[가-힣]{2,}$/.test(s) ? s.slice(1) : s;
}

/** 성별 배지 — 이모티콘(👨 👩) 대신 작은 글자 "남" · "여" (아바타 모서리) */
function genderIcon(gender) {
  if (gender === '남' || gender === '여') return gender;
  return '';
}

// 역할(lib/schema.js의 ROLE_OPTIONS) 앞에 붙이는 작은 아이콘 — 직접 그린 선 아이콘(lib/uiIcons.js). 주일편성 포지션 아이콘과는 다른 체계라 따로 둠.
const ui = require('./uiIcons');
function roleIcon(role) { return ui.roleIcon(role); }
function roleBadgesHtml(rolesCsv) {
  const roles = String(rolesCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!roles.length) return '';
  return `<span class="ph-roletags">${roles.map((r) => `<span class="ph-roletag">${roleIcon(r)} ${esc(r)}</span>`).join('')}</span>`;
}

/**
 * 팀의 "이름 → {사진, 성별, 역할, 가입여부, 가입행, 명단행}" 맵.
 * 회원(가입자) 정보가 있으면 사진·성별·역할이 그게 우선, 없으면 팀원명단(사전 등록) 정보로 채움.
 * 가입행/명단행은 각 시트에서의 실제 행 번호 — 팀원관리 화면에서 관리자가 바로 수정할 때 씀.
 * @param {string} team
 */
async function teamInfoMap(team) {
  const [members, roster] = await Promise.all([sheetsDb.readAll('회원'), sheetsDb.readAll('팀원명단')]);
  const map = {};
  roster.filter((r) => r['팀ID'] === team && r['이름']).forEach((r) => {
    map[r['이름']] = { 사진: r['사진'] || '', 성별: r['성별'] || '', 역할: r['역할'] || '', 가입: false, 명단행: r.__row };
  });
  members.filter((m) => String(m['소속팀'] || '').split(',').map((s) => s.trim()).includes(team) && m['이름']).forEach((m) => {
    const prev = map[m['이름']] || {};
    map[m['이름']] = {
      사진: m['프로필사진'] || prev.사진 || '', 성별: m['성별'] || prev.성별 || '',
      역할: m['역할'] || prev.역할 || '', 가입: true, 명단행: prev.명단행, 가입행: m.__row,
    };
  });
  return map;
}

/**
 * 원형 아바타(사진 또는 이니셜) + 성별 아이콘 배지. size: 'sm'(명단 칩 안) | 'md'(목록) | 'lg'(팀원관리 카드)
 */
function avatarHtml(name, info, size) {
  const sz = size || 'md';
  const info2 = info || {};
  // 사진이 안 열리면(<img> 실패) 첫 글자가 보이도록 글자를 깔아 두고 그 위에 사진을 얹음
  const ini = `<span class="ph-avatar-txt">${esc(initials(name))}</span>`;
  const inner = info2.사진
    ? `${ini}<img class="ph-avatar-img" src="${esc(photo.src(info2.사진))}" alt="" loading="lazy" onerror="this.remove()">`
    : ini;
  const badge = genderIcon(info2.성별) ? `<span class="ph-avatar-badge ph-g-${info2.성별 === '남' ? 'm' : 'f'}">${genderIcon(info2.성별)}</span>` : '';
  return `<span class="ph-avatar ph-avatar-${sz}">${inner}${badge}</span>`;
}

module.exports = { teamInfoMap, avatarHtml, initials, givenName, genderIcon, roleIcon, roleBadgesHtml };
