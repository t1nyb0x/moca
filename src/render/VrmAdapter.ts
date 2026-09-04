import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import {
  createVRMAnimationHumanoidTracks,
  VRMAnimationLoaderPlugin,
  type VRMAnimation,
} from "@pixiv/three-vrm-animation";

import { CANONICAL_EMOTIONS, type CanonicalEmotion } from "@/domain/emotion/types";
import { EMOTION_KEYS, VISEME_KEYS } from "@/domain/motion/compose";
import type { PoseMap } from "@/domain/motion/pose";
import type { WeightMap } from "@/domain/motion/types";
import type { ModelAdapter } from "./ModelAdapter";

/**
 * 姿勢で動かしうるボーン (要件 F-14)。
 *
 * 前腕と手は入れない。関節を順に回すだけでは円弧を描く機械的な動きになり、
 * 手が胴へ入る。VRM の当たり判定は揺れ物のためのもので、メッシュ同士は
 * 止まらない。
 */
const POSED_BONES = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
] as const;

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

/** 身振りの立ち上がりと終わりを馴染ませる時間 (秒)。 */
const GESTURE_FADE_SECONDS = 0.2;

/**
 * VRMA から体の動きだけを取り出す (要件 F-15)。
 *
 * **表情と視線は使わない。** クリップに任せると、読み上げ中のリップシンクや
 * 感情の表情を上書きしてしまう。moca の芯は「返答に応じて表情が変わる」こと
 * なので、そこはこちらが持ち続ける (ADR-0019)。
 *
 * **腰の移動も使わない。** マスコット表示ではモデルの外接箱に合わせて窓を
 * 詰めており、動いているあいだに位置が変わると枠から出る (要件 F-13)。
 */
