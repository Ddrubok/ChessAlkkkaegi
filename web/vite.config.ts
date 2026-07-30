import { defineConfig } from "vite";

const GITHUB_PAGES_BASE = "./";

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview === true ? GITHUB_PAGES_BASE : "/",
  build: {
    rollupOptions: {
      input: "index.html",
    },
  },
}));