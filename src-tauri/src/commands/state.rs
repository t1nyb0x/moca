//! アプリケーション状態と、コマンドの実処理。
//!
//! Tauri のコマンド関数はテストしにくいので、ロジックはここに置き、
//! コマンド側は薄い包みに留める。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::llm::http::{ChatProvider, HttpProvider};
use crate::llm::types::{ChatMessage, ChatRequest, ChatResult, Delta, ModelInfo, Role};
use crate::prompt::build_system_prompt;
use crate::secret::store::{provider_key_ref, SecretStore};
use crate::secret::Secret;
use crate::storage::models::{
    CharacterProfile, Conversation, ConversationSummary, MessageRole, ProviderProfile, Settings,
};
use crate::storage::store::FileStore;
use crate::tts::cevio::CevioSynthesizer;
use crate::tts::http::HttpSynthesizer;
use crate::tts::types::{SpeakerInfo, SynthesizeRequest, TtsKind};
use crate::tts::SpeechSynthesizer;

use super::dto::{ChatStreamRequest, ProviderHealth, ProviderProfileDto};
use super::error::CommandError;

type Result<T> = std::result::Result<T, CommandError>;

pub struct AppState {
    pub store: FileStore,
    pub secrets: Arc<dyn SecretStore>,
    /// 進行中の要求。中断の宛先。
    cancels: Mutex<HashMap<String, CancellationToken>>,
}

