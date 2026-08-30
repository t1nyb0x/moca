import { useEffect, useState } from "react";

import { MorphMappingDialog } from "./MorphMappingDialog";

import { useAppStore } from "@/app/store";
import { logsDir } from "@/ipc";
import { CANONICAL_EMOTIONS } from "@/domain/emotion/types";
import { groupByRole, ROLES, type ExpressionRole } from "@/domain/model/expression-roles";
import { isSoftwareRenderer } from "@/domain/model/renderer";
import type { IdleSettings } from "@/ipc/generated/IdleSettings";

const ROLE_LABELS: Record<ExpressionRole, string> = {
  emotion: "感情（タグで指定）",
  viseme: "口形（リップシンクが使用）",
  blink: "まばたき（自動）",
  lookAt: "視線（自動）",
  custom: "モデル固有（現在は未使用）",
};

const IDLE_LABELS: { key: keyof IdleSettings; label: string }[] = [
  { key: "blink", label: "まばたき" },
  { key: "saccade", label: "視線の揺らぎ" },
  { key: "lookAt", label: "視線を向ける" },
  { key: "breath", label: "呼吸" },
  { key: "springBone", label: "髪の揺れ" },
  { key: "motion", label: "体の動き" },
];

const EMOTION_LABELS: Record<string, string> = {
  neutral: "平常",
  happy: "喜び",
  angry: "怒り",
  sad: "悲しみ",
  relaxed: "安らぎ",
  surprised: "驚き",
};

/**
 * 診断パネル。
 *
 * 表情が動かない、色が付かないといった不具合は何のエラーも出さずに起きる。
 * 原因がモデル側にあるのか経路にあるのかを、推測ではなく見て切り分けられる
 * ようにする。
 *
 * 感情ボタンは LLM とまったく同じ経路（ストアの emotion）を通すので、
 * ここで顔が変われば経路は生きている。
 */
