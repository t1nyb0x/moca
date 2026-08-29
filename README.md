# Moca

VRM / PMX 形式の 3D キャラクターモデルを表示し、そのキャラクターと対話できる Windows デスクトップアプリケーション。LLM の返答内容に応じて、モデルが表情と動作で感情を表現する。

Tauri v2 製。ローカル LLM（Ollama / LM Studio / llama.cpp）および外部 LLM API（Anthropic / OpenAI / Google Gemini）に対応する。

現在の版は 0.2.0。VRM の表示、LLM との会話、感情に応じた表情変化まで動作する。
できること・できないことは [ロードマップ](docs/roadmap.md) を参照。

## 文書

| 文書 | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要件定義書。機能要件・非機能要件・技術選定の根拠・段階リリース計画 |
| [docs/emotion-protocol.md](docs/emotion-protocol.md) | 感情表現プロトコル仕様。タグ文法、パーサ仕様、表情および音声へのマッピング |
| [docs/architecture.md](docs/architecture.md) | アーキテクチャ概要。レイヤ構成、中核インターフェース、データフロー、拡張ポイント |
| [docs/ipc-contract.md](docs/ipc-contract.md) | Rust コアと WebView フロントの IPC 契約。コマンド、DTO、エラー、呼び出し順序の制約 |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 実装順序。TDD の進め方と各段の完了条件 |
| [docs/adr/](docs/adr/) | アーキテクチャ決定記録。決定ごとに 1 ファイル |
| [docs/roadmap.md](docs/roadmap.md) | ロードマップ。各版で何ができるようになるか |
| [CHANGELOG.md](CHANGELOG.md) | 変更履歴 |

## 段階リリース計画（概要）

| フェーズ | 内容 |
|---|---|
| P0 (MVP) | VRM 表示、モデル非表示・未設定運用、アイドル挙動、チャット、LLM 4 系統、感情タグによる表情反映、疑似リップシンク |
| P1 | PMX 対応、モーションクリップ、ジェスチャ |
| P2 | 音声合成（VOICEVOX / CeVIO AI）と音声駆動リップシンク |
| P3 | 透過デスクトップマスコット |
| P4 | 長期記憶、function calling、複数キャラクター、macOS / Linux |

## ブランチ運用

配布するアプリなので、**`main` にあるものが利用者の入れられるもの**と一致するようにする。

| ブランチ | 意味 |
|---|---|
| `main` | 最新のリリース。ここにタグを打つ |
| `develop` | 次のリリースへ向けた作業の集積先 |
| `feature/*`, `fix/*`, `docs/*` | 個々の作業。`develop` へ取り込む |

### リリースの手順

**タグは手で打たない。** 版番号を上げて `main` へ取り込めば、あとは自動で
進む。手順から人が抜けるほど取りこぼしが減る。

1. `develop` で版番号を 3 箇所とも上げる
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. `CHANGELOG.md` に変更点を書く
3. `develop` を `main` へ取り込む
4. Release ワークフローが動く
   - 版番号を読み、対応するタグが無ければ打つ
   - 型チェックとテストを通してから NSIS インストーラを作る
   - 下書きのプレリリースとして公開する
5. 内容を確かめて公開する

版番号が 3 箇所で食い違っていると CI が落ちる（`npm run version:check`）。
どれか一つを上げ忘れると、インストーラの版だけが古いといった食い違いが
起きるため。

同じ版のまま `main` へ取り込んだ場合、タグが既にあるのでリリースは動かない。
作り直したいときは Actions から Release を手動で実行し、`force` を有効に
する。

CI は `main` と `develop` への push、およびすべての PR で回る。

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

`cargo` を呼ぶ場合は PATH を明示する。rustup が追加した PATH は新しい
セッションからしか見えないため。

```
cmd.exe /c "set PATH=%USERPROFILE%\.cargo\bin;%PATH% && cd /d C:\dev\moca && cargo test"
```

### 起動方法

| コマンド | フロントの取得元 | 用途 |
|---|---|---|
| `npm run tauri dev` | Vite 開発サーバー（自動起動） | 開発中はこれを使う |
| `npm run tauri build` | 同梱した `dist` | 配布物を作る |
| `npm run tauri build -- --debug --no-bundle` | 同梱した `dist` | 単体起動する実行ファイルだけ欲しいとき |

**`cargo build` で作った `moca.exe` を直接起動してはいけない。** デバッグ
ビルドは `tauri.conf.json` の `devUrl`（`http://localhost:1420`）を見に
いくため、Vite が動いていないと接続エラーの画面になる。これは設定の誤り
ではなく、Tauri の仕様どおりの挙動である。

単体で起動できる実行ファイルが欲しい場合は `tauri build` を使うこと。
`tauri build` は `frontendDist` を同梱するため、開発サーバーを必要と
しない。

起動が成功したかは標準出力で確かめられる。次の 2 行が出れば、WebView が
立ち上がってフロントが IPC に到達している。

```
INFO  moca: データディレクトリ path=...
DEBUG moca::commands: 設定の読み出し
```

### ログ

不具合の調査にはログを使う。保存先はアプリの「診断」パネルに表示される。

```
%LOCALAPPDATA%\io.github.t1nyb0x.moca\logs\moca.YYYY-MM-DD.log
```

日次でローテーションし、7 日ぶんだけ残す。水準は設定の `logLevel`
（`info` / `debug`）で変えられ、次回の起動から効く。環境変数 `RUST_LOG`
があればそちらが優先されるので、設定を書き換えずに一時的に上げられる。

```
cmd.exe /c "set RUST_LOG=moca=debug,info && C:\dev\moca\src-tauri\target\debug\moca.exe"
```

API キーはログに出ない。`Secret` 型が `Debug` と `Display` を秘匿している
ため、構造体ごと出力しても漏れない（ADR-0011）。

### 環境構築でつまずいた点

**ウイルス対策ソフトによる rustup の失敗。** ESET Security が LLVM のリンカ
`ld.lld.exe` を検疫するため、`rustup default stable` が展開直後のファイルを
見失いロールバックする。次のパスを除外設定に追加すること。Defender でも
同種の誤検知が報告されている。

```
%USERPROFILE%\.rustup
%USERPROFILE%\.cargo
C:\dev\moca\src-tauri\target
```

3 つ目はビルド成果物。除外しないとリンクのたびにスキャンされ、ビルドが
遅くなる。

**Visual Studio の C++ ワークロード。** VS 2022 が入っていても、C++ による
デスクトップ開発が未導入だと `link.exe` が無く `cargo build` が失敗する。
GUI の Visual Studio Installer から追加するか、次のコマンドで部品だけを
追加する（要管理者権限）。

```
vs_installer.exe modify ^
  --installPath "C:\Program Files\Microsoft Visual Studio\2022\Community" ^
  --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ^
  --passive --norestart
```

`--wait` を付けると終了コード 87（パラメータが不正）で失敗する。

## 前提

- モデルファイルは同梱しない。利用者が自身で用意したファイルを読み込む
- MMD 向けモデルは再配布・改変・利用目的に制限を課す規約を持つものが多い。利用者は各モデルの規約を確認すること
