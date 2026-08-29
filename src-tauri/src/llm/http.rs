//! HTTP 層。
//!
//! 3 プロバイダとも「POST してSSE を駆動する」流れは同一なので、
//! URL・ヘッダ・ボディ・デコーダだけを種別で切り替える 1 実装にまとめる。

use std::time::Duration;

use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, RETRY_AFTER};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use crate::secret::Secret;

use super::error::ProviderError;
use super::stream::drive;
use super::types::{ChatRequest, ChatResult, Delta, ModelInfo};
use super::{anthropic, gemini, openai};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ProviderKind {
    /// Ollama / LM Studio / llama.cpp / OpenAI 公式
    OpenaiCompatible,
    Anthropic,
    Gemini,
}

#[async_trait]
pub trait ChatProvider: Send + Sync {
    async fn stream_chat(
        &self,
        request: ChatRequest,
        cancel: CancellationToken,
        sink: mpsc::Sender<Delta>,
    ) -> Result<ChatResult, ProviderError>;

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError>;

    async fn health_check(&self) -> Result<(), ProviderError>;
}

pub struct HttpProvider {
    kind: ProviderKind,
    base_url: String,
    api_key: Option<Secret>,
    client: reqwest::Client,
}

impl std::fmt::Debug for HttpProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // api_key は Secret なので出しても安全だが、明示しておく
        f.debug_struct("HttpProvider")
            .field("kind", &self.kind)
            .field("base_url", &self.base_url)
            .field("api_key", &self.api_key)
            .finish()
    }
}

impl HttpProvider {
    pub fn new(
        kind: ProviderKind,
        base_url: impl Into<String>,
        api_key: Option<Secret>,
    ) -> Result<Self, ProviderError> {
        let client = reqwest::Client::builder()
            // ストリーミングは長時間続くので全体のタイムアウトは設けない。
            // 接続確立だけを見張る。
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|err| ProviderError::from_reqwest(&err))?;

        Ok(Self {
            kind,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            api_key,
            client,
        })
    }

    fn chat_url(&self, model: &str) -> String {
        match self.kind {
            ProviderKind::OpenaiCompatible => {
                format!("{}/v1/chat/completions", self.base_url)
            }
            ProviderKind::Anthropic => format!("{}/v1/messages", self.base_url),
            ProviderKind::Gemini => {
                format!("{}/{}", self.base_url, gemini::stream_path(model))
            }
        }
    }

    fn models_url(&self) -> String {
        match self.kind {
            ProviderKind::OpenaiCompatible | ProviderKind::Anthropic => {
                format!("{}/v1/models", self.base_url)
            }
            ProviderKind::Gemini => format!("{}/v1beta/models", self.base_url),
        }
    }

    /// 認証ヘッダを組み立てる。
    ///
    /// `Secret::expose` を呼んでよいのはここだけ。増えていないかを
    /// grep で監査する (ADR-0011)。
    fn headers(&self) -> Result<HeaderMap, ProviderError> {
        let mut headers = HeaderMap::new();
        let Some(key) = self.api_key.as_ref().filter(|key| !key.is_empty()) else {
            // ローカル LLM は鍵を要求しない
            return Ok(headers);
        };

        let invalid = || {
            ProviderError::Protocol("API キーにヘッダへ入れられない文字が含まれています".to_owned())
        };

        match self.kind {
            ProviderKind::OpenaiCompatible => {
                let mut value = HeaderValue::from_str(&format!("Bearer {}", key.expose()))
                    .map_err(|_| invalid())?;
                value.set_sensitive(true);
                headers.insert(reqwest::header::AUTHORIZATION, value);
            }
            ProviderKind::Anthropic => {
                let mut value = HeaderValue::from_str(key.expose()).map_err(|_| invalid())?;
                value.set_sensitive(true);
                headers.insert(HeaderName::from_static("x-api-key"), value);
                headers.insert(
                    HeaderName::from_static("anthropic-version"),
                    HeaderValue::from_static(anthropic::API_VERSION),
                );
            }
            ProviderKind::Gemini => {
                let mut value = HeaderValue::from_str(key.expose()).map_err(|_| invalid())?;
                value.set_sensitive(true);
                headers.insert(HeaderName::from_static(gemini::API_KEY_HEADER), value);
            }
        }
        Ok(headers)
    }

    fn build_body(&self, request: &ChatRequest) -> Value {
        match self.kind {
            ProviderKind::OpenaiCompatible => openai::build_body(request),
            ProviderKind::Anthropic => anthropic::build_body(request),
            ProviderKind::Gemini => gemini::build_body(request),
        }
    }

    /// 2xx でなければ本文を読んで分類する。本文はそのまま外へ出さない。
    async fn check_status(response: reqwest::Response) -> Result<reqwest::Response, ProviderError> {
        if response.status().is_success() {
            return Ok(response);
        }

        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_secs);

        let body = response.text().await.unwrap_or_default();
        let parsed: Option<Value> = serde_json::from_str(&body).ok();
        let error = parsed
            .as_ref()
            .and_then(|value| value.get("error"))
            .cloned();

        if let Some(error) = error {
            let mut classified = super::decode::classify_error(&error, status);
            // ステータス由来の情報を優先して補う
            if status == 429 {
                classified = ProviderError::RateLimit { retry_after };
            }
            return Err(classified);
        }

        Err(ProviderError::from_status(status, retry_after))
    }
}

