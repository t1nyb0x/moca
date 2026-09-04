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

/**
 * 自然な立ち姿の角度 (要件 F-14-1)。
 *
 * A ポーズに見える原因は、腕の角度そのものより **「指がまっすぐ開いている」
 * ことと「左右が完全に対称であること」** にある。どちらも人がとらない形で、
 * 見た瞬間に人形と分かる。
 *
 * いずれも基準の姿勢を一度だけ作り変えるためのもので、床との接地は変えない。
 */
export const NATURAL_STANCE = {
  /** 肘の曲げ。まっすぐだと棒に見える。 */
  elbowRadians: 0.24,
  /** 肩の下がり。いからせない。 */
  shoulderDropRadians: 0.045,
  /** 手首の掌屈。手の甲が正面を向いたままだと硬い。 */
  wristRadians: 0.07,
  /** 指の曲げ (付け根)。関節ごとの倍率は FINGER_CURL_SCALE。 */
  fingerCurlRadians: 0.26,
  /** つま先の開き。左右へ均等に開く。 */
  toeOutRadians: 0.07,
  /** 左右の崩し。完全対称を避けるだけの、ごく浅い差。 */
  asymmetryRadians: 0.05,
} as const;

/**
 * 指の関節ごとの曲げ具合。
 *
 * 力を抜いた手は、付け根より第二関節のほうが深く曲がる。すべて同じ角度に
 * すると円弧を描いて、握った形にならない。
 */
export const FINGER_CURL_SCALE = {
  proximal: 1,
  intermediate: 1.3,
  distal: 0.85,
} as const;

/**
 * 探りの結果から、実際に回す向きを決める。
 *
 * モデルによって軸の向きが入れ替わることがあるので、値を決め打ちせず
 * 一度動かして測る。`relaxArm` と同じ考え方。
 *
 * @param probeSign 試しに回した向き。
 * @param movedAsIntended その向きで狙いどおりに動いたか。
 */
export function resolveDirection(probeSign: number, movedAsIntended: boolean): number {
  return movedAsIntended ? probeSign : -probeSign;
}
