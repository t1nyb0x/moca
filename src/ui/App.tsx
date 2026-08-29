import { useEffect, useState } from "react";

import { useAppStore } from "@/app/store";
import { canEnterMascot } from "@/domain/mascot/window";
import { windowStartDrag } from "@/ipc";
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
  const providers = useAppStore((state) => state.providers);
  const activeCharacterId = useAppStore((state) => state.activeCharacterId);
  const setActiveCharacter = useAppStore((state) => state.setActiveCharacter);
  const setProvider = useAppStore((state) => state.setProvider);
  const mascot = useAppStore((state) => state.mascot);
  const setMascot = useAppStore((state) => state.setMascot);
  const mascotScale = useAppStore((state) => state.settings?.mascotScale ?? 0.5);
  const setMascotScale = useAppStore((state) => state.setMascotScale);
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

  const character = characters.find((item) => item.id === activeCharacterId);
  const provider = providers.find((item) => item.id === character?.providerId);
  const mascotReady = canEnterMascot({ hasModel: model !== null, showViewer });

  // 透過の塗りを外すのは body。ここだけは React の外に出す必要がある
  useEffect(() => {
    document.body.classList.toggle("mascot", mascot);
    return () => document.body.classList.remove("mascot");
  }, [mascot]);

  /**
   * 掴んで窓ごと動かす (要件 F-13-6)。
   *
   * 枠を消すと掴む場所が無くなるため、モデルの上をそのまま取っ手にする。
   * ボタンの上では拾わない。押せなくなるため。
   */
  const startDrag = (event: React.MouseEvent): void => {
    if (!mascot || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, input, select") !== null) return;
    void windowStartDrag();
  };

  /** マスコット表示では道具立てを出せないので、ホイールで大きさを変える。 */
  const wheelScale = (event: React.WheelEvent): void => {
    if (!mascot) return;
    void setMascotScale(mascotScale + (event.deltaY < 0 ? 0.05 : -0.05));
  };

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="app" onMouseDown={startDrag} onWheel={wheelScale}>
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

        {/*
          接続先の切り替え。会話を保ったまま差し替えられる。キャラクターの
          切り替えと違い、会話・表情・モデルは作り直さない。
        */}
        {character !== undefined && (
          <select
            className="app__provider"
            aria-label="接続先"
            value={character.providerId}
            disabled={status === "streaming"}
            onChange={(event) => void setProvider(event.target.value)}
          >
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}

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
        {/*
          マスコット表示はモデルが出ているときだけ (要件 F-13-1)。描かれる
          ものが無いと全面が透明になり、操作できない窓が残る。
        */}
        <button
          type="button"
          disabled={!mascotReady}
          title={
            mascotReady
              ? "枠を消して机の上に置きます"
              : "モデルを表示しているときだけ使えます"
          }
          onClick={() => void setMascot(true)}
        >
          机に置く
        </button>
      </header>

      {/*
        要件 4.4: MMD 向けモデルは再配布・改変・利用目的に制限を課す規約を
        持つものが多い。読み込んだ時点で確認を促す。
      */}
      {model?.format === "pmx" && !licenseAcknowledged && (
        <p className="banner banner--notice" role="status">
          <span className="banner__body">
            <strong>PMX の対応は実験的です。</strong>
            表示と揺れ物までを目安としており、表情は診断パネルから手で
            割り当てる必要があります。立ち姿と視線は調整されません。
            <br />
            また MMD 向けのモデルは、再配布や改変、利用目的に制限を設けている
            ものが多くあります。配布元の規約をご確認のうえお使いください。
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

      {/*
        emotionMode は接続先ごとの設定で、既定は tag。off は規約に従えない
        モデルのための逃げ道 (ADR-0003)。切り替えで黙って表情が止まるのが
        一番困るので、その状態であることだけ伝える。
      */}
      {provider?.emotionMode === "off" && (
        <p className="banner banner--notice" role="status">
          この接続先は感情タグが無効です。返答に応じた表情の変化は起きません。
          設定の接続先から切り替えられます。
        </p>
      )}

      {/* マスコット表示から戻る唯一の手がかり。常に掴める場所へ置く。 */}
      {mascot && (
        <button
          type="button"
          className="mascot__exit"
          title="通常の表示に戻します"
          onClick={() => void setMascot(false)}
        >
          戻る
        </button>
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
