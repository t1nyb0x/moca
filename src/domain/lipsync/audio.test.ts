import { describe, expect, it } from "vitest";
import {
  advanceAudioLipSync,
  createAudioLipSyncState,
  DEFAULT_AUDIO_LIPSYNC_CONFIG,
  emotionAt,
  evaluateAudioLipSync,
  rmsOf,
  type AudioLipSyncState,
} from "./audio";

const LOUD = 0.5;

/** 十分な時間を掛けて包絡を目標へ寄せる。 */
function settle(
  state: AudioLipSyncState,
  progress: number,
  amplitude: number,
  steps = 40,
): AudioLipSyncState {
  let s = state;
  for (let i = 0; i < steps; i += 1) {
    s = advanceAudioLipSync(s, 1 / 60, { progress, amplitude });
  }
  return s;
}

describe("advanceAudioLipSync", () => {
  it("再生位置に応じて口形が進む", () => {
    const state = createAudioLipSyncState("あいうえお");
    const early = settle(state, 0.1, LOUD);
    const late = settle(early, 0.9, LOUD);
    expect(early.current).not.toBe(late.current);
  });

  it("音量が大きいほど口が開く", () => {
    const state = createAudioLipSyncState("あああ");
    const quiet = settle(state, 0.5, 0.05);
    const loud = settle(state, 0.5, LOUD);
    expect(loud.level).toBeGreaterThan(quiet.level);
  });

  it("無音では口を閉じる", () => {
    const open = settle(createAudioLipSyncState("あああ"), 0.5, LOUD);
    expect(open.level).toBeGreaterThan(0.5);
    const silent = settle(open, 0.5, 0);
    expect(silent.level).toBe(0);
  });

  it("小さな声でも口は動く", () => {
    // 直近の最大音量で正規化するので、録音の音量差に左右されない
    const state = createAudioLipSyncState("あああ");
    const soft = settle(state, 0.5, 0.09);
    expect(soft.level).toBeGreaterThan(0.5);
  });

  it("床を下回る音量を増幅しない", () => {
    const state = createAudioLipSyncState("あああ");
    const noise = settle(state, 0.5, DEFAULT_AUDIO_LIPSYNC_CONFIG.silence + 0.001);
    expect(noise.level).toBeLessThan(0.5);
  });

  it("句読点では音量にかかわらず閉じる", () => {
    const state = createAudioLipSyncState("あ、");
    const closed = settle(state, 1, LOUD);
    expect(closed.closed).toBe(true);
    expect(closed.level).toBe(0);
  });

  it("位置が飛んでもキューを取りこぼさない", () => {
    const state = createAudioLipSyncState("あいうえお");
    const jumped = advanceAudioLipSync(state, 1 / 60, { progress: 1, amplitude: LOUD });
    expect(jumped.index).toBe(state.cues.length);
  });

  it("位置は戻らない", () => {
    const state = createAudioLipSyncState("あいうえお");
    const forward = advanceAudioLipSync(state, 1 / 60, { progress: 0.8, amplitude: LOUD });
    const back = advanceAudioLipSync(forward, 1 / 60, { progress: 0.1, amplitude: LOUD });
    expect(back.index).toBe(forward.index);
  });

  it("時間が進まなければ何も変わらない", () => {
    const state = createAudioLipSyncState("あいうえお");
    expect(advanceAudioLipSync(state, 0, { progress: 1, amplitude: LOUD })).toBe(state);
  });

  it("空の文でも壊れない", () => {
    const state = createAudioLipSyncState("");
    const after = settle(state, 0.5, LOUD);
    expect(evaluateAudioLipSync(after)).toEqual({});
  });

  it("元の状態を書き換えない", () => {
    const state = createAudioLipSyncState("あいうえお");
    const before = JSON.stringify(state);
    advanceAudioLipSync(state, 1 / 60, { progress: 1, amplitude: LOUD });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("音量が範囲外でも重みは 0〜1 に収まる", () => {
    const state = createAudioLipSyncState("あああ");
    const over = settle(state, 0.5, 10);
    expect(over.level).toBeLessThanOrEqual(1);
  });
});

describe("evaluateAudioLipSync", () => {
  it("口形と開き具合を重みにする", () => {
    const state = settle(createAudioLipSyncState("ああ"), 0.5, LOUD);
    const weights = evaluateAudioLipSync(state);
    expect(Object.keys(weights)).toHaveLength(1);
    expect(Object.values(weights)[0]).toBeGreaterThan(0);
  });

  it("閉じているあいだは何も出さない", () => {
    expect(evaluateAudioLipSync(createAudioLipSyncState("ああ"))).toEqual({});
  });
});

describe("emotionAt", () => {
  const marks = [
    { at: 0, value: "neutral" },
    { at: 10, value: "happy" },
    { at: 20, value: "sad" },
  ];

  it("再生位置に対応する感情を選ぶ", () => {
    expect(emotionAt(marks, 0.6, 30)).toBe("happy");
  });

  it("最後まで進めば最後の感情になる", () => {
    expect(emotionAt(marks, 1, 30)).toBe("sad");
  });

  it("先頭では最初の感情になる", () => {
    expect(emotionAt(marks, 0, 30)).toBe("neutral");
  });

  it("印が無ければ何も返さない", () => {
    expect(emotionAt([], 0.5, 30)).toBeNull();
  });

  it("長さが無ければ何も返さない", () => {
    expect(emotionAt(marks, 0.5, 0)).toBeNull();
  });

  it("先頭より後にしか印が無ければ、そこに届くまで何も返さない", () => {
    expect(emotionAt([{ at: 15, value: "happy" }], 0.1, 30)).toBeNull();
  });
});

describe("rmsOf", () => {
  it("無音は 0 になる", () => {
    // getByteTimeDomainData は無音を 128 で返す
    expect(rmsOf(new Uint8Array(64).fill(128))).toBe(0);
  });

  it("振れ幅が大きいほど値が大きい", () => {
    const small = new Uint8Array([118, 138, 118, 138]);
    const large = new Uint8Array([28, 228, 28, 228]);
    expect(rmsOf(large)).toBeGreaterThan(rmsOf(small));
  });

  it("最大振幅でも 1 を超えない", () => {
    expect(rmsOf(new Uint8Array([0, 255, 0, 255]))).toBeLessThanOrEqual(1);
  });

  it("空でも壊れない", () => {
    expect(rmsOf(new Uint8Array(0))).toBe(0);
  });

  it("正負で値が変わらない", () => {
    expect(rmsOf(new Uint8Array([178]))).toBeCloseTo(rmsOf(new Uint8Array([78])), 10);
  });
});
