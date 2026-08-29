/**
 * 立ち姿を整えるための計算 (ADR-0005 の補足)。
 *
 * T ポーズのままだと人形にしか見えない。モーションデータを持たない構成
 * では、初期姿勢を作り変えることが「生きている感」の前提になる。
 */

/** 腕を下ろす目標角度。水平からの角度で表す。 */
export const DEFAULT_ARM_DECLINATION_DEGREES = 35;

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * 腕をあとどれだけ下ろすべきかを返す。
 *
 * @param armDirectionY 肩から手へ向かう単位ベクトルの Y 成分。
 *   -1 が真下、0 が水平、+1 が真上。
 * @returns 追加で回す角度（ラジアン）。既に十分下がっていれば 0。
 *
 * 既に A ポーズのモデルもあるので、無条件に回さず現状から差分だけを求める。
 * 二重に回すと腕が体へめり込む。
 */
export function armLoweringAngle(
  armDirectionY: number,
  targetDegrees: number = DEFAULT_ARM_DECLINATION_DEGREES,
): number {
  // 数値誤差で asin の定義域を外れないように丸める
  const clamped = Math.min(1, Math.max(-1, armDirectionY));
  const currentDeclination = Math.asin(-clamped);
  const target = targetDegrees * DEGREES_TO_RADIANS;
  return Math.max(0, target - currentDeclination);
}
