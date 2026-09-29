# 체스알까기 밸런스 설정 가이드 (`balance.csv`)

본 문서는 `web/balance.csv` 파일을 통해 게임 내 물리 엔진 및 체스말 밸런스를 조절하는 방법과 규칙을 안내합니다.

## 빠른 사용법

1. 엑셀에서 `balance.csv`를 열고 `value` 열만 수정합니다.
2. `CSV UTF-8(쉼표로 분리)` 형식으로 저장합니다. `.xlsx`로 저장하면 반영되지 않습니다.
3. `web` 폴더에서 `npm run build`를 실행합니다. 잘못된 CSV는 빌드 전에 오류가 납니다.
4. Android는 `npx cap sync android` 후 기존 절차로 새 AAB를 빌드하고 배포합니다. 새 업로드에는 새 버전 코드가 필요합니다.

예: `QUEEN_WEIGHT_MULTIPLIER`를 `1.2`로 바꾸면 퀸 무게가 20% 증가합니다. `PAWN_POWER_MULTIPLIER`를 `0.9`로 바꾸면 폰 발사 속도가 10% 감소합니다.

CSV가 바뀌면 저장된 개발용 손맛 조절값은 새 밸런스의 기본값으로 시작합니다. 게임 진행도와 재화는 초기화하지 않습니다. 이후 손맛 조절판에서 바꾼 값은 로컬 모드에서 CSV 기본값을 덮어쓸 수 있습니다.

실제 물리 반영 검사는 `node src/tools/balance-physics-check.mjs`로 실행합니다.

---

## 1. 개요 및 단일 진실 공급원 (Single Source of Truth)

- **`web/balance.csv`**는 아래 27개 항목의 기본값을 관리하는 파일입니다. 연구 비용·스테이지 성장 등 다른 설정은 기존 코드에 남아 있습니다.
- 코드가 임의로 분기되거나 오래된 생성 테이블(stale generated tables)을 참조하지 않으며, 빌드 시점에 번들링되어 게임 전반에 즉시 반영됩니다.
- 원격 데이터베이스(Supabase)와 연동되지 않는 순수 로컬 설정입니다.

---

## 2. 편집 규칙 및 주의사항

1. **오직 `value` 컬럼(수치)만 편집하십시오.**
   - `key` 이름을 변경, 삭제하거나 임의의 키를 새로 추가하지 마십시오.
   - 시스템 빌드 검증기(`npm run check:balance`)가 27개의 고정 키를 엄격하게 검사하며, **누락·중복·알 수 없는 키**가 발견되면 프로덕션 빌드가 즉시 차단됩니다.
2. **헤더 형식 유지:**
   - 1행의 `key,value,description` 헤더는 반드시 그대로 유지되어야 합니다.
3. **수치 형식:**
   - 공백이나 빈칸, `NaN`, 문자열은 허용되지 않으며, 유한한 십진수 숫자(정수 또는 소수)여야 합니다.
   - 각 키별로 지정된 유효 범위(아래 표 참조)를 준수해야 합니다.
4. **설명(description) 작성 시:**
   - 설명에 쉼표(`,`)나 큰따옴표(`"`)가 포함될 경우 표준 CSV 규격에 따라 전체를 `"..."`로 감싸고 큰따옴표는 `""`로 이스케이프하십시오.

---

## 3. 핵심 수치 개념

### (1) 중량 배율 (`weightMultiplier`)
- 기하학적 3D 메쉬의 볼록껍질(Convex Hull) 부피에서 유도된 기본 질량에 상대적으로 곱해지는 배율입니다.
- **기본값 `1.0`**: 원본 질량(기본 밀도 `PIECE_DENSITY = 1.2` 기준)을 유지합니다.
- **예시 `1.2`**: 기본 대비 **+20% 무거워짐**.
  - 충돌 시 상대 말에 의해 덜 밀려나며, 상대 말을 더 강하게 튕겨내는 물리적 이점을 가집니다.

