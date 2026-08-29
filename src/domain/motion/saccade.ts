import { nextInRange, seedRng, type RngState } from "./rng";
import { clamp01, type WeightMap } from "./types";

/**
 * サッケード（微小な視線のゆらぎ）。
 *
 * 視線が完全に静止していると人形に見える。数百ミリ秒ごとに目標を
 * 微小に振り、そこへ滑らかに追従させる。
 */
export type SaccadeConfig = {
  readonly minIntervalSeconds: number;
  readonly maxIntervalSeconds: number;
  /** 目標のずれの最大値。VRM の lookAt 表情の重みに対応する。 */
  readonly amplitude: number;
  /** 目標への追従の速さ (1/秒)。大きいほど機敏。 */
  readonly followPerSecond: number;
};

export const DEFAULT_SACCADE_CONFIG: SaccadeConfig = {
  minIntervalSeconds: 0.3,
  maxIntervalSeconds: 2.0,
  amplitude: 0.15,
  followPerSecond: 8,
};

export type SaccadeState = {
  readonly rng: RngState;
  readonly timeToNext: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly x: number;
  readonly y: number;
};

function pickTarget(
  rng: RngState,
  config: SaccadeConfig,
): { rng: RngState; x: number; y: number; interval: number } {
  const xs = nextInRange(rng, -config.amplitude, config.amplitude);
  const ys = nextInRange(xs.state, -config.amplitude, config.amplitude);
  const interval = nextInRange(
    ys.state,
    config.minIntervalSeconds,
    config.maxIntervalSeconds,
  );
  return {
    rng: interval.state,
    x: xs.value,
    y: ys.value,
    interval: interval.value,
  };
}

export function createSaccadeState(
  seed: number,
  config: SaccadeConfig = DEFAULT_SACCADE_CONFIG,
): SaccadeState {
  const picked = pickTarget(seedRng(seed), config);
  return {
    rng: picked.rng,
    timeToNext: picked.interval,
    targetX: picked.x,
    targetY: picked.y,
    x: 0,
    y: 0,
  };
}

export function advanceSaccade(
  state: SaccadeState,
  deltaSeconds: number,
  config: SaccadeConfig = DEFAULT_SACCADE_CONFIG,
): SaccadeState {
  if (deltaSeconds <= 0) return state;

  let { rng, timeToNext, targetX, targetY } = state;

  timeToNext -= deltaSeconds;
  if (timeToNext <= 0) {
    const picked = pickTarget(rng, config);
    rng = picked.rng;
    targetX = picked.x;
    targetY = picked.y;
    // 遅れぶんを繰り越さず即座に再スケジュールする。dt が大きくても
    // 目標が飛び続けないようにするため。
    timeToNext = picked.interval;
  }

  // 指数的な追従。dt が大きいときに行き過ぎないよう 1 で頭打ちにする。
  const factor = Math.min(1, config.followPerSecond * deltaSeconds);
  return {
    rng,
    timeToNext,
    targetX,
    targetY,
    x: state.x + (targetX - state.x) * factor,
    y: state.y + (targetY - state.y) * factor,
  };
}

export function evaluateSaccade(state: SaccadeState): WeightMap {
  return {
    lookRight: clamp01(Math.max(0, state.x)),
    lookLeft: clamp01(Math.max(0, -state.x)),
    lookUp: clamp01(Math.max(0, state.y)),
    lookDown: clamp01(Math.max(0, -state.y)),
  };
}
