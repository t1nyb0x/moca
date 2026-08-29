import { describe, expect, it } from "vitest";
import { nextFloat, nextInRange, type RngState } from "./rng";

describe("nextFloat", () => {
  it("同じ状態からは常に同じ値が出る", () => {
    const a = nextFloat(12345 as RngState);
    const b = nextFloat(12345 as RngState);
    expect(a).toEqual(b);
  });

  it("状態を進めると別の値が出る", () => {
    const first = nextFloat(1 as RngState);
    const second = nextFloat(first.state);
    expect(second.value).not.toBe(first.value);
  });

  it("値は 0 以上 1 未満に収まる", () => {
    let state = 42 as RngState;
    for (let i = 0; i < 10_000; i += 1) {
      const next = nextFloat(state);
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(1);
      state = next.state;
    }
  });

  it("偏りが極端でない", () => {
    let state = 7 as RngState;
    const buckets = new Array<number>(10).fill(0);
    const samples = 20_000;
    for (let i = 0; i < samples; i += 1) {
      const next = nextFloat(state);
      const index = Math.min(9, Math.floor(next.value * 10));
      buckets[index] = (buckets[index] ?? 0) + 1;
      state = next.state;
    }
    // 一様なら各バケット 10%。5%〜15% に収まっていれば実用上十分。
    for (const count of buckets) {
      expect(count / samples).toBeGreaterThan(0.05);
      expect(count / samples).toBeLessThan(0.15);
    }
  });
});

describe("nextInRange", () => {
  it("指定した範囲に収まる", () => {
    let state = 99 as RngState;
    for (let i = 0; i < 5_000; i += 1) {
      const next = nextInRange(state, 2, 6);
      expect(next.value).toBeGreaterThanOrEqual(2);
      expect(next.value).toBeLessThan(6);
      state = next.state;
    }
  });

  it("min と max が等しければその値を返す", () => {
    expect(nextInRange(1 as RngState, 3, 3).value).toBe(3);
  });
});
