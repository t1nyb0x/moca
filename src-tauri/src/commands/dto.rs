//! IPC 境界の DTO。
//!
//! 保存形とは意図的に分けてある。たとえば `hasApiKey` は資格情報ストアへ
//! 問い合わせて導く値で、ファイルには持たない (docs/ipc-contract.md 1.3)。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::llm::http::ProviderKind;
use crate::storage::models::{EmotionMode, Message, ProviderProfile};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderProfileDto {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    /// 設定済みか否かだけを伝える。鍵そのものは決して返さない。
    pub has_api_key: bool,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: u32,
    pub emotion_mode: EmotionMode,
    pub context_budget_tokens: Option<u32>,
}

impl ProviderProfileDto {
    pub fn from_profile(profile: &ProviderProfile, has_api_key: bool) -> Self {
        Self {
            id: profile.id.clone(),
            name: profile.name.clone(),
            kind: profile.kind,
            base_url: profile.base_url.clone(),
            model: profile.model.clone(),
            has_api_key,
            temperature: profile.temperature,
            top_p: profile.top_p,
            max_tokens: profile.max_tokens,
            emotion_mode: profile.emotion_mode,
            context_budget_tokens: profile.context_budget_tokens,
        }
    }

    pub fn into_profile(self) -> ProviderProfile {
        ProviderProfile {
            id: self.id,
            name: self.name,
            kind: self.kind,
            base_url: self.base_url,
            model: self.model,
            temperature: self.temperature,
            top_p: self.top_p,
            max_tokens: self.max_tokens,
            emotion_mode: self.emotion_mode,
            context_budget_tokens: self.context_budget_tokens,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderHealth {
    pub ok: bool,
    pub latency_ms: Option<u32>,
    /// 表示用。成功時はモデル数など。
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatStreamRequest {
    /// フロントが採番する。中断の宛先になる。
    pub request_id: String,
    pub character_id: String,
    /// 送信対象。窓の切り出しはフロントが行う。
    pub history: Vec<Message>,
    pub user_input: String,
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use crate::storage::models::EmotionMode;

    fn profile() -> ProviderProfile {
        ProviderProfile {
            id: "p1".to_owned(),
            name: "ローカル".to_owned(),
            kind: ProviderKind::OpenaiCompatible,
            base_url: "http://localhost:11434".to_owned(),
            model: "llama3.2".to_owned(),
            temperature: Some(0.7),
            top_p: None,
            max_tokens: 1024,
            emotion_mode: EmotionMode::Tag,
            context_budget_tokens: None,
        }
    }

    #[test]
    fn 保存形と_dto_を往復できる() {
        let original = profile();
        let dto = ProviderProfileDto::from_profile(&original, true);
        assert!(dto.has_api_key);
        assert_eq!(dto.clone().into_profile(), original);
    }

    #[test]
    fn dto_に鍵そのものは含まれない() {
        let json =
            serde_json::to_string(&ProviderProfileDto::from_profile(&profile(), true)).unwrap();
        assert!(json.contains("\"hasApiKey\":true"));
        assert!(!json.contains("apiKey\":\""), "鍵の値を返している: {json}");
    }
}
