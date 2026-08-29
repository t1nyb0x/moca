import { describe, expect, it } from "vitest";
import { createSegmenter, flushSpeech, pushSpeech } from "./segment";

describe("pushSpeech", () => {
  it("文が閉じたところで切り出す", () => {
    const { segments } = pushSpeech(createSegmenter(), "こんにちは。お元気ですか？");
    expect(segments).toEqual([
      { text: "こんにちは。", emotion: "neutral" },
      { text: "お元気ですか？", emotion: "neutral" },
    ]);
  });

  it("閉じていない分は次に持ち越す", () => {
    const first = pushSpeech(createSegmenter(), "こんにち");
    expect(first.segments).toEqual([]);
    const second = pushSpeech(first.state, "は。");
    expect(second.segments).toEqual([{ text: "こんにちは。", emotion: "neutral" }]);
  });

  it("感情が変わる位置で切る", () => {
    // 一つの音声に複数の感情は乗せられない
    const first = pushSpeech(createSegmenter(), "そうですね");
    const second = pushSpeech(first.state, "うれしいですわ。", "happy");
    expect(second.segments[0]).toEqual({ text: "そうですね", emotion: "neutral" });
    expect(second.segments[1]).toEqual({ text: "うれしいですわ。", emotion: "happy" });
  });

  it("同じ感情が続いても切らない", () => {
    const first = pushSpeech(createSegmenter("happy"), "とても");
    const second = pushSpeech(first.state, "うれしい。", "happy");
    expect(second.segments).toEqual([{ text: "とてもうれしい。", emotion: "happy" }]);
  });

  it("感情の指定だけでも切り替わる", () => {
    const state = pushSpeech(createSegmenter(), "", "sad").state;
    expect(state.emotion).toBe("sad");
  });

  it("句点が無くても長くなれば切り出す", () => {
    // 句読点を打たないモデルでも喋り始められるように
    const { segments } = pushSpeech(createSegmenter(), "あ".repeat(200));
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) expect(segment.text.length).toBeLessThanOrEqual(80);
  });

  it("改行でも切り出す", () => {
    const { segments } = pushSpeech(createSegmenter(), "はい\nそうです\n");
    expect(segments).toHaveLength(2);
  });

  it("記号だけの断片を作らない", () => {
    const { segments } = pushSpeech(createSegmenter(), "。");
    expect(segments).toEqual([]);
  });

  it("前後の空白を落とす", () => {
    const { segments } = pushSpeech(createSegmenter(), "  はい。  ");
    expect(segments[0]?.text).toBe("はい。");
  });

  it("英語の疑問符と感嘆符も区切りになる", () => {
    const { segments } = pushSpeech(createSegmenter(), "Hello! Are you ok?");
    expect(segments).toHaveLength(2);
  });

  it("元の状態を書き換えない", () => {
    const state = createSegmenter();
    pushSpeech(state, "こんにちは。");
    expect(state.buffer).toBe("");
  });

  it("複数のコードポイントからなる文字を壊さない", () => {
    const { state } = pushSpeech(createSegmenter(), "\u{1F600}");
    expect(state.buffer).toBe("\u{1F600}");
  });
});

describe("flushSpeech", () => {
  it("残りを切り出す", () => {
    const { state } = pushSpeech(createSegmenter(), "終わりです");
    const { segments } = flushSpeech(state);
    expect(segments).toEqual([{ text: "終わりです", emotion: "neutral" }]);
  });

  it("残りが無ければ何も出さない", () => {
    expect(flushSpeech(createSegmenter()).segments).toEqual([]);
  });

  it("空白だけなら何も出さない", () => {
    const { state } = pushSpeech(createSegmenter(), "   ");
    expect(flushSpeech(state).segments).toEqual([]);
  });

  it("感情を引き継ぐ", () => {
    const { state } = pushSpeech(createSegmenter(), "つらい", "sad");
    expect(flushSpeech(state).segments[0]?.emotion).toBe("sad");
  });

  it("二度呼んでも重複しない", () => {
    const { state } = pushSpeech(createSegmenter(), "残り");
    const once = flushSpeech(state);
    expect(flushSpeech(once.state).segments).toEqual([]);
  });
});
