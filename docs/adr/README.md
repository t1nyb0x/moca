# アーキテクチャ決定記録 (ADR)

本ディレクトリは moca の設計上の決定を、決定ごとに 1 ファイルで記録する。

各 ADR は「その時点で何を知っていて、なぜそう決めたか」を残すことを目的とする。後から前提が変わった場合、既存の ADR は書き換えず、新しい ADR を起こして旧 ADR を `棄却` または `置換` の状態へ変更する。

## 状態の定義

| 状態 | 意味 |
|---|---|
| 提案 | 検討中。まだ実装の根拠にしてはならない |
| 採択 | 有効。実装はこれに従う |
| 棄却 | 検討したが採用しなかった |
| 置換 | 後続の ADR に置き換えられた。置換先を明記する |

## 一覧

| # | 決定 | 状態 |
|---|---|---|
| [0001](0001-rendering-in-webview.md) | 3D 描画を WebView 側 (three.js) に置く | 採択 |
| [0002](0002-llm-in-rust-core.md) | LLM 通信を Rust コアに置く | 採択 |
| [0003](0003-inline-emotion-tags.md) | 感情表現にインラインタグ方式を用いる | 採択 |
| [0004](0004-vrm-first-pmx-behind-adapter.md) | MVP は VRM のみ。PMX は ModelAdapter の背後に置く | 採択 |
| [0005](0005-pure-controllers-single-applier.md) | モーション制御を純粋関数化し、副作用を MorphApplier に隔離する | 採択 |
| [0006](0006-windows-native-toolchain.md) | ビルドは Windows ネイティブツールチェーンで行う | 採択 |
| [0007](0007-react-with-canvas-outside.md) | フロントエンドは React。3D キャンバスは React の管理外に置く | 採択 |
| [0008](0008-zustand-for-state.md) | 状態管理に Zustand を用いる | 採択 |
| [0009](0009-tauri-channel-for-streaming.md) | ストリーミング IPC に Tauri v2 の Channel を用いる | 採択 |
| [0010](0010-json-conversation-storage.md) | 会話履歴は JSON ファイルで永続化する | 採択 |
| [0011](0011-tracing-and-secret-masking.md) | ロギングは tracing。機密は保存前にマスクする | 採択 |
| [0012](0012-repository-layout.md) | リポジトリ構成を単一パッケージ + src-tauri とする | 採択 |
| [0013](0013-reasoning-separate-from-body.md) | 推論モデルの思考を本文と分けて扱う | 採択 |
| [0014](0014-emotion-synced-to-speech.md) | 感情の切り替えを発話の再生位置に同期させる | 採択 |
| [0015](0015-pmx-via-third-party-loader.md) | PMX の読み込みに第三者ライブラリを用いる | 採択 |
