import { isCanonicalEmotion, type ParseEvent } from "./types";

/**
 * バッファがこの長さを超えたらタグの解釈を諦め、本文として吐き出す。
 *
 * 本文中の素の `[` が応答の残り全体を飲み込むことを防ぐ安全装置。
 * 最長の正当なタグ `[surprised:0.05]` が 16 文字なので余裕を見た値。
 * 仕様: docs/emotion-protocol.md 3.4
 */
export const MAX_TAG_LEN = 24;

/** タグ本体に出現しうる文字。これ以外を見た時点で解釈を中断する。 */
const TAG_BODY_CHAR = /^[a-z0-9:.]$/;

/**
 * `[happy]` `[happy:0.8]` の形。
 * 強度は 0.0 以上 1.0 以下。値域外は文法に適合しても解決しない。
 */
const TAG_PATTERN = /^\[([a-z]+)(?::(\d(?:\.\d+)?))?\]$/;

function parseTag(raw: string): ParseEvent | null {
  const matched = TAG_PATTERN.exec(raw);
  if (matched === null) return null;

  const name = matched[1];
  if (name === undefined || !isCanonicalEmotion(name)) return null;

  const rawIntensity = matched[2];
  if (rawIntensity === undefined) {
    return { type: "emotion", emotion: name, intensity: 1.0 };
  }

  const intensity = Number(rawIntensity);
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) return null;

  return { type: "emotion", emotion: name, intensity };
}

/**
 * LLM の応答ストリームから感情タグを逐次抽出する。
 *
 * チャンク境界をまたぐ部分タグを扱えることが最重要の要件である。
 * `[hap` と `py]` が別チャンクで到着しても正しく解決しなければならない。
 *
 * 設計原則: **本文を絶対に失わない。** 感情が取れないことは許容するが、
 * ユーザーが読むべきテキストが消えることは許容しない。
 *
 * 仕様: docs/emotion-protocol.md 第 3 章
 */
export class EmotionTagParser {
  /** 空文字なら TEXT 状態。非空なら BUFFERING 状態で、必ず `[` から始まる。 */
  #buffer = "";

  push(chunk: string): ParseEvent[] {
    const events: ParseEvent[] = [];
    let pending = "";

    const flushPending = (): void => {
      if (pending === "") return;
      events.push({ type: "text", value: pending });
      pending = "";
    };

    // コードポイント単位で回す。添字だとサロゲートペアを割ってしまう。
    for (const char of chunk) {
      if (this.#buffer === "") {
        if (char === "[") {
          flushPending();
          this.#buffer = "[";
        } else {
          pending += char;
        }
        continue;
      }

      if (char === "]") {
        const parsed = parseTag(this.#buffer + char);
        if (parsed === null) {
          pending += this.#buffer + char;
        } else {
          events.push(parsed);
        }
        this.#buffer = "";
        continue;
      }

      if (TAG_BODY_CHAR.test(char)) {
        this.#buffer += char;
        if (this.#buffer.length > MAX_TAG_LEN) {
          pending += this.#buffer;
          this.#buffer = "";
        }
        continue;
      }

      // 早期中断。タグに出現しえない文字を見たので本文へ戻し、
      // その文字は TEXT 状態として処理し直す。
      pending += this.#buffer;
      this.#buffer = "";
      if (char === "[") {
        flushPending();
        this.#buffer = "[";
      } else {
        pending += char;
      }
    }

    flushPending();
    return events;
  }

  /** ストリーム終端。閉じないまま残ったバッファを本文として吐き出す。 */
  flush(): ParseEvent[] {
    if (this.#buffer === "") return [];
    const value = this.#buffer;
    this.#buffer = "";
    return [{ type: "text", value }];
  }

  reset(): void {
    this.#buffer = "";
  }
}
