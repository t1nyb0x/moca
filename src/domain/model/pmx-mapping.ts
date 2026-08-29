import { CANONICAL_EMOTIONS, type CanonicalEmotion } from "@/domain/emotion/types";
import type { Viseme } from "@/domain/lipsync/viseme";

/**
 * PMX のモーフ割り当て (ADR-0004、emotion-protocol.md 4.3)。
 *
 * PMX にはモーフ名の標準が無い。名前は日本語で、モデル制作者ごとに違う。
 * そこで候補を複数持ち、モデルが実際に持つものを選ぶ。当たらなければ
 * その枠は空にする。表情が出ないことはあっても、表示は成立させる。
 */

export type MorphTarget = {
  readonly morphName: string;
  readonly weight: number;
};

/** 一つの部位に対する候補と、当たったときの重み。 */
type Slot = {
  readonly candidates: readonly string[];
  readonly weight: number;
};

/**
 * 感情ごとの既定候補。眉・目・口の順に並べている。
 *
 * MMD の標準的なモデルに広く見られる名前を挙げているが、当たる保証は
 * どこにもない。利用者が UI から割り当て直せることが前提。
 */
const EMOTION_SLOTS: Readonly<Record<CanonicalEmotion, readonly Slot[]>> = {
  neutral: [],
  happy: [
    { candidates: ["にこり", "にっこり", "eyebrow_smile"], weight: 1.0 },
    { candidates: ["笑い", "笑顔", "喜び"], weight: 1.0 },
    { candidates: ["にっこり", "にやり", "わーい"], weight: 0.8 },
  ],
  angry: [
    { candidates: ["怒り", "怒", "eyebrow_angry"], weight: 1.0 },
    { candidates: ["キリッ", "じと目", "睨み"], weight: 0.7 },
    { candidates: ["∧", "へ", "怒り口"], weight: 0.6 },
  ],
  sad: [
    { candidates: ["困る", "下", "悲しい"], weight: 1.0 },
    { candidates: ["はぅ", "なごみ", "悲しむ"], weight: 0.5 },
    { candidates: ["▲", "さんかく", "口角下げ"], weight: 0.5 },
  ],
  relaxed: [
    { candidates: ["にこり", "にっこり"], weight: 0.5 },
    { candidates: ["なごみ", "細める", "じと目"], weight: 0.8 },
    { candidates: ["にっこり", "にやり"], weight: 0.4 },
  ],
  surprised: [
    { candidates: ["上", "驚き", "eyebrow_up"], weight: 1.0 },
    { candidates: ["びっくり", "驚き", "見開き"], weight: 1.0 },
    { candidates: ["お", "□", "ワ"], weight: 0.6 },
  ],
};

/** 母音の口形。ほぼ全モデルが持つ。 */
const VISEME_CANDIDATES: Readonly<Record<Viseme, readonly string[]>> = {
  aa: ["あ", "ア", "a"],
  ih: ["い", "イ", "i"],
  ou: ["う", "ウ", "u"],
  ee: ["え", "エ", "e"],
  oh: ["お", "オ", "o"],
};

const BLINK_CANDIDATES = ["まばたき", "まばたき2", "瞬き", "blink"] as const;

export type PmxMapping = {
  readonly emotions: Readonly<Record<CanonicalEmotion, readonly MorphTarget[]>>;
  readonly visemes: Readonly<Record<Viseme, string | null>>;
  readonly blink: string | null;
};

/** 候補のうち、モデルが実際に持つ最初のものを返す。 */
function pick(candidates: readonly string[], available: ReadonlySet<string>): string | null {
  return candidates.find((name) => available.has(name)) ?? null;
}

/**
 * モデルが持つモーフ名から既定の割り当てを求める。
 *
 * 当たらなかった枠は落とす。半端に当たった状態でも、当たったぶんだけは
 * 動かす。全部揃わないと何も動かない、という作りにはしない。
 */
export function resolveDefaultMapping(availableMorphs: readonly string[]): PmxMapping {
  const available = new Set(availableMorphs);

  const emotions = {} as Record<CanonicalEmotion, readonly MorphTarget[]>;
  for (const emotion of CANONICAL_EMOTIONS) {
    emotions[emotion] = EMOTION_SLOTS[emotion].flatMap((slot) => {
      const morphName = pick(slot.candidates, available);
      return morphName === null ? [] : [{ morphName, weight: slot.weight }];
    });
  }

  const visemes = {} as Record<Viseme, string | null>;
  for (const viseme of Object.keys(VISEME_CANDIDATES) as Viseme[]) {
    visemes[viseme] = pick(VISEME_CANDIDATES[viseme], available);
  }

  return { emotions, visemes, blink: pick(BLINK_CANDIDATES, available) };
}

/**
 * 既定の割り当てに利用者の指定を重ねる。
 *
 * 指定のある感情はまるごと置き換える。部分的に混ぜると、どこまでが
 * 利用者の意思なのか分からなくなる。指定の無い感情は既定のまま残す。
 *
 * 存在しないモーフ名は落とす。モデルを差し替えたあとの古い設定が残って
 * いても壊れないようにするため。
 */
export function applyOverrides(
  base: PmxMapping,
  overrides: Readonly<Partial<Record<CanonicalEmotion, readonly MorphTarget[]>>>,
  availableMorphs: readonly string[],
): PmxMapping {
  const available = new Set(availableMorphs);
  const emotions = { ...base.emotions } as Record<CanonicalEmotion, readonly MorphTarget[]>;

  for (const emotion of CANONICAL_EMOTIONS) {
    const specified = overrides[emotion];
    if (specified === undefined) continue;
    emotions[emotion] = specified.filter((target) => available.has(target.morphName));
  }

  return { ...base, emotions };
}

/** その感情を表現できるか。1 つでも当たっていれば表現できるとみなす。 */
export function canExpress(mapping: PmxMapping, emotion: CanonicalEmotion): boolean {
  if (emotion === "neutral") return true;
  return mapping.emotions[emotion].length > 0;
}
