import { useEffect, useRef, useState } from "react";

import { useAppStore } from "@/app/store";

/**
 * マスコット表示のままの会話 (要件 F-13-8)。
 *
 * 別ウィンドウにはしない。Tauri のウィンドウは WebView ごと分かれ、状態を
 * 持つストアが割れるため (ADR-0016)。同じウィンドウの中で、モデルの隣に置く。
 */
export function MascotChat(): React.JSX.Element {
  const conversation = useAppStore((state) => state.conversation);
  const streamingText = useAppStore((state) => state.streamingText);
  const status = useAppStore((state) => state.status);
  const send = useAppStore((state) => state.send);
  const cancel = useAppStore((state) => state.cancel);
  const setMascotChat = useAppStore((state) => state.setMascotChat);

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const streaming = status === "streaming";
  const messages = conversation?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamingText]);

  const submit = (): void => {
    const value = input;
    if (value.trim() === "" || streaming) return;
    setInput("");
    void send(value);
  };

  return (
    <aside className="mchat">
      <div className="mchat__log">
        {messages.length === 0 && !streaming && (
          <p className="mchat__placeholder">話しかけてみてください。</p>
        )}

        {messages.map((message, index) => (
          <p
            key={`${message.createdAt}-${index}`}
            className={`mchat__msg mchat__msg--${message.role}`}
          >
            {message.content}
          </p>
        ))}

        {streaming && streamingText !== "" && (
          <p className="mchat__msg mchat__msg--assistant">{streamingText}</p>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="mchat__form">
        <input
          className="mchat__input"
          value={input}
          placeholder="メッセージを入力"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // 変換中の Enter は確定であって送信ではない
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {streaming ? (
          <button type="button" onClick={() => void cancel()}>
            中断
          </button>
        ) : (
          <button type="button" onClick={submit}>
            送信
          </button>
        )}
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
