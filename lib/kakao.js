/**
 * 카카오톡에 붙여 넣는 콘티 요약 글 — 청년부 앱(church-app public/worship/conti.js kakaoText)과 같은 모양:
 *   [2026년 10월 04일] 주일예배 콘티
 *   인도자: … | 남싱: … | 메인건반: … | 세컨건반: … | 일렉: … | 베이스: … | 드럼: …
 *   #1. 곡 - 팀 (Key: G)
 *   - 송폼: V1-C-V2-C
 *   - 곡 설명: …
 *   - YouTube: https://youtu.be/…
 *   [결단찬양] # 곡 (Key: G) - YouTube: …
 * 비어 있는 줄(송폼 · 설명 · 링크)은 뺍니다. 사람이 안 정해진 자리는 "-".
 * 이 앱의 포지션 이름(피아노 · 신디 · 남성싱어 …)으로 바꿨고, 여성싱어 · 어쿠기타 · 알토는 사람이 있을 때만 적습니다.
 */
const YNForm = require('../public/js/formb.js');
const DOW = ['주일', '월', '화', '수', '목', '금', '토'];

const one = (v, dash) => { v = String(v == null ? '' : v).trim(); return v || (dash || ''); };
function dateLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `[${m[1]}년 ${m[2]}월 ${m[3]}일]` : `[${String(ymd || '')}]`;
}
/** 기록해 둔 링크 그대로 — 주소가 아니라 영상 번호만 적어 둔 경우에만 주소로 바꿈 */
function ytLink(link) {
  link = String(link || '').trim();
  if (!link) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(link)) return 'https://youtu.be/' + link;
  return link;
}
const namesOf = (slots, key) => { const a = ((slots || {})[key] || []).filter(Boolean); return a.length ? a.join(', ') : '-'; };

/**
 * W = { date, practice:{date,none}|null, event:{name}|null, slots:{포지션:[이름…]}, songs:[{title,team,key,form,note,link}], finals:[…] }
 * (이름은 이미 "윤정환 목사" 처럼 부를 이름으로 넣어 주세요)
 */
function kakaoText(W) {
  W = W || {};
  const slots = W.slots || {}, out = [];
  const what = W.event && W.event.name ? W.event.name : '주일예배';
  out.push(dateLabel(W.date) + ' ' + what + ' 콘티');
  const pr = W.practice;
  if (pr && pr.date && !pr.none) { const d = new Date(pr.date + 'T12:00:00'); out.push(`연습: ${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})${pr.note ? ' · ' + pr.note : ''}`); }
  out.push('');
  const line = [['인도자', '인도자', 1], ['남싱', '남성싱어', 1], ['여싱', '여성싱어', 0], ['알토', '알토', 0], ['메인건반', '피아노', 1], ['세컨건반', '신디', 1],
    ['일렉', '일렉', 1], ['어쿠', '어쿠기타', 0], ['베이스', '베이스', 1], ['드럼', '드럼', 1]]
    .filter(([, key, always]) => always || ((slots[key] || []).length))
    .map(([label, key]) => label + ': ' + namesOf(slots, key));
  out.push(line.join(' | '));
  (W.songs || []).forEach((s, i) => {
    out.push('');
    out.push('#' + (i + 1) + '. ' + one(s.title) + (one(s.team) ? ' - ' + one(s.team) : '') + (one(s.key) ? ' (Key: ' + one(s.key) + ')' : ''));
    if (one(s.form)) out.push('- 송폼: ' + one(s.form));
    const note = String(s.note || '').replace(/\r/g, '').split('\n').map((x) => x.replace(/\s+$/, '')).filter((x, k, a) => x || (k > 0 && k < a.length - 1));
    if (note.join('').trim()) out.push('- 곡 설명: ' + note.join('\n  ').trim());
    if (ytLink(s.link)) out.push('- YouTube: ' + ytLink(s.link));
  });
  const fin = (W.finals || []).filter((s) => one(s.title));
  if (fin.length) {
    out.push('');
    out.push('[결단찬양]');
    fin.forEach((s, i) => {
      if (i) out.push('');
      out.push('# ' + one(s.title) + (one(s.key) ? ' (Key: ' + one(s.key) + ')' : ''));
      if (ytLink(s.link)) out.push('- YouTube: ' + ytLink(s.link));
    });
  }
  return out.join('\n');
}

/** 화면의 송폼 표시 규칙과 같음 — 마디 수(:8)가 들어 있으면 풀어서, 아니면 적힌 그대로 */
function formText(form) { return form && /:\d/.test(form) ? YNForm.pretty(form) : String(form || ''); }

module.exports = { kakaoText, formText, ytLink, dateLabel };
