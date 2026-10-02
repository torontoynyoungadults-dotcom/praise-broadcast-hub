/**
 * 패키지 악보(PDF 한 개에 여러 곡)에서 한 곡의 쪽만 뽑은 새 PDF 를 만듭니다.
 *   "곡별 악보로 저장" 은 곡마다 (원본 파일 + 쪽 범위) 줄을 남기는데, 그 줄을 열 때 원본 전체가 아니라 그 곡 쪽만 보이게 하는 데 씁니다.
 *   원본 파일 · 시트 구조는 건드리지 않고, 열 때마다(작은 캐시) 즉석에서 만들어 돌려줍니다.
 */
const { PDFDocument } = require('pdf-lib');
const pageSpec = require('./pageSpec');

/** buf(PDF) 에서 spec('3-5,8') 쪽만 뽑은 PDF 버퍼. PDF 가 아니거나 범위가 맞지 않으면 null */
async function extract(buf, spec) {
  const want = pageSpec.specPages(spec);
  if (!want.length) return null;
  let src;
  try { src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false }); } catch (e) { return null; }
  const n = src.getPageCount();
  const idx = want.filter((p) => p <= n).map((p) => p - 1);
  if (!idx.length) return null;
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

/** PDF 머리글(%PDF-)인지 */
const isPdf = (buf) => !!buf && buf.length > 4 && buf.slice(0, 5).toString('latin1') === '%PDF-';

module.exports = { extract, isPdf };
