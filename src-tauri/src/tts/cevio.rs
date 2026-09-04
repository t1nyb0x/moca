//! CeVIO AI を COM で直に叩く (要件 F-12-1)。
//!
//! shirataki (Node の HTTP サーバー) を挟む経路も残す。あちらは CeVIO を
//! 別の PC で動かせる。こちらは同じ機械の上に居る場合しか使えないかわりに、
//! CeVIO AI のほかに何も起動しなくてよい。
//!
//! CeVIO 側の口は小さい。
//!
//! ```text
//! CeVIO.Talk.RemoteService2.ServiceControl2V40 → StartHost(false)
//! CeVIO.Talk.RemoteService2.Talker2V40         → Cast, Speed, Tone, ToneScale,
//!                                                Components, AvailableCasts,
//!                                                OutputWaveToFile(text, path)
//! ```
//!
//! いずれも `IDispatch` の遅延束縛で呼ぶ。型情報を持たず、名前から DISPID を
//! 引いて `Invoke` で叩く。
//!
//! **MTA で入る。** CeVIO の COM は別プロセスにあるため、呼び出しはプロセス間
//! で受け渡される。STA で入るとその受け渡しに Windows のメッセージ循環が要る
//! が、Rust のスレッドはそれを持たない。呼び出しが永久に返らなくなる (実測で
//! 600 秒待っても返らず、MTA へ変えたら 0.07 秒で返った)。
//!
//! **COM の呼び出しは同期で、しかもスレッドに縛られる。** 非同期の文脈から直に
//! 呼ばず、`spawn_blocking` の中で作って使い捨てる。`IDispatch` をスレッドを
//! またいで持ち回らない。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use windows::core::{BSTR, GUID, HRESULT, PCWSTR, VARIANT};
use windows::Win32::System::Com::{
    CLSIDFromProgID, CoCreateInstance, CoInitializeEx, IDispatch, CLSCTX_ALL, COINIT_MULTITHREADED,
    DISPATCH_METHOD, DISPATCH_PROPERTYGET, DISPATCH_PROPERTYPUT, DISPPARAMS,
};

use super::error::TtsError;
use super::types::{SpeakerInfo, SynthesizeRequest};
use super::SpeechSynthesizer;

const SERVICE_PROG_ID: &str = "CeVIO.Talk.RemoteService2.ServiceControl2V40";
const TALKER_PROG_ID: &str = "CeVIO.Talk.RemoteService2.Talker2V40";

/// 利用者へ見せる名前。起動していないときの案内に使う。
const SERVICE_NAME: &str = "CeVIO AI";

/// CeVIO の各値は 0〜100 で 50 が普通。
const NEUTRAL: f64 = 50.0;

/// 値を入れる引数の DISPID。プロパティへの代入はこの名前付き引数で表す。
const DISPID_PROPERTYPUT: i32 = -3;

/// STA で初期化済みのスレッドから MTA を求めたときに返る。
const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x8001_0106_u32 as i32);

// --- 単位の変換 ---
//
// shirataki 経由でも同じ数値を送る。同じ CeVIO を相手にしているので、
// 変換はここを唯一の出どころとする。

/// 倍率 (1.0 が普通) を 0〜100 へ直す。
pub fn to_scale(value: f64) -> i32 {
    (value * NEUTRAL).clamp(0.0, 100.0).round() as i32
}

/// 中心からのずれ (0.0 が普通) を 0〜100 へ直す。
pub fn to_offset(value: f64) -> i32 {
    (NEUTRAL + value * NEUTRAL).clamp(0.0, 100.0).round() as i32
}

/// 感情成分の 0.0〜1.0 を 0〜100 へ直す。
pub fn to_component(value: f64) -> i32 {
    (value * 100.0).clamp(0.0, 100.0).round() as i32
}

