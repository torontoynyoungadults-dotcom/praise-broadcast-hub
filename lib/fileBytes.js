/** 악보 파일(드라이브 · 외부 주소)의 바이트 — 패키지 PDF 만들 때 서버가 받아 옵니다. 실패하면 null */
const { serviceAuth } = require('./googleAuth');
const liveStore = require('./liveStore');
const sheetSearch = require('./sheetSearch');

const MAX = 30 * 1024 * 1024;
const CACHE_MAX = 90 * 1024 * 1024;                // 한 번 받은 악보는 메모리에 잠깐 — 다시 만들 때 드라이브에서 또 받지 않게
const cache = new Map(); let cacheBytes = 0;
function remember(link, buf) {
  if (buf.length > CACHE_MAX / 3) return;
  cache.set(link, buf); cacheBytes += buf.length;
  for (const [k, v] of cache) { if (cacheBytes <= CACHE_MAX) break; cache.delete(k); cacheBytes -= v.length; }
}
async function get(link) {
  link = String(link || '').trim();
  if (!link) return null;
  if (cache.has(link)) { const b = cache.get(link); cache.delete(link); cache.set(link, b); return b; }
  try {
    const id = liveStore.driveIdOf(link);
    let r;
    if (id) {
      const { token } = await serviceAuth().getAccessToken();
      r = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(25000) });
    } else {
      await sheetSearch.assertPublicHttps(link);
      r = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    }
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX) return null;
    remember(link, buf);
    return buf;
  } catch (e) { console.error('[패키지 악보 받기 실패]', e.message); return null; }
}
module.exports = { get };
