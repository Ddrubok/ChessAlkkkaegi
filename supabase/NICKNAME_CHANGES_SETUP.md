# 닉네임 변경 적용 안내

## Supabase 적용

1. 운영 프로젝트의 **SQL Editor → New query**를 엽니다.
2. `supabase/migrations/20260920_nickname_changes.sql` 전체를 복사하여 실행합니다.
3. 결과가 `nickname_changes_ready`인지 확인합니다.
4. SQL 적용 후 새 웹 버전을 배포합니다. 이전 버전의 직접 닉네임 변경은 SQL 적용 이후 차단됩니다.

웹 배포는 SQL을 자동으로 실행하지 않습니다. 운영 SQL은 위 절차로 별도 적용합니다.

## 사용 방법과 규칙

- 로그인 후 메인 화면의 프로필을 펼쳐 **닉네임 변경**을 누릅니다. 온라인 로비의 닉네임 편집 버튼에서도 같은 창이 열립니다.
- 원하는 이름을 입력하고 **중복 확인 → 무료로 변경**을 누릅니다.
- Google 계정은 기존 회원을 포함하여 계정당 한 번 무료입니다. 이후에는 변경권 1장이 필요합니다. 이메일 전용 계정에는 Google 무료 변경 혜택이 없습니다.
- 새 Google 프로필은 서버가 임시 `Player_…` 이름을 지정합니다. 임시 이름 생성은 무료 변경 횟수를 사용하지 않습니다. 기존 프로필 이름은 유지합니다.
- 이름은 정규화 후 2~20자입니다. 대소문자, 앞뒤 일반 공백, 전각/반각 차이만으로 중복 이름을 만들 수 없습니다.
- 중복 확인 직후 다른 사용자가 먼저 이름을 사용해도 저장 시 서버에서 다시 차단합니다.
- 중복 이름, 실패한 변경, 현재와 같은 이름에는 횟수나 변경권을 차감하지 않습니다. 같은 요청을 재전송해도 이중 차감하지 않습니다.
- 무료 사용 이력과 변경권은 계정별 서버 테이블에서 관리합니다. 기기 초기화나 계정 진행도 JSON 수정으로 초기화할 수 없습니다.

## 기존 중복 이름으로 적용이 중단되는 경우

마이그레이션은 기존 이름을 임의로 변경하지 않습니다. `nickname_duplicates_exist` 오류가 나오면 다음 읽기 전용 쿼리로 충돌을 확인하고 이름 정리 후 다시 적용합니다.

```sql
SELECT lower(btrim(normalize(nickname, NFKC))) AS normalized_name,
       count(*) AS account_count
FROM public.profiles
GROUP BY lower(btrim(normalize(nickname, NFKC)))
HAVING count(*) > 1;
```

## 나중에 상점 연결하기

판매 화면·가격·결제 기능은 이번 범위에 포함하지 않았습니다. 변경권 지급과 사용 기반은 준비되어 있습니다.

결제를 검증하는 신뢰할 수 있는 서버에서 `service_role` 권한으로 다음 RPC를 호출합니다. 브라우저에 서버 키를 넣으면 안 됩니다.

```js
// 서버에서 구매자와 결제 완료를 검증한 이후에만 호출합니다.
await admin.rpc('grant_nickname_change_ticket_v1', {
  p_user_id: verifiedUserId,
  p_purchase_id: verifiedOrderId,
  p_quantity: 1,
});
```

주문 ID는 결제 제공자를 포함한 고유하고 일정한 값으로 사용합니다. 같은 주문·계정·수량으로 재호출하면 추가 지급하지 않습니다. 동일 주문 ID를 다른 계정이나 수량으로 재사용하면 오류가 납니다. 일반 로그인 사용자는 지급 RPC를 실행할 수 없습니다.

## 확인 방법

Google 계정에서 다른 사용자의 이름으로 중복 확인이 거절되는지, 새 이름으로 무료 변경한 뒤 무료 버튼이 사라지는지 확인합니다. 로그아웃·재로그인 후에도 이름과 사용 이력이 유지되어야 합니다.

로컬 자동 검사:

```powershell
npm --prefix .orca/sql-check install --no-save @electric-sql/pglite
node supabase/tests/nickname-check.mjs
node web/src/tools/nickname-change-check.mjs
npm --prefix web run check:regressions
npm --prefix web run build
```

SQL 검사는 운영 DB가 아닌 임시 PGlite DB에서 실행합니다. 브라우저 모의 검사에서는 320px 화면, 9개 언어, 중복 거절, 네트워크 재시도, 계정 전환 시 창 닫기, SQL 미적용 시 변경 차단을 확인했습니다. 실제 운영 OAuth 계정의 최종 확인은 SQL 적용 후 진행합니다.
