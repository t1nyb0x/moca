import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { CanonicalEmotion, EmotionCue } from "@/domain/emotion/types";
import type { MorphTarget } from "@/domain/model/pmx-mapping";
import type { ModelDiagnostics } from "@/domain/model/diagnostics";
import {
  advanceBlink,
  createBlinkState,
  evaluateBlink,
  type BlinkState,
} from "@/domain/motion/blink";
import {
  advanceBreath,
  createBreathState,
  evaluateBreath,
  type BreathState,
} from "@/domain/motion/breath";
import {
  advanceIdleMotion,
  createIdleMotionState,
  evaluateIdleMotion,
  type IdleMotionState,
} from "@/domain/motion/idle-motion";
import {
  advanceEmotionMotion,
  createEmotionMotionState,
  evaluateEmotionMotion,
  setEmotionMotion,
  type EmotionMotionState,
} from "@/domain/motion/emotion-motion";
import { composePose, type PoseMap } from "@/domain/motion/pose";
import {
  advanceExpression,
  createExpressionState,
  evaluateExpression,
  setExpressionTarget,
  type ExpressionState,
} from "@/domain/motion/expression";
import {
  advanceSaccade,
  createSaccadeState,
  DEFAULT_SACCADE_CONFIG,
  type SaccadeState,
} from "@/domain/motion/saccade";
import {
  advanceLipSync,
  createLipSyncState,
  DEFAULT_LIPSYNC_CONFIG,
  evaluateLipSync,
  feedLipSync,
  type LipSyncConfig,
  type LipSyncState,
} from "@/domain/lipsync/controller";
import {
  advanceAudioLipSync,
  createAudioLipSyncState,
  evaluateAudioLipSync,
  type AudioLipSyncState,
  type AudioSample,
} from "@/domain/lipsync/audio";
import type { CameraState } from "@/ipc/generated/CameraState";
import type { IdleSettings } from "@/ipc/generated/IdleSettings";

import { MorphApplier } from "./MorphApplier";
import type { ModelAdapter, ModelLoadContext } from "./ModelAdapter";
import { loadPmx, PmxAdapter } from "./PmxAdapter";
import { loadVrm } from "./VrmAdapter";

export type FramingPreset = "face" | "upper" | "full";

/** カメラの視野 (縦、度)。全身の構図の計算もこれに従う。 */
const CAMERA_FOV_DEG = 30;

/** 全身の構図で、カメラを身長の何倍の距離に置くか。 */
const FULL_DISTANCE_FACTOR = 2.0;

/** マスコットの窓に持たせる左右の余裕。髪が少し揺れても切れないように。 */
const MASCOT_WIDTH_MARGIN = 1.08;

const DEFAULT_IDLE: IdleSettings = {
  blink: true,
  saccade: true,
  lookAt: true,
  breath: true,
  springBone: true,
  motion: true,
};

/**
 * 3D ビュー。
 *
 * React の管理外で動く (ADR-0007)。状態は購読で受け取り、props では
 * 受けない。毎フレームの値を React state に置くと 60fps で再レンダリングが
 * 走る。
 */
export class Viewer {
  readonly #container: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene: THREE.Scene;
  readonly #camera: THREE.PerspectiveCamera;
  readonly #controls: OrbitControls;
  readonly #clock = new THREE.Clock();
  readonly #applier = new MorphApplier();
  readonly #resizeObserver: ResizeObserver;
  /**
   * 視線の向き先。カメラの子にして、サッケードでずらす。
   *
   * 原点（カメラの位置そのもの）に置くのが要点。前方へずらすと、見下ろす
   * 構図のときに向き先が頭より下へ来て、モデルが下を向く。VRM の多くは
   * 「下を見る」表情でまぶたを下げるため、半目に見えてしまう。
   */
  readonly #lookAtTarget = new THREE.Object3D();

