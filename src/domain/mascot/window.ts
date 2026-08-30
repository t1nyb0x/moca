/**
 * マスコット表示の窓の寸法と、入ってよいかの判定。
 *
 * 仕様: 要件 F-13、docs/adr/0016-single-transparent-window.md
 */

/**
 * 表示倍率の下限。
 *
 * 小さくしすぎると掴めなくなる。マスコット表示は枠なし・常時最前面で、
 * 描かれているところしか拾わないため、掴めない大きさは操作できない窓を
 * 作るのと同じことになる (要件 F-13-3)。
 */
export const MIN_SCALE = 0.15;

/** 画面の高さいっぱいより大きくしても意味がない。 */
export const MAX_SCALE = 1;

export const DEFAULT_SCALE = 0.5;

/**
 * 窓の縦横比 (横 / 縦) の既定値。
 *
 * 通常はモデルの外接箱から求める (要件 F-13-4)。まだモデルを測れていない
 * ときの目安として使う。
 */
export const DEFAULT_ASPECT = 0.6;

/**
 * 縦横比の下限と上限。
 *
 * モデルの外接箱から求めるため、読み込みの具合によっては極端な値になりうる。
 * 細すぎても平たすぎても掴めない窓になるので、範囲へ収める。
 */
export const MIN_ASPECT = 0.15;
export const MAX_ASPECT = 3;

/** 縦横比を扱える範囲へ収める。読めない値は既定へ倒す。 */
export function clampAspect(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, value));
}

/**
 * 吹き出しを出すときに横へ足す幅 (要件 F-13-8)。
 *
 * 窓はモデルの外接箱まで詰めてある (F-13-4)。そのままでは文字が数えるほどしか
 * 入らないため、話すあいだだけ広げる。伸ばすのは右側だけで、モデルの器は幅を
 * 保つ。左右に伸ばすとモデルが画面上で動いて見える。
 */
export const CHAT_EXTRA_WIDTH = 260;

/** 画面の高さが取れない環境で使う値。 */
const FALLBACK_SCREEN_HEIGHT = 800;

/** 倍率を扱える範囲へ収める。読めない値は既定へ倒す。 */
export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/**
 * マスコット表示に入ってよいか (要件 F-13-1)。
 *
 * モデルが描かれていなければ全面が透明になり、全面がクリックスルーとなる。
 * 枠がなく常時最前面で、見えず触れない窓が残る。逃げ道を用意するのではなく、
 * その状態に入れないようにする。
 */
export function canEnterMascot(input: {
  readonly hasModel: boolean;
  readonly showViewer: boolean;
}): boolean {
  return input.hasModel && input.showViewer;
}

/**
 * 窓の大きさ。倍率は画面の高さに対する割合として効く (要件 F-13-3)。
 *
 * 構図は `full` に固定するため、窓ごと拡縮すれば見た目の大きさが決まる。
 */
export function mascotWindowSize(
  scale: number,
  screenHeight: number,
  aspect?: number | null,
  extraWidth = 0,
): { readonly width: number; readonly height: number } {
  const base =
    Number.isFinite(screenHeight) && screenHeight > 0
      ? screenHeight
      : FALLBACK_SCREEN_HEIGHT;
  const height = Math.round(base * clampScale(scale));
  const extra = Number.isFinite(extraWidth) && extraWidth > 0 ? extraWidth : 0;
  return { width: Math.round(height * clampAspect(aspect)) + extra, height };
}

/** モデルの器の幅。吹き出しを出しても、ここは変えない。 */
export function mascotModelWidth(
  scale: number,
  screenHeight: number,
  aspect?: number | null,
): number {
  return mascotWindowSize(scale, screenHeight, aspect).width;
}
