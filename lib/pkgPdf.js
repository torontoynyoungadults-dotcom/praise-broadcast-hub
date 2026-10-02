/**
 * 인쇄용 PDF 패키지 — US Letter · 흑백 · 표지 + 곡마다 (머리말 · 악보 · 꼬리말).
 *   표지 : 연습 일시 · 서는 멤버 · 콘티(순서 · 제목 · 원곡팀 · Key · BPM · 송폼 · 곡 설명 · 악보 페이지) · 유튜브 이어 듣기 QR
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
  const emb = (n) => doc.embedFont(fontBytes(n), { subset: false });      // (pdf-lib 의 한글 서브셋팅이 글자를 빠뜨려서 통째로 심음 — 그래서 글꼴 수를 최소화)
  const [light, sans, semi, bold] = await Promise.all([emb('Pretendard-Light-KR.ttf'), emb('Pretendard-Regular-KR.ttf'), emb('Pretendard-SemiBold-KR.ttf'), emb('Pretendard-Bold-KR.ttf')]);
  return { sans, sansBold: semi, sansLight: light, serif: sans, serifBold: bold };      // 전부 Pretendard 고딕 (명조 없음)
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

const DOW = ['주일', '월', '화', '수', '목', '금', '토'];
function dateParts(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
  return { y: +m[1], m: +m[2], d: +m[3], dow: DOW[d.getDay()], dowEn: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()], mon: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()] };
}
const dotDate = (ymd) => { const p = dateParts(ymd); return p ? `${p.y}.${String(p.m).padStart(2, '0')}.${String(p.d).padStart(2, '0')}` : ''; };
const koDate = (ymd) => { const p = dateParts(ymd); return p ? `${p.m}월 ${p.d}일 (${p.dow})` : ''; };

/** '자르기' 칸 → {l,t,r,b}(0~1) | null.  예전 값(숫자 하나)은 위쪽만 */
function parseCrop(v) {
  const a = String(v == null ? '' : v).split(',').map((x) => parseFloat(x));
  if (a.length === 1) return a[0] > 0 && a[0] < 0.9 ? { l: 0, t: a[0], r: 1, b: 1 } : null;
  if (a.length !== 4 || a.some((x) => !(x >= 0 && x <= 1))) return null;
  const c = { l: a[0], t: a[1], r: a[2], b: a[3] };
  if (c.r - c.l < 0.15 || c.b - c.t < 0.1) return null;
  return (c.l > 0 || c.t > 0 || c.r < 1 || c.b < 1) ? c : null;
}

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
    const uc = parseCrop(sh.crop);               // 사용자가 지정한 악보 영역 — 첫 쪽은 네 방향 모두, 나머지 쪽은 좌우만
    for (const no of want) {
      const page = src.getPage(no - 1);
      const cb = page.getCropBox();
      const d = det.find((x) => x.pageNo === no);
      const okDet = d && d.box && Math.abs(d.w - cb.width) < 3 && Math.abs(d.h - cb.height) < 3 && !(page.getRotation().angle % 360);
      let box = okDet ? d.box : null, hc = !!(okDet && d.headerCut);
      if (uc && !(page.getRotation().angle % 360)) {
        if (no === want[0]) { box = { left: uc.l, right: uc.r, top: uc.t, bottom: uc.b }; hc = true; }
        else box = Object.assign({ top: 0, bottom: 1 }, box || {}, { left: uc.l, right: uc.r });
      }
      out.push({ page, cb: { x: cb.x, y: cb.y, w: cb.width, h: cb.height }, box, headerCut: hc, srcDoc: src });
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
  rightText(page, `${o.dateLabel}   페이지 ${o.n} / ${o.total}`, W - SX, FOOT_Y, F.sans, 7, gray(0.3));
}

/** 머리말을 그리고 { yTop(악보를 올릴 영역의 위쪽 y), pn(페이지 번호를 나중에 적을 자리) } 를 돌려줌.
 *  첫 쪽: ① 번호 · 제목 – 원곡팀 ·········· KEY · BPM · 페이지   ② 송폼만 크고 또렷하게 한 줄   ③ 곡 설명(있으면) */
