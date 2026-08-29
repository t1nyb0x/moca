//! Server-Sent Events のフレーム分解。
//!
//! 3 つの LLM プロバイダはいずれも SSE でストリーミングするが、届く
//! チャンクの切れ目はプロバイダにも回線にも依存する。ここを共通化しないと、
//! チャンク分割起因のバグが 3 アダプタに散らばる。

/// 1 件の SSE イベント。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SseEvent {
    /// `event:` フィールド。省略されることも多い。
    pub event: Option<String>,
    /// `data:` フィールドの内容。複数行は改行で連結される。
    pub data: String,
}

/// チャンクを与えると、完成したイベントだけを返す増分デコーダ。
///
/// バイト列のまま `\n` で行に切り出してから UTF-8 へ変換するのが要点。
/// `\n` は UTF-8 のマルチバイト列の一部になり得ないため、日本語の応答が
/// チャンク境界で割れても文字が壊れない。
#[derive(Debug, Default)]
pub struct SseDecoder {
    /// 行として切り出せていない残りのバイト。
    buffer: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// チャンクを与え、完成したイベントを返す。
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buffer.extend_from_slice(chunk);

        let mut events = Vec::new();
        while let Some(index) = self.buffer.iter().position(|&byte| byte == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=index).collect();
            line.pop(); // '\n'
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if let Some(event) = self.consume_line(&line) {
                events.push(event);
            }
        }
        events
    }

    /// ストリーム終端。空行で閉じられていないイベントを取りこぼさない。
    pub fn finish(&mut self) -> Option<SseEvent> {
        if !self.buffer.is_empty() {
            let mut line: Vec<u8> = std::mem::take(&mut self.buffer);
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if let Some(event) = self.consume_line(&line) {
                return Some(event);
            }
        }
        self.dispatch()
    }

    fn consume_line(&mut self, line: &[u8]) -> Option<SseEvent> {
        if line.is_empty() {
            return self.dispatch();
        }

        // 不正な UTF-8 は捨てずに置換文字へ落とす。1 バイトの化けで
        // ストリーム全体を失うほうが害が大きい。
        let line = String::from_utf8_lossy(line);

        // ':' で始まる行はコメント。キープアライブに使われる。
        if line.starts_with(':') {
            return None;
        }

        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            // 値のないフィールド行。仕様上は空文字を値とする。
            None => (line.as_ref(), ""),
        };

        match field {
            "event" => self.event = Some(value.to_owned()),
            "data" => self.data.push(value.to_owned()),
            // id と retry は本アプリでは使わない
            _ => {}
        }
        None
    }

    fn dispatch(&mut self) -> Option<SseEvent> {
        if self.data.is_empty() {
            // データのないイベントは仕様上ディスパッチしない
            self.event = None;
            return None;
        }
        let data = std::mem::take(&mut self.data).join("\n");
        Some(SseEvent {
            event: self.event.take(),
            data,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(data: &str) -> SseEvent {
        SseEvent {
            event: None,
            data: data.to_owned(),
        }
    }

    fn named(name: &str, data: &str) -> SseEvent {
        SseEvent {
            event: Some(name.to_owned()),
            data: data.to_owned(),
        }
    }

    /// 入力を chunk_size バイトずつ与えて全イベントを集める。
    fn decode_in_chunks(input: &[u8], chunk_size: usize) -> Vec<SseEvent> {
        let mut decoder = SseDecoder::new();
        let mut events = Vec::new();
        for chunk in input.chunks(chunk_size.max(1)) {
            events.extend(decoder.push(chunk));
        }
        events.extend(decoder.finish());
        events
    }

    #[test]
    fn 単一のイベントを取り出せる() {
        let input = b"data: hello\n\n";
        assert_eq!(decode_in_chunks(input, input.len()), vec![event("hello")]);
    }

    #[test]
    fn 複数のイベントを順に取り出せる() {
        let input = b"data: one\n\ndata: two\n\ndata: three\n\n";
        assert_eq!(
            decode_in_chunks(input, input.len()),
            vec![event("one"), event("two"), event("three")]
        );
    }

    #[test]
    fn event_フィールドを拾える() {
        let input = b"event: content_block_delta\ndata: {}\n\n";
        assert_eq!(
            decode_in_chunks(input, input.len()),
            vec![named("content_block_delta", "{}")]
        );
    }

    #[test]
    fn 複数のdata行は改行で連結する() {
        let input = b"data: first\ndata: second\n\n";
        assert_eq!(
            decode_in_chunks(input, input.len()),
            vec![event("first\nsecond")]
        );
    }

    #[test]
    fn コメント行を無視する() {
        let input = b": keep-alive\ndata: hello\n\n";
        assert_eq!(decode_in_chunks(input, input.len()), vec![event("hello")]);
    }

    #[test]
    fn crlf_を扱える() {
        let input = b"event: ping\r\ndata: hello\r\n\r\n";
        assert_eq!(
            decode_in_chunks(input, input.len()),
            vec![named("ping", "hello")]
        );
    }

    #[test]
    fn 値の前の空白を一つだけ落とす() {
        let input = b"data:  two-spaces\n\n";
        assert_eq!(
            decode_in_chunks(input, input.len()),
            vec![event(" two-spaces")]
        );
    }

    #[test]
    fn データのないイベントはディスパッチしない() {
        let input = b"event: ping\n\ndata: hello\n\n";
        assert_eq!(decode_in_chunks(input, input.len()), vec![event("hello")]);
    }

    #[test]
    fn 空行だけでは何も起きない() {
        assert_eq!(decode_in_chunks(b"\n\n\n", 3), vec![]);
    }

    #[test]
    fn 空行で閉じられていない末尾のイベントを取りこぼさない() {
        let input = b"data: hello\n";
        assert_eq!(decode_in_chunks(input, input.len()), vec![event("hello")]);
    }

    #[test]
    fn 改行のない末尾のイベントも拾う() {
        let input = b"data: hello";
        assert_eq!(decode_in_chunks(input, input.len()), vec![event("hello")]);
    }

    /// ここが本デコーダの主目的。
    #[test]
    fn あらゆる分割位置で結果が一致する() {
        let input = concat!(
            "event: content_block_delta\n",
            "data: {\"text\":\"こんにちは\"}\n",
            "\n",
            ": keep-alive\n",
            "\n",
            "data: {\"text\":\"お待ちしておりました\"}\n",
            "\n",
            "data: [DONE]\n",
            "\n",
        )
        .as_bytes();

        let baseline = decode_in_chunks(input, input.len());
        assert_eq!(baseline.len(), 3);

        for size in 1..=input.len() {
            assert_eq!(
                decode_in_chunks(input, size),
                baseline,
                "分割幅 {size} で結果が変わった"
            );
        }
    }

    /// 日本語はマルチバイトなので、1 バイトずつ与えると必ず途中で割れる。
    #[test]
    fn マルチバイト文字がチャンク境界で割れても壊れない() {
        let input = "data: 表情豊かに喋る\n\n".as_bytes();
        for size in 1..=input.len() {
            assert_eq!(
                decode_in_chunks(input, size),
                vec![event("表情豊かに喋る")],
                "分割幅 {size} で文字が壊れた"
            );
        }
    }

    #[test]
    fn 値のないフィールド行を空文字として扱う() {
        let input = b"data\n\n";
        assert_eq!(decode_in_chunks(input, input.len()), vec![event("")]);
    }

    #[test]
    fn 知らないフィールドを無視する() {
        let input = b"id: 42\nretry: 1000\ndata: hello\n\n";
        assert_eq!(decode_in_chunks(input, input.len()), vec![event("hello")]);
    }

    #[test]
    fn イベント名は次のイベントへ持ち越さない() {
        let input = b"event: first\ndata: a\n\ndata: b\n\n";
        assert_eq!(
            decode_in_chunks(input, input.len()),
            vec![named("first", "a"), event("b")]
        );
    }
}
