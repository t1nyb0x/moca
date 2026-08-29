import { EmotionTagParser } from "@/domain/emotion/parser";
import { NEUTRAL_CUE, type EmotionCue } from "@/domain/emotion/types";
import type { EmotionSpan } from "@/ipc/generated/EmotionSpan";
import type { Message } from "@/ipc/generated/Message";

export type { EmotionCue };

/** 1 チャンクを流し込んだ結果、UI と 3D ビューへ伝えるべきこと。 */
export type AssemblerUpdate = {
  /** 今回新たに確定した表示用テキスト。リップシンクへも渡す。 */
  readonly appendedText: string;
  /** 感情が変わったなら新しい感情。変わっていなければ null。 */
  readonly emotion: EmotionCue | null;
};

const NEUTRAL = NEUTRAL_CUE;

/**
 * ストリーミング応答を組み立てる。
 *
 * 保存に必要な 3 つの値を同時に作る。
 * - `display`: タグを除いた表示用の本文
 * - `raw`: タグを含む原文（再開時に表情を復元するため）
 * - `emotions`: 感情が切り替わる位置（display 上の文字数）
 *
 * 位置を display 上で数えるのが要点。raw 上の位置ではタグの長さぶん
 * ずれるため、復元時に表示と噛み合わない。
 */
export class ResponseAssembler {
  #parser = new EmotionTagParser();
  #display = "";
  #raw = "";
  #emotions: EmotionSpan[] = [];
  #current: EmotionCue = NEUTRAL;
  #finished = false;

  get display(): string {
    return this.#display;
  }

  get raw(): string {
    return this.#raw;
  }

  get emotions(): readonly EmotionSpan[] {
    return this.#emotions;
  }

  get currentEmotion(): EmotionCue {
    return this.#current;
  }

  push(chunk: string): AssemblerUpdate {
    this.#raw += chunk;
    return this.#consume(this.#parser.push(chunk));
  }

  /** ストリーム終端。閉じないまま残った文字を取りこぼさない。 */
  finish(): AssemblerUpdate {
    if (this.#finished) return { appendedText: "", emotion: null };
    this.#finished = true;
    return this.#consume(this.#parser.flush());
  }

  #consume(events: ReturnType<EmotionTagParser["push"]>): AssemblerUpdate {
    let appendedText = "";
    let emotion: EmotionCue | null = null;

    for (const event of events) {
      if (event.type === "text") {
        appendedText += event.value;
        this.#display += event.value;
        continue;
      }

      const next: EmotionCue = {
        emotion: event.emotion,
        intensity: event.intensity,
      };
      // 同じ感情の連続指定は意味を持たない (emotion-protocol.md W-5)
      if (
        next.emotion === this.#current.emotion &&
        next.intensity === this.#current.intensity
      ) {
        continue;
      }

      this.#current = next;
      emotion = next;
      this.#emotions.push({
        offset: this.#display.length,
        emotion: next.emotion,
        intensity: next.intensity,
      });
    }

    return { appendedText, emotion };
  }

  /** 保存できる形にする。 */
  toMessage(createdAt: string): Message {
    return {
      role: "assistant",
      content: this.#display,
      rawContent: this.#raw,
      emotions: this.#emotions.length > 0 ? [...this.#emotions] : null,
      createdAt,
    };
  }
}
