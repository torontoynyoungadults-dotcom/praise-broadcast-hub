/**
 * /photo/:id — 드라이브에 올린 사진(프로필 · 팀원 · 장비)을 이 앱을 거쳐 보여줍니다 (lib/photo.js 설명 참고).
 * 로그인한 사람만, 그리고 이 앱의 시트에 실제로 적혀 있는 사진 ID만 내려줍니다 (아무 드라이브 파일이나 열리지 않게).
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const { serviceAuth } = require('../lib/googleAuth');
const photo = require('../lib/photo');

const router = express.Router();
const CACHE = new Map();                       // id → { buf, type } — 최근 사진 몇 개는 메모리에 (프로필 사진은 작음)
const CACHE_MAX = 80, ONE_MAX = 6 * 1024 * 1024;

/** 사진 칸이 있는 시트들에서 쓰는 사진 ID 모음 */
async function knownIds() {
  const [members, roster, tickets] = await Promise.all([sheetsDb.readAll('회원'), sheetsDb.readAll('팀원명단'), sheetsDb.readAll('장비수리요청')]);
  const ids = new Set();
  const add = (v) => String(v || '').split(',').forEach((x) => { const id = photo.driveIdOf(x.trim()); if (id) ids.add(id); });
  members.forEach((m) => add(m['프로필사진']));
  roster.forEach((r) => add(r['사진']));
  tickets.forEach((t) => add(t['사진']));
  return ids;
}

router.get('/photo/:id', async (req, res) => {
  if (!req.session) return res.status(401).type('text').send('로그인이 필요합니다.');
  const id = String(req.params.id || '');
  if (!photo.FILE_RE.test(id)) return res.status(404).type('text').send('not found');
  try {
    let hit = CACHE.get(id);
    if (!hit) {
      if (!(await knownIds()).has(id)) return res.status(404).type('text').send('not found');
      const { token } = await serviceAuth().getAccessToken();
      const r = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) return res.status(r.status === 404 ? 404 : 502).type('text').send('사진을 불러오지 못했습니다.');
      const type = String(r.headers.get('content-type') || 'image/jpeg');
      if (!/^image\//i.test(type)) return res.status(404).type('text').send('not found');
      const buf = Buffer.from(await r.arrayBuffer());
      hit = { buf, type };
      if (buf.length <= ONE_MAX) { CACHE.set(id, hit); while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value); }
    }
    res.set({ 'Content-Type': hit.type, 'Content-Length': String(hit.buf.length), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.send(hit.buf);
  } catch (e) {
    console.error('[사진]', id, e && e.message);
    if (!res.headersSent) res.status(502).type('text').send('사진을 불러오지 못했습니다.');
  }
});

module.exports = router;
