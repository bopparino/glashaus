import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings as RuntimeSettings, State } from "../shared/types";
import { api } from "./api";
import { Field, Notice, messageOf } from "./Forms";
import { Icon } from "./Icon";
import { modelLocation } from "./model-location";
import { StartupSettings } from "./Startup";
import { UpdateSettings } from "./Updates";
import { DataControls } from "./DataControls";
type ModelRequest = {
  provider: RuntimeSettings["provider"];
  ollamaUrl?: string;
  grokApiKey?: string;
};
type ModelDiscovery =
  | { status: "loading" }
  | { status: "ready"; names: string[] }
  | { status: "error"; message: string };
const emptyModelList: string[] = [];

function ModelPicker({
  label,
  value,
  onChange,
  names,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  names: string[];
  required?: boolean;
}) {
  const [manual, setManual] = useState(false);
  const unlisted = value && !names.includes(value);
  return (
    <div className="model-picker">
      <Field label={label}>
        {manual ? (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
            maxLength={500}
            placeholder="Exact model ID"
          />
        ) : (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
          >
            <option value="">
              {required ? "Choose a model" : "Use the conversation model"}
            </option>
            {unlisted && <option value={value}>{value} (unlisted)</option>}
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <button
        type="button"
        className="text-button"
        onClick={() => setManual(!manual)}
      >
        {manual
          ? `Choose ${label.toLowerCase()} from list`
          : `Enter ${label.toLowerCase()} manually`}
      </button>
    </div>
  );
}

export function Settings({
  state,
  refresh,
  editIdentity,
  back,
}: {
  state: State;
  refresh: () => Promise<void>;
  editIdentity: () => void;
  back: () => void;
}) {
  const [provider, setProvider] = useState(state.settings.provider);
  const [grokModel, setGrokModel] = useState(state.settings.grokModel);
  const [grokKey, setGrokKey] = useState("");
  const [url, setUrl] = useState(state.settings.ollamaUrl);
  const [model, setModel] = useState(state.settings.model);
  const [utility, setUtility] = useState(state.settings.utilityModel);
  const [context, setContext] = useState(state.settings.contextSize);
  const [searchKey, setSearchKey] = useState("");
  const [botToken, setBotToken] = useState("");
  const [discovery, setDiscovery] = useState<ModelDiscovery | null>(null);
  const discoveryRequest = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [updating, setUpdating] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const unsaved =
    provider !== state.settings.provider ||
    grokModel !== state.settings.grokModel ||
    !!grokKey ||
    url !== state.settings.ollamaUrl ||
    model !== state.settings.model ||
    utility !== state.settings.utilityModel ||
    context !== state.settings.contextSize ||
    !!searchKey ||
    !!botToken;
  const loadModels = useCallback(
    async (connection: ModelRequest, autoSelect = false) => {
      discoveryRequest.current?.abort();
      const request = new AbortController();
      discoveryRequest.current = request;
      setDiscovery({ status: "loading" });
      try {
        const models = await api<{ name: string }[]>(
          "/models/discover",
          connection,
          "POST",
          request.signal,
        );
        if (request.signal.aborted) return;
        const names = [...new Set(models.map(({ name }) => name))].sort(
          (a, b) => a.localeCompare(b, undefined, { numeric: true }),
        );
        setDiscovery({ status: "ready", names });
        if (autoSelect && names.length === 1) {
          const select =
            connection.provider === "grok" ? setGrokModel : setModel;
          select((current) => current || names[0]);
        }
      } catch (e) {
        if (!request.signal.aborted)
          setDiscovery({ status: "error", message: messageOf(e) });
      }
    },
    [],
  );
  useEffect(() => {
    if (
      (provider === "ollama" && url === state.settings.ollamaUrl) ||
      (provider === "grok" && !grokKey && state.settings.hasGrokKey)
    )
      void loadModels({ provider });
    return () => discoveryRequest.current?.abort();
  }, [
    provider,
    url,
    grokKey,
    state.settings.ollamaUrl,
    state.settings.hasGrokKey,
    loadModels,
  ]);

  function clearDiscovery() {
    discoveryRequest.current?.abort();
    setDiscovery(null);
  }
  const names =
    discovery?.status === "ready" ? discovery.names : emptyModelList;
  const modelSettings = {
    provider,
    grokModel,
    ...(grokKey.trim() ? { grokApiKey: grokKey } : {}),
    ollamaUrl: url,
    model,
    utilityModel: utility,
    contextSize: context,
  };
  const canLoad =
    provider === "grok"
      ? Boolean(grokKey.trim() || state.settings.hasGrokKey)
      : Boolean(url.trim());
  const canSaveModel =
    canLoad && Boolean((provider === "grok" ? grokModel : model).trim());
  async function run(name: string, task: () => Promise<void>) {
    setBusy(name);
    setError("");
    setSaved("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy("");
    }
  }
  async function afterCleanup() {
    const next = await api<State>("/state");
    clearDiscovery();
    setProvider(next.settings.provider);
    setGrokModel(next.settings.grokModel);
    setGrokKey("");
    setUrl(next.settings.ollamaUrl);
    setModel(next.settings.model);
    setUtility(next.settings.utilityModel);
    setContext(next.settings.contextSize);
    setSearchKey("");
    setBotToken("");
    setSaved("");
    await refresh();
  }
  return (
    <section className="document settings-page">
      <header className="page-heading">
        <h1>Make it yours.</h1>
        <p>Your models. Your machine. Your shared space.</p>
      </header>
      {error && <Notice error>{error}</Notice>}
      {saved && <Notice>{saved}</Notice>}
      <fieldset className="settings-fields" disabled={deleting}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("save", async () => {
              await api("/settings", {
                ...modelSettings,
                ...(searchKey ? { ollamaApiKey: searchKey } : {}),
                ...(botToken ? { telegramToken: botToken } : {}),
              });
              setGrokKey("");
              setSearchKey("");
              setBotToken("");
              setSaved("Settings saved.");
            });
          }}
        >
          <fieldset className="settings-fields" disabled={updating}>
            <section className="settings-section">
              <h2>Model connection</h2>
              <Field label="Model provider">
                <select
                  value={provider}
                  onChange={(e) => {
                    clearDiscovery();
                    setProvider(e.target.value === "grok" ? "grok" : "ollama");
                  }}
                >
                  <option value="ollama">Ollama</option>
                  <option value="grok">Grok (xAI)</option>
                </select>
              </Field>
              {provider === "grok" ? (
                <>
                  <Field
                    label="xAI API key"
                    hint={
                      state.settings.hasGrokKey
                        ? "A key is saved. Enter a new one to replace it."
                        : "Paste an API key from your xAI console."
                    }
                  >
                    <input
                      type="password"
                      autoComplete="off"
                      maxLength={500}
                      value={grokKey}
                      required={!state.settings.hasGrokKey}
                      onChange={(e) => {
                        clearDiscovery();
                        setGrokKey(e.target.value);
                      }}
                    />
                  </Field>
                  {state.settings.hasGrokKey ? (
                    <button
                      type="button"
                      className="text-button"
                      disabled={!!busy}
                      onClick={() =>
                        void run("remove-grok", async () => {
                          await api("/settings", { grokApiKey: "" });
                          clearDiscovery();
                          setGrokKey("");
                          setSaved("xAI API key removed.");
                        })
                      }
                    >
                      Remove saved xAI key
                    </button>
                  ) : (
                    <a
                      className="text-button"
                      href="https://console.x.ai/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open xAI console
                    </a>
                  )}
                </>
              ) : (
                <Field
                  label="Ollama address"
                  hint="Use the default for Ollama running on this computer."
                >
                  <input
                    type="url"
                    value={url}
                    required
                    placeholder="http://127.0.0.1:11434"
                    onChange={(e) => {
                      clearDiscovery();
                      setUrl(e.target.value);
                    }}
                  />
                </Field>
              )}
              <div className="inline-actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={
                    !!busy || !canLoad || discovery?.status === "loading"
                  }
                  onClick={() =>
                    void loadModels(
                      provider === "ollama"
                        ? { provider, ollamaUrl: url }
                        : {
                            provider,
                            ...(grokKey.trim() ? { grokApiKey: grokKey } : {}),
                          },
                      true,
                    )
                  }
                >
                  {discovery?.status === "loading"
                    ? "Loading models…"
                    : discovery?.status === "ready"
                      ? "Refresh models"
                      : "Load models"}
                </button>
                <span className="helper" role="status">
                  {discovery?.status === "ready" &&
                    (names.length
                      ? `${names.length} ${names.length === 1 ? "model" : "models"} available`
                      : provider === "ollama"
                        ? "Connected. Install a model in Ollama, then refresh."
                        : "No chat models are available to this xAI key.")}
                </span>
              </div>
              {discovery?.status === "error" && (
                <Notice error>{discovery.message}</Notice>
              )}
              <ModelPicker
                key={provider}
                label={
                  provider === "grok" ? "Grok model" : "Conversation model"
                }
                value={provider === "grok" ? grokModel : model}
                onChange={provider === "grok" ? setGrokModel : setModel}
                names={names}
                required
              />
              <p className="model-location">
                {provider === "grok"
                  ? "xAI processes the conversation and memory context. Your GlasHaus history is stored on this machine."
                  : `${modelLocation(model, url)}. Your GlasHaus history is stored on this machine.`}
              </p>
              {provider === "ollama" && (
                <details>
                  <summary>Advanced model settings</summary>
                  <ModelPicker
                    label="Memory and research model"
                    value={utility}
                    onChange={setUtility}
                    names={names}
                  />
                  <Field
                    label="Context size"
                    hint="Choose a size supported by your model and hardware."
                  >
                    <input
                      type="number"
                      min={2048}
                      max={131072}
                      step={1}
                      value={context}
                      onChange={(e) => setContext(Number(e.target.value))}
                    />
                  </Field>
                </details>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={!!busy || !canSaveModel}
                  onClick={() =>
                    void run("save-model", async () => {
                      await api("/settings", modelSettings);
                      setGrokKey("");
                      setSaved("Model settings saved.");
                    })
                  }
                >
                  {busy === "save-model" ? "Saving model…" : "Save model"}
                </button>
                {!state.companion && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={back}
                  >
                    Back to setup
                  </button>
                )}
              </div>
            </section>
            <section className="settings-section">
              <h2>Character research</h2>
              <p className="section-description">
                Search and fetch public sources through Ollama. Only the
                character name, source work, and story scope are sent for
                research—not your chats or relationship.
              </p>
              <Field
                label="Ollama API key"
                hint={
                  state.settings.hasSearchKey
                    ? "A key is saved. Leave blank to keep it, or enter a replacement."
                    : "Stored on this machine. Excluded from exported backups."
                }
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={searchKey}
                  onChange={(e) => setSearchKey(e.target.value)}
                  placeholder={
                    state.settings.hasSearchKey
                      ? "Saved key"
                      : "Enter your Ollama API key"
                  }
                />
              </Field>
              {state.settings.hasSearchKey && (
                <button
                  type="button"
                  className="text-button"
                  disabled={!!busy}
                  onClick={() =>
                    void run("remove-search", async () => {
                      await api("/settings", { ollamaApiKey: "" });
                      setSaved("Search key removed.");
                    })
                  }
                >
                  Remove saved key
                </button>
              )}
            </section>
            <section className="settings-section">
              <h2>Take this to Telegram.</h2>
              <p className="section-description">
                Create a bot with BotFather, paste its token, and save. Pair
                your private chat with a one-time code. Web and Telegram share
                the same companion and memory.
              </p>
              <Field
                label="BotFather token"
                hint={
                  state.settings.hasTelegramToken
                    ? "A token is saved. Leave blank to keep it."
                    : "Keep this token private. It controls your bot."
                }
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder={
                    state.settings.hasTelegramToken
                      ? "Saved token"
                      : "Paste bot token"
                  }
                />
              </Field>
              {state.settings.hasTelegramToken && (
                <div className="pairing">
                  <p>
                    {state.settings.telegramOwnerId
                      ? "Your private chat is paired."
                      : "Your bot is waiting for you."}
                  </p>
                  {state.telegram.botName && (
                    <a
                      href={`https://t.me/${state.telegram.botName}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open @{state.telegram.botName}
                    </a>
                  )}
                  {state.telegram.pairingCode &&
                    !state.settings.telegramOwnerId && (
                      <p className="pair-code">
                        Send <code>/start {state.telegram.pairingCode}</code>
                        <small>The code expires after 15 minutes.</small>
                      </p>
                    )}
                  {state.telegram.error && (
                    <Notice error>{state.telegram.error}</Notice>
                  )}
                  <div className="inline-actions">
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run("pair", async () => {
                          await api("/telegram/pair", {});
                          setSaved(
                            "Telegram connection restarted. The pairing code will appear here.",
                          );
                        })
                      }
                    >
                      Reconnect bot
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!!busy}
                      onClick={() =>
                        void run("disconnect", async () => {
                          await api("/settings", {
                            telegramToken: "",
                            telegramOwnerId: "",
                          });
                          setSaved("Telegram disconnected.");
                        })
                      }
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
              <p className="helper">
                This alpha supports private text conversations. Photos, voice,
                and proactive messages are not enabled.
              </p>
            </section>
            <div className="form-actions">
              <button
                className="button primary"
                disabled={!!busy}
                type="submit"
              >
                {busy === "save" ? "Saving…" : "Save settings"}
                <Icon name="arrow" />
              </button>
              {state.companion && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={back}
                >
                  Back to conversation
                </button>
              )}
            </div>
          </fieldset>
        </form>
        <StartupSettings refresh={refresh} />
        <UpdateSettings
          blockedReason={
            busy
              ? "Wait for your settings to finish saving or checking."
              : unsaved
                ? "Save your settings changes before updating."
                : ""
          }
          onUpdatingChange={setUpdating}
        />
        {state.companion && (
          <>
            <section className="settings-section">
              <h2>Their foundation</h2>
              <p className="section-description">
                Edit {state.companion.name}’s identity and your relationship.
                Previous revisions stay in your backup.
              </p>
              <button className="button secondary" onClick={editIdentity}>
                Edit identity
                <Icon name="arrow" />
              </button>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={state.settings.reflectionEnabled}
                  disabled={!!busy}
                  onChange={(e) =>
                    void run("reflection", async () => {
                      await api("/settings", {
                        reflectionEnabled: e.target.checked,
                      });
                    })
                  }
                />{" "}
                Allow a quiet daily reflection after 9pm while GlasHaus is
                running
              </label>
            </section>
            <section className="settings-section">
              <h2>Keep a copy.</h2>
              <p className="section-description">
                Export identity, conversations, memories, and reflections.
                Credentials stay on this machine. Your backup contains private
                conversations; store it somewhere safe.
              </p>
              <a className="button secondary" href="/api/export" download>
                <Icon name="download" /> Download backup
              </a>
            </section>
          </>
        )}
      </fieldset>
      <DataControls
        companion={state.companion}
        refresh={afterCleanup}
        onBusyChange={setDeleting}
        blockedReason={
          updating
            ? "Wait for Updates to finish checking or restarting."
            : busy
              ? "Wait for the current settings action to finish."
              : unsaved
                ? "Save your settings changes before deleting data."
                : ""
        }
      />
      <p className="helper">
        GlasHaus {state.version} · Served on localhost only. Anyone with access
        to this computer and your data folder may be able to read your
        conversations and saved credentials.
      </p>
    </section>
  );
}
