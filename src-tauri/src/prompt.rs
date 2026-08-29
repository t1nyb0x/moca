//! システムプロンプトの組み立て。
//!
//! 人格定義に感情プロトコルの説明を連結する。フロントは人格定義だけを
//! 持ち、プロトコルの文言を知らない (docs/ipc-contract.md 2.6)。
//!
//! 文言の設計方針は docs/emotion-protocol.md 6.1:
//! 短く保ち、例示を含め、強制しない。

use crate::storage::models::EmotionMode;

/// 人格定義の末尾へ追記するブロック。
///
/// 人格が主でプロトコルが従なので必ず後ろに置く。先頭に置くと、小規模な
/// モデルほど人格よりタグ規約に気を取られる。
pub const EMOTION_PROTOCOL_BLOCK: &str = "\
---
返答には感情タグを付けてください。

利用できるタグ: [neutral] [happy] [angry] [sad] [relaxed] [surprised]

- タグは、その感情で話し始める位置の直前に置きます。
- 文の途中ではなく、文や節の先頭に置いてください。
- 感情の強さを指定する場合は [happy:0.6] のように 0.1〜1.0 で書きます。省略すると 1.0 です。
- 一つの返答の中で感情が変わる場合は、変わる位置に新しいタグを置いてください。
- タグ以外の場所で角括弧を使わないでください。

例:
[happy]こんにちは。今日はいい天気ですね。[relaxed]こういう日は、のんびり過ごしたくなります。
[surprised]えっ、本当ですか。[happy:0.7]それは嬉しいです。
[sad]そうですか……。[relaxed]でも、きっと大丈夫ですよ。";

/// 送信するシステムプロンプトを組み立てる。
///
/// 何も無ければ `None` を返す。空文字を送るとプロバイダによっては
/// 検証エラーになる。
pub fn build_system_prompt(persona: &str, mode: EmotionMode) -> Option<String> {
    let persona = persona.trim();

    match mode {
        EmotionMode::Off => {
            if persona.is_empty() {
                None
            } else {
                Some(persona.to_owned())
            }
        }
        EmotionMode::Tag => Some(if persona.is_empty() {
            EMOTION_PROTOCOL_BLOCK.to_owned()
        } else {
            format!("{persona}\n\n{EMOTION_PROTOCOL_BLOCK}")
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PERSONA: &str = "あなたは倉本千奈です。丁寧で前向きな話し方をします。";

    #[test]
    fn 人格の後ろにプロトコルを連結する() {
        let prompt = build_system_prompt(PERSONA, EmotionMode::Tag).unwrap();
        let persona_at = prompt.find(PERSONA).unwrap();
        let protocol_at = prompt.find("利用できるタグ").unwrap();
        assert!(persona_at < protocol_at, "人格が主、プロトコルが従");
    }

    #[test]
    fn 無効時はプロトコルを連結しない() {
        let prompt = build_system_prompt(PERSONA, EmotionMode::Off).unwrap();
        assert_eq!(prompt, PERSONA);
        assert!(!prompt.contains("感情タグ"));
    }

    #[test]
    fn 人格が空でもプロトコルは送る() {
        let prompt = build_system_prompt("   ", EmotionMode::Tag).unwrap();
        assert!(prompt.starts_with("---"));
    }

    #[test]
    fn 人格が空で無効なら何も送らない() {
        // 空文字を送るとプロバイダによっては検証エラーになる
        assert!(build_system_prompt("", EmotionMode::Off).is_none());
    }

    #[test]
    fn 前後の空白を落とす() {
        let prompt = build_system_prompt("  こんにちは  ", EmotionMode::Off).unwrap();
        assert_eq!(prompt, "こんにちは");
    }

    #[test]
    fn プロトコルに六種すべてのタグが載っている() {
        for emotion in ["neutral", "happy", "angry", "sad", "relaxed", "surprised"] {
            assert!(
                EMOTION_PROTOCOL_BLOCK.contains(&format!("[{emotion}]")),
                "{emotion} がプロトコル文に無い"
            );
        }
    }

    #[test]
    fn プロトコルに例示が含まれる() {
        // 抽象的な説明より few-shot が効く (emotion-protocol.md 6.1)
        assert!(EMOTION_PROTOCOL_BLOCK.contains("例:"));
        assert!(EMOTION_PROTOCOL_BLOCK.contains("[happy:0.7]"));
    }
}
