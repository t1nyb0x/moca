/**
 * 正規化感情セット。
 *
 * VRM 1.0 の表情プリセット名と一致させてある。これにより VRM 経路の
 * マッピングが恒等となり、変換テーブルが不要になる。
 * 仕様: docs/emotion-protocol.md 第 1 章
 */
export const CANONICAL_EMOTIONS = [
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
] as const;

export type CanonicalEmotion = (typeof CANONICAL_EMOTIONS)[number];

const EMOTION_SET: ReadonlySet<string> = new Set(CANONICAL_EMOTIONS);

export function isCanonicalEmotion(value: string): value is CanonicalEmotion {
  return EMOTION_SET.has(value);
}

/** パーサが発行するイベント。docs/emotion-protocol.md 3.2 */
export type ParseEvent =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "emotion";
      readonly emotion: CanonicalEmotion;
      readonly intensity: number;
    };
