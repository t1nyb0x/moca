import type { Message } from "@/ipc/generated/Message";
import { estimateTokens } from "./tokens";

/**
 * コンテキスト窓の切り出し設定 (未決事項 U-4 の解決)。
 */
export type ContextWindowOptions = {
  /** 送る最大ターン数。1 ターンは 1 メッセージ。 */
  readonly maxTurns: number;
  /** 履歴に使ってよいトークン数の上限。 */
  readonly budgetTokens: number;
};

/** モデルの文脈長が不明なときの既定予算。 */
export const DEFAULT_BUDGET_TOKENS = 8_000;
export const DEFAULT_MAX_TURNS = 20;

export const DEFAULT_CONTEXT_WINDOW: ContextWindowOptions = {
  maxTurns: DEFAULT_MAX_TURNS,
  budgetTokens: DEFAULT_BUDGET_TOKENS,
};

/** モデルの文脈長から履歴用の予算を決める。半分を応答と入力に残す。 */
export function budgetFromContextLength(contextLength: number | null): number {
  if (contextLength === null || contextLength <= 0) return DEFAULT_BUDGET_TOKENS;
  return Math.floor(contextLength / 2);
}

/**
 * 送信する履歴を切り出す。
 *
 * 新しいものを優先し、古い順に落とす。ターン数と推定トークン量の
 * どちらの上限も超えないようにする。
 *
 * 1 件も入らない場合は空を返す。無理に 1 件入れると、その 1 件だけで
 * 予算を超えて送信が拒否される。
 */
export function trimHistory(
  messages: readonly Message[],
  options: ContextWindowOptions = DEFAULT_CONTEXT_WINDOW,
): Message[] {
  const maxTurns = Math.max(0, options.maxTurns);
  const budget = Math.max(0, options.budgetTokens);

  const kept: Message[] = [];
  let used = 0;

  // 新しいほうから詰めていく
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (kept.length >= maxTurns) break;

    const message = messages[index];
    if (message === undefined) continue;

    const cost = estimateTokens(message.content);
    if (used + cost > budget) break;

    used += cost;
    kept.push(message);
  }

  return kept.reverse();
}
