/**
 * 카톡(다른 앱)에서 녹음을 바로 올리기
 *  · 안드로이드 — 홈 화면에 추가한 앱이 "공유" 대상 (site.webmanifest share_target → POST /share/rec) → 어느 주일 · 어떤 녹음인지 고르고 저장
 *  · 아이폰 — 단축어가 개인 주소(POST /share/rec?token=…)로 파일 + 종류를 보냄 → 바로 저장하고 결과를 글자로 돌려줌
 *  · /share/ios — 단축어 만드는 법 + 내 개인 주소
 */
'use strict';
const express = require('express');
const crypto = require('crypto');
const spa = require('../lib/spa');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const rec = require('../lib/recIngest');

const router = express.Router();
const esc = pageShell.esc;
const PENDING = new Map();                       // 공유로 받아 R2 에 올려 둔 파일 — 어디에 넣을지 고르기 전 (1시간)
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const KINDS = [['연습', '연습'], ['예배', '예배'], ['참고', '참고 음원']];

async function ctxOf(email, team) { return teamContext.resolve({ session: { email }, query: { team: team || '' } }); }

router.post('/share/rec', rec.big.single('file'), async (req, res) => {
  const token = String(req.query.token || (req.body && req.body.token) || '').trim();
  let email = req.session && req.session.email;
  if (token) email = await rec.emailOfToken(token).catch(() => '');
  if (!email) { if (req.file) require('fs').unlink(req.file.path, () => {}); return token ? res.status(401).type('text').send('주소가 맞지 않아요. 앱의 "아이폰 단축어" 화면에서 주소를 다시 복사해 주세요.') : res.redirect(303, '/'); }
  if (!req.file) return token ? res.status(400).type('text').send('파일이 오지 않았어요. 카톡에서 녹음 파일을 골라 공유해 주세요.') : res.redirect(303, '/share/rec');
  const ctx = await ctxOf(email, req.query.team).catch(() => null);
  if (!ctx || !ctx.current) { require('fs').unlink(req.file.path, () => {}); return res.status(403).type('text').send('소속된 찬양팀이 없어요.'); }
  const title = rec.cleanTitle((req.body && req.body.title) || req.file.originalname);
  let link;
  try { link = await rec.store(req.file); } catch (e) { return res.status(400).type('text').send(e.message || '올리지 못했어요.'); }
  if (token) {                                    // 아이폰 단축어 — 고른 종류로 바로 저장
    const kindIn = String((req.body && (req.body.kind || req.body['구분'])) || req.query.kind || '연습').trim();
    const kind = /예배/.test(kindIn) ? '예배' : /참고/.test(kindIn) ? '참고' : '연습';
    const date = rec.defaultDate(kind);
    await rec.addRec({ team: ctx.current, date, kind, title, link, who: ctx.member['이름'] });
    return res.type('text').send(`올렸어요 ✓\n${md(date)} 주일 · ${kind === '참고' ? '참고 음원' : kind + ' 녹음'}\n${title}`);
  }
  const pid = crypto.randomBytes(9).toString('base64url');
  PENDING.set(pid, { link, title, email, at: Date.now() });
  for (const [k, v] of PENDING) if (Date.now() - v.at > 3600 * 1000) PENDING.delete(k);
  if (req.query.json) return res.json({ p: pid });
  res.redirect(303, '/share/rec?p=' + pid);
});

