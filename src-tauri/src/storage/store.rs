//! ファイルによる永続化 (ADR-0010)。
//!
//! 配置:
//! ```text
//! {root}/
//! ├─ settings.json
//! ├─ providers.json
//! ├─ characters/{id}.json
//! └─ conversations/
//!    ├─ index.json          一覧表示用。全会話を読まずに済ませる
//!    └─ {id}.json           本体
//! ```

use std::fs;
use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Serialize};

use super::atomic::write_atomic;
use super::models::{
    CharacterProfile, Conversation, ConversationSummary, ProviderProfile, Settings,
};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("ファイルの読み書きに失敗しました")]
    Io(#[from] std::io::Error),

    #[error("保存されたデータを読み取れません。ファイルが壊れている可能性があります")]
    Corrupt(#[source] serde_json::Error),

    #[error("見つかりません")]
    NotFound,

    #[error("{0}")]
    Conflict(String),
}

type Result<T> = std::result::Result<T, StorageError>;

pub struct FileStore {
    root: PathBuf,
}

impl FileStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn settings_path(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    fn providers_path(&self) -> PathBuf {
        self.root.join("providers.json")
    }

    fn characters_dir(&self) -> PathBuf {
        self.root.join("characters")
    }

    fn character_path(&self, id: &str) -> PathBuf {
        self.characters_dir().join(format!("{id}.json"))
    }

    fn conversations_dir(&self) -> PathBuf {
        self.root.join("conversations")
    }

    fn conversation_path(&self, id: &str) -> PathBuf {
        self.conversations_dir().join(format!("{id}.json"))
    }

    fn conversation_index_path(&self) -> PathBuf {
        self.conversations_dir().join("index.json")
    }

    /// ファイルが無ければ既定値を返す。壊れていればエラーにする。
    ///
    /// 「無い」と「壊れている」を混同して既定値へ倒すと、利用者の設定が
    /// 黙って消えたように見える。
    fn read_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T> {
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(StorageError::Corrupt),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
            Err(err) => Err(StorageError::Io(err)),
        }
    }

    fn read_required<T: DeserializeOwned>(path: &Path) -> Result<T> {
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(StorageError::Corrupt),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Err(StorageError::NotFound),
            Err(err) => Err(StorageError::Io(err)),
        }
    }

    fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(value).map_err(StorageError::Corrupt)?;
        write_atomic(path, &bytes)?;
        Ok(())
    }

    // --- 設定 ---

    pub fn load_settings(&self) -> Result<Settings> {
        Self::read_or_default(&self.settings_path())
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        Self::write_json(&self.settings_path(), settings)
    }

    // --- プロバイダプロファイル ---

    pub fn list_providers(&self) -> Result<Vec<ProviderProfile>> {
        Self::read_or_default(&self.providers_path())
    }

    pub fn upsert_provider(&self, profile: &ProviderProfile) -> Result<()> {
        let mut providers = self.list_providers()?;
        match providers.iter_mut().find(|item| item.id == profile.id) {
            Some(existing) => *existing = profile.clone(),
            None => providers.push(profile.clone()),
        }
        Self::write_json(&self.providers_path(), &providers)
    }

    /// 参照しているキャラクターがあれば削除させない (IPC 契約 C-4)。
    ///
    /// 消せてしまうと、キャラクターが存在しないプロバイダを指したまま
    /// 残り、送信時になって初めて失敗する。
    pub fn delete_provider(&self, id: &str) -> Result<()> {
        let referencing: Vec<String> = self
            .list_characters()?
            .into_iter()
            .filter(|character| character.provider_id == id)
            .map(|character| character.name)
            .collect();

        if !referencing.is_empty() {
            return Err(StorageError::Conflict(format!(
                "このプロバイダは {} から参照されています。先に切り替えてください",
                referencing.join("、")
            )));
        }

        let providers: Vec<ProviderProfile> = self
            .list_providers()?
            .into_iter()
            .filter(|provider| provider.id != id)
            .collect();
        Self::write_json(&self.providers_path(), &providers)
    }

    // --- キャラクタープロファイル ---

    pub fn list_characters(&self) -> Result<Vec<CharacterProfile>> {
        let dir = self.characters_dir();
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(StorageError::Io(err)),
        };

        let mut characters = Vec::new();
        for entry in entries.filter_map(std::result::Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            characters.push(Self::read_required::<CharacterProfile>(&path)?);
        }
        characters.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(characters)
    }

    pub fn get_character(&self, id: &str) -> Result<CharacterProfile> {
        Self::read_required(&self.character_path(id))
    }

    pub fn upsert_character(&self, profile: &CharacterProfile) -> Result<()> {
        Self::write_json(&self.character_path(&profile.id), profile)
    }

    pub fn delete_character(&self, id: &str) -> Result<()> {
        match fs::remove_file(self.character_path(id)) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(StorageError::Io(err)),
        }

        // 会話も一緒に片付ける。参照先の無い会話が残らないように。
        let remaining: Vec<ConversationSummary> = self
            .conversation_index()?
            .into_iter()
            .filter(|summary| {
                if summary.character_id == id {
                    let _ = fs::remove_file(self.conversation_path(&summary.id));
                    false
                } else {
                    true
                }
            })
            .collect();
        Self::write_json(&self.conversation_index_path(), &remaining)
    }

    // --- 会話 ---

    fn conversation_index(&self) -> Result<Vec<ConversationSummary>> {
        Self::read_or_default(&self.conversation_index_path())
    }

    pub fn list_conversations(
        &self,
        character_id: Option<&str>,
    ) -> Result<Vec<ConversationSummary>> {
        let mut summaries = self.conversation_index()?;
        if let Some(character_id) = character_id {
            summaries.retain(|summary| summary.character_id == character_id);
        }
        // 新しい順
        summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(summaries)
    }

    pub fn get_conversation(&self, id: &str) -> Result<Conversation> {
        Self::read_required(&self.conversation_path(id))
    }

    pub fn save_conversation(&self, conversation: &Conversation) -> Result<()> {
        Self::write_json(&self.conversation_path(&conversation.id), conversation)?;

        let summary = ConversationSummary::from(conversation);
        let mut index = self.conversation_index()?;
        match index.iter_mut().find(|item| item.id == summary.id) {
            Some(existing) => *existing = summary,
            None => index.push(summary),
        }
        Self::write_json(&self.conversation_index_path(), &index)
    }

    pub fn delete_conversation(&self, id: &str) -> Result<()> {
        match fs::remove_file(self.conversation_path(id)) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(StorageError::Io(err)),
        }
        let index: Vec<ConversationSummary> = self
            .conversation_index()?
            .into_iter()
            .filter(|summary| summary.id != id)
            .collect();
        Self::write_json(&self.conversation_index_path(), &index)
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use crate::llm::http::ProviderKind;
    use crate::storage::models::{
        now_rfc3339, EmotionMode, IdleSettings, Message, MessageRole, SCHEMA_VERSION,
    };

    fn store() -> (tempfile::TempDir, FileStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::new(dir.path());
        (dir, store)
    }

    fn provider(id: &str) -> ProviderProfile {
        ProviderProfile {
            id: id.to_owned(),
            name: format!("プロファイル {id}"),
            kind: ProviderKind::OpenaiCompatible,
            base_url: "http://localhost:11434".to_owned(),
            model: "llama3.2".to_owned(),
            temperature: None,
            top_p: None,
            max_tokens: Some(1024),
            emotion_mode: EmotionMode::Tag,
            context_budget_tokens: None,
        }
    }

    fn character(id: &str, provider_id: &str) -> CharacterProfile {
        CharacterProfile {
            id: id.to_owned(),
            name: format!("キャラクター {id}"),
            model_path: None,
            model_format: None,
            system_prompt: "あなたは倉本千奈です".to_owned(),
            provider_id: provider_id.to_owned(),
            camera_preset: None,
            idle_settings: IdleSettings::default(),
            emotion_mapping: None,
            voice_settings: None,
            gestures: Vec::new(),
            schema_version: SCHEMA_VERSION,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        }
    }

    fn conversation(id: &str, character_id: &str, updated_at: &str) -> Conversation {
        Conversation {
            id: id.to_owned(),
            character_id: character_id.to_owned(),
            title: format!("会話 {id}"),
            messages: vec![Message {
                role: MessageRole::User,
                content: "こんにちは".to_owned(),
                raw_content: None,
                emotions: None,
                created_at: now_rfc3339(),
                model: None,
            }],
            schema_version: SCHEMA_VERSION,
            created_at: now_rfc3339(),
            updated_at: updated_at.to_owned(),
        }
    }

    #[test]
    fn 設定は無ければ既定値を返す() {
        let (_dir, store) = store();
        assert_eq!(store.load_settings().unwrap(), Settings::default());
    }

    #[test]
    fn 設定を保存して読み戻せる() {
        let (_dir, store) = store();
        let settings = Settings {
            show_viewer: false,
            active_character_id: Some("ch1".to_owned()),
            ..Settings::default()
        };
        store.save_settings(&settings).unwrap();
        assert_eq!(store.load_settings().unwrap(), settings);
    }

    #[test]
    fn 壊れたファイルは既定値へ倒さずエラーにする() {
        let (dir, store) = store();
        fs::write(dir.path().join("settings.json"), "{壊れている").unwrap();
        assert!(matches!(
            store.load_settings(),
            Err(StorageError::Corrupt(_))
        ));
    }

    #[test]
    fn プロバイダを追加と更新できる() {
        let (_dir, store) = store();
        store.upsert_provider(&provider("p1")).unwrap();
        store.upsert_provider(&provider("p2")).unwrap();
        assert_eq!(store.list_providers().unwrap().len(), 2);

        let mut updated = provider("p1");
        updated.model = "qwen2.5".to_owned();
        store.upsert_provider(&updated).unwrap();

        let providers = store.list_providers().unwrap();
        assert_eq!(providers.len(), 2, "重複して増えている");
        assert_eq!(
            providers.iter().find(|p| p.id == "p1").unwrap().model,
            "qwen2.5"
        );
    }

    #[test]
    fn 参照されていないプロバイダは削除できる() {
        let (_dir, store) = store();
        store.upsert_provider(&provider("p1")).unwrap();
        store.delete_provider("p1").unwrap();
        assert!(store.list_providers().unwrap().is_empty());
    }

    #[test]
    fn 参照されているプロバイダは削除できない() {
        // IPC 契約 C-4
        let (_dir, store) = store();
        store.upsert_provider(&provider("p1")).unwrap();
        store.upsert_character(&character("ch1", "p1")).unwrap();

        let error = store.delete_provider("p1").unwrap_err();
        match error {
            StorageError::Conflict(message) => {
                assert!(message.contains("キャラクター ch1"), "実際: {message}")
            }
            other => panic!("想定外: {other:?}"),
        }
        assert_eq!(
            store.list_providers().unwrap().len(),
            1,
            "消えてしまっている"
        );
    }

    #[test]
    fn キャラクターを保存して取得できる() {
        let (_dir, store) = store();
        let profile = character("ch1", "p1");
        store.upsert_character(&profile).unwrap();
        assert_eq!(store.get_character("ch1").unwrap(), profile);
    }

    #[test]
    fn 存在しないキャラクターは_NotFound() {
        let (_dir, store) = store();
        assert!(matches!(
            store.get_character("none"),
            Err(StorageError::NotFound)
        ));
    }

    #[test]
    fn キャラクター一覧は名前順になる() {
        let (_dir, store) = store();
        let mut b = character("b", "p1");
        b.name = "いろは".to_owned();
        let mut a = character("a", "p1");
        a.name = "あさひ".to_owned();
        store.upsert_character(&b).unwrap();
        store.upsert_character(&a).unwrap();

        let names: Vec<_> = store
            .list_characters()
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, vec!["あさひ", "いろは"]);
    }

    #[test]
    fn キャラクターが無ければ空を返す() {
        let (_dir, store) = store();
        assert!(store.list_characters().unwrap().is_empty());
    }

    #[test]
    fn 会話を保存すると一覧にも載る() {
        let (_dir, store) = store();
        store
            .save_conversation(&conversation("c1", "ch1", "2026-08-29T00:00:00Z"))
            .unwrap();

        let summaries = store.list_conversations(None).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].message_count, 1);
        assert_eq!(summaries[0].title, "会話 c1");
    }

    #[test]
    fn 会話一覧は新しい順になる() {
        let (_dir, store) = store();
        store
            .save_conversation(&conversation("old", "ch1", "2026-08-01T00:00:00Z"))
            .unwrap();
        store
            .save_conversation(&conversation("new", "ch1", "2026-08-29T00:00:00Z"))
            .unwrap();

        let ids: Vec<_> = store
            .list_conversations(None)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, vec!["new", "old"]);
    }

    #[test]
    fn 会話一覧をキャラクターで絞り込める() {
        let (_dir, store) = store();
        store
            .save_conversation(&conversation("c1", "ch1", "2026-08-29T00:00:00Z"))
            .unwrap();
        store
            .save_conversation(&conversation("c2", "ch2", "2026-08-29T00:00:00Z"))
            .unwrap();

        assert_eq!(store.list_conversations(Some("ch1")).unwrap().len(), 1);
        assert_eq!(store.list_conversations(None).unwrap().len(), 2);
    }

    #[test]
    fn 会話を更新しても一覧が重複しない() {
        let (_dir, store) = store();
        let mut c = conversation("c1", "ch1", "2026-08-29T00:00:00Z");
        store.save_conversation(&c).unwrap();

        c.messages.push(Message {
            role: MessageRole::Assistant,
            content: "ごきげんよう".to_owned(),
            raw_content: Some("[happy]ごきげんよう".to_owned()),
            emotions: None,
            created_at: now_rfc3339(),
            model: None,
        });
        store.save_conversation(&c).unwrap();

        let summaries = store.list_conversations(None).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].message_count, 2);
    }

    #[test]
    fn 会話を削除すると一覧からも消える() {
        let (_dir, store) = store();
        store
            .save_conversation(&conversation("c1", "ch1", "2026-08-29T00:00:00Z"))
            .unwrap();
        store.delete_conversation("c1").unwrap();

        assert!(store.list_conversations(None).unwrap().is_empty());
        assert!(matches!(
            store.get_conversation("c1"),
            Err(StorageError::NotFound)
        ));
        // 冪等
        store.delete_conversation("c1").unwrap();
    }

    #[test]
    fn キャラクターを消すとその会話も片付く() {
        let (_dir, store) = store();
        store.upsert_character(&character("ch1", "p1")).unwrap();
        store
            .save_conversation(&conversation("c1", "ch1", "2026-08-29T00:00:00Z"))
            .unwrap();
        store
            .save_conversation(&conversation("c2", "ch2", "2026-08-29T00:00:00Z"))
            .unwrap();

        store.delete_character("ch1").unwrap();

        let remaining = store.list_conversations(None).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "c2");
        assert!(matches!(
            store.get_conversation("c1"),
            Err(StorageError::NotFound)
        ));
    }

    #[test]
    fn 保存されるファイルは整形された_json() {
        let (dir, store) = store();
        store.save_settings(&Settings::default()).unwrap();
        let text = fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(text.contains('\n'), "1 行に潰れていて差分が読みにくい");
    }
}
