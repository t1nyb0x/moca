import { useAppStore } from "@/app/store";
import { CANONICAL_EMOTIONS } from "@/domain/emotion/types";

const EMOTION_LABELS: Record<string, string> = {
  neutral: "平常",
  happy: "喜び",
  angry: "怒り",
  sad: "悲しみ",
  relaxed: "安らぎ",
  surprised: "驚き",
};

/**
 * 診断パネル。
 *
 * 表情が動かない、色が付かないといった不具合は何のエラーも出さずに起きる。
 * 原因がモデル側にあるのか経路にあるのかを、推測ではなく見て切り分けられる
 * ようにする。
 *
 * 感情ボタンは LLM とまったく同じ経路（ストアの emotion）を通すので、
 * ここで顔が変われば経路は生きている。
 */
export function DiagnosticsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const model = useAppStore((state) => state.model);
  const diagnostics = useAppStore((state) => state.modelDiagnostics);
  const emotion = useAppStore((state) => state.emotion);
  const previewEmotion = useAppStore((state) => state.previewEmotion);

  const expressible = new Set(diagnostics?.expressibleEmotions ?? []);

  return (
    <aside className="diag">
      <header className="diag__header">
        <h3>診断</h3>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </header>

      {model === null ? (
        <p className="diag__note">モデルが読み込まれていません。</p>
      ) : diagnostics === null ? (
        <p className="diag__note">モデルの情報を取得中です。</p>
      ) : (
        <dl className="diag__list">
          <dt>テクスチャ</dt>
          <dd>
            {diagnostics.textureCount} 枚
            {diagnostics.textureCount === 0 && "（読み込みに失敗している可能性）"}
          </dd>

          <dt>表情の総数</dt>
          <dd>
            {diagnostics.expressionCount} 個
            {diagnostics.expressionCount === 0 && "（このモデルは表情を持ちません）"}
          </dd>

          <dt>描画</dt>
          <dd>{diagnostics.rendererName}</dd>
        </dl>
      )}

      <p className="diag__note">
        現在の感情: <strong>{EMOTION_LABELS[emotion.emotion] ?? emotion.emotion}</strong>
        {emotion.intensity !== 1 && `（強さ ${emotion.intensity}）`}
      </p>

      <p className="diag__note">
        押すと顔が変わるか確かめられます。変われば経路は生きています。
      </p>
      <div className="diag__buttons">
        {CANONICAL_EMOTIONS.map((item) => {
          const supported = model === null || diagnostics === null || expressible.has(item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={emotion.emotion === item}
              className={emotion.emotion === item ? "diag__button diag__button--on" : "diag__button"}
              onClick={() => previewEmotion(item)}
              title={supported ? undefined : "このモデルはこの感情を表現できません"}
            >
              {EMOTION_LABELS[item] ?? item}
              {!supported && "（非対応）"}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
