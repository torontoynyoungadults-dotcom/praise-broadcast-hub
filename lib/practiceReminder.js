/**
 * 자동 안내 두 가지 — 폰 푸시(종 알림) + 이메일, 편성된 사람에게만
 *   · 화요일 아침 9시: 연습 안내 — 이번 주(월~일) 연습하는 콘티에 편성된 사람 ('연습 불참'은 빼요)
 *   · 토요일 아침 9시: 주일 안내 — 내일 주일에 편성된 사람 ('주일 불참'은 빼요)
 *   · 켜고 끄기: '설정' 탭 '연습안내' · '주일안내' = 켜짐 (관리 화면에서 따로 바꿈). 처음엔 꺼져 있어요.
 *   · 같은 날 두 번 가지 않게 '설정' 탭 '연습안내보냄:<팀>' · '주일안내보냄:<팀>' 에 보낸 날짜를 적어 둠.
 *   · 언제 보내나: 그 요일 아침 9시(토론토) 이후 — 서버가 깨어 있으면 스스로, 잠들어 있으면
 *     GitHub Actions(.github/workflows/practice-reminder.yml)가 /cron/practice-reminder 를 불러 깨움.
 */
const crypto = require('crypto');
const sheetsDb = require('./sheetsDb');
const week = require('./weekUtil');
const prac = require('./practice');
const pv = require('./practiceView');
const honorific = require('./honorific');
const timeSettings = require('./timeSettings');
const notify = require('./notify');
const mailer = require('./mailer');

const SEND_HOUR = 9;                                       // 그 요일(화 · 토) 이 시각(토론토) 이후에 보냄
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dowOf = (d) => new Date(d + 'T12:00:00').getDay();
const mdShort = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const baseUrl = () => String(process.env.BASE_URL || '').replace(/\/+$/, '');

/* ---------------------------------------------------------------- 로그인 없이 여는 캘린더 링크 (메일용) */
function calSig(team, pd, name) {
  return crypto.createHmac('sha256', String(process.env.SESSION_SECRET || 'dev')).update(['cal', team, pd, name].join('|')).digest('hex').slice(0, 24);
}
function calLink(team, pd, name) {
  const q = new URLSearchParams({ team, pd, n: name, s: calSig(team, pd, name) });
  return baseUrl() + '/practice-cal.ics?' + q.toString();
}

/* ---------------------------------------------------------------- 켜기 · 끄기 · 기록 */
async function setSetting(key, value, desc) {
  const rows = await sheetsDb.readAll('설정', { fresh: true });
  const hit = rows.find((r) => r['키'] === key);
  const row = { '키': key, '값': value, '설명': desc || (hit && hit['설명']) || '' };
  if (hit) await sheetsDb.updateRow('설정', hit.__row, row); else await sheetsDb.appendRow('설정', row);
}

/* ---------------------------------------------------------------- 누구에게 무엇을 */
function mondayOf(d) { return prac.addDays(d, -((dowOf(d) + 6) % 7)); }

async function activeTeams() {
  return (await sheetsDb.readAll('찬양팀')).filter((t) => String(t['활성여부']).toUpperCase() !== 'FALSE').map((t) => String(t['팀명'] || '').trim()).filter(Boolean);
}
async function teamMembers(team) {
  return (await sheetsDb.readAll('회원')).filter((m) => String(m['접속중지']).toUpperCase() !== 'TRUE' && m['이메일'] && m['이름']
    && String(m['소속팀'] || '').split(',').map((s) => s.trim()).includes(team));
}
/** 그 예배의 곡 — 콘티 · 설교 후 찬양 · 폐회송 */
function songsOf(rows, team, t) {
  const inT = (r) => r['팀ID'] === team && (t.event ? r['행사ID'] === t.event : (!r['행사ID'] && r['날짜'] === t.date));
  const order = (a, b) => Number(a['순서'] || 0) - Number(b['순서'] || 0);
  const list = rows.filter(inT);
  const pick = (f) => list.filter(f).sort(order).map((r) => ({ title: String(r['제목'] || '제목 없음'), key: String(r['Key'] || '').trim(), team: String(r['팀'] || '').trim() }));
  return { conti: pick((r) => r['구분'] !== '결단' && r['구분'] !== '폐회송'), final: pick((r) => r['구분'] === '결단'), closing: pick((r) => r['구분'] === '폐회송') };
}

