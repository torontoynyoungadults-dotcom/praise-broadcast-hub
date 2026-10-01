/**
 * 악보의 "쪽 범위" 글 — 패키지 악보(PDF 한 개에 여러 곡)에서 곡마다 어느 쪽인지를 적어 둡니다.
 *   pagesToSpec([3,4,5,8]) → '3-5,8'      specToRanges('3-5,8') → [[3,5],[8,8]]      specPages('3-5,8') → [3,4,5,8]
 * 쪽은 1 ~ 500, 한 곡에 최대 200쪽까지만 받아들입니다 (이상한 값이 시트에 들어가지 않도록).
 */
const MAXP = 500, MAXN = 200;

function cleanPages(list) {
  const set = new Set();
  [].concat(list || []).forEach((x) => { const n = Math.floor(Number(x)); if (n >= 1 && n <= MAXP) set.add(n); });
  return Array.from(set).sort((a, b) => a - b).slice(0, MAXN);
}
function pagesToSpec(list) {
  const p = cleanPages(list), out = [];
  for (let i = 0; i < p.length;) {
    let j = i; while (j + 1 < p.length && p[j + 1] === p[j] + 1) j++;
    out.push(j > i ? `${p[i]}-${p[j]}` : String(p[i])); i = j + 1;
  }
  return out.join(',');
}
function specToRanges(spec) {
  const out = [];
  String(spec || '').split(',').forEach((part) => {
    const m = /^\s*(\d{1,3})\s*(?:[-~–]\s*(\d{1,3}))?\s*$/.exec(part);
    if (!m) return;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (a >= 1 && b >= a && b <= MAXP) out.push([a, b]);
  });
  return out;
}
const specPages = (spec) => { const o = []; specToRanges(spec).forEach(([a, b]) => { for (let p = a; p <= b && o.length < MAXN; p++) o.push(p); }); return o; };
/** 깨끗이 다듬은 글 ('3 - 5, 8' → '3-5,8'), 알아볼 수 없으면 '' */
const cleanSpec = (spec) => pagesToSpec(specPages(spec));

module.exports = { cleanPages, pagesToSpec, specToRanges, specPages, cleanSpec };
