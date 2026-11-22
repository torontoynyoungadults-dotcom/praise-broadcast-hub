/**
 * 곡 들어보기 기록 — 홈 "다음 섬김" 카드의 "곡 들어보기 3/4" 체크가 실제로 채워지게.
 * 예배콘티의 "유튜브 이어 듣기" 플레이어에서 한 곡을 45초 넘게 듣거나 끝까지 들으면 그 영상을 "들음"으로 적고,
 * "유튜브에서 한 번에 열기"(유튜브 앱으로 재생목록 열기)를 누르면 그 재생목록의 곡을 모두 "들음"으로 적습니다.
 * '곡듣기' 탭 — 사람 · 영상마다 한 줄(마지막으로 들은 시각만 고침). 같은 영상을 다른 주 콘티에 다시 넣어도 그대로 이어짐.
 */
const sheetsDb = require('./sheetsDb');

const VID = /^[A-Za-z0-9_-]{11}$/;
const FRESH_DAYS = 45;                     // 이보다 오래전에 들은 것은 "다시 들어 보기" 로 봄
let chain = Promise.resolve();             // 같은 사람이 여러 번 눌러도 줄이 겹치지 않게 한 줄로 처리
const serial = (fn) => (chain = chain.then(fn, fn));

/** 들었다고 적기 — vids: 영상 ID 배열 */
function mark(team, name, vids) {
  team = String(team || '').trim(); name = String(name || '').trim();
  const list = Array.from(new Set((Array.isArray(vids) ? vids : [vids]).map((v) => String(v || '').trim()).filter((v) => VID.test(v)))).slice(0, 50);
  if (!team || !name || !list.length) return Promise.resolve(0);
  return serial(async () => {
    const rows = (await sheetsDb.readAll('곡듣기', { fresh: true })).filter((r) => r['팀ID'] === team && String(r['이름'] || '').trim() === name);
    const now = new Date().toISOString(), adds = [];
    for (const v of list) {
      const r = rows.find((x) => x['영상ID'] === v);
      if (r) await sheetsDb.updateCells('곡듣기', [{ row: r.__row, header: '시각', value: now }]);
      else adds.push({ '팀ID': team, '이름': name, '영상ID': v, '시각': now });
    }
    if (adds.length) await sheetsDb.appendRows('곡듣기', adds);
    sheetsDb.invalidate('곡듣기');
    return list.length;
  });
}

/** 이 사람이 최근(45일 안)에 들은 영상 ID 모음 */
async function heard(team, name, today) {
  const since = new Date(new Date(String(today || '') + 'T12:00:00').getTime() - FRESH_DAYS * 864e5);
  const ok = isNaN(since) ? '' : since.toISOString();
  const rows = await sheetsDb.readAll('곡듣기');
  return new Set(rows.filter((r) => r['팀ID'] === team && String(r['이름'] || '').trim() === name && String(r['시각'] || '') >= ok).map((r) => String(r['영상ID'])));
}

module.exports = { mark, heard };
