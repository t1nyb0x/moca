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
 * 窓の縦横比 (横 / 縦)。
 *
 * 立ち姿を収める目安。#13 でモデルの外接矩形から求めるようになるまでの
 * 暫定値 (要件 F-13-4)。
 */
export const MASCOT_ASPECT = 0.6;

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
): { readonly width: number; readonly height: number } {
  const base =
    Number.isFinite(screenHeight) && screenHeight > 0
      ? screenHeight
      : FALLBACK_SCREEN_HEIGHT;
  const height = Math.round(base * clampScale(scale));
  return { width: Math.round(height * MASCOT_ASPECT), height };
}
