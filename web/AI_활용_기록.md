07-24 ~ 07-25: 프로젝트 초기 세팅

  - chess.fbx 3D 모델 리소스 추가
  - Unity URP 기반 체스 알까기 프로젝트 전체 커밋 (191개 파일)
  - .gitignore 설정

  07-26: 게임 규칙

  - 체스 알까기 핵심 규칙 구현 (chess alkkaegi rule)

  07-29: 조작 + 모바일 빌드

  - 타점 설정을 클래식 모드에도 적용 (input.ts)
  - Capacitor 기반 Android 프로젝트 스캐폴딩 (web/android/)

  07-30: 조작/UI 개선 (input.ts 집중)

  - 클래식 발사 시 마우스로 방향 설정 (+29줄)
  - 기물 선택 UI를 기물 위치로 이동, 선택 후 살짝 옆으로偏移
  - 타점 선택 시 확대 기능 추가 (+23줄)

  07-31: 앱 아이콘 + Android 세팅

  - 앱 아이콘 전 해상도 교체 (mdpi~xxxhdpi)
  - 줌 설정 수정, gradle.properties 추가

  ———

  한줄 요약: Unity→Web 이관 후, input.ts 중심으로 조작감(마우스 조준, 타점 확대, UI 위치) 개선 + Capacitor Android 빌드
  파이프라인 구축.