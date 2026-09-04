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

/** 感情とその強さ。表情の指示として持ち回る単位。 */
export type EmotionCue = {
  readonly emotion: CanonicalEmotion;
  readonly intensity: number;
};

export const NEUTRAL_CUE: EmotionCue = { emotion: "neutral", intensity: 1 };

/**
 * 身振りの指示 (要件 F-15)。
 *
 * 感情と違い、タグ名は利用者が決める。moca 側は名前を一つも知らない
 * ので、正規化された語彙を持たない (ADR-0019)。
 */
export type GestureCue = {
  readonly tag: string;
  readonly intensity: number;
};

/** パーサが発行するイベント。docs/emotion-protocol.md 3.2 */
export type ParseEvent =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "emotion";
      readonly emotion: CanonicalEmotion;
      readonly intensity: number;
    }
  | {
      readonly type: "gesture";
      readonly tag: string;
      readonly intensity: number;
    };
