import { describe, expect, it } from "vitest";
import { directoryOf, resolveTexturePath } from "./texture-path";

describe("directoryOf", () => {
  it.each([
    ["C:\\models\\china\\china.pmx", "C:\\models\\china"],
    ["/home/me/models/china.pmx", "/home/me/models"],
    ["china.pmx", ""],
  ])("%s の親は %s", (path, expected) => {
    expect(directoryOf(path)).toBe(expected);
  });
});

describe("resolveTexturePath", () => {
  const model = "C:\\models\\china\\china.pmx";

  it("同じディレクトリのテクスチャを解決する", () => {
    // 報告された失敗そのもの
    expect(resolveTexturePath(model, "服2.tga")).toBe("C:\\models\\china\\服2.tga");
  });

  it("下位ディレクトリを解決する", () => {
    expect(resolveTexturePath(model, "tex\\肌.png")).toBe(
      "C:\\models\\china\\tex\\肌.png",
    );
  });

  it("区切りが混ざっていても解決する", () => {
    // PMX の中では / と \\ が混在することがある
    expect(resolveTexturePath(model, "tex/肌.png")).toBe(
      "C:\\models\\china\\tex\\肌.png",
    );
  });

  it("上位への参照を畳む", () => {
    expect(resolveTexturePath(model, "..\\共通\\目.png")).toBe(
      "C:\\models\\共通\\目.png",
    );
  });

  it("現在位置の指定を無視する", () => {
    expect(resolveTexturePath(model, ".\\服.tga")).toBe("C:\\models\\china\\服.tga");
  });

  it("ルートより上へは戻さない", () => {
    expect(resolveTexturePath("C:\\a.pmx", "..\\..\\..\\x.png")).toBe("C:\\x.png");
  });

  it("既に絶対パスならそのまま返す", () => {
    expect(resolveTexturePath(model, "D:\\shared\\toon.bmp")).toBe(
      "D:\\shared\\toon.bmp",
    );
  });

  it("空の指定は空を返す", () => {
    expect(resolveTexturePath(model, "")).toBe("");
    expect(resolveTexturePath(model, "   ")).toBe("");
  });

  it("POSIX のパスでも区切りを保つ", () => {
    expect(resolveTexturePath("/home/me/china.pmx", "tex/肌.png")).toBe(
      "/home/me/tex/肌.png",
    );
  });

  it("元のパスの区切りに合わせる", () => {
    // Windows のパスなら \\ で返す。混ぜると解決できない
    const resolved = resolveTexturePath(model, "tex/a.png");
    expect(resolved).not.toContain("/");
  });
});
