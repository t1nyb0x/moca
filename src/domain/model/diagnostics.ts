import type { CanonicalEmotion } from "@/domain/emotion/types";

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
  /** モデルが持つ表情の総数。0 なら表情を一切動かせない。 */
  readonly expressionCount: number;
  /** 表現できる感情。VRM 0.x には surprised が無い (emotion-protocol.md 4.2)。 */
  readonly expressibleEmotions: readonly CanonicalEmotion[];
  /** 描画に使われている実装。ソフトウェア描画の検出に使う (要件 R-3)。 */
  readonly rendererName: string;
};
