import { nextInRange, seedRng, type RngState } from "./rng";
import { clamp01, type WeightMap } from "./types";

export type BlinkConfig = {
  readonly minIntervalSeconds: number;
  readonly maxIntervalSeconds: number;
  /** 閉じるまでの時間。まぶたは閉じるほうが速い。 */
  readonly closeSeconds: number;
  readonly openSeconds: number;
};

export const DEFAULT_BLINK_CONFIG: BlinkConfig = {
  minIntervalSeconds: 2,
  maxIntervalSeconds: 6,
  closeSeconds: 0.05,
  openSeconds: 0.07,
};

export type BlinkState = {
  readonly rng: RngState;
  /** 次のまばたき開始までの残り秒。 */
  readonly timeToNext: number;
  /** まばたき中の経過秒。null なら目を開いている。 */
  readonly phase: number | null;
};

export function createBlinkState(
  seed: number,
  config: BlinkConfig = DEFAULT_BLINK_CONFIG,
): BlinkState {
  const scheduled = nextInRange(
    seedRng(seed),
    config.minIntervalSeconds,
    config.maxIntervalSeconds,
  );
  return { rng: scheduled.state, timeToNext: scheduled.value, phase: null };
}

const blinkDuration = (config: BlinkConfig): number =>
  config.closeSeconds + config.openSeconds;

/**
 * 状態を進める。
 *
 * dt がまばたき 1 回ぶんより大きくても破綻しないよう、残り時間を
 * 消化しきるまで繰り返す。テストが粗い刻みで回せるようにするため。
 */
export function advanceBlink(
  state: BlinkState,
  deltaSeconds: number,
  config: BlinkConfig = DEFAULT_BLINK_CONFIG,
): BlinkState {
  let { rng, timeToNext, phase } = state;
  let remaining = Math.max(0, deltaSeconds);

  while (remaining > 0) {
    if (phase === null) {
      if (remaining < timeToNext) {
        timeToNext -= remaining;
        remaining = 0;
      } else {
        remaining -= timeToNext;
        timeToNext = 0;
        phase = 0;
      }
      continue;
    }

    const left = blinkDuration(config) - phase;
    if (remaining < left) {
      phase += remaining;
      remaining = 0;
    } else {
      remaining -= left;
      phase = null;
      const scheduled = nextInRange(
        rng,
        config.minIntervalSeconds,
        config.maxIntervalSeconds,
      );
      rng = scheduled.state;
      timeToNext = scheduled.value;
    }
  }

  return { rng, timeToNext, phase };
}

export function evaluateBlink(
  state: BlinkState,
  config: BlinkConfig = DEFAULT_BLINK_CONFIG,
): WeightMap {
  if (state.phase === null) return { blink: 0 };

  const weight =
    state.phase < config.closeSeconds
      ? state.phase / config.closeSeconds
      : 1 - (state.phase - config.closeSeconds) / config.openSeconds;

  return { blink: clamp01(weight) };
}