/// 合成 1 回ぶんの CeVIO への指定。
///
/// COM の呼び出しから切り離して組み立てる。CeVIO を入れていない機械でも
/// ここまでは試験できる。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TalkParams {
    pub cast: String,
    pub text: String,
    pub speed: Option<i32>,
    pub tone: Option<i32>,
    pub tone_scale: Option<i32>,
    /// 割り当てられた感情成分だけ。並んでいる成分との突き合わせは
    /// [`resolve_components`] で行う。
    pub components: BTreeMap<String, i32>,
}

pub fn build_params(request: &SynthesizeRequest) -> TalkParams {
    let preset = &request.preset;
    TalkParams {
        cast: request.effective_speaker().to_owned(),
        text: request.text.clone(),
        speed: preset.speed.map(to_scale),
        tone: preset.pitch.map(to_offset),
        tone_scale: preset.intonation.map(to_scale),
        components: preset
            .components
            .iter()
            .map(|(name, value)| (name.clone(), to_component(*value)))
            .collect(),
    }
}

/// キャストが実際に持つ成分へ与える値を決める。
///
/// **割り当てに無い成分は 0 で明示的に打ち消す。** `Talker` は設定した値を
/// 保ち続けるため、書かなかった成分には前回の値が残る。「嬉しい」で一文
/// 読ませた後に「哀しみ」だけを送ると、両方が高いまま混ざった声になる。
///
/// 割り当てが空のときは何もしない。こちらが感情を管理しないなら、CeVIO 側で
/// 調整された値をそのままにしておくほうがよい。
pub fn resolve_components(available: &[String], wanted: &BTreeMap<String, i32>) -> Vec<i32> {
    if wanted.is_empty() {
        return Vec::new();
    }
    available
        .iter()
        .map(|name| wanted.get(name).copied().unwrap_or(0))
        .collect()
}

// --- COM の足回り ---

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 呼び出しの失敗はどれも利用者に見せる文言を持たない。記録に残して
/// `Protocol` に畳む。
fn failed(what: &str, error: &windows::core::Error) -> TtsError {
    tracing::debug!(target: "moca::tts", what, %error, "CeVIO の COM 呼び出しに失敗した");
    TtsError::Protocol
}

/// 名前から DISPID を引く。COM の遅延束縛はここから始まる。
fn dispid(target: &IDispatch, name: &str) -> Result<i32, TtsError> {
    let wide = wide(name);
    let mut id = 0i32;
    // SAFETY: wide は終端付きで、呼び出しのあいだ生きている。
    unsafe {
        target
            .GetIDsOfNames(&GUID::zeroed(), &PCWSTR(wide.as_ptr()), 1, 0, &mut id)
            .map_err(|error| failed(name, &error))?;
    }
    Ok(id)
}

/// 引数なしのプロパティ取得。
fn get(target: &IDispatch, name: &str) -> Result<VARIANT, TtsError> {
    let id = dispid(target, name)?;
    let mut out = VARIANT::default();
    let params = DISPPARAMS::default();
    // SAFETY: out は呼び出しのあいだ生きている。
    unsafe {
        target
            .Invoke(
                id,
                &GUID::zeroed(),
                0,
                DISPATCH_PROPERTYGET,
                &params,
                Some(&mut out),
                None,
                None,
            )
            .map_err(|error| failed(name, &error))?;
    }
    Ok(out)
}

/// プロパティへの代入。
///
/// 値は名前付き引数 `DISPID_PROPERTYPUT` として渡す決まりで、位置引数だけを
/// 並べても代入にはならない。
fn put(target: &IDispatch, name: &str, value: VARIANT) -> Result<(), TtsError> {
    let id = dispid(target, name)?;
    let mut args = [value];
    let mut named = [DISPID_PROPERTYPUT];
    let params = DISPPARAMS {
        rgvarg: args.as_mut_ptr(),
        cArgs: 1,
        rgdispidNamedArgs: named.as_mut_ptr(),
        cNamedArgs: 1,
    };
    // SAFETY: args と named は呼び出しのあいだ生きている。
    unsafe {
        target
            .Invoke(
                id,
                &GUID::zeroed(),
                0,
                DISPATCH_PROPERTYPUT,
                &params,
                None,
                None,
                None,
            )
            .map_err(|error| failed(name, &error))?;
    }
    Ok(())
}

