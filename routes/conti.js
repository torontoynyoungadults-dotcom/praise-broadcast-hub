/**
 * 예배콘티 — church-app의 예배콘티를 가져오되:
 *  - "이주의 말씀"(성경구절) 기능은 뺌
 *  - "가사도구"는 뺌
 *  - 녹음은 유지하지만 드라이브 폴더 자동 스캔/자동링크는 빼고, 직접 업로드 또는 링크 입력으로 대체
 * 로그인 없이 보는 공개 링크(팀+주차 단위, 읽기 전용)도 이 파일에서 함께 처리합니다.
 */
const express = require('express');
const upload = require('../lib/upload');
const sheetsDb = require('../lib/sheetsDb');
const driveStore = require('../lib/driveStore');
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
      { title: '예배콘티' },
    ));
  }
  req.ctx = ctx;
  next();
}

function backTo(res, team, date) {
  res.redirect(`/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}`);
}

/* ---------- 조회(읽기) 공통 — 로그인 화면과 공개 화면이 함께 씁니다 ---------- */
async function loadWeek(team, date) {
  const [songs, metaRows, sheets, recs, comments] = await Promise.all([
    sheetsDb.readAll('찬양콘티'),
    sheetsDb.readAll('콘티메타'),
    sheetsDb.readAll('악보저장소'),
    sheetsDb.readAll('녹음'),
    sheetsDb.readAll('콘티댓글'),
  ]);
  const mine = (rows) => rows.filter((r) => r['팀ID'] === team && r['날짜'] === date);
  const list = mine(songs);
  const order = (a, b) => Number(a['순서'] || 0) - Number(b['순서'] || 0);
  return {
    conti: list.filter((r) => r['구분'] !== '결단').sort(order),
    final: list.filter((r) => r['구분'] === '결단').sort(order),
    meta: metaRows.find((r) => r['팀ID'] === team && r['날짜'] === date) || null,
    sheets: mine(sheets),
    recs: mine(recs),
    comments: mine(comments).sort((a, b) => String(a['작성시각']).localeCompare(String(b['작성시각']))),
  };
}

function songRow(s, { editable }) {
  const bits = [s['Key'] && `Key ${s['Key']}`, s['송폼'], s['BPM'] && `${s['BPM']} BPM`].filter(Boolean).join(' · ');
  return `<div class="ph-list-item">
    <div class="ph-li-main">
      <div class="ph-li-title">${esc(s['제목'] || '(제목 없음)')}</div>
      ${bits ? `<div class="ph-li-sub">${esc(bits)}</div>` : ''}
      ${s['유튜브'] ? `<a class="ph-li-link" href="${esc(s['유튜브'])}" target="_blank" rel="noopener">▶ 유튜브</a>` : ''}
      ${s['비고'] ? `<div class="ph-li-note">${esc(s['비고'])}</div>` : ''}
    </div>
    ${editable ? `<form method="post" action="/conti/songs/delete" onsubmit="return confirm('이 곡을 지울까요?')">
      <input type="hidden" name="__row" value="${s.__row}">
      <input type="hidden" name="team" value="${esc(s['팀ID'])}"><input type="hidden" name="date" value="${esc(s['날짜'])}">
      <button class="ph-row-del" type="submit" title="삭제">✕</button>
    </form>` : ''}
  </div>`;
}

function songForm(kind, team, date) {
  const label = kind === '결단' ? '결단찬양 추가' : '콘티에 곡 추가';
  return `<details class="ph-add">
    <summary>+ ${label}</summary>
    <form method="post" action="/conti/songs" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}"><input type="hidden" name="구분" value="${kind}">
      <input type="text" name="제목" placeholder="곡 제목" required>
      <div class="ph-inline3">
        <input type="text" name="Key" placeholder="Key (예: G)">
        <input type="text" name="송폼" placeholder="송폼">
        <input type="text" name="BPM" placeholder="BPM" inputmode="numeric">
      </div>
      <input type="text" name="유튜브" placeholder="유튜브 링크 (선택)">
      <input type="text" name="비고" placeholder="비고 (선택)">
      <button class="ph-btn pri" type="submit">추가</button>
    </form>
  </details>`;
}

