/**
 * 스케줄 엑셀 템플릿 — 내려받아 채운 뒤 "엑셀로 스케줄 올리기"(routes/scheduleImport.js)로 올리는 .xlsx.
 *   시트 "스케줄"   한 줄 = 한 주일. 날짜 · 포지션들 · 불참 · 연습만 불참 · 주일만 불참 (읽는 규칙: lib/scheduleImport.js 의 표 형식)
 *   시트 "팀원명단" 이름 · 스케줄표에 보이는 이름 · 역할 (이름 칸의 목록 상자가 이 명단을 씁니다)
 *   시트 "안내"     쓰는 법
 * build({ team, dates, members, assign, off }) → Buffer
 */
const { writeXlsx, colName } = require('./xlsxWrite');
const { POSITION_GROUPS, canonicalPosition } = require('./positions');
const { shortMap } = require('./shortName');

const POS = POSITION_GROUPS.reduce((a, g) => a.concat(g[1]), []);
const ABS = ['불참', '연습만 불참', '주일만 불참'];
const KIND = { all: 0, prac: 1, sun: 2 };

/** from 이후(포함) 첫 주일부터 weeks 개 주일 */
function sundays(from, weeks) {
  const d = new Date(from + 'T12:00:00');
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  const out = [];
  for (let i = 0; i < weeks; i++) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 7); }
  return out;
}

/** 구분('' | '연습' | '예배') → all | prac | sun */
const partOf = (g) => ({ '연습': 'prac', '예배': 'sun' }[String(g || '').trim()] || 'all');

/**
 * @param {{team:string, dates:string[], members:{name:string, role?:string, pastor?:boolean}[], assign?:{date:string,pos:string,name:string}[], off?:{date:string,name:string,part:string,reason?:string}[]}} o
 */
function build(o) {
  const dates = o.dates || [];
  const members = (o.members || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const pastors = new Set(members.filter((m) => m.pastor).map((m) => m.name));       // 목회자는 줄이지 않고 "윤정환 목사"
  const short = shortMap(members.filter((m) => !m.pastor).map((m) => m.name));
  const shown = (n) => (pastors.has(n) ? n + ' 목사' : (short.get(n) || n));
  const heads = ['날짜'].concat(POS, ABS);
  const cell = new Map();                                       // 날짜|칸 이름 → [이름]
  const put = (d, col, text) => { const k = d + '|' + col; (cell.get(k) || cell.set(k, []).get(k)).push(text); };
  (o.assign || []).forEach((a) => { const p = canonicalPosition(a.pos); if (POS.includes(p)) put(a.date, p, a.name); });
  (o.off || []).forEach((x) => {
    const why = x.reason && !/^(불참|불가)$/.test(x.reason) ? `(${x.reason})` : '';
    put(x.date, ABS[KIND[x.part] || 0], x.name + why);
  });
  const rows = [heads];
  dates.forEach((d) => rows.push([{ d }].concat(heads.slice(1).map((h) => (cell.get(d + '|' + h) || []).join(', ')))));

  const lastRow = Math.max(rows.length, 2) + 40;               // 줄을 더 적어도 목록 상자가 따라오게 여유
  const listEnd = Math.max(members.length + 1, 2);
  const posRange = `B2:${colName(POS.length)}${lastRow}`;
  const sched = {
    name: '스케줄', rows, header: true, freeze: { rows: 1, cols: 1 },
    widths: [13].concat(POS.map((p) => (/싱어|알토/.test(p) ? 16 : 11)), [16, 16, 16]),
    grayCols: [POS.length + 1, POS.length + 2, POS.length + 3],
    lists: [{ sqref: posRange, formula: `'팀원명단'!$A$2:$A$${listEnd}` }],
  };
  const roster = {
    name: '팀원명단', header: true, freeze: { rows: 1 }, widths: [14, 20, 24],
    rows: [['이름', '스케줄표에 보이는 이름', '역할']].concat(members.map((m) => [m.name, shown(m.name), m.role || ''])),
  };
  const dups = members.filter((m) => !m.pastor && /^[가-힣]{3}$/.test(m.name) && short.get(m.name) !== m.name.slice(1) && short.get(m.name) !== m.name);
  const guide = {
    name: '안내', plain: true, widths: [96],
    rows: [
      [{ title: `${o.team} 스케줄 엑셀 템플릿` }],
      [''],
      ['① "스케줄" 시트: 한 줄이 한 주일(일요일)이에요. 포지션 칸에 그 주일에 서는 사람 이름을 적어요.'],
      ['② 싱어처럼 여러 명이면 쉼표로 이어 적어요.  예) 조희영, 김희영'],
      ['③ 이름은 칸을 눌렀을 때 나오는 목록(팀원명단 시트)에서 고르면 가장 정확해요. 두 글자만 적어도 팀원 명단에서 찾아 맞춰요 (조희 → 조희영).'],
      ['④ 불참 칸: 연습 · 주일 모두 못 오면 "불참", 금요일 연습만이면 "연습만 불참", 주일만이면 "주일만 불참"에 이름을 적어요. 여러 명은 쉼표로, 사유는 괄호로.  예) 지원(휴가), 다현'],
      ['⑤ 줄을 더 쓰려면 맨 아래 줄에 날짜(예 2026-12-27)를 적고 이어서 채우면 돼요. 주일이 아닌 날짜는 건너뛰어요. 비워 둔 줄은 무시해요.'],
      ['⑥ 다 채우면 스케줄표의 "엑셀로 스케줄 올리기"에서 이 파일을 올려요. 올리기 전에 미리보기로 무엇이 바뀌는지 먼저 보여드려요.'],
      ['     · 빈 곳만 채우기: 이미 적힌 편성은 그대로 두고, 빈 자리만 더해요.'],
      ['     · 엑셀대로 덮어쓰기: 이름이 하나라도 적힌 줄은 엑셀대로 바꿔요 (그 줄에서 비워 둔 포지션 칸은 비운 것으로 봐요). 이름이 하나도 없는 줄은 건드리지 않아요.'],
      [''],
      [`스케줄표에는 세 글자 이름이 성을 뗀 이름으로 보여요 (정지원 → 지원).${dups.length ? ' 이름이 같은 사람이 있으면 성 + 이름 첫 글자로 보여요 (' + dups.slice(0, 4).map((m) => `${m.name} → ${short.get(m.name)}`).join(' · ') + '). 팀원명단 시트 두 번째 열에서 확인하세요.' : ''}`],
    ],
  };
  return writeXlsx([sched, roster, guide]);
}

module.exports = { build, sundays, partOf };
