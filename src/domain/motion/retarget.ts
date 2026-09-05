/**
 * 身振りのクリップを、モデルの立ち姿へ載せ替える (要件 F-15-3-1)。
 *
 * ## なぜ要るか
 *
 * クリップの回転をそのままボーンへ書くと、**クリップの休め姿勢がそのまま
 * ボーンに載る。** ところが「腕を下ろした姿勢」はモデルごとに違う。moca の
 * 立ち姿の調整は「これより高い腕を下ろす」下限を与えるだけで、元から低い腕は
 * そのまま垂れる (`armLoweringAngle`)。食い違えば、その差のぶんだけ身振りの
 * 前後で腕が跳ねる。
 *
 * ## どう載せ替えるか
 *
 * **世界での向き**を組み立ててから差を取り、親の向きで割り戻す。
 *
 * ```
 * 世界(t) = 世界(親, t) × ローカル(t)
 * 目標(t) = ( 世界(t) × 世界(0)⁻¹ ) × 立ち姿の世界での向き
 * 出力(t) = 目標(親, t)⁻¹ × 目標(t)
 * ```
 *
 * **世界で差を取るのが要点。** 骨のローカル回転だけを見て差を取ると、
 * 二つの壊れ方をする。
 *
 * 1. 骨自身の側（右）から掛けると、差の回転軸が土台の姿勢ごと傾く。腕が
 *    35 度下がった姿勢で作った「持ち上げる」動きを、腕が 75 度垂れたモデルへ
 *    右から掛けると、40 度傾いた軸で回るので**腕が外へ開く。** three.js の
 *    加算ブレンドがこれにあたる
 * 2. 親の側（左）から掛けると腕は直るが、**祖先の立ち姿の差が、その先の骨の
 *    座標系ごと回してしまう。** 腕の付け根で 40 度違えば手首の軸も 40 度回り、
 *    腕の動きは合っているのに**手の向きだけが崩れる**
 *
 * どちらも実際に起きた。世界で差を取れば、**手が世界のどちらを向くか**が
 * クリップのとおりに保たれる。手のひらを正面へ向ける動きは、腕がどこから
 * 始まっても正面を向く。
 *
 * t = 0 では差が単位回転になるので、出力は立ち姿そのものになる。
 *
 * **終わりは立ち姿へ閉じる。** クリップの終わりが始まりと同じ姿勢とは限らない。
 * 撮影ものでは、手だけが違う向きで終わっていることがある。差はそのぶん残る
 * ので、放っておくと身振りのあとに手首が回ったままになる。要件 F-15-3 の
 * 「一定時間で終わり、元の姿勢へ戻る」をここで守る。
 *
 * ## 手首だけは扱いを変える
 *
 * 腕と手では、保つべきものが違う。
 *
 * - **肩と肘は「手をどこへ運ぶか」を決める。** 体格に合わせて相対で載せ替える
 *   のが正しい。腕の長さも立ち姿もモデルごとに違う
 * - **手首は「手が何を見せるか」を決める。** 手のひらをこちらへ向ける、という
 *   のは**絶対の向きに意味がある。** 相対で載せると、腕の付け根の立ち姿の差の
 *   ぶんだけ手のひらが回ってしまう
 *
 * そこで手だけは、クリップの世界での向きをそのまま使う。ただし丸ごと従うと、
 * モデルによっては手首が人体の可動域を超える。**ひねりと曲げを分けて扱う。**
 *
 * - **ひねり**（前腕の軸まわり、回内・回外）は可動域が広い（±80 度以上）。
 *   クリップの向きに素直に従わせる
 * - **曲げ**（軸に垂直、掌屈・背屈・橈屈・尺屈）は狭い（±20〜70 度）。立ち姿
 *   からの差として頭打ちにする
 *
 * 手首をひねって手のひらを向けるのは、人が実際にしていることでもある。腕を
 * どこへ上げようと、見せたい面はこちらへ向ける。
 *
 * **向きを合わせるのは、手を上げているあいだだけにする。** 二つの条件で測る。
 *
 * - 動き出してから合わせる。始めから絶対の向きにすると、腕がまだ立ち姿に
 *   いるうちに手首だけが先に回り、上げ始めに手がねじれて見える
 * - **前腕がどれだけ動いたかで決める。** 腕を下ろすとき、人は手のひらを前へ
 *   向けたままにしない。肩が内へ回り、手のひらは腿のほうを向く。腕が休め姿勢
 *   へ近づくほど、向きを合わせるのをやめていく
 *
 * 手のひらを相手へ向けるのは「見せている」あいだの振る舞いである。上げも
 * 下ろしもしていない腕には、向けるべき面が無い。
 */

