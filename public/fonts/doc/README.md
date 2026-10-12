# 문서 · 노트 글꼴 (v9.26)

선교 핸드북 · 보고서의 글자 서식 도구, 내 노트 텍스트 상자, 라이브 노트 글자에서 고르는 글꼴입니다.
`tools/fonts/build-doc-fonts.py` 가 원본 글꼴을 KS X 1001 한글 2,350자 + 영문 · 기호로 줄이고 TrueType 으로 바꿔
`<키>-<굵기>.ttf`(PDF 용) · `.woff2`(화면 용)를 만듭니다. 화면은 `fonts.css` 의 `font-family: yn-<키>` 로 씁니다.

| 키 | 글꼴 | 굵기 | 출처 · 라이선스 |
|---|---|---|---|
| paperlogy | 페이퍼로지 | 400 · 700 | Freesentation / Paperlogy — SIL OFL 1.1 |
| pretendard | 프리텐다드 | 400 · 700 | orioncactus/pretendard — SIL OFL 1.1 |
| scdream | 에스코어 드림 | 400 | S-Core — 무료 (임베딩 허용) |
| gowunbatang | 고운바탕 | 400 · 700 | Google Fonts (yangheeryu) — SIL OFL 1.1 |
| suit | 수트 | 400 · 700 | sun-typeface/SUIT — SIL OFL 1.1 |
| kopubdotum | KoPub 돋움 | 400 · 700 | 한국출판인회의 KoPub — 무료 (임베딩 허용) |
| chosungu | 조선굴림체 | 400 | 조선일보 — 무료 (임베딩 허용) |
| seoyun | 이서윤체 | 400 | 이서윤 — 무료 (임베딩 허용) |
| yuntaeng | 온글잎 윤탱체 | 400 | (주)보이저엑스 온글잎 — 무료, 임베딩 허용 (noonnu.cc/font_page/1918) |
| yeeun | 그리운 예은체 | 400 | 그리운 — 모든 사용 범위 무료, 임베딩 허용 (noonnu.cc/font_page/1938) |
| popcorn | 그리운 팝콘체 | 400 | 그리운 — 모든 사용 범위 무료, 임베딩 허용 (noonnu.cc/font_page/1939) |
| konkon | 온글잎 콘콘체 | 400 | (주)보이저엑스 온글잎 — 무료, 임베딩 허용 (noonnu.cc/font_page/1546) |
| goding | 고딕 아니고 고딩 | 400 | 네이버 나눔손글씨 — 무료, 임베딩 허용 |

메모먼트 꾹꾹체는 배포처가 "웹폰트 파일 · 웹서비스 직접 임베딩"을 허용하지 않아 넣지 않았습니다 (https://www.memoment.kr/font).
(온글잎 긍정체는 라이브 노트 전용으로 `../anno/` 에 있음.)

굵은 꼴이 없는 글꼴은 화면에서는 브라우저가, PDF 에서는 글자를 살짝 비켜 두 번 그려 굵게 보이게 합니다.
글꼴을 더하려면: 원본을 받아 스크립트의 `FONTS` 에 넣고 실행 → 키를 `public/rte/rte.js FONTS` · `logic/richtext.js 리치글꼴_` ·
`lib/missiondoc/fonts.js DOC_FONTS` · `public/worship/anno.js` (FONT_KEYS · FONT_NAMES · FONTS · LOCAL_FONTS) · `lib/realtime.js FONT_KEYS` ·
`public/notes/ink.js FONTS` · `logic/notes.js 손글씨다듬기_` 에 같이 더합니다 (`npm run test:v926` 이 목록이 같은지 확인).