#[async_trait]
impl ChatProvider for HttpProvider {
    async fn stream_chat(
        &self,
        request: ChatRequest,
        cancel: CancellationToken,
        sink: mpsc::Sender<Delta>,
    ) -> Result<ChatResult, ProviderError> {
        let url = self.chat_url(&request.model);
        let body = self.build_body(&request);

        tracing::debug!(
            target: "moca::llm",
            kind = ?self.kind,
            model = %request.model,
            messages = request.messages.len(),
            "チャットを開始する"
        );

        let response = self
            .client
            .post(&url)
            .headers(self.headers()?)
            .json(&body)
            .send()
            .await
            .map_err(|err| ProviderError::from_reqwest(&err))?;

        let response = Self::check_status(response).await?;
        let bytes = response.bytes_stream();

        match self.kind {
            ProviderKind::OpenaiCompatible => {
                drive(Box::pin(bytes), cancel, sink, openai::decode_event).await
            }
            ProviderKind::Anthropic => {
                drive(Box::pin(bytes), cancel, sink, anthropic::decode_event).await
            }
            ProviderKind::Gemini => {
                drive(Box::pin(bytes), cancel, sink, gemini::decode_event).await
            }
        }
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let response = self
            .client
            .get(self.models_url())
            .headers(self.headers()?)
            .send()
            .await
            .map_err(|err| ProviderError::from_reqwest(&err))?;

        let response = Self::check_status(response).await?;
        let value: Value = response
            .json()
            .await
            .map_err(|err| ProviderError::from_reqwest(&err))?;

        Ok(match self.kind {
            ProviderKind::Gemini => gemini::parse_models(&value),
            _ => openai::parse_models(&value),
        })
    }

