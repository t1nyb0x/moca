import { NEUTRAL_CUE, type EmotionCue } from "@/domain/emotion/types";

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
  /**
   * この区間の表情。強さも持ち回る。
   *
   * 感情名だけにすると強さが失われ、`[happy:0.6]` がすべて最大強度に
   * なる。モデルによっては最大強度で目が閉じるため、顔が壊れる。
   */
  readonly cue: EmotionCue;
};

export type SegmenterState = {
  readonly buffer: string;
  readonly cue: EmotionCue;
};

export function createSegmenter(cue: EmotionCue = NEUTRAL_CUE): SegmenterState {
  return { buffer: "", cue };
}

export type SegmentResult = {
  readonly state: SegmenterState;
  readonly segments: readonly SpeechSegment[];
};

/**
 * 受信した差分を積み、切り出せた分を返す。
 *
 * @param cue この差分の先頭から適用される感情と強さ。変わらないなら null。
 */
export function pushSpeech(
  state: SegmenterState,
  text: string,
  cue: EmotionCue | null = null,
): SegmentResult {
  const segments: SpeechSegment[] = [];
  let buffer = state.buffer;
  let current = state.cue;

  const changed =
    cue !== null &&
    (cue.emotion !== current.emotion || cue.intensity !== current.intensity);
  if (changed) {
    // 感情が変わる前の分は、変わる前の感情で読み上げる。
    const pending = buffer.trim();
    if (pending !== "") segments.push({ text: pending, cue: current });
    buffer = "";
    current = cue;
  }

  for (const char of text) {
    buffer += char;
    const done =
      (TERMINATORS.has(char) && buffer.trim().length >= MIN_LENGTH) ||
      buffer.length >= MAX_LENGTH;
    if (!done) continue;
    const ready = buffer.trim();
    if (ready !== "") segments.push({ text: ready, cue: current });
    buffer = "";
  }

  return { state: { buffer, cue: current }, segments };
}

/** 受信が終わったときに、残りを切り出す。 */
export function flushSpeech(state: SegmenterState): SegmentResult {
  const ready = state.buffer.trim();
  if (ready === "") return { state: { ...state, buffer: "" }, segments: [] };
  return {
    state: { ...state, buffer: "" },
    segments: [{ text: ready, cue: state.cue }],
  };
}
