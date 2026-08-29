/**
 * トークン数の見積もり。
 *
 * 正確なトークン化はモデルごとに異なり、フロント側では行えない。
 * コンテキスト窓の切り出しに使うだけなので、多めに見積もって安全側へ
 * 倒す。少なく見積もると送信が拒否される。
 *
 * 日本語の文字はおおむね 1 文字 1 トークン、ASCII は 4 文字で 1 トークン
 * 程度として数える。
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 128) {
      ascii += 1;
    } else {
      wide += 1;
    }
  }
  return Math.ceil(ascii / 4) + wide;
}
