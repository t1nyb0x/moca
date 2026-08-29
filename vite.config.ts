import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Tauri は固定ポートを要求する。ポートが埋まっていれば黙って別ポートへ
// 逃げるのではなく失敗させる。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust 側の変更で Vite の HMR を走らせない
      ignored: ["**/src-tauri/**"],
    },
  },
});
