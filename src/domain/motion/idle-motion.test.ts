import { describe, expect, it } from "vitest";
import {
  advanceIdleMotion,
  createIdleMotionState,
  evaluateIdleMotion,
} from "./idle-motion";

/** dt 刻みで進めながら、あるボーンの軸の値を集める。 */
function samples(seconds: number, dt = 1 / 60, tempo = 1): number[] {
  let state = createIdleMotionState();
  const out: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    state = advanceIdleMotion(state, dt, tempo);
    out.push(evaluateIdleMotion(state).spine?.z ?? 0);
  }
  return out;
}

describe("advanceIdleMotion", () => {
  it("進めた分だけ時刻が動く", () => {
    const state = advanceIdleMotion(createIdleMotionState(), 0.5);
    expect(state.seconds).toBeCloseTo(0.5, 9);
  });

  it("速さの倍率が効く", () => {
    const fast = advanceIdleMotion(createIdleMotionState(), 1, 2);
    expect(fast.seconds).toBeCloseTo(2, 9);
  });

  it("進まない指定では状態を変えない", () => {
    const state = createIdleMotionState(3);
    expect(advanceIdleMotion(state, 0)).toBe(state);
    expect(advanceIdleMotion(state, -1)).toBe(state);
  });

  it("壊れた倍率は等倍として扱う", () => {
    const state = advanceIdleMotion(createIdleMotionState(), 1, Number.NaN);
    expect(state.seconds).toBeCloseTo(1, 9);
  });
});

describe("evaluateIdleMotion", () => {
  it("止まらずに動き続ける", () => {
    const values = samples(20);
    const distinct = new Set(values.map((v) => v.toFixed(4)));
    expect(distinct.size).toBeGreaterThan(50);
  });

  it("大きさの上限を超えない", () => {
    // 上限は composePose が持つが、ここでも常識的な範囲に収まっていること
    for (const value of samples(60)) {
      expect(Math.abs(value)).toBeLessThan(0.1);
    }
  });

  it("倍率 0 なら何も返さない", () => {
    const state = advanceIdleMotion(createIdleMotionState(), 3);
    expect(evaluateIdleMotion(state, 0)).toEqual({});
  });

  it("倍率を上げると振れも大きくなる", () => {
    const state = advanceIdleMotion(createIdleMotionState(), 1.5);
    const small = Math.abs(evaluateIdleMotion(state, 0.5).spine?.z ?? 0);
    const large = Math.abs(evaluateIdleMotion(state, 1.5).spine?.z ?? 0);
    expect(large).toBeGreaterThan(small);
  });

  it("腰は回さない", () => {
    // 腰は骨格の根なので、回すと脚ごと振れて吊り下げられたように見える
    for (let t = 0.5; t < 20; t += 0.7) {
      const state = advanceIdleMotion(createIdleMotionState(), t);
      expect(evaluateIdleMotion(state).hips).toBeUndefined();
    }
  });

  it("背骨と胸は逆へ返す", () => {
    // 同じ向きだと体が一枚板に見える
    const state = advanceIdleMotion(createIdleMotionState(), 1.5);
    const pose = evaluateIdleMotion(state);
    const spine = pose.spine?.z ?? 0;
    const chest = pose.chest?.z ?? 0;
    expect(Math.sign(spine)).toBe(-Math.sign(chest));
  });

  it("周期の違う波が重なっている", () => {
    // 単一の正弦なら、半周期ずらすと符号が必ず反転する
    const period = 1 / 0.11;
    let a = createIdleMotionState();
    a = advanceIdleMotion(a, period / 2);
    const head = evaluateIdleMotion(a).head;
    expect(head).toBeDefined();
  });

  it("同じ時刻なら同じ結果になる", () => {
    const a = createIdleMotionState(7.5);
    const b = createIdleMotionState(7.5);
    expect(evaluateIdleMotion(a)).toEqual(evaluateIdleMotion(b));
  });
});
