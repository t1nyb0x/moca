import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * レイヤ境界の強制 (ADR-0012)
 *
 * 依存の向きは常に内側 (domain) へ向かう。この規約は書いただけでは
 * 守られないため、機械的に検出する。
 *
 *   ui  ->  app  ->  domain
 *   render      ->  domain
 *   ipc         ->  domain
 */
const OUTER_LAYERS = ["render", "app", "ui", "ipc", "audio"];

const forbid = (groups, message) => ({ group: groups, message });

export default tseslint.config(
  { ignores: ["dist/**", "src-tauri/**", "src/ipc/generated/**", "coverage/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      // 使わない引数は名前の頭に _ を付けて意図を示す。インターフェースを
      // 満たすために受け取るが使わない、という場面がある。
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // --- 開発用のスクリプトは Node で動く ---
  {
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // --- domain: 何にも依存しない純粋ロジック (ADR-0005) ---
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          forbid(["three", "three/**", "@pixiv/**"],
            "domain は three.js に依存してはならない (ADR-0005)"),
          forbid(["react", "react-dom", "react/**", "react-dom/**"],
            "domain は React に依存してはならない (ADR-0012)"),
          forbid(["@tauri-apps/**"],
            "domain は Tauri に依存してはならない (ADR-0012)"),
          forbid(["zustand", "zustand/**"],
            "domain は状態管理に依存してはならない (ADR-0008)"),
          forbid(
            OUTER_LAYERS.flatMap((l) => [`@/${l}/**`, `**/../${l}/**`]),
            "依存の向きは内側へ。domain から上位レイヤを import してはならない (ADR-0012)"),
        ],
      }],
    },
  },

  // --- render: three.js 層。domain のみ参照可 (ADR-0007) ---
  {
    files: ["src/render/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          forbid(["react", "react-dom", "react/**", "react-dom/**"],
            "render は React に依存してはならない。3D キャンバスは React の管理外 (ADR-0007)"),
          forbid(
            ["ui", "app"].flatMap((l) => [`@/${l}/**`, `**/../${l}/**`]),
            "render から ui / app を import してはならない。状態は購読で受け取る (ADR-0008)"),
        ],
      }],
    },
  },

  // --- audio: WebAudio 層。domain のみ参照可 (ADR-0007 と同じ理由) ---
  {
    files: ["src/audio/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          forbid(["react", "react-dom", "react/**", "react-dom/**"],
            "audio は React に依存してはならない。再生は React の管理外"),
          forbid(
            ["ui", "app"].flatMap((l) => [`@/${l}/**`, `**/../${l}/**`]),
            "audio から ui / app を import してはならない (ADR-0008)"),
        ],
      }],
    },
  },

  // --- テストでは制限を緩めない。境界違反はテストからでも検出する ---
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
