# 정산 마이그레이션

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