function sheetItem(s, editable) {
  return `<div class="ph-list-item">
    <div class="ph-li-main"><a class="ph-li-link strong" href="${esc(s['파일링크'])}" target="_blank" rel="noopener">📄 ${esc(s['제목'] || '악보')}</a>
      <div class="ph-li-sub">${esc(s['올린사람'] || '')}</div></div>
    ${editable ? `<form method="post" action="/conti/sheets/delete" onsubmit="return confirm('이 악보를 지울까요?')">
      <input type="hidden" name="__row" value="${s.__row}">
      <input type="hidden" name="team" value="${esc(s['팀ID'])}"><input type="hidden" name="date" value="${esc(s['날짜'])}">
      <button class="ph-row-del" type="submit" title="삭제">✕</button>
    </form>` : ''}
  </div>`;
}

function commentItem(c) {
  return `<div class="ph-list-item"><div class="ph-li-main">
    <div class="ph-li-title">${esc(c['이름'] || '익명')}</div>
    <div class="ph-li-note">${esc(c['내용'] || '')}</div>
  </div></div>`;
}

function recItem(r, editable) {
  return `<div class="ph-list-item">
    <div class="ph-li-main"><a class="ph-li-link strong" href="${esc(r['링크'])}" target="_blank" rel="noopener">🎧 ${esc(r['제목'] || '녹음')}</a>
      <div class="ph-li-sub">${esc(r['올린사람'] || '')}</div></div>
    ${editable ? `<form method="post" action="/conti/recordings/delete" onsubmit="return confirm('이 녹음을 지울까요?')">
      <input type="hidden" name="__row" value="${r.__row}">
      <input type="hidden" name="team" value="${esc(r['팀ID'])}"><input type="hidden" name="date" value="${esc(r['날짜'])}">
      <button class="ph-row-del" type="submit" title="삭제">✕</button>
    </form>` : ''}
  </div>`;
}

/* ================= 로그인 화면 ================= */
router.get('/conti', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const date = week.normalizeDate(req.query.date);
  const w = await loadWeek(team, date);

  const nav = `<div class="ph-weeknav">
    <a class="ph-icon-btn" href="/conti?team=${encodeURIComponent(team)}&date=${week.shiftWeek(date, -1)}">‹</a>
    <form method="get" class="ph-weekdate"><input type="hidden" name="team" value="${esc(team)}">
      <input type="date" name="date" value="${esc(date)}" onchange="this.form.submit()"></form>
    <a class="ph-icon-btn" href="/conti?team=${encodeURIComponent(team)}&date=${week.shiftWeek(date, 1)}">›</a>
  </div>`;

  const publicUrl = `/public/conti?team=${encodeURIComponent(team)}&date=${encodeURIComponent(date)}`;

  const hero = pageShell.hero({ eyebrow: `${team} · 예배콘티`, title: '예배콘티', sub: week.labelKo(date) });

  const content = `
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx, { keep: { date } })}
    ${nav}
    <p class="ph-msg" style="margin-top:12px;"><a href="${publicUrl}" target="_blank" rel="noopener">🔗 로그인 없이 보는 공개 링크</a></p>
  </div>

  <div class="ph-card top-accent">
    <h2 class="ph-h2">콘티</h2>
    <div class="ph-list">${w.conti.length ? w.conti.map((s) => songRow(s, { editable: true })).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div>
    ${songForm('콘티', team, date)}
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">결단찬양</h2>
    <div class="ph-list">${w.final.length ? w.final.map((s) => songRow(s, { editable: true })).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    ${songForm('결단', team, date)}
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">이번 주 정보</h2>
    <form method="post" action="/conti/meta" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
      <div class="ph-field"><label>토요연습시간</label><input type="text" name="토요연습시간" placeholder="예: 토요일 오후 2시" value="${esc(w.meta && w.meta['토요연습시간'] || '')}"></div>
      <div class="ph-field"><label>유튜브 재생목록</label><input type="text" name="유튜브재생목록" placeholder="연습용 유튜브 재생목록 링크" value="${esc(w.meta && w.meta['유튜브재생목록'] || '')}"></div>
      <div class="ph-field"><label>방송팀 요청</label><input type="text" name="방송팀요청" placeholder="방송팀에 전달할 요청사항" value="${esc(w.meta && w.meta['방송팀요청'] || '')}"></div>
      <button class="ph-btn" type="submit">저장</button>
    </form>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">악보</h2>
    <div class="ph-list">${w.sheets.length ? w.sheets.map((s) => sheetItem(s, true)).join('') : '<p class="ph-sub">아직 올라온 악보가 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 악보 올리기</summary>
      <form method="post" action="/conti/sheets" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
        <input type="text" name="제목" placeholder="곡 제목" required>
        <input type="file" name="파일" accept=".pdf,image/*">
        <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
        <button class="ph-btn pri" type="submit">올리기</button>
      </form>
    </details>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">녹음</h2>
    <h3 class="ph-h3">연습 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] !== '예배').length ? w.recs.filter((r) => r['구분'] !== '예배').map((r) => recItem(r, true)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <h3 class="ph-h3">예배 녹음</h3>
    <div class="ph-list">${w.recs.filter((r) => r['구분'] === '예배').length ? w.recs.filter((r) => r['구분'] === '예배').map((r) => recItem(r, true)).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 녹음 올리기</summary>
      <form method="post" action="/conti/recordings" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
        <input type="text" name="제목" placeholder="녹음 제목" required>
        <select name="구분"><option value="연습">연습 녹음</option><option value="예배">예배 녹음</option></select>
        <input type="file" name="파일" accept="audio/*">
        <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
        <button class="ph-btn pri" type="submit">올리기</button>
      </form>
    </details>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">댓글</h2>
    <div class="ph-list">${w.comments.length ? w.comments.map(commentItem).join('') : '<p class="ph-sub">아직 댓글이 없어요.</p>'}</div>
    <form method="post" action="/conti/comments" class="ph-inlineform">
      <input type="hidden" name="team" value="${esc(team)}"><input type="hidden" name="date" value="${esc(date)}">
      <input type="text" name="내용" placeholder="댓글을 남겨보세요" required>
      <button class="ph-btn" type="submit">등록</button>
    </form>
  </div>
  `;
  res.type('html').send(await pageShell.render(content, { title: `${team} 예배콘티` }));
});

