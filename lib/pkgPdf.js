/**
 * 인쇄용 PDF 패키지 — US Letter · 흑백 · 표지 + 곡마다 (머리말 · 악보 · 꼬리말).
 *   표지 : 연습 일시 · 서는 멤버 · 콘티(순서 · 제목 · 원곡팀 · Key · BPM · 송폼 · 곡 설명 · 악보 쪽수) · 유튜브 이어 듣기 QR
 *   곡   : 맨 위에 순서 · 제목 · 원곡팀 · Key/BPM · 송폼을 머리말로, 악보는 원본 PDF 에서 (제목/순서 머리글을 뺀) 악보 부분만 벡터 그대로 올림, 맨 아래 꼬리말
 * 글꼴은 public/fonts 의 Noto Sans/Serif KR (OFL, 한글 2350자 + 영문 · 기호 서브셋) 을 PDF 에 심습니다.
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const QRCode = require('qrcode');
const pageSpec = require('./pageSpec');
const sheetCrop = require('./sheetCrop');

const W = 612, H = 792;                       // US Letter (pt)
const MX = 42;                                // 좌우 여백
const FONT_DIR = path.join(__dirname, '..', 'public', 'fonts');
const _fb = {};
const fontBytes = (n) => (_fb[n] = _fb[n] || fs.readFileSync(path.join(FONT_DIR, n)));

const K = rgb(0, 0, 0);
const gray = (v) => rgb(v, v, v);

async function loadFonts(doc) {
  doc.registerFontkit(fontkit);
  const emb = (n) => doc.embedFont(fontBytes(n), { subset: false });
  const [sans, sansBold, sansLight, serif, serifBold] = await Promise.all([
    emb('NotoSans-Regular-KR.ttf'), emb('NotoSans-Bold-KR.ttf'), emb('NotoSans-Light-KR.ttf'), emb('NotoSerif-Regular-KR.ttf'), emb('NotoSerif-Bold-KR.ttf'),
  ]);
  return { sans, sansBold, sansLight, serif, serifBold };
}

/* ---------- 글 그리기 도우미 ---------- */
const clean = (s) => String(s == null ? '' : s).replace(/[\r\t]/g, ' ').replace(/[\u0000-\u001f]/g, '');
function fit(font, text, size, maxW) {                 // 폭에 맞게 글자 크기 줄임 (최소 minRatio) → 그래도 넘치면 말줄임
  let s = size;
  while (s > size * 0.62 && font.widthOfTextAtSize(text, s) > maxW) s -= 0.5;
  let t = text;
  if (font.widthOfTextAtSize(t, s) > maxW) { while (t.length > 1 && font.widthOfTextAtSize(t + '…', s) > maxW) t = t.slice(0, -1); t += '…'; }
  return { text: t, size: s };
}
function wrap(font, text, size, maxW) {                // 한글은 글자 단위, 영문은 단어 단위로 줄바꿈
  const out = [];
  String(text).split('\n').forEach((para) => {
    let line = '';
    const tokens = para.match(/[A-Za-z0-9'’.,:;!?()\/_\-&+#@]+|\s+|[^\sA-Za-z0-9]/g) || [];
    tokens.forEach((tk) => {
      const tryLine = line + tk;
      if (font.widthOfTextAtSize(tryLine, size) <= maxW || !line.trim()) line = tryLine;
      else { out.push(line.trim()); line = tk.trim() ? tk : ''; }
    });
    out.push(line.trim());
  });
  return out.filter((l, i, a) => l || (i > 0 && i < a.length - 1));
}
function text(page, s, x, y, font, size, color, opt) {
  s = clean(s); if (!s) return 0;
  page.drawText(s, Object.assign({ x, y, size, font, color: color || K }, opt || {}));
  return font.widthOfTextAtSize(s, size);
}
function tracked(page, s, x, y, font, size, color, sp) {        // 자간을 벌린 작은 영문 라벨
  s = clean(s); let cx = x;
  for (const ch of s) { page.drawText(ch, { x: cx, y, size, font, color: color || K }); cx += font.widthOfTextAtSize(ch, size) + sp; }
  return cx - x - sp;
}
const trackedW = (font, s, size, sp) => { let w = 0; for (const ch of clean(s)) w += font.widthOfTextAtSize(ch, size) + sp; return Math.max(0, w - sp); };
const hline = (page, x1, x2, y, th, color) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: th, color: color || K });
const rightText = (page, s, xr, y, font, size, color) => { s = clean(s); const w = font.widthOfTextAtSize(s, size); page.drawText(s, { x: xr - w, y, size, font, color: color || K }); return w; };

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function dateParts(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
  return { y: +m[1], m: +m[2], d: +m[3], dow: DOW[d.getDay()], dowEn: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()], mon: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()] };
}
const dotDate = (ymd) => { const p = dateParts(ymd); return p ? `${p.y}.${String(p.m).padStart(2, '0')}.${String(p.d).padStart(2, '0')}` : ''; };
const koDate = (ymd) => { const p = dateParts(ymd); return p ? `${p.m}월 ${p.d}일 (${p.dow})` : ''; };