### (2) 발사 속도 배율 (`powerMultiplier`)
- 힘(N)이나 충격량(N·s)의 절대값이 아니라 **목표 발사 속도**에 곱해지는 배율입니다.
- **기본값 `1.0`**: 원본 목표 발사 속도를 유지합니다.
- **예시 `1.2`**: 발사 직후 초속이 **+20% 증가**하여 같은 조준 세기에서도 더 빠르고 멀리 발사됩니다.

---

## 4. 모드별 적용 범위 (Mode Scope)

| 설정 항목 | 적용 모드 | 설명 |
| :--- | :--- | :--- |
| **공통 물리** (`PIECE_DENSITY`, `PIECE_RESTITUTION`, `PIECE_LINEAR_DAMPING`, `PIECE_ANGULAR_DAMPING`, 기물별 `weightMultiplier`) | **전 모드 공통** (온라인, 로컬, 스테이지, 퍼즐) | 모든 모드의 콜라이더 생성 및 바디 물리 시뮬레이션에 공통 적용됩니다. |
| **오프라인 마찰** (`PIECE_FRICTION`) | 로컬 / 스테이지 / 퍼즐 | 기본 마찰 계수 (0.05). |
| **온라인 마찰** (`CLASSIC_FRICTION`) | 온라인 대전 전용 | 초반 연쇄 탈락을 줄이기 위한 전용 마찰 (0.2). |
| **오프라인 최대 속도** (`MAX_LAUNCH_SPEED`) | 로컬 / 스테이지 / 퍼즐 | 기본 최대 발사 속도 (11). 런타임 튜닝 패널 오버라이드 가능. |
| **온라인 최대 속도** (`CLASSIC_MAX_LAUNCH_SPEED`, `CLASSIC_KNIGHT_MAX_LAUNCH_SPEED`) | 온라인 대전 전용 | 온라인 밸런스용 속도 (일반 말 7, 나이트 4.5). |
| **기물별 발사 배율** (`powerMultiplier`) | **전 모드 공통** | `getMaxLaunchSpeed()`의 최종 반환값에 곱해져 모드별 기본 속도를 비례 증폭합니다. |
| **기물 고유 기믹** (`KNIGHT_LAUNCH_ANGLE_DEG`, `KNIGHT_MIN_LAUNCH_POWER`, `ROOK_MAX_OVERDRIVE_POWER`, `ROOK_SPIN_MAX_POWER`, `BISHOP_SPIN_TORQUE_MULTIPLIER`, `BISHOP_DEFLECTION_IMPULSE_FACTOR`) | 기물별 스킬 발동 시 | 포물선 앙각, 오버드라이브 파워, 리코셰 회전 토크 등에 직접 적용됩니다. |

---

## 5. 재빌드 및 온라인 동기화 안내

1. **재빌드/재설치 필요:**
   - CSV 수정 후 웹은 `npm run build`로 재빌드하고 결과물을 배포합니다. 설치된 Android 앱에는 새 앱 빌드의 업데이트 설치가 필요합니다. `npm run build:portable`은 별도의 웹 체험판 빌드이며 Android 설치 명령이 아닙니다.
   - 빌드 과정에서 `prebuild`가 자동으로 `npm run check:balance`를 실행하여 CSV 문법 및 범위를 사전 검증합니다.
2. **온라인 대전 클라이언트 일치:**
   - 온라인 대전은 P2P 및 물리 상태 검증을 수행하므로, **대전하는 두 플레이어의 클라이언트가 동일한 빌드(동일한 `balance.csv` 수치)**여야 탈동기화(Desync) 없이 정상 진행됩니다.
   - 이번 변경에는 서로 다른 밸런스 버전의 매칭을 자동으로 차단하는 기능은 포함하지 않았습니다.
3. **유효성 검사 단독 실행:**
   - 빌드 없이 CSV 유효성만 테스트하려면 `web/` 디렉터리에서 아래 명령을 실행하십시오.
   ```bash
   npm run check:balance
   ```

---

## 6. 전체 27개 키 목록 및 기본값 / 허용 범위

