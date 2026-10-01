/**
 * 아주 작은 .xlsx 읽기 도구 — 별도 패키지 없이(zlib 만) 엑셀 파일의 시트 · 칸 값을 읽습니다.
 * 지원: 공유 문자열 · 인라인 문자열 · 숫자 · 날짜(엑셀 날짜 번호 → 'YYYY-MM-DD') · 여러 시트. 서식 · 수식 결과는 값만 봅니다.
 * readXlsx(buffer) → [{ name, rows: [[칸, 칸, …], …] }]   (칸 = 문자열 | 숫자 | '' , 날짜 서식인 숫자는 'YYYY-MM-DD' 문자열)
 */
const zlib = require('zlib');

function unzip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; } }
  if (e < 0) throw new Error('엑셀(.xlsx) 파일이 아닙니다.');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lnLen = buf.readUInt16LE(off + 26), leLen = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + lnLen + leLen, off + 30 + lnLen + leLen + csize);
    files[name] = { method, data };
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return (name) => {
    const f = files[name];
    if (!f) return null;
    return (f.method === 0 ? f.data : zlib.inflateRawSync(f.data)).toString('utf8');
  };
}

const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const textOf = (xml) => { let out = ''; String(xml).replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t) => { out += unesc(t); return m; }); return out; };

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref); let n = 0;
  for (const ch of m ? m[1] : 'A') n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
/** 엑셀 날짜 번호 → YYYY-MM-DD (1900 체계) */
function serialToDate(n) {
  const d = new Date(Math.round((n - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
}
const DATE_BUILTIN = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function readXlsx(buf) {
  const get = unzip(buf);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('엑셀(.xlsx) 파일이 아닙니다.');
  const rels = {};
  String(get('xl/_rels/workbook.xml.rels') || '').replace(/<Relationship\b[^>]*>/g, (tag) => {
    const id = /\bId="([^"]*)"/.exec(tag), tg = /\bTarget="([^"]*)"/.exec(tag);
    if (id && tg) rels[id[1]] = tg[1];
    return tag;
  });
  const shared = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) ss.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (m, inner) => { shared.push(textOf(inner)); return m; });
  // 날짜 서식인 칸 번호 (cellXfs 의 numFmtId)
  const dateXf = new Set();
  const styles = get('xl/styles.xml') || '';
  const customDate = new Set();
  styles.replace(/<numFmt\b[^>]*>/g, (tag) => {
    const id = /numFmtId="(\d+)"/.exec(tag), code = /formatCode="([^"]*)"/.exec(tag);
    if (id && code && /[ymd]/i.test(code[1].replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '')) && !/[hs]/i.test(code[1].replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '')) ) customDate.add(+id[1]);
    return tag;
  });
  const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  if (cx) { let i = 0; cx[1].replace(/<xf\b[^>]*>/g, (tag) => { const f = /numFmtId="(\d+)"/.exec(tag); const id = f ? +f[1] : 0; if (DATE_BUILTIN.has(id) || customDate.has(id)) dateXf.add(i); i++; return tag; }); }

  const sheets = [];
  wb.replace(/<sheet\b[^>]*>/g, (tag) => {
    const name = /\bname="([^"]*)"/.exec(tag), rid = /\br:id="([^"]*)"/.exec(tag);
    if (!name || !rid || !rels[rid[1]]) return tag;
    let target = rels[rid[1]].replace(/^\//, ''); if (!/^xl\//.test(target)) target = 'xl/' + target;
    const xml = get(target);
    if (xml == null) return tag;
    const rows = [];
    xml.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (m, rowXml) => {
      const cells = [];
      rowXml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (mm, attrs, inner) => {
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs), t = /\bt="([^"]*)"/.exec(attrs), s = /\bs="(\d+)"/.exec(attrs);
        if (!ref) return mm;
        let val = '';
        const v = inner ? /<v>([\s\S]*?)<\/v>/.exec(inner) : null;
        if (t && t[1] === 'inlineStr') val = textOf(inner || '');
        else if (v) {
          if (t && t[1] === 's') val = shared[+v[1]] || '';
          else if (t && (t[1] === 'str' || t[1] === 'e')) val = unesc(v[1]);
          else if (t && t[1] === 'b') val = v[1] === '1';
          else { const num = Number(v[1]); val = isNaN(num) ? unesc(v[1]) : (s && dateXf.has(+s[1]) ? serialToDate(num) : num); }
        }
        cells[colIndex(ref[1])] = val;
        return mm;
      });
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      rows.push(cells);
      return m;
    });
    sheets.push({ name: unesc(name[1]), rows });
    return tag;
  });
  return sheets;
}

module.exports = { readXlsx, serialToDate };
