/**
 * R2 연결 확인 + 버킷 CORS 설정 (한 번만).
 *
 *   node --env-file=.env scripts/r2-setup.js            # BASE_URL 주소를 허용 주소로 CORS 설정
 *   node --env-file=.env scripts/r2-setup.js https://praise.example.com http://localhost:3000   # 허용 주소를 직접 지정
 *
 * .env (또는 터미널 환경변수)에 R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · BASE_URL 이 있어야 합니다.
 * CORS 는 R2_DIRECT=1 (브라우저가 악보를 R2 에서 바로 받기)을 켜기 전에 꼭 필요합니다 — 없으면 악보가 안 열립니다.
 * R2 API 토큰에 "버킷 설정 변경" 권한이 없으면 CORS 단계가 실패합니다 — 그때는 Cloudflare 화면(R2 → 버킷 → Settings → CORS policy)에 같은 내용을 붙여 넣으세요.
 */
const r2 = require('../lib/r2');

(async () => {
  if (!r2.enabled()) { console.error('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET 환경변수를 먼저 넣어 주세요.'); process.exit(1); }

  const id = 'r2setuptest' + Date.now().toString(36);
  await r2.put(id, Buffer.from('ok'), 'text/plain');
  const meta = await r2.head(id);
  await r2.remove(id);
  if (!meta) { console.error('R2 에 올린 시험 파일을 다시 찾지 못했어요. 버킷 이름 · 토큰 권한을 확인해 주세요.'); process.exit(1); }
  console.log('✔ R2 읽기 · 쓰기 확인 (시험 파일은 지웠어요)');

  const origins = process.argv.slice(2).length ? process.argv.slice(2) : [String(process.env.BASE_URL || '').trim().replace(/\/+$/, '')].filter(Boolean);
  if (!origins.length) { console.error('허용할 주소가 없어요 — BASE_URL 을 넣거나 주소를 인자로 주세요.'); process.exit(1); }
  try {
    await r2.setCors(origins);
    console.log('✔ CORS 설정 완료 — 허용 주소:', origins.join(', '));
  } catch (e) {
    console.error('✖ CORS 설정 실패:', e && e.message);
    console.error('  Cloudflare 화면에서 직접 넣을 내용:\n' + JSON.stringify([{ AllowedOrigins: origins, AllowedMethods: ['GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type', 'ETag'], MaxAgeSeconds: 86400 }], null, 2));
    process.exit(1);
  }
})().catch((e) => { console.error('실패:', e && e.message); process.exit(1); });
