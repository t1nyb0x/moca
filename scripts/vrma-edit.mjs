/**
 * 手持ちの VRMA を切り出して、moca で使える形に整える。
 *
 *   node scripts/vrma-edit.mjs <入力.vrma> <出力.vrma> [--from 秒] [--to 秒]
 *                              [--bones right-arm] [--fps 30]
 *                              [--smooth 回数] [--max-speed 度/秒]
 *
 * **元のファイルは書き換えない。** 別名で書き出す。
 *
 * ## 何のためにあるか
 *
 * 撮影した VRMA をそのまま割り当てると、二つのことが起きる。
 *
 * 1. **全身のトラックが moca の立ち姿を上書きする。** 撮影では解かれていない
 *    側の腕や脚まで入っており、肘の曲げ・指の握り・体重移動が消えて人形に
 *    見える。要る骨だけを残せば、残りは moca の手続きの動きが生き続ける
 * 2. **両端の姿勢には手を入れない。** 「moca の立ち姿」は一つに決まらないので、
 *    決め打ちで書き込むと腕がその角度まで持ち上がって跳ねる。実際にそうなった。
 *    立ち姿への着地は moca 側が行う (`retarget.ts`、要件 F-15-3)
 *
 * 3. **撮影データは暴れる。** 推定を見失うと、1 コマで数十度跳ぶ。指のように
 *    小さく速く動く骨ほどひどい。均しと速さの頭打ちで抑える
 *
 * 回転だけを取り出して書き直す。腰の移動と表情は落とす。moca はどちらも
 * 使わない (ADR-0019)。
 */
import { readFileSync, writeFileSync } from "node:fs";

import { buildVrma, decodeGlb } from "./vrma/gltf.mjs";
import { slerp } from "./vrma/quaternion.mjs";
import { SKELETON } from "./vrma/skeleton.mjs";

