/**
 * Tauri コマンドの型付きラッパ。
 *
 * 契約は docs/ipc-contract.md。型は Rust 側から ts-rs で生成しており、
 * ここで手書きしてはならない。
 */
import { Channel, invoke } from "@tauri-apps/api/core";

import type { ChatResult } from "./generated/ChatResult";
import type { ChatStreamRequest } from "./generated/ChatStreamRequest";
import type { CharacterProfile } from "./generated/CharacterProfile";
import type { Conversation } from "./generated/Conversation";
import type { ConversationSummary } from "./generated/ConversationSummary";
import type { Delta } from "./generated/Delta";
import type { ModelInfo } from "./generated/ModelInfo";
import type { ProviderHealth } from "./generated/ProviderHealth";
import type { ProviderProfileDto } from "./generated/ProviderProfileDto";
import type { Settings } from "./generated/Settings";
import { toCommandError } from "./errors";

/** 失敗を必ず CommandError にそろえる。 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toCommandError(error);
  }
}

export const settingsGet = (): Promise<Settings> => call("settings_get");

export const settingsSet = (settings: Settings): Promise<void> =>
  call("settings_set", { settings });

export const providersList = (): Promise<ProviderProfileDto[]> => call("providers_list");

/**
 * `apiKey` の意味づけは 3 通り (docs/ipc-contract.md 2.2)。
 *
 * - `null`: 既存の鍵を維持する
 * - `""`: 鍵を削除する
 * - 値: 差し替える
 */
export const providerUpsert = (
  profile: ProviderProfileDto,
  apiKey: string | null,
): Promise<ProviderProfileDto> => call("provider_upsert", { profile, apiKey });

export const providerDelete = (id: string): Promise<void> => call("provider_delete", { id });

export const providerTest = (id: string): Promise<ProviderHealth> =>
  call("provider_test", { id });

export const providerModels = (id: string): Promise<ModelInfo[]> =>
  call("provider_models", { id });

export const charactersList = (): Promise<CharacterProfile[]> => call("characters_list");

export const characterGet = (id: string): Promise<CharacterProfile> =>
  call("character_get", { id });

export const characterUpsert = (profile: CharacterProfile): Promise<CharacterProfile> =>
  call("character_upsert", { profile });

export const characterDelete = (id: string): Promise<void> =>
  call("character_delete", { id });

export const conversationsIndex = (
  characterId: string | null,
): Promise<ConversationSummary[]> => call("conversations_index", { characterId });

export const conversationGet = (id: string): Promise<Conversation> =>
  call("conversation_get", { id });

export const conversationSave = (conversation: Conversation): Promise<void> =>
  call("conversation_save", { conversation });

export const conversationDelete = (id: string): Promise<void> =>
  call("conversation_delete", { id });

/**
 * ストリームが終わるまで解決しない。
 *
 * 差分は Channel で届き、エラーは棄却でのみ表現される。中断は
 * `stopReason: "cancelled"` の正常解決になる。
 */
export function chatStream(
  request: ChatStreamRequest,
  onDelta: (delta: Delta) => void,
): Promise<ChatResult> {
  const channel = new Channel<Delta>();
  channel.onmessage = onDelta;
  return call("chat_stream", { request, onDelta: channel });
}

/** 冪等。すでに終わった要求への中断も成功する。 */
export const chatCancel = (requestId: string): Promise<void> =>
  call("chat_cancel", { requestId });

export { isCommandError, toCommandError } from "./errors";
export type { CommandError, CommandErrorKind } from "./errors";