/** x, y, z, w の順。three.js の並びに合わせる。 */
export type Quaternion = readonly [number, number, number, number];

export const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1];

/** 回転の合成。`a` のあとに `b` ではなく、親 `a`・子 `b` の順で読む。 */
export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** 逆回転。単位長を前提にするので、共役をそのまま返す。 */
export function invertQuaternion([x, y, z, w]: Quaternion): Quaternion {
  return [-x, -y, -z, w];
}

/** 回転の列。時刻とクォータニオンを持つ。 */
export type BoneTrack = {
  readonly times: ArrayLike<number>;
  readonly values: ArrayLike<number>;
};

/** 骨の休め姿勢と繋がりを引くための道具。 */
export type Skeleton = {
  /** その骨の、モデルの立ち姿でのローカル回転。 */
  readonly restOf: (bone: string) => Quaternion;
  /** 親の骨。根なら null。 */
  readonly parentOf: (bone: string) => string | null;
};

/**
 * 手首の曲げの上限 (度)。
 *
 * 掌屈 70 度・背屈 70 度・橈屈 20 度・尺屈 30 度あたりが人の可動域である。
 * 方向を問わない一つの値としては、いちばん広い掌屈・背屈に合わせる。ここを
 * 超えると手が折れて見える。ひねり (回内・回外) には上限を設けない。
 */
export const MAX_WRIST_SWING_DEGREES = 70;

/** 世界での向きをそのまま使う骨。手のひらの向きは絶対値に意味がある。 */
const ABSOLUTE_BONES = new Set(["leftHand", "rightHand"]);

/**
 * 手の向きを立ち姿からクリップの向きへ寄せるのに掛ける時間 (秒)。
 *
 * 腕が上がり始めるより少し遅れて向きが決まるくらいが自然になる。短くすると
 * 上げ始めに手首だけが先に回り、長くすると向きが決まらないまま振り始める。
 */
export const WRIST_AIM_SECONDS = 0.35;

/**
 * 手の向きを合わせ始める、前腕の動きの大きさ (度)。
 *
 * 休め姿勢からこれだけ動いていなければ、手のひらを向けにいかない。腕を
 * 下ろすときに手のひらが前を向いたままになるのを防ぐ。
 */
export const WRIST_AIM_FROM_DEGREES = 20;

/** 手の向きを合わせ切る、前腕の動きの大きさ (度)。 */
export const WRIST_AIM_FULL_DEGREES = 50;

/**
 * 終わりに立ち姿へ閉じるのに掛ける時間 (秒)。
 *
 * クリップの終わりが始まりと同じ姿勢とは限らない。撮影ものでは、手だけが
 * 違う向きで終わっていることがある。放っておくと身振りのあとに手首が回った
 * ままになるので、最後にここで閉じる (要件 F-15-3)。
 */
export const CLOSING_SECONDS = 0.3;

/**
 * 回転を「ひねり」と「曲げ」に分ける。
 *
 * @param axis ひねりの軸。手首では前腕の伸びる向き。
 * @returns `twist` は軸まわりの回転、`swing` は残り。`swing × twist` で元へ戻る。
 */
export function decomposeSwingTwist(
  q: Quaternion,
  axis: Quaternion,
): { swing: Quaternion; twist: Quaternion } {
  const [ax, ay, az] = axis;
  const dot = q[0] * ax + q[1] * ay + q[2] * az;
  const projected: Quaternion = [ax * dot, ay * dot, az * dot, q[3]];

  const length = Math.hypot(...projected);
  const twist: Quaternion =
    length < 1e-8
      ? IDENTITY_QUATERNION
      : [
          projected[0] / length,
          projected[1] / length,
          projected[2] / length,
          projected[3] / length,
        ];

  return { swing: multiplyQuaternions(q, invertQuaternion(twist)), twist };
}

