import { describe, expect, it } from "vitest";

import {
  angleOf,
  decomposeSwingTwist,
  IDENTITY_QUATERNION,
  invertQuaternion,
  MAX_WRIST_SWING_DEGREES,
  multiplyQuaternions,
  rebaseClip,
  sampleTrack,
  withinWristRange,
  type Quaternion,
} from "./retarget";

/** 度で書いた Z 回りの回転。腕の上げ下ろしはこの軸に乗る。 */
const aroundZ = (degrees: number): Quaternion => {
  const half = (degrees * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};

const aroundY = (degrees: number): Quaternion => {
  const half = (degrees * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
};

const frames = (...quaternions: Quaternion[]): number[] => quaternions.flat();

const frameAt = (values: readonly number[], index: number): Quaternion => [
  values[index * 4] ?? 0,
  values[index * 4 + 1] ?? 0,
  values[index * 4 + 2] ?? 0,
  values[index * 4 + 3] ?? 1,
];

const close = (actual: readonly number[], expected: readonly number[]): void => {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? 0, 6));
};

describe("multiplyQuaternions", () => {
  it("単位回転は何も変えない", () => {
    const q = aroundZ(33);
    close(multiplyQuaternions(IDENTITY_QUATERNION, q), q);
    close(multiplyQuaternions(q, IDENTITY_QUATERNION), q);
  });

  it("同じ軸なら角度が足し合わさる", () => {
    close(multiplyQuaternions(aroundZ(30), aroundZ(20)), aroundZ(50));
  });
});

describe("invertQuaternion", () => {
  it("掛け合わせると単位回転になる", () => {
    const q = aroundY(57);
    close(multiplyQuaternions(q, invertQuaternion(q)), IDENTITY_QUATERNION);
  });
});

/**
 * 骨ごとに差を取る素朴なやり方。祖先の立ち姿の差を無視するので、手の向きが
 * 崩れる。直したことを見張るために、試験の中だけで組み立てる。
 */
const rebasePerBone = (values: readonly number[], rest: Quaternion): number[] => {
  const first = invertQuaternion(frameAt(values, 0));
  const out: number[] = [];
  for (let index = 0; index * 4 < values.length; index += 1) {
    const delta = multiplyQuaternions(frameAt(values, index), first);
    out.push(...multiplyQuaternions(delta, rest));
  }
  return out;
};

