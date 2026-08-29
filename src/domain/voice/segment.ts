import type { CanonicalEmotion } from "@/domain/emotion/types";

/**
 * 読み上げの単位を切り出す。
 *
 * 合成器は文の全体を受け取ってから音声を返すので、返答が出来上がるまで
 * 待つと喋り始めが遅れる。文が閉じた時点で切り出して順に合成すれば、
 * 受信しながら喋れる。
 *
 * 感情が変わる位置でも切る。一つの音声に複数の感情は乗せられないため、
 * ここで切らないと感情の切り替えが次の文までずれる。
 */

/** 文の終わり。 */
const TERMINATORS = new Set(["。", "！", "？", "!", "?", "\n"]);

/**
 * 区切りが来なくても切り出す長さ。
 *
 * 句点を打たないモデルがある。際限なく貯めると一度も喋らないまま
 * 終わってしまう。
 */
const MAX_LENGTH = 80;

/** 区切りを探し始める長さ。短すぎる断片を作らない。 */
const MIN_LENGTH = 2;

export type SpeechSegment = {
  readonly text: string;
  readonly emotion: CanonicalEmotion;
};

export type SegmenterState = {
  readonly buffer: string;
  readonly emotion: CanonicalEmotion;
};

export function createSegmenter(emotion: CanonicalEmotion = "neutral"): SegmenterState {
  return { buffer: "", emotion };
}

export type SegmentResult = {
  readonly state: SegmenterState;
  readonly segments: readonly SpeechSegment[];
};

/**
 * 受信した差分を積み、切り出せた分を返す。
 *
 * @param emotion この差分の先頭から適用される感情。変わらないなら null。
 */
export function pushSpeech(
  state: SegmenterState,
  text: string,
  emotion: CanonicalEmotion | null = null,
): SegmentResult {
  const segments: SpeechSegment[] = [];
  let buffer = state.buffer;
  let current = state.emotion;

  if (emotion !== null && emotion !== current) {
    // 感情が変わる前の分は、変わる前の感情で読み上げる。
    const pending = buffer.trim();
    if (pending !== "") segments.push({ text: pending, emotion: current });
    buffer = "";
    current = emotion;
  }

  for (const char of text) {
    buffer += char;
    const done =
      (TERMINATORS.has(char) && buffer.trim().length >= MIN_LENGTH) ||
      buffer.length >= MAX_LENGTH;
    if (!done) continue;
    const ready = buffer.trim();
    if (ready !== "") segments.push({ text: ready, emotion: current });
    buffer = "";
  }

  return { state: { buffer, emotion: current }, segments };
}

/** 受信が終わったときに、残りを切り出す。 */
export function flushSpeech(state: SegmenterState): SegmentResult {
  const ready = state.buffer.trim();
  if (ready === "") return { state: { ...state, buffer: "" }, segments: [] };
  return {
    state: { ...state, buffer: "" },
    segments: [{ text: ready, emotion: state.emotion }],
  };
}
