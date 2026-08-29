import { useState } from "react";

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
    maxTokens: 2048,
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
    },
    emotionMapping: null,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const providers = useAppStore((state) => state.providers);
  const characters = useAppStore((state) => state.characters);
  const bootstrap = useAppStore((state) => state.bootstrap);

  const [error, setError] = useState<ReturnType<typeof toCommandError> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);

  const [provider, setProvider] = useState<ProviderProfileDto | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [character, setCharacter] = useState<CharacterProfile | null>(null);

  const run = async (task: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(toCommandError(caught));
    }
  };

  const saveProvider = (): void => {
    if (provider === null) return;
    void run(async () => {
      // 空文字は削除、未入力(null)は維持 (docs/ipc-contract.md 2.2)
      await ipc.providerUpsert(provider, apiKey === "" ? null : apiKey);
      setApiKey("");
      setProvider(null);
      setNotice("接続先を保存しました");
      await bootstrap();
    });
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog">
        <header className="dialog__header">
          <h2>設定</h2>
          <button type="button" onClick={onClose}>
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
                  <small>
                    {KIND_LABELS[item.kind]} / {item.model || "モデル未設定"}
                    {item.hasApiKey ? " / 鍵あり" : ""}
                  </small>
                </span>
                <span className="list__actions">
                  <button
                    type="button"
                    onClick={() => {
                      setProvider(item);
                      setApiKey("");
                      setModels([]);
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
          <button type="button" onClick={() => setProvider(emptyProvider())}>
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
                  value={provider.maxTokens}
                  onChange={(event) =>
                    setProvider({
                      ...provider,
                      maxTokens: Number(event.target.value) || 1,
                    })
                  }
                />
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
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      const health = await ipc.providerTest(provider.id);
                      setNotice(health.detail);
                    })
                  }
                >
                  接続テスト
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      setModels(await ipc.providerModels(provider.id));
                      setNotice("モデル一覧を取得しました");
                    })
                  }
                >
                  モデル一覧
                </button>
                <button type="button" onClick={() => setProvider(null)}>
                  やめる
                </button>
              </div>
              <p className="form__note">
                接続テストとモデル一覧は、保存済みの設定に対して実行されます。
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
                  <button type="button" onClick={() => setCharacter(item)}>
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
            onClick={() => setCharacter(emptyCharacter(providers[0]?.id ?? ""))}
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
              <div className="form__actions">
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await ipc.characterUpsert(character);
                      setCharacter(null);
                      setNotice("キャラクターを保存しました");
                      await bootstrap();
                    })
                  }
                >
                  保存
                </button>
                <button type="button" onClick={() => setCharacter(null)}>
                  やめる
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
