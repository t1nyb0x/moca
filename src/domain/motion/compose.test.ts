import { describe, expect, it } from "vitest";
import { composeWeights, EMOTION_KEYS, VISEME_KEYS } from "./compose";
import type { WeightMap } from "./types";

const empty: WeightMap = {};

function compose(input: {
  expression?: WeightMap;
  lipSync?: WeightMap;
  idle?: WeightMap[];
}): WeightMap {
  return composeWeights({
    expression: input.expression ?? empty,
    lipSync: input.lipSync ?? empty,
    idle: input.idle ?? [],
  });
}

describe("composeWeights", () => {
  it("何も無ければ空を返す", () => {
    expect(compose({})).toEqual({});
  });

  it("複数の入力を重ねる", () => {
    const result = compose({
      expression: { happy: 0.8 },
      idle: [{ blink: 1 }, { lookLeft: 0.2 }],
    });
    expect(result).toEqual({ happy: 0.8, blink: 1, lookLeft: 0.2 });
  });

  it("同じキーは最大値を採る", () => {
    const result = compose({ idle: [{ blink: 0.3 }, { blink: 0.9 }, { blink: 0.5 }] });
    expect(result.blink).toBe(0.9);
  });

  it("重みが 0 のキーは落とす", () => {
    expect(compose({ idle: [{ blink: 0 }] })).toEqual({});
  });

  it("重みを 0〜1 に丸める", () => {
    const result = compose({ idle: [{ blink: 5 }] });
    expect(result.blink).toBe(1);
  });

  describe("発話中の口", () => {
    it("リップシンクの口形が感情由来の口形を押しのける", () => {
      // 混ざると口が半端に開いたまま固まる
      const result = compose({
        expression: { aa: 0.9, happy: 1 },
        lipSync: { ih: 0.7 },
      });
      expect(result.aa).toBeUndefined();
      expect(result.ih).toBe(0.7);
      expect(result.happy).toBe(1);
    });

    it("発話していなければ感情由来の口形を残す", () => {
      const result = compose({ expression: { aa: 0.4 }, lipSync: {} });
      expect(result.aa).toBe(0.4);
    });

    it("リップシンクの重みが 0 なら発話中とみなさない", () => {
      const result = compose({ expression: { aa: 0.4 }, lipSync: { ih: 0 } });
      expect(result.aa).toBe(0.4);
    });
  });

  describe("群の正規化", () => {
    it("感情の合計が 1 を超えたら比率を保って縮める", () => {
      const result = compose({ expression: { happy: 1, sad: 1 } });
      const total = EMOTION_KEYS.reduce((sum, key) => sum + (result[key] ?? 0), 0);
      expect(total).toBeCloseTo(1, 6);
      expect(result.happy).toBeCloseTo(0.5, 6);
      expect(result.sad).toBeCloseTo(0.5, 6);
    });

    it("合計が 1 以下なら触らない", () => {
      const result = compose({ expression: { happy: 0.3, sad: 0.2 } });
      expect(result.happy).toBe(0.3);
      expect(result.sad).toBe(0.2);
    });

    it("口形の群も正規化する", () => {
      const result = compose({ lipSync: { aa: 1, ih: 1 } });
      const total = VISEME_KEYS.reduce((sum, key) => sum + (result[key] ?? 0), 0);
      expect(total).toBeCloseTo(1, 6);
    });

    it("群の外側は正規化の影響を受けない", () => {
      const result = compose({
        expression: { happy: 1, sad: 1 },
        idle: [{ blink: 1 }],
      });
      expect(result.blink).toBe(1);
    });
  });

  it("入力を変更しない", () => {
    const expression = { happy: 1, sad: 1 };
    const lipSync = { aa: 0.5 };
    const idle = [{ blink: 1 }];
    const snapshot = JSON.stringify({ expression, lipSync, idle });

    compose({ expression, lipSync, idle });

    expect(JSON.stringify({ expression, lipSync, idle })).toBe(snapshot);
  });

  it("出力の重みは常に 0 より大きく 1 以下", () => {
    const result = compose({
      expression: { happy: 1, sad: 1, angry: 1 },
      lipSync: { aa: 1, ih: 1 },
      idle: [{ blink: 1 }, { lookUp: 0.3 }],
    });
    for (const value of Object.values(result)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
