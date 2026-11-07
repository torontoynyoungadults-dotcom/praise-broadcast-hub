const express = require('express');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const ui = require('../lib/uiIcons');

const router = express.Router();

router.get('/', async (req, res) => {
  if (!req.session) {
    const err = req.query.err ? `<p class="ph-msg err">${pageShell.esc(req.query.err)}</p>` : '';
    const hero = pageShell.hero({
      eyebrow: '토론토영락교회',
      title: 'YN 3부찬양팀 허브',
      sub: '구글 계정으로 로그인하면 소속 찬양팀의 콘티 · 공지 · 스케줄 · 라이브러리를 볼 수 있어요.',
    });
    const content = `
    ${hero}
    <div class="ph-card">
      <a class="ph-btn pri" href="/auth/google">Google로 로그인</a>
      ${err}
    </div>`;
    return res.type('html').send(await pageShell.render(content, { title: 'YN 3부찬양팀 허브' }));
  }

  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  const { isAdmin, roles, current: team } = ctx;

  // V13 홈 — 로그인하면 먼저 "이번 주 나의 일정 + 바로가기"를 보여 줌 (예전처럼 바로 예배 콘티로: ?go=conti)
  if (team && ctx.teams.length) {
    const q = req.query.team && ctx.teams.includes(String(req.query.team)) ? `?team=${encodeURIComponent(String(req.query.team))}` : '';
    if (req.query.go === 'conti') return spa.redirect(req, res, '/conti' + q);
    const name = String((ctx.member && ctx.member['이름']) || '').trim();
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dateKo = `${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}요일`;
    const greet = now.getDay() === 0 || now.getDay() === 6 ? '평안한 주말 보내세요' : '평안한 한 주 보내세요';
    const qs = q || (team ? `?team=${encodeURIComponent(team)}` : '');
    const esc = pageShell.esc;
    let hd = null;
    try { hd = await require('../lib/practiceView').homeData(team, name); } catch (e) { console.error('[홈 데이터]', e && e.message); }
    const dot = (d) => `${d.slice(5, 7)}.${d.slice(8, 10)}`;
    const mdK = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
    const mdS = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    const tq = (d) => `/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(d)}`;
    const nx = hd && hd.next;
    const chk = (ok, label) => `<span class="hm-ck${ok ? ' ok' : ''}"><i aria-hidden="true">${ok ? '✓' : ''}</i>${esc(label)}</span>`;
    const nextBlock = nx ? `<section class="hm-next" aria-labelledby="hm-next-h">
      <div class="hm-next-top"><div><h2 id="hm-next-h">다음 섬김</h2><b class="hm-next-d">${mdK(nx.date)} 주일</b><span class="hm-next-s"><b>${esc(nx.pos.join(' · '))}</b>${nx.rehearsal ? ` · 리허설 ${nx.rehearsal}` : ''}${nx.worship ? ` · 예배 ${nx.worship}` : ''}</span></div><span class="hm-dday">${nx.dday === 0 ? 'D-day' : 'D-' + nx.dday}</span></div>
      <div class="hm-cks" aria-label="준비 상황">${chk(nx.nConti > 0, nx.nConti ? `콘티 ${nx.nConti}곡` : '콘티 준비 중')}${chk(nx.nSheets > 0, nx.nSheets ? `악보 ${nx.nSheets}` : '악보 아직')}${chk(nx.pracDone, nx.prac ? `연습 ${mdS(nx.prac)}` : '연습 미정')}${chk(false, '곡 들어보기')}</div>
      <div class="hm-next-btns"><a class="hm-yt" href="${tq(nx.date)}#yt">${ui.icon('play')} 유튜브 이어 듣기</a><a class="hm-ct" href="${tq(nx.date)}">${mdS(nx.date)} 콘티 보기</a></div>
    </section>` : `<section class="hm-next hm-next-none"><div class="hm-next-top"><div><h2>다음 섬김</h2><span class="hm-next-s">앞으로 8주 안에 서는 주일이 없어요</span></div></div></section>`;
    const row = (k, d, t, sub, tag, on, href) => `<${href ? `a href="${href}"` : 'div'} class="hm-row"><span class="hm-rd"><small>${esc(k)}</small><b>${dot(d)}</b></span><span class="hm-rt"><span>${esc(t)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="hm-tag${on ? ' on' : ''}">${esc(tag)}</span></${href ? 'a' : 'div'}>`;
    const wk = hd && hd.week;
    const weekRows = wk ? [
      row(`${wk.fri.has ? '일월화수목금토'[new Date(wk.fri.date + 'T12:00:00').getDay()] : '금'} 연습`, wk.fri.date, wk.fri.has ? wk.fri.text : '연습이 없어요', wk.fri.sub, wk.fri.has ? (wk.fri.pos.length ? wk.fri.pos.join(' · ') : '쉼') : '없음', wk.fri.has && wk.fri.pos.length, wk.fri.has ? `/practice-conti?team=${encodeURIComponent(team)}&pd=${encodeURIComponent(wk.fri.date)}` : ''),
      row('주일', wk.sun.date, wk.sun.on ? `${wk.sun.pos.join(' · ')}로 섬기는 주일이에요` : '섬기는 주일이 아니에요', wk.sun.sub, wk.sun.on ? wk.sun.pos.join(' · ') : '쉼', wk.sun.on, tq(wk.sun.date)),
      wk.nextP ? row('다음 연습', wk.nextP.date, wk.nextP.text, wk.nextP.sub, wk.nextP.pos.join(' · '), true, `/practice-conti?team=${encodeURIComponent(team)}&pd=${encodeURIComponent(wk.nextP.date)}`) : '',
    ].join('') : '';
    const tile = (href, title, sub, icon) => `<a class="hm-tile2" href="${href}${qs}">${ui.icon(icon)}<span><b>${esc(title)}</b><small>${esc(sub)}</small></span></a>`;
    const content = `
  ${pageShell.hubNav('', team)}
  ${pageShell.hero({ barOnly: true })}
  <section class="hm-dark">
    <div class="hm-hi"><span>${esc(dateKo)}</span><h1>${esc(name)}님,<br>${esc(greet)}</h1></div>
    ${nextBlock}
  </section>
  ${weekRows ? `<section class="hm-sec" aria-labelledby="hm-week-h"><div class="v13-sechead"><h2 class="ph-h2" id="hm-week-h">이번 주</h2></div><div class="hm-rows">${weekRows}</div></section>` : ''}
  <section class="hm-tiles" aria-label="자주 쓰는 것">
    ${tile('/schedule', '스케쥴', hd && hd.counts ? `내 일정 ${hd.counts.mine} · 안 되는 날 ${hd.counts.off}` : '내가 서는 날 · 안 되는 날', 'calendar')}
    ${tile('/schedule', '안 되는 날 알리기', '날짜만 누르면 끝', 'check')}
    ${tile('/library', '라이브러리', hd && hd.counts ? `${hd.counts.songs}곡 · 악보 · 녹음` : '곡 · 악보 · 녹음', 'book')}
    ${tile('/events', '주일 외', hd && hd.counts && hd.counts.ev ? `${hd.counts.ev.name} ${mdS(hd.counts.ev.date)} · D-${hd.counts.ev.dday}` : '성탄절 · 특별 예배', 'cross')}
  </section>
  ${hd && hd.news && hd.news.length ? `<section class="hm-sec" aria-labelledby="hm-new-h"><div class="v13-sechead"><h2 class="ph-h2" id="hm-new-h">팀 소식</h2></div>
    ${hd.news.map((n) => `<a class="hm-news" href="${esc(n.href)}"><span class="k${n.warn ? ' w' : ''}">${esc(n.k)}</span><span class="t">${esc(n.t)}</span><span class="s">${esc(n.s)}</span></a>`).join('')}</section>` : ''}
  <a class="hm-cta2" href="/conti${qs}"><span><small>이번 주일${wk ? ' · ' + dot(wk.sun.date) : ''}</small>주일콘티 보기</span>${ui.icon('next')}</a>`;
    // TODO(redesign): 팀 소식(새 녹음 · 콘티 준비 · 미정 자리), 곡 들어보기 체크 기록, 안 되는 날 빠르게 알리기 화면
    return spa.send(req, res, content, { title: 'YN 3부찬양팀 허브' });
  }

  const hero = pageShell.hero({
    eyebrow: isAdmin ? '관리자' : (roles.join(' · ') || '팀원'),
    title: `${team || '찬양팀'} 허브`,
    sub: '예배 콘티 · 공지 · 스케줄 · 라이브러리를 한곳에서',
  });
  const content = `
  ${pageShell.hubNav('', team)}
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx)}
    <p class="ph-sub">위 메뉴를 눌러 예배 콘티 · 공지 및 모임 · 스케줄표 · 라이브러리 · 장비 · 수리를 오갈 수 있어요.</p>
  </div>
  <div class="ph-card">
    <a class="ph-btn" href="/logout">로그아웃</a>
  </div>`;
  spa.send(req, res, content, { title: `${team || '찬양팀'} 허브` });
});

// /admin 은 routes/admin.js 가 맡습니다 (찬양팀 · 멤버 · 태그라인 관리).

module.exports = router;
