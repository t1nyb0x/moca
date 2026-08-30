import { useState } from "react";

import { CANONICAL_EMOTIONS, type CanonicalEmotion } from "@/domain/emotion/types";
import { resolveDefaultPresets } from "@/domain/voice/emotion-preset";
import * as ipc from "@/ipc";
import type { SpeakerInfo } from "@/ipc/generated/SpeakerInfo";
import type { TtsKind } from "@/ipc/generated/TtsKind";
import type { VoicePreset } from "@/ipc/generated/VoicePreset";
import type { VoiceSettings } from "@/ipc/generated/VoiceSettings";

/** 接続先ごとの既定の待ち受け先。どちらもローカルで動かす前提。 */
const DEFAULT_BASE_URL: Readonly<Record<TtsKind, string>> = {
  voicevox: "http://127.0.0.1:50021",
  shirataki: "http://127.0.0.1:3000",
};

const KIND_LABEL: Readonly<Record<TtsKind, string>> = {
  voicevox: "VOICEVOX",
  shirataki: "CeVIO AI (shirataki)",
};

const EMOTION_LABEL: Readonly<Record<CanonicalEmotion, string>> = {
  neutral: "平常",
  happy: "喜び",
  angry: "怒り",
  sad: "哀しみ",
  relaxed: "安らぎ",
  surprised: "驚き",
};

export function emptyVoiceSettings(): VoiceSettings {
  return {
    enabled: false,
    kind: "voicevox",
    baseUrl: DEFAULT_BASE_URL.voicevox,
    speaker: "",
    emotionPresets: {},
  };
}

function presetOf(settings: VoiceSettings, emotion: CanonicalEmotion): VoicePreset {
  return (
    settings.emotionPresets[emotion] ?? {
      speaker: null,
      components: {},
      speed: null,
      pitch: null,
      intonation: null,
    }
  );
}

