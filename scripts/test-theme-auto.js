/**
 * 화면 모드 시간 자동 시험 (lib/themeBoot.js) — 가짜 시계로 낮 · 밤 · 직접 고른 것의 만료를 확인
 *   NODE_PATH=$(npm root -g) node scripts/test-theme-auto.js
 */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'lib', 'themeBoot.js'), 'utf8').match(/THEME_BOOT = `([\s\S]*?)`;/)[1];
const { chromium } = require('playwright');
let fail = 0;
const eq = (a, b, m) => { const ok = a === b; if (!ok) fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + m + (ok ? '' : ' (' + a + ' ≠ ' + b + ')')); };

(async () => {
  const br = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const ctx = await br.newContext({ timezoneId: 'America/Toronto' });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-10-04T10:00:00-04:00') });
  const html = '<!doctype html><html><head><meta name="theme-color" content="#000"><script>' + src + '</script></head><body></body></html>';
  const th = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.route('http://t.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const load = async () => { await page.goto('http://t.test/x'); };
  const at = async (iso) => { await page.clock.setSystemTime(new Date(iso)); await page.clock.runFor(61000); };

  await load();
  eq(await th(), 'light', '낮 10시 → 밝게');
  await at('2026-10-04T18:57:00-04:00'); eq(await th(), 'light', '저녁 6:58 → 밝게');
  await at('2026-10-04T19:01:00-04:00'); eq(await th(), 'dark', '저녁 7:01 → 열어 둔 채로도 어둡게로 바뀜');
  await at('2026-10-05T02:00:00-04:00'); eq(await th(), 'dark', '새벽 2시 → 어둡게');
  await at('2026-10-05T07:01:00-04:00'); eq(await th(), 'light', '아침 7:01 → 밝게');

  // 직접 고르기: 낮 10시에 어둡게 → 저녁 7시까지 유지, 다음 날 낮에는 자동(밝게)
  await page.clock.setSystemTime(new Date('2026-10-06T10:00:00-04:00')); await load();
  await page.evaluate(() => { PHThemeMode.setManual('dark'); });
  eq(await page.evaluate(() => PHThemeMode.auto()), false, '직접 고르면 자동이 아님');
  eq(await page.evaluate(() => +localStorage.getItem('ph.themeUntil')), new Date('2026-10-06T19:00:00-04:00').getTime(), '낮에 고른 것은 저녁 7시까지');
  await page.reload(); await load();
  await page.evaluate(() => { PHThemeMode.setManual('dark'); }); await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await at('2026-10-06T15:00:00-04:00'); eq(await th(), 'dark', '직접 고른 어둡게가 오후 3시에도 유지');
  await at('2026-10-07T10:00:00-04:00'); eq(await th(), 'light', '다음 날 낮 → 다시 자동(밝게) — 영원히 고정되지 않음');
  eq(await page.evaluate(() => PHThemeMode.auto()), true, '자동으로 돌아옴');

  // 밤에 밝게 고르기: 아침 7시까지
  await page.clock.setSystemTime(new Date('2026-10-07T22:00:00-04:00')); await page.evaluate(() => PHThemeMode.setAuto());
  await page.evaluate(() => { PHThemeMode.setManual('light'); document.documentElement.setAttribute('data-theme', 'light'); });
  eq(await page.evaluate(() => +localStorage.getItem('ph.themeUntil')), new Date('2026-10-08T07:00:00-04:00').getTime(), '밤에 고른 것은 다음 날 아침 7시까지');
  await at('2026-10-08T03:00:00-04:00'); eq(await th(), 'light', '새벽 3시에도 직접 고른 밝게 유지');

  // 옛 저장값(manual 만 있고 만료 없음) → 고정되지 않고 자동
  await page.clock.setSystemTime(new Date('2026-10-09T22:00:00-04:00'));
  await page.evaluate(() => { localStorage.setItem('ph.theme', 'light'); localStorage.setItem('ph.themeMode', 'manual'); localStorage.removeItem('ph.themeUntil'); });
  await load(); eq(await th(), 'dark', '만료 정보 없는 옛 직접 선택은 무시하고 시간 자동(밤 → 어둡게)');
  await br.close();
  console.log(fail ? '\n✗ 실패 ' + fail : '\n✓ 모두 통과'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
