/**
 * 콘티의 '녹음' 시트에서 NAS 영상 연결을 끊습니다 (그 줄을 지움). NAS 파일 자체는 건드리지 않아요.
 *   · 대상: 링크가 "nas:/…" 이고 확장자가 영상(mp4 · mov · mkv …)인 줄
 *   · NAS 음원(mp3 등) 연결과 유튜브 · 다른 링크는 그대로 둡니다 (--all 을 주면 NAS 음원 연결도 끊음)
 *
 *   먼저 목록만:  node --env-file=.env scripts/unlink-nas-videos.js
 *   진짜 지우기:  node --env-file=.env scripts/unlink-nas-videos.js --apply
 *
 * .env 에 DB_FOLDER_ID · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_REFRESH_TOKEN (Render 와 같은 값) 이 있어야 합니다. 시트만 건드려서 Render 에서 돌려도 대역폭은 안 씁니다.
 * 지운 줄은 되돌릴 수 없으니, 목록(--apply 없이)을 먼저 확인하고, 필요하면 구글 시트의 '녹음' 탭을 복사해 두세요.
 */
const sheetsDb = require('../lib/sheetsDb');
const nas = require('../lib/nas');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

(async () => {
  const rows = await sheetsDb.readAll('녹음', { fresh: true });
  const hit = rows.filter((r) => {
    const p = nas.pathOfLink(r['링크']);
    return p && (ALL || nas.kindOf(p) === 'video');
  });
  console.log(`'녹음' ${rows.length}줄 중 끊을 NAS ${ALL ? '녹음' : '영상'} 연결 ${hit.length}줄`);
  hit.forEach((r) => console.log(`  행 ${r.__row} · ${r['팀ID']} · ${r['날짜']}${r['행사ID'] ? ' (행사 ' + r['행사ID'] + ')' : ''} · ${r['구분']} · ${r['제목']} · ${nas.pathOfLink(r['링크'])}`));
  if (!hit.length) return;
  if (!APPLY) { console.log('\n목록만 보여 드렸어요. 정말 끊으려면 --apply 를 붙여 다시 실행하세요.'); return; }
  const n = await sheetsDb.deleteRows('녹음', hit.map((r) => r.__row));
  sheetsDb.invalidate && sheetsDb.invalidate('녹음');
  console.log(`\n${n == null ? hit.length : n}줄 지웠어요.`);
})().catch((e) => { console.error('실패:', e && e.message); process.exit(1); });
