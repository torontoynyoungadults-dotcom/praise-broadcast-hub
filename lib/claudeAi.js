/**
 * V873 — 라이브 악보 Claude AI (한윤종 님 계정에서만)
 * ------------------------------------------------------------
 * · API 키는 서버 환경 변수 ANTHROPIC_API_KEY 에만 둡니다 (화면 · 코드 · GitHub 에는 없음).
 * · 쓸 수 있는 사람: 로그인한 사람의 이메일이 CLAUDE_ALLOW_EMAILS (기본 hanyj123@gmail.com) 에 있거나,
 *   이메일이 비어 있는 계정이면 이름이 CLAUDE_ALLOW_NAMES (기본 한윤종) 에 있을 때만. 다른 분에게는 단추도 보이지 않고, 서버도 거절합니다.
 * · 하루 사용 한도 CLAUDE_DAILY_LIMIT (기본 80번) · 모델 CLAUDE_MODEL (기본 claude-sonnet-5-5)
 *
 * 하는 일 (task)
 *   status : 쓸 수 있는지 { allowed, enabled, left }
 *   chords : 악보 그림에서 코드를 모두 읽어 위치와 함께 (자동 인식이 놓친 코드 채우기)
 *   chart  : 곡의 페이지들을 ChordPro (가사 + 코드) 로 옮겨 적기 — 키 바꾸기는 화면에서
 *   info   : Key · BPM · 박자 · 송폼 읽기
 *   ask    : 악보를 보며 묻고 답하기
 *   labels : (화질 보정) 코드 · 제목 · Key · 섹션 글자와 자리 — 깨끗한 글자로 다시 쓰기
 *   engrave: (화질 보정 · 실험) 악보 전체를 ABC 악보 글로 — 화면에서 새로 그림
 */
'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';
const list = (v, d) => String(v == null || v === '' ? d : v).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

function allowed(u) {
  if (!u || u.ro || u.guest) return false;
  const email = String(u.email || '').trim().toLowerCase(), name = String(u.name || '').trim().toLowerCase();
  if (email) return list(process.env.CLAUDE_ALLOW_EMAILS, 'hanyj123@gmail.com').includes(email);
  return !!name && list(process.env.CLAUDE_ALLOW_NAMES, '한윤종').includes(name);
}
function enabled() { return !!String(process.env.ANTHROPIC_API_KEY || '').trim(); }

let day = '', used = 0;
function limit() { const n = parseInt(process.env.CLAUDE_DAILY_LIMIT || '80', 10); return isFinite(n) && n > 0 ? n : 80; }
function left() { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; used = 0; } return Math.max(0, limit() - used); }
function spend() { left(); used++; }

const IMG_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
function imgBlock(dataUrl) {
  const m = IMG_RE.exec(String(dataUrl || ''));
  if (!m) throw new Error('악보 그림을 읽지 못했습니다.');
  if (m[2].length > 5.5e6) throw new Error('악보 그림이 너무 큽니다.');
  return { type: 'image', source: { type: 'base64', media_type: 'image/' + m[1], data: m[2] } };
}
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, n);

async function callClaude({ system, messages, maxTokens, full, maxMs, noThink }) {
  const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('서버에 Claude API 키가 아직 없습니다 (Render 환경 변수 ANTHROPIC_API_KEY).');
  if (left() <= 0) throw new Error('오늘 Claude 사용 한도를 다 썼습니다. 내일 다시 써 주세요.');
  spend();
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), maxMs || 120000);
  try {
    const send = (think) => fetch(API_URL, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(Object.assign({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: maxTokens || 2000, system, messages }, think ? { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } } : {}))       // Sonnet 5.5: 시작 전 생각 없이 · 생각 양 적게 (끄기 'disabled' 는 없음)
    });
    noThink = noThink !== false;                                                                       // 생각(thinking) 없이 바로 답만 — 출력 한도를 생각에 다 쓰지 않게
    let r = await send(noThink), j = await r.json().catch(() => ({}));
    if (!r.ok && noThink && r.status === 400 && /thinking|output_config|effort/i.test(JSON.stringify(j))) { r = await send(false); j = await r.json().catch(() => ({})); }   // 이 모델이 thinking 설정을 받지 않으면 빼고 다시
    if (!r.ok) {
      const msg = (j && j.error && j.error.message) || ('HTTP ' + r.status);
      if (r.status === 401) throw new Error('Claude API 키가 맞지 않습니다 (Render 환경 변수를 확인해 주세요).');
      if (r.status === 429 || r.status === 529) throw new Error('Claude 가 지금 바쁩니다. 잠시 뒤 다시 눌러 주세요.');
      throw new Error('Claude 오류: ' + msg);
    }
    const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const diag = { stop: j.stop_reason || '', out: j.usage && j.usage.output_tokens, think: j.usage && j.usage.output_tokens_details && j.usage.output_tokens_details.thinking_tokens, blocks: (j.content || []).map((c) => c.type).join(','), chars: text.length };
    if (diag.stop !== 'end_turn') console.warn('[claude]', JSON.stringify(diag));
    return full ? { text, stop: diag.stop, diag } : text;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Claude 응답이 너무 오래 걸려 멈췄습니다. 다시 눌러 주세요.');
    throw e;
  } finally { clearTimeout(t); }
}