impl AppState {
    pub fn new(store: FileStore, secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            store,
            secrets,
            cancels: Mutex::new(HashMap::new()),
        }
    }

    // --- 設定 ---

    pub fn settings_get(&self) -> Result<Settings> {
        Ok(self.store.load_settings()?)
    }

    pub fn settings_set(&self, settings: Settings) -> Result<()> {
        Ok(self.store.save_settings(&settings)?)
    }

    // --- プロバイダ ---

    fn has_api_key(&self, provider_id: &str) -> bool {
        self.secrets
            .get(&provider_key_ref(provider_id))
            .ok()
            .flatten()
            .is_some_and(|secret| !secret.is_empty())
    }

    pub fn providers_list(&self) -> Result<Vec<ProviderProfileDto>> {
        Ok(self
            .store
            .list_providers()?
            .iter()
            .map(|profile| ProviderProfileDto::from_profile(profile, self.has_api_key(&profile.id)))
            .collect())
    }

    /// `api_key` の意味づけは 3 通りある (docs/ipc-contract.md 2.2)。
    ///
    /// - `None`: 既存の鍵を維持する
    /// - `Some("")`: 鍵を削除する
    /// - `Some(値)`: 差し替える
    pub fn provider_upsert(
        &self,
        dto: ProviderProfileDto,
        api_key: Option<String>,
    ) -> Result<ProviderProfileDto> {
        if dto.id.trim().is_empty() {
            return Err(CommandError::invalid("プロバイダの識別子が空です"));
        }
        if dto.base_url.trim().is_empty() {
            return Err(CommandError::invalid("接続先の URL を入力してください"));
        }

        let profile = dto.into_profile();
        self.store.upsert_provider(&profile)?;

        let key_ref = provider_key_ref(&profile.id);
        match api_key {
            None => {}
            Some(value) if value.is_empty() => self.secrets.delete(&key_ref)?,
            Some(value) => self.secrets.set(&key_ref, &Secret::new(value))?,
        }

        Ok(ProviderProfileDto::from_profile(
            &profile,
            self.has_api_key(&profile.id),
        ))
    }

    pub fn provider_delete(&self, id: &str) -> Result<()> {
        // 参照があれば store 側が拒む (IPC 契約 C-4)
        self.store.delete_provider(id)?;
        self.secrets.delete(&provider_key_ref(id))?;
        Ok(())
    }

    pub fn find_provider(&self, id: &str) -> Result<ProviderProfile> {
        self.store
            .list_providers()?
            .into_iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| CommandError::not_found("プロバイダの設定が見つかりません"))
    }

    fn build_provider(&self, profile: &ProviderProfile) -> Result<HttpProvider> {
        let key = self.secrets.get(&provider_key_ref(&profile.id))?;
        Ok(HttpProvider::new(profile.kind, &profile.base_url, key)?)
    }

    pub async fn provider_test(&self, id: &str) -> Result<ProviderHealth> {
        let profile = self.find_provider(id)?;
        let provider = self.build_provider(&profile)?;

        let started = Instant::now();
        match provider.list_models().await {
            Ok(models) => Ok(ProviderHealth {
                ok: true,
                latency_ms: Some(started.elapsed().as_millis() as u32),
                detail: format!(
                    "接続できました。{} 件のモデルが見つかりました",
                    models.len()
                ),
            }),
            Err(error) => {
                let error: CommandError = error.into();
                Ok(ProviderHealth {
                    ok: false,
                    latency_ms: None,
                    detail: error.message,
                })
            }
        }
    }

    pub async fn provider_models(&self, id: &str) -> Result<Vec<ModelInfo>> {
        let profile = self.find_provider(id)?;
        Ok(self.build_provider(&profile)?.list_models().await?)
    }

    // --- キャラクター ---

    pub fn characters_list(&self) -> Result<Vec<CharacterProfile>> {
        Ok(self.store.list_characters()?)
    }

    pub fn character_get(&self, id: &str) -> Result<CharacterProfile> {
        Ok(self.store.get_character(id)?)
    }

    pub fn character_upsert(&self, mut profile: CharacterProfile) -> Result<CharacterProfile> {
        if profile.id.trim().is_empty() {
            return Err(CommandError::invalid("キャラクターの識別子が空です"));
        }
        profile.updated_at = crate::storage::models::now_rfc3339();
        self.store.upsert_character(&profile)?;
        Ok(profile)
    }

    pub fn character_delete(&self, id: &str) -> Result<()> {
        Ok(self.store.delete_character(id)?)
    }

    // --- 会話 ---

    pub fn conversations_index(
        &self,
        character_id: Option<&str>,
    ) -> Result<Vec<ConversationSummary>> {
        Ok(self.store.list_conversations(character_id)?)
    }

    pub fn conversation_get(&self, id: &str) -> Result<Conversation> {
        Ok(self.store.get_conversation(id)?)
    }

    pub fn conversation_save(&self, mut conversation: Conversation) -> Result<()> {
        conversation.updated_at = crate::storage::models::now_rfc3339();
        Ok(self.store.save_conversation(&conversation)?)
    }

    pub fn conversation_delete(&self, id: &str) -> Result<()> {
        Ok(self.store.delete_conversation(id)?)
    }

    // --- 音声合成 ---

    /// 繋ぎ方は種別で決まる。CeVIO を COM で直に叩く経路に待ち受け先は
    /// 要らない (ADR-0018)。
    fn synthesizer(kind: TtsKind, base_url: &str) -> Result<Box<dyn SpeechSynthesizer>> {
        Ok(match kind {
            TtsKind::Cevio => Box::new(CevioSynthesizer::new()),
            _ => Box::new(HttpSynthesizer::new(kind, base_url)?),
        })
    }

    pub async fn tts_speakers(&self, kind: TtsKind, base_url: &str) -> Result<Vec<SpeakerInfo>> {
        Ok(Self::synthesizer(kind, base_url)?.speakers().await?)
    }

    pub async fn tts_emotion_axes(
        &self,
        kind: TtsKind,
        base_url: &str,
        speaker: &str,
    ) -> Result<Vec<String>> {
        Ok(Self::synthesizer(kind, base_url)?
            .emotion_axes(speaker)
            .await?)
    }

    /// 選択中のキャラクターの設定で合成する。
    ///
    /// 感情から声の作り方への割り当ては設定に持たせてあるので、呼び出し側は
    /// 正規化感情の名前だけを渡せばよい。
    pub async fn tts_synthesize(
        &self,
        character_id: &str,
        text: &str,
        emotion: &str,
        intensity: f64,
    ) -> Result<Vec<u8>> {
        if text.trim().is_empty() {
            return Err(CommandError::invalid("読み上げる本文がありません"));
        }

        let character = self.character_get(character_id)?;
        let settings = character
            .voice_settings
            .ok_or_else(|| CommandError::invalid("このキャラクターに音声が設定されていません"))?;

        if !settings.enabled {
            return Err(CommandError::invalid("音声が無効になっています"));
        }

        // タグの強さと、利用者が決めた効き具合の積だけ中立から寄せる。
        // 名前だけを見ていた頃は [happy:0.3] も [happy:1.0] も同じ声だった。
        let target = settings
            .emotion_presets
            .get(emotion)
            .cloned()
            .unwrap_or_default();
        let neutral = settings
            .emotion_presets
            .get("neutral")
            .cloned()
            .unwrap_or_default();
        let strength = if settings.emotion_strength.is_finite() {
            settings.emotion_strength.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let amount = if intensity.is_finite() {
            intensity.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let preset = crate::tts::blend::blend(&neutral, &target, amount * strength);

        let synthesizer = Self::synthesizer(settings.kind, &settings.base_url)?;
        Ok(synthesizer
            .synthesize(SynthesizeRequest {
                text: text.to_owned(),
                speaker: settings.speaker,
                preset,
            })
            .await?)
    }

    // --- チャット ---

    /// 中断は冪等。すでに終わった要求への中断も成功とする。
    /// 完了と中断が競合して届きうるため。
    pub fn chat_cancel(&self, request_id: &str) {
        if let Some(token) = self.cancels.lock().expect("poisoned").get(request_id) {
            token.cancel();
        }
    }

    pub fn in_flight(&self) -> usize {
        self.cancels.lock().expect("poisoned").len()
    }

    /// 送信内容を組み立てる。
    ///
    /// システムプロンプトへの感情プロトコル連結はここで行う。フロントは
    /// プロトコルの文言を知らない。
    fn build_chat_request(
        &self,
        character: &CharacterProfile,
        provider: &ProviderProfile,
        request: &ChatStreamRequest,
    ) -> ChatRequest {
        let mut messages: Vec<ChatMessage> = request
            .history
            .iter()
            .map(|message| ChatMessage {
                role: match message.role {
                    MessageRole::User => Role::User,
                    MessageRole::Assistant => Role::Assistant,
                },
                content: message.content.clone(),
            })
            .collect();
        messages.push(ChatMessage::user(request.user_input.clone()));

        // 身振りのタグはキャラクターごとに違う。割り当てたものだけを教える。
        let gesture_tags: Vec<String> = character
            .gestures
            .iter()
            .map(|gesture| gesture.tag.clone())
            .collect();

        ChatRequest {
            system: build_system_prompt(
                &character.system_prompt,
                provider.emotion_mode,
                &gesture_tags,
            ),
            messages,
            model: provider.model.clone(),
            max_tokens: provider.max_tokens,
            temperature: provider.temperature,
            top_p: provider.top_p,
        }
    }

    /// ストリームを回し、差分を `sink` へ流す。
    ///
    /// エラーは戻り値でのみ表現し、`sink` には流さない。経路が 2 本あると
    /// フロントの状態管理が壊れる (docs/ipc-contract.md 2.6)。
    pub async fn chat_stream(
        &self,
        request: ChatStreamRequest,
        sink: mpsc::Sender<Delta>,
    ) -> Result<ChatResult> {
        if request.request_id.trim().is_empty() {
            return Err(CommandError::invalid("要求の識別子が空です"));
        }

        let character = self.character_get(&request.character_id)?;
        let profile = self.find_provider(&character.provider_id)?;
        let provider = self.build_provider(&profile)?;
        let chat_request = self.build_chat_request(&character, &profile, &request);

        let token = CancellationToken::new();
        self.cancels
            .lock()
            .expect("poisoned")
            .insert(request.request_id.clone(), token.clone());

        let result = provider.stream_chat(chat_request, token, sink).await;

        self.cancels
            .lock()
            .expect("poisoned")
            .remove(&request.request_id);

        result.map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use crate::commands::error::CommandErrorKind;
    use crate::llm::http::ProviderKind;
    use crate::llm::types::StopReason;
    use crate::secret::store::MemorySecretStore;
    use crate::storage::models::{now_rfc3339, EmotionMode, IdleSettings, Message, SCHEMA_VERSION};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn state() -> (tempfile::TempDir, AppState) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::new(
            FileStore::new(dir.path()),
            Arc::new(MemorySecretStore::new()),
        );
        (dir, state)
    }

    fn provider_dto(id: &str, base_url: &str) -> ProviderProfileDto {
        ProviderProfileDto {
            id: id.to_owned(),
            name: "テスト".to_owned(),
            kind: ProviderKind::OpenaiCompatible,
            base_url: base_url.to_owned(),
            model: "test-model".to_owned(),
            has_api_key: false,
            temperature: None,
            top_p: None,
            max_tokens: Some(256),
            emotion_mode: EmotionMode::Tag,
            context_budget_tokens: None,
        }
    }

    fn character(id: &str, provider_id: &str) -> CharacterProfile {
        CharacterProfile {
            id: id.to_owned(),
            name: "千奈".to_owned(),
            model_path: None,
            model_format: None,
            system_prompt: "あなたは倉本千奈です".to_owned(),
            provider_id: provider_id.to_owned(),
            camera_preset: None,
            idle_settings: IdleSettings::default(),
            emotion_mapping: None,
            voice_settings: None,
            gestures: Vec::new(),
            schema_version: SCHEMA_VERSION,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        }
    }

    #[test]
    fn 鍵を保存すると_has_api_key_が立つ() {
        let (_dir, state) = state();
        state
            .provider_upsert(provider_dto("p1", "http://x"), Some("sk-test".to_owned()))
            .unwrap();
        assert!(state.providers_list().unwrap()[0].has_api_key);
    }

    #[test]
    fn 鍵に_None_を渡すと既存を維持する() {
        let (_dir, state) = state();
        state
            .provider_upsert(provider_dto("p1", "http://x"), Some("sk-test".to_owned()))
            .unwrap();

        let mut updated = provider_dto("p1", "http://y");
        updated.model = "changed".to_owned();
        state.provider_upsert(updated, None).unwrap();

        let list = state.providers_list().unwrap();
        assert_eq!(list[0].model, "changed");
        assert!(list[0].has_api_key, "鍵が消えている");
    }

    #[test]
    fn 鍵に空文字を渡すと削除する() {
        let (_dir, state) = state();
        state
            .provider_upsert(provider_dto("p1", "http://x"), Some("sk-test".to_owned()))
            .unwrap();
        state
            .provider_upsert(provider_dto("p1", "http://x"), Some(String::new()))
            .unwrap();
        assert!(!state.providers_list().unwrap()[0].has_api_key);
    }

    #[test]
    fn プロバイダを消すと鍵も消える() {
        let (_dir, state) = state();
        state
            .provider_upsert(provider_dto("p1", "http://x"), Some("sk-test".to_owned()))
            .unwrap();
        state.provider_delete("p1").unwrap();
        assert!(state
            .secrets
            .get(&provider_key_ref("p1"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn 参照されているプロバイダは消せず鍵も残る() {
        let (_dir, state) = state();
        state
            .provider_upsert(provider_dto("p1", "http://x"), Some("sk-test".to_owned()))
            .unwrap();
        state.character_upsert(character("ch1", "p1")).unwrap();

        let error = state.provider_delete("p1").unwrap_err();
        assert_eq!(error.kind, CommandErrorKind::Invalid);
        assert!(state
            .secrets
            .get(&provider_key_ref("p1"))
            .unwrap()
            .is_some());
    }

    #[test]
    fn 識別子が空なら拒否する() {
        let (_dir, state) = state();
        assert_eq!(
            state
                .provider_upsert(provider_dto("", "http://x"), None)
                .unwrap_err()
                .kind,
            CommandErrorKind::Invalid
        );
        assert_eq!(
            state
                .provider_upsert(provider_dto("p1", "  "), None)
                .unwrap_err()
                .kind,
            CommandErrorKind::Invalid
        );
    }

    #[test]
    fn 存在しないプロバイダは_not_found() {
        let (_dir, state) = state();
        assert_eq!(
            state.find_provider("none").unwrap_err().kind,
            CommandErrorKind::NotFound
        );
    }

    #[test]
    fn キャラクター保存で更新時刻が入る() {
        let (_dir, state) = state();
        let mut profile = character("ch1", "p1");
        profile.updated_at = "1970-01-01T00:00:00Z".to_owned();
        let saved = state.character_upsert(profile).unwrap();
        assert_ne!(saved.updated_at, "1970-01-01T00:00:00Z");
    }

    #[tokio::test]
    async fn チャットが通り差分が流れる() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(concat!(
                        "data: {\"choices\":[{\"delta\":{\"content\":\"[happy]ごきげんよう\"}}]}\n\n",
                        "data: [DONE]\n\n",
                    )),
            )
            .mount(&server)
            .await;

        let (_dir, state) = state();
        state
            .provider_upsert(provider_dto("p1", &server.uri()), None)
            .unwrap();
        state.character_upsert(character("ch1", "p1")).unwrap();

        let (tx, mut rx) = mpsc::channel(64);
        let result = state
            .chat_stream(
                ChatStreamRequest {
                    request_id: "r1".to_owned(),
                    character_id: "ch1".to_owned(),
                    history: vec![],
                    user_input: "こんにちは".to_owned(),
                },
                tx,
            )
            .await
            .unwrap();

        assert_eq!(result.stop_reason, StopReason::EndTurn);
        assert_eq!(
            rx.try_recv().unwrap(),
            Delta::Text {
                value: "[happy]ごきげんよう".to_owned()
            }
        );
        assert_eq!(state.in_flight(), 0, "進行中の要求が残っている");
    }

    #[tokio::test]
    async fn 送信内容に人格と感情プロトコルが載る() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string("data: [DONE]\n\n"),
            )
            .mount(&server)
            .await;

        let (_dir, state) = state();
        state
            .provider_upsert(provider_dto("p1", &server.uri()), None)
            .unwrap();
        state.character_upsert(character("ch1", "p1")).unwrap();

        let (tx, _rx) = mpsc::channel(64);
        state
            .chat_stream(
                ChatStreamRequest {
                    request_id: "r1".to_owned(),
                    character_id: "ch1".to_owned(),
                    history: vec![Message {
                        role: MessageRole::Assistant,
                        content: "はじめまして".to_owned(),
                        raw_content: None,
                        emotions: None,
                        created_at: now_rfc3339(),
                        model: None,
                    }],
                    user_input: "お元気ですか".to_owned(),
                },
                tx,
            )
            .await
            .unwrap();

        let requests = server.received_requests().await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        let messages = body["messages"].as_array().unwrap();

        assert_eq!(messages[0]["role"], "system");
        let system = messages[0]["content"].as_str().unwrap();
        assert!(system.contains("倉本千奈"), "人格が載っていない");
        assert!(system.contains("[happy]"), "感情プロトコルが載っていない");

        // 履歴と今回の入力が順に並ぶ
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[2]["content"], "お元気ですか");
    }

    #[tokio::test]
    async fn 感情モードが_off_ならプロトコルを載せない() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string("data: [DONE]\n\n"),
            )
            .mount(&server)
            .await;

        let (_dir, state) = state();
        let mut dto = provider_dto("p1", &server.uri());
        dto.emotion_mode = EmotionMode::Off;
        state.provider_upsert(dto, None).unwrap();
        state.character_upsert(character("ch1", "p1")).unwrap();

        let (tx, _rx) = mpsc::channel(64);
        state
            .chat_stream(
                ChatStreamRequest {
                    request_id: "r1".to_owned(),
                    character_id: "ch1".to_owned(),
                    history: vec![],
                    user_input: "やあ".to_owned(),
                },
                tx,
            )
            .await
            .unwrap();

        let requests = server.received_requests().await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        let system = body["messages"][0]["content"].as_str().unwrap();
        assert!(!system.contains("感情タグ"));
    }

    #[tokio::test]
    async fn 未知のキャラクターは_not_found() {
        let (_dir, state) = state();
        let (tx, _rx) = mpsc::channel(1);
        let error = state
            .chat_stream(
                ChatStreamRequest {
                    request_id: "r1".to_owned(),
                    character_id: "none".to_owned(),
                    history: vec![],
                    user_input: "やあ".to_owned(),
                },
                tx,
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind, CommandErrorKind::NotFound);
    }

    #[test]
    fn 未知の要求への中断は成功扱い() {
        let (_dir, state) = state();
        state.chat_cancel("知らない要求");
    }
}
