import { useState } from "react";

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
 *
 * **動かして確かめるのはここではなく診断パネルで行う。** この画面は全面を
 * 覆うダイアログなので、押しても背後のモデルが見えない。診断は横に開く板で、
 * モデルを見たまま押せる (要件 F-15-9)。
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

  /**
   * 読み込んだファイルを割り当てへ足す。
   *
   * タグ名はファイル名から推測する。そのまま使えるならそれを既定にし、
   * 使えなければ空にして利用者に決めてもらう。
   */
  const append = (
    handles: readonly { readonly path: string; readonly name: string }[],
  ): void => {
    const added: GestureBinding[] = [];
    for (const handle of handles) {
      const taken = [...value, ...added].map((item) => item.tag);
      const guess = normalizeGestureTag(handle.name);
      const tag = validateGestureTag(guess, taken) === null ? guess : "";
      added.push({ tag, path: handle.path, name: handle.name });
    }
    onChange([...value, ...added]);
  };

  /** 押しているあいだの共通の後始末。 */
  const run = (work: () => Promise<void>): void => {
    setBusy(true);
    setStatus(null);
    void (async () => {
      try {
        await work();
      } catch (error) {
        setStatus(ipc.toCommandError(error).message);
      } finally {
        setBusy(false);
      }
    })();
  };

  /** ファイルを選んで一件足す。 */
  const add = (): void =>
    run(async () => {
      const handle = await ipc.motionPick();
      if (handle === null) return;
      append([handle]);
    });

  /**
   * 同梱の身振りを足す (ADR-0020)。
   *
   * VRMA を持っていない人でも、ひとつは試せるようにするための入り口。
   * 既に入っているものは飛ばす。押すたびに増えていくと分かりにくい。
   */
  const addBundled = (): void =>
    run(async () => {
      const bundled = await ipc.motionBundled();
      const known = new Set(value.map((item) => item.path));
      const fresh = bundled.filter((handle) => !known.has(handle.path));

      if (bundled.length === 0) {
        setStatus("同梱の身振りが見つかりませんでした");
        return;
      }
      if (fresh.length === 0) {
        setStatus("同梱の身振りはすべて追加済みです");
        return;
      }
      append(fresh);
    });

  return (
    <fieldset className="form__fieldset">
      <legend>身振り</legend>

      <p className="form__note">
        VRMA を読み込んでタグ名を付けると、その名前が返答の指示として使えるように
        なります。返答に <code>[タグ名]</code> が出たら、その動きをします。
        割り当てが無ければ何も起きません。手持ちの VRMA が無ければ、同梱の
        <code>wave</code>（手を振る）から試せます。
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
        <button type="button" disabled={busy} onClick={addBundled}>
          同梱の身振りを追加
        </button>
      </div>
      {status !== null && <p className="form__note">{status}</p>}

      <p className="form__note">
        タグ名は英小文字だけで書いてください。感情タグ（happy など）と同じ名前は
        使えません。VRM のみが対象です。PMX はボーン名が標準化されていないため
        動きません。
      </p>

      <p className="form__note">
        <strong>動きを確かめるには、保存してこの画面を閉じ、「診断」を開いて
        ください。</strong>
        この画面はモデルの上に重なるため、ここで動かしても見えません。診断は横に
        開くので、モデルを見たまま試せます。
      </p>
    </fieldset>
  );
}
