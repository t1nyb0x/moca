import { CANONICAL_EMOTIONS, type CanonicalEmotion } from "@/domain/emotion/types";
import type { VoiceStyle } from "@/domain/voice/types";

/**
 * 正規化感情から声の作り方への既定の割り当て
 * (docs/emotion-protocol.md 第 5 章)。
 *
 * CeVIO は感情成分に数値を与えて表す。成分の顔ぶれはキャストごとに違う
 * ので、候補名から推測する。VOICEVOX には成分が無く、スタイルの選択が
 * その役目を果たすため、速さ・高さ・抑揚の調整で近似する。
 */

/** 感情成分の候補名。当たった最初のものを使う。 */
const COMPONENT_CANDIDATES: Readonly<Record<CanonicalEmotion, readonly string[]>> = {
  neutral: ["普通", "ノーマル", "normal"],
  happy: ["嬉しい", "うれしい", "喜び", "happy"],
  angry: ["怒り", "怒", "angry"],
  sad: ["哀しみ", "悲しみ", "哀しい", "悲しい", "sad"],
  relaxed: ["落ち着き", "穏やか", "リラックス", "relaxed"],
  // 驚きを専用成分として持つキャストは少ない
  surprised: ["驚き", "びっくり", "surprised"],
};

/**
 * 専用の成分が無いときの、抑揚と速さによる近似。
 *
 * **成分で表せている感情には掛けない。** 二重に効いて作り物めいた声になる。
 * CeVIO は抑揚を 50 から動かすほど平板に聞こえるため、成分が当たっている
 * かぎり触らないほうがよい。
 */
const PROSODY: Readonly<
  Record<CanonicalEmotion, Pick<VoiceStyle, "speed" | "pitch" | "intonation">>
> = {
  neutral: { speed: null, pitch: null, intonation: null },
  happy: { speed: 1.1, pitch: 0.35, intonation: 1.25 },
  angry: { speed: 1.15, pitch: 0.1, intonation: 1.4 },
  sad: { speed: 0.9, pitch: -0.3, intonation: 0.75 },
  relaxed: { speed: 0.95, pitch: -0.1, intonation: 0.85 },
  surprised: { speed: 1.1, pitch: 0.6, intonation: 1.4 },
};

/** 成分が当たったときは調整しない。 */
const NO_PROSODY: Pick<VoiceStyle, "speed" | "pitch" | "intonation"> = {
  speed: null,
  pitch: null,
  intonation: null,
};

/** 主となる成分の強さと、残りを埋める「普通」の強さ。 */
const PRIMARY_WEIGHT = 0.9;
const NEUTRAL_FILL = 0.1;

function pick(
  candidates: readonly string[],
  available: ReadonlySet<string>,
): string | null {
  return candidates.find((name) => available.has(name)) ?? null;
}

/**
 * 話者が持つ感情成分から既定の割り当てを求める。
 *
 * @param axes 接続先が返した成分名。VOICEVOX では空。
 *
 * 当たらなかった感情は成分を持たず、抑揚と速さだけで表す。何も当たらなく
 * ても声は出る。表情と同じく、揃わないと何も動かない作りにはしない。
 */
export function resolveDefaultPresets(
  axes: readonly string[],
): Record<CanonicalEmotion, VoiceStyle> {
  const available = new Set(axes);
  const neutralName = pick(COMPONENT_CANDIDATES.neutral, available);

  const presets = {} as Record<CanonicalEmotion, VoiceStyle>;

  for (const emotion of CANONICAL_EMOTIONS) {
    const components: Record<string, number> = {};
    const primary = pick(COMPONENT_CANDIDATES[emotion], available);

    if (emotion === "neutral") {
      if (neutralName !== null) components[neutralName] = 1;
    } else if (primary !== null) {
      components[primary] = PRIMARY_WEIGHT;
      if (neutralName !== null) components[neutralName] = NEUTRAL_FILL;
    } else if (neutralName !== null) {
      // 専用の成分が無い感情。声色は普通のまま、抑揚で差を出す。
      components[neutralName] = 1;
    }

    // 成分で表せているなら抑揚は触らない (上の PROSODY の注釈)
    const prosody = primary !== null ? NO_PROSODY : PROSODY[emotion];
    presets[emotion] = { speaker: null, components, ...prosody };
  }

  return presets;
}