/** 数値入力の空欄は「指定しない」。0 と区別する必要がある。 */
function toNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function VoiceSettingsForm({
  value,
  onChange,
}: {
  readonly value: VoiceSettings;
  readonly onChange: (next: VoiceSettings) => void;
}): React.JSX.Element {
  const [speakers, setSpeakers] = useState<SpeakerInfo[]>([]);
  const [axes, setAxes] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (partial: Partial<VoiceSettings>): void =>
    onChange({ ...value, ...partial });

  /**
   * 接続を確かめ、話者と感情成分を取り込む。
   *
   * 合成器は別のアプリなので、起動し忘れが一番多い失敗になる。ここで
   * 分かるようにしておく。
   */
  const probe = (): void => {
    setBusy(true);
    setStatus(null);
    void (async () => {
      try {
        const found = await ipc.ttsSpeakers(value.kind, value.baseUrl);
        setSpeakers(found);
        const speaker = value.speaker !== "" ? value.speaker : (found[0]?.id ?? "");
        if (speaker !== value.speaker) patch({ speaker });
        const names = speaker === ""
          ? []
          : await ipc.ttsEmotionAxes(value.kind, value.baseUrl, speaker);
        setAxes(names);

        // 割り当てが空のままだと感情成分を一切送らず、CeVIO 側に残っている
        // 値がずっと使われ続ける。押し忘れで感情が固まるので、まだ作られて
        // いなければここで作る。作ったあとは手で直せる。
        const assigned = Object.keys(value.emotionPresets).length > 0;
        if (!assigned && names.length > 0) {
          applyDefaults(names);
          setStatus(
            `${found.length} 名の話者が見つかりました。感情ごとの声を既定の組み合わせにしました`,
          );
          return;
        }

        setStatus(`${found.length} 名の話者が見つかりました`);
      } catch (error) {
        setSpeakers([]);
        setAxes([]);
        setStatus(ipc.toCommandError(error).message);
      } finally {
        setBusy(false);
      }
    })();
  };

  const applyDefaults = (names: readonly string[] = axes): void => {
    const defaults = resolveDefaultPresets(names);
    const emotionPresets = Object.fromEntries(
      CANONICAL_EMOTIONS.map((emotion) => [emotion, defaults[emotion]]),
    );
    patch({ emotionPresets });
  };

  const setPreset = (emotion: CanonicalEmotion, next: VoicePreset): void =>
    patch({ emotionPresets: { ...value.emotionPresets, [emotion]: next } });

  return (
    <div className="form form--nested">
      <label className="form__check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        音声で読み上げる
      </label>

      <label>
        合成器
        <select
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value as TtsKind;
            // 待ち受け先は合成器ごとに違う。付け替えたら既定に戻す。
            patch({ kind, baseUrl: DEFAULT_BASE_URL[kind], speaker: "" });
            setSpeakers([]);
            setAxes([]);
          }}
        >
          {(["voicevox", "shirataki"] as const).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </label>

      <label>
        待ち受け先
        <input
          value={value.baseUrl}
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </label>

      <div className="form__actions">
        <button type="button" disabled={busy} onClick={probe}>
          接続を確かめる
        </button>
        <button
          type="button"
          disabled={speakers.length === 0}
          onClick={() => {
            // 引数なしで呼ぶ。そのまま渡すとクリックの事象が成分名として届く。
            applyDefaults();
            setStatus("感情ごとの声を既定の組み合わせにしました");
          }}
        >
          感情の割り当てを作り直す
        </button>
      </div>
      {status !== null && <p className="form__note">{status}</p>}

      {/*
        割り当てが空のときは感情成分を一切送らないため、合成器側に残っている
        値がずっと使われる。押し忘れていると感情が固まったままになる。
      */}
      {value.enabled && Object.keys(value.emotionPresets).length === 0 && (
        <p className="banner banner--notice" role="status">
          感情ごとの声がまだ割り当てられていません。このままだと合成器側に
          残っている値で読み上げられ、感情によって声が変わりません。
          「接続を確かめる」を押すと既定の組み合わせを作ります。
        </p>
      )}

      <label>
        話者
        <select
          value={value.speaker}
          disabled={speakers.length === 0}
          onChange={(event) => {
            const speaker = event.target.value;
            patch({ speaker });
            void ipc
              .ttsEmotionAxes(value.kind, value.baseUrl, speaker)
              .then(setAxes, () => setAxes([]));
          }}
        >
          {speakers.length === 0 && <option value="">接続を確かめてください</option>}
          {speakers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      {CANONICAL_EMOTIONS.map((emotion) => {
        const preset = presetOf(value, emotion);
        return (
          <details key={emotion} className="form__group">
            <summary>{EMOTION_LABEL[emotion]}の声</summary>
            {axes.map((axis) => (
              <label key={axis} className="form__range">
                {axis}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={preset.components[axis] ?? 0}
                  onChange={(event) =>
                    setPreset(emotion, {
                      ...preset,
                      components: {
                        ...preset.components,
                        [axis]: Number(event.target.value),
                      },
                    })
                  }
                />
                <span>{(preset.components[axis] ?? 0).toFixed(2)}</span>
              </label>
            ))}
            <label>
              速さ（1.0 が普通）
              <input
                type="number"
                step={0.05}
                value={preset.speed ?? ""}
                onChange={(event) =>
                  setPreset(emotion, { ...preset, speed: toNumber(event.target.value) })
                }
              />
            </label>
            <label>
              高さ（0.0 が普通）
              <input
                type="number"
                step={0.05}
                value={preset.pitch ?? ""}
                onChange={(event) =>
                  setPreset(emotion, { ...preset, pitch: toNumber(event.target.value) })
                }
              />
            </label>
            <label>
              抑揚（1.0 が普通）
              <input
                type="number"
                step={0.05}
                value={preset.intonation ?? ""}
                onChange={(event) =>
                  setPreset(emotion, {
                    ...preset,
                    intonation: toNumber(event.target.value),
                  })
                }
              />
            </label>
          </details>
        );
      })}
    </div>
  );
}
