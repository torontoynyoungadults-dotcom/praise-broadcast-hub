#!/usr/bin/env node
/**
 * 라이브 악보 — "처음 켰을 때(저장된 설정이 없을 때)" 기본값을 조용하게 바꿉니다.  (public/worship/practice.js)
 *   · 예배 타이머(⏱)        기본 꺼짐   — 위 막대 ⏱ 로 켜면 그 선택을 기억 (yn.pv.show.timer = 1)
 *   · 떠 있는 메트로놈 창(🥁) 기본 꺼짐   — 송폼 창 안의 작은 동그라미(축소형)만 보임. 위 막대 🥁 로 켜면 기억 (yn.pv.show.metro = 1)
 *   · 필기 도구 도크(도구)    기본 접힘   — "도구 열기" 로 펴면 기억 (yn.pv.tools = 1)
 *   · 컴퓨터 화면의 오른쪽 패널 기본 닫힘 — 위 막대 오른쪽 단추로 열면 기억 (yn.pv.side = 1)
 * 저장된 값(사용자가 직접 켜고 끈 것)은 그대로 이깁니다. 예전 버전은 컴퓨터에서 처음 열 때 yn.pv.side=1 을 "자동으로" 써 두었기 때문에,
 * 기기마다 딱 한 번(yn.pv.dv 표시) 그 값을 지워 새 기본값이 보이게 합니다.
 *
 * church-app 파일을 다시 복사한 경우(tools/patch-live-emoji.js [church-app 경로]) 그 도구 끝에서 이 도구가 자동으로 이어서 돌아갑니다.
 * 단독 실행:  node tools/patch-live-defaults.js   (이미 고쳐 있으면 건너뜀 · 찾을 글이 안 나오면 멈춤)
 */
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'worship');

/** [파일, 찾을 글, 바꿀 글, 횟수(기본 1)] */
const P = [
  ['practice.js',
    `  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g,`,
    `  /* 기본값 정리 v11 — 예전 버전이 컴퓨터에서 "자동으로" 써 둔 오른쪽 패널 열림(side=1)을 기기마다 한 번만 지움 (tools/patch-live-defaults.js) */
  (function () { try { var s = root.localStorage; if (s.getItem('yn.pv.dv') === null) { if (s.getItem('yn.pv.side') === '1') s.removeItem('yn.pv.side'); s.setItem('yn.pv.dv', '11'); } } catch (e) { /* 저장이 막힌 브라우저 */ } }());
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g,`],
  // 오른쪽 패널(컴퓨터): 저장된 '1' 일 때만 처음부터 열림 (예전: '0' 이 아니면 열림)
  ['practice.js', `S.layout === 'computer' && !S.compact ? ls('side') !== '0' : false`, `S.layout === 'computer' && !S.compact ? ls('side') === '1' : false`],
  ['practice.js', `if (S.layout === 'computer' && ls('side') !== '0') el.classList.add('pv-sideopen');`, `if (S.layout === 'computer' && ls('side') === '1') el.classList.add('pv-sideopen');`],
  ['practice.js', `if (S.layout === 'computer' && ls('side') !== '0' && P.tabs.length) showTab(P.tabs[0].id);`, `if (S.layout === 'computer' && ls('side') === '1' && P.tabs.length) showTab(P.tabs[0].id);`],
  // 필기 도구 도크: 저장된 '1' 일 때만 처음부터 펼침 (예전: '0' 일 때만 접힘)
  ['practice.js', `if (ls('tools') === '0') setTools(false, false);`, `if (ls('tools') !== '1') setTools(false, false);                      // 기본은 접힘 (v11) — "도구 열기" 로 펴면 '1' 로 기억`],
  // 떠 있는 창 보이기: 타이머 · 메트로놈 창은 저장된 값이 없으면 숨김 (송폼 창은 그대로 보임)
  ['practice.js', `function showOn(k) { return ls('show.' + k) !== '0'; }`, `var SHOW_DEF = { timer: false, form: true, metro: false };            // 저장된 값이 없을 때의 기본 (v11) — 타이머 · 메트로놈 창은 꺼짐, 메트로놈은 송폼 창 안의 동그라미(축소형)만
    function showOn(k) { var v = ls('show.' + k); return v === null ? SHOW_DEF[k] !== false : v !== '0'; }`],
];
let n = 0;
for (const [file, from, to, times] of P) {
  const p = path.join(OUT, file);
  const s = fs.readFileSync(p, 'utf8');
  const got = s.split(from).length - 1;
  if (s.indexOf(to) >= 0) continue;                                     // 이미 고쳐 있음 (바꿀 글이 찾을 글을 품고 있어도 두 번 고치지 않음)
  if (got !== (times || 1)) throw new Error(`${file}: "${from.slice(0, 50)}" 가 ${got}번 나옴 (원본이 바뀌었는지 확인)`);
  fs.writeFileSync(p, s.split(from).join(to)); n++;
}
console.log(`라이브 악보 기본값(타이머 · 도구 · 메트로놈 축소형) — ${n}곳 고침 (이미 고친 곳은 건너뜀)`);
