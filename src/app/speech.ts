import { AudioPlayer, type Playback } from "@/audio/player";
import type { SpeechSegment } from "@/domain/voice/segment";
import { ttsSynthesize } from "@/ipc";

/**
 * 読み上げの待ち行列。
 *
 * 合成は文ごとに投げ、再生は投げた順に一つずつ行う。合成を先に走らせて
 * おくことで、前の文を喋っているあいだに次の文が用意される。
 *
 * 合成の失敗で発話全体を止めない。声が出ないだけで、会話そのものは
 * 成り立つため (docs/requirements.md F-12)。
 */
export class SpeechQueue {
  readonly #player = new AudioPlayer();
  /** 再生の順序を保つための鎖。 */
  #chain: Promise<void> = Promise.resolve();
  /**
   * 中断の世代。
   *
   * 止めた後に、すでに投げてしまった合成が返ってくる。世代が違うものは
   * 捨てる。これが無いと、中断したはずの声が後から鳴る。
   */
  #generation = 0;

  /** 再生が始まった。口を動かすためのつなぎ込みに使う。 */
  onSegment: ((segment: SpeechSegment, playback: Playback) => void) | null = null;
  /** 再生が終わった。 */
  onIdle: (() => void) | null = null;
  /** 合成に失敗した。会話は続けてよい。 */
  onError: ((error: unknown) => void) | null = null;

  /** 合成をすぐ始め、再生は順番を待つ。 */
  enqueue(characterId: string, segment: SpeechSegment): void {
    const generation = this.#generation;
    // 待ち行列に入っているあいだの棄却を、処理されない拒否にしない。
    const pending = ttsSynthesize(characterId, segment.text, segment.emotion).then(
      (wav) => ({ wav, error: null }),
      (error: unknown) => ({ wav: null, error }),
    );

    this.#chain = this.#chain.then(async () => {
      if (generation !== this.#generation) return;
      const { wav, error } = await pending;
      if (generation !== this.#generation) return;
      if (wav === null) {
        this.onError?.(error);
        return;
      }
      try {
        const playback = await this.#player.play(wav);
        if (generation !== this.#generation) {
          playback.stop();
          return;
        }
        this.onSegment?.(segment, playback);
        await playback.finished;
      } catch (playbackError) {
        this.onError?.(playbackError);
      } finally {
        if (generation === this.#generation) this.onIdle?.();
      }
    });
  }

  /** 鳴っているものを止め、待っているものを捨てる。 */
  cancel(): void {
    this.#generation += 1;
    this.#player.stop();
    this.#chain = Promise.resolve();
    this.onIdle?.();
  }

  async dispose(): Promise<void> {
    this.#generation += 1;
    await this.#player.dispose();
  }
}
