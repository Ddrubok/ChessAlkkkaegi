# 광고 운영 설정

앱은 Capacitor AdMob SDK, 웹 안내 페이지는 일반 AdSense를 지원합니다. 웹 광고 기본값은 `off`입니다. H5 Games Ads 공통 연동은 남아 있으나 코인 제거 후 게임 내 보상 광고 진입점은 없습니다. 코드 구현과 Google의 계정·사이트·H5 참여 승인은 별개입니다.

## 1. 지금 해야 할 웹 계정 설정

1. AdSense의 사이트 상세 화면에서 정확한 거절 사유와 신청 URL을 확인합니다. `가치가 별로 없는 콘텐츠`, 접근 불가, 소유권 확인 실패 등 사유에 맞춰 재검토합니다.
2. 배포된 게임·소개·규칙·티어·업데이트·개인정보 페이지를 확인합니다. 개인정보처리방침의 운영자 이메일, 실제 수집·보관·삭제 설명이 운영 현황과 일치하는지 확인합니다.
3. 기존 `index.html`의 `google-adsense-account` 메타 태그로 소유권을 확인할 수 있습니다. 현재 게시자 ID는 `ca-pub-1173757866262139`입니다. 계정이 다르면 메타 태그와 아래 환경 변수, ads.txt를 함께 바꿉니다.
4. AdSense의 사이트 메뉴에서 검토를 요청합니다. 대시보드 접근과 신청은 소유자가 직접 진행해야 합니다.
5. 추후 게임 내 H5 광고를 운영할 때 별도로 참여를 신청합니다. 일반 AdSense 승인만으로 H5가 활성화되는 것은 아닙니다.

안내 페이지는 `about.html`, `guide.html`, `tiers.html`, `updates.html`입니다. Google Search Console에는 URL 접두어 `https://ddrubok.github.io/ChessAlkkkaegi/`로 소유권을 확인하고 `sitemap.xml`을 제출할 수 있습니다. 검색 색인 완료는 AdSense 승인 보장이나 재신청의 필수 조건이 아닙니다.

## 2. 웹 광고를 단계적으로 켜는 설정

GitHub 저장소 → Settings → Secrets and variables → Actions → **Variables**에서 설정합니다. 아래 ID는 브라우저에 공개되는 설정이며 비밀 키가 아닙니다.

| 변수 | 현재 기본값 / 설정 방법 |
|---|---|
| `VITE_WEB_ADS_MODE` | `off`: 광고 요청 안 함. 사이트 승인 후 `display`, H5 참여 승인·동의 설정·테스트 완료 후 `h5` |
| `VITE_ADSENSE_CLIENT_ID` | `ca-pub-1173757866262139`. AdSense 계정의 게시자 ID와 확인 |
| `VITE_ADSENSE_SLOT_ID` | AdSense → 광고 → 광고 단위 기준 → 디스플레이 광고를 만들어 받은 숫자 `data-ad-slot` |

`display`는 안내 페이지의 광고 영역만 사용합니다. `h5`는 같은 안내 페이지 배너와 게임 광고 API를 초기화하지만, 현재 보상형·전면 광고를 요청하는 게임 진입점은 없습니다. 슬롯이 없으면 안내 페이지 배너를 요청하지 않습니다. 승인 후 안내 페이지 디스플레이 광고부터 운영할 수 있습니다.

이 배치를 유지하려면 AdSense의 사이트 **자동 광고(Auto ads)를 끄고** 수동 디스플레이 단위를 사용하세요. 계정에서 자동 광고를 켜면 이 코드가 지정하지 않은 위치에도 광고가 추가될 수 있습니다.

변수 저장 후 Actions → **Deploy web to GitHub Pages** → **Run workflow** → `main`으로 재배포해야 반영됩니다. 이미 완성된 빌드에는 변수 변경이 즉시 반영되지 않습니다. GitHub 배포에서는 테스트 모드를 항상 끕니다.

## 3. 개인정보 동의 메시지

웹: 광고 활성화 전에 AdSense의 **개인정보 보호 및 메시지**에서 사이트와 개인정보처리방침 URL을 연결하고 필요한 지역의 동의 메시지를 게시합니다. EEA·영국·스위스 트래픽에는 Google 인증 CMP와 TCF 관련 요구사항을 확인해야 합니다. Google CMP를 쓰면 별도 자체 동의 시스템을 만들 필요는 없습니다. 공개 사이트에서 메시지와 동의 변경 수단이 실제로 동작하는지 확인하세요. 단순히 방침 링크를 추가하는 것으로 동의 수집이 완료되지는 않습니다.

앱: AdMob의 **개인정보 보호 및 메시지**에서 해당 앱의 메시지를 게시합니다. 코드가 UMP `requestConsentInfo`와 필요한 동의 폼을 거친 뒤 `canRequestAds`일 때만 초기화합니다. UMP가 개인정보 옵션을 요구하면 앱 설정에 **광고 개인정보 설정** 버튼이 표시됩니다. 아동 대상 여부와 적용 지역은 실제 서비스 대상에 맞게 계정에서 설정해야 합니다.

## 4. ads.txt — 현재 루트 파일 확인 완료