/** V875 — Claude 가 원하는 형식으로 답하지 않았을 때: 그 답을 짧게 보여 주며 이유를 알려 줌 */
const REFUSE_RE = /copyright|copyrighted|reproduc|lyrics|can['’]?t|cannot|unable|not able|I['’]m sorry|I apologi|저작권|죄송|할 수 없/i;
function whyNot(text, stop, what, diag) {
  const t = String(text || '').replace(/\s+/g, ' ').trim(), snip = t.length > 220 ? t.slice(0, 220) + '…' : t;
  const dg = diag ? ' (출력 ' + (diag.out || '?') + '토큰' + (diag.think ? ' 중 생각 ' + diag.think : '') + ' · ' + (diag.blocks || '-') + ' · 글자 ' + (diag.chars || 0) + ')' : '';
  if (stop === 'max_tokens') return new Error(what + ' — Claude 가 악보를 쓰기 전에 출력 한도에 닿았어요. 다시 한 번 눌러 보고, 계속 그러면 알려 주세요.' + dg + (snip ? '\nClaude 답: ' + snip : ''));
  if (stop === 'refusal' || REFUSE_RE.test(t)) return new Error(what + ' — Claude 가 이 곡을 그대로 옮겨 적는 것을 거절했어요. 저작권이 있는 곡의 가사 · 멜로디 전체는 옮겨 적지 않는 경우가 있어요 (저작권이 끝난 찬송가 · 팀이 직접 만든 편곡은 보통 돼요). 이 곡은 「+ 코드 · 제목 다시 쓰기」를 써 주세요.' + (snip ? '\nClaude 답: ' + snip : ''));
  return new Error(what + ' — Claude 답이 악보 형식이 아니었어요.' + (snip ? '\nClaude 답: ' + snip : '(빈 답)'));
}
function jsonOf(text) {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Claude 답을 읽지 못했습니다. 다시 눌러 주세요.');
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('Claude 답을 읽지 못했습니다. 다시 눌러 주세요.'); }
}

const SHEET_CTX = 'The image is one page of a worship-team lead sheet: a single melody staff with chord symbols printed above it and (usually Korean) lyrics under it. It may also contain a title, a "Key" label, tempo, section labels (Verse/V1, Chorus/C, Bridge/B, Intro, Interlude, Outro, Pre-chorus...) and repeat marks.';

