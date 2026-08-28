# ADR-0008: 状態管理に Zustand を用いる

- 状態: 採択
- 日付: 2026-08-29

## 文脈

アプリケーション状態（会話、現在の感情、プロファイル、接続状態）は次の 3 者から読み書きされる。

1. React コンポーネント（チャット UI、設定画面）
2. **3D ビューのフレームループ**（React の外側。ADR-0007）
3. **IPC 受信ハンドラ**（React の外側。Tauri の Channel コールバック）

つまり状態は React コンポーネントツリーの外から購読できなければならない。

## 決定

Zustand を用いる。

決め手は**フック外から読み書きできること**である。ストアは素のオブジェクトとして存在し、`store.getState()` / `store.subscribe()` が React と無関係に使える。

```ts
// React 内
const messages = useAppStore(s => s.messages);

// フレームループ内（React 外）
const emotion = useAppStore.getState().currentEmotion;

// IPC ハンドラ内（React 外）
useAppStore.getState().appendDelta(chunk);

// 3D ビューへは購読で流す。props ではない
useAppStore.subscribe(s => s.currentEmotion, e => viewer.setEmotion(e));
```

## 検討した代替案

**React Context + useReducer。** 採用しない。Context の値はコンポーネントツリー内でしか読めない。フレームループと IPC ハンドラから状態へ到達するために、ref を経由した抜け道を作ることになり、状態の所在が二重化する。また Context は値が変わるたびに配下を再レンダリングするため、ストリーミング中に毎トークン再描画が走る。

**Redux Toolkit。** 採用しない。ストア外購読は可能だが、この規模には記述量が過大である。

**Jotai / Valtio。** 有力な代替。Valtio のプロキシは命令的な書き換えと相性が良い。ただし購読の粒度が暗黙になるため、フレームループとの境界が読みにくくなる。明示的な `subscribe` を持つ Zustand を採る。

## 影響

- ストアはスライス単位で分割する（`chatSlice` / `characterSlice` / `providerSlice` / `viewerSlice`）
- ストリーミング中の高頻度更新が React の再レンダリングを誘発しないよう、テキストの逐次追記はセレクタの粒度に注意する。必要なら表示中メッセージのみ別ストアに分ける
- `domain/` は Zustand に依存しない。ストアは `app/` 層に置く
