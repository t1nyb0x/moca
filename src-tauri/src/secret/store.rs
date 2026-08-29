//! 機密の保管先 (要件 F-11)。
//!
//! 本番は Windows 資格情報マネージャー。テストではインメモリ実装へ
//! 差し替える。テストが実際の資格情報ストアを汚さないようにするため。

use std::collections::HashMap;
use std::sync::Mutex;

use super::Secret;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("資格情報の保存に失敗しました")]
    Backend(#[source] Box<dyn std::error::Error + Send + Sync>),
    #[error("資格情報の名前が不正です")]
    InvalidRef,
}

pub trait SecretStore: Send + Sync {
    fn set(&self, key_ref: &str, secret: &Secret) -> Result<(), SecretError>;
    fn get(&self, key_ref: &str) -> Result<Option<Secret>, SecretError>;
    fn delete(&self, key_ref: &str) -> Result<(), SecretError>;
}

/// プロバイダプロファイルの id から資格情報の名前を作る。
pub fn provider_key_ref(provider_id: &str) -> String {
    format!("provider:{provider_id}")
}

/// Windows 資格情報マネージャーを使う本番実装。
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, key_ref: &str) -> Result<keyring::Entry, SecretError> {
        if key_ref.is_empty() {
            return Err(SecretError::InvalidRef);
        }
        keyring::Entry::new(&self.service, key_ref)
            .map_err(|err| SecretError::Backend(Box::new(err)))
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, key_ref: &str, secret: &Secret) -> Result<(), SecretError> {
        self.entry(key_ref)?
            .set_password(secret.expose())
            .map_err(|err| SecretError::Backend(Box::new(err)))
    }

    fn get(&self, key_ref: &str) -> Result<Option<Secret>, SecretError> {
        match self.entry(key_ref)?.get_password() {
            Ok(value) => Ok(Some(Secret::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(SecretError::Backend(Box::new(err))),
        }
    }

    fn delete(&self, key_ref: &str) -> Result<(), SecretError> {
        match self.entry(key_ref)?.delete_credential() {
            // 無いものを消せたことにするのは呼び出し側にとって都合がよい
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(SecretError::Backend(Box::new(err))),
        }
    }
}

/// テスト用のインメモリ実装。
#[derive(Debug, Default)]
pub struct MemorySecretStore {
    entries: Mutex<HashMap<String, String>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.entries.lock().expect("poisoned").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl SecretStore for MemorySecretStore {
    fn set(&self, key_ref: &str, secret: &Secret) -> Result<(), SecretError> {
        if key_ref.is_empty() {
            return Err(SecretError::InvalidRef);
        }
        self.entries
            .lock()
            .expect("poisoned")
            .insert(key_ref.to_owned(), secret.expose().to_owned());
        Ok(())
    }

    fn get(&self, key_ref: &str) -> Result<Option<Secret>, SecretError> {
        Ok(self
            .entries
            .lock()
            .expect("poisoned")
            .get(key_ref)
            .map(Secret::new))
    }

    fn delete(&self, key_ref: &str) -> Result<(), SecretError> {
        self.entries.lock().expect("poisoned").remove(key_ref);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn 一通りの操作ができる(store: &dyn SecretStore) {
        let key_ref = provider_key_ref("abc");

        assert!(store.get(&key_ref).unwrap().is_none(), "初期状態では空");

        store.set(&key_ref, &Secret::new("sk-test-1")).unwrap();
        assert_eq!(store.get(&key_ref).unwrap().unwrap().expose(), "sk-test-1");

        // 上書きできる
        store.set(&key_ref, &Secret::new("sk-test-2")).unwrap();
        assert_eq!(store.get(&key_ref).unwrap().unwrap().expose(), "sk-test-2");

        store.delete(&key_ref).unwrap();
        assert!(store.get(&key_ref).unwrap().is_none());

        // 無いものの削除は成功扱い
        store.delete(&key_ref).unwrap();
    }

    #[test]
    fn インメモリ実装が契約を満たす() {
        一通りの操作ができる(&MemorySecretStore::new());
    }

    #[test]
    fn 名前が空なら拒否する() {
        let store = MemorySecretStore::new();
        assert!(matches!(
            store.set("", &Secret::new("x")),
            Err(SecretError::InvalidRef)
        ));
    }

    #[test]
    fn プロバイダの資格情報名が_id_から決まる() {
        assert_eq!(provider_key_ref("abc-123"), "provider:abc-123");
    }

    #[test]
    fn 別の名前は互いに干渉しない() {
        let store = MemorySecretStore::new();
        store.set("a", &Secret::new("1")).unwrap();
        store.set("b", &Secret::new("2")).unwrap();
        assert_eq!(store.get("a").unwrap().unwrap().expose(), "1");
        assert_eq!(store.get("b").unwrap().unwrap().expose(), "2");
        store.delete("a").unwrap();
        assert!(store.get("b").unwrap().is_some());
    }

    #[test]
    fn エラー表示に機密が現れない() {
        let error = SecretError::Backend(Box::new(std::io::Error::other("sk-leak")));
        // source には残るが、表示用の文言には出さない
        assert!(!error.to_string().contains("sk-leak"));
    }

    /// 実際の資格情報マネージャーを触るので既定では走らせない。
    /// 手元で確認する場合は `cargo test -- --ignored` で実行する。
    #[test]
    #[ignore = "OS の資格情報ストアを変更するため"]
    fn keyring_実装が契約を満たす() {
        一通りの操作ができる(&KeyringStore::new("moca-test"));
    }
}
