import { describe, expect, it } from "vitest";
import {
  advanceExpression,
  createExpressionState,
  DEFAULT_EXPRESSION_CONFIG as CFG,
  evaluateExpression,
  setExpressionTarget,
  type ExpressionState,
} from "./expression";
import { CANONICAL_EMOTIONS } from "../emotion/types";

const sum = (state: ExpressionState): number =>
  Object.values(evaluateExpression(state)).reduce((a, b) => a + b, 0);

/** 遷移が完了するまで進める。 */
function settle(state: ExpressionState): ExpressionState {
  return advanceExpression(state, CFG.transitionSeconds);
}

describe("ExpressionController", () => {
  it("初期状態はどの表情も出ていない", () => {
    expect(evaluateExpression(createExpressionState())).toEqual({});
  });

  it("遷移が完了すると目標の強度に達する", () => {
    const state = settle(
      setExpressionTarget(createExpressionState(), "happy", 0.8),
    );
    expect(evaluateExpression(state)).toEqual({ happy: 0.8 });
  });

  it("切り替えた直後はまだ前の表情が支配的", () => {
    const happy = settle(setExpressionTarget(createExpressionState(), "happy"));
    const switching = setExpressionTarget(happy, "sad");
    const weights = evaluateExpression(switching);
    expect(weights.happy).toBeCloseTo(1, 6);
    expect(weights.sad ?? 0).toBe(0);
  });

  it("遷移の途中では両方の表情が混ざる", () => {
    const happy = settle(setExpressionTarget(createExpressionState(), "happy"));
    const mid = advanceExpression(
      setExpressionTarget(happy, "sad"),
      CFG.transitionSeconds / 2,
    );
    const weights = evaluateExpression(mid);
    expect(weights.happy).toBeGreaterThan(0);
    expect(weights.sad).toBeGreaterThan(0);
  });

  it("合計の重みが 1 を超えない", () => {
    let state = createExpressionState();
    let seed = 1;
    for (let step = 0; step < 500; step += 1) {
      // 決定的に感情を巡回させながら細かく進める
      if (step % 7 === 0) {
        seed = (seed * 31 + 17) % CANONICAL_EMOTIONS.length;
        const emotion = CANONICAL_EMOTIONS[seed] ?? "neutral";
        state = setExpressionTarget(state, emotion, 1);
      }
      state = advanceExpression(state, 1 / 60);
      expect(sum(state)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("割り込んでも見た目が飛ばない", () => {
    let state = settle(setExpressionTarget(createExpressionState(), "happy"));
    state = advanceExpression(setExpressionTarget(state, "angry"), 0.1);

    const before = evaluateExpression(state);
    const after = evaluateExpression(setExpressionTarget(state, "sad"));
    expect(after).toEqual(before);
  });

  it("neutral へ切り替えるとすべての表情が消える", () => {
    const happy = settle(setExpressionTarget(createExpressionState(), "happy"));
    const neutral = settle(setExpressionTarget(happy, "neutral"));
    expect(evaluateExpression(neutral)).toEqual({});
  });

  it("neutral への遷移も補間される", () => {
    const happy = settle(setExpressionTarget(createExpressionState(), "happy"));
    const mid = advanceExpression(
      setExpressionTarget(happy, "neutral"),
      CFG.transitionSeconds / 2,
    );
    expect(evaluateExpression(mid).happy).toBeCloseTo(0.5, 2);
  });

  it("強度は 0〜1 に丸められる", () => {
    const over = settle(setExpressionTarget(createExpressionState(), "happy", 5));
    expect(evaluateExpression(over)).toEqual({ happy: 1 });
  });

  it("遷移は単調に進む", () => {
    let state = setExpressionTarget(createExpressionState(), "happy");
    let previous = 0;
    for (let i = 0; i < 30; i += 1) {
      state = advanceExpression(state, CFG.transitionSeconds / 20);
      const current = evaluateExpression(state).happy ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
    expect(previous).toBeCloseTo(1, 6);
  });

  it("完了後にさらに進めても変化しない", () => {
    const done = settle(setExpressionTarget(createExpressionState(), "sad"));
    expect(advanceExpression(done, 10)).toEqual(done);
  });

  it("負の dt を無視する", () => {
    const state = setExpressionTarget(createExpressionState(), "happy");
    expect(advanceExpression(state, -1)).toEqual(state);
  });
});
