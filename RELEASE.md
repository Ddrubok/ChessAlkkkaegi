# 네 플랫폼 릴리스

`Four-platform release`는 한 Git 커밋에서 일반 웹, itch.io, CrazyGames, Android를 빌드한다. 버전명과 Android 버전 코드는 `web/android/app/build.gradle`에서 읽는다. 처음 사용하는 경우 아래 설정을 마친 후 GitHub Actions에서 실행한다.

## 버전을 올릴 때

1. 같은 릴리스에 포함할 게임 코드와 에셋을 커밋하고 `versionName`을 올린다. Google Play에 새 AAB를 올릴 때는 기존에 사용한 값보다 큰 `versionCode`를 지정한다.
2. 검토한 변경을 `main`에 반영하고 GitHub의 **Actions → Four-platform release → Run workflow**를 연다. 기본값은 네 플랫폼 빌드와 검사다. 실제 업로드까지 진행할 때는 `main`에서 `distribute`를 선택한다. CLI로는 다음 명령을 사용한다.

   ```sh
   gh workflow run four-platform-release.yml --ref main -f distribute=true -f play_track=internal
   ```

3. 실행 결과에서 `verify` 성공과 `release-manifest`의 버전·커밋을 확인한다. 이 단계는 ZIP, Pages 아카이브, 서명된 AAB 안에서 직접 빌드 정보와 체스 말 물리 데이터의 해시를 읽는다. 한 플랫폼이라도 검사에 실패하면 세 자동 업로드 작업은 시작하지 않는다.
4. 같은 실행에서 `portal-packages`를 내려받아 그 안의 `crazygames.zip`을 푼다. CrazyGames Developer Portal에서 기존 게임을 열고 `index.html`이 들어 있는 폴더를 선택한다. 미리보기에서 로그인·클래식 매칭을 확인한 뒤 심사를 제출한다. [개발자 포털](https://developer.crazygames.com/) · [공식 업데이트 안내](https://docs.crazygames.com/faq/)

| 대상 | 배포를 선택한 실행의 결과 |
| --- | --- |
| 웹 | 검증한 Pages 아카이브를 기존 GitHub Pages 사이트에 배포한다. |
| itch.io | Butler로 기존 `ddurubok/chess-alkkagi:html` 채널에 `itch.zip`을 올리고 릴리스 버전명을 기록한다. |
| Android | 검증한 AAB를 Google Play의 선택한 트랙에 올린다. 기본은 내부 테스트다. 처음부터 전체 출시하려는 경우에만 `production`을 선택한다. |
| CrazyGames | 동일 커밋의 포털 업로드용 파일을 준비한다. 제출 상태와 공개 시점은 Developer Portal에서 확인한다. |

**부분 실패 시** Actions에서 실패한 작업과 대상 플랫폼의 현재 버전을 먼저 확인한다. 아직 반영되지 않은 작업은 같은 실행의 **Re-run failed jobs**로 재시도한다. 이미 Play에 올라간 버전 코드를 내부 테스트에서 정식 출시할 때는 Play Console에서 기존 릴리스를 승격한다. 준비만 한 실행에서 CrazyGames 심사를 먼저 진행한 경우, 이후 배포 실행의 커밋이 심사본과 일치하는지 확인한다. 플랫폼별 심사와 캐시 갱신 때문에 실제 공개 시각은 달라질 수 있다.

## 최초 설정

### 로컬에서 배포 파일만 준비하기

운영 빌드 환경과 Android SDK, JDK, 웹 의존성이 설치된 릴리스 작업 폴더에서 아래 명령을 실행한다. Python 3.11 이상을 사용한다. `JAVA_HOME`은 빌드 JDK를 가리켜야 한다. 기본 서명 설정은 `web/android/keystore.properties`이며, 다른 작업 폴더의 기존 업로드 키를 사용할 때는 `CHESS_ANDROID_SIGNING_PROPERTIES`에 해당 설정 파일의 절대 경로를 지정한다.

```sh
python scripts/prepare-release-local.py <새-출력-폴더> --signer-sha256 <기존-업로드-인증서-SHA256>
```

이 명령은 세 웹 빌드, Capacitor 동기화, Android 릴리스 서명, 네 패키지의 버전·물리 데이터 검증을 차례로 수행하고 같은 폴더에 패치노트를 넣는다. 출력 폴더는 검증 후 생성되며, 기존 폴더가 있으면 중단한다. 로컬에서는 Capacitor 동기화로 Android 생성 파일이 갱신되므로 이번 릴리스는 소스를 복사한 작업 폴더에서 실행했다.

### GitHub Actions 설정

- 이 워크플로와 이번 릴리스의 소스가 기본 브랜치에 있어야 Actions 메뉴에서 실행할 수 있다. GitHub Pages의 빌드 소스는 **GitHub Actions**로 설정한다. 정기 배포를 이 절차로 전환할 때 저장소 Actions 변수 `COORDINATED_RELEASES=true`를 설정하면 기존 웹 워크플로의 `main` 푸시에 의한 선행 배포가 멈춘다. 기존 수동 웹 배포는 계속 사용할 수 있다.
- GitHub Actions secrets에 Play에 등록된 업로드 키의 `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`를 등록한다. 기존 앱과 같은 키를 사용한다.
- 운영 클라이언트 설정인 `VITE_SUPABASE_ANON_KEY`와 `VITE_METERED_API_KEY`를 등록한다. Android에서 운영 중인 광고 단위는 `VITE_ADMOB_BANNER_ID`, `VITE_ADMOB_INTERSTITIAL_ID`, `VITE_ADMOB_REWARDED_ID`로 전달한다. 웹 광고는 기존 Pages와 같은 저장소 변수 `VITE_WEB_ADS_MODE`, `VITE_ADSENSE_CLIENT_ID`, `VITE_ADSENSE_SLOT_ID`를 사용한다.
- 업로드용으로 itch 게시 권한이 있는 `BUTLER_API_KEY`와 해당 앱·트랙에 권한이 있는 Google Play 서비스 계정 JSON인 `PLAY_SERVICE_ACCOUNT_JSON`을 등록한다. 빌드만 선택한 실행에는 이 두 업로드 자격 증명이 필요하지 않다. [Butler 배포 문서](https://itch.io/docs/butler/pushing.html) · [Google Play 출시 문서](https://support.google.com/googleplay/android-developer/answer/9859348)

온라인 메시지나 승패 규칙이 바뀌면 직전 버전과의 대전 호환성을 별도로 확인한다. 현재 물리 해시는 `chess-set.meta.json`을 대상으로 하므로 게임 규칙 변경 전체를 감지하지 않는다.