/** 回転の角度 (度)。 */
export function angleOf(q: Quaternion): number {
  return (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
}

/** 角度に頭打ちを設ける。軸は変えず、角度だけを縮める。 */
export function limitAngle(q: Quaternion, maxDegrees: number): Quaternion {
  const angle = angleOf(q);
  if (angle <= maxDegrees) return q;
  return slerpQuaternions(IDENTITY_QUATERNION, q, maxDegrees / angle);
}

/**
 * クリップ全体を、モデルの立ち姿へ載せ替える。
 *
 * 骨ごとに差を取ると、祖先の立ち姿の差がその先の骨の座標系を回してしまう。
 * 世界での向きを組み立ててから差を取り、親の向きで割り戻す。
 *
 * @returns 骨ごとの新しい回転の列。入力に無い骨は含まれない。
 */
export function rebaseClip(
  tracks: ReadonlyMap<string, BoneTrack>,
  skeleton: Skeleton,
): Map<string, number[]> {
  /** 立ち姿での世界の向き。根から掛け合わせて求める。 */
  const restWorld = new Map<string, Quaternion>();
  const restWorldOf = (bone: string): Quaternion => {
    const known = restWorld.get(bone);
    if (known !== undefined) return known;

    const parent = skeleton.parentOf(bone);
    const world =
      parent === null
        ? skeleton.restOf(bone)
        : multiplyQuaternions(restWorldOf(parent), skeleton.restOf(bone));
    restWorld.set(bone, world);
    return world;
  };

  /** クリップでの、その時刻のローカル回転。トラックが無ければ動かない。 */
  const localAt = (bone: string, time: number): Quaternion => {
    const track = tracks.get(bone);
    if (track === undefined) return IDENTITY_QUATERNION;
    return sampleTrack(track, time);
  };

  /** クリップでの世界の向き。 */
  const clipWorldAt = (bone: string, time: number): Quaternion => {
    const parent = skeleton.parentOf(bone);
    const local = localAt(bone, time);
    return parent === null ? local : multiplyQuaternions(clipWorldAt(parent, time), local);
  };

  /** 載せ替えた後の世界の向き。動かない骨は立ち姿のまま。 */
  const targetWorldAt = (bone: string, time: number, start: number): Quaternion => {
    const parent = skeleton.parentOf(bone);
    const moves = tracks.has(bone) || (parent !== null && movesWithAncestors(parent));
    if (!moves) return restWorldOf(bone);

    const delta = multiplyQuaternions(
      clipWorldAt(bone, time),
      invertQuaternion(clipWorldAt(bone, start)),
    );
    return multiplyQuaternions(delta, restWorldOf(bone));
  };

  /** 前腕が休め姿勢からどれだけ動いたか (度)。手を上げているかの目安になる。 */
  const armMotionAt = (bone: string, time: number, start: number): number =>
    angleOf(
      multiplyQuaternions(
        clipWorldAt(bone, time),
        invertQuaternion(clipWorldAt(bone, start)),
      ),
    );

  /** その骨自身か祖先のどれかが動くか。 */
  function movesWithAncestors(bone: string): boolean {
    if (tracks.has(bone)) return true;
    const parent = skeleton.parentOf(bone);
    return parent !== null && movesWithAncestors(parent);
  }

  const out = new Map<string, number[]>();
  for (const [bone, track] of tracks) {
    const count = track.times.length;
    const start = track.times[0] ?? 0;
    const end = track.times[count - 1] ?? start;
    const parent = skeleton.parentOf(bone);
    const absolute = ABSOLUTE_BONES.has(bone);
    const values: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const time = track.times[index] ?? 0;
      const parentWorld =
        parent === null ? null : targetWorldAt(parent, time, start);

      const toLocal = (world: Quaternion): Quaternion =>
        parentWorld === null
          ? world
          : multiplyQuaternions(invertQuaternion(parentWorld), world);

      const relative = toLocal(targetWorldAt(bone, time, start));

      // 終わりは立ち姿へ閉じる。クリップの終わりが始まりと同じ姿勢とは
      // 限らないので、残った差をここで畳む。
      const closing = smoothstep(
        clamp01((end - time) / Math.min(CLOSING_SECONDS, (end - start) / 2 || 1)),
      );

      if (!absolute) {
        values.push(...slerpQuaternions(skeleton.restOf(bone), relative, closing));
        continue;
      }

      // 手はクリップの世界での向きへ寄せる。ただし**手を上げているあいだ
      // だけ**。動き出しと、腕がどれだけ動いたかの両方で測る。
      const aimed = withinWristRange(toLocal(clipWorldAt(bone, time)), relative);
      const edge = Math.min(time - start, end - time);
      const raised = parent === null ? 0 : armMotionAt(parent, time, start);
      const weight = smoothstep(
        Math.min(
          clamp01(edge / WRIST_AIM_SECONDS),
          clamp01(
            (raised - WRIST_AIM_FROM_DEGREES) /
              (WRIST_AIM_FULL_DEGREES - WRIST_AIM_FROM_DEGREES),
          ),
        ),
      );
      const posed = slerpQuaternions(relative, aimed, weight);
      values.push(...slerpQuaternions(skeleton.restOf(bone), posed, closing));
    }
    out.set(bone, values);
  }
  return out;
}

