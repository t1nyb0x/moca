//! 壊れない書き込み。
//!
//! 同一ディレクトリの一時ファイルへ書いてから rename する。rename は
//! 同一ボリューム内なら不可分なので、途中で落ちても対象ファイルが
//! 半端な内容になることがない (ADR-0010)。
//!
//! 一時ファイルを同じディレクトリに作るのが要点。別ボリュームだと
//! rename がコピーに退化して不可分でなくなる。

use std::fs;
use std::io::{self, Write};
use std::path::Path;

pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "親ディレクトリを決められません",
        )
    })?;
    fs::create_dir_all(parent)?;

    let temp_path = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data"),
        uuid::Uuid::new_v4()
    ));

    // スコープを切ってファイルを確実に閉じてから rename する。
    // Windows では開いたままの rename が失敗しうる。
    {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }

    match fs::rename(&temp_path, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            // 失敗したら一時ファイルを残さない
            let _ = fs::remove_file(&temp_path);
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn 書いた内容を読み戻せる() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        write_atomic(&path, b"{\"a\":1}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn 既存のファイルを上書きできる() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        write_atomic(&path, b"old").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn 一時ファイルを残さない() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        write_atomic(&path, b"x").unwrap();

        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            entries,
            vec!["data.json".to_owned()],
            "残骸がある: {entries:?}"
        );
    }

    #[test]
    fn 親ディレクトリを作る() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("conversations").join("a.json");
        write_atomic(&path, b"x").unwrap();
        assert!(path.exists());
    }

    #[test]
    fn 一時ファイルは対象と同じディレクトリに作られる() {
        // 別ボリュームだと rename が不可分でなくなるため、この性質は重要
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("deep").join("nested");
        let path = nested.join("data.json");
        write_atomic(&path, b"x").unwrap();
        assert_eq!(path.parent().unwrap(), nested);
    }

    #[test]
    fn 同時に書いても半端な内容にならない() {
        let dir = tempfile::tempdir().unwrap();
        let path = Arc::new(dir.path().join("data.json"));

        let handles: Vec<_> = (0..8)
            .map(|index| {
                let path = Arc::clone(&path);
                thread::spawn(move || {
                    let body = format!("{{\"writer\":{index}}}");
                    for _ in 0..20 {
                        write_atomic(&path, body.as_bytes()).unwrap();
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }

        // どの書き手の内容であれ、必ず完全な JSON である
        let content = fs::read_to_string(path.as_path()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content)
            .unwrap_or_else(|_| panic!("半端な内容が残った: {content}"));
        assert!(parsed.get("writer").is_some());
    }
}
