import { useEffect, useRef, useState } from "react";

import { useAppStore, type GestureSource } from "@/app/store";
import { isSoftwareRenderer } from "@/domain/model/renderer";
import { toAssetUrl, windowCursorPosition, windowSetClickThrough } from "@/ipc";
import { Viewer } from "@/render/Viewer";
import { ViewerToolbar } from "./ViewerToolbar";

/**
 * カメラ操作が終わってから位置を覚えるまでの待ち。
 *
 * 手を離すたびに書くと、少し直すつもりの操作でも書き込みが積み上がる。
 * 続けて動かす間は書かず、落ち着いてから一度だけ書く。
 */
const CAMERA_SAVE_DELAY_MS = 800;

/**
 * 当たり判定を取り直す間隔。
 *
 * クリックスルー中は WebView へマウスが届かないため、位置は取りに行くしかない。
 * 短いほど掴める感触が良くなるが、そのぶん往復が増える。
 */
const HIT_TEST_INTERVAL_MS = 80;

/** これより薄いところは「描かれていない」とみなす。 */
const SOLID_ALPHA = 0.1;

/**
 * 3D ビューの器。
 *
 * **この DOM は React の再レンダリング対象に含めない** (ADR-0007)。
 * 依存配列を空にして一度だけ生成し、以降は購読で状態を流し込む。
 * 毎フレームの値を props で渡すと 60fps で再レンダリングが走る。
 */
