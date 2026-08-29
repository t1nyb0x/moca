import { clamp01, type WeightMap } from "./types";

/** 感情の表情。合計が 1 を超えたら正規化する対象。 */
export const EMOTION_KEYS = [
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
] as const;

/** 口形。同時に立つのは 1 つだけのはずだが念のため群として扱う。 */
export const VISEME_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;

const VISEME_SET: ReadonlySet<string> = new Set(VISEME_KEYS);

export type ComposeInput = {
  /** 感情由来の表情。 */
  readonly expression: WeightMap;
  /** リップシンク由来の口形。 */
  readonly lipSync: WeightMap;
  /** まばたきや視線など。順に重ねる。 */
  readonly idle: readonly WeightMap[];
};

function mergeMax(target: Record<string, number>, source: WeightMap): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key] ?? 0;
    if (value > current) target[key] = value;
  }
}

/** 群の合計が 1 を超えていたら、その群だけを比率を保って縮める。 */
function normalizeGroup(target: Record<string, number>, keys: readonly string[]): void {
  let total = 0;
  for (const key of keys) total += target[key] ?? 0;
  if (total <= 1) return;

  for (const key of keys) {
    const value = target[key];
    if (value !== undefined) target[key] = value / total;
  }
}

/**
 * 各コントローラの出力を 1 枚の重み写像へまとめる。
 *
 * 合成規則は docs/architecture.md 2.6:
 * 1. キーごとに最大値を採る
 * 2. 発話中は感情由来の口形を抑え、リップシンクを優先する
 * 3. 群の合計が 1 を超えたら正規化する
 *
 * three.js には触れない。ここが純粋であることで、表情が破綻する条件を
 * 単体テストで押さえられる。
 */
export function composeWeights(input: ComposeInput): WeightMap {
  const result: Record<string, number> = {};

  for (const map of input.idle) mergeMax(result, map);
  mergeMax(result, input.expression);

  // 発話中はリップシンクが口を占有する。感情由来の口形と混ざると
  // 口が半端に開いたまま固まる。
  const speaking = Object.entries(input.lipSync).some(
    ([key, value]) => VISEME_SET.has(key) && value > 0,
  );
  if (speaking) {
    for (const key of VISEME_KEYS) delete result[key];
  }
  mergeMax(result, input.lipSync);

  normalizeGroup(result, EMOTION_KEYS);
  normalizeGroup(result, VISEME_KEYS);

  for (const [key, value] of Object.entries(result)) {
    const clamped = clamp01(value);
    if (clamped <= 0) {
      delete result[key];
    } else {
      result[key] = clamped;
    }
  }

  return result;
}
