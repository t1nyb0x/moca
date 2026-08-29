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
    if (state.model !== null) {
      void viewer.setModel(toAssetUrl(state.model.path)).catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : "モデルを読み込めませんでした");
      });
    }

    const unsubscribe = [
      store.subscribe(
        (current) => current.model,
        (model) => {
          setFailure(null);
          void viewer
            .setModel(model === null ? null : toAssetUrl(model.path))
            .catch((error: unknown) => {
              setFailure(
                error instanceof Error ? error.message : "モデルを読み込めませんでした",
              );
            });
        },
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
    </div>
  );
}
