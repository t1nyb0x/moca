import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Delta } from "@/ipc/generated/Delta";
import type { ProviderProfileDto } from "@/ipc/generated/ProviderProfileDto";
import type { Settings } from "@/ipc/generated/Settings";
import type { CharacterProfile } from "@/ipc/generated/CharacterProfile";
import type { ChatResult } from "@/ipc/generated/ChatResult";

vi.mock("@/ipc", () => ({
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  providersList: vi.fn(),
  charactersList: vi.fn(),
  conversationGet: vi.fn(),
  conversationSave: vi.fn(),
  chatStream: vi.fn(),
  chatCancel: vi.fn(),
  characterUpsert: vi.fn(),
  modelPick: vi.fn(),
  modelOpen: vi.fn(),
}));

import * as ipc from "@/ipc";
import { createAppStore } from "./store";

const mocked = vi.mocked(ipc);

const settings: Settings = {
  schemaVersion: 1,
  activeCharacterId: "ch1",
  logLevel: "info",
  lipSyncCharsPerSecond: 10,
  showViewer: true,
};

const provider: ProviderProfileDto = {
  id: "p1",
  name: "ローカル",
  kind: "openaiCompatible",
  baseUrl: "http://localhost:11434",
  model: "llama3.2",
  hasApiKey: false,
  temperature: null,
  topP: null,
  maxTokens: 1024,
  emotionMode: "tag",
  contextBudgetTokens: null,
};

const character: CharacterProfile = {
  id: "ch1",
  name: "千奈",
  modelPath: null,
  modelFormat: null,
  systemPrompt: "あなたは倉本千奈です",
  providerId: "p1",
  cameraPreset: null,
  idleSettings: {
    blink: true,
    saccade: true,
    lookAt: true,
    breath: true,
    springBone: true,
  },
  emotionMapping: null,
  schemaVersion: 1,
  createdAt: "2026-08-29T00:00:00Z",
  updatedAt: "2026-08-29T00:00:00Z",
};

const okResult: ChatResult = { stopReason: "endTurn", usage: null };

/** chatStream のモック。与えた差分を順に流してから解決する。 */
function respondWith(chunks: readonly string[], result: ChatResult = okResult): void {
  mocked.chatStream.mockImplementation(async (_request, onDelta) => {
    for (const value of chunks) {
      const delta: Delta = { kind: "text", value };
      onDelta(delta);
    }
    return result;
  });
}

function store() {
  const instance = createAppStore();
  instance.setState({
    settings,
    providers: [provider],
    characters: [character],
    activeCharacterId: "ch1",
  });
  return instance;
}

const handle = {
  path: "C:\\models\\china.vrm",
  format: "vrm" as const,
  sizeBytes: 12_345,
  oversized: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.conversationSave.mockResolvedValue(undefined);
  mocked.chatCancel.mockResolvedValue(undefined);
  mocked.characterUpsert.mockImplementation(async (profile) => profile);
  mocked.settingsSet.mockResolvedValue(undefined);
});

