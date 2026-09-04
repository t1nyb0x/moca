/**
 * 体重移動 (要件 F-14-1)。
 *
 * 人は片脚に体重を預けて立ち、ときどき乗せ替える。**片側に留まる時間がある
 * ことが要点**で、正弦でそのまま往復させると振り子に見える。端で寝る波形へ
 * 通してから使う。
 *
 * ## 腰を回しても脚が振れない作り
 *
 * 0.7 で「腰は回さない」と決めた。腰は骨格の根なので、回すと脚ごと振れて
 * 吊り下げられた人形に見えるためである。
 *
 * その制約は**股関節で打ち消せば外せる**。骨盤を θ 傾けると同時に、左右の
 * 腿を −θ 回せば、脚は床に対して立ったまま骨盤だけが傾く。体重移動は骨盤の
 * 傾きそのものなので、これで初めて成り立つ。
 *
 * ## 軸の約束 (正規化された VRM の座標系)
 *
 * `+X` がモデルの左、`+Y` が上、`+Z` が前。したがって
 *
 * - `hips.z` 正 → 左の腰が上がる。**体重は左脚に乗る**
 * - `spine.z` 正 → 上体が右へ傾く。骨盤の傾きを打ち消すには負を入れる
 * - `lowerLeg.x` 正 → 膝が曲がり、踵が後ろへ動く
 * - `upperLeg.x` 負 → 腿が前へ出る
 */

import type { PoseMap } from "./pose";

export type WeightShiftConfig = {
  /** 乗せ替えの周期 (Hz)。ゆっくりでよい。 */
  readonly hz: number;
  /** 骨盤の傾き (ラジアン)。 */
  readonly pelvisRadians: number;
  /** 遊脚の膝の緩み (ラジアン)。 */
  readonly kneeRadians: number;
  /**
   * 端で寝かせる強さ。
   *
   * 大きいほど片側に留まる時間が延び、乗せ替えが速くなる。0 に近いと
   * ただの正弦に戻り、絶えず揺れ続ける振り子に見える。
   */
  readonly hold: number;
};

export const DEFAULT_WEIGHT_SHIFT_CONFIG: WeightShiftConfig = {
  // 25 秒でひと往復。これ以上速いと落ち着かない
  hz: 0.04,
  // 3 度ほど。欲張ると股関節の打ち消しでは足の位置を保てない
  pelvisRadians: 0.052,
  kneeRadians: 0.06,
  // 実測で、6 割ほどを片側で過ごし、乗せ替えに費やすのは 1 割強になる
  hold: 2.8,
};

export type WeightShiftState = {
  /** 経過秒。畳まない。 */
  readonly seconds: number;
};

export function createWeightShiftState(initialSeconds = 0): WeightShiftState {
  return { seconds: Number.isFinite(initialSeconds) ? initialSeconds : 0 };
}

/** `tempo` は感情による速さの倍率。待機の揺れと歩調を合わせる。 */
export function advanceWeightShift(
  state: WeightShiftState,
  deltaSeconds: number,
  tempo = 1,
): WeightShiftState {
  if (!(deltaSeconds > 0)) return state;
  const scale = Number.isFinite(tempo) && tempo > 0 ? tempo : 1;
  return { seconds: state.seconds + deltaSeconds * scale };
}

/**
 * いまどちらの脚に体重が乗っているか。`+1` が左脚、`-1` が右脚。
 *
 * 二つの波を重ねてから端で寝かせる。単一の正弦では乗せ替えの間隔が
 * 一定になり、機械の動きに見える。
 */
export function weightBias(
  state: WeightShiftState,
  config: WeightShiftConfig = DEFAULT_WEIGHT_SHIFT_CONFIG,
): number {
  const t = state.seconds * config.hz * Math.PI * 2;
  const raw = Math.sin(t) + 0.35 * Math.sin(t * 0.41);
  // tanh は端へ寄せるほど鈍る。留まる時間が延び、乗せ替えだけが速くなる。
  const shaped = Math.tanh(raw * config.hold);
  return Math.min(1, Math.max(-1, shaped));
}

/**
 * 乗せ替えの最中は、どちらの脚も緩めない。
 *
 * 中間では両脚で支えているので、膝を緩めると宙に浮いた足ができる。
 * 十分に片側へ寄ってから緩め始める。
 */
const SLACK_THRESHOLD = 0.35;

function slackOf(bias: number): number {
  const over = Math.abs(bias) - SLACK_THRESHOLD;
  if (over <= 0) return 0;
  return over / (1 - SLACK_THRESHOLD);
}

/** `amplitude` は感情による大きさの倍率。 */
export function evaluateWeightShift(
  state: WeightShiftState,
  amplitude = 1,
  config: WeightShiftConfig = DEFAULT_WEIGHT_SHIFT_CONFIG,
): PoseMap {
  const gain = Number.isFinite(amplitude) && amplitude > 0 ? amplitude : 0;
  if (gain === 0) return {};

  const bias = weightBias(state, config);
  const pelvis = bias * config.pelvisRadians * gain;

  const pose: Record<string, { x?: number; y?: number; z?: number }> = {
    hips: { z: pelvis },
    // 脚は股関節で戻す。これを外すと脚ごと振れる。
    leftUpperLeg: { z: -pelvis },
    rightUpperLeg: { z: -pelvis },
    // 背骨と胸で上体を支持脚の上へ返す。返さないと体が傾いたままになる。
    // 肩の線が骨盤とわずかに逆を向き、いわゆる S 字になる。
    spine: { z: -pelvis * 0.7 },
    chest: { z: -pelvis * 0.5 },
  };

  const slack = slackOf(bias);
  if (slack > 0) {
    const knee = slack * config.kneeRadians * gain;
    // 体重が乗っていない側を緩める。左の腰が上がっていれば支持脚は左。
    const free = bias > 0 ? "right" : "left";
    pose[`${free}LowerLeg`] = { x: knee };
    // 膝を曲げたぶん足が浮く。腿を少し前へ出して、つま先を残したまま
    // 踵が軽く上がる形にする。
    pose[`${free}UpperLeg`] = {
      z: -pelvis,
      x: -knee * 0.4,
    };
  }

  return pose;
}
