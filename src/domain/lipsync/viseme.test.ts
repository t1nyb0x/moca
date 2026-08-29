import { describe, expect, it } from "vitest";
import { cueOf, cuesOf, type VisemeCue } from "./viseme";

const viseme = (v: "aa" | "ih" | "ou" | "ee" | "oh"): VisemeCue => ({
  kind: "viseme",
  viseme: v,
});
const hold: VisemeCue = { kind: "hold" };
const close: VisemeCue = { kind: "close" };

describe("cueOf", () => {
  describe("母音の行", () => {
    it.each([
      ["あ行", "あかさたなはまやらわ", "aa"],
      ["い行", "いきしちにひみり", "ih"],
      ["う行", "うくすつぬふむゆる", "ou"],
      ["え行", "えけせてねへめれ", "ee"],
      ["お行", "おこそとのほもよろを", "oh"],
    ] as const)("%s は %s になる", (_name, chars, expected) => {
      for (const char of chars) {
        expect(cueOf(char)).toEqual(viseme(expected));
      }
    });

    it.each([
      ["濁音のあ行", "がざだば", "aa"],
      ["濁音のい行", "ぎじぢび", "ih"],
      ["濁音のう行", "ぐずづぶ", "ou"],
      ["濁音のえ行", "げぜでべ", "ee"],
      ["濁音のお行", "ごぞどぼ", "oh"],
      ["半濁音", "ぱ", "aa"],
      ["半濁音", "ぴ", "ih"],
      ["半濁音", "ぷ", "ou"],
      ["半濁音", "ぺ", "ee"],
      ["半濁音", "ぽ", "oh"],
    ] as const)("%s の %s は %s になる", (_name, chars, expected) => {
      for (const char of chars) {
        expect(cueOf(char)).toEqual(viseme(expected));
      }
    });

    it("小書きのカナも母音で写像する", () => {
      expect(cueOf("ぁ")).toEqual(viseme("aa"));
      expect(cueOf("ぃ")).toEqual(viseme("ih"));
      expect(cueOf("ぅ")).toEqual(viseme("ou"));
      expect(cueOf("ぇ")).toEqual(viseme("ee"));
      expect(cueOf("ぉ")).toEqual(viseme("oh"));
      expect(cueOf("ゃ")).toEqual(viseme("aa"));
      expect(cueOf("ゅ")).toEqual(viseme("ou"));
      expect(cueOf("ょ")).toEqual(viseme("oh"));
    });
  });

  describe("カタカナ", () => {
    it("平仮名と同じ結果になる", () => {
      const pairs: ReadonlyArray<readonly [string, string]> = [
        ["ア", "あ"],
        ["キ", "き"],
        ["ス", "す"],
        ["テ", "て"],
        ["ノ", "の"],
        ["ヴ", "ゔ"],
        ["ャ", "ゃ"],
      ];
      for (const [kata, hira] of pairs) {
        expect(cueOf(kata)).toEqual(cueOf(hira));
      }
    });
  });

  describe("直前を保持する文字", () => {
    it.each(["っ", "ッ", "ん", "ン", "ー", "〜", "～"])(
      "%s は hold になる",
      (char) => {
        expect(cueOf(char)).toEqual(hold);
      },
    );
  });

  describe("閉口する文字", () => {
    it.each(["。", "、", "！", "？", "!", "?", ".", ",", " ", "\n", "\t", "「", "」", "…"])(
      "%s は close になる",
      (char) => {
        expect(cueOf(char)).toEqual(close);
      },
    );
  });

  describe("境界", () => {
    it("空文字は close になる", () => {
      expect(cueOf("")).toEqual(close);
    });
  });

  describe("その他", () => {
    it.each(["漢", "字", "A", "z", "1"])(
      "カナ以外の %s は既定で aa になる",
      (char) => {
        expect(cueOf(char)).toEqual(viseme("aa"));
      },
    );
  });
});

describe("cuesOf", () => {
  it("文字列を先頭から順に写像する", () => {
    expect(cuesOf("あい。")).toEqual([viseme("aa"), viseme("ih"), close]);
  });

  it("空文字では何も返さない", () => {
    expect(cuesOf("")).toEqual([]);
  });

  it("実際の発話らしい文を写像できる", () => {
    expect(cuesOf("こんにちは。")).toEqual([
      viseme("oh"), // こ
      hold, // ん
      viseme("ih"), // に
      viseme("ih"), // ち
      viseme("aa"), // は
      close, // 。
    ]);
  });

  it("長音を含む文を写像できる", () => {
    expect(cuesOf("そうですね〜")).toEqual([
      viseme("oh"), // そ
      viseme("ou"), // う
      viseme("ee"), // で
      viseme("ou"), // す
      viseme("ee"), // ね
      hold, // 〜
    ]);
  });

  it("サロゲートペアを割らない", () => {
    // 結合文字を含む文字列でも文字数ぶんのキューを返す
    const text = "あ\u{20BB7}い";
    expect(cuesOf(text)).toHaveLength(3);
  });
});