/* ---------- 악보 원본 → 곡에 들어갈 "쪽 조각" 들 ---------- */
/** sheets:[{buf,type,spec}] → [{ page(PDFPage of src doc), cb:{x,y,w,h}, box:{left,top,right,bottom}|null, srcDoc }] */
async function pieces(sheets, cropOn, imagesToPdf) {
  const out = [];
  for (const sh of sheets || []) {
    let buf = sh.buf;
    const isPdf = buf && buf.length > 4 && buf.slice(0, 5).toString('latin1') === '%PDF-';
    if (!isPdf) {
      try { buf = await imagesToPdf([buf]); } catch (e) { continue; }       // 사진(JPG/PNG) 악보는 한 쪽짜리 PDF 로
    }
    let src;
    try { src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false }); } catch (e) { continue; }
    const n = src.getPageCount();
    let want = sh.spec ? pageSpec.specPages(sh.spec).filter((p) => p <= n) : Array.from({ length: n }, (_, i) => i + 1);
    if (!want.length) want = Array.from({ length: n }, (_, i) => i + 1);
    let det = [];
    if (cropOn) { try { det = await sheetCrop.detect(buf, want); } catch (e) { console.error('[패키지 악보 분석 실패]', e.message); det = []; } }
    for (const no of want) {
      const page = src.getPage(no - 1);
      const cb = page.getCropBox();
      const d = det.find((x) => x.pageNo === no);
      const okDet = d && d.box && Math.abs(d.w - cb.width) < 3 && Math.abs(d.h - cb.height) < 3 && !(page.getRotation().angle % 360);
      out.push({ page, cb: { x: cb.x, y: cb.y, w: cb.width, h: cb.height }, box: okDet ? d.box : null, headerCut: !!(okDet && d.headerCut), srcDoc: src });
    }
  }
  return out;
}

/* ---------- 곡 쪽 ---------- (머리말 · 꼬리말은 얇게 — 악보가 쪽을 최대한 채우도록) */
const SX = 26;                                   // 악보 좌우 여백
const FOOT_Y = 17;                               // 꼬리말 글자 기준선
function drawFooter(page, F, o) {
  hline(page, SX, W - SX, FOOT_Y + 9, 0.35, gray(0.4));
  text(page, `${o.church} · ${o.team}`, SX, FOOT_Y, F.sans, 7, gray(0.3));
  rightText(page, `${o.dateLabel}   ${o.n} / ${o.total}`, W - SX, FOOT_Y, F.sans, 7, gray(0.3));
}

