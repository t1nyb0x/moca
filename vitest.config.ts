import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
