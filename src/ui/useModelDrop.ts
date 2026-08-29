import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { useAppStore } from "@/app/store";

/** 受け付ける拡張子。検証は Rust 側が行う。 */
const ACCEPTED = /\.(vrm|pmx)$/i;

/**
 * ウィンドウへのファイル投下でモデルを読み込む (要件 F-01-2)。
 *
 * 投下されたパスの検証は Rust 側で行う。ここでは拡張子だけを見て、
 * 明らかに関係のないファイルを拾わないようにする。
 *
 * @returns 投下待ちの表示を出すかどうか
 */
export function useModelDrop(): boolean {
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "over" || payload.type === "enter") {
          setHovering(true);
          return;
        }
        setHovering(false);
        if (payload.type !== "drop") return;

        const target = payload.paths.find((path) => ACCEPTED.test(path));
        if (target === undefined) return;
        void useAppStore.getState().adoptModel(target);
      })
      .then((off) => {
        // 購読が張られる前に破棄されていたら、すぐ外す
        if (disposed) off();
        else unlisten = off;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return hovering;
}
