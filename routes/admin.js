/**
 * 관리자 대시보드 — 찬양팀 추가/비활성화, 예배 시간 · 폐회송 기본값, 방송팀 링크, 바닥글 태그라인 설정.
 * 멤버의 소속팀 · 역할 관리는 "팀원관리"(routes/roster.js)에서 합니다.
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const { prefixOf } = require('../lib/prefix');
const pageShell = require('../lib/pageShell');
const spa = require('../lib/spa');
const timeSettings = require('../lib/timeSettings');
const closingHymn = require('../lib/closingHymn');
const guestLink = require('../lib/guestLink');
const upload = require('../lib/upload');
const driveStore = require('../lib/driveStore');
const pkgPdf = require('../lib/pkgPdf');
const sheetSearch = require('../lib/sheetSearch');
const ui = require('../lib/uiIcons');
const conti = require('./conti');
const S = () => conti.shared;

const router = express.Router();
const esc = pageShell.esc;

async function requireAdmin(req, res, next) {
  if (!req.session) return res.redirect('/');
  const member = await sheetsDb.findOne('회원', '이메일', req.session.email);
  if (!member || String(member['관리자여부']).toUpperCase() !== 'TRUE') return res.redirect('/');
  req.member = member;
  next();
}

function teamRow(t) {
  const active = String(t['활성여부']).toUpperCase() !== 'FALSE';
  return `<div class="ph-list-item">
    <div class="ph-li-main"><div class="ph-li-title">${esc(t['팀명'])}</div>
      <div class="ph-li-sub">${active ? '활성' : '비활성'}</div></div>
    <form method="post" action="/admin/teams/toggle">
      <input type="hidden" name="__row" value="${t.__row}"><input type="hidden" name="to" value="${active ? 'FALSE' : 'TRUE'}">
      <button class="ph-btn" type="submit">${active ? '비활성화' : '다시 활성화'}</button>
    </form>
  </div>`;
}

router.get('/admin', requireAdmin, async (req, res) => {
  const [teams, tagline] = await Promise.all([
    sheetsDb.readAll('찬양팀'),
    sheetsDb.getSetting('태그라인', '소망이 넘치는 교회'),
  ]);
  const activeTeams = teams.filter((t) => String(t['활성여부']).toUpperCase() !== 'FALSE');
  const tokens = await Promise.all(activeTeams.map((t) => guestLink.tokenFor(t['팀명']).catch(() => '')));
  const glRows = activeTeams.map((t, i) => {
    const token = tokens[i], url = token ? `${req.protocol}://${req.get('host')}${prefixOf(req)}/b/${token}` : '';
    return `<div class="ph-list-item" style="flex-direction:column;align-items:stretch;gap:8px;">
      <div class="ph-li-title">${esc(t['팀명'])}</div>
      ${token ? `<div class="cn-glrow" style="display:flex;gap:8px;"><input type="text" readonly value="${esc(url)}" aria-label="${esc(t['팀명'])} 방송팀 보기 링크" onfocus="this.select()" style="flex:1;min-width:0;">
        <button type="button" class="ph-btn" onclick="var i=this.parentNode.querySelector('input');i.select();(navigator.clipboard?navigator.clipboard.writeText(i.value):Promise.reject()).then(function(){this.textContent='복사됨 ✓'}.bind(this),function(){try{document.execCommand('copy');this.textContent='복사됨 ✓'}catch(e){}}.bind(this))">복사</button></div>` : '<p class="ph-sub" style="margin:0;">아직 만들지 않았어요.</p>'}
      <form method="post" action="/admin/guest-link"${token ? ` onsubmit="return confirm('새 링크로 바꾸면 예전 링크는 바로 쓸 수 없어요. 바꿀까요?')"` : ''}>
        <input type="hidden" name="team" value="${esc(t['팀명'])}"><button class="ph-btn${token ? '' : ' pri'}" type="submit">${token ? '새 링크로 바꾸기' : '링크 만들기'}</button></form>
    </div>`;
  }).join('');
  const tsAll = await Promise.all(activeTeams.map((t) => timeSettings.get(t['팀명'])));
  const timeCards = activeTeams.map((t, i) => { const v = tsAll[i];
    return `<form method="post" action="/admin/times" class="ph-list-item" style="flex-direction:column;align-items:stretch;gap:8px;">
      <div class="ph-li-title">${esc(t['팀명'])}</div>
      <input type="hidden" name="team" value="${esc(t['팀명'])}">
      <label class="ph-sub" style="margin:0;">예배 시간 <input type="text" name="worship" value="${esc(timeSettings.fmt(v.worship))}" placeholder="예: 오전 11시 15분" maxlength="20" style="width:11em;"></label>
      <label class="ph-sub" style="margin:0;">주일 당일 리허설 모임 <input type="text" name="rehearsal" value="${esc(timeSettings.fmt(v.rehearsal))}" placeholder="예: 오전 11시 15분" maxlength="20" style="width:11em;"></label>
      <label class="ph-sub" style="margin:0;">기본 연습 시간 <input type="text" name="practice" value="${esc(timeSettings.fmt(v.practice))}" placeholder="예: 오전 11시 15분" maxlength="20" style="width:11em;"></label>
      <label class="ph-sub" style="margin:0;">연습 장소 <input type="text" name="place" value="${esc(v.place)}" maxlength="30" placeholder="예: 본당"></label>
      <button class="ph-btn pri" type="submit">저장</button>
    </form>`; }).join('');
  const chAll = await Promise.all(activeTeams.map((t) => closingHymn.get(t['팀명'])));
  const chSheetsAll = await Promise.all(activeTeams.map((t) => closingHymn.getSheets(t['팀명'])));
  const chCards = activeTeams.map((t, i) => { const v = chAll[i] || {}; const sheets = chSheetsAll[i] || [];
    const sheetList = sheets.map((f, idx) => `<span class="ph-songsheet"><a class="ph-li-link" href="${esc(f['링크'])}" target="_blank" rel="noopener">${ui.icon('page')} ${esc(f['제목'] || '악보')}</a>
      <form method="post" action="/admin/closing-hymn/sheet/delete" style="display:inline;" onsubmit="return confirm('이 악보를 지울까요?')">
        <input type="hidden" name="team" value="${esc(t['팀명'])}"><input type="hidden" name="idx" value="${idx}">
        <button class="ph-row-del" type="submit" title="삭제" aria-label="삭제">${ui.icon('close')}</button>
      </form></span>`).join('');
    return `<div class="ph-list-item" style="flex-direction:column;align-items:stretch;gap:8px;">
      <div class="ph-li-title">${esc(t['팀명'])}</div>
      <form method="post" action="/admin/closing-hymn" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(t['팀명'])}">
        <input type="text" name="제목" value="${esc(v['제목'] || '')}" placeholder="곡 제목" maxlength="80" required>
        <div class="ph-inline3">
          <input type="text" name="팀" value="${esc(v['팀'] || '')}" placeholder="원곡팀" maxlength="60">
          <input type="text" name="Key" value="${esc(v['Key'] || '')}" placeholder="Key" maxlength="8">
          <input type="text" name="BPM" value="${esc(v['BPM'] || '')}" placeholder="BPM" inputmode="numeric" maxlength="4">
        </div>
        <input type="text" name="송폼" value="${esc(v['송폼'] || '')}" placeholder="송폼 (예: V1-C-V2-C)" maxlength="120">
        <input type="text" name="유튜브" value="${esc(v['유튜브'] || '')}" placeholder="유튜브 링크 (선택)" maxlength="300">
        <textarea name="비고" rows="2" placeholder="곡 설명 (선택)" maxlength="300">${esc(v['비고'] || '')}</textarea>
        <button class="ph-btn pri" type="submit">저장</button>
      </form>
      <div class="ph-songsheets">${sheetList}
        <details class="ph-add ph-songsheet-add">
          <summary>+ 폐회송 악보 올리기</summary>
          <form method="post" action="/admin/closing-hymn/sheet" enctype="multipart/form-data" class="ph-inlineform">
            <input type="hidden" name="team" value="${esc(t['팀명'])}">
            <input type="file" name="파일" accept=".pdf,image/*" multiple>
            <input type="text" name="제목" placeholder="제목 (비워 두면 파일 이름이 제목이 돼요)">
            <input type="text" name="링크" placeholder="또는 링크 직접 입력 (파일 대신)">
            <button type="button" class="ph-btn" data-sheet-search data-pick="1">${ui.icon('search')} 웹에서 악보 찾기</button><span class="ss-picked" hidden></span>
            <label class="ph-hdrchk"><input type="checkbox" name="header" value="1" data-sheet-hdr> 헤더 자동 추가 <small>(제목 · 원곡팀 · KEY · BPM · 송폼 머리말을 달고, 악보의 제목 · 여백은 자동으로 잘라요. 끄면 올린 그대로)</small></label>
            <button type="button" class="ph-btn" data-sheet-hdr-crop hidden>${ui.icon('page')} 자르기 조정</button><input type="hidden" name="crop" value="">
            <button class="ph-btn pri" type="submit">올리기</button>
          </form>
        </details>
      </div>
    </div>`; }).join('');
  const hero = pageShell.hero({ eyebrow: '관리자', title: '관리자 설정', sub: '찬양팀 · 시간 · 허브 문구를 관리합니다.' });

  const content = `
  ${pageShell.hubNav('', '')}
  ${hero}
  ${pageShell.adminTabs('admin', '')}

  <div class="ph-card top-accent">
    <h2 class="ph-h2">허브 바닥글 태그라인</h2>
    <form method="post" action="/admin/tagline" class="ph-inlineform">
      <input type="text" name="태그라인" value="${esc(tagline)}" maxlength="60">
      <button class="ph-btn pri" type="submit">저장</button>
    </form>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">찬양팀</h2>
    <div class="ph-list">${teams.length ? teams.map(teamRow).join('') : '<p class="ph-sub">아직 찬양팀이 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 찬양팀 추가</summary>
      <form method="post" action="/admin/teams" class="ph-inlineform">
        <input type="text" name="팀명" placeholder="예: 2부 찬양팀" required>
        <button class="ph-btn pri" type="submit">추가</button>
      </form>
    </details>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">예배 · 연습 시간</h2>
    <p class="ph-sub">거의 매주 같은 시간이라 기본값으로 두었어요. PDF 커버와 스케줄표에 자동으로 들어가요. 연습 시간은 스케줄표에서 그 주만 따로 바꿀 수 있고, <b>주일 외 찬양</b>은 행사마다 시간을 따로 적어요.</p>
    <div class="ph-list">${timeCards}</div>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">폐회송</h2>
    <p class="ph-sub">축도 직전에 부르는 곡이에요. 보통 1년에 한 번 정도만 바뀌어요 — 여기서 정해두면 매주 콘티에 자동으로 들어가고, 인쇄용 PDF 패키지와 라이브 악보에도 함께 나와요. 악보도 여기서 올려두면 똑같이 매주 따라가요. 어느 한 주만 다르면 그 주의 콘티 화면에서 바로 고치면 돼요.</p>
    <div class="ph-list">${chCards || '<p class="ph-sub">활성 찬양팀이 없어요.</p>'}</div>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">방송팀 보기 링크</h2>
    <p class="ph-sub">로그인 없이 <b>예배 콘티 · 라이브 악보 · 스케줄표</b>를 볼 수 있는 링크예요 (고칠 수 없고 댓글만 가능). 방송팀에 전달해 주세요.</p>
    <div class="ph-list">${glRows || '<p class="ph-sub">활성 찬양팀이 없어요.</p>'}</div>
  </div>
  `;
  spa.send(req, res, content, { title: '관리자' });
});

router.post('/admin/guest-link', requireAdmin, async (req, res) => {
  const team = String((req.body || {}).team || '').trim();
  const t = team ? await sheetsDb.findOne('찬양팀', '팀명', team) : null;
  if (t) { try { await guestLink.regenerate(team); } catch (e) { console.error('[방송팀 링크 저장 실패]', e.message); } }
  spa.redirect(req, res, '/admin');
});

router.post('/admin/times', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const t = team ? await sheetsDb.findOne('찬양팀', '팀명', team) : null;
  if (t) { try { await timeSettings.save(team, { worship: b.worship, rehearsal: b.rehearsal, practice: b.practice, place: b.place }); } catch (e) { console.error('[시간 설정 저장 실패]', e.message); } }
  spa.redirect(req, res, '/admin');
});

router.post('/admin/closing-hymn', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const t = team ? await sheetsDb.findOne('찬양팀', '팀명', team) : null;
  if (t && String(b['제목'] || '').trim()) {
    try { await closingHymn.save(team, { 제목: b['제목'], 팀: b['팀'], Key: b['Key'], BPM: b['BPM'], 송폼: b['송폼'], 유튜브: b['유튜브'], 비고: b['비고'] }); }
    catch (e) { console.error('[폐회송 저장 실패]', e.message); }
  }
  spa.redirect(req, res, '/admin');
});

/** 폐회송 기본 악보에 "헤더 자동 추가" — 콘티의 한 곡 전용 악보 올리기와 같지만, 아직 그 주의 곡 줄이 없으니
 *  저장된 폐회송 기본값(제목 · 원곡팀 · Key · BPM · 송폼)으로 머리말을 답니다. */
