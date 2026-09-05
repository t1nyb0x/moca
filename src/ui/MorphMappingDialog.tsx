import { useMemo } from "react";

import { DialogBackdrop } from "./DialogBackdrop";

import { useAppStore } from "@/app/store";
import { CANONICAL_EMOTIONS, type CanonicalEmotion } from "@/domain/emotion/types";
import type { MorphTarget } from "@/ipc/generated/MorphTarget";

const EMOTION_LABELS: Record<CanonicalEmotion, string> = {
  neutral: "平常",
  happy: "喜び",
  angry: "怒り",
  sad: "悲しみ",
  relaxed: "安らぎ",
  surprised: "驚き",
};

/** 平常はすべてを 0 にすることで表すので、割り当ての対象にしない。 */
const EDITABLE = CANONICAL_EMOTIONS.filter((emotion) => emotion !== "neutral");

/**
 * PMX のモーフ割り当てを編集する (ADR-0004)。
 *
 * PMX にはモーフ名の標準が無く、推測は外れる。外れたときに直す手段が
 * 無ければ、表情は永久に出ない。
 *
 * 変更は即座に保存し、顔へ反映する。割り当ての良し悪しは見て判断する
 * ものなので、確定してからでないと確かめられない作りにはしない。
 */
export function MorphMappingDialog({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const diagnostics = useAppStore((state) => state.modelDiagnostics);
  const characters = useAppStore((state) => state.characters);
  const activeCharacterId = useAppStore((state) => state.activeCharacterId);
  const saveEmotionMapping = useAppStore((state) => state.saveEmotionMapping);
  const previewEmotion = useAppStore((state) => state.previewEmotion);

  const character = characters.find((item) => item.id === activeCharacterId);
  const available = diagnostics?.expressionNames ?? [];
  const current = diagnostics?.emotionMorphs ?? null;

  /** 表示している割り当て。保存済みが無ければ推測の結果を見せる。 */
  const entries = useMemo(() => {
    const saved = character?.emotionMapping?.entries;
    const result: Record<string, MorphTarget[]> = {};
    for (const emotion of EDITABLE) {
      const fromSaved = saved?.[emotion];
      result[emotion] = fromSaved ?? [...(current?.[emotion] ?? [])];
    }
    return result;
  }, [character?.emotionMapping, current]);

  const commit = (next: Record<string, MorphTarget[]>): void => {
    void saveEmotionMapping({
      format: "pmx",
      modelId: character?.modelPath ?? null,
      entries: next,
    });
  };

  const update = (
    emotion: CanonicalEmotion,
    change: (targets: MorphTarget[]) => MorphTarget[],
  ): void => {
    commit({ ...entries, [emotion]: change([...(entries[emotion] ?? [])]) });
  };

  if (current === null) {
    return (
      <DialogBackdrop onClose={onClose}>
        <div className="dialog" role="dialog" aria-modal="true">
          <header className="dialog__header">
            <h2>表情の割り当て</h2>
            <button type="button" onClick={onClose}>
              閉じる
            </button>
          </header>
          <p className="form__note">
            この機能は PMX モデルでのみ使えます。VRM は表情が仕様で標準化されて
            いるため、割り当ての必要がありません。
          </p>
        </div>
      </DialogBackdrop>
    );
  }

  return (
    <DialogBackdrop onClose={onClose}>
      <div className="dialog" role="dialog" aria-modal="true">
        <header className="dialog__header">
          <h2>表情の割り当て</h2>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        <p className="form__note">
          PMX はモーフ名がモデルごとに違うため、自動の推測は外れることが
          あります。変更するとすぐに顔へ反映されるので、見ながら調整して
          ください。モデルは {available.length} 個のモーフを持っています。
        </p>

        {EDITABLE.map((emotion) => {
          const targets = entries[emotion] ?? [];
          return (
            <section key={emotion} className="mapping">
              <div className="mapping__head">
                <h3>{EMOTION_LABELS[emotion]}</h3>
                <button type="button" onClick={() => previewEmotion(emotion)}>
                  試す
                </button>
                <span className="mapping__spacer" />
                <button
                  type="button"
                  onClick={() =>
                    update(emotion, (list) => [
                      ...list,
                      { morphName: available[0] ?? "", weight: 1 },
                    ])
                  }
                  disabled={available.length === 0}
                >
                  モーフを足す
                </button>
              </div>

              {targets.length === 0 ? (
                <p className="form__note">
                  割り当てがありません。この感情では表情が変わりません。
                </p>
              ) : (
                targets.map((target, index) => (
                  <div key={`${emotion}-${index}`} className="mapping__row">
                    <select
                      value={target.morphName}
                      onChange={(event) =>
                        update(emotion, (list) => {
                          list[index] = { ...target, morphName: event.target.value };
                          return list;
                        })
                      }
                    >
                      {available.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={target.weight}
                      onChange={(event) =>
                        update(emotion, (list) => {
                          const weight = Math.min(1, Math.max(0, Number(event.target.value) || 0));
                          list[index] = { ...target, weight };
                          return list;
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        update(emotion, (list) => list.filter((_, i) => i !== index))
                      }
                    >
                      外す
                    </button>
                  </div>
                ))
              )}
            </section>
          );
        })}

        <div className="form__actions">
          <button
            type="button"
            onClick={() => void saveEmotionMapping(null)}
            title="自動の推測に戻します"
          >
            推測に戻す
          </button>
        </div>
      </div>
    </DialogBackdrop>
  );
}
