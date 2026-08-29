import { useEffect, useRef, useState } from "react";

import { useAppStore } from "@/app/store";
import { toAssetUrl } from "@/ipc";
import { Viewer } from "@/render/Viewer";
import { ViewerToolbar } from "./ViewerToolbar";

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
    const character = state.characters.find((item) => item.id === state.activeCharacterId);
    if (character !== undefined) viewer.setIdleSettings(character.idleSettings);
    /** 読み込み結果を確かめる。無音の失敗を見逃さないため。 */
    const load = (path: string | null): void => {
      setFailure(null);
      setWarning(null);
      void viewer
        .setModel(path === null ? null : toAssetUrl(path))
        .then((diagnostics) => {
          useAppStore.getState().setModelDiagnostics(diagnostics);
          if (diagnostics === null) return;

          // 覚えた位置があればそちらを優先する (要件 F-03-5)
          const current = useAppStore.getState();
          const saved = current.characters.find(
            (item) => item.id === current.activeCharacterId,
          )?.cameraPreset;
          if (saved != null) viewer.applyCameraState(saved);

          if (diagnostics.textureCount === 0) {
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

    if (state.model !== null) load(state.model.path);

    const unsubscribe = [
      store.subscribe(
        (current) => current.model,
        (model) => load(model?.path ?? null),
      ),
      // 会話中の感情は発話と一緒に渡し、口が到達した時点で反映させる
      store.subscribe(
        (current) => current.speech,
        (speech) => viewer.feedSpeech(speech.text, speech.emotion),
      ),
      // 手動の確認は即座に反映する
      store.subscribe(
        (current) => current.preview,
        (preview) => viewer.setEmotion(preview.emotion),
      ),
      store.subscribe(
        (current) => current.settings?.lipSyncCharsPerSecond ?? 10,
        (rate) => viewer.setLipSyncRate(rate),
      ),
      store.subscribe(
        (current) => current.settings?.backgroundColor ?? null,
        (color) => viewer.setBackgroundColor(color),
      ),
      store.subscribe(
        (current) =>
          current.characters.find((item) => item.id === current.activeCharacterId)
            ?.idleSettings,
        (idle) => {
          if (idle !== undefined) viewer.setIdleSettings(idle);
        },
      ),
    ];

    return () => {
      for (const off of unsubscribe) off();
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