async function headerizeClosingHymnFiles(req, team) {
  const files = (req.files || []).filter((f) => f && f.buffer && f.buffer.length);
  if (!files.length) return;
  const def = (await closingHymn.get(team)) || {};
  const s = { kind: '폐회송', no: 1, title: def['제목'] || '', team: def['팀'] || '', key: def['Key'] || '', bpm: def['BPM'] || '', form: def['송폼'] || '', note: '' };
  const crops = String((req.body || {}).crop || '').split('|');
  for (let i = 0; i < files.length; i++) {
    try {
      const pdf = await pkgPdf.buildSongSheet(s, { buf: files[i].buffer, crop: crops[i] || '' }, sheetSearch.imagesToPdf);
      if (pdf) { files[i].buffer = pdf; files[i].mimetype = 'application/pdf'; files[i].originalname = String(files[i].originalname || '악보').replace(/\.[^.]*$/, '') + '.pdf'; files[i].size = pdf.length; }
    } catch (e) { console.error('[폐회송 악보 헤더 추가 실패]', files[i].originalname, e.message); }
  }
}

/** 폐회송 기본 악보 올리기 — 파일 · 링크 · 웹에서 찾은 이미지 모두 가능 (콘티의 "이 곡 악보 올리기"와 같은 방식).
 *  저장해 두면 매주 자동으로 만들어지는 폐회송 곡에 그대로 복사돼 붙습니다 (routes/conti.js 의 ensureClosingHymn). */
