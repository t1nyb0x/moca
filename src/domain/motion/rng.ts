/**
 * 決定的な擬似乱数生成器 (mulberry32)。
 *
 * `Math.random()` を直接使うとテストが書けない。まばたきの間隔分布や
 * サッケードが可動域を超えないことは検証したい性質なので、生成器の状態を
 * 呼び出し側の state に持たせて決定的にする (ADR-0005)。
 */
export type RngState = number;

/** 任意の整数から初期状態を作る。 */
export function seedRng(seed: number): RngState {
  return seed | 0;
}

/** 0 以上 1 未満の値と、次の状態を返す。 */
export function nextFloat(state: RngState): { state: RngState; value: number } {
  const advanced = (state + 0x6d2b79f5) | 0;
  let t = advanced;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: advanced, value };
}

/** min 以上 max 未満の値を返す。 */
export function nextInRange(
  state: RngState,
  min: number,
  max: number,
): { state: RngState; value: number } {
  const next = nextFloat(state);
  return { state: next.state, value: min + next.value * (max - min) };
}
