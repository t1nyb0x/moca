import { describe, expect, it } from "vitest";

import {
  describeGestureTagProblem,
  normalizeGestureTag,
  usableGestures,
  validateGestureTag,
  type GestureBinding,
} from "./gesture";

function binding(tag: string, path = "C:/m/a.vrma"): GestureBinding {
  return { tag, path, name: "a" };
}

describe("validateGestureTag", () => {
  it("英小文字だけの名前を認める", () => {
    expect(validateGestureTag("wave")).toBeNull();
    expect(validateGestureTag("bow")).toBeNull();
  });

  it("空の名前を断る", () => {
    expect(validateGestureTag("")).toBe("empty");
  });

  it("英小文字以外を含む名前を断る", () => {
    // パーサは [a-z]+ しか拾わない。外れると本文として画面に出る。
    for (const tag of ["Wave", "wave1", "手を振る", "wave!", "wa ve", "wave-2"]) {
      expect(validateGestureTag(tag), tag).toBe("shape");
    }
  });

  it("感情タグと同じ名前を断る", () => {
    // パーサが感情として解決してしまい、身振りには届かない
    for (const tag of ["happy", "sad", "neutral", "surprised"]) {
      expect(validateGestureTag(tag), tag).toBe("reserved");
    }
  });

  it("既にある名前を断る", () => {
    expect(validateGestureTag("wave", ["bow", "wave"])).toBe("duplicate");
  });

  it("自分以外に同じ名前が無ければ通す", () => {
    expect(validateGestureTag("wave", ["bow"])).toBeNull();
  });
});

describe("describeGestureTagProblem", () => {
  it("すべての問題に文言がある", () => {
    for (const problem of ["empty", "shape", "reserved", "duplicate"] as const) {
      expect(describeGestureTagProblem(problem).length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeGestureTag", () => {
  it("前後の空白を落として小文字にする", () => {
    expect(normalizeGestureTag("  Wave  ")).toBe("wave");
  });
});

describe("usableGestures", () => {
  it("正しい割り当てをそのまま残す", () => {
    const list = usableGestures([binding("wave"), binding("bow")]);
    expect(list.map((item) => item.tag)).toEqual(["wave", "bow"]);
  });

  it("名前を整えてから判定する", () => {
    expect(usableGestures([binding(" WAVE ")])[0]?.tag).toBe("wave");
  });

  it("使えない名前を落とす", () => {
    // 設定ファイルは手で書き換えられる。壊れた割り当てでプロンプトを汚さない。
    const list = usableGestures([binding("happy"), binding("Wave2"), binding("bow")]);
    expect(list.map((item) => item.tag)).toEqual(["bow"]);
  });

  it("同じタグは先に書かれたほうを採る", () => {
    const list = usableGestures([
      binding("wave", "C:/m/1.vrma"),
      binding("wave", "C:/m/2.vrma"),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]?.path).toBe("C:/m/1.vrma");
  });

  it("ファイルの無い割り当てを落とす", () => {
    expect(usableGestures([binding("wave", "")])).toHaveLength(0);
  });
});
