/**
 * 웹에서 악보 이미지 찾기 — Google Programmable Search(이미지 검색) 공식 API 사용.
 *  필요한 환경변수: GOOGLE_CSE_KEY (API 키) · GOOGLE_CSE_ID (검색엔진 ID, "전체 웹 검색" + "이미지 검색" 켠 것)
 *  고른 이미지(JPG/PNG)는 서버가 받아 PDF 한 개로 묶어 악보로 저장합니다 (pdf-lib).
 */
const dns = require('dns').promises;
const net = require('net');
const { PDFDocument } = require('pdf-lib');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES = 12;

function configured() { return !!(String(process.env.GOOGLE_CSE_KEY || '').trim() && String(process.env.GOOGLE_CSE_ID || '').trim()); }

/** 검색 — [{ thumb, url, w, h, title, source }]  (JPG/PNG 만; 못 쓰는 형식은 뺌) */
async function search(q, start) {
  q = String(q || '').trim().slice(0, 120);
  if (!q) return [];
  if (!configured()) { const e = new Error('not-configured'); e.code = 'NOT_CONFIGURED'; throw e; }
  const u = new URL(process.env.GOOGLE_CSE_ENDPOINT || 'https://www.googleapis.com/customsearch/v1');   // GOOGLE_CSE_ENDPOINT: 시험용 가짜 서버 주소
  u.searchParams.set('key', process.env.GOOGLE_CSE_KEY.trim());
  u.searchParams.set('cx', process.env.GOOGLE_CSE_ID.trim());
  u.searchParams.set('q', q);
  u.searchParams.set('searchType', 'image');
  u.searchParams.set('num', '10');
  u.searchParams.set('safe', 'active');
  const st = Math.max(1, Math.min(91, parseInt(start, 10) || 1));
  if (st > 1) u.searchParams.set('start', String(st));
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error((d.error && d.error.message) || ('HTTP ' + r.status));
    e.code = r.status === 429 || /quota|limit/i.test(e.message) ? 'QUOTA' : 'API';
    e.status = r.status;
    throw e;
  }
  return (d.items || []).filter((it) => /image\/(jpeg|png)/i.test(it.mime || '') || /\.(jpe?g|png)(\?|$)/i.test(it.link || '')).map((it) => ({
    thumb: (it.image && it.image.thumbnailLink) || it.link, url: it.link,
    w: it.image && it.image.width, h: it.image && it.image.height,
    title: String(it.title || '').slice(0, 80), source: (it.displayLink || '').slice(0, 60),
  }));
}

function privateIp(ip) {
  if (net.isIPv4(ip)) { const p = ip.split('.').map(Number); return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); }
  const x = ip.toLowerCase(); return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:');
}
/** 서버가 내부망 주소를 대신 열어 주지 않도록 — https 만, 사설 IP 거부 */
async function assertPublicHttps(urlStr) {
  if (process.env.SHEETSEARCH_TEST === '1') return;   // 시험(가짜 서버)에서만
  const u = new URL(urlStr);
  if (u.protocol !== 'https:') throw new Error('https 주소만 가져올 수 있어요');
  if (net.isIP(u.hostname)) { if (privateIp(u.hostname)) throw new Error('허용되지 않는 주소'); return; }
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('허용되지 않는 주소');
}

async function fetchImage(urlStr) {
  let cur = urlStr;
  for (let hop = 0; hop < 3; hop++) {
    await assertPublicHttps(cur);
    const r = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 PraiseHub', Accept: 'image/jpeg,image/png' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { cur = new URL(r.headers.get('location'), cur).href; continue; }
    if (!r.ok) throw new Error('이미지를 받지 못했어요 (' + r.status + ')');
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('이미지가 너무 커요');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('이미지가 너무 커요');
    return buf;
  }
  throw new Error('이동이 너무 많아요');
}

/** 이미지(JPG/PNG) 여러 장 → 한 PDF (쪽 크기 = 이미지 크기, 너무 크면 가로 1240pt 로 줄임) */
async function imagesToPdf(buffers) {
  const pdf = await PDFDocument.create();
  for (const buf of buffers) {
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
    const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
    if (!isPng && !isJpg) throw new Error('JPG · PNG 만 쓸 수 있어요');
    const img = isPng ? await pdf.embedPng(buf) : await pdf.embedJpg(buf);
    const k = img.width > 1240 ? 1240 / img.width : 1;
    const page = pdf.addPage([img.width * k, img.height * k]);
    page.drawImage(img, { x: 0, y: 0, width: img.width * k, height: img.height * k });
  }
  return Buffer.from(await pdf.save());
}

module.exports = { configured, search, fetchImage, imagesToPdf, assertPublicHttps, MAX_IMAGES };
