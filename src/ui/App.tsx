import { useEffect, useState } from "react";

import { useAppStore } from "@/app/store";
import { ChatPanel } from "./ChatPanel";
import { SettingsDialog } from "./SettingsDialog";

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

  const [settingsOpen, setSettingsOpen] = useState(false);

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

        <button
          type="button"
          onClick={newConversation}
          disabled={status === "streaming"}
        >
          新しい会話
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          設定
        </button>
      </header>

      <main className="app__main">
        <ChatPanel />
      </main>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
