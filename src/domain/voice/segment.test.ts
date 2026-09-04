import { describe, expect, it } from "vitest";
import { NEUTRAL_CUE, type EmotionCue } from "@/domain/emotion/types";
import { createSegmenter, flushSpeech, pushSpeech } from "./segment";
import type { GestureCue } from "@/domain/emotion/types";

const cue = (emotion: EmotionCue["emotion"], intensity = 1): EmotionCue => ({
  emotion,
  intensity,
});

const wave = (tag = "wave", intensity = 1): GestureCue => ({ tag, intensity });

/** 区間の比較。身振りは指定しなければ空。 */
const segment = (
  text: string,
  cue: EmotionCue,
  gestures: readonly GestureCue[] = [],
): { text: string; cue: EmotionCue; gestures: readonly GestureCue[] } => ({
  text,
  cue,
  gestures,
});

describe("pushSpeech", () => {
  it("文が閉じたところで切り出す", () => {
    const { segments } = pushSpeech(createSegmenter(), "こんにちは。お元気ですか？");
    expect(segments).toEqual([
      segment("こんにちは。", NEUTRAL_CUE),
      segment("お元気ですか？", NEUTRAL_CUE),
    ]);
  });

  it("閉じていない分は次に持ち越す", () => {
    const first = pushSpeech(createSegmenter(), "こんにち");
    expect(first.segments).toEqual([]);
    const second = pushSpeech(first.state, "は。");
    expect(second.segments).toEqual([segment("こんにちは。", NEUTRAL_CUE)]);
  });

  it("感情が変わる位置で切る", () => {
    // 一つの音声に複数の感情は乗せられない
    const first = pushSpeech(createSegmenter(), "そうですね");
    const second = pushSpeech(first.state, "うれしいですわ。", cue("happy"));
    expect(second.segments[0]).toEqual(segment("そうですね", NEUTRAL_CUE));
    expect(second.segments[1]).toEqual(segment("うれしいですわ。", cue("happy")));
  });

  it("同じ感情が続いても切らない", () => {
    const first = pushSpeech(createSegmenter(cue("happy")), "とても");
    const second = pushSpeech(first.state, "うれしい。", cue("happy"));
    expect(second.segments).toEqual([segment("とてもうれしい。", cue("happy"))]);
  });

  it("強さも持ち回る", () => {
    // 落とすと [happy:0.6] が最大強度になり、目が閉じるモデルで顔が壊れる
    const { segments } = pushSpeech(createSegmenter(), "うれしい。", cue("happy", 0.6));
    expect(segments[0]?.cue.intensity).toBe(0.6);
  });

  it("同じ感情でも強さが変われば切る", () => {
    const first = pushSpeech(createSegmenter(), "すこし", cue("happy", 0.4));
    const second = pushSpeech(first.state, "とても。", cue("happy", 0.9));
    expect(second.segments[0]).toEqual(segment("すこし", cue("happy", 0.4)));
    expect(second.segments[1]).toEqual(segment("とても。", cue("happy", 0.9)));
  });

  it("身振りは次に切り出す区間の先頭へ付く", () => {
    // 読み上げより先に手が動くと、言葉と身振りがずれて見える
    const { segments } = pushSpeech(createSegmenter(), "やあ。", null, [wave()]);
    expect(segments).toEqual([segment("やあ。", NEUTRAL_CUE, [wave()])]);
  });

  it("区間が閉じるまで身振りを持ち越す", () => {
    const first = pushSpeech(createSegmenter(), "こんにち", null, [wave()]);
    expect(first.segments).toEqual([]);
    expect(first.state.gestures).toEqual([wave()]);

    const second = pushSpeech(first.state, "は。");
    expect(second.segments).toEqual([segment("こんにちは。", NEUTRAL_CUE, [wave()])]);
    expect(second.state.gestures).toEqual([]);
  });

  it("一度出した身振りを次の区間へ繰り越さない", () => {
    const { segments } = pushSpeech(createSegmenter(), "やあ。またね。", null, [wave()]);
    expect(segments[0]?.gestures).toEqual([wave()]);
    expect(segments[1]?.gestures).toEqual([]);
  });

  it("感情が変わる位置では変わる前の区間へ付ける", () => {
    // 溜まっている身振りは、既にバッファへ入っている本文に対応する
    const first = pushSpeech(createSegmenter(), "そうですね", null, [wave()]);
    const second = pushSpeech(first.state, "うれしい。", cue("happy"), [wave("bow")]);
    expect(second.segments[0]).toEqual(segment("そうですね", NEUTRAL_CUE, [wave()]));
    expect(second.segments[1]).toEqual(
      segment("うれしい。", cue("happy"), [wave("bow")]),
    );
  });

  it("同じ差分に複数の身振りが来たら順に並べる", () => {
    const { segments } = pushSpeech(createSegmenter(), "やあ。", null, [
      wave("bow"),
      wave(),
    ]);
    expect(segments[0]?.gestures).toEqual([wave("bow"), wave()]);
  });

  it("感情の指定だけでも切り替わる", () => {
    const state = pushSpeech(createSegmenter(), "", cue("sad")).state;
    expect(state.cue).toEqual(cue("sad"));
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
    expect(segments).toEqual([segment("終わりです", NEUTRAL_CUE)]);
  });

  it("残りが無ければ何も出さない", () => {
    expect(flushSpeech(createSegmenter()).segments).toEqual([]);
  });

  it("空白だけなら何も出さない", () => {
    const { state } = pushSpeech(createSegmenter(), "   ");
    expect(flushSpeech(state).segments).toEqual([]);
  });

  it("感情と強さを引き継ぐ", () => {
    const { state } = pushSpeech(createSegmenter(), "つらい", cue("sad", 0.7));
    expect(flushSpeech(state).segments[0]?.cue).toEqual(cue("sad", 0.7));
  });

  it("残りの本文へ身振りを付ける", () => {
    const { state } = pushSpeech(createSegmenter(), "終わりです", null, [wave()]);
    expect(flushSpeech(state).segments[0]?.gestures).toEqual([wave()]);
  });

  it("本文が残っていなければ身振りは状態に残る", () => {
    // 末尾のタグの後に本文が続かない場合。呼び出し側が拾って待たずに動かす。
    const { state } = pushSpeech(createSegmenter(), "", null, [wave()]);
    const result = flushSpeech(state);
    expect(result.segments).toEqual([]);
    expect(result.state.gestures).toEqual([wave()]);
  });

  it("二度呼んでも重複しない", () => {
    const { state } = pushSpeech(createSegmenter(), "残り");
    const once = flushSpeech(state);
    expect(flushSpeech(once.state).segments).toEqual([]);
  });
});
