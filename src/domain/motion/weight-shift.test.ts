import { describe, expect, it } from "vitest";

import {
  advanceWeightShift,
  createWeightShiftState,
  DEFAULT_WEIGHT_SHIFT_CONFIG,
  evaluateWeightShift,
  weightBias,
} from "./weight-shift";

/** 秒数を進めた状態。 */
function at(seconds: number) {
  return createWeightShiftState(seconds);
}

/** ひと往復ぶんを刻んで bias を並べる。 */
function samples(count: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(weightBias(at(i * step)));
  return out;
}

describe("advanceWeightShift", () => {
  it("経過秒を積む", () => {
    expect(advanceWeightShift(at(1), 0.5).seconds).toBeCloseTo(1.5);
  });

  it("進まない時間では状態を変えない", () => {
    const state = at(1);
    expect(advanceWeightShift(state, 0)).toBe(state);
    expect(advanceWeightShift(state, -1)).toBe(state);
  });

  it("速さの倍率が効く", () => {
    expect(advanceWeightShift(at(0), 1, 2).seconds).toBeCloseTo(2);
  });

  it("おかしな倍率は等倍として扱う", () => {
    expect(advanceWeightShift(at(0), 1, Number.NaN).seconds).toBeCloseTo(1);
    expect(advanceWeightShift(at(0), 1, -3).seconds).toBeCloseTo(1);
  });
});

describe("weightBias", () => {
  it("-1 から 1 に収まる", () => {
    for (const value of samples(400, 0.4)) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("左右のどちらへも寄る", () => {
    const values = samples(400, 0.4);
    expect(Math.max(...values)).toBeGreaterThan(0.8);
    expect(Math.min(...values)).toBeLessThan(-0.8);
  });

  it("片側に留まる時間がある", () => {
    // 正弦のままだと絶えず動き続け、振り子に見える。端で寝ていること。
    const values = samples(400, 0.4);
    const settled = values.filter((value) => Math.abs(value) > 0.9).length;
    expect(settled / values.length).toBeGreaterThan(0.4);
  });

  it("乗せ替えは留まる時間より短い", () => {
    const values = samples(400, 0.4);
    const moving = values.filter((value) => Math.abs(value) < 0.5).length;
    expect(moving / values.length).toBeLessThan(0.25);
  });

  it("留まる強さを 0 に近づけると正弦に戻る", () => {
    const config = { ...DEFAULT_WEIGHT_SHIFT_CONFIG, hold: 0.01 };
    const value = weightBias(at(3), config);
    expect(Math.abs(value)).toBeLessThan(0.1);
  });
});

describe("evaluateWeightShift", () => {
  it("骨盤の傾きを股関節で打ち消す", () => {
    // 打ち消さないと脚ごと振れて、吊り下げられた人形に見える
    const pose = evaluateWeightShift(at(3));
    const pelvis = pose["hips"]?.z ?? 0;
    expect(pelvis).not.toBe(0);
    expect(pose["leftUpperLeg"]?.z).toBeCloseTo(-pelvis);
    expect(pose["rightUpperLeg"]?.z).toBeCloseTo(-pelvis);
  });

  it("上体を骨盤と逆へ返す", () => {
    // 返さないと体が傾いたままになり、頭が支持脚の上から外れる
    const pose = evaluateWeightShift(at(3));
    const pelvis = pose["hips"]?.z ?? 0;
    expect(Math.sign(pose["spine"]?.z ?? 0)).toBe(-Math.sign(pelvis));
    expect(Math.sign(pose["chest"]?.z ?? 0)).toBe(-Math.sign(pelvis));
  });

  it("肩の線は骨盤とわずかに逆を向く", () => {
    // 骨盤 +1 に対し、背骨 -0.7 と胸 -0.5 で合計 -0.2。いわゆる S 字。
    const pose = evaluateWeightShift(at(3));
    const pelvis = pose["hips"]?.z ?? 0;
    const shoulder = pelvis + (pose["spine"]?.z ?? 0) + (pose["chest"]?.z ?? 0);
    expect(Math.sign(shoulder)).toBe(-Math.sign(pelvis));
    expect(Math.abs(shoulder)).toBeLessThan(Math.abs(pelvis));
  });

  it("体重が乗っていない側の膝を緩める", () => {
    // 左の腰が上がっていれば支持脚は左。緩めるのは右。
    const seconds = [...Array(200).keys()]
      .map((index) => index * 0.4)
      .find((value) => weightBias(at(value)) > 0.9);
    expect(seconds).toBeDefined();

    const pose = evaluateWeightShift(at(seconds ?? 0));
    expect(pose["rightLowerLeg"]?.x).toBeGreaterThan(0);
    expect(pose["leftLowerLeg"]).toBeUndefined();
  });

  it("反対へ乗せ替えると緩める脚も入れ替わる", () => {
    const seconds = [...Array(200).keys()]
      .map((index) => index * 0.4)
      .find((value) => weightBias(at(value)) < -0.9);
    expect(seconds).toBeDefined();

    const pose = evaluateWeightShift(at(seconds ?? 0));
    expect(pose["leftLowerLeg"]?.x).toBeGreaterThan(0);
    expect(pose["rightLowerLeg"]).toBeUndefined();
  });

  it("乗せ替えの最中はどちらの膝も緩めない", () => {
    // 中間は両脚で支えている。緩めると宙に浮いた足ができる。
    const seconds = [...Array(400).keys()]
      .map((index) => index * 0.2)
      .find((value) => Math.abs(weightBias(at(value))) < 0.2);
    expect(seconds).toBeDefined();

    const pose = evaluateWeightShift(at(seconds ?? 0));
    expect(pose["leftLowerLeg"]).toBeUndefined();
    expect(pose["rightLowerLeg"]).toBeUndefined();
  });

  it("膝を曲げた側は腿を前へ出す", () => {
    // 曲げたぶん足が浮く。踵が軽く上がる形にして目立たなくする。
    const seconds = [...Array(200).keys()]
      .map((index) => index * 0.4)
      .find((value) => weightBias(at(value)) > 0.9);
    const pose = evaluateWeightShift(at(seconds ?? 0));
    expect(pose["rightUpperLeg"]?.x).toBeLessThan(0);
  });

  it("緩めた側でも股関節の打ち消しは残す", () => {
    const seconds = [...Array(200).keys()]
      .map((index) => index * 0.4)
      .find((value) => weightBias(at(value)) > 0.9);
    const pose = evaluateWeightShift(at(seconds ?? 0));
    expect(pose["rightUpperLeg"]?.z).toBeCloseTo(-(pose["hips"]?.z ?? 0));
  });

  it("大きさの倍率で薄まる", () => {
    const full = evaluateWeightShift(at(3), 1);
    const half = evaluateWeightShift(at(3), 0.5);
    expect(half["hips"]?.z).toBeCloseTo((full["hips"]?.z ?? 0) * 0.5);
  });

  it("倍率 0 では何も出さない", () => {
    expect(evaluateWeightShift(at(3), 0)).toEqual({});
  });

  it("おかしな倍率も 0 として扱う", () => {
    expect(evaluateWeightShift(at(3), Number.NaN)).toEqual({});
    expect(evaluateWeightShift(at(3), -1)).toEqual({});
  });

  it("傾きは上限に収まる大きさに留める", () => {
    // composePose の上限 0.3 に対し、他の層と重なっても余裕を残す
    const pose = evaluateWeightShift(at(3));
    for (const rotation of Object.values(pose)) {
      for (const value of Object.values(rotation)) {
        expect(Math.abs(value)).toBeLessThan(0.1);
      }
    }
  });
});
