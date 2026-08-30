import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Delta } from "@/ipc/generated/Delta";
import type { ProviderProfileDto } from "@/ipc/generated/ProviderProfileDto";
import type { Settings } from "@/ipc/generated/Settings";
import type { CharacterProfile } from "@/ipc/generated/CharacterProfile";
import type { ChatResult } from "@/ipc/generated/ChatResult";
import { CHAT_EXTRA_WIDTH, DEFAULT_ASPECT, MIN_SCALE } from "@/domain/mascot/window";

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
  conversationsIndex: vi.fn(),
  conversationDelete: vi.fn(),
  ttsSynthesize: vi.fn(),
  ttsEmotionAxes: vi.fn(),
  windowSetMascot: vi.fn(),
  windowSetClickThrough: vi.fn(),
  windowCursorPosition: vi.fn(),
  windowSetSize: vi.fn(),
  windowSize: vi.fn(),
  windowStartDrag: vi.fn(),
  toCommandError: (error: unknown) => error,
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
  backgroundColor: null,
  mascot: false,
  mascotScale: 0.5,
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
  voiceSettings: null,
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
  mocked.conversationsIndex.mockResolvedValue([]);
  mocked.conversationDelete.mockResolvedValue(undefined);
  mocked.windowSetMascot.mockResolvedValue(undefined);
  mocked.windowSetSize.mockResolvedValue(undefined);
  mocked.windowSize.mockResolvedValue({ width: 1100, height: 720 });
  mocked.windowSetClickThrough.mockResolvedValue(undefined);
});