/// 引数を渡してメソッドを呼ぶ。DISPPARAMS の引数は逆順に並べる決まり。
fn call(target: &IDispatch, name: &str, args: &mut [VARIANT]) -> Result<VARIANT, TtsError> {
    let id = dispid(target, name)?;
    args.reverse();
    let params = DISPPARAMS {
        rgvarg: args.as_mut_ptr(),
        cArgs: args.len() as u32,
        ..Default::default()
    };
    let mut out = VARIANT::default();
    // SAFETY: args と out は呼び出しのあいだ生きている。
    unsafe {
        target
            .Invoke(
                id,
                &GUID::zeroed(),
                0,
                DISPATCH_METHOD,
                &params,
                Some(&mut out),
                None,
                None,
            )
            .map_err(|error| failed(name, &error))?;
    }
    Ok(out)
}

fn as_dispatch(value: &VARIANT) -> Result<IDispatch, TtsError> {
    IDispatch::try_from(value).map_err(|error| failed("IDispatch への変換", &error))
}

fn as_i32(value: &VARIANT) -> Result<i32, TtsError> {
    i32::try_from(value).map_err(|error| failed("整数への変換", &error))
}

fn as_string(value: &VARIANT) -> Result<String, TtsError> {
    BSTR::try_from(value)
        .map(|text| text.to_string())
        .map_err(|error| failed("文字列への変換", &error))
}

fn as_bool(value: &VARIANT) -> Result<bool, TtsError> {
    bool::try_from(value).map_err(|error| failed("真偽値への変換", &error))
}

/// COM を使う前に、そのスレッドで一度だけ呼ぶ。
///
/// 二度目以降は `S_FALSE` が返るだけで害はない。`RPC_E_CHANGED_MODE` だけは
/// 見逃せない。STA で初期化済みのスレッドであり、そのまま呼ぶと戻らなくなる。
fn init() -> Result<(), TtsError> {
    // SAFETY: 引数を取らない初期化。解除は行わない (プロセスの終わりまで使う)。
    let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if result == RPC_E_CHANGED_MODE {
        tracing::warn!(target: "moca::tts", "STA のスレッドから CeVIO を呼ぼうとした");
        return Err(TtsError::Protocol);
    }
    Ok(())
}

/// ProgID から実体を作る。登録されていなければ CeVIO AI が入っていない。
fn create(prog_id: &str) -> Result<IDispatch, TtsError> {
    let wide = wide(prog_id);
    // SAFETY: wide は終端付きで、呼び出しのあいだ生きている。
    unsafe {
        let clsid = CLSIDFromProgID(PCWSTR(wide.as_ptr())).map_err(|error| {
            tracing::debug!(target: "moca::tts", prog_id, %error, "CeVIO が登録されていない");
            TtsError::NotRunning(SERVICE_NAME.to_owned())
        })?;
        CoCreateInstance(&clsid, None, CLSCTX_ALL).map_err(|error| {
            tracing::debug!(target: "moca::tts", prog_id, %error, "CeVIO の実体を作れない");
            TtsError::NotRunning(SERVICE_NAME.to_owned())
        })
    }
}

/// CeVIO の `Talker`。作ったスレッドの上でだけ使う。
struct Talker(IDispatch);

impl Talker {
    /// CeVIO AI を起こして `Talker` を得る。既に起動していれば何も起きない。
    fn connect() -> Result<Self, TtsError> {
        init()?;

        let service = create(SERVICE_PROG_ID)?;
        // 引数の false は「他のプロセスが使っていても起動する」の意
        call(&service, "StartHost", &mut [VARIANT::from(false)])?;

        Ok(Self(create(TALKER_PROG_ID)?))
    }

