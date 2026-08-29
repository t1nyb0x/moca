# 実装計画 (P0 / MVP)

- 版: 0.1
- 作成日: 2026-08-29

CLAUDE.md の方針に従い、**テストを先に書く**。各段は「テストが通り、かつ完了条件を満たす」ことで次へ進む。

依存の少ないものから積み上げ、three.js と Tauri という検証しにくい層を最後に置く。**最も壊れやすい感情タグパーサを最初に書く**のは、ここが仕様の中核であり、後段すべてがその出力に依存するためである。

---

## 段 0: 足場

| 作業 | 備考 |
|---|---|
| Windows へ rustup 導入、MSVC ツールチェーン確認 | [ADR-0006](adr/0006-windows-native-toolchain.md) |
| Tauri v2 プロジェクト生成（React + TypeScript + Vite） | |
| ディレクトリ構成の作成 | [ADR-0012](adr/0012-repository-layout.md) |
| ESLint の import 制限を設定 | `domain/` から three / react / @tauri-apps を禁止。**最初に入れる** |
| Vitest / cargo test / カバレッジ設定 | 対象と除外を ADR-0012 のとおりに |
| `.gitignore` | `target/`, `node_modules/`, `dist/` |

**完了条件**: 空のテストが両側で走り、`npm run tauri dev` で白いウィンドウが出る。

---

## 段 1: 感情タグパーサ（フロント / 純粋ロジック）

最初に書く。仕様は `emotion-protocol.md` 第 3 章。

| 作業 |
|---|
| `emotion-protocol.md` 3.7 の必須テストケースをすべて先に書く |
| 分割位置を変えた同一入力が同一イベント列を生む性質のテスト（1 文字ずつ / 2 文字ずつ / 一括） |
| `EmotionTagParser` 実装 |

**完了条件**: チャンク境界ケースを含む全テストが通る。カバレッジ 100%。

---

## 段 2: リップシンクとモーションのロジック（フロント / 純粋ロジック）

three.js に触れない。すべて `(state, t) -> WeightMap` の純粋関数（[ADR-0005](adr/0005-pure-controllers-single-applier.md)）。

| 作業 |
|---|
| カナ → 母音ビセーム写像（`emotion-protocol.md` 第 7 章） |
| `LipSyncController`（消化レート、包絡、句読点で閉口） |
| `BlinkController` / `SaccadeController` / `BreathController`（乱数は seed を state に持つ） |
| `ExpressionController`（感情遷移の補間） |

**完了条件**: 乱数を含む挙動が決定的に再現でき、可動域を超えないことが検証済み。

---

## 段 3: LLM アダプタ（Rust）

| 作業 |
|---|
| `sse.rs`: SSE フレーム分解の共通実装。分割フレーム、空行、不正 UTF-8 境界のテスト |
| `ChatProvider` トレイト、`ChatRequest` / `Delta` / `ProviderError` |
| `Secret` newtype と `Debug` / `Display` の秘匿テスト（[ADR-0011](adr/0011-tracing-and-secret-masking.md)） |
| OpenAI 互換アダプタ + 記録済みフィクスチャのテスト |
| Anthropic アダプタ（`system` はトップレベル、`content_block_delta`） |
| Gemini アダプタ（ロール `model`、`systemInstruction`） |
| `wiremock` による HTTP 結合テスト（認証失敗、429、5xx、途中切断） |

**完了条件**: 3 アダプタがネットワークなしのテストで同一の `Delta` 列を生む。`Secret` が `{:?}` で漏れないことが証明されている。

---

## 段 4: 永続化と機密（Rust）

| 作業 |
|---|
| `SecretStore` トレイト + keyring 実装 + インメモリ実装 |
| 設定 / プロファイル / 会話の JSON 永続化（[ADR-0010](adr/0010-json-conversation-storage.md)） |
| atomic write（一時ファイル + rename）のテスト |
| `schemaVersion` の読み書き |

**完了条件**: 書き込み中断でファイルが壊れないことがテストで示されている。

---

## 段 5: IPC 境界

| 作業 |
|---|
| `ts-rs` による DTO の TS 型生成 |
| `docs/ipc-contract.md` 第 2 章のコマンドを実装 |
| `chat_stream` を Channel で実装、`chat_cancel` と `CancellationToken` |
| フロント側 `ipc/` ラッパ |

**完了条件**: 生成された TS 型が契約書と一致する。中断が `stopReason: "cancelled"` で正常解決する。

---

## 段 6: チャット UI

| 作業 |
|---|
| Zustand ストア（スライス分割、[ADR-0008](adr/0008-zustand-for-state.md)） |
| チャット画面、ストリーミング表示、中断、再生成 |
| プロバイダ設定画面、接続テスト、モデル一覧 |
| エラー表示（`CommandError.kind` ごとの文言） |
| コンテキスト窓の切り出し（直近 20 ターン + トークン予算） |

**完了条件**: **モデル未設定のままチャットが完全に成立する**（要件 F-02-1）。ここで一度動くものになる。

---

## 段 7: 3D ビュー

| 作業 |
|---|
| `Viewer`（シーン、カメラ、フレームループ）と `ViewerHost`（[ADR-0007](adr/0007-react-with-canvas-outside.md)） |
| `ModelAdapter` / `VrmAdapter`（[ADR-0004](adr/0004-vrm-first-pmx-behind-adapter.md)） |
| `MorphApplier`（合成規則、口モーフのリップシンク優先） |
| `model_pick` / `model_open` とアセットプロトコル経由の読み込み |
| VRM 0.x の `surprised` 解決（`emotion-protocol.md` 4.2） |
| カメラ操作、構図プリセット、表示・非表示切り替え |

**完了条件**: VRM が表示され、アイドル挙動が動き、非表示時にフレームループが止まる。

---

## 段 8: 統合

| 作業 |
|---|
| 段 1・2 の出力を `MorphApplier` へ接続。喋りながら表情が変わることの確認 |
| キャラクタープロファイルの保存・切り替え |
| ロギング（tracing + ローテーション） |
| WebdriverIO + tauri-driver のスモークテスト |
| ソフトウェアレンダリング検出と警告（要件 R-3） |
| インストーラ生成（WebView2 ブートストラッパ同梱） |

**完了条件**: 要件定義書 P0 の全項目が満たされている。

---

## 検証の観点

各段の完了時に確認する。

| # | 観点 |
|---|---|
| V-1 | `domain/` が three.js / React / Tauri を import していない（ESLint が保証） |
| V-2 | カバレッジがロジック層で 80% 以上 |
| V-3 | API キーがログ・IPC・WebView のいずれにも現れない |
| V-4 | モデル未設定でも全機能（3D 以外）が動作する |
| V-5 | 感情タグが本文表示に漏れていない |
| V-6 | 中断・再生成でトークンの取り違えが起きない |
