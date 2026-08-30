//! タスクトレイ常駐 (要件 F-13-7)。
//!
//! マスコット表示は枠が無く、窓を見失うことがある。常駐先から呼び戻せる
//! ようにしておく。
//!
//! 表示の切り替えそのものは画面側が持つ。モデルが出ていなければ入れない、
//! といった判断 (F-13-1、F-13-10) が画面側にあり、ここで直に窓を触ると
//! それを迂回してしまうため、通知だけを送る。

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// 画面側へ「表示を切り替えたい」と伝えるための名前。
pub const TOGGLE_EVENT: &str = "mascot://toggle";

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "表示を切り替える", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::UnknownPath)?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("moca")
        .menu(&menu)
        // 左クリックは窓を呼び戻すために使う。献立は右クリックから。
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => {
                if let Err(error) = app.emit(TOGGLE_EVENT, ()) {
                    tracing::warn!(target: "moca::tray", %error, "表示の切り替えを伝えられません");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            else {
                return;
            };

            // 見失った窓を前へ出す。マスコット表示は枠も影も無いため、
            // 他の窓の裏に回ると探しにくい。
            let Some(window) = tray.app_handle().get_webview_window("main") else {
                return;
            };
            let _ = window.show();
            let _ = window.set_focus();
        })
        .build(app)?;

    Ok(())
}
