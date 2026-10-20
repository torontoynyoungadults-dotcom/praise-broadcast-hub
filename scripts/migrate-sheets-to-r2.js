/**
 * 예전 악보(구글 드라이브) → R2 로 복사. 시트의 링크 · 파일 ID · 필기는 하나도 바꾸지 않습니다.
 *   서버는 악보를 열 때 R2 에 `sheets/<드라이브 파일ID>` 가 있으면 R2 에서, 없으면 예전처럼 드라이브에서 가져옵니다.
 *   그래서 이 복사는 몇 번을 다시 돌려도 안전하고(이미 옮긴 건 건너뜀), 드라이브 원본은 그대로 남습니다.
 *
 * ⚠ Render 가 아니라 **내 컴퓨터**에서 돌리세요. Render 에서 돌리면 R2 로 올리는 트래픽이 Render 대역폭으로 한꺼번에 잡힙니다.
 *
 *   1) 이 레포 폴더에서 npm install
 *   2) .env 에 Render 와 같은 값 넣기: DB_FOLDER_ID · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_REFRESH_TOKEN
 *      · R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET
 *   3) 먼저 확인만:  node --env-file=.env scripts/migrate-sheets-to-r2.js --dry-run
 *      그다음 진짜:  node --env-file=.env scripts/migrate-sheets-to-r2.js
 *   옵션: --limit=5 (앞의 5개만 시험) · --concurrency=3 (동시에 받는 개수, 기본 3)
 *
 * 옮기는 곳: 악보저장소.파일링크 · 개인악보.파일링크 · 악보보정.원래링크 (되돌리기용 원본) → 버킷의 sheets/<ID>
 *             녹음.링크 (드라이브에 올린 녹음. NAS · 유튜브 링크는 해당 없음) → 버킷의 audio/<ID>
 */
const sheetsDb = require('../lib/sheetsDb');
const liveStore = require('../lib/liveStore');
const r2 = require('../lib/r2');
const { serviceAuth } = require('../lib/googleAuth');

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.split('=')[1] : def; };
const DRY = process.argv.includes('--dry-run');
const LIMIT = Number(arg('limit', 0)) || 0;
const CONC = Math.max(1, Math.min(6, Number(arg('concurrency', 3)) || 3));
const SOURCES = [['악보저장소', '파일링크', 'sheets'], ['개인악보', '파일링크', 'sheets'], ['악보보정', '원래링크', 'sheets'], ['녹음', '링크', 'audio']];

const mb = (n) => (n / 1048576).toFixed(1) + 'MB';

async function download(id) {
  const { token } = await serviceAuth().getAccessToken();
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('드라이브 응답 ' + r.status);
  const type = String(r.headers.get('content-type') || 'application/octet-stream');
  if (/^text\/html/i.test(type)) throw new Error('드라이브가 파일 대신 웹페이지를 보냄');
  return { buf: Buffer.from(await r.arrayBuffer()), type };
}

(async () => {
  if (!r2.enabled()) { console.error('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET 환경변수가 필요해요.'); process.exit(1); }

  const ids = new Map();                                   // 'kind:드라이브 파일ID' → { id, kind, label }
  for (const [tab, col, kind] of SOURCES) {
    let rows = [];
    try { rows = await sheetsDb.readAll(tab, { fresh: true }); } catch (e) { console.error(`[${tab}] 읽기 실패 — 건너뜀:`, e.message); continue; }
    rows.forEach((r) => { const id = liveStore.driveIdOf(r[col]); if (id && !ids.has(kind + ':' + id)) ids.set(kind + ':' + id, { id, kind, label: tab + ' ' + (r['제목'] || r['ID'] || '') }); });
  }
  let todo = Array.from(ids.values());
  console.log(`드라이브 악보 파일 ${todo.length}개 발견`);

  const missing = [];
  for (const t of todo) { if (!(await r2.head(t.id, t.kind))) missing.push(t); }
  console.log(`이미 R2 에 있음 ${todo.length - missing.length}개 · 옮길 것 ${missing.length}개`);
  todo = LIMIT ? missing.slice(0, LIMIT) : missing;
  if (DRY) { todo.forEach((t) => console.log('  (옮길 예정)', t.kind, t.id, '←', t.label)); console.log('확인만 했어요 (--dry-run). 실제로 옮기려면 --dry-run 을 빼고 다시 실행하세요.'); return; }

  let ok = 0, bytes = 0; const failed = []; let i = 0;
  const lane = async () => {
    while (i < todo.length) {
      const { id, kind, label } = todo[i++], n = i;
      try {
        const { buf, type } = await download(id);
        await r2.put(id, buf, type, kind);
        if (!(await verify(id, kind, buf.length))) throw new Error('올린 뒤 크기가 맞지 않음');
        ok++; bytes += buf.length;
        console.log(`[${n}/${todo.length}] ✔ ${label} (${mb(buf.length)})`);
      } catch (e) { failed.push({ id, kind, label, why: e.message }); console.error(`[${n}/${todo.length}] ✖ ${label} — ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: CONC }, lane));
  console.log(`\n끝 — 성공 ${ok}개 (${mb(bytes)}) · 실패 ${failed.length}개`);
  if (failed.length) { console.log('실패한 것은 같은 명령을 다시 실행하면 이어서 시도해요:'); failed.forEach((f) => console.log('  ', f.kind, f.id, f.label, '—', f.why)); process.exitCode = 2; }
})().catch((e) => { console.error('실패:', e && e.message); process.exit(1); });

/** 올린 파일이 R2 에서 같은 크기로 읽히는지 (head 의 기억을 거치지 않고 바로 확인) */
async function verify(id, kind, size) {
  const got = await r2.getBuffer(id, kind);
  return !!got && got.buf.length === size;
}
