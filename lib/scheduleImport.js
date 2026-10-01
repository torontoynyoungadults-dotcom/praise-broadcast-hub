/**
 * 스케줄 엑셀 가져오기 — 미리 짜 둔 편성표(.xlsx)를 스케줄표(찬양편성)와 불참(불가일정)으로 옮깁니다.
 *
 * 엑셀 모양 (헤더: 날짜 · 포지션 · 이름)
 *   · 포지션이 피아노 · 신디 · 인도자 · 여성싱어 …  → 그 날짜의 편성 한 칸 (한 줄에 한 사람)
 *   · 포지션이 "비고(불참/기타)" · "불참" 인 줄의 이름 칸 = 메모 글  ("조희 연습X, 다현x 지원 x (휴가)")
 *       "이름 + X" 를 불참으로 읽고, 이름 앞뒤에 "연습" 이 붙으면 금요일 연습만 불참, 아니면 연습 · 주일 모두 불참
 *   · 이름은 두 글자(이름만, 또는 성+이름 첫 글자)여도 팀원 명단에서 찾아 맞춥니다 (조희 → 조희영, 지원 → 정지원)
 *     같은 두 글자가 여러 사람이면 "그 날 편성에 없는 사람" → "편성에 많이 나오는 사람" 순으로 고르고 "추정" 으로 표시합니다.
 *   · 날짜는 'YYYY-MM-DD' · 엑셀 날짜 · 엑셀 날짜 번호(46026) 모두 읽습니다. 주일이 아닌 날짜는 건너뜁니다.
 */
const week = require('./weekUtil');
const { readXlsx, serialToDate } = require('./xlsxLite');
const { canonicalPosition, ALL_POSITIONS } = require('./positions');

const MULTI = new Set(['남성싱어', '여성싱어', '알토']);
const POS_ALIAS = {
  '남싱': '남성싱어', '남성': '남성싱어', '남자싱어': '남성싱어', '남성 싱어': '남성싱어',
  '여싱': '여성싱어', '여성': '여성싱어', '여자싱어': '여성싱어', '여성 싱어': '여성싱어',
  '건반': '피아노', '키보드': '피아노', '신스': '신디', '신디사이저': '신디', '일렉기타': '일렉', '일렉트릭': '일렉',
  '어쿠스틱': '어쿠기타', '어쿠스틱기타': '어쿠기타', '어쿠': '어쿠기타', '리더': '인도자', '인도': '인도자', '찬양인도': '인도자',
  'ppt': 'PPT', 'Ppt': 'PPT', '피피티': 'PPT', '사운드': '음향', '엔지니어': '음향',
};
function normPosition(p) {
  p = String(p == null ? '' : p).trim();
  if (!p) return '';
  const a = POS_ALIAS[p] || POS_ALIAS[p.toLowerCase()] || p;
  const c = canonicalPosition(a);
  return ALL_POSITIONS.includes(c) ? c : '';
}

function parseDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return v > 30000 && v < 80000 ? serialToDate(v) : '';
  const s = String(v).trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = /^\d{5}$/.exec(s);
  if (m) return parseDate(Number(s));
  return '';
}
const isSunday = (d) => new Date(d + 'T12:00:00').getDay() === 0;

/** 엑셀 → { assign:[{date,pos,name,row}], notes:[{date,text,row}], direct:[{date,name,part,row}], skipped:[{row,why}] } */
function parseWorkbook(buf) {
  const sheets = readXlsx(buf);
  const out = { assign: [], notes: [], direct: [], skipped: [], sheets: sheets.map((s) => s.name) };
  sheets.forEach((sh) => {
    let head = -1, cDate = 0, cPos = 1, cName = 2;
    for (let i = 0; i < Math.min(sh.rows.length, 5); i++) {
      const r = sh.rows[i].map((x) => String(x == null ? '' : x).trim());
      if (r.includes('날짜') && (r.includes('이름') || r.includes('포지션'))) { head = i; cDate = r.indexOf('날짜'); cPos = r.includes('포지션') ? r.indexOf('포지션') : 1; cName = r.includes('이름') ? r.indexOf('이름') : 2; break; }
    }
    for (let i = head + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i];
      const rawDate = r[cDate], pos = String(r[cPos] == null ? '' : r[cPos]).trim(), name = String(r[cName] == null ? '' : r[cName]).trim();
      if ((rawDate === '' || rawDate == null) && !pos && !name) continue;
      const where = `${sh.name} ${i + 1}행`;
      const date = parseDate(rawDate);
      if (!date) { out.skipped.push({ row: where, why: '날짜를 읽을 수 없음' }); continue; }
      if (/^비고|^기타|^메모/.test(pos)) { if (name) out.notes.push({ date, text: name, row: where }); continue; }
      if (/^불참|^연습불참|^주일불참/.test(pos)) {
        if (name) out.direct.push({ date, name, part: /연습/.test(pos) ? 'prac' : (/주일|예배/.test(pos) ? 'sun' : 'all'), row: where });
        continue;
      }
      const p = normPosition(pos);
      if (!p) { out.skipped.push({ row: where, why: `알 수 없는 포지션 "${pos}"` }); continue; }
      if (!name) { out.skipped.push({ row: where, why: '이름이 비어 있음' }); continue; }
      out.assign.push({ date, pos: p, name, row: where });
    }
  });
  return out;
}

