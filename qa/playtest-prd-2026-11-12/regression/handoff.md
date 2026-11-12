# PRD v1.1 R04/05/06/07/08/10/11 독립 회귀 확인 (2026-11-12)

## 범위와 결과

현재 로컬 소스의 기존 headless 검사를 **7개 실행해 모두 종료 코드 0**을 확인했다. 공개 네트워크 연결, 운영 데이터 쓰기, 빌드, 전체 `check:regressions`, 앱 소스 수정은 하지 않았다. 출력은 모두 `qa/playtest-prd-2026-11-12/regression/`에 남겼고 11월 11일 원본 보고서·JSON은 보존했다. Vite SSR은 실제 프로젝트 모듈을 읽지만 브라우저 UI, 서버, 저장소, 오디오 장치 일부는 검사별 대역이다.

| PRD | 이번에 확인한 것 | 증거 / 남은 범위 |
| --- | --- | --- |
| R04·05 | 카드 5%→8% **교체** 표기, 중량의 속도 유지 설명, 상한 무효·실제 적용값 표기. 크기·질량·초기 속도의 1·2·5등급 **9개** 표시값이 실제 물리 생성/발사값과 일치 | `card.log`, `physics-results.json`. 한 종류의 Pawn/선정 등급만 대조했다. 동일 샷의 모든 기물·연구·상한 및 실제 플레이어 체감은 미검증. |
| R06 | 선/기울임/누움 × 중심/표면 × 25/50/100% **18회**의 목표 초기 속도와 실제 Δv 일치. 벽 3~8단계 **6개** 형상 대응·접촉/파괴 규칙 통과, 경계 접근 **3개** 기록 | `physics.log`, `physics-results.json`. 실제 렌더 겹침, 비스듬/모서리·고저속 전수, 사용자가 느낀 어색함은 미판정. 물리 배율 조정 근거는 확인되지 않았다. |
| R07 | 일반 카드 중복 펼침 없음, 거대 폰·누운 시작 특수 상세, 중복 선택 차단·실패 뒤 재시도 | `card.log`. DOM 대역 검사이며 작은 화면·키보드·터치의 실제 조작은 미검증. |
| R08 | 클래식/전략 별도 큐, sync 전 인원 unknown과 확인된 0명 구분, 중복 탭·본인·이미 매칭된 계정 제외, 취소/재진입/오래된 콜백 차단. 호스트·게스트 연결 취소와 중복 ready 차단 | `match-presence.log`, `match-cancel.log`. `feedback-copy.ts`의 게스트 코드/로그인 자동 매칭·0명/분리 큐 안내와 `supabase-match-ui.ts`의 상태별 표시 경로도 정적 확인. 클라이언트/RTC/Supabase는 대역이며 실제 두 계정 경기는 하지 않았다. |
| R10 | 4·5·6단계 현재 버프·거대 폰/보드 조건을 물리 결과에 기록. 1~10단계 무승부 때 같은 단계·카드·포인트 체크포인트 보존, 중복 결과 방지, 보드 초기화 실패 후 재시도, 보상/카드 재추첨 없음 | `physics-results.json`, `draw.log`. 보드 생성·결과 UI·저장소는 대역. 1·5단계 실패 원인/승률 비교와 거대 폰 도입 단계 실험은 미실행. 기존 난도 수치는 유지 권장. |
| R11 | 모의 오디오 경계에서 mute/복원·충돌 강도·연쇄 충돌·조준 상한음, 피드백 유무에 따른 물리 동일성 통과. 모의 RPC에서 결과 재시도·0점·오류 처리 통과 | `sound.log`, `settlement.log`, `draw.log`. 실제 스피커의 손맛, 화면/입력/작은 뷰포트, 실제 서버 정산은 미검증. |

## 실행 기록과 대역

1. `node tools/itch-card-feedback-check.mjs` — 종료 0. Vite SSR, DOM 노드 대역, 카드 선택 실패 주입. `card.log`.
2. `cd web; node src/tools/itch-feedback-draw-check.mjs` — 종료 0. 실제 `main.ts` 결과 콜백 추출, 10단계, 메모리 체크포인트·보드/UI 대역. `draw.log`.
3. `cd web; node src/tools/match-cancel-check.mjs` — 종료 0. RTC/fetch/타이머/Supabase 클라이언트 대역, 공용 서버 접속 없음. `match-cancel.log`.
4. `cd web; node src/tools/matchmaking-presence-check.mjs` — 종료 0. Presence 채널·시계 대역, 두 큐. `match-presence.log`.
5. `node qa/playtest-prd-2026-11-12/regression/physics-check.mjs` — 종료 0. 기존 물리 검사 소스를 읽은 뒤 **evidence-local 복사본**의 모듈 경로와 JSON 출력만 변경했다. Rapier/Vite 실제 모듈, 18+6+3+9 사례. `physics.log`, `physics-results.json`. 기존 `qa/itch-feedback-2026-11-11/physics-results.json`을 덮어쓰지 않았다.
6. `cd web; node src/tools/sound-check.mjs` — 종료 0. 브라우저 Audio/fetch 대역과 실제 Rapier. 자동재생 실패 메시지는 의도한 예외 주입 뒤 복구를 검사한 로그다. `sound.log`.
7. `cd web; node src/tools/settlement-client-check.mjs` — 종료 0. RPC 대역, 운영 데이터 쓰기 없음. `settlement.log`.

## 판정과 후속

이 범위에서 **확정 결함 없음**. 수정을 권고할 구체 코드 결함은 발견하지 못했다. PF-T09~T15·T18~T20의 전체 수용 완료로 해석하면 안 된다. 특히 인간의 카드 이해/체감, 벽·넘어진 말의 화면 반응, 1·5단계 실패 유형, 온라인 두 계정 연결/정산, 실제 소리와 뷰포트는 별도 플레이테스트 대상이다. 물리 상수나 5단계 거대 폰 시점을 현 결과만으로 바꾸지 않는다.

입력/scene 파일은 다른 작업자가 수정 중이므로 이에 의존하는 클래식 취소·브라우저·렌더 검사는 실행하지 않았다. R11의 해당 부분은 그 변경이 안정된 뒤 동일 리비전에서 확인해야 한다. 체크리스트 원본의 `not-run` 표기는 이 파일에서 수정하지 않았다.
