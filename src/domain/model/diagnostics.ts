import type { CanonicalEmotion } from "@/domain/emotion/types";
import type { MorphTarget } from "./pmx-mapping";

/**
 * 読み込んだモデルの素性。
 *
 * 表情が動かない、色が付かないといった不具合は何のエラーも出さずに起きる。
 * 原因がモデル側にあるのか経路にあるのかを切り分けられるよう、測れる値を
 * 持ち回る。
 *
 * render と app の双方から参照するため domain に置く (ADR-0012)。
 */
export type ModelDiagnostics = {
  /** 基本色テクスチャを持つ材質の数。0 は読み込み失敗の疑い。 */
  readonly textureCount: number;
  /**
   * モデルが持つ表情の名前。
   *
   * VRM の表情は役割ごとに分かれており、感情として選べるのはそのうち
   * 標準化された 5 種だけ。残りは口形・まばたき・視線に自動で使われるか、
   * モデル固有のカスタム表情（現状は未使用、未決事項 U-6）である。
   */
  readonly expressionNames: readonly string[];
  /** 表現できる感情。VRM 0.x には surprised が無い (emotion-protocol.md 4.2)。 */
  readonly expressibleEmotions: readonly CanonicalEmotion[];
  /** 直接の表情が無く、別の表情で近似している感情。 */
  readonly approximatedEmotions: readonly CanonicalEmotion[];
  /** 描画に使われている実装。ソフトウェア描画の検出に使う (要件 R-3)。 */
  readonly rendererName: string;
  /**
   * 感情ごとのモーフ割り当て。PMX のみ。VRM は表情が標準化されており
   * 割り当ての概念が無いので null。
   */
  readonly emotionMorphs: Readonly<
    Record<CanonicalEmotion, readonly MorphTarget[]>
  > | null;
};
