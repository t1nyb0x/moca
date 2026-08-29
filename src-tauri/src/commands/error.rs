//! IPC 境界のエラー表現 (docs/ipc-contract.md 1.4)。
//!
//! `message` はそのまま UI に出せる日本語であること。プロバイダやファイル
//! システムの生のメッセージを入れない。

use serde::Serialize;
use ts_rs::TS;

use crate::llm::error::ProviderError;
use crate::secret::store::SecretError;
use crate::storage::store::StorageError;
use crate::tts::error::TtsError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CommandErrorKind {
    Auth,
    RateLimit,
    ContextTooLong,
    Network,
    Protocol,
    Server,
    NotFound,
    Io,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommandError {
    pub kind: CommandErrorKind,
    /// ユーザーへ表示してよい文言。機密を含まない。
    pub message: String,
    pub retry_after_ms: Option<u32>,
    pub status: Option<u16>,
}

impl CommandError {
    pub fn new(kind: CommandErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after_ms: None,
            status: None,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(CommandErrorKind::Invalid, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(CommandErrorKind::NotFound, message)
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CommandError {}

impl From<ProviderError> for CommandError {
    fn from(error: ProviderError) -> Self {
        let message = error.to_string();
        match error {
            ProviderError::Auth => Self::new(CommandErrorKind::Auth, message),
            ProviderError::RateLimit { retry_after } => Self {
                kind: CommandErrorKind::RateLimit,
                message,
                retry_after_ms: retry_after.map(|duration| duration.as_millis() as u32),
                status: None,
            },
            ProviderError::ContextTooLong => Self::new(CommandErrorKind::ContextTooLong, message),
            ProviderError::Network(_) => Self::new(CommandErrorKind::Network, message),
            ProviderError::Protocol(_) => Self::new(CommandErrorKind::Protocol, message),
            ProviderError::Server { status, .. } => Self {
                kind: CommandErrorKind::Server,
                message,
                retry_after_ms: None,
                status: Some(status),
            },
        }
    }
}

impl From<StorageError> for CommandError {
    fn from(error: StorageError) -> Self {
        let message = error.to_string();
        match error {
            StorageError::NotFound => Self::new(CommandErrorKind::NotFound, message),
            StorageError::Conflict(text) => Self::new(CommandErrorKind::Invalid, text),
            StorageError::Corrupt(_) | StorageError::Io(_) => {
                Self::new(CommandErrorKind::Io, message)
            }
        }
    }
}

impl From<TtsError> for CommandError {
    fn from(error: TtsError) -> Self {
        let message = error.to_string();
        match error {
            // 起動していないのが最も多い失敗。接続の問題として扱う。
            TtsError::NotRunning(_) => Self::new(CommandErrorKind::Network, message),
            TtsError::UnknownSpeaker => Self::new(CommandErrorKind::NotFound, message),
            TtsError::Rejected => Self::new(CommandErrorKind::Invalid, message),
            TtsError::Protocol => Self::new(CommandErrorKind::Protocol, message),
            TtsError::Server { status } => Self {
                kind: CommandErrorKind::Server,
                message,
                retry_after_ms: None,
                status: Some(status),
            },
        }
    }
}

impl From<SecretError> for CommandError {
    fn from(error: SecretError) -> Self {
        // source 側には詳細が残るが、表示用には出さない
        tracing::debug!(target: "moca::secret", error = ?error, "資格情報の操作に失敗した");
        Self::new(CommandErrorKind::Io, error.to_string())
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use std::time::Duration;

    #[test]
    fn レート制限は待ち時間をミリ秒で渡す() {
        let error: CommandError = ProviderError::RateLimit {
            retry_after: Some(Duration::from_secs(30)),
        }
        .into();
        assert_eq!(error.kind, CommandErrorKind::RateLimit);
        assert_eq!(error.retry_after_ms, Some(30_000));
    }

    #[test]
    fn サーバーエラーはステータスを渡す() {
        let error: CommandError = ProviderError::Server {
            status: 503,
            message: "内部".to_owned(),
        }
        .into();
        assert_eq!(error.kind, CommandErrorKind::Server);
        assert_eq!(error.status, Some(503));
    }

    #[test]
    fn 保存の衝突は_invalid_になる() {
        // 参照されているプロバイダの削除など
        let error: CommandError = StorageError::Conflict("参照されています".to_owned()).into();
        assert_eq!(error.kind, CommandErrorKind::Invalid);
        assert_eq!(error.message, "参照されています");
    }

    #[test]
    fn 見つからない場合は_not_found_になる() {
        let error: CommandError = StorageError::NotFound.into();
        assert_eq!(error.kind, CommandErrorKind::NotFound);
    }

    #[test]
    fn 音声合成の未起動は接続の問題として扱う() {
        let error: CommandError = TtsError::NotRunning("VOICEVOX".to_owned()).into();
        assert_eq!(error.kind, CommandErrorKind::Network);
        assert!(error.message.contains("VOICEVOX"));
    }

    #[test]
    fn 表示文言が日本語で機密を含まない() {
        let errors: Vec<CommandError> = vec![
            ProviderError::Auth.into(),
            ProviderError::ContextTooLong.into(),
            StorageError::NotFound.into(),
        ];
        for error in errors {
            assert!(!error.message.is_empty());
            assert!(!error.message.contains("sk-"));
        }
    }

    #[test]
    fn json_は_camelCase_になる() {
        let error = CommandError {
            kind: CommandErrorKind::RateLimit,
            message: "待ってください".to_owned(),
            retry_after_ms: Some(1000),
            status: None,
        };
        let json = serde_json::to_string(&error).unwrap();
        assert!(json.contains("\"retryAfterMs\":1000"));
        assert!(json.contains("\"kind\":\"rateLimit\""));
    }
}
