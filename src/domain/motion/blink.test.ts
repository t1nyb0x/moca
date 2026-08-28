import { describe, expect, it } from "vitest";
import {
  advanceBlink,
  createBlinkState,
  DEFAULT_BLINK_CONFIG as CFG,
  evaluateBlink,
  type BlinkState,
} from "./blink";

/** dt 刻みで進めながら blink の重みを記録する。 */
function simulate(seed: number, seconds: number, dt: number): number[] {
  let state = createBlinkState(seed);
  const samples: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    state = advanceBlink(state, dt);
    samples.push(evaluateBlink(state).blink ?? 0);
  }
  return samples;
}

/** まばたきの開始時刻を拾う。 */
function blinkStartTimes(seed: number, seconds: number, dt: number): number[] {
  let state: BlinkState = createBlinkState(seed);
  const times: number[] = [];
  let wasBlinking = false;
  for (let t = 0; t < seconds; t += dt) {
    state = advanceBlink(state, dt);
    const blinking = state.phase !== null;
    if (blinking && !wasBlinking) times.push(t);
    wasBlinking = blinking;
  }
  return times;
}

describe("BlinkController", () => {
  it("重みは常に 0〜1 に収まる", () => {
    for (const weight of simulate(1, 60, 1 / 60)) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it("開始直後は目を開いている", () => {
    expect(evaluateBlink(createBlinkState(1))).toEqual({ blink: 0 });
  });

  it("最大間隔を超える前に必ずまばたきする", () => {
    const limit = CFG.maxIntervalSeconds + CFG.closeSeconds + CFG.openSeconds;
    for (let seed = 0; seed < 30; seed += 1) {
      const starts = blinkStartTimes(seed, limit, 1 / 120);
      expect(starts.length).toBeGreaterThan(0);
    }
  });

  it("まばたきの間隔が設定範囲に収まる", () => {
    const starts = blinkStartTimes(3, 300, 1 / 240);
    expect(starts.length).toBeGreaterThan(40);
    for (let i = 1; i < starts.length; i += 1) {
      const gap =
        (starts[i] ?? 0) - (starts[i - 1] ?? 0) - CFG.closeSeconds - CFG.openSeconds;
      // 刻み幅ぶんの誤差を許容する
      expect(gap).toBeGreaterThan(CFG.minIntervalSeconds - 0.05);
      expect(gap).toBeLessThan(CFG.maxIntervalSeconds + 0.05);
    }
  });

  it("まばたきの途中で重みが 1 に達する", () => {
    const peak = Math.max(...simulate(5, 60, 1 / 240));
    expect(peak).toBeGreaterThan(0.95);
  });

  it("同じ seed からは同じ系列が出る", () => {
    expect(simulate(77, 30, 1 / 60)).toEqual(simulate(77, 30, 1 / 60));
  });

  it("seed が違えば系列も違う", () => {
    expect(simulate(1, 30, 1 / 60)).not.toEqual(simulate(2, 30, 1 / 60));
  });

  it("大きな dt を与えても破綻しない", () => {
    let state = createBlinkState(9);
    for (let i = 0; i < 100; i += 1) {
      state = advanceBlink(state, 3.5);
      const weight = evaluateBlink(state).blink ?? 0;
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
      expect(state.timeToNext).toBeGreaterThanOrEqual(0);
    }
  });

  it("負の dt を無視する", () => {
    const state = createBlinkState(1);
    expect(advanceBlink(state, -5)).toEqual(state);
  });
});
