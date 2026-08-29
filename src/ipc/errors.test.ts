import { describe, expect, it } from "vitest";
import { isCommandError, toCommandError } from "./errors";

const commandError = {
  kind: "auth" as const,
  message: "認証に失敗しました",
  retryAfterMs: null,
  status: null,
};

describe("isCommandError", () => {
  it("Rust 側のエラーを判別できる", () => {
    expect(isCommandError(commandError)).toBe(true);
  });

  it.each([null, undefined, 42, "文字列", {}, { kind: "unknown", message: "x" }, { kind: "auth" }])(
    "%o は CommandError ではない",
    (value) => {
      expect(isCommandError(value)).toBe(false);
    },
  );
});

describe("toCommandError", () => {
  it("CommandError はそのまま通す", () => {
    expect(toCommandError(commandError)).toBe(commandError);
  });

  it("Error を protocol として包む", () => {
    const result = toCommandError(new Error("壊れました"));
    expect(result.kind).toBe("protocol");
    expect(result.message).toBe("壊れました");
  });

  it("文字列を protocol として包む", () => {
    expect(toCommandError("なにか失敗").message).toBe("なにか失敗");
  });

  it.each([null, undefined, "", 0, {}])(
    "手がかりが無ければ既定の文言にする (%o)",
    (value) => {
      const result = toCommandError(value);
      expect(result.kind).toBe("protocol");
      expect(result.message).not.toBe("");
    },
  );

  it("常に UI に出せる文言を持つ", () => {
    for (const value of [commandError, new Error(""), null, 123]) {
      expect(toCommandError(value).message.length).toBeGreaterThan(0);
    }
  });
});
