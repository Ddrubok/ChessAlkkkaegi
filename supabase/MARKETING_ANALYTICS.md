# 홍보 측정 배포와 운영

2026-10-26 기획서 1.1의 M02 구현. **현재 기본값은 수집 꺼짐**이다. 로컬 코드·SQL 검증과 실제 서비스 배포를 구분한다. 새 분석 서비스나 유료 SDK는 추가하지 않았다.

## 배포 순서

1. 사용할 환경을 확인한다. 개발 웹은 `chessalkkagi-dev.pages.dev` / `eohasrpzjwtzexoogwdt`, 기존 공개 웹은 GitHub Pages / `yoajmckkrpgvcljrffww`다. 서로 다른 프로젝트다.
2. 해당 Supabase 프로젝트의 SQL Editor에서 [202610260001_marketing_events.sql](migrations/202610260001_marketing_events.sql)을 적용한다. 기존 게임 전적이나 물리 규칙은 변경하지 않는다. `setup_dev_project.sql`은 **비어 있는 새 개발 프로젝트용**이므로 운영 DB에 실행하지 않는다.
3. 보관 작업을 확인한다. pg_cron이 이미 설치된 프로젝트에서는 마이그레이션이 매일 삭제 작업을 등록한다. 없으면 Dashboard → Integrations → Cron에서 활성화한 뒤 마이그레이션을 다시 실행하거나, 별도 관리자 스케줄러가 `purge_marketing_events()`를 매일 호출하게 한다. 등록 여부뿐 아니라 실행 성공도 확인한다. [Supabase Cron 공식 문서](https://supabase.com/docs/guides/cron)
4. 아래 개인정보 안내 초안을 실제 운영 방침에 반영하고 Play Console의 데이터 보안 내용을 확인한다. 웹과 앱에 적용되는 실제 SDK 전체를 함께 검토한다.
5. 해당 빌드의 환경 설정에 `VITE_MARKETING_ENABLED=true`를 넣어 다시 빌드한다. 먼저 staging/QA에서 수집을 확인한다. Android 테스트 빌드는 `VITE_MARKETING_ENV=qa`를 지정한다. staging, 개발 서버, 로컬 웹은 development로, 브라우저 자동화는 qa로 분리한다. Poki 빌드에서는 항상 꺼진다.
6. 이벤트 전송·권한·삭제 작업을 확인한 후에만 공개 빌드에 적용한다. 이번 작업에서는 원격 SQL 적용, 공개 배포, Play Console 수정, 광고 집행을 하지 않았다.

```sql
-- 관리자 SQL Editor에서 확인한다. 결과에 개인 계정 연결표를 포함하지 않는다.
select environment, platform, build, name, count(*)
from public.marketing_events
where recorded_at >= now() - interval '1 day'
group by 1, 2, 3, 4 order by 1, 2, 3, 4;

-- pg_cron 설치 후에만 실행한다.
select jobid, jobname, schedule, active from cron.job
where jobname = 'purge_marketing_events_daily';
select status, start_time, end_time from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'purge_marketing_events_daily')
order by start_time desc limit 5;
```

## 무엇을 세는가

| 항목 | 구현 기준 |
|---|---|
| 환경 ID | 브라우저 저장소 또는 앱 설치 환경의 가명 UUID. 사람 수·실제 설치 수와 같지 않음 |
| 세션 | 마지막 유효 조작·게임 활동 후 30분. 짧은 새로고침은 동일 세션. 살아 있는 판은 긴 복귀 후에도 동일 경기 ID로 결과 연결. 최초 세션 여부를 별도 표시 |
| 준비·첫 발사 | 준비 완료, 취소되지 않고 승인된 첫 발사. 처음 한 번의 발사는 연습/퍼즐/정규 모드를 구분 |
| 연습 완료 | 기초/심화 구분. 연습 3:3은 정규 경기 완료에 합산하지 않음 |
| 정규 경기 | AI는 스테이지의 각 판, 친구 대전, 로컬 2인. 로컬 2인은 한 환경으로 셈 |
| 랭크 | 원시 이벤트에 `ranked`로 별도 기록. 이번 홍보의 AI·친구·로컬 정규 경기 집계에서 제외 |
| 정상 결과 | 실제 결과 콜백의 승/패/무. 기권은 별도. 메뉴 이탈·연결 종료 포기는 중단 |
| 종료 미확인 | 종료·중단이 없으면 해당 경기의 마지막 기록부터 24시간 후 미확인. 늦게 도착한 결과가 있으면 재집계 |
| 초대 | 방 코드 준비 또는 계정 초대 전송 성공. 참가는 연결 성공. 재대결은 실제 다음 경기 시작 |
| 경기 ID | 양쪽 같은 원본 ID를 SHA-256으로 변환. 참가 가능한 방 코드와 계정이 들어간 원본 ID는 전송하지 않음 |
| 재시도 | 같은 event_id로 전송. SQL 기본키로 중복 제거. 최대 100개 대기, 한 번에 20개 전송 |
| 유입 | 허용한 UTM source/campaign/content만 기록. 같은 세션 복귀 시 유지. Android 설치 출처는 아직 unknown |

수집 실패는 게임 입력·턴·결과를 기다리게 하지 않는다. 대기 큐가 100개를 넘으면 오래된 이벤트가 빠질 수 있다. 장기 전송 장애의 집계는 완전하다고 판단하지 않는다. 기기 시계가 서버보다 5분 넘게 앞서면 SQL이 해당 배치를 거절한다.

로그인 전후 같은 저장소 ID를 사용하며 서버가 `auth.uid()`를 별도 제한된 연결표에 넣는다. 클라이언트가 보고한 가명 ID는 신원 증명이 아니다. 서로 다른 기기·웹·앱을 임의로 합치지 않는다. 운영자/QA는 qa 또는 development 빌드를 사용한다. 악의적인 봇 전체를 판별하는 부정 방지 시스템은 아니다.

## 집계

관리자가 전체 관찰 기간의 `marketing_events`를 JSON 배열로 내보낸다. 계정 연결표, 비밀키, 세션 토큰은 내보내지 않는다. 이 파일은 공개 저장소에 커밋하지 않는다.

```powershell
node scripts/marketing-metrics.mjs --input "관리자만_보관하는_이벤트.json" --as-of "2026-11-03T00:00:00Z"
node scripts/marketing-metrics.mjs --input "관리자만_보관하는_이벤트.json" --platform android --campaign-source shorts
```

기본 집계는 production만 사용한다. 첫 관측 session_start → 준비 → 첫 정규 경기 시작 → 그 경기의 정상 완료를 분자·분모와 함께 계산한다. 실패한 첫 경기 뒤의 다른 승리를 첫 경기 완료로 바꾸지 않는다. 같은 첫 세션의 다음 경기, KST D1/D7, 아직 24시간이 지나지 않은 진행 중 기록과 종료 미확인 기록을 구분한다. 날짜 전체가 끝나지 않은 D1/D7은 분모에서 제외한다. 캠페인 필터는 처음 유입된 환경의 이후 직접 재방문도 포함한다.

반드시 최초 실행부터 포함하는 내보내기를 사용한다. `session_start.details.first_session=true`인 기록이 없는 환경은 신규 전환·유지율 분모에서 제외한다. 잘린 기간이나 90일 삭제 이후 재방문한 오래된 환경을 신규로 다시 세지 않는다. 원래 최초 실행이 없는 표본 수와 수신 시각이 빠진 자료의 한계를 보고서에 표시한다.

설치 귀속·광고비·설치 후 168시간 관찰은 현재 검증되지 않았다. 집계 도구는 완료당 비용을 `unavailable`로 표시한다. 첫 실행 시간을 설치 시간으로 바꾸어 비용을 계산하지 않는다.

## 개인정보 안내 반영용 초안

다음은 이번 추가 측정에 대한 초안이며, 현재 공개 개인정보처리방침을 덮어쓰지 않았다.

> 게임의 처음 이용 흐름과 중단 지점을 개선하기 위해, 임의로 만든 이용 환경 식별값, 세션·경기 식별값, 게임 버전과 웹/Android 구분, 연습·발사·경기 시작/결과·초대·재대결의 시각과 상태, 허용된 유입 캠페인 표기를 수집합니다. 이메일, 닉네임, 접속 토큰, 참가 가능한 방 코드, 원본 URL의 나머지 매개변수는 이 분석 이벤트에 포함하지 않습니다. 로그인할 때는 같은 기기의 이용 흐름을 연결하기 위한 계정 식별 연결을 별도로 제한하여 보관합니다. 상세 이벤트와 연결 기록은 90일 보관 정책 및 정기 삭제 작업을 적용하며, 접근은 지정한 개발·운영 담당자로 제한합니다. 삭제 요청 경로와 처리 담당자는 서비스의 실제 개인정보처리방침에 명시합니다.

실제 예약 작업의 삭제 지연, 백업 보관 정책과 계정 삭제 요청 처리도 운영 설정과 맞춰 확정해야 한다. 가명 ID는 완전히 익명인 데이터라는 뜻이 아니다. 분석 기능에 사용자 선택권을 제공하지 않는 현재 구조에서 ‘선택 수집’이라고 표시하지 않는다.

Play Console → 앱 콘텐츠 → 데이터 보안에서 **앱 활동/앱 상호작용**, **기기 또는 기타 ID**, 계정 연결 시 **사용자 ID**와 분석 목적을 실제 수집 방식에 맞춰 검토한다. 수집/공유·필수/선택·삭제 요청 여부는 실제 정책을 기준으로 작성한다. 공개 테스트도 데이터 보안 대상이며, 앱이 제어하는 WebView와 SDK의 수집도 포함된다. [Google Play 공식 안내](https://support.google.com/googleplay/android-developer/answer/10787469?hl=ko)

## 재검사

```powershell
cd web
npm run check:marketing
npm run build:staging
```

SQL 검사는 기존 로컬 PGlite 설치 `.orca/sql-check`를 사용한다. 없을 때의 설치 방법은 [기존 Supabase README](README.md)에 있다. 로컬 SQL 검사에는 pg_cron 확장이 없어 실제 예약 실행은 원격 환경에서 별도 확인해야 한다.
