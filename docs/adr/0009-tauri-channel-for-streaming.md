# ADR-0009: ストリーミング IPC に Tauri v2 の Channel を用いる

- 状態: 採択
- 日付: 2026-08-29

## 文脈

ADR-0002 により LLM 通信は Rust 側で行われる。応答はトークン単位で到着し、これを WebView 側へ逐次届ける必要がある（要件 F-05-2）。

Tauri v2 でバックエンドからフロントへ継続的にデータを送る方法は 2 つある。グローバルイベント (`app.emit` / `listen`) と、Channel (`tauri::ipc::Channel<T>`) である。

## 決定

`tauri::ipc::Channel<T>` を用いる。フロント側がコマンド呼び出し時に Channel を渡し、Rust 側がその Channel へ `Delta` を送る。

```rust
#[tauri::command]
async fn chat_stream(
    req: ChatRequestDto,
    on_delta: tauri::ipc::Channel<DeltaDto>,
) -> Result<(), CommandError> { /* ... */ }
```

## 検討した代替案

**グローバルイベント (`emit` / `listen`)。** 採用しない。イベント名がグローバル名前空間を共有するため、複数の要求が同時に走ったときに識別子を自前で付与し、受信側で振り分ける必要がある。本アプリでは、再生成 (要件 F-05-4) と中断 (F-05-3) の組み合わせで「中断した旧要求の遅れて届いたトークン」が発生しうる。Channel は要求ごとに独立しているため、この取り違えが構造的に起こらない。リスナの解除漏れによるリークも避けられる。

## 影響

- 中断 (F-05-3) は、Rust 側の `CancellationToken` を発火させるコマンド (`chat_cancel`) を別途用意して実現する。Channel の破棄だけに頼らない
- Channel に流す `Delta` は IPC 境界を越えるため DTO として serde 定義する。内部型をそのまま公開しない
- コマンドとイベントの一覧は `docs/ipc-contract.md` に定義し、両側の実装がそれを唯一の参照元とする