function createBodyClip(
  animation: VRMAnimation,
  vrm: VRM,
  name: string,
): THREE.AnimationClip {
  const { rotation } = createVRMAnimationHumanoidTracks(
    animation,
    vrm.humanoid,
    vrm.meta.metaVersion,
  );
  return new THREE.AnimationClip(name, undefined, [...rotation.values()]);
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
  /** 姿勢で動かすボーンと、その基準の回転。 */
  readonly #posed = new Map<
    string,
    { node: THREE.Object3D; rest: { x: number; y: number; z: number } }
  >();
  /** 前のフレームで動かしたボーン。戻し忘れを防ぐ。 */
  #posedLast: readonly string[] = [];
  /** 直接の表情が無い感情を、使える表情で近似するための対応表。 */
  readonly #substitutes: ReadonlyMap<
    CanonicalEmotion,
    readonly { name: string; scale: number }[]
  >;

  /** 身振りの再生器 (要件 F-15)。 */
  readonly #mixer: THREE.AnimationMixer;
  readonly #clips = new Map<string, THREE.AnimationClip>();
  /** 再生中の身振り。一度に動くのは一つだけ。 */
  #action: THREE.AnimationAction | null = null;
  /** 終わりを馴染ませ終えるまでの残り時間。null なら馴染ませ中でない。 */
  #fadeOutLeft: number | null = null;

  constructor(vrm: VRM) {
    this.#vrm = vrm;
    this.#mixer = new THREE.AnimationMixer(vrm.scene);
    this.#mixer.addEventListener("finished", this.#onGestureFinished);
    this.textureCount = countTexturedMaterials(vrm.scene);
    this.#available = new Set(
      vrm.expressionManager?.expressions.map(
        (expression) => expression.expressionName,
      ) ?? [],
    );

    // 姿勢で使いうるボーンを先に引いておく。基準の回転もここで覚える。
    // 立ち姿の調整 (腕を下ろす) の後に取るので、そこが閉じ切った端になる。
    for (const name of POSED_BONES) {
      const node =
        vrm.humanoid.getNormalizedBoneNode(name) ??
        (name === "chest" ? vrm.humanoid.getNormalizedBoneNode("upperChest") : null);
      if (node === null) continue;
      this.#posed.set(name, {
        node,
        rest: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
      });
    }

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

  applyPose(pose: PoseMap): void {
    // 今回動かさないボーンを基準へ戻す。戻さないと前の姿勢が残り続ける。
    for (const name of this.#posedLast) {
      if (name in pose) continue;
      const entry = this.#posed.get(name);
      if (entry === undefined) continue;
      entry.node.rotation.set(entry.rest.x, entry.rest.y, entry.rest.z);
    }

    const applied: string[] = [];
    for (const [name, rotation] of Object.entries(pose)) {
      const entry = this.#posed.get(name);
      // 当たらないボーン名は読み飛ばす (要件 F-14-6)
      if (entry === undefined) continue;
      entry.node.rotation.set(
        entry.rest.x + (rotation.x ?? 0),
        entry.rest.y + (rotation.y ?? 0),
        entry.rest.z + (rotation.z ?? 0),
      );
      applied.push(name);
    }
    this.#posedLast = applied;
  }

  /**
   * VRMA を読み、身振りとして登録する (要件 F-15)。
   *
   * VRMA も glTF なので、モデルと同じ経路で読める。中身は IPC を通らない
   * (docs/ipc-contract.md 2.5)。
   */
  async registerGesture(tag: string, url: string): Promise<boolean> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url);
    const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
    const animation = animations?.[0];
    if (animation === undefined) return false;

    const clip = createBodyClip(animation, this.#vrm, tag);
    // 体を動かすものが無いなら、登録しても何も起きない
    if (clip.tracks.length === 0) return false;

    this.#forget(tag);
    this.#clips.set(tag, clip);
    return true;
  }

  /**
   * 身振りを始める。
   *
   * `intensity` はそのまま重みにする。1 未満なら基準の姿勢との中間になり、
   * 動きが小さくなる。0 では何も起きないので始めない。
   */
  playGesture(tag: string, intensity: number): boolean {
    const clip = this.#clips.get(tag);
    if (clip === undefined) return false;

    const weight = Math.min(1, Math.max(0, intensity));
    if (weight <= 0) return false;

    // 前の身振りは畳んでから始める。重ねると腕が二重に振れる。
    this.#stopGesture();

    const action = this.#mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    // 終わりは自分で馴染ませる。切ると最後の姿勢から基準へ飛ぶ。
    action.clampWhenFinished = true;
    action.setEffectiveWeight(weight);
    action.fadeIn(GESTURE_FADE_SECONDS);
    action.play();

    this.#action = action;
    this.#fadeOutLeft = null;
    return true;
  }

  clearGestures(): void {
    this.#stopGesture();
    for (const tag of [...this.#clips.keys()]) this.#forget(tag);
  }

  /** 再生を終え、ボーンを基準へ戻す。 */
  #stopGesture(): void {
    this.#action?.stop();
    this.#action = null;
    this.#fadeOutLeft = null;
  }

  #forget(tag: string): void {
    const clip = this.#clips.get(tag);
    if (clip === undefined) return;
    this.#mixer.uncacheClip(clip);
    this.#clips.delete(tag);
  }

  /**
   * 最後まで再生し終えた。最後の姿勢から基準へ馴染ませる。
   *
   * ここで止めきらないと、クリップの最終フレームがボーンに残り続け、
   * 待機の動きへ戻れなくなる。
   */
  #onGestureFinished = (): void => {
    if (this.#action === null) return;
    this.#action.fadeOut(GESTURE_FADE_SECONDS);
    this.#fadeOutLeft = GESTURE_FADE_SECONDS;
  };

  /**
   * **姿勢の書き込みより後に回す。** `applyPose` は基準からの差を絶対値で
   * 書くので、先に走らせるとクリップを消してしまう。この順なら、クリップが
   * 動かすボーンはクリップが持ち、触らないボーンには呼吸や待機が残る。
   */
  update(deltaSeconds: number): void {
    if (this.#action !== null) {
      this.#mixer.update(deltaSeconds);
      if (this.#fadeOutLeft !== null) {
        this.#fadeOutLeft -= deltaSeconds;
        if (this.#fadeOutLeft <= 0) this.#stopGesture();
      }
    }
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
    const { minY, maxY } = this.bounds();
    const size = maxY - minY;
    return size > 0 ? size : 1.5;
  }

  bounds(): { readonly minY: number; readonly maxY: number } {
    const box = new THREE.Box3().setFromObject(this.#vrm.scene);
    return { minY: box.min.y, maxY: box.max.y };
  }

  dispose(): void {
    this.#mixer.removeEventListener("finished", this.#onGestureFinished);
    this.clearGestures();
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
