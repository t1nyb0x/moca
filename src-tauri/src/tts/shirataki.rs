//! shirataki 経由の CeVIO AI (既定 http://localhost:3000)。
//!
//! 感情はキャストごとの成分に 0〜100 の値を与えて表す。成分の顔ぶれは
//! キャストによって違うため、実行時に問い合わせる
//! (docs/emotion-protocol.md 5.1)。

use serde_json::{json, Value};

use super::types::{SpeakerInfo, SynthesizeRequest};

/// 音声そのものを受け取るための指定。
///
/// **省略すると JSON でファイルパスが返り、音声が得られない。** しかも
/// サーバー側の一時ファイルが消えない。必ず指定する。
const EXPORT_TYPE_STREAM: i64 = 1;

/// CeVIO の各値は 0〜100 で 50 が普通。
const NEUTRAL: f64 = 50.0;

fn to_cevio_scale(value: f64) -> i64 {
    (value * NEUTRAL).clamp(0.0, 100.0).round() as i64
}

fn to_cevio_offset(value: f64) -> i64 {
    (NEUTRAL + value * NEUTRAL).clamp(0.0, 100.0).round() as i64
}

/// `POST /v1/voice/create` の本文を組み立てる。
pub fn build_create_body(request: &SynthesizeRequest) -> Value {
    let preset = &request.preset;

    let mut voice_control = serde_json::Map::new();
    if let Some(speed) = preset.speed {
        voice_control.insert("speed".to_owned(), json!(to_cevio_scale(speed)));
    }
    if let Some(pitch) = preset.pitch {
        voice_control.insert("tone".to_owned(), json!(to_cevio_offset(pitch)));
    }
    if let Some(intonation) = preset.intonation {
        voice_control.insert("toneScale".to_owned(), json!(to_cevio_scale(intonation)));
    }

    // 感情は名前と値の並びで渡す。連想配列ではない。
    let emotions: Vec<Value> = preset
        .components
        .iter()
        .map(|(name, value)| {
            json!({ "name": name, "value": (value * 100.0).clamp(0.0, 100.0).round() as i64 })
        })
        .collect();

    let mut body = json!({
        "cast": request.effective_speaker(),
        "text": request.text,
        "exportType": EXPORT_TYPE_STREAM,
        "voiceControl": Value::Object(voice_control),
    });

    if !emotions.is_empty() {
        body["emotions"] = Value::Array(emotions);
    }
    body
}

/// `GET /v1/voice/casts` の応答からキャストを取り出す。
///
/// 文字列の並びを想定するが、実装が変わって連想配列になっても拾えるように
/// しておく。
pub fn casts_from_json(value: &Value) -> Vec<SpeakerInfo> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let name = item
                .as_str()
                .or_else(|| item.get("name").and_then(Value::as_str))?;
            Some(SpeakerInfo {
                id: name.to_owned(),
                name: name.to_owned(),
                // CeVIO にスタイルの概念は無い。感情は成分で表す。
                styles: Vec::new(),
            })
        })
        .collect()
}

/// `GET /v1/voice/emotions?cast=` の応答から成分名を取り出す。
pub fn emotions_from_json(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.as_str()
                        .or_else(|| item.get("name").and_then(Value::as_str))
                        .map(str::to_owned)
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts::types::VoicePreset;
    use std::collections::BTreeMap;

    fn request(preset: VoicePreset) -> SynthesizeRequest {
        SynthesizeRequest {
            text: "ごきげんよう".to_owned(),
            speaker: "花隈千冬".to_owned(),
            preset,
        }
    }

    #[test]
    fn 音声本体を要求する指定を必ず入れる() {
        // 省略すると JSON でパスが返り、音声が得られない
        let body = build_create_body(&request(VoicePreset::default()));
        assert_eq!(body["exportType"], EXPORT_TYPE_STREAM);
    }

    #[test]
    fn キャストと本文を渡す() {
        let body = build_create_body(&request(VoicePreset::default()));
        assert_eq!(body["cast"], "花隈千冬");
        assert_eq!(body["text"], "ごきげんよう");
    }

    #[test]
    fn 普通の値は_50_になる() {
        let body = build_create_body(&request(VoicePreset {
            speed: Some(1.0),
            pitch: Some(0.0),
            intonation: Some(1.0),
            ..VoicePreset::default()
        }));
        assert_eq!(body["voiceControl"]["speed"], 50);
        assert_eq!(body["voiceControl"]["tone"], 50);
        assert_eq!(body["voiceControl"]["toneScale"], 50);
    }

    #[test]
    fn 速さと抑揚は倍率から直す() {
        let body = build_create_body(&request(VoicePreset {
            speed: Some(1.5),
            intonation: Some(0.5),
            ..VoicePreset::default()
        }));
        assert_eq!(body["voiceControl"]["speed"], 75);
        assert_eq!(body["voiceControl"]["toneScale"], 25);
    }

    #[test]
    fn 高さは中心からのずれで直す() {
        let high = build_create_body(&request(VoicePreset {
            pitch: Some(0.5),
            ..VoicePreset::default()
        }));
        assert_eq!(high["voiceControl"]["tone"], 75);

        let low = build_create_body(&request(VoicePreset {
            pitch: Some(-1.0),
            ..VoicePreset::default()
        }));
        assert_eq!(low["voiceControl"]["tone"], 0);
    }

    #[test]
    fn 範囲外の値を丸める() {
        let body = build_create_body(&request(VoicePreset {
            speed: Some(9.0),
            pitch: Some(-9.0),
            ..VoicePreset::default()
        }));
        assert_eq!(body["voiceControl"]["speed"], 100);
        assert_eq!(body["voiceControl"]["tone"], 0);
    }

    #[test]
    fn 感情は名前と値の並びで渡す() {
        // 連想配列ではない
        let mut components = BTreeMap::new();
        components.insert("嬉しい".to_owned(), 0.9);
        components.insert("普通".to_owned(), 0.1);

        let body = build_create_body(&request(VoicePreset {
            components,
            ..VoicePreset::default()
        }));
        let emotions = body["emotions"].as_array().unwrap();
        assert_eq!(emotions.len(), 2);
        assert_eq!(emotions[0]["name"], "嬉しい");
        assert_eq!(emotions[0]["value"], 90);
        assert_eq!(emotions[1]["value"], 10);
    }

    #[test]
    fn 感情の指定が無ければ項目ごと出さない() {
        let body = build_create_body(&request(VoicePreset::default()));
        assert!(body.get("emotions").is_none());
    }

    #[test]
    fn キャスト一覧を取り出す() {
        let value = serde_json::json!(["花隈千冬", "小春六花"]);
        let casts = casts_from_json(&value);
        assert_eq!(casts.len(), 2);
        assert_eq!(casts[0].id, "花隈千冬");
        assert!(casts[0].styles.is_empty(), "CeVIO にスタイルの概念は無い");
    }

    #[test]
    fn 連想配列で返ってきても拾う() {
        let value = serde_json::json!([{ "name": "花隈千冬" }]);
        assert_eq!(casts_from_json(&value)[0].name, "花隈千冬");
    }

    #[test]
    fn 感情の成分名を取り出す() {
        let value = serde_json::json!(["嬉しい", "普通", "怒り", "悲しみ"]);
        assert_eq!(
            emotions_from_json(&value),
            vec!["嬉しい", "普通", "怒り", "悲しみ"]
        );
    }

    #[test]
    fn 想定外の応答でも壊れない() {
        assert!(casts_from_json(&serde_json::json!({})).is_empty());
        assert!(emotions_from_json(&serde_json::json!({})).is_empty());
    }
}
