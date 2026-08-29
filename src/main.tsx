import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { installClientErrorReporting } from "./ipc/report";
import "./ui/global.css";

// 捕まえられなかった失敗を Rust のログへ送る。WebView の中の例外は
// 何もしないと痕跡が残らない。
installClientErrorReporting();

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root が見つかりません");
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
