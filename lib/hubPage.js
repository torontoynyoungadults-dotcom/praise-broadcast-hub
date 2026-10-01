/**
 * 스케줄표 · 라이브러리 화면 틀 — 이 앱의 맨 위 배너 · 메뉴 아래에 church-app 화면(.yn)을 그대로 띄웁니다.
 * 화면 코드는 public/hub/* (tools/port-church-hub.js 로 church-app 에서 가져옴 + hubshim.js),
 * 서버 함수는 lib/hubApi.js (POST /api/<함수>, church-app callServer 약속).
 */
const pageShell = require('./pageShell');
const teamContext = require('./teamContext');
const liveAuth = require('./liveAuth');
const hubApi = require('./hubApi');
const spa = require('./spa');

const FILES = ['hub/contrast.js', 'hub/icons.js', 'worship/icons-plus.js', 'hub/docview.js', 'hub/stats.js', 'hub/library.js', 'hub/hubport.js', 'hub/hubshim.js'];
const V = {};
function v(f) { return V[f] || (V[f] = pageShell.assetVersion(f)); }

/**
 * @param {{ nav:string, tab:string, title:string, hero:object, view?:string }} o
 */
async function send(req, res, o) {
  const ctx = req.ctx;
  const team = ctx.current;
  const user = { name: String(ctx.member['이름'] || ''), team, canEdit: true, admin: !!ctx.isAdmin };
  const boot = {
    token: liveAuth.mint(ctx.member, team, ctx.isAdmin), team, tab: o.tab, view: o.view || '',
    D: await hubApi.boot(user),
  };
  const content = `
  ${pageShell.hubNav(o.nav, team)}
  ${pageShell.hero(o.hero)}
  ${teamContext.teamSwitcher(ctx, { keep: {} }) ? `<div class="ph-card ph-teamcard">${teamContext.teamSwitcher(ctx, { keep: {} })}</div>` : ''}
  <div class="yn yn-main"><div class="shell"><div id="body"><div class="panel"><i class="skel line" style="width:55%;"></i><i class="skel line" style="width:85%;"></i><i class="skel line" style="width:70%;"></i></div></div></div></div>
  <noscript><div class="ph-card"><p class="ph-sub">이 화면은 자바스크립트가 필요합니다.</p></div></noscript>`;
  const head = `<link rel="stylesheet" href="/hub/yn.css?v=${v('hub/yn.css')}">\n<link rel="stylesheet" href="/hub/yn-adapt.css?v=${v('hub/yn-adapt.css')}">`;
  const scripts = `<script>window.__HUB__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>\n` +
    FILES.map((f) => `<script src="/${f}?v=${v(f)}"></script>`).join('\n');
  // 탭 전환(조각) 요청이 와도 늘 페이지째 보냅니다 — 스크립트가 돌아야 하므로 (public/js/spa.js 는 JSON 이 아니면 페이지째 다시 엶)
  const who = await spa.whoOf(req);
  res.set('Cache-Control', 'no-store');
  res.type('html').send(await pageShell.render(`<div id="ph-tabbody">${pageShell.decorate(content, who)}</div>`, { title: o.title, head, scripts, who }));
}

module.exports = { send };
