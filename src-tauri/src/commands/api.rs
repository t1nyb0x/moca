//! Tauri コマンドの定義。
//!
//! 実処理は `AppState` にある。ここは薄い包みに留め、テストしにくい層を
//! 最小化する。契約は docs/ipc-contract.md 第 2 章。

use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;

use crate::llm::types::{ChatResult, Delta, ModelInfo};
use crate::storage::models::{CharacterProfile, Conversation, ConversationSummary, Settings};

use super::dto::{ChatStreamRequest, ProviderHealth, ProviderProfileDto};
use super::error::CommandError;
use super::state::AppState;

type Result<T> = std::result::Result<T, CommandError>;

// --- 設定 ---

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<Settings> {
    state.settings_get()
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, settings: Settings) -> Result<()> {
    state.settings_set(settings)
}

// --- プロバイダ ---

#[tauri::command]
pub fn providers_list(state: State<'_, AppState>) -> Result<Vec<ProviderProfileDto>> {
    state.providers_list()
}

#[tauri::command]
pub fn provider_upsert(
    state: State<'_, AppState>,
    profile: ProviderProfileDto,
    api_key: Option<String>,
) -> Result<ProviderProfileDto> {
    state.provider_upsert(profile, api_key)
}

#[tauri::command]
pub fn provider_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    state.provider_delete(&id)
}

#[tauri::command]
pub async fn provider_test(state: State<'_, AppState>, id: String) -> Result<ProviderHealth> {
    state.provider_test(&id).await
}

#[tauri::command]
pub async fn provider_models(state: State<'_, AppState>, id: String) -> Result<Vec<ModelInfo>> {
    state.provider_models(&id).await
}

// --- キャラクター ---

#[tauri::command]
pub fn characters_list(state: State<'_, AppState>) -> Result<Vec<CharacterProfile>> {
    state.characters_list()
}

#[tauri::command]
pub fn character_get(state: State<'_, AppState>, id: String) -> Result<CharacterProfile> {
    state.character_get(&id)
}

#[tauri::command]
pub fn character_upsert(
    state: State<'_, AppState>,
    profile: CharacterProfile,
) -> Result<CharacterProfile> {
    state.character_upsert(profile)
}

#[tauri::command]
pub fn character_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    state.character_delete(&id)
}

// --- 会話 ---

#[tauri::command]
pub fn conversations_index(
    state: State<'_, AppState>,
    character_id: Option<String>,
) -> Result<Vec<ConversationSummary>> {
    state.conversations_index(character_id.as_deref())
}

#[tauri::command]
pub fn conversation_get(state: State<'_, AppState>, id: String) -> Result<Conversation> {
    state.conversation_get(&id)
}

#[tauri::command]
pub fn conversation_save(state: State<'_, AppState>, conversation: Conversation) -> Result<()> {
    state.conversation_save(conversation)
}

#[tauri::command]
pub fn conversation_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    state.conversation_delete(&id)
}

// --- チャット ---

/// ストリームが終わるまで解決しない。
///
/// エラーは Channel ではなく戻り値でのみ表現する。中断は
/// `stopReason: "cancelled"` の正常終了になる (docs/ipc-contract.md 2.6)。
#[tauri::command]
pub async fn chat_stream(
    state: State<'_, AppState>,
    request: ChatStreamRequest,
    on_delta: Channel<Delta>,
) -> Result<ChatResult> {
    let (tx, mut rx) = mpsc::channel::<Delta>(256);

    // Channel への送出は同期呼び出しなので、受け口を別タスクに分ける
    let forward = tokio::spawn(async move {
        while let Some(delta) = rx.recv().await {
            if on_delta.send(delta).is_err() {
                break;
            }
        }
    });

    let result = state.chat_stream(request, tx).await;
    let _ = forward.await;
    result
}

/// 冪等。すでに終わった要求への中断も成功を返す。
#[tauri::command]
pub fn chat_cancel(state: State<'_, AppState>, request_id: String) -> Result<()> {
    state.chat_cancel(&request_id);
    Ok(())
}