  #adapter: ModelAdapter | null = null;
  #frame: number | null = null;
  #running = false;

  #idle: IdleSettings = DEFAULT_IDLE;
  #lipSyncConfig: LipSyncConfig = DEFAULT_LIPSYNC_CONFIG;

  #blink: BlinkState;
  #saccade: SaccadeState;
  #breath: BreathState;
  #idleMotion: IdleMotionState;
  #emotionMotion: EmotionMotionState;
  /** 最後に指定した構図。寸法が変わったときに取り直すために覚えておく。 */
  #framing: FramingPreset | null = null;
  /** 当たり判定で測りたい点。次の描画で読む (要件 F-13-5)。 */
  #alphaProbe: { x: number; y: number } | null = null;
  #alphaProbeResult: number | null = null;
  readonly #probeBuffer = new Uint8Array(4);
  /**
   * 読み込みの世代。追い越しを捨てるために使う。
   *
   * `setModel` は読み込みのあいだ待つ。その間に次の指示が来ると、古いほうも
   * 完了して場面へ足されてしまう。二体が重なり、表情の制御を受けるのは後から
   * 代入された片方だけになるため、もう一体が既定の姿のまま残る。
   */
  #loadGeneration = 0;
  #refitOnResize = false;
  #expression: ExpressionState = createExpressionState();
  #lipSync: LipSyncState = createLipSyncState();
  #audioLipSync: AudioLipSyncState = createAudioLipSyncState();
  /**
   * 再生中の音声から今の位置と音量を測る手段。
   *
   * これがあるあいだは文字数まかせの疑似リップシンクを使わない。
   * 実際に鳴っている音に合わせるほうが常に正確なため。
   */
  #audioSampler: (() => AudioSample) | null = null;
  /**
   * まだ発話が追いついていない感情の切り替え。
   *
   * 受信した瞬間に顔を変えると、口がまだ最初の文を喋っているのに表情だけ
   * 最後の感情になってしまう。口が該当位置を通過してから切り替える。
   */
  #emotionMarkers: { at: number; cue: EmotionCue }[] = [];

  /** 読み込みや描画の失敗を外へ伝える。 */
  onError: ((error: unknown) => void) | null = null;
  /**
   * カメラ操作が一段落したときに呼ばれる。
   *
   * 位置を覚えさせる用 (要件 F-03-5)。動かしている最中ではなく、手を離した
   * ところで知らせる。毎フレーム保存すると書き込みが際限なく増える。
   */
  onCameraSettled: (() => void) | null = null;

  constructor(container: HTMLElement, seed: number = Date.now()) {
    this.#container = container;

    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.#renderer.domElement);

    this.#scene = new THREE.Scene();

    this.#camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 100);
    this.#camera.position.set(0, 1.3, 2.2);
    this.#scene.add(this.#camera);

    this.#camera.add(this.#lookAtTarget);

    // three r155 以降、光の強さは物理単位で扱われる。three-vrm の公式例に
    // ならい主光源を Math.PI とし、環境光は控えめな補助に留める。
    // 環境光を主光源と同程度まで上げると MToon の陰色が飛び、のっぺりした
    // 白い塊になる。
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const key = new THREE.DirectionalLight(0xffffff, Math.PI);
    key.position.set(1, 1, 1).normalize();
    this.#scene.add(ambient, key);

    this.#controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    this.#controls.target.set(0, 1.2, 0);
    this.#controls.enableDamping = true;
    this.#controls.addEventListener("end", () => this.onCameraSettled?.());
    this.#controls.update();

    this.#blink = createBlinkState(seed);
    this.#saccade = createSaccadeState(seed + 1);
    this.#breath = createBreathState();
    this.#idleMotion = createIdleMotionState();
    this.#emotionMotion = createEmotionMotionState();

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(container);
    this.#resize();
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#clock.getDelta(); // 停止中に溜まった時間を捨てる
    this.#loop();
  }

