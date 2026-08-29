pub mod llm;
pub mod secret;
pub mod storage;

use tracing_subscriber::EnvFilter;

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
        .run(tauri::generate_context!())
        .expect("Tauri アプリケーションの起動に失敗しました");
}
