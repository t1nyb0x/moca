/**
 * 回転トラックを VRMA (glTF バイナリ) へ組み立てる。
 *
 * VRMA は glTF 2.0 に `VRMC_vrm_animation` 拡張を載せただけのものである。
 * 人型ボーンとノードの対応を拡張へ書き、ノードの回転をアニメーションとして
 * 持たせれば、モデルを選ばず当たる (ADR-0019)。
 *
 * moca が使うのは回転だけだが (`createBodyClip`)、ほかの実装が読んでも
 * 壊れないよう、必須の人型ボーンはすべてノードとして置く。
 */

import { SKELETON } from "./skeleton.mjs";

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

const FLOAT = 5126;

/** 4 の倍数へ切り上げる。glTF はチャンクもビューも 4 バイト境界に揃える。 */
const align4 = (value) => (value + 3) & ~3;

/**
 * @param {{
 *   name: string,
 *   tracks: ReadonlyArray<{ bone: string, times: number[], values: number[] }>,
 * }} spec
 * @returns {Uint8Array} .vrma として書き出せる GLB
 */
export function buildVrma({ name, tracks }) {
  if (tracks.length === 0) throw new Error("トラックが空です");

  const index = new Map(SKELETON.map((bone, at) => [bone.name, at]));
  for (const track of tracks) {
    if (!index.has(track.bone)) throw new Error(`知らない骨です: ${track.bone}`);
  }

  const nodes = SKELETON.map((bone) => {
    const children = SKELETON.map((child, at) => (child.parent === bone.name ? at : -1))
      .filter((at) => at >= 0);
    return {
      name: bone.name,
      translation: bone.translation,
      ...(children.length > 0 ? { children } : {}),
    };
  });

  const humanBones = Object.fromEntries(
    SKELETON.map((bone) => [bone.name, { node: index.get(bone.name) }]),
  );

  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  let offset = 0;

  /** データを詰め、アクセサの番号を返す。 */
  const push = (data, type, extras) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    offset += align4(bytes.byteLength);

    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: FLOAT,
      count: data.length / (type === "VEC4" ? 4 : 1),
      type,
      ...extras,
    });
    return accessors.length - 1;
  };

  const samplers = [];
  const channels = [];

  for (const track of tracks) {
    const times = Float32Array.from(track.times);
    const values = Float32Array.from(track.values);

    // 時刻のアクセサには min/max が要る。無いと読み手が尺を決められない。
    const input = push(times, "SCALAR", {
      min: [times[0]],
      max: [times[times.length - 1]],
    });
    const output = push(values, "VEC4", {});

    samplers.push({ input, output, interpolation: "LINEAR" });
    channels.push({
      sampler: samplers.length - 1,
      target: { node: index.get(track.bone), path: "rotation" },
    });
  }

  const binary = concat(chunks, offset);

  const json = {
    asset: { version: "2.0", generator: "moca vrma builder" },
    extensionsUsed: ["VRMC_vrm_animation"],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: "1.0",
        humanoid: { humanBones },
      },
    },
    nodes,
    scenes: [{ nodes: [index.get("hips")] }],
    scene: 0,
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews,
    accessors,
    animations: [{ name, samplers, channels }],
  };

  return encodeGlb(json, binary);
}

/** バイト列を 4 バイト境界で詰め直して 1 本にする。 */
function concat(chunks, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += align4(chunk.byteLength);
  }
  return out;
}

/**
 * JSON とバイナリを GLB へ包む。
 *
 * JSON チャンクの余りは空白 (0x20)、バイナリチャンクの余りは 0 で埋める。
 * glTF の仕様どおりで、埋め方を間違えると読み手が JSON の解析で落ちる。
 */
export function encodeGlb(json, binary) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = align4(jsonBytes.byteLength);
  const binLength = align4(binary.byteLength);

  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
  out.set(jsonBytes, 20);

  const binAt = 20 + jsonLength;
  view.setUint32(binAt, binLength, true);
  view.setUint32(binAt + 4, CHUNK_BIN, true);
  out.set(binary, binAt + 8);

  return out;
}

/** 書き出した GLB を読み返す。試験と検証に使う。 */
export function decodeGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("GLB ではありません");

  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  );

  const binAt = 20 + jsonLength;
  const binLength = view.getUint32(binAt, true);
  const binary = bytes.subarray(binAt + 8, binAt + 8 + binLength);

  return { json, binary, byteLength: view.getUint32(8, true) };
}
