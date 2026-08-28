import { describe, expect, it } from "vitest";
import { clamp01 } from "./types";

describe("clamp01", () => {
  it.each([
    [0, 0],
    [1, 1],
    [0.5, 0.5],
    [-0.3, 0],
    [1.7, 1],
    [Number.NEGATIVE_INFINITY, 0],
    [Number.POSITIVE_INFINITY, 1],
  ])("%f を %f に丸める", (input, expected) => {
    expect(clamp01(input)).toBe(expected);
  });

  it("NaN は 0 として扱う", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
