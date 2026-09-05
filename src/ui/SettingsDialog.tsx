import { useState } from "react";

import { DialogBackdrop } from "./DialogBackdrop";
import { emptyVoiceSettings, VoiceSettingsForm } from "./VoiceSettingsForm";
import { GestureSettingsForm } from "./GestureSettingsForm";

import { useAppStore } from "@/app/store";
import * as ipc from "@/ipc";
import { toCommandError } from "@/ipc/errors";
import type { CharacterProfile } from "@/ipc/generated/CharacterProfile";
import type { ModelInfo } from "@/ipc/generated/ModelInfo";
import type { ProviderKind } from "@/ipc/generated/ProviderKind";
import type { ProviderProfileDto } from "@/ipc/generated/ProviderProfileDto";
import { ErrorBanner } from "./ErrorBanner";

const KIND_LABELS: Record<ProviderKind, string> = {
  openaiCompatible: "OpenAI 互換 (Ollama / LM Studio / llama.cpp / OpenAI)",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
};

const DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  openaiCompatible: "http://localhost:11434",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};

/**
 * OpenAI 互換のローカルサーバーと、その既定の待ち受け先。
 *
 * 既定値が Ollama 決め打ちのため、他を使う人はポートを自分で調べる必要が
 * あった。`/v1` は送信時に付くので、ここはホストとポートまでを持つ。
 */
const LOCAL_SERVERS: readonly { readonly name: string; readonly baseUrl: string }[] = [
  { name: "Ollama", baseUrl: "http://localhost:11434" },
  { name: "LM Studio", baseUrl: "http://localhost:1234" },
  { name: "llama.cpp", baseUrl: "http://localhost:8080" },
];

function emptyProvider(): ProviderProfileDto {
  return {
    id: crypto.randomUUID(),
    name: "新しい接続先",
    kind: "openaiCompatible",
    baseUrl: DEFAULT_BASE_URL.openaiCompatible,
    model: "",
    hasApiKey: false,
    temperature: null,
    topP: null,
    // 既定は上限なし。蓋をすると推論モデルが思考だけで打ち切られる。
    maxTokens: null,
    emotionMode: "tag",
    contextBudgetTokens: null,
  };
}

