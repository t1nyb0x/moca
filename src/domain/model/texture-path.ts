/**
 * PMX が参照するテクスチャの絶対パスを求める。
 *
 * PMX はテクスチャを「モデルからの相対パス」で持つ。区切りは環境により
 * `\` と `/` が混在し、`..` を含むこともある。
 *
 * Tauri の `convertFileSrc` はパス全体を 1 つの URL セグメントへ符号化する
 * ため、そこからの相対解決は働かない。実際 `服2.tga` がそのまま要求されて
 * 失敗した。相対パスは自前で解決してから URL にする必要がある。
 */

/** モデルのあるディレクトリ。区切りは元の表記を保つ。 */
export function directoryOf(modelPath: string): string {
  const index = Math.max(modelPath.lastIndexOf("/"), modelPath.lastIndexOf("\\"));
  return index < 0 ? "" : modelPath.slice(0, index);
}

/**
 * モデルの位置とテクスチャの相対パスから絶対パスを組み立てる。
 *
 * `..` と `.` は畳む。畳んだ結果ディレクトリの外へ出る場合もそのまま返す。
 * 許可の判断は Rust 側のアセットスコープに任せる。ここで独自に弾くと、
 * 正当な参照まで塞いでしまう。
 */
export function resolveTexturePath(modelPath: string, texturePath: string): string {
  const trimmed = texturePath.trim();
  if (trimmed === "") return "";

  // 既に絶対パスならそのまま使う
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return trimmed;
  }

  const separator = modelPath.includes("\\") ? "\\" : "/";
  const base = directoryOf(modelPath);
  const segments = base === "" ? [] : base.split(/[\\/]/);

  for (const segment of trimmed.split(/[\\/]/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // ルートより上へは戻さない
      if (segments.length > 1) segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join(separator);
}
