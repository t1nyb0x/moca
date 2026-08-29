//! プロバイダ非依存の共通表現。
//!
//! 3 プロバイダの差異（システムプロンプトの置き場所、ロール名、終了理由、
//! usage のフィールド名）はアダプタ内部で吸収し、ここには持ち込まない。
//! 差異の一覧は docs/ipc-contract.md 7.4。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 会話上の役割。system はメッセージ列に含めない。
///
/// Anthropic はトップレベルの `system`、Gemini は `systemInstruction` と、
/// 置き場所がプロバイダごとに違うため、共通表現では別扱いにする。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

impl ChatMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChatRequest {
    /// 人格定義と感情プロトコルを連結したもの。配置はアダプタが決める。
    pub system: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub model: String,
    /// 生成量の上限。`None` は指定しない（モデルが自然に終わるまで）。
    ///
    /// Anthropic だけは必須なのでアダプタ側で既定値を補う。OpenAI 互換と
    /// Gemini では省略でき、省略したほうがよい。推論モデルは思考にも
    /// トークンを使うため、蓋をすると本文が出ないまま打ち切られる。
    pub max_tokens: Option<u32>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// ストリーム中にフロントへ流す差分。
///
/// エラーは Channel に流さず、コマンドの戻り値でのみ表現する。
/// 経路が 2 本あるとフロント側の状態管理が壊れる (docs/ipc-contract.md 2.6)。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Delta {
    Text {
        value: String,
    },
    /// 推論モデルの思考。本文ではないので会話には残さないが、進行中で
    /// あることを伝えるために流す。これを捨てると、思考の長いモデルでは
    /// 何も起きていないように見える。
    Reasoning {
        value: String,
    },
    Usage(Usage),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    /// 中断はエラーではない。正常終了として扱う。
    Cancelled,
}

/// ストリーム 1 イベントの解釈結果。
///
/// 停止理由の判明とストリーム終端を分けているのが要点。OpenAI 互換では
/// `finish_reason` の後に usage が届くため、停止理由で打ち切ると
/// トークン数を取りこぼす。
#[derive(Debug, Clone, PartialEq)]
pub enum StreamItem {
    Delta(Delta),
    /// 停止理由が判明した。ストリームはまだ続きうる。
    Stop(StopReason),
    /// ストリーム終端。
    End,
    Ignore,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatResult {
    pub stop_reason: StopReason,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: Option<String>,
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;

    #[test]
    fn ロールは_camelCase_で表現される() {
        assert_eq!(
            serde_json::to_string(&Role::Assistant).unwrap(),
            "\"assistant\""
        );
    }

    #[test]
    fn delta_は_kind_タグ付きで直列化される() {
        let json = serde_json::to_string(&Delta::Text {
            value: "こんにちは".to_owned(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"text","value":"こんにちは"}"#);
    }

    #[test]
    fn 思考の差分は本文と区別される() {
        let json = serde_json::to_string(&Delta::Reasoning {
            value: "考え中".to_owned(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"reasoning","value":"考え中"}"#);
    }

    #[test]
    fn usage_の差分も_kind_タグを持つ() {
        let json = serde_json::to_string(&Delta::Usage(Usage {
            input_tokens: 12,
            output_tokens: 34,
        }))
        .unwrap();
        assert_eq!(
            json,
            r#"{"kind":"usage","inputTokens":12,"outputTokens":34}"#
        );
    }

    #[test]
    fn 停止理由は_camelCase_で表現される() {
        assert_eq!(
            serde_json::to_string(&StopReason::EndTurn).unwrap(),
            "\"endTurn\""
        );
        assert_eq!(
            serde_json::to_string(&StopReason::Cancelled).unwrap(),
            "\"cancelled\""
        );
    }
}
