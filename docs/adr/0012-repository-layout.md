# ADR-0012: リポジトリ構成を単一パッケージ + src-tauri とする

- 状態: 採択
- 日付: 2026-08-29

## 文脈

`domain/`（純粋ロジック）、`render/`（three.js）、`ui/`（React）、`app/`、`ipc/` というレイヤ分割を行う（`docs/architecture.md`）。この分割を npm ワークスペースによる複数パッケージで表現するか、単一パッケージ内のディレクトリで表現するかを決める必要がある。

また ADR-0005 は「依存の向きは常に内側（domain）へ向かう」ことを設計の前提としている。この規約は書いただけでは守られない。

## 決定

**単一の npm パッケージ**とし、レイヤはディレクトリで表現する。

```
moca/
├─ docs/
│  ├─ requirements.md
│  ├─ architecture.md
│  ├─ emotion-protocol.md
│  ├─ ipc-contract.md
│  └─ adr/
├─ src/
│  ├─ domain/          # 純粋ロジック。three.js / React / Tauri を import しない
│  │  ├─ emotion/      # タグパーサ、正規化感情
│  │  ├─ motion/       # 各コントローラ
│  │  └─ lipsync/      # カナ→ビセーム写像
│  ├─ render/          # three.js 層。domain のみ import 可
│  ├─ app/             # Zustand ストア、ユースケース
│  ├─ ipc/             # Tauri コマンド/Channel のラッパ
│  ├─ ui/              # React コンポーネント
│  └─ main.tsx
├─ src-tauri/
│  ├─ src/
│  │  ├─ lib.rs
│  │  ├─ commands/
│  │  ├─ llm/          # ChatProvider と 3 アダプタ、sse.rs
│  │  ├─ tts/          # P2
│  │  ├─ storage/
│  │  └─ secret/
│  ├─ capabilities/
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
└─ vitest.config.ts
```

**依存の向きは ESLint で機械的に強制する。** `no-restricted-imports` の zone 設定により、`domain/` から `three` / `react` / `@tauri-apps/*` / 上位レイヤへの import を禁止する。規約を人の注意力に委ねない。

## 検討した代替案

**npm ワークスペースで `packages/domain`、`packages/render` などに分ける。** 採用しない。パッケージ境界は再利用の単位であり、現時点で `domain/` を他所から使う予定はない。ビルド設定、tsconfig の参照関係、バージョン整合の管理コストが先に発生する。将来 `domain/` を切り出す必要が生じた時点で抽出すればよく、そのときディレクトリ境界がそのままパッケージ境界になる。

**Rust 側をワークスペース分割する。** 採用しない。理由は同じ。`llm/` が独立クレートとして有用になるまでは単一クレートで足りる。

## 影響

- `src/domain/` に対する ESLint の import 制限を初期セットアップの時点で入れる。後から入れると既に違反が積み上がっている
- Vitest のカバレッジ設定で `src/domain/` と `src/app/` を対象、`src/render/` と `src/ui/` を除外とする（ADR-0005）
- Rust 側のカバレッジは `cargo llvm-cov` を用い、`llm/` と `storage/` を対象とする
- `docs/` はコードと同じリポジトリに置き、設計変更とコード変更を同じコミットで追えるようにする
