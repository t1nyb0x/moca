//! 音声合成の HTTP 層。
//!
//! VOICEVOX と shirataki はどちらもローカルの HTTP サーバーで、WAV を
//! 返す。合成の手順だけが違うので、種別で切り替える 1 実装にまとめる。

use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;

use super::error::TtsError;
use super::types::{SpeakerInfo, SynthesizeRequest, TtsKind};
use super::{shirataki, voicevox};

/// 合成には時間がかかるが、際限なく待つ理由も無い。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[async_trait]
pub trait SpeechSynthesizer: Send + Sync {
    async fn speakers(&self) -> Result<Vec<SpeakerInfo>, TtsError>;

    /// 話者が持つ感情成分の名前。VOICEVOX には無いので空を返す。
    async fn emotion_axes(&self, speaker: &str) -> Result<Vec<String>, TtsError>;

    /// WAV のバイト列を返す。
    async fn synthesize(&self, request: SynthesizeRequest) -> Result<Vec<u8>, TtsError>;

    async fn health_check(&self) -> Result<(), TtsError>;
}

pub struct HttpSynthesizer {
    kind: TtsKind,
    base_url: String,
    client: reqwest::Client,
    /// キャストごとの感情成分名。
    ///
    /// 合成のたびに問い合わせないための控え。キャストの成分は増減しない
    /// ので、一度取れれば足りる。
    axes_cache: tokio::sync::RwLock<std::collections::HashMap<String, Vec<String>>>,
}

impl std::fmt::Debug for HttpSynthesizer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpSynthesizer")
            .field("kind", &self.kind)
            .field("base_url", &self.base_url)
            .finish()
    }
}

impl HttpSynthesizer {
    pub fn new(kind: TtsKind, base_url: impl Into<String>) -> Result<Self, TtsError> {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|err| TtsError::from_reqwest(&err, kind.display_name()))?;

        Ok(Self {
            kind,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            client,
            axes_cache: tokio::sync::RwLock::default(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.base_url)
    }

    fn wrap(&self, err: &reqwest::Error) -> TtsError {
        TtsError::from_reqwest(err, self.kind.display_name())
    }

    async fn check(response: reqwest::Response) -> Result<reqwest::Response, TtsError> {
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status().as_u16();
        // 応答本文には利用者向けの説明が入ることもあるが、そのまま出さず
        // 記録に留める。表示は自前の文言で揃える。
        let body = response.text().await.unwrap_or_default();
        tracing::debug!(target: "moca::tts", status, body = %body, "音声合成が失敗した");
        Err(TtsError::from_status(status))
    }
}

#[async_trait]
impl SpeechSynthesizer for HttpSynthesizer {
    async fn speakers(&self) -> Result<Vec<SpeakerInfo>, TtsError> {
        let path = match self.kind {
            TtsKind::Voicevox => "speakers",
            TtsKind::Shirataki => "v1/voice/casts",
        };
        let response = self
            .client
            .get(self.url(path))
            .send()
            .await
            .map_err(|err| self.wrap(&err))?;
        let value: Value = Self::check(response)
            .await?
            .json()
            .await
            .map_err(|err| self.wrap(&err))?;

        Ok(match self.kind {
            TtsKind::Voicevox => voicevox::speakers_from_json(&value),
            TtsKind::Shirataki => shirataki::casts_from_json(&value),
        })
    }

    async fn emotion_axes(&self, speaker: &str) -> Result<Vec<String>, TtsError> {
        // VOICEVOX に感情成分は無い。スタイルの選択がその役目を果たす。
        if self.kind == TtsKind::Voicevox {
            return Ok(Vec::new());
        }

        let response = self
            .client
            .get(self.url("v1/voice/emotions"))
            .query(&[("cast", speaker)])
            .send()
            .await
            .map_err(|err| self.wrap(&err))?;
        let value: Value = Self::check(response)
            .await?
            .json()
            .await
            .map_err(|err| self.wrap(&err))?;

        Ok(shirataki::emotions_from_json(&value))
    }

    async fn synthesize(&self, request: SynthesizeRequest) -> Result<Vec<u8>, TtsError> {
        let bytes = match self.kind {
            TtsKind::Voicevox => self.synthesize_voicevox(&request).await?,
            TtsKind::Shirataki => self.synthesize_shirataki(&request).await?,
        };

        // 空の応答は成功に見えるが再生できない。ここで気づけるようにする。
        if bytes.is_empty() {
            return Err(TtsError::Protocol);
        }
        Ok(bytes)
    }

    async fn health_check(&self) -> Result<(), TtsError> {
        self.speakers().await.map(|_| ())
    }
}

impl HttpSynthesizer {
    /// VOICEVOX は 2 段階。問い合わせを作り、調整してから合成する。
    async fn synthesize_voicevox(&self, request: &SynthesizeRequest) -> Result<Vec<u8>, TtsError> {
        let speaker = request.effective_speaker();

        let response = self
            .client
            .post(self.url("audio_query"))
            .query(&[("text", request.text.as_str()), ("speaker", speaker)])
            .send()
            .await
            .map_err(|err| self.wrap(&err))?;
        let mut query: Value = Self::check(response)
            .await?
            .json()
            .await
            .map_err(|err| self.wrap(&err))?;

        voicevox::apply_preset(&mut query, &request.preset);

        let response = self
            .client
            .post(self.url("synthesis"))
            .query(&[("speaker", speaker)])
            .json(&query)
            .send()
            .await
            .map_err(|err| self.wrap(&err))?;

        Ok(Self::check(response)
            .await?
            .bytes()
            .await
            .map_err(|err| self.wrap(&err))?
            .to_vec())
    }