router.post('/conti/songs', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const kind = b['구분'] === '결단' ? '결단' : '콘티';
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(res, team, date);
  const all = (await sheetsDb.readAll('찬양콘티')).filter((r) => r['팀ID'] === team && r['날짜'] === date && r['구분'] === kind);
  await sheetsDb.appendRow('찬양콘티', {
    'ID': 'C' + Date.now().toString(36), '팀ID': team, '날짜': date, '구분': kind,
    '순서': all.length + 1, '제목': title, 'Key': b['Key'] || '', '유튜브': b['유튜브'] || '',
    '송폼': b['송폼'] || '', 'BPM': b['BPM'] || '', '비고': b['비고'] || '', '만든시각': new Date().toISOString(),
  });
  backTo(res, team, date);
});

router.post('/conti/songs/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('찬양콘티', row); } catch (e) { console.error('[콘티 삭제 실패]', e.message); } }
  backTo(res, b.team, week.normalizeDate(b.date));
});

router.post('/conti/meta', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const existing = await sheetsDb.findWhere('콘티메타', (r) => r['팀ID'] === team && r['날짜'] === date);
  const row = {
    'ID': existing ? existing['ID'] : 'M' + Date.now().toString(36), '팀ID': team, '날짜': date,
    '토요연습시간': b['토요연습시간'] || '', '유튜브재생목록': b['유튜브재생목록'] || '', '방송팀요청': b['방송팀요청'] || '',
    '수정시각': new Date().toISOString(),
  };
  if (existing) await sheetsDb.updateRow('콘티메타', existing.__row, row);
  else await sheetsDb.appendRow('콘티메타', row);
  backTo(res, team, date);
});

router.post('/conti/sheets', requireTeam, upload.single('파일'), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(res, team, date);
  let link = String(b['링크'] || '').trim();
  try { if (req.file) link = await driveStore.uploadPublic('악보', req.file); } catch (e) { console.error('[악보 업로드 실패]', e.message); }
  if (!link) return backTo(res, team, date);
  await sheetsDb.appendRow('악보저장소', {
    'ID': 'F' + Date.now().toString(36), '팀ID': team, '날짜': date, '제목': title,
    '파일링크': link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
  });
  backTo(res, team, date);
});

