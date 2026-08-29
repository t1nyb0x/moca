import { describe, expect, it } from "vitest";
import { groupByRole, roleOf, ROLES } from "./expression-roles";

describe("roleOf", () => {
  it.each(["neutral", "happy", "angry", "sad", "relaxed", "surprised"])(
    "%s は感情",
    (name) => {
      expect(roleOf(name)).toBe("emotion");
    },
  );

  it.each(["aa", "ih", "ou", "ee", "oh"])("%s は口形", (name) => {
    expect(roleOf(name)).toBe("viseme");
  });

  it.each(["blink", "blinkLeft", "blinkRight"])("%s はまばたき", (name) => {
    expect(roleOf(name)).toBe("blink");
  });

  it.each(["lookUp", "lookDown", "lookLeft", "lookRight"])("%s は視線", (name) => {
    expect(roleOf(name)).toBe("lookAt");
  });

  it.each(["Fcl_ALL_Joy", "ほっぺ", "unknown"])(
    "%s はモデル固有として扱う",
    (name) => {
      expect(roleOf(name)).toBe("custom");
    },
  );
});

describe("groupByRole", () => {
  it("役割ごとに分類する", () => {
    const grouped = groupByRole(["happy", "aa", "blink", "lookUp", "ほっぺ"]);
    expect(grouped.get("emotion")).toEqual(["happy"]);
    expect(grouped.get("viseme")).toEqual(["aa"]);
    expect(grouped.get("blink")).toEqual(["blink"]);
    expect(grouped.get("lookAt")).toEqual(["lookUp"]);
    expect(grouped.get("custom")).toEqual(["ほっぺ"]);
  });

  it("すべての役割の枠を用意する", () => {
    const grouped = groupByRole([]);
    for (const role of ROLES) {
      expect(grouped.get(role)).toEqual([]);
    }
  });

  it("並び順を保つ", () => {
    const grouped = groupByRole(["happy", "sad", "angry"]);
    expect(grouped.get("emotion")).toEqual(["happy", "sad", "angry"]);
  });

  it("総数が一致する", () => {
    const names = ["happy", "aa", "blink", "lookUp", "ほっぺ", "unknown"];
    const total = [...groupByRole(names).values()].reduce(
      (sum, list) => sum + list.length,
      0,
    );
    expect(total).toBe(names.length);
  });
});
