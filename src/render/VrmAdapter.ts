import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

import type { CanonicalEmotion } from "@/domain/emotion/types";
import { EMOTION_KEYS, VISEME_KEYS } from "@/domain/motion/compose";
import type { WeightMap } from "@/domain/motion/types";
import type { ModelAdapter } from "./ModelAdapter";

/** 腕を下ろす角度。T ポーズから自然な立ち姿へ。 */
const RELAXED_UPPER_ARM_RADIANS = 1.2;
/** 肘のわずかな曲げ。まっすぐだと棒のように見える。 */
const RELAXED_LOWER_ARM_RADIANS = 0.14;

/**
 * 片腕を下ろす。
 *
 * VRM の初期姿勢は仕様で T ポーズと決まっているが、既に腕が下りている
 * モデルもあり得るので実測してから適用する。回転の向きも符号を決め打ち
 * せず、手が下がるほうを選ぶ。左右やモデルの向きで符号が変わるため。
 */
function relaxArm(
  vrm: VRM,
  upperName: "leftUpperArm" | "rightUpperArm",
  lowerName: "leftLowerArm" | "rightLowerArm",
  handName: "leftHand" | "rightHand",
): void {
  const upper = vrm.humanoid.getNormalizedBoneNode(upperName);
  if (upper === null) return;
  const probe = vrm.humanoid.getNormalizedBoneNode(handName) ?? upper;

  const shoulder = new THREE.Vector3();
  const hand = new THREE.Vector3();

  vrm.scene.updateMatrixWorld(true);
  upper.getWorldPosition(shoulder);
  probe.getWorldPosition(hand);

  const armLength = shoulder.distanceTo(hand);
  if (armLength > 0 && shoulder.y - hand.y > armLength * 0.3) {
    // すでに下がっている。触らない。
    return;
  }

  const before = hand.y;
  upper.rotation.z = RELAXED_UPPER_ARM_RADIANS;
  vrm.scene.updateMatrixWorld(true);
  probe.getWorldPosition(hand);

  if (hand.y > before) {
    // 手が上がったので回転の向きが逆
    upper.rotation.z = -RELAXED_UPPER_ARM_RADIANS;
    vrm.scene.updateMatrixWorld(true);
  }

  const lower = vrm.humanoid.getNormalizedBoneNode(lowerName);
  if (lower !== null) {
    lower.rotation.z = Math.sign(upper.rotation.z) * RELAXED_LOWER_ARM_RADIANS;
  }
}

/**
 * 立ち姿を整える。
 *
 * T ポーズのままだと人形にしか見えない。モーションデータを持たない MVP
 * では、初期姿勢を作り変えることが「生きている感」の前提になる
 * (ADR-0005 の補足)。
 */
export function applyRelaxedPose(vrm: VRM): void {
  relaxArm(vrm, "leftUpperArm", "leftLowerArm", "leftHand");
  relaxArm(vrm, "rightUpperArm", "rightLowerArm", "rightHand");
  vrm.humanoid.update();
}

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

/**
 * 基本色テクスチャが貼られている材質の数を数える。
 *
 * 0 枚なら、モデルにテクスチャが無いか、読み込みに失敗している。
 * 埋め込みテクスチャは blob URL を作って fetch で読むため、CSP の
 * connect-src に blob: が無いと静かに失敗し、真っ白なモデルになる。
 * 二度と黙って起きないよう数を持ち回る。
 */
function countTexturedMaterials(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.material === undefined || mesh.material === null) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if ("map" in material && material.map !== null && material.map !== undefined) {
        count += 1;
      }
    }
  });
  return count;
}

export class VrmAdapter implements ModelAdapter {
  readonly format = "vrm" as const;
  /** 基本色テクスチャを持つ材質の数。0 は読み込み失敗の疑い。 */
  readonly textureCount: number;

  readonly #vrm: VRM;
  readonly #available: Set<string>;
  readonly #chest: THREE.Object3D | null;
  readonly #spine: THREE.Object3D | null;
  readonly #chestRestX: number;
  readonly #spineRestX: number;

  constructor(vrm: VRM) {
    this.#vrm = vrm;
    this.textureCount = countTexturedMaterials(vrm.scene);
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

  // T ポーズのままでは人形に見える。腕を下ろしてから返す。
  applyRelaxedPose(vrm);

  return new VrmAdapter(vrm);
}
