//! Anthropic Messages API。
//!
//! Rust 向けの公式 SDK が無いため reqwest による raw HTTP で実装する。
//! 仕様: docs/ipc-contract.md 7.2

use serde_json::{json, Value};

use super::decode::{as_u32, classify_error, parse_json};
use super::error::ProviderError;
use super::sse::SseEvent;
use super::types::{ChatRequest, Delta, Role, StopReason, StreamItem, Usage};

pub const API_VERSION: &str = "2023-06-01";

fn role_str(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

/// リクエストボディを組み立てる。
///
/// **システムプロンプトは `messages` に含めず、トップレベルの `system` に置く。**
/// ここが OpenAI 互換との最大の構造差。`max_tokens` は必須。
pub fn build_body(request: &ChatRequest) -> Value {
    let messages: Vec<Value> = request
        .messages
        .iter()
        .map(|message| {
            json!({
                "role": role_str(message.role),
                "content": message.content,
            })
        })
        .collect();

    let mut body = json!({
        "model": request.model,
        "messages": messages,
        "stream": true,
        "max_tokens": request.max_tokens,
    });

    if let Some(system) = &request.system {
        body["system"] = json!(system);
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = json!(top_p);
    }
    body
}

fn stop_reason_of(raw: &str) -> StopReason {
    match raw {
        "max_tokens" => StopReason::MaxTokens,
        _ => StopReason::EndTurn,
    }
}

pub fn decode_event(event: &SseEvent) -> Result<Vec<StreamItem>, ProviderError> {
    let data = event.data.trim();
    if data.is_empty() {
        return Ok(Vec::new());
    }

    let value = parse_json(data)?;
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    match kind {
        "error" => {
            let error = value.get("error").cloned().unwrap_or(Value::Null);
            Err(classify_error(&error, 500))
        }

        "message_start" => {
            let usage = value
                .get("message")
                .and_then(|message| message.get("usage"));
            Ok(vec![StreamItem::Delta(Delta::Usage(Usage {
                input_tokens: as_u32(usage.and_then(|u| u.get("input_tokens"))),
                output_tokens: as_u32(usage.and_then(|u| u.get("output_tokens"))),
            }))])
        }

        "content_block_delta" => {
            let delta = value.get("delta");
            let delta_kind = delta
                .and_then(|delta| delta.get("type"))
                .and_then(Value::as_str)
                .unwrap_or_default();

            // thinking_delta は思考の中身。本文には混ぜず、別の種別で流す。
            if delta_kind == "thinking_delta" {
                let thought = delta
                    .and_then(|delta| delta.get("thinking"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if thought.is_empty() {
                    return Ok(Vec::new());
                }
                return Ok(vec![StreamItem::Delta(Delta::Reasoning {
                    value: thought.to_owned(),
                })]);
            }

            if delta_kind != "text_delta" {
                return Ok(Vec::new());
            }

            let text = delta
                .and_then(|delta| delta.get("text"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if text.is_empty() {
                return Ok(Vec::new());
            }
            Ok(vec![StreamItem::Delta(Delta::Text {
                value: text.to_owned(),
            })])
        }

        "message_delta" => {
            let mut items = Vec::new();
            if let Some(reason) = value
                .get("delta")
                .and_then(|delta| delta.get("stop_reason"))
                .and_then(Value::as_str)
            {
                items.push(StreamItem::Stop(stop_reason_of(reason)));
            }
            if let Some(usage) = value.get("usage") {
                items.push(StreamItem::Delta(Delta::Usage(Usage {
                    input_tokens: as_u32(usage.get("input_tokens")),
                    output_tokens: as_u32(usage.get("output_tokens")),
                })));
            }
            Ok(items)
        }

        "message_stop" => Ok(vec![StreamItem::End]),

        // ping / content_block_start / content_block_stop など
        _ => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::ChatMessage;

    fn request() -> ChatRequest {
        ChatRequest {
            system: Some("あなたは倉本千奈です".to_owned()),
            messages: vec![
                ChatMessage::user("こんにちは"),
                ChatMessage::assistant("ごきげんよう"),
                ChatMessage::user("お元気ですか"),
            ],
            model: "claude-opus-5".to_owned(),
            max_tokens: 2048,
            temperature: None,
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
    fn システムプロンプトをトップレベルに置く() {
        let body = build_body(&request());
        assert_eq!(body["system"], "あなたは倉本千奈です");
    }

    #[test]
    fn messages_にシステムを混ぜない() {
        let body = build_body(&request());
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        for message in messages {
            assert_ne!(message["role"], "system");
        }
    }

    #[test]
    fn max_tokens_は必須なので常に入る() {
        let body = build_body(&request());
        assert_eq!(body["max_tokens"], 2048);
    }

    #[test]
    fn システムが無ければフィールドごと出さない() {
        let mut req = request();
        req.system = None;
        assert!(build_body(&req).get("system").is_none());
    }

    #[test]
    fn テキスト差分を取り出す() {
        let items = decode_event(&event(
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ごきげんよう"}}"#,
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
    fn 思考の差分を本文に混ぜない() {
        let items = decode_event(&event(
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"内部の考え"}}"#,
        ))
        .unwrap();
        assert_eq!(
            items,
            vec![StreamItem::Delta(Delta::Reasoning {
                value: "内部の考え".to_owned()
            })],
            "思考は本文ではなく別種別で流す"
        );
    }

    #[test]
    fn message_start_で入力トークンを拾う() {
        let items = decode_event(&event(
            r#"{"type":"message_start","message":{"usage":{"input_tokens":120,"output_tokens":0}}}"#,
        ))
        .unwrap();
        assert_eq!(
            items,
            vec![StreamItem::Delta(Delta::Usage(Usage {
                input_tokens: 120,
                output_tokens: 0
            }))]
        );
    }

    #[test]
    fn message_delta_で停止理由と出力トークンを拾う() {
        let items = decode_event(&event(
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":45}}"#,
        ))
        .unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], StreamItem::Stop(StopReason::EndTurn));
        assert_eq!(
            items[1],
            StreamItem::Delta(Delta::Usage(Usage {
                input_tokens: 0,
                output_tokens: 45
            }))
        );
    }

    #[test]
    fn 上限到達を区別する() {
        let items = decode_event(&event(
            r#"{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}"#,
        ))
        .unwrap();
        assert_eq!(items[0], StreamItem::Stop(StopReason::MaxTokens));
    }

    #[test]
    fn message_stop_で終端する() {
        let items = decode_event(&event(r#"{"type":"message_stop"}"#)).unwrap();
        assert_eq!(items, vec![StreamItem::End]);
    }

    #[test]
    fn ping_や_block_境界を無視する() {
        for data in [
            r#"{"type":"ping"}"#,
            r#"{"type":"content_block_start","index":0}"#,
            r#"{"type":"content_block_stop","index":0}"#,
        ] {
            assert!(decode_event(&event(data)).unwrap().is_empty());
        }
    }

    #[test]
    fn エラーイベントを分類する() {
        let result = decode_event(&event(
            r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#,
        ));
        assert_eq!(result.unwrap_err(), ProviderError::Auth);
    }
}
