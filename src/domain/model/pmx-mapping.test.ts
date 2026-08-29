import { describe, expect, it } from "vitest";
import { applyOverrides, canExpress, resolveDefaultMapping } from "./pmx-mapping";

/** MMD の標準的なモデルに広く見られるモーフ名。 */
const STANDARD = [
  // 眉
  "真面目", "困る", "にこり", "怒り", "上", "下",
  // 目
  "まばたき", "笑い", "ウィンク", "ウィンク2", "はぅ", "なごみ",
  "びっくり", "じと目", "キリッ", "はちゅ目",
  // 口
  "あ", "い", "う", "え", "お", "にやり", "にっこり", "ω", "▲", "∧", "□", "ワ", "ん",
  // その他
  "照れ", "涙",
];

describe("resolveDefaultMapping", () => {
  it("標準的なモデルなら全部の感情が当たる", () => {
    const mapping = resolveDefaultMapping(STANDARD);
    for (const emotion of ["happy", "angry", "sad", "relaxed", "surprised"] as const) {
      expect(mapping.emotions[emotion].length).toBeGreaterThan(0);
      expect(canExpress(mapping, emotion)).toBe(true);
    }
  });

  it("neutral には割り当てを作らない", () => {
    // neutral はすべてを 0 にすることで表す
    const mapping = resolveDefaultMapping(STANDARD);
    expect(mapping.emotions.neutral).toEqual([]);
    expect(canExpress(mapping, "neutral")).toBe(true);
  });

  it("母音の口形を見つける", () => {
    const mapping = resolveDefaultMapping(STANDARD);
    expect(mapping.visemes).toEqual({
      aa: "あ",
      ih: "い",
      ou: "う",
      ee: "え",
      oh: "お",
    });
  });

  it("まばたきを見つける", () => {
    expect(resolveDefaultMapping(STANDARD).blink).toBe("まばたき");
  });

  it("当たった枠の重みを保つ", () => {
    const mapping = resolveDefaultMapping(STANDARD);
    const happy = mapping.emotions.happy;
    expect(happy).toContainEqual({ morphName: "笑い", weight: 1 });
    for (const target of happy) {
      expect(target.weight).toBeGreaterThan(0);
      expect(target.weight).toBeLessThanOrEqual(1);
    }
  });

  it("候補は先に書いたものを優先する", () => {
    // にこり と にっこり の両方があれば、にこり を採る
    const mapping = resolveDefaultMapping(["にこり", "にっこり"]);
    expect(mapping.emotions.happy[0]?.morphName).toBe("にこり");
  });

  it("持っていないモーフは割り当てない", () => {
    // 目のモーフしか無いモデル
    const mapping = resolveDefaultMapping(["笑い", "びっくり"]);
    expect(mapping.emotions.happy).toEqual([{ morphName: "笑い", weight: 1 }]);
    expect(mapping.emotions.angry).toEqual([]);
    expect(mapping.visemes.aa).toBeNull();
    expect(mapping.blink).toBeNull();
  });

  it("半端に当たっても、当たったぶんは動かす", () => {
    // 全部揃わないと何も動かない、という作りにはしない
    const mapping = resolveDefaultMapping(["怒り"]);
    expect(canExpress(mapping, "angry")).toBe(true);
    expect(mapping.emotions.angry).toHaveLength(1);
  });

  it("モーフを持たないモデルでも壊れない", () => {
    const mapping = resolveDefaultMapping([]);
    for (const emotion of ["happy", "angry", "sad", "relaxed", "surprised"] as const) {
      expect(mapping.emotions[emotion]).toEqual([]);
      expect(canExpress(mapping, emotion)).toBe(false);
    }
    expect(canExpress(mapping, "neutral")).toBe(true);
    expect(mapping.blink).toBeNull();
  });

  it("知らない名前だけのモデルでも壊れない", () => {
    const mapping = resolveDefaultMapping(["Fcl_ALL_Joy", "ほっぺ", "メガネ消し"]);
    expect(canExpress(mapping, "happy")).toBe(false);
    expect(mapping.visemes.aa).toBeNull();
  });

  it("同じモーフが複数の感情に使われてもよい", () => {
    // にこり は happy と relaxed の両方で使う
    const mapping = resolveDefaultMapping(STANDARD);
    const happyNames = mapping.emotions.happy.map((t) => t.morphName);
    const relaxedNames = mapping.emotions.relaxed.map((t) => t.morphName);
    expect(happyNames).toContain("にこり");
    expect(relaxedNames).toContain("にこり");
  });
});

describe("applyOverrides", () => {
  const base = resolveDefaultMapping(STANDARD);

  it("指定した感情を置き換える", () => {
    const result = applyOverrides(
      base,
      { happy: [{ morphName: "照れ", weight: 0.9 }] },
      STANDARD,
    );
    expect(result.emotions.happy).toEqual([{ morphName: "照れ", weight: 0.9 }]);
  });

  it("指定は部分的に混ぜず、まるごと置き換える", () => {
    // どこまでが利用者の意思か分からなくなるため
    const result = applyOverrides(base, { happy: [] }, STANDARD);
    expect(result.emotions.happy).toEqual([]);
    expect(canExpress(result, "happy")).toBe(false);
  });

  it("指定の無い感情は既定のまま残す", () => {
    const result = applyOverrides(base, { happy: [] }, STANDARD);
    expect(result.emotions.angry).toEqual(base.emotions.angry);
  });

  it("存在しないモーフ名は落とす", () => {
    // モデルを差し替えたあとに古い設定が残っていても壊れない
    const result = applyOverrides(
      base,
      { happy: [{ morphName: "存在しない", weight: 1 }, { morphName: "照れ", weight: 1 }] },
      STANDARD,
    );
    expect(result.emotions.happy).toEqual([{ morphName: "照れ", weight: 1 }]);
  });

  it("口形とまばたきには触らない", () => {
    const result = applyOverrides(base, { happy: [] }, STANDARD);
    expect(result.visemes).toEqual(base.visemes);
    expect(result.blink).toBe(base.blink);
  });

  it("元の割り当てを変更しない", () => {
    const before = JSON.stringify(base.emotions);
    applyOverrides(base, { happy: [{ morphName: "照れ", weight: 1 }] }, STANDARD);
    expect(JSON.stringify(base.emotions)).toBe(before);
  });

  it("指定が空なら何も変わらない", () => {
    expect(applyOverrides(base, {}, STANDARD)).toEqual(base);
  });
});
