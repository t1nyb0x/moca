# ADR-0011: ロギングは tracing。機密は型で保護する

- 状態: 採択
- 日付: 2026-08-29
- 関連: 未決事項 U-8 の解決

## 文脈

LLM 接続の不具合は、ユーザー環境でしか再現しないことが多い（ローカル LLM の設定、プロキシ、モデル固有のレスポンス差異）。診断のためにログが要る。

一方で本アプリは API キーを扱う。要件 F-11-4 はログへの機密混入を禁じている。HTTP のリクエストヘッダやエラーレスポンスをそのまま出力すると、キーが平文でログファイルに残る。

## 決定

- Rust 側は `tracing` + `tracing-subscriber`。ファイル出力は `tracing-appender` による日次ローテーション、保持 7 日
- 出力先はアプリのログディレクトリ。既定レベルは `info`、設定で `debug` へ引き上げ可能
- 機密は **`Secret<String>` newtype** で保持し、`Debug` と `Display` を `"[REDACTED]"` に実装する

```rust
pub struct Secret(String);

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("Secret([REDACTED])")
    }
}
impl fmt::Display for Secret { /* 同上 */ }

impl Secret {
    /// 唯一の取り出し口。呼び出し箇所を grep で監査できるよう明示的に命名する。
    pub fn expose(&self) -> &str { &self.0 }
}
```

## 検討した代替案

**規約でログ出力時にマスクする。** 採用しない。「気をつける」は必ず破られる。特にエラー経路は例外的な書き方になりやすく、`{:?}` でリクエスト構造体ごと出力してしまう事故が起きる。型で塞げば `Debug` 派生が自動的に安全になる。

**ログを出さない。** 採用しない。診断不能なアプリはユーザー環境の問題を解決できない。

## 影響

- `ProviderProfile` など API キーを含みうる構造体は `Secret` をフィールドに持つ。`#[derive(Debug)]` がそのまま安全になる
- `Secret::expose()` の呼び出し箇所は HTTP ヘッダ組み立て 1 箇所に限定する。CI や `/code-review` で `expose()` の増加を監視する
- HTTP レスポンスボディをログへ出す場合も、エラーメッセージにキーが反射されている可能性を考慮し、既知のキー文字列を出力直前に置換する二重防御を入れる
- WebView 側 (`console`) には機密が到達しない（ADR-0002 により API キーが IPC を越えないため）
- ログにユーザーの会話本文を出力しない。既定レベルでは会話内容ではなくメタ情報（トークン数、所要時間、ステータス）のみとする