export function ViewerHost(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const container = hostRef.current;
    if (container === null) return;

    const viewer = new Viewer(container);
    viewerRef.current = viewer;
    viewer.onError = (error) => {
      setFailure(error instanceof Error ? error.message : "描画に失敗しました");
    };
    viewer.start();

    const store = useAppStore;
    const state = store.getState();

    // 初期状態を流し込む
    viewer.setLipSyncRate(state.settings?.lipSyncCharsPerSecond ?? 10);
    viewer.setBackgroundColor(state.settings?.backgroundColor ?? null);
    viewer.setRefitOnResize(state.mascot);
    viewer.setInteractive(!state.mascot);

    /**
     * 通常表示のカメラを当てる。
     *
     * 覚えた位置があればそこへ、無ければ既定の構図へ。読み込み直後と、
     * マスコット表示から戻ったときの両方で使う。
     */
    const applyNormalCamera = (): void => {
      const current = useAppStore.getState();
      const character = current.characters.find(
        (item) => item.id === current.activeCharacterId,
      );
      if (character?.cameraPreset != null) {
        viewer.applyCameraState(character.cameraPreset);
      } else {
        // 構築時の固定値のままだと、モデルの大きさによらず同じ距離になり、
        // 寄りすぎた絵で始まる。
        viewer.setFraming("upper");
      }
    };

    /**
     * その点が掴めるか (要件 F-13-5)。
     *
     * ボタンなどの部品はキャンバスの外にあるので、先に見る。ここを飛ばすと
     * 「戻る」が押せなくなり、マスコット表示から出られなくなる。
     */
    const isSolidAt = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        return false;
      }

      const element = document.elementFromPoint(x, y);
      if (element === null) return false;
      if (element.closest("button, input, select, textarea, a") !== null) {
        return true;
      }

      const canvas = container.querySelector("canvas");
      if (canvas === null || element !== canvas) return false;

      // 測定は次の描画で行われるので、判定に使うのは前回の値。80ms 前の、
      // ほぼ同じ点の結果なので実用上は差し支えない。
      const alpha = viewer.probedAlpha();
      const rect = canvas.getBoundingClientRect();
      viewer.probeAlpha(x - rect.left, y - rect.top);
      return alpha !== null && alpha > SOLID_ALPHA;
    };

    let clickThrough = false;
    let hitTimer: ReturnType<typeof setInterval> | null = null;

    const applyHitTest = async (): Promise<void> => {
      let point;
      try {
        point = await windowCursorPosition();
      } catch {
        // 取れない一回は見送る。次の巡回で取り直せばよい。
        return;
      }
      const next = !isSolidAt(point.x, point.y);
      if (next === clickThrough) return;
      clickThrough = next;
      try {
        await windowSetClickThrough(next);
      } catch {
        // 切り替えられなければ、次の巡回でまた試す
        clickThrough = !next;
      }
    };

    const stopHitTest = (): void => {
      if (hitTimer !== null) {
        clearInterval(hitTimer);
        hitTimer = null;
      }
      // 通常表示へ素通しを持ち込まない。残すと窓が一切触れなくなる。
      if (clickThrough) {
        clickThrough = false;
        void windowSetClickThrough(false);
      }
    };

    const startHitTest = (): void => {
      if (hitTimer !== null) return;
      hitTimer = setInterval(() => void applyHitTest(), HIT_TEST_INTERVAL_MS);
    };

    // 起動時にマスコット表示だと、下の購読は変化を取り逃がす。bootstrap が
    // mascot を立てるのは、この効果が走るより前だからである。
    if (useAppStore.getState().mascot) startHitTest();

    // カメラ位置を自動で覚える (要件 F-03-5)。手を離してから少し置くのは、
    // 回している最中の中間位置を書き込まないため。
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    viewer.onCameraSettled = () => {
      // マスコット表示は全身に固定なので覚えない (F-13-2)。ここで保存すると
      // 通常表示のために覚えた位置を全身で上書きしてしまう。
      if (useAppStore.getState().mascot) return;
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void useAppStore.getState().saveCameraState(viewer.cameraState());
      }, CAMERA_SAVE_DELAY_MS);
    };
    const character = state.characters.find((item) => item.id === state.activeCharacterId);
    if (character !== undefined) viewer.setIdleSettings(character.idleSettings);
    /**
     * 身振りの登録が終わるまでの待ち合わせ。
     *
     * 割り当てを差し替えた直後に「試す」を押すと、登録より先に再生の指示が
     * 届く。読み込みは非同期なので、そのままでは何も起きない。
     */
    let gesturesReady: Promise<unknown> = Promise.resolve();

    /**
     * 身振りを載せ終えたときの報告を診断へ渡す。
     *
     * **モデルの読み込みと割り当ての差し替えは、どちらが先に来るか決まらない。**
     * 割り当てを先に載せに行くとモデルがまだ無く、その後モデルを読んだ時点で
     * 改めて載る。両方の結末をここで受ける (要件 F-15-11)。
     */
    viewer.onGesturesLoaded = (result) => {
      const failed = new Set(result.failed);
      const store = useAppStore.getState();
      store.setGestureReport(
        store.gestures.map((gesture) => ({
          tag: gesture.tag,
          name: gesture.name,
          loaded: result.pending ? null : !failed.has(gesture.tag),
        })),
      );

      if (result.failed.length === 0) return;
      setWarning(
        `身振り ${result.failed.join("、")} を読み込めませんでした。` +
          "ファイルが移動または削除されていないか確認してください。",
      );
    };

    /** 割り当てを 3D ビューへ載せる。結果は onGesturesLoaded が受ける。 */
    const applyGestures = (gestures: readonly GestureSource[]): void => {
      gesturesReady = viewer.setGestures(
        gestures.map((gesture) => ({
          tag: gesture.tag,
          url: toAssetUrl(gesture.path),
        })),
      );
    };

    /** 読み込み結果を確かめる。無音の失敗を見逃さないため。 */
    const load = (handle: { path: string; format: "vrm" | "pmx" } | null): void => {
      setFailure(null);
      setWarning(null);
      void viewer
        .setModel(
          handle === null
            ? null
            : {
                url: toAssetUrl(handle.path),
                path: handle.path,
                format: handle.format,
                toAssetUrl,
              },
        )
        .then((diagnostics) => {
          useAppStore.getState().setModelDiagnostics(diagnostics);
          if (diagnostics === null) return;

          const current = useAppStore.getState();
          const character = current.characters.find(
            (item) => item.id === current.activeCharacterId,
          );

          // マスコット表示では構図を全身に固定する (要件 F-13-2)。覚えた位置
          // より優先する。
          //
          // ここで決め直すのは、起動時に購読が間に合わないため。bootstrap は
          // モデルを読んだ直後に mascot を立てるが、この購読が張られるのは
          // React の効果が走ってからで、その頃には変化が済んでいる。読み込みの
          // 完了はこの購読より必ず後に来るので、ここが唯一確実な場所になる。
          // マスコット表示では覚えた位置より全身を優先する (要件 F-13-2)
          if (useAppStore.getState().mascot) {
            viewer.setFraming("full");
          } else {
            applyNormalCamera();
          }

          // 窓をモデルに合わせるための縦横比 (要件 F-13-4)。構図を決めた後に
          // 測る。外接箱は構図に依らないが、順序を固定しておくほうが読みやすい。
          useAppStore.getState().setModelAspect(viewer.mascotAspect());

          // 保存された割り当てがあれば反映する (PMX のみ)
          if (character?.emotionMapping != null) {
            const applied = viewer.setEmotionOverrides(
              character.emotionMapping.entries,
            );
            if (applied !== null) {
              useAppStore.getState().setModelDiagnostics(applied);
            }
          }

          // 描画がソフトウェアへ落ちていると実用に耐えない (要件 R-3)。
          // 落ちていること自体は何のエラーも出ないので知らせる。
          if (isSoftwareRenderer(diagnostics.rendererName)) {
            setWarning(
              "GPU が使われていません。表示が重い場合は 3D を隠してお使いください。",
            );
          } else if (diagnostics.textureCount === 0) {
            setWarning(
              "テクスチャを読み込めませんでした。モデルが白く表示されます。",
            );
          } else if (diagnostics.expressibleEmotions.length <= 1) {
            // neutral しか無い、あるいは何も無い
            setWarning(
              "このモデルは感情の表情を持っていません。表情は変わりません。",
            );
          }
        })
        .catch((error: unknown) => {
          setFailure(
            error instanceof Error ? error.message : "モデルを読み込めませんでした",
          );
        });
    };

    if (state.model !== null) load(state.model);
    // 起動時の読み込みが購読より先に済んでいることがある。現在の値を一度当てる。
    if (state.gestures.length > 0) applyGestures(state.gestures);

    const unsubscribe = [
      store.subscribe(
        (current) => current.model,
        (model) => load(model),
      ),
      // 会話中の感情は発話と一緒に渡し、口が到達した時点で反映させる
      store.subscribe(
        (current) => current.speech,
        (speech) => viewer.feedSpeech(speech.text, speech.emotion, speech.gestures),
      ),
      // 読み上げ音声があるあいだは、実際の波形に合わせて口を動かす
      store.subscribe(
        (current) => current.speechAudio,
        (audio) => {
          if (audio === null) {
            viewer.endAudioSpeech();
            return;
          }
          viewer.speakAudio(
            audio.segment.text,
            audio.segment.cue,
            audio.segment.gestures,
            audio.playback.sample,
          );
        },
      ),
      // 手動の確認は即座に反映する
      store.subscribe(
        (current) => current.preview,
        (preview) => viewer.setEmotion(preview.emotion),
      ),
      // 身振りの割り当て (要件 F-15)。モデルの読み込みとは独立に差し替わる。
      store.subscribe(
        (current) => current.gestures,
        (gestures) => applyGestures(gestures),
      ),
      // 待たずに始める身振り。手動の確認と、本文が続かない末尾のタグ。
      store.subscribe(
        (current) => current.gesturePlay,
        (play) => {
          // 登録が済んでから動かす。差し替えた直後でも取りこぼさない。
          void gesturesReady.then(() => {
            for (const cue of play.cues) viewer.playGesture(cue.tag, cue.intensity);
          });
        },
      ),
      store.subscribe(
        (current) => current.settings?.lipSyncCharsPerSecond ?? 10,
        (rate) => viewer.setLipSyncRate(rate),
      ),
      store.subscribe(
        (current) => current.settings?.backgroundColor ?? null,
        (color) => viewer.setBackgroundColor(color),
      ),
      // マスコット表示では構図を全身に固定し、カメラ操作を止める (F-13-2、F-13-6)
      store.subscribe(
        (current) => current.mascot,
        (mascot) => {
          // 構図を先に決めてから止める。逆にすると OrbitControls の減衰用の
          // 状態が古いまま残り、以後の update で元の位置へ引き戻される。
          if (mascot) viewer.setFraming("full");
          viewer.setRefitOnResize(mascot);
          viewer.setInteractive(!mascot);
          if (mascot) startHitTest();
          else stopHitTest();
          // 戻るときは全身のままにしない。マスコット表示の構図はあちらの
          // 都合であって、利用者が通常表示のために覚えた位置ではない。
          if (!mascot) applyNormalCamera();
        },
      ),
      store.subscribe(
        (current) =>
          current.characters.find((item) => item.id === current.activeCharacterId)
            ?.idleSettings,
        (idle) => {
          if (idle !== undefined) viewer.setIdleSettings(idle);
        },
      ),
      store.subscribe(
        (current) =>
          current.characters.find((item) => item.id === current.activeCharacterId)
            ?.emotionMapping,
        (mapping) => {
          const applied = viewer.setEmotionOverrides(mapping?.entries ?? {});
          if (applied !== null) useAppStore.getState().setModelDiagnostics(applied);
        },
      ),
    ];

    return () => {
      for (const off of unsubscribe) off();
      stopHitTest();
      if (saveTimer !== null) clearTimeout(saveTimer);
      viewer.onCameraSettled = null;
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  return (
    <div className="viewer">
      <div ref={hostRef} className="viewer__canvas" />
      <ViewerToolbar viewer={viewerRef} />
      {failure !== null && (
        <p className="viewer__failure" role="alert">
          {failure}
        </p>
      )}
      {failure === null && warning !== null && (
        <p className="viewer__failure" role="status">
          {warning}
        </p>
      )}
    </div>
  );
}