/**
 * 이 팀에서 [from, to] 연습에 서는 사람마다 안내 한 건.
 * @returns {Promise<{team,name,email,pastor,items:{g,mine:{t,pos}[]}[]}[]>}
 */
async function plan(team, from, to) {
  const gs = await pv.groups(team, from, to);
  if (!gs.length) return [];
  const [assign, offs, members] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), teamMembers(team)]);
  const A = assign.filter((r) => r['팀ID'] === team), O = offs.filter((r) => r['팀ID'] === team);
  const out = [];
  members.forEach((m) => {
    const name = String(m['이름']).trim();
    const items = gs.map((g) => ({ g, mine: g.targets.map((t) => Object.assign({ t }, pv.standing(name, t, A, O))).filter((x) => x.pos.length && !x.off) }))
      .filter((x) => x.mine.length);
    if (items.length) out.push({ team, name, email: String(m['이메일']).trim().toLowerCase(), pastor: honorific.isPastorRoles(m['역할']), items });
  });
  return out;
}

/* ---------------------------------------------------------------- 메일 내용 (연습 · 주일 공통 틀) */
function dayWord(d, today) {
  const diff = Math.round((new Date(d + 'T12:00:00') - new Date(today + 'T12:00:00')) / 864e5);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  return (diff > 0 && diff < 7 && dowOf(d) >= dowOf(today) ? '이번주 ' : '') + WD[dowOf(d)] + '요일';
}
/** "피아노" → "피아노로" · "드럼" → "드럼으로" (받침이 있으면 '으로', ㄹ 받침은 '로') */
function euro(word) {
  const c = String(word || '').trim().slice(-1), code = c.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return word + '로';
  const jong = code % 28;
  return word + (jong === 0 || jong === 8 ? '로' : '으로');
}
/** 보내는 이름 — "3부 찬양팀" → "3부찬양팀 Admin" */
const fromName = (team) => `${String(team || '').replace(/\s+/g, '')} Admin`;
/** 포지션 아이콘 (메일은 그림 파일 · SVG 가 자주 막혀서 이모지) */
const POS_ICON = { 피아노: '🎹', 신디: '🎛️', 드럼: '🥁', 베이스: '🎸', 일렉: '🎸', 어쿠기타: '🪕', 인도자: '🎤', 남성싱어: '🎙️', 여성싱어: '🎙️', 알토: '🎙️', 음향: '🎚️', PPT: '🖥️', 방송총괄: '🎬' };
const chip = (x) => `<span style="display:inline-block;margin:0 4px 4px 0;padding:2px 10px;border-radius:99px;border:1px solid #C9A86A;color:#8A5F22;font-size:12.5px;font-weight:700;">${esc(x)}</span>`;
/** 왼쪽 날짜 칸 + 오른쪽 시간 · 장소 · 콘티 · 내 포지션 */
function dateCard(date, big, lines, pos) {
  const d = new Date(date + 'T12:00:00');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid #D9E1DD;border-radius:14px;overflow:hidden;">
        <tr>
          <td width="104" style="background:#1F4A3F;padding:16px 10px;text-align:center;vertical-align:middle;">
            <div style="font-size:13px;color:#D6B97F;font-weight:700;">${d.getMonth() + 1}월</div>
            <div style="font-size:34px;line-height:1.1;color:#F5F0E4;font-weight:800;">${d.getDate()}</div>
            <div style="font-size:13px;color:#D6B97F;font-weight:700;">${d.getDay() === 0 ? '주일' : WD[d.getDay()] + '요일'}</div>
          </td>
          <td style="padding:14px 18px;vertical-align:middle;background:#FBFCFB;">
            <div style="font-size:19px;font-weight:800;color:#122722;">${esc(big)}</div>
            ${lines.filter(Boolean).map((l, k) => `<div style="font-size:${k ? 14 : 15}px;color:#33443F;margin-top:${k ? 6 : 2}px;">${esc(l)}</div>`).join('')}
            ${pos && pos.length ? `<div style="margin-top:8px;">${pos.map(chip).join('')}</div>` : ''}
          </td>
        </tr>
      </table>`;
}
/** 그 예배의 곡 목록 */
function songTable(name, s) {
  const li = (x, mark) => `<tr><td style="width:26px;padding:7px 0;vertical-align:top;color:#8A5F22;font-weight:700;font-size:14px;">${mark}</td>
        <td style="padding:7px 0;font-size:15px;color:#122722;border-bottom:1px solid #E7ECE9;"><b style="font-weight:700;">${esc(x.title)}</b>${x.team ? `<span style="color:#6B7A75;"> · ${esc(x.team)}</span>` : ''}${x.key ? `<span style="float:right;color:#1F4A3F;font-weight:700;">${esc(x.key)}</span>` : ''}</td></tr>`;
  const rows = s.conti.map((x, i) => li(x, i + 1)).concat(s.final.map((x) => li(x, '✝')), s.closing.map((x) => li(x, '♪'))).join('');
  return `<p style="margin:22px 0 4px;font-size:13px;font-weight:700;color:#4C645E;">${esc(name)} 콘티</p>
        ${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>` : '<p style="margin:6px 0;font-size:14px;color:#6B7A75;">아직 올라온 곡이 없어요. 곡이 올라오면 앱에서 알려 드려요.</p>'}`;
}
const songText = (s) => s.conti.concat(s.final, s.closing).map((x) => x.title + (x.key ? ` (${x.key})` : '')).join(', ') || '아직 곡이 없어요';
/** 버튼 줄 — [ [href, label, primary?], … ] 를 한 줄에 같은 높이로 */
function buttons(list) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr>${list.map(([href, label, pri], i) => `${i ? '<td style="width:8px;"></td>' : ''}
        <td style="border-radius:10px;${pri ? 'background:#1F4A3F;border:1px solid #1F4A3F;' : 'border:1px solid #1F4A3F;'}"><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;color:${pri ? '#F5F0E4' : '#1F4A3F'};text-decoration:none;font-size:15px;font-weight:700;line-height:20px;">${esc(label)}</a></td>`).join('')}
      </tr></table>`;
}
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;display:inline-table;"><tr>
        <td style="border-radius:10px;background:#1F4A3F;"><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;color:#F5F0E4;text-decoration:none;font-size:15px;font-weight:700;">${esc(label)}</a></td>
      </tr></table>`;
/** 메일 한 장의 틀 */
function shell({ title, kicker, heading, lead, body, note, footer }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#EEF2EF;">
  <div style="display:none;max-height:0;overflow:hidden;">${esc(lead.replace(/\n/g, ' '))}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2EF;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;">
      <tr><td style="background:#17302A;padding:22px 26px 20px;">
        <div style="font-size:13px;color:#D6B97F;font-weight:700;">${esc(kicker)}</div>
        <div style="margin-top:8px;font-size:22px;line-height:1.45;color:#F5F0E4;font-weight:700;">${esc(heading)}</div>
      </td></tr>
      <tr><td style="padding:22px 26px 8px;">
        <p style="margin:0 0 18px;font-size:15.5px;line-height:1.65;color:#122722;">${esc(lead).replace(/\n/g, '<br>')}</p>
        ${body}
        <p style="margin:26px 0 0;padding:12px 14px;border-radius:10px;background:#F4F7F5;font-size:13.5px;line-height:1.6;color:#33443F;">${note}</p>
      </td></tr>
      <tr><td style="padding:18px 26px 24px;font-size:12px;line-height:1.6;color:#7A847F;">
        ${esc(footer)}<br>
        해외한인장로회 토론토영락교회 · 650 McNicoll Ave. Toronto, ON
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** 연습 안내 메일 (화요일) — { subject, html, text, push } */
async function compose(p, today) {
  const songRows = await sheetsDb.readAll('찬양콘티');
  const you = p.pastor ? `${p.name} 목사님` : `${p.name}님`;
  const first = p.items[0];
  const contiNames = (it) => it.mine.map((x) => pv.targetName(x.t)).join(' · ');
  const posOf = (it) => Array.from(new Set([].concat(...it.mine.map((x) => x.pos))));
  const when = (g) => [timeSettings.fmt(g.time), g.place].filter(Boolean).join(' ');
  const dw = dayWord(first.g.date, today), short = dw.replace(/^이번주 /, '이번 ');      // "이번주 금요일" · "이번 금요일"
  const heading = `${dw} 연습 있습니다`;
  const subject = `[${p.team}] ${heading} — ${mdShort(first.g.date)} ${when(first.g)}`;
  const blocks = [], texts = [];
  for (const it of p.items) {
    const g = it.g;
    const href = baseUrl() + `/practice-conti?team=${encodeURIComponent(p.team)}&pd=${encodeURIComponent(g.date)}`;
    const ev = pv.calEvent(p.team, g, it.mine.map((x) => ({ name: pv.targetName(x.t), pos: x.pos })), baseUrl());
    const google = pv.googleCalUrl(ev), ics = calLink(p.team, g.date, p.name);
    const songs = it.mine.map((x) => ({ name: pv.targetName(x.t), s: songsOf(songRows, p.team, x.t) }));
    blocks.push(dateCard(g.date, timeSettings.fmt(g.time), [g.place, `${contiNames(it)} 콘티`], posOf(it))
      + songs.map(({ name, s }) => songTable(name, s)).join('')
      + buttons([[href, '연습 콘티 열기', true]])
      + `<p style="margin:12px 0 0;font-size:13.5px;color:#4C645E;">캘린더에 넣기 · <a href="${esc(google)}" style="color:#1F4A3F;font-weight:700;">구글 캘린더</a> · <a href="${esc(ics)}" style="color:#1F4A3F;font-weight:700;">아이폰 · 맥 캘린더</a></p>`);
    texts.push(`■ ${mdShort(g.date)}(${WD[dowOf(g.date)]}) ${when(g)} — ${contiNames(it)} 콘티${posOf(it).length ? ' (' + posOf(it).join(' · ') + ')' : ''}\n`
      + songs.map(({ name, s }) => `  ${name} 콘티: ${songText(s)}`).join('\n') + `\n  연습 콘티: ${href}\n  구글 캘린더: ${google}\n  아이폰 캘린더: ${ics}`);
  }
  const lead = `${you}, ${short} 연습 있습니다.\n${contiNames(first)} 콘티를 연습해요 — 아래 곡으로 미리 준비해 주세요.`;
  const html = shell({ title: subject, kicker: `${p.team} · 연습 안내`, heading, lead, body: blocks.join('<div style="height:28px;"></div>'),
    note: '연습에 오기 어려우면 스케줄표에서 그 날을 <b>연습 불참</b>으로 표시해 주세요. 인도자와 팀이 미리 알 수 있어요.',
    footer: `이 메일은 ${p.team} 스케줄표에서 이번 주 연습에 편성된 분께 매주 화요일 아침 자동으로 보내져요.` });
  const text = `${lead}\n\n${texts.join('\n\n')}\n\n연습에 오기 어려우면 스케줄표에서 그 날을 '연습 불참'으로 표시해 주세요.\n— ${p.team} · 토론토영락교회 찬양팀 허브`;
  const shortNames = (it) => it.mine.map((x) => (x.t.event ? x.t.name : mdShort(x.t.date) + ' 주일')).join(' · ');
  const push = { title: `${short}, 연습 있습니다 · ${mdShort(first.g.date)}`, body: `${when(first.g)} · ${shortNames(first)} 콘티${posOf(first).length ? ' · ' + posOf(first).join(' · ') : ''}`,
    url: `/practice-conti?team=${encodeURIComponent(p.team)}&pd=${encodeURIComponent(first.g.date)}` };
  return { subject, html, text, push, fromName: fromName(p.team) };
}

/* ---------------------------------------------------------------- 주일 안내 (토요일 아침) */
/** 그 주일(date)에 서는 사람 — '주일만 불참' · '둘 다 불참'은 빼요 */
async function planSunday(team, date) {
  const [assign, offs, members] = await Promise.all([sheetsDb.readAll('찬양편성'), sheetsDb.readAll('불가일정'), teamMembers(team)]);
  const A = assign.filter((r) => r['팀ID'] === team && !r['행사ID'] && r['날짜'] === date);
  const off = new Set(offs.filter((r) => r['팀ID'] === team && String(r['날짜']) === date && String(r['구분'] || '').trim() !== '연습').map((r) => String(r['이름'] || '').trim()));
  const { canonicalPosition, ALL_POSITIONS } = require('./positions');
  const byName = new Map();
  A.forEach((r) => { const n = String(r['이름'] || '').trim(), pos = canonicalPosition(String(r['포지션'] || '').trim()); if (!n || !pos) return; const l = byName.get(n) || byName.set(n, []).get(n); if (!l.includes(pos)) l.push(pos); });
  const lineup = ALL_POSITIONS.map((pos) => ({ pos, names: Array.from(byName.entries()).filter(([n, ps]) => ps.includes(pos) && !off.has(n)).map(([n]) => n) })).filter((x) => x.names.length);
  const pastors = members.filter((m) => honorific.isPastorRoles(m['역할'])).map((m) => String(m['이름']).trim());
  return members.map((m) => ({ m, name: String(m['이름']).trim() })).filter((x) => byName.has(x.name) && !off.has(x.name))
    .map((x) => ({ team, date, name: x.name, email: String(x.m['이메일']).trim().toLowerCase(), pastor: honorific.isPastorRoles(x.m['역할']), pos: byName.get(x.name), lineup, pastors }));
}
/** 주일 안내 메일 — { subject, html, text, push } */
async function composeSunday(p, today) {
  const [songRows, ts] = await Promise.all([sheetsDb.readAll('찬양콘티'), timeSettings.get(p.team)]);
  const you = p.pastor ? `${p.name} 목사님` : `${p.name}님`;
  const s = songsOf(songRows, p.team, { date: p.date, event: '' });
  const dw = dayWord(p.date, today);
  const when = dw === '내일' ? '내일 주일' : mdShort(p.date) + ' 주일';
  const heading = `${when}, ${p.team} ${euro(p.pos.join(' · '))} 섬기는 주일입니다.`;
  const subject = heading;
  const meet = timeSettings.fmt(ts.rehearsal), worship = timeSettings.fmt(ts.worship);
  const href = baseUrl() + `/conti?team=${encodeURIComponent(p.team)}&date=${encodeURIComponent(p.date)}`;
  const live = baseUrl() + `/conti/practice?team=${encodeURIComponent(p.team)}&date=${encodeURIComponent(p.date)}`;
  const pastors = new Set(p.pastors || []);
  const honor = (n, pos) => (pos === '인도자' || pastors.has(n) ? honorific.withTitle(n) : n);
  const lineupHtml = `<p style="margin:22px 0 6px;font-size:13px;font-weight:700;color:#4C645E;">함께 서는 분</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D9E1DD;border-radius:12px;">${p.lineup.map((x, i) => {
          const me = x.names.includes(p.name);
          return `<tr style="${me ? 'background:#FBF6EC;' : ''}">
          <td style="width:30px;padding:9px 0 9px 12px;font-size:17px;${i ? 'border-top:1px solid #E7ECE9;' : ''}">${POS_ICON[x.pos] || '🎵'}</td>
          <td style="width:84px;padding:9px 8px;font-size:13.5px;color:#4C645E;font-weight:700;${i ? 'border-top:1px solid #E7ECE9;' : ''}">${esc(x.pos)}</td>
          <td style="padding:9px 12px 9px 0;font-size:15px;color:#122722;${i ? 'border-top:1px solid #E7ECE9;' : ''}">${x.names.map((n) => n === p.name ? `<b style="color:#8A5F22;">${esc(honor(n, x.pos))}</b>` : esc(honor(n, x.pos))).join(' · ')}</td></tr>`;
        }).join('')}</table>`;
  const body = dateCard(p.date, `리허설 모임 ${meet}`, [`예배 ${worship}${ts.place ? ' · ' + ts.place : ''}`], p.pos)
    + songTable(`${mdShort(p.date)} 주일`, s) + lineupHtml
    + buttons([[href, '예배 콘티 열기', true], [live, '라이브 악보', false]]);
  const lead = `${you}, ${when}, ${p.team} 섬기는 주일입니다.\n리허설 모임은 ${meet}, 예배는 ${worship}이에요.`;
  const html = shell({ title: subject, kicker: `${p.team} · 주일 안내`, heading, lead, body,
    note: '내일 서기 어려운 일이 생기면 인도자께 바로 알려 주세요. 스케줄표에서 그 날을 <b>주일 불참</b>으로 표시하면 팀도 함께 볼 수 있어요.',
    footer: `이 메일은 ${p.team} 스케줄표에서 이번 주일에 편성된 분께 매주 토요일 아침 자동으로 보내져요.` });
  const text = `${lead}\n\n■ ${mdShort(p.date)}(주일) 리허설 ${meet} · 예배 ${worship}${ts.place ? ' · ' + ts.place : ''} — ${p.pos.join(' · ')}\n  콘티: ${songText(s)}\n  함께 서는 분: ${p.lineup.map((x) => x.pos + ' ' + x.names.join('·')).join(' / ')}\n  예배 콘티: ${href}\n\n— ${p.team} · 토론토영락교회 찬양팀 허브`;
  const push = { title: heading, body: `리허설 모임 ${meet} · 예배 ${worship}`, url: `/conti?team=${encodeURIComponent(p.team)}&date=${encodeURIComponent(p.date)}` };
  return { subject, html, text, push, fromName: fromName(p.team) };
}

/* ---------------------------------------------------------------- 보내기 */
/* ---------------------------------------------------------------- 보내기 — 화요일 = 연습 안내 · 토요일 = 주일 안내 */
const KINDS = {
  prac: { dow: 2, flag: '연습안내', sent: '연습안내보냄:', label: '연습 안내', push: '연습' },
  sun: { dow: 6, flag: '주일안내', sent: '주일안내보냄:', label: '주일 안내', push: '주일' },
};
async function enabledKind(kind) { return String(await sheetsDb.getSetting(KINDS[kind].flag, '')).trim() === '켜짐'; }
async function setEnabledKind(kind, on) { await setSetting(KINDS[kind].flag, on ? '켜짐' : '꺼짐', `${KINDS[kind].label} 메일 · 푸시 (${kind === 'prac' ? '화요일' : '토요일'} 아침) — 관리에서 켜고 끔`); }
async function lastSentKind(kind, team) { return String(await sheetsDb.getSetting(KINDS[kind].sent + team, '') || ''); }

/** 이 팀 · 이 종류의 받는 사람과 메일 */
async function jobs(kind, team, today) {
  if (kind === 'prac') {
    const people = await plan(team, today, prac.addDays(mondayOf(today), 6));
    return Promise.all(people.map(async (p) => ({ p, m: await compose(p, today) })));
  }
  const sunday = prac.addDays(today, (7 - dowOf(today)) % 7);
  const people = await planSunday(team, sunday);
  return Promise.all(people.map(async (p) => ({ p, m: await composeSunday(p, today) })));
}

let running = null;
/**
 * 오늘이 그 요일(화 = 연습 · 토 = 주일)이고 아침 9시가 지났고, 켜져 있고, 이번 주에 아직 안 보냈으면 보냄.
 * @param {{now?:string, kinds?:string[]}} o
 */
async function run(o = {}) {
  const today = o.now || week.todayStr();
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto', hour: '2-digit', hour12: false }));
  const out = [];
  for (const kind of o.kinds || Object.keys(KINDS)) {
    const K = KINDS[kind];
    if (dowOf(today) !== K.dow) { out.push({ kind, ran: false, why: '보낼 요일이 아님' }); continue; }
    if (hour < SEND_HOUR) { out.push({ kind, ran: false, why: `아직 ${SEND_HOUR}시 전` }); continue; }
    if (!(await enabledKind(kind))) { out.push({ kind, ran: false, why: '꺼져 있음' }); continue; }
    for (const team of await activeTeams()) {
      if ((await lastSentKind(kind, team)) === today) { out.push({ kind, team, ran: false, why: '이미 보냄' }); continue; }
      await setSetting(K.sent + team, today, `${K.label}를 보낸 날 (같은 날 두 번 안 가게)`);     // 먼저 적어 둠 — 겹쳐 불려도 두 번 안 감
      const list = await jobs(kind, team, today);
      let pushed = 0, mailed = 0, failed = 0;
      for (const { p, m } of list) {
        try { const r = await notify.send(team, { kind: K.push, title: m.push.title, body: m.push.body, url: m.push.url, by: `자동 (${K.label})`, to: [p.email] }); pushed += r.sent ? 1 : 0; } catch (e) { console.error(`[${K.label} 푸시 실패]`, p.name, e && e.message); }
        if (mailer.configured()) {
          try { await mailer.send({ to: p.email, subject: m.subject, html: m.html, text: m.text, fromName: m.fromName }); mailed++; } catch (e) { failed++; console.error(`[${K.label} 메일 실패]`, p.name, e && e.message); }
        }
      }
      console.log(`[${K.label}] ${team} ${today} — ${list.length}명 · 푸시 ${pushed} · 메일 ${mailed}${failed ? ' · 실패 ' + failed : ''}`);
      out.push({ kind, team, ran: true, people: list.length, pushed, mailed, failed });
    }
  }
  return { ran: out.some((x) => x.ran), teams: out };
}
function ensure(o) { if (!running) running = run(o).catch((e) => { console.error('[자동 안내 실패]', e && e.message); return { ran: false, why: e && e.message, teams: [] }; }).finally(() => { running = null; }); return running; }
/** 서버가 깨어 있을 때 — 15분마다 확인 */
function start() { setTimeout(() => ensure(), 120000); setInterval(() => ensure(), 15 * 60 * 1000).unref(); }

/**
 * 미리보기 — kind 'prac': 이 사람의 다음 연습 · 'sun': 이 사람이 서는 다음 주일 (없으면 가장 가까운 것으로 견본)
 * @returns {Promise<null|{subject,html,text,push,sample:boolean,to:string}>}
 */
async function preview(team, member, kind) {
  const today = week.todayStr();
  const name = String(member['이름'] || '').trim();
  const me = { name, email: String(member['이메일'] || ''), pastor: honorific.isPastorRoles(member['역할']) };
  if (kind === 'sun') {
    const first = prac.addDays(today, (7 - dowOf(today)) % 7);
    for (let i = 0; i < 6; i++) {
      const d = prac.addDays(first, i * 7);
      const hit = (await planSunday(team, d)).find((x) => x.name === name);
      if (hit) return Object.assign(await composeSunday(hit, prac.addDays(d, -1)), { sample: false, to: hit.email });
    }
    const any = (await planSunday(team, first))[0];
    const p = Object.assign({ team, date: first, pos: ['(포지션)'], lineup: any ? any.lineup : [], pastors: any ? any.pastors : [] }, me);
    return Object.assign(await composeSunday(p, prac.addDays(first, -1)), { sample: true, to: me.email });
  }
  const all = await plan(team, today, prac.addDays(today, 28));
  let p = all.find((x) => x.name === name), sample = false;
  if (p) p = Object.assign({}, p, { items: [p.items[0]] });
  else {
    const g = (await pv.groups(team, today, prac.addDays(today, 28)))[0];
    if (!g) return null;
    sample = true;
    p = Object.assign({ team, items: [{ g, mine: g.targets.map((t) => ({ t, pos: ['(포지션)'] })) }] }, me);
  }
  const tue = prac.addDays(mondayOf(p.items[0].g.date), 1);
  const m = await compose(p, tue > today && tue <= p.items[0].g.date ? tue : today);
  return Object.assign(m, { sample, to: p.email });
}

module.exports = { run, ensure, start, preview, plan, planSunday, compose, composeSunday, KINDS, enabledKind, setEnabledKind, lastSentKind, calSig, mondayOf };
