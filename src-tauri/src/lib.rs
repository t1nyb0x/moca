pub mod commands;
pub mod llm;
pub mod prompt;
pub mod secret;
pub mod storage;

use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use commands::state::AppState;
use secret::store::KeyringStore;
use storage::store::FileStore;

/// 資格情報マネージャー上のサービス名。
const KEYRING_SERVICE: &str = "moca";

/// ロギングの初期化。
///
/// ADR-0011 に従い `tracing` を用いる。ファイル出力・日次ローテーション・
/// `Secret` newtype による機密保護は段 8 で追加する。現時点では開発時の
/// 標準出力のみ。
fn init_tracing() {
    let default_directive = if cfg!(debug_assertions) {
        "moca=debug,info"
    } else {
        "info"
    };
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_directive));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            tracing::info!(target: "moca", path = %data_dir.display(), "データディレクトリ");

            app.manage(AppState::new(
                FileStore::new(data_dir),
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
        ])
        .run(tauri::generate_context!())
        .expect("Tauri アプリケーションの起動に失敗しました");
}
