//! 機密文字列の型による保護 (ADR-0011)。

pub mod store;

use std::fmt;

/// API キーのような機密文字列。
///
/// `Debug` と `Display` を秘匿してあるため、この型を含む構造体に
/// `#[derive(Debug)]` を付けてもキーが漏れない。「ログに出さないよう
/// 気をつける」という規約は必ず破られるので、型で塞ぐ。
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// 中身を取り出す唯一の口。
    ///
    /// 呼び出し箇所を grep で監査できるよう、あえて目立つ名前にしてある。
    /// HTTP ヘッダの組み立て以外で使ってはならない。
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([REDACTED])")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl From<String> for Secret {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for Secret {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "sk-ant-super-secret-value";

    #[test]
    fn debug_出力に中身が現れない() {
        let secret = Secret::new(KEY);
        let rendered = format!("{secret:?}");
        assert!(!rendered.contains(KEY));
        assert_eq!(rendered, "Secret([REDACTED])");
    }

    #[test]
    fn display_出力に中身が現れない() {
        let secret = Secret::new(KEY);
        assert!(!format!("{secret}").contains(KEY));
    }

    #[test]
    fn 構造体に埋め込んでも漏れない() {
        // これが Secret を型にした本来の目的。derive(Debug) が自動的に安全になる。
        #[derive(Debug)]
        #[allow(dead_code)]
        struct Profile {
            name: String,
            api_key: Secret,
        }

        let profile = Profile {
            name: "本番".to_owned(),
            api_key: Secret::new(KEY),
        };
        let rendered = format!("{profile:?}");
        assert!(!rendered.contains(KEY), "実際の出力: {rendered}");
        assert!(rendered.contains("本番"));
    }

    #[test]
    fn expose_で中身を取り出せる() {
        assert_eq!(Secret::new(KEY).expose(), KEY);
    }

    #[test]
    fn 空判定ができる() {
        assert!(Secret::new("").is_empty());
        assert!(!Secret::new(KEY).is_empty());
    }
}
