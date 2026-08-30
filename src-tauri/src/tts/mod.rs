//! 音声合成 (要件 P2、ADR-0011 と同じくローカルの別プロセスへ繋ぐ)。
//!
//! VOICEVOX と CeVIO (shirataki 経由) は感情の表し方が根本的に違う。
//! 前者は話者ごとのスタイル選択、後者は成分ごとの数値。差異はこの
//! モジュールに閉じ込め、呼び出し側は正規化感情だけを扱う。

pub mod blend;
pub mod error;
pub mod http;
pub mod shirataki;
pub mod types;
pub mod voicevox;