describe("モデル", () => {
  it("選んだモデルを保持し、キャラクターへパスを保存する", async () => {
    mocked.modelPick.mockResolvedValue(handle);
    const instance = store();

    await instance.getState().pickModel();

    expect(instance.getState().model).toEqual(handle);
    expect(mocked.characterUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ modelPath: handle.path, modelFormat: "vrm" }),
    );
  });

  it("ダイアログを閉じたら何も変えない", async () => {
    mocked.modelPick.mockResolvedValue(null);
    const instance = store();

    await instance.getState().pickModel();

    expect(instance.getState().model).toBeNull();
    expect(mocked.characterUpsert).not.toHaveBeenCalled();
  });

  it("選択に失敗したらエラーとして保持する", async () => {
    mocked.modelPick.mockRejectedValue({
      kind: "invalid",
      message: "対応していない形式です",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();

    await instance.getState().pickModel();
    expect(instance.getState().error?.kind).toBe("invalid");
  });

  it("パスから開ける", async () => {
    mocked.modelOpen.mockResolvedValue(handle);
    const instance = store();
    await instance.getState().openModel(handle.path);
    expect(instance.getState().model).toEqual(handle);
  });

  it("読めなければモデル未設定と同じ状態にする", async () => {
    // 会話は続けられるようにする (要件 F-02)
    mocked.modelOpen.mockRejectedValue({
      kind: "io",
      message: "読めません",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();

    await instance.getState().openModel("C:\\missing.vrm");

    expect(instance.getState().model).toBeNull();
    expect(instance.getState().error?.kind).toBe("io");
  });

  it("モデルを外すとパスも消す", async () => {
    mocked.modelOpen.mockResolvedValue(handle);
    const instance = store();
    await instance.getState().openModel(handle.path);

    await instance.getState().clearModel();

    expect(instance.getState().model).toBeNull();
    expect(mocked.characterUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ modelPath: null, modelFormat: null }),
    );
  });

  it("キャラクターが選ばれていなければパスを保存しない", async () => {
    const instance = store();
    instance.setState({ activeCharacterId: null });
    await instance.getState().persistModelPath("C:\\x.vrm");
    expect(mocked.characterUpsert).not.toHaveBeenCalled();
  });

  it("パスの保存に失敗してもエラーとして保持する", async () => {
    mocked.characterUpsert.mockRejectedValue({
      kind: "io",
      message: "書けません",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();
    await instance.getState().persistModelPath("C:\\x.vrm");
    expect(instance.getState().error?.kind).toBe("io");
  });

  it("起動時に前回のモデルを復元する", async () => {
    // 要件 F-01-6
    mocked.settingsGet.mockResolvedValue(settings);
    mocked.providersList.mockResolvedValue([provider]);
    mocked.charactersList.mockResolvedValue([
      { ...character, modelPath: handle.path, modelFormat: "vrm" as const },
    ]);
    mocked.modelOpen.mockResolvedValue(handle);

    const instance = createAppStore();
    await instance.getState().bootstrap();

    expect(mocked.modelOpen).toHaveBeenCalledWith(handle.path);
    expect(instance.getState().model).toEqual(handle);
  });

  it("キャラクターを切り替えるとそのモデルを読み込む", async () => {
    mocked.modelOpen.mockResolvedValue(handle);
    const instance = store();
    instance.setState({
      characters: [
        character,
        { ...character, id: "ch2", modelPath: handle.path, modelFormat: "vrm" as const },
      ],
    });

    await instance.getState().setActiveCharacter("ch2");

    expect(mocked.modelOpen).toHaveBeenCalledWith(handle.path);
  });
});

describe("診断", () => {
  const diagnostics = {
    textureCount: 12,
    expressionNames: ["neutral", "happy", "sad", "aa", "blink"],
    expressibleEmotions: ["neutral", "happy", "sad"] as const,
    rendererName: "ANGLE (NVIDIA)",
  };

  it("モデルの素性を保持する", () => {
    const instance = store();
    instance.getState().setModelDiagnostics(diagnostics);
    expect(instance.getState().modelDiagnostics).toEqual(diagnostics);
  });

  it("モデルを外すと素性も消す", async () => {
    mocked.modelOpen.mockResolvedValue(handle);
    const instance = store();
    await instance.getState().openModel(handle.path);
    instance.getState().setModelDiagnostics(diagnostics);

    await instance.getState().clearModel();

    expect(instance.getState().modelDiagnostics).toBeNull();
  });

  it("感情を手で指定できる", () => {
    // LLM と同じ経路を通すので、これで顔が変われば経路は生きている
    const instance = store();
    instance.getState().previewEmotion("angry");
    expect(instance.getState().emotion).toEqual({
      emotion: "angry",
      intensity: 1,
    });
  });
});

describe("3D ビューの表示切り替え", () => {
  it("設定に保存する", async () => {
    const instance = store();
    await instance.getState().setShowViewer(false);

    expect(instance.getState().showViewer).toBe(false);
    expect(mocked.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ showViewer: false }),
    );
  });

  it("設定が未読込なら保存を試みない", async () => {
    const instance = createAppStore();
    await instance.getState().setShowViewer(false);
    expect(instance.getState().showViewer).toBe(false);
    expect(mocked.settingsSet).not.toHaveBeenCalled();
  });
});

