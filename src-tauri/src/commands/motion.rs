//! 身振りに使うモーションファイルの選択 (要件 F-15)。
//!
//! モデルと同じく、**ファイルの中身は IPC で運ばない**。パスをアセット
//! プロトコルのスコープへ登録し、three.js のローダーが WebView 側で直接
//! 取得する (docs/ipc-contract.md 2.5)。
//!
//! 扱うのは VRMA だけとする。VRM のための標準的なモーション形式であり、
//! 人型ボーンの対応が仕様で保証されているため、モデルを選ばず当たる
//! (ADR-0019)。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use super::error::{CommandError, CommandErrorKind};

type Result<T> = std::result::Result<T, CommandError>;

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MotionHandle {
    /// 絶対パス。フロントが convertFileSrc に渡す。
    pub path: String,
    /// 画面に出す名前。拡張子を除いたファイル名。
    pub name: String,
}

/// 拡張子を確かめ、表示用の名前を切り出す。
///
/// ファイルシステムに触れないので単体でテストできる。
pub fn build_handle(path: &Path) -> Result<MotionHandle> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);

    if extension.as_deref() != Some("vrma") {
        return Err(CommandError::invalid(
            "対応していない形式です。.vrma ファイルを選んでください",
        ));
    }

    // 拡張子を除いた名前。取れなければパスをそのまま出す。
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let name = if name.is_empty() {
        path.to_string_lossy().into_owned()
    } else {
        name.to_owned()
    };

    Ok(MotionHandle {
        path: path.to_string_lossy().into_owned(),
        name,
    })
}

/// 実ファイルを検証し、アセットプロトコルのスコープへ登録する。
fn open_path(app: &AppHandle, path: PathBuf) -> Result<MotionHandle> {
    let metadata = std::fs::metadata(&path).map_err(|err| {
        tracing::debug!(target: "moca::commands", error = ?err, "モーションの情報を取得できない");
        CommandError::new(
            CommandErrorKind::Io,
            "ファイルを読み取れません。移動または削除されていないか確認してください",
        )
    })?;

    if !metadata.is_file() {
        return Err(CommandError::invalid("ファイルを選んでください"));
    }

    let handle = build_handle(&path)?;

    // VRMA は 1 ファイルで完結する。そのファイルだけ許せばよい。
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|err| {
            tracing::debug!(target: "moca::commands", error = ?err, "スコープ登録に失敗");
            CommandError::new(
                CommandErrorKind::Io,
                "ファイルへのアクセスを許可できませんでした",
            )
        })?;

    tracing::info!(target: "moca::commands", name = %handle.name, "モーションを開いた");
    Ok(handle)
}

/// ネイティブのファイルダイアログを開く。選ばなければ None。
#[tauri::command]
pub async fn motion_pick(app: AppHandle) -> Result<Option<MotionHandle>> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .add_filter("VRM アニメーション", &["vrma"])
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });

    let Ok(Some(picked)) = rx.await else {
        return Ok(None);
    };

    let path = picked
        .into_path()
        .map_err(|_| CommandError::invalid("ファイルの場所を解釈できませんでした"))?;

    open_path(&app, path).map(Some)
}

/// 保存済みのパスを開き直す。起動時の復元に使う。
///
/// スコープの許可はプロセスごとに消えるため、読み込む前に毎回通す。
#[tauri::command]
pub fn motion_open(app: AppHandle, path: String) -> Result<MotionHandle> {
    open_path(&app, PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;

    #[test]
    fn vrma_を受け付ける() {
        let handle = build_handle(Path::new("C:/motions/wave.vrma")).unwrap();
        assert_eq!(handle.path, "C:/motions/wave.vrma");
        assert_eq!(handle.name, "wave");
    }

    #[test]
    fn 拡張子の大小を問わない() {
        assert!(build_handle(Path::new("a.VRMA")).is_ok());
    }

    #[test]
    fn 表示名は拡張子を落とす() {
        // 利用者はタグ名とは別に「どのファイルか」を見分けたい
        let handle = build_handle(Path::new("C:/motions/手を振る.vrma")).unwrap();
        assert_eq!(handle.name, "手を振る");
    }

    #[test]
    fn vrma_以外を断る() {
        for name in ["a.vrm", "a.vmd", "a.fbx", "a.glb", "a"] {
            let error = build_handle(Path::new(name)).unwrap_err();
            assert_eq!(error.kind, CommandErrorKind::Invalid, "{name}");
        }
    }

    #[test]
    fn 先頭が点だけの名前は拡張子と見なさない() {
        // ".vrma" は隠しファイルの名前であって、拡張子を持たない
        assert!(build_handle(Path::new(".vrma")).is_err());
    }
}
