import { useEffect, useRef } from "react";

/**
 * 画面を覆う板。**背景を押しても Esc でも閉じられる。**
 *
 * 「閉じる」を押しにいくのは、画面の隅まで目とマウスを運ぶことになる。閉じ方は
 * 複数あってよい。
 *
 * 覆いであって対話の器ではないので、`role="dialog"` は中身の側に付ける。
 */
export function DialogBackdrop({
  onClose,
  children,
  enabled = true,
}: {
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  /**
   * 背景と Esc で閉じられるか。
   *
   * 上に確認を重ねているあいだは切る。そうしないと、確認へ答えるつもりの Esc で
   * 下の画面まで閉じてしまう。
   */
  readonly enabled?: boolean;
}): React.JSX.Element {
  /**
   * 押し始めが背景だったか。
   *
   * **離した場所だけで決めない。** 入力欄の文字を選ぼうとして外まで引っ張ると、
   * 離した場所は背景になる。それで閉じると書きかけが消える。
   */
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (!enabled) return;
        // 背景そのものを押したときだけ閉じる。中の要素からの伝播では閉じない。
        if (event.target !== event.currentTarget) return;
        if (!pressedOnBackdrop.current) return;
        onClose();
      }}
    >
      {children}
    </div>
  );
}
