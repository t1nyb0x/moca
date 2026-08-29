import { describeError } from "@/app/error-display";
import type { CommandError } from "@/ipc/errors";

type Props = {
  error: CommandError;
  onDismiss: () => void;
  onRetry?: (() => void) | undefined;
};

export function ErrorBanner({ error, onDismiss, onRetry }: Props): React.JSX.Element {
  const display = describeError(error);

  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__body">
        <p className="banner__message">{display.message}</p>
        {display.hint !== null && <p className="banner__hint">{display.hint}</p>}
      </div>
      <div className="banner__actions">
        {display.retryable && onRetry !== undefined && (
          <button type="button" onClick={onRetry}>
            再試行
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          閉じる
        </button>
      </div>
    </div>
  );
}
