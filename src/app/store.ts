import { create, type StoreApi, type UseBoundStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import * as ipc from "@/ipc";
import type { CommandError } from "@/ipc/errors";
import type { CharacterProfile } from "@/ipc/generated/CharacterProfile";
import type { Conversation } from "@/ipc/generated/Conversation";
import type { Message } from "@/ipc/generated/Message";
import type { ModelHandle } from "@/ipc/generated/ModelHandle";
import type { ProviderProfileDto } from "@/ipc/generated/ProviderProfileDto";
import type { Settings } from "@/ipc/generated/Settings";
import type { StopReason } from "@/ipc/generated/StopReason";

import { budgetFromContextLength, DEFAULT_MAX_TURNS, trimHistory } from "./context-window";
import { ResponseAssembler, type EmotionCue } from "./response-assembler";

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
};

const NEUTRAL: EmotionCue = { emotion: "neutral", intensity: 1 };

export type AppState = {
  settings: Settings | null;
  providers: ProviderProfileDto[];
  characters: CharacterProfile[];
  activeCharacterId: string | null;

  conversation: Conversation | null;
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
  emotion: EmotionCue;
  speech: SpeechChunk;

  /** 読み込み済みのモデル。null はモデル未設定 (要件 F-02)。 */
  model: ModelHandle | null;
  showViewer: boolean;

  bootstrap: () => Promise<void>;
  setActiveCharacter: (id: string | null) => Promise<void>;
  /** 選択中のキャラクターへモデルのパスを保存する。 */
  persistModelPath: (path: string | null) => Promise<void>;
  newConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  send: (input: string) => Promise<void>;
  cancel: () => Promise<void>;
  regenerate: () => Promise<void>;
  clearError: () => void;
  pickModel: () => Promise<void>;
  openModel: (path: string) => Promise<void>;
  clearModel: () => Promise<void>;
  setShowViewer: (show: boolean) => Promise<void>;
};

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

function userMessage(content: string): Message {
  return {
    role: "user",
    content,
    rawContent: null,
    emotions: null,
    createdAt: nowIso(),
  };
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
  return create<AppState>()(subscribeWithSelector((set, get) => ({
    settings: null,
    providers: [],
    characters: [],
    activeCharacterId: null,

    conversation: null,
    status: "idle",
    streamingText: "",
    thinkingText: "",
    requestId: null,
    error: null,
    emotion: NEUTRAL,
    speech: { seq: 0, text: "" },
    model: null,
    showViewer: true,

    clearError: () => set({ error: null }),

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

        // 前回のモデルを復元する (要件 F-01-6)。失敗しても本体は動かす。
        const active = characters.find(
          (character) => character.id === settings.activeCharacterId,
        );
        if (active?.modelPath != null) {
          await get().openModel(active.modelPath);
        }
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    pickModel: async () => {
      try {
        const handle = await ipc.modelPick();
        if (handle === null) return;
        set({ model: handle });
        await get().persistModelPath(handle.path);
      } catch (error) {
        set({ error: error as CommandError });
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
      set({ model: null });
      await get().persistModelPath(null);
    },

    setShowViewer: async (show) => {
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
          modelFormat: path === null ? null : "vrm",
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
        set({ conversation, streamingText: "", error: null, emotion: NEUTRAL });
      } catch (error) {
        set({ error: error as CommandError });
      }
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

      const history = trimHistory(base.messages, {
        maxTurns: DEFAULT_MAX_TURNS,
        budgetTokens: budgetFromContextLength(
          state.providers.find((provider) =>
            state.characters.some(
              (character) =>
                character.id === characterId && character.providerId === provider.id,
            ),
          )?.contextBudgetTokens ?? null,
        ),
      });

      const withUser: Conversation = {
        ...base,
        messages: [...base.messages, userMessage(trimmed)],
      };

      const requestId = newId();
      const assembler = new ResponseAssembler();

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
            set((current) => ({
              streamingText: assembler.display,
              emotion: update.emotion ?? current.emotion,
              speech:
                update.appendedText === ""
                  ? current.speech
                  : { seq: current.speech.seq + 1, text: update.appendedText },
            }));
          },
        );

        assembler.finish();

        // 中断でも受け取れた分は残す。ユーザーの目に見えていたものを消さない。
        const messages =
          assembler.display === ""
            ? withUser.messages
            : [...withUser.messages, assembler.toMessage(nowIso())];

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
  })));
}

export const useAppStore = createAppStore();
