//! モデルファイルの選択と検証 (要件 F-01)。
//!
//! **ファイルの中身は IPC で運ばない。** 60MB の VRM を base64 で往復
//! させるとメモリと時間の二重払いになる。パスをアセットプロトコルの
//! スコープへ登録し、three.js のローダーが WebView 側で直接取得する
//! (docs/ipc-contract.md 2.5)。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::storage::models::ModelFormat;

use super::error::{CommandError, CommandErrorKind};

type Result<T> = std::result::Result<T, CommandError>;

/// これを超えたら警告する (要件 R-4、未決事項 U-10)。読み込みは妨げない。
pub const OVERSIZE_THRESHOLD_BYTES: u64 = 150 * 1024 * 1024;

/// PMX に対応済み。0.3 で `PmxAdapter` を入れた (ADR-0004)。
const PMX_SUPPORTED: bool = true;

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelHandle {
    /// 絶対パス。フロントが convertFileSrc に渡す。
    pub path: String,
    pub format: ModelFormat,
    /// バイト数。JSON の数値は f64 なので、そのまま表せる形にしておく。
    pub size_bytes: f64,
    pub oversized: bool,
}

/// 拡張子から形式を決める。
pub fn classify_extension(path: &Path) -> Result<ModelFormat> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);

    match extension.as_deref() {
        Some("vrm") => Ok(ModelFormat::Vrm),
        Some("pmx") => Ok(ModelFormat::Pmx),
        _ => Err(CommandError::invalid(
            "対応していない形式です。.vrm ファイルを選んでください",
        )),
    }
}

/// パスとサイズから ModelHandle を組み立てる。
///
/// ファイルシステムに触れないので単体でテストできる。
pub fn build_handle(path: &Path, size_bytes: u64) -> Result<ModelHandle> {
    let format = classify_extension(path)?;

    if format == ModelFormat::Pmx && !PMX_SUPPORTED {
        return Err(CommandError::invalid(
            "PMX は現在のバージョンでは読み込めません。VRM をお使いください",
        ));
    }

    Ok(ModelHandle {
        path: path.to_string_lossy().into_owned(),
        format,
        size_bytes: size_bytes as f64,
        oversized: size_bytes > OVERSIZE_THRESHOLD_BYTES,
    })
}

/// 実ファイルを検証し、アセットプロトコルのスコープへ登録する。
fn open_path(app: &AppHandle, path: PathBuf) -> Result<ModelHandle> {
    let metadata = std::fs::metadata(&path).map_err(|err| {
        tracing::debug!(target: "moca::commands", error = ?err, "モデルの情報を取得できない");
        CommandError::new(
            CommandErrorKind::Io,
            "ファイルを読み取れません。移動または削除されていないか確認してください",
        )
    })?;

    if !metadata.is_file() {
        return Err(CommandError::invalid("ファイルを選んでください"));
    }

    let handle = build_handle(&path, metadata.len())?;

    grant_access(app, &path, handle.format)?;

    tracing::info!(
        target: "moca::commands",
        format = ?handle.format,
        // バイト数は整数で出す。f64 のまま出すと 31209924.0 になって読みにくい
        size = handle.size_bytes as u64,
        "モデルを開いた"
    );
    Ok(handle)
}

/// 読み込みに必要な範囲だけアクセスを許す。
///
/// VRM は 1 ファイルにテクスチャを内包するので、そのファイルだけでよい。
/// PMX はテクスチャを外部ファイルとして相対パスで参照するため、モデルの
/// あるディレクトリを許可しないと絵が出ない。必要最小限にするため、
/// 親ディレクトリまでに留めて上位へは広げない。
fn grant_access(app: &AppHandle, path: &Path, format: ModelFormat) -> Result<()> {
    let scope = app.asset_protocol_scope();

    let granted = match format {
        ModelFormat::Vrm => scope.allow_file(path),
        ModelFormat::Pmx => match path.parent() {
            Some(dir) => {
                tracing::debug!(
                    target: "moca::commands",
                    dir = %dir.display(),
                    "PMX のテクスチャのためディレクトリを許可する"
                );
                scope.allow_directory(dir, true)
            }
            None => scope.allow_file(path),
        },
    };

    granted.map_err(|err| {
        tracing::debug!(target: "moca::commands", error = ?err, "スコープ登録に失敗");
        CommandError::new(
            CommandErrorKind::Io,
            "ファイルへのアクセスを許可できませんでした",
        )
    })
}

/// ネイティブのファイルダイアログを開く。選ばなければ None。
#[tauri::command]
pub async fn model_pick(app: AppHandle) -> Result<Option<ModelHandle>> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .add_filter("モデル", &["vrm", "pmx"])
        .add_filter("VRM モデル", &["vrm"])
        .add_filter("PMX モデル", &["pmx"])
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

/// ドラッグ＆ドロップや前回のパスの復元に使う。
#[tauri::command]
pub fn model_open(app: AppHandle, path: String) -> Result<ModelHandle> {
    open_path(&app, PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;

    #[test]
    fn vrm_を受け付ける() {
        let handle = build_handle(Path::new("C:/models/china.vrm"), 42).unwrap();
        assert_eq!(handle.format, ModelFormat::Vrm);
        assert_eq!(handle.size_bytes, 42.0);
        assert!(!handle.oversized);
    }

    #[test]
    fn 拡張子の大小を問わない() {
        assert_eq!(
            classify_extension(Path::new("a.VRM")).unwrap(),
            ModelFormat::Vrm
        );
    }

    #[test]
    fn pmx_を受け付ける() {
        let handle = build_handle(Path::new("C:/models/china.pmx"), 42).unwrap();
        assert_eq!(handle.format, ModelFormat::Pmx);
    }

    #[test]
    fn 未対応の拡張子を断る() {
        for name in ["a.glb", "a.fbx", "a.pmd", "a.txt", "a"] {
            let error = build_handle(Path::new(name), 1).unwrap_err();
            assert_eq!(error.kind, CommandErrorKind::Invalid, "{name}");
        }
    }

    #[test]
    fn 閾値を超えたら警告を立てるが失敗はしない() {
        let handle = build_handle(Path::new("big.vrm"), OVERSIZE_THRESHOLD_BYTES + 1).unwrap();
        assert!(handle.oversized);
    }

    #[test]
    fn 閾値ちょうどは警告しない() {
        let handle = build_handle(Path::new("a.vrm"), OVERSIZE_THRESHOLD_BYTES).unwrap();
        assert!(!handle.oversized);
    }

    #[test]
    fn パスをそのまま返す() {
        let handle = build_handle(Path::new("C:/モデル/千奈.vrm"), 1).unwrap();
        assert!(handle.path.contains("千奈.vrm"));
    }

    #[test]
    fn 大きなサイズも数値として表せる() {
        // JSON の数値は f64。2^53 まで正確なのでバイト数には十分。
        let handle = build_handle(Path::new("a.vrm"), 8_000_000_000).unwrap();
        assert_eq!(handle.size_bytes, 8_000_000_000.0);
    }
}
