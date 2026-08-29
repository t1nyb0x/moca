import { describe, expect, it } from "vitest";
import { resolveDefaultPresets } from "./emotion-preset";

/** 実機の「花隈千冬」が持つ成分。GET /v1/voice/emotions で確認した。 */
const CHIFUYU = ["嬉しい", "普通", "怒り", "哀しみ", "落ち着き"];

describe("resolveDefaultPresets", () => {
  it("実機のキャストで主な感情が当たる", () => {
    const presets = resolveDefaultPresets(CHIFUYU);
    expect(presets.happy.components).toEqual({ 嬉しい: 0.9, 普通: 0.1 });
    expect(presets.angry.components).toEqual({ 怒り: 0.9, 普通: 0.1 });
    expect(presets.sad.components).toEqual({ 哀しみ: 0.9, 普通: 0.1 });
    expect(presets.relaxed.components).toEqual({ 落ち着き: 0.9, 普通: 0.1 });
  });

  it("平常は普通だけを立てる", () => {
    expect(resolveDefaultPresets(CHIFUYU).neutral.components).toEqual({ 普通: 1 });
  });

  it("専用の成分が無い感情は普通のまま抑揚で差を出す", () => {
    // 驚きを持つキャストは少ない
    const presets = resolveDefaultPresets(CHIFUYU);
    expect(presets.surprised.components).toEqual({ 普通: 1 });
    expect(presets.surprised.pitch).toBeGreaterThan(0);
    expect(presets.surprised.intonation).toBeGreaterThan(1);
  });

  it("成分を持たない接続先でも抑揚で表す", () => {
    // VOICEVOX には感情成分が無い
    const presets = resolveDefaultPresets([]);
    for (const emotion of ["happy", "angry", "sad", "relaxed", "surprised"] as const) {
      expect(presets[emotion].components).toEqual({});
      expect(presets[emotion].speed).not.toBeNull();
    }
  });

  it("平常には補正を掛けない", () => {
    const presets = resolveDefaultPresets([]);
    expect(presets.neutral.speed).toBeNull();
    expect(presets.neutral.pitch).toBeNull();
    expect(presets.neutral.intonation).toBeNull();
  });

  it("感情ごとに声色が違う", () => {
    const presets = resolveDefaultPresets([]);
    expect(presets.sad.speed).toBeLessThan(1);
    expect(presets.angry.speed).toBeGreaterThan(1);
    expect(presets.sad.pitch).toBeLessThan(0);
    expect(presets.happy.pitch).toBeGreaterThan(0);
  });

  it("候補は先に書いたものを優先する", () => {
    const presets = resolveDefaultPresets(["哀しみ", "悲しみ", "普通"]);
    expect(Object.keys(presets.sad.components)).toContain("哀しみ");
    expect(Object.keys(presets.sad.components)).not.toContain("悲しみ");
  });

  it("普通に相当する成分が無くても壊れない", () => {
    const presets = resolveDefaultPresets(["嬉しい"]);
    expect(presets.happy.components).toEqual({ 嬉しい: 0.9 });
    expect(presets.neutral.components).toEqual({});
  });

  it("知らない名前だけでも壊れない", () => {
    const presets = resolveDefaultPresets(["なにか", "ほか"]);
    for (const emotion of ["happy", "sad"] as const) {
      expect(presets[emotion].components).toEqual({});
    }
  });

  it("六種すべてに割り当てを作る", () => {
    const presets = resolveDefaultPresets(CHIFUYU);
    expect(Object.keys(presets)).toHaveLength(6);
  });
});
