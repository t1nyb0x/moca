/**
 * モーフ名から重み (0.0〜1.0) への写像。
 *
 * コントローラはこれを返すだけで、three.js のオブジェクトには触れない。
 * 実際の書き込みは MorphApplier 1 箇所に隔離する (ADR-0005)。
 */
export type WeightMap = Readonly<Record<string, number>>;

/**
 * 時刻と状態からモーフ重みを導く純粋なコントローラ。
 *
 * `advance` が唯一の時間依存な遷移で、`evaluate` は副作用のない射影。
 * 乱数を使う実装は生成器の状態を `S` に含めて決定的にすること。
 */
export interface Controller<S> {
  /** 初期状態。seed を要する実装は生成関数を別に持つ。 */
  advance(state: S, deltaSeconds: number): S;
  evaluate(state: S): WeightMap;
}

/** 0.0〜1.0 に丸める。 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