/* ============================================================ 이름 맞추기 */
function buildResolver(knownNames, assign) {
  const roster = new Set(Array.from(knownNames).map((n) => String(n).trim()).filter(Boolean));
  const known = new Set(roster);
  assign.forEach((a) => known.add(a.name));
  const freq = new Map();                                   // 편성에 나온 횟수 (같은 두 글자가 여럿일 때 고르는 힌트)
  const byDate = new Map();                                 // 날짜 → 그 날 편성된 사람들
  assign.forEach((a) => {
    freq.set(a.name, (freq.get(a.name) || 0) + 1);
    (byDate.get(a.date) || byDate.set(a.date, new Set()).get(a.date)).add(a.name);
  });
  const index = new Map();                                  // 짧은 이름 → 사람들
  const put = (k, n) => { if (!k || k.length < 2) return; (index.get(k) || index.set(k, new Set()).get(k)).add(n); };
  known.forEach((n) => { put(n, n); if (n.length >= 3) { put(n.slice(1), n); put(n.slice(0, 2), n); } });

  /** → { name, status:'ok'|'guess'|'unknown'|'ambiguous', cands } */
  function resolve(token, date, forAbsence) {
    token = String(token || '').trim();
    if (!token) return { name: '', status: 'unknown', cands: [] };
    if (roster.has(token) || (token.length >= 3 && known.has(token))) return { name: token, status: 'ok', cands: [token] };
    let cands = Array.from(index.get(token) || []).filter((n) => n !== token);
    if (!cands.length) return known.has(token) ? { name: token, status: 'unknown', cands: [] } : { name: '', status: 'unknown', cands: [] };
    if (cands.length === 1) return { name: cands[0], status: 'ok', cands };
    let pool = cands;
    if (forAbsence && date && byDate.has(date)) {
      const free = pool.filter((n) => !byDate.get(date).has(n));
      if (free.length >= 1) pool = free;
    }
    if (pool.length > 1) {
      const top = Math.max(...pool.map((n) => freq.get(n) || 0));
      const best = pool.filter((n) => (freq.get(n) || 0) === top);
      if (best.length === 1) return { name: best[0], status: 'guess', cands };
      return { name: '', status: 'ambiguous', cands };
    }
    return { name: pool[0], status: 'guess', cands };
  }
  /** "중규희영" 처럼 붙여 쓴 것을 이름들로 쪼갬 */
  function split(token) {
    token = String(token || '').trim();
    if (known.has(token) || index.has(token)) return [token];
    const memo = new Map();
    const go = (s) => {
      if (!s) return [];
      if (memo.has(s)) return memo.get(s);
      let res = null;
      for (let len = Math.min(3, s.length); len >= 2 && !res; len--) {
        const head = s.slice(0, len);
        if (known.has(head) || index.has(head)) { const rest = go(s.slice(len)); if (rest) res = [head].concat(rest); }
      }
      memo.set(s, res);
      return res;
    };
    return go(token) || [token];
  }
  return { resolve, split, known, index, freq };
}

