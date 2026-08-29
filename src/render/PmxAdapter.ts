import * as THREE from "three";
import {
  ThreeMmdLoader,
  disposeMmdModel,
  type MmdRuntime,
} from "@yohawing/three-mmd-loader";

import { CANONICAL_EMOTIONS, type CanonicalEmotion } from "@/domain/emotion/types";
import type { Viseme } from "@/domain/lipsync/viseme";
import { EMOTION_KEYS, VISEME_KEYS } from "@/domain/motion/compose";
import type { WeightMap } from "@/domain/motion/types";
import {
  applyOverrides,
  canExpress as mappingCanExpress,
  resolveDefaultMapping,
  type MorphTarget,
  type PmxMapping,
} from "@/domain/model/pmx-mapping";
import { armLoweringAngle } from "@/domain/model/rest-pose";
import { resolveTexturePath } from "@/domain/model/texture-path";
import type { ModelAdapter, ModelLoadContext } from "./ModelAdapter";

/** 腕のボーン。MMD の標準的な命名。 */
const ARM_BONES = { left: ["左腕"], right: ["右腕"] } as const;
/** 腕の向きを測る先。手首が無ければひじで代用する。 */
const ARM_TIP_BONES = {
  left: ["左手首", "左ひじ"],
  right: ["右手首", "右ひじ"],
} as const;

const DOWN = new THREE.Vector3(0, -1, 0);

/** 呼吸を当てるボーン。MMD の標準的な命名。 */
const CHEST_BONES = ["上半身2", "上半身"] as const;
const SPINE_BONES = ["上半身", "センター"] as const;
const HEAD_BONES = ["頭", "首"] as const;

/**
 * PMX モデルの適合層 (ADR-0004)。
 *
 * VRM と違い、PMX には表情の標準が無い。モーフ名は日本語でモデルごとに
 * 異なるため、`PmxMapping` で正規化感情から実際のモーフ名へ橋渡しする。
 *
 * 揺れ物はランタイムの stateful-spring で動かす。Bullet の WASM を積まずに
 * 済むため軽い。
 *
 * 視線追従には対応しない。PMX に LookAt の仕組みが無く、目のボーンを
 * 直接動かす必要があるため。まばたきと表情、口形は動く。
 */
export class PmxAdapter implements ModelAdapter {
  readonly format = "pmx" as const;
  readonly textureCount: number;

  readonly #root: THREE.Group;
  readonly #meshes: THREE.SkinnedMesh[];
  readonly #defaultMapping: PmxMapping;
  #mapping: PmxMapping;
  readonly #chest: THREE.Bone | null;
  readonly #spine: THREE.Bone | null;
  readonly #head: THREE.Bone | null;
  readonly #chestRestX: number;
  readonly #spineRestX: number;
  readonly #dispose: () => void;
  readonly #runtime: MmdRuntime | null;

  /**
   * 表情と呼吸は tick のあとに当てる。
   *
   * ランタイムはボーンとモーフを書き換えるので、先に当てると毎フレーム
   * 消される。値を持ち回り、tick の直後に書き込む。
   */
  #pendingMorphs: ReadonlyMap<string, number> = new Map();
  #pendingChestPitch = 0;
  #pendingSpinePitch = 0;
  /** 物理演算に失敗したら諦める。描画ごと止めるより無いほうがまし。 */
  #physicsEnabled: boolean;
  #elapsedSeconds = 0;

  /**
   * 整えた立ち姿。tick がボーンを書き換えるので毎フレーム当て直す。
   *
   * 一度きりの変更では消される。呼吸と同じ扱い。
   */
  readonly #restPose: { bone: THREE.Bone; quaternion: THREE.Quaternion }[] = [];

  constructor(
    root: THREE.Group,
    meshes: THREE.SkinnedMesh[],
    textureCount: number,
    dispose: () => void,
    runtime: MmdRuntime | null,
  ) {
    this.#root = root;
    this.#meshes = meshes;
    this.textureCount = textureCount;
    this.#dispose = dispose;
    this.#runtime = runtime;
    this.#physicsEnabled = runtime !== null;
    this.#defaultMapping = resolveDefaultMapping(this.availableMorphs());
    this.#mapping = this.#defaultMapping;

    const bones = meshes[0]?.skeleton.bones ?? [];
    const find = (names: readonly string[]): THREE.Bone | null =>
      names.map((name) => bones.find((bone) => bone.name === name)).find(Boolean) ?? null;

    this.#chest = find(CHEST_BONES);
    this.#spine = find(SPINE_BONES);
    this.#head = find(HEAD_BONES);
    this.#chestRestX = this.#chest?.rotation.x ?? 0;
    this.#spineRestX = this.#spine?.rotation.x ?? 0;

    this.#relaxArm(bones, ARM_BONES.left, ARM_TIP_BONES.left);
    this.#relaxArm(bones, ARM_BONES.right, ARM_TIP_BONES.right);
  }

