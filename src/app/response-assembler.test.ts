import { describe, expect, it } from "vitest";
import { ResponseAssembler } from "./response-assembler";

function feed(chunks: readonly string[]): ResponseAssembler {
  const assembler = new ResponseAssembler();
  for (const chunk of chunks) assembler.push(chunk);
  assembler.finish();
  return assembler;
}

/** 文字列を size 文字ずつに割る。 */
function split(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

describe("ResponseAssembler", () => {
  it("タグを除いた本文を作る", () => {
    const assembler = feed(["[happy]ごきげんよう。[sad]さようなら。"]);
    expect(assembler.display).toBe("ごきげんよう。さようなら。");
  });

  it("タグを含む原文を保つ", () => {
    const raw = "[happy]ごきげんよう。[sad]さようなら。";
    expect(feed([raw]).raw).toBe(raw);
  });

  it("感情の位置を表示用本文の上で数える", () => {
    // raw 上の位置だとタグの長さぶんずれ、復元時に噛み合わない
    const assembler = feed(["[happy]ごきげんよう。[sad]さようなら。"]);
    expect(assembler.emotions).toEqual([
      { offset: 0, emotion: "happy", intensity: 1 },
      { offset: 7, emotion: "sad", intensity: 1 },
    ]);
    expect(assembler.display.slice(7)).toBe("さようなら。");
  });

  it("強度を保つ", () => {
    const assembler = feed(["[happy:0.6]うれしい"]);
    expect(assembler.emotions[0]?.intensity).toBe(0.6);
  });

  it("タグが無ければ感情を記録しない", () => {
    const assembler = feed(["ごきげんよう。"]);
    expect(assembler.emotions).toEqual([]);
    expect(assembler.display).toBe("ごきげんよう。");
    expect(assembler.currentEmotion.emotion).toBe("neutral");
  });

  it("同じ感情の連続指定は記録しない", () => {
    const assembler = feed(["[happy]あ[happy]い[happy:0.5]う"]);
    expect(assembler.emotions).toHaveLength(2);
    expect(assembler.emotions[1]?.intensity).toBe(0.5);
  });

  it("チャンクの分割位置によらず同じ結果になる", () => {
    const source = "[happy]ごきげんよう。[surprised:0.7]えっ、本当ですか。";
    const baseline = feed([source]);

    for (let size = 1; size <= source.length; size += 1) {
      const assembler = feed(split(source, size));
      expect(assembler.display).toBe(baseline.display);
      expect(assembler.raw).toBe(baseline.raw);
      expect(assembler.emotions).toEqual(baseline.emotions);
    }
  });

  it("チャンクごとに追加分だけを返す", () => {
    const assembler = new ResponseAssembler();
    expect(assembler.push("[happy]ごき").appendedText).toBe("ごき");
    expect(assembler.push("げんよう").appendedText).toBe("げんよう");
    expect(assembler.finish().appendedText).toBe("");
  });

  it("感情が変わったチャンクだけ感情を返す", () => {
    const assembler = new ResponseAssembler();
    expect(assembler.push("ふつう").emotion).toBeNull();
    expect(assembler.push("[happy]うれしい").emotion).toEqual({
      emotion: "happy",
      intensity: 1,
    });
    expect(assembler.push("まだうれしい").emotion).toBeNull();
  });

  it("閉じないタグの文字を取りこぼさない", () => {
    const assembler = feed(["こんにちは[hap"]);
    expect(assembler.display).toBe("こんにちは[hap");
  });

  it("finish は二度呼んでも重複しない", () => {
    const assembler = new ResponseAssembler();
    assembler.push("[hap");
    expect(assembler.finish().appendedText).toBe("[hap");
    expect(assembler.finish().appendedText).toBe("");
    expect(assembler.display).toBe("[hap");
  });

  it("保存できる形にできる", () => {
    const assembler = feed(["[happy]ごきげんよう。"]);
    const message = assembler.toMessage("2026-08-29T00:00:00Z", "llama3.2");
    expect(message).toEqual({
      role: "assistant",
      content: "ごきげんよう。",
      rawContent: "[happy]ごきげんよう。",
      emotions: [{ offset: 0, emotion: "happy", intensity: 1 }],
      createdAt: "2026-08-29T00:00:00Z",
      model: "llama3.2",
    });
  });

  it("使ったモデルが分からなければ null で保存する", () => {
    const message = feed(["ふつうの返事"]).toMessage("2026-08-29T00:00:00Z", null);
    expect(message.model).toBeNull();
  });

  it("感情が無ければ emotions は null で保存する", () => {
    const message = feed(["ふつうの返事"]).toMessage("2026-08-29T00:00:00Z", null);
    expect(message.emotions).toBeNull();
  });

  it("割り当てた身振りのタグを拾う", () => {
    const assembler = new ResponseAssembler(["wave"]);
    const update = assembler.push("[wave]こんにちは");
    expect(update.gestures).toEqual([{ tag: "wave", intensity: 1 }]);
    expect(update.appendedText).toBe("こんにちは");
  });

  it("身振りのタグは本文にも原文の外にも残さない", () => {
    const assembler = new ResponseAssembler(["wave"]);
    assembler.push("[wave]やあ");
    expect(assembler.display).toBe("やあ");
    // 原文はタグを含んだまま残す。再開時に同じ動きを復元できるようにする。
    expect(assembler.raw).toBe("[wave]やあ");
  });

  it("同じ身振りが続いても間引かない", () => {
    // 二度うなずくのと一度うなずくのは違う
    const assembler = new ResponseAssembler(["nod"]);
    const update = assembler.push("[nod][nod]はい");
    expect(update.gestures).toHaveLength(2);
  });

  it("強さを持ち回る", () => {
    const assembler = new ResponseAssembler(["wave"]);
    expect(assembler.push("[wave:0.4]やあ").gestures).toEqual([
      { tag: "wave", intensity: 0.4 },
    ]);
  });

  it("割り当てていないタグは本文として残す", () => {
    const assembler = new ResponseAssembler(["wave"]);
    const update = assembler.push("[bow]やあ");
    expect(update.gestures).toEqual([]);
    expect(assembler.display).toBe("[bow]やあ");
  });

  it("身振りを渡さなければ従来どおり動く", () => {
    const assembler = new ResponseAssembler();
    const update = assembler.push("[happy]やあ");
    expect(update.gestures).toEqual([]);
    expect(update.emotion).toEqual({ emotion: "happy", intensity: 1 });
  });

  it("感情と身振りを同じ差分で受け取れる", () => {
    const assembler = new ResponseAssembler(["wave"]);
    const update = assembler.push("[happy][wave]やあ");
    expect(update.emotion).toEqual({ emotion: "happy", intensity: 1 });
    expect(update.gestures).toEqual([{ tag: "wave", intensity: 1 }]);
  });

  it("空の応答も壊れない", () => {
    const assembler = feed([]);
    expect(assembler.display).toBe("");
    expect(assembler.toMessage("t", null).content).toBe("");
  });
});
