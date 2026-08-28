# アーキテクチャ概要

- 版: 0.1（初版）
- 作成日: 2026-08-29
- 状態: ドラフト

要件定義書（`requirements.md`）の第 5 章および第 6 章を、実装に落とせる粒度まで具体化した文書。インターフェースのシグネチャは実装時に調整されうる指針であり、確定仕様ではない。

---

## 1. レイヤ構成

```
┌─ WebView2 (TypeScript) ───────────────────────────────────────┐
│                                                               │
│  ui/            チャット UI、設定画面、モデル読み込み UI          │
│   └─ 依存: app/                                                │
│                                                               │
│  app/           アプリケーション状態、ユースケース               │
│   └─ 依存: domain/, ipc/                                       │
│                                                               │
│  domain/        純粋ロジック（テスト対象の中心）                  │
│   ├─ emotion/   タグパーサ、正規化感情、強度                     │
│   ├─ motion/    各コントローラ（純粋関数）                       │
│   └─ lipsync/   カナ→ビセーム写像、包絡                         │
│   └─ 依存: なし                                                │
│                                                               │
│  render/        three.js 層（テスト対象外）                      │
│   ├─ ModelAdapter 実装（VrmAdapter / PmxAdapter）               │
│   ├─ MorphApplier  重みマップをモデルへ書き込む唯一の場所         │
│   └─ Scene / Camera / Loop                                    │
│   └─ 依存: domain/                                             │
│                                                               │
│  ipc/           Tauri コマンド・イベントの薄いラッパ              │
└───────────────────────────────────────────────────────────────┘
                              ↕ Tauri IPC
┌─ Rust コア ───────────────────────────────────────────────────┐
│                                                               │
│  commands/      Tauri コマンド定義（境界）                       │
│                                                               │
│  llm/           ChatProvider トレイトと 3 アダプタ               │
│   ├─ openai_compat.rs                                         │
│   ├─ anthropic.rs                                             │
│   ├─ gemini.rs                                                │
│   └─ sse.rs      SSE フレーム分解（共通）                        │
│                                                               │
│  tts/           SpeechSynthesizer トレイト（P2）                 │
│   ├─ voicevox.rs                                              │
│   └─ shirataki.rs                                             │
│                                                               │
│  storage/       設定・プロファイル・会話の永続化                  │
│  secret/        SecretStore トレイト（keyring 実装）             │
└───────────────────────────────────────────────────────────────┘
```

**依存の向きは常に内側（domain）へ向かう。** `domain/` は three.js にも Tauri にも依存しない。これが要件定義書 6.6 のテスト戦略を成立させる前提である。

---

## 2. 中核インターフェース

### 2.1 ChatProvider（Rust）

3 プロバイダの差異を吸収する境界。

```rust
pub struct ChatRequest {
    pub system: Option<String>,
    pub messages: Vec<ChatMessage>,   // role は User / Assistant のみ
    pub model: String,
    pub max_tokens: u32,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
}

pub enum Delta {
    Text(String),
    Usage { input_tokens: u32, output_tokens: u32 },
    Done { stop_reason: StopReason },
}

pub enum ProviderError {
    Auth,                    // 401 / 403
    RateLimit { retry_after: Option<Duration> },
    ContextTooLong,
    Network(String),
    Protocol(String),        // 想定外のレスポンス形状
    Server { status: u16, message: String },
}

#[async_trait]
pub trait ChatProvider: Send + Sync {
    async fn stream_chat(
        &self,
        req: ChatRequest,
        cancel: CancellationToken,
    ) -> Result<BoxStream<'static, Result<Delta, ProviderError>>, ProviderError>;

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError>;

    async fn health_check(&self) -> Result<(), ProviderError>;
}
```

実装上の注意:

- `system` の配置はアダプタ内部で決める（OpenAI 互換は messages 先頭、Anthropic はトップレベル `system`、Gemini は `systemInstruction`）
- Gemini アダプタは `Assistant` を `model` へ読み替える
- SSE のフレーム分解は `sse.rs` に共通化し、各アダプタは分解済みのイベントを解釈するだけにする。ここを共通化しないと、チャンク分割起因のバグが 3 箇所に散る
- `CancellationToken` は要件 F-05-3（生成中断）に対応する

### 2.2 SecretStore（Rust）

```rust
pub trait SecretStore: Send + Sync {
    fn set(&self, key_ref: &str, secret: &str) -> Result<(), SecretError>;
    fn get(&self, key_ref: &str) -> Result<Option<String>, SecretError>;
    fn delete(&self, key_ref: &str) -> Result<(), SecretError>;
}
```