    /// `.Length` と `.At(i)` を持つ配列を Rust の並びへ移す。
    fn collect(&self, property: &str) -> Result<Vec<VARIANT>, TtsError> {
        let array = as_dispatch(&get(&self.0, property)?)?;
        let count = as_i32(&get(&array, "Length")?)?;
        (0..count)
            .map(|index| call(&array, "At", &mut [VARIANT::from(index)]))
            .collect()
    }

    fn available_casts(&self) -> Result<Vec<String>, TtsError> {
        self.collect("AvailableCasts")?
            .iter()
            .map(as_string)
            .collect()
    }

    /// キャストを選ぶ。以降の `Components` はこのキャストのものになる。
    ///
    /// 知らない名前を入れても COM は黙って受け取ることがあるため、先に
    /// 一覧と突き合わせる。
    fn select(&self, cast: &str) -> Result<(), TtsError> {
        if !self.available_casts()?.iter().any(|name| name == cast) {
            return Err(TtsError::UnknownSpeaker);
        }
        put(&self.0, "Cast", VARIANT::from(BSTR::from(cast)))
    }

    /// 選んでいるキャストが持つ感情成分の名前。
    fn component_names(&self) -> Result<Vec<String>, TtsError> {
        self.collect("Components")?
            .iter()
            .map(|component| as_string(&get(&as_dispatch(component)?, "Name")?))
            .collect()
    }

    /// 速さ・高さ・抑揚と感情成分を書き込む。キャストを選んだ後に呼ぶ。
    fn apply(&self, params: &TalkParams) -> Result<(), TtsError> {
        for (name, value) in [
            ("Speed", params.speed),
            ("Tone", params.tone),
            ("ToneScale", params.tone_scale),
        ] {
            if let Some(value) = value {
                put(&self.0, name, VARIANT::from(value))?;
            }
        }

        let components = self.collect("Components")?;
        let names: Vec<String> = components
            .iter()
            .map(|component| as_string(&get(&as_dispatch(component)?, "Name")?))
            .collect::<Result<_, _>>()?;

        for (component, value) in components
            .iter()
            .zip(resolve_components(&names, &params.components))
        {
            put(&as_dispatch(component)?, "Value", VARIANT::from(value))?;
        }
        Ok(())
    }

    /// WAV を書き出す。CeVIO はファイルにしか出せない。
    fn output_wave(&self, text: &str, path: &Path) -> Result<(), TtsError> {
        let done = as_bool(&call(
            &self.0,
            "OutputWaveToFile",
            &mut [
                VARIANT::from(BSTR::from(text)),
                VARIANT::from(BSTR::from(path.to_string_lossy().as_ref())),
            ],
        )?)?;

        if !done {
            tracing::debug!(target: "moca::tts", "CeVIO が書き出しを拒んだ");
            return Err(TtsError::Rejected);
        }
        Ok(())
    }
}

/// 書き出し先。合成のたびに使い捨てる。
fn wave_path() -> PathBuf {
    std::env::temp_dir().join(format!("moca-tts-{}.wav", uuid::Uuid::new_v4()))
}

fn read_wave(path: &Path) -> Result<Vec<u8>, TtsError> {
    std::fs::read(path).map_err(|error| {
        tracing::debug!(target: "moca::tts", %error, "書き出した WAV を読めない");
        TtsError::Protocol
    })
}

/// COM 経由の CeVIO AI。
///
/// 状態を持たない。`Talker` は呼び出しごとに作って捨てる。COM の実体は
/// スレッドに縛られるうえ、CeVIO 側は別プロセスで生き続けるため、こちらで
/// 抱え込む利点が無い。
#[derive(Debug, Default)]
pub struct CevioSynthesizer;