function emptyCharacter(providerId: string): CharacterProfile {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "新しいキャラクター",
    modelPath: null,
    modelFormat: null,
    systemPrompt: "",
    providerId,
    cameraPreset: null,
    idleSettings: {
      blink: true,
      saccade: true,
      lookAt: true,
      breath: true,
      springBone: true,
      motion: true,
    },
    emotionMapping: null,
    gestures: [],
    voiceSettings: null,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const providers = useAppStore((state) => state.providers);
  const characters = useAppStore((state) => state.characters);
  const activeCharacterId = useAppStore((state) => state.activeCharacterId);
  const bootstrap = useAppStore((state) => state.bootstrap);

  // 一覧の「編集」は編集対象を選ぶだけなので、どれを使っているかが分からない。
  const activeProviderId = characters.find(
    (item) => item.id === activeCharacterId,
  )?.providerId;

  const [error, setError] = useState<ReturnType<typeof toCommandError> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);

  const [provider, setProvider] = useState<ProviderProfileDto | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [character, setCharacter] = useState<CharacterProfile | null>(null);
  /** 接続テストの結果。フォームの中に出す。上部に出すと画面外になる。 */
  const [health, setHealth] = useState<{ ok: boolean; text: string } | null>(null);

  /**
   * 編集を始めたときの姿。書きかけがあるかを、これとの違いで見る。
   *
   * 入力のたびに下書きへ書き込むので、「触ったかどうか」では判らない。開いた
   * ときの姿と比べれば、元へ戻した場合も書きかけとは見なさずに済む。
   */
  const [providerBaseline, setProviderBaseline] = useState<string | null>(null);
  const [characterBaseline, setCharacterBaseline] = useState<string | null>(null);

  /** 保存せずに閉じようとしているか。確認を出しているあいだ true。 */
  const [confirmingClose, setConfirmingClose] = useState(false);

  /** 接続先の編集を開く。閉じるときは null を渡す。 */
  const openProvider = (item: ProviderProfileDto | null): void => {
    setProvider(item);
    setProviderBaseline(item === null ? null : JSON.stringify(item));
    setApiKey("");
    setHealth(null);
    setConfirmingClose(false);
  };

  /** キャラクターの編集を開く。閉じるときは null を渡す。 */
  const openCharacter = (item: CharacterProfile | null): void => {
    setCharacter(item);
    setCharacterBaseline(item === null ? null : JSON.stringify(item));
    setConfirmingClose(false);
  };

  /**
   * 保存していない書きかけがあるか。
   *
   * API キーは入力欄に残っていれば書きかけと見なす。保存すると空へ戻るので、
   * 残っているということは、まだ渡していないということになる。
   */
  const unsaved =
    (provider !== null &&
      (JSON.stringify(provider) !== providerBaseline || apiKey !== "")) ||
    (character !== null && JSON.stringify(character) !== characterBaseline);

  /**
   * 閉じようとする。書きかけがあれば、まず確認を出す。
   *
   * 背景を押して閉じられるようにしたぶん、うっかり閉じる目も増えた。書きかけを
   * 黙って捨てない。
   */
  const requestClose = (): void => {
    if (unsaved) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  const run = async (task: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(toCommandError(caught));
    }
  };

  /** 保存して最新の姿を返す。空文字は削除、未入力(null)は維持 (契約 2.2)。 */
  const persist = async (target: ProviderProfileDto): Promise<ProviderProfileDto> => {
    const saved = await ipc.providerUpsert(target, apiKey === "" ? null : apiKey);
    setApiKey("");
    setProvider(saved);
    setProviderBaseline(JSON.stringify(saved));
    await bootstrap();
    return saved;
  };

  const saveProvider = (): void => {
    if (provider === null) return;
    void run(async () => {
      await persist(provider);
      openProvider(null);
      setNotice("接続先を保存しました");
    });
  };

  /**
   * 接続テストとモデル一覧は保存済みの設定に対して動く。利用者に保存の
   * 段取りを強いるより、先に保存してしまうほうがよい。
   */
  const testConnection = (): void => {
    if (provider === null) return;
    void run(async () => {
      setHealth(null);
      const saved = await persist(provider);
      const result = await ipc.providerTest(saved.id);
      setHealth({ ok: result.ok, text: result.detail });
    });
  };

  const fetchModels = (): void => {
    if (provider === null) return;
    void run(async () => {
      const saved = await persist(provider);
      const found = await ipc.providerModels(saved.id);
      setModels(found);
      if (found.length === 0) {
        setHealth({ ok: false, text: "モデルが見つかりませんでした" });
      }
    });
  };

  return (
    <DialogBackdrop onClose={requestClose} enabled={!confirmingClose}>
      {confirmingClose && (
        <DialogBackdrop onClose={() => setConfirmingClose(false)}>
          <div
            className="dialog dialog--confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="保存していない変更があります"
          >
            <h2>保存していない変更があります</h2>
            <p className="form__note">閉じると、書きかけの内容は失われます。</p>
            <div className="form__actions form__actions--end">
              <button type="button" onClick={() => setConfirmingClose(false)}>
                編集に戻る
              </button>
              <button type="button" onClick={onClose}>
                保存せずに閉じる
              </button>
            </div>
          </div>
        </DialogBackdrop>
      )}

      <div className="dialog" role="dialog" aria-modal="true">
        <header className="dialog__header">
          <h2>設定</h2>
          <button type="button" onClick={requestClose}>
            閉じる
          </button>
        </header>


        {error !== null && (
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        )}
        {notice !== null && (
          <p className="banner banner--notice" role="status">
            {notice}
          </p>
        )}

        <section className="dialog__section">
          <h3>接続先</h3>
          <ul className="list">
            {providers.map((item) => (
              <li key={item.id} className="list__item">
                <span>
                  {item.name}
                  {item.id === activeProviderId && (
                    <span className="tag">使用中</span>
                  )}
                  <small>
                    {KIND_LABELS[item.kind]} / {item.model || "モデル未設定"}
                    {item.hasApiKey ? " / 鍵あり" : ""}
                    {item.emotionMode === "off" ? " / 感情タグ off" : ""}
                  </small>
                </span>
                <span className="list__actions">
                  <button
                    type="button"
                    onClick={() => {
                      openProvider(item);
                      setApiKey("");
                      setModels([]);
                      setHealth(null);
                    }}
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await ipc.providerDelete(item.id);
                        await bootstrap();
                      })
                    }
                  >
                    削除
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => openProvider(emptyProvider())}>
            接続先を追加
          </button>

          {provider !== null && (
            <div className="form">
              <label>
                名前
                <input
                  value={provider.name}
                  onChange={(event) =>
                    setProvider({ ...provider, name: event.target.value })
                  }
                />
              </label>
              <label>
                種別
                <select
                  value={provider.kind}
                  onChange={(event) => {
                    const kind = event.target.value as ProviderKind;
                    setProvider({ ...provider, kind, baseUrl: DEFAULT_BASE_URL[kind] });
                  }}
                >
                  {(Object.keys(KIND_LABELS) as ProviderKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                接続先 URL
                <input
                  value={provider.baseUrl}
                  onChange={(event) =>
                    setProvider({ ...provider, baseUrl: event.target.value })
                  }
                />
              </label>

              {/*
                既定値は Ollama のもの。他のローカルサーバーを使う人が
                ポートを調べずに済むよう、候補から選べるようにする。
              */}
              {provider.kind === "openaiCompatible" && (
                <div className="picker">
                  <p className="picker__label">
                    よく使う待ち受け先（押すと入ります）
                  </p>
                  <div className="picker__items">
                    {LOCAL_SERVERS.map((server) => (
                      <button
                        key={server.baseUrl}
                        type="button"
                        aria-pressed={provider.baseUrl === server.baseUrl}
                        className={
                          provider.baseUrl === server.baseUrl
                            ? "picker__item picker__item--on"
                            : "picker__item"
                        }
                        onClick={() =>
                          setProvider({ ...provider, baseUrl: server.baseUrl })
                        }
                      >
                        {server.name}
                        <small>{server.baseUrl}</small>
                      </button>
                    ))}
                  </div>
                  <p className="form__note">
                    ホストとポートまでを入れてください。<code>/v1</code> は送信時に
                    付くため、書き足すと <code>/v1/v1/...</code> となって繋がりません。
                  </p>
                </div>
              )}
              <label>
                モデル
                <input
                  value={provider.model}
                  list="model-candidates"
                  onChange={(event) =>
                    setProvider({ ...provider, model: event.target.value })
                  }
                />
              </label>
              <datalist id="model-candidates">
                {models.map((model) => (
                  <option key={model.id} value={model.id} />
                ))}
              </datalist>
              <label>
                API キー
                <input
                  type="password"
                  value={apiKey}
                  placeholder={
                    provider.hasApiKey ? "設定済み（変更する場合のみ入力）" : "ローカルなら不要"
                  }
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <label>
                最大トークン数
                <input
                  type="number"
                  min={1}
                  placeholder="空欄で上限なし"
                  value={provider.maxTokens ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    setProvider({
                      ...provider,
                      maxTokens: raw === "" ? null : Math.max(1, Number(raw) || 1),
                    });
                  }}
                />
                <small className="form__note">
                  生成する量の上限です。空欄なら指定せず、モデルが区切りの良い
                  ところまで書きます。推論モデル（Qwen3 系など）は思考にも
                  トークンを使うため、ここに小さな値を入れると本文が出ないまま
                  打ち切られます。Anthropic は指定が必須なので、空欄のときは
                  4096 を送ります。
                </small>
              </label>
              <label>
                履歴に使うトークン数
                <input
                  type="number"
                  min={1}
                  placeholder="空欄で既定 (8000)"
                  value={provider.contextBudgetTokens ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    setProvider({
                      ...provider,
                      contextBudgetTokens:
                        raw === "" ? null : Math.max(1, Number(raw) || 1),
                    });
                  }}
                />
                <small className="form__note">
                  過去のやり取りを送る量の上限です。モデルの文脈長の半分ほどが
                  目安になります。残り半分は今回の入力と応答のために空けて
                  おきます。推論モデルは思考にも使うので、半分でも足りない
                  ことがあります。
                </small>
              </label>
              <label>
                感情表現
                <select
                  value={provider.emotionMode}
                  onChange={(event) =>
                    setProvider({
                      ...provider,
                      emotionMode: event.target.value === "off" ? "off" : "tag",
                    })
                  }
                >
                  <option value="tag">有効（感情タグを使う）</option>
                  <option value="off">無効（常に neutral）</option>
                </select>
              </label>

              <div className="form__actions">
                <button type="button" onClick={saveProvider}>
                  保存
                </button>
                <button type="button" onClick={testConnection}>
                  接続テスト
                </button>
                <button type="button" onClick={fetchModels}>
                  モデル一覧を取得
                </button>
                <button
                  type="button"
                  onClick={() => openProvider(null)}
                >
                  やめる
                </button>
              </div>

              {health !== null && (
                <p
                  className={`result ${health.ok ? "result--ok" : "result--ng"}`}
                  role="status"
                >
                  {health.ok ? "接続できました。" : "接続できませんでした。"}
                  {health.text}
                </p>
              )}

              {models.length > 0 && (
                <div className="picker">
                  <p className="picker__label">
                    見つかったモデル（押すと選べます）
                  </p>
                  <div className="picker__items">
                    {models.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        aria-pressed={provider.model === model.id}
                        className={
                          provider.model === model.id ? "picker__item picker__item--on" : "picker__item"
                        }
                        onClick={() => setProvider({ ...provider, model: model.id })}
                      >
                        {model.displayName ?? model.id}
                      </button>
                    ))}
                  </div>
                  <p className="form__note">
                    選んだら「保存」を押してください。
                  </p>
                </div>
              )}

              <p className="form__note">
                接続テストとモデル一覧は、押したときにこの設定を保存してから実行します。
              </p>
            </div>
          )}
        </section>

        <section className="dialog__section">
          <h3>キャラクター</h3>
          <ul className="list">
            {characters.map((item) => (
              <li key={item.id} className="list__item">
                <span>
                  {item.name}
                  <small>{item.modelPath ?? "モデル未設定"}</small>
                </span>
                <span className="list__actions">
                  <button type="button" onClick={() => openCharacter(item)}>
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await ipc.characterDelete(item.id);
                        await bootstrap();
                      })
                    }
                  >
                    削除
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={providers.length === 0}
            title={providers.length === 0 ? "先に接続先を追加してください" : undefined}
            onClick={() => openCharacter(emptyCharacter(providers[0]?.id ?? ""))}
          >
            キャラクターを追加
          </button>

          {character !== null && (
            <div className="form">
              <label>
                名前
                <input
                  value={character.name}
                  onChange={(event) =>
                    setCharacter({ ...character, name: event.target.value })
                  }
                />
              </label>
              <label>
                接続先
                <select
                  value={character.providerId}
                  onChange={(event) =>
                    setCharacter({ ...character, providerId: event.target.value })
                  }
                >
                  {providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                人格（システムプロンプト）
                <textarea
                  rows={8}
                  value={character.systemPrompt}
                  placeholder="どんな性格で、どんな話し方をするかを書きます。感情タグの説明は自動で付きます。"
                  onChange={(event) =>
                    setCharacter({ ...character, systemPrompt: event.target.value })
                  }
                />
              </label>
              <fieldset className="form__fieldset">
                <legend>声</legend>
                <GestureSettingsForm
                  value={character.gestures}
                  onChange={(gestures) => setCharacter({ ...character, gestures })}
                />

                <VoiceSettingsForm
                  value={character.voiceSettings ?? emptyVoiceSettings()}
                  onChange={(voiceSettings) =>
                    setCharacter({ ...character, voiceSettings })
                  }
                />
              </fieldset>
              <div className="form__actions">
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await ipc.characterUpsert(character);
                      openCharacter(null);
                      setNotice("キャラクターを保存しました");
                      await bootstrap();
                    })
                  }
                >
                  保存
                </button>
                <button type="button" onClick={() => openCharacter(null)}>
                  やめる
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </DialogBackdrop>
  );
}
