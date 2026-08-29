import { describe, expect, it } from "vitest";
import { armLoweringAngle, DEFAULT_ARM_DECLINATION_DEGREES } from "./rest-pose";

const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

describe("armLoweringAngle", () => {
  it("水平な腕は目標角度ぶん下ろす", () => {
    // T ポーズ
    expect(toDegrees(armLoweringAngle(0))).toBeCloseTo(
      DEFAULT_ARM_DECLINATION_DEGREES,
      6,
    );
  });

  it("既に目標まで下がっていれば動かさない", () => {
    // A ポーズのモデルを二重に回すと腕が体へめり込む
    const y = -Math.sin((DEFAULT_ARM_DECLINATION_DEGREES * Math.PI) / 180);
    expect(armLoweringAngle(y)).toBe(0);
  });

  it("目標より下がっていても戻さない", () => {
    expect(armLoweringAngle(-0.9)).toBe(0);
  });

  it("少しだけ下がっている腕は差分だけ回す", () => {
    // 20 度下がっていれば、残り 15 度
    const y = -Math.sin((20 * Math.PI) / 180);
    expect(toDegrees(armLoweringAngle(y))).toBeCloseTo(15, 6);
  });

  it("上を向いている腕は大きく回す", () => {
    const y = Math.sin((30 * Math.PI) / 180);
    expect(toDegrees(armLoweringAngle(y))).toBeCloseTo(65, 6);
  });

  it("目標角度を変えられる", () => {
    expect(toDegrees(armLoweringAngle(0, 60))).toBeCloseTo(60, 6);
  });

  it("定義域を外れた値でも壊れない", () => {
    // 正規化の誤差で 1 をわずかに超えることがある
    expect(Number.isFinite(armLoweringAngle(1.0000001))).toBe(true);
    expect(Number.isFinite(armLoweringAngle(-1.0000001))).toBe(true);
    expect(armLoweringAngle(-1.5)).toBe(0);
  });

  it("真上を向いていれば 90 度に目標を足した角度になる", () => {
    expect(toDegrees(armLoweringAngle(1))).toBeCloseTo(
      90 + DEFAULT_ARM_DECLINATION_DEGREES,
      6,
    );
  });
});