router.get('/share/rec', async (req, res) => {
  if (!req.session || !req.session.email) return res.redirect('/');
  if (req.query.sw) {                              // 서비스워커가 보관한 공유 파일 → 이 화면이 (로그인된 채로) 올림
    return spa.send(req, res, `${pageShell.hero({ barOnly: true })}<section class="sh13"><p class="sh13-k">카톡에서 받은 녹음</p><h1 id="sh13n">올리는 중…</h1>
      <div class="r13-prog"><i id="sh13b"></i><span id="sh13s">0%</span></div>
      <script>(function(){caches.open('share-tmp').then(function(c){return c.match('/share/rec/file').then(function(r){if(!r)throw new Error('파일을 찾지 못했어요. 카톡에서 다시 공유해 주세요.');var n=decodeURIComponent(r.headers.get('X-Name')||'녹음');document.getElementById('sh13n').textContent=n;return r.blob().then(function(b){var fd=new FormData();fd.append('file',new File([b],n,{type:b.type}));var x=new XMLHttpRequest();x.open('POST','/share/rec?json=1');x.upload.onprogress=function(e){if(e.lengthComputable){var p=Math.round(e.loaded/e.total*100);document.getElementById('sh13b').style.width=p+'%';document.getElementById('sh13s').textContent=p<100?p+'% · '+Math.round(e.loaded/1048576)+' / '+Math.round(e.total/1048576)+'MB':'저장하는 중…';}};x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(j.p){c.delete('/share/rec/file');location.replace('/share/rec?p='+j.p);}else document.getElementById('sh13s').textContent=x.responseText.slice(0,160)||'올리지 못했어요';};x.onerror=function(){document.getElementById('sh13s').textContent='인터넷이 끊겨 올리지 못했어요.'};x.send(fd);});});}).catch(function(e){document.getElementById('sh13s').textContent=e.message;});})();</script></section>`, { title: '녹음 올리기' });
  }
  const p = PENDING.get(String(req.query.p || ''));
  if (!p || p.email !== req.session.email) {
    return spa.send(req, res, `${pageShell.hero({ barOnly: true })}<section class="sh13"><h1>카톡에서 녹음 올리기</h1>
      <p class="ph-sub">카톡 채팅방의 녹음 파일 → <b>공유</b> → <b>YN찬양팀Hub</b> 를 고르면 여기로 와요. (안드로이드 · 홈 화면에 추가한 앱)</p>
      <p class="ph-sub">아이폰은 <a href="/share/ios">단축어 만들기</a> 를 한 번 해 두면 카톡에서 바로 올라가요.</p></section>`, { title: '녹음 올리기' });
  }
  const ctx = await ctxOf(req.session.email, req.query.team);
  const opts = rec.sundayChoices(), def = rec.defaultDate('연습'), defW = rec.defaultDate('예배');
  const teamSel = ctx.teams.length > 1 ? `<label class="sh13-f"><span>찬양팀</span><select name="team">${ctx.teams.map((t) => `<option${t === ctx.current ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : `<input type="hidden" name="team" value="${esc(ctx.current)}">`;
  const html = `${pageShell.hero({ barOnly: true })}<section class="sh13">
    <p class="sh13-k">카톡에서 받은 녹음</p><h1>${esc(p.title)}</h1>
    <form method="post" action="/share/rec/save" class="a13-form sh13-form">
      <input type="hidden" name="p" value="${esc(req.query.p)}">
      <fieldset class="a13-kind"><legend>어떤 녹음인가요</legend><div>
        ${KINDS.map(([v, t], i) => `<label><input type="radio" name="kind" value="${v}"${i === 0 ? ' checked' : ''} onchange="var s=this.form.date;s.value=this.value==='예배'?'${defW}':'${def}'">${t}</label>`).join('')}
      </div></fieldset>
      ${teamSel}
      <label class="sh13-f"><span>어느 주일 콘티에</span><select name="date">${opts.map((d) => `<option value="${d}"${d === def ? ' selected' : ''}>${md(d)} 주일${d === def ? ' · 이번 주' : ''}</option>`).join('')}</select></label>
      <div class="a13-title"><label>제목</label><input type="text" name="title" value="${esc(p.title)}" maxlength="80"></div>
      <div class="a13-bar r13-bar"><button type="submit" class="a13-go"><span>콘티에 올리기</span></button></div>
    </form></section>`;
  spa.send(req, res, html, { title: '녹음 올리기' });
});

router.post('/share/rec/save', express.urlencoded({ extended: false }), async (req, res) => {
  if (!req.session || !req.session.email) return res.redirect('/');
  const b = req.body || {}, p = PENDING.get(String(b.p || ''));
  if (!p || p.email !== req.session.email) return res.status(410).type('text').send('시간이 지나 사라졌어요. 카톡에서 다시 공유해 주세요.');
  const ctx = await ctxOf(req.session.email, b.team);
  const team = ctx.teams.includes(String(b.team || '')) ? String(b.team) : ctx.current;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : rec.defaultDate(b.kind);
  const kind = await rec.addRec({ team, date, kind: b.kind, title: rec.cleanTitle(b.title || p.title), link: p.link, who: ctx.member['이름'] });
  PENDING.delete(String(b.p));
  spa.redirect(req, res, `/conti/listen?${new URLSearchParams({ team, date, kind })}`);
});

/* ---- 아이폰 단축어 만들기 ---- */
router.get('/share/ios', async (req, res) => {
  if (!req.session || !req.session.email) return res.redirect('/');
  const tok = await rec.tokenFor(req.session.email);
  const host = `${req.protocol === 'http' && !/localhost/.test(req.get('host')) ? 'https' : req.protocol}://${req.get('host')}`;
  const url = `${host}/share/rec?token=${tok}`;
  const step = (n, t, d) => `<li><b>${n}</b><div><h3>${t}</h3>${d}</div></li>`;
  const html = `${pageShell.hero({ barOnly: true })}<section class="sh13">
    <p class="sh13-k">아이폰 (iOS 27) · 한 번만 하면 돼요</p><h1>카톡에서 바로 녹음 올리기</h1>
    <p class="ph-sub">아이폰 "단축어" 앱으로 공유 메뉴에 <b>찬양팀에 녹음 올리기</b> 를 만들어요. 만든 뒤에는 카톡 녹음 파일 → 공유 → 찬양팀에 녹음 올리기 → 연습 / 예배 고르기 로 끝나요.</p>
    <div class="sh13-url"><span>내 개인 주소</span><code id="sh13u">${esc(url)}</code>
      <button type="button" class="a13-go" onclick="var t=document.getElementById('sh13u').textContent;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){this.querySelector('span').textContent='복사했어요'}.bind(this)).catch(function(){prompt('길게 눌러 복사하세요',t)})"><span>주소 복사</span></button>
      <small>나만 쓰는 주소예요 — 다른 사람에게 보내지 마세요.</small></div>
    <div class="sh13-ai"><span>iOS 27 — 설명으로 바로 만들기</span>
      <p>단축어 앱 → <b>＋</b> → <b>단축어 설명하기</b> 에 아래 문장을 붙여넣으면 단축어가 만들어져요. 만든 뒤 ⓘ 에서 <b>공유 시트에서 보기</b> 가 켜져 있는지만 확인하세요.</p>
      <code id="sh13d">이름은 "찬양팀에 녹음 올리기". 공유 시트에서 파일과 미디어를 받아. "어떤 녹음?" 메뉴로 연습, 예배, 참고 음원 중 하나를 고르게 해. 그 다음 ${esc(url)} 로 POST 요청을 보내는데, 요청 본문은 양식으로 하고 file 필드에 받은 파일, kind 필드에 고른 항목을 넣어. 마지막에 받은 결과를 보여줘.</code>
      <button type="button" class="a13-go" onclick="var t=document.getElementById('sh13d').textContent;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){this.querySelector('span').textContent='복사했어요'}.bind(this)).catch(function(){prompt('길게 눌러 복사하세요',t)})"><span>설명 문장 복사</span></button>
    </div>
    <p class="sh13-k" style="margin-top:18px">직접 만들기 (iOS 27 · 설명이 잘 안 될 때)</p>
    <ol class="sh13-steps">
      ${step(1, '단축어 앱 → 오른쪽 위 ＋', '<p>새 단축어를 만들고 이름을 <b>찬양팀에 녹음 올리기</b> 로 바꿔요.</p>')}
      ${step(2, '공유 메뉴에 보이게', '<p>ⓘ (단축어 정보) → <b>공유 시트에서 보기</b> 켜기 → 받는 것: <b>파일</b> · <b>미디어</b> 만 남기기. (맨 위에 "공유 시트에서 … 입력 받기" 동작이 생겨요)</p>')}
      ${step(3, '"메뉴에서 선택" 추가', '<p>동작 검색에서 <b>메뉴에서 선택</b> → 묻는 말: <b>어떤 녹음?</b> · 항목: <b>연습</b>, <b>예배</b>, <b>참고 음원</b>.</p>')}
      ${step(4, '"URL 내용 가져오기" 추가', '<p>메뉴 <b>아래(끝 다음)</b>에 <b>URL 내용 가져오기</b> → URL 칸에 위 <b>내 개인 주소</b> 붙여넣기.</p><p>▸ 펼쳐서 방법: <b>POST</b> · 요청 본문: <b>양식</b></p><p>필드 추가 → <b>파일</b> · 키 <code>file</code> · 값: <b>단축어 입력</b></p><p>필드 추가 → <b>텍스트</b> · 키 <code>kind</code> · 값: <b>선택한 항목</b> (메뉴 결과)</p>')}
      ${step(5, '"결과 보기" 추가', '<p><b>결과 보기</b> → 값: <b>URL의 내용</b>. 올라가면 "올렸어요 ✓ 11/8 주일 · 연습 녹음" 이 떠요.</p>')}
    </ol>
    <p class="ph-sub">연습 · 참고 음원은 <b>다가오는 주일</b>, 예배 녹음은 <b>지난 주일</b> 콘티에 들어가요. 다른 주일이면 콘티 화면의 녹음 목록에서 고칠 수 있어요.</p>
    <form method="post" action="/share/ios/reset" onsubmit="return confirm('새 주소를 만들면 예전 단축어는 안 돼요. 만들까요?')"><button type="submit" class="sh13-reset">주소 새로 만들기</button></form>
  </section>`;
  spa.send(req, res, html, { title: '아이폰 단축어' });
});
router.post('/share/ios/reset', async (req, res) => {
  if (!req.session || !req.session.email) return res.redirect('/');
  await rec.tokenFor(req.session.email, true);
  spa.redirect(req, res, '/share/ios');
});

module.exports = router;
