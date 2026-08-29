/**
 * 声の作り方。
 *
 * Rust 側の `VoicePreset` と同じ形にそろえてある。domain は生成型を
 * 参照しない決まり (ADR-0012) なので、ここで定義して構造的に合わせる。
 * 単位はプロバイダ非依存で、1.0 と 0.0 が「普通」を意味する。
 */
export type VoiceStyle = {
  /** 話者・スタイルの差し替え。null なら既定の話者。 */
  readonly speaker: string | null;
  /** 感情成分の値。0.0〜1.0。成分を持たない接続先では空。 */
  readonly components: Readonly<Record<string, number>>;
  /** 話す速さ。1.0 が普通。 */
  readonly speed: number | null;
  /** 声の高さ。0.0 が普通。 */
  readonly pitch: number | null;
  /** 抑揚。1.0 が普通。 */
  readonly intonation: number | null;
};
