/**
 * 라이브러리 — church-app의 "아카이브"(지난 콘티 · 악보 · 녹음 모아보기) + "통계"(곡 순위)를 하나로 합친 화면.
 * 원본은 두 개의 탭(아카이브/통계)이었지만, 이 허브에서는 원래 기획대로 "라이브러리" 하나로 둡니다.
 * (팀 강조 선택 · 인도자별 보기 · 월별 통계 · 오타 자동 교정 같은 세부 기능은 당장은 뺐습니다.)
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const week = require('../lib/weekUtil');

const router = express.Router();
const esc = pageShell.esc;

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length) {
    return res.type('html').send(await pageShell.render(
      `<div class="ph-card"><p class="ph-sub">아직 소속된 찬양팀이 없어요. 관리자에게 문의해주세요.</p><a class="ph-btn" href="/">← 허브로</a></div>`,
      { title: '라이브러리' },
    ));
  }
  req.ctx = ctx;
  next();
}

/** 제목 비교용 — 띄어쓰기 · 대소문자 · 괄호 속 설명을 무시 (church-app의 songNorm을 단순화) */
function norm(t) {
  return String(t || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^0-9a-z가-힣ㄱ-ㆎ]/g, '');
}
function ytId(url) {
  const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/.exec(String(url || ''));
  return m ? m[1] : '';
}

async function loadAll(team) {
  const [songs, sheets, recs] = await Promise.all([
    sheetsDb.readAll('찬양콘티'),
    sheetsDb.readAll('악보저장소'),
    sheetsDb.readAll('녹음'),
  ]);
  const mine = (rows) => rows.filter((r) => r['팀ID'] === team);
  return { songs: mine(songs), sheets: mine(sheets), recs: mine(recs) };
}

function matchesQ(hay, q) { return !q || norm(hay).includes(q); }

function dayCard(date, songs, sheets, recs, team) {
  const yt = (s) => { const id = ytId(s['유튜브']); return id ? `<a class="ph-li-link" href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener">▶</a>` : ''; };
  const songLine = (s) => `<div class="ph-arsong"><span class="ph-arno">${s['구분'] === '결단' ? '결' : s['순서']}</span>
    <span class="ph-art">${esc(s['제목'])}${s['팀'] ? `<em>${esc(s['팀'])}</em>` : ''}</span>
    ${s['Key'] ? `<span class="ph-kb">${esc(s['Key'])}</span>` : ''} ${yt(s)}</div>`;
  return `<div class="ph-card ph-arcard">
    <div class="ph-weektitle">${esc(week.labelKo(date))}
      <a class="ph-arrow" href="/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}">열기 ›</a></div>
    ${songs.length ? songs.map(songLine).join('') : '<p class="ph-sub" style="margin:4px 0;">콘티 없이 악보만 있어요.</p>'}
    ${sheets.length ? `<div class="ph-sub" style="margin-top:6px;">📄 악보 ${sheets.length}개</div>` : ''}
    ${recs.length ? `<div class="ph-sub">🎧 녹음 ${recs.length}개</div>` : ''}
  </div>`;
}

function daysView(all, team, q) {
  const byDate = {};
  all.songs.forEach((s) => { (byDate[s['날짜']] = byDate[s['날짜']] || { songs: [], sheets: [], recs: [] }).songs.push(s); });
  all.sheets.forEach((s) => { (byDate[s['날짜']] = byDate[s['날짜']] || { songs: [], sheets: [], recs: [] }).sheets.push(s); });
  all.recs.forEach((r) => { (byDate[r['날짜']] = byDate[r['날짜']] || { songs: [], sheets: [], recs: [] }).recs.push(r); });

  let dates = Object.keys(byDate);
  if (q) {
    dates = dates.filter((d) => {
      const day = byDate[d];
      return day.songs.some((s) => matchesQ(s['제목'], q) || matchesQ(s['팀'], q)) ||
        day.sheets.some((s) => matchesQ(s['제목'], q)) || day.recs.some((r) => matchesQ(r['제목'], q));
    });
  }
  const today = week.todayStr();
  const upcoming = dates.filter((d) => d >= today).sort();
  const past = dates.filter((d) => d < today).sort().reverse();
  const card = (d) => dayCard(d, byDate[d].songs.sort((a, b) => Number(a['순서'] || 0) - Number(b['순서'] || 0)), byDate[d].sheets, byDate[d].recs, team);

  if (!dates.length) return '<p class="ph-sub">아직 기록이 없어요.</p>';
  return (upcoming.length ? `<h3 class="ph-h3">다가오는 예배 · ${upcoming.length}</h3>${upcoming.map(card).join('')}` : '') +
    (past.length ? `<h3 class="ph-h3">지난 예배 · ${past.length}</h3>${past.map(card).join('')}` : '');
}

