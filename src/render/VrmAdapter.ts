import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

import { CANONICAL_EMOTIONS, type CanonicalEmotion } from "@/domain/emotion/types";
import { EMOTION_KEYS, VISEME_KEYS } from "@/domain/motion/compose";
import type { WeightMap } from "@/domain/motion/types";
import type { ModelAdapter } from "./ModelAdapter";

/**
 * 直接の表情を持たない感情の代替。
 *
 * VRM 0.x には surprised に相当するプリセットが無い
 * (docs/emotion-protocol.md 4.2)。何もしないと無反応になるため、
 * 使える表情の組み合わせで近似する。眉を動かす手段が無いので、
 * 口を開けることで驚きらしさを出す。
 */
const EMOTION_SUBSTITUTES: Readonly<
  Partial<Record<CanonicalEmotion, readonly { name: string; scale: number }[]>>
> = {
  surprised: [{ name: "oh", scale: 0.45 }],
};

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
  /** 直接の表情が無い感情を、使える表情で近似するための対応表。 */
  readonly #substitutes: ReadonlyMap<
    CanonicalEmotion,
    readonly { name: string; scale: number }[]
  >;

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

    const substitutes = new Map<
      CanonicalEmotion,
      readonly { name: string; scale: number }[]
    >();
    for (const [emotion, targets] of Object.entries(EMOTION_SUBSTITUTES)) {
      const key = emotion as CanonicalEmotion;
      if (this.#available.has(key) || targets === undefined) continue;
      const usable = targets.filter((target) => this.#available.has(target.name));
      if (usable.length > 0) substitutes.set(key, usable);
    }
    this.#substitutes = substitutes;
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
    return this.#available.has(emotion) || this.#substitutes.has(emotion);
  }

  /** 直接の表情が無く、近似で表現している感情。 */
  approximatedEmotions(): readonly CanonicalEmotion[] {
    return [...this.#substitutes.keys()];
  }

  expressibleEmotions(): readonly CanonicalEmotion[] {
    return CANONICAL_EMOTIONS.filter((emotion) => this.canExpress(emotion));
  }

  applyWeights(weights: WeightMap): void {
    const manager = this.#vrm.expressionManager;
    if (manager === undefined || manager === null) return;

    // 近似で補う感情は、代替先の重みへ足し込んでから書き込む。
    const resolved: Record<string, number> = { ...weights };
    for (const [emotion, targets] of this.#substitutes) {
      const weight = weights[emotion] ?? 0;
      if (weight <= 0) continue;
      for (const target of targets) {
        const current = resolved[target.name] ?? 0;
        resolved[target.name] = Math.min(1, Math.max(current, weight * target.scale));
      }
    }

    for (const key of WRITABLE_KEYS) {
      if (!this.#available.has(key)) continue;
      manager.setValue(key, resolved[key] ?? 0);
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

  boneNames(): readonly string[] {
    const names: string[] = [];
    this.#vrm.scene.traverse((object) => {
      if ((object as THREE.Bone).isBone === true) names.push(object.name);
    });
    return names;
  }

  /** VRM は正規化された人型ボーンを持つので必ず当たる。 */
  adjustedBones(): readonly string[] {
    return ["leftUpperArm", "rightUpperArm"];
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
