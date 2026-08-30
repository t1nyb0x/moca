//! 永続化するデータの型。
//!
//! 仕様: docs/ipc-contract.md 第 2 章、docs/requirements.md 第 8 章
//!
//! ここに置くのは「ファイルへ書く形」であって、IPC 境界の DTO とは
//! 一致しない。たとえば `ProviderProfile` に `hasApiKey` は持たせない。
//! あれは資格情報ストアへ問い合わせて導く値であり、ファイルへ写しを
//! 置くと実体と食い違う。DTO の組み立ては段 5 のコマンド層で行う。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::llm::http::ProviderKind;
use crate::tts::types::{TtsKind, VoicePreset};

/// スキーマの版。将来の移行に備えて全レコードが持つ。
pub const SCHEMA_VERSION: u32 = 1;

fn schema_version() -> u32 {
    SCHEMA_VERSION
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ModelFormat {
    Vrm,
    Pmx,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EmotionMode {
    /// 感情タグを注入し、解析する
    Tag,
    /// 注入しない。常に neutral で動く
    Off,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Settings {
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    pub active_character_id: Option<String>,
    pub log_level: String,
    pub lip_sync_chars_per_second: f64,
    pub show_viewer: bool,
    /// 3D ビューの背景色 (要件 F-03-4)。None は既定色。
    ///
    /// 後から足した項目なので default が要る。無いと既存の設定ファイルが
    /// 読めなくなり、利用者の設定が失われる。
    #[serde(default)]
    pub background_color: Option<String>,
    /// マスコット表示か (要件 F-13-1)。
    ///
    /// 復元時にモデルを表示できなければ、この値によらず通常表示で起動する
    /// (F-13-9)。判断は画面側で行う。
    #[serde(default)]
    pub mascot: bool,
    /// マスコット表示の倍率。画面の高さに対するモデルの背丈の割合 (F-13-3)。
    #[serde(default = "default_mascot_scale")]
    pub mascot_scale: f64,
}

/// 画面の高さの半分を既定とする。
fn default_mascot_scale() -> f64 {
    0.5
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            active_character_id: None,
            log_level: "info".to_owned(),
            // 未決事項 U-5。実機で調整する。
            lip_sync_chars_per_second: 10.0,
            show_viewer: true,
            background_color: None,
            mascot: false,
            mascot_scale: default_mascot_scale(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    /// `None` は上限を指定しない。既存の記録は数値のまま読める。
    #[serde(default)]
    pub max_tokens: Option<u32>,
    pub emotion_mode: EmotionMode,
    pub context_budget_tokens: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CameraState {
    pub position: [f64; 3],
    pub target: [f64; 3],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IdleSettings {
    pub blink: bool,
    pub saccade: bool,
    pub look_at: bool,
    pub breath: bool,
    pub spring_bone: bool,
}

impl Default for IdleSettings {
    fn default() -> Self {
        Self {
            blink: true,
            saccade: true,
            look_at: true,
            breath: true,
            spring_bone: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MorphTarget {
    pub morph_name: String,
    pub weight: f64,
}

/// 正規化感情からモーフへの割り当て。
///
/// VRM は恒等マッピングで足りるので通常は None。PMX はモーフ名に標準が
/// 無いためモデルごとに必須になる (ADR-0004)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EmotionMapping {
    pub format: ModelFormat,
    pub model_id: Option<String>,
    pub entries: HashMap<String, Vec<MorphTarget>>,
}

/// 音声合成の設定 (要件 P2)。
///
/// 感情ごとの声の作り方は、正規化感情から接続先固有の値への割り当てとして
/// 持つ。VOICEVOX はスタイルの差し替え、CeVIO は成分の数値になるが、
/// `VoicePreset` が両方を表せる (docs/emotion-protocol.md 第 5 章)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VoiceSettings {
    pub enabled: bool,
    pub kind: TtsKind,
    pub base_url: String,
    /// 既定の話者。VOICEVOX はスタイル id、CeVIO はキャスト名。
    pub speaker: String,
    /// 正規化感情ごとの声の作り方。
    #[serde(default)]
    pub emotion_presets: std::collections::BTreeMap<String, VoicePreset>,
    /// 感情の効き具合 (要件 F-12-3)。0.0 で中立のまま、1.0 で割り当てどおり。
    ///
    /// タグの強さに素直に従うと、文ごとに声色が振れて落ち着かない。ここで
    /// 全体を抑えられるようにする。
    #[serde(default = "default_emotion_strength")]
    pub emotion_strength: f64,
}

fn default_emotion_strength() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CharacterProfile {
    pub id: String,
    pub name: String,
    /// None はモデル未設定 (要件 F-02)
    pub model_path: Option<String>,
    pub model_format: Option<ModelFormat>,
    pub system_prompt: String,
    pub provider_id: String,
    pub camera_preset: Option<CameraState>,
    #[serde(default)]
    pub idle_settings: IdleSettings,
    pub emotion_mapping: Option<EmotionMapping>,
    /// 後から足した項目なので default が要る。無いと既存の記録が読めなくなる。
    #[serde(default)]
    pub voice_settings: Option<VoiceSettings>,
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EmotionSpan {
    pub offset: u32,
    pub emotion: String,
    pub intensity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Message {
    pub role: MessageRole,
    /// 感情タグを除去済みの本文。表示に使う。
    pub content: String,
    /// タグを含む原文。assistant のみ。再開時の表情復元に使う。
    pub raw_content: Option<String>,
    pub emotions: Option<Vec<EmotionSpan>>,
    pub created_at: String,
    /// 生成に使ったモデル。assistant のみ。接続先を切り替えて試し比べたとき、
    /// どれが書いた返答かを後から辿れるようにする。表示のたびに現在の接続先
    /// から作ると、切り替えた後で過去の返答が嘘になるため記録する。
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Conversation {
    pub id: String,
    pub character_id: String,
    pub title: String,
    pub messages: Vec<Message>,
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// 一覧表示用。全会話を読まずに済ませるために本体と分けて持つ。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConversationSummary {
    pub id: String,
    pub character_id: String,
    pub title: String,
    pub updated_at: String,
    pub message_count: u32,
}

impl From<&Conversation> for ConversationSummary {
    fn from(conversation: &Conversation) -> Self {
        Self {
            id: conversation.id.clone(),
            character_id: conversation.character_id.clone(),
            title: conversation.title.clone(),
            updated_at: conversation.updated_at.clone(),
            message_count: conversation.messages.len() as u32,
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;

    #[test]
    fn 設定の既定値() {
        let settings = Settings::default();
        assert_eq!(settings.schema_version, SCHEMA_VERSION);
        assert!(settings.show_viewer);
        assert_eq!(settings.lip_sync_chars_per_second, 10.0);
    }

    #[test]
    fn アイドル挙動は既定で全部有効() {
        let idle = IdleSettings::default();
        assert!(idle.blink && idle.saccade && idle.look_at && idle.breath && idle.spring_bone);
    }

    #[test]
    fn 使用モデルが無い古い記録も読める() {
        // model を足す前に保存された会話を想定する。
        // これが読めないと過去の会話が開けなくなる。
        let json = r#"{"role":"assistant","content":"ごきげんよう","rawContent":null,"emotions":null,"createdAt":"2026-08-29T00:00:00Z"}"#;
        let message: Message = serde_json::from_str(json).unwrap();
        assert_eq!(message.model, None);
    }

    #[test]
    fn フィールド名は_camelCase_で保存される() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        assert!(json.contains("\"activeCharacterId\""));
        assert!(json.contains("\"lipSyncCharsPerSecond\""));
        assert!(json.contains("\"schemaVersion\""));
    }

    #[test]
    fn 版が無い古いレコードも読める() {
        // 移行を楽にするため schemaVersion は既定値で補う
        let json = r#"{"activeCharacterId":null,"logLevel":"info","lipSyncCharsPerSecond":10.0,"showViewer":true}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn マスコットの設定が無い古い記録も読める() {
        // マスコット表示を足す前に保存された設定を想定する。
        // これが読めないと利用者の設定が失われる。
        let json = r#"{"schemaVersion":1,"activeCharacterId":"ch1","logLevel":"info","lipSyncCharsPerSecond":10.0,"showViewer":true,"backgroundColor":null}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert!(!settings.mascot);
        assert_eq!(settings.mascot_scale, 0.5);
    }

    #[test]
    fn 後から足した項目が無くても読める() {
        // 背景色を足す前に保存された設定ファイルを想定する。
        // これが読めないと利用者の設定が失われる。
        let json = r#"{"schemaVersion":1,"activeCharacterId":"ch1","logLevel":"info","lipSyncCharsPerSecond":10.0,"showViewer":true}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.background_color, None);
        assert_eq!(settings.active_character_id.as_deref(), Some("ch1"));
    }

    #[test]
    fn 音声設定が無い古い記録も読める() {
        // 0.4 より前に保存されたキャラクターを想定する
        let json = r#"{"id":"ch1","name":"千奈","modelPath":null,"modelFormat":null,
            "systemPrompt":"","providerId":"p1","cameraPreset":null,
            "emotionMapping":null,"createdAt":"t","updatedAt":"t"}"#;
        let profile: CharacterProfile = serde_json::from_str(json).unwrap();
        assert!(profile.voice_settings.is_none());
        assert!(profile.idle_settings.blink);
    }

    #[test]
    fn 会話から一覧項目を導ける() {
        let conversation = Conversation {
            id: "c1".to_owned(),
            character_id: "ch1".to_owned(),
            title: "はじめての会話".to_owned(),
            messages: vec![Message {
                role: MessageRole::User,
                content: "こんにちは".to_owned(),
                raw_content: None,
                emotions: None,
                created_at: now_rfc3339(),
                model: None,
            }],
            schema_version: SCHEMA_VERSION,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };
        let summary = ConversationSummary::from(&conversation);
        assert_eq!(summary.message_count, 1);
        assert_eq!(summary.title, "はじめての会話");
    }

    #[test]
    fn 感情の範囲を保存できる() {
        let message = Message {
            role: MessageRole::Assistant,
            content: "ごきげんよう".to_owned(),
            raw_content: Some("[happy]ごきげんよう".to_owned()),
            emotions: Some(vec![EmotionSpan {
                offset: 0,
                emotion: "happy".to_owned(),
                intensity: 1.0,
            }]),
            created_at: now_rfc3339(),
            model: Some("llama3.2".to_owned()),
        };
        let json = serde_json::to_string(&message).unwrap();
        let restored: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, message);
    }
}
