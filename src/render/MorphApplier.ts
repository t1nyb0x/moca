import { composeWeights, type ComposeInput } from "@/domain/motion/compose";
import type { PoseMap } from "@/domain/motion/pose";
import type { ModelAdapter } from "./ModelAdapter";

/**
 * 合成した重みをモデルへ書き込む唯一の場所 (ADR-0005)。
 *
 * 合成規則そのものは `composeWeights` にあり純粋。ここは書き込みだけを
 * 担う薄い層で、テストの対象外とする。
 */
export class MorphApplier {
  apply(adapter: ModelAdapter, input: ComposeInput, pose: PoseMap): void {
    adapter.applyWeights(composeWeights(input));
    adapter.applyPose(pose);
  }
}
