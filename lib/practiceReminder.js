/**
 * 월요일 아침 연습 안내 — 이번 주(월~일)에 연습이 있고, 그 연습하는 콘티에 편성된 사람에게만
 *   · 폰 푸시(종 알림) + 이메일 한 통씩. '연습 불참'으로 표시한 사람은 빼요.
 *   · 켜고 끄기: '설정' 탭 '연습안내' = 켜짐 (관리 화면에서 바꿈). 처음엔 꺼져 있어요.
 *   · 같은 주에 두 번 가지 않게 '설정' 탭 '연습안내보냄:<팀>' 에 그 주 월요일 날짜를 적어 둠.
 *   · 언제 보내나: 월요일 아침 8시(토론토) 이후 — 서버가 깨어 있으면 스스로, 잠들어 있으면
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

const FLAG = '연습안내';
const SENT = '연습안내보냄:';
const SEND_HOUR = 8;                                       // 월요일 이 시각(토론토) 이후에 보냄
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
async function enabled() { return String(await sheetsDb.getSetting(FLAG, '')).trim() === '켜짐'; }
async function setEnabled(on) { await setSetting(FLAG, on ? '켜짐' : '꺼짐', '월요일 아침 연습 안내 (푸시 + 이메일) — 관리에서 켜고 끔'); }
async function lastSent(team) { return String(await sheetsDb.getSetting(SENT + team, '') || ''); }

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

/* ---------------------------------------------------------------- 메일 내용 */
function dayWord(d, today) {
  const diff = Math.round((new Date(d + 'T12:00:00') - new Date(today + 'T12:00:00')) / 864e5);
  if (diff === 0) return '오늘';
  return (diff > 0 && diff < 7 && dowOf(d) >= dowOf(today) ? '이번 주 ' : '') + WD[dowOf(d)] + '요일';
}
/** 사람 한 명의 안내 메일 — { subject, html, text, push } */
async function compose(p, today) {
  const songRows = await sheetsDb.readAll('찬양콘티');
  const you = p.pastor ? `${p.name} 목사님` : `${p.name}님`;
  const first = p.items[0];
  const contiNames = (it) => it.mine.map((x) => pv.targetName(x.t)).join(' · ');
  const posOf = (it) => Array.from(new Set([].concat(...it.mine.map((x) => x.pos))));
  const when = (g) => [timeSettings.fmt(g.time), g.place].filter(Boolean).join(' ');
  const subject = `[${p.team}] ${dayWord(first.g.date, today)}(${mdShort(first.g.date)}) 연습 안내 — ${contiNames(first)} 콘티`;

  const blocks = [], texts = [];
  for (const it of p.items) {
    const g = it.g, d = new Date(g.date + 'T12:00:00');
    const href = baseUrl() + `/practice-conti?team=${encodeURIComponent(p.team)}&pd=${encodeURIComponent(g.date)}`;
    const ev = pv.calEvent(p.team, g, it.mine.map((x) => ({ name: pv.targetName(x.t), pos: x.pos })), baseUrl());
    const google = pv.googleCalUrl(ev), ics = calLink(p.team, g.date, p.name);
    const pos = posOf(it);
    const songs = it.mine.map((x) => ({ name: pv.targetName(x.t), s: songsOf(songRows, p.team, x.t) }));
    const songHtml = songs.map(({ name, s }) => {
      const li = (x, mark) => `<tr><td style="width:26px;padding:7px 0;vertical-align:top;color:#8A5F22;font-weight:700;font-size:14px;">${mark}</td>
        <td style="padding:7px 0;font-size:15px;color:#122722;border-bottom:1px solid #E7ECE9;"><b style="font-weight:700;">${esc(x.title)}</b>${x.team ? `<span style="color:#6B7A75;"> · ${esc(x.team)}</span>` : ''}${x.key ? `<span style="float:right;color:#1F4A3F;font-weight:700;">${esc(x.key)}</span>` : ''}</td></tr>`;
      const rows = s.conti.map((x, i) => li(x, i + 1)).concat(s.final.map((x) => li(x, '✝')), s.closing.map((x) => li(x, '♪'))).join('');
      return `<p style="margin:22px 0 4px;font-size:13px;font-weight:700;color:#4C645E;">${esc(name)} 콘티</p>
        ${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>` : '<p style="margin:6px 0;font-size:14px;color:#6B7A75;">아직 올라온 곡이 없어요. 곡이 올라오면 앱에서 알려 드려요.</p>'}`;
    }).join('');
    blocks.push(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid #D9E1DD;border-radius:14px;overflow:hidden;">
        <tr>
          <td width="104" style="background:#1F4A3F;padding:16px 10px;text-align:center;vertical-align:middle;">
            <div style="font-size:13px;color:#D6B97F;font-weight:700;">${d.getMonth() + 1}월</div>
            <div style="font-size:34px;line-height:1.1;color:#F5F0E4;font-weight:800;">${d.getDate()}</div>
            <div style="font-size:13px;color:#D6B97F;font-weight:700;">${WD[d.getDay()]}요일</div>
          </td>
          <td style="padding:14px 18px;vertical-align:middle;background:#FBFCFB;">
            <div style="font-size:19px;font-weight:800;color:#122722;">${esc(timeSettings.fmt(g.time))}</div>
            <div style="font-size:15px;color:#33443F;margin-top:2px;">${esc(g.place || '')}</div>
            <div style="font-size:14px;color:#33443F;margin-top:8px;">${esc(contiNames(it))} 콘티</div>
            ${pos.length ? `<div style="margin-top:8px;">${pos.map((x) => `<span style="display:inline-block;margin:0 4px 4px 0;padding:2px 10px;border-radius:99px;border:1px solid #C9A86A;color:#8A5F22;font-size:12.5px;font-weight:700;">${esc(x)}</span>`).join('')}</div>` : ''}
          </td>
        </tr>
      </table>
      ${songHtml}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr>
        <td style="border-radius:10px;background:#1F4A3F;"><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;color:#F5F0E4;text-decoration:none;font-size:15px;font-weight:700;">연습 콘티 열기</a></td>
      </tr></table>
      <p style="margin:12px 0 0;font-size:13.5px;color:#4C645E;">캘린더에 넣기 ·
        <a href="${esc(google)}" style="color:#1F4A3F;font-weight:700;">구글 캘린더</a> ·
        <a href="${esc(ics)}" style="color:#1F4A3F;font-weight:700;">아이폰 · 맥 캘린더</a></p>`);
    texts.push(`■ ${mdShort(g.date)}(${WD[d.getDay()]}) ${when(g)} — ${contiNames(it)} 콘티${pos.length ? ' (' + pos.join(' · ') + ')' : ''}\n`
      + songs.map(({ name, s }) => `  ${name} 콘티: ` + (s.conti.concat(s.final, s.closing).map((x) => x.title + (x.key ? ` (${x.key})` : '')).join(', ') || '아직 곡이 없어요')).join('\n')
      + `\n  연습 콘티: ${href}\n  구글 캘린더: ${google}\n  아이폰 캘린더: ${ics}`);
  }

  const lead = `${dayWord(first.g.date, today)} ${you}께서 참석하셔야 하는 ${first.g.date.slice(5, 7) * 1}월 ${first.g.date.slice(8, 10) * 1}일 ${when(first.g)}에서 ${contiNames(first)} 콘티 연습이 있습니다. 연습으로 준비해주세요.`;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#EEF2EF;">
  <div style="display:none;max-height:0;overflow:hidden;">${esc(lead)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2EF;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;">
      <tr><td style="background:#17302A;padding:22px 26px 20px;">
        <div style="font-size:13px;color:#D6B97F;font-weight:700;">${esc(p.team)} · 이번 주 연습</div>
        <div style="margin-top:8px;font-size:21px;line-height:1.45;color:#F5F0E4;font-weight:700;">${esc(you)}, 이번 주 연습에 서세요</div>
      </td></tr>
      <tr><td style="padding:22px 26px 8px;">
        <p style="margin:0 0 18px;font-size:15.5px;line-height:1.65;color:#122722;">${esc(lead)}</p>
        ${blocks.join('<div style="height:28px;"></div>')}
        <p style="margin:26px 0 0;padding:12px 14px;border-radius:10px;background:#F4F7F5;font-size:13.5px;line-height:1.6;color:#33443F;">연습에 오기 어려우면 스케줄표에서 그 날을 <b>연습 불참</b>으로 표시해 주세요. 인도자와 팀이 미리 알 수 있어요.</p>
      </td></tr>
      <tr><td style="padding:18px 26px 24px;font-size:12px;line-height:1.6;color:#7A847F;">
        이 메일은 ${esc(p.team)} 스케줄표에서 이번 주 연습에 편성된 분께 매주 월요일 아침 자동으로 보내져요.<br>
        해외한인장로회 토론토영락교회 · 650 McNicoll Ave. Toronto, ON
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = `${lead}\n\n${texts.join('\n\n')}\n\n연습에 오기 어려우면 스케줄표에서 그 날을 '연습 불참'으로 표시해 주세요.\n— ${p.team} · 토론토영락교회 찬양팀 허브`;
  const push = { title: `이번 주 연습 · ${mdShort(first.g.date)}(${WD[dowOf(first.g.date)]})`, body: `${when(first.g)} · ${contiNames(first)} 콘티${posOf(first).length ? ' · ' + posOf(first).join(' · ') : ''}`,
    url: `/practice-conti?team=${encodeURIComponent(p.team)}&pd=${encodeURIComponent(first.g.date)}` };
  return { subject, html, text, push };
}

/* ---------------------------------------------------------------- 보내기 */
let running = null;
/**
 * @param {{force?:boolean, now?:string}} o force = 월요일 · 시각 · 이미 보냄 · 꺼짐을 무시 (관리자 시험용 아님 — 시험은 testTo)
 * @returns {Promise<{ran:boolean, why?:string, teams:object[]}>}
 */
async function run(o = {}) {
  const today = o.now || week.todayStr();
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto', hour: '2-digit', hour12: false }));
  if (!o.force) {
    if (!(await enabled())) return { ran: false, why: '꺼져 있음', teams: [] };
    if (dowOf(today) !== 1) return { ran: false, why: '월요일이 아님', teams: [] };
    if (hour < SEND_HOUR) return { ran: false, why: `아직 ${SEND_HOUR}시 전`, teams: [] };
  }
  const mon = mondayOf(today), sun = prac.addDays(mon, 6);
  const result = [];
  for (const team of await activeTeams()) {
    if (!o.force && (await lastSent(team)) === mon) { result.push({ team, skipped: '이미 보냄' }); continue; }
    await setSetting(SENT + team, mon, '월요일 연습 안내를 보낸 주 (같은 주에 두 번 안 가게)');      // 먼저 적어 둠 — 도중에 겹쳐 불려도 두 번 안 감
    const people = await plan(team, today, sun);
    let pushed = 0, mailed = 0, failed = 0;
    for (const p of people) {
      const m = await compose(p, today);
      try { const r = await notify.send(team, { kind: '연습', title: m.push.title, body: m.push.body, url: m.push.url, by: '자동 (월요일 연습 안내)', to: [p.email] }); pushed += r.sent ? 1 : 0; } catch (e) { console.error('[연습 안내 푸시 실패]', p.name, e && e.message); }
      if (mailer.configured()) {
        try { await mailer.send({ to: p.email, subject: m.subject, html: m.html, text: m.text }); mailed++; } catch (e) { failed++; console.error('[연습 안내 메일 실패]', p.name, e && e.message); }
      }
    }
    console.log(`[연습 안내] ${team} ${mon} — ${people.length}명 · 푸시 ${pushed} · 메일 ${mailed}${failed ? ' · 실패 ' + failed : ''}`);
    result.push({ team, people: people.length, pushed, mailed, failed });
  }
  return { ran: true, teams: result };
}
function ensure(o) { if (!running) running = run(o).catch((e) => { console.error('[연습 안내 실패]', e && e.message); return { ran: false, why: e && e.message, teams: [] }; }).finally(() => { running = null; }); return running; }
/** 서버가 깨어 있을 때 — 15분마다 "월요일 8시 지났고 아직 안 보냈나" 확인 */
function start() { setTimeout(() => ensure(), 120000); setInterval(() => ensure(), 15 * 60 * 1000).unref(); }

/**
 * 미리보기 — 이 사람의 다음 연습 안내(앞으로 4주 안에서 처음 서는 연습). 서는 연습이 없으면 가장 가까운 연습으로 견본.
 * @returns {Promise<null|{subject,html,text,push,sample:boolean,to:string}>}
 */
async function preview(team, member) {
  const today = week.todayStr();
  const name = String(member['이름'] || '').trim();
  const all = await plan(team, today, prac.addDays(today, 28));
  let p = all.find((x) => x.name === name), sample = false;
  if (p) p = Object.assign({}, p, { items: [p.items[0]] });
  else {
    const g = (await pv.groups(team, today, prac.addDays(today, 28)))[0];
    if (!g) return null;
    sample = true;
    p = { team, name, email: String(member['이메일'] || ''), pastor: honorific.isPastorRoles(member['역할']), items: [{ g, mine: g.targets.map((t) => ({ t, pos: ['(포지션)'] })) }] };
  }
  const m = await compose(p, mondayOf(p.items[0].g.date) > today ? mondayOf(p.items[0].g.date) : today);
  return Object.assign(m, { sample, to: p.email });
}

module.exports = { run, ensure, start, preview, plan, compose, enabled, setEnabled, lastSent, calSig, mondayOf };
