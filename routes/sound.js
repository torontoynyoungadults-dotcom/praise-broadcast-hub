/**
 * 마이크 · 인이어 설정 (/sound) — 싱어는 이름마다 마이크 라인 · 인이어 번호, 세션은 악기마다 마이크 번호, P16 채널 16개 이름.
 * 팀원 누구나 보고 고칠 수 있음 (객원 제외). 저장은 lib/soundSetup.js, 주일 편성 칸에 번호가 같이 보임.
 */
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const avatar = require('../lib/avatar');
const guestAccess = require('../lib/guestAccess');
const ui = require('../lib/uiIcons');
const sound = require('../lib/soundSetup');
const { positionIconSvg } = require('../lib/positionIcons');

const router = express.Router();
const esc = pageShell.esc;
const SINGER_ROLES = ['인도자', '남싱', '여싱', '목회자'];

async function requireTeam(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  if (!ctx.teams.length || guestAccess.isGuest(ctx.member)) return res.redirect('/');
  req.ctx = ctx;
  next();
}

router.get('/sound', requireTeam, async (req, res) => {
  const team = req.ctx.current;
  const [cfg, infoMap, assign] = await Promise.all([sound.get(team), avatar.teamInfoMap(team), sheetsDb.readAll('찬양편성')]);
  const names = Object.keys(infoMap);
  const roleOf = (n) => String((infoMap[n] || {}).역할 || '');
  const sung = new Set(assign.filter((r) => r['팀ID'] === team && sound.SINGER_POS.includes(String(r['포지션'] || '').trim())).map((r) => String(r['이름'] || '').trim()));
  const isSinger = (n) => SINGER_ROLES.some((r) => roleOf(n).split(',').map((x) => x.trim()).includes(r)) || sung.has(n) || !!cfg.singer[n];
  const singers = names.filter(isSinger).sort((a, b) => a.localeCompare(b, 'ko'));
  const others = names.filter((n) => !isSinger(n)).sort((a, b) => a.localeCompare(b, 'ko'));
  const num = (name, val, label) => `<input class="snd-in" type="text" inputmode="numeric" maxlength="12" name="${esc(name)}" value="${esc(val || '')}" placeholder="—" aria-label="${esc(label)}">`;
  const singerRow = (n) => { const v = cfg.singer[n] || {}; return `<div class="snd-row">
      <span class="snd-who">${avatar.avatarHtml(n, infoMap[n] || {}, 'sm', { noBadge: true })}<b>${esc(n)}</b><small>${esc(roleOf(n))}</small></span>
      <label class="snd-f"><i>마이크 라인</i>${num(`singer[${n}][mic]`, v.mic, n + ' 마이크 라인')}</label>
      <label class="snd-f"><i>인이어</i>${num(`singer[${n}][iem]`, v.iem, n + ' 인이어')}</label></div>`; };
  const sessRow = (k) => { const v = cfg.session[k] || {}; return `<div class="snd-row">
      <span class="snd-who"><span class="snd-ic">${positionIconSvg(k)}</span><b>${esc(k)}</b></span>
      <label class="snd-f"><i>마이크</i>${num(`session[${k}][mic]`, v.mic, k + ' 마이크 번호')}</label></div>`; };
  const p16 = cfg.p16.map((name, i) => `<label class="snd-p16"><span>${i + 1}</span><input type="text" maxlength="24" name="p16[${i}]" value="${esc(name)}" placeholder="채널 ${i + 1}" aria-label="P16 채널 ${i + 1}"></label>`).join('');
  const msg = String(req.query.ok || '') === '1' ? '<p class="ph-msg ok">저장했어요.</p>' : '';
  const content = `
  ${pageShell.hubNav('', team)}
  ${pageShell.hero({ eyebrow: `${team} · 음향`, title: '마이크 · 인이어', sub: '싱어 마이크 라인 · 인이어 번호, 세션 마이크 번호, P16 채널' })}
  <form method="post" action="/sound" class="snd">
    <input type="hidden" name="team" value="${esc(team)}">
    <div class="ph-card">
      <h2 class="ph-h2">싱어</h2>
      <p class="ph-sub">이름마다 마이크 라인 번호와 인이어 번호예요. 주일 편성에서 그 사람 이름 아래에 같이 보여요.</p>
      <div class="snd-list">${singers.map(singerRow).join('') || '<p class="ph-sub">싱어 역할인 팀원이 없어요.</p>'}</div>
      ${others.length ? `<details class="ph-add snd-more"><summary>+ 다른 팀원도 적기 (${others.length}명)</summary><div class="snd-list">${others.map(singerRow).join('')}</div></details>` : ''}
    </div>
    <div class="ph-card">
      <h2 class="ph-h2">세션</h2>
      <p class="ph-sub">악기마다 마이크(라인) 번호예요. 여러 개면 "1-6"처럼 적어요.</p>
      <div class="snd-list">${sound.SESSION_INST.map(sessRow).join('')}</div>
    </div>
    <div class="ph-card">
      <h2 class="ph-h2">P16 채널</h2>
      <p class="ph-sub">개인 모니터(P16) 16개 채널 이름이에요.</p>
      <div class="snd-p16s">${p16}</div>
    </div>
    <div class="snd-save">${msg}<button class="ph-btn pri" type="submit">저장</button></div>
  </form>`;
  spa.send(req, res, content, { title: `${team} 마이크 · 인이어` });
});

router.post('/sound', requireTeam, async (req, res) => {
  const b = req.body || {}, team = String(b.team || '').trim() || req.ctx.current;
  if (!req.ctx.teams.includes(team)) return spa.redirect(req, res, '/sound');
  const c = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n || 12);
  const data = { singer: {}, session: {}, p16: [] };
  Object.keys(b.singer || {}).forEach((n) => { const v = b.singer[n] || {}; data.singer[c(n, 30)] = { mic: c(v.mic), iem: c(v.iem) }; });
  sound.SESSION_INST.forEach((k) => { const v = (b.session || {})[k] || {}; data.session[k] = { mic: c(v.mic) }; });
  const p = b.p16 || {}; for (let i = 0; i < 16; i++) data.p16.push(c(Array.isArray(p) ? p[i] : p[String(i)], 24));
  try { await sound.save(team, data, String(req.ctx.member['이름'] || '')); }
  catch (e) { console.error('[마이크 · 인이어 저장 실패]', e && e.message); }
  spa.redirect(req, res, `/sound?team=${encodeURIComponent(team)}&ok=1`);
});

module.exports = router;
