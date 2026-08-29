import { clamp01, type WeightMap } from "../motion/types";
import { cuesOf, type Viseme, type VisemeCue } from "./viseme";

/**
 * 音声再生に同期した口の駆動 (ADR-0014, docs/emotion-protocol.md 7)。
 *
 * 疑似リップシンク (controller.ts) は文字数と時間から口を動かすため、
 * 実際の発話と少しずつずれていく。読み上げた音声があるなら、推測する
 * 必要は無い。
 *
 * - どの口形か: 合成に渡したのと同じ文から作ったキューを、再生位置で
 *   割り当てる。文と音声は同じものなので位置は対応する。
 * - どれだけ開くか: その瞬間の音量。息継ぎや無声区間で自然に閉じる。
 *
 * 評価結果は疑似リップシンクと同じ WeightMap なので、合成器の有無で
 * 上の層は変わらない。
 */

export type AudioLipSyncConfig = {
  /** 口を開くまでの時間。 */
  readonly attackSeconds: number;
  /** 口を閉じるまでの時間。開くより緩やかにする。 */
  readonly decaySeconds: number;
  /** これを下回る音量は無音とみなす。 */
  readonly silence: number;
  /**
   * 直近の最大音量の減衰。
   *
   * 音量をそのまま開き具合にすると、静かな声でほとんど口が動かない。
   * 直近の最大値で割って正規化し、その基準を徐々に下げることで、
   * 声の大小にかかわらず口が動くようにする。
   */
  readonly peakDecayPerSecond: number;
  /** 基準の下限。無音を増幅して口が痙攣するのを防ぐ。 */
  readonly peakFloor: number;
};

export const DEFAULT_AUDIO_LIPSYNC_CONFIG: AudioLipSyncConfig = {
  attackSeconds: 0.03,
  decaySeconds: 0.07,
  silence: 0.02,
  peakDecayPerSecond: 0.5,
  peakFloor: 0.08,
};

export type AudioLipSyncState = {
  /** 読み上げる文から作った口形の並び。 */
  readonly cues: readonly VisemeCue[];
  /** 次に見るキューの位置。 */
  readonly index: number;
  /** 現在の口形。 */
  readonly current: Viseme | null;
  /** 口を閉じる指示 (句読点) の直後か。 */
  readonly closed: boolean;
  /** 包絡の現在値。 */
  readonly level: number;
  /** 正規化の基準となる直近の最大音量。 */
  readonly peak: number;
};

/** 読み上げる文から状態を作る。再生開始前に呼ぶ。 */
export function createAudioLipSyncState(text = ""): AudioLipSyncState {
  return {
    cues: cuesOf(text),
    index: 0,
    current: null,
    closed: false,
    level: 0,
    peak: 0,
  };
}

export type AudioSample = {
  /** 再生位置。0.0〜1.0。 */
  readonly progress: number;
  /** その瞬間の音量。0.0〜1.0。 */
  readonly amplitude: number;
};

export function advanceAudioLipSync(
  state: AudioLipSyncState,
  deltaSeconds: number,
  sample: AudioSample,
  config: AudioLipSyncConfig = DEFAULT_AUDIO_LIPSYNC_CONFIG,
): AudioLipSyncState {
  if (deltaSeconds <= 0) return state;

  let { current, closed, index } = state;

  // 再生位置までのキューをまとめて消化する。取りこぼすと口形が固まる。
  const wanted = Math.min(
    state.cues.length,
    Math.floor(clamp01(sample.progress) * state.cues.length),
  );
  for (let i = index; i < wanted; i += 1) {
    const cue = state.cues[i];
    if (cue === undefined) break;
    if (cue.kind === "viseme") {
      current = cue.viseme;
      closed = false;
    } else if (cue.kind === "hold") {
      closed = false;
    } else {
      closed = true;
    }
  }
  index = Math.max(index, wanted);

  const decayed = Math.max(state.peak - config.peakDecayPerSecond * deltaSeconds, 0);
  const peak = Math.max(decayed, sample.amplitude);
  const reference = Math.max(peak, config.peakFloor);

  const openness =
    closed || sample.amplitude <= config.silence
      ? 0
      : clamp01(sample.amplitude / reference);

  const level =
    state.level < openness
      ? Math.min(openness, state.level + deltaSeconds / config.attackSeconds)
      : Math.max(openness, state.level - deltaSeconds / config.decaySeconds);

  return { ...state, index, current, closed, level: clamp01(level), peak };
}

export function evaluateAudioLipSync(state: AudioLipSyncState): WeightMap {
  if (state.current === null || state.level <= 0) return {};
  return { [state.current]: state.level };
}

/**
 * 時間領域の波形から音量を求める。
 *
 * `AnalyserNode.getByteTimeDomainData` は無音を 128 とした符号無し 8bit
 * を返す。中心からのずれの二乗平均を取り、0.0〜1.0 に直す。
 */
export function rmsOf(waveform: Uint8Array): number {
  if (waveform.length === 0) return 0;
  let sum = 0;
  for (const value of waveform) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  return clamp01(Math.sqrt(sum / waveform.length));
}

/**
 * 再生位置に対応する感情。
 *
 * 感情タグの位置を文字数で記録しておき、口と同じ位置で切り替える。
 * 受信時に切り替えると顔だけ先に進んでしまう (ADR-0014)。
 */
export function emotionAt<T>(
  marks: readonly { readonly at: number; readonly value: T }[],
  progress: number,
  total: number,
): T | null {
  if (marks.length === 0 || total <= 0) return null;
  const position = clamp01(progress) * total;
  let found: T | null = null;
  for (const mark of marks) {
    if (mark.at > position) break;
    found = mark.value;
  }
  return found;
}