router.post('/admin/closing-hymn/sheet', requireAdmin, upload.array('파일', 12), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const t = team ? await sheetsDb.findOne('찬양팀', '팀명', team) : null;
  if (t) {
    try {
      if (b.header === '1') await headerizeClosingHymnFiles(req, team);
      const wf = await S().webSheetFile(b.url, b['제목']);
      if (wf) req.files = (req.files || []).concat([wf]);
      const typed = String(b['제목'] || '').trim();
      const files = (req.files || []).filter((f) => f && f.buffer && f.buffer.length);
      const jobs = [];
      for (const f of files) {
        try { jobs.push({ 제목: (files.length === 1 && typed) || S().titleFromFile(f.originalname) || typed || '악보', 링크: await driveStore.uploadPublic('악보', f) }); }
        catch (e) { console.error('[폐회송 악보 업로드 실패]', e.message); }
      }
      const link = String(b['링크'] || '').trim();
      if (!jobs.length && link) jobs.push({ 제목: typed || S().titleFromLink(link), 링크: link });
      if (jobs.length) await closingHymn.addSheets(team, jobs);
    } catch (e) { console.error('[폐회송 악보 저장 실패]', e.message); }
  }
  spa.redirect(req, res, '/admin');
});

router.post('/admin/closing-hymn/sheet/delete', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  if (team) { try { await closingHymn.removeSheet(team, b.idx); } catch (e) { console.error('[폐회송 악보 삭제 실패]', e.message); } }
  spa.redirect(req, res, '/admin');
});

