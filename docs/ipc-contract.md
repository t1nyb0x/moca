# IPC 契約

- 版: 0.1（初版）
- 作成日: 2026-08-29
- 状態: ドラフト

Rust コアと WebView フロントの境界を定義する。**両側の実装はこの文書のみを参照する。** 一方の都合で片側だけを変更してはならない。

関連: ADR-0002（LLM を Rust に置く）、ADR-0009（Channel によるストリーミング）、ADR-0011（機密の型保護）

---

## 1. 規約

### 1.1 命名

| 対象 | 規約 | 例 |
|---|---|---|
| コマンド名 | `snake_case`、`{名詞}_{動詞}` | `provider_test`、`conversation_get` |
| フィールド名 | Rust は `snake_case`、境界で `camelCase` へ変換 | `input_tokens` → `inputTokens` |

Rust の DTO はすべて `#[serde(rename_all = "camelCase")]` を付ける。

### 1.2 型定義の単一情報源

**Rust 側の DTO 定義を正とする。** TypeScript の型は `ts-rs` クレートによって Rust から生成し、`src/ipc/generated/` へ出力する。手書きで二重管理しない。

生成は `cargo test` で走らせ、生成物の差分が出た状態でのコミットを CI で検出する。これにより Rust 側の変更が TS 側へ反映されないまま進むことを防ぐ。

### 1.3 機密の扱い

**API キーは IPC 境界を越えない。** フロントからバックエンドへ「保存」方向にのみ流れ、読み出し方向には決して流れない（ADR-0011、要件 F-11-3）。

`ProviderProfile` DTO は `apiKey` フィールドを持たない。代わりに `hasApiKey: boolean` を持ち、設定済みか否かだけを伝える。

### 1.4 エラー

すべてのコマンドは失敗時に `CommandError` を返す。

```ts
type CommandError = {
  kind:
    | "auth"            // 401 / 403。キーの誤りまたは失効
    | "rateLimit"       // 429
    | "contextTooLong"  // 入力がモデルの文脈長を超えた
    | "network"         // 接続不能。ローカル LLM 未起動を含む
    | "protocol"        // 想定外のレスポンス形状
    | "server"          // 5xx
    | "notFound"        // 指定 id の資源がない
    | "io"              // ファイル読み書き失敗
    | "invalid";        // 入力値が不正
  message: string;        // ユーザーへ表示してよい文言。機密を含まない
  retryAfterMs?: number;  // rateLimit のときのみ
  status?: number;        // server のときのみ
};
```

`message` は**そのまま UI に出せる日本語**とする。プロバイダの生のエラー文字列をそのまま入れない（キーが反射されている可能性があるため。ADR-0011）。

---

## 2. コマンド一覧

### 2.1 設定

| コマンド | 引数 | 戻り値 |
|---|---|---|
| `settings_get` | — | `Settings` |
| `settings_set` | `settings: Settings` | — |

```ts
type Settings = {
  schemaVersion: number;
  activeCharacterId: string | null;
  logLevel: "info" | "debug";
  lipSyncCharsPerSecond: number;   // 既定 10
  showViewer: boolean;             // 要件 F-02-2
};
```

### 2.2 プロバイダプロファイル

| コマンド | 引数 | 戻り値 |
|---|---|---|
| `providers_list` | — | `ProviderProfile[]` |
| `provider_upsert` | `profile: ProviderProfile`, `apiKey: string \| null` | `ProviderProfile` |
| `provider_delete` | `id: string` | — |
| `provider_test` | `id: string` | `ProviderHealth` |
| `provider_models` | `id: string` | `ModelInfo[]` |

```ts
type ProviderProfile = {
  id: string;
  name: string;
  kind: "openaiCompatible" | "anthropic" | "gemini";
  baseUrl: string;
  model: string;
  hasApiKey: boolean;           // 読み出し専用。キー本体は返さない
  temperature: number | null;
  topP: number | null;
  maxTokens: number;
  emotionMode: "tag" | "off";   // emotion-protocol.md 6.4
  contextBudgetTokens: number | null;  // null なら既定値を用いる
};

type ProviderHealth = {
  ok: boolean;
  latencyMs: number | null;
  detail: string;               // 表示用。成功時はモデル名など
};

type ModelInfo = { id: string; displayName: string | null };
```

`provider_upsert` の `apiKey` に `null` を渡した場合、既存のキーを維持する。空文字を渡した場合はキーを削除する。**この区別を実装で取り違えないこと。**

### 2.3 キャラクタープロファイル

| コマンド | 引数 | 戻り値 |
|---|---|---|
| `characters_list` | — | `CharacterProfile[]` |
| `character_get` | `id: string` | `CharacterProfile` |
| `character_upsert` | `profile: CharacterProfile` | `CharacterProfile` |
| `character_delete` | `id: string` | — |

```ts
type CharacterProfile = {
  id: string;
  name: string;
  modelPath: string | null;             // null はモデル未設定（要件 F-02）
  modelFormat: "vrm" | "pmx" | null;
  systemPrompt: string;
  providerId: string;
  cameraPreset: CameraState | null;
  idleSettings: IdleSettings;
  emotionMapping: EmotionMapping | null;  // VRM は通常 null
  voiceSettings: null;                    // P2 まで常に null
  schemaVersion: number;
  createdAt: string;                      // RFC3339
  updatedAt: string;
};

type CameraState = { position: [number, number, number]; target: [number, number, number] };

type IdleSettings = {
  blink: boolean;
  saccade: boolean;
  lookAt: boolean;
  breath: boolean;
  springBone: boolean;
};
```

