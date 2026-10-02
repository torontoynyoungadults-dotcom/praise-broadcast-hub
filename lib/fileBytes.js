/** 악보 파일(드라이브 · 외부 주소)의 바이트 — 패키지 PDF 만들 때 서버가 받아 옵니다. 실패하면 null */
const { serviceAuth } = require('./googleAuth');
const liveStore = require('./liveStore');
const sheetSearch = require('./sheetSearch');

const MAX = 30 * 1024 * 1024;
async function get(link) {
  link = String(link || '').trim();
  if (!link) return null;
  try {
    const id = liveStore.driveIdOf(link);
    let r;
    if (id) {
      const { token } = await serviceAuth().getAccessToken();
      r = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
    } else {
      await sheetSearch.assertPublicHttps(link);
      r = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    }
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length && buf.length <= MAX ? buf : null;
  } catch (e) { console.error('[패키지 악보 받기 실패]', e.message); return null; }
}
module.exports = { get };