  /** 要件 F-02-3: 非表示のあいだは描画に一切の資源を使わない。 */
  stop(): void {
    this.#running = false;
    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
  }

  dispose(): void {
    this.stop();
    this.#resizeObserver.disconnect();
    this.#controls.dispose();
    this.#clearModel();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }

  get isRunning(): boolean {
    return this.#running;
  }

  /** 描画に使われている実装。ソフトウェア描画の検出に使う (要件 R-3)。 */
  rendererInfo(): string {
    const gl = this.#renderer.getContext();
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo === null) return gl.getParameter(gl.RENDERER) as string;
    return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string;
  }

  /** 読み込み結果の診断。無音の失敗を検出できるようにする。 */
  async setModel(context: ModelLoadContext | null): Promise<ModelDiagnostics | null> {
    const generation = ++this.#loadGeneration;
    this.#clearModel();
    if (context === null) return null;

    const adapter =
      context.format === "pmx" ? await loadPmx(context) : await loadVrm(context.url);

    // 待っているあいだに次の指示が来ていたら、出来たものは捨てる。
    // 足すと場面に二体並び、片方が既定の姿のまま残る。
    if (generation !== this.#loadGeneration) {
      adapter.dispose();
      return null;
    }

    this.#adapter = adapter;
    this.#scene.add(adapter.object);
    adapter.setLookAtTarget(this.#idle.lookAt ? this.#lookAtTarget : null);
    this.setFraming("upper");

    return this.#diagnostics();
  }

  /**
   * 感情ごとのモーフ割り当てを差し替える (PMX のみ)。
   *
   * VRM は表情が標準化されているので割り当ての概念が無く、何もしない。
   */
  setEmotionOverrides(
    overrides: Readonly<Partial<Record<CanonicalEmotion, readonly MorphTarget[]>>>,
  ): ModelDiagnostics | null {
    const adapter = this.#adapter;
    if (!(adapter instanceof PmxAdapter)) return null;
    adapter.setEmotionOverrides(overrides);
    return this.#diagnostics();
  }

  #diagnostics(): ModelDiagnostics | null {
    const adapter = this.#adapter;
    if (adapter === null) return null;
    return {
      textureCount: adapter.textureCount,
      expressionNames: adapter.availableMorphs(),
      expressibleEmotions: adapter.expressibleEmotions(),
      approximatedEmotions: adapter.approximatedEmotions(),
      rendererName: this.rendererInfo(),
      emotionMorphs: adapter instanceof PmxAdapter ? adapter.emotionMorphs() : null,
      boneNames: adapter.boneNames(),
      adjustedBones: adapter.adjustedBones(),
    };
  }

  /** 感情を即座に切り替える。手動の確認用。 */
  setEmotion(emotion: CanonicalEmotion, intensity = 1): void {
    this.#emotionMarkers = [];
    this.#expression = setExpressionTarget(this.#expression, emotion, intensity);
    // 体も一緒に動かす。表情だけだと顔しか変わらず、人形のままに見える
    this.#emotionMotion = setEmotionMotion(this.#emotionMotion, emotion, intensity);
  }

  /**
   * 受信したテキストと、その直前に指定された感情を送る。
   *
   * 差分だけを渡すこと。感情はこのテキストの先頭に対応するので、口が
   * そこへ到達した時点で切り替える。
   */
  feedSpeech(text: string, emotion: EmotionCue | null = null): void {
    if (emotion !== null) {
      this.#emotionMarkers.push({ at: this.#lipSync.fed, cue: emotion });
    }
    this.#lipSync = feedLipSync(this.#lipSync, text);
  }