impl CevioSynthesizer {
    pub fn new() -> Self {
        Self
    }

    /// COM の仕事はすべて専用のスレッドで行う。`IDispatch` は closure の中で
    /// 作って中で捨てるので、スレッドをまたがない。
    async fn on_com_thread<T, F>(work: F) -> Result<T, TtsError>
    where
        T: Send + 'static,
        F: FnOnce(Talker) -> Result<T, TtsError> + Send + 'static,
    {
        tokio::task::spawn_blocking(move || work(Talker::connect()?))
            .await
            .map_err(|error| {
                tracing::debug!(target: "moca::tts", %error, "CeVIO を呼ぶスレッドが落ちた");
                TtsError::Protocol
            })?
    }
}

#[async_trait]
impl SpeechSynthesizer for CevioSynthesizer {
    async fn speakers(&self) -> Result<Vec<SpeakerInfo>, TtsError> {
        let casts = Self::on_com_thread(|talker| talker.available_casts()).await?;
        Ok(casts
            .into_iter()
            .map(|name| SpeakerInfo {
                id: name.clone(),
                name,
                // CeVIO にスタイルの概念は無い。感情は成分で表す。
                styles: Vec::new(),
            })
            .collect())
    }

    async fn emotion_axes(&self, speaker: &str) -> Result<Vec<String>, TtsError> {
        let cast = speaker.to_owned();
        Self::on_com_thread(move |talker| {
            talker.select(&cast)?;
            talker.component_names()
        })
        .await
    }

