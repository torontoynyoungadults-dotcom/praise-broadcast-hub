/**
 * v9.6 — 예배콘티 「유튜브로 이어 듣기」 아래 송폼 태그 (public/js/conti-tools.js + public/worship/ytform.js) — 브라우저 시험
 *   서버 · 구글 없이: 가짜 유튜브 플레이어 + /conti/ytform 을 메모리로 대신함
 *   NODE_PATH=$(npm root -g) node scripts/e2e-ytform-conti.js
 */
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const PUB = path.join(__dirname, '..', 'public');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const FAKE_YT = () => {
  window.__yt = [];
  function P(el, o) { this.t = 0; this.playing = false; this.at = Date.now(); this.vid = o.videoId; window.__yt.push(this); }
  P.prototype.getCurrentTime = function () { if (this.playing) { const n = Date.now(); this.t += (n - this.at) / 1000; this.at = n; } return this.t; };
  P.prototype.seekTo = function (t) { this.t = t; this.at = Date.now(); window.__lastSeek = t; };
  P.prototype.playVideo = function () { this.getCurrentTime(); this.playing = true; this.at = Date.now(); };
  P.prototype.pauseVideo = function () { this.getCurrentTime(); this.playing = false; };
  P.prototype.getDuration = function () { return 200; };
  P.prototype.loadVideoById = function (v) { this.vid = v; this.t = 0; };
  P.prototype.cueVideoById = function (v) { this.vid = v; this.t = 0; };
  window.YT = { Player: P };
};
(async () => {
  const store = {};                                  // 팀 · 영상 → { tags, by, at }
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(FAKE_YT);
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;margin:0;padding:16px">' +
      '<div class="cn-yplay" data-cn-yplay data-team="Kairos" data-ytv="1" data-items="' + JSON.stringify([{ id: 'dQw4w9WgXcQ', t: 'Way Maker', k: '콘티', n: 1 }, { id: 'abcdefghijk', t: 'Holy Forever', k: '콘티', n: 2 }]).replace(/"/g, '&quot;') + '">' +
      '<button type="button" data-cn-yplay-open>이어 듣기</button><div data-cn-yplayer hidden></div></div><script src="/js/conti-tools.js"></script></body>' });
    if (u.pathname === '/conti/ytform') {
      const key = u.searchParams.get('team') + '|' + (u.searchParams.get('vid') || (route.request().postDataJSON() || {}).vid);
      if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result: store[key] || { tags: [], by: '', at: 0 } }) });
      const b = route.request().postDataJSON(); store[key] = { tags: b.tags, by: '김리더', at: Date.now() };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result: store[key] }) });
    }
    const f = path.join(PUB, u.pathname);
    if (u.hostname === new URL(route.request().frame().url() || 'http://x/').hostname && fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ path: f, contentType: /\.css$/.test(f) ? 'text/css' : 'text/javascript' });
    if (/youtube\.com/.test(u.hostname)) return route.fulfill({ contentType: 'text/javascript', body: 'window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();' });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.goto('http://hub.test/');
  await page.click('[data-cn-yplay-open]');
  ok(await page.waitForFunction(() => { const f = document.querySelector('[data-cn-yform] .ytf'); return f && /아직 송폼 태그가 없어요/.test(f.textContent); }, null, { timeout: 8000 }).then(() => true, () => false), '이어 듣기 아래 「송폼 구간」');
  await page.click('[data-cn-yform] [data-a="edit"]');
  const at = (t) => page.evaluate((x) => { const p = window.__yt[0]; p.pauseVideo(); p.seekTo(x); }, t);
  await at(5); await page.click('[data-cn-yform] [data-add="V1"]');
  await at(33.3); await page.click('[data-cn-yform] [data-add="C"]');
  await page.click('[data-cn-yform] [data-a="save"]');
  ok(await page.waitForFunction(() => /저장했어요/.test(document.querySelector('[data-cn-yform]').textContent), null, { timeout: 5000 }).then(() => true, () => false), '저장 → /conti/ytform (팀 Kairos)');
  ok(JSON.stringify((store['Kairos|dQw4w9WgXcQ'] || {}).tags) === JSON.stringify([{ t: 5, k: 'V1' }, { t: 33.3, k: 'C' }]), '저장된 태그', store);
  await page.click('[data-cn-yform] .ytf-chip:nth-child(2)');
  ok(await page.evaluate(() => window.__lastSeek === 33.3), '칩 → 그 부분부터');
  await page.click('[data-cn-ynext]');
  ok(await page.waitForFunction(() => /아직 송폼 태그가 없어요/.test(document.querySelector('[data-cn-yform]').textContent), null, { timeout: 5000 }).then(() => true, () => false), '다음 곡 → 그 곡의 태그');
  await page.click('[data-cn-yprev]');
  ok(await page.waitForFunction(() => document.querySelectorAll('[data-cn-yform] .ytf-chip').length === 2, null, { timeout: 5000 }).then(() => true, () => false), '앞 곡으로 → 저장한 태그 다시');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '폰 화면에서 옆으로 넘치지 않음');
  ok(!errs.length, '화면 오류 없음', errs);
  await br.close();
  console.log(fail ? '✗ 실패 ' + fail : '✓ 모두 통과 (통과 ' + pass + ')'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
