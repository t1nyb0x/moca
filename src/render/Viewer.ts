import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { CanonicalEmotion } from "@/domain/emotion/types";
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
import type { IdleSettings } from "@/ipc/generated/IdleSettings";

import { MorphApplier } from "./MorphApplier";
import type { ModelAdapter } from "./ModelAdapter";
import { loadVrm } from "./VrmAdapter";

export type FramingPreset = "face" | "upper" | "full";

const DEFAULT_IDLE: IdleSettings = {
  blink: true,
  saccade: true,
  lookAt: true,
  breath: true,
  springBone: true,
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
  #expression: ExpressionState = createExpressionState();
  #lipSync: LipSyncState = createLipSyncState();

  /** 読み込みや描画の失敗を外へ伝える。 */
  onError: ((error: unknown) => void) | null = null;

  constructor(container: HTMLElement, seed: number = Date.now()) {
    this.#container = container;

    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.#renderer.domElement);

    this.#scene = new THREE.Scene();

    this.#camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
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
    this.#controls.update();

    this.#blink = createBlinkState(seed);
    this.#saccade = createSaccadeState(seed + 1);
    this.#breath = createBreathState();

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
  async setModel(url: string | null): Promise<ModelDiagnostics | null> {
    this.#clearModel();
    if (url === null) return null;

    const adapter = await loadVrm(url);
    this.#adapter = adapter;
    this.#scene.add(adapter.object);
    adapter.setLookAtTarget(this.#idle.lookAt ? this.#lookAtTarget : null);
    this.setFraming("upper");

    return {
      textureCount: adapter.textureCount,
      expressionNames: adapter.availableMorphs(),
      expressibleEmotions: adapter.expressibleEmotions(),
      approximatedEmotions: adapter.approximatedEmotions(),
      rendererName: this.rendererInfo(),
    };
  }

  setEmotion(emotion: CanonicalEmotion, intensity = 1): void {
    this.#expression = setExpressionTarget(this.#expression, emotion, intensity);
  }

  /** 受信したテキストをリップシンクへ送る。差分だけを渡すこと。 */
  feedSpeech(text: string): void {
    this.#lipSync = feedLipSync(this.#lipSync, text);
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

  setBackgroundColor(color: string | null): void {
    this.#scene.background = color === null ? null : new THREE.Color(color);
  }

  setFraming(preset: FramingPreset): void {
    const adapter = this.#adapter;
    if (adapter === null) return;

    const head = adapter.headWorldPosition(new THREE.Vector3());
    const height = adapter.height();

    // カメラは目線の高さに置く。下から見上げたり上から見下ろしたりすると、
    // モデルの視線もそちらへ向いて表情が不自然になる。
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
        this.#camera.position.set(0, height * 0.55, height * 1.7);
        this.#controls.target.set(0, height * 0.5, 0);
        break;
    }
    this.#controls.update();
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
    this.#lipSync = advanceLipSync(this.#lipSync, delta, this.#lipSyncConfig);
    if (this.#idle.blink) this.#blink = advanceBlink(this.#blink, delta);
    if (this.#idle.breath) this.#breath = advanceBreath(this.#breath, delta);
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
          lipSync: evaluateLipSync(this.#lipSync),
          idle: this.#idle.blink ? [evaluateBlink(this.#blink)] : [],
        },
        this.#idle.breath
          ? evaluateBreath(this.#breath)
          : { chestPitchRadians: 0, spinePitchRadians: 0 },
      );
      adapter.update(delta);
    }

    this.#controls.update();
    this.#renderer.render(this.#scene, this.#camera);
  }
}
