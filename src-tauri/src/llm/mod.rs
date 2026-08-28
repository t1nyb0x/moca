//! LLM プロバイダとの通信。
//!
//! OpenAI 互換 / Anthropic / Gemini の差異はすべてこのモジュールに閉じる
//! (ADR-0002)。差異の一覧は docs/ipc-contract.md 7.4 を参照。

pub mod anthropic;
pub mod decode;
pub mod error;
pub mod gemini;
pub mod openai;
pub mod sse;
pub mod stream;
pub mod types;
