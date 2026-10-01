# V11 — 방송팀 보기 링크 · 스케줄 엑셀 올리기 · 라이브 기본값 · 청록 테마 · 홈 화면 로고 · 속도

## 1. 방송팀(PPT) 보기 전용 링크  `/b/<열쇠>`
- 기존 "로그인 없이 보는 공개 링크"(`/public/conti`)는 없앰(404).
- 새 링크: 로그인 없이 **예배 콘티 · 스케줄표** 두 메뉴만. 수정 폼 없음, **댓글만** 가능(이름 + 내용, 저장될 때 이름 뒤에 "(방송팀)").
- 열쇠: `설정` 시트 `방송팀링크:<팀명>` 한 줄(24자 랜덤). 콘티 화면 "방송팀 보기 링크" 칸에서 관리자가 만들기/새로 바꾸기, 팀원은 복사. 새로 바꾸면 예전 링크는 즉시 막힘.
- 파일: lib/guestLink.js · routes/guest.js · routes/conti.js(guestPanel, POST /conti/guest-link, `shared` 내보내기) · public/js/conti-tools.js(복사) · sw.js(PAGE_OK에 /b/…).
- 안전장치: 로봇 방지 숨은 칸, IP당 10분 8개 · 링크당 1시간 80개 제한, 길이 제한, noindex · no-store, 다른 팀 자료 안 섞임, 비활성 팀 링크 막힘.

## 2. 스케줄 엑셀 올리기 (관리자)  `/schedule/import`
- 스케줄표 위 "엑셀로 스케줄 올리기" → 파일 고르기 → 미리보기(새로 넣음/이미 있음/겹침, 이름 점검표, 불참 목록) → 반영.
- 엑셀: 시트 헤더 `날짜·포지션·이름`. 포지션이 `비고(불참/기타)` 인 줄의 메모에서 "이름+X"를 불참으로 읽음("연습X"=금요일 연습만, 그 외 둘 다, 괄호는 사유, 사유 없으면 "불참").
- 두 글자 이름은 팀원명단+회원에서 맞춤(조희→조희영, 김희→김희영). 같은 두 글자가 여럿이면 그 날 편성에 없는 사람 → 편성에 자주 나온 사람 순으로 "추정" 표시, 점검표에서 고칠 수 있음. 명단에 없는 이름은 직접 적거나 비우면 건너뜀.
- 날짜: YYYY-MM-DD / 엑셀 날짜 / 번호(46026) 모두. 주일 아닌 날짜는 건너뜀. "이 날짜부터"(기본 올해 1/1).
- 모드: 빈 곳만 채우기(기본, 겹치는 단일 포지션은 건너뜀) / 엑셀대로 덮어쓰기. 다시 올려도 중복 없음.
- 직접 입력칸: `2026-02-08 지혜` (금요일 날짜+연습 → 그 주일 연습 불참).
- 파일: lib/xlsxLite.js(의존성 없는 xlsx 읽기) · lib/scheduleImport.js · routes/scheduleImport.js · lib/sheetsDb.js(appendRows, deleteRows — 요청 한 번에 묶음).

## 3. 라이브 악보 기본값 (저장된 선택이 있으면 그것이 우선)
- 예배 시간(타이머) 표시 꺼짐 · 도구 접힘 · 메트로놈은 축소형(송폼 안 동그라미/폰 빠른 버튼)만. PC 오른쪽 패널도 접힘(기기마다 1회 초기화).
- tools/patch-live-defaults.js (patch-live-emoji.js에서 호출 → 재생성해도 유지), LIVE_V=ca83-4.

## 4. 테마 — 청록 + 연한 오렌지/노랑 글래스 (핑크 제거)
- 라이트: 민트(#D3EDE3) → 크림(#F6EFD2) → 살구(#F9E1C5), 글씨 숲색 #153B31, 포인트 #F29468. 다크: 깊은 청록 #0D1A19, 포인트 #F4A272.
- app.css 토큰 · yn-adapt.css · worship/hub.css · live-base.css · 히어로 스카이라인. tools/theme-remap.js (hub.css/live-base.css에는 다시 돌리지 말 것). 블러 22px→14~20px.
- 기본 테마는 그대로 다크(theme.js). 라이트가 첨부 배너와 더 닮음 — 필요하면 기본값 변경.

## 5. 홈 화면 로고 · 이름
- 직접 디자인(민트→크림→오렌지 그라데이션, 코랄 해 + 숲색 십자가 + 소리 파장). public/icons/ (192/512/maskable/apple-touch/favicon, svg 원본).
- manifest name/short_name = "YN찬양팀Hub", apple-mobile-web-app-title 등 head 태그(pageShell · live).

## 6. 속도
- 응답 압축(brotli/gzip): yn.css 346KB→65KB, practice.js 182KB→56KB, /conti HTML 90KB→11KB.
- 화면 파일(?v=) 1년 immutable, vendor/아이콘 7일. 폰트 CSS 비차단 로드.
- sheetsDb 읽기 캐시: 20초 신선 + 5분 SWR(지난 값 즉시, 뒤에서 갱신) + 같은 탭 동시읽기 합침 + 쓰기 시 즉시 무효화(읽는 도중 쓰기 보호) + 실패 시 10분 지난 값으로 버팀. (구글 시트 API 호출 대폭 감소)
- 남은 참고: Render 무료 플랜은 15분 무사용 시 잠들어 첫 접속이 느림 → 유료 플랜 또는 외부 핑(UptimeRobot, /healthz)으로 해결.

## 시험
- _v11_import 30 · _v11_guest 57 · _v11_shots(브라우저) 16 · _v11_sheetsdb 14 · _v11_live 31 · 기존 r18 서버 88 / 브라우저 77 외 회귀 통과. 예전부터 실패: practice(2), roster 🎹, songbuilder at-tag, pdf_fallback.