    async fn synthesize(&self, request: SynthesizeRequest) -> Result<Vec<u8>, TtsError> {
        let params = build_params(&request);

        let bytes = Self::on_com_thread(move |talker| {
            talker.select(&params.cast)?;
            talker.apply(&params)?;

            let path = wave_path();
            let result = talker
                .output_wave(&params.text, &path)
                .and_then(|()| read_wave(&path));
            // 失敗しても消す。溜まると気づかないまま容量を食う。
            let _ = std::fs::remove_file(&path);
            result
        })
        .await?;

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

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;
    use crate::tts::types::VoicePreset;

    fn request(preset: VoicePreset) -> SynthesizeRequest {
        SynthesizeRequest {
            text: "ごきげんよう".to_owned(),
            speaker: "花隈千冬".to_owned(),
            preset,
        }
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn キャストと本文を渡す() {
        let params = build_params(&request(VoicePreset::default()));
        assert_eq!(params.cast, "花隈千冬");
        assert_eq!(params.text, "ごきげんよう");
    }

    #[test]
    fn 調整が無ければ触れない() {
        // 指定しない値は CeVIO 側の設定をそのままにする
        let params = build_params(&request(VoicePreset::default()));
        assert_eq!(params.speed, None);
        assert_eq!(params.tone, None);
        assert_eq!(params.tone_scale, None);
    }

    #[test]
    fn 普通の値は_50_になる() {
        let params = build_params(&request(VoicePreset {
            speed: Some(1.0),
            pitch: Some(0.0),
            intonation: Some(1.0),
            ..VoicePreset::default()
        }));
        assert_eq!(params.speed, Some(50));
        assert_eq!(params.tone, Some(50));
        assert_eq!(params.tone_scale, Some(50));
    }

    #[test]
    fn 速さと抑揚は倍率から_高さは中心からのずれで直す() {
        let params = build_params(&request(VoicePreset {
            speed: Some(1.5),
            pitch: Some(0.5),
            intonation: Some(0.5),
            ..VoicePreset::default()
        }));
        assert_eq!(params.speed, Some(75));
        assert_eq!(params.tone, Some(75));
        assert_eq!(params.tone_scale, Some(25));
    }

    #[test]
    fn 範囲外の値を丸める() {
        let params = build_params(&request(VoicePreset {
            speed: Some(9.0),
            pitch: Some(-9.0),
            ..VoicePreset::default()
        }));
        assert_eq!(params.speed, Some(100));
        assert_eq!(params.tone, Some(0));
    }

    #[test]
    fn 感情成分を_0から100_へ直す() {
        let mut components = BTreeMap::new();
        components.insert("嬉しい".to_owned(), 0.9);
        let params = build_params(&request(VoicePreset {
            components,
            ..VoicePreset::default()
        }));
        assert_eq!(params.components["嬉しい"], 90);
    }

    #[test]
    fn 指定しなかった成分も_0_で打ち消す() {
        // Talker は前回の値を保つ。打ち消さないと感情が混ざる。
        let available = names(&["嬉しい", "普通", "怒り", "哀しみ", "落ち着き"]);
        let wanted = BTreeMap::from([("哀しみ".to_owned(), 90)]);

        assert_eq!(
            resolve_components(&available, &wanted),
            vec![0, 0, 0, 90, 0],
            "書かなかった成分に前の値が残ってしまう"
        );
    }

    #[test]
    fn 割り当てが空なら成分に触れない() {
        // こちらが感情を管理しないなら、CeVIO 側の調整をそのままにする
        let available = names(&["嬉しい", "普通"]);
        assert!(resolve_components(&available, &BTreeMap::new()).is_empty());
    }

    #[test]
    fn キャストに無い成分は捨てる() {
        // 別のキャストで作った割り当てが残っていることがある
        let available = names(&["嬉しい", "普通"]);
        let wanted = BTreeMap::from([("嬉しい".to_owned(), 80), ("激しい".to_owned(), 70)]);
        assert_eq!(resolve_components(&available, &wanted), vec![80, 0]);
    }

    #[test]
    fn 書き出し先は毎回変わる() {
        // 同じ名前を使い回すと、前の合成の途中で上書きしうる
        assert_ne!(wave_path(), wave_path());
    }

    /// 実物の CeVIO AI へ繋いで往復を確かめる。
    ///
    /// 作り物の相手では思い込みごと通ってしまう。COM は特に、名前や引数の
    /// 並びが合っているかを実物でしか確かめられない。
    /// `cargo test -- --ignored cevio` で確認する。
    #[tokio::test]
    #[ignore = "CeVIO AI の導入と起動が必要"]
    async fn 実物の_CeVIO_から音声を得られる() {
        let tts = CevioSynthesizer::new();

        let casts = tts.speakers().await.expect("キャスト一覧");
        assert!(!casts.is_empty(), "キャストが一人もいない");
        println!("キャスト {} 名", casts.len());

        let cast = casts[0].id.clone();
        let axes = tts.emotion_axes(&cast).await.expect("感情成分");
        assert!(!axes.is_empty(), "感情成分が空");
        println!("{cast} の成分: {axes:?}");

        let mut components = BTreeMap::new();
        components.insert(axes[0].clone(), 0.9);

        let wav = tts
            .synthesize(SynthesizeRequest {
                text: "こんにちは。".to_owned(),
                speaker: cast,
                preset: VoicePreset {
                    components,
                    speed: Some(1.0),
                    pitch: Some(0.0),
                    intonation: Some(1.0),
                    ..VoicePreset::default()
                },
            })
            .await
            .expect("音声合成");

        assert!(wav.len() > 1024, "音声が小さすぎる: {} バイト", wav.len());
        assert_eq!(&wav[0..4], b"RIFF", "WAV になっていない");
        assert_eq!(&wav[8..12], b"WAVE", "WAV になっていない");
    }

    #[tokio::test]
    #[ignore = "CeVIO AI の導入と起動が必要"]
    async fn 知らないキャストはそう伝える() {
        let tts = CevioSynthesizer::new();
        assert_eq!(
            tts.emotion_axes("居ない人").await.unwrap_err(),
            TtsError::UnknownSpeaker
        );
    }
}