describe("rebaseClip", () => {
  // 胸 → 上腕 → 前腕 → 手 の 4 本。VRM の人型ボーンと同じ繋がり。
  const parents: Record<string, string | null> = {
    chest: null,
    rightUpperArm: "chest",
    rightLowerArm: "rightUpperArm",
    rightHand: "rightLowerArm",
  };
  const parentOf = (bone: string): string | null => parents[bone] ?? null;

  /** 立ち姿。腕は 75 度垂れている。クリップ側の 35 度とは食い違う。 */
  const rest: Record<string, Quaternion> = {
    chest: IDENTITY_QUATERNION,
    rightUpperArm: aroundZ(75),
    rightLowerArm: aroundZ(10),
    rightHand: IDENTITY_QUATERNION,
  };
  const restOf = (bone: string): Quaternion => rest[bone] ?? IDENTITY_QUATERNION;
  const skeleton = { restOf, parentOf };

  /** ローカル回転の並びから世界での向きを求める。 */
  const worldOf = (
    bone: string,
    localOf: (name: string) => Quaternion,
  ): Quaternion => {
    const parent = parentOf(bone);
    return parent === null
      ? localOf(bone)
      : multiplyQuaternions(worldOf(parent, localOf), localOf(bone));
  };

  /** 腕を 35 度から 5 度まで持ち上げ、手首は前腕に対して 60 度ひねるクリップ。 */
  const clip = new Map([
    ["rightUpperArm", { times: [0, 1], values: frames(aroundZ(35), aroundZ(5)) }],
    ["rightHand", { times: [0, 1], values: frames(IDENTITY_QUATERNION, aroundY(60)) }],
  ]);

  /** 向きを合わせ切った頃合いのコマを持つ、長めのクリップ。 */
  const longClip = new Map([
    [
      "rightUpperArm",
      { times: [0, 0.5, 1], values: frames(aroundZ(35), aroundZ(-35), aroundZ(-35)) },
    ],
    [
      "rightHand",
      {
        times: [0, 0.5, 1],
        values: frames(IDENTITY_QUATERNION, aroundY(60), aroundY(60)),
      },
    ],
  ]);

  const localAt = (
    out: Map<string, number[]>,
    index: number,
  ): ((bone: string) => Quaternion) => {
    return (bone) => {
      const values = out.get(bone);
      return values === undefined ? restOf(bone) : frameAt(values, index);
    };
  };

  it("先頭の姿勢はモデルの立ち姿そのものになる", () => {
    // ここが一致するから、身振りの前後で腕が跳ねない。手の向きを合わせるのも
    // 動き出してからなので、先頭では手も立ち姿にいる
    const out = rebaseClip(clip, skeleton);
    for (const bone of out.keys()) {
      close(frameAt(out.get(bone) ?? [], 0), restOf(bone));
    }
  });

  it("手は世界での向きそのものがクリップと一致する", () => {
    // 手のひらがどちらを向くかは絶対値に意味がある。腕の付け根の立ち姿が
    // 40 度違っても、見せる面まで 40 度回ってはいけない
    const out = rebaseClip(longClip, skeleton);
    const clipLocalAt = (index: number) => (bone: string) => {
      const track = longClip.get(bone);
      return track === undefined ? IDENTITY_QUATERNION : frameAt(track.values, index);
    };
    // 端では向きを合わせない (合わせるのは動き出してから) ので、途中のコマで見る
    const gap = angleOf(
      multiplyQuaternions(
        worldOf("rightHand", localAt(out, 1)),
        invertQuaternion(worldOf("rightHand", clipLocalAt(1))),
      ),
    );
    // 可動域の頭打ちに掛かるぶんだけは外れる。数度に収まっていればよい
    expect(gap).toBeLessThan(8);
  });

  it("骨ごとに差を取るやり方では、手の向きが崩れる", () => {
    // 直す前のやり方。世界での向きがクリップから外れる
    // 直す前のやり方。回帰の見張りとして残す
    const naive = rebasePerBone(clip.get("rightHand")?.values ?? [], restOf("rightHand"));
    const naiveDelta = multiplyQuaternions(
      worldOf("rightHand", (bone) =>
        bone === "rightHand"
          ? frameAt(naive, 1)
          : bone === "rightUpperArm"
            ? frameAt(rebasePerBone(clip.get(bone)?.values ?? [], restOf(bone)), 1)
            : restOf(bone),
      ),
      invertQuaternion(worldOf("rightHand", localAt(rebaseClip(clip, skeleton), 0))),
    );

    const clipLocalAt = (index: number) => (bone: string) => {
      const track = clip.get(bone);
      return track === undefined ? IDENTITY_QUATERNION : frameAt(track.values, index);
    };
    const clipDelta = multiplyQuaternions(
      worldOf("rightHand", clipLocalAt(1)),
      invertQuaternion(worldOf("rightHand", clipLocalAt(0))),
    );

    const difference = Math.hypot(
      ...naiveDelta.map((value, index) => value - (clipDelta[index] ?? 0)),
    );
    expect(difference).toBeGreaterThan(0.05);

  });

  it("立ち姿がクリップと同じなら、途中はクリップのままになる", () => {
    // 終わりは立ち姿へ閉じるので、そこは比べない
    const same = {
      restOf: (bone: string) =>
        bone === "rightUpperArm" ? aroundZ(35) : IDENTITY_QUATERNION,
      parentOf,
    };
    const out = rebaseClip(longClip, same);
    close(frameAt(out.get("rightUpperArm") ?? [], 1), aroundZ(-35));
  });

  it("書き出す回転はすべて単位長である", () => {
    for (const values of rebaseClip(clip, skeleton).values()) {
      for (let at = 0; at < values.length; at += 4) {
        expect(Math.hypot(...values.slice(at, at + 4))).toBeCloseTo(1, 6);
      }
    }
  });
});

describe("sampleTrack", () => {
  const track = { times: [0, 1], values: frames(IDENTITY_QUATERNION, aroundZ(90)) };

  it("キーの時刻ではその回転を返す", () => {
    close(sampleTrack(track, 0), IDENTITY_QUATERNION);
    close(sampleTrack(track, 1), aroundZ(90));
  });

  it("間は球面線形に繋ぐ", () => {
    close(sampleTrack(track, 0.5), aroundZ(45));
  });

  it("両端の外側は端の回転のまま", () => {
    close(sampleTrack(track, -1), IDENTITY_QUATERNION);
    close(sampleTrack(track, 9), aroundZ(90));
  });
});

