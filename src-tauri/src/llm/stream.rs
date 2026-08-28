//! SSE ストリームの駆動ループ。
//!
//! 3 プロバイダで異なるのはイベントの解釈だけで、ループ自体は同一。
//! ここを共通化することで、中断処理やトークン集計の実装が 3 箇所に
//! 散らばるのを防ぐ。

use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::error::ProviderError;
use super::sse::{SseDecoder, SseEvent};
use super::types::{ChatResult, Delta, StopReason, StreamItem, Usage};

/// バイトストリームを読み、差分を sink へ流しながら結果を組み立てる。
///
/// `decode` はイベント 1 件を解釈する純粋関数。プロバイダごとに差し替える。
pub async fn drive<S, E, D>(
    mut stream: S,
    cancel: CancellationToken,
    sink: mpsc::Sender<Delta>,
    decode: D,
) -> Result<ChatResult, ProviderError>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Debug,
    D: Fn(&SseEvent) -> Result<Vec<StreamItem>, ProviderError>,
{
    let mut decoder = SseDecoder::new();
    let mut stop_reason: Option<StopReason> = None;
    let mut usage: Option<Usage> = None;
    let mut ended = false;

    loop {
        let chunk = tokio::select! {
            biased;
            () = cancel.cancelled() => {
                return Ok(ChatResult { stop_reason: StopReason::Cancelled, usage });
            }
            next = stream.next() => next,
        };

        let Some(chunk) = chunk else { break };
        let chunk = chunk
            .map_err(|err| ProviderError::Network(format!("ストリームが途切れました ({err:?})")))?;

        for event in decoder.push(&chunk) {
            match handle(&event, &decode, &sink, &mut stop_reason, &mut usage).await? {
                Flow::Continue => {}
                Flow::End => {
                    ended = true;
                    break;
                }
            }
        }
        if ended {
            break;
        }
    }

    if !ended {
        if let Some(event) = decoder.finish() {
            handle(&event, &decode, &sink, &mut stop_reason, &mut usage).await?;
        }
    }

    Ok(ChatResult {
        // 終端が明示されないまま切れた場合も、受け取れた分は正常扱いにする。
        stop_reason: stop_reason.unwrap_or(StopReason::EndTurn),
        usage,
    })
}

enum Flow {
    Continue,
    End,
}

async fn handle<D>(
    event: &SseEvent,
    decode: &D,
    sink: &mpsc::Sender<Delta>,
    stop_reason: &mut Option<StopReason>,
    usage: &mut Option<Usage>,
) -> Result<Flow, ProviderError>
where
    D: Fn(&SseEvent) -> Result<Vec<StreamItem>, ProviderError>,
{
    for item in decode(event)? {
        match item {
            StreamItem::Delta(delta) => {
                if let Delta::Usage(value) = &delta {
                    *usage = Some(merge_usage(*usage, *value));
                }
                // 受信側が閉じていたら送るのをやめるだけでよい。エラーではない。
                if sink.send(delta).await.is_err() {
                    return Ok(Flow::End);
                }
            }
            StreamItem::Stop(reason) => *stop_reason = Some(reason),
            StreamItem::End => return Ok(Flow::End),
            StreamItem::Ignore => {}
        }
    }
    Ok(Flow::Continue)
}

