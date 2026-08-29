import { useEffect, useRef, useState } from "react";

import { useAppStore } from "@/app/store";
import { ErrorBanner } from "./ErrorBanner";

export function ChatPanel(): React.JSX.Element {
  const conversation = useAppStore((state) => state.conversation);
  const status = useAppStore((state) => state.status);
  const streamingText = useAppStore((state) => state.streamingText);
  const thinkingText = useAppStore((state) => state.thinkingText);
  const error = useAppStore((state) => state.error);
  const activeCharacterId = useAppStore((state) => state.activeCharacterId);
  const send = useAppStore((state) => state.send);
  const cancel = useAppStore((state) => state.cancel);
  const regenerate = useAppStore((state) => state.regenerate);
  const clearError = useAppStore((state) => state.clearError);

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = conversation?.messages ?? [];
  const streaming = status === "streaming";
  const canRegenerate =
    !streaming && messages.some((message) => message.role === "assistant");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamingText, thinkingText]);

  const submit = (): void => {
    const value = input;
    if (value.trim() === "" || streaming) return;
    setInput("");
    void send(value);
  };

  return (
    <section className="chat">
      {error !== null && (
        <ErrorBanner
          error={error}
          onDismiss={clearError}
          onRetry={canRegenerate ? () => void regenerate() : undefined}
        />
      )}

      <div className="chat__log">
        {messages.length === 0 && !streaming && (
          <p className="chat__empty">
            {activeCharacterId === null
              ? "設定からキャラクターを作ると会話を始められます。"
              : "話しかけてみてください。"}
          </p>
        )}

        {messages.map((message, index) => (
          <article
            key={`${message.createdAt}-${index}`}
            className={`bubble bubble--${message.role}`}
          >
            {message.content}
          </article>
        ))}

        {/*
          推論モデルは本文の前に長く考える。何も出さないと固まったように
          見えるので、思考中であることと末尾だけを示す。
        */}
        {streaming && streamingText === "" && thinkingText !== "" && (
          <article className="bubble bubble--thinking">
            <span className="bubble__label">考えています</span>
            {thinkingText.slice(-120)}
          </article>
        )}

        {streaming && (streamingText !== "" || thinkingText === "") && (
          <article className="bubble bubble--assistant bubble--streaming">
            {streamingText}
            <span className="bubble__caret" aria-hidden="true" />
          </article>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          className="composer__input"
          value={input}
          rows={2}
          placeholder="メッセージを入力"
          disabled={activeCharacterId === null}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter で送信、Shift+Enter で改行
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer__actions">
          {streaming ? (
            <button type="button" onClick={() => void cancel()}>
              中断
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={input.trim() === "" || activeCharacterId === null}
            >
              送信
            </button>
          )}
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={!canRegenerate}
            title="直前の応答を作り直す"
          >
            再生成
          </button>
        </div>
      </div>
    </section>
  );
}
