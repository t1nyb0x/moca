import { describe, expect, it } from "vitest";
import { EmotionTagParser, MAX_TAG_LEN } from "./parser";
import type { ParseEvent } from "./types";

/**
 * 隣接する text イベントを結合する。
 *
 * テキストは受信しだい直ちに発行されるため、チャンクの分割位置によって
 * text イベントの粒度は変わる。表示上は等価なので、比較前に正規化する。
 * 仕様: docs/emotion-protocol.md 3.7
 */
function normalize(events: readonly ParseEvent[]): ParseEvent[] {
  const out: ParseEvent[] = [];
  for (const ev of events) {
    if (ev.type !== "text") {
      out.push(ev);
      continue;
    }
    if (ev.value === "") continue;
    const last = out[out.length - 1];
    if (last?.type === "text") {
      out[out.length - 1] = { type: "text", value: last.value + ev.value };
    } else {
      out.push(ev);
    }
  }
  return out;
}

/** 入力を chunkSize 文字ずつ与えて解析する。0 は一括投入を意味する。 */
function parseInChunks(input: string, chunkSize: number): ParseEvent[] {
  const parser = new EmotionTagParser();
  const events: ParseEvent[] = [];
  if (chunkSize <= 0) {
    events.push(...parser.push(input));
  } else {
    for (let i = 0; i < input.length; i += chunkSize) {
      events.push(...parser.push(input.slice(i, i + chunkSize)));
    }
  }
  events.push(...parser.flush());
  return normalize(events);
}

/** 一括投入した場合の結果。 */
function parseAll(input: string): ParseEvent[] {
  return parseInChunks(input, 0);
}

/** イベント列から本文だけを取り出して連結する。 */
function textOf(events: readonly ParseEvent[]): string {
  return events
    .filter((e): e is Extract<ParseEvent, { type: "text" }> => e.type === "text")
    .map((e) => e.value)
    .join("");
}

const text = (value: string): ParseEvent => ({ type: "text", value });
const emotion = (
  e: "neutral" | "happy" | "angry" | "sad" | "relaxed" | "surprised",
  intensity = 1.0,
): ParseEvent => ({ type: "emotion", emotion: e, intensity });