/** 残す骨の組。 */
const PRESETS = {
  /** 右腕と右手。指まで含む。 */
  "right-arm": (name) =>
    /^right(UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(name),
  /** 右腕だけ。指は moca の立ち姿に任せる。 */
  "right-arm-only": (name) => /^right(UpperArm|LowerArm|Hand)$/.test(name),
  /** 両腕と両手。 */
  arms: (name) =>
    /^(left|right)(Shoulder|UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(name),
  /** すべて。 */
  all: () => true,
};

/** glTF のアクセサを読む。 */
function reader(json, binary) {
  const sizes = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  return (index) => {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView];
    const offset = binary.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const length = accessor.count * sizes[accessor.type];
    return new Float32Array(binary.buffer.slice(offset, offset + length * 4));
  };
}

/** VRMA から、人型ボーン名ごとの回転トラックを取り出す。 */
export function readRotationTracks(bytes) {
  const { json, binary } = decodeGlb(bytes);
  const read = reader(json, binary);

  const extension = json.extensions?.VRMC_vrm_animation;
  if (extension === undefined) throw new Error("VRMA ではありません");

  const boneOf = new Map();
  for (const [bone, { node }] of Object.entries(extension.humanoid.humanBones)) {
    boneOf.set(node, bone);
  }

  const animation = json.animations?.[0];
  if (animation === undefined) throw new Error("アニメーションがありません");

  const tracks = new Map();
  for (const channel of animation.channels) {
    if (channel.target.path !== "rotation") continue;
    const bone = boneOf.get(channel.target.node);
    if (bone === undefined) continue;

    const sampler = animation.samplers[channel.sampler];
    tracks.set(bone, { times: read(sampler.input), values: read(sampler.output) });
  }
  return tracks;
}

/** トラックから、その時刻の回転を求める。 */
function quaternionAt({ times, values }, time) {
  const quaternion = (index) => [
    values[index * 4],
    values[index * 4 + 1],
    values[index * 4 + 2],
    values[index * 4 + 3],
  ];

  if (time <= times[0]) return quaternion(0);
  if (time >= times[times.length - 1]) return quaternion(times.length - 1);

  let index = 0;
  while (index < times.length - 1 && times[index + 1] <= time) index += 1;

  const span = times[index + 1] - times[index];
  const t = span === 0 ? 0 : (time - times[index]) / span;
  return slerp(quaternion(index), quaternion(index + 1), t);
}

/** 回転どうしの角度 (度)。 */
function angleBetween(a, b) {
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

/**
 * 1 コマあたりの回転量に頭打ちを設ける。
 *
 * 撮影が推定を見失うと、1 コマで数十度跳ぶ。**跳んだ先が正しいとは限らない**
 * ので、追いつく速さを制限する。行き先が本物なら数コマで追いつき、跳ねただけ
 * なら均されて消える。
 */
export function clampSpeed(values, seconds, maxDegreesPerSecond) {
  const limit = (maxDegreesPerSecond * seconds) / (values.length / 4 - 1);
  const out = values.slice();
  for (let index = 1; index < out.length / 4; index += 1) {
    const previous = out.slice((index - 1) * 4, index * 4);
    const current = out.slice(index * 4, index * 4 + 4);
    const angle = angleBetween(previous, current);
    if (angle > limit) {
      const eased = slerp(previous, current, limit / angle);
      for (let axis = 0; axis < 4; axis += 1) out[index * 4 + axis] = eased[axis];
    }
  }
  return out;
}

/**
 * 前後のコマへ寄せて均す。細かい震えを落とす。
 *
 * 両隣の中間へ少しずつ寄せることを繰り返す。回数を増やすほど滑らかになり、
 * そのぶん動きの角も丸くなる。両端は動かさない。立ち姿へ寄せた値を保つため。
 */
export function smoothTrack(values, passes, strength = 0.5) {
  let out = values.slice();
  for (let pass = 0; pass < passes; pass += 1) {
    const next = out.slice();
    for (let index = 1; index < out.length / 4 - 1; index += 1) {
      const previous = out.slice((index - 1) * 4, index * 4);
      const current = out.slice(index * 4, index * 4 + 4);
      const following = out.slice((index + 1) * 4, (index + 2) * 4);
      const middle = slerp(previous, following, 0.5);
      const eased = slerp(current, middle, strength);
      for (let axis = 0; axis < 4; axis += 1) next[index * 4 + axis] = eased[axis];
    }
    out = next;
  }
  return out;
}

/**
 * 切り出して、要る骨だけを残し、両端を立ち姿へ寄せる。
 *
 * @returns {Array<{ bone: string, times: number[], values: number[] }>}
 */
export function trim(tracks, { from, to, keep, fps, smooth, maxSpeed }) {
  const known = new Set(SKELETON.map((bone) => bone.name));
  const count = Math.max(1, Math.round((to - from) * fps));
  const out = [];

  for (const [bone, track] of tracks) {
    if (!keep(bone) || !known.has(bone)) continue;

    const times = [];
    let values = [];
    for (let index = 0; index <= count; index += 1) {
      const time = (index / count) * (to - from);
      times.push(Number(time.toFixed(6)));
      values.push(...quaternionAt(track, from + time));
    }

    // 暴れを抑えてから両端を寄せる。順序が逆だと、跳ねが寄せた値まで
    // 引きずってしまう。
    if (maxSpeed > 0) values = clampSpeed(values, to - from, maxSpeed);
    if (smooth > 0) values = smoothTrack(values, smooth);

    out.push({ bone, times, values: values.map(Number) });
  }
  return out;
}

function main(argv) {
  const [input, output] = argv.filter((value) => !value.startsWith("--"));
  if (input === undefined || output === undefined) {
    console.error("使い方: node scripts/vrma-edit.mjs <入力> <出力> [--from 秒] [--to 秒] ...");
    process.exit(1);
  }

  const option = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    return at < 0 ? fallback : argv[at + 1];
  };

  const preset = option("bones", "right-arm");
  const keep = PRESETS[preset];
  if (keep === undefined) {
    console.error(`知らない組です: ${preset} (${Object.keys(PRESETS).join(" / ")})`);
    process.exit(1);
  }

  const tracks = readRotationTracks(new Uint8Array(readFileSync(input)));
  const last = Math.max(...[...tracks.values()].map(({ times }) => times[times.length - 1]));

  const from = Number(option("from", 0));
  const to = Number(option("to", last));
  const edited = trim(tracks, {
    from,
    to,
    keep,
    fps: Number(option("fps", 30)),
    smooth: Number(option("smooth", 2)),
    maxSpeed: Number(option("max-speed", 400)),
  });

  const bytes = buildVrma({ name: option("name", "gesture"), tracks: edited });
  writeFileSync(output, bytes);

  console.log(`${output} (${bytes.byteLength} バイト)`);
  console.log(`  ${from.toFixed(2)}〜${to.toFixed(2)} 秒を切り出し (${(to - from).toFixed(2)} 秒)`);
  console.log(`  残した骨 ${edited.length} 本 / 元は ${tracks.size} 本`);
  console.log(`  ${edited.map(({ bone }) => bone).join(", ")}`);
}

if (process.argv[1]?.endsWith("vrma-edit.mjs")) {
  main(process.argv.slice(2));
}
