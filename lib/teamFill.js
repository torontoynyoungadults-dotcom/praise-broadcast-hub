/**
 * 원곡 팀 자동 채우기 — 콘티의 유튜브 링크에서 영상 채널 · 제목(oEmbed)을 읽어 '팀' 칸이 빈 곡에 원곡 팀을 채웁니다.
 *  · 이미 팀이 적힌 곡은 건드리지 않습니다 (직접 쓴 것이 우선).
 *  · 알아보지 못한 채널은 비워 두고 결과에 채널 이름을 보여줍니다 → 아래 RULES 에 한 줄 더하면 다음부터 채워져요.
 */
const sheetsDb = require('./sheetsDb');
const youtube = require('./youtube');

// [팀 이름, 채널·제목에서 찾을 말]  — 위에 있는 것이 먼저
const RULES = [
  ['마커스', /마커스|marcus|markers?\s*worship|markus/i],
  ['피아워십', /피아\s*워십|피아\s*worship|pia\s*worship|piaworship|피아 ?(?:워십|예배)/i],
  ['어노인팅', /어노인팅|anointing/i],
  ['Welove', /we\s*love|welove|위러브|위 러브/i],
  ['예닮워십', /예닮/],
  ['제이어스', /제이어스|j-?us\b/i],
  ['아이자야 식스티원', /isaiah\s*6\s*1|아이자야\s*(?:식스티원|61)/i],
  ['소리엘', /소리엘|sorie?l/i],
  ['힐송', /hillsong/i],
  ['베델', /bethel/i],
  ['엘리베이션 워십', /elevation\s*worship/i],
  ['게이트웨이 워십', /gateway\s*worship/i],
  ['메이버릭 시티', /maverick\s*city/i],
  ['찬송가', /찬\s*\d{1,3}\s*장|찬송가|새찬송가|hymn/i],
];
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function teamOf(channel, title) {
  const hay = clean(channel) + ' | ' + clean(title);
  for (const [name, re] of RULES) if (re.test(hay)) return name;
  return '';
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/** 한 번에 최대 MAX 개 영상까지 (너무 오래 걸리지 않게 — 남은 것은 한 번 더 누르면 이어서) */
const MAX = 120;

async function run(team, { dryRun } = {}) {
  const rows = (await sheetsDb.readAll('찬양콘티', { fresh: true })).filter((r) => r['팀ID'] === team);
  const need = rows.filter((r) => !String(r['팀'] || '').trim() && youtube.idOf(r['유튜브']));
  const ids = Array.from(new Set(need.map((r) => youtube.idOf(r['유튜브'])))).slice(0, MAX);
  const infos = {};
  await pool(ids, 6, async (id) => { infos[id] = await youtube.info('https://youtu.be/' + id); });
  const cells = [], unknown = new Map(); let failed = 0, matched = 0;
  const byTeam = {};
  need.forEach((r) => {
    const id = youtube.idOf(r['유튜브']);
    if (!(id in infos)) return;                                  // 이번 회차 범위 밖
    const inf = infos[id];
    if (!inf) { failed++; return; }
    const t = teamOf(inf.channel, inf.title);
    if (!t) { const e = unknown.get(inf.channel) || { channel: inf.channel, n: 0, sample: String(r['제목'] || '') }; e.n++; unknown.set(inf.channel, e); return; }
    cells.push({ row: r.__row, header: '팀', value: t });
    byTeam[t] = (byTeam[t] || 0) + 1; matched++;
  });
  if (!dryRun && cells.length) await sheetsDb.updateCells('찬양콘티', cells);
  return { total: need.length, checked: ids.length, matched, failed, byTeam, unknown: Array.from(unknown.values()).sort((a, b) => b.n - a.n), more: Math.max(0, new Set(need.map((r) => youtube.idOf(r['유튜브']))).size - ids.length) };
}

module.exports = { run, teamOf, RULES };