describe("bootstrap", () => {
  it("設定とプロファイルを読み込む", async () => {
    mocked.settingsGet.mockResolvedValue(settings);
    mocked.providersList.mockResolvedValue([provider]);
    mocked.charactersList.mockResolvedValue([character]);

    const instance = createAppStore();
    await instance.getState().bootstrap();

    const state = instance.getState();
    expect(state.settings).toEqual(settings);
    expect(state.providers).toEqual([provider]);
    expect(state.activeCharacterId).toBe("ch1");
  });

  it("失敗してもエラーとして保持する", async () => {
    mocked.settingsGet.mockRejectedValue({
      kind: "io",
      message: "読めません",
      retryAfterMs: null,
      status: null,
    });
    mocked.providersList.mockResolvedValue([]);
    mocked.charactersList.mockResolvedValue([]);

    const instance = createAppStore();
    await instance.getState().bootstrap();
    expect(instance.getState().error?.kind).toBe("io");
  });
});

describe("send", () => {
  it("会話を作り、発言と応答を並べる", async () => {
    respondWith(["ごきげん", "よう"]);
    const instance = store();

    await instance.getState().send("こんにちは");

    const conversation = instance.getState().conversation;
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0]).toMatchObject({
      role: "user",
      content: "こんにちは",
    });
    expect(conversation?.messages[1]).toMatchObject({
      role: "assistant",
      content: "ごきげんよう",
    });
    expect(instance.getState().status).toBe("idle");
  });

  it("会話の題は最初の発言から作る", async () => {
    respondWith(["はい"]);
    const instance = store();
    await instance.getState().send("今日はいい天気ですね");
    expect(instance.getState().conversation?.title).toBe("今日はいい天気ですね");
  });

  it("感情タグを本文から取り除き、感情として保持する", async () => {
    respondWith(["[happy]ごきげんよう。", "[sad]さようなら。"]);
    const instance = store();

    await instance.getState().send("やあ");

    const assistant = instance.getState().conversation?.messages[1];
    expect(assistant?.content).toBe("ごきげんよう。さようなら。");
    expect(assistant?.rawContent).toContain("[happy]");
    expect(assistant?.emotions).toHaveLength(2);
    expect(instance.getState().emotion.emotion).toBe("sad");
  });

  it("発話の断片を順に積む", async () => {
    respondWith(["ごき", "げん", "よう"]);
    const instance = store();
    await instance.getState().send("やあ");
    // リップシンクは追加分だけを消化するので、差分ごとに seq が進む
    expect(instance.getState().speech.seq).toBe(3);
    expect(instance.getState().speech.text).toBe("よう");
  });

  it("保存はストリームの解決後に一度だけ行う", async () => {
    // IPC 契約 C-2
    let savedDuringStream = false;
    mocked.chatStream.mockImplementation(async (_request, onDelta) => {
      onDelta({ kind: "text", value: "あ" });
      savedDuringStream = mocked.conversationSave.mock.calls.length > 0;
      return okResult;
    });

    const instance = store();
    await instance.getState().send("やあ");

    expect(savedDuringStream).toBe(false);
    expect(mocked.conversationSave).toHaveBeenCalledTimes(1);
  });

  it("生成中の送信を受け付けない", async () => {
    // IPC 契約 C-1
    const instance = store();
    let release: (() => void) | undefined;
    mocked.chatStream.mockImplementation(
      () =>
        new Promise<ChatResult>((resolve) => {
          release = () => resolve(okResult);
        }),
    );

    const first = instance.getState().send("ひとつめ");
    await instance.getState().send("ふたつめ");
    expect(mocked.chatStream).toHaveBeenCalledTimes(1);

    release?.();
    await first;
  });

  it("キャラクター未選択なら送らずにエラーにする", async () => {
    const instance = store();
    instance.setState({ activeCharacterId: null });

    await instance.getState().send("やあ");

    expect(mocked.chatStream).not.toHaveBeenCalled();
    expect(instance.getState().error?.kind).toBe("invalid");
  });

  it("空の入力は無視する", async () => {
    const instance = store();
    await instance.getState().send("   ");
    expect(mocked.chatStream).not.toHaveBeenCalled();
  });

  it("履歴は切り出して送る", async () => {
    respondWith(["はい"]);
    const instance = store();

    await instance.getState().send("いちど目");
    await instance.getState().send("にど目");

    const secondCall = mocked.chatStream.mock.calls[1]?.[0];
    expect(secondCall?.userInput).toBe("にど目");
    // 直前のやり取り 2 件が履歴として渡る
    expect(secondCall?.history).toHaveLength(2);
  });

  it("失敗しても送った内容は残す", async () => {
    mocked.chatStream.mockRejectedValue({
      kind: "network",
      message: "接続できません",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();

    await instance.getState().send("やあ");

    const state = instance.getState();
    expect(state.error?.kind).toBe("network");
    expect(state.status).toBe("idle");
    expect(state.conversation?.messages).toHaveLength(1);
    expect(state.conversation?.messages[0]?.content).toBe("やあ");
    expect(mocked.conversationSave).not.toHaveBeenCalled();
  });

  it("応答が空なら助手の発言を足さない", async () => {
    respondWith([]);
    const instance = store();
    await instance.getState().send("やあ");
    expect(instance.getState().conversation?.messages).toHaveLength(1);
  });
});

