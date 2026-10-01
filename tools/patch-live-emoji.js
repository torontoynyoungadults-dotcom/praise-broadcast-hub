#!/usr/bin/env node
/**
 * 라이브 악보 화면 파일(public/worship/*)의 남은 이모티콘을 직접 그린 아이콘(YI · icons-plus.js)으로 바꿉니다.
 * church-app v8.3 은 주요 단추의 이모지를 YNIcon 으로 바꿨지만, 몇 곳(내 오디오 · 키 바꿔 연습 · 화음 분석 · 페이지 리드 …)에 아직 남아 있습니다.
 * 사용:  node tools/patch-live-emoji.js [church-app 경로]
 *   · church-app 경로를 주면 먼저 원본 파일을 다시 복사한 뒤 고칩니다 (church-app 이 바뀌어도 다시 돌리면 됨)
 *   · 찾을 글은 정확히 한 번(또는 적힌 횟수) 나와야 하고, 아니면 멈춥니다
 */
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'worship');
const SRC = process.argv[2] ? path.join(process.argv[2], 'public', 'worship') : '';
const FILES = ['audio-shift.js', 'harmony-ui.js', 'practice-panels.js', 'practice.js', 'ytplayer.js', 'timer.js'];
if (SRC) FILES.concat(['hub.css', 'icons.js']).forEach((f) => fs.copyFileSync(path.join(SRC, f), path.join(OUT, f)));

/** [파일, 찾을 글, 바꿀 글, 횟수(기본 1)] */
const P = [
  ['audio-shift.js', `data-a="pick">📁 내 오디오 파일 고르기`, `data-a="pick">' + YI('folder') + ' 내 오디오 파일 고르기`],
  ['audio-shift.js', `data-a="startnote">🎹 목표 키 시작음`, `data-a="startnote">' + YI('piano_small') + ' 목표 키 시작음`],
  ['audio-shift.js', `esc('🎧 키 바꿔 연습'`, `YI('headphones') + ' ' + esc('키 바꿔 연습'`],
  ['audio-shift.js', `aria-label="닫기">✕</button>`, `aria-label="닫기">' + YI('close') + '</button>`],
  ['harmony-ui.js', `data-a="an-page">🔍 이 페이지 분석`, `data-a="an-page">' + YI('search') + ' 이 페이지 분석`],
  ['harmony-ui.js', `data-sub="del">🗑 지우기`, `data-sub="del">' + YI('trash') + ' 지우기`],
  ['harmony-ui.js', `data-a="png">🖼 바뀐`, `data-a="png">' + YI('image') + ' 바뀐`],
  ['harmony-ui.js', `data-a="del-sel">🗑 이 음표 지우기`, `data-a="del-sel">' + YI('trash') + ' 이 음표 지우기`],
  ['harmony-ui.js', `data-a="undo">↶ 되돌리기`, `data-a="undo">' + YI('undo') + ' 되돌리기`],
  ['practice-panels.js', `(p.lead ? '📄 ' : '') + (p.click ? '🎚 ' : '')`, `(p.lead ? YI('page') + ' ' : '') + (p.click ? YI('metronome') + ' ' : '')`],
  ['practice-panels.js', `title="닫기">✕</button>`, `title="닫기">' + YI('close') + '</button>`],
  ['practice.js', `toast('✋ 선택·이동 모드`, `toast('선택·이동 모드`],
  ['practice.js', `<b>📄 페이지 리드</b>`, `<b>' + YI('page') + ' 페이지 리드</b>`],
  ['practice.js', `folm.textContent = S.followM ? '🎚 메트로놈 따라감' : '🎚 메트로놈 따라가기 꺼짐';`, `folm.innerHTML = YI('metronome') + (S.followM ? ' 메트로놈 따라감' : ' 메트로놈 따라가기 꺼짐');`],
  ['practice.js', `toast(to === 'eraser' ? '🧽 지우개로 전환 — 같은 방법으로 다시 톡톡 치면 펜으로 돌아옵니다' : '✏️ 펜으로 돌아왔습니다'`, `toast(to === 'eraser' ? '지우개로 전환 — 같은 방법으로 다시 톡톡 치면 펜으로 돌아옵니다' : '펜으로 돌아왔습니다'`],
  ['practice.js', `aria-label="닫기">✕</button></div><div class="pv-ytbody">`, `aria-label="닫기">' + YI('close') + '</button></div><div class="pv-ytbody">`],
  ['ytplayer.js', `data-k="shifter">🎧 키 바꿔 연습`, `data-k="shifter">' + YI('headphones') + ' 키 바꿔 연습`],
  ['ytplayer.js', `data-k="startnote">🎹 목표 키 시작음`, `data-k="startnote">' + YI('piano_small') + ' 목표 키 시작음`],
  ['ytplayer.js', `'🔁 ' + fmtTime(st.a)`, `'반복 · ' + fmtTime(st.a)`],
  ['timer.js', `title="예배 시작 · 연습 종료 시각 설정">⚙</button>`, `title="예배 시작 · 연습 종료 시각 설정">' + YI('gear') + '</button>`],
];
let n = 0;
for (const [file, from, to, times] of P) {
  const p = path.join(OUT, file);
  let s = fs.readFileSync(p, 'utf8');
  const got = s.split(from).length - 1;
  if (got === 0 && s.indexOf(to) >= 0) continue;                       // 이미 고쳐 있음
  if (got !== (times || 1)) throw new Error(`${file}: "${from.slice(0, 40)}" 가 ${got}번 나옴 (원본이 바뀌었는지 확인)`);
  fs.writeFileSync(p, s.split(from).join(to)); n++;
}
console.log(`라이브 악보 이모티콘 고치기 — ${n}곳 고침 (이미 고친 곳은 건너뜀)`);
require('./patch-live-defaults.js');                                    // 이어서 — 처음 켰을 때 기본값(타이머 꺼짐 · 도구 접힘 · 메트로놈 축소형) 다시 적용
