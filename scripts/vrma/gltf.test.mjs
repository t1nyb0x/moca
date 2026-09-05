import { describe, expect, it } from "vitest";

import { buildVrma, decodeGlb, encodeGlb } from "./gltf.mjs";
import { SKELETON } from "./skeleton.mjs";
/** 0 度から 30 度へ回るだけの、10 コマの回転トラック。 */
const track = (bone) => {
  const times = [];
  const values = [];
  for (let index = 0; index <= 10; index += 1) {
    const half = ((index / 10) * 30 * Math.PI) / 360;
    times.push(index / 10);
    values.push(0, 0, Math.sin(half), Math.cos(half));
  }
  return { bone, times, values };
};

const build = () => buildVrma({ name: "wave", tracks: [track("rightUpperArm"), track("head")] });

describe("encodeGlb", () => {
  it("包んで開くと元へ戻る", () => {
    const binary = Uint8Array.from([1, 2, 3, 4, 5]);
    const { json, binary: read } = decodeGlb(encodeGlb({ asset: { version: "2.0" } }, binary));
    expect(json.asset.version).toBe("2.0");
    expect([...read.subarray(0, 5)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("全体も各チャンクも 4 バイト境界に揃う", () => {
    // 揃っていないと読み手が JSON の解析で落ちる
    const bytes = encodeGlb({ a: "あ" }, Uint8Array.from([1, 2, 3]));
    expect(bytes.byteLength % 4).toBe(0);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(12, true) % 4).toBe(0);
  });

  it("JSON の余りは空白で埋める", () => {
    const bytes = encodeGlb({ a: 1 }, new Uint8Array(0));
    const view = new DataView(bytes.buffer);
    const length = view.getUint32(12, true);
    const text = new TextDecoder().decode(bytes.subarray(20, 20 + length));
    expect(text.trimEnd()).toBe('{"a":1}');
    expect(text.slice(-1)).toMatch(/[ }]/);
  });
});

describe("buildVrma", () => {
  it("VRMA として名乗る", () => {
    const { json } = decodeGlb(build());
    expect(json.extensionsUsed).toContain("VRMC_vrm_animation");
    expect(json.extensions.VRMC_vrm_animation.specVersion).toBe("1.0");
  });

  it("骨格のすべての骨を人型ボーンとして対応づける", () => {
    // 動かさない骨も置く。読み手が必須の骨を求めても欠けないようにする
    const { json } = decodeGlb(build());
    const humanBones = json.extensions.VRMC_vrm_animation.humanoid.humanBones;
    for (const bone of SKELETON) {
      expect(json.nodes[humanBones[bone.name].node].name).toBe(bone.name);
    }
  });

  it("回転だけを動かす", () => {
    // moca は回転しか使わない。位置や尺を書いても捨てられる
    const { json } = decodeGlb(build());
    for (const channel of json.animations[0].channels) {
      expect(channel.target.path).toBe("rotation");
    }
  });

  it("指定した骨だけにトラックを持つ", () => {
    // 触っていない骨は moca の手続きの動きが動かし続ける
    const { json } = decodeGlb(build());
    const animated = json.animations[0].channels.map(
      (channel) => json.nodes[channel.target.node].name,
    );
    expect(animated.sort()).toEqual(["head", "rightUpperArm"]);
  });

  it("時刻のアクセサに min と max を持つ", () => {
    // 無いと読み手が尺を決められない
    const { json } = decodeGlb(build());
    const input = json.accessors[json.animations[0].samplers[0].input];
    expect(input.min).toEqual([0]);
    expect(input.max).toEqual([1]);
    expect(input.type).toBe("SCALAR");
  });

  it("バッファの長さが宣言と合う", () => {
    const { json, binary } = decodeGlb(build());
    expect(binary.byteLength).toBeGreaterThanOrEqual(json.buffers[0].byteLength);
    for (const view of json.bufferViews) {
      expect(view.byteOffset % 4).toBe(0);
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(binary.byteLength);
    }
  });

  it("知らない骨は受け付けない", () => {
    expect(() => buildVrma({ name: "x", tracks: [track("leftWing")] })).toThrow();
  });

  it("トラックが無ければ作らない", () => {
    expect(() => buildVrma({ name: "x", tracks: [] })).toThrow();
  });
});
