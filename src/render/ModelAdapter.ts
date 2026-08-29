import type * as THREE from "three";

import type { CanonicalEmotion } from "@/domain/emotion/types";
import type { WeightMap } from "@/domain/motion/types";

export type ModelFormatName = "vrm" | "pmx";

/**
 * モデル形式の差異を吸収する境界 (ADR-0004)。
 *
 * MVP では `VrmAdapter` 1 実装のみ。実装が 1 つしかない抽象は本来
 * 避けるべきだが、PMX 対応 (P1) の存在が確定しているため正当化される。
 */
export interface ModelAdapter {
  readonly format: ModelFormatName;
  /** シーンへ追加する対象。 */
  readonly object: THREE.Object3D;
  /** 基本色テクスチャを持つ材質の数。0 は読み込み失敗の疑い。 */
  readonly textureCount: number;

  /** モデルが持つ表情・モーフの名称。マッピングの解決に使う。 */
  availableMorphs(): readonly string[];

  /** その感情をこのモデルで表現できるか。 */
  canExpress(emotion: CanonicalEmotion): boolean;

  /** 表現できる感情の一覧。モデルによって欠けるものがある。 */
  expressibleEmotions(): readonly CanonicalEmotion[];

  /** 合成済みの重みを書き込む。 */
  applyWeights(weights: WeightMap): void;

  /** 呼吸をボーンの回転として与える。表情モーフでは表せないため別経路。 */
  applyBreath(chestPitchRadians: number, spinePitchRadians: number): void;

  /** 毎フレーム呼ぶ。SpringBone や視線の更新を含む。 */
  update(deltaSeconds: number): void;

  setLookAtTarget(target: THREE.Object3D | null): void;

  /** 頭の位置。カメラの構図決めに使う。 */
  headWorldPosition(out: THREE.Vector3): THREE.Vector3;

  /** モデル全体の高さ。 */
  height(): number;

  dispose(): void;
}
