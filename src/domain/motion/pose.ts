/**
 * ボーンの回転を層として重ねる (要件 F-14)。
 *
 * モーフ側に `composeWeights` があるのと同じ役目。呼吸・待機・感情がそれぞれ
 * 独立に回転を出し、ここで足し合わせる。
 *
 * **合計に上限を設ける。** 層が増えるほど足し算は膨らむが、人の関節はそこまで
 * 曲がらない。上限が無いと、感情と待機がたまたま同じ向きへ振れたときに
 * 折れた姿勢になる (F-14-4)。
 */

/** 基準の姿勢からの差 (ラジアン)。指定しない軸は動かさない。 */
export type BoneRotation = {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
};

export type PoseMap = Readonly<Record<string, BoneRotation>>;

/**
 * 1 軸あたりの上限 (ラジアン)。およそ 17 度。
 *
 * 机の上に置くものなので、これ以上動くとかえって落ち着かない (F-13)。
 */
export const MAX_ROTATION = 0.3;

const AXES = ["x", "y", "z"] as const;

function clamp(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(limit, Math.max(-limit, value));
}

/** 層を足し合わせ、軸ごとに上限で丸める。 */
export function composePose(
  layers: readonly PoseMap[],
  limit: number = MAX_ROTATION,
): PoseMap {
  const sums: Record<string, { x: number; y: number; z: number }> = {};

  for (const layer of layers) {
    for (const [bone, rotation] of Object.entries(layer)) {
      const current = (sums[bone] ??= { x: 0, y: 0, z: 0 });
      for (const axis of AXES) {
        const value = rotation[axis];
        if (value !== undefined && Number.isFinite(value)) current[axis] += value;
      }
    }
  }

  const result: Record<string, BoneRotation> = {};
  for (const [bone, sum] of Object.entries(sums)) {
    const rotation: { x?: number; y?: number; z?: number } = {};
    let moved = false;
    for (const axis of AXES) {
      const value = clamp(sum[axis], limit);
      // ごく小さい回転は落として写像を小さく保つ
      if (Math.abs(value) > 1e-6) {
        rotation[axis] = value;
        moved = true;
      }
    }
    if (moved) result[bone] = rotation;
  }

  return result;
}

/** 姿勢の各回転を一律に薄める。感情の強さを効かせるのに使う。 */
export function scalePose(pose: PoseMap, scale: number): PoseMap {
  if (!Number.isFinite(scale)) return {};
  const result: Record<string, BoneRotation> = {};
  for (const [bone, rotation] of Object.entries(pose)) {
    const scaled: { x?: number; y?: number; z?: number } = {};
    for (const axis of AXES) {
      const value = rotation[axis];
      if (value !== undefined) scaled[axis] = value * scale;
    }
    result[bone] = scaled;
  }
  return result;
}
