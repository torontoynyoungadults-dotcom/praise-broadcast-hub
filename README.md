# 찬양방송팀 허브

토론토영락교회 청년부 찬양방송팀 전용 허브. (청년부 전체 앱인 `church-app`과는 별도의 독립 프로젝트입니다.)

## 지금 단계 (1단계 — 로그인 골격)
- Google 로그인 + 회원가입(이름·전화번호·소속 찬양팀·역할·프로필사진)
- 로그인 후 소속 찬양팀 허브 진입 (지금은 자리만, 실제 탭은 다음 단계에서)
- 관리자 플래그 확인 후 `/admin` 진입 (지금은 자리만)

다음 단계에서 예배콘티 → 공지및모임 → 스케줄표 → 라이브러리 → 장비·수리 순서로 기능을 이어 붙입니다.

## 로컬에서 실행하기
```bash
npm install
cp .env.example .env   # 값 채우기 (아래 "환경변수" 참고)
npm start
```

## 환경변수
`.env.example` 참고. 구글 관련 자격이 **두 가지**로 분리되어 있는 점이 중요합니다.

### ① 서버 자격 — 시트 · 드라이브 읽고 쓰기 (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN`)
1. [Google Cloud Console](https://console.cloud.google.com) → 새 프로젝트 생성 (church-app과는 별개의 새 프로젝트)
2. API 및 서비스 → 라이브러리 → **Google Sheets API**, **Google Drive API** 사용 설정
3. API 및 서비스 → OAuth 동의 화면 → User Type "외부" → 사용할 교회 공용 계정을 테스트 사용자로 추가한 뒤, **반드시 "앱 게시(프로덕션으로 이동)"까지 누르세요.** 테스트 상태로 두면 리프레시 토큰이 **7일마다 만료**되어 `invalid_grant` 로 사이트가 멈춥니다. (게시해도 검증은 필요 없고, 로그인 때 "확인되지 않은 앱" 경고만 한 번 나옵니다)
4. 사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 유형 **데스크톱 앱**
5. 발급된 클라이언트 ID/시크릿으로 아래 실행 (교회 공용 구글 계정 — 아래 드라이브 폴더에 편집자 권한이 있는 계정 — 으로 로그인):
   ```bash
   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run auth
   ```
6. 터미널에 출력되는 `GOOGLE_REFRESH_TOKEN` 값을 `.env`(로컬) / Render 환경변수(배포)에 저장

### ② 로그인 자격 — 멤버의 "Google로 로그인" (`GOOGLE_LOGIN_CLIENT_ID` / `GOOGLE_LOGIN_CLIENT_SECRET`)
1. 같은 Google Cloud 프로젝트의 사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 유형 **웹 애플리케이션**
2. 승인된 리디렉션 URI에 `<BASE_URL>/auth/google/callback` 추가
   - 로컬 테스트: `http://localhost:3000/auth/google/callback`
   - 배포: `https://<render-주소>/auth/google/callback`
3. 발급된 클라이언트 ID/시크릿을 `GOOGLE_LOGIN_CLIENT_ID` / `GOOGLE_LOGIN_CLIENT_SECRET`에 저장

### ③ 기타
- `DB_FOLDER_ID`: 드라이브 폴더 ID (모든 시트·파일이 이 폴더 아래에 저장됩니다)
- `SESSION_SECRET`: 아무 긴 임의 문자열 (`openssl rand -hex 32`)
- `BASE_URL`: 이 서버가 실제로 떠 있는 주소 (구글 로그인 리디렉션을 이 값 기준으로 만듭니다 — ②의 리디렉션 URI와 정확히 일치해야 합니다)

## Render 배포
`render.yaml` 참고. GitHub에 push하면 Render가 자동 빌드/배포합니다. 환경변수는 Render 대시보드 → Environment 탭에서 위 항목들을 채워주세요.

## DB 구조
`lib/schema.js`에 정의되어 있습니다. 구글 드라이브 폴더(`DB_FOLDER_ID`) 안에 "찬양방송팀 허브 DB"라는 시트 1개를 자동으로 만들고, 그 안에 탭(회원/찬양팀/찬양콘티/… )을 둡니다. 서버를 처음 실행하면 필요한 탭과 머리글을 자동으로 만듭니다.

### 최초 관리자 지정 (부트스트랩)
가입을 마친 뒤, 생성된 시트의 "회원" 탭을 직접 열어 본인 행의 "관리자여부" 칸을 `TRUE`로 바꿔주세요. 이후부터는 관리자 화면에서 다른 사람을 관리자로 지정할 수 있도록 만들 예정입니다.