router.post('/conti/sheets/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('악보저장소', row); } catch (e) { console.error('[악보 삭제 실패]', e.message); } }
  backTo(res, b.team, week.normalizeDate(b.date));
});

router.post('/conti/recordings', requireTeam, upload.single('파일'), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(res, team, date);
  let link = String(b['링크'] || '').trim();
  try { if (req.file) link = await driveStore.uploadPublic('음원', req.file); } catch (e) { console.error('[녹음 업로드 실패]', e.message); }
  if (!link) return backTo(res, team, date);
  await sheetsDb.appendRow('녹음', {
    'ID': 'R' + Date.now().toString(36), '팀ID': team, '날짜': date,
    '구분': b['구분'] === '예배' ? '예배' : '연습', '제목': title,
    '링크': link, '올린사람': req.ctx.member['이름'], '올린시각': new Date().toISOString(),
  });
  backTo(res, team, date);
});

router.post('/conti/recordings/delete', requireTeam, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) { try { await sheetsDb.deleteRow('녹음', row); } catch (e) { console.error('[녹음 삭제 실패]', e.message); } }
  backTo(res, b.team, week.normalizeDate(b.date));
});

router.post('/conti/comments', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim(), date = week.normalizeDate(b.date);
  const content = String(b['내용'] || '').trim();
  if (content) {
    await sheetsDb.appendRow('콘티댓글', {
      'ID': 'M' + Date.now().toString(36), '팀ID': team, '날짜': date,
      '이름': req.ctx.member['이름'], '내용': content, '작성시각': new Date().toISOString(),
    });
  }
  backTo(res, team, date);
});

/* ================= 로그인 없이 보는 공개 화면 (예배콘티만) ================= */
router.get('/public/conti', async (req, res) => {
  const team = String(req.query.team || '').trim();
  const date = week.normalizeDate(req.query.date);
  if (!team) return res.status(404).type('text').send('팀을 찾을 수 없습니다.');
  const teamRow = await sheetsDb.findOne('찬양팀', '팀명', team);
  if (!teamRow || String(teamRow['활성여부']).toUpperCase() === 'FALSE') {
    return res.status(404).type('text').send('존재하지 않거나 비활성화된 찬양팀입니다.');
  }
  const w = await loadWeek(teamRow['팀명'], date);
  const nav = `<div class="ph-weeknav">
    <a class="ph-icon-btn" href="/public/conti?team=${encodeURIComponent(team)}&date=${week.shiftWeek(date, -1)}">‹</a>
    <div class="ph-weekdate-label">${esc(week.labelKo(date))}</div>
    <a class="ph-icon-btn" href="/public/conti?team=${encodeURIComponent(team)}&date=${week.shiftWeek(date, 1)}">›</a>
  </div>`;
  const hero = pageShell.hero({ eyebrow: `${teamRow['팀명']} · 공개 콘티`, title: '예배콘티', sub: '로그인 없이 보는 공개 화면입니다.' });
  const content = `
  ${hero}
  <div class="ph-card">${nav}</div>
  <div class="ph-card top-accent">
    <h2 class="ph-h2">콘티</h2>
    <div class="ph-list">${w.conti.length ? w.conti.map((s) => songRow(s, { editable: false })).join('') : '<p class="ph-sub">아직 등록된 곡이 없어요.</p>'}</div>
  </div>
  <div class="ph-card">
    <h2 class="ph-h2">결단찬양</h2>
    <div class="ph-list">${w.final.length ? w.final.map((s) => songRow(s, { editable: false })).join('') : '<p class="ph-sub">아직 없어요.</p>'}</div>
  </div>
  <div class="ph-card">
    <h2 class="ph-h2">악보</h2>
    <div class="ph-list">${w.sheets.length ? w.sheets.map((s) => sheetItem(s, false)).join('') : '<p class="ph-sub">아직 올라온 악보가 없어요.</p>'}</div>
  </div>
  `;
  res.type('html').send(await pageShell.render(content, { title: `${teamRow['팀명']} 예배콘티 (공개)` }));
});

module.exports = router;
