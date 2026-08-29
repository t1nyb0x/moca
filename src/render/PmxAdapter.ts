import * as THREE from "three";
import { ThreeMmdLoader, disposeMmdModel } from "@yohawing/three-mmd-loader";

import { CANONICAL_EMOTIONS, type CanonicalEmotion } from "@/domain/emotion/types";
import type { Viseme } from "@/domain/lipsync/viseme";
import { EMOTION_KEYS, VISEME_KEYS } from "@/domain/motion/compose";
import type { WeightMap } from "@/domain/motion/types";
import {
  canExpress as mappingCanExpress,
  resolveDefaultMapping,
  type PmxMapping,
} from "@/domain/model/pmx-mapping";
import { resolveTexturePath } from "@/domain/model/texture-path";
import type { ModelAdapter, ModelLoadContext } from "./ModelAdapter";

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
 * 視線追従には対応しない。PMX に LookAt の仕組みが無く、目のボーンを
 * 直接動かす必要があるため。まばたきと表情、口形は動く。
 */
export class PmxAdapter implements ModelAdapter {
  readonly format = "pmx" as const;
  readonly textureCount: number;

  readonly #root: THREE.Group;
  readonly #meshes: THREE.SkinnedMesh[];
  readonly #mapping: PmxMapping;
  readonly #chest: THREE.Bone | null;
  readonly #spine: THREE.Bone | null;
  readonly #head: THREE.Bone | null;
  readonly #chestRestX: number;
  readonly #spineRestX: number;
  readonly #dispose: () => void;

  constructor(
    root: THREE.Group,
    meshes: THREE.SkinnedMesh[],
    textureCount: number,
    dispose: () => void,
  ) {
    this.#root = root;
    this.#meshes = meshes;
    this.textureCount = textureCount;
    this.#dispose = dispose;
    this.#mapping = resolveDefaultMapping(this.availableMorphs());

    const bones = meshes[0]?.skeleton.bones ?? [];
    const find = (names: readonly string[]): THREE.Bone | null =>
      names.map((name) => bones.find((bone) => bone.name === name)).find(Boolean) ?? null;

    this.#chest = find(CHEST_BONES);
    this.#spine = find(SPINE_BONES);
    this.#head = find(HEAD_BONES);
    this.#chestRestX = this.#chest?.rotation.x ?? 0;
    this.#spineRestX = this.#spine?.rotation.x ?? 0;
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

    this.#writeMorphs(resolved);
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
    if (this.#chest !== null) {
      this.#chest.rotation.x = this.#chestRestX + chestPitchRadians;
    }
    if (this.#spine !== null && this.#spine !== this.#chest) {
      this.#spine.rotation.x = this.#spineRestX + spinePitchRadians;
    }
  }

  update(_deltaSeconds: number): void {
    // 物理演算と IK は未対応。髪やスカートは揺れない。
    // 動かすにはランタイムの tick が要るが、姿勢だけを与える経路が
    // 現状では見当たらないため後回しにする。
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
  );
}
