import { useEffect, useRef, useState } from "react";

import { useAppStore } from "@/app/store";
import { toAssetUrl } from "@/ipc";
import { Viewer } from "@/render/Viewer";

/**
 * 3D ビューの器。
 *
 * **この DOM は React の再レンダリング対象に含めない** (ADR-0007)。
 * 依存配列を空にして一度だけ生成し、以降は購読で状態を流し込む。
 * 毎フレームの値を props で渡すと 60fps で再レンダリングが走る。
 */
export function ViewerHost(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const container = hostRef.current;
    if (container === null) return;

    const viewer = new Viewer(container);
    viewer.onError = (error) => {
      setFailure(error instanceof Error ? error.message : "描画に失敗しました");
    };
    viewer.start();

    const store = useAppStore;
    const state = store.getState();

    // 初期状態を流し込む
    viewer.setLipSyncRate(state.settings?.lipSyncCharsPerSecond ?? 10);
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
      store.subscribe(
        (current) => current.emotion,
        (emotion) => viewer.setEmotion(emotion.emotion, emotion.intensity),
      ),
      store.subscribe(
        (current) => current.speech,
        (speech) => viewer.feedSpeech(speech.text),
      ),
      store.subscribe(
        (current) => current.settings?.lipSyncCharsPerSecond ?? 10,
        (rate) => viewer.setLipSyncRate(rate),
      ),
    ];

    return () => {
      for (const off of unsubscribe) off();
      viewer.dispose();
    };
  }, []);

  return (
    <div className="viewer">
      <div ref={hostRef} className="viewer__canvas" />
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