/** 메모 글 → [{ raw, part:'all'|'prac', reason }]  ("이름 X" 만 불참으로 읽음) */
function parseNote(text) {
  const out = [];
  let s = String(text || '');
  s = s.replace(/연습/g, '~').replace(/[×✕✗]/g, 'x');
  const re = /([가-힣]{2,8})\s*(~)?\s*[xX](?![A-Za-z])\s*(?:\(([^)]{1,20})\))?/g;
  let m;
  while ((m = re.exec(s))) {
    let word = m[1], prac = !!m[2], reason = m[3] ? m[3].trim() : '';
    if (/휴가$/.test(word)) { word = word.slice(0, -2); reason = reason || '휴가'; }
    if (/^휴가/.test(word)) { word = word.slice(2); reason = reason || '휴가'; }
    // "조희 휴가x" 처럼 이름과 x 사이에 낱말이 끼면 앞 낱말이 이름
    if (word.length < 2) continue;
    out.push({ raw: word, part: prac ? 'prac' : 'all', reason });
  }
  // "조희 휴가x" → 위 정규식은 '휴가' 만 잡으므로, 이름 + 휴가 + x 를 따로 처리
  const re2 = /([가-힣]{2,4})\s+(휴가)\s*[xX]/g;
  while ((m = re2.exec(String(text || '').replace(/연습/g, '~').replace(/[×✕✗]/g, 'x')))) {
    if (!out.some((o) => o.raw === m[1])) out.push({ raw: m[1], part: 'all', reason: '휴가' });
  }
  return out;
}

/** "2026-02-08 지혜 주일 / 2026-02-06 지혜 연습" 같은 직접 입력 줄 → direct */
function parseManualLines(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    line = line.trim(); if (!line) return;
    const m = /^(\d{4}[-./]\d{1,2}[-./]\d{1,2})\s+(\S+)(?:\s+(.*))?$/.exec(line);
    let date = m ? parseDate(m[1]) : '';
    if (!m || !date) return;
    const extra = String(m[3] || '');
    let part = /연습|금/.test(extra) ? 'prac' : (/주일|예배/.test(extra) ? 'sun' : 'all');
    const dow = new Date(date + 'T12:00:00').getDay();
    if (dow >= 4 || dow === 5) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + (7 - dow) % 7); date = d.toISOString().slice(0, 10); if (dow !== 0 && part === 'all') part = 'prac'; }   // 금요일 연습 날짜를 적으면 그 주일의 연습 불참으로
    out.push({ date, name: m[2], part, row: `직접 입력 ${i + 1}줄` });
  });
  return out;
}

/**
 * 분석 — 이름 맞추기까지 해서 미리보기 자료를 만듭니다.
 * @param {object} parsed parseWorkbook 결과
 * @param {{known:Iterable<string>, from?:string, manual?:string}} opts
 */
function analyze(parsed, opts) {
  const from = opts.from || '';
  const resolver = buildResolver(opts.known || [], parsed.assign);
  const skipped = parsed.skipped.slice();
  const take = (date, what) => {
    if (from && date < from) return false;
    if (!isSunday(date)) { skipped.push({ row: what, why: `${date} 은(는) 주일이 아니라 건너뜀` }); return false; }
    return true;
  };
  let before = 0;
  const assign = [];
  const seen = new Set();
  parsed.assign.forEach((a) => {
    if (from && a.date < from) { before++; return; }
    if (!take(a.date, a.row)) return;
    const r = resolver.resolve(a.name, a.date, false);
    const name = r.name || a.name;
    const key = [a.date, a.pos, name].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    assign.push({ date: a.date, pos: a.pos, raw: a.name, name, status: r.status === 'unknown' ? 'unknown' : (r.status === 'ok' && a.name !== name ? 'mapped' : r.status), cands: r.cands });
  });

  // 불참
  const abs = [];
  const addAbs = (date, raw, part, reason, row, forceName) => {
    if (!take(date, row)) { return; }
    const r = forceName ? { name: forceName, status: 'ok', cands: [forceName] } : resolver.resolve(raw, date, part === 'all');
    abs.push({ date, raw, part, reason: reason || '', name: r.name, status: r.status === 'ok' && raw !== r.name ? 'mapped' : r.status, cands: r.cands, row });
  };
  parsed.notes.forEach((n) => {
    if (from && n.date < from) return;
    const found = parseNote(n.text);
    found.forEach((f) => resolver.split(f.raw).forEach((piece) => addAbs(n.date, piece, f.part, f.reason, n.row)));
    n.found = found.length;
  });
  parsed.direct.concat(parseManualLines(opts.manual)).forEach((d) => {
    if (from && d.date < from) return;
    addAbs(d.date, d.name, d.part, '', d.row);
  });
  // 같은 사람 · 같은 날 겹치면 합치기 (한쪽이 둘 다면 둘 다)
  const merged = new Map();
  abs.forEach((a) => {
    const k = a.date + '|' + (a.name || a.raw);
    const prev = merged.get(k);
    if (!prev) { merged.set(k, Object.assign({}, a)); return; }
    if (prev.part !== a.part) prev.part = 'all';
    if (!prev.reason && a.reason) prev.reason = a.reason;
  });
  const absences = Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date) || a.raw.localeCompare(b.raw, 'ko'));

  // 이름 점검표 — 같은 "엑셀 표기" 는 한 줄로 (고쳐 쓰면 모든 곳에 적용)
  const names = new Map();
  const note = (raw, where, r) => {
    const e = names.get(raw) || { raw, name: r.name, status: r.status, cands: r.cands, count: 0, where };
    e.count++; names.set(raw, e);
  };
  assign.forEach((a) => { if (a.status !== 'ok') note(a.raw, '편성', { name: a.name, status: a.status, cands: a.cands }); });
  absences.forEach((a) => { if (a.status !== 'ok') note(a.raw, '불참', { name: a.name, status: a.status, cands: a.cands }); });
  const rank = { unknown: 0, ambiguous: 1, guess: 2, mapped: 3 };
  const nameList = Array.from(names.values()).sort((a, b) => (rank[a.status] - rank[b.status]) || a.raw.localeCompare(b.raw, 'ko'));
  const dates = Array.from(new Set(assign.map((a) => a.date))).sort();
  return { assign, absences, names: nameList, skipped, before, dates, notes: parsed.notes.filter((n) => !from || n.date >= from) };
}