### 2.4 会話

| コマンド | 引数 | 戻り値 |
|---|---|---|
| `conversations_index` | `characterId: string \| null` | `ConversationSummary[]` |
| `conversation_get` | `id: string` | `Conversation` |
| `conversation_save` | `conversation: Conversation` | — |
| `conversation_delete` | `id: string` | — |

```ts
type ConversationSummary = {
  id: string; characterId: string; title: string; updatedAt: string; messageCount: number;
};

type Conversation = {
  id: string;
  characterId: string;
  title: string;
  messages: Message[];
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;                 // 感情タグ除去済み。表示に使う
  rawContent: string | null;       // タグを含む原文。assistant のみ
  emotions: EmotionSpan[] | null;  // 再開時の表情復元用
  createdAt: string;
};

type EmotionSpan = { offset: number; emotion: CanonicalEmotion; intensity: number };

type CanonicalEmotion = "neutral" | "happy" | "angry" | "sad" | "relaxed" | "surprised";
```

保存はストリーミング中に行わず、応答完了時および中断時に 1 回だけ行う（ADR-0010）。

### 2.5 モデルファイル

| コマンド | 引数 | 戻り値 |
|---|---|---|
| `model_pick` | — | `ModelHandle \| null` |
| `model_open` | `path: string` | `ModelHandle` |

```ts
type ModelHandle = {
  path: string;
  assetUrl: string;      // convertFileSrc 済みの URL。three.js のローダーへ渡す
  format: "vrm" | "pmx";
  sizeBytes: number;
  oversized: boolean;    // 閾値超過。UI で警告する（要件 R-4）
};
```

**設計上の要点。** モデルファイルの中身を IPC で運ばない。60MB の VRM を base64 で往復させると、メモリと時間の двой払いになる。Rust 側はパスをアセットプロトコルのスコープへ登録し、`convertFileSrc` した URL を返すだけとする。three.js のローダーが WebView 側で直接 HTTP 取得する。

`model_pick` はネイティブのファイルダイアログを開く。`model_open` はドラッグ＆ドロップで得たパス、および前回セッションのパス復元に用いる。いずれも次を検証する。

1. 拡張子が `.vrm` または `.pmx` であること
2. ファイルが存在し読み取れること
3. サイズが閾値以下であること（超過時は `oversized: true` を立てるが、失敗にはしない）
4. **P0 では `.pmx` は `invalid` エラーを返す**（要件 F-01-7。無言で失敗させない）

### 2.6 チャット

| コマンド | 引数 | 戻り値 |
|---|---|---|
| `chat_stream` | `req: ChatStreamRequest`, `onDelta: Channel<ChatDelta>` | `ChatResult` |
| `chat_cancel` | `requestId: string` | — |

```ts
type ChatStreamRequest = {
  requestId: string;        // フロントが採番する UUID
  characterId: string;
  history: Message[];       // 送信対象。窓の切り出しはフロントが行う
  userInput: string;
};

type ChatDelta =
  | { kind: "text"; value: string }
  | { kind: "usage"; inputTokens: number; outputTokens: number };

type ChatResult = {
  stopReason: "endTurn" | "maxTokens" | "cancelled";
  usage: { inputTokens: number; outputTokens: number } | null;
};
```

#### エラー経路を 1 本にする

`chat_stream` は**ストリーム完了まで解決しない async コマンド**とする。

- 正常終了（中断を含む）: `ChatResult` で解決する
- 接続前・接続後を問わず失敗: `CommandError` で棄却する

Channel には `text` と `usage` のみを流し、**エラーを Channel に流さない**。エラー経路が Channel と戻り値の 2 本あると、フロント側で「Channel にエラーが来たが Promise はまだ解決していない」という状態を扱う羽目になる。1 本に統一する。

#### 中断

`chat_cancel(requestId)` は Rust 側の `CancellationToken` を発火させる。`chat_stream` は `stopReason: "cancelled"` で正常解決する。**中断はエラーではない。**

`chat_cancel` は未知の `requestId` に対しても成功を返す（冪等）。既に完了した要求への中断要求が競合で届きうるため。

#### システムプロンプトの構築

`CharacterProfile.systemPrompt` に感情プロトコルのブロックを連結する処理は **Rust 側**で行う（`emotion-protocol.md` 6.2）。フロントは人格定義のみを保持し、プロトコル文言を知らない。プロバイダごとの配置差異（messages 先頭 / トップレベル `system` / `systemInstruction`）はアダプタ内部で吸収する。

`ProviderProfile.emotionMode` が `"off"` のときは連結しない。

---

## 3. グローバルイベント

MVP では使用しない。

継続的な通知はすべて Channel で行う（ADR-0009）。将来 P2 で音声再生の進捗、P3 でウィンドウ状態の変化が必要になった場合に改めて定義する。

---

## 4. 呼び出し順序の制約

| # | 制約 |
|---|---|
| C-1 | `chat_stream` は同一 `characterId` に対して同時に 1 本まで。フロントが送信ボタンを抑止して保証する |
| C-2 | `conversation_save` は `chat_stream` の解決後に呼ぶ。ストリーミング中に呼んではならない |
| C-3 | `model_open` / `model_pick` の戻り値 `assetUrl` は、そのセッション中のみ有効。アプリ再起動後は再取得する |
| C-4 | `provider_delete` は、そのプロバイダを参照する `CharacterProfile` が存在する場合 `invalid` で失敗する |
| C-5 | `settings_set` は全体置換。部分更新ではない。読んで変更して書き戻す |

---

## 5. 変更履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 0.1 | 2026-08-29 | 初版 |
