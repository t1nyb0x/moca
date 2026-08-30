//! ウィンドウの見た目の切り替え (要件 F-13、ADR-0016)。
//!
//! 透過はウィンドウ生成時にしか決められない。`set_transparent` は存在しない
//! ため `tauri.conf.json` で常に有効にしてある。ここで触るのは実行時に
//! 変えられるものだけ。

use serde::Serialize;
use tauri::{LogicalSize, Window};
use ts_rs::TS;

use super::error::{CommandError, CommandErrorKind};

type Result<T> = std::result::Result<T, CommandError>;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
}

/// 窓の左上を原点とした、カーソルの位置 (論理画素)。
///
/// 窓の外にいることもあるため、負の値や大きさを超える値を取りうる。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CursorPoint {
    pub x: f64,
    pub y: f64,
}

/// 通常表示での最小の大きさ。`tauri.conf.json` の `minWidth` / `minHeight`
/// と揃える。
const MIN_NORMAL_WIDTH: f64 = 720.0;
const MIN_NORMAL_HEIGHT: f64 = 480.0;

fn failed(error: tauri::Error) -> CommandError {
    CommandError::new(
        CommandErrorKind::Io,
        format!("ウィンドウを操作できませんでした: {error}"),
    )
}

/// マスコット表示と通常表示を切り替える (要件 F-13-1)。
///
/// **最小の大きさの制約を外すこと。** 通常表示の下限 (720x480) を残したまま
/// では、倍率を下げても窓がそこまでしか縮まない。
#[tauri::command]
pub fn window_set_mascot(window: Window, enabled: bool) -> Result<()> {
    window.set_decorations(!enabled).map_err(failed)?;
    window.set_shadow(!enabled).map_err(failed)?;
    window.set_always_on_top(enabled).map_err(failed)?;

    let min = if enabled {
        None
    } else {
        Some(LogicalSize::new(MIN_NORMAL_WIDTH, MIN_NORMAL_HEIGHT))
    };
    window.set_min_size(min).map_err(failed)?;

    Ok(())
}

/// 窓の大きさを変える (要件 F-13-3)。
#[tauri::command]
pub fn window_set_size(window: Window, width: f64, height: f64) -> Result<()> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(CommandError::invalid("ウィンドウの大きさが不正です"));
    }
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(failed)
}

/// いまの窓の大きさ (論理画素)。
///
/// マスコット表示へ入る前の大きさを覚えておき、戻るときに復元するために使う。
/// これが無いと、利用者が広げた窓が切り替えのたびに既定へ戻ってしまう。
#[tauri::command]
pub fn window_size(window: Window) -> Result<WindowSize> {
    let scale = window.scale_factor().map_err(failed)?;
    let size = window
        .inner_size()
        .map_err(failed)?
        .to_logical::<f64>(scale);
    Ok(WindowSize {
        width: size.width,
        height: size.height,
    })
}

/// 窓に対するカーソルの位置 (要件 F-13-5)。
///
/// **クリックスルー中は WebView へマウスが届かない。** 画面側では「モデルの
/// 上へ戻ってきた」ことを検知できないため、位置はこちらから読む。
#[tauri::command]
pub fn window_cursor_position(window: Window) -> Result<CursorPoint> {
    let scale = window.scale_factor().map_err(failed)?;
    let cursor = window.cursor_position().map_err(failed)?;
    let origin = window.inner_position().map_err(failed)?;
    Ok(CursorPoint {
        x: (cursor.x - f64::from(origin.x)) / scale,
        y: (cursor.y - f64::from(origin.y)) / scale,
    })
}

/// 描かれていないところでは、背後の窓を操作できるようにする (要件 F-13-5)。
#[tauri::command]
pub fn window_set_click_through(window: Window, ignore: bool) -> Result<()> {
    window.set_ignore_cursor_events(ignore).map_err(failed)
}

/// 掴んで窓ごと動かす (要件 F-13-6)。
///
/// マスコット表示では枠を消すため、掴む場所が無くなる。カメラ操作の代わりに
/// この操作を割り当てる。掴んで動かす対象はカメラではなくモデルである。
#[tauri::command]
pub fn window_start_drag(window: Window) -> Result<()> {
    window.start_dragging().map_err(failed)
}
