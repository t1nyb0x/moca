# moca

VRM のモデルを読み込んで、LLM と話せる Windows のアプリです。返答に応じて表情が
変わり、声に合わせて口が動きます。枠を消して机の上に置けば、ほかの作業をしながら
隣に居させておけます。

モデルは同梱していません。お手元の VRM を読み込んでお使いください。

## 何ができるか

会話の相手はローカルでも外部の API でも構いません。Ollama、LM Studio、llama.cpp と、
OpenAI、Anthropic、Gemini に繋がります。接続先は会話を続けたまま切り替えられますので、
同じ人格のまま返答を比べられます。

表情は、返答に混ぜてもらった感情タグで動きます。タグは本文から取り除きますので、
画面には出ません。声は VOICEVOX と CeVIO AI に対応していて、感情で声色も変わります。
手を振るなどの身振りもタグで動かせます。動きはひとつだけ同梱してあります。

話していないあいだも、まばたきをして、視線を動かし、呼吸をして、片脚に体重を
預けて立っています。止まっている人形に見えるのがいやだったので、そこは作り込み
ました。

0.9 の時点では、長期記憶も複数キャラクターの同時表示もありません。できないことは
[下にまとめてあります](#できないこと)。

---

## 動かすのに要るもの

| | |
|---|---|
| Windows 10 バージョン 1809 以降 / Windows 11 (x64) | WebView2 はインストーラに同梱しています |
| LLM の接続先 | ローカルで動かすか、API キーをご用意ください |
| VRM モデル | ご自身で用意してください。PMX も読めますが実験的な対応です |
| （任意）VOICEVOX または CeVIO AI | 声を出す場合に使います。別のアプリとして起動しておいてください |
| （任意）VRMA ファイル | 同梱以外の身振りをさせる場合に使います |

## 入れる

[Releases](https://github.com/t1nyb0x/moca/releases) からインストーラ
（`moca_x.y.z_x64-setup.exe`）を取得して実行してください。WebView2 が無い環境では
一緒に入ります。

署名を付けていませんので、SmartScreen が警告を出します。「詳細情報」→「実行」で
進められます。気になる場合は、後述の手順でご自分でビルドしてください。

## 使いはじめる

初回は次の順に進みます。接続先とキャラクターを作るまでモデルは開けません。どの
キャラクターにモデルを結び付けるかが決まらないためです。

### 1. 接続先を追加する

「設定」→「接続先を追加」と進みます。種別と待ち受け先は[下の表](#接続先を設定する)を
ご覧ください。ローカルで動かしている場合は、候補ボタンから入れられます。

「接続を確かめる」を押すとモデルの一覧を取り込みますので、そこから選びます。

### 2. キャラクターを作る

同じ設定画面の「キャラクターを追加」から。名前と**人格（システムプロンプト）**を
書きます。どんな性格で、どんな話し方をするかを書けば充分です。感情タグの説明は
moca が自動で足しますので、そこは書かなくて構いません。

### 3. モデルを開く

「モデルを開く」から VRM を選びます。ウィンドウへ放り込んでも読み込めます。

モデルが無くても会話はできます。顔を出さずにお使いいただいても構いません
（「3D を隠す」）。

### 4. 話しかける

下の入力欄に書いて Enter を押します。`Shift + Enter` で改行、書いている途中で
止めたければ「中断」、気に入らなければ「再生成」です。

返答に `[happy]` のようなタグが出れば、そこで表情が変わります。うまく出ないときは
「診断」パネルを開いてください。タグが何度出たかまで分かります。

### 5. 机に置く（任意）

「机に置く」を押すと、枠と背景が消えてモデルだけが残ります。

| したいこと | やり方 |
|---|---|
| 動かす | モデルを掴んで引きます |
| 大きさを変える | ホイールを回します |
| 話しかける | モデルを押すと吹き出しが開きます |
| 通常の表示へ戻す | 隅の「戻る」を押します。タスクトレイの「表示を切り替える」でも戻せます |

描かれていないところは、背後のウィンドウを触れます。後ろのアプリを使いながら、
隣に居させておけます。

窓を見失ったときは、タスクトレイのアイコンから呼び戻せます。

---

## もっと使う

### 接続先を設定する

設定の「接続先を追加」から入ります。種別と待ち受け先の対応は次のとおりです。

| 接続先 | 種別 | 接続先 URL |
|---|---|---|
| Ollama | OpenAI 互換 | `http://localhost:11434`（既定値） |
| LM Studio | OpenAI 互換 | `http://localhost:1234` |
| llama.cpp server | OpenAI 互換 | `http://localhost:8080` |
| OpenAI | OpenAI 互換 | `https://api.openai.com` |
| Anthropic | Anthropic | `https://api.anthropic.com` |
| Google Gemini | Gemini | `https://generativelanguage.googleapis.com` |

ローカルサーバーの 3 つは、設定画面の候補ボタンからも入れられます。

**入れるのはホストとポートまでです。** `/v1/chat/completions` などの経路は送信時に
付きます（`src-tauri/src/llm/http.rs` の `chat_url`）。`/v1` まで書くと
`/v1/v1/chat/completions` になって繋がりません。末尾のスラッシュは吸収します。

「接続を確かめる」を押すと `/v1/models` を叩いてモデル一覧を取り込みます。取れた
候補から選べば、モデル名を手で書かずに済みます。LM Studio は Developer タブから
サーバーを起動しておいてください。ポートを既定から変えている場合は、それに合わせ
ます。

### 音声で読み上げる

合成器は別のアプリですので、先に起動しておく必要があります。

| 合成器 | 既定の待ち受け先 | 準備 |
|---|---|---|
| VOICEVOX | `http://127.0.0.1:50021` | VOICEVOX 本体を起動します |
| CeVIO AI (直接) | 不要 | CeVIO AI 本体を起動します |
| CeVIO AI (shirataki 経由) | `http://127.0.0.1:3000` | CeVIO AI 本体と [shirataki](https://github.com/t1nyb0x/shirataki) を起動します |

設定の「キャラクター」から合成器と待ち受け先を選び、「接続を確かめる」で話者を
取り込みます。shirataki は環境変数 `PORT` で待ち受け先を変えられますので、既定から
変えている場合はここも合わせてください。

CeVIO には 2 通りの繋ぎ方があります。「直接」は同じ機械に入っている CeVIO AI を
COM で直に呼びますので、ほかに何も起動しなくて済みます。そのかわり別の PC の CeVIO
は使えません。合成を別の PC に任せたい場合は、shirataki 経由をお選びください
（[ADR-0018](docs/adr/0018-cevio-over-com.md)）。

「感情の割り当てを作る」を押すと、話者が持つ感情成分の名前から既定の組み合わせを
推測します。成分の顔ぶれはキャストごとに違いますので、当たらない感情は声色を変えず、
抑揚と速さだけで差を出します。感情ごとの値は手で調整できます。

合成器が起動していなければ、その旨が画面に出ます。声が出ないだけで、会話は続け
られます。

### 身振りをさせる

返答に合わせて体を動かせます。動きは VRMA ファイルとして与えます。手を振る `wave`
を同梱していますので、ほかの動きが要る場合はご自身で用意して割り当ててください。

1. 設定の「キャラクター」→「身振り」で「同梱の身振りを追加」を押します。手持ちの
   VRMA を使う場合は「VRMA を追加」でファイルを選びます
2. タグ名を付けます。英小文字だけで書いてください（`wave`、`bow` など）
3. 保存して設定を閉じ、「診断」を開いて「試す」で動きを確かめます

同梱していても、押すまでは割り当てられません。何も足さなければ、返答もプロンプトも
0.7 までと変わりません。

同梱するのは自分たちで作った動きだけとしています。他人が作ったファイルは、出来が
よくても同梱しません。再配布や改変の条件をファイルごとに抱え込まないためです
（[ADR-0020](docs/adr/0020-bundle-only-our-own-motions.md)）。

割り当てたタグ名は、システムプロンプトへ自動で書き足されます。返答に `[wave]` の
ように出たら、その動きをします。読み上げをしている場合は、その音声に合わせて
始まります。

`[wave:0.5]` のように強さを書くと、動きが小さくなります。

**割り当てが無ければ何も変わりません。** プロンプトにも何も足しません。

同梱の `wave` は、自分たちで撮影したモーションを切り出したものです。作り方と、その
ときのコマンドは [`src-tauri/resources/gestures/README.md`](src-tauri/resources/gestures/README.md)
に書いてあります。手持ちの VRMA を整えるにも、同じ道具が使えます。

```
node scripts/vrma-edit.mjs 入力.vrma 出力.vrma --from 4.4 --to 9.3 --bones right-arm
```

切り出し、要る骨だけを残す、震えを均す、速さに頭打ちを設ける、といったことができ
ます。**元のファイルは書き換えません。**

試すのは診断パネルで行ってください。設定は全面を覆いますので、そこで動かしても
モデルが見えません。診断は横に開きますから、モデルを見たまま押せます。

診断には、割り当てごとに読み込めたかどうかも出ます。直近の応答にタグが何度出たかも
分かりますので、「モデルがタグを出していない」のか「ファイルを読めていない」のかを
切り分けられます。

| 制限 | 理由 |
|---|---|
| VRM のみ | VRMA は VRM の人型ボーンを前提とします。PMX はボーン名が標準化されていません |
| タグ名は英小文字のみ | 感情タグと同じ文法で拾うためです。外れた名前は本文として画面に出ます |
| 感情タグと同じ名前は使えない | 感情として先に解決されます |
| 表情と視線は動かない | 読み上げ中の口や、感情の表情を上書きしないためです |
| その場から動かない | マスコット表示は窓をモデルに合わせて詰めており、位置が変わると枠から出ます |

詳しくは [ADR-0019](docs/adr/0019-gestures-from-user-vrma.md) をご覧ください。

### 会話を残す

会話は自動で保存されます。「会話」を押すと一覧が出て、開き直せます。「新しい会話」で
別の話を始められます。

キャラクターごとに分かれて残りますので、人格を変えたい場合はキャラクターを増やして
ください。

---

## 困ったとき

まず「診断」を開いてください。モデルの素性（ボーンの数、表情の名前、身振りが載った
かどうか）、表情を手で試すボタン、身振りを試すボタン、ログの保存先が並んでいます。

| 症状 | 見るところ |
|---|---|
| 返答が来ない | 接続先の「接続を確かめる」。ローカルなら本体が起動しているか |
| 表情が変わらない | 診断でタグの回数を見ます。0 ならモデル（LLM）がタグを出していません |
| 声が出ない | 合成器を起動しているか。設定の「接続を確かめる」で話者を取り込めるか |
| 身振りが動かない | 診断で読み込めているか。VRM か。タグは英小文字か |
| 表示が重い | 「3D を隠す」をお試しください。モデルが大きい場合は警告が出ます |

それでも分からないときは[ログ](#ログ)をご覧ください。保存先は診断パネルに出ています。
API キーはログに出ませんので、そのまま貼っていただいて構いません。

---

## できないこと

- PMX は実験的な対応です。表示はできますが、表情は手で割り当てる必要があり、身振り
  は当たりません（ボーン名が標準化されていないためです）
- 身振りの到達点はモデルによってずれます。腕が低く垂れるモデルでは、手も低くなります
- まばたきの抑制は暫定対応です（0.4 から持ち越しています）
- macOS と Linux には対応していません
- インストーラに署名がありません

できること・できないことの全体像は[ロードマップ](docs/roadmap.md)にあります。

## データの置き場

```
%APPDATA%\io.github.t1nyb0x.moca\
├─ settings.json         全体の設定
├─ providers.json        接続先。API キーはここには入らない
├─ characters/{id}.json  キャラクター
└─ conversations/        会話
```

API キーは Windows の資格情報マネージャーへ預けますので、上のファイルには入りません。
ログにも出ません。

## 前提

- モデルファイルは同梱していません。利用者ご自身が用意したファイルを読み込みます
- MMD 向けモデルは、再配布・改変・利用目的に制限を課す規約を持つものが多くあります。
  各モデルの規約をご確認ください
- 同梱している身振りは自分たちで作ったものです。他人が作った動きは同梱しません
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