  /**
   * 腕を下ろして自然な立ち姿にする。
   *
   * ボーンの向きはモデルごとに違うので、回転軸を決め打ちしない。肩から
   * 手へ向かう実際の方向を測り、そこから真下へ倒す軸を求める。
   */
  #relaxArm(
    bones: readonly THREE.Bone[],
    armNames: readonly string[],
    tipNames: readonly string[],
  ): void {
    const find = (names: readonly string[]): THREE.Bone | null =>
      names.map((name) => bones.find((bone) => bone.name === name)).find(Boolean) ?? null;

    const arm = find(armNames);
    if (arm === null) return;
    const tip = find(tipNames) ?? arm;

    this.#root.updateMatrixWorld(true);
    const shoulder = arm.getWorldPosition(new THREE.Vector3());
    const hand = tip.getWorldPosition(new THREE.Vector3());
    const direction = hand.sub(shoulder);
    if (direction.lengthSq() < 1e-8) return;
    direction.normalize();

    const angle = armLoweringAngle(direction.y);
    if (angle <= 0) return;

    // 腕を真下へ倒す回転軸。両者が平行なら回しようがない。
    const axis = new THREE.Vector3().crossVectors(direction, DOWN);
    if (axis.lengthSq() < 1e-8) return;
    axis.normalize();

    // 世界座標の軸を親の空間へ持ち込み、ボーン自身の回転より前に掛ける
    const parentQuaternion = new THREE.Quaternion();
    arm.parent?.getWorldQuaternion(parentQuaternion);
    const localAxis = axis.applyQuaternion(parentQuaternion.invert()).normalize();

    arm.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(localAxis, angle),
    );
    this.#root.updateMatrixWorld(true);

    this.#restPose.push({ bone: arm, quaternion: arm.quaternion.clone() });
  }

  get object(): THREE.Object3D {
    return this.#root;
  }

  availableMorphs(): readonly string[] {
    const names = new Set<string>();
    for (const mesh of this.#meshes) {
      for (const name of Object.keys(mesh.morphTargetDictionary ?? {})) {
        names.add(name);
      }
    }
    return [...names];
  }

  /** 既定の割り当て。UI が初期値として見せる。 */
  defaultEmotionMorphs(): Readonly<Record<CanonicalEmotion, readonly MorphTarget[]>> {
    return this.#defaultMapping.emotions;
  }

  /** 現在の割り当て。 */
  emotionMorphs(): Readonly<Record<CanonicalEmotion, readonly MorphTarget[]>> {
    return this.#mapping.emotions;
  }

  /**
   * 利用者の割り当てを反映する。
   *
   * 差し替えの前に管理下のモーフを 0 に戻す。古い割り当てのモーフが
   * 動かなくなったまま値を保持すると、表情が焼き付いて残る。
   */
  setEmotionOverrides(
    overrides: Readonly<Partial<Record<CanonicalEmotion, readonly MorphTarget[]>>>,
  ): void {
    this.#writeMorphs(new Map());
    this.#mapping = applyOverrides(this.#defaultMapping, overrides, this.availableMorphs());
  }

  canExpress(emotion: CanonicalEmotion): boolean {
    return mappingCanExpress(this.#mapping, emotion);
  }

  expressibleEmotions(): readonly CanonicalEmotion[] {
    return CANONICAL_EMOTIONS.filter((emotion) => this.canExpress(emotion));
  }

  /** PMX では近似を使わない。当たらない感情はそのまま表現できない。 */
  approximatedEmotions(): readonly CanonicalEmotion[] {
    return [];
  }

  applyWeights(weights: WeightMap): void {
    // 感情は複数のモーフに分かれ、同じモーフを複数の感情が使うことも
    // ある。いったん名前ごとに集めてから書き込む。
    const resolved = new Map<string, number>();
    const put = (name: string, value: number): void => {
      const current = resolved.get(name) ?? 0;
      if (value > current) resolved.set(name, value);
    };

    for (const emotion of EMOTION_KEYS) {
      const weight = weights[emotion] ?? 0;
      if (weight <= 0) continue;
      for (const target of this.#mapping.emotions[emotion]) {
        put(target.morphName, weight * target.weight);
      }
    }

    for (const viseme of VISEME_KEYS) {
      const name = this.#mapping.visemes[viseme as Viseme];
      const weight = weights[viseme] ?? 0;
      if (name !== null && weight > 0) put(name, weight);
    }

    if (this.#mapping.blink !== null) {
      const weight = weights.blink ?? 0;
      if (weight > 0) put(this.#mapping.blink, weight);
    }

    // 書き込みは tick のあと (update) で行う
    this.#pendingMorphs = resolved;
  }

  /** 管理しているモーフを毎回すべて書く。書き残しがあると値が焼き付く。 */
  #writeMorphs(resolved: ReadonlyMap<string, number>): void {
    for (const mesh of this.#meshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (dictionary === undefined || influences === undefined) continue;

      for (const name of this.#managedMorphs()) {
        const index = dictionary[name];
        if (index === undefined) continue;
        influences[index] = resolved.get(name) ?? 0;
      }
    }
  }

  #managedMorphs(): readonly string[] {
    const names = new Set<string>();
    for (const emotion of CANONICAL_EMOTIONS) {
      for (const target of this.#mapping.emotions[emotion]) names.add(target.morphName);
    }
    for (const name of Object.values(this.#mapping.visemes)) {
      if (name !== null) names.add(name);
    }
    if (this.#mapping.blink !== null) names.add(this.#mapping.blink);
    return [...names];
  }

  applyBreath(chestPitchRadians: number, spinePitchRadians: number): void {
    this.#pendingChestPitch = chestPitchRadians;
    this.#pendingSpinePitch = spinePitchRadians;
  }

  /**
   * 揺れ物を進め、そのあとに表情と呼吸を当てる。
   *
   * 順序が要点。ランタイムはボーンとモーフを書き換えるので、先に当てると
   * 毎フレーム消される。
   */
  update(deltaSeconds: number): void {
    this.#elapsedSeconds += deltaSeconds;

    if (this.#physicsEnabled && this.#runtime !== null) {
      try {
        this.#runtime.tick(this.#elapsedSeconds, {
          mesh: this.#meshes[0] ?? this.#root,
          physics: true,
          ik: true,
        });
      } catch (error) {
        // 揺れ物が動かないだけなら見た目が固いで済む。描画ごと止めない。
        this.#physicsEnabled = false;
        console.warn("MMD の物理演算を止めました", error);
      }
    }

    for (const { bone, quaternion } of this.#restPose) {
      bone.quaternion.copy(quaternion);
    }

    this.#writeMorphs(this.#pendingMorphs);

    if (this.#chest !== null) {
      this.#chest.rotation.x = this.#chestRestX + this.#pendingChestPitch;
    }
    if (this.#spine !== null && this.#spine !== this.#chest) {
      this.#spine.rotation.x = this.#spineRestX + this.#pendingSpinePitch;
    }
  }

  setLookAtTarget(_target: THREE.Object3D | null): void {
    // PMX に LookAt の仕組みは無い。目のボーンを直接動かす必要がある。
  }

  headWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    if (this.#head === null) return out.set(0, this.height() * 0.9, 0);
    return this.#head.getWorldPosition(out);
  }

  height(): number {
    const box = new THREE.Box3().setFromObject(this.#root);
    const size = box.getSize(new THREE.Vector3());
    return size.y > 0 ? size.y : 1.5;
  }

  dispose(): void {
    this.#dispose();
  }
}

/** テクスチャが貼られている材質の数を数える。0 は読み込み失敗の疑い。 */
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

/**
 * PMX を読み込む。
 *
 * テクスチャはモデルからの相対パスで参照される。`convertFileSrc` はパス
 * 全体を 1 つの URL セグメントへ符号化するため、そこからの相対解決は
 * 働かない。相対パスを自前で絶対パスへ直してから URL にする。
 */
export async function loadPmx(context: ModelLoadContext): Promise<PmxAdapter> {
  const loader = new ThreeMmdLoader({
    // Bullet の WASM を積まずに揺れ物を動かせる
    runtime: { physics: "stateful-spring" },
    textureResolver: {
      resolve: async (texturePath) => {
        const absolute = resolveTexturePath(context.path, texturePath);
        if (absolute === "") return undefined;
        return context.toAssetUrl(absolute);
      },
    },
  });
  const model = await loader.loadModel(context.url);

  const meshes: THREE.SkinnedMesh[] = [];
  model.root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh === true && mesh.morphTargetDictionary !== undefined) {
      meshes.push(mesh);
    }
  });

  model.root.traverse((object) => {
    object.frustumCulled = false;
  });

  return new PmxAdapter(
    model.root,
    meshes,
    countTexturedMaterials(model.root),
    () => disposeMmdModel(model),
    model.runtime,
  );
}
