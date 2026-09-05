import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // scripts は同梱物を作るビルド時の道具。角度の符号を機械で確かめる
    // ため、アプリの試験と同じ場所で走らせる。
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      // ADR-0005 / ADR-0012: ロジック層のみを対象とする。
      // three.js と React に触れる層はカバレッジの対象外。
      include: ["src/domain/**", "src/app/**"],
      exclude: ["src/render/**", "src/ui/**", "src/ipc/generated/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
