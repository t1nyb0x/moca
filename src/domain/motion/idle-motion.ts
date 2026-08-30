/**
 * 待機中の動き (要件 F-14-1)。
 *
 * 止まっていると人形に見える。重心をゆっくり移し、体をわずかに揺らし、
 * ときおり首を傾ける。
 *
 * **周期の違う波を重ねる。** 単一の正弦だと往復がすぐ見破られて、機械の
 * 動きに見える。互いに割り切れない比を選ぶと、composite の繰り返しが
 * 数分単位まで延びる。
 *
 * 位相ではなく経過秒を持つのは、波ごとに周期が違うため。0〜1 の位相に
 * 畳むと、比の違う波が折り返しの瞬間に飛ぶ。
 */
import type { PoseMap } from "./pose";

export type IdleMotionConfig = {
  /** 基本の周期。ゆっくり息づく程度。 */
  readonly hz: number;
  /** 体の揺れの大きさ (ラジアン)。 */
  readonly swayRadians: number;
  /** 首の傾げの大きさ (ラジアン)。 */
  readonly tiltRadians: number;
};

export const DEFAULT_IDLE_MOTION_CONFIG: IdleMotionConfig = {
  hz: 0.11,
  swayRadians: 0.035,
  tiltRadians: 0.05,
};

export type IdleMotionState = {
  /** 経過秒。畳まない。 */
  readonly seconds: number;
};

export function createIdleMotionState(initialSeconds = 0): IdleMotionState {
  return { seconds: Number.isFinite(initialSeconds) ? initialSeconds : 0 };
}

/** `tempo` は感情による速さの倍率。 */
export function advanceIdleMotion(
  state: IdleMotionState,
  deltaSeconds: number,
  tempo = 1,
): IdleMotionState {
  if (!(deltaSeconds > 0)) return state;
  const scale = Number.isFinite(tempo) && tempo > 0 ? tempo : 1;
  return { seconds: state.seconds + deltaSeconds * scale };
}

/** `amplitude` は感情による大きさの倍率。 */
export function evaluateIdleMotion(
  state: IdleMotionState,
  amplitude = 1,
  config: IdleMotionConfig = DEFAULT_IDLE_MOTION_CONFIG,
): PoseMap {
  const gain = Number.isFinite(amplitude) && amplitude > 0 ? amplitude : 0;
  if (gain === 0) return {};

  const t = state.seconds * config.hz * Math.PI * 2;
  const sway = config.swayRadians * gain;
  const tilt = config.tiltRadians * gain;

  // 比は互いに割り切れないものを選ぶ。割り切れると往復が目立つ。
  const weight = Math.sin(t); // 重心の移動
  const twist = Math.sin(t * 0.73); // 体のひねり
  const nod = Math.sin(t * 1.31); // ごく浅い頷き
  const lean = Math.sin(t * 0.41); // 首の傾げ

  return {
    // 重心を左右へ。腰から動かすと全身が付いてくる
    hips: { z: weight * sway, y: twist * sway * 0.6 },
    // 上半身は腰と逆へ返す。同じ向きだと体が折れて見える
    spine: { z: -weight * sway * 0.5 },
    head: { z: lean * tilt, x: nod * tilt * 0.35 },
  };
}
