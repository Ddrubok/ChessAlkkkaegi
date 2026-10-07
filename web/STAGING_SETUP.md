# 개발 웹 배포

외부 개발자는 Cloudflare Pages의 개발 사이트를 사용합니다. `develop`의 변경 사항은 개발 사이트에, 출시할 코드는 `main`에 반영합니다. 운영 웹과 APK·AAB는 같은 출시 커밋을 기준으로 빌드합니다.

## Cloudflare Pages 연결 설정

Cloudflare의 **Workers & Pages → Create application → Pages → Import an existing Git repository**에서 연결합니다. GitHub 설치 범위는 `Ddrubok/ChessAlkkkaegi` 저장소만 선택하면 됩니다.

| 항목 | 값 |
|---|---|
| Project name | `chessalkkagi-dev` (사용 가능 여부는 생성 시 확인) |
| Git repository | `Ddrubok/ChessAlkkkaegi` |
| Production branch | `develop` |
| Framework preset | None |
| Root directory | `web` |
| Build command | `npm run build:staging` |
| Build output directory | `dist-staging` |
| Preview branch deployments | None |

Cloudflare가 표시하는 **Production branch**는 이 개발 사이트의 대표 주소에 배포할 브랜치를 뜻합니다. 게임의 운영 배포는 기존 GitHub Pages와 `main`이 담당합니다. 개발 브랜치에서는 GitHub Pages의 수동 배포도 건너뜁니다.

환경 변수는 아래처럼 등록합니다. Preview를 나중에 활성화할 경우에도 동일한 개발 값을 설정합니다.

| 변수 | 값 |
|---|---|
| `NODE_VERSION` | `22.18.0` |
| `VITE_SUPABASE_URL` | `https://eohasrpzjwtzexoogwdt.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | 개발 Supabase의 Publishable key |
| `VITE_AD_TEST_MODE` | `true` |
| `VITE_WEB_ADS_MODE` | `off` |

`.env.staging.local`은 Git에 포함되지 않습니다. Cloudflare에서는 환경 변수를 직접 등록해야 합니다. 앱 번들에 포함되는 설정에는 Publishable key만 사용합니다. 개발 URL이 없거나 운영 DB 주소가 들어가면 빌드가 실패합니다.

배포 성공 후 Cloudflare가 표시하는 실제 HTTPS 주소를 사용합니다. 주소는 프로젝트 생성 전에는 확정되지 않습니다. **개발 Supabase → Authentication → URL Configuration**에서 Site URL을 이 주소로 바꾸고 Redirect URLs에 같은 주소와 `http://127.0.0.1:5204/`를 모두 등록합니다. URL 끝에 `/`를 포함합니다.

Google 로그인은 개발 환경에서 생략합니다. 이메일 계정을 만들어 친구·랭킹·진행도 저장을 확인합니다. 개발 계정과 기록은 운영 프로젝트와 별개입니다.

## 개발자 PC 실행

`web/.env.staging.local` 파일에 위 표의 `VITE_` 변수들을 넣고 실행합니다.

```powershell
cd web
npm ci
npm run dev:staging
```

접속 주소는 `http://127.0.0.1:5204/`입니다. `npm run build:staging`은 타입 검사와 개발 환경 분리 검사를 실행하고 `dist-staging`에 출력합니다. 운영 빌드는 기존 `npm run build`와 `dist`를 사용합니다.

배포 후에는 다른 PC에서 화면 로딩, 이메일 로그인, 개발 DB의 프로필·진행도 저장, 두 계정 간 친구·대전을 확인합니다. Google 로그인과 Android 전용 광고는 이 웹 검증 대상에서 제외합니다.

공식 문서: [Cloudflare GitHub 연결](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/), [빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Supabase 로그인 복귀 주소](https://supabase.com/docs/guides/auth/redirect-urls).
