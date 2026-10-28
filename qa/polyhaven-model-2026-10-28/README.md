# Poly Haven 체스 기물 교체 결과 — 2026-10-28

## 결과

선택한 1번 **Poly Haven Chess Set / Riley Queen / CC0**를 웹 게임의 6종 기물에 적용했다. 기존 아이보리·차콜 재질과 보드, 기물 높이·바닥 반경·기본 질량을 유지했다. 새 형상으로 충돌체를 다시 생성했으며 기존 Free3D 메시·충돌체는 배포 자산에 사용하지 않았다.

- 원본: <https://polyhaven.com/a/chess_set>
- 이용 조건: <https://polyhaven.com/license>, <https://creativecommons.org/publicdomain/zero/1.0/>
- 원본 및 변환 설명: [assets-source README](../../assets-source/polyhaven-chess/README.md)
- [게임 화면](new-gameplay.png), [로비 이미지](evidence-lobby.png), [맵 미리보기](evidence-map-thumbs.png)

아래 모델 검수는 로컬 작업 시점의 기록이다. Android 웹 자산은 갱신했지만 APK/AAB는 만들지 않았다. 공개 배포·포털 제출은 별도 단계다.

develop 반영 전에는 Git 인덱스에 포함한 파일만 별도 폴더로 추출하고 기존 설치 의존성을 연결해 `npm run build`와 `npm run check:regressions`가 모두 종료 코드 0으로 통과하는 것을 확인했다. 원본 glTF와 물리 메타데이터는 `.gitattributes`에서 LF를 고정해 Windows/Linux 체크아웃의 바이트 해시 차이를 방지한다. 이전 모델과 비교하는 두 QA 스크립트는 변경 전 커밋 `df00d80946c671f93f7dde485f7bfa8679af895f`를 명시한다.

## 실제 변경

1. `web/src/tools/convert-polyhaven.mjs`에서 고정된 공식 glTF/BIN 해시를 확인하고 Pawn/Rook/Knight/Bishop/Queen/King을 재생성한다. 모델은 810,716 → **476,800 bytes**, 약 41% 작아졌다. 렌더링용 텍스처 없이 기존 게임 재질을 사용한다.
2. Knight의 원본 방향을 +90도 보정했다. 게임의 진영별 회전과 충돌체에 동일하게 적용된다. 바닥 평탄화 범위와 바닥 외곽점 개수도 실제 생성값으로 기록한다.
3. 새 충돌체의 부피 차이로 질량이 달라지지 않도록 기물별 `densityScale`을 계산한다. 기존 CSV의 힘·마찰·업그레이드 값은 바꾸지 않았다. 승급·기물 교체·초기화에도 적용한다.
4. 모델·메타데이터·로비 이미지 URL에 내용 해시를 붙여 이전 캐시의 재사용을 막는다. 온라인 ready/resume에는 물리 메타데이터 해시를 포함해 구버전 또는 다른 충돌체와의 혼합 대전을 차단한다. 업데이트 안내는 기존 9개 언어에 추가했다.
5. 로비 JPEG 3개, 맵 WebP 42개, CrazyGames 표지 3개와 실제 플레이 프리뷰 2개를 새로 만들었다. 프리뷰는 실제 AI 테스트 플레이의 연속 16초, 원본 녹화 속도 25fps, 무음이다.

질량 보정은 기존 게임 감각의 급격한 변화를 줄인다. **형상·무게중심·회전 관성은 새 모델을 따르므로 모든 충돌 궤적이 이전과 같다는 뜻은 아니다.**

| 기물 | 보존한 기본 질량 |
|---|---:|
| Pawn | 0.027423 |
| Rook | 0.044274 |
| Knight | 0.066776 |
| Bishop | 0.055475 |
| Queen | 0.080601 |
| King | 0.102715 |

## 검증 결과

| 검사 | 결과 / 범위 |
|---|---|
| 원본 변환 재현 | `convert-polyhaven.mjs --check` 통과. GLB/메타데이터 바이트 일치 |
| 독립 형상 검사 | 6종의 원본 좌표·인덱스·법선·높이·바닥 통계·질량 검사 통과 |
| 실제 Rapier 물리 | 6종 정착, 가장자리 낙하, Pawn–Knight 접촉 검사 통과. 제어 속도를 쓰는 독립 물리 시험이며 플레이 녹화와 구분 |
| 질량·승급·강화 | mass compatibility / balance physics / gameplay regression 통과 |
| 클래식 발사 | classic balance 156회 발사 통과; Queen 150% 강화 발사 검사 통과 |
| 스테이지 | stage headless 통과. 스테이지 30의 32개 기물 정착·생존 확인 |
| 퍼즐 | startup 검사 통과. 전체 퍼즐의 해법·난이도 전수 검증은 아님 |
| 실제 브라우저 입력 | 1920×1080, 1080×1620, 821×462에서 각각 튜토리얼 3단계 완료와 스테이지 발사 3회. 실제 선택·드래그·AI 턴 사용, 게임 상태 강제 변경 없음 |
| 작은 화면 취소 | 취소 버튼 위에서 놓으면 발사되지 않음; 화면 안 드래그에서는 정상 발사 |
| 온라인 | 실제 런타임과 가짜 전송 채널로 동일 버전 턴·해시·복구·재접속·재대결 통과. 구버전/다른 버전 ready·resume 차단 통과 |
| 이미지 | 14개 맵 × 3장, 총 658,180 bytes 규격 검사 통과. 로비·게임 이미지 시각 확인 |
| 빌드 | 일반 웹, staging, Poki, CrazyGames, portable 빌드 완료. TypeScript 검사 통과 |
| 최종 CrazyGames ZIP | 83개 파일, 3,540,817 bytes. 압축 해제한 파일 전체가 최종 dist와 일치. 821×462의 다른 origin iframe에서 시작·설정·튜토리얼·AI 진입 검사 통과, 외부 요청/페이지 오류 없음 |
| Android | `cap copy android` 완료, 패키징 전 웹 자산 해시 일치. 연결 기기의 실제 테스트는 이번에 수행하지 않음 |
| 단일 HTML | 내장 모델·메타·오디오 11개 바이트 일치 및 `file://` 게스트 시작→튜토리얼 모델 표시 확인. 아래 외부 장식 이미지 누락이 있어 완전한 오프라인 배포 검수는 미완료 |