  /**
   * 読み上げ音声に合わせて口を動かす。
   *
   * 合成に渡したのと同じ文を渡すこと。音声と文は対応しているので、
   * 再生位置から口形が決まる。感情はこの音声の先頭に対応するため、
   * 待たずにここで切り替える。
   */
  speakAudio(text: string, emotion: EmotionCue | null, sample: () => AudioSample): void {
    // 疑似リップシンクの積み残しを持ち込まない。二重に口が動いてしまう。
    this.#lipSync = createLipSyncState();
    this.#emotionMarkers = [];
    this.#audioLipSync = createAudioLipSyncState(text);
    this.#audioSampler = sample;
    if (emotion !== null) {
      this.#expression = setExpressionTarget(
        this.#expression,
        emotion.emotion,
        emotion.intensity,
      );
      this.#emotionMotion = setEmotionMotion(
        this.#emotionMotion,
        emotion.emotion,
        emotion.intensity,
      );
    }
  }

  /** 再生が終わった、または止められた。口を閉じて通常の駆動へ戻す。 */
  endAudioSpeech(): void {
    this.#audioSampler = null;
    this.#audioLipSync = createAudioLipSyncState();
  }

  setIdleSettings(idle: IdleSettings): void {
    this.#idle = idle;
    this.#adapter?.setLookAtTarget(idle.lookAt ? this.#lookAtTarget : null);
  }

  setLipSyncRate(charsPerSecond: number): void {
    this.#lipSyncConfig = {
      ...DEFAULT_LIPSYNC_CONFIG,
      charsPerSecond: Math.max(1, charsPerSecond),
    };
  }

  /** 現在のカメラ位置。キャラクターへ保存するために取り出す (要件 F-03-5)。 */
  cameraState(): CameraState {
    const { x, y, z } = this.#camera.position;
    const target = this.#controls.target;
    return {
      position: [x, y, z],
      target: [target.x, target.y, target.z],
    };
  }

  /** 保存しておいたカメラ位置へ戻す。 */
  applyCameraState(state: CameraState): void {
    const [px, py, pz] = state.position;
    const [tx, ty, tz] = state.target;
    this.#camera.position.set(px, py, pz);
    this.#controls.target.set(tx, ty, tz);
    this.#controls.update();
  }

  setBackgroundColor(color: string | null): void {
    this.#scene.background = color === null ? null : new THREE.Color(color);
  }

  /**
   * カメラ操作の可否 (要件 F-13-6)。
   *
   * マスコット表示では掴む操作を窓の移動へ譲る。掴んで動かす対象はカメラ
   * ではなくモデルであるため。
   */
  setInteractive(enabled: boolean): void {
    // 止める前に一度そろえる。OrbitControls は内部に減衰用の状態を持って
    // おり、そこが古いままだと以後の update で元の位置へ引き戻される。
    this.#controls.update();
    this.#controls.enabled = enabled;
  }

  /**
   * 窓の寸法が変わったら構図を取り直すか (要件 F-13-3)。
   *
   * マスコット表示では倍率で窓ごと拡縮するため、寸法が変わるたびに構図が
   * ずれる。取り直さないと頭や足が切れる。
   */
  setRefitOnResize(enabled: boolean): void {
    this.#refitOnResize = enabled;
  }

  /**
   * 次の描画でこの点の不透明度を測る (要件 F-13-5)。座標はキャンバス内の
   * CSS 画素。
   *
   * WebGL の描画結果は、描いたフレームの中でしか読み出せない。任意の時点で
   * 読むには `preserveDrawingBuffer` が要るが、常時の描画が重くなる。測る点を
   * 預かって描画の直後に読む形にすれば、その代償を払わずに済む。
   */
  probeAlpha(x: number, y: number): void {
    this.#alphaProbe = { x, y };
  }

  /** 直近に測った不透明度 (0〜1)。まだ測っていなければ null。 */
  probedAlpha(): number | null {
    return this.#alphaProbeResult;
  }

  /**
   * マスコット表示に必要な窓の縦横比 (横 / 縦)。モデルが無ければ null。
   *
   * 構図は全身に固定なので、外接箱から必要な横幅が決まる。読み込みのたびに
   * 一度だけ求める。髪の揺れに合わせて毎フレーム変えると窓が震える。
   */
  mascotAspect(): number | null {
    const adapter = this.#adapter;
    if (adapter === null) return null;

    const height = adapter.height();
    if (!(height > 0)) return null;

    const distance = height * FULL_DISTANCE_FACTOR;
    const visibleHeight =
      2 * distance * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV_DEG / 2));

    // 左右のどちらかへ寄っていても収まるよう、遠いほうの端で測る
    const box = new THREE.Box3().setFromObject(adapter.object);
    const halfWidth = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    if (!(halfWidth > 0)) return null;

    const needed = halfWidth * 2 * MASCOT_WIDTH_MARGIN;
    return needed / visibleHeight;
  }

  setFraming(preset: FramingPreset): void {
    const adapter = this.#adapter;
    if (adapter === null) return;

    const head = adapter.headWorldPosition(new THREE.Vector3());
    const height = adapter.height();

    // カメラは目線の高さに置く。下から見上げたり上から見下ろしたりすると、
    // モデルの視線もそちらへ向いて表情が不自然になる。
    this.#framing = preset;

    switch (preset) {
      case "face":
        this.#camera.position.set(0, head.y, height * 0.42);
        this.#controls.target.set(0, head.y, 0);
        break;
      case "upper":
        this.#camera.position.set(0, head.y, height * 0.8);
        this.#controls.target.set(0, head.y * 0.93, 0);
        break;
      case "full":
        // 視野 30 度では、距離 d で見える縦幅が 2d·tan15° = 0.536d となる。
        // 1.7h では 0.911h しか入らず、身長 h の頭と足が切れる。2.0h にして
        // 1.07h を確保し、上下におよそ 3% の余白を残す。
        this.#camera.position.set(0, height * 0.55, height * FULL_DISTANCE_FACTOR);
        this.#controls.target.set(0, height * 0.5, 0);
        break;
    }
    this.#controls.update();
  }

  /**
   * 口が到達した位置までの感情を反映する。
   *
   * 消化待ちが尽きているときは待つ相手がいないので、残りをまとめて出す。
   * 末尾のタグの後に本文が続かない場合に取り残されないようにするため。
   */
  #fireDueEmotions(): void {
    while (this.#emotionMarkers.length > 0) {
      const marker = this.#emotionMarkers[0];
      if (marker === undefined) break;
      const reached = this.#lipSync.consumed >= marker.at;
      const nothingLeft = this.#lipSync.pending.length === 0;
      if (!reached && !nothingLeft) break;

      this.#emotionMarkers.shift();
      this.#expression = setExpressionTarget(
        this.#expression,
        marker.cue.emotion,
        marker.cue.intensity,
      );
      this.#emotionMotion = setEmotionMotion(
        this.#emotionMotion,
        marker.cue.emotion,
        marker.cue.intensity,
      );
    }
  }

  #clearModel(): void {
    if (this.#adapter === null) return;
    this.#scene.remove(this.#adapter.object);
    this.#adapter.dispose();
    this.#adapter = null;
  }

  #resize(): void {
    const width = this.#container.clientWidth;
    const height = this.#container.clientHeight;
    if (width === 0 || height === 0) return;
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();

    // 窓ごと拡縮するマスコット表示では、寸法が変わるたびに構図を取り直す
    if (this.#refitOnResize && this.#framing !== null) {
      this.setFraming(this.#framing);
    }
  }

  #loop = (): void => {
    if (!this.#running) return;
    this.#frame = requestAnimationFrame(this.#loop);

    // 復帰直後の巨大な delta で挙動が飛ばないよう頭打ちにする
    const delta = Math.min(this.#clock.getDelta(), 0.1);
    try {
      this.#step(delta);
    } catch (error) {
      this.stop();
      this.onError?.(error);
    }
  };

  #step(delta: number): void {
    this.#expression = advanceExpression(this.#expression, delta);
    const sampler = this.#audioSampler;
    if (sampler === null) {
      this.#lipSync = advanceLipSync(this.#lipSync, delta, this.#lipSyncConfig);
      this.#fireDueEmotions();
    } else {
      this.#audioLipSync = advanceAudioLipSync(this.#audioLipSync, delta, sampler());
    }
    if (this.#idle.blink) this.#blink = advanceBlink(this.#blink, delta);
    if (this.#idle.breath) this.#breath = advanceBreath(this.#breath, delta);

    // 感情の姿勢は待機の速さも決めるので、先に進める (要件 F-14-2)
    this.#emotionMotion = advanceEmotionMotion(this.#emotionMotion, delta);
    const emotionMotion = evaluateEmotionMotion(this.#emotionMotion);
    if (this.#idle.motion) {
      this.#idleMotion = advanceIdleMotion(
        this.#idleMotion,
        delta,
        emotionMotion.tempo,
      );
    }
    if (this.#idle.saccade) {
      this.#saccade = advanceSaccade(this.#saccade, delta);
      // 視線用の表情はモデル側の LookAt が毎フレーム上書きするため、
      // モーフではなく向き先の位置をずらして表現する。基準はカメラの位置
      // そのもの（原点）なので、ここでのずれがそのまま揺らぎになる。
      const scale = 1 / DEFAULT_SACCADE_CONFIG.amplitude;
      this.#lookAtTarget.position.x = this.#saccade.x * scale * 0.06;
      this.#lookAtTarget.position.y = this.#saccade.y * scale * 0.04;
    }

    const adapter = this.#adapter;
    if (adapter !== null) {
      this.#applier.apply(
        adapter,
        {
          expression: evaluateExpression(this.#expression),
          lipSync:
            this.#audioSampler === null
              ? evaluateLipSync(this.#lipSync)
              : evaluateAudioLipSync(this.#audioLipSync),
          idle: this.#idle.blink ? [evaluateBlink(this.#blink)] : [],
        },
        this.#pose(emotionMotion),
      );
      adapter.update(delta);
    }

    this.#controls.update();
    this.#renderer.render(this.#scene, this.#camera);
    this.#readAlphaProbe();
  }

  /**
   * 呼吸・待機・感情の姿勢を 1 枚に重ねる (要件 F-14)。
   *
   * 合計の上限は `composePose` が持つ。層がたまたま同じ向きへ振れたときに
   * 折れた姿勢にしないため。
   */
  #pose(emotionMotion: ReturnType<typeof evaluateEmotionMotion>): PoseMap {
    const layers: PoseMap[] = [];

    if (this.#idle.breath) {
      const breath = evaluateBreath(this.#breath);
      layers.push({
        chest: { x: breath.chestPitchRadians },
        spine: { x: breath.spinePitchRadians },
      });
    }

    if (this.#idle.motion) {
      layers.push(evaluateIdleMotion(this.#idleMotion, emotionMotion.amplitude));
      layers.push(emotionMotion.pose);
    }

    return composePose(layers);
  }

  /** 描画の直後に呼ぶ。ここを外すと読み出せる保証が無くなる。 */
  #readAlphaProbe(): void {
    const probe = this.#alphaProbe;
    if (probe === null) return;
    this.#alphaProbe = null;

    const canvas = this.#renderer.domElement;
    const ratio = this.#renderer.getPixelRatio();
    const x = Math.round(probe.x * ratio);
    // WebGL の原点は左下。CSS の座標は左上なので上下を入れ替える。
    const y = Math.round((canvas.clientHeight - probe.y) * ratio);

    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
      this.#alphaProbeResult = 0;
      return;
    }

    const gl = this.#renderer.getContext();
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.#probeBuffer);
    this.#alphaProbeResult = (this.#probeBuffer[3] ?? 0) / 255;
  }
}