/// トークン数を併合する。
///
/// Anthropic は入力トークンを message_start、出力トークンを message_delta と
/// 別のイベントで送る。単純に上書きすると先に届いた入力トークンが消える。
fn merge_usage(previous: Option<Usage>, incoming: Usage) -> Usage {
    let Some(previous) = previous else {
        return incoming;
    };
    Usage {
        input_tokens: if incoming.input_tokens > 0 {
            incoming.input_tokens
        } else {
            previous.input_tokens
        },
        output_tokens: if incoming.output_tokens > 0 {
            incoming.output_tokens
        } else {
            previous.output_tokens
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::convert::Infallible;

    fn chunks(parts: &[&str]) -> impl Stream<Item = Result<Bytes, Infallible>> + Unpin {
        let items: Vec<_> = parts
            .iter()
            .map(|part| Ok(Bytes::from(part.to_string())))
            .collect();
        Box::pin(futures_util::stream::iter(items))
    }

    /// data をそのままテキストとして返す素朴なデコーダ。
    fn echo(event: &SseEvent) -> Result<Vec<StreamItem>, ProviderError> {
        Ok(match event.data.as_str() {
            "[DONE]" => vec![StreamItem::End],
            "[STOP]" => vec![StreamItem::Stop(StopReason::MaxTokens)],
            "[SKIP]" => vec![StreamItem::Ignore],
            text => vec![StreamItem::Delta(Delta::Text {
                value: text.to_owned(),
            })],
        })
    }

    async fn collect(
        parts: &[&str],
        cancel: CancellationToken,
    ) -> (Vec<Delta>, Result<ChatResult, ProviderError>) {
        let (tx, mut rx) = mpsc::channel(64);
        let result = drive(chunks(parts), cancel, tx, echo).await;
        let mut deltas = Vec::new();
        while let Ok(delta) = rx.try_recv() {
            deltas.push(delta);
        }
        (deltas, result)
    }

    #[tokio::test]
    async fn 差分を順に流す() {
        let (deltas, result) = collect(
            &["data: a\n\n", "data: b\n\n", "data: [DONE]\n\n"],
            CancellationToken::new(),
        )
        .await;
        assert_eq!(
            deltas,
            vec![
                Delta::Text { value: "a".into() },
                Delta::Text { value: "b".into() }
            ]
        );
        assert_eq!(result.unwrap().stop_reason, StopReason::EndTurn);
    }

    #[tokio::test]
    async fn 停止理由の後の差分も取りこぼさない() {
        // OpenAI 互換は finish_reason の後に usage を送ってくる
        let (deltas, result) = collect(
            &[
                "data: a\n\n",
                "data: [STOP]\n\n",
                "data: b\n\n",
                "data: [DONE]\n\n",
            ],
            CancellationToken::new(),
        )
        .await;
        assert_eq!(deltas.len(), 2);
        assert_eq!(result.unwrap().stop_reason, StopReason::MaxTokens);
    }

    #[tokio::test]
    async fn 無視すべきイベントを飛ばす() {
        let (deltas, _) = collect(
            &["data: [SKIP]\n\n", "data: a\n\n", "data: [DONE]\n\n"],
            CancellationToken::new(),
        )
        .await;
        assert_eq!(deltas, vec![Delta::Text { value: "a".into() }]);
    }

    #[tokio::test]
    async fn 終端が来なくても正常終了する() {
        let (deltas, result) = collect(&["data: a\n\n"], CancellationToken::new()).await;
        assert_eq!(deltas.len(), 1);
        assert_eq!(result.unwrap().stop_reason, StopReason::EndTurn);
    }

    #[tokio::test]
    async fn 空行で閉じられていない末尾も拾う() {
        let (deltas, _) = collect(&["data: a"], CancellationToken::new()).await;
        assert_eq!(deltas, vec![Delta::Text { value: "a".into() }]);
    }

    #[tokio::test]
    async fn 中断はエラーではなく正常終了になる() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let (_, result) = collect(&["data: a\n\n"], cancel).await;
        assert_eq!(result.unwrap().stop_reason, StopReason::Cancelled);
    }

    #[tokio::test]
    async fn チャンク境界をまたいでも差分が壊れない() {
        let source = "data: こんにちは\n\ndata: [DONE]\n\n";
        let bytes = source.as_bytes();
        for size in 1..=bytes.len() {
            let parts: Vec<String> = bytes
                .chunks(size)
                .map(|c| String::from_utf8_lossy(c).into_owned())
                .collect();
            let (tx, mut rx) = mpsc::channel(64);
            let items: Vec<Result<Bytes, Infallible>> = bytes
                .chunks(size)
                .map(|c| Ok(Bytes::copy_from_slice(c)))
                .collect();
            let stream = Box::pin(futures_util::stream::iter(items));
            drive(stream, CancellationToken::new(), tx, echo)
                .await
                .unwrap();

            let mut deltas = Vec::new();
            while let Ok(delta) = rx.try_recv() {
                deltas.push(delta);
            }
            assert_eq!(
                deltas,
                vec![Delta::Text {
                    value: "こんにちは".into()
                }],
                "分割幅 {size} ({parts:?}) で壊れた"
            );
        }
    }

    #[test]
    fn トークン数は上書きではなく併合される() {
        // Anthropic は入力と出力を別イベントで送る
        let after_start = merge_usage(
            None,
            Usage {
                input_tokens: 120,
                output_tokens: 0,
            },
        );
        let after_delta = merge_usage(
            Some(after_start),
            Usage {
                input_tokens: 0,
                output_tokens: 45,
            },
        );
        assert_eq!(
            after_delta,
            Usage {
                input_tokens: 120,
                output_tokens: 45,
            }
        );
    }

    #[tokio::test]
    async fn 受信側が閉じていても失敗しない() {
        let (tx, rx) = mpsc::channel(1);
        drop(rx);
        let result = drive(
            chunks(&["data: a\n\n", "data: b\n\n"]),
            CancellationToken::new(),
            tx,
            echo,
        )
        .await;
        assert!(result.is_ok());
    }
}
