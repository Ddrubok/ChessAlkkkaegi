# Supabase Profile Banners Setup & Verification Guide

## 1. 개요 (Overview)
`20260917_profile_banners.sql` 마이그레이션은 프로필 배너 기능(`banners-v1`)을 위한 백엔드 스키마와 RPC를 배포합니다.
기존 v1/v2 클라이언트에는 읽을 수 있는 항목만 반환하고, 이들이 저장할 때 새 배너 기록을 보존합니다. 새 클라이언트는 `ca_account_progress_v3:` 기기 캐시를 사용하여 오래된 앱의 엄격한 캐시 검사와 충돌하지 않게 합니다. 기존 계정 캐시는 새 캐시가 없을 때 읽되 원본을 덮어쓰지 않습니다.

## 2. 배포 순서 (Migration Steps)
선행 조건: `20260915_account_progress.sql`, `20260916_mastery_account_progress.sql`이 적용되어 있어야 합니다. 이번 개발에서는 새 마이그레이션을 운영 DB에 실행하지 않았습니다.

DB 변경 및 확인을 먼저 진행한 뒤 웹/앱을 배포합니다. DB 변경 전에는 배너 기록을 해당 계정의 기기 캐시에 보관하며 다른 기기로 동기화하지 못합니다. 사용자에게 저장 대기 상태와 재시도 버튼을 표시합니다.

1. Supabase 대시보드의 **SQL Editor**로 이동합니다.
2. `supabase/migrations/20260917_profile_banners.sql` 파일의 내용을 붙여넣고 실행합니다.
3. 실행 결과로 `'profile_banners_migration_applied'`가 반환되는지 확인합니다.
4. `supabase/verify_profile_banners.sql` 스크립트를 실행하여 함수 권한 및 준비 상태(`profile_banners_ready`)를 검증합니다.

새 서버 기능이 확인되면 게임의 ‘저장 다시 시도’를 눌러 기기 기록을 동기화할 수 있습니다. 개인정보가 없는 배너 ID만 온라인 상대에게 공개됩니다. PvE 진행도의 실제 플레이 여부까지 서버가 검증하는 기능은 아닙니다.

문제가 생겨 이전 웹/앱으로 되돌릴 경우 새 DB 함수를 삭제하지 않고 유지합니다. 구버전 조회·저장 호환 처리가 기존 배너 데이터를 보존하므로, 배너 필드를 수동 삭제하는 방식으로 되돌리지 않습니다.

## 3. 신규 및 변경 RPC 명세 (RPC Specifications)

### `get_account_progress_v3(p_expected_user_id uuid, p_client_capability text)`
- **권한**: `authenticated` (비인증/익명 계정 차단)
- **요구 케이퍼빌리티**: `'banners-v1'`
- **반환값**: `{ data: jsonb, revision: bigint, capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1'] }`

### `save_account_progress_v3(p_data jsonb, p_expected_revision bigint, p_expected_user_id uuid, p_client_capability text)`
- **권한**: `authenticated`
- **요구 케이퍼빌리티**: `'banners-v1'`
- **CAS 버전 충돌 방지**: `p_expected_revision`이 현재 버전과 불일치할 경우 `40001` 에러 발생.

### `get_player_banner(p_user_id uuid)`
- **권한**: `authenticated`
- **목적**: 대전 상대 또는 특정 유저의 장착된 공개 배너 ID를 조회합니다.
- **보안**: 전체 도메인이나 진행도 테이블에 대한 광범위한 접근 없이 오직 유효하고 검증된 `banner_id` 문자열만 반환합니다. 미보유/미장착 시 기본값 `'classic'` 반환.

## 4. 하위 호환성 (Backward Compatibility)
- **v1 클라이언트 (`get_account_progress` / `save_account_progress`)**:
  - 숙련도 및 배너 키(`ca_mastery_*`)를 노출하지 않으며, 레거시 저장 시 기존 행에 저장된 숙련도/배너 데이터를 원자적으로 보존합니다.
- **v2 클라이언트 (`get_account_progress_v2` / `save_account_progress_v2` with `mastery-v1`)**:
  - v2 읽기 시 배너 확장 필드(`banners`, `banner:*` 보상, `equipped.banner`)를 투영(제거)하여 엄격한 v2 검증기의 오류를 방지합니다.
  - v2 저장 시 기존 행의 배너 확장 필드를 유실 없이 원자적으로 보존합니다.
