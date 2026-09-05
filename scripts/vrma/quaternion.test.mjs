import { describe, expect, it } from "vitest";

import {
  eulerToQuaternion,
  IDENTITY,
  multiply,
  normalize,
  rotateVector,
  slerp,
} from "./quaternion.mjs";

const close = (actual, expected) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
};

describe("eulerToQuaternion", () => {
  it("無回転は単位回転になる", () => {
    close(eulerToQuaternion({}), IDENTITY);
  });

  it("Z まわりに 90 度回すと X 軸が Y 軸へ向く", () => {
    close(rotateVector(eulerToQuaternion({ z: 90 }), [1, 0, 0]), [0, 1, 0]);
  });

  it("Y まわりに 90 度回すと X 軸が -Z へ向く", () => {
    close(rotateVector(eulerToQuaternion({ y: 90 }), [1, 0, 0]), [0, 0, -1]);
  });

  it("長さを変えない", () => {
    const [x, y, z] = rotateVector(eulerToQuaternion({ x: 33, y: -12, z: 71 }), [0, 1, 0]);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
  });
});

describe("multiply", () => {
  it("単位回転は何も変えない", () => {
    const rotation = eulerToQuaternion({ x: 10, y: 20, z: 30 });
    close(multiply(IDENTITY, rotation), rotation);
    close(multiply(rotation, IDENTITY), rotation);
  });

  it("親と子を重ねると角度が足し合わさる", () => {
    const composed = multiply(eulerToQuaternion({ z: 30 }), eulerToQuaternion({ z: 20 }));
    close(composed, eulerToQuaternion({ z: 50 }));
  });
});

describe("slerp", () => {
  it("両端はそのままの回転を返す", () => {
    const a = eulerToQuaternion({ z: 10 });
    const b = eulerToQuaternion({ z: 80 });
    close(slerp(a, b, 0), a);
    close(slerp(a, b, 1), b);
  });

  it("半分では角度も半分になる", () => {
    const half = slerp(eulerToQuaternion({ z: 0 }), eulerToQuaternion({ z: 90 }), 0.5);
    close(half, eulerToQuaternion({ z: 45 }));
  });

  it("遠回りしない", () => {
    // 裏返した回転は同じ姿勢を指す。そのまま混ぜると 1 周してしまう
    const a = eulerToQuaternion({ z: 10 });
    const b = eulerToQuaternion({ z: 40 }).map((value) => -value);
    close(slerp(a, b, 0.5), eulerToQuaternion({ z: 25 }));
  });

  it("途中でも単位長を保つ", () => {
    const mid = slerp(eulerToQuaternion({ x: 20 }), eulerToQuaternion({ y: 70, z: 30 }), 0.37);
    expect(Math.hypot(...mid)).toBeCloseTo(1, 6);
  });
});

describe("normalize", () => {
  it("長さを 1 にする", () => {
    expect(Math.hypot(...normalize([0, 0, 3, 4]))).toBeCloseTo(1, 6);
  });

  it("長さ 0 は単位回転にする", () => {
    close(normalize([0, 0, 0, 0]), IDENTITY);
  });
});
