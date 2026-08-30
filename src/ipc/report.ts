import { invoke } from "@tauri-apps/api/core";

/**
 * 画面側の失敗を Rust のログへ送る。
 *
 * WebView の中の例外は Rust のログに残らない。残らないと「エラーになる」
 * としか分からず、調査の取っ掛かりが無い。
 *
 * ここ自体が失敗しても何もしない。報告のために報告が要る状況を作らない。
 */
export function reportClientError(message: string, detail?: unknown): void {
  const text =
    detail instanceof Error
      ? `${detail.name}: ${detail.message}\n${detail.stack ?? ""}`
      : detail === undefined
        ? undefined
        : String(detail);

  void invoke("log_client_error", { message, detail: text }).catch(() => {
    // 握りつぶす
  });
}

/**
 * 失敗として扱わないもの。
 *
 * `ResizeObserver loop ...` は、観測している要素の寸法が一巡で収束しなかった
 * ときにブラウザが出す通知で、次の描画で追いつく。マスコット表示は窓ごと
 * 拡縮するため頻繁に出るが、これをログへ流すと本当の失敗が埋もれる。
 */
const IGNORED = [/^ResizeObserver loop/];

/** 捕まえられなかった失敗をすべてログへ送る。 */
export function installClientErrorReporting(): void {
  window.addEventListener("error", (event) => {
    if (IGNORED.some((pattern) => pattern.test(event.message))) return;
    reportClientError(event.message, event.error);
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportClientError("処理されなかった拒否", event.reason);
  });
}
