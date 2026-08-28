import { describe, expect, it } from "vitest";
import {
  advanceBreath,
  createBreathState,
  DEFAULT_BREATH_CONFIG as CFG,
  evaluateBreath,
} from "./breath";

describe("BreathController", () => {
  it("位相は常に 0 以上 1 未満に収まる", () => {
    let state = createBreathState();
    for (let i = 0; i < 10_000; i += 1) {
      state = advanceBreath(state, 1 / 60);
      expect(state.phase).toBeGreaterThanOrEqual(0);
      expect(state.phase).toBeLessThan(1);
    }
  });

  it("回転量が振幅を超えない", () => {
    let state = createBreathState();
    for (let i = 0; i < 10_000; i += 1) {
      state = advanceBreath(state, 1 / 60);
      const out = evaluateBreath(state);
      expect(Math.abs(out.chestPitchRadians)).toBeLessThanOrEqual(
        CFG.amplitudeRadians + 1e-12,
      );
      expect(Math.abs(out.spinePitchRadians)).toBeLessThanOrEqual(
        CFG.amplitudeRadians * CFG.spineRatio + 1e-12,
      );
    }
  });

  it("1 周期ぶん進めると元の位相へ戻る", () => {
    const start = createBreathState(0.3);
    const after = advanceBreath(start, 1 / CFG.hz);
    expect(after.phase).toBeCloseTo(start.phase, 10);
  });

  it("脊椎は胸より控えめに動く", () => {
    const out = evaluateBreath(createBreathState(0.25));
    expect(Math.abs(out.spinePitchRadians)).toBeLessThan(
      Math.abs(out.chestPitchRadians),
    );
  });

  it("開始位相では回転量が 0 になる", () => {
    const out = evaluateBreath(createBreathState(0));
    expect(out.chestPitchRadians).toBeCloseTo(0, 12);
  });

  it("初期位相を 0〜1 に正規化する", () => {
    expect(createBreathState(2.25).phase).toBeCloseTo(0.25, 12);
    expect(createBreathState(-0.25).phase).toBeCloseTo(0.75, 12);
  });

  it("負の dt を無視する", () => {
    const state = createBreathState(0.5);
    expect(advanceBreath(state, -1)).toEqual(state);
  });
});