describe("会話の一覧", () => {
  const summary = (id: string, title: string) => ({
    id,
    characterId: "ch1",
    title,
    updatedAt: "2026-08-29T00:00:00Z",
    messageCount: 2,
  });

  it("選択中のキャラクターの分だけ読む", async () => {
    mocked.conversationsIndex.mockResolvedValue([summary("c1", "きのう")]);
    const instance = store();

    await instance.getState().refreshConversations();

    expect(mocked.conversationsIndex).toHaveBeenCalledWith("ch1");
    expect(instance.getState().conversations).toHaveLength(1);
  });

  it("キャラクター未選択なら空にする", async () => {
    const instance = store();
    instance.setState({
      activeCharacterId: null,
      conversations: [summary("c1", "のこり")],
    });

    await instance.getState().refreshConversations();

    expect(instance.getState().conversations).toEqual([]);
    expect(mocked.conversationsIndex).not.toHaveBeenCalled();
  });

  it("読み込みに失敗したらエラーとして保持する", async () => {
    mocked.conversationsIndex.mockRejectedValue({
      kind: "io",
      message: "読めません",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();
    await instance.getState().refreshConversations();
    expect(instance.getState().error?.kind).toBe("io");
  });

  it("削除すると一覧から消える", async () => {
    const instance = store();
    instance.setState({ conversations: [summary("c1", "あ"), summary("c2", "い")] });

    await instance.getState().deleteConversation("c1");

    expect(mocked.conversationDelete).toHaveBeenCalledWith("c1");
    expect(instance.getState().conversations.map((item) => item.id)).toEqual(["c2"]);
  });

  it("開いている会話を削除したら画面も離す", async () => {
    mocked.conversationGet.mockResolvedValue({
      id: "c1",
      characterId: "ch1",
      title: "いま開いている",
      messages: [],
      schemaVersion: 1,
      createdAt: "2026-08-29T00:00:00Z",
      updatedAt: "2026-08-29T00:00:00Z",
    });
    const instance = store();
    await instance.getState().loadConversation("c1");
    instance.setState({ conversations: [summary("c1", "いま開いている")] });

    await instance.getState().deleteConversation("c1");

    expect(instance.getState().conversation).toBeNull();
  });

  it("削除に失敗したら一覧を変えない", async () => {
    mocked.conversationDelete.mockRejectedValue({
      kind: "io",
      message: "消せません",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();
    instance.setState({ conversations: [summary("c1", "あ")] });

    await instance.getState().deleteConversation("c1");

    expect(instance.getState().conversations).toHaveLength(1);
    expect(instance.getState().error?.kind).toBe("io");
  });

  it("応答を保存したら一覧を読み直す", async () => {
    respondWith(["はい"]);
    const instance = store();
    await instance.getState().send("やあ");
    expect(mocked.conversationsIndex).toHaveBeenCalledWith("ch1");
  });

  it("本文が空なら保存しないので読み直しもしない", async () => {
    respondWith([]);
    const instance = store();
    await instance.getState().send("やあ");
    expect(mocked.conversationsIndex).not.toHaveBeenCalled();
  });
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

  it("投下されたモデルを読み込んで保存する", async () => {
    mocked.modelOpen.mockResolvedValue(handle);
    const instance = store();

    await instance.getState().adoptModel(handle.path);

    expect(instance.getState().model).toEqual(handle);
    expect(mocked.characterUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ modelPath: handle.path }),
    );
  });

  it("読めなかったモデルのパスは保存しない", async () => {
    // 開けないパスを覚えても仕方がない
    mocked.modelOpen.mockRejectedValue({
      kind: "invalid",
      message: "対応していない形式です",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();

    await instance.getState().adoptModel("C:\\bad.vrm");

    expect(instance.getState().model).toBeNull();
    expect(mocked.characterUpsert).not.toHaveBeenCalled();
  });

  it("キャラクター未選択なら投下を断る", async () => {
    // 表示はされるのに保存先が無い、という中途半端な状態を作らない
    const instance = store();
    instance.setState({ activeCharacterId: null });

    await instance.getState().adoptModel(handle.path);

    expect(mocked.modelOpen).not.toHaveBeenCalled();
    expect(instance.getState().error?.kind).toBe("invalid");
  });

  it("キャラクター未選択なら選択も断る", async () => {
    const instance = store();
    instance.setState({ activeCharacterId: null });

    await instance.getState().pickModel();

    expect(mocked.modelPick).not.toHaveBeenCalled();
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

  it("マスコット表示で保存されていてもモデルが無ければ通常表示で起動する", async () => {
    // 要件 F-13-9。ここを守らないと、起動した瞬間から操作できないアプリになる
    mocked.settingsGet.mockResolvedValue({ ...settings, mascot: true });
    mocked.providersList.mockResolvedValue([provider]);
    mocked.charactersList.mockResolvedValue([character]); // modelPath は null

    const instance = createAppStore();
    await instance.getState().bootstrap();

    expect(instance.getState().mascot).toBe(false);
    expect(mocked.windowSetMascot).not.toHaveBeenCalledWith(true);
  });

  it("マスコット表示で保存されモデルも復元できれば、その表示で起動する", async () => {
    mocked.settingsGet.mockResolvedValue({ ...settings, mascot: true });
    mocked.providersList.mockResolvedValue([provider]);
    mocked.charactersList.mockResolvedValue([
      { ...character, modelPath: handle.path, modelFormat: "vrm" as const },
    ]);
    mocked.modelOpen.mockResolvedValue(handle);

    const instance = createAppStore();
    await instance.getState().bootstrap();

    expect(instance.getState().mascot).toBe(true);
    expect(mocked.windowSetMascot).toHaveBeenCalledWith(true);
  });

  describe("感情ごとの声の割り当て", () => {
    const voiced: CharacterProfile = {
      ...character,
      voiceSettings: {
        enabled: true,
        kind: "shirataki",
        baseUrl: "http://127.0.0.1:3000",
        speaker: "花隈千冬",
        emotionPresets: {},
      },
    };

    async function boot(active: CharacterProfile) {
      mocked.settingsGet.mockResolvedValue(settings);
      mocked.providersList.mockResolvedValue([provider]);
      mocked.charactersList.mockResolvedValue([active]);
      const instance = createAppStore();
      await instance.getState().bootstrap();
      return instance;
    }

    it("割り当てが空なら成分を取り込んで作る", async () => {
      // 空のままだと成分を一切送らず、合成器側に残った値で読み上げられる
      mocked.ttsEmotionAxes.mockResolvedValue(["嬉しい", "普通", "怒り"]);

      const instance = await boot(voiced);

      expect(mocked.ttsEmotionAxes).toHaveBeenCalledWith(
        "shirataki",
        "http://127.0.0.1:3000",
        "花隈千冬",
      );
      const saved = mocked.characterUpsert.mock.calls[0]?.[0] as CharacterProfile;
      const presets = saved.voiceSettings?.emotionPresets ?? {};
      expect(Object.keys(presets).length).toBeGreaterThan(0);
      expect(presets.happy?.components["嬉しい"]).toBeGreaterThan(0);
      expect(instance.getState().error).toBeNull();
    });

    it("すでに割り当てがあれば触らない", async () => {
      await boot({
        ...voiced,
        voiceSettings: {
          ...voiced.voiceSettings!,
          emotionPresets: { happy: { speaker: null, components: {}, speed: null, pitch: null, intonation: null } },
        },
      });
      expect(mocked.ttsEmotionAxes).not.toHaveBeenCalled();
    });

    it("音声が無効なら触らない", async () => {
      await boot({ ...voiced, voiceSettings: { ...voiced.voiceSettings!, enabled: false } });
      expect(mocked.ttsEmotionAxes).not.toHaveBeenCalled();
    });

    it("成分が取れなくても起動を妨げない", async () => {
      // 合成器が動いていないだけ。会話は成り立つ
      mocked.ttsEmotionAxes.mockRejectedValue({
        kind: "network",
        message: "つながりません",
        retryAfterMs: null,
        status: null,
      });

      const instance = await boot(voiced);

      expect(mocked.characterUpsert).not.toHaveBeenCalled();
      expect(instance.getState().error).toBeNull();
    });
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
    approximatedEmotions: [] as const,
    emotionMorphs: null,
    boneNames: ["左腕", "右腕"],
    adjustedBones: ["左腕", "右腕"],
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

  it("アイドル挙動を切り替えて保存する", async () => {
    // 要件 F-04-6
    const instance = store();
    await instance.getState().setIdleSettings({
      ...character.idleSettings,
      lookAt: false,
    });

    const updated = instance
      .getState()
      .characters.find((item) => item.id === "ch1");
    expect(updated?.idleSettings.lookAt).toBe(false);
    expect(updated?.idleSettings.blink).toBe(true);
    expect(mocked.characterUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        idleSettings: expect.objectContaining({ lookAt: false }),
      }),
    );
  });

  it("キャラクター未選択なら何もしない", async () => {
    const instance = store();
    instance.setState({ activeCharacterId: null });
    await instance.getState().setIdleSettings(character.idleSettings);
    expect(mocked.characterUpsert).not.toHaveBeenCalled();
  });

  it("保存に失敗しても画面には反映したままにする", async () => {
    // 切り替えの手応えを優先する
    mocked.characterUpsert.mockRejectedValue({
      kind: "io",
      message: "書けません",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();
    await instance.getState().setIdleSettings({
      ...character.idleSettings,
      breath: false,
    });

    expect(
      instance.getState().characters.find((item) => item.id === "ch1")
        ?.idleSettings.breath,
    ).toBe(false);
    expect(instance.getState().error?.kind).toBe("io");
  });

  describe("接続先の切り替え", () => {
    const other: ProviderProfileDto = {
      ...provider,
      id: "p2",
      name: "Anthropic",
      kind: "anthropic",
      model: "claude-opus-4",
      emotionMode: "off",
    };

    function withBoth() {
      const instance = store();
      instance.setState({ providers: [provider, other] });
      return instance;
    }

    it("選択中のキャラクターへ保存する", async () => {
      const instance = withBoth();
      await instance.getState().setProvider("p2");

      expect(
        instance.getState().characters.find((item) => item.id === "ch1")?.providerId,
      ).toBe("p2");
      expect(mocked.characterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: "p2" }),
      );
    });

    it("会話を保ったまま切り替える", async () => {
      // これがこの機能の目的。setActiveCharacter と違い会話を作り直さない
      respondWith(["ごきげんよう。"]);
      const instance = withBoth();
      await instance.getState().send("やあ");
      const before = instance.getState().conversation;

      await instance.getState().setProvider("p2");

      expect(instance.getState().conversation).toBe(before);
    });

    it("知らない接続先は無視する", async () => {
      const instance = withBoth();
      await instance.getState().setProvider("p9");
      expect(mocked.characterUpsert).not.toHaveBeenCalled();
    });

    it("キャラクター未選択なら何もしない", async () => {
      const instance = withBoth();
      instance.setState({ activeCharacterId: null });
      await instance.getState().setProvider("p2");
      expect(mocked.characterUpsert).not.toHaveBeenCalled();
    });

    it("保存に失敗しても画面には反映したままにする", async () => {
      // 切り替えの手応えを優先する
      mocked.characterUpsert.mockRejectedValue({
        kind: "io",
        message: "書けません",
        retryAfterMs: null,
        status: null,
      });
      const instance = withBoth();
      await instance.getState().setProvider("p2");

      expect(
        instance.getState().characters.find((item) => item.id === "ch1")?.providerId,
      ).toBe("p2");
      expect(instance.getState().error?.kind).toBe("io");
    });
  });

  describe("マスコット表示", () => {
    /** モデルを読み込んで 3D を出している状態にする。 */
    function shown() {
      const instance = store();
      instance.setState({ model: handle, showViewer: true });
      return instance;
    }

    it("モデルが出ていれば入れる", async () => {
      const instance = shown();
      await instance.getState().setMascot(true);

      expect(instance.getState().mascot).toBe(true);
      expect(mocked.windowSetMascot).toHaveBeenCalledWith(true);
      expect(mocked.windowSetSize).toHaveBeenCalled();
    });

    it("モデルが無ければ入れない", async () => {
      // 全面が透明になり、全面がクリックスルーになる (F-13-1)
      const instance = store();
      instance.setState({ model: null, showViewer: true });

      await instance.getState().setMascot(true);

      expect(instance.getState().mascot).toBe(false);
      expect(mocked.windowSetMascot).not.toHaveBeenCalled();
    });

    it("3D ビューを隠していれば入れない", async () => {
      const instance = store();
      instance.setState({ model: handle, showViewer: false });

      await instance.getState().setMascot(true);

      expect(instance.getState().mascot).toBe(false);
      expect(mocked.windowSetMascot).not.toHaveBeenCalled();
    });

    it("モデルを外すと通常表示へ戻る", async () => {
      // 要件 F-13-10。操作できない窓を残さない
      const instance = shown();
      await instance.getState().setMascot(true);
      vi.clearAllMocks();

      await instance.getState().clearModel();

      expect(instance.getState().mascot).toBe(false);
      expect(mocked.windowSetMascot).toHaveBeenCalledWith(false);
    });

    it("3D ビューを隠すと通常表示へ戻る", async () => {
      const instance = shown();
      await instance.getState().setMascot(true);
      vi.clearAllMocks();

      await instance.getState().setShowViewer(false);

      expect(instance.getState().mascot).toBe(false);
      expect(mocked.windowSetMascot).toHaveBeenCalledWith(false);
    });

    it("戻るときは入る前の大きさへ復元する", async () => {
      mocked.windowSize.mockResolvedValue({ width: 1400, height: 900 });
      const instance = shown();

      await instance.getState().setMascot(true);
      await instance.getState().setMascot(false);

      expect(mocked.windowSetSize).toHaveBeenLastCalledWith(1400, 900);
    });

    it("倍率は範囲へ収めて保存する", async () => {
      const instance = shown();
      await instance.getState().setMascotScale(0);

      expect(instance.getState().settings?.mascotScale).toBe(MIN_SCALE);
      expect(mocked.settingsSet).toHaveBeenCalledWith(
        expect.objectContaining({ mascotScale: MIN_SCALE }),
      );
    });

    it("表示中に倍率を変えると窓も追従する", async () => {
      const instance = shown();
      await instance.getState().setMascot(true);
      vi.clearAllMocks();

      await instance.getState().setMascotScale(0.8);

      expect(mocked.windowSetSize).toHaveBeenCalled();
    });

    it("モデルの縦横比に合わせて窓の横幅が決まる", async () => {
      // 要件 F-13-4。透明なだけの領域を左右に残さない
      const instance = shown();
      instance.setState({ modelAspect: 0.4 });

      await instance.getState().setMascot(true);

      const [width, height] = mocked.windowSetSize.mock.calls[0] ?? [];
      expect(width).toBe(Math.round((height as number) * 0.4));
    });

    it("縦横比が分からなければ既定で組む", async () => {
      const instance = shown();
      instance.setState({ modelAspect: null });

      await instance.getState().setMascot(true);

      const [width, height] = mocked.windowSetSize.mock.calls[0] ?? [];
      expect(width).toBe(Math.round((height as number) * DEFAULT_ASPECT));
    });

    it("モデルを測り終えたら窓を合わせ直す", async () => {
      // 起動時はモデルを測る前に窓を組むため、既定の縦横比で出来ている
      const instance = shown();
      await instance.getState().setMascot(true);
      vi.clearAllMocks();

      instance.getState().setModelAspect(0.35);

      const [width, height] = mocked.windowSetSize.mock.calls[0] ?? [];
      expect(width).toBe(Math.round((height as number) * 0.35));
    });

    it("表示していなければ測り直しても窓は触らない", async () => {
      const instance = shown();
      instance.getState().setModelAspect(0.35);
      expect(mocked.windowSetSize).not.toHaveBeenCalled();
    });

    it("吹き出しを開くと窓が広がる", async () => {
      // 窓はモデルの幅ぴったりなので、話すには広げるしかない (要件 F-13-8)
      const instance = shown();
      await instance.getState().setMascot(true);
      const closed = mocked.windowSetSize.mock.calls[0]?.[0] as number;
      vi.clearAllMocks();

      await instance.getState().setMascotChat(true);

      expect(instance.getState().mascotChat).toBe(true);
      expect(mocked.windowSetSize).toHaveBeenCalledWith(
        closed + CHAT_EXTRA_WIDTH,
        expect.any(Number),
      );
    });

    it("吹き出しを閉じると窓も戻る", async () => {
      const instance = shown();
      await instance.getState().setMascot(true);
      const closed = mocked.windowSetSize.mock.calls[0]?.[0] as number;
      await instance.getState().setMascotChat(true);
      vi.clearAllMocks();

      await instance.getState().setMascotChat(false);

      expect(mocked.windowSetSize).toHaveBeenCalledWith(closed, expect.any(Number));
    });

    it("マスコット表示でなければ吹き出しは開かない", async () => {
      const instance = shown();
      await instance.getState().setMascotChat(true);
      expect(instance.getState().mascotChat).toBe(false);
      expect(mocked.windowSetSize).not.toHaveBeenCalled();
    });

    it("通常表示へ戻ると吹き出しも閉じる", async () => {
      const instance = shown();
      await instance.getState().setMascot(true);
      await instance.getState().setMascotChat(true);

      await instance.getState().setMascot(false);

      expect(instance.getState().mascotChat).toBe(false);
    });

    it("表示していなければ窓は触らない", async () => {
      const instance = shown();
      await instance.getState().setMascotScale(0.8);
      expect(mocked.windowSetSize).not.toHaveBeenCalled();
    });
  });

  it("感情を手で指定できる", () => {
    const instance = store();
    instance.getState().previewEmotion("angry");
    expect(instance.getState().emotion).toEqual({
      emotion: "angry",
      intensity: 1,
    });
  });

  it("手動の指定は発話とは別の経路で即座に伝える", () => {
    const instance = store();
    const before = instance.getState().preview.seq;
    instance.getState().previewEmotion("sad");

    const preview = instance.getState().preview;
    expect(preview.seq).toBe(before + 1);
    expect(preview.emotion).toBe("sad");
    // 発話の列は動かさない
    expect(instance.getState().speech.seq).toBe(0);
  });
});

describe("カメラと背景 (要件 F-03)", () => {
  const camera = {
    position: [0, 1.2, 1.5] as [number, number, number],
    target: [0, 1.1, 0] as [number, number, number],
  };

  it("カメラ位置をキャラクターへ保存する", async () => {
    const instance = store();
    await instance.getState().saveCameraState(camera);

    expect(
      instance.getState().characters.find((item) => item.id === "ch1")?.cameraPreset,
    ).toEqual(camera);
    expect(mocked.characterUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ cameraPreset: camera }),
    );
  });

  it("null を渡すと覚えた位置を忘れる", async () => {
    const instance = store();
    await instance.getState().saveCameraState(camera);
    await instance.getState().saveCameraState(null);

    expect(
      instance.getState().characters.find((item) => item.id === "ch1")?.cameraPreset,
    ).toBeNull();
  });

  it("キャラクター未選択なら保存しない", async () => {
    const instance = store();
    instance.setState({ activeCharacterId: null });
    await instance.getState().saveCameraState(camera);
    expect(mocked.characterUpsert).not.toHaveBeenCalled();
  });

  it("背景色を設定へ保存する", async () => {
    const instance = store();
    await instance.getState().setBackgroundColor("#123456");

    expect(instance.getState().settings?.backgroundColor).toBe("#123456");
    expect(mocked.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundColor: "#123456" }),
    );
  });

  it("null を渡すと既定色へ戻す", async () => {
    const instance = store();
    await instance.getState().setBackgroundColor("#123456");
    await instance.getState().setBackgroundColor(null);
    expect(instance.getState().settings?.backgroundColor).toBeNull();
  });

  it("設定が未読込なら保存を試みない", async () => {
    const instance = createAppStore();
    await instance.getState().setBackgroundColor("#123456");
    expect(mocked.settingsSet).not.toHaveBeenCalled();
  });

  it("保存に失敗してもエラーとして保持する", async () => {
    mocked.settingsSet.mockRejectedValue({
      kind: "io",
      message: "書けません",
      retryAfterMs: null,
      status: null,
    });
    const instance = store();
    await instance.getState().setBackgroundColor("#123456");
    expect(instance.getState().error?.kind).toBe("io");
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

  it("返答に使ったモデルを記録する", async () => {
    // 切り替えて試し比べたとき、どれが書いたかを後から辿れるようにする
    respondWith(["ごきげんよう。"]);
    const instance = store();

    await instance.getState().send("やあ");

    const messages = instance.getState().conversation?.messages ?? [];
    expect(messages[1]?.model).toBe("llama3.2");
    // 利用者の発言は誰も生成していない
    expect(messages[0]?.model).toBeNull();
  });

  it("切り替えた後の返答には新しいモデルが載る", async () => {
    const other: ProviderProfileDto = { ...provider, id: "p2", model: "claude-opus-4" };
    respondWith(["ごきげんよう。"]);
    const instance = store();
    instance.setState({ providers: [provider, other] });

    await instance.getState().send("やあ");
    await instance.getState().setProvider("p2");
    await instance.getState().send("もう一度");

    const messages = instance.getState().conversation?.messages ?? [];
    // 過去の返答は書いた当時のモデルのまま
    expect(messages[1]?.model).toBe("llama3.2");
    expect(messages[3]?.model).toBe("claude-opus-4");
  });

  it("発話の断片を順に積む", async () => {
    respondWith(["ごき", "げん", "よう"]);
    const instance = store();
    await instance.getState().send("やあ");
    // リップシンクは追加分だけを消化するので、差分ごとに seq が進む
    expect(instance.getState().speech.seq).toBe(3);
    expect(instance.getState().speech.text).toBe("よう");
  });

  it("感情は発話に添えて渡す", async () => {
    // 受信した瞬間に顔を変えると、口が追いつく前に表情だけ先へ進む
    const chunks: { text: string; emotion: string | null }[] = [];
    mocked.chatStream.mockImplementation(async (_request, onDelta) => {
      onDelta({ kind: "text", value: "[happy]うれしい" });
      onDelta({ kind: "text", value: "です" });
      return okResult;
    });

    const instance = store();
    const off = instance.subscribe(
      (state) => state.speech,
      (speech) => chunks.push({ text: speech.text, emotion: speech.emotion?.emotion ?? null }),
    );
    await instance.getState().send("やあ");
    off();

    expect(chunks).toEqual([
      { text: "うれしい", emotion: "happy" },
      { text: "です", emotion: null },
    ]);
  });

  it("本文が無くても感情だけは渡す", async () => {
    // タグだけが先に届く場合を取りこぼさない
    mocked.chatStream.mockImplementation(async (_request, onDelta) => {
      onDelta({ kind: "text", value: "[happy]" });
      return okResult;
    });

    const instance = store();
    await instance.getState().send("やあ");
    expect(instance.getState().speech.emotion?.emotion).toBe("happy");
    expect(instance.getState().speech.text).toBe("");
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

  it("履歴の量は接続先の設定に従う", async () => {
    respondWith(["はい"]);
    const instance = store();
    // 1 件ぶんも入らない予算にすると履歴は空になる
    instance.setState({ providers: [{ ...provider, contextBudgetTokens: 1 }] });

    await instance.getState().send("いちど目");
    await instance.getState().send("にど目");

    expect(mocked.chatStream.mock.calls[1]?.[0].history).toEqual([]);
  });

  it("設定が無ければ既定の予算を使う", async () => {
    respondWith(["はい"]);
    const instance = store();
    instance.setState({ providers: [{ ...provider, contextBudgetTokens: null }] });

    await instance.getState().send("いちど目");
    await instance.getState().send("にど目");

    expect(mocked.chatStream.mock.calls[1]?.[0].history).toHaveLength(2);
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
