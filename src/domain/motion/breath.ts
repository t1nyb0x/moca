/**
 * 呼吸。
 *
 * これだけはモーフではなくボーンの回転として出力する。VRM の表情に
 * 呼吸のプリセットは存在せず、胸部と脊椎をわずかに動かして表現する。
 */
export type BreathConfig = {
  /** 1 秒あたりの呼吸回数。安静時の成人でおよそ 0.25Hz。 */
  readonly hz: number;
  /** 胸部の最大回転量 (ラジアン)。 */
  readonly amplitudeRadians: number;
  /** 脊椎へ伝える割合。胸より控えめに動かす。 */
  readonly spineRatio: number;
};

export const DEFAULT_BREATH_CONFIG: BreathConfig = {
  hz: 0.25,
  amplitudeRadians: 0.02,
  spineRatio: 0.4,
};

export type BreathState = {
  /** 0 以上 1 未満の位相。 */
  readonly phase: number;
};

export type BreathOutput = {
  readonly chestPitchRadians: number;
  readonly spinePitchRadians: number;
};

export function createBreathState(initialPhase = 0): BreathState {
  return { phase: ((initialPhase % 1) + 1) % 1 };
}

export function advanceBreath(
  state: BreathState,
  deltaSeconds: number,
  config: BreathConfig = DEFAULT_BREATH_CONFIG,
): BreathState {
  if (deltaSeconds <= 0) return state;
  const advanced = state.phase + config.hz * deltaSeconds;
  return { phase: advanced - Math.floor(advanced) };
}

export function evaluateBreath(
  state: BreathState,
  config: BreathConfig = DEFAULT_BREATH_CONFIG,
): BreathOutput {
  const value = Math.sin(state.phase * Math.PI * 2) * config.amplitudeRadians;
  return {
    chestPitchRadians: value,
    spinePitchRadians: value * config.spineRatio,
  };
}