검사 로그 및 JSON은 이 폴더에 보존했다. 브라우저 플레이 기록은 `gameplay-*-preview-results.json`, 작은 화면은 `small/`, 최종 ZIP은 `portal-final-zip-results.json`, 해시 검사는 `artifact-results.json`이다.

## 검사 도중 수정하거나 구분한 사항

- 초기 새 모델은 Queen/King 질량이 약 30~35% 감소했다. 최종 변환 및 런타임 질량 보정으로 해결했다. [초기 독립 리뷰](CONVERSION_REVIEW.md)의 수치는 수정 전 기록이다.
- 초기 Knight가 옆을 향하던 문제와 바닥 메타 통계 오류를 수정하고 변환·이미지·플레이 검사를 다시 했다.
- 기존 stage 검사에 스테이지 12의 배치를 하드코딩한 조건이 있었다. 새 모델의 좁아진 충돌체가 일렬 배치에 맞으므로, 실제 최대 지지 폭으로 기대 배치를 산출하도록 검사를 수정했다. 게임의 배치 로직은 변경하지 않았다.
- 작은 화면 자동화는 180px 드래그가 창 밖으로 나가 실패했다. 90px로 실제 화면 안에서 조작하자 정상 발사했다. 게임 입력 코드는 수정하지 않았다.
- 온라인 직접 실행 검사는 프로젝트의 공용 headless preload를 빠뜨려 Rapier 초기화에 실패했다. 공용 환경을 불러오도록 검사 진입점을 수정했고 전체 검사 통과를 확인했다. [온라인 보고서](ONLINE_COMPATIBILITY.md)
- portable의 외부 preload를 제거하고 boot-language를 인라인으로 포함했다. 정적 검사가 JavaScript 템플릿 문자열을 실제 HTML 요청으로 오인하던 부분도 수정했다. 다만 기존 `assets/cosmetics/classic-frame.webp`는 런타임에서 여전히 외부 파일로 요청된다. 모델 교체와 무관한 오프라인 장식 자산 누락이며 이 파일을 완전한 배포 완료로 표시하지 않는다.

## 최종 파일과 재생성

- CrazyGames 업로드 후보: [ChessAlkkagi-CrazyGames-Basic.zip](../../store-assets/crazygames-basic/ChessAlkkagi-CrazyGames-Basic.zip)
- 자산/권한/미디어: [ASSETS.md](../../store-assets/crazygames-basic/ASSETS.md)
- 패키지 해시: `ef20e31868069e8610e2fedd719bde6da982ae52c91d0aeb9298caa7f2f1811a`
- 모델 해시: `2ee584b125a20ddcf388e4798f28a376f2b2a3a22e8590aec1f96fc71e6f6863`
- 메타데이터 해시: `e386535e27f86a9f4114c566c8e9d3b47706d49e59a2b07544864cf2607d7ce8`

```powershell
# 저장소 루트
node web/src/tools/convert-polyhaven.mjs
node qa/polyhaven-model-2026-10-28/render-shipping-images.mjs --publish
# 맵 이미지 재생성은 IMAGE_REFRESH.md의 capture 명령 사용
cd web
npm run build:crazygames
cd ..
powershell -NoProfile -File store-assets/crazygames-basic/package.ps1
```

## 남은 범위

실제 온라인 사람 대전, Android 기기, 모든 스테이지·퍼즐 완주는 이번 검사 범위에 포함하지 않았다. CrazyGames 계정 내 업로드와 심사는 별도 단계다.

`resource/`, `unity/`, 과거 시네마틱 프로젝트, 날짜별 Google Play 스크린샷과 이전 QA 기록은 원본 보존을 위해 그대로 두었다. **이전 모델이 등장하는 과거 홍보물은 새 출시 자료로 재사용하지 말고 새 모델로 다시 캡처·렌더해야 한다.** 이번에 갱신한 배포본과 CrazyGames 미디어의 범위를 넘어 라이선스 정리가 끝났다고 판단하지 않는다.