/** 머리말을 그리고, 악보를 올릴 영역의 위쪽 y 를 돌려줌 */
function drawSongHeader(page, F, s, first, o) {
  const top = H - 24;
  if (!first) {                                  // 이어지는 쪽 — 얇은 한 줄
    text(page, s.kind === '결단' ? '+' : String(s.no).padStart(2, '0'), SX, top - 11, F.serifBold, 11, K);
    const t = fit(F.serifBold, clean(s.title), 10.5, W - 2 * SX - 120);
    text(page, t.text, SX + 22, top - 10.5, F.serifBold, t.size, K);
    rightText(page, `계속 · ${o.pageInSong} / ${o.pagesInSong}`, W - SX, top - 10, F.sans, 7, gray(0.4));
    hline(page, SX, W - SX, top - 17, 0.7, K);
    return top - 22;
  }
  // 첫 쪽 — 두 줄(제목 · Key/BPM / 원곡팀 · 송폼)
  const num = s.kind === '결단' ? '+' : String(s.no).padStart(2, '0');
  text(page, num, SX, top - 20, F.serifBold, 22, K);
  const tx = SX + 36;
  const metaW = 112;
  const t = fit(F.serifBold, clean(s.title) || '제목 없음', 17, W - SX - metaW - tx - 8);
  text(page, t.text, tx, top - 16, F.serifBold, t.size, K);
  // Key · BPM — 작은 박스 두 개
  const bx = W - SX - metaW;
  [['KEY', clean(s.key)], ['BPM', clean(s.bpm)]].forEach((b, i) => {
    const x = bx + i * (metaW / 2 + 2), w = metaW / 2 - 2;
    page.drawRectangle({ x, y: top - 27, width: w, height: 27, borderColor: K, borderWidth: i === 0 ? 1.2 : 0.6, color: undefined });
    tracked(page, b[0], x + 5, top - 10, F.sansBold, 5.6, gray(0.4), 1.2);
    const v = b[1] || '—';
    const f = fit(F.serifBold, v, 15, w - 10);
    text(page, f.text, x + w - 5 - F.serifBold.widthOfTextAtSize(f.text, f.size), top - 22, F.serifBold, f.size, K);
  });
  // 원곡팀 · 송폼
  let fx = tx; const fy = top - 34.5;
  if (clean(s.team)) { fx += text(page, clean(s.team), fx, fy + 2.5, F.sans, 8, gray(0.3)) + 9; }
  const toks = String(s.form || '').split(/\s*[-–>→,]\s*/).map((x) => clean(x).trim()).filter(Boolean).slice(0, 24);
  toks.forEach((tk) => {
    const tw = F.sansBold.widthOfTextAtSize(tk, 6.6), bw = Math.max(15, tw + 8);
    if (fx + bw > bx - 6) return;
    page.drawRectangle({ x: fx, y: fy, width: bw, height: 10.5, borderColor: K, borderWidth: 0.5, color: undefined });
    text(page, tk, fx + (bw - tw) / 2, fy + 3, F.sansBold, 6.6, K);
    fx += bw + 3;
  });
  hline(page, SX, W - SX, top - 41, 1.3, K);
  return top - 47;
}

/** 악보 조각 하나를 area 안에 맞춰 그림 */
async function drawPiece(out, page, pc, area) {
  const { cb } = pc;
  const bx = pc.box || { left: 0, right: 1, top: 0, bottom: 1 };
  const left = cb.x + bx.left * cb.w, right = cb.x + bx.right * cb.w;
  const top = cb.y + (1 - bx.top) * cb.h, bottom = cb.y + (1 - bx.bottom) * cb.h;
  const bw = Math.max(10, right - left), bh = Math.max(10, top - bottom);
  const emb = await out.embedPage(pc.page, { left, bottom, right, top });
  const sc = Math.min(area.w / bw, area.h / bh, 2.4);
  const dw = bw * sc, dh = bh * sc;
  page.drawPage(emb, { x: area.x + (area.w - dw) / 2, y: area.top - dh, width: dw, height: dh });
}

/* ---------- QR (벡터) ---------- */
function drawQR(page, textVal, x, y, size) {
  const qr = QRCode.create(String(textVal), { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, data = qr.modules.data, q = 3;          // 여백 3칸
  const cell = size / (n + q * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1), borderColor: K, borderWidth: 0.8 });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!data[r * n + c]) { c++; continue; }
      let e = c; while (e < n && data[r * n + e]) e++;
      page.drawRectangle({ x: x + (q + c) * cell, y: y + size - (q + r + 1) * cell, width: (e - c) * cell + 0.15, height: cell + 0.15, color: K });
      c = e;
    }
  }
}

