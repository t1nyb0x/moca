//! VOICEVOX (既定 http://localhost:50021)。
//!
//! 感情は「スタイル」の選択で表す。数値の成分は無い。足りないぶんは
//! 速さ・高さ・抑揚の調整で補う (docs/emotion-protocol.md 5.2)。
//!
//! 合成は 2 段階。`/audio_query` で問い合わせを作り、必要な調整を加えて
//! から `/synthesis` へ渡す。

use serde_json::Value;

use super::types::{SpeakerInfo, StyleInfo, VoicePreset};

/// VOICEVOX が受け付ける範囲。外れると 422 が返る。
const SPEED_RANGE: (f64, f64) = (0.5, 2.0);
const PITCH_RANGE: (f64, f64) = (-0.15, 0.15);
const INTONATION_RANGE: (f64, f64) = (0.0, 2.0);

fn clamp(value: f64, range: (f64, f64)) -> f64 {
    value.max(range.0).min(range.1)
}

/// 問い合わせへ声の調整を書き込む。
///
/// 指定の無い項目には触らない。VOICEVOX が話者ごとに用意した既定値を
/// 尊重するため。
pub fn apply_preset(query: &mut Value, preset: &VoicePreset) {
    if let Some(speed) = preset.speed {
        query["speedScale"] = Value::from(clamp(speed, SPEED_RANGE));
    }
    if let Some(pitch) = preset.pitch {
        // 単位が違う。こちらは半音に近い尺度で、幅も狭い。
        query["pitchScale"] = Value::from(clamp(pitch * PITCH_RANGE.1, PITCH_RANGE));
    }
    if let Some(intonation) = preset.intonation {
        query["intonationScale"] = Value::from(clamp(intonation, INTONATION_RANGE));
    }
}

/// `GET /speakers` の応答から話者を取り出す。
///
/// 合成時に指定するのはスタイルの id なので、スタイルを持たない話者は
/// 使えない。落として構わない。
pub fn speakers_from_json(value: &Value) -> Vec<SpeakerInfo> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let name = item.get("name").and_then(Value::as_str)?;
            let styles: Vec<StyleInfo> = item
                .get("styles")
                .and_then(Value::as_array)
                .map(|styles| {
                    styles
                        .iter()
                        .filter_map(|style| {
                            let id = style.get("id").and_then(Value::as_i64)?;
                            let style_name = style.get("name").and_then(Value::as_str)?;
                            Some(StyleInfo {
                                id: id.to_string(),
                                name: style_name.to_owned(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            if styles.is_empty() {
                return None;
            }

            Some(SpeakerInfo {
                // 既定として使えるよう、先頭のスタイルを話者の id にする
                id: styles[0].id.clone(),
                name: name.to_owned(),
                styles,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn query() -> Value {
        json!({ "speedScale": 1.0, "pitchScale": 0.0, "intonationScale": 1.0 })
    }

    #[test]
    fn 指定の無い項目には触らない() {
        // 話者ごとの既定値を尊重する
        let mut q = query();
        apply_preset(&mut q, &VoicePreset::default());
        assert_eq!(q, query());
    }

    #[test]
    fn 速さを書き込む() {
        let mut q = query();
        apply_preset(
            &mut q,
            &VoicePreset {
                speed: Some(1.3),
                ..VoicePreset::default()
            },
        );
        assert_eq!(q["speedScale"], 1.3);
    }

    #[test]
    fn 高さは狭い尺度へ直す() {
        // 単位が違う。1.0 をそのまま渡すと範囲外になる。
        let mut q = query();
        apply_preset(
            &mut q,
            &VoicePreset {
                pitch: Some(1.0),
                ..VoicePreset::default()
            },
        );
        assert_eq!(q["pitchScale"], 0.15);
    }

    #[test]
    fn 範囲を超えた値を丸める() {
        // 外れると 422 が返る
        let mut q = query();
        apply_preset(
            &mut q,
            &VoicePreset {
                speed: Some(9.0),
                pitch: Some(9.0),
                intonation: Some(9.0),
                ..VoicePreset::default()
            },
        );
        assert_eq!(q["speedScale"], 2.0);
        assert_eq!(q["pitchScale"], 0.15);
        assert_eq!(q["intonationScale"], 2.0);

        let mut low = query();
        apply_preset(
            &mut low,
            &VoicePreset {
                speed: Some(-1.0),
                pitch: Some(-9.0),
                intonation: Some(-1.0),
                ..VoicePreset::default()
            },
        );
        assert_eq!(low["speedScale"], 0.5);
        assert_eq!(low["pitchScale"], -0.15);
        assert_eq!(low["intonationScale"], 0.0);
    }

    #[test]
    fn 話者とスタイルを取り出す() {
        let value = json!([
            {
                "name": "四国めたん",
                "speaker_uuid": "abc",
                "styles": [
                    { "name": "ノーマル", "id": 2, "type": "talk" },
                    { "name": "あまあま", "id": 0, "type": "talk" }
                ]
            }
        ]);
        let speakers = speakers_from_json(&value);
        assert_eq!(speakers.len(), 1);
        assert_eq!(speakers[0].name, "四国めたん");
        assert_eq!(speakers[0].id, "2", "先頭のスタイルを既定にする");
        assert_eq!(speakers[0].styles.len(), 2);
        assert_eq!(speakers[0].styles[1].name, "あまあま");
    }

    #[test]
    fn スタイルを持たない話者は落とす() {
        // 合成時に指定するのはスタイルの id なので使えない
        let value = json!([{ "name": "誰か", "styles": [] }]);
        assert!(speakers_from_json(&value).is_empty());
    }

    #[test]
    fn 想定外の応答でも壊れない() {
        assert!(speakers_from_json(&json!({})).is_empty());
        assert!(speakers_from_json(&json!([{ "styles": [{ "id": 1 }] }])).is_empty());
    }
}
