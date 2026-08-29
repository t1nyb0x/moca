import { create, type StoreApi, type UseBoundStore } from "zustand";

import * as ipc from "@/ipc";
import type { CommandError } from "@/ipc/errors";
import type { CharacterProfile } from "@/ipc/generated/CharacterProfile";
import type { Conversation } from "@/ipc/generated/Conversation";
import type { Message } from "@/ipc/generated/Message";
import type { ProviderProfileDto } from "@/ipc/generated/ProviderProfileDto";
import type { Settings } from "@/ipc/generated/Settings";

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
  requestId: string | null;
  error: CommandError | null;
  emotion: EmotionCue;
  speech: SpeechChunk;

  bootstrap: () => Promise<void>;
  setActiveCharacter: (id: string | null) => Promise<void>;
  newConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  send: (input: string) => Promise<void>;
  cancel: () => Promise<void>;
  regenerate: () => Promise<void>;
  clearError: () => void;
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

function userMessage(content: string): Message {
  return {
    role: "user",
    content,
    rawContent: null,
    emotions: null,
    createdAt: nowIso(),
  };
}

export function createAppStore(): UseBoundStore<StoreApi<AppState>> {
  return create<AppState>((set, get) => ({
    settings: null,
    providers: [],
    characters: [],
    activeCharacterId: null,

    conversation: null,
    status: "idle",
    streamingText: "",
    requestId: null,
    error: null,
    emotion: NEUTRAL,
    speech: { seq: 0, text: "" },

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
        });
      } catch (error) {
        set({ error: error as CommandError });
      }
    },

    setActiveCharacter: async (id) => {
      set({ activeCharacterId: id, conversation: null, emotion: NEUTRAL });
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
      set({ conversation: null, streamingText: "", emotion: NEUTRAL, error: null });
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
        requestId,
        error: null,
      });

      try {
        const result = await ipc.chatStream(
          { requestId, characterId, history, userInput: trimmed },
          (delta) => {
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
          requestId: null,
        });

        // 保存はストリームの解決後に一度だけ (IPC 契約 C-2)
        await ipc.conversationSave(finished);
        void result;
      } catch (error) {
        // 送った内容は残す。やり直せるようにするため。
        set({
          status: "idle",
          streamingText: "",
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
  }));
}

export const useAppStore = createAppStore();
