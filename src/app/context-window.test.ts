import { describe, expect, it } from "vitest";
import type { Message } from "@/ipc/generated/Message";
import {
  DEFAULT_BUDGET_TOKENS,
  suggestBudget,
  trimHistory,
} from "./context-window";

function message(content: string, index: number): Message {
  return {
    role: index % 2 === 0 ? "user" : "assistant",
    content,
    rawContent: null,
    emotions: null,
    createdAt: "2026-08-29T00:00:00Z",
  };
}

function history(count: number, content = "こんにちは"): Message[] {
  return Array.from({ length: count }, (_, index) => message(`${content}${index}`, index));
}

describe("trimHistory", () => {
  it("上限に収まっていれば全部返す", () => {
    const messages = history(5);
    expect(trimHistory(messages, { maxTurns: 20, budgetTokens: 10_000 })).toEqual(messages);
  });

  it("ターン数の上限で古いものから落とす", () => {
    const messages = history(30);
    const kept = trimHistory(messages, { maxTurns: 20, budgetTokens: 1_000_000 });
    expect(kept).toHaveLength(20);
    expect(kept[kept.length - 1]).toEqual(messages[29]);
    expect(kept[0]).toEqual(messages[10]);
  });

  it("並び順を保つ", () => {
    const messages = history(30);
    const kept = trimHistory(messages, { maxTurns: 5, budgetTokens: 1_000_000 });
    const contents = kept.map((m) => m.content);
    expect(contents).toEqual([...contents].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))));
  });

  it("トークン予算で古いものから落とす", () => {
    // 1 件およそ 5 トークン
    const messages = history(10, "あいうえ");
    const kept = trimHistory(messages, { maxTurns: 100, budgetTokens: 12 });
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(10);
    // 残るのは新しいほう
    expect(kept[kept.length - 1]).toEqual(messages[9]);
  });

  it("予算が足りなければ何も返さない", () => {
    // 1 件でも入らないなら空。無理に入れるとその 1 件で予算超過になる
    const messages = history(3, "とても長い文章をここに入れておきます");
    expect(trimHistory(messages, { maxTurns: 20, budgetTokens: 1 })).toEqual([]);
  });

  it("空の履歴は空を返す", () => {
    expect(trimHistory([], { maxTurns: 20, budgetTokens: 1000 })).toEqual([]);
  });

  it("上限が 0 なら空を返す", () => {
    expect(trimHistory(history(5), { maxTurns: 0, budgetTokens: 1000 })).toEqual([]);
    expect(trimHistory(history(5), { maxTurns: 20, budgetTokens: 0 })).toEqual([]);
  });

  it("負の上限を 0 として扱う", () => {
    expect(trimHistory(history(5), { maxTurns: -1, budgetTokens: -1 })).toEqual([]);
  });

  it("元の配列を変更しない", () => {
    const messages = history(30);
    const copy = [...messages];
    trimHistory(messages, { maxTurns: 5, budgetTokens: 1000 });
    expect(messages).toEqual(copy);
  });

  it("既定の設定で動く", () => {
    expect(trimHistory(history(50))).toHaveLength(20);
  });
});

describe("suggestBudget", () => {
  it("文脈長の半分を提案する", () => {
    // 残り半分は今回の入力と応答のために空けておく
    expect(suggestBudget(32_000)).toBe(16_000);
  });

  it.each([null, 0, -1])("不明な場合 (%o) は既定値", (value) => {
    expect(suggestBudget(value)).toBe(DEFAULT_BUDGET_TOKENS);
  });
});
