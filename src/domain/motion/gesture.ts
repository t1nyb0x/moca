/**
 * 身振りのタグ (要件 F-15)。
 *
 * 感情タグと違い、**顔ぶれは利用者が決める**。VRMA を読み込んで好きな名前を
 * 付け、その名前がシステムプロンプトへ載る (ADR-0019)。moca 側は名前を一つも
 * 知らない。
 *
 * ここにあるのは名前の決まりだけ。再生そのものは three.js 側に置く。
 */

import { isCanonicalEmotion } from "@/domain/emotion/types";

/**
 * 使える名前の形。
 *
 * 感情タグの文法 (`[a-z]+`) に合わせる。パーサはこの形しか拾わないので、
 * ここから外れた名前を付けると、そのタグは本文として画面に出てしまう
 * (docs/emotion-protocol.md 3.4)。
 */
export const GESTURE_TAG_PATTERN = /^[a-z]+$/;

export type GestureTagProblem = "empty" | "shape" | "reserved" | "duplicate";

/**
 * タグ名を確かめる。問題が無ければ null。
 *
 * @param existing 既に使われている名前。自分自身は含めないこと。
 */
export function validateGestureTag(
  tag: string,
  existing: readonly string[] = [],
): GestureTagProblem | null {
  if (tag === "") return "empty";
  if (!GESTURE_TAG_PATTERN.test(tag)) return "shape";
  // 感情タグと同じ名前は付けられない。パーサは感情として解決してしまう。
  if (isCanonicalEmotion(tag)) return "reserved";
  if (existing.includes(tag)) return "duplicate";
  return null;
}

/** 問題を利用者向けの文言にする。 */
export function describeGestureTagProblem(problem: GestureTagProblem): string {
  switch (problem) {
    case "empty":
      return "タグ名を入れてください";
    case "shape":
      return "タグ名は英小文字だけで書いてください";
    case "reserved":
      return "感情タグと同じ名前は使えません";
    case "duplicate":
      return "同じタグ名が既にあります";
  }
}

/** 入力欄からの値を整える。前後の空白を落とし、英大文字を小文字にする。 */
export function normalizeGestureTag(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 割り当て。パスは VRMA の絶対パス。 */
export type GestureBinding = {
  readonly tag: string;
  readonly path: string;
  readonly name: string;
};

/**
 * 実際に使える割り当てだけを残す。
 *
 * 名前の決まりは画面で守らせるが、設定ファイルは手で書き換えられる。
 * 壊れた割り当てでプロンプトを汚さないよう、使う側でも一度ふるいにかける。
 * 同じタグが二つあれば先に書かれたほうを採る。
 */
export function usableGestures(
  bindings: readonly GestureBinding[],
): readonly GestureBinding[] {
  const seen: string[] = [];
  const result: GestureBinding[] = [];

  for (const binding of bindings) {
    const tag = normalizeGestureTag(binding.tag);
    if (validateGestureTag(tag, seen) !== null) continue;
    if (binding.path === "") continue;
    seen.push(tag);
    result.push({ ...binding, tag });
  }
  return result;
}
