import { describe, expect, it } from "vitest";
import {
  advanceLipSync,
  createLipSyncState,
  DEFAULT_LIPSYNC_CONFIG as CFG,
  evaluateLipSync,
  feedLipSync,
  type LipSyncState,
} from "./controller";

const DT = 1 / 60;

function run(state: LipSyncState, seconds: number, dt = DT): LipSyncState {
  let next = state;
  for (let t = 0; t < seconds; t += dt) {
    next = advanceLipSync(next, dt);
  }
  return next;
}

function levelOf(state: LipSyncState): number {
  return Object.values(evaluateLipSync(state))[0] ?? 0;
}

describe("LipSyncController", () => {
  it("初期状態では口が閉じている", () => {
    expect(evaluateLipSync(createLipSyncState())).toEqual({});
  });

  it("テキストを与えると口が動き出す", () => {
    const state = run(feedLipSync(createLipSyncState(), "あいうえお"), 0.3);
    expect(levelOf(state)).toBeGreaterThan(0);
  });

  it("出力される口形は常に 1 つだけ", () => {
    let state = feedLipSync(createLipSyncState(), "こんにちは、お元気ですか。");
    for (let t = 0; t < 3; t += DT) {
      state = advanceLipSync(state, DT);
      expect(Object.keys(evaluateLipSync(state)).length).toBeLessThanOrEqual(1);
    }
  });

  it("重みは常に 0〜1 に収まる", () => {
    let state = feedLipSync(createLipSyncState(), "あいうえおかきくけこ");
    for (let t = 0; t < 5; t += DT) {
      state = advanceLipSync(state, DT);
      expect(state.level).toBeGreaterThanOrEqual(0);
      expect(state.level).toBeLessThanOrEqual(1);
    }
  });

  it("設定した速度でキューを消化する", () => {
    const text = "あいうえおかきくけこ"; // 10 文字
    const expectedSeconds = text.length / CFG.charsPerSecond;

    const halfway = run(feedLipSync(createLipSyncState(), text), expectedSeconds / 2);
    expect(halfway.pending.length).toBeGreaterThan(2);
    expect(halfway.pending.length).toBeLessThan(8);

    const done = run(feedLipSync(createLipSyncState(), text), expectedSeconds + 0.2);
    expect(done.pending.length).toBe(0);
  });

  it("母音に応じて口形が変わる", () => {
    let state = feedLipSync(createLipSyncState(), "あ");
    state = run(state, 0.2);
    expect(state.current).toBe("aa");

    state = feedLipSync(state, "い");
    state = run(state, 0.2);
    expect(state.current).toBe("ih");
  });

  it("撥音や長音では直前の口形を保つ", () => {
    let state = feedLipSync(createLipSyncState(), "こんー");
    // 3 文字を消化しきった直後を見る。ここから猶予を過ぎると閉口するのが
    // 正しいので、長く回しすぎると別の挙動を見てしまう。
    state = run(state, 0.32);
    expect(state.pending.length).toBe(0);
    expect(state.current).toBe("oh"); // こ の口形が保たれる
    expect(state.target).toBe(1); // 撥音・長音では閉じにいかない
  });

  it("句読点で口を閉じにいく", () => {
    let state = feedLipSync(createLipSyncState(), "あ。");
    state = run(state, 0.3);
    expect(state.target).toBe(0);
  });

  it("発話が尽きてから猶予の後に閉口する", () => {
    let state = feedLipSync(createLipSyncState(), "あい");
    state = run(state, 0.25); // 消化しきる
    expect(state.pending.length).toBe(0);

    const justAfter = run(state, CFG.idleCloseSeconds / 2);
    expect(justAfter.target).toBe(1);

    const later = run(state, CFG.idleCloseSeconds + CFG.decaySeconds + 0.1);
    expect(later.target).toBe(0);
    expect(levelOf(later)).toBe(0);
  });

  it("長文を投入しても消化中に閉口しない", () => {
    // 「投入からの経過」で猶予を測ると、ここで途中閉口してしまう
    const long = "あ".repeat(50);
    let state = feedLipSync(createLipSyncState(), long);
    let closedWhileSpeaking = false;
    for (let t = 0; t < 3; t += DT) {
      state = advanceLipSync(state, DT);
      // 最初の 1 文字を消化するまでは口が閉じていて当然なので、
      // 発話が始まってからのみ検査する
      const speaking = state.current !== null && state.pending.length > 0;
      if (speaking && state.target === 0) {
        closedWhileSpeaking = true;
      }
    }
    expect(closedWhileSpeaking).toBe(false);
    expect(state.pending.length).toBeGreaterThan(0);
  });

  it("追加投入で発話が続く", () => {
    let state = feedLipSync(createLipSyncState(), "あい");
    state = run(state, 0.25);
    state = feedLipSync(state, "うえ");
    state = run(state, 0.1);
    expect(state.target).toBe(1);
  });

  it("空文字の投入は何も変えない", () => {
    const state = createLipSyncState();
    expect(feedLipSync(state, "")).toEqual(state);
  });

  it("負の dt を無視する", () => {
    const state = feedLipSync(createLipSyncState(), "あ");
    expect(advanceLipSync(state, -1)).toEqual(state);
  });

  describe("再生位置", () => {
    it("投入した数を数える", () => {
      const state = feedLipSync(createLipSyncState(), "あいう");
      expect(state.fed).toBe(3);
      expect(state.consumed).toBe(0);
    });

    it("消化した数を数える", () => {
      let state = feedLipSync(createLipSyncState(), "あいうえお");
      state = run(state, 0.35); // 3 文字ぶん
      expect(state.consumed).toBeGreaterThanOrEqual(3);
      expect(state.consumed).toBeLessThanOrEqual(4);
    });

    it("投入も消化も単調に増える", () => {
      let state = feedLipSync(createLipSyncState(), "あいうえお");
      let fed = state.fed;
      let consumed = state.consumed;
      for (let t = 0; t < 2; t += DT) {
        state = advanceLipSync(state, DT);
        expect(state.fed).toBeGreaterThanOrEqual(fed);
        expect(state.consumed).toBeGreaterThanOrEqual(consumed);
        fed = state.fed;
        consumed = state.consumed;
      }
    });

    it("消化は投入を追い越さない", () => {
      let state = feedLipSync(createLipSyncState(), "あいうえお");
      for (let t = 0; t < 3; t += DT) {
        state = advanceLipSync(state, DT);
        expect(state.consumed).toBeLessThanOrEqual(state.fed);
      }
    });

    it("追加投入しても数え直さない", () => {
      let state = feedLipSync(createLipSyncState(), "あい");
      state = run(state, 0.35);
      const before = state.consumed;
      state = feedLipSync(state, "うえ");
      expect(state.consumed).toBe(before);
      expect(state.fed).toBe(4);
    });
  });

  it("同じ入力からは同じ結果になる", () => {
    const build = (): LipSyncState =>
      run(feedLipSync(createLipSyncState(), "こんにちは。"), 2);
    expect(build()).toEqual(build());
  });
});
