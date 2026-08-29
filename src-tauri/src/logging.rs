//! ロギングの初期化 (ADR-0011)。
//!
//! 標準出力とファイルの双方へ出す。ファイルは日次でローテーションし、
//! 7 日ぶんだけ残す。不具合の調査に起動時のコンソールしか手がかりが
//! 無いのは不便すぎる。
//!
//! 機密の秘匿は `Secret` newtype が担っており、ここでは扱わない。

use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// 残すログファイルの日数。
const MAX_LOG_FILES: usize = 7;

/// 書き込み待ちを持つので、アプリが生きているあいだ保持し続ける必要がある。
/// 落とすと未書き込みのログが失われる。
pub struct LogGuard(#[allow(dead_code)] WorkerGuard);

/// 設定の水準からフィルタの指定を組み立てる。
///
/// 本アプリは指定された水準、依存ライブラリは info に留める。依存側の
/// debug まで出すと量が多すぎて自分のログが埋もれる。
pub fn filter_directive(level: &str) -> String {
    let level = match level.trim().to_ascii_lowercase().as_str() {
        "trace" => "trace",
        "debug" => "debug",
        "warn" => "warn",
        "error" => "error",
        // 未知の値は info へ倒す。設定ファイルが手で編集されうるため。
        _ => "info",
    };
    format!("moca={level},info")
}

/// 標準出力とファイルへ出す購読者を設定する。
///
/// 環境変数 `RUST_LOG` があればそちらを優先する。調査のとき設定を書き換え
/// ずに水準を変えられるようにするため。
pub fn init(log_dir: &Path, level: &str) -> Option<LogGuard> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(filter_directive(level)));

    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("moca")
        .filename_suffix("log")
        .max_log_files(MAX_LOG_FILES)
        .build(log_dir)
        .ok()?;

    let (writer, guard) = tracing_appender::non_blocking(appender);

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_target(true))
        // ファイルには色の制御文字を入れない。テキストとして読めなくなる。
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_target(true)
                .with_writer(writer),
        )
        .init();

    Some(LogGuard(guard))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 指定した水準を本アプリだけに当てる() {
        assert_eq!(filter_directive("debug"), "moca=debug,info");
        assert_eq!(filter_directive("warn"), "moca=warn,info");
    }

    #[test]
    fn 依存ライブラリは常に_info_に留める() {
        // 依存側の debug まで出すと自分のログが埋もれる
        for level in ["trace", "debug", "info", "warn", "error"] {
            assert!(
                filter_directive(level).ends_with(",info"),
                "{level} で依存側の水準が上がっている"
            );
        }
    }

    #[test]
    fn 大文字や空白を許す() {
        assert_eq!(filter_directive(" DEBUG "), "moca=debug,info");
    }

    #[test]
    fn 未知の値は_info_へ倒す() {
        // 設定ファイルは手で編集されうる
        for value in ["", "verbose", "なんでもない"] {
            assert_eq!(filter_directive(value), "moca=info,info");
        }
    }
}
