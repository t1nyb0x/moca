/**
 * 描画がソフトウェアで行われているかの判定 (要件 R-3)。
 *
 * WebGL の性能は GPU ドライバに依存し、ソフトウェアへ落ちると実用に
 * 耐えない。落ちていること自体は何のエラーも出ないので、名前から判定して
 * 知らせる。
 */

/** ソフトウェア実装に現れる語。すべて小文字で比較する。 */
const SOFTWARE_MARKERS = [
  "swiftshader",
  "llvmpipe",
  "softpipe",
  "lavapipe",
  "basic render",
  "microsoft basic",
  "software adapter",
  "software rasterizer",
] as const;

export function isSoftwareRenderer(name: string): boolean {
  const normalized = name.toLowerCase();
  return SOFTWARE_MARKERS.some((marker) => normalized.includes(marker));
}
