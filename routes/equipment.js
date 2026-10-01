/**
 * 장비 · 수리 — church-app은 이 화면(views/Equipment.html)을 허브 안에 iframe으로 끼워 넣어 썼는데
 * ("페이지 안에 페이지" 문제), 그 문제를 없애고 하나의 페이지로 다시 만들었습니다.
 * - 오늘 점검: 점검 항목마다 OK · 이상 · 해당없음을 바로 누르고, 이상이면 메모를 남깁니다.
 * - 수리 요청: 사진과 함께 요청을 올리고, 상태를 접수 → 승인 → 처리중 → 완료로 바꿔 갑니다.
 * (church-app의 "커미티만 승인" 권한 구분은 빼고, 이 허브의 다른 기능처럼 팀원 누구나 상태를 바꿀 수 있게 했습니다.)
 */
const express = require('express');
const upload = require('../lib/upload');
const sheetsDb = require('../lib/sheetsDb');
const driveStore = require('../lib/driveStore');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const week = require('../lib/weekUtil');
const spa = require('../lib/spa');

const router = express.Router();
const esc = pageShell.esc;

const RESULTS = ['OK', '이상', '해당없음'];
const NEXT_ACTIONS = {
  접수: [['승인', '승인'], ['반려', '반려'], ['취소', '취소']],
  승인: [['처리중', '처리 시작'], ['완료', '완료 처리'], ['반려', '반려'], ['취소', '취소']],
  처리중: [['완료', '완료 처리'], ['취소', '취소']],
  완료: [['접수', '다시 접수']],
  반려: [['접수', '다시 접수']],
  취소: [['접수', '다시 접수']],
};

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length) {
    return spa.send(req, res,
      `${pageShell.hubNav('equipment', '')}<div class="ph-card"><p class="ph-sub">아직 소속된 찬양팀이 없어요. 관리자에게 문의해주세요.</p><a class="ph-btn" href="/">← 허브로</a></div>`,
      { title: '장비 · 수리' },
    );
  }
  req.ctx = ctx;
  next();
}

function backTo(req, res, team) { spa.redirect(req, res, `/equipment?team=${encodeURIComponent(team || '')}`); }

function itemRow(it, record) {
  const rec = record || {};
  return `<div class="ph-eqitem">
    <div class="ph-eqitemhead">
      <div class="ph-eqitemname">${esc(it['이름'])}</div>
      ${it['설명'] ? `<div class="ph-li-sub">${esc(it['설명'])}</div>` : ''}
    </div>
    <div class="ph-eqresults">
      ${RESULTS.map((r) => `<form method="post" action="/equipment/check" style="display:inline;">
        <input type="hidden" name="team" value="${esc(it['팀ID'])}"><input type="hidden" name="itemId" value="${esc(it['ID'])}">
        <input type="hidden" name="결과" value="${r}">
        <button type="submit" class="ph-eqresbtn ${r === rec['상태'] ? 'on ' + (r === 'OK' ? 'ok' : r === '이상' ? 'bad' : '') : ''}">${r}</button>
      </form>`).join('')}
    </div>
    ${rec['상태'] ? `<div class="ph-li-sub">${esc(rec['확인자'] || '')} 확인${rec['메모'] ? ` · ${esc(rec['메모'])}` : ''}</div>` : ''}
    <details class="ph-add" style="margin-top:2px;">
      <summary>메모 ${rec['메모'] ? '수정' : '남기기'}</summary>
      <form method="post" action="/equipment/check" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(it['팀ID'])}"><input type="hidden" name="itemId" value="${esc(it['ID'])}">
        <input type="hidden" name="결과" value="${esc(rec['상태'] || 'OK')}">
        <input type="text" name="메모" value="${esc(rec['메모'] || '')}" placeholder="메모 (선택)">
        <button class="ph-btn" type="submit">저장</button>
      </form>
    </details>
    <form method="post" action="/equipment/items/archive" onsubmit="return confirm('이 항목을 보관할까요? 기록은 남습니다.')" style="margin-top:4px;">
      <input type="hidden" name="team" value="${esc(it['팀ID'])}"><input type="hidden" name="__row" value="${it.__row}"><input type="hidden" name="보관" value="TRUE">
      <button class="ph-row-del" type="submit" title="보관">🗄</button>
    </form>
  </div>`;
}

