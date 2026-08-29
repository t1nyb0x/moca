//! 音声合成のエラー表現。
//!
//! 表示文言はそのまま UI に出せる日本語であること。合成先はローカルの
//! 別プロセスなので、起動していないことが最も多い失敗になる。

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TtsError {
    #[error("音声合成に接続できません。{0}が起動しているか確認してください")]
    NotRunning(String),

    #[error("指定された話者が見つかりません")]
    UnknownSpeaker,

    #[error("音声合成が要求を受け付けませんでした")]
    Rejected,

    #[error("音声合成の応答を読み取れませんでした")]
    Protocol,

    #[error("音声合成でエラーが発生しました (HTTP {status})")]
    Server { status: u16 },
}

impl TtsError {
    pub fn from_reqwest(err: &reqwest::Error, service: &str) -> Self {
        if err.is_connect() || err.is_timeout() {
            Self::NotRunning(service.to_owned())
        } else if err.is_decode() {
            Self::Protocol
        } else {
            Self::NotRunning(service.to_owned())
        }
    }

    pub fn from_status(status: u16) -> Self {
        match status {
            400..=404 => Self::Rejected,
            _ => Self::Server { status },
        }
    }
}
