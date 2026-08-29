import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

import type { CanonicalEmotion } from "@/domain/emotion/types";
import { EMOTION_KEYS, VISEME_KEYS } from "@/domain/motion/compose";
import type { WeightMap } from "@/domain/motion/types";
import type { ModelAdapter } from "./ModelAdapter";

/** 書き込みを試みる表情名。ここに無いキーは無視する。 */
const WRITABLE_KEYS: readonly string[] = [
  ...EMOTION_KEYS,
  ...VISEME_KEYS,
  "blink",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
];

export class VrmAdapter implements ModelAdapter {
  readonly format = "vrm" as const;

  readonly #vrm: VRM;
  readonly #available: Set<string>;
  readonly #chest: THREE.Object3D | null;
  readonly #spine: THREE.Object3D | null;
  readonly #chestRestX: number;
  readonly #spineRestX: number;

  constructor(vrm: VRM) {
    this.#vrm = vrm;
    this.#available = new Set(
      vrm.expressionManager?.expressions.map(
        (expression) => expression.expressionName,
      ) ?? [],
    );

    this.#chest =
      vrm.humanoid.getNormalizedBoneNode("chest") ??
      vrm.humanoid.getNormalizedBoneNode("upperChest");
    this.#spine = vrm.humanoid.getNormalizedBoneNode("spine");
    this.#chestRestX = this.#chest?.rotation.x ?? 0;
    this.#spineRestX = this.#spine?.rotation.x ?? 0;
  }

  get object(): THREE.Object3D {
    return this.#vrm.scene;
  }

  availableMorphs(): readonly string[] {
    return [...this.#available];
  }

  /**
   * VRM 0.x には surprised に相当するプリセットが無い
   * (docs/emotion-protocol.md 4.2)。読み込み時に判定しておき、UI から
   * 表現できない感情が分かるようにする。
   */
  canExpress(emotion: CanonicalEmotion): boolean {
    if (emotion === "neutral") return true;
    return this.#available.has(emotion);
  }

  applyWeights(weights: WeightMap): void {
    const manager = this.#vrm.expressionManager;
    if (manager === undefined || manager === null) return;

    for (const key of WRITABLE_KEYS) {
      if (!this.#available.has(key)) continue;
      manager.setValue(key, weights[key] ?? 0);
    }
  }

  applyBreath(chestPitchRadians: number, spinePitchRadians: number): void {
    if (this.#chest !== null) {
      this.#chest.rotation.x = this.#chestRestX + chestPitchRadians;
    }
    if (this.#spine !== null) {
      this.#spine.rotation.x = this.#spineRestX + spinePitchRadians;
    }
  }

  update(deltaSeconds: number): void {
    this.#vrm.update(deltaSeconds);
  }

  setLookAtTarget(target: THREE.Object3D | null): void {
    if (this.#vrm.lookAt === undefined || this.#vrm.lookAt === null) return;
    this.#vrm.lookAt.target = target;
  }

  headWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    const head = this.#vrm.humanoid.getNormalizedBoneNode("head");
    if (head === null) return out.set(0, this.height() * 0.9, 0);
    return head.getWorldPosition(out);
  }

  height(): number {
    const box = new THREE.Box3().setFromObject(this.#vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    return size.y > 0 ? size.y : 1.5;
  }

  dispose(): void {
    VRMUtils.deepDispose(this.#vrm.scene);
  }
}

/**
 * VRM を読み込む。
 *
 * アセットプロトコル経由の URL を受け取り、WebView が直接取得する。
 * ファイルの中身は IPC を通らない (docs/ipc-contract.md 2.5)。
 */
export async function loadVrm(url: string): Promise<VrmAdapter> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (vrm === undefined) {
    throw new Error("VRM として読み込めませんでした");
  }

  // 描画負荷を下げる。読み込み時に一度だけ。
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.combineSkeletons(vrm.scene);

  // VRM 0.x は前後が逆を向いているので回す
  VRMUtils.rotateVRM0(vrm);

  vrm.scene.traverse((object) => {
    object.frustumCulled = false;
  });

  return new VrmAdapter(vrm);
}