describe("推論モデル", () => {
  it("思考は本文に混ぜず、進行中として保持する", async () => {
    mocked.chatStream.mockImplementation(async (_request, onDelta) => {
      onDelta({ kind: "reasoning", value: "まず前提を" });
      onDelta({ kind: "reasoning", value: "整理する" });
      onDelta({ kind: "text", value: "ごきげんよう" });
      return okResult;
    });

    const instance = store();
    await instance.getState().send("やあ");

    const assistant = instance.getState().conversation?.messages[1];
    expect(assistant?.content).toBe("ごきげんよう");
    expect(assistant?.rawContent).not.toContain("前提");
  });

  it("思考は発話としても流さない", async () => {
    // リップシンクが思考を喋ってしまわないこと
    mocked.chatStream.mockImplementation(async (_request, onDelta) => {
      onDelta({ kind: "reasoning", value: "考え中" });
      return okResult;
    });

    const instance = store();
    await instance.getState().send("やあ");
    expect(instance.getState().speech.seq).toBe(0);
  });

  it("思考だけで上限に達したら理由を伝える", async () => {
    // 黙って何も起きないと不具合と区別がつかない
    mocked.chatStream.mockImplementation(async (_request, onDelta) => {
      onDelta({ kind: "reasoning", value: "延々と考える" });
      return { stopReason: "maxTokens" as const, usage: null };
    });

    const instance = store();
    await instance.getState().send("やあ");

    const error = instance.getState().error;
    expect(error).not.toBeNull();
    expect(error?.message).toContain("最大トークン数");
    expect(mocked.conversationSave).not.toHaveBeenCalled();
  });

  it("本文が空なら理由を伝える", async () => {
    respondWith([]);
    const instance = store();
    await instance.getState().send("やあ");
    expect(instance.getState().error?.message).toContain("本文を返しませんでした");
  });

  it("中断で本文が空でも文句を言わない", async () => {
    mocked.chatStream.mockResolvedValue({
      stopReason: "cancelled" as const,
      usage: null,
    });
    const instance = store();
    await instance.getState().send("やあ");
    expect(instance.getState().error).toBeNull();
  });

  it("思考の後に本文が来れば保存する", async () => {
    mocked.chatStream.mockImplementation(async (_request, onDelta) => {
      onDelta({ kind: "reasoning", value: "考え" });
      onDelta({ kind: "text", value: "答え" });
      return okResult;
    });
    const instance = store();
    await instance.getState().send("やあ");
    expect(instance.getState().error).toBeNull();
    expect(mocked.conversationSave).toHaveBeenCalledTimes(1);
    expect(instance.getState().thinkingText).toBe("");
  });
});

