import { describe, expect, it } from "vitest";
import {
  advanceEmotionMotion,
  createEmotionMotionState,
  DEFAULT_EMOTION_MOTION_CONFIG as CFG,
  evaluateEmotionMotion,
  setEmotionMotion,
  type EmotionMotionState,
} from "./emotion-motion";

/** 遷移も一撃も終わった状態まで進める。 */
function settled(state: EmotionMotionState): EmotionMotionState {
  return advanceEmotionMotion(state, Math.max(CFG.transitionSeconds, CFG.onsetSeconds) + 1);
}

describe("setEmotionMotion", () => {
  it("平常には偏りが無い", () => {
    const state = settled(setEmotionMotion(createEmotionMotionState(), "neutral"));
    expect(evaluateEmotionMotion(state).pose).toEqual({});
  });

  it("感情ごとに姿勢が違う", () => {
    const happy = settled(setEmotionMotion(createEmotionMotionState(), "happy"));
    const sad = settled(setEmotionMotion(createEmotionMotionState(), "sad"));
    expect(evaluateEmotionMotion(happy).pose).not.toEqual(
      evaluateEmotionMotion(sad).pose,
    );
  });

  it("うつむきと上向きが逆になっている", () => {
    const happy = settled(setEmotionMotion(createEmotionMotionState(), "happy"));
    const sad = settled(setEmotionMotion(createEmotionMotionState(), "sad"));
    const up = evaluateEmotionMotion(happy).pose.head?.x ?? 0;
    const down = evaluateEmotionMotion(sad).pose.head?.x ?? 0;
    expect(up).toBeLessThan(0);
    expect(down).toBeGreaterThan(0);
  });

  it("腕は左右で符号が反転する", () => {
    // 開く向きに揃える。片側だけ動くと不自然になる
    const state = settled(setEmotionMotion(createEmotionMotionState(), "happy"));
    const pose = evaluateEmotionMotion(state).pose;
    const left = pose.leftUpperArm?.z ?? 0;
    const right = pose.rightUpperArm?.z ?? 0;
    expect(left).not.toBe(0);
    expect(Math.sign(left)).toBe(-Math.sign(right));
  });

  it("強さのぶんだけ偏る", () => {
    const full = settled(setEmotionMotion(createEmotionMotionState(), "sad", 1));
    const half = settled(setEmotionMotion(createEmotionMotionState(), "sad", 0.5));
    const a = evaluateEmotionMotion(full).pose.head?.x ?? 0;
    const b = evaluateEmotionMotion(half).pose.head?.x ?? 0;
    expect(b).toBeCloseTo(a / 2, 6);
  });

  it("強さ 0 なら中立のまま", () => {
    const state = settled(setEmotionMotion(createEmotionMotionState(), "sad", 0));
    const out = evaluateEmotionMotion(state);
    expect(out.pose).toEqual({});
    expect(out.tempo).toBeCloseTo(1, 9);
    expect(out.amplitude).toBeCloseTo(1, 9);
  });

  it("待機の速さと大きさが感情で変わる", () => {
    const happy = settled(setEmotionMotion(createEmotionMotionState(), "happy"));
    const sad = settled(setEmotionMotion(createEmotionMotionState(), "sad"));
    expect(evaluateEmotionMotion(happy).tempo).toBeGreaterThan(1);
    expect(evaluateEmotionMotion(sad).tempo).toBeLessThan(1);
    expect(evaluateEmotionMotion(sad).amplitude).toBeLessThan(1);
  });
});

describe("立ち上がりの一撃", () => {
  it("驚きは切り替わった直後がいちばん大きい", () => {
    // 驚きは持続する姿勢ではなく、跳ねて戻るもの
    const start = setEmotionMotion(createEmotionMotionState(), "surprised");
    const now = Math.abs(evaluateEmotionMotion(start).pose.head?.x ?? 0);
    const later = Math.abs(
      evaluateEmotionMotion(settled(start)).pose.head?.x ?? 0,
    );
    expect(now).toBeGreaterThan(later);
  });

  it("一撃は時間で消える", () => {
    const start = setEmotionMotion(createEmotionMotionState(), "surprised");
    const mid = advanceEmotionMotion(start, CFG.onsetSeconds / 2);
    const end = advanceEmotionMotion(start, CFG.onsetSeconds + 0.1);

    const at = (s: EmotionMotionState) =>
      Math.abs(evaluateEmotionMotion(s).pose.leftShoulder?.z ?? 0);
    expect(at(start)).toBeGreaterThan(at(mid));
    expect(at(mid)).toBeGreaterThan(at(end));
  });

  it("悲しみには一撃が無い", () => {
    const start = setEmotionMotion(createEmotionMotionState(), "sad");
    const now = evaluateEmotionMotion(start).pose;
    // 遷移の始まりなので、まだほとんど動いていない
    expect(Math.abs(now.head?.x ?? 0)).toBeLessThan(0.01);
  });
});

describe("遷移", () => {
  // 一撃を持たない感情どうしで確かめる。一撃はわざと跳ねさせるものなので、
  // 混ぜると「飛ばない」ことを見られない。
  it("切り替えた直後は前の姿勢のまま", () => {
    const sad = settled(setEmotionMotion(createEmotionMotionState(), "sad"));
    const before = evaluateEmotionMotion(sad).pose.head?.x ?? 0;
    const switched = setEmotionMotion(sad, "relaxed");
    expect(evaluateEmotionMotion(switched).pose.head?.x).toBeCloseTo(before, 6);
  });

  it("遷移の途中で切り替えても飛ばない", () => {
    // 開始点を前の感情にすると、割り込みのたびに姿勢が跳ねる
    let state = setEmotionMotion(createEmotionMotionState(), "sad");
    state = advanceEmotionMotion(state, CFG.transitionSeconds / 2);
    const before = evaluateEmotionMotion(state).pose.head?.x ?? 0;

    const switched = setEmotionMotion(state, "relaxed");
    expect(evaluateEmotionMotion(switched).pose.head?.x).toBeCloseTo(before, 6);
  });

  it("一撃を持つ感情へ切り替えるとその場で振れる", () => {
    // これは意図した跳ね。驚きや喜びの立ち上がりを見せるためのもの
    const sad = settled(setEmotionMotion(createEmotionMotionState(), "sad"));
    const before = evaluateEmotionMotion(sad).pose.head?.x ?? 0;
    const switched = setEmotionMotion(sad, "surprised");
    const after = evaluateEmotionMotion(switched).pose.head?.x ?? 0;
    expect(after).toBeLessThan(before);
  });

  it("進めるほど目標へ近づく", () => {
    let state = setEmotionMotion(createEmotionMotionState(), "sad");
    const at = () => Math.abs(evaluateEmotionMotion(state).pose.head?.x ?? 0);
    const first = at();
    state = advanceEmotionMotion(state, CFG.transitionSeconds / 2);
    const middle = at();
    state = advanceEmotionMotion(state, CFG.transitionSeconds);
    expect(first).toBeLessThan(middle);
    expect(middle).toBeLessThan(at());
  });

  it("進まない指定では状態を変えない", () => {
    const state = setEmotionMotion(createEmotionMotionState(), "happy");
    expect(advanceEmotionMotion(state, 0)).toBe(state);
  });
});