export function DiagnosticsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const model = useAppStore((state) => state.model);
  const diagnostics = useAppStore((state) => state.modelDiagnostics);
  const emotion = useAppStore((state) => state.emotion);
  const previewEmotion = useAppStore((state) => state.previewEmotion);
  const setIdleSettings = useAppStore((state) => state.setIdleSettings);
  const conversation = useAppStore((state) => state.conversation);
  const characters = useAppStore((state) => state.characters);
  const providers = useAppStore((state) => state.providers);
  const activeCharacterId = useAppStore((state) => state.activeCharacterId);

  const [mappingOpen, setMappingOpen] = useState(false);
  const [logPath, setLogPath] = useState<string | null>(null);
  useEffect(() => {
    void logsDir()
      .then(setLogPath)
      .catch(() => setLogPath(null));
  }, []);

  const expressible = new Set(diagnostics?.expressibleEmotions ?? []);
  const approximated = new Set(diagnostics?.approximatedEmotions ?? []);
  const grouped = groupByRole(diagnostics?.expressionNames ?? []);

  // 直近の応答にタグが含まれていたか。原因を「モデルが出さない」と
  // 「こちらが取りこぼす」に分けるための決め手になる。
  const lastAssistant = [...(conversation?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");

  const character = characters.find((item) => item.id === activeCharacterId);
  const provider = providers.find((item) => item.id === character?.providerId);
  const tagsEnabled = provider?.emotionMode === "tag";

  return (
    <aside className="diag">
      <header className="diag__header">
        <h3>診断</h3>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </header>

      {model === null ? (
        <p className="diag__note">モデルが読み込まれていません。</p>
      ) : diagnostics === null ? (
        <p className="diag__note">モデルの情報を取得中です。</p>
      ) : (
        <dl className="diag__list">
          <dt>テクスチャ</dt>
          <dd>
            {diagnostics.textureCount} 枚
            {diagnostics.textureCount === 0 && "（読み込みに失敗している可能性）"}
          </dd>

          <dt>表情の総数</dt>
          <dd>
            {diagnostics.expressionNames.length} 個
            {diagnostics.expressionNames.length === 0 &&
              "（このモデルは表情を持ちません）"}
          </dd>

          <dt>立ち姿</dt>
          <dd>
            {diagnostics.adjustedBones.length === 0
              ? "元の姿勢のまま"
              : `腕を下ろしました（${diagnostics.adjustedBones.join("、")}）`}
          </dd>

          <dt>ボーン</dt>
          <dd>{diagnostics.boneNames.length} 本</dd>

          <dt>描画</dt>
          <dd>
            {diagnostics.rendererName}
            {isSoftwareRenderer(diagnostics.rendererName) &&
              "（GPU が使われていません）"}
          </dd>
        </dl>
      )}

      {diagnostics !== null && diagnostics.expressionNames.length > 0 && (
        <details className="diag__details">
          <summary>表情の内訳</summary>
          {ROLES.map((role) => {
            const names = grouped.get(role) ?? [];
            if (names.length === 0) return null;
            return (
              <div key={role} className="diag__group">
                <p className="diag__groupLabel">
                  {ROLE_LABELS[role]}: {names.length} 個
                </p>
                <p className="diag__groupNames">{names.join("、")}</p>
              </div>
            );
          })}
          <p className="diag__note">
            感情として選べるのは VRM が標準化した 5 種と平常だけです。口形・
            まばたき・視線はそれぞれの仕組みが自動で動かしています。
          </p>
        </details>
      )}

      {logPath !== null && (
        <p className="diag__note">
          ログの保存先
          <span className="diag__path">{logPath}</span>
          不具合のご報告には、この場所の <code>moca.log</code> を添えていただけると
          原因が追えます。
        </p>
      )}

      <p
        className={tagsEnabled ? "diag__note" : "diag__note diag__note--warn"}
        role={tagsEnabled ? undefined : "alert"}
      >
        感情タグの送信:{" "}
        <strong>{tagsEnabled ? "有効" : "無効"}</strong>
        {!tagsEnabled &&
          "。無効のあいだはモデルにタグの説明を送らないため、会話で表情は変わりません。設定の接続先で「感情表現」を有効にしてください。"}
      </p>

      <p className="diag__note">
        直近に受け取った感情:{" "}
        <strong>{EMOTION_LABELS[emotion.emotion] ?? emotion.emotion}</strong>
        {emotion.intensity !== 1 && `（強さ ${emotion.intensity}）`}
      </p>

      {lastAssistant !== undefined && (
        <details className="diag__details" open>
          <summary>直近の応答</summary>
          <p className="diag__note">
            感情の切り替わり: <strong>{lastAssistant.emotions?.length ?? 0} 回</strong>
            <br />
            <small>
              直前と同じ感情のタグは変化として数えません（emotion-protocol W-5）。
            </small>
            {(lastAssistant.emotions?.length ?? 0) === 0 &&
              "。モデルがタグを出していません。人格の書き方を変えるか、感情タグに従いやすいモデルをお試しください。"}
          </p>
          <p className="diag__groupLabel">モデルが返した生の文字列</p>
          <p className="diag__raw">
            {(lastAssistant.rawContent ?? lastAssistant.content).slice(0, 300)}
          </p>
        </details>
      )}

      {character !== undefined && (
        <div className="diag__idle">
          <p className="diag__groupLabel">アイドル挙動</p>
          {IDLE_LABELS.map(({ key, label }) => (
            <label key={key} className="diag__toggle">
              <input
                type="checkbox"
                checked={character.idleSettings[key]}
                onChange={(event) =>
                  void setIdleSettings({
                    ...character.idleSettings,
                    [key]: event.target.checked,
                  })
                }
              />
              {label}
            </label>
          ))}
          <p className="diag__note">
            まぶたが下がって見えるときは「視線を向ける」を切ってお試しください。
          </p>
        </div>
      )}

      <p className="diag__note">
        押すと顔が変わるか確かめられます。変われば経路は生きています。
      </p>

      {diagnostics !== null && diagnostics.boneNames.length > 0 && (
        <details className="diag__details">
          <summary>ボーンの一覧</summary>
          <p className="diag__groupNames">{diagnostics.boneNames.join("、")}</p>
          <p className="diag__note">
            立ち姿の調整は、腕のボーンが標準的な名前のときだけ働きます。
          </p>
        </details>
      )}

      {diagnostics?.emotionMorphs != null && (
        <>
          <p className="diag__note">
            PMX はモーフ名がモデルごとに違うため、自動の推測が外れることが
            あります。表情が変わらない感情があれば割り当てを直せます。
          </p>
          <button type="button" onClick={() => setMappingOpen(true)}>
            表情の割り当てを直す
          </button>
        </>
      )}

      {mappingOpen && <MorphMappingDialog onClose={() => setMappingOpen(false)} />}
      <div className="diag__buttons">
        {CANONICAL_EMOTIONS.map((item) => {
          const supported = model === null || diagnostics === null || expressible.has(item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={emotion.emotion === item}
              className={emotion.emotion === item ? "diag__button diag__button--on" : "diag__button"}
              onClick={() => previewEmotion(item)}
              title={
                approximated.has(item)
                  ? "このモデルは専用の表情を持たないため、別の表情で近似します"
                  : supported
                    ? undefined
                    : "このモデルはこの感情を表現できません"
              }
            >
              {EMOTION_LABELS[item] ?? item}
              {!supported && "（非対応）"}
              {supported && approximated.has(item) && "（近似）"}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
