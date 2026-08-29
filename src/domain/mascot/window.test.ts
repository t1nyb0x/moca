import { describe, expect, it } from "vitest";
import {
  canEnterMascot,
  clampScale,
  DEFAULT_SCALE,
  MASCOT_ASPECT,
  MAX_SCALE,
  MIN_SCALE,
  mascotWindowSize,
} from "./window";

describe("clampScale", () => {
  it("範囲の内側はそのまま返す", () => {
    expect(clampScale(0.5)).toBe(0.5);
  });

  it("下限より小さければ下限まで戻す", () => {
    // 小さくしすぎると掴めなくなり、枠なしの窓が操作できなくなる (F-13-3)
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(-1)).toBe(MIN_SCALE);
  });

  it("上限より大きければ上限まで戻す", () => {
    expect(clampScale(2)).toBe(MAX_SCALE);
  });

  it("数として読めない値は既定へ倒す", () => {
    // 設定ファイルが壊れていても操作できない窓を作らない
    expect(clampScale(Number.NaN)).toBe(DEFAULT_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SCALE);
  });

  it("下限は 0 より大きい", () => {
    expect(MIN_SCALE).toBeGreaterThan(0);
  });
});

describe("canEnterMascot", () => {
  it("モデルが表示されていれば入れる", () => {
    expect(canEnterMascot({ hasModel: true, showViewer: true })).toBe(true);
  });

  it("モデルが無ければ入れない", () => {
    // 全面が透明になり、全面がクリックスルーになる (F-13-1)
    expect(canEnterMascot({ hasModel: false, showViewer: true })).toBe(false);
  });

  it("3D ビューを隠していれば入れない", () => {
    expect(canEnterMascot({ hasModel: true, showViewer: false })).toBe(false);
  });

  it("どちらも欠けていれば入れない", () => {
    expect(canEnterMascot({ hasModel: false, showViewer: false })).toBe(false);
  });
});

describe("mascotWindowSize", () => {
  it("倍率は画面の高さに対する割合として効く", () => {
    const size = mascotWindowSize(0.5, 1000);
    expect(size.height).toBe(500);
  });

  it("横幅は縦横比から決まる", () => {
    const size = mascotWindowSize(0.5, 1000);
    expect(size.width).toBe(Math.round(500 * MASCOT_ASPECT));
  });

  it("整数の画素にそろえる", () => {
    const size = mascotWindowSize(0.333, 999);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });

  it("範囲外の倍率は収めてから使う", () => {
    expect(mascotWindowSize(99, 1000)).toEqual(mascotWindowSize(MAX_SCALE, 1000));
    expect(mascotWindowSize(0, 1000)).toEqual(mascotWindowSize(MIN_SCALE, 1000));
  });

  it("画面の高さが取れなくても潰れない", () => {
    // 0 を返す環境があっても、掴めない大きさの窓を作らない
    const size = mascotWindowSize(0.5, 0);
    expect(size.height).toBeGreaterThan(0);
    expect(size.width).toBeGreaterThan(0);
  });
});
