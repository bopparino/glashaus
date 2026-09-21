import { useEffect, useState } from "react";
import type { State } from "../shared/types";
import { api } from "./api";
import { Field, Notice, messageOf } from "./Forms";
import { Icon } from "./Icon";
import { modelLocation } from "./model-location";
import { StartupSettings } from "./Startup";
import { UpdateSettings } from "./Updates";
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
  const [url, setUrl] = useState(state.settings.ollamaUrl);
  const [model, setModel] = useState(state.settings.model);
  const [utility, setUtility] = useState(state.settings.utilityModel);
  const [context, setContext] = useState(state.settings.contextSize);
  const [searchKey, setSearchKey] = useState("");
  const [botToken, setBotToken] = useState("");
  const [models, setModels] = useState<{ name: string }[]>([]);
  const [connection, setConnection] = useState("Not checked");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [updating, setUpdating] = useState(true);
  const unsaved =
    url !== state.settings.ollamaUrl ||
    model !== state.settings.model ||
    utility !== state.settings.utilityModel ||
    context !== state.settings.contextSize ||
    !!searchKey ||
    !!botToken;
  useEffect(() => {
    let active = true;
    api<{ name: string }[]>("/models")
      .then((list) => {
        if (active) {
          setModels(list);
          setConnection(
            list.length
              ? `${list.length} models available`
              : "Connected. No models installed yet.",
          );
        }
      })
      .catch(() => {
        if (active)
          setConnection(
            "Ollama is not reachable. Start Ollama, then test the connection.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
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
  return (
    <section className="document settings-page">
      <header className="page-heading">
        <h1>Make it yours.</h1>
        <p>Your models. Your machine. Your shared space.</p>
      </header>
      {error && <Notice error>{error}</Notice>}
      {saved && <Notice>{saved}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run("save", async () => {
            await api("/settings", {
              ollamaUrl: url,
              model,
              utilityModel: utility,
              contextSize: context,
              ...(searchKey ? { ollamaApiKey: searchKey } : {}),
              ...(botToken ? { telegramToken: botToken } : {}),
            });
            setSearchKey("");
            setBotToken("");
            setSaved("Settings saved.");
          });
        }}
      >
        <fieldset className="settings-fields" disabled={updating}>
          <section className="settings-section">
            <h2>The engine</h2>
            <p className="section-description">
              Choose a model available through Ollama. Local models run on your
              Ollama server; cloud models send conversation context to their
              hosted provider.
            </p>
            <Field label="Ollama address">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                placeholder="http://127.0.0.1:11434"
              />
            </Field>
            <div className="inline-actions">
              <button
                className="button secondary"
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run("test", async () => {
                    await api("/settings", { ollamaUrl: url });
                    const list = await api<{ name: string }[]>("/models");
                    setModels(list);
                    setConnection(
                      list.length
                        ? `${list.length} models available`
                        : "Connected. Install a model in Ollama first.",
                    );
                    if (!model && list.length) setModel(list[0].name);
                  })
                }
              >
                {busy === "test" ? "Connecting…" : "Test connection"}
              </button>
              <span className="helper">{connection}</span>
            </div>
            <Field
              label="Conversation model"
              hint="Use the exact model name from Ollama. Names ending in :cloud use hosted inference. A remote address sends context to that server. Custom aliases may hide cloud routing; check your Ollama configuration."
            >
              <input
                list="ollama-models"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                required
                placeholder="Choose or enter a model"
              />
            </Field>
            <datalist id="ollama-models">
              {models.map((m) => (
                <option key={m.name} value={m.name} />
              ))}
            </datalist>
            <p className="model-location" role="status">
              {modelLocation(model, url)}. Your GlasHaus history is stored on
              this machine.
            </p>
            <details>
              <summary>Advanced model settings</summary>
              <Field
                label="Memory and research model"
                hint="Leave blank to use the conversation model."
              >
                <input
                  list="ollama-models"
                  value={utility}
                  onChange={(e) => setUtility(e.target.value)}
                />
              </Field>
              <Field
                label="Context size"
                hint="Larger contexts use more memory. Must be supported by your model and hardware."
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
          </section>
          <section className="settings-section">
            <h2>Character research</h2>
            <p className="section-description">
              Search and fetch public sources through Ollama. Only the character
              name, source work, and story scope are sent for research—not your
              chats or relationship.
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
              Create a bot with BotFather, paste its token, and save. Pair your
              private chat with a one-time code. Web and Telegram share the same
              companion and memory.
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
              This alpha supports private text conversations. Photos, voice, and
              proactive messages are not enabled.
            </p>
          </section>
          <div className="form-actions">
            <button className="button primary" disabled={!!busy} type="submit">
              {busy === "save" ? "Saving…" : "Save settings"}
              <Icon name="arrow" />
            </button>
            <button className="button secondary" type="button" onClick={back}>
              Back to {state.companion ? "conversation" : "setup"}
            </button>
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
              Allow a quiet daily reflection after 9pm while GlasHaus is running
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
      <p className="helper">
        GlasHaus {state.version} · Served on localhost only. Anyone with access
        to this computer and your data folder may be able to read your
        conversations and saved credentials.
      </p>
    </section>
  );
}
