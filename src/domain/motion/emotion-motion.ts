/**
 * 感情に応じた姿勢と、待機の動きの質 (要件 F-14-2)。
 *
 * 姿勢だけを変えても案外伝わらない。同じ揺れでも、速く小刻みなら高揚に、
 * 遅く小さければ沈みに見える。**どこで止まっているか**と**どう揺れているか**
 * の両方を感情で変える。
 *
 * 姿勢は 2 つに分ける。驚きだけは持続する姿勢ではなく、跳ねて戻るもので
 * あるため、立ち上がりの一撃と持続する偏りを別に持つ。
 *
 * 腕は肩と上腕まで、**基準から外へ開く方向にのみ**動かす。基準は腕を下ろした
 * 状態であり、そこが閉じ切った端になる。閉じる方向は手が胴へ入る (F-14)。
 */
import type { CanonicalEmotion } from "../emotion/types";
import { composePose, scalePose, type PoseMap } from "./pose";

export type EmotionMotion = {
  /** その感情でいるあいだ保つ偏り。 */
  readonly sustain: PoseMap;
  /** 切り替わった瞬間だけ乗る一撃。減衰して消える。 */
  readonly onset: PoseMap;
  /** 待機の動きの速さの倍率。 */
  readonly tempo: number;
  /** 待機の動きの大きさの倍率。 */
  readonly amplitude: number;
};

const NONE: PoseMap = {};

/**
 * 感情ごとの姿勢。値は実機で見ながら詰めたもの。
 *
 * 符号の意味 (VRM の正規化ボーン):
 * - `head.x` 正で顎を引く（うつむく）、負で上を向く
 * - `spine.x` / `chest.x` 正で丸める、負で反る
 * - 肩の `z` は左右で符号が反転する。上げる向きに揃えてある
 * - 上腕の `z` も左右で反転する。開く向きに揃えてある
 */
const TABLE: Readonly<Record<CanonicalEmotion, EmotionMotion>> = {
  neutral: { sustain: NONE, onset: NONE, tempo: 1, amplitude: 1 },

  happy: {
    sustain: {
      head: { x: -0.045 },
      chest: { x: -0.03 },
      leftShoulder: { z: -0.03 },
      rightShoulder: { z: 0.03 },
      leftUpperArm: { z: -0.05 },
      rightUpperArm: { z: 0.05 },
    },
    onset: { head: { x: -0.03 }, chest: { x: -0.02 } },
    tempo: 1.35,
    amplitude: 1.25,
  },

  sad: {
    sustain: {
      head: { x: 0.1 },
      spine: { x: 0.055 },
      chest: { x: 0.03 },
      leftShoulder: { z: 0.035 },
      rightShoulder: { z: -0.035 },
    },
    onset: NONE,
    tempo: 0.6,
    amplitude: 0.55,
  },

  angry: {
    sustain: {
      head: { x: 0.03 },
      chest: { x: -0.05 },
      leftShoulder: { z: -0.045 },
      rightShoulder: { z: 0.045 },
      leftUpperArm: { z: -0.04 },
      rightUpperArm: { z: 0.04 },
    },
    onset: { chest: { x: -0.03 }, head: { x: 0.02 } },
    // 速く小刻みに。大きさは抑える
    tempo: 1.45,
    amplitude: 0.75,
  },

  relaxed: {
    sustain: {
      head: { z: 0.055, x: 0.02 },
      spine: { x: 0.02 },
      leftShoulder: { z: 0.03 },
      rightShoulder: { z: -0.03 },
      leftUpperArm: { z: -0.02 },
      rightUpperArm: { z: 0.02 },
    },
    onset: NONE,
    tempo: 0.72,
    amplitude: 1.2,
  },

  surprised: {
    // 持続はごく浅い。驚きは姿勢ではなく出来事である
    sustain: { head: { x: -0.03 }, spine: { x: -0.02 } },
    onset: {
      head: { x: -0.09 },
      spine: { x: -0.06 },
      chest: { x: -0.04 },
      leftShoulder: { z: -0.08 },
      rightShoulder: { z: 0.08 },
      leftUpperArm: { z: -0.06 },
      rightUpperArm: { z: 0.06 },
    },
    tempo: 1.15,
    amplitude: 0.9,
  },
};

