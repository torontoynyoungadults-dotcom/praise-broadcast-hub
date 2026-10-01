/**
 * 스케줄표·주일편성의 "+ 이름" 자유 입력칸을 "팀원 목록 중에서 고르기"로 바꾸는 공용 부품.
 * - 그 포지션에 어울리는 역할(lib/positions.js POSITION_ROLE_HINT)인 사람을 먼저 보여줌
 * - 그 외 팀원도 아래에서 고를 수 있음
 * - 명단에 없는 객원은 옆 칸에 이름을 직접 입력 가능(직접 입력이 있으면 그걸 우선함)
 */
const { POSITION_ROLE_HINT } = require('./positions');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/** roster: [{이름, 역할}] — 역할이 맞는 사람(matched)과 그 외(rest)로 나눠 각각 가나다순 정렬 */
function sortedRoster(roster, posKey) {
  const wantRoles = POSITION_ROLE_HINT[posKey] || [];
  const matched = [];
  const rest = [];
  (roster || []).forEach((p) => {
    const roles = String(p.역할 || '').split(',').map((s) => s.trim()).filter(Boolean);
    const isMatch = wantRoles.length > 0 && roles.some((r) => wantRoles.includes(r));
    (isMatch ? matched : rest).push(p);
  });
  const byName = (a, b) => String(a.이름).localeCompare(String(b.이름), 'ko');
  matched.sort(byName);
  rest.sort(byName);
  return { matched, rest, wantRoles };
}

/** <select>(역할 우선 정렬) + 직접 입력(객원) input을 함께 그려주는 폼 조각 */
function pickerFields(roster, posKey) {
  const { matched, rest, wantRoles } = sortedRoster(roster, posKey);
  const opt = (p) => `<option value="${esc(p.이름)}">${esc(p.이름)}</option>`;
  const matchedGroup = matched.length ? `<optgroup label="추천 (${esc(wantRoles.join('·'))})">${matched.map(opt).join('')}</optgroup>` : '';
  const restGroup = rest.length ? `<optgroup label="${matched.length ? '그 외 팀원' : '팀원'}">${rest.map(opt).join('')}</optgroup>` : '';
  if (!matched.length && !rest.length) {
    return `<input type="text" name="이름_custom" class="ph-posselect-custom" placeholder="이름 입력 (아직 등록된 팀원이 없어요)" maxlength="20">`;
  }
  return `<select name="이름_select" class="ph-posselect"><option value="">팀원 선택…</option>${matchedGroup}${restGroup}</select>
    <input type="text" name="이름_custom" class="ph-posselect-custom" placeholder="또는 객원 이름 직접 입력" maxlength="20">`;
}

/** POST 바디에서 최종 이름을 뽑아냄 — 직접 입력이 있으면 그게 우선(객원), 없으면 고른 팀원 */
function resolveName(body) {
  const b = body || {};
  const custom = String(b['이름_custom'] || '').trim();
  if (custom) return custom;
  return String(b['이름_select'] || '').trim();
}

module.exports = { pickerFields, resolveName, sortedRoster };