router.post('/admin/tagline', requireAdmin, async (req, res) => {
  const value = String((req.body || {})['태그라인'] || '').trim();
  const existing = await sheetsDb.findWhere('설정', (r) => r['키'] === '태그라인');
  const row = { '키': '태그라인', '값': value, '설명': '허브 바닥글에 보이는 한 줄 문구' };
  if (existing) await sheetsDb.updateRow('설정', existing.__row, row);
  else await sheetsDb.appendRow('설정', row);
  spa.redirect(req, res, '/admin');
});

router.post('/admin/teams', requireAdmin, async (req, res) => {
  const name = String((req.body || {})['팀명'] || '').trim();
  if (name) {
    const dup = await sheetsDb.findOne('찬양팀', '팀명', name);
    if (!dup) await sheetsDb.appendRow('찬양팀', { 'ID': 'T' + Date.now().toString(36), '팀명': name, '생성일': new Date().toISOString(), '활성여부': 'TRUE' });
  }
  spa.redirect(req, res, '/admin');
});

router.post('/admin/teams/toggle', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const row = Number(b.__row);
  if (row) {
    const rows = await sheetsDb.readAll('찬양팀');
    const found = rows.find((r) => r.__row === row);
    if (found) await sheetsDb.updateRow('찬양팀', row, { ...found, '활성여부': b.to === 'TRUE' ? 'TRUE' : 'FALSE' });
  }
  spa.redirect(req, res, '/admin');
});

module.exports = router;
