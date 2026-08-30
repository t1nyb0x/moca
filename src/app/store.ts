import { create, type StoreApi, type UseBoundStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import type { Playback } from "@/audio/player";
import {
  createSegmenter,
  flushSpeech,
  pushSpeech,
  type SpeechSegment,
} from "@/domain/voice/segment";
import * as ipc from "@/ipc";
import { SpeechQueue } from "./speech";
import type { CommandError } from "@/ipc/errors";
import type { CameraState } from "@/ipc/generated/CameraState";
import type { EmotionMapping } from "@/ipc/generated/EmotionMapping";
import type { CharacterProfile } from "@/ipc/generated/CharacterProfile";
import type { Conversation } from "@/ipc/generated/Conversation";
import type { ConversationSummary } from "@/ipc/generated/ConversationSummary";
import { NEUTRAL_CUE, type CanonicalEmotion, type EmotionCue } from "@/domain/emotion/types";
import {
  canEnterMascot,
  clampScale,
  DEFAULT_SCALE,
  mascotWindowSize,
} from "@/domain/mascot/window";
import type { ModelDiagnostics } from "@/domain/model/diagnostics";
import type { Message } from "@/ipc/generated/Message";
import type { IdleSettings } from "@/ipc/generated/IdleSettings";
import type { ModelHandle } from "@/ipc/generated/ModelHandle";
import type { ProviderProfileDto } from "@/ipc/generated/ProviderProfileDto";
import type { Settings } from "@/ipc/generated/Settings";
import type { StopReason } from "@/ipc/generated/StopReason";

import { DEFAULT_BUDGET_TOKENS, DEFAULT_MAX_TURNS, trimHistory } from "./context-window";
import { ResponseAssembler } from "./response-assembler";

export type ChatStatus = "idle" | "streaming";

/**
 * 3D ビューへ渡す発話の断片。
 *
 * `seq` を増やすことで、同じ文字列が続けて届いても変化として検出できる。
 * リップシンクは追加分だけを消化するため、差分で渡す必要がある。
 */
export type SpeechChunk = {
  readonly seq: number;
  readonly text: string;
  /** このテキストの先頭に対応する感情。無ければ null。 */
  readonly emotion: EmotionCue | null;
};

/**
 * 再生中の読み上げ音声。
 *
 * 音声があるときは、文字数から口を推測せずに実際の波形へ合わせる。
 * null は「今は鳴っていない」。
 */
export type SpeechAudio = {
  readonly seq: number;
  readonly segment: SpeechSegment;
  readonly playback: Playback;
};

/** 手動で感情を確かめるための指示。発話とは独立に即座に反映される。 */
export type EmotionPreview = {
  readonly seq: number;
  readonly emotion: CanonicalEmotion;
};

const NEUTRAL = NEUTRAL_CUE;

export type AppState = {
  settings: Settings | null;
  providers: ProviderProfileDto[];
  characters: CharacterProfile[];
  activeCharacterId: string | null;

  conversation: Conversation | null;
  /** 選択中のキャラクターの会話一覧。本体は開くまで読まない (ADR-0010)。 */
  conversations: ConversationSummary[];
  status: ChatStatus;
  /** 生成中の応答。確定したら conversation へ移す。 */
  streamingText: string;
  /**
   * 推論モデルの思考。会話には残さないが、進行中であることを見せるために
   * 保持する。捨てると思考の長いモデルで画面が固まったように見える。
   */
  thinkingText: string;
  requestId: string | null;
  error: CommandError | null;
  /** 直近に受け取った感情。診断の表示に使う。 */
  emotion: EmotionCue;
  speech: SpeechChunk;
  speechAudio: SpeechAudio | null;
  preview: EmotionPreview;

  /** 読み込み済みのモデル。null はモデル未設定 (要件 F-02)。 */
  model: ModelHandle | null;
  /** 読み込んだモデルの素性。原因の切り分けに使う。 */
  modelDiagnostics: ModelDiagnostics | null;
  showViewer: boolean;
  /** マスコット表示か (要件 F-13-1)。 */
  mascot: boolean;
  /**
   * マスコット表示へ入る前の窓の大きさ。戻るときに復元する。
   *
   * 保存はしない。次の起動では通常表示の既定に従えばよい。
   */
  normalSize: { readonly width: number; readonly height: number } | null;
  /**
   * モデルを収めるのに必要な窓の縦横比 (要件 F-13-4)。
   *
   * 描画側が読み込みのたびに測って入れる。保存はしない。モデルごとに違い、
   * 次に読んだときまた測るため。
   */
  modelAspect: number | null;

  bootstrap: () => Promise<void>;
  setActiveCharacter: (id: string | null) => Promise<void>;
  /** 選択中のキャラクターへモデルのパスを保存する。 */
  persistModelPath: (path: string | null) => Promise<void>;
  newConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  send: (input: string) => Promise<void>;
  cancel: () => Promise<void>;
  regenerate: () => Promise<void>;
  clearError: () => void;
  setModelDiagnostics: (diagnostics: ModelDiagnostics | null) => void;
  /** 感情を手で指定する。LLM と同じ経路を通るので切り分けに使える。 */
  previewEmotion: (emotion: CanonicalEmotion) => void;
  /** アイドル挙動の切り替え (要件 F-04-6)。選択中のキャラクターへ保存する。 */
  setIdleSettings: (idle: IdleSettings) => Promise<void>;
  /**
   * 接続先を切り替える。選択中のキャラクターへ保存する。
   *
   * `setActiveCharacter` と違い会話・表情・モデルを作り直さない。会話を
   * 続けたまま接続先だけ差し替えられることが、この操作の目的であるため。
   */
  setProvider: (providerId: string) => Promise<void>;
  /** 3D ビューの背景色 (要件 F-03-4)。null は既定色。 */
  setBackgroundColor: (color: string | null) => Promise<void>;
  /** カメラ位置を選択中のキャラクターへ保存する (要件 F-03-5)。 */
  saveCameraState: (state: CameraState | null) => Promise<void>;
  /** 感情ごとのモーフ割り当てを保存する (PMX 用、ADR-0004)。 */
  saveEmotionMapping: (mapping: EmotionMapping | null) => Promise<void>;
  pickModel: () => Promise<void>;
  /** 読み込んで選択中のキャラクターへ保存する。投下や選択の受け口。 */
  adoptModel: (path: string) => Promise<void>;
  /** 読み込むだけ。復元に使う。 */
  openModel: (path: string) => Promise<void>;
  clearModel: () => Promise<void>;
  setShowViewer: (show: boolean) => Promise<void>;
  /**
   * マスコット表示を切り替える (要件 F-13-1)。
   *
   * モデルが表示されていなければ入れない。全面が透明になり、全面が
   * クリックスルーとなって操作できない窓が残るため。
   */
  setMascot: (enabled: boolean) => Promise<void>;
  /** マスコット表示の倍率 (要件 F-13-3)。範囲へ収めてから保存する。 */
  setMascotScale: (scale: number) => Promise<void>;
  /** モデルを収めるのに必要な縦横比。描画側が測って入れる (要件 F-13-4)。 */
  setModelAspect: (aspect: number | null) => void;
};

/** 画面の高さ。取れない環境では窓の寸法側が既定へ倒す。 */
function screenHeight(): number {
  return typeof window === "undefined" ? 0 : window.screen.height;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function titleFrom(input: string): string {
  const trimmed = input.trim().replace(/\s+/gu, " ");
  return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed || "新しい会話";
}

/** 直近のユーザー発言の位置。無ければ -1。 */
function lastIndexOfUser(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

/**
 * 本文が空のまま終わったときの説明。
 *
 * 推論モデルは思考にトークンを使い切ると本文を 1 文字も返さない。
 * 何も表示されないままだと、利用者には不具合と区別がつかない。
 */
function emptyResponseError(
  display: string,
  stopReason: StopReason,
): CommandError | null {
  if (display !== "") return null;
  if (stopReason === "cancelled") return null;

  const message =
    stopReason === "maxTokens"
      ? "モデルが思考だけで最大トークン数に達し、本文が生成されませんでした。設定で最大トークン数を増やすか、思考の短いモデルをお試しください。"
      : "モデルが本文を返しませんでした。";

  return { kind: "invalid", message, retryAfterMs: null, status: null };
}

/**
 * キャラクターが選ばれていなければ断る。
 *
 * モデルは選択中のキャラクターへ保存する。選ばれていないと、表示は
 * されるのに保存先が無いという中途半端な状態になる。
 */
function requireCharacter(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): boolean {
  if (get().activeCharacterId !== null) return true;
  set({
    error: {
      kind: "invalid",
      message: "先にキャラクターを選んでください。モデルはキャラクターごとに保存されます。",
      retryAfterMs: null,
      status: null,
    },
  });
  return false;
}

function userMessage(content: string): Message {
  return {
    role: "user",
    content,
    rawContent: null,
    emotions: null,
    createdAt: nowIso(),
    // 利用者の発言は誰も生成していない
    model: null,
  };
}

/**
 * 読み上げの失敗を、会話の失敗と区別できる形にそろえる。
 *
 * 黙って声が出ないのが一番困る。原因が分かる言葉にして表に出す。
 */
function toVoiceError(error: unknown): CommandError {
  const base = ipc.toCommandError(error);
  return { ...base, message: `読み上げに失敗しました: ${base.message}` };
}

/**
 * `subscribeWithSelector` を挟むのは、3D ビューが特定の値だけを購読する
 * ため (ADR-0007)。素の subscribe は状態全体の変化しか通知しない。
 */
export function createAppStore(): UseBoundStore<
  Omit<StoreApi<AppState>, "subscribe"> & {
    subscribe: {
      (listener: (state: AppState, prev: AppState) => void): () => void;
      <U>(
        selector: (state: AppState) => U,
        listener: (selected: U, previous: U) => void,
        options?: {
          equalityFn?: (a: U, b: U) => boolean;
          fireImmediately?: boolean;
        },
      ): () => void;
    };
  }
> {
  const speechQueue = new SpeechQueue();

  return create<AppState>()(subscribeWithSelector((set, get) => {
    speechQueue.onSegment = (segment, playback) => {
      set((current) => ({
        speechAudio: { seq: (current.speechAudio?.seq ?? 0) + 1, segment, playback },
      }));
    };
    speechQueue.onIdle = () => set({ speechAudio: null });
    speechQueue.onError = (error) => {
      // 声が出なくても会話は続けられる。既に出ている失敗を覆い隠さない。
      set((current) =>
        current.error === null
          ? { error: toVoiceError(error) }
          : {},
      );
    };

    return {
    settings: null,
    providers: [],
    characters: [],
    activeCharacterId: null,

    conversation: null,
    conversations: [],
    status: "idle",
    streamingText: "",
    thinkingText: "",
    requestId: null,
    error: null,
    emotion: NEUTRAL,
    speech: { seq: 0, text: "", emotion: null },
    speechAudio: null,
    preview: { seq: 0, emotion: "neutral" },
    model: null,
    modelDiagnostics: null,
    showViewer: true,
    mascot: false,
    normalSize: null,
    modelAspect: null,

    clearError: () => set({ error: null }),

    setModelDiagnostics: (diagnostics) => set({ modelDiagnostics: diagnostics }),

    previewEmotion: (emotion) =>
      set((current) => ({
        emotion: { emotion, intensity: 1 },
        preview: { seq: current.preview.seq + 1, emotion },
      })),

    setBackgroundColor: async (color) => {
      const settings = get().settings;
      if (settings === null) return;
      const next = { ...settings, backgroundColor: color };
      set({ settings: next });
      try {
        await ipc.settingsSet(next);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    saveCameraState: async (state) => {
      const current = get();
      const character = current.characters.find(
        (item) => item.id === current.activeCharacterId,
      );
      if (character === undefined) return;

      const updated = { ...character, cameraPreset: state };
      set({
        characters: current.characters.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      });
      try {
        await ipc.characterUpsert(updated);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    saveEmotionMapping: async (mapping) => {
      const current = get();
      const character = current.characters.find(
        (item) => item.id === current.activeCharacterId,
      );
      if (character === undefined) return;

      const updated = { ...character, emotionMapping: mapping };
      set({
        characters: current.characters.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      });
      try {
        await ipc.characterUpsert(updated);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    setIdleSettings: async (idle) => {
      const state = get();
      const character = state.characters.find(
        (item) => item.id === state.activeCharacterId,
      );
      if (character === undefined) return;

      // 先に反映してから保存する。切り替えの手応えを待たせない。
      const updated = { ...character, idleSettings: idle };
      set({
        characters: state.characters.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      });

      try {
        await ipc.characterUpsert(updated);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    setMascot: async (enabled) => {
      const state = get();
      if (state.mascot === enabled) return;
      // 描かれるものが無ければ入れない (要件 F-13-1)。逃げ道を用意するのでは
      // なく、操作できない窓になる状態そのものを避ける。
      if (
        enabled &&
        !canEnterMascot({ hasModel: state.model !== null, showViewer: state.showViewer })
      ) {
        return;
      }

      try {
        // 入る前の大きさを覚えておき、戻るときに復元する
        const normalSize = enabled ? await ipc.windowSize() : state.normalSize;
        set({ mascot: enabled, normalSize });

        await ipc.windowSetMascot(enabled);

        const size = enabled
          ? mascotWindowSize(
              state.settings?.mascotScale ?? DEFAULT_SCALE,
              screenHeight(),
              state.modelAspect,
            )
          : (normalSize ?? { width: 1100, height: 720 });
        await ipc.windowSetSize(size.width, size.height);
      } catch (error) {
        set({ error: error as CommandError });
      }

      const settings = get().settings;
      if (settings === null) return;
      const next = { ...settings, mascot: enabled };
      set({ settings: next });
      try {
        await ipc.settingsSet(next);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    setModelAspect: (aspect) => {
      set({ modelAspect: aspect });

      // 起動時はモデルを測る前に窓を組むため、既定の縦横比で出来ている。
      // 測れたところで合わせ直す (要件 F-13-4)。
      const state = get();
      if (!state.mascot) return;
      const size = mascotWindowSize(
        state.settings?.mascotScale ?? DEFAULT_SCALE,
        screenHeight(),
        aspect,
      );
      void ipc.windowSetSize(size.width, size.height).catch((error: unknown) => {
        set({ error: error as CommandError });
      });
    },

    setMascotScale: async (scale) => {
      const state = get();
      const clamped = clampScale(scale);

      if (state.mascot) {
        const size = mascotWindowSize(clamped, screenHeight(), state.modelAspect);
        try {
          await ipc.windowSetSize(size.width, size.height);
        } catch (error) {
          set({ error: error as CommandError });
        }
      }

      const settings = get().settings;
      if (settings === null) return;
      const next = { ...settings, mascotScale: clamped };
      set({ settings: next });
      try {
        await ipc.settingsSet(next);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    setProvider: async (providerId) => {
      const state = get();
      const character = state.characters.find(
        (item) => item.id === state.activeCharacterId,
      );
      if (character === undefined) return;
      // 実在しない接続先を指すと、送信のたびに解決に失敗して黙って止まる
      if (!state.providers.some((item) => item.id === providerId)) return;
      if (character.providerId === providerId) return;

      // 先に反映してから保存する。切り替えの手応えを待たせない。
      const updated = { ...character, providerId };
      set({
        characters: state.characters.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      });

      try {
        await ipc.characterUpsert(updated);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    bootstrap: async () => {
      try {
        const [settings, providers, characters] = await Promise.all([
          ipc.settingsGet(),
          ipc.providersList(),
          ipc.charactersList(),
        ]);
        set({
          settings,
          providers,
          characters,
          activeCharacterId: settings.activeCharacterId,
          showViewer: settings.showViewer,
        });
        await get().refreshConversations();

        // 前回のモデルを復元する (要件 F-01-6)。失敗しても本体は動かす。
        const active = characters.find(
          (character) => character.id === settings.activeCharacterId,
        );
        if (active?.modelPath != null) {
          await get().openModel(active.modelPath);
        }

        // 復元はモデルを出せたときだけ (要件 F-13-9)。ここを守らないと、
        // 読み込みに失敗した起動が操作できないアプリになる。
        if (settings.mascot) await get().setMascot(true);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    pickModel: async () => {
      if (!requireCharacter(get, set)) return;
      try {
        const handle = await ipc.modelPick();
        if (handle === null) return;
        set({ model: handle });
        await get().persistModelPath(handle.path);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    adoptModel: async (path) => {
      if (!requireCharacter(get, set)) return;
      await get().openModel(path);
      // 読めなかったときは保存しない。開けないパスを覚えても仕方がない。
      if (get().model !== null) {
        await get().persistModelPath(path);
      }
    },

    openModel: async (path) => {
      try {
        set({ model: await ipc.modelOpen(path) });
      } catch (error) {
        // 読めなくても会話は続けられる。モデル未設定と同じ状態にする。
        set({ model: null, error: error as CommandError });
      }
    },

    clearModel: async () => {
      // モデルが消えると全面が透明になる。先に通常表示へ戻す (要件 F-13-10)。
      await get().setMascot(false);
      set({ model: null, modelDiagnostics: null });
      await get().persistModelPath(null);
    },

    setShowViewer: async (show) => {
      // 3D を隠すと描かれるものが無くなる (要件 F-13-10)。
      if (!show) await get().setMascot(false);
      set({ showViewer: show });
      const settings = get().settings;
      if (settings === null) return;
      const next = { ...settings, showViewer: show };
      set({ settings: next });
      try {
        await ipc.settingsSet(next);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    persistModelPath: async (path) => {
      const state = get();
      const character = state.characters.find(
        (item) => item.id === state.activeCharacterId,
      );
      if (character === undefined) return;
      try {
        const saved = await ipc.characterUpsert({
          ...character,
          modelPath: path,
          modelFormat: path === null ? null : (get().model?.format ?? "vrm"),
        });
        set({
          characters: state.characters.map((item) =>
            item.id === saved.id ? saved : item,
          ),
        });
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    setActiveCharacter: async (id) => {
      set({ activeCharacterId: id, conversation: null, emotion: NEUTRAL, model: null });

      await get().refreshConversations();

      const character = get().characters.find((item) => item.id === id);
      if (character?.modelPath != null) {
        await get().openModel(character.modelPath);
      }

      const settings = get().settings;
      if (settings === null) return;
      const next = { ...settings, activeCharacterId: id };
      set({ settings: next });
      try {
        await ipc.settingsSet(next);
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    newConversation: () => {
      set({
        conversation: null,
        streamingText: "",
        thinkingText: "",
        emotion: NEUTRAL,
        error: null,
      });
    },

    loadConversation: async (id) => {
      try {
        const conversation = await ipc.conversationGet(id);
        set({
          conversation,
          streamingText: "",
          thinkingText: "",
          error: null,
          emotion: NEUTRAL,
        });
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    refreshConversations: async () => {
      const characterId = get().activeCharacterId;
      if (characterId === null) {
        set({ conversations: [] });
        return;
      }
      try {
        set({ conversations: await ipc.conversationsIndex(characterId) });
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    deleteConversation: async (id) => {
      try {
        await ipc.conversationDelete(id);
      } catch (error) {
        set({ error: error as CommandError });
        return;
      }
      set((current) => ({
        conversations: current.conversations.filter((item) => item.id !== id),
        // 開いている会話を消したら画面も離す
        conversation:
          current.conversation?.id === id ? null : current.conversation,
      }));
    },

    send: async (input) => {
      const state = get();

      // 同一キャラクターに対して同時に 1 本まで (IPC 契約 C-1)
      if (state.status === "streaming") return;

      const characterId = state.activeCharacterId;
      if (characterId === null) {
        set({
          error: {
            kind: "invalid",
            message: "キャラクターが選ばれていません",
            retryAfterMs: null,
            status: null,
          },
        });
        return;
      }

      const trimmed = input.trim();
      if (trimmed === "") return;

      const base: Conversation = state.conversation ?? {
        id: newId(),
        characterId,
        title: titleFrom(trimmed),
        messages: [],
        schemaVersion: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      // contextBudgetTokens は「履歴に使ってよいトークン数」そのもの。
      // 以前は文脈長として扱って半分に割っていたが、名前と食い違っていた。
      const character = state.characters.find((item) => item.id === characterId);
      const provider = state.providers.find(
        (item) => item.id === character?.providerId,
      );
      const history = trimHistory(base.messages, {
        maxTurns: DEFAULT_MAX_TURNS,
        budgetTokens: provider?.contextBudgetTokens ?? DEFAULT_BUDGET_TOKENS,
      });

      const withUser: Conversation = {
        ...base,
        messages: [...base.messages, userMessage(trimmed)],
      };

      const requestId = newId();
      const assembler = new ResponseAssembler();

      // 声を出す設定なら、口は音声に合わせる。文字数からの推測はしない。
      const voiceCharacterId =
        character?.voiceSettings?.enabled === true ? characterId : null;
      let segmenter = createSegmenter();
      speechQueue.cancel();

      set({
        conversation: withUser,
        status: "streaming",
        streamingText: "",
        thinkingText: "",
        requestId,
        error: null,
      });

      try {
        const result = await ipc.chatStream(
          { requestId, characterId, history, userInput: trimmed },
          (delta) => {
            if (delta.kind === "reasoning") {
              // 思考は本文でも発話でもない。表情にもリップシンクにも渡さない。
              set((current) => ({
                thinkingText: current.thinkingText + delta.value,
              }));
              return;
            }
            if (delta.kind !== "text") return;
            const update = assembler.push(delta.value);

            if (voiceCharacterId !== null) {
              // 文が閉じた時点で合成へ回す。返答の完成を待つと喋り始めが遅れる。
              // 強さも渡す。落とすと表情が常に最大になる。
              const pushed = pushSpeech(segmenter, update.appendedText, update.emotion);
              segmenter = pushed.state;
              for (const segment of pushed.segments) {
                speechQueue.enqueue(voiceCharacterId, segment);
              }
            }

            set((current) => ({
              streamingText: assembler.display,
              emotion: update.emotion ?? current.emotion,
              // 感情は口が該当位置へ到達した時点で反映されるよう、
              // テキストと一緒に送る。音声があるならそちらが口を動かすので
              // 疑似リップシンクへは渡さない。
              speech:
                voiceCharacterId !== null ||
                (update.appendedText === "" && update.emotion === null)
                  ? current.speech
                  : {
                      seq: current.speech.seq + 1,
                      text: update.appendedText,
                      emotion: update.emotion,
                    },
            }));
          },
        );

        assembler.finish();

        if (voiceCharacterId !== null) {
          // 句点で終わらない返答の、最後の一文を取りこぼさない。
          const rest = flushSpeech(segmenter);
          segmenter = rest.state;
          for (const segment of rest.segments) {
            speechQueue.enqueue(voiceCharacterId, segment);
          }
        }

        // 中断でも受け取れた分は残す。ユーザーの目に見えていたものを消さない。
        const messages =
          assembler.display === ""
            ? withUser.messages
            : [
                ...withUser.messages,
                assembler.toMessage(nowIso(), provider?.model ?? null),
              ];

        const finished: Conversation = {
          ...withUser,
          messages,
          updatedAt: nowIso(),
        };

        set({
          conversation: finished,
          status: "idle",
          streamingText: "",
          thinkingText: "",
          requestId: null,
          // 本文が 1 文字も出なかったときは理由を伝える。黙って何も起きない
          // のが一番困る。中断は利用者の意図なので何も言わない。
          error: emptyResponseError(assembler.display, result.stopReason),
        });

        // 保存はストリームの解決後に一度だけ (IPC 契約 C-2)
        if (assembler.display !== "") {
          await ipc.conversationSave(finished);
          await get().refreshConversations();
        }
      } catch (error) {
        // 送った内容は残す。やり直せるようにするため。
        set({
          status: "idle",
          streamingText: "",
          thinkingText: "",
          requestId: null,
          error: error as CommandError,
        });
      }
    },

    cancel: async () => {
      const requestId = get().requestId;
      if (requestId === null) return;
      // 中断したのに声だけ喋り続けることがないように、先に止める。
      speechQueue.cancel();
      try {
        await ipc.chatCancel(requestId);
      } catch {
        // 中断の失敗は利用者に見せる必要がない。冪等なので握りつぶす。
      }
    },

    regenerate: async () => {
      const state = get();
      if (state.status === "streaming") return;

      const conversation = state.conversation;
      if (conversation === null) return;

      const lastUserIndex = lastIndexOfUser(conversation.messages);
      if (lastUserIndex < 0) return;

      const input = conversation.messages[lastUserIndex]?.content ?? "";

      // 直近のユーザー発言以降を捨ててから送り直す
      set({
        conversation: {
          ...conversation,
          messages: conversation.messages.slice(0, lastUserIndex),
        },
        emotion: NEUTRAL,
      });

      await get().send(input);
    },
    };
  }));
}

export const useAppStore = createAppStore();