function drawSongHeader(page, F, s, first, o) {
  const top = H - 24;
  if (!first) {                                  // 이어지는 쪽 — 얇은 한 줄
    text(page, s.kind === '결단' ? '+' : String(s.no).padStart(2, '0'), SX, top - 11, F.serifBold, 11, K);
    const t = fit(F.serifBold, clean(s.title), 10.5, W - 2 * SX - 170);
    text(page, t.text, SX + 22, top - 10.5, F.serifBold, t.size, K);
    rightText(page, `계속 · ${o.pageInSong} / ${o.pagesInSong}`, W - SX - 70, top - 10, F.sans, 7, gray(0.4));
    hline(page, SX, W - SX, top - 17, 0.7, K);
    return { yTop: top - 22, pn: { x: W - SX, y: top - 10.5, small: true } };
  }
  const num = s.kind === '결단' ? '+' : String(s.no).padStart(2, '0');
  text(page, num, SX, top - 18, F.serifBold, 21, K);
  const tx = SX + 34;
  const cellW = [44, 52, 62], metaW = cellW[0] + cellW[1] + cellW[2];
  const bx = W - SX - metaW;
  // ① 제목 – 원곡팀
  const team = clean(s.team);
  const availT = bx - tx - 14;
  let ts = 17, tt = clean(s.title) || '제목 없음';
  const teamW = (sz) => (team ? F.sans.widthOfTextAtSize(' – ' + team, sz) : 0);
  while (ts > 12 && F.serifBold.widthOfTextAtSize(tt, ts) + teamW(Math.min(10.5, ts - 5)) > availT) ts -= 0.5;
  const tf = fit(F.serifBold, tt, ts, Math.max(60, availT - teamW(Math.min(10.5, ts - 5))));
  const tw = text(page, tf.text, tx, top - 15, F.serifBold, tf.size, K);
  if (team) text(page, ' – ' + team, tx + tw, top - 15, F.sans, Math.min(10.5, ts - 5), gray(0.3));
  // KEY · BPM · 페이지
  const cols = [['KEY', clean(s.key) || '—'], ['BPM', clean(s.bpm) || '—'], ['페이지', null]];
  let cx = bx;
  cols.forEach((c, i) => {
    if (i) page.drawLine({ start: { x: cx - 4, y: top - 3 }, end: { x: cx - 4, y: top - 25 }, thickness: 0.5, color: gray(0.5) });
    tracked(page, c[0], cx, top - 6, F.sansBold, 5.8, gray(0.4), c[0] === '페이지' ? 0.4 : 1.2);
    if (c[1] !== null) { const f = fit(F.serifBold, c[1], 15, cellW[i] - 10); text(page, f.text, cx, top - 21, F.serifBold, f.size, K); }
    cx += cellW[i];
  });
  const pn = { x: bx + cellW[0] + cellW[1], y: top - 21 };
  // ② 송폼 — 테두리 없이 굵은 글씨, 길면 2줄까지
  let y = top - 33;
  const formStr = clean(s.form).replace(/\s*[-–>→›]\s*/g, '  –  ');
  if (formStr) {
    const fl = wrap(F.sansBold, formStr, 10, W - 2 * SX).slice(0, 2);
    fl.forEach((ln, li) => text(page, ln, SX, y - 10 - li * 13, F.sansBold, 10, K));
    y -= fl.length * 13 + 5;
  }
  // ③ 곡 설명
  const note = clean(s.note).replace(/@/g, '');
  if (note) {
    const lines = wrap(F.sans, note, 8.6, W - 2 * SX).slice(0, 3);
    lines.forEach((ln, li) => text(page, ln, SX, y - 8 - li * 11, F.sans, 8.6, gray(0.25)));
    y -= lines.length * 11 + 5;
  }
  hline(page, SX, W - SX, y - 3, 1.3, K);
  return { yTop: y - 9, pn };
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
/** newPage(i) → 새 쪽. 돌려주는 값: 표지 쪽 수. info.songStart[i] = 그 곡의 시작 쪽(절대) — 모르면 null.
 *  k = 글씨 · 간격 배율 (한 쪽에 안 들어가면 build 가 k 를 줄여 다시 그림) */
function drawCover(newPage, F, info, k) {
  k = k || 1;
  const pages = [];
  const addPage = () => { const p = newPage(pages.length); pages.push(p); return p; };
  let p = addPage();
  const L = 48, R = W - 48, CW = R - L;
  const QR = Math.round(74 * Math.max(k, 0.85));        // 위쪽 오른쪽 (조금 작아도 스캔 잘 됨)
  const needQr = !!info.qrUrl;
  let y = H - 44;
  tracked(p, 'WORSHIP PACKET', L, y, F.sansBold, 7.5 * k, K, 2.6);
  rightText(p, info.church, R, y, F.sansBold, 8 * k, K);
  y -= 8; hline(p, L, R, y, 2, K); hline(p, L, R, y - 3.5, 0.5, K);
  const headTop = y - 8;                                   // 날짜 영역 시작
  // 날짜 · 제목 (왼쪽) / QR (오른쪽)
  const dp = dateParts(info.date);
  let dy = headTop - 28 * k;
  if (dp) {
    const ds = `${dp.m}월 ${dp.d}일`;
    text(p, ds, L, dy, F.serifBold, 28 * k, K);
    const mw = F.serifBold.widthOfTextAtSize(ds, 28 * k);
    text(p, (dp.dow === "주일" ? "주일" : dp.dow + "요일"), L + mw + 8, dy + 1, F.serif, 13 * k, gray(0.3));
    text(p, `${dp.y}`, L + mw + 8 + F.serif.widthOfTextAtSize((dp.dow === "주일" ? "주일" : dp.dow + "요일"), 13 * k) + 8, dy + 1, F.sansLight, 9 * k, gray(0.45));
  }
  dy -= 17 * k;
  text(p, info.title || '주일예배 찬양 콘티', L, dy, F.serif, 12.5 * k, K);
  dy -= 12 * k;
  text(p, info.team, L, dy, F.sans, 8.5 * k, gray(0.35));
  // 연습 · 예배 (날짜 아래, QR 왼쪽 폭 안에서 한 줄 두 칸)
  dy -= 15 * k;
  const infoRow = [];
  if (info.practice && info.practice.date && !info.practice.none) infoRow.push(['REHEARSAL  연습', koDate(info.practice.date), info.practice.note || '']);
  else if (info.practice && info.practice.none) infoRow.push(['REHEARSAL  연습', '연습 없음', '']);
  const tm = info.times || {};
  const wLines = [];
  if (info.eventName) wLines.push(info.eventName);
  if (tm.worship) wLines.push('예배 ' + tm.worship);
  if (tm.rehearsal) wLines.push('당일 리허설 ' + tm.rehearsal);
  infoRow.push(['WORSHIP  예배', koDate(info.date), wLines]);
  const leftW = CW - (needQr ? QR + 22 : 0);
  const cw = leftW / Math.max(1, infoRow.length);
  let maxLines = 0;
  infoRow.forEach((r, i) => {
    const x = L + i * cw + (i ? 12 : 0);
    if (i) p.drawLine({ start: { x: L + i * cw, y: dy + 6 * k }, end: { x: L + i * cw, y: dy - 29 * k }, thickness: 0.4, color: gray(0.5) });
    tracked(p, r[0], x, dy, F.sansBold, 6.2 * k, gray(0.4), 1.4);
    text(p, r[1], x, dy - 14 * k, F.serifBold, 11.5 * k, K);
    const lines = (Array.isArray(r[2]) ? r[2] : r[2] ? [r[2]] : []).slice(0, 3);
    lines.forEach((ln, li) => { const f = fit(F.sans, clean(ln), 8.2 * k, cw - 20); text(p, f.text, x, dy - (25 + li * 10.5) * k, F.sans, f.size, gray(0.3)); });
    maxLines = Math.max(maxLines, lines.length);
  });
  dy -= (32 + Math.max(0, maxLines - 1) * 10.5) * k;
  let y2 = dy;
  if (needQr) {
    const qx = R - QR, qTop = headTop - 2;
    drawQR(p, info.qrUrl, qx, qTop - QR, QR);
    const cap = '전곡 이어 듣기 · 스캔';
    const cs = 7 * k; rightText(p, cap, R, qTop - QR - 9 * k, F.sansBold, cs, gray(0.25));
    y2 = Math.min(y2, qTop - QR - 9 * k - 8 * k);
  }
  y = y2 - 4;
  hline(p, L, R, y, 0.5, gray(0.5));
  y -= 12 * k;

  // 서는 멤버 — 촘촘하게 4열
  const ORDER = ['인도자', '남성싱어', '여성싱어', '알토', '드럼', '베이스', '피아노', '신디', '일렉', '어쿠기타', '방송총괄', '음향', 'PPT'];      // 서는 멤버 표시 순서 (없는 포지션은 건너뜀)
  const ordIdx = (k) => { const i = ORDER.indexOf(k); return i < 0 ? 99 : i; };
  const mem = (info.members || []).filter((m) => m.names && m.names.length).slice().sort((a, b) => ordIdx(a.pos) - ordIdx(b.pos));
  if (mem.length) {
    tracked(p, 'TEAM', L, y, F.sansBold, 7 * k, K, 2.2); text(p, '서는 멤버', L + 34, y, F.sansBold, 8.5 * k, K);
    y -= 6; hline(p, L, R, y, 0.7, K); y -= 11 * k;
    const cols = 4, colW = CW / cols;
    const rowsN = Math.ceil(mem.length / cols);
    for (let r = 0; r < rowsN; r++) {
      let rowH = 0;
      for (let c = 0; c < cols; c++) {
        const m = mem[r * cols + c]; if (!m) continue;
        const x = L + c * colW;
        tracked(p, clean(m.pos), x, y, F.sansBold, 6.2 * k, gray(0.45), 0.6);
        const lines = wrap(F.sansBold, m.names.join(', '), 9.2 * k, colW - 10);
        lines.forEach((ln, li) => text(p, ln, x, y - 10.5 * k - li * 10.5 * k, F.sansBold, 9.2 * k, K));
        rowH = Math.max(rowH, 10.5 * k + lines.length * 10.5 * k);
      }
      y -= rowH + 5 * k;
    }
    y -= 2;
  }

  // 콘티 표
  const songs = info.songs || [];
  const reserveBottom = () => 46;
  const header = (pg, yy, cont) => {
    tracked(pg, 'SETLIST', L, yy, F.sansBold, 7 * k, K, 2.2); text(pg, cont ? '콘티 (계속)' : '콘티', L + 46, yy, F.sansBold, 8.5 * k, K);
    rightText(pg, '페이지', R, yy, F.sansBold, 7 * k, gray(0.4));
    yy -= 6; hline(pg, L, R, yy, 0.8, K);
    const cx = { no: L, title: L + 28, key: R - 140, bpm: R - 92, pg: R };
    tracked(pg, 'KEY', cx.key, yy - 9 * k, F.sansBold, 5.8 * k, gray(0.45), 1.1);
    tracked(pg, 'BPM', cx.bpm, yy - 9 * k, F.sansBold, 5.8 * k, gray(0.45), 1.1);
    return { y: yy - 13 * k, cx };
  };
  let hd = header(p, y, false); y = hd.y;
  let cx = hd.cx;
  songs.forEach((s, i) => {
    // 한 곡 = ① 번호 · 제목 – 원곡팀 · KEY · BPM · 페이지  ② 송폼(코드마다 회색 칩)  ③ 곡 설명(있으면)
    const team = clean(s.team);
    const titleW = cx.key - cx.title - 12;
    const CH = 14.5 * k, CG = 3.5 * k;               // 칩 높이 · 줄 간격
    const toks = String(s.form || '').split(/\s*[-–>→›,]\s*/).map((x) => clean(x).trim()).filter(Boolean).slice(0, 40);
    const chipRows = [];
    { let row = [], rx = 0; const maxW = CW - 28;
      toks.forEach((tk) => { const w = Math.max(20 * k, F.sansBold.widthOfTextAtSize(tk, 9.2 * k) + 12 * k); if (rx + w > maxW && row.length) { chipRows.push(row); row = []; rx = 0; } row.push({ tk, w, x: rx }); rx += w + 11 * k; });
      if (row.length) chipRows.push(row); }
    chipRows.length = Math.min(chipRows.length, 2);
    const noteLines = clean(s.note) ? wrap(F.sans, clean(s.note).replace(/@/g, ''), 8 * k, CW - 28).slice(0, 4) : [];
    const formH = chipRows.length ? chipRows.length * (CH + CG) : 0;
    const rowH = 21 * k + formH + (noteLines.length ? noteLines.length * 10 * k + 4 : 0) + 6 * k;
    if (y - rowH < reserveBottom()) {
      p = addPage(); hline(p, L, R, H - 50, 1.2, K); y = H - 70; hd = header(p, y, true); y = hd.y; cx = hd.cx;
    }
    const top = y;
    text(p, s.kind === '결단' ? '+' : String(s.no).padStart(2, '0'), cx.no, top - 14 * k, F.sansBold, 13 * k, K);
    const tmSz = 8.5 * k;
    const teamTxt = team ? ' – ' + team : '';
    const teamW = teamTxt ? F.sans.widthOfTextAtSize(teamTxt, tmSz) : 0;
    const tf = fit(F.sansBold, clean(s.title) || '제목 없음', 12 * k, Math.max(80, titleW - teamW));
    const tw = text(p, tf.text, cx.title, top - 13 * k, F.sansBold, tf.size, K);
    if (teamTxt) { const tt = fit(F.sans, teamTxt, tmSz, Math.max(20, titleW - tw)); text(p, tt.text, cx.title + tw, top - 13 * k, F.sans, tt.size, gray(0.35)); }
    if (s.kind === '결단') text(p, '설교 후 찬양', cx.title + tw + (teamTxt ? teamW + 6 : 6), top - 13 * k, F.sans, 7 * k, gray(0.45));
    text(p, clean(s.key) || '—', cx.key, top - 14 * k, F.sansBold, 11 * k, K);
    text(p, clean(s.bpm) || '—', cx.bpm, top - 14 * k, F.sansBold, 11 * k, K);
    const pn = info.songStart && info.songStart[i];
    if (pn) rightText(p, String(pn), cx.pg, top - 14 * k, F.sansBold, 11 * k, K); else rightText(p, '악보 없음', cx.pg, top - 14 * k, F.sans, 7 * k, gray(0.5));
    let ly = top - 20 * k;
    chipRows.forEach((row, ri) => {
      const cy = ly - ri * (CH + CG) - CH - CG / 2;
      row.forEach((c, ci) => {
        const x0 = cx.title + c.x, r = Math.min(4.5, CH / 3), bw = c.w, bh = CH;
        p.drawSvgPath(`M ${r} 0 H ${bw - r} Q ${bw} 0 ${bw} ${r} V ${bh - r} Q ${bw} ${bh} ${bw - r} ${bh} H ${r} Q 0 ${bh} 0 ${bh - r} V ${r} Q 0 0 ${r} 0 Z`, { x: x0, y: cy + bh, color: gray(0.9), borderWidth: 0 });
        text(p, c.tk, x0 + (bw - F.sansBold.widthOfTextAtSize(c.tk, 9.2 * k)) / 2, cy + bh * 0.3, F.sansBold, 9.2 * k, K);
        if (ci < row.length - 1) { const ax = x0 + bw + 2.6 * k; p.drawLine({ start: { x: ax, y: cy + bh / 2 }, end: { x: ax + 6 * k, y: cy + bh / 2 }, thickness: 1, color: gray(0.35) }); }
      });
    });
    if (chipRows.length) ly -= formH;
    if (noteLines.length) { ly -= 2; noteLines.forEach((ln) => { text(p, ln, cx.title, ly - 8 * k, F.sans, 8 * k, gray(0.32)); ly -= 10 * k; }); }
    y = top - rowH;
    hline(p, L, R, y + 2, 0.35, gray(0.6));
  });

  // 표지 꼬리말
  hline(p, L, R, 40, 0.5, gray(0.5));
  text(p, `${info.church} · ${info.team}`, L, 28, F.sans, 8, gray(0.3));
  return pages;
}

/** 표지가 한 쪽에 들어가는 가장 큰 배율을 찾음 (끝까지 안 되면 가장 작은 배율로 두 쪽) */
function fitCover(F, info) {
  const dummy = () => ({ drawText() {}, drawLine() {}, drawRectangle() {}, drawPage() {}, drawSvgPath() {} });
  const ks = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.66, 0.62];
  for (const k of ks) { if (drawCover(() => dummy(), F, info, k).length === 1) return { k, n: 1 }; }
  const k = ks[ks.length - 1];
  return { k, n: drawCover(() => dummy(), F, info, k).length };
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
  const prog = info.onProgress || (() => {});
  let doneItems = 0;
  for (const it of items) {
    prog(0.3 + 0.6 * (doneItems / Math.max(1, items.length)), it.i >= 0 ? `악보 정리 중 (${doneItems + 1}/${items.length}) ${clean(it.s.title).slice(0, 14)}` : '악보 정리 중');
    doneItems++;
    const pcs = await pieces(it.sheets, !!info.crop, imagesToPdf);
    if (!pcs.length) continue;
    for (let k = 0; k < pcs.length; k++) {
      const pg = out.addPage([W, H]);
      const first = k === 0;
      const o = { pageInSong: k + 1, pagesInSong: pcs.length };
      let yTop, pnPos = null;
      if (it.i < 0) { // 첨부 악보 — 얇은 한 줄 머리말
        const s = it.s; text(pg, `첨부 악보 · ${clean(s.title)}`.slice(0, 60), SX, H - 34, F.serifBold, 10.5, K); hline(pg, SX, W - SX, H - 41, 0.7, K); yTop = H - 46;
      } else { const hd = drawSongHeader(pg, F, it.s, first, o); yTop = hd.yTop; pnPos = hd.pn; }
      const a = { x: SX, w: W - 2 * SX, top: yTop, h: yTop - (FOOT_Y + 16) };
      await drawPiece(out, pg, pcs[k], a);
      contentPages.push({ page: pg, song: it.i, pn: pnPos });
      if (first && it.i >= 0) songStart[it.i] = contentPages.length;     // 내용 쪽 번호(1부터) — 표지 쪽 수는 나중에 더함
    }
  }

  prog(0.92, '표지 만드는 중');
  // 2) 표지 — 한 쪽에 들어가는 가장 큰 글씨 배율을 찾아 앞에 끼움
  const guess = Object.assign({}, info, { songStart: songStart.map((v) => (v ? v + 1 : null)) });
  const fc = fitCover(F, guess);
  const coverN = fc.n;
  const starts = songStart.map((v) => (v ? v + coverN : null));
  drawCover((i) => out.insertPage(i, [W, H]), F, Object.assign({}, info, { songStart: starts }), fc.k);

  // 3) 꼬리말
  const total = out.getPageCount();
  contentPages.forEach((c, idx) => {
    const n = idx + 1 + coverN;
    drawFooter(c.page, F, { church: info.church, team: info.team, dateLabel, n, total });
    if (c.pn && !c.pn.small) {                                  // 머리말의 페이지 번호 칸
      const w1 = text(c.page, String(n), c.pn.x, c.pn.y, F.serifBold, 15, K);
      text(c.page, ` / ${total}`, c.pn.x + w1, c.pn.y, F.sans, 8, gray(0.4));
    }
  });
  return Buffer.from(await out.save());
}

const LAYOUT_V = 7;                              // 디자인을 바꾸면 올림 — 확정해 둔 PDF 가 "옛 디자인"으로 표시됨
module.exports = { parseCrop, build, W, H, LAYOUT_V };
