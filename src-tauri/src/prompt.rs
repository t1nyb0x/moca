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

/// 身振りのタグを説明するブロック (要件 F-15)。
///
/// タグの顔ぶれは利用者が決めるので、文言は実行時に組み立てる。割り当てが
/// 無ければ何も足さない。使えないタグを教えると、モデルはそれを書こうと
/// する (ADR-0019)。
fn gesture_block(tags: &[String]) -> Option<String> {
    let listed: Vec<String> = tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .map(|tag| format!("[{tag}]"))
        .collect();
    if listed.is_empty() {
        return None;
    }

    let first = listed.first()?;
    Some(format!(
        "\
---
返答には身振りのタグを付けられます。

利用できるタグ: {}

- 身振りをさせたい位置の直前に置きます。書き方は感情タグと同じです。
- 使わなくてもかまいません。動きがふさわしい場面でだけ置いてください。
- 一つの返答で何度も繰り返さないでください。

例:
{first}こんにちは。今日はいい天気ですね。",
        listed.join(" ")
    ))
}

/// 送信するシステムプロンプトを組み立てる。
///
/// 何も無ければ `None` を返す。空文字を送るとプロバイダによっては
/// 検証エラーになる。
///
/// `gestures` は利用者が割り当てた身振りのタグ名。感情タグを切っている
/// ときは身振りも教えない。どちらも同じ角括弧の約束に乗っており、従えない
/// モデルのための逃げ道が `Off` だからである (要件 R-2、ADR-0003)。
pub fn build_system_prompt(
    persona: &str,
    mode: EmotionMode,
    gestures: &[String],
) -> Option<String> {
    let persona = persona.trim();

    match mode {
        EmotionMode::Off => {
            if persona.is_empty() {
                None
            } else {
                Some(persona.to_owned())
            }
        }
        EmotionMode::Tag => {
            let mut blocks: Vec<String> = Vec::new();
            if !persona.is_empty() {
                blocks.push(persona.to_owned());
            }
            blocks.push(EMOTION_PROTOCOL_BLOCK.to_owned());
            if let Some(block) = gesture_block(gestures) {
                blocks.push(block);
            }
            Some(blocks.join("\n\n"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PERSONA: &str = "あなたは倉本千奈です。丁寧で前向きな話し方をします。";

    #[test]
    fn 人格の後ろにプロトコルを連結する() {
        let prompt = build_system_prompt(PERSONA, EmotionMode::Tag, &[]).unwrap();
        let persona_at = prompt.find(PERSONA).unwrap();
        let protocol_at = prompt.find("利用できるタグ").unwrap();
        assert!(persona_at < protocol_at, "人格が主、プロトコルが従");
    }

    #[test]
    fn 無効時はプロトコルを連結しない() {
        let prompt = build_system_prompt(PERSONA, EmotionMode::Off, &[]).unwrap();
        assert_eq!(prompt, PERSONA);
        assert!(!prompt.contains("感情タグ"));
    }

    #[test]
    fn 人格が空でもプロトコルは送る() {
        let prompt = build_system_prompt("   ", EmotionMode::Tag, &[]).unwrap();
        assert!(prompt.starts_with("---"));
    }

    #[test]
    fn 人格が空で無効なら何も送らない() {
        // 空文字を送るとプロバイダによっては検証エラーになる
        assert!(build_system_prompt("", EmotionMode::Off, &[]).is_none());
    }

    #[test]
    fn 前後の空白を落とす() {
        let prompt = build_system_prompt("  こんにちは  ", EmotionMode::Off, &[]).unwrap();
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

    fn tags(list: &[&str]) -> Vec<String> {
        list.iter().map(|tag| (*tag).to_owned()).collect()
    }

    #[test]
    fn 身振りの割り当てがあればタグを教える() {
        let prompt =
            build_system_prompt(PERSONA, EmotionMode::Tag, &tags(&["wave", "bow"])).unwrap();
        assert!(prompt.contains("[wave]"));
        assert!(prompt.contains("[bow]"));
    }

    #[test]
    fn 身振りの説明は感情タグの後ろに置く() {
        // 感情は常にある。身振りは足せる場合だけの上乗せ。
        let prompt = build_system_prompt(PERSONA, EmotionMode::Tag, &tags(&["wave"])).unwrap();
        let emotion_at = prompt.find("利用できるタグ: [neutral]").unwrap();
        let gesture_at = prompt.find("身振りのタグ").unwrap();
        assert!(emotion_at < gesture_at);
    }

    #[test]
    fn 割り当てが無ければ身振りに触れない() {
        // 使えないタグを教えると、モデルはそれを書こうとする
        let prompt = build_system_prompt(PERSONA, EmotionMode::Tag, &[]).unwrap();
        assert!(!prompt.contains("身振り"));
    }

    #[test]
    fn 空白だけのタグは載せない() {
        let prompt = build_system_prompt(PERSONA, EmotionMode::Tag, &tags(&["  ", ""])).unwrap();
        assert!(!prompt.contains("身振り"));
    }

    #[test]
    fn 感情タグが無効なら身振りも教えない() {
        // どちらも同じ角括弧の約束に乗っている (要件 R-2)
        let prompt = build_system_prompt(PERSONA, EmotionMode::Off, &tags(&["wave"])).unwrap();
        assert!(!prompt.contains("[wave]"));
    }

    #[test]
    fn 身振りの説明にも例示を入れる() {
        let prompt = build_system_prompt(PERSONA, EmotionMode::Tag, &tags(&["wave"])).unwrap();
        assert!(prompt.contains("[wave]こんにちは"));
    }

    #[test]
    fn プロトコルに例示が含まれる() {
        // 抽象的な説明より few-shot が効く (emotion-protocol.md 6.1)
        assert!(EMOTION_PROTOCOL_BLOCK.contains("例:"));
        assert!(EMOTION_PROTOCOL_BLOCK.contains("[happy:0.7]"));
    }
}