/* ---------- 표지 ---------- */
/** newPage(i) → 새 쪽. 돌려주는 값: 표지 쪽 수. info.songStart[i] = 그 곡의 시작 쪽(절대) — 모르면 null */
function drawCover(newPage, F, info) {
  const pages = [];
  const addPage = () => { const p = newPage(pages.length); pages.push(p); return p; };
  let p = addPage();
  const L = 50, R = W - 50, CW = R - L;
  let y = H - 52;
  tracked(p, 'WORSHIP PACKET', L, y, F.sansBold, 8, K, 3);
  rightText(p, info.church, R, y, F.sansBold, 8.5, K);
  y -= 10; hline(p, L, R, y, 2.4, K); hline(p, L, R, y - 4, 0.5, K);
  y -= 52;
  const dp = dateParts(info.date);
  if (dp) {
    text(p, `${dp.m}월 ${dp.d}일`, L, y, F.serifBold, 44, K);
    const mw = F.serifBold.widthOfTextAtSize(`${dp.m}월 ${dp.d}일`, 44);
    text(p, `${dp.dow}요일`, L + mw + 14, y + 2, F.serif, 20, gray(0.3));
    rightText(p, `${dp.y}`, R, y + 28, F.serif, 12, gray(0.35));
    tracked(p, `${dp.mon}  ${String(dp.d).padStart(2, '0')}  ${dp.dowEn}`, R - trackedW(F.sansLight, `${dp.mon}  ${String(dp.d).padStart(2, '0')}  ${dp.dowEn}`, 8, 2.4), y + 12, F.sansLight, 8, gray(0.35), 2.4);
  }
  y -= 26;
  text(p, info.title || '주일예배 찬양 콘티', L, y, F.serif, 17, K);
  y -= 16;
  text(p, info.team, L, y, F.sans, 9.5, gray(0.35));
  y -= 24;

  // 연습 · 예배
  const infoRow = [];
  if (info.practice && info.practice.date && !info.practice.none) infoRow.push(['REHEARSAL  연습', koDate(info.practice.date), info.practice.note || '']);
  else if (info.practice && info.practice.none) infoRow.push(['REHEARSAL  연습', '연습 없음', '']);
  infoRow.push(['WORSHIP  예배', koDate(info.date), info.eventName || '']);
  const cw = CW / Math.max(1, infoRow.length);
  hline(p, L, R, y + 8, 0.5, gray(0.5));
  infoRow.forEach((r, i) => {
    const x = L + i * cw + (i ? 14 : 0);
    if (i) p.drawLine({ start: { x: L + i * cw, y: y + 4 }, end: { x: L + i * cw, y: y - 40 }, thickness: 0.4, color: gray(0.5) });
    tracked(p, r[0], x, y - 8, F.sansBold, 6.8, gray(0.4), 1.6);
    text(p, r[1], x, y - 26, F.serifBold, 14, K);
    if (r[2]) { const f = fit(F.sans, clean(r[2]), 9, cw - 22); text(p, f.text, x, y - 40, F.sans, f.size, gray(0.3)); }
  });
  y -= 56;
  hline(p, L, R, y + 6, 0.5, gray(0.5));
  y -= 18;

  // 서는 멤버
  const mem = (info.members || []).filter((m) => m.names && m.names.length);
  if (mem.length) {
    tracked(p, 'TEAM', L, y, F.sansBold, 7.5, K, 2.4); text(p, '서는 멤버', L + 38, y, F.sansBold, 9, K);
    y -= 8; hline(p, L, R, y, 0.8, K); y -= 14;
    const cols = 3, colW = CW / cols;
    const rowsN = Math.ceil(mem.length / cols);
    for (let r = 0; r < rowsN; r++) {
      let rowH = 0;
      for (let c = 0; c < cols; c++) {
        const m = mem[r * cols + c]; if (!m) continue;
        const x = L + c * colW;
        tracked(p, clean(m.pos), x, y, F.sansBold, 7.2, gray(0.4), 0.8);
        const lines = wrap(F.sans, m.names.join(', '), 10, colW - 14);
        lines.forEach((ln, li) => text(p, ln, x, y - 13 - li * 12.5, F.sans, 10, K));
        rowH = Math.max(rowH, 13 + lines.length * 12.5);
      }
      y -= rowH + 6;
    }
    y -= 4;
  }

  // 콘티 표
  const songs = info.songs || [];
  const needQr = !!info.qrUrl;
  const QR = 86;
  const reserveBottom = (last) => (last && needQr ? QR + 56 : 56);
  const header = (pg, yy, cont) => {
    tracked(pg, 'SETLIST', L, yy, F.sansBold, 7.5, K, 2.4); text(pg, cont ? '콘티 (계속)' : '콘티', L + 50, yy, F.sansBold, 9, K);
    rightText(pg, '쪽', R, yy, F.sansBold, 8, gray(0.4));
    yy -= 8; hline(pg, L, R, yy, 0.8, K);
    const cx = { no: L, title: L + 30, key: R - 190, bpm: R - 148, form: R - 112, pg: R };
    tracked(pg, 'KEY', cx.key, yy - 10, F.sansBold, 6.2, gray(0.45), 1.2);
    tracked(pg, 'BPM', cx.bpm, yy - 10, F.sansBold, 6.2, gray(0.45), 1.2);
    tracked(pg, 'FORM', cx.form, yy - 10, F.sansBold, 6.2, gray(0.45), 1.2);
    return { y: yy - 16, cx };
  };
  let hd = header(p, y, false); y = hd.y;
  let cx = hd.cx;
  songs.forEach((s, i) => {
    const sub = [s.kind === '결단' ? '설교 후 찬양' : '', clean(s.team)].filter(Boolean).join(' · ');
    const commentLines = clean(s.note) ? wrap(F.serif, clean(s.note).replace(/@/g, ''), 8.6, cx.key - cx.title - 10).slice(0, 6) : [];
    const rowH = 32 + (sub ? 0 : -3) + commentLines.length * 11.5 + (commentLines.length ? 3 : 0);
    const last = i === songs.length - 1;
    if (y - rowH < reserveBottom(last)) {
      p = addPage(); hline(p, L, R, H - 50, 1.2, K); y = H - 70; hd = header(p, y, true); y = hd.y; cx = hd.cx;
    }
    const top = y;
    text(p, s.kind === '결단' ? '+' : String(s.no).padStart(2, '0'), cx.no, top - 16, F.serifBold, 15, K);
    const tf = fit(F.serifBold, clean(s.title) || '제목 없음', 13, cx.key - cx.title - 10);
    text(p, tf.text, cx.title, top - 14, F.serifBold, tf.size, K);
    if (sub) text(p, sub, cx.title, top - 25, F.sans, 8, gray(0.4));
    text(p, clean(s.key) || '—', cx.key, top - 15, F.serifBold, 12, K);
    text(p, clean(s.bpm) || '—', cx.bpm, top - 15, F.serifBold, 12, K);
    const ff = fit(F.sans, clean(s.form) || '', 8, R - cx.form - 30);
    text(p, ff.text, cx.form, top - 14, F.sans, ff.size, gray(0.2));
    const pn = info.songStart && info.songStart[i];
    if (pn) rightText(p, String(pn), cx.pg, top - 15, F.serifBold, 11, K); else rightText(p, '악보 없음', cx.pg, top - 15, F.sans, 7, gray(0.5));
    const cy0 = top - (sub ? 37 : 27);
    commentLines.forEach((ln, li) => text(p, ln, cx.title, cy0 - li * 11.5, F.serif, 8.6, gray(0.3)));
    y = top - rowH;
    hline(p, L, R, y + 2, 0.35, gray(0.6));
  });

  // QR — 마지막 표지 쪽 아래
  if (needQr) {
    const qy = 62;
    drawQR(p, info.qrUrl, L, qy, QR);
    const tx = L + QR + 18;
    tracked(p, 'LISTEN', tx, qy + QR - 12, F.sansBold, 7.5, K, 2.4);
    text(p, '전곡 이어 듣기', tx, qy + QR - 30, F.serifBold, 15, K);
    text(p, '휴대폰 카메라로 스캔하면 유튜브가 이 콘티의 곡을', tx, qy + QR - 46, F.sans, 8.5, gray(0.3));
    text(p, '순서대로 이어서 재생해 줘요.', tx, qy + QR - 58, F.sans, 8.5, gray(0.3));
    if (info.qrCount) text(p, `${info.qrCount}곡 · YouTube`, tx, qy + 2, F.sansBold, 7.5, gray(0.4));
  }
  // 표지 꼬리말
  hline(p, L, R, 40, 0.5, gray(0.5));
  text(p, `${info.church} · ${info.team}`, L, 28, F.sans, 8, gray(0.3));
  return pages;
}

