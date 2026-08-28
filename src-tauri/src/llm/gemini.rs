//! Google Gemini API。
//!
//! 仕様: docs/ipc-contract.md 7.3
//!
//! **鍵はクエリではなく `x-goog-api-key` ヘッダで送る。** クエリに載せると
//! reqwest のエラー表示やログに URL 経由で漏れる (ADR-0011)。

use serde_json::{json, Value};

use super::decode::{as_u32, classify_error, parse_json};
use super::error::ProviderError;
use super::sse::SseEvent;
use super::types::{ChatRequest, Delta, Role, StopReason, StreamItem, Usage};

pub const API_KEY_HEADER: &str = "x-goog-api-key";

/// Gemini のロール名は `assistant` ではなく `model`。
fn role_str(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Assistant => "model",
    }
}

pub fn build_body(request: &ChatRequest) -> Value {
    let contents: Vec<Value> = request
        .messages
        .iter()
        .map(|message| {
            json!({
                "role": role_str(message.role),
                "parts": [{ "text": message.content }],
            })
        })
        .collect();

    let mut generation_config = json!({ "maxOutputTokens": request.max_tokens });
    if let Some(temperature) = request.temperature {
        generation_config["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        generation_config["topP"] = json!(top_p);
    }

    let mut body = json!({
        "contents": contents,
        "generationConfig": generation_config,
    });

    if let Some(system) = &request.system {
        body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
    }
    body
}

/// ストリーミング用のパス。モデル名を含むため呼び出し側で組み立てる。
pub fn stream_path(model: &str) -> String {
    format!("v1beta/models/{model}:streamGenerateContent?alt=sse")
}

fn stop_reason_of(raw: &str) -> StopReason {
    match raw {
        "MAX_TOKENS" => StopReason::MaxTokens,
        _ => StopReason::EndTurn,
    }
}

pub fn decode_event(event: &SseEvent) -> Result<Vec<StreamItem>, ProviderError> {
    let data = event.data.trim();
    if data.is_empty() {
        return Ok(Vec::new());
    }

    let value = parse_json(data)?;
    if let Some(error) = value.get("error").filter(|error| !error.is_null()) {
        let status = as_u32(error.get("code")) as u16;
        return Err(classify_error(
            error,
            if status == 0 { 500 } else { status },
        ));
    }

    let mut items = Vec::new();

    if let Some(candidate) = value
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|candidates| candidates.first())
    {
        let text: String = candidate
            .get("content")
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    // thought: true は思考の中身。本文に混ぜてはならない。
                    .filter(|part| part.get("thought").and_then(Value::as_bool) != Some(true))
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .collect()
            })
            .unwrap_or_default();

        if !text.is_empty() {
            items.push(StreamItem::Delta(Delta::Text { value: text }));
        }

        if let Some(reason) = candidate.get("finishReason").and_then(Value::as_str) {
            items.push(StreamItem::Stop(stop_reason_of(reason)));
        }
    }

    if let Some(usage) = value.get("usageMetadata") {
        items.push(StreamItem::Delta(Delta::Usage(Usage {
            input_tokens: as_u32(usage.get("promptTokenCount")),
            output_tokens: as_u32(usage.get("candidatesTokenCount")),
        })));
    }

    Ok(items)
}

