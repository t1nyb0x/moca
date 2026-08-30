//! 感情の強さを声へ反映する (要件 F-12-3)。
//!
//! 感情タグは `[happy:0.7]` のように強さを持つ (emotion-protocol.md 3.2)。
//! これまでは名前だけを見ており、0.3 でも 1.0 でも同じ声になっていた。
//!
//! 中立の声からその感情の声へ、強さのぶんだけ寄せる。中立を基点にするのは、
//! 強さ 0 が「感情を出さない」であり、それは中立そのものだからである。

use std::collections::BTreeMap;

use crate::tts::types::VoicePreset;

/// 調整が無いときの既定値。中立の声はここを基点にする。
const BASE_SPEED: f64 = 1.0;
const BASE_PITCH: f64 = 0.0;
const BASE_INTONATION: f64 = 1.0;

/// 端では計算せずそのまま返す。`1.0 + (0.1 - 1.0) * 1.0` が 0.1 に
/// ならないため、最大の強さで利用者が決めた値がわずかにずれる。
fn lerp(from: f64, to: f64, t: f64) -> f64 {
    if t <= 0.0 {
        return from;
    }
    if t >= 1.0 {
        return to;
    }
    from + (to - from) * t
}

/// どちらも指定が無ければ指定しないままにする。片方だけなら既定から寄せる。
fn lerp_option(from: Option<f64>, to: Option<f64>, t: f64, base: f64) -> Option<f64> {
    if from.is_none() && to.is_none() {
        return None;
    }
    Some(lerp(from.unwrap_or(base), to.unwrap_or(base), t))
}

/// 中立から `target` へ `t` (0〜1) のぶんだけ寄せた声。
///
/// `speaker` は混ぜられないので、半分を境に切り替える。VOICEVOX のスタイルも
/// CeVIO のキャストも、中間という状態を持たないため。
pub fn blend(neutral: &VoicePreset, target: &VoicePreset, t: f64) -> VoicePreset {
    let t = t.clamp(0.0, 1.0);

    let mut components: BTreeMap<String, f64> = BTreeMap::new();
    for name in neutral.components.keys().chain(target.components.keys()) {
        if components.contains_key(name) {
            continue;
        }
        let from = neutral.components.get(name).copied().unwrap_or(0.0);
        let to = target.components.get(name).copied().unwrap_or(0.0);
        components.insert(name.clone(), lerp(from, to, t));
    }

    VoicePreset {
        speaker: if t >= 0.5 {
            target.speaker.clone()
        } else {
            neutral.speaker.clone()
        },
        components,
        speed: lerp_option(neutral.speed, target.speed, t, BASE_SPEED),
        pitch: lerp_option(neutral.pitch, target.pitch, t, BASE_PITCH),
        intonation: lerp_option(neutral.intonation, target.intonation, t, BASE_INTONATION),
    }
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;

    fn preset(components: &[(&str, f64)], speed: Option<f64>) -> VoicePreset {
        VoicePreset {
            speaker: None,
            components: components
                .iter()
                .map(|(name, value)| ((*name).to_owned(), *value))
                .collect(),
            speed,
            pitch: None,
            intonation: None,
        }
    }

    fn neutral() -> VoicePreset {
        preset(&[("普通", 1.0)], None)
    }

    fn happy() -> VoicePreset {
        preset(&[("嬉しい", 0.9), ("普通", 0.1)], Some(1.1))
    }

    #[test]
    fn 強さが最大なら感情の声そのもの() {
        let blended = blend(&neutral(), &happy(), 1.0);
        assert_eq!(blended.components.get("嬉しい"), Some(&0.9));
        assert_eq!(blended.components.get("普通"), Some(&0.1));
        assert_eq!(blended.speed, Some(1.1));
    }

    #[test]
    fn 強さが0なら中立の声そのもの() {
        let blended = blend(&neutral(), &happy(), 0.0);
        assert_eq!(blended.components.get("嬉しい"), Some(&0.0));
        assert_eq!(blended.components.get("普通"), Some(&1.0));
        // 中立に指定が無くても、寄せる相手があれば既定から動かす
        assert_eq!(blended.speed, Some(1.0));
    }

    #[test]
    fn 途中の強さでは間の値になる() {
        let blended = blend(&neutral(), &happy(), 0.5);
        assert_eq!(blended.components.get("嬉しい"), Some(&0.45));
        assert!((blended.components["普通"] - 0.55).abs() < 1e-9);
    }

    #[test]
    fn 範囲の外は丸める() {
        let over = blend(&neutral(), &happy(), 5.0);
        assert_eq!(over.components.get("嬉しい"), Some(&0.9));
        let under = blend(&neutral(), &happy(), -1.0);
        assert_eq!(under.components.get("嬉しい"), Some(&0.0));
    }

    #[test]
    fn どちらも指定が無い調整は指定しないまま() {
        let blended = blend(&neutral(), &preset(&[("嬉しい", 1.0)], None), 0.5);
        assert_eq!(blended.speed, None);
        assert_eq!(blended.pitch, None);
    }

    #[test]
    fn 話者は半分を境に切り替わる() {
        let mut target = happy();
        target.speaker = Some("よろこび".to_owned());

        assert_eq!(blend(&neutral(), &target, 0.49).speaker, None);
        assert_eq!(
            blend(&neutral(), &target, 0.5).speaker,
            Some("よろこび".to_owned())
        );
    }
}