describe("EmotionTagParser", () => {
  describe("基本", () => {
    it("タグが無ければ全文がそのまま本文になる", () => {
      expect(parseAll("こんにちは。今日はいい天気ですね。")).toEqual([
        text("こんにちは。今日はいい天気ですね。"),
      ]);
    });

    it("空入力では何も発行しない", () => {
      expect(parseAll("")).toEqual([]);
    });

    it("仕様書の例を解析できる", () => {
      expect(parseAll("あ[happy:0.8]い[sad]う")).toEqual([
        text("あ"),
        emotion("happy", 0.8),
        text("い"),
        emotion("sad"),
        text("う"),
      ]);
    });

    it("タグは本文に漏れない", () => {
      const events = parseAll("[happy]こんにちは。[relaxed]のんびりしましょう。");
      expect(textOf(events)).toBe("こんにちは。のんびりしましょう。");
    });

    it("冒頭のタグの前に本文が無い場合、空の text を発行しない", () => {
      expect(parseAll("[happy]やあ")).toEqual([emotion("happy"), text("やあ")]);
    });

    it("連続したタグを両方発行する", () => {
      expect(parseAll("[happy][sad]")).toEqual([emotion("happy"), emotion("sad")]);
    });

    it("6 種すべての感情を解決できる", () => {
      const all = "[neutral][happy][angry][sad][relaxed][surprised]";
      expect(parseAll(all)).toEqual([
        emotion("neutral"),
        emotion("happy"),
        emotion("angry"),
        emotion("sad"),
        emotion("relaxed"),
        emotion("surprised"),
      ]);
    });
  });

  describe("チャンク境界（最重要）", () => {
    const input = "あ[happy:0.8]い[sad]う";
    const expected = [
      text("あ"),
      emotion("happy", 0.8),
      text("い"),
      emotion("sad"),
      text("う"),
    ];

    it("一括投入で正しく解析できる", () => {
      expect(parseInChunks(input, 0)).toEqual(expected);
    });

    it("1 文字ずつ与えても同じ結果になる", () => {
      expect(parseInChunks(input, 1)).toEqual(expected);
    });

    it("2 文字ずつ与えても同じ結果になる", () => {
      expect(parseInChunks(input, 2)).toEqual(expected);
    });

    it("あらゆる分割幅で結果が一致する", () => {
      for (let size = 1; size <= input.length + 2; size += 1) {
        expect(parseInChunks(input, size)).toEqual(expected);
      }
    });

    it("タグを含む長文でも分割幅によらず一致する", () => {
      const long =
        "[happy]こんにちは。今日はいい天気ですね。" +
        "[relaxed]こういう日は、のんびり過ごしたくなります。" +
        "[surprised:0.6]えっ、本当ですか。[sad:0.25]そうですか……。";
      const baseline = parseInChunks(long, 0);
      for (let size = 1; size <= 7; size += 1) {
        expect(parseInChunks(long, size)).toEqual(baseline);
      }
    });
  });

  describe("強度", () => {
    it("省略時は 1.0 になる", () => {
      expect(parseAll("[happy]")).toEqual([emotion("happy", 1.0)]);
    });

    it.each([
      ["[happy:0]", "happy", 0],
      ["[happy:1]", "happy", 1],
      ["[happy:1.0]", "happy", 1],
      ["[happy:0.5]", "happy", 0.5],
      ["[happy:0.05]", "happy", 0.05],
      ["[surprised:0.6]", "surprised", 0.6],
    ] as const)("%s の強度は %f", (input, name, expectedIntensity) => {
      expect(parseAll(input)).toEqual([emotion(name, expectedIntensity)]);
    });

    it.each(["[happy:1.5]", "[happy:5]", "[happy:-0.5]", "[happy:2]"])(
      "値域外の %s はタグとして解決せず本文になる",
      (input) => {
        expect(parseAll(input)).toEqual([text(input)]);
      },
    );

    it.each(["[happy:]", "[happy:abc]", "[happy:0.]", "[happy::1]"])(
      "強度が壊れた %s は本文になる",
      (input) => {
        expect(parseAll(input)).toEqual([text(input)]);
      },
    );
  });

  describe("劣化規則（本文を絶対に失わない）", () => {
    it("未知のタグ名は本文として表示される", () => {
      expect(parseAll("[excited]わあ")).toEqual([text("[excited]わあ")]);
    });

    it("大文字のタグは本文として表示される", () => {
      expect(textOf(parseAll("[HAPPY]やあ"))).toBe("[HAPPY]やあ");
    });

    it("全角の角括弧はタグとして扱わない", () => {
      expect(textOf(parseAll("［happy］やあ"))).toBe("［happy］やあ");
    });

    it("空タグは本文として表示される", () => {
      expect(textOf(parseAll("[]やあ"))).toBe("[]やあ");
    });

    it("本文中の素の角括弧を壊さない", () => {
      expect(textOf(parseAll("配列は [0] です"))).toBe("配列は [0] です");
    });

    it("角括弧の後に日本語が続いても本文を保つ", () => {
      expect(textOf(parseAll("これは [重要] な点です"))).toBe("これは [重要] な点です");
    });

    it.each([
      "[",
      "[hap",
      "[happy",
      "[happy:",
      "[happy:0",
      "[happy:0.",
      "終わりに[",
    ])("閉じないまま終端した %s を本文として吐き出す", (input) => {
      expect(textOf(parseAll(input))).toBe(input);
    });

    it("MAX_TAG_LEN を超えた角括弧列は本文になる", () => {
      const input = "[" + "a".repeat(MAX_TAG_LEN + 5);
      expect(textOf(parseAll(input))).toBe(input);
    });

    it("長い角括弧列の後にある正当なタグを取りこぼさない", () => {
      const noise = "[" + "a".repeat(MAX_TAG_LEN + 5);
      const events = parseAll(`${noise}[happy]やあ`);
      expect(events).toContainEqual(emotion("happy"));
      expect(textOf(events)).toBe(`${noise}やあ`);
    });

    it.each([
      "こんにちは",
      "配列は [0] です",
      "[HAPPY]",
      "［happy］",
      "[]",
      "[excited]",
      "[happy:1.5]",
      "終わりに[",
      "[hap",
    ])("タグとして解決しない入力 %s は全文が保たれる", (input) => {
      expect(textOf(parseAll(input))).toBe(input);
    });
  });

  describe("早期中断", () => {
    it("二重括弧は内側をタグとして解決する", () => {
      expect(parseAll("[[happy]]")).toEqual([
        text("["),
        emotion("happy"),
        text("]"),
      ]);
    });

    it("タグに出現しえない文字を見た時点で本文へ戻る", () => {
      // 空白はタグ内に現れない (W-2) ため、そこで中断する
      expect(textOf(parseAll("[happy ]"))).toBe("[happy ]");
    });

    it("中断後もその文字から解析をやり直す", () => {
      const events = parseAll("[あ[happy]");
      expect(events).toContainEqual(emotion("happy"));
      expect(textOf(events)).toBe("[あ");
    });
  });

  describe("状態管理", () => {
    it("flush は 2 回呼んでも重複して発行しない", () => {
      const parser = new EmotionTagParser();
      parser.push("[hap");
      expect(parser.flush()).toEqual([text("[hap")]);
      expect(parser.flush()).toEqual([]);
    });

    it("reset で保持中のバッファを捨てる", () => {
      const parser = new EmotionTagParser();
      parser.push("[hap");
      parser.reset();
      expect(parser.flush()).toEqual([]);
      expect(normalize(parser.push("やあ"))).toEqual([text("やあ")]);
    });

    it("reset 後に別のストリームを解析できる", () => {
      const parser = new EmotionTagParser();
      parser.push("[happy]まえ");
      parser.reset();
      const events = normalize([...parser.push("[sad]あと"), ...parser.flush()]);
      expect(events).toEqual([emotion("sad"), text("あと")]);
    });
  });
});