describe("cancel", () => {
  it("進行中の要求を中断する", async () => {
    const instance = store();
    let capturedRequestId: string | undefined;
    let release: (() => void) | undefined;

    mocked.chatStream.mockImplementation((request, onDelta) => {
      capturedRequestId = request.requestId;
      onDelta({ kind: "text", value: "とちゅ" });
      return new Promise<ChatResult>((resolve) => {
        release = () => resolve({ stopReason: "cancelled", usage: null });
      });
    });

    const pending = instance.getState().send("やあ");
    await instance.getState().cancel();
    expect(mocked.chatCancel).toHaveBeenCalledWith(capturedRequestId);

    release?.();
    await pending;

    // 目に見えていた分は消さない
    const messages = instance.getState().conversation?.messages;
    expect(messages?.[1]?.content).toBe("とちゅ");
    expect(instance.getState().status).toBe("idle");
  });

  it("進行中でなければ何もしない", async () => {
    const instance = store();
    await instance.getState().cancel();
    expect(mocked.chatCancel).not.toHaveBeenCalled();
  });

  it("中断の失敗は表に出さない", async () => {
    const instance = store();
    instance.setState({ requestId: "r1" });
    mocked.chatCancel.mockRejectedValue(new Error("失敗"));
    await instance.getState().cancel();
    expect(instance.getState().error).toBeNull();
  });
});

describe("regenerate", () => {
  it("直前の応答を捨てて送り直す", async () => {
    respondWith(["いちどめ"]);
    const instance = store();
    await instance.getState().send("おはよう");

    respondWith(["にどめ"]);
    await instance.getState().regenerate();

    const messages = instance.getState().conversation?.messages;
    expect(messages).toHaveLength(2);
    expect(messages?.[0]?.content).toBe("おはよう");
    expect(messages?.[1]?.content).toBe("にどめ");
    expect(mocked.chatStream).toHaveBeenCalledTimes(2);
  });

  it("会話が無ければ何もしない", async () => {
    const instance = store();
    await instance.getState().regenerate();
    expect(mocked.chatStream).not.toHaveBeenCalled();
  });

  it("生成中は受け付けない", async () => {
    const instance = store();
    instance.setState({ status: "streaming" });
    await instance.getState().regenerate();
    expect(mocked.chatStream).not.toHaveBeenCalled();
  });
});

describe("会話の読み込み", () => {
  it("保存済みの会話を開ける", async () => {
    const conversation = {
      id: "c1",
      characterId: "ch1",
      title: "むかしの会話",
      messages: [],
      schemaVersion: 1,
      createdAt: "2026-08-29T00:00:00Z",
      updatedAt: "2026-08-29T00:00:00Z",
    };
    mocked.conversationGet.mockResolvedValue(conversation);

    const instance = store();
    await instance.getState().loadConversation("c1");

    expect(instance.getState().conversation).toEqual(conversation);
    expect(instance.getState().emotion.emotion).toBe("neutral");
  });

  it("開けなければエラーとして保持する", async () => {
    mocked.conversationGet.mockRejectedValue({
      kind: "notFound",
      message: "見つかりません",
      retryAfterMs: null,
      status: null,
    });

    const instance = store();
    await instance.getState().loadConversation("none");
    expect(instance.getState().error?.kind).toBe("notFound");
  });
});

describe("会話の切り替え", () => {
  it("新しい会話を始めると状態を初期化する", async () => {
    respondWith(["[happy]はい"]);
    const instance = store();
    await instance.getState().send("やあ");

    instance.getState().newConversation();

    const state = instance.getState();
    expect(state.conversation).toBeNull();
    expect(state.emotion.emotion).toBe("neutral");
  });

  it("設定が未読込なら保存を試みない", async () => {
    const instance = createAppStore();
    await instance.getState().setActiveCharacter("ch1");
    expect(instance.getState().activeCharacterId).toBe("ch1");
    expect(mocked.settingsSet).not.toHaveBeenCalled();
  });

  it("設定の保存に失敗してもエラーとして保持する", async () => {
    mocked.settingsSet.mockRejectedValue({
      kind: "io",
      message: "書けません",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();
    await instance.getState().setActiveCharacter("ch2");
    expect(instance.getState().error?.kind).toBe("io");
  });

  it("キャラクターを切り替えると会話を離す", async () => {
    mocked.settingsSet.mockResolvedValue(undefined);
    respondWith(["はい"]);
    const instance = store();
    await instance.getState().send("やあ");

    await instance.getState().setActiveCharacter("ch2");

    expect(instance.getState().conversation).toBeNull();
    expect(instance.getState().activeCharacterId).toBe("ch2");
    expect(mocked.settingsSet).toHaveBeenCalled();
  });
});
