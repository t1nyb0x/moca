import { CANONICAL_EMOTIONS } from "@/domain/emotion/types";
import { VISEME_KEYS } from "@/domain/motion/compose";

export type ExpressionRole = "emotion" | "viseme" | "blink" | "lookAt" | "custom";

const BLINK_KEYS = ["blink", "blinkLeft", "blinkRight"];
const LOOK_KEYS = ["lookUp", "lookDown", "lookLeft", "lookRight"];

const ROLE_TABLE: ReadonlyMap<string, ExpressionRole> = new Map([
  ...CANONICAL_EMOTIONS.map((name) => [name, "emotion" as const] as const),
  ...VISEME_KEYS.map((name) => [name, "viseme" as const] as const),
  ...BLINK_KEYS.map((name) => [name, "blink" as const] as const),
  ...LOOK_KEYS.map((name) => [name, "lookAt" as const] as const),
]);

/**
 * 表情の役割を判定する。
 *
 * VRM の表情は感情だけではない。口形・まばたき・視線はそれぞれ別の
 * 仕組みが自動で動かしており、利用者が選ぶものではない。
 */
export function roleOf(expressionName: string): ExpressionRole {
  return ROLE_TABLE.get(expressionName) ?? "custom";
}

/** 役割ごとに分類する。表示順は ROLES に従う。 */
export const ROLES: readonly ExpressionRole[] = [
  "emotion",
  "viseme",
  "blink",
  "lookAt",
  "custom",
];

export function groupByRole(
  names: readonly string[],
): ReadonlyMap<ExpressionRole, readonly string[]> {
  const grouped = new Map<ExpressionRole, string[]>();
  for (const role of ROLES) grouped.set(role, []);
  for (const name of names) grouped.get(roleOf(name))?.push(name);
  return grouped;
}
