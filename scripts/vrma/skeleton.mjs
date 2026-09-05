/**
 * VRMA に書き込む休め姿勢の骨格。
 *
 * VRM 1.0 の正規化された骨格に合わせる。Y が上、モデルは +Z を向き、
 * **モデルから見た右手側は -X** である。休め姿勢は T ポーズで、どの骨も
 * 回転を持たない。
 *
 * 長さは目安の値で、身長 1.5m ほどの人型を想定する。moca は回転しか使わない
 * ので描画には効かないが、ほかの道具で開いたときに人の形に見えるようにする。
 */

/**
 * 片手ぶんの指を作る。
 *
 * 手のひらは休め姿勢で下 (-Y) を向き、指は腕の伸びる向きへ並ぶ。親指の側が
 * 前 (+Z)、小指の側が後ろ (-Z) になる。左右で違うのは腕の伸びる向きだけ
 * なので、符号ひとつで折り返す。
 *
 * @param {"left" | "right"} side
 * @param {1 | -1} sign 腕の伸びる向き。左が +X、右が -X。
 */
function fingers(side, sign) {
  const at = (x, z) => [sign * x, 0, z];
  const digit = (name, spread, lengths) => {
    const [proximal, intermediate, distal] = lengths;
    return [
      { name: `${side}${name}Proximal`, parent: `${side}Hand`, translation: at(proximal, spread) },
      {
        name: `${side}${name}Intermediate`,
        parent: `${side}${name}Proximal`,
        translation: at(intermediate, 0),
      },
      {
        name: `${side}${name}Distal`,
        parent: `${side}${name}Intermediate`,
        translation: at(distal, 0),
      },
    ];
  };

  return [
    // 親指だけは並びから外れ、手のひらの前へ付く。
    { name: `${side}ThumbMetacarpal`, parent: `${side}Hand`, translation: at(0.02, 0.025) },
    {
      name: `${side}ThumbProximal`,
      parent: `${side}ThumbMetacarpal`,
      translation: at(0.03, 0.015),
    },
    { name: `${side}ThumbDistal`, parent: `${side}ThumbProximal`, translation: at(0.025, 0.01) },

    ...digit("Index", 0.025, [0.075, 0.035, 0.022]),
    ...digit("Middle", 0.008, [0.078, 0.038, 0.024]),
    ...digit("Ring", -0.01, [0.075, 0.035, 0.022]),
    ...digit("Little", -0.028, [0.068, 0.028, 0.018]),
  ];
}

/** @type {ReadonlyArray<{ name: string, parent: string | null, translation: [number, number, number] }>} */
export const SKELETON = [
  { name: "hips", parent: null, translation: [0, 0.72, 0] },
  { name: "spine", parent: "hips", translation: [0, 0.1, 0] },
  { name: "chest", parent: "spine", translation: [0, 0.12, 0] },
  { name: "neck", parent: "chest", translation: [0, 0.18, 0] },
  { name: "head", parent: "neck", translation: [0, 0.06, 0] },

  { name: "leftShoulder", parent: "chest", translation: [0.04, 0.14, 0] },
  { name: "leftUpperArm", parent: "leftShoulder", translation: [0.1, 0, 0] },
  { name: "leftLowerArm", parent: "leftUpperArm", translation: [0.22, 0, 0] },
  { name: "leftHand", parent: "leftLowerArm", translation: [0.22, 0, 0] },

  { name: "rightShoulder", parent: "chest", translation: [-0.04, 0.14, 0] },
  { name: "rightUpperArm", parent: "rightShoulder", translation: [-0.1, 0, 0] },
  { name: "rightLowerArm", parent: "rightUpperArm", translation: [-0.22, 0, 0] },
  { name: "rightHand", parent: "rightLowerArm", translation: [-0.22, 0, 0] },

  { name: "leftUpperLeg", parent: "hips", translation: [0.08, -0.06, 0] },
  { name: "leftLowerLeg", parent: "leftUpperLeg", translation: [0, -0.36, 0] },
  { name: "leftFoot", parent: "leftLowerLeg", translation: [0, -0.34, 0] },

  ...fingers("left", 1),
  ...fingers("right", -1),

  { name: "rightUpperLeg", parent: "hips", translation: [-0.08, -0.06, 0] },
  { name: "rightLowerLeg", parent: "rightUpperLeg", translation: [0, -0.36, 0] },
  { name: "rightFoot", parent: "rightLowerLeg", translation: [0, -0.34, 0] },
];