const TASKS = {
  async chords(p) {
    const known = (Array.isArray(p.known) ? p.known : []).slice(0, 160).map((c) => ({ t: clip(c.t, 14), x: +(+c.x).toFixed(3), y: +(+c.y).toFixed(3) }));
    const text = SHEET_CTX + '\n\nList EVERY chord symbol printed on this page, in reading order (left to right, top to bottom). Ignore lyrics, titles, section labels, rehearsal letters, fingering and bar numbers.' +
      '\nFor each chord give its text exactly as printed (e.g. G, Am7, D/F#, Bbmaj7, Csus4, E7(b9)) and the position of the CENTER of the chord text as fractions of the image width (x) and height (y), 0..1 from the top-left corner. Be precise about positions.' +
      (known.length ? '\nAn automatic reader already found these (positions in the same units; it may have missed or misread some): ' + JSON.stringify(known) : '') +
      '\nAnswer with JSON only: {"chords":[{"t":"G","x":0.123,"y":0.234}, ...]}';
    const out = await callClaude({ system: 'You read chord symbols from sheet-music images with great care. You answer with strict JSON only.', maxTokens: 4000,
      messages: [{ role: 'user', content: [imgBlock(p.image), { type: 'text', text }] }] });
    const j = jsonOf(out);
    const chords = (Array.isArray(j.chords) ? j.chords : []).map((c) => ({ t: clip(c && c.t, 16).trim(), x: +c.x, y: +c.y }))
      .filter((c) => c.t && isFinite(c.x) && isFinite(c.y) && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1).slice(0, 300);
    return { chords };
  },
  async chart(p) {
    const imgs = (Array.isArray(p.images) ? p.images : []).slice(0, 4);
    if (!imgs.length) throw new Error('악보 그림이 없습니다.');
    const text = SHEET_CTX + (imgs.length > 1 ? ' The ' + imgs.length + ' images are consecutive pages of the same song.' : '') +
      '\n\nTranscribe the whole song into ChordPro format, keeping every chord EXACTLY as printed (do not transpose).' +
      '\nRules: first lines {title: ...} and {key: ...} (the printed key, or your best reading from the key signature and chords).' +
      ' Mark each section with {comment: <label as printed, e.g. Verse 1, Chorus, Bridge, Intro>}.' +
      ' Put each chord in square brackets immediately before the lyric syllable where it is played, e.g. [G]주 님의 [D/F#]사랑. Keep the lyrics exactly as printed (Korean as-is), one printed system/line per line.' +
      ' For bars without lyrics (intro, interlude, ending) write the chords on one line like: [G] [C] [D] [G].' +
      ' Write repeats out as printed (you may add {comment: x2} when a repeat sign or "2x" is printed). Output ChordPro only, no explanation.' +
      (p.title ? '\nSong title from the setlist: ' + clip(p.title, 80) : '');
    const content = imgs.map(imgBlock).concat([{ type: 'text', text }]);
    const r = await callClaude({ system: 'You are an expert music copyist for church worship teams. You transcribe lead sheets into clean ChordPro.', maxTokens: 8000, maxMs: 180000, full: true, messages: [{ role: 'user', content }] });
    const cp = String(r.text || '').replace(/^```[a-z]*\s*|```\s*$/g, '').trim();
    if (!/\[[A-G][^\]]{0,10}\]/.test(cp)) throw whyNot(r.text, r.stop, '코드 악보를 만들지 못했어요');
    return { chordpro: cp, truncated: r.stop === 'max_tokens' };
  },
  async info(p) {
    const text = SHEET_CTX + '\n\nRead the song information from this page.' +
      '\n- key: the printed key (e.g. "G", "Bb", "F#m") — from a "Key" label, else from the key signature and the chords.' +
      '\n- bpm: integer tempo if printed (e.g. ♩=72 or "BPM 72"), else null.' +
      '\n- time: time signature like "4/4" or "6/8", else null.' +
      '\n- form: the song form in performance order using these codes joined by "-": I (intro), V1 V2 V3 (verses), PC (pre-chorus), C (chorus), C2, B (bridge), Itld (interlude), O (outro), Tag. Follow repeat signs, D.S./D.C. and printed road-map lines. null if you cannot tell.' +
      '\n- title: printed title or null.' +
      (p.title ? '\nSetlist title: ' + clip(p.title, 80) : '') +
      '\nAnswer with JSON only: {"title":..., "key":..., "bpm":..., "time":..., "form":..., "note":"one short sentence in Korean about anything uncertain"}';
    const out = await callClaude({ system: 'You read sheet music carefully and answer with strict JSON only.', maxTokens: 800, messages: [{ role: 'user', content: [imgBlock(p.image), { type: 'text', text }] }] });
    const j = jsonOf(out);
    const bpm = parseInt(j.bpm, 10);
    return { title: j.title ? clip(j.title, 80) : '', key: j.key ? clip(j.key, 6).trim() : '', bpm: isFinite(bpm) && bpm >= 30 && bpm <= 300 ? bpm : 0, time: j.time ? clip(j.time, 6) : '', form: j.form ? clip(j.form, 120) : '', note: j.note ? clip(j.note, 200) : '' };
  },
  /** V874 — 화질 보정 「코드 · 제목 다시 쓰기」: 다시 쓸 글자와 자리 (가사는 빼고) */
  async labels(p) {
    const text = SHEET_CTX + '\n\nFind the printed TEXT LABELS on this page that are NOT lyrics and NOT music notes: chord symbols above the staff, the song title, the key label (e.g. "Key: G"), tempo text (e.g. "BPM 72", "♩=72"), and section labels (e.g. "Verse 1", "Chorus", "V1", "Bridge", "Intro").' +
      '\nFor each give: t = the text exactly as printed (chords like G, Am7, D/F#, Bbmaj7); k = one of "chord","title","key","tempo","section"; x,y = the CENTER of the text as fractions of image width/height (0..1, from top-left); h = the height of its capital letters as a fraction of image height. Be precise about positions and skip anything you are not sure about.' +
      '\nAnswer with JSON only: {"items":[{"t":"G","k":"chord","x":0.12,"y":0.21,"h":0.012}, ...]}';
    const out = await callClaude({ system: 'You read printed text in sheet-music images with great care. You answer with strict JSON only.', maxTokens: 5000, messages: [{ role: 'user', content: [imgBlock(p.image), { type: 'text', text }] }] });
    const j = jsonOf(out), KINDS = ['chord', 'title', 'key', 'tempo', 'section'];
    const items = (Array.isArray(j.items) ? j.items : []).map((c) => ({ t: clip(c && c.t, 60).trim(), k: KINDS.includes(c && c.k) ? c.k : 'chord', x: +c.x, y: +c.y, h: +c.h || 0 }))
      .filter((c) => c.t && isFinite(c.x) && isFinite(c.y) && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1).slice(0, 300);
    return { items };
  },
  /** V874 — 화질 보정 「실험: 새로 그리기」: 악보 전체를 ABC 악보 글로 (화면에서 abcjs 로 그림) */
  /** 한 번에 한 쪽만 (p.part = 0 부터, p.header = 첫 쪽에서 받은 머리말) — 쪽마다 짧게 받아 이어 붙임 */
  async engrave(p) {
    const imgs = (Array.isArray(p.images) ? p.images : []).slice(0, 1);
    if (!imgs.length) throw new Error('악보 그림이 없습니다.');
    const part = Math.max(0, parseInt(p.part, 10) || 0), total = Math.max(1, parseInt(p.total, 10) || 1), first = part === 0;
    const text = SHEET_CTX + (total > 1 ? ' This is page ' + (part + 1) + ' of ' + total + '.' : '') +
      '\n\nRe-engrave this page: transcribe it into ABC notation (standard 2.1) so it can be re-typeset cleanly.' +
      (first ? '\n- Start with the header: X:1, T:<title>, M:<meter>, L:1/8, Q:<tempo if printed, e.g. 1/4=72>, K:<key as printed, e.g. G or Bb or F#m>.'
             : '\n- This continues a tune whose header is:\n' + clip(p.header, 300) + '\nDo NOT repeat the header — output only the music lines of this page (use [K:..] or [M:..] inline only if they change).') +
      '\n- One melody voice. Every note with its printed pitch and duration, ties (-), triplets ((3), rests, pickup bars, bar lines. One printed system per ABC line.' +
      '\n- Chord symbols in double quotes before the note where they are printed, e.g. "G"B2 "D/F#"A2.' +
      '\n- Lyrics on w: lines under each music line, Korean syllables separated by spaces, "-" for a syllable held across notes, "_" for melisma; extra w: lines for stacked verses.' +
      '\n- Section labels as annotations like "^Verse 1". Repeats |: :|, endings [1 [2, D.S./Coda as printed.' +
      '\nRespond with the ABC text only. ' + (first ? 'Your very first characters must be "X:1".' : 'Your very first characters must be music, not commentary.') + ' Do not explain, do not analyse, no code fences.';
    const r = await callClaude({ system: 'You are an expert music engraver. You output only ABC notation, never commentary.', maxTokens: 16000, maxMs: 240000, full: true, noThink: true, messages: [{ role: 'user', content: imgs.map(imgBlock).concat([{ type: 'text', text }]) }] });
    let body = String(r.text || '');
    const fence = /```[a-z0-9]*[ \t]*\n([\s\S]*?)```/gi; let fm; while ((fm = fence.exec(body))) { if (/[|]/.test(fm[1])) { body = fm[1]; break; } }     // 코드블록 안의 ABC 만 (앞뒤 설명 빼고)
    body = body.replace(/```[a-z0-9]*\s*/gi, '').replace(/```/g, '');
    if (first) {
      const xi = body.search(/^\s*X:\s*\d*/m);
      if (xi >= 0) body = body.slice(xi);
      else if (/^\s*K:/m.test(body) && /\|/.test(body)) body = 'X:1\n' + body.slice(Math.max(0, body.search(/^\s*[TMLQCK]:/m)));
      else throw whyNot(r.text, r.stop, '새로 그리지 못했어요', r.diag);
    } else {
      const mi = body.search(/^\s*(?:["^_=A-Ga-gz[|(]|w:)/m); if (mi < 0) throw whyNot(r.text, r.stop, (part + 1) + '쪽을 새로 그리지 못했어요', r.diag);
      body = body.slice(mi).replace(/^\s*[XTMLQCK]:.*$/gm, '');
    }
    body = body.split('\n').map((l) => l.replace(/^\s+/, '')).filter((l) => !/^(Note|Here|This|I |Let me|The )[^|]*[.!?:]$/.test(l) && !/^[A-Z][a-z]+(\s+[a-z']+){3,}[^|"]*[.!?]$/.test(l)).join('\n').trim();      // 앞뒤 설명 문장 빼기
    if (first && !/^K:/m.test(body)) body = body.replace(/^(X:.*)$/m, '$1\nK:C');
    if (!/[A-Ga-gz][,']*\d*/.test(body.replace(/^[A-Za-z]:.*$/gm, ''))) throw whyNot(r.text, r.stop, '새로 그리지 못했어요', r.diag);
    const header = first ? body.split('\n').filter((l) => /^[XTMLQK]:/.test(l)).join('\n') : '';
    return { abc: body, header, truncated: r.stop === 'max_tokens' };
  },
  async ask(p) {
    const hist = (Array.isArray(p.history) ? p.history : []).slice(-8).map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: clip(m && m.text, 3000) })).filter((m) => m.content);
    const q = clip(p.q, 2000).trim(); if (!q) throw new Error('질문을 써 주세요.');
    const ctx = [p.title ? '곡: ' + clip(p.title, 80) : '', p.keyInfo ? '키: ' + clip(p.keyInfo, 120) : '', p.chords ? '이 페이지에서 읽은 코드: ' + clip(p.chords, 1500) : ''].filter(Boolean).join('\n');
    const content = [];
    if (p.image) content.push(imgBlock(p.image));
    content.push({ type: 'text', text: (ctx ? ctx + '\n\n' : '') + q });
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const msgs = hist.concat([{ role: 'user', content }]);
    for (let i = msgs.length - 2; i >= 0; i--) if (msgs[i].role === msgs[i + 1].role) msgs.splice(i, 1);     // 같은 쪽이 연달아 오지 않게
    const out = await callClaude({
      system: 'You are a friendly, practical music assistant for a Korean church worship band (keys, guitar, bass, drums, vocals). The user is looking at the attached lead-sheet page during rehearsal. Answer in Korean, short and concrete (chord names, voicings, bass notes, rhythm ideas). If the question is about the sheet, look at the image carefully. Use plain text with short lines; no tables.',
      maxTokens: 1500, messages: msgs });
    return { answer: out };
  }
};

/** u = 로그인한 사람 { email, name, … } · task · p = 화면에서 보낸 것 */
async function run(u, task, p) {
  if (task === 'status') return { allowed: allowed(u), enabled: allowed(u) && enabled(), left: allowed(u) ? left() : 0 };
  if (!allowed(u)) throw new Error('이 기능은 정해진 계정에서만 쓸 수 있습니다.');
  const fn = Object.prototype.hasOwnProperty.call(TASKS, task) ? TASKS[task] : null;
  if (!fn) throw new Error('알 수 없는 AI 요청입니다.');
  const r = await fn(p || {});
  r.left = left();
  return r;
}

module.exports = { run, allowed, enabled, _jsonOf: jsonOf, _setFetch: (f) => { global.fetch = f; } };