本番実装は `keyring` クレート経由で Windows 資格情報マネージャーを用いる。テストではインメモリ実装に差し替える。

**取得した値は Rust プロセス内に留め、IPC で WebView へ渡さない**（要件 F-11-3）。

### 2.3 SpeechSynthesizer（Rust、P2）

```rust
pub struct SpeakStyle {
    pub emotion: CanonicalEmotion,
    pub intensity: f32,
}

#[async_trait]
pub trait SpeechSynthesizer: Send + Sync {
    async fn speakers(&self) -> Result<Vec<SpeakerInfo>, TtsError>;

    /// キャスト・話者が持つ感情成分やスタイルの一覧。
    /// CeVIO はキャストごとに成分が異なり、VOICEVOX は style の一覧となる。
    async fn emotion_axes(&self, speaker: &str) -> Result<Vec<EmotionAxis>, TtsError>;

    /// WAV バイト列を返す。
    async fn synthesize(&self, text: &str, speaker: &str, style: &SpeakStyle)
        -> Result<Vec<u8>, TtsError>;

    async fn health_check(&self) -> Result<(), TtsError>;
}
```

MVP では実装しないが、`SpeakStyle` の型と `emotion_axes` の存在を今の段階で確定させておく。CeVIO と VOICEVOX で感情の表現方法が根本的に異なる（数値成分 対 スタイル選択）ため、この抽象がないと P2 で呼び出し側に分岐が漏れる。詳細は `emotion-protocol.md` 第 5 章。

### 2.4 ModelAdapter（TypeScript）

VRM と PMX の差異を吸収する境界。**MVP では VRM 実装のみを提供するが、インターフェースは初期から定義する。**

```ts
interface ModelAdapter {
  readonly format: "vrm" | "pmx";
  readonly object: THREE.Object3D;

  /** モデルが持つ表情・モーフの名称一覧。マッピング解決に用いる。 */
  availableMorphs(): readonly string[];

  /** 正規化感情がこのモデルで表現可能か。VRM 0.x の surprised 判定などに用いる。 */
  resolveEmotion(emotion: CanonicalEmotion): MorphTarget[] | null;

  /** 毎フレーム呼ぶ。SpringBone や物理演算の更新を含む。 */
  update(deltaSeconds: number): void;

  /** 視線の追従先。 */
  setLookAtTarget(target: THREE.Object3D | null): void;

  dispose(): void;
}

type MorphTarget = { name: string; weight: number };
```

`VrmAdapter` は `@pixiv/three-vrm` を包む。`PmxAdapter`（P1）は `MMDLoader` と `MMDAnimationHelper` を包み、`EmotionMapping` を参照して `resolveEmotion` を実装する。

### 2.5 コントローラ（TypeScript、純粋関数）

**これらは three.js を一切参照しない。** 時刻と状態を受け取り、モーフ重みマップを返すだけ。これによりカバレッジ 80% の達成対象となる。

```ts
type WeightMap = Readonly<Record<string, number>>;

interface Controller<S> {
  /** 副作用を持たない。同じ (state, t) には同じ結果を返す。 */
  evaluate(state: S, elapsedSeconds: number): WeightMap;
  /** 次フレームの状態。乱数は seed として state に含める。 */
  advance(state: S, deltaSeconds: number): S;
}
```

実装するコントローラ:

| コントローラ | 出力するモーフ | 要件 |
|---|---|---|
| `BlinkController` | `blink` | F-04-1 |
| `SaccadeController` | `lookUp` / `lookDown` / `lookLeft` / `lookRight` | F-04-2 |
| `BreathController` | 胸部・脊椎ボーンの回転（モーフではなくボーン変位） | F-04-4 |
| `ExpressionController` | `happy` / `angry` / `sad` / `relaxed` / `surprised` | F-07 |
| `LipSyncController` | `aa` / `ih` / `ou` / `ee` / `oh` | F-08 |

乱数を用いるコントローラ（まばたき、サッケード）は、**乱数生成器を state に含めて決定的にする。** そうしないと単体テストが書けない。

### 2.6 MorphApplier（TypeScript）

各コントローラの `WeightMap` を合成し、`ModelAdapter` へ書き込む**唯一の場所**。

```ts
class MorphApplier {
  apply(adapter: ModelAdapter, maps: readonly WeightMap[]): void;
}
```

合成規則:

1. 各マップを順に合成する（後勝ちではなく、キーごとに最大値を採る）
2. 口モーフについては、リップシンクが有効な間は感情由来の値を抑制する（`emotion-protocol.md` 4.3）
3. 合計重みが 1.0 を超えるキー群がある場合は正規化する

