# Supabase Profile Cosmetics Setup & Verification Guide

## 1. 개요 (Overview)
`20260918_profile_cosmetics.sql` 마이그레이션은 프로필 6종 꾸미기 슬롯(`cosmetics-v1`: banner, frame, badge, badgeFrame, title, titleFrame) 기능 지원을 위한 백엔드 스키마와 RPC를 배포합니다.
기존 v1/v2/v3 클라이언트에는 각 버전이 해석할 수 있는 항목만 안전하게 투영(projection)하여 반환하고, 구버전 클라이언트가 저장할 때 신규 꾸미기 슬롯(`badgeFrame`, `titleFrame`) 및 회원 기본 아이템(`frame:classic-gold`, `title:challenger`) 설정을 유실 없이 원자적으로 보존합니다.
새 클라이언트는 `ca_account_progress_v4:` 기기 캐시 접두사를 사용하여 구버전 앱의 엄격한 캐시 검증과 충돌하지 않도록 격리됩니다.

## 2. 배포 순서 (Migration Steps)
선행 조건: 기존 계정 진행도·숙련도·배너 마이그레이션이 적용되어 있어야 합니다. 이전에 `profile_banners_ready`를 확인한 DB라면 아래 신규 마이그레이션부터 실행합니다. 이번 작업에서는 운영 DB에 접속하거나 SQL을 실행하지 않았습니다.

DB 변경 및 검증을 먼저 완료한 후 웹/앱 클라이언트를 배포합니다.

1. Supabase 대시보드의 **SQL Editor**로 이동합니다.
2. `supabase/migrations/20260918_profile_cosmetics.sql` 파일의 전체 내용을 붙여넣고 실행합니다.
3. 실행 결과 쿼리 탭에서 `'profile_cosmetics_migration_applied'` 마커가 반환되는지 확인합니다.
4. `supabase/verify_profile_cosmetics.sql` 스크립트를 실행하여 신규 RPC 함수 존재 및 실행 권한 상태가 `'profile_cosmetics_ready'`로 검증되는지 확인합니다.

문제가 발생하여 이전 버전 웹/앱으로 롤백하더라도 신규 DB 함수를 임의로 삭제하지 않습니다. 구버전 조회·저장 호환 계층이 데이터 유실 없이 동작하므로, DB 필드를 수동 조작하여 되돌리지 않습니다.

## 3. 신규 및 변경 RPC 명세 (RPC Specifications)

### `get_account_progress_v4(p_expected_user_id uuid, p_client_capability text)`
- **권한**: `authenticated` (비인증 anon 또는 익명 계정 호출 시 `42501` 거부)
- **요구 케이퍼빌리티**: `'cosmetics-v1'`
- **반환값**: `{ data: jsonb, revision: bigint, capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1', 'cosmetics-v1'] }`

### `save_account_progress_v4(p_data jsonb, p_expected_revision bigint, p_expected_user_id uuid, p_client_capability text)`
- **권한**: `authenticated`
- **요구 케이퍼빌리티**: `'cosmetics-v1'`
- **CAS 버전 충돌 방지**: `p_expected_revision`이 현재 버전과 불일치할 경우 `40001` 예외 발생.
- **검증 규칙**:
  - `equipped` 6개 슬롯(`banner`, `frame`, `badge`, `badgeFrame`, `title`, `titleFrame`) 유효성 검사
  - 회원 기본 아이템(`frame:classic-gold`, `title:challenger`, `badgeFrame:gold|silver|violet`, `titleFrame:gold|silver|violet`, `banner:classic|slate|forest`)은 보상 획득 증빙 없이 기본 소유 인정
  - 업적 아이템(`frame:mastery-complete`, `title:explorer`, `badge:mastery-m01~m08`, 업적 배너 3종)은 `ca_mastery_rewards_v1` 소유권 증빙 필수
  - 알 수 없는 아이템 ID 및 슬롯은 `22023` 에러로 엄격 거부

### `get_player_cosmetics(p_user_id uuid)`
- **권한**: `authenticated`
- **목적**: 대전 상대 또는 특정 유저의 검증된 6-slot 공개 장착 꾸미기 정보를 단일 객체로 조회합니다.
- **반환값 형식**:
  ```json
  {
    "banner": "classic",
    "frame": "frame:classic-gold",
    "badge": "badge:mastery-m01",
    "badgeFrame": "badgeFrame:gold",
    "title": "title:challenger",
    "titleFrame": "titleFrame:violet"
  }
  ```
- **보안**: 비공개 진행도(PvE 기록, 연구 포인트 등)를 일체 노출하지 않으며, 오직 유효성이 검증된 장착 아이템 ID(또는 null)만 안전하게 반환합니다.

## 4. 하위 호환성 및 투영/보존 (Backward Compatibility)
- **v1 클라이언트 (`get_account_progress` / `save_account_progress`)**:
  - 숙련도 및 꾸미기 키(`ca_mastery_*`)를 노출하지 않으며, 레거시 저장 시 기존 행의 숙련도/배너/꾸미기 데이터를 보존합니다.
- **v2 클라이언트 (`get_account_progress_v2` / `save_account_progress_v2` with `mastery-v1`)**:
  - v2 읽기 시 배너/꾸미기 확장 필드를 투영(제거/null화)하여 반환합니다.
  - v2 저장 시 기존 행의 배너 및 신규 6-slot 꾸미기 필드를 유실 없이 원자적으로 보존합니다.
- **v3 클라이언트 (`get_account_progress_v3` / `save_account_progress_v3` with `banners-v1`)**:
  - v3 읽기 시 `badgeFrame`, `titleFrame` 슬롯을 제거하고, `frame:classic-gold` 및 `title:challenger`를 `null`로 투영하여 구버전 검증 실패를 방지합니다.
  - v3 저장 시 기존 행의 `badgeFrame`, `titleFrame`, `frame:classic-gold`, `title:challenger` 값을 안전하게 병합하여 보존합니다.
