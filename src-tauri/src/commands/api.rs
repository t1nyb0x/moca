//! Tauri コマンドの定義。
//!
//! 実処理は `AppState` にある。ここは薄い包みに留め、テストしにくい層を
//! 最小化する。契約は docs/ipc-contract.md 第 2 章。

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc;

use crate::llm::types::{ChatResult, Delta, ModelInfo};
use crate::storage::models::{CharacterProfile, Conversation, ConversationSummary, Settings};
use crate::tts::types::{SpeakerInfo, TtsKind};

use super::dto::{ChatStreamRequest, ProviderHealth, ProviderProfileDto};
use super::error::{CommandError, CommandErrorKind};
use super::state::AppState;

type Result<T> = std::result::Result<T, CommandError>;

// --- 設定 ---

/// フロントが起動時に最初に呼ぶ。ここまで届けば WebView と IPC は生きている。
#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<Settings> {
    tracing::debug!(target: "moca::commands", "設定の読み出し");
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

/// 画面側で起きた失敗を記録する。
///
/// WebView の中の例外は Rust のログに残らない。残らないと「エラーになる」
/// としか分からず、調査の取っ掛かりが無い。画面側から明示的に送ってもらう。
#[tauri::command]
pub fn log_client_error(message: String, detail: Option<String>) {
    tracing::error!(
        target: "moca::client",
        detail = detail.as_deref().unwrap_or("-"),
        "画面側でエラー: {message}"
    );
}

/// ログの保存先。不具合の報告に添えてもらうために表示する。
#[tauri::command]
pub fn logs_dir(app: AppHandle) -> Result<String> {
    app.path()
        .app_log_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| {
            tracing::debug!(target: "moca::commands", ?error, "ログの場所を解決できない");
            CommandError::new(CommandErrorKind::Io, "ログの保存先を特定できませんでした")
        })
}

// --- 音声合成 ---

#[tauri::command]
pub async fn tts_speakers(
    state: State<'_, AppState>,
    kind: TtsKind,
    base_url: String,
) -> Result<Vec<SpeakerInfo>> {
    state.tts_speakers(kind, &base_url).await
}

#[tauri::command]
pub async fn tts_emotion_axes(
    state: State<'_, AppState>,
    kind: TtsKind,
    base_url: String,
    speaker: String,
) -> Result<Vec<String>> {
    state.tts_emotion_axes(kind, &base_url, &speaker).await
}

/// 合成した WAV を生のバイト列で返す。
///
/// 音声は数百 KB になる。JSON の数値配列で運ぶと数倍に膨れるので、
/// 生の応答を使う。
#[tauri::command]
pub async fn tts_synthesize(
    state: State<'_, AppState>,
    character_id: String,
    text: String,
    emotion: String,
    intensity: f64,
) -> Result<tauri::ipc::Response> {
    let audio = state
        .tts_synthesize(&character_id, &text, &emotion, intensity)
        .await?;
    Ok(tauri::ipc::Response::new(audio))
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