three.js に触れるコードをこのクラスに閉じ込めることで、テスト不能な領域を最小化する。

### 2.7 EmotionTagParser（TypeScript）

```ts
type ParseEvent =
  | { type: "text"; value: string }
  | { type: "emotion"; emotion: CanonicalEmotion; intensity: number };

class EmotionTagParser {
  /** チャンクを与え、確定したイベントを返す。未確定分は内部に保持する。 */
  push(chunk: string): ParseEvent[];
  /** ストリーム終端。保持中のバッファを text として吐き出す。 */
  flush(): ParseEvent[];
  reset(): void;
}
```

仕様は `emotion-protocol.md` 第 3 章に従う。**本プロジェクトで最もテストを厚くすべきクラス。**

---

## 3. 主要なデータフロー

### 3.1 メッセージ送信から表情反映まで

```
[UI] 送信
  │
  ▼
[app] 会話履歴 + システムプロンプト（+ 感情プロトコル追記）から ChatRequest を構築
  │
  ▼  invoke("chat_stream", ...)
[Rust commands] ProviderProfile を解決 → SecretStore から API キー取得
  │
  ▼
[Rust llm] ChatProvider::stream_chat
  │           ├─ アダプタが system の配置・ロール名を変換
  │           └─ sse.rs がフレーム分解 → Delta を生成
  │
  ▼  Tauri event "chat:delta"
[ipc] Delta を受信
  │
  ▼
[domain/emotion] EmotionTagParser.push(chunk)
  │
  ├─ text イベント ──▶ [UI] 逐次表示
  │                 └─▶ [domain/lipsync] LipSyncController へテキスト供給
  │
  └─ emotion イベント ▶ [domain/motion] ExpressionController の目標感情を更新
                                │
                                ▼ 200〜300ms かけて補間
[render] 毎フレーム:
    各 Controller.evaluate() → WeightMap 群
      │
      ▼
    MorphApplier.apply(adapter, maps)
      │
      ▼
    ModelAdapter.update(delta)   ← SpringBone / 物理演算
      │
      ▼
    renderer.render(scene, camera)
```

### 3.2 モデル未設定・非表示時（要件 F-02）

`render/` レイヤ全体が起動しない。`domain/` のコントローラは動作を継続するため、`ExpressionController` の状態は更新され続ける。3D ビューを再表示した時点で現在の感情が反映される（F-02-4）。

レンダリングループは `requestAnimationFrame` ごと停止させ、GPU および CPU を消費しない（F-02-3）。

---

## 4. 拡張ポイント

将来の拡張が既存コードの改変を要さないよう、次の 3 点をインターフェースとして固定する。

| 拡張ポイント | インターフェース | 追加時に書くもの | 該当フェーズ |
|---|---|---|---|
| モデル形式 | `ModelAdapter` | `PmxAdapter` | P1 |
| LLM プロバイダ | `ChatProvider` | 新アダプタ 1 ファイル | 随時 |
| 音声合成 | `SpeechSynthesizer` | `VoicevoxSynthesizer` / `ShiratakiSynthesizer` | P2 |
| リップシンク駆動源 | `LipSyncController` の入力 | テキスト供給 → 振幅供給への差し替え | P2 |

P3 の透過マスコットウィンドウは Tauri のウィンドウ設定の変更が中心であり、上記インターフェースには影響しない。ただし**チャット UI と 3D ビューを別ウィンドウへ分離できる程度には、両者の状態共有を疎にしておく**こと。

---

## 5. 技術スタック（暫定）

| 領域 | 選定 | 備考 |
|---|---|---|
| アプリ基盤 | Tauri v2 | capabilities による権限制御を利用する |
| バックエンド | Rust / tokio / reqwest / serde | Anthropic は Rust 公式 SDK がないため raw HTTP |
| 機密情報 | keyring | Windows 資格情報マネージャー |
| 設定永続化 | tauri-plugin-store | |
| フロントエンド | TypeScript / Vite | フレームワークは未決（U-1） |
| 3D | three.js / @pixiv/three-vrm | PMX は P1 で MMDLoader + ammo.js |
| テスト | cargo test / wiremock / Vitest / WebdriverIO + tauri-driver | |

three.js のバージョンは固定する。`MMDLoader` が `examples/jsm` 配下にあり API 安定性の保証がないため（要件定義書 R-1）、P1 着手時にバージョン更新方針を判断する。

---

## 6. 変更履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 0.1 | 2026-08-29 | 初版 |
