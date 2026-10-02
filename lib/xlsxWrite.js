/**
 * 아주 작은 .xlsx 만들기 도구 — 별도 패키지 없이(zlib 만) 스케줄 템플릿 같은 간단한 엑셀 파일을 만듭니다.
 * (읽기는 lib/xlsxLite.js)
 *
 * writeXlsx([{ name, rows, widths, header, freeze, dateCols, lists, noteRows }]) → Buffer
 *   rows       [[칸, …], …]   칸 = 문자열 | 숫자 | { d:'YYYY-MM-DD' } (엑셀 날짜 칸) | null
 *   widths     열 너비 (글자 수)
 *   header     true 면 첫 줄을 머리글 스타일로
 *   freeze     { rows:1, cols:1 } 처럼 틀 고정
 *   lists      [{ sqref:'B2:N60', formula:"'팀원명단'!$A$2:$A$40" }]  목록 상자(자유 입력도 허용 — 오류 메시지 없음)
 *   plain      true 면 모든 칸을 줄바꿈 되는 본문 스타일로 (안내 시트)
 */
const zlib = require('zlib');

/* ---------- zip (무압축 저장 — 파일이 작아서 충분) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(files) {
  const parts = [], central = [];
  let off = 0;
  files.forEach((f) => {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.from(f.data, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const useDef = deflated.length < data.length;
    const body = useDef ? deflated : data, method = useDef ? 8 : 0, crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);                         // 시각 0:00 · 날짜 1980-01-01
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + body.length;
  });
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, end]));
}

/* ---------- xlsx ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const serial = (ymd) => Math.round(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000) + 25569;

/* 스타일 번호: 0 기본 · 1 머리글(주황) · 2 날짜 · 3 본문(테두리·줄바꿈) · 4 안내 본문(줄바꿈) · 5 안내 제목(굵게 큼) · 6 머리글(회색 — 불참 열) */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Malgun Gothic"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Malgun Gothic"/></font><font><b/><sz val="14"/><name val="Malgun Gothic"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8590C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4E6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6B7280"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D0D0"/></left><right style="thin"><color rgb="FFD0D0D0"/></right><top style="thin"><color rgb="FFD0D0D0"/></top><bottom style="thin"><color rgb="FFD0D0D0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sh) {
  const rows = sh.rows || [];
  const maxCol = rows.reduce((m, r) => Math.max(m, r.length), 1);
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${colName(maxCol - 1)}${Math.max(rows.length, 1)}"/>`;
  const fr = sh.freeze ? `<pane${sh.freeze.cols ? ` xSplit="${sh.freeze.cols}"` : ''}${sh.freeze.rows ? ` ySplit="${sh.freeze.rows}"` : ''} topLeftCell="${colName(sh.freeze.cols || 0)}${(sh.freeze.rows || 0) + 1}" activePane="${sh.freeze.rows && sh.freeze.cols ? 'bottomRight' : (sh.freeze.rows ? 'bottomLeft' : 'topRight')}" state="frozen"/>` : '';
  x += `<sheetViews><sheetView workbookViewId="0"${sh.first ? ' tabSelected="1"' : ''}${sh.plain ? ' showGridLines="0"' : ''}>${fr}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>`;
  if (sh.widths && sh.widths.length) x += '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  x += '<sheetData>';
  rows.forEach((r, ri) => {
    const isHead = sh.header && ri === 0;
    x += `<row r="${ri + 1}"${isHead ? ' ht="30" customHeight="1"' : ''}>`;
    r.forEach((v, ci) => {
      if (v === null || v === undefined || v === '') {
        if (!sh.plain && !isHead) x += `<c r="${colName(ci)}${ri + 1}" s="3"/>`;
        return;
      }
      const ref = `${colName(ci)}${ri + 1}`;
      if (v && typeof v === 'object' && v.d) { x += `<c r="${ref}" s="2"><v>${serial(v.d)}</v></c>`; return; }
      const style = sh.plain ? (v && v.title ? 5 : 4) : isHead ? ((sh.grayCols || []).includes(ci) ? 6 : 1) : 3;
      if (typeof v === 'number') { x += `<c r="${ref}" s="${style}"><v>${v}</v></c>`; return; }
      const txt = v && v.title ? v.title : v;
      x += `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(clean(txt))}</t></is></c>`;
    });
    x += '</row>';
  });
  x += '</sheetData>';
  const lists = sh.lists || [];
  if (lists.length) x += `<dataValidations count="${lists.length}">` + lists.map((l) => `<dataValidation type="list" allowBlank="1" showInputMessage="0" showErrorMessage="0" sqref="${l.sqref}"><formula1>${esc(l.formula)}</formula1></dataValidation>`).join('') + '</dataValidations>';
  x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
  return x;
}

function writeXlsx(sheets) {
  sheets.forEach((s, i) => { s.first = i === 0; });
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
  ].concat(sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })));
  return zip(files);
}

module.exports = { writeXlsx, colName };
