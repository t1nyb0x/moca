//! ウィンドウの見た目の切り替え (要件 F-13、ADR-0016)。
//!
//! 透過はウィンドウ生成時にしか決められない。`set_transparent` は存在しない
//! ため `tauri.conf.json` で常に有効にしてある。ここで触るのは実行時に
//! 変えられるものだけ。

use serde::Serialize;
use tauri::{LogicalSize, PhysicalPosition, Window};
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

/// 画面からはみ出した窓を、端が接地する位置まで戻す (要件 F-13-11)。
///
/// 引数と戻り値はすべて物理画素。`area` は作業領域、すなわちタスクバーを除いた
/// 範囲を渡す。原点が 0 とは限らない。左や上に別の画面があると負になる。
///
/// **窓のほうが大きいときは左上を合わせる。** 右下を合わせると、題名と閉じる
/// ボタンが画面の外へ出て、窓を操作できなくなる。
pub fn clamp_to_area(
    position: (i32, i32),
    size: (u32, u32),
    area_position: (i32, i32),
    area_size: (u32, u32),
) -> (i32, i32) {
    let clamp = |value: i32, origin: i32, span: u32, length: u32| {
        let last = origin + span as i32 - length as i32;
        // 窓のほうが大きいと last < origin になる。min を先に取ると原点へ寄る。
        value.min(last).max(origin)
    };

    (
        clamp(position.0, area_position.0, area_size.0, size.0),
        clamp(position.1, area_position.1, area_size.1, size.1),
    )
}

/// いまの窓を、画面の中へ収め直す。
///
/// マスコット表示から戻ると窓は大きくなる。左上はそのままなので、画面の下や
/// 右に寄せて置いていた場合、そのぶんが画面の外へ出る。**戻したときに窓が
/// 見えないのは詰みに近い**ので、ここで引き戻す。
///
/// 画面の情報が取れないときは何もしない。位置を勝手に動かすより、そのままの
/// ほうが害が小さい。
fn keep_within_screen(window: &Window) -> Result<()> {
    let Some(monitor) = window.current_monitor().map_err(failed)? else {
        return Ok(());
    };

    let area = monitor.work_area();
    let size = window.outer_size().map_err(failed)?;
    let position = window.outer_position().map_err(failed)?;

    let (x, y) = clamp_to_area(
        (position.x, position.y),
        (size.width, size.height),
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
    );

    if x != position.x || y != position.y {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(failed)?;
    }
    Ok(())
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

    keep_within_screen(&window)
}

/// 窓の大きさを変える (要件 F-13-3)。
#[tauri::command]
pub fn window_set_size(window: Window, width: f64, height: f64) -> Result<()> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(CommandError::invalid("ウィンドウの大きさが不正です"));
    }
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(failed)?;

    // 大きくなったぶんが画面の外へ出ることがある。
    keep_within_screen(&window)
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

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;

    /// 1920x1040 の作業領域 (下 40 画素はタスクバー)。
    const AREA_POSITION: (i32, i32) = (0, 0);
    const AREA_SIZE: (u32, u32) = (1920, 1040);

    fn clamp(position: (i32, i32), size: (u32, u32)) -> (i32, i32) {
        clamp_to_area(position, size, AREA_POSITION, AREA_SIZE)
    }

    #[test]
    fn 収まっている窓は動かさない() {
        assert_eq!(clamp((100, 200), (800, 600)), (100, 200));
    }

    #[test]
    fn 下へはみ出したら下端を接地させる() {
        // マスコット表示を画面の下に置いて戻すと、これが起きる
        assert_eq!(clamp((100, 900), (800, 600)), (100, 1040 - 600));
    }

    #[test]
    fn 右へはみ出したら右端を接地させる() {
        assert_eq!(clamp((1500, 100), (800, 600)), (1920 - 800, 100));
    }

    #[test]
    fn 左や上へはみ出したら原点へ戻す() {
        assert_eq!(clamp((-50, -30), (800, 600)), (0, 0));
    }

    #[test]
    fn 画面より大きい窓は左上を合わせる() {
        // 右下を合わせると、題名と閉じるボタンが画面の外へ出て操作できなくなる
        assert_eq!(clamp((100, 100), (2400, 1200)), (0, 0));
    }

    #[test]
    fn 作業領域の原点が負でも接地させる() {
        // 主画面の左に別の画面がある配置
        let area_position = (-1920, 0);
        let size = (800, 600);
        assert_eq!(
            clamp_to_area((-2400, 100), size, area_position, AREA_SIZE),
            (-1920, 100)
        );
        assert_eq!(
            clamp_to_area((-500, 900), size, area_position, AREA_SIZE),
            (-1920 + 1920 - 800, 1040 - 600)
        );
    }

    #[test]
    fn タスクバーのぶんは避ける() {
        // 作業領域を使うので、画面の高さ 1080 ではなく 1040 で収まる
        assert_eq!(clamp((0, 1000), (800, 600)), (0, 440));
    }
}
