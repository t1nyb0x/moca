pub mod commands;
pub mod llm;
pub mod logging;
pub mod prompt;
pub mod secret;
pub mod storage;
pub mod tts;

use std::sync::Arc;

use tauri::Manager;

use commands::state::AppState;
use secret::store::KeyringStore;
use storage::store::FileStore;

/// 資格情報マネージャー上のサービス名。
const KEYRING_SERVICE: &str = "moca";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = FileStore::new(data_dir.clone());

            // ログの水準は設定から取る。設定が壊れていても起動は妨げない。
            let settings = store.load_settings().unwrap_or_default();

            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            if let Some(guard) = logging::init(&log_dir, &settings.log_level) {
                // 書き込み待ちを持つので、アプリが生きているあいだ保持する
                app.manage(guard);
            }

            tracing::info!(
                target: "moca",
                data = %data_dir.display(),
                logs = %log_dir.display(),
                "起動しました"
            );

            app.manage(AppState::new(
                store,
                Arc::new(KeyringStore::new(KEYRING_SERVICE)),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api::settings_get,
            commands::api::settings_set,
            commands::api::providers_list,
            commands::api::provider_upsert,
            commands::api::provider_delete,
            commands::api::provider_test,
            commands::api::provider_models,
            commands::api::characters_list,
            commands::api::character_get,
            commands::api::character_upsert,
            commands::api::character_delete,
            commands::api::conversations_index,
            commands::api::conversation_get,
            commands::api::conversation_save,
            commands::api::conversation_delete,
            commands::api::chat_stream,
            commands::api::chat_cancel,
            commands::model::model_pick,
            commands::model::model_open,
            commands::api::logs_dir,
            commands::api::log_client_error,
            commands::api::tts_speakers,
            commands::api::tts_emotion_axes,
            commands::api::tts_synthesize,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri アプリケーションの起動に失敗しました");
}
