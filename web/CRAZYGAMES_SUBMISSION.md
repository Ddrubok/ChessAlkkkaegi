# Chess Alkkagi — CrazyGames Basic 제출

확인일: 2026-10-28. 현재 모델의 기술 검수와 파일 준비 결과는 [QA 보고서](../qa/polyhaven-model-2026-10-28/README.md)에 기록한다. **공개 업로드·심사 제출은 아직 하지 않았다.**

## Model clearance

The current build replaces the Free3D Personal Use model with Poly Haven Chess Set by Riley Queen (CC0). Geometry, collider metadata, lobby/map imagery, covers and preview footage have been regenerated. See [current asset provenance](../store-assets/crazygames-basic/ASSETS.md) and [replacement QA](../qa/polyhaven-model-2026-10-28/README.md). The original model permission hold is resolved for this replacement. Historical captures/cinematics are not current submission media.

Developer portal account access, terms acceptance, upload and review have not been completed.

## 빌드 범위

- 기초·고급 튜토리얼, AI 스테이지, 로컬 진행 저장과 기물 연구.
- 계정 로그인, 온라인·주간·퍼즐·로컬 2인 메뉴, 광고, 외부 링크, 자체 마케팅 분석 제외.
- 최초 언어는 영어. 이용자가 설정에서 선택한 언어는 유지.
- SDK 없음. 서버 설정이나 Supabase SQL 추가 작업 불필요.
- 일반 웹·staging·Poki와 구분되는 `crazygames` 모드. develop/main 배포나 Android AAB를 대체하지 않는다.

공식 안내상 Basic은 SDK가 선택 사항이고 수익화를 하지 않는 검증 단계다. SDK 미사용 시 전체 패키지를 최초 다운로드 크기로 계산한다. 실측 파일 수·크기·해시는 [PACKAGE.json](../store-assets/crazygames-basic/PACKAGE.json)에 있다. [Basic 안내](https://docs.crazygames.com/requirements/intro/), [기술 요구사항](https://docs.crazygames.com/requirements/technical/).

## 권한 확인 후 업로드 순서

1. [CrazyGames Developer Portal](https://developer.crazygames.com/)에서 본인 개발자 계정으로 로그인한다. 신규 게임 제출에서 Basic 절차를 따른다. 로그인 이후의 실제 항목 배치는 이 환경에서 확인하지 않았다.
2. `store-assets/crazygames-basic/ChessAlkkagi-CrazyGames-Basic.zip`을 올린다. ZIP 내부 최상위에 `index.html`이 있다. AAB나 소스 전체를 올리지 않는다.
3. 아래 영문 제목·설명·조작법을 입력한다. 검수 범위는 **desktop, landscape, mouse, Chrome/Edge**다. 모바일 지원이나 온라인 멀티플레이를 표시하지 않는다.
4. 같은 폴더의 `cover-landscape.png`(1920×1080), `cover-portrait.png`(800×1200), `cover-square.png`(800×800)를 해당 표지 항목에 지정한다.
5. `preview-landscape.mp4`, `preview-portrait.mp4`를 미리보기 항목에 지정한다. 실제 AI 대전, 정상 속도, 16초, 무음이다. [표지·미리보기 규격](https://docs.crazygames.com/requirements/game-covers/).
6. 포털 안에서 로딩 → Try a shot → 첫 장외 → AI 스테이지 → 메뉴 복귀를 확인한다. 자동 검사 경고와 권리 확인 항목을 해결한 뒤 심사를 제출한다. 업로드만으로 게시 완료가 되지는 않는다.

## Portal copy

**Title:** Chess Alkkagi

**Short description:** Flick chess pieces across a wooden board and knock your opponent's pieces out. Learn the controls in the tutorial, then take on turn-based AI stages.

**Description:**

Chess Alkkagi turns familiar chess pieces into a physics flick game. Pull a piece back, release it, and send it into the opposing formation. Choose the direction and power of each shot, knock enemy pieces off the board, and keep your own pieces in play.

Start with three short tutorial steps, then challenge the AI across ten stages. Learn each piece's abilities in the advanced tutorial and use points earned in solo play for piece research. Progress and settings are saved in your browser when storage is available.

This version is for solo play against the AI. It does not use standard chess move or checkmate rules.

**Controls:** Mouse: in Classic mode, click and drag one of your white pieces backward, then release to launch it in the opposite direction. Pull farther for more power. Use the on-screen tutorial to learn Billiards mode and piece abilities. Open Menu to leave the current match; use Settings to change language and sound.

**Developer notes:** HTML5 / Three.js / Rapier. Basic submission without an SDK, ads, external account login, custom telemetry, or multiplayer. Local progress only. Tested in desktop Chrome and Edge in small landscape iframes. Touch devices, Safari, Chromebook hardware, and the authenticated CrazyGames preview need separate verification.

## 재빌드 / 재생성

프로젝트 루트 기준:

```powershell
cd web
npm run build:crazygames
npm run check:crazygames
cd ..
powershell -NoProfile -File store-assets/crazygames-basic/package.ps1
node store-assets/crazygames-basic/render.mjs
node qa/polyhaven-model-2026-10-28/gameplay.mjs --capture --stage-capture
node qa/polyhaven-model-2026-10-28/gameplay.mjs --capture --stage-capture --portrait
node store-assets/crazygames-basic/encode-previews.mjs
```

렌더는 설치된 Chrome, `.orca/ui-check/node_modules/playwright`, 기존 `films/chess-alkkagi-teaser/node_modules/ffmpeg-static`을 사용한다. 새 패키지나 유료 API를 추가하지 않았다. QA 관찰용 빌드는 `qa/.../observed-dist`에만 생성하며 ZIP에 포함하지 않는다.
