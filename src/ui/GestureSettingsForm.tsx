import { useState } from "react";

import { useAppStore } from "@/app/store";
import {
  describeGestureTagProblem,
  normalizeGestureTag,
  validateGestureTag,
} from "@/domain/motion/gesture";
import * as ipc from "@/ipc";
import type { GestureBinding } from "@/ipc/generated/GestureBinding";

/**
 * 身振りの割り当て (要件 F-15)。
 *
 * VRMA を読み込んでタグ名を付けると、その名前がシステムプロンプトへ載る。
 * 返答にそのタグが出たら、割り当てたモーションを再生する (ADR-0019)。
 */
export function GestureSettingsForm({
  value,
  onChange,
}: {
  readonly value: readonly GestureBinding[];
  readonly onChange: (next: GestureBinding[]) => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (index: number, partial: Partial<GestureBinding>): void =>
    onChange(
      value.map((item, at) => (at === index ? { ...item, ...partial } : item)),
    );

  const problemAt = (index: number): string | null => {
    const binding = value[index];
    if (binding === undefined) return null;
    const others = value
      .filter((_, at) => at !== index)
      .map((item) => item.tag);
    const problem = validateGestureTag(binding.tag, others);
    return problem === null ? null : describeGestureTagProblem(problem);
  };

  /** ファイルを選んで一件足す。タグ名はファイル名から推測する。 */
  const add = (): void => {
    setBusy(true);
    setStatus(null);
    void (async () => {
      try {
        const handle = await ipc.motionPick();
        if (handle === null) return;

        // ファイル名がそのままタグに使えるならそれを既定にする。使えなければ
        // 空にして、利用者に決めてもらう。
        const guess = normalizeGestureTag(handle.name);
        const tag =
          validateGestureTag(
            guess,
            value.map((item) => item.tag),
          ) === null
            ? guess
            : "";

        onChange([...value, { tag, path: handle.path, name: handle.name }]);
      } catch (error) {
        setStatus(ipc.toCommandError(error).message);
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * その場で動かして確かめる。
   *
   * 保存を待たずに見られるよう、編集中の割り当てをそのまま 3D ビューへ
   * 載せてから動かす。
   */
  const tryOut = (index: number): void => {
    const binding = value[index];
    if (binding === undefined || problemAt(index) !== null) return;
    setStatus(null);
    void (async () => {
      const store = useAppStore.getState();
      await store.refreshGestures([...value]);
      store.playGestures([{ tag: binding.tag, intensity: 1 }]);
    })();
  };

  return (
    <fieldset className="form__fieldset">
      <legend>身振り</legend>

      <p className="form__note">
        VRMA を読み込んでタグ名を付けると、その名前が返答の指示として使えるように
        なります。返答に <code>[タグ名]</code> が出たら、その動きをします。
        割り当てが無ければ何も起きません。
      </p>

      {value.length > 0 && (
        <ul className="list">
          {value.map((binding, index) => {
            const problem = problemAt(index);
            return (
              <li key={`${binding.path}-${index}`} className="list__item">
                <div>
                  <input
                    aria-label="タグ名"
                    value={binding.tag}
                    placeholder="wave"
                    onChange={(event) =>
                      patch(index, {
                        tag: normalizeGestureTag(event.target.value),
                      })
                    }
                  />
                  <small>{binding.name}</small>
                  {problem !== null && <small role="alert">{problem}</small>}
                </div>
                <div className="list__actions">
                  <button
                    type="button"
                    disabled={problem !== null}
                    onClick={() => tryOut(index)}
                  >
                    試す
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((_, at) => at !== index))}
                  >
                    外す
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="form__actions">
        <button type="button" disabled={busy} onClick={add}>
          VRMA を追加
        </button>
      </div>
      {status !== null && <p className="form__note">{status}</p>}

      <p className="form__note">
        タグ名は英小文字だけで書いてください。感情タグ（happy など）と同じ名前は
        使えません。VRM のみが対象です。PMX はボーン名が標準化されていないため
        動きません。
      </p>
    </fieldset>
  );
}
