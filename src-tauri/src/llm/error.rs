//! プロバイダ非依存のエラー表現。
//!
//! `message` はそのまま UI に出せる日本語であること。プロバイダの生の
//! エラー文字列をそのまま入れてはならない。キーが反射されている可能性が
//! あるため (ADR-0011)。

use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    #[error("認証に失敗しました。API キーを確認してください")]
    Auth,

    #[error("リクエストが多すぎます。しばらく待ってから再試行してください")]
    RateLimit { retry_after: Option<Duration> },

    #[error("会話が長すぎてモデルの上限を超えました。新しい会話を始めてください")]
    ContextTooLong,

    #[error("接続できませんでした: {0}")]
    Network(String),

    #[error("応答の形式が想定と異なります: {0}")]
    Protocol(String),

    #[error("サーバーがエラーを返しました (HTTP {status}): {message}")]
    Server { status: u16, message: String },
}

impl ProviderError {
    /// HTTP ステータスから分類する。
    ///
    /// `body` はプロバイダの生の応答なので、そのまま message へ入れない。
    pub fn from_status(status: u16, retry_after: Option<Duration>) -> Self {
        match status {
            401 | 403 => Self::Auth,
            429 => Self::RateLimit { retry_after },
            400..=499 => Self::Server {
                status,
                message: "リクエストが受け付けられませんでした".to_owned(),
            },
            _ => Self::Server {
                status,
                message: "サーバー側で問題が発生しました".to_owned(),
            },
        }
    }

    /// reqwest のエラーを分類する。
    ///
    /// **URL を含めない。** reqwest のエラー表示には URL が含まれ、
    /// クエリに鍵を載せる設計だとそこから漏れる。本アプリは鍵を必ず
    /// ヘッダで送るが、二重の防御としてここでも URL を落とす。
    pub fn from_reqwest(err: &reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::Network("応答がタイムアウトしました".to_owned())
        } else if err.is_connect() {
            Self::Network(
                "接続できませんでした。エンドポイントが起動しているか確認してください".to_owned(),
            )
        } else if err.is_decode() {
            Self::Protocol("応答を読み取れませんでした".to_owned())
        } else {
            Self::Network("通信に失敗しました".to_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 認証エラーに分類される() {
        assert_eq!(ProviderError::from_status(401, None), ProviderError::Auth);
        assert_eq!(ProviderError::from_status(403, None), ProviderError::Auth);
    }

    #[test]
    fn レート制限に分類される() {
        let retry = Some(Duration::from_secs(30));
        assert_eq!(
            ProviderError::from_status(429, retry),
            ProviderError::RateLimit { retry_after: retry }
        );
    }

    #[test]
    fn その他の_4xx_と_5xx_を区別する() {
        match ProviderError::from_status(400, None) {
            ProviderError::Server { status, .. } => assert_eq!(status, 400),
            other => panic!("想定外: {other:?}"),
        }
        match ProviderError::from_status(503, None) {
            ProviderError::Server { status, .. } => assert_eq!(status, 503),
            other => panic!("想定外: {other:?}"),
        }
    }

    #[test]
    fn 表示文言が日本語で機密を含まない() {
        let messages = [
            ProviderError::Auth.to_string(),
            ProviderError::RateLimit { retry_after: None }.to_string(),
            ProviderError::ContextTooLong.to_string(),
            ProviderError::from_status(500, None).to_string(),
        ];
        for message in messages {
            assert!(!message.is_empty());
            assert!(
                !message.contains("sk-"),
                "鍵らしき文字列が含まれる: {message}"
            );
            assert!(!message.contains("http"), "URL が含まれる: {message}");
        }
    }
}
