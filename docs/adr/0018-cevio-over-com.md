# ADR-0018: CeVIO AI を COM で直に叩く経路を持つ

- 状態: 採択
- 日付: 2026-09-04
- 関連: 要件 F-12、[ADR-0011](0011-tracing-and-secret-masking.md)、[emotion-protocol.md](../emotion-protocol.md) 第 5 章

## 文脈

0.4 で CeVIO AI に対応したとき、moca は [shirataki](https://github.com/t1nyb0x/shirataki)
という自作の HTTP サーバーを挟んだ。CeVIO の口が .NET の COM であり、Rust から
直に叩けるか分からなかったためである。

その結果、CeVIO で読み上げるには **CeVIO AI 本体と shirataki の 2 つを起動して
おく**必要がある。利用者から「毎回外部サーバーを立ち上げるのが面倒」と挙がった。

CeVIO の口が本当に小さいことは、shirataki の実装を読んで確かめた。

```text
CeVIO.Talk.RemoteService2.ServiceControl2V40 → StartHost(false)
CeVIO.Talk.RemoteService2.Talker2V40         → Cast, Speed, Tone, ToneScale,
                                                Components, AvailableCasts,
                                                OutputWaveToFile(text, path)
```

moca が shirataki に頼んでいるのも 3 つだけである。キャストの一覧、感情成分の
名前、合成。**間に挟んでいるものは、moca にとって薄い。**

実証したところ、Rust から `IDispatch` の遅延束縛で呼べた。実物からキャストの
一覧を取り、感情成分を読み、WAV を書き出すところまで通っている。

## 決定

**shirataki 経由の経路は残したまま、COM で直に叩く経路を足す。** 合成器の選択を
VOICEVOX / CeVIO AI (shirataki 経由) / CeVIO AI (直接) の 3 択にする。

置き換えではない。**COM で叩けるのは CeVIO が同じ機械の上に居る場合だけ**で
ある。shirataki は CeVIO を別の PC で動かせる。手元の非力な機械で moca を動かし、
合成は別の PC に任せる、という使い方はこちらでしか成り立たない。

| 選択肢 | 起動しておくもの | CeVIO の置き場所 |
|---|---|---|
| CeVIO AI (直接) | CeVIO AI のみ | 同じ機械 |
| CeVIO AI (shirataki 経由) | CeVIO AI と shirataki | どこでもよい |

実装は `SpeechSynthesizer` のもう 1 実装として置く。この trait は 0.4 では HTTP
層に置いていたが、HTTP でない実装ができたので `tts` モジュールの直下へ移した。

## 実証で分かったこと

**MTA で入らなければならない。** `COINIT_APARTMENTTHREADED` で初期化すると、
呼び出しが返らない。CeVIO の COM は別プロセスにあるため呼び出しはプロセス間で
受け渡されるが、STA ではその受け渡しに Windows のメッセージ循環が要る。Rust の
スレッドはそれを持たない。実測で 600 秒待っても返らず、`COINIT_MULTITHREADED`
へ変えたら 0.07 秒で返った。CeVIO のプロセス自体は起動していたので、`StartHost`
までは効いており、その次で固まっていた。

**COM の呼び出しは同期で、スレッドに縛られる。** 非同期の文脈から直に呼べない。
`spawn_blocking` の中で `Talker` を作り、その中で使い切って捨てる。`IDispatch`
をスレッドをまたいで持ち回らない。

**音声はファイルにしか出せない。** `OutputWaveToFile` しか無く、バイト列を直に
受け取る口が無い。一時ファイルへ書き、読み、消す。

**`Talker` は設定した感情値を保ち続ける。** これは shirataki 経由でも同じ問題で、
書かなかった成分には前回の値が残る。「嬉しい」で一文読ませた後に「哀しみ」だけ
を送ると、両方が高いまま混ざった声になる。合成のたびに、キャストが持つ成分を
すべて明示して打ち消す。

## 帰結

- CeVIO を同じ機械で動かす利用者は、起動しておくものが 1 つ減る
- 待ち受け先の設定は CeVIO (直接) では意味を持たない。画面から隠す
- COM の呼び出しは実物でしか確かめられない。名前も引数の並びも型情報を持たない
  遅延束縛であり、作り物の相手では思い込みごと通ってしまう。試験は
  `cargo test -- --ignored cevio` で、CeVIO AI を入れた機械でのみ回す
- 単位の変換 (0〜100 で 50 が普通) は 2 経路で共通なので、`tts::cevio` を唯一の
  出どころとし、shirataki 側もそこから使う
- **この経路は Windows と CeVIO AI に縛られる。** moca は既に Windows 専用
  （[ADR-0006](0006-windows-native-toolchain.md)）なので、新たな制約は増えない
