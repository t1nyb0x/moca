//! 音声合成 (要件 P2、ADR-0011 と同じくローカルの別プロセスへ繋ぐ)。
//!
//! VOICEVOX と CeVIO は感情の表し方が根本的に違う。前者は話者ごとのスタイル
//! 選択、後者は成分ごとの数値。差異はこのモジュールに閉じ込め、呼び出し側は
//! 正規化感情だけを扱う。
//!
//! 繋ぎ方は 2 通りある。HTTP (VOICEVOX、shirataki) と COM (CeVIO を直に叩く。
//! ADR-0018)。どちらも [`SpeechSynthesizer`] として同じ形で見える。

pub mod blend;
pub mod cevio;
pub mod error;
pub mod http;
pub mod shirataki;
pub mod types;
pub mod voicevox;

use async_trait::async_trait;

use error::TtsError;
use types::{SpeakerInfo, SynthesizeRequest};

/// 合成器の口。
///
/// 実装は接続の仕方ごとに置く。HTTP は [`http::HttpSynthesizer`]、COM は
/// [`cevio::CevioSynthesizer`]。
#[async_trait]
pub trait SpeechSynthesizer: Send + Sync {
    async fn speakers(&self) -> Result<Vec<SpeakerInfo>, TtsError>;

    /// 話者が持つ感情成分の名前。VOICEVOX には無いので空を返す。
    async fn emotion_axes(&self, speaker: &str) -> Result<Vec<String>, TtsError>;

    /// WAV のバイト列を返す。
    async fn synthesize(&self, request: SynthesizeRequest) -> Result<Vec<u8>, TtsError>;

    async fn health_check(&self) -> Result<(), TtsError>;
}
