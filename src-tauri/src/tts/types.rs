//! 音声合成の共通表現。
//!
//! VOICEVOX と CeVIO (shirataki 経由) は感情の表し方が根本的に違う。
//! 前者は話者ごとの「スタイル」の選択、後者は成分ごとの数値。両者を
//! 呼び出し側から見て同じ形にするのがこの層の役目
//! (docs/emotion-protocol.md 第 5 章)。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TtsKind {
    Voicevox,
    /// CeVIO AI を駆動する自作サーバー
    Shirataki,
}

impl TtsKind {
    /// 利用者へ見せる名前。接続できないときの案内に使う。
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Voicevox => "VOICEVOX",
            Self::Shirataki => "shirataki",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StyleInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpeakerInfo {
    /// 合成時に指定する値。VOICEVOX はスタイル id、CeVIO はキャスト名。
    pub id: String,
    pub name: String,
    /// VOICEVOX のスタイル。CeVIO では空。
    pub styles: Vec<StyleInfo>,
}

/// 話者ごとの声の作り方。
///
/// 単位はプロバイダ非依存にする。1.0 と 0.0 が「普通」で、そこからの
/// ずれで表す。各アダプタが自分の単位へ直す。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VoicePreset {
    /// 話者・スタイルの差し替え。指定が無ければ既定の話者を使う。
    pub speaker: Option<String>,
    /// 感情成分の値 (CeVIO)。0.0〜1.0 で表し、アダプタが 0〜100 へ直す。
    #[serde(default)]
    pub components: BTreeMap<String, f64>,
    /// 話す速さ。1.0 が普通。
    pub speed: Option<f64>,
    /// 声の高さ。0.0 が普通。-1.0〜1.0。
    pub pitch: Option<f64>,
    /// 抑揚。1.0 が普通。
    pub intonation: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SynthesizeRequest {
    pub text: String,
    /// 既定の話者。プリセットに指定があればそちらが優先される。
    pub speaker: String,
    pub preset: VoicePreset,
}

impl SynthesizeRequest {
    /// 実際に使う話者。
    pub fn effective_speaker(&self) -> &str {
        self.preset.speaker.as_deref().unwrap_or(&self.speaker)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn プリセットの話者が既定より優先される() {
        let request = SynthesizeRequest {
            text: "こんにちは".to_owned(),
            speaker: "既定".to_owned(),
            preset: VoicePreset {
                speaker: Some("差し替え".to_owned()),
                ..VoicePreset::default()
            },
        };
        assert_eq!(request.effective_speaker(), "差し替え");
    }

    #[test]
    fn プリセットに指定が無ければ既定を使う() {
        let request = SynthesizeRequest {
            text: "こんにちは".to_owned(),
            speaker: "既定".to_owned(),
            preset: VoicePreset::default(),
        };
        assert_eq!(request.effective_speaker(), "既定");
    }

    #[test]
    fn 接続先の名前を出せる() {
        assert_eq!(TtsKind::Voicevox.display_name(), "VOICEVOX");
        assert_eq!(TtsKind::Shirataki.display_name(), "shirataki");
    }
}
