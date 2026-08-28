//! OpenAI 互換エンドポイント。
//!
//! Ollama / LM Studio / llama.cpp server / OpenAI 公式をこの 1 アダプタで
//! 吸収する。差異は base URL と API キーの有無に集約される。
//! 仕様: docs/ipc-contract.md 7.1

use serde_json::{json, Value};

use super::decode::{as_u32, classify_error, parse_json};
use super::error::ProviderError;
use super::sse::SseEvent;
use super::types::{ChatRequest, Delta, Role, StopReason, StreamItem, Usage};

fn role_str(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

/// リクエストボディを組み立てる。
///
/// システムプロンプトは `messages` の先頭に `role: "system"` として置く。
/// ここが Anthropic / Gemini との最大の構造差。
pub fn build_body(request: &ChatRequest) -> Value {
    let mut messages: Vec<Value> = Vec::with_capacity(request.messages.len() + 1);
    if let Some(system) = &request.system {
        messages.push(json!({ "role": "system", "content": system }));
    }
    for message in &request.messages {
        messages.push(json!({
            "role": role_str(message.role),
            "content": message.content,
        }));
    }

    let mut body = json!({
        "model": request.model,
        "messages": messages,
        "stream": true,
        "max_tokens": request.max_tokens,
        // 公式 OpenAI はこれが無いと usage を送らない。ローカルの実装は
        // 未知のフィールドを無視するので付けたままでよい。
        "stream_options": { "include_usage": true },
    });

    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = json!(top_p);
    }
    body
}

pub fn decode_event(event: &SseEvent) -> Result<Vec<StreamItem>, ProviderError> {
    let data = event.data.trim();
    if data.is_empty() {
        return Ok(Vec::new());
    }
    if data == "[DONE]" {
        return Ok(vec![StreamItem::End]);
    }

    let value = parse_json(data)?;
    if let Some(error) = value.get("error").filter(|e| !e.is_null()) {
        return Err(classify_error(error, 500));
    }

    let mut items = Vec::new();

    if let Some(choice) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
    {
        if let Some(text) = choice
            .get("delta")
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
        {
            if !text.is_empty() {
                items.push(StreamItem::Delta(Delta::Text {
                    value: text.to_owned(),
                }));
            }
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            items.push(StreamItem::Stop(match reason {
                "length" => StopReason::MaxTokens,
                _ => StopReason::EndTurn,
            }));
        }
    }

    if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
        items.push(StreamItem::Delta(Delta::Usage(Usage {
            input_tokens: as_u32(usage.get("prompt_tokens")),
            output_tokens: as_u32(usage.get("completion_tokens")),
        })));
    }

    Ok(items)
}

/// `GET /v1/models` の応答からモデル一覧を取り出す。
pub fn parse_models(value: &Value) -> Vec<super::types::ModelInfo> {
    value
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(|id| super::types::ModelInfo {
                    id: id.to_owned(),
                    display_name: None,
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::ChatMessage;

    fn request() -> ChatRequest {
        ChatRequest {
            system: Some("あなたは親切な助手です".to_owned()),
            messages: vec![ChatMessage::user("こんにちは")],
            model: "gpt-4o-mini".to_owned(),
            max_tokens: 1024,
            temperature: Some(0.7),
            top_p: None,
        }
    }

    #[test]
    fn システムプロンプトを_messages_の先頭に置く() {
        let body = build_body(&request());
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "あなたは親切な助手です");
        assert_eq!(messages[1]["role"], "user");
    }

    #[test]
    fn システムプロンプトが無ければ足さない() {
        let mut req = request();
        req.system = None;
        let body = build_body(&req);
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn 省略可能なパラメータは指定時のみ入る() {
        let body = build_body(&request());
        assert_eq!(body["temperature"], 0.7);
        assert!(body.get("top_p").is_none());
    }

    #[test]
    fn ストリーミングと_usage_を要求する() {
        let body = build_body(&request());
        assert_eq!(body["stream"], true);
        assert_eq!(body["stream_options"]["include_usage"], true);
    }

    fn event(data: &str) -> SseEvent {
        SseEvent {
            event: None,
            data: data.to_owned(),
        }
    }

    #[test]
    fn テキスト差分を取り出す() {
        let items = decode_event(&event(
            r#"{"choices":[{"delta":{"content":"こんにちは"},"finish_reason":null}]}"#,
        ))
        .unwrap();
        assert_eq!(
            items,
            vec![StreamItem::Delta(Delta::Text {
                value: "こんにちは".to_owned()
            })]
        );
    }

    #[test]
    fn 空の差分は流さない() {
        let items = decode_event(&event(r#"{"choices":[{"delta":{"content":""}}]}"#)).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn 役割だけの最初の差分を無視する() {
        let items =
            decode_event(&event(r#"{"choices":[{"delta":{"role":"assistant"}}]}"#)).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn 停止理由を解釈する() {
        let stop = decode_event(&event(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        ))
        .unwrap();
        assert_eq!(stop, vec![StreamItem::Stop(StopReason::EndTurn)]);

        let length = decode_event(&event(
            r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
        ))
        .unwrap();
        assert_eq!(length, vec![StreamItem::Stop(StopReason::MaxTokens)]);
    }

    #[test]
    fn テキストと停止理由が同時に来ても両方拾う() {
        // 1 イベントが複数の意味を持ちうるため Vec で返している
        let items = decode_event(&event(
            r#"{"choices":[{"delta":{"content":"です"},"finish_reason":"stop"}]}"#,
        ))
        .unwrap();
        assert_eq!(items.len(), 2);
        assert!(matches!(items[0], StreamItem::Delta(Delta::Text { .. })));
        assert_eq!(items[1], StreamItem::Stop(StopReason::EndTurn));
    }

    #[test]
    fn トークン数を取り出す() {
        let items = decode_event(&event(
            r#"{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34}}"#,
        ))
        .unwrap();
        assert_eq!(
            items,
            vec![StreamItem::Delta(Delta::Usage(Usage {
                input_tokens: 12,
                output_tokens: 34
            }))]
        );
    }

    #[test]
    fn usage_が_null_なら無視する() {
        let items = decode_event(&event(r#"{"choices":[{"delta":{}}],"usage":null}"#)).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn 終端記号を認識する() {
        assert_eq!(
            decode_event(&event("[DONE]")).unwrap(),
            vec![StreamItem::End]
        );
    }

    #[test]
    fn エラー応答を分類する() {
        let error = decode_event(&event(
            r#"{"error":{"code":"context_length_exceeded","message":"too long"}}"#,
        ));
        assert_eq!(error.unwrap_err(), ProviderError::ContextTooLong);
    }

    #[test]
    fn 壊れた_json_は形式エラーになる() {
        let result = decode_event(&event("{not json"));
        assert!(matches!(result, Err(ProviderError::Protocol(_))));
    }

    #[test]
    fn モデル一覧を取り出す() {
        let value: Value = serde_json::from_str(
            r#"{"data":[{"id":"llama3.2"},{"id":"qwen2.5"},{"broken":true}]}"#,
        )
        .unwrap();
        let models = parse_models(&value);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "llama3.2");
    }

    #[test]
    fn モデル一覧が無ければ空を返す() {
        assert!(parse_models(&json!({})).is_empty());
    }
}
