import { Component, type ErrorInfo, type ReactNode } from "react";

import { reportClientError } from "@/ipc/report";

type Props = { readonly children: ReactNode };
type State = { readonly error: Error | null };

/**
 * 画面全体が落ちたときに、白い窓ではなく理由を出す。
 *
 * React は描画中の例外を投げると木ごと外す。何も出ない窓が残るだけでは
 * 利用者に何も伝わらないし、こちらも調べようがない。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError(error.message, `${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="crash" role="alert">
        <h1>画面の表示に失敗しました</h1>
        <p>
          この内容はログにも記録されています。差し支えなければ、そのまま
          お知らせください。
        </p>
        <pre className="crash__detail">
          {error.name}: {error.message}
          {"\n"}
          {error.stack}
        </pre>
        <button type="button" onClick={() => this.setState({ error: null })}>
          もう一度試す
        </button>
      </div>
    );
  }
}
