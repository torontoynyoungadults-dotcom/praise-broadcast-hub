/** V865 — 화음 팀 공유 (worshipHarmLoad / worshipHarmSave) — 시트 없이 메모리로 시험  ·  node scripts/test-harm-share.js */
const sheetsDb = require('../lib/sheetsDb');
const rows = { 찬양주석: [], 악보필기: [], 악보저장소: [] };
sheetsDb.readAll = async (t) => (rows[t] || []).map((r, i) => Object.assign({ __row: i + 2 }, r));
sheetsDb.appendRow = async (t, r) => { (rows[t] = rows[t] || []).push(r); };
sheetsDb.updateRow = async (t, n, r) => { rows[t][n - 2] = r; };
const live = require('../routes/live');
const F = live.FNS;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
(async () => {
  const lead = { team: 'T1', name: '리더', canEdit: true }, mem = { team: 'T1', name: '팀원', canEdit: false }, other = { team: 'T2', name: '남', canEdit: true };
  const FILE = 'fileAbc1234567';
  let r = await F.worshipHarmLoad(mem, FILE);
  ok(r.data === null && r.canEdit === false, '처음엔 없음');
  let err = ''; try { await F.worshipHarmSave(mem, FILE, { pages: {} }); } catch (e) { err = e.message; }
  ok(/팀장/.test(err), '팀원은 저장 불가');
  const s = await F.worshipHarmSave(lead, FILE, { pages: { 1: { notes: [1] } }, ov: { alto: {}, tenor: { n1: 74 } }, use: {}, orig: 'G', show: { x: 1 } });
  ok(s.ok && s.by === '리더', '리더 저장');
  r = await F.worshipHarmLoad(mem, FILE);
  ok(r.data && r.data.ov.tenor.n1 === 74 && r.by === '리더' && r.data.show === undefined, '팀원이 같은 화음을 읽음 (보기 설정은 빠짐)');
  r = await F.worshipHarmLoad(other, FILE);
  ok(r.data === null, '다른 팀은 못 봄');
  err = ''; try { await F.worshipHarmSave(lead, FILE, { pages: { 1: { big: 'x'.repeat(410000) } } }); } catch (e) { err = e.message; }
  ok(/너무 큽니다/.test(err), '너무 큰 자료 거절');
  await new Promise((res) => setTimeout(res, 50));
  ok(rows.찬양주석.some((x) => x['소유'] === '#화음' && x['범위'] === 'song'), '시트(찬양주석)에 #화음 층으로 저장');
  console.log(fail ? '✗ 실패 ' + fail : '✓ 모두 통과 (통과 ' + pass + ')'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