describe("手首の扱い", () => {
  const parents: Record<string, string | null> = {
    rightUpperArm: null,
    rightLowerArm: "rightUpperArm",
    rightHand: "rightLowerArm",
  };
  const skeletonWith = (armRest: Quaternion) => ({
    parentOf: (bone: string) => parents[bone] ?? null,
    restOf: (bone: string) =>
      bone === "rightUpperArm" ? armRest : IDENTITY_QUATERNION,
  });

  /** 腕を上げ、手のひらを（世界の）ある向きへ向けるクリップ。 */
  const clip = new Map([
    [
      "rightUpperArm",
      { times: [0, 0.5, 1], values: frames(aroundZ(35), aroundZ(-35), aroundZ(-35)) },
    ],
    [
      "rightHand",
      {
        times: [0, 0.5, 1],
        values: frames(IDENTITY_QUATERNION, aroundZ(-20), aroundZ(-20)),
      },
    ],
  ]);

  const worldOf = (
    bone: string,
    localOf: (name: string) => Quaternion,
    parentOf: (name: string) => string | null,
  ): Quaternion => {
    const parent = parentOf(bone);
    return parent === null
      ? localOf(bone)
      : multiplyQuaternions(worldOf(parent, localOf, parentOf), localOf(bone));
  };

  it("手の世界での向きが、立ち姿に依らずクリップのとおりになる", () => {
    // 手のひらがどちらを向くかは絶対値に意味がある。腕の付け根の立ち姿が
    // 違っても、見せる面は同じでなければならない
    const skeleton = skeletonWith(aroundZ(75));
    const out = rebaseClip(clip, skeleton);

    const localAt = (index: number) => (bone: string) => {
      const values = out.get(bone);
      return values === undefined ? skeleton.restOf(bone) : frameAt(values, index);
    };
    const clipLocalAt = (index: number) => (bone: string) => {
      const track = clip.get(bone);
      return track === undefined ? IDENTITY_QUATERNION : frameAt(track.values, index);
    };

    close(
      worldOf("rightHand", localAt(1), skeleton.parentOf),
      worldOf("rightHand", clipLocalAt(1), skeleton.parentOf),
    );
  });

  it("手も始まりはモデルの立ち姿にいる", () => {
    // 始めから絶対の向きにすると、腕がまだ立ち姿にいるうちに手首だけが先に
    // 回る。上げ始めに手がひとりでにねじれて見えた
    const skeleton = skeletonWith(aroundZ(75));
    const out = rebaseClip(clip, skeleton);
    close(frameAt(out.get("rightHand") ?? [], 0), skeleton.restOf("rightHand"));
  });

  it("腕の骨は相対のまま。立ち姿から始まる", () => {
    const skeleton = skeletonWith(aroundZ(75));
    const out = rebaseClip(clip, skeleton);
    close(frameAt(out.get("rightUpperArm") ?? [], 0), aroundZ(75));
  });
});

describe("withinWristRange", () => {
  const aroundX = (degrees: number): Quaternion => {
    const half = (degrees * Math.PI) / 360;
    return [Math.sin(half), 0, 0, Math.cos(half)];
  };

  it("ひねりはそのまま通す", () => {
    // 前腕の軸まわりは回内・回外で ±80 度以上動く
    const twisted = aroundX(90);
    close(withinWristRange(twisted, IDENTITY_QUATERNION), twisted);
  });

  it("曲げは頭打ちにする", () => {
    // 掌屈も背屈も、ここまでは曲がらない
    const bent = aroundZ(120);
    const limited = withinWristRange(bent, IDENTITY_QUATERNION);
    expect(angleOf(limited)).toBeLessThanOrEqual(MAX_WRIST_SWING_DEGREES + 0.001);
  });

  it("可動域に収まっている曲げは変えない", () => {
    const bent = aroundZ(30);
    close(withinWristRange(bent, IDENTITY_QUATERNION), bent);
  });

  it("大きくひねりながら深く曲げても、ひねりは残る", () => {
    // 曲げだけを削り、見せている面は保つ
    const q = multiplyQuaternions(aroundZ(120), aroundX(80));
    const limited = withinWristRange(q, IDENTITY_QUATERNION);
    const { twist } = decomposeSwingTwist(limited, [1, 0, 0, 0]);
    expect(angleOf(twist)).toBeGreaterThan(60);
  });

  it("基準からの差で測る", () => {
    // 基準は「クリップが記録した手首の角度」。それ自体はどれだけ深くても通る。
    // 向きを合わせるために足すぶんだけを頭打ちにする
    const recorded = aroundZ(80);
    close(withinWristRange(recorded, recorded), recorded);
  });
});