2026년 9월 15일 확인 결과, `https://ddrubok.github.io/ads.txt`가 HTTP 200으로 응답하며 `google.com, pub-1173757866262139, DIRECT, f08c47fec0942fa0` 항목이 이미 있습니다. **현재 게시자 ID를 유지하면 새 파일을 올릴 필요가 없습니다.** AdSense 대시보드의 인식 상태만 확인하세요.

게시자 ID나 도메인을 바꿀 때만 아래 위치를 관리합니다. 프로젝트 하위의 `/ChessAlkkkaegi/ads.txt`는 호스트 루트의 `/ads.txt`와 다릅니다.

- `Ddrubok/ddrubok.github.io` 사용자 사이트 저장소를 운영한다면 루트에 같은 파일을 게시하여 `https://ddrubok.github.io/ads.txt`로 접근되게 합니다. 기존 파일이 있다면 기존 판매자 항목을 보존하고 필요한 줄만 추가합니다.
- 이 게임에 전용 도메인을 연결하고 사이트 루트의 `https://도메인/ads.txt`에 게시합니다. 도메인 변경 시 AdSense 신청 사이트, 소유권, sitemap의 URL도 업데이트합니다.

다른 저장소나 DNS는 이 작업에서 변경하지 않았습니다. ads.txt 준비는 콘텐츠 심사와 별개입니다.

## 5. Android AdMob 설정

App ID는 `web/android/app/src/main/res/values/strings.xml`의 `admob_app_id`에 있습니다. 현재 Google 샘플 ID가 아닌 값이 들어 있습니다. AdMob의 `com.chessalkkagi.app` 앱과 일치하는지 확인하세요. **App ID는 `~`, 광고 단위 ID는 `/`를 포함**합니다. `VITE_ADMOB_APP_ID`를 .env에 넣어도 Android 리소스가 바뀌지 않습니다.

AdMob에서 해당 앱의 광고 단위를 만든 뒤, 로컬 `web/.env`에 설정합니다. 기존 Supabase 설정은 보존하세요.

```dotenv
VITE_ADMOB_REWARDED_ID=ca-app-pub-계정번호/보상형광고단위번호
VITE_ADMOB_BANNER_ID=
VITE_ADMOB_INTERSTITIAL_ID=
VITE_AD_TEST_MODE=false
VITE_WEB_ADS_MODE=off
```

온라인 매칭 코인과 코인 보상 광고 진입점은 제거되었습니다. 보상형·전면 광고 공통 연동은 남아 있지만 현재 이를 요청하는 게임 버튼은 없습니다. 배너를 사용할 때 해당 단위를 설정합니다. 프로덕션에서 누락되거나 샘플 ID인 단위는 요청하지 않습니다. 설정 뒤 웹 빌드 → `npx cap sync android` → APK/AAB 재빌드가 필요합니다. Play Console 앱 정보·데이터 보안·개인정보처리방침과 AdMob 앱 준비 상태도 확인하세요.

AdMob에서 app-ads.txt를 안내하면 **AdMob이 제공한 판매자 줄**을 개발자 웹사이트의 루트 `/app-ads.txt`에 게시하고 스토어의 개발자 웹사이트와 맞춥니다. 웹 AdSense의 게시자 ID가 AdMob과 같다고 가정해서 복사하지 마세요.

## 6. 테스트와 보상 규칙

- `npm run check:ads`: SDK를 모의 처리하여 앱/웹 분리, 광고 없음·차단·취소·중복·시간 초과, 완료 콜백과 AdMob 리스너 정리를 검사합니다. 실제 광고 요청은 하지 않습니다.
- `npm run dev`는 광고를 명시적으로 켰을 때 공식 테스트 광고를 요청합니다. 웹 H5 테스트에는 로컬 `VITE_WEB_ADS_MODE=h5`가 필요하며 계정 이용 조건은 별개입니다.
- 설치용 QA 빌드는 `VITE_AD_TEST_MODE=true`로 공식 테스트 광고를 사용합니다. 수익화 배포에서는 반드시 `false`로 되돌리고 다시 빌드합니다. 직접 운영 광고를 클릭해 테스트하지 마세요.
- 온라인 매칭의 코인 소모, 자동 충전, 광고 시청·친구 초대 코인 지급은 제거되었습니다. 연구 포인트는 별개의 진행도이며 유지합니다.
- 자동 검사와 실제 기기 광고 검증은 다릅니다. Android 기기에서 동의 표시, 테스트 광고 완료/취소, 화면·소리 복귀를 확인한 후 운영 단위를 켜세요.

## 공식 참고

- [AdSense 사이트 재검토](https://support.google.com/adsense/answer/12176698?hl=ko)
- [H5 참여 신청 조건](https://support.google.com/adsense/answer/1705831?hl=ko)
- [Ad Placement API와 완료 콜백](https://developers.google.com/ad-placement/apis)
- [Google CMP 설정](https://support.google.com/adsense/answer/7670013?hl=ko)
- [AdMob UMP](https://developers.google.com/admob/android/privacy)
- [ads.txt 위치](https://support.google.com/adsense/answer/12171612?hl=ko)