function ticketCard(t) {
  const photos = String(t['사진'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const badge = { 접수: '', 승인: 'ok', 처리중: 'ok', 완료: 'ok', 반려: 'bad', 취소: 'bad' }[t['상태']] || '';
  const next = NEXT_ACTIONS[t['상태']] || [];
  return `<div class="ph-list-item ph-ticket">
    <div class="ph-li-main">
      <div class="ph-li-title">${esc(t['제목'])} ${t['우선순위'] === '긴급' ? '<span class="ph-eqpri">긴급</span>' : ''}
        <span class="ph-eqbadge ${badge}">${esc(t['상태'] || '접수')}</span></div>
      ${t['항목'] ? `<div class="ph-li-sub">장비: ${esc(t['항목'])}</div>` : ''}
      ${t['내용'] ? `<div class="ph-li-note">${esc(t['내용'])}</div>` : ''}
      ${photos.length ? `<div class="ph-eqphotos">${photos.map((p) => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" alt=""></a>`).join('')}</div>` : ''}
      <div class="ph-li-sub">${esc(t['요청자'] || '')} 요청${t['처리자'] ? ` · ${esc(t['처리자'])} 처리` : ''}${t['메모'] ? ` · ${esc(t['메모'])}` : ''}</div>
      ${next.length ? `<div class="ph-ticketacts">${next.map(([to, label]) => `<form method="post" action="/equipment/tickets/act" style="display:inline;">
        <input type="hidden" name="team" value="${esc(t['팀ID'])}"><input type="hidden" name="__row" value="${t.__row}"><input type="hidden" name="상태" value="${to}">
        <button type="submit" class="ph-btn">${label}</button>
      </form>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

router.get('/equipment', requireTeam, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current;
  const date = week.todayStr();
  const [itemRows, recRows, ticketRows] = await Promise.all([
    sheetsDb.readAll('장비점검항목'),
    sheetsDb.readAll('장비점검기록'),
    sheetsDb.readAll('장비수리요청'),
  ]);
  const items = itemRows.filter((r) => r['팀ID'] === team && String(r['보관여부']).toUpperCase() !== 'TRUE')
    .sort((a, b) => (a['분류'] || '').localeCompare(b['분류'], 'ko') || Number(a['순서'] || 0) - Number(b['순서'] || 0));
  const recByItem = {};
  recRows.filter((r) => r['팀ID'] === team && r['날짜'] === date).forEach((r) => { recByItem[r['항목ID']] = r; });

  const byCat = {};
  items.forEach((it) => { (byCat[it['분류'] || '기타'] = byCat[it['분류'] || '기타'] || []).push(it); });

  const tickets = ticketRows.filter((r) => r['팀ID'] === team).sort((a, b) => String(b['요청시각']).localeCompare(String(a['요청시각'])));
  const checkedCount = items.filter((it) => recByItem[it['ID']] && recByItem[it['ID']]['상태']).length;
  const issueCount = items.filter((it) => recByItem[it['ID']] && recByItem[it['ID']]['상태'] === '이상').length;

  const hero = pageShell.hero({ eyebrow: `${team} · 장비 · 수리`, title: '장비 · 수리', sub: week.labelKo(date) });

  const content = `
  ${pageShell.hubNav('equipment', team)}
  ${hero}
  <div class="ph-card">
    ${teamContext.teamSwitcher(ctx)}
    <p class="ph-sub">오늘 점검 ${checkedCount}/${items.length}${issueCount ? ` · 이상 ${issueCount}건` : ''}</p>
  </div>

  <div class="ph-card top-accent">
    <h2 class="ph-h2">오늘 점검</h2>
    ${Object.keys(byCat).length ? Object.keys(byCat).sort((a, b) => a.localeCompare(b, 'ko')).map((cat) => `
      <h3 class="ph-h3">${esc(cat)}</h3>
      <div class="ph-list">${byCat[cat].map((it) => itemRow(it, recByItem[it['ID']])).join('')}</div>
    `).join('') : '<p class="ph-sub">아직 점검 항목이 없어요.</p>'}
    <details class="ph-add">
      <summary>+ 점검 항목 추가</summary>
      <form method="post" action="/equipment/items" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">
        <input type="text" name="분류" placeholder="분류 (예: 음향 · 영상 · 조명)">
        <input type="text" name="이름" placeholder="항목 이름 (예: 메인 스피커)" required>
        <input type="text" name="설명" placeholder="설명 (선택)">
        <button class="ph-btn pri" type="submit">추가</button>
      </form>
    </details>
  </div>

  <div class="ph-card">
    <h2 class="ph-h2">수리 요청</h2>
    <div class="ph-list">${tickets.length ? tickets.map(ticketCard).join('') : '<p class="ph-sub">아직 올라온 요청이 없어요.</p>'}</div>
    <details class="ph-add">
      <summary>+ 수리 요청 올리기</summary>
      <form method="post" action="/equipment/tickets" enctype="multipart/form-data" class="ph-inlineform">
        <input type="hidden" name="team" value="${esc(team)}">
        <input type="text" name="제목" placeholder="무엇이 문제인가요?" required>
        <textarea name="내용" rows="3" placeholder="자세히 적어주세요" style="width:100%;padding:10px 13px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg-2);color:var(--ink);font-size:15px;font-family:inherit;"></textarea>
        <div class="ph-inline3">
          <select name="항목"><option value="">장비 선택 (선택)</option>${items.map((it) => `<option value="${esc(it['이름'])}">${esc(it['이름'])}</option>`).join('')}</select>
          <select name="우선순위"><option value="보통">보통</option><option value="긴급">긴급</option></select>
          <input type="file" name="사진" accept="image/*" multiple>
        </div>
        <button class="ph-btn pri" type="submit">요청하기</button>
      </form>
    </details>
  </div>
  `;
  spa.send(req, res, content, { title: `${team} 장비 · 수리` });
});

router.post('/equipment/items', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const name = String(b['이름'] || '').trim();
  if (name) {
    const all = (await sheetsDb.readAll('장비점검항목')).filter((r) => r['팀ID'] === team);
    await sheetsDb.appendRow('장비점검항목', {
      'ID': 'EI' + Date.now().toString(36), '팀ID': team, '이름': name, '보관여부': 'FALSE',
      '분류': b['분류'] || '기타', '설명': b['설명'] || '', '순서': all.length + 1,
      '만든이': req.ctx.member['이름'], '만든시각': new Date().toISOString(), '수정자': '', '수정시각': '',
    });
  }
  backTo(req, res, team);
});

router.post('/equipment/items/archive', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const row = Number(b.__row);
  if (row) {
    const rows = await sheetsDb.readAll('장비점검항목');
    const found = rows.find((r) => r.__row === row);
    if (found) await sheetsDb.updateRow('장비점검항목', row, { ...found, '보관여부': 'TRUE', '수정자': req.ctx.member['이름'], '수정시각': new Date().toISOString() });
  }
  backTo(req, res, team);
});

router.post('/equipment/check', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const itemId = String(b.itemId || '').trim();
  const result = RESULTS.includes(b['결과']) ? b['결과'] : '';
  const memo = String(b['메모'] || '').trim();
  const date = week.todayStr();
  if (itemId) {
    const existing = await sheetsDb.findWhere('장비점검기록', (r) => r['팀ID'] === team && r['날짜'] === date && r['항목ID'] === itemId);
    const row = {
      'ID': existing ? existing['ID'] : 'ER' + Date.now().toString(36), '팀ID': team, '항목ID': itemId, '날짜': date,
      '상태': result, '메모': memo, '확인자': req.ctx.member['이름'], '확인시각': new Date().toISOString(),
    };
    if (existing) await sheetsDb.updateRow('장비점검기록', existing.__row, row);
    else await sheetsDb.appendRow('장비점검기록', row);
  }
  backTo(req, res, team);
});

router.post('/equipment/tickets', requireTeam, upload.array('사진', 4), async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const title = String(b['제목'] || '').trim();
  if (!title) return backTo(req, res, team);
  let photos = [];
  try {
    if (req.files && req.files.length) photos = await Promise.all(req.files.map((f) => driveStore.uploadPublic('장비사진', f)));
  } catch (e) { console.error('[장비사진 업로드 실패]', e.message); }
  await sheetsDb.appendRow('장비수리요청', {
    'ID': 'ET' + Date.now().toString(36), '팀ID': team, '제목': title, '내용': b['내용'] || '',
    '사진': photos.join(','), '상태': '접수', '요청자': req.ctx.member['이름'], '요청시각': new Date().toISOString(),
    '우선순위': b['우선순위'] === '긴급' ? '긴급' : '보통', '항목': b['항목'] || '', '처리자': '', '변경시각': '', '메모': '',
  });
  backTo(req, res, team);
});

router.post('/equipment/tickets/act', requireTeam, async (req, res) => {
  const b = req.body || {};
  const team = String(b.team || '').trim();
  const row = Number(b.__row);
  const to = String(b['상태'] || '').trim();
  if (row && to) {
    const rows = await sheetsDb.readAll('장비수리요청');
    const found = rows.find((r) => r.__row === row);
    const allowed = (NEXT_ACTIONS[found && found['상태']] || []).some(([s]) => s === to);
    if (found && allowed) {
      await sheetsDb.updateRow('장비수리요청', row, {
        ...found, '상태': to, '처리자': req.ctx.member['이름'], '변경시각': new Date().toISOString(),
      });
    }
  }
  backTo(req, res, team);
});

module.exports = router;
