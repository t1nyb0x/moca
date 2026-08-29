import type { CommandError } from "./generated/CommandError";
import type { CommandErrorKind } from "./generated/CommandErrorKind";

export type { CommandError, CommandErrorKind };

function isCommandErrorKind(value: unknown): value is CommandErrorKind {
  return (
    typeof value === "string" &&
    [
      "auth",
      "rateLimit",
      "contextTooLong",
      "network",
      "protocol",
      "server",
      "notFound",
      "io",
      "invalid",
    ].includes(value)
  );
}

/** Rust 側が返した CommandError かどうか。 */
export function isCommandError(value: unknown): value is CommandError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CommandError>;
  return (
    isCommandErrorKind(candidate.kind) && typeof candidate.message === "string"
  );
}

/**
 * 何が飛んできても CommandError にそろえる。
 *
 * invoke は Rust 側の CommandError で棄却するのが正常な経路だが、WebView
 * 内部の例外や Tauri 層の失敗が素の Error や文字列で来ることがある。UI が
 * 分岐を持たずに済むよう、ここで一本化する。
 */
export function toCommandError(value: unknown): CommandError {
  if (isCommandError(value)) return value;

  if (value instanceof Error) {
    return {
      kind: "protocol",
      message: value.message || "予期しないエラーが発生しました",
      retryAfterMs: null,
      status: null,
    };
  }

  if (typeof value === "string" && value !== "") {
    return {
      kind: "protocol",
      message: value,
      retryAfterMs: null,
      status: null,
    };
  }

  return {
    kind: "protocol",
    message: "予期しないエラーが発生しました",
    retryAfterMs: null,
    status: null,
  };
}