    async fn health_check(&self) -> Result<(), ProviderError> {
        self.list_models().await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::{ChatMessage, StopReason, Usage};
    use wiremock::matchers::{header, header_exists, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn request() -> ChatRequest {
        ChatRequest {
            system: Some("あなたは倉本千奈です".to_owned()),
            messages: vec![ChatMessage::user("こんにちは")],
            model: "test-model".to_owned(),
            max_tokens: Some(256),
            temperature: None,
            top_p: None,
        }
    }

    fn sse(body: &str) -> ResponseTemplate {
        ResponseTemplate::new(200)
            .insert_header("content-type", "text/event-stream")
            .set_body_string(body.to_owned())
    }

    async fn collect(
        provider: &HttpProvider,
        cancel: CancellationToken,
    ) -> (Vec<Delta>, Result<ChatResult, ProviderError>) {
        let (tx, mut rx) = mpsc::channel(256);
        let result = provider.stream_chat(request(), cancel, tx).await;
        let mut deltas = Vec::new();
        while let Ok(delta) = rx.try_recv() {
            deltas.push(delta);
        }
        (deltas, result)
    }

    fn text_of(deltas: &[Delta]) -> String {
        deltas
            .iter()
            .filter_map(|delta| match delta {
                Delta::Text { value } => Some(value.as_str()),
                Delta::Reasoning { .. } | Delta::Usage(_) => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn openai互換のストリームを読み切れる() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(header("authorization", "Bearer test-key"))
            .respond_with(sse(concat!(
                "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"ごきげん\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"よう\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
                "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":4}}\n\n",
                "data: [DONE]\n\n",
            )))
            .mount(&server)
            .await;

        let provider = HttpProvider::new(
            ProviderKind::OpenaiCompatible,
            server.uri(),
            Some(Secret::new("test-key")),
        )
        .unwrap();

        let (deltas, result) = collect(&provider, CancellationToken::new()).await;
        assert_eq!(text_of(&deltas), "ごきげんよう");

        let result = result.unwrap();
        assert_eq!(result.stop_reason, StopReason::EndTurn);
        assert_eq!(
            result.usage,
            Some(Usage {
                input_tokens: 10,
                output_tokens: 4
            })
        );
    }

    /// Ollama の推論モデルが実際に返す形。content は空で reasoning に思考が入る。
    #[tokio::test]
    async fn 推論モデルの思考を本文と分けて流す() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(sse(concat!(
                "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"\",\"reasoning\":\"考えて\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"\",\"reasoning\":\"います\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"ごきげんよう\"}}]}\n\n",
                "data: [DONE]\n\n",
            )))
            .mount(&server)
            .await;

        let provider =
            HttpProvider::new(ProviderKind::OpenaiCompatible, server.uri(), None).unwrap();
        let (deltas, result) = collect(&provider, CancellationToken::new()).await;

        assert_eq!(text_of(&deltas), "ごきげんよう", "思考が本文へ漏れている");

        let thinking: String = deltas
            .iter()
            .filter_map(|delta| match delta {
                Delta::Reasoning { value } => Some(value.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(thinking, "考えています");
        assert!(result.is_ok());
    }

    /// 思考だけで上限に達し、本文が 1 文字も出ない場合。
    #[tokio::test]
    async fn 思考だけで打ち切られた場合も正常終了する() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(sse(concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"\",\"reasoning\":\"延々と\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n",
                "data: [DONE]\n\n",
            )))
            .mount(&server)
            .await;

        let provider =
            HttpProvider::new(ProviderKind::OpenaiCompatible, server.uri(), None).unwrap();
        let (deltas, result) = collect(&provider, CancellationToken::new()).await;

        assert_eq!(text_of(&deltas), "");
        assert_eq!(result.unwrap().stop_reason, StopReason::MaxTokens);
    }

    #[tokio::test]
    async fn 鍵が無ければ認証ヘッダを付けない() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(sse("data: [DONE]\n\n"))
            .mount(&server)
            .await;

        let provider =
            HttpProvider::new(ProviderKind::OpenaiCompatible, server.uri(), None).unwrap();
        let (_, result) = collect(&provider, CancellationToken::new()).await;
        assert!(result.is_ok());

        let requests = server.received_requests().await.unwrap();
        assert!(requests[0].headers.get("authorization").is_none());
    }

    #[tokio::test]
    async fn anthropicのストリームを読み切れる() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(header("x-api-key", "test-key"))
            .and(header("anthropic-version", anthropic::API_VERSION))
            .respond_with(sse(concat!(
                "event: message_start\n",
                "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":120,\"output_tokens\":0}}}\n\n",
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"ごきげんよう\"}}\n\n",
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"内緒\"}}\n\n",
                "event: message_delta\n",
                "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":45}}\n\n",
                "event: message_stop\n",
                "data: {\"type\":\"message_stop\"}\n\n",
            )))
            .mount(&server)
            .await;

        let provider = HttpProvider::new(
            ProviderKind::Anthropic,
            server.uri(),
            Some(Secret::new("test-key")),
        )
        .unwrap();

        let (deltas, result) = collect(&provider, CancellationToken::new()).await;
        assert_eq!(text_of(&deltas), "ごきげんよう", "思考が本文へ漏れている");

        // 入力と出力が別イベントで届いても両方揃う
        assert_eq!(
            result.unwrap().usage,
            Some(Usage {
                input_tokens: 120,
                output_tokens: 45
            })
        );
    }

    #[tokio::test]
    async fn geminiのストリームを読み切れる() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1beta/models/test-model:streamGenerateContent"))
            .and(query_param("alt", "sse"))
            .and(header(gemini::API_KEY_HEADER, "test-key"))
            .respond_with(sse(concat!(
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ごきげん\"}]}}]}\n\n",
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"よう\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":30,\"candidatesTokenCount\":12}}\n\n",
            )))
            .mount(&server)
            .await;

        let provider = HttpProvider::new(
            ProviderKind::Gemini,
            server.uri(),
            Some(Secret::new("test-key")),
        )
        .unwrap();

        let (deltas, result) = collect(&provider, CancellationToken::new()).await;
        assert_eq!(text_of(&deltas), "ごきげんよう");
        assert_eq!(result.unwrap().stop_reason, StopReason::EndTurn);
    }

    #[tokio::test]
    async fn geminiは鍵をクエリに載せない() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(header_exists(gemini::API_KEY_HEADER))
            .respond_with(sse("data: {\"candidates\":[]}\n\n"))
            .mount(&server)
            .await;

        let provider = HttpProvider::new(
            ProviderKind::Gemini,
            server.uri(),
            Some(Secret::new("super-secret")),
        )
        .unwrap();
        let _ = collect(&provider, CancellationToken::new()).await;

        let requests = server.received_requests().await.unwrap();
        let url = requests[0].url.to_string();
        assert!(!url.contains("super-secret"), "URL に鍵が載っている: {url}");
    }

    #[tokio::test]
    async fn 認証失敗を分類する() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401).set_body_string(
                r#"{"error":{"type":"authentication_error","message":"invalid key"}}"#,
            ))
            .mount(&server)
            .await;

        let provider = HttpProvider::new(
            ProviderKind::Anthropic,
            server.uri(),
            Some(Secret::new("bad")),
        )
        .unwrap();
        let (_, result) = collect(&provider, CancellationToken::new()).await;
        assert_eq!(result.unwrap_err(), ProviderError::Auth);
    }

    #[tokio::test]
    async fn レート制限で待ち時間を拾う() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(429)
                    .insert_header("retry-after", "30")
                    .set_body_string(r#"{"error":{"type":"rate_limit_error"}}"#),
            )
            .mount(&server)
            .await;

        let provider =
            HttpProvider::new(ProviderKind::OpenaiCompatible, server.uri(), None).unwrap();
        let (_, result) = collect(&provider, CancellationToken::new()).await;
        assert_eq!(
            result.unwrap_err(),
            ProviderError::RateLimit {
                retry_after: Some(Duration::from_secs(30))
            }
        );
    }

    #[tokio::test]
    async fn サーバーエラーを分類する() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(503).set_body_string("upstream down"))
            .mount(&server)
            .await;

        let provider =
            HttpProvider::new(ProviderKind::OpenaiCompatible, server.uri(), None).unwrap();
        let (_, result) = collect(&provider, CancellationToken::new()).await;
        match result.unwrap_err() {
            ProviderError::Server { status, message } => {
                assert_eq!(status, 503);
                assert!(!message.contains("upstream down"), "生の本文が漏れている");
            }
            other => panic!("想定外: {other:?}"),
        }
    }

    #[tokio::test]
    async fn 接続できなければネットワークエラーになる() {
        // 起動していないポートを指す。ローカル LLM 未起動の再現。
        let provider =
            HttpProvider::new(ProviderKind::OpenaiCompatible, "http://127.0.0.1:1", None).unwrap();
        let (_, result) = collect(&provider, CancellationToken::new()).await;
        assert!(matches!(result.unwrap_err(), ProviderError::Network(_)));
    }

    #[tokio::test]
    async fn 中断すると正常終了として返る() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(sse(
                "data: {\"choices\":[{\"delta\":{\"content\":\"あ\"}}]}\n\n",
            ))
            .mount(&server)
            .await;

        let provider =
            HttpProvider::new(ProviderKind::OpenaiCompatible, server.uri(), None).unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();

        let (_, result) = collect(&provider, cancel).await;
        assert_eq!(result.unwrap().stop_reason, StopReason::Cancelled);
    }

    #[tokio::test]
    async fn モデル一覧を取得できる() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"data":[{"id":"llama3.2"},{"id":"qwen2.5"}]}"#),
            )
            .mount(&server)
            .await;

        let provider =
            HttpProvider::new(ProviderKind::OpenaiCompatible, server.uri(), None).unwrap();
        let models = provider.list_models().await.unwrap();
        assert_eq!(models.len(), 2);
        assert!(provider.health_check().await.is_ok());
    }

    #[tokio::test]
    async fn base_url_の末尾のスラッシュを吸収する() {
        let provider = HttpProvider::new(
            ProviderKind::OpenaiCompatible,
            "http://localhost:11434/",
            None,
        )
        .unwrap();
        assert_eq!(
            provider.chat_url("x"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn debug_出力に鍵が現れない() {
        let provider = HttpProvider::new(
            ProviderKind::Anthropic,
            "http://example.test",
            Some(Secret::new("sk-ant-leak-me")),
        )
        .unwrap();
        let rendered = format!("{provider:?}");
        assert!(
            !rendered.contains("sk-ant-leak-me"),
            "実際の出力: {rendered}"
        );
    }
}
