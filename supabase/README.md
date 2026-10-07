# 정산 마이그레이션

## 새 개발 프로젝트 설치 — chessalkkagi-dev

운영용 업그레이드 절차는 아래에 따로 있습니다. 새 개발 프로젝트에는 기본 테이블까지 포함한 [setup_dev_project.sql](setup_dev_project.sql)을 사용합니다.

1. [개발 프로젝트 SQL Editor](https://supabase.com/dashboard/project/eohasrpzjwtzexoogwdt/sql/new)를 엽니다. 프로젝트 이름이 `chessalkkagi-dev`인지 확인합니다.
2. `setup_dev_project.sql` 전체를 붙여 넣고 `postgres` 역할로 **Run**을 누릅니다. 기존 `profiles` 등 앱 테이블이나 회원이 있으면 실행을 중단하도록 되어 있습니다.
3. 마지막 결과에 `chessalkkagi_dev_ready`가 표시되는지 확인합니다. 기본 테이블, 10개 마이그레이션, 랭킹 권한 검증을 한 트랜잭션으로 실행합니다. 운영 데이터는 복사하지 않습니다.
4. 개발 프로젝트의 **Authentication → URL Configuration**에서 **Site URL**과 **Redirect URLs**에 `http://127.0.0.1:5204/`를 설정합니다. 앱은 로그인 후 이 주소로 돌아옵니다. [Supabase 공식 안내](https://supabase.com/docs/guides/auth/redirect-urls)
5. 개발 환경에서는 Google 로그인을 사용하지 않습니다. 계정 저장·친구·랭킹 기능은 개발 프로젝트에 가입한 이메일 계정으로 확인합니다.

웹 연결 정보는 Git에서 제외되는 `web/.env.staging.local`에 설정했습니다. 앱용 URL은 `https://eohasrpzjwtzexoogwdt.supabase.co`이며, 대시보드 URL과 다릅니다. 이 파일에는 공개 Publishable key만 사용합니다.

프로젝트 루트 PowerShell에서 개발 웹 실행:

```powershell
cd web
npm run dev:staging
```

접속 주소는 `http://127.0.0.1:5204/`입니다. 처음 로그인하면 개발 프로젝트에 새 계정과 진행도가 생깁니다. 운영 계정의 기록은 복사되지 않습니다. 이 주소는 현재 PC에서 사용하는 로컬 웹이며, 외부에 공개한 개발 사이트 주소는 아직 없습니다.

`npm run build:staging`은 `web/dist-staging`에 출력합니다. 기존 `npm run build`와 Android의 `web/dist`는 운영용입니다. 개발 모드는 브라우저에 저장된 연결 설정을 무시하고 이 개발 프로젝트만 사용하며, 개발 URL/공개 키가 없거나 다른 프로젝트 URL이면 시작·빌드를 중단합니다. 테스트 광고 설정도 개발 환경에 따로 적용했습니다.

외부 개발자 공유는 [Cloudflare Pages 개발 배포 안내](../web/STAGING_SETUP.md)를 따릅니다. GitHub Pages는 `main`만 배포하고, `develop`에서 수동 실행해도 운영 사이트를 교체하지 않도록 제한했습니다. 개발 사이트 발급 후 개발 Supabase의 Site URL은 해당 HTTPS 주소로 변경하고, Redirect URLs에는 HTTPS 주소와 로컬 주소를 함께 등록합니다.

설치 묶음 재생성 및 로컬 검증(저장소 루트):

```powershell
node supabase/build-dev-setup.mjs
node supabase/tests/dev-project-check.mjs
cd web
node --experimental-vm-modules src/tools/staging-check.mjs
```

SQL 검사는 아래 기존 검사와 동일하게 `.orca/sql-check`의 PGlite를 사용합니다. Supabase 인증 스키마를 흉내 낸 메모리 DB에서 설치, 프로필 생성, 친구 권한, 대전 정산, 진행도·퀘스트·주간 도전 RPC, 재실행 시 데이터 보존을 확인합니다. 원격 DB에 설치했다는 의미는 아닙니다.

## 2026-10-07 보강 적용 — 기존 서비스

기존 정산 SQL을 적용한 서비스에서는 [20261007_ranked_match_registration.sql](migrations/20261007_ranked_match_registration.sql) **전체**를 SQL Editor에서 실행합니다. `ranked_match_registration_applied` 결과를 확인한 뒤 [검증 SQL](verify_ranked_match_registration.sql)을 실행하고 새 앱을 배포합니다. 이번 로컬 작업에서는 운영 DB에 적용하지 않았습니다.

새 앱은 최초 대전과 재대결을 시작하기 전에 두 참가자를 등록합니다. 서버는 등록한 참가자·모드와 일치하고 24시간 이내인 경기만 정산합니다. 이미 정산된 경기의 재시도는 기존 결과를 반환합니다. 경기 ID는 기존 P2P 흐름에서 정하며, 서버 등록은 실제 플레이나 담합 방지를 증명하지 않습니다.

**서버 변경과 앱 업데이트를 함께 계획해야 합니다.** 새 앱은 이 SQL이 없으면 랭킹 대전을 시작할 수 없고, 구버전 앱은 새 SQL 적용 후 새 경기 정산에 실패합니다. 진행 중인 구버전 경기는 먼저 종료하도록 안내하세요. 아래의 과거 묶음 SQL이나 20260914 SQL만 다시 적용하면 보강된 정산 함수가 덮어써지므로, 항상 20261007 마이그레이션을 마지막에 적용해야 합니다. 전적·진행도 초기화는 없습니다.

로컬 보안 회귀 검사: `node supabase/tests/security-hardening-check.mjs`

## Dashboard에서 적용

1. [프로젝트 SQL Editor](https://supabase.com/dashboard/project/yoajmckkrpgvcljrffww/sql/new)를 연다. 프로젝트가 체스알까기용인지 확인한다.
2. 관리자 `postgres` 역할로 `apply_secure_settlement.sql` **전체**를 붙여 넣고 Run을 누른다.
3. 결과의 `status`가 `secure_settlement_applied`인지 확인한다.
4. 수정된 web 빌드를 배포한다. 구버전 클라이언트의 정산 호출은 차단된다.

적용 파일은 두 마이그레이션을 묶은 스냅샷이다. 별도로 옛 추천인 SQL을 다시 실행하지 않는다.
기본 `profiles`/`match_history` 테이블은 이미 있어야 한다. 추천인 스키마는 파일에서 준비한다.
전체 실행 중 오류가 나면 트랜잭션이 취소되므로 오류 원문을 확인하고 수정 후 전체를 재실행한다.
적용 파일에는 데이터 삭제나 전적 초기화가 없다. 기존 NULL 전적은 기본값으로 보정한다.

묶음 파일 로컬 검증: `node supabase/tests/settlement-check.mjs ../apply_secure_settlement.sql`

## 개별 마이그레이션

기존 `profiles`/`match_history` 스키마와 `20260901_referral_system.sql` 적용 후,
관리자 권한으로 `migrations/20260914_secure_match_settlement.sql`을 적용한다.
이후 새 web 빌드를 배포한다. 운영 DB 적용은 사용자가 `secure_settlement_applied` 결과로 확인했다.

이 SQL은 전적/코인 직접 수정과 구버전 `finish_match` 호출 권한을 회수한다.
구버전 클라이언트는 정산에 실패하므로 SQL과 web 배포를 함께 진행해야 한다.
새 정산은 인증된 양쪽 참가자가 같은 매치 ID·모드·승자를 보고해야 확정되며,
재시도는 기존 결과를 반환한다. 상대 미확인이나 결과 불일치는 전적을 바꾸지 않는다.
P2P 합의 방식이므로 연결 종료 판정·승부 조작 공모 방지는 별도 서버 판정이 필요하다.

로컬 검증은 저장소 루트에서 실행한다. 원격 DB를 사용하지 않는다.

```powershell
npm install --prefix .orca/sql-check --no-save --package-lock=false @electric-sql/pglite@0.5.8
node supabase/tests/settlement-check.mjs
```

실제 PostgreSQL 엔진(PGlite)으로 권한·계정 격리·중복 정산·모드별 전적·무승부·
추천인 보상·마이그레이션 재실행을 검사한다. 운영 스키마와 동시 접속 부하 검증은 별도다.
