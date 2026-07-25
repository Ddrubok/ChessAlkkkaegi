import { defineConfig } from "vite";

// GitHub Pages는 저장소 이름이 주소에 들어가므로 빌드 결과의 기준 경로를 그에 맞춘다.
const GITHUB_PAGES_BASE = "/ChessAlkkkaegi/";

export default defineConfig(({ command, isPreview }) => ({
  // 개발 서버만 루트에서 열고, 빌드와 빌드 결과 미리보기는 배포와 같은 하위 경로를 쓴다.
  base: command === "build" || isPreview === true ? GITHUB_PAGES_BASE : "/",
  build: {
    rollupOptions: {
      // 게임 배포물에는 루트 진입점만 넣어 개발 전용 변환 도구가 섞이지 않게 한다.
      input: "index.html",
    },
  },
}));