/** 加速と減速を両端に付ける。0..1 を 0..1 へ写す。 */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** 0..1 に収める。 */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** その時刻の回転を取り出す。キーの間は球面線形に繋ぐ。 */
export function sampleTrack(track: BoneTrack, time: number): Quaternion {
  const count = track.times.length;
  const at = (index: number): Quaternion => [
    track.values[index * 4] ?? 0,
    track.values[index * 4 + 1] ?? 0,
    track.values[index * 4 + 2] ?? 0,
    track.values[index * 4 + 3] ?? 1,
  ];

  if (count === 0) return IDENTITY_QUATERNION;
  if (time <= (track.times[0] ?? 0)) return at(0);
  if (time >= (track.times[count - 1] ?? 0)) return at(count - 1);

  let index = 0;
  while (index < count - 1 && (track.times[index + 1] ?? 0) <= time) index += 1;

  const from = track.times[index] ?? 0;
  const to = track.times[index + 1] ?? 0;
  const span = to - from;
  return span === 0 ? at(index) : slerpQuaternions(at(index), at(index + 1), (time - from) / span);
}

/** 球面線形補間。近いときは線形に落として 0 割りを避ける。 */
export function slerpQuaternions(a: Quaternion, b: Quaternion, t: number): Quaternion {
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
    const mixed: Quaternion = [
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ];
    const length = Math.hypot(...mixed);
    return length === 0 ? IDENTITY_QUATERNION : [
      mixed[0] / length,
      mixed[1] / length,
      mixed[2] / length,
      mixed[3] / length,
    ];
  }

  const angle = Math.acos(dot);
  const sin = Math.sin(angle);
  const from = Math.sin((1 - t) * angle) / sin;
  const to = Math.sin(t * angle) / sin;
  return [a[0] * from + bx * to, a[1] * from + by * to, a[2] * from + bz * to, a[3] * from + bw * to];
}

/**
 * 手首を人の可動域に収める。
 *
 * 相対で載せ替えた向き——つまり**クリップが記録した手首の角度そのもの**——を
 * 基準に置き、そこからの差を前腕の軸まわりの**ひねり**と、それ以外の**曲げ**に
 * 分ける。ひねりはそのまま通し、曲げだけを頭打ちにする。
 *
 * 基準を立ち姿ではなく相対の向きに取るのが要点。**向きを合わせるために足す
 * ぶんだけ**を測ることになるので、クリップが元から持っていた深い手首の角度を
 * 削らずに済む。
 *
 * 正規化された骨格では、腕は休め姿勢で X 軸に沿って伸びる。したがって前腕の
 * 軸は親の座標系の X 軸になる。
 */
export function withinWristRange(local: Quaternion, reference: Quaternion): Quaternion {
  const delta = multiplyQuaternions(local, invertQuaternion(reference));
  const { swing, twist } = decomposeSwingTwist(delta, [1, 0, 0, 0]);
  const limited = limitAngle(swing, MAX_WRIST_SWING_DEGREES);
  return multiplyQuaternions(multiplyQuaternions(limited, twist), reference);
}
