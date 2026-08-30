import { describe, expect, it } from "vitest";
import { composePose, MAX_ROTATION, scalePose } from "./pose";

describe("composePose", () => {
  it("何も無ければ空を返す", () => {
    expect(composePose([])).toEqual({});
  });

  it("同じボーンの同じ軸を足し合わせる", () => {
    const result = composePose([{ head: { x: 0.05 } }, { head: { x: 0.03 } }]);
    expect(result.head?.x).toBeCloseTo(0.08, 9);
  });

  it("別の軸は混ざらない", () => {
    const result = composePose([{ head: { x: 0.05 } }, { head: { z: 0.02 } }]);
    expect(result.head).toEqual({ x: 0.05, z: 0.02 });
  });

  it("別のボーンはそれぞれ残る", () => {
    const result = composePose([{ head: { x: 0.05 } }, { spine: { x: 0.02 } }]);
    expect(Object.keys(result).sort()).toEqual(["head", "spine"]);
  });

  it("上限を超えたら丸める", () => {
    // 層がたまたま同じ向きへ振れても折れた姿勢にしない
    const result = composePose([{ head: { x: 0.5 } }, { head: { x: 0.5 } }]);
    expect(result.head?.x).toBe(MAX_ROTATION);
  });

  it("負の側にも上限が効く", () => {
    const result = composePose([{ head: { x: -5 } }]);
    expect(result.head?.x).toBe(-MAX_ROTATION);
  });

  it("上限は指定できる", () => {
    const result = composePose([{ head: { x: 1 } }], 0.1);
    expect(result.head?.x).toBe(0.1);
  });

  it("打ち消し合ったボーンは落とす", () => {
    const result = composePose([{ head: { x: 0.05 } }, { head: { x: -0.05 } }]);
    expect(result.head).toBeUndefined();
  });

  it("数として読めない値は無視する", () => {
    const result = composePose([{ head: { x: Number.NaN } }, { head: { x: 0.04 } }]);
    expect(result.head?.x).toBeCloseTo(0.04, 9);
  });

  it("入力を変更しない", () => {
    const layer = { head: { x: 0.05 } };
    const snapshot = JSON.stringify(layer);
    composePose([layer, { head: { x: 0.05 } }]);
    expect(JSON.stringify(layer)).toBe(snapshot);
  });
});

describe("scalePose", () => {
  it("回転を一律に薄める", () => {
    const result = scalePose({ head: { x: 0.1, z: -0.2 } }, 0.5);
    expect(result.head?.x).toBeCloseTo(0.05, 9);
    expect(result.head?.z).toBeCloseTo(-0.1, 9);
  });

  it("0 なら動かない姿勢になる", () => {
    const result = scalePose({ head: { x: 0.1 } }, 0);
    expect(result.head?.x).toBe(0);
  });

  it("指定の無い軸は増やさない", () => {
    const result = scalePose({ head: { x: 0.1 } }, 0.5);
    expect(result.head).toEqual({ x: 0.05 });
  });

  it("数として読めない倍率では空を返す", () => {
    expect(scalePose({ head: { x: 0.1 } }, Number.NaN)).toEqual({});
  });
});
