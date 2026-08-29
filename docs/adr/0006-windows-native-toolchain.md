# ADR-0006: ビルドは Windows ネイティブツールチェーンで行う

- 状態: 採択
- 日付: 2026-08-29

## 文脈

開発は WSL2 上の Linux シェルから行うが、配布対象は Windows デスクトップである（要件 4.1）。Tauri の Windows 向けビルドは MSVC ツールチェーン (`x86_64-pc-windows-msvc`) と WebView2 を必要とする。

環境調査の結果は次のとおり。

| 項目 | 状態 |
|---|---|
| Visual Studio 2022 | インストール済み（MSVC 利用可） |
| WebView2 Runtime | 導入済み |
| Node.js (Windows) | v22.10.0 / npm 10.9.0 |
| Rust | WSL・Windows とも未インストール |
| プロジェクト配置 | `C:\dev\moca`（WSL からは `/mnt/c/dev/moca`、9p マウント） |

## 決定

Rust ツールチェーンと Node.js は **Windows 側に統一**する。WSL からは Windows の実行ファイル (`cargo.exe` / `npm.exe`) を呼び出す。

- Rust: Windows へ `rustup` を導入し、既定ツールチェーンを `stable-x86_64-pc-windows-msvc` とする
- Node.js: 既存の Windows 側 v22.10.0 を用いる
- **`npm install` も Windows 側で実行する**

## 検討した代替案

**WSL で開発・テストし、Windows でリリースビルドのみ行う。** 採用しない。決定的な問題は `node_modules` である。Vite が依存する esbuild、rollup、swc などはプラットフォーム固有のネイティブバイナリを `node_modules` 配下へ展開する。WSL で `npm install` した `node_modules` を Windows の `npm run` から使うと、あるいはその逆を行うと、バイナリのプラットフォーム不一致で失敗する。`/mnt/c` を共有している以上、両側から触ると必ず壊れる。

Rust 側も同様に、`target/` を Linux と Windows で共有すると再ビルドが頻発する。

なお、純ロジックの `cargo test` を WSL の Linux ツールチェーンで高速に回す案には利点があるが、rustup を 2 系統管理する運用コストと、`target/` 分離の手当てに見合わない。必要になった時点で再検討する。

**すべて WSL で完結させる（Linux 版 Tauri を作る）。** 採用しない。配布対象が Windows であり、WebView2 と webkit2gtk では WebView の挙動が異なる。開発中に検証している対象が配布物と別物になる。

## 影響

- 実装着手前に Windows へ `rustup` の導入が必要（`winget install Rustlang.Rustup`）。VS 2022 の「C++ によるデスクトップ開発」ワークロード（MSVC + Windows SDK）が入っていることを併せて確認する
- WSL 側から `npm install` / `cargo build` を実行してはならない。この規約を README と CLAUDE.md に明記する
- WSL から実行する場合は `cmd.exe /c "cd /d C:\dev\moca && npm run ..."` の形を用いる
- `/mnt/c` は 9p マウントであり WSL からのファイル走査が遅い。ビルドは Windows ネイティブ側で行われるため NTFS 速度が出る
- `.gitignore` に `target/`、`node_modules/`、`dist/` を含める