/**
 * 반영 계획 — 지금 시트 내용과 비교해 무엇을 더하고 건너뛰는지.
 * @param {object} an analyze 결과
 * @param {{map:object, mode:'fill'|'replace', existingAssign:object[], existingOff:object[], team:string}} o  map: 엑셀 표기 → 고친 이름('' = 건너뜀)
 */
function plan(an, o) {
  const map = o.map || {};
  const fix = (raw, name) => (Object.prototype.hasOwnProperty.call(map, raw) ? String(map[raw] || '').trim() : name);
  const exist = new Map();                                   // 날짜|포지션 → [{name,__row}]
  o.existingAssign.filter((r) => r['팀ID'] === o.team && !r['행사ID']).forEach((r) => {
    const k = r['날짜'] + '|' + canonicalPosition(String(r['포지션'] || '').trim());
    (exist.get(k) || exist.set(k, []).get(k)).push({ name: String(r['이름'] || '').trim(), row: r.__row });
  });
  const wantBy = new Map();
  an.assign.forEach((a) => {
    const name = fix(a.raw, a.name);
    if (!name) return;
    const k = a.date + '|' + a.pos;
    const list = wantBy.get(k) || wantBy.set(k, []).get(k);
    if (!list.includes(name)) list.push(name);
  });
  const add = [], del = [], keep = [], conflict = [];
  wantBy.forEach((names, k) => {
    const [date, pos] = k.split('|');
    const have = exist.get(k) || [];
    if (o.mode === 'replace') {
      have.forEach((h) => { if (!names.includes(h.name)) del.push({ date, pos, name: h.name, row: h.row }); });
      names.forEach((n) => { if (have.some((h) => h.name === n)) keep.push({ date, pos, name: n }); else add.push({ date, pos, name: n }); });
    } else {
      names.forEach((n) => {
        if (have.some((h) => h.name === n)) { keep.push({ date, pos, name: n }); return; }
        if (!MULTI.has(pos) && have.length) { conflict.push({ date, pos, name: n, have: have.map((h) => h.name).join(', ') }); return; }
        add.push({ date, pos, name: n });
      });
    }
  });
  // 불참 — 같은 사람 · 날짜에 이미 같은(또는 더 넓은) 불참이 있으면 건너뜀
  const offHave = new Map();
  o.existingOff.filter((r) => r['팀ID'] === o.team).forEach((r) => {
    const k = String(r['날짜']) + '|' + String(r['이름']);
    const part = { '': 'all', '연습': 'prac', '예배': 'sun' }[String(r['구분'] || '').trim()] || 'all';
    const e = offHave.get(k) || offHave.set(k, { prac: false, sun: false }).get(k);
    if (part !== 'sun') e.prac = true; if (part !== 'prac') e.sun = true;
  });
  const off = [], offKeep = [];
  an.absences.forEach((a) => {
    const name = fix(a.raw, a.name);
    if (!name) return;
    const h = offHave.get(a.date + '|' + name) || { prac: false, sun: false };
    const needPrac = a.part !== 'sun', needSun = a.part !== 'prac';
    if ((!needPrac || h.prac) && (!needSun || h.sun)) { offKeep.push({ date: a.date, name }); return; }
    off.push({ date: a.date, name, part: a.part, reason: a.reason || '불참' });
  });
  return { add, del, keep, conflict, off, offKeep };
}

module.exports = { parseWorkbook, analyze, plan, parseNote, parseManualLines, buildResolver, normPosition, parseDate };
