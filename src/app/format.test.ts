import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./format";

const now = new Date(2026, 7, 29, 15, 30); // 2026-08-29 15:30

/** その日時の地方時刻での ISO 文字列を作る。 */
function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

describe("formatTimestamp", () => {
  it("今日なら時刻だけを出す", () => {
    expect(formatTimestamp(localIso(2026, 8, 29, 9, 5), now)).toBe("09:05");
  });

  it("同じ年の別の日は月日を添える", () => {
    expect(formatTimestamp(localIso(2026, 8, 1, 9, 5), now)).toBe("8/1 09:05");
  });

  it("別の年は西暦から出す", () => {
    expect(formatTimestamp(localIso(2025, 12, 31, 23, 59), now)).toBe(
      "2025/12/31 23:59",
    );
  });

  it("時と分を 2 桁に揃える", () => {
    expect(formatTimestamp(localIso(2026, 8, 29, 0, 0), now)).toBe("00:00");
  });

  it("読み取れない値は空文字にする", () => {
    // 壊れた記録があっても一覧を壊さない
    expect(formatTimestamp("こわれている", now)).toBe("");
    expect(formatTimestamp("", now)).toBe("");
  });

  it("既定では現在時刻を基準にする", () => {
    expect(formatTimestamp(new Date().toISOString())).toMatch(/^\d{2}:\d{2}$/);
  });
});
