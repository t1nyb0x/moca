//! プロバイダ応答の分類に使う共通処理。

use serde_json::Value;

use super::error::ProviderError;

/// エラー応答を分類する。
///
/// **表示用の文言にプロバイダの生メッセージを入れない。** 鍵が反射されて
/// いる可能性があるため (ADR-0011)。分類のために中身を見るのは構わないが、
/// 外へ出すのは自前の日本語だけにする。
pub fn classify_error(error: &Value, status: u16) -> ProviderError {
    let code = error
        .get("code")
        .and_then(Value::as_str)
        .or_else(|| error.get("type").and_then(Value::as_str))
        .or_else(|| error.get("status").and_then(Value::as_str))
        .unwrap_or_default()
        .to_ascii_lowercase();

    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();

    tracing::debug!(target: "moca::llm", code = %code, "プロバイダがエラーを返した");

    if code.contains("context_length") || code.contains("context_window") {
        return ProviderError::ContextTooLong;
    }
    if message.contains("context length")
        || message.contains("context window")
        || message.contains("too many tokens")
        || message.contains("maximum context")
    {
        return ProviderError::ContextTooLong;
    }
    if code.contains("authentication") || code.contains("permission") || code.contains("api key") {
        return ProviderError::Auth;
    }
    if code.contains("rate_limit") || code.contains("resource_exhausted") {
        return ProviderError::RateLimit { retry_after: None };
    }

    ProviderError::from_status(status, None)
}

/// data 部を JSON として読む。
pub fn parse_json(data: &str) -> Result<Value, ProviderError> {
    serde_json::from_str(data)
        .map_err(|_| ProviderError::Protocol("JSON として読めない応答が届きました".to_owned()))
}

pub fn as_u32(value: Option<&Value>) -> u32 {
    value.and_then(Value::as_u64).unwrap_or(0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 文脈長超過を検出する() {
        let error = json!({ "code": "context_length_exceeded", "message": "..." });
        assert_eq!(classify_error(&error, 400), ProviderError::ContextTooLong);
    }

    #[test]
    fn メッセージからも文脈長超過を検出する() {
        let error = json!({ "message": "This model's maximum context length is 8192 tokens" });
        assert_eq!(classify_error(&error, 400), ProviderError::ContextTooLong);
    }

    #[test]
    fn 認証エラーを検出する() {
        let error = json!({ "type": "authentication_error", "message": "invalid x-api-key" });
        assert_eq!(classify_error(&error, 400), ProviderError::Auth);
    }

    #[test]
    fn レート制限を検出する() {
        let error = json!({ "type": "rate_limit_error" });
        assert_eq!(
            classify_error(&error, 400),
            ProviderError::RateLimit { retry_after: None }
        );
    }

    #[test]
    fn 分類できなければステータスに従う() {
        let error = json!({ "message": "something went wrong" });
        match classify_error(&error, 503) {
            ProviderError::Server { status, .. } => assert_eq!(status, 503),
            other => panic!("想定外: {other:?}"),
        }
    }

    #[test]
    fn 表示文言にプロバイダの生メッセージが混ざらない() {
        let error = json!({ "message": "invalid api key sk-live-abcdef123456" });
        let rendered = classify_error(&error, 401).to_string();
        assert!(!rendered.contains("sk-live"), "実際の出力: {rendered}");
    }
}