describe("decomposeSwingTwist", () => {
  const aroundX = (degrees: number): Quaternion => {
    const half = (degrees * Math.PI) / 360;
    return [Math.sin(half), 0, 0, Math.cos(half)];
  };

  it("分けて掛け直すと元へ戻る", () => {
    const q = multiplyQuaternions(aroundZ(40), aroundX(50));
    const { swing, twist } = decomposeSwingTwist(q, [1, 0, 0, 0]);
    close(multiplyQuaternions(swing, twist), q);
  });

  it("軸まわりだけの回転は、すべてひねりになる", () => {
    const { swing, twist } = decomposeSwingTwist(aroundX(70), [1, 0, 0, 0]);
    close(twist, aroundX(70));
    close(swing, IDENTITY_QUATERNION);
  });

  it("軸に垂直な回転は、すべて曲げになる", () => {
    const { swing, twist } = decomposeSwingTwist(aroundZ(45), [1, 0, 0, 0]);
    close(swing, aroundZ(45));
    close(twist, IDENTITY_QUATERNION);
  });
});

describe("手を上げているあいだだけ向きを合わせる", () => {
  const parents: Record<string, string | null> = {
    rightUpperArm: null,
    rightLowerArm: "rightUpperArm",
    rightHand: "rightLowerArm",
  };
  const skeleton = {
    parentOf: (bone: string) => parents[bone] ?? null,
    // 立ち姿は 75 度垂れている。クリップの休め姿勢 (35 度) とは食い違う
    restOf: (bone: string) =>
      bone === "rightUpperArm" ? aroundZ(75) : IDENTITY_QUATERNION,
  };

  /** 上げて、留めて、下ろすクリップ。手首の角度は終始そのまま。 */
  const clip = new Map([
    [
      "rightUpperArm",
      {
        times: [0, 0.6, 1.4, 2],
        values: frames(aroundZ(35), aroundZ(-35), aroundZ(-35), aroundZ(35)),
      },
    ],
    [
      "rightHand",
      {
        times: [0, 0.6, 1.4, 2],
        values: frames(
          IDENTITY_QUATERNION,
          IDENTITY_QUATERNION,
          IDENTITY_QUATERNION,
          IDENTITY_QUATERNION,
        ),
      },
    ],
  ]);

  const out = rebaseClip(clip, skeleton);
  const handAt = (index: number): Quaternion => frameAt(out.get("rightHand") ?? [], index);

  it("上げているあいだは、立ち姿の手首から離れて向きを合わせる", () => {
    // 腕が 70 度動いているので、向きを合わせ切っている
    expect(angleOf(handAt(1))).toBeGreaterThan(20);
    expect(angleOf(handAt(2))).toBeGreaterThan(20);
  });

  it("下ろし切ったところでは、手首は立ち姿のままになる", () => {
    // 腕を下ろすとき、人は手のひらを前へ向けたままにしない。肩が内へ回り、
    // 手のひらは腿のほうを向く
    close(handAt(3), skeleton.restOf("rightHand"));
  });

  it("上げ始めの手首も立ち姿のままになる", () => {
    close(handAt(0), skeleton.restOf("rightHand"));
  });
});

describe("終わりは立ち姿へ閉じる", () => {
  const parents: Record<string, string | null> = {
    rightUpperArm: null,
    rightLowerArm: "rightUpperArm",
    rightHand: "rightLowerArm",
  };
  const skeleton = {
    parentOf: (bone: string) => parents[bone] ?? null,
    restOf: (bone: string) =>
      bone === "rightUpperArm" ? aroundZ(75) : IDENTITY_QUATERNION,
  };

  /** 手だけが違う向きで終わるクリップ。撮影ものでよくある。 */
  const clip = new Map([
    [
      "rightUpperArm",
      {
        times: [0, 0.6, 1.4, 2],
        values: frames(aroundZ(35), aroundZ(-35), aroundZ(-35), aroundZ(35)),
      },
    ],
    [
      "rightHand",
      {
        times: [0, 0.6, 1.4, 2],
        values: frames(IDENTITY_QUATERNION, aroundZ(30), aroundZ(30), aroundZ(90)),
      },
    ],
  ]);

  it("手が違う向きで終わっていても、立ち姿へ戻る", () => {
    // 放っておくと身振りのあとに手首が回ったままになる (要件 F-15-3)
    const out = rebaseClip(clip, skeleton);
    close(frameAt(out.get("rightHand") ?? [], 3), skeleton.restOf("rightHand"));
    close(frameAt(out.get("rightUpperArm") ?? [], 3), skeleton.restOf("rightUpperArm"));
  });

  it("途中の姿勢は閉じない", () => {
    const out = rebaseClip(clip, skeleton);
    expect(angleOf(frameAt(out.get("rightHand") ?? [], 1))).toBeGreaterThan(5);
  });
});
