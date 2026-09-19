# Google 회원가입·로그인 설정

Google로 처음 인증하면 Supabase 회원이 만들어지고, 다음부터 같은 버튼으로 로그인합니다.
기존 계정 진행도·꾸미기는 `auth.users.id`를 기준으로 계속 저장합니다. 이번 기능에는 추가 SQL이 없습니다.

2026-09-19 공개 `/auth/v1/settings` 확인 당시 운영 프로젝트의 Google 제공자는 꺼져 있었습니다.
설정 전에는 Google 버튼을 숨깁니다. 아래 설정을 마친 뒤 게임을 새로고침하면 나타납니다.

## 1. Google Cloud / Google Auth Platform

1. 사용할 Google Cloud 프로젝트를 선택합니다.
2. Google Auth Platform에서 Branding, Audience, Data Access를 설정합니다. 앱 이름·지원 이메일·개발자 연락처와 실제 홈페이지/개인정보처리방침을 등록합니다.
3. 외부 사용자용 앱이라면 External을 선택합니다. Testing 상태에서는 Test users에 등록한 Google 계정으로 먼저 시험합니다. 일반 공개 전에 Publishing status를 Production으로 전환하고, Google이 요구하는 추가 검증이 있으면 완료합니다.
4. Clients에서 OAuth 클라이언트를 **Web application** 유형으로 생성합니다. 이번 Android도 시스템 브라우저 → Supabase OAuth 방식을 사용하므로 같은 웹 클라이언트를 사용합니다.
5. Authorized JavaScript origins:
   - `https://ddrubok.github.io`
   - 로컬 확인용: `http://127.0.0.1:5203`
6. Authorized redirect URIs에 아래 **Supabase 콜백**을 정확히 추가합니다:

   `https://yoajmckkrpgvcljrffww.supabase.co/auth/v1/callback`

7. Client ID와 Client secret을 복사하여 다음 Supabase 설정에 입력합니다. **Client secret은 저장소·프런트엔드·채팅에 넣지 않습니다.**

## 2. Supabase Dashboard

Authentication → Sign In / Providers → Google에서:

1. Google 제공자를 활성화합니다.
2. Google Cloud의 Client ID, Client secret을 입력하고 저장합니다.
3. nonce 검증 생략 같은 보안 완화 옵션은 켜지 않습니다.

Authentication → URL Configuration에서:

- Site URL: `https://ddrubok.github.io/ChessAlkkkaegi/`
- Redirect URLs:
  - `https://ddrubok.github.io/ChessAlkkkaegi/`
  - `http://127.0.0.1:5203/`
  - `http://localhost:5203/` — 이 주소로 개발할 때만
  - `com.chessalkkagi.app://auth/callback` — 새 Android 빌드용

Google Cloud에는 Supabase 콜백 URL을, Supabase에는 게임/앱 복귀 URL을 넣습니다. 두 종류의 주소를 바꾸어 넣지 마세요.

## 3. 계정과 기록

- 기존 이메일 회원은 같은 **확인된 이메일**의 Google 계정을 사용하면 Supabase의 자동 identity linking 대상이 됩니다. 운영에서 기존 계정과 동일한 사용자 ID인지 확인하세요.
- 이메일 주소가 다르면 별도 계정입니다. 이번 변경은 서로 다른 계정의 기록을 임의로 합치지 않습니다.
- Google 이름·사진을 게임 닉네임·배너로 자동 덮어쓰지 않습니다. 게임의 기존 프로필/계정 저장 흐름을 유지합니다.
- Google 제공자 활성화와 URL 설정만 필요하며, RLS나 진행도/보상 테이블을 수정할 필요가 없습니다.

## 4. 확인 순서

1. 제공자 활성화 후 게임 새로고침 → Google로 계속하기 버튼 확인.
2. 신규 테스트 Google 계정으로 인증 → 로비 입장 → 로그아웃 → 같은 Google 계정 재로그인.
3. 기존 이메일 회원과 같은 확인된 이메일의 Google 계정으로 로그인 → 닉네임·진행도·꾸미기 유지 확인.
4. Google 계정 선택 화면에서 취소 → 게임으로 돌아와 이메일 로그인/Google 재시도 확인.
5. Android는 새 앱 빌드를 설치한 후 시스템 브라우저에서 로그인하고 앱으로 돌아오는지 확인. 웹 배포만으로 기존 설치 앱의 코드가 업데이트되지는 않습니다.
6. 기기 두 대에서 로그인 후 계정 진행도가 동일한지 확인합니다.

인증 코드는 PKCE로 교환하며 토큰을 URL에서 임의로 받아 저장하지 않습니다. Google 실제 인증과 Android 실기기 복귀는 제공자 설정 후 확인해야 합니다.

공식 참고:
- [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase 복귀 URL](https://supabase.com/docs/guides/auth/redirect-urls)
- [계정 연결](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Capacitor 앱 링크](https://capacitorjs.com/docs/apis/app)
