/**
 * 回転の計算。VRMA を組み立てるためだけの最小限の実装。
 *
 * three.js を持ち込まないのは、これがビルド時のスクリプトであり、
 * アプリの依存とは別に動かしたいためである。
 *
 * 角度はすべて度で受け取る。手で書いて手で読む数値だからである。
 * 合成の順序は three.js の既定と同じ XYZ（内的回転）に揃える。
 */

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * オイラー角 (度, XYZ 順) をクォータニオンへ直す。
 *
 * @param {{ x?: number, y?: number, z?: number }} angles
 * @returns {[number, number, number, number]} x, y, z, w
 */
export function eulerToQuaternion({ x = 0, y = 0, z = 0 }) {
  const halfX = toRadians(x) / 2;
  const halfY = toRadians(y) / 2;
  const halfZ = toRadians(z) / 2;

  const cx = Math.cos(halfX);
  const sx = Math.sin(halfX);
  const cy = Math.cos(halfY);
  const sy = Math.sin(halfY);
  const cz = Math.cos(halfZ);
  const sz = Math.sin(halfZ);

  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

/** 回転を合成する。`a` のあとに `b` ではなく、親 `a`・子 `b` の順で読む。 */
export function multiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** ベクトルを回す。前進運動学の確認に使う。 */
export function rotateVector(quaternion, [vx, vy, vz]) {
  const [qx, qy, qz, qw] = quaternion;

  // t = 2 * (q_vec × v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * 二つの回転を球面線形補間で繋ぐ。
 *
 * 成分ごとに混ぜると回転が短くなったり速さが波打ったりする。角度で等速に
 * 進ませたいので、球面上を辿る。近いときは線形に落として 0 割りを避ける。
 */
export function slerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;

  // 遠回りしないよう、鈍角なら片方を裏返す。回転としては同じものを指す。
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  if (dot > 0.9995) {
    return normalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }

  const angle = Math.acos(dot);
  const sin = Math.sin(angle);
  const from = Math.sin((1 - t) * angle) / sin;
  const to = Math.sin(t * angle) / sin;
  return [a[0] * from + bx * to, a[1] * from + by * to, a[2] * from + bz * to, a[3] * from + bw * to];
}

/** 長さを 1 に揃える。 */
export function normalize(q) {
  const length = Math.hypot(...q);
  return length === 0 ? [0, 0, 0, 1] : q.map((value) => value / length);
}

/** 単位回転。無回転の姿勢を書くときに使う。 */
export const IDENTITY = [0, 0, 0, 1];