    /// キャストの感情成分。取れなければ空を返し、合成は続ける。
    ///
    /// ここで失敗しても声は出る。打ち消しが効かなくなるだけなので、
    /// 合成そのものを止める理由にはならない。
    async fn axes_of(&self, speaker: &str) -> Vec<String> {
        if let Some(found) = self.axes_cache.read().await.get(speaker) {
            return found.clone();
        }
        let axes = self.emotion_axes(speaker).await.unwrap_or_default();
        self.axes_cache
            .write()
            .await
            .insert(speaker.to_owned(), axes.clone());
        axes
    }

    async fn synthesize_shirataki(&self, request: &SynthesizeRequest) -> Result<Vec<u8>, TtsError> {
        let axes = self.axes_of(request.effective_speaker()).await;
        let body = shirataki::build_create_body(request, &axes);
        let response = self
            .client
            .post(self.url("v1/voice/create"))
            .json(&body)
            .send()
            .await
            .map_err(|err| self.wrap(&err))?;

        Ok(Self::check(response)
            .await?
            .bytes()
            .await
            .map_err(|err| self.wrap(&err))?
            .to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts::types::VoicePreset;
    use std::collections::BTreeMap;
    use wiremock::matchers::{body_json_string, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// RIFF/WAVE の最小限の体裁。実物も同じ先頭で始まる。
    fn wav_bytes() -> Vec<u8> {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&[36, 0, 0, 0]);
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&[0u8; 24]);
        bytes
    }

    fn request(text: &str, speaker: &str, preset: VoicePreset) -> SynthesizeRequest {
        SynthesizeRequest {
            text: text.to_owned(),
            speaker: speaker.to_owned(),
            preset,
        }
    }

    // --- VOICEVOX ---

    #[tokio::test]
    async fn voicevox_の話者を取り出せる() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/speakers"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"[{"name":"四国めたん","styles":[{"name":"ノーマル","id":2}]}]"#,
            ))
            .mount(&server)
            .await;

