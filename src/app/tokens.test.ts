import { describe, expect, it } from "vitest";
import { estimateTokens } from "./tokens";

describe("estimateTokens", () => {
  it("空文字は 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("日本語はおおむね文字数ぶん", () => {
    expect(estimateTokens("こんにちは")).toBe(5);
  });

  it("ASCII は 4 文字で 1 トークン程度", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("混在も足し合わせる", () => {
    expect(estimateTokens("abcdこんにちは")).toBe(1 + 5);
  });

  it("常に少なく見積もらない", () => {
    // 切り捨てると送信が拒否されるので、端数は切り上げる
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("サロゲートペアを 1 文字として数える", () => {
    expect(estimateTokens("\u{20BB7}")).toBe(1);
  });

  it("長さに対して単調", () => {
    let previous = 0;
    let text = "";
    for (let i = 0; i < 50; i += 1) {
      text += "あ";
      const current = estimateTokens(text);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});