function songsView(all, team, q) {
  const g = {};
  all.songs.forEach((s) => {
    const key = norm(s['제목']);
    if (!key) return;
    if (q && !matchesQ(s['제목'], q) && !matchesQ(s['팀'], q)) return;
    const x = g[key] = g[key] || { title: s['제목'], team: s['팀'] || '', keys: {}, count: 0, dates: [], youtube: '' };
    x.count += 1;
    x.dates.push(s['날짜']);
    if (s['Key']) x.keys[s['Key']] = (x.keys[s['Key']] || 0) + 1;
    if (!x.youtube && s['유튜브']) x.youtube = s['유튜브'];
    if (!x.team && s['팀']) x.team = s['팀'];
  });
  const list = Object.values(g).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ko'));
  if (!list.length) return '<p class="ph-sub">아직 입력된 콘티가 없어요.</p>';
  return `<p class="ph-sub">${list.length}곡 · 많이 부른 순</p><div class="ph-list">` + list.map((x) => {
    const keys = Object.keys(x.keys).sort((a, b) => x.keys[b] - x.keys[a]);
    const dates = x.dates.sort().reverse();
    const id = ytId(x.youtube);
    return `<div class="ph-list-item"><div class="ph-li-main">
      <div class="ph-li-title">${esc(x.title)}${x.team ? ` <span class="ph-li-sub" style="display:inline;">· ${esc(x.team)}</span>` : ''}</div>
      <div class="ph-li-sub">${x.count}회 · ${keys.map(esc).join(', ')}${id ? ` · <a href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener">▶ YouTube</a>` : ''}</div>
      <div class="ph-li-sub">최근: ${dates.slice(0, 5).map((d) => `<a href="/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(d)}">${esc(d)}</a>`).join(', ')}${dates.length > 5 ? ` 외 ${dates.length - 5}회` : ''}</div>
    </div></div>`;
  }).join('') + '</div>';
}

function sheetsView(all, q) {
  const list = all.sheets.filter((s) => matchesQ(s['제목'], q)).sort((a, b) => String(b['날짜']).localeCompare(String(a['날짜'])));
  if (!list.length) return '<p class="ph-sub">올라온 악보가 없어요.</p>';
  return `<p class="ph-sub">${list.length}개</p><div class="ph-list">` + list.map((s) => `<div class="ph-list-item"><div class="ph-li-main">
    <a class="ph-li-link strong" href="${esc(s['파일링크'])}" target="_blank" rel="noopener">📄 ${esc(s['제목'] || '악보')}</a>
    <div class="ph-li-sub">${esc(s['날짜'])} · ${esc(s['올린사람'] || '')}</div></div></div>`).join('') + '</div>';
}

function recsView(all, q) {
  const list = all.recs.filter((r) => matchesQ(r['제목'], q)).sort((a, b) => String(b['날짜']).localeCompare(String(a['날짜'])));
  if (!list.length) return '<p class="ph-sub">올라온 녹음이 없어요.</p>';
  return `<p class="ph-sub">${list.length}개</p><div class="ph-list">` + list.map((r) => `<div class="ph-list-item"><div class="ph-li-main">
    <a class="ph-li-link strong" href="${esc(r['링크'])}" target="_blank" rel="noopener">🎧 ${esc(r['제목'] || '녹음')}</a>
    <div class="ph-li-sub">${esc(r['날짜'])} · ${r['구분'] === '예배' ? '예배' : '연습'} · ${esc(r['올린사람'] || '')}</div></div></div>`).join('') + '</div>';
}

router.get('/library', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const view = ['days', 'song', 'sheet', 'rec'].includes(req.query.view) ? req.query.view : 'days';
  const q = norm(req.query.q || '');
  const all = await loadAll(team);

  const hero = pageShell.hero({ eyebrow: `${team} · 라이브러리`, title: '라이브러리', sub: '지난 콘티 · 악보 · 녹음을 모아보고 찾아보세요.' });
  const tab = (key, label) => `<a class="pv-tab${view === key ? ' on' : ''}" href="/library?team=${encodeURIComponent(team)}&view=${key}${req.query.q ? `&q=${encodeURIComponent(req.query.q)}` : ''}">${label}</a>`;

  let body;
  if (view === 'song') body = songsView(all, team, q);
  else if (view === 'sheet') body = sheetsView(all, q);
  else if (view === 'rec') body = recsView(all, q);
  else body = daysView(all, team, q);

  const content = `
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx, { keep: { view, q: req.query.q } })}
    <div class="pv-songtabs" style="margin-bottom:10px;">${tab('days', '예배별')}${tab('song', '곡 순위')}${tab('sheet', '악보 전체')}${tab('rec', '녹음 전체')}</div>
    <form method="get" class="ph-inlineform" style="gap:8px;">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="view" value="${esc(view)}">
      <input type="search" name="q" value="${esc(req.query.q || '')}" placeholder="곡 · 원곡팀 · 파일 이름으로 찾기">
      <button class="ph-btn" type="submit">찾기</button>
    </form>
  </div>

  <div class="ph-card top-accent">${body}</div>
  `;
  res.type('html').send(await pageShell.render(content, { title: `${team} 라이브러리` }));
});

module.exports = router;
