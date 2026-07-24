import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      // 게임 배포물에는 루트 진입점만 넣어 개발 전용 변환 도구가 섞이지 않게 한다.
      input: "index.html",
    },
  },
});
