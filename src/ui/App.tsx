import { useEffect, useState } from "react";

import { useAppStore } from "@/app/store";
import { ChatPanel } from "./ChatPanel";
import { SettingsDialog } from "./SettingsDialog";
import { ViewerHost } from "./ViewerHost";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ConversationList } from "./ConversationList";
import { useModelDrop } from "./useModelDrop";

/**
 * アプリケーションの外枠。
 *
 * 3D ビューは段 7 で `ViewerHost` として足す。React の管理外に置くため、
 * ここには器だけを用意する (ADR-0007)。
 */
export function App(): React.JSX.Element {
  const characters = useAppStore((state) => state.characters);
  const activeCharacterId = useAppStore((state) => state.activeCharacterId);
  const setActiveCharacter = useAppStore((state) => state.setActiveCharacter);
  const newConversation = useAppStore((state) => state.newConversation);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const status = useAppStore((state) => state.status);
  const model = useAppStore((state) => state.model);
  const showViewer = useAppStore((state) => state.showViewer);
  const pickModel = useAppStore((state) => state.pickModel);
  const clearModel = useAppStore((state) => state.clearModel);
  const setShowViewer = useAppStore((state) => state.setShowViewer);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const dropping = useModelDrop();
  const [licenseAcknowledged, setLicenseAcknowledged] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">moca</span>

        <select
          className="app__character"
          value={activeCharacterId ?? ""}
          disabled={status === "streaming"}
          onChange={(event) =>
            void setActiveCharacter(event.target.value === "" ? null : event.target.value)
          }
        >
          <option value="">キャラクター未選択</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>

        <span className="app__spacer" />

        {model === null ? (
          <button
            type="button"
            onClick={() => void pickModel()}
            disabled={activeCharacterId === null}
            title={
              activeCharacterId === null
                ? "先にキャラクターを選んでください"
                : "VRM ファイルを読み込みます"
            }
          >
            モデルを開く
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void setShowViewer(!showViewer)}
              aria-pressed={showViewer}
            >
              {showViewer ? "3D を隠す" : "3D を表示"}
            </button>
            <button type="button" onClick={() => void clearModel()}>
              モデルを外す
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => setHistoryOpen((open) => !open)}
          aria-pressed={historyOpen}
        >
          会話
        </button>
        <button
          type="button"
          onClick={newConversation}
          disabled={status === "streaming"}
        >
          新しい会話
        </button>
        <button
          type="button"
          onClick={() => setDiagOpen((open) => !open)}
          aria-pressed={diagOpen}
        >
          診断
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          設定
        </button>
      </header>

      {/*
        要件 4.4: MMD 向けモデルは再配布・改変・利用目的に制限を課す規約を
        持つものが多い。読み込んだ時点で確認を促す。
      */}
      {model?.format === "pmx" && !licenseAcknowledged && (
        <p className="banner banner--notice" role="status">
          <span className="banner__body">
            MMD 向けのモデルは、再配布や改変、利用目的に制限を設けているものが
            多くあります。配布元の規約をご確認のうえお使いください。
          </span>
          <span className="banner__actions">
            <button type="button" onClick={() => setLicenseAcknowledged(true)}>
              確認しました
            </button>
          </span>
        </p>
      )}

      {model?.oversized === true && (
        <p className="banner banner--notice" role="status">
          このモデルはファイルが大きめです。表示が重い場合は 3D を隠してお使いください。
        </p>
      )}

      <main className="app__main">
        {historyOpen && <ConversationList onClose={() => setHistoryOpen(false)} />}
        {/* モデル未設定でも、3D を隠していてもチャットは完全に成立する (要件 F-02) */}
        {model !== null && showViewer && <ViewerHost />}
        <ChatPanel />
        {diagOpen && <DiagnosticsPanel onClose={() => setDiagOpen(false)} />}
      </main>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      {dropping && (
        <div className="drop" aria-hidden="true">
          <p className="drop__message">VRM ファイルをここに落としてください</p>
        </div>
      )}
    </div>
  );
}
