/**
 * Tauri コマンドの型付きラッパ。
 *
 * 契約は docs/ipc-contract.md。型は Rust 側から ts-rs で生成しており、
 * ここで手書きしてはならない。
 */
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { ChatResult } from "./generated/ChatResult";
import type { ChatStreamRequest } from "./generated/ChatStreamRequest";
import type { CharacterProfile } from "./generated/CharacterProfile";
import type { Conversation } from "./generated/Conversation";
import type { ConversationSummary } from "./generated/ConversationSummary";
import type { Delta } from "./generated/Delta";
import type { ModelHandle } from "./generated/ModelHandle";
import type { ModelInfo } from "./generated/ModelInfo";
import type { ProviderHealth } from "./generated/ProviderHealth";
import type { ProviderProfileDto } from "./generated/ProviderProfileDto";
import type { Settings } from "./generated/Settings";
import type { SpeakerInfo } from "./generated/SpeakerInfo";
import type { TtsKind } from "./generated/TtsKind";
import type { CursorPoint } from "./generated/CursorPoint";
import type { WindowSize } from "./generated/WindowSize";
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

/** ログの保存先。不具合の報告に添えてもらうために表示する。 */
export const logsDir = (): Promise<string> => call("logs_dir");

/** ネイティブのファイルダイアログを開く。選ばなければ null。 */
export const modelPick = (): Promise<ModelHandle | null> => call("model_pick");

/** ドラッグ＆ドロップや前回のパスの復元に使う。 */
export const modelOpen = (path: string): Promise<ModelHandle> =>
  call("model_open", { path });

/**
 * モデルのパスを three.js が取得できる URL にする。
 *
 * URL の形式は Tauri の内部仕様なので、自前で組み立てず必ずこれを通す
 * (docs/ipc-contract.md 2.5)。model_pick / model_open がスコープを
 * 許可した後でなければ読み込めない。
 */
export const toAssetUrl = (path: string): string => convertFileSrc(path);

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

/** 接続先が話せる話者。接続テストも兼ねる。 */
export const ttsSpeakers = (kind: TtsKind, baseUrl: string): Promise<SpeakerInfo[]> =>
  call("tts_speakers", { kind, baseUrl });

/**
 * 話者が持つ感情成分の名前。
 *
 * 顔ぶれはキャストごとに違う。VOICEVOX は成分を持たないので空になる。
 */
export const ttsEmotionAxes = (
  kind: TtsKind,
  baseUrl: string,
  speaker: string,
): Promise<string[]> => call("tts_emotion_axes", { kind, baseUrl, speaker });

/**
 * 感情に応じた声で読み上げた WAV を得る。
 *
 * 音声は数百 KB になるため生のバイト列で届く (docs/ipc-contract.md 2.6)。
 */
export const ttsSynthesize = (
  characterId: string,
  text: string,
  emotion: string,
): Promise<ArrayBuffer> => call("tts_synthesize", { characterId, text, emotion });

/**
 * マスコット表示へ切り替える (要件 F-13-1)。
 *
 * 透過は生成時に決まっているため、ここでは枠・影・最前面と、大きさの下限を
 * 切り替える (ADR-0016)。
 */
export const windowSetMascot = (enabled: boolean): Promise<void> =>
  call("window_set_mascot", { enabled });

export const windowSetSize = (width: number, height: number): Promise<void> =>
  call("window_set_size", { width, height });

/** マスコット表示へ入る前の大きさを覚えるために読む。 */
export const windowSize = (): Promise<WindowSize> => call("window_size");

/**
 * 窓に対するカーソルの位置 (要件 F-13-5)。
 *
 * クリックスルー中は WebView へマウスが届かないため、位置はこちらから読む。
 */
export const windowCursorPosition = (): Promise<CursorPoint> =>
  call("window_cursor_position");

/** 描かれていないところでは背後の窓を操作できるようにする (要件 F-13-5)。 */
export const windowSetClickThrough = (ignore: boolean): Promise<void> =>
  call("window_set_click_through", { ignore });

/** 掴んで窓ごと動かす (要件 F-13-6)。 */
export const windowStartDrag = (): Promise<void> => call("window_start_drag");

/**
 * トレイからの表示切り替えを受け取る (要件 F-13-7)。
 *
 * 窓を直に触らせず通知だけを受けるのは、モデルが出ていなければ入れないと
 * いった判断 (F-13-1、F-13-10) を画面側に集めておくため。
 */
export const onMascotToggle = (handler: () => void): Promise<() => void> =>
  listen("mascot://toggle", () => handler());

export { isCommandError, toCommandError } from "./errors";
export type { CommandError, CommandErrorKind } from "./errors";
