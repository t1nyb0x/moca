import { useAppStore } from "@/app/store";
import { formatTimestamp } from "@/app/format";

/**
 * 会話の一覧 (要件 F-10-2, F-10-3)。
 *
 * 一覧は本体とは別のファイルから読んでいるので、開くたびに全会話を
 * 読み込むことはない (ADR-0010)。
 */
export function ConversationList({ onClose }: { onClose: () => void }): React.JSX.Element {
  const conversations = useAppStore((state) => state.conversations);
  const current = useAppStore((state) => state.conversation);
  const status = useAppStore((state) => state.status);
  const loadConversation = useAppStore((state) => state.loadConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const newConversation = useAppStore((state) => state.newConversation);

  const streaming = status === "streaming";

  return (
    <aside className="history">
      <header className="history__header">
        <h3>会話</h3>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </header>

      <button
        type="button"
        className="history__new"
        disabled={streaming}
        onClick={newConversation}
      >
        新しい会話
      </button>

      {conversations.length === 0 ? (
        <p className="history__empty">まだ会話がありません。</p>
      ) : (
        <ul className="history__list">
          {conversations.map((item) => {
            const active = current?.id === item.id;
            return (
              <li
                key={item.id}
                className={active ? "history__item history__item--on" : "history__item"}
              >
                <button
                  type="button"
                  className="history__open"
                  disabled={streaming}
                  aria-current={active ? "true" : undefined}
                  onClick={() => void loadConversation(item.id)}
                >
                  <span className="history__title">{item.title}</span>
                  <span className="history__meta">
                    {formatTimestamp(item.updatedAt)} / {item.messageCount} 件
                  </span>
                </button>
                <button
                  type="button"
                  className="history__delete"
                  disabled={streaming}
                  title="この会話を削除する"
                  onClick={() => void deleteConversation(item.id)}
                >
                  削除
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