export type EmotionMotionConfig = {
  /** 姿勢を切り替える補間時間。表情より少し遅らせると体が後から付いてくる。 */
  readonly transitionSeconds: number;
  /** 立ち上がりの一撃が消えるまでの時間。 */
  readonly onsetSeconds: number;
};

export const DEFAULT_EMOTION_MOTION_CONFIG: EmotionMotionConfig = {
  transitionSeconds: 0.45,
  onsetSeconds: 0.6,
};

export type EmotionMotionState = {
  /** 遷移の開始点。いまの見た目をそのまま持つ。 */
  readonly from: PoseMap;
  readonly to: PoseMap;
  readonly elapsed: number;
  readonly duration: number;
  /** 立ち上がりの一撃と、その残り時間。 */
  readonly onset: PoseMap;
  readonly onsetLeft: number;
  /** 待機の動きへ渡す倍率。 */
  readonly fromTempo: number;
  readonly toTempo: number;
  readonly fromAmplitude: number;
  readonly toAmplitude: number;
};

export function createEmotionMotionState(): EmotionMotionState {
  return {
    from: NONE,
    to: NONE,
    elapsed: 0,
    duration: 0,
    onset: NONE,
    onsetLeft: 0,
    fromTempo: 1,
    toTempo: 1,
    fromAmplitude: 1,
    toAmplitude: 1,
  };
}

function ratioOf(state: EmotionMotionState): number {
  if (state.duration <= 0) return 1;
  return Math.min(1, Math.max(0, state.elapsed / state.duration));
}

/** 強さのぶんだけ中立から寄せる。0 なら中立のまま。 */
function toward(value: number, intensity: number): number {
  return 1 + (value - 1) * intensity;
}

/** 目標の感情を切り替える。現在の姿勢を開始点として遷移を始める。 */
export function setEmotionMotion(
  state: EmotionMotionState,
  emotion: CanonicalEmotion,
  intensity = 1,
  config: EmotionMotionConfig = DEFAULT_EMOTION_MOTION_CONFIG,
): EmotionMotionState {
  const strength = Number.isFinite(intensity)
    ? Math.min(1, Math.max(0, intensity))
    : 1;
  const entry = TABLE[emotion];
  const ratio = ratioOf(state);

  return {
    // 遷移の途中で切り替わっても、いまの見た目から続ける
    from: composePose([
      scalePose(state.from, 1 - ratio),
      scalePose(state.to, ratio),
    ]),
    to: scalePose(entry.sustain, strength),
    elapsed: 0,
    duration: Math.max(0, config.transitionSeconds),
    onset: scalePose(entry.onset, strength),
    onsetLeft: Math.max(0, config.onsetSeconds),
    fromTempo: currentTempo(state),
    toTempo: toward(entry.tempo, strength),
    fromAmplitude: currentAmplitude(state),
    toAmplitude: toward(entry.amplitude, strength),
  };
}

function currentTempo(state: EmotionMotionState): number {
  const ratio = ratioOf(state);
  return state.fromTempo + (state.toTempo - state.fromTempo) * ratio;
}

function currentAmplitude(state: EmotionMotionState): number {
  const ratio = ratioOf(state);
  return state.fromAmplitude + (state.toAmplitude - state.fromAmplitude) * ratio;
}

export function advanceEmotionMotion(
  state: EmotionMotionState,
  deltaSeconds: number,
): EmotionMotionState {
  if (!(deltaSeconds > 0)) return state;
  return {
    ...state,
    elapsed: Math.min(state.duration, state.elapsed + deltaSeconds),
    onsetLeft: Math.max(0, state.onsetLeft - deltaSeconds),
  };
}

export type EmotionMotionOutput = {
  readonly pose: PoseMap;
  readonly tempo: number;
  readonly amplitude: number;
};

export function evaluateEmotionMotion(
  state: EmotionMotionState,
  config: EmotionMotionConfig = DEFAULT_EMOTION_MOTION_CONFIG,
): EmotionMotionOutput {
  const ratio = ratioOf(state);
  // 一撃は時間とともに消える。速く落ちるほど「跳ねた」感じになる
  const impulse =
    config.onsetSeconds > 0 ? (state.onsetLeft / config.onsetSeconds) ** 2 : 0;

  return {
    pose: composePose([
      scalePose(state.from, 1 - ratio),
      scalePose(state.to, ratio),
      scalePose(state.onset, impulse),
    ]),
    tempo: currentTempo(state),
    amplitude: currentAmplitude(state),
  };
}
