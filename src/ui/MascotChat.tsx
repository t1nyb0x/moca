import { useState } from "react";

import { useAppStore } from "@/app/store";

/**
 * マスコット表示のままの会話 (要件 F-13-8)。
 *
 * 別ウィンドウにはしない。Tauri のウィンドウは WebView ごと分かれ、状態を
 * 持つストアが割れるため (ADR-0016)。同じウィンドウの中で、モデルの隣に置く。
 *
 * 出すのは直近の返答だけとする。机の上に置くものなので、履歴を積むと場所を
 * 取りすぎる。さかのぼりたいときは通常表示へ戻ればよい。
 */
export function MascotChat(): React.JSX.Element {
  const conversation = useAppStore((state) => state.conversation);
  const streamingText = useAppStore((state) => state.streamingText);
  const status = useAppStore((state) => state.status);
  const send = useAppStore((state) => state.send);
  const setMascotChat = useAppStore((state) => state.setMascotChat);

  const [input, setInput] = useState("");

  const streaming = status === "streaming";
  const messages = conversation?.messages ?? [];
  // findLast は tsconfig の対象より新しいので、後ろから探す
  const lastReply = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const shown = streaming ? streamingText : (lastReply?.content ?? "");

  const submit = (): void => {
    const value = input;
    if (value.trim() === "" || streaming) return;
    setInput("");
    void send(value);
  };

  return (
    <aside className="mchat">
      <div className="mchat__bubble">
        {shown === "" ? (
          <span className="mchat__placeholder">話しかけてみてください。</span>
        ) : (
          shown
        )}
      </div>

      <div className="mchat__form">
        <input
          className="mchat__input"
          value={input}
          placeholder="メッセージを入力"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" disabled={streaming} onClick={submit}>
          送信
        </button>
      </div>

      <button
        type="button"
        className="mchat__close"
        title="吹き出しを閉じます"
        onClick={() => void setMascotChat(false)}
      >
        閉じる
      </button>
    </aside>
  );
}
