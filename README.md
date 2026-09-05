# moca

VRM のモデルを読み込んで、LLM と話せる Windows のアプリ。返答に応じて表情が
変わり、声に合わせて口が動く。枠を消して机の上に置けば、ほかの作業をしながら
隣に居させてもいい。

モデルは同梱していない。自分で用意した VRM を読み込む。

## 何ができるか

会話の相手はローカルでも外部の API でもいい。Ollama、LM Studio、llama.cpp と、
OpenAI、Anthropic、Gemini に繋がる。接続先は会話を続けたまま切り替えられるので、
同じ人格のまま返答を比べられる。

表情は、返答に混ぜてもらった感情タグで動く。タグは本文から取り除くので画面には
出ない。声は VOICEVOX と CeVIO AI に対応していて、感情で声色も変わる。手を振る
などの身振りもタグで動かせる。動きはひとつだけ同梱してある。

話していないあいだも、まばたきをして、視線を動かし、呼吸をして、片脚に体重を
預けて立っている。止まっている人形に見えるのがいやだったので、そこは作り込んだ。

0.9 の時点では、長期記憶も複数キャラクターの同時表示も無い。できないことは
[下にまとめてある](#できないこと)。

---

## 動かすのに要るもの

| | |
|---|---|
| Windows 10 バージョン 1809 以降 / Windows 11 (x64) | WebView2 はインストーラに同梱している |
| LLM の接続先 | ローカルで動かすか、API キーを用意する |
| VRM モデル | 自分で用意する。PMX も読めるが実験的な対応 |
| （任意）VOICEVOX または CeVIO AI | 声を出す場合。別のアプリとして起動しておく |
| （任意）VRMA ファイル | 同梱以外の身振りをさせる場合 |

## 入れる

[Releases](https://github.com/t1nyb0x/moca/releases) からインストーラ
（`moca_x.y.z_x64-setup.exe`）を取得して実行する。WebView2 が無い環境では
一緒に入る。

署名を付けていないので、SmartScreen が警告を出す。 「詳細情報」→「実行」で
進められる。気になる場合は、後述の手順で自分でビルドしてほしい。

## 使いはじめる

初回は次の順に進む。接続先とキャラクターを作るまでモデルは開けない。どの
キャラクターにモデルを結び付けるかが決まらないためである。

### 1. 接続先を追加する

「設定」→「接続先を追加」。種別と待ち受け先は[下の表](#接続先を設定する)を参照。
ローカルで動かしている場合は候補ボタンから入れられる。

「接続を確かめる」を押すとモデルの一覧を取り込むので、そこから選ぶ。

### 2. キャラクターを作る

同じ設定画面の「キャラクターを追加」。名前と**人格（システムプロンプト）**を書く。
どんな性格で、どんな話し方をするかを書けばよい。感情タグの説明は moca が自動で
足すので、そこは書かなくてよい。

### 3. モデルを開く

「モデルを開く」から VRM を選ぶ。ウィンドウへ放り込んでもよい。

モデルが無くても会話はできる。顔を出さずに使ってもいい（「3D を隠す」）。

### 4. 話しかける

下の入力欄に書いて Enter。`Shift + Enter` で改行、書いている途中で「中断」、
気に入らなければ「再生成」。

返答に `[happy]` のようなタグが出れば、そこで表情が変わる。うまく出ないときは
「診断」パネルを開く。タグが何度出たかまで見える。

### 5. 机に置く（任意）

「机に置く」を押すと、枠と背景が消えてモデルだけが残る。

| したいこと | やり方 |
|---|---|
| 動かす | モデルを掴んで引く |
| 大きさを変える | ホイールを回す |
| 話しかける | モデルを押すと吹き出しが開く |
| 通常の表示へ戻す | 隅の「戻る」を押す。タスクトレイの「表示を切り替える」でもよい |

描かれていないところは背後のウィンドウを触れる。後ろのアプリを使いながら、
隣に居させられる。

窓を見失ったらタスクトレイのアイコンから呼び戻せる。

---

## もっと使う

### 接続先を設定する

設定の「接続先を追加」から。種別と待ち受け先の対応は次のとおり。

| 接続先 | 種別 | 接続先 URL |
|---|---|---|
| Ollama | OpenAI 互換 | `http://localhost:11434`（既定値） |
| LM Studio | OpenAI 互換 | `http://localhost:1234` |
| llama.cpp server | OpenAI 互換 | `http://localhost:8080` |
| OpenAI | OpenAI 互換 | `https://api.openai.com` |
| Anthropic | Anthropic | `https://api.anthropic.com` |
| Google Gemini | Gemini | `https://generativelanguage.googleapis.com` |

ローカルサーバーの 3 つは、設定画面の候補ボタンからも入れられる。

**入れるのはホストとポートまで。** `/v1/chat/completions` などの経路は送信時
に付く（`src-tauri/src/llm/http.rs` の `chat_url`）。`/v1` まで書くと
`/v1/v1/chat/completions` になって繋がらない。末尾のスラッシュは吸収される。

「接続を確かめる」を押すと `/v1/models` を叩いてモデル一覧を取り込む。取れた
候補から選べば、モデル名を手で書かずに済む。LM Studio は Developer タブから
サーバーを起動しておくこと。ポートを既定から変えている場合はそれに合わせる。

### 音声で読み上げる

合成器は別のアプリなので、先に起動しておく必要がある。

| 合成器 | 既定の待ち受け先 | 準備 |
|---|---|---|
| VOICEVOX | `http://127.0.0.1:50021` | VOICEVOX 本体を起動する |
| CeVIO AI (直接) | 不要 | CeVIO AI 本体を起動する |
| CeVIO AI (shirataki 経由) | `http://127.0.0.1:3000` | CeVIO AI 本体と [shirataki](https://github.com/t1nyb0x/shirataki) を起動する |

設定の「キャラクター」から合成器と待ち受け先を選び、「接続を確かめる」で
話者を取り込む。shirataki は環境変数 `PORT` で待ち受け先を変えられるので、
既定から変えている場合はここも合わせる。

**CeVIO には 2 通りの繋ぎ方がある。**「直接」は同じ機械に入っている CeVIO AI を
COM で直に呼ぶので、ほかに何も起動しなくてよい。そのかわり別の PC の CeVIO は
使えない。合成を別の PC に任せたい場合は shirataki 経由を選ぶ（[ADR-0018](docs/adr/0018-cevio-over-com.md)）。

「感情の割り当てを作る」を押すと、話者が持つ感情成分の名前から既定の
組み合わせを推測する。成分の顔ぶれはキャストごとに違うため、当たらない
感情は声色を変えず抑揚と速さだけで差を出す。感情ごとの値は手で調整できる。

合成器が起動していなければ、その旨が画面に出る。声が出ないだけで会話は
続けられる。

### 身振りをさせる

返答に合わせて体を動かせる。動きは VRMA ファイルとして与える。手を振る
`wave` を同梱している。ほかは利用者が用意して割り当てる。

1. 設定の「キャラクター」→「身振り」で「同梱の身振りを追加」を押す。手持ちの
   VRMA を使う場合は「VRMA を追加」でファイルを選ぶ
2. タグ名を付ける。英小文字だけで書く（`wave`、`bow` など）
3. 保存して設定を閉じ、「診断」を開いて「試す」で動きを確かめる

同梱していても、押すまでは割り当てられない。何も足さなければ、返答も
プロンプトも 0.7 までと変わらない。

同梱するのは自分たちで作った動きだけとする。他人が作ったファイルは、
出来がよくても同梱しない。再配布や改変の条件をファイルごとに抱え込まない
ためである（[ADR-0020](docs/adr/0020-bundle-only-our-own-motions.md)）。

割り当てたタグ名はシステムプロンプトへ自動で書き足される。返答に `[wave]` の
ように出たら、その動きをする。読み上げをしている場合は、その音声に合わせて
始まる。

`[wave:0.5]` のように強さを書くと、動きが小さくなる。

**割り当てが無ければ何も変わらない。** プロンプトにも何も足さない。

同梱の `wave` は自分たちで撮影したモーションを切り出したもの。作り方と、その
ときのコマンドは [`src-tauri/resources/gestures/README.md`](src-tauri/resources/gestures/README.md)
に書いてある。手持ちの VRMA を整えるにも同じ道具が使える。

```
node scripts/vrma-edit.mjs 入力.vrma 出力.vrma --from 4.4 --to 9.3 --bones right-arm
```

切り出し、要る骨だけを残す、震えを均す、速さに頭打ちを設ける、といったことが
できる。**元のファイルは書き換えない。**

試すのは診断パネルで行う。設定は全面を覆うので、そこで動かしてもモデルが
見えない。診断は横に開くため、モデルを見たまま押せる。

診断には割り当てごとに読み込めたかどうかも出る。直近の応答にタグが何度出たかも
分かるので、「モデルがタグを出していない」のか「ファイルを読めていない」のかを
切り分けられる。

| 制限 | 理由 |
|---|---|
| VRM のみ | VRMA は VRM の人型ボーンを前提とする。PMX はボーン名が標準化されていない |
| タグ名は英小文字のみ | 感情タグと同じ文法で拾うため。外れた名前は本文として画面に出る |
| 感情タグと同じ名前は使えない | 感情として先に解決される |
| 表情と視線は動かない | 読み上げ中の口や感情の表情を上書きしないため |
| その場から動かない | マスコット表示は窓をモデルに合わせて詰めており、位置が変わると枠から出る |

詳しくは [ADR-0019](docs/adr/0019-gestures-from-user-vrma.md) を参照。

### 会話を残す

会話は自動で保存される。「会話」を押すと一覧が出て、開き直せる。「新しい会話」で
別の話を始められる。

キャラクターごとに分かれて残るので、人格を変えたい場合はキャラクターを増やす。

---

## 困ったとき

まず「診断」を開く。モデルの素性（ボーンの数、表情の名前、身振りが載ったか）、
表情を手で試すボタン、身振りを試すボタン、ログの保存先が並んでいる。

| 症状 | 見るところ |
|---|---|
| 返答が来ない | 接続先の「接続を確かめる」。ローカルなら本体が起動しているか |
| 表情が変わらない | 診断でタグの回数を見る。0 ならモデル（LLM）がタグを出していない |
| 声が出ない | 合成器を起動しているか。設定の「接続を確かめる」で話者を取り込めるか |
| 身振りが動かない | 診断で読み込めているか。VRM か。タグは英小文字か |
| 表示が重い | 「3D を隠す」。モデルが大きい場合は警告が出る |

それでも分からないときは[ログ](#ログ)を見る。保存先は診断パネルに出ている。
API キーはログに出ないので、そのまま貼って構わない。


---

## できないこと

- PMX は実験的な対応。表示はできるが、表情は手で割り当てる必要があり、
  身振りは当たらない（ボーン名が標準化されていないため）
- 身振りの到達点はモデルによってずれる。腕が低く垂れるモデルでは手も低くなる
- まばたきの抑制は暫定対応（0.4 から持ち越し）
- macOS と Linux には対応していない
- インストーラに署名が無い

できること・できないことの全体像は[ロードマップ](docs/roadmap.md)にある。

## データの置き場

```
%APPDATA%\io.github.t1nyb0x.moca\
├─ settings.json         全体の設定
├─ providers.json        接続先。API キーはここには入らない
├─ characters/{id}.json  キャラクター
└─ conversations/        会話
```

API キーは Windows の資格情報マネージャーへ預けるので、上のファイルには入らない。
ログにも出ない。

## 前提

- モデルファイルは同梱しない。利用者が自身で用意したファイルを読み込む
- MMD 向けモデルは再配布・改変・利用目的に制限を課す規約を持つものが多い。利用者は各モデルの規約を確認すること
- 同梱している身振りは自分たちで作ったもの。他人が作った動きは同梱しない
  （[ADR-0020](docs/adr/0020-bundle-only-our-own-motions.md)）

---

# 開発

Tauri v2 製。画面は React、描画は three.js（[@pixiv/three-vrm](https://github.com/pixiv/three-vrm)）、
LLM と合成器との通信は Rust 側に置いてある。構成は
[docs/architecture.md](docs/architecture.md)、決定の理由は [docs/adr/](docs/adr/) にある。

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

**WSL から `tauri build` を呼ぶ場合。** Tauri CLI が `cargo` を見つけられず
`program not found` で止まることがある。WSL から起動した `powershell.exe` は
Windows の環境変数を WSL を開いた時点のスナップショットで受け取るため、
その後に入れた rustup の `%USERPROFILE%\.cargo\bin` が PATH に載らないため。
`where.exe cargo` が空振りするかどうかで判別できる。PATH を補って呼ぶこと。

```
powershell.exe -NoProfile -Command 'cd C:\dev\moca; $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"; npm run tauri build'
```

外側をシングルクォートにするのは、WSL 側のシェルに `$env:` を展開させない
ため。WSL を開き直してもスナップショットを取り直すので直る。

**ビルド済みアプリを起動したままビルドしない。** `target\release\moca.exe` を
実行中にビルドすると、リンクは通って `target\release\deps\moca.exe` まで
できるが、それを `target\release` へ持ち上げる段で止まる。

```
error: failed to remove file `C:\dev\moca\src-tauri\target\release\moca.exe`

Caused by:
  アクセスが拒否されました。 (os error 5)
```

Windows は実行中の exe を削除できないため。バンドルまで進まないので
`target\release\bundle\nsis` のインストーラも古いまま残り、`release` の
成果物が更新されない。アプリを終了してからビルドし直すこと。

```
powershell.exe -NoProfile -Command 'Get-Process moca -ErrorAction SilentlyContinue | Stop-Process'
```

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
