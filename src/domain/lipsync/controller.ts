import { clamp01, type WeightMap } from "../motion/types";
import { cuesOf, type Viseme, type VisemeCue } from "./viseme";

export type LipSyncConfig = {
  /** 1 秒あたりに消化する文字数。未決事項 U-5。実機で調整する。 */
  readonly charsPerSecond: number;
  /** 口を開くまでの時間。短いほど機敏だが、短すぎるとがたつく。 */
  readonly attackSeconds: number;
  /** 口を閉じるまでの時間。開くより緩やかにする。 */
  readonly decaySeconds: number;
  /** 消化するものが尽きてから閉口するまでの猶予。 */
  readonly idleCloseSeconds: number;
};

export const DEFAULT_LIPSYNC_CONFIG: LipSyncConfig = {
  charsPerSecond: 10,
  attackSeconds: 0.04,
  decaySeconds: 0.08,
  idleCloseSeconds: 0.15,
};

export type LipSyncState = {
  /** 未消化のキュー。 */
  readonly pending: readonly VisemeCue[];
  /** 現在の口形。null なら一度も口形が決まっていない。 */
  readonly current: Viseme | null;
  /** 包絡の現在値。 */
  readonly level: number;
  /** 包絡の目標値。0 か 1 のみ。 */
  readonly target: number;
  /** 前回の消化からの経過秒。 */
  readonly sinceConsume: number;
  /**
   * 最後に何かを消化した、または投入されてからの経過秒。
   *
   * 「投入からの経過」で測ると、長文を入れた瞬間から時間が進むため、
   * 消化し終えた途端に閉口してしまう。最後の消化を起点にする必要がある。
   */
  readonly sinceActivity: number;
};

export function createLipSyncState(): LipSyncState {
  return {
    pending: [],
    current: null,
    level: 0,
    target: 0,
    sinceConsume: 0,
    sinceActivity: 0,
  };
}

/** 受信したテキストを口形のキューへ変換して積む。 */
export function feedLipSync(state: LipSyncState, text: string): LipSyncState {
  if (text === "") return state;
  return {
    ...state,
    pending: [...state.pending, ...cuesOf(text)],
    sinceActivity: 0,
  };
}

export function advanceLipSync(
  state: LipSyncState,
  deltaSeconds: number,
  config: LipSyncConfig = DEFAULT_LIPSYNC_CONFIG,
): LipSyncState {
  if (deltaSeconds <= 0) return state;

  let { current, target, sinceConsume, sinceActivity } = state;
  let pending = state.pending;

  sinceConsume += deltaSeconds;
  sinceActivity += deltaSeconds;

  const interval = 1 / config.charsPerSecond;
  const consumed = Math.min(
    pending.length,
    Math.floor(sinceConsume / interval),
  );
  for (const cue of pending.slice(0, consumed)) {
    sinceConsume -= interval;
    sinceActivity = 0;

    if (cue.kind === "viseme") {
      current = cue.viseme;
      target = 1;
    } else if (cue.kind === "hold") {
      target = 1;
    } else {
      target = 0;
    }
  }

  if (consumed > 0) pending = pending.slice(consumed);

  if (pending.length === 0) {
    // 消化待ちが無いなら時間を貯めない。次の投入で一気に消化されないように。
    sinceConsume = 0;
    if (sinceActivity >= config.idleCloseSeconds) target = 0;
  }

  const level =
    state.level < target
      ? Math.min(target, state.level + deltaSeconds / config.attackSeconds)
      : Math.max(target, state.level - deltaSeconds / config.decaySeconds);

  return {
    pending,
    current,
    level: clamp01(level),
    target,
    sinceConsume,
    sinceActivity,
  };
}

export function evaluateLipSync(state: LipSyncState): WeightMap {
  if (state.current === null || state.level <= 0) return {};
  return { [state.current]: state.level };
}
