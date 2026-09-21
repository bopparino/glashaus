import { useEffect, useId, useState } from "react";
import type { StartupStatus } from "../shared/types";
import { api } from "./api";
import { Notice, messageOf } from "./Forms";

export async function changeStartup(enabled: boolean) {
  const result = await api<{ restarting: boolean }>("/startup", { enabled });
  if (result.restarting) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      try {
        const next = await api<StartupStatus>(
          "/startup",
          undefined,
          "GET",
          AbortSignal.timeout(2000),
        );
        if (next.managed) {
          await api("/state"); // A new process has a new mutation token.
          return;
        }
      } catch {
        /* Brief disconnect during the foreground-to-service handoff. */
      }
    }
    throw new Error(
      "Your companion is saved, but the background app hasn’t reconnected. Refresh this page in a moment. If it stays offline, start GlasHaus from its install command and check Settings.",
    );
  }
}

export function StartupChoice({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [error, setError] = useState("");
  const hint = useId();
  useEffect(() => {
    let active = true;
    api<StartupStatus>("/startup")
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active)
          setError(
            "Could not check background startup. You can set it up later in Settings.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section
      className="settings-section startup-section"
      aria-label="Background startup"
    >
      <h2>A little more present.</h2>
      <label className="check-line">
        <input
          type="checkbox"
          checked={!!(status?.managed && status.enabled) || checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={
            disabled || !status?.available || (status.managed && status.enabled)
          }
          aria-describedby={hint}
        />
        Run in the background and start at sign-in
      </label>
      <p className="helper" id={hint}>
        {status?.enabled
          ? status.managed
            ? "Sign-in startup is already on. You can change it in Settings."
            : "Sign-in startup is already on. Select this to switch this manual session to the background."
          : "Optional. Close the terminal and keep web and Telegram available while this computer is awake and Ollama is running. You can turn off sign-in startup in Settings."}
      </p>
      <p className="helper">
        {error ||
          (status
            ? status.message ||
              `${status.platform}. Runs as you, not as an administrator.`
            : "Checking startup support…")}
      </p>
    </section>
  );
}

export function StartupSettings({ refresh }: { refresh: () => Promise<void> }) {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = async () => setStatus(await api<StartupStatus>("/startup"));
  useEffect(() => {
    void load().catch(() =>
      setError("Could not check startup. Reopen Settings to try again."),
    );
  }, []);
  async function change(enabled: boolean) {
    setBusy(true);
    setError("");
    setMessage(
      enabled
        ? "Switching to background mode. This page will reconnect…"
        : "Turning off sign-in startup…",
    );
    try {
      await changeStartup(enabled);
      await load();
      await refresh();
      setMessage(
        enabled
          ? "Background startup is on. You can close the terminal and this tab."
          : "Sign-in startup is off. This session stays open until you stop it or sign out.",
      );
    } catch (e) {
      setError(messageOf(e));
      setMessage("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section startup-section">
      <h2>Here when you sign in.</h2>
      <p className="section-description">
        Keep GlasHaus running without a terminal. Web and Telegram still need
        this computer awake and Ollama available.
      </p>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {status ? (
        <>
          <p className="helper">
            {status.platform} · Sign-in startup {status.enabled ? "on" : "off"}{" "}
            · {status.managed ? "Background session" : "Manual session"}
          </p>
          {status.message && <p className="helper">{status.message}</p>}
          {status.enabled && !status.managed && status.available && (
            <div className="form-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void change(true)}
              >
                Switch this session to background
              </button>
            </div>
          )}
          <button
            className="button secondary"
            disabled={busy || (!status.available && !status.enabled)}
            onClick={() => void change(!status.enabled)}
          >
            {busy
              ? "Updating startup…"
              : status.enabled
                ? "Turn off sign-in startup"
                : "Enable background startup"}
          </button>
          <p className="helper">
            Runs under your own account. Turning this off does not close the
            current session or erase your companion. Linux uses a systemd user
            service; running before sign-in needs a separate system setting.
          </p>
        </>
      ) : (
        !error && (
          <p role="status" className="helper">
            Checking startup support…
          </p>
        )
      )}
    </section>
  );
}