        let tts = HttpSynthesizer::new(TtsKind::Voicevox, server.uri()).unwrap();
        let speakers = tts.speakers().await.unwrap();
        assert_eq!(speakers.len(), 1);
        assert_eq!(speakers[0].name, "四国めたん");
        assert_eq!(speakers[0].styles[0].id, "2");
    }

    #[tokio::test]
    async fn voicevox_は問い合わせを作ってから合成する() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/audio_query"))
            .and(query_param("speaker", "2"))
            .and(query_param("text", "ごきげんよう"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(
                    r#"{"speedScale":1.0,"pitchScale":0.0,"intonationScale":1.0}"#,
                ),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/synthesis"))
            .and(query_param("speaker", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(wav_bytes()))
            .mount(&server)
            .await;

        let tts = HttpSynthesizer::new(TtsKind::Voicevox, server.uri()).unwrap();
        let audio = tts
            .synthesize(request("ごきげんよう", "2", VoicePreset::default()))
            .await
            .unwrap();
        assert_eq!(&audio[0..4], b"RIFF");
    }

    #[tokio::test]
    async fn voicevox_へ調整を渡す() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/audio_query"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(
                    r#"{"speedScale":1.0,"pitchScale":0.0,"intonationScale":1.0}"#,
                ),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/synthesis"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(wav_bytes()))
            .mount(&server)
            .await;

        let tts = HttpSynthesizer::new(TtsKind::Voicevox, server.uri()).unwrap();
        tts.synthesize(request(
            "やあ",
            "2",
            VoicePreset {
                speed: Some(1.2),
                ..VoicePreset::default()
            },
        ))
        .await
        .unwrap();

        let requests = server.received_requests().await.unwrap();
        let synthesis = requests
            .iter()
            .find(|r| r.url.path() == "/synthesis")
            .expect("合成の要求が無い");
        let body: Value = serde_json::from_slice(&synthesis.body).unwrap();
        assert_eq!(body["speedScale"], 1.2);
    }

    #[tokio::test]
    async fn voicevox_に感情成分は無い() {
        let server = MockServer::start().await;
        let tts = HttpSynthesizer::new(TtsKind::Voicevox, server.uri()).unwrap();
        assert!(tts.emotion_axes("2").await.unwrap().is_empty());
    }

    // --- shirataki ---

    #[tokio::test]
    async fn shirataki_のキャストを取り出せる() {
        // 実物が返す形
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/voice/casts"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"["花隈千冬"]"#))
            .mount(&server)
            .await;

        let tts = HttpSynthesizer::new(TtsKind::Shirataki, server.uri()).unwrap();
        let casts = tts.speakers().await.unwrap();
        assert_eq!(casts[0].name, "花隈千冬");
    }

    #[tokio::test]
    async fn shirataki_の感情成分を取り出せる() {
        // 実物が返す 5 成分
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/voice/emotions"))
            .and(query_param("cast", "花隈千冬"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"["嬉しい","普通","怒り","哀しみ","落ち着き"]"#),
            )
            .mount(&server)
            .await;

        let tts = HttpSynthesizer::new(TtsKind::Shirataki, server.uri()).unwrap();
        let axes = tts.emotion_axes("花隈千冬").await.unwrap();
        assert_eq!(axes, vec!["嬉しい", "普通", "怒り", "哀しみ", "落ち着き"]);
    }

    #[tokio::test]
    async fn shirataki_へ音声本体を要求する() {
        // exportType を省略すると JSON でパスが返り、音声が得られない
        let mut components = BTreeMap::new();
        components.insert("嬉しい".to_owned(), 0.9);

        let expected = serde_json::json!({
            "cast": "花隈千冬",
            "text": "ごきげんよう",
            "exportType": 1,
            "voiceControl": {},
            "emotions": [{ "name": "嬉しい", "value": 90 }],
        });

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/voice/create"))
            .and(body_json_string(expected.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(wav_bytes()))
            .mount(&server)
            .await;

        let tts = HttpSynthesizer::new(TtsKind::Shirataki, server.uri()).unwrap();
        let audio = tts
            .synthesize(request(
                "ごきげんよう",
                "花隈千冬",
                VoicePreset {
                    components,
                    ..VoicePreset::default()
                },
            ))
            .await
            .unwrap();
        assert_eq!(&audio[0..4], b"RIFF");
    }

    // --- 失敗 ---

    #[tokio::test]
    async fn 起動していなければそう伝える() {
        // 最も多い失敗。案内に接続先の名前を入れる。
        let tts = HttpSynthesizer::new(TtsKind::Voicevox, "http://127.0.0.1:1").unwrap();
        match tts.health_check().await.unwrap_err() {
            TtsError::NotRunning(name) => assert_eq!(name, "VOICEVOX"),
            other => panic!("想定外: {other:?}"),
        }
    }

    #[tokio::test]
    async fn 受け付けられなかった要求を区別する() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(400).set_body_string(r#"{"error":"無効なキャストです"}"#),
            )
            .mount(&server)
            .await;

        let tts = HttpSynthesizer::new(TtsKind::Shirataki, server.uri()).unwrap();
        let error = tts
            .synthesize(request("やあ", "知らない人", VoicePreset::default()))
            .await
            .unwrap_err();
        assert_eq!(error, TtsError::Rejected);
        assert!(
            !error.to_string().contains("無効なキャスト"),
            "生の応答を出さない"
        );
    }

    #[tokio::test]
    async fn 空の応答を成功と扱わない() {
        // 再生できないのに成功に見えるのが一番困る
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/voice/create"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(Vec::<u8>::new()))
            .mount(&server)
            .await;

        let tts = HttpSynthesizer::new(TtsKind::Shirataki, server.uri()).unwrap();
        let error = tts
            .synthesize(request("やあ", "花隈千冬", VoicePreset::default()))
            .await
            .unwrap_err();
        assert_eq!(error, TtsError::Protocol);
    }

    #[tokio::test]
    async fn base_url_の末尾のスラッシュを吸収する() {
        let tts = HttpSynthesizer::new(TtsKind::Shirataki, "http://localhost:53000/").unwrap();
        assert_eq!(
            tts.url("v1/voice/casts"),
            "http://localhost:53000/v1/voice/casts"
        );
    }

    /// 実物の shirataki へ繋いで往復を確かめる。
    ///
    /// wiremock は自分が思う形しか返さないので、思い込みごと通ってしまう。
    /// サーバーを立てて `cargo test -- --ignored shirataki` で確認する。
    #[tokio::test]
    #[ignore = "shirataki と CeVIO AI の起動が必要"]
    async fn 実物の_shirataki_から音声を得られる() {
        let tts = HttpSynthesizer::new(TtsKind::Shirataki, "http://127.0.0.1:53000").unwrap();

        let casts = tts.speakers().await.expect("キャスト一覧");
        assert!(!casts.is_empty(), "キャストが一人もいない");

        let cast = casts[0].id.clone();
        let axes = tts.emotion_axes(&cast).await.expect("感情成分");
        assert!(!axes.is_empty(), "感情成分が空");

        let mut components = std::collections::BTreeMap::new();
        components.insert(axes[0].clone(), 0.9);

        let wav = tts
            .synthesize(SynthesizeRequest {
                text: "こんにちは。".to_string(),
                speaker: cast,
                preset: VoicePreset {
                    components,
                    ..VoicePreset::default()
                },
            })
            .await
            .expect("音声合成");

        assert!(wav.len() > 1024, "音声が小さすぎる: {} バイト", wav.len());
        assert_eq!(&wav[0..4], b"RIFF", "WAV になっていない");
        assert_eq!(&wav[8..12], b"WAVE", "WAV になっていない");
    }
}
