import type { CanonicalEmotion } from "../emotion/types";
import { clamp01, type WeightMap } from "./types";

export type ExpressionConfig = {
  /** 感情を切り替える補間時間。瞬時に切り替えると人形に見える。 */
  readonly transitionSeconds: number;
};

export const DEFAULT_EXPRESSION_CONFIG: ExpressionConfig = {
  transitionSeconds: 0.25,
};

/**
 * 表情の遷移状態。
 *
 * 遷移の開始点を「感情」ではなく「そのときの重み」として持つのが要点。
 * 遷移の途中で新しい感情が届いても、現在の見た目から連続に繋がる。
 * 開始点を旧感情にすると、割り込みのたびに表情が飛ぶ。
 */
export type ExpressionState = {
  readonly from: WeightMap;
  readonly to: WeightMap;
  readonly elapsed: number;
  readonly duration: number;
};

const EMPTY: WeightMap = {};

export function createExpressionState(): ExpressionState {
  return { from: EMPTY, to: EMPTY, elapsed: 0, duration: 0 };
}

/** neutral は「すべての表情が 0」であり、専用のモーフを持たない。 */
function targetWeights(
  emotion: CanonicalEmotion,
  intensity: number,
): WeightMap {
  if (emotion === "neutral") return EMPTY;
  return { [emotion]: clamp01(intensity) };
}

export function evaluateExpression(state: ExpressionState): WeightMap {
  const ratio =
    state.duration <= 0 ? 1 : clamp01(state.elapsed / state.duration);

  const result: Record<string, number> = {};
  const keys = new Set([...Object.keys(state.from), ...Object.keys(state.to)]);
  for (const key of keys) {
    const weight =
      (state.from[key] ?? 0) * (1 - ratio) + (state.to[key] ?? 0) * ratio;
    // ごく小さい重みは落として写像を小さく保つ
    if (weight > 1e-6) result[key] = weight;
  }
  return result;
}

/** 目標の感情を切り替える。現在の見た目を開始点として遷移を始める。 */
export function setExpressionTarget(
  state: ExpressionState,
  emotion: CanonicalEmotion,
  intensity = 1,
  config: ExpressionConfig = DEFAULT_EXPRESSION_CONFIG,
): ExpressionState {
  return {
    from: evaluateExpression(state),
    to: targetWeights(emotion, intensity),
    elapsed: 0,
    duration: Math.max(0, config.transitionSeconds),
  };
}

export function advanceExpression(
  state: ExpressionState,
  deltaSeconds: number,
): ExpressionState {
  if (deltaSeconds <= 0) return state;
  if (state.elapsed >= state.duration) return state;
  return { ...state, elapsed: Math.min(state.duration, state.elapsed + deltaSeconds) };
}
