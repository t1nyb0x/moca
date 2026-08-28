# Moca

VRM / PMX 形式の 3D キャラクターモデルを表示し、そのキャラクターと対話できる Windows デスクトップアプリケーション。LLM の返答内容に応じて、モデルが表情と動作で感情を表現する。

Tauri v2 製。ローカル LLM（Ollama / LM Studio / llama.cpp）および外部 LLM API（Anthropic / OpenAI / Google Gemini）に対応する。

現在は設計フェーズ。要件定義と主要な設計判断は確定済みで、実装は未着手。

## 文書

| 文書 | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要件定義書。機能要件・非機能要件・技術選定の根拠・段階リリース計画 |
| [docs/emotion-protocol.md](docs/emotion-protocol.md) | 感情表現プロトコル仕様。タグ文法、パーサ仕様、表情および音声へのマッピング |
| [docs/architecture.md](docs/architecture.md) | アーキテクチャ概要。レイヤ構成、中核インターフェース、データフロー、拡張ポイント |
| [docs/ipc-contract.md](docs/ipc-contract.md) | Rust コアと WebView フロントの IPC 契約。コマンド、DTO、エラー、呼び出し順序の制約 |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 実装順序。TDD の進め方と各段の完了条件 |
| [docs/adr/](docs/adr/) | アーキテクチャ決定記録。決定ごとに 1 ファイル |

## 段階リリース計画（概要）

| フェーズ | 内容 |
|---|---|
| P0 (MVP) | VRM 表示、モデル非表示・未設定運用、アイドル挙動、チャット、LLM 4 系統、感情タグによる表情反映、疑似リップシンク |
| P1 | PMX 対応、モーションクリップ、ジェスチャ |
| P2 | 音声合成（VOICEVOX / CeVIO AI）と音声駆動リップシンク |
| P3 | 透過デスクトップマスコット |
| P4 | 長期記憶、function calling、複数キャラクター、macOS / Linux |

## 開発環境

**Rust と Node.js は Windows 側に統一する**（[ADR-0006](docs/adr/0006-windows-native-toolchain.md)）。

WSL から `npm install` や `cargo build` を実行してはならない。`/mnt/c` を共有しているため、WSL 側で `npm install` すると esbuild や rollup のネイティブバイナリがプラットフォーム不一致で壊れる。

| 必要なもの | 状態 |
|---|---|
| Visual Studio 2022 + C++ によるデスクトップ開発 | MSVC と Windows SDK が必要 |
| WebView2 Runtime | Windows 11 には標準搭載 |
| Node.js 22 系 (Windows) | |
| Rust `stable-x86_64-pc-windows-msvc` | `winget install Rustlang.Rustup` |

WSL から実行する場合は次の形を用いる。

```
cmd.exe /c "cd /d C:\dev\moca && npm run dev"
```

## 前提

- モデルファイルは同梱しない。利用者が自身で用意したファイルを読み込む
- MMD 向けモデルは再配布・改変・利用目的に制限を課す規約を持つものが多い。利用者は各モデルの規約を確認すること