/* ---------- 전체 ---------- */
/**
 * info: { church, team, date, title, eventName, practice, members:[{pos,names}], songs:[{no,kind,title,team,key,bpm,form,note,sheets:[{buf,type,spec}]}],
 *         extra:[{title,sheets}], qrUrl, qrCount, crop }
 */
async function build(info, imagesToPdf) {
  const out = await PDFDocument.create();
  out.setTitle(`${info.team} ${dotDate(info.date)} 콘티`); out.setAuthor(info.church); out.setCreator('찬양방송팀 허브');
  const F = await loadFonts(out);
  const dateLabel = dotDate(info.date);

  // 1) 곡 쪽(표지는 나중에 앞에 끼움)
  const contentPages = [];                         // { page, song:i }
  const songStart = info.songs.map(() => null);
  const area = (first) => ({ x: MX, w: W - 2 * MX });
  const items = info.songs.map((s, i) => ({ s, i, sheets: s.sheets })).concat((info.extra || []).map((e) => ({ s: { no: 0, kind: '첨부', title: e.title, team: '', key: '', bpm: '', form: '', note: '' }, i: -1, sheets: e.sheets })));
  for (const it of items) {
    const pcs = await pieces(it.sheets, !!info.crop, imagesToPdf);
    if (!pcs.length) continue;
    for (let k = 0; k < pcs.length; k++) {
      const pg = out.addPage([W, H]);
      const first = k === 0;
      const o = { pageInSong: k + 1, pagesInSong: pcs.length };
      let yTop;
      if (it.i < 0) { // 첨부 악보 — 얇은 한 줄 머리말
        const s = it.s; text(pg, `첨부 악보 · ${clean(s.title)}`.slice(0, 60), SX, H - 34, F.serifBold, 10.5, K); hline(pg, SX, W - SX, H - 41, 0.7, K); yTop = H - 46;
      } else yTop = drawSongHeader(pg, F, it.s, first, o);
      const a = { x: SX, w: W - 2 * SX, top: yTop, h: yTop - (FOOT_Y + 16) };
      await drawPiece(out, pg, pcs[k], a);
      contentPages.push({ page: pg, song: it.i });
      if (first && it.i >= 0) songStart[it.i] = contentPages.length;     // 내용 쪽 번호(1부터) — 표지 쪽 수는 나중에 더함
    }
  }

  // 2) 표지 — 쪽 수를 먼저 세고(임시 문서에서), 실제로 앞에 끼움
  const scratch = await PDFDocument.create(); const SF = await loadFonts(scratch);
  const coverN = drawCover(() => scratch.addPage([W, H]), SF, Object.assign({}, info, { songStart: songStart.map((v) => (v ? v + 1 : null)) })).length;
  const starts = songStart.map((v) => (v ? v + coverN : null));
  drawCover((i) => out.insertPage(i, [W, H]), F, Object.assign({}, info, { songStart: starts }));

  // 3) 꼬리말
  const total = out.getPageCount();
  contentPages.forEach((c, idx) => drawFooter(c.page, F, { church: info.church, team: info.team, dateLabel, n: idx + 1 + coverN, total }));
  return Buffer.from(await out.save());
}

module.exports = { build, W, H };
