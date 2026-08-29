import { describe, expect, it } from "vitest";
import type { CommandError, CommandErrorKind } from "@/ipc/errors";
import { describeError } from "./error-display";

function error(kind: CommandErrorKind, extra: Partial<CommandError> = {}): CommandError {
  return {
    kind,
    message: "何かが起きました",
    retryAfterMs: null,
    status: null,
    ...extra,
  };
}

const ALL_KINDS: CommandErrorKind[] = [
  "auth",
  "rateLimit",
  "contextTooLong",
  "network",
  "protocol",
  "server",
  "notFound",
  "io",
  "invalid",
];

describe("describeError", () => {
  it("主文は Rust 側の文言をそのまま使う", () => {
    expect(describeError(error("auth")).message).toBe("何かが起きました");
  });

  it.each(ALL_KINDS)("%s を扱える", (kind) => {
    const display = describeError(error(kind));
    expect(display.message).not.toBe("");
    expect(typeof display.retryable).toBe("boolean");
  });

  it("レート制限は待ち時間を秒で示す", () => {
    const display = describeError(error("rateLimit", { retryAfterMs: 30_000 }));
    expect(display.hint).toContain("30 秒");
  });

  it("待ち時間が 1 秒未満でも 1 秒として示す", () => {
    const display = describeError(error("rateLimit", { retryAfterMs: 200 }));
    expect(display.hint).toContain("1 秒");
  });

  it("待ち時間が不明なら秒数を出さない", () => {
    const display = describeError(error("rateLimit"));
    expect(display.hint).toBe("しばらく待ってから再試行してください。");
  });

  it.each<[CommandErrorKind, boolean]>([
    ["rateLimit", true],
    ["network", true],
    ["server", true],
    ["auth", false],
    ["contextTooLong", false],
    ["notFound", false],
    ["invalid", false],
    ["io", false],
    ["protocol", false],
  ])("%s の再試行可否は %s", (kind, expected) => {
    expect(describeError(error(kind)).retryable).toBe(expected);
  });

  it("接続失敗ではローカル LLM の起動を促す", () => {
    expect(describeError(error("network")).hint).toContain("起動しているか");
  });

  it("認証失敗では API キーの確認を促す", () => {
    expect(describeError(error("auth")).hint).toContain("API キー");
  });

  it("手当てのしようがない種別はヒントを出さない", () => {
    expect(describeError(error("notFound")).hint).toBeNull();
    expect(describeError(error("invalid")).hint).toBeNull();
  });
});
