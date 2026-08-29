import { rmsOf, type AudioSample } from "@/domain/lipsync/audio";

/**
 * 読み上げ音声の再生と、口を動かすための観測。
 *
 * WebAudio を触る唯一の場所。判断は domain の純粋関数に任せ、ここは
 * 再生位置と音量を測って渡すだけにする (ADR-0005)。
 */

/** 波形の解像度。口の開閉を測るだけなので小さくてよい。 */
const FFT_SIZE = 512;

export type Playback = {
  /** 今の再生位置と音量。毎フレーム呼ばれる。 */
  readonly sample: () => AudioSample;
  /** 途中で止める。冪等。 */
  readonly stop: () => void;
  /** 再生し終えるか、止められると解決する。 */
  readonly finished: Promise<void>;
};

/** 何も鳴っていないときの観測値。 */
const SILENT: AudioSample = { progress: 0, amplitude: 0 };

export const IDLE_PLAYBACK: Playback = {
  sample: () => SILENT,
  stop: () => {},
  finished: Promise.resolve(),
};

export class AudioPlayer {
  #context: AudioContext | null = null;
  #current: Playback | null = null;

  /**
   * 再生は一度に一つ。新しい発話は前の発話を止める。
   *
   * 重なると何を喋っているのか分からなくなるうえ、口の駆動元も
   * 二重になる。
   */
  async play(wav: ArrayBuffer): Promise<Playback> {
    this.stop();

    const context = this.#ensureContext();
    // 自動再生の制限で停止していることがある。無音のまま終わらせない。
    if (context.state === "suspended") await context.resume();

    // decodeAudioData は渡した ArrayBuffer を切り離すことがあるため複製する。
    const decoded = await context.decodeAudioData(wav.slice(0));

    const source = context.createBufferSource();
    source.buffer = decoded;

    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    const waveform = new Uint8Array(analyser.fftSize);

    source.connect(analyser);
    analyser.connect(context.destination);

    const startedAt = context.currentTime;
    const duration = decoded.duration;
    let stopped = false;

    let resolve: () => void = () => {};
    const finished = new Promise<void>((r) => {
      resolve = r;
    });
    source.onended = () => {
      stopped = true;
      resolve();
    };

    const playback: Playback = {
      sample: () => {
        if (stopped || duration <= 0) return SILENT;
        analyser.getByteTimeDomainData(waveform);
        return {
          progress: Math.min(1, (context.currentTime - startedAt) / duration),
          amplitude: rmsOf(waveform),
        };
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        // 既に終わっている音源への stop は例外になる
        try {
          source.stop();
        } catch {
          // 無視してよい
        }
        source.disconnect();
        analyser.disconnect();
        resolve();
      },
      finished,
    };

    this.#current = playback;
    source.start();
    return playback;
  }

  /** 鳴っているものを止める。何も鳴っていなくてもよい。 */
  stop(): void {
    this.#current?.stop();
    this.#current = null;
  }

  /** 画面を閉じるときに資源を返す。 */
  async dispose(): Promise<void> {
    this.stop();
    const context = this.#context;
    this.#context = null;
    if (context !== null) await context.close();
  }

  /**
   * AudioContext は利用者の操作より前には作らない。
   *
   * 起動時に作ると自動再生の制限で suspended のまま始まる。
   */
  #ensureContext(): AudioContext {
    this.#context ??= new AudioContext();
    return this.#context;
  }
}