/// `GET /v1beta/models` の応答からモデル一覧を取り出す。
pub fn parse_models(value: &Value) -> Vec<super::types::ModelInfo> {
    value
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name").and_then(Value::as_str)?;
                    // "models/gemini-2.5-pro" の接頭辞を落とす
                    let id = name.strip_prefix("models/").unwrap_or(name);
                    Some(super::types::ModelInfo {
                        id: id.to_owned(),
                        display_name: item
                            .get("displayName")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use crate::llm::types::ChatMessage;

    fn request() -> ChatRequest {
        ChatRequest {
            system: Some("あなたは倉本千奈です".to_owned()),
            messages: vec![
                ChatMessage::user("こんにちは"),
                ChatMessage::assistant("ごきげんよう"),
            ],
            model: "gemini-2.5-flash".to_owned(),
            max_tokens: 1024,
            temperature: Some(0.5),
            top_p: None,
        }
    }

    fn event(data: &str) -> SseEvent {
        SseEvent {
            event: None,
            data: data.to_owned(),
        }
    }

    #[test]
    fn アシスタントのロール名は_model_になる() {
        let body = build_body(&request());
        let contents = body["contents"].as_array().unwrap();
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[1]["role"], "model");
    }

    #[test]
    fn システムプロンプトを_systemInstruction_に置く() {
        let body = build_body(&request());
        assert_eq!(
            body["systemInstruction"]["parts"][0]["text"],
            "あなたは倉本千奈です"
        );
        // contents 側には混ざらない
        assert_eq!(body["contents"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn 生成設定は_generationConfig_にまとまる() {
        let body = build_body(&request());
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 1024);
        assert_eq!(body["generationConfig"]["temperature"], 0.5);
        assert!(body["generationConfig"].get("topP").is_none());
    }

    #[test]
    fn ストリーミングのパスに_alt_sse_が付く() {
        let path = stream_path("gemini-2.5-flash");
        assert!(path.contains("gemini-2.5-flash:streamGenerateContent"));
        assert!(path.contains("alt=sse"));
        // 鍵はヘッダで送るのでパスには現れない
        assert!(!path.contains("key="));
    }

    #[test]
    fn テキスト差分を取り出す() {
        let items = decode_event(&event(
            r#"{"candidates":[{"content":{"parts":[{"text":"ごきげんよう"}],"role":"model"}}]}"#,
        ))
        .unwrap();
        assert_eq!(
            items,
            vec![StreamItem::Delta(Delta::Text {
                value: "ごきげんよう".to_owned()
            })]
        );
    }

    #[test]
    fn 複数のパートを連結する() {
        let items = decode_event(&event(
            r#"{"candidates":[{"content":{"parts":[{"text":"ごきげん"},{"text":"よう"}]}}]}"#,
        ))
        .unwrap();
        assert_eq!(
            items,
            vec![StreamItem::Delta(Delta::Text {
                value: "ごきげんよう".to_owned()
            })]
        );
    }

    #[test]
    fn 思考のパートを本文に混ぜない() {
        let items = decode_event(&event(
            r#"{"candidates":[{"content":{"parts":[{"text":"内部の考え","thought":true},{"text":"本文"}]}}]}"#,
        ))
        .unwrap();
        assert_eq!(
            items,
            vec![StreamItem::Delta(Delta::Text {
                value: "本文".to_owned()
            })]
        );
    }

    #[test]
    fn 停止理由を解釈する() {
        let stop = decode_event(&event(
            r#"{"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}"#,
        ))
        .unwrap();
        assert_eq!(stop, vec![StreamItem::Stop(StopReason::EndTurn)]);

        let length = decode_event(&event(
            r#"{"candidates":[{"content":{"parts":[]},"finishReason":"MAX_TOKENS"}]}"#,
        ))
        .unwrap();
        assert_eq!(length, vec![StreamItem::Stop(StopReason::MaxTokens)]);
    }

    #[test]
    fn トークン数を取り出す() {
        let items = decode_event(&event(
            r#"{"candidates":[],"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":12}}"#,
        ))
        .unwrap();
        assert_eq!(
            items,
            vec![StreamItem::Delta(Delta::Usage(Usage {
                input_tokens: 30,
                output_tokens: 12
            }))]
        );
    }

    #[test]
    fn エラー応答を分類する() {
        let result = decode_event(&event(
            r#"{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}"#,
        ));
        assert_eq!(
            result.unwrap_err(),
            ProviderError::RateLimit { retry_after: None }
        );
    }

    #[test]
    fn モデル一覧から接頭辞を落とす() {
        let value: Value = serde_json::from_str(
            r#"{"models":[{"name":"models/gemini-2.5-pro","displayName":"Gemini 2.5 Pro"}]}"#,
        )
        .unwrap();
        let models = parse_models(&value);
        assert_eq!(models[0].id, "gemini-2.5-pro");
        assert_eq!(models[0].display_name.as_deref(), Some("Gemini 2.5 Pro"));
    }
}