| 키 이름 (Key) | 기본값 | 허용 범위 | 설명 |
| :--- | :---: | :---: | :--- |
| `PIECE_DENSITY` | 1.2 | 0.01 ~ 100.0 | 말 볼록껍질 부피 기반 기본 물리 밀도 |
| `PIECE_FRICTION` | 0.05 | 0.0 ~ 10.0 | 로컬/스테이지/퍼즐 모드 말 기본 마찰 계수 |
| `CLASSIC_FRICTION` | 0.2 | 0.0 ~ 10.0 | 온라인 대전 전용 말 마찰 계수 |
| `PIECE_RESTITUTION` | 0.6 | 0.0 ~ 1.0 | 말 충돌 반발 계수 (0: 완전비탄성, 1: 완전탄성) |
| `PIECE_LINEAR_DAMPING` | 0.0 | 0.0 ~ 100.0 | 말 병진 속도 감쇠값 (0은 무감쇠) |
| `PIECE_ANGULAR_DAMPING` | 0.0 | 0.0 ~ 100.0 | 말 각속도 회전 감쇠값 (0은 무감쇠) |
| `MAX_LAUNCH_SPEED` | 11.0 | 0.1 ~ 100.0 | 로컬/스테이지/퍼즐 모드 최대 발사 속도 |
| `CLASSIC_MAX_LAUNCH_SPEED` | 7.0 | 0.1 ~ 100.0 | 온라인 대전 일반 말 최대 발사 속도 |
| `CLASSIC_KNIGHT_MAX_LAUNCH_SPEED` | 4.5 | 0.1 ~ 100.0 | 온라인 대전 나이트 최대 발사 속도 |
| `KNIGHT_LAUNCH_ANGLE_DEG` | 65.0 | 0.0 ~ 89.9 | 나이트 도약 고정 앙각 (도 단위) |
| `KNIGHT_MIN_LAUNCH_POWER` | 0.38 | 0.0 ~ 1.0 | 나이트 최소 발사 세기 보정 비율 |
| `ROOK_MAX_OVERDRIVE_POWER` | 1.5 | 0.1 ~ 5.0 | 룩 무회전(중앙 타격) 시 최대 오버드라이브 파워 배율 |
| `ROOK_SPIN_MAX_POWER` | 1.0 | 0.1 ~ 5.0 | 룩 스핀 타격 시 최대 파워 배율 |
| `BISHOP_SPIN_TORQUE_MULTIPLIER` | 2.2 | 0.0 ~ 20.0 | 비숍 충돌 회전 토크 증폭 배율 |
| `BISHOP_DEFLECTION_IMPULSE_FACTOR` | 0.65 | 0.0 ~ 5.0 | 비숍 충돌 대각선 굴절 충격량 배율 |
| `PAWN_WEIGHT_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 폰(Pawn) 개별 질량/밀도 배율 |
| `PAWN_POWER_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 폰(Pawn) 개별 발사 속도 배율 |
| `KNIGHT_WEIGHT_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 나이트(Knight) 개별 질량/밀도 배율 |
| `KNIGHT_POWER_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 나이트(Knight) 개별 발사 속도 배율 |
| `BISHOP_WEIGHT_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 비숍(Bishop) 개별 질량/밀도 배율 |
| `BISHOP_POWER_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 비숍(Bishop) 개별 발사 속도 배율 |
| `ROOK_WEIGHT_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 룩(Rook) 개별 질량/밀도 배율 |
| `ROOK_POWER_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 룩(Rook) 개별 발사 속도 배율 |
| `QUEEN_WEIGHT_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 퀸(Queen) 개별 질량/밀도 배율 |
| `QUEEN_POWER_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 퀸(Queen) 개별 발사 속도 배율 |
| `KING_WEIGHT_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 킹(King) 개별 질량/밀도 배율 |
| `KING_POWER_MULTIPLIER` | 1.0 | 0.01 ~ 20.0 | 킹(King) 개별 발사 속도 배율 |
