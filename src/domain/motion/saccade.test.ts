import { describe, expect, it } from "vitest";
import {
  advanceSaccade,
  createSaccadeState,
  DEFAULT_SACCADE_CONFIG as CFG,
  evaluateSaccade,
  type SaccadeState,
} from "./saccade";

function run(seed: number, seconds: number, dt: number): SaccadeState[] {
  let state = createSaccadeState(seed);
  const states: SaccadeState[] = [];
  for (let t = 0; t < seconds; t += dt) {
    state = advanceSaccade(state, dt);
    states.push(state);
  }
  return states;
}

describe("SaccadeController", () => {
  it("視線の変位が可動域を超えない", () => {
    for (const state of run(1, 120, 1 / 60)) {
      expect(Math.abs(state.x)).toBeLessThanOrEqual(CFG.amplitude + 1e-9);
      expect(Math.abs(state.y)).toBeLessThanOrEqual(CFG.amplitude + 1e-9);
    }
  });

  it("重みは常に 0〜1 に収まる", () => {
    for (const state of run(2, 60, 1 / 60)) {
      for (const weight of Object.values(evaluateSaccade(state))) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it("左右および上下が同時に立つことはない", () => {
    for (const state of run(3, 60, 1 / 60)) {
      const w = evaluateSaccade(state);
      expect(Math.min(w.lookLeft ?? 0, w.lookRight ?? 0)).toBe(0);
      expect(Math.min(w.lookUp ?? 0, w.lookDown ?? 0)).toBe(0);
    }
  });

  it("開始時は正面を向いている", () => {
    expect(evaluateSaccade(createSaccadeState(1))).toEqual({
      lookRight: 0,
      lookLeft: 0,
      lookUp: 0,
      lookDown: 0,
    });
  });

  it("最大間隔のうちに目標が変わる", () => {
    const states = run(4, CFG.maxIntervalSeconds * 3, 1 / 120);
    const targets = new Set(states.map((s) => `${s.targetX},${s.targetY}`));
    expect(targets.size).toBeGreaterThan(1);
  });

  it("視線が実際に動く", () => {
    const states = run(5, 10, 1 / 60);
    const moved = states.some((s) => Math.abs(s.x) > 0.01 || Math.abs(s.y) > 0.01);
    expect(moved).toBe(true);
  });

  it("同じ seed からは同じ系列が出る", () => {
    expect(run(11, 20, 1 / 60)).toEqual(run(11, 20, 1 / 60));
  });

  it("大きな dt でも可動域を超えない", () => {
    let state = createSaccadeState(6);
    for (let i = 0; i < 200; i += 1) {
      state = advanceSaccade(state, 2.5);
      expect(Math.abs(state.x)).toBeLessThanOrEqual(CFG.amplitude + 1e-9);
      expect(state.timeToNext).toBeGreaterThan(0);
    }
  });

  it("負の dt を無視する", () => {
    const state = createSaccadeState(1);
    expect(advanceSaccade(state, -1)).toEqual(state);
  });
});
