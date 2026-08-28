/**
 * 口形（ビセーム）。VRM の母音表現に対応する。
 * 仕様: docs/emotion-protocol.md 第 7 章
 */
export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh";

/**
 * 1 文字から導かれる口の指示。
 *
 * - `viseme`: その母音の口形を作る
 * - `hold`: 直前の口形を保つ（促音・撥音・長音）
 * - `close`: 口を閉じる（句読点・記号・空白）
 */
export type VisemeCue =
  | { readonly kind: "viseme"; readonly viseme: Viseme }
  | { readonly kind: "hold" }
  | { readonly kind: "close" };

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_OFFSET = 0x60;

/** カタカナを平仮名へ正規化する。写像表を平仮名だけで持てるようにするため。 */
function toHiragana(char: string): string {
  const code = char.codePointAt(0) ?? -1;
  if (code < KATAKANA_START || code > KATAKANA_END) return char;
  return String.fromCodePoint(code - KANA_OFFSET);
}

/**
 * 母音ごとの写像表。
 *
 * Unicode の並びから機械的に導く手もあるが、五十音の並びは小書き文字や
 * 促音が混ざって規則的ではない。表を明示したほうが監査できる。
 */
const VISEME_ROWS: ReadonlyArray<readonly [Viseme, string]> = [
  ["aa", "あかさたなはまやらわがざだばぱぁゃゎゕ"],
  ["ih", "いきしちにひみりぎじぢびぴぃゐ"],
  ["ou", "うくすつぬふむゆるぐずづぶぷぅゅゔ"],
  ["ee", "えけせてねへめれげぜでべぺぇゑゖ"],
  ["oh", "おこそとのほもよろをごぞどぼぽぉょ"],
];

const VISEME_BY_KANA: ReadonlyMap<string, Viseme> = new Map(
  VISEME_ROWS.flatMap(([v, chars]) =>
    [...chars].map((char) => [char, v] as const),
  ),
);

/** 直前の口形を保つ文字。促音、撥音、長音、波ダッシュ。 */
const HOLD_CHARS: ReadonlySet<string> = new Set([
  "っ",
  "ん",
  "ー",
  "〜",
  "～",
]);

/** 口を閉じる文字。句読点、括弧、記号、空白。 */
const CLOSE_CHARS: ReadonlySet<string> = new Set([
  ..."。、，．・…‥！？!?,.:：;；",
  ..."「」『』（）()【】〔〕[]{}〈〉《》",
  ..."\"'“”‘’`",
  ..."-–—/\\|=+*#@&%$^~<>",
]);

const WHITESPACE = /\s/u;

/** 1 文字に対する口の指示を返す。複数文字を渡した場合は先頭のみを見る。 */
export function cueOf(char: string): VisemeCue {
  const first = [...char][0];
  if (first === undefined) return { kind: "close" };

  const normalized = toHiragana(first);

  if (HOLD_CHARS.has(normalized)) return { kind: "hold" };
  if (WHITESPACE.test(normalized) || CLOSE_CHARS.has(normalized)) {
    return { kind: "close" };
  }

  const viseme = VISEME_BY_KANA.get(normalized);
  if (viseme !== undefined) return { kind: "viseme", viseme };

  // 漢字・英数字・その他。形態素解析はしないので便宜的に aa を当てる。
  return { kind: "viseme", viseme: "aa" };
}

/** 文字列を先頭から順に写像する。サロゲートペアを割らない。 */
export function cuesOf(text: string): VisemeCue[] {
  return [...text].map(cueOf);
}
