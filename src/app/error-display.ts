import type { CommandError } from "@/ipc/errors";

export type ErrorDisplay = {
  /** 主文。Rust 側が用意した日本語をそのまま使う。 */
  readonly message: string;
  /** 次に何をすればよいか。無ければ null。 */
  readonly hint: string | null;
  /** そのまま再試行して意味があるか。 */
  readonly retryable: boolean;
};

function hintFor(error: CommandError): string | null {
  switch (error.kind) {
    case "auth":
      return "設定画面で API キーを確認してください。";
    case "rateLimit": {
      if (error.retryAfterMs === null) {
        return "しばらく待ってから再試行してください。";
      }
      const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
      return `${seconds} 秒ほど待ってから再試行してください。`;
    }
    case "contextTooLong":
      return "新しい会話を始めるか、古いやり取りを整理してください。";
    case "network":
      return "ローカルの LLM を使っている場合は、サーバーが起動しているか確認してください。";
    case "protocol":
      return "接続先の URL とモデル名が正しいか確認してください。";
    case "server":
      return "接続先で問題が起きています。しばらく待ってから試してください。";
    case "io":
      return "保存先のフォルダにアクセスできるか確認してください。";
    case "notFound":
    case "invalid":
      return null;
  }
}

function isRetryable(error: CommandError): boolean {
  switch (error.kind) {
    case "rateLimit":
    case "network":
    case "server":
      return true;
    default:
      return false;
  }
}

/** UI に出す形へ整える。 */
export function describeError(error: CommandError): ErrorDisplay {
  return {
    message: error.message,
    hint: hintFor(error),
    retryable: isRetryable(error),
  };
}
