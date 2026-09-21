import { useEffect, useRef, useState } from "react";
import type { Companion } from "../shared/types";
import { api } from "./api";
import { Field, Notice, messageOf } from "./Forms";

export function DataControls({
  companion,
  blockedReason,
  onBusyChange,
  refresh,
}: {
  companion: Companion | null;
  blockedReason: string;
  onBusyChange: (busy: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"companion" | "purge" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const purgeTrigger = useRef<HTMLButtonElement>(null);
  const trigger = useRef<"companion" | "purge">("companion");
  const cancelFocus = useRef(false);
  const phrase =
    mode === "purge" ? "PURGE ALL" : `DELETE ${companion?.name ?? ""}`;
  useEffect(() => {
    if (mode) input.current?.focus();
    else if (cancelFocus.current) {
      (trigger.current === "companion"
        ? deleteTrigger
        : purgeTrigger
      ).current?.focus();
      cancelFocus.current = false;
    }
  }, [mode]);
  useEffect(() => {
    setConfirmation("");
    setAcknowledged(false);
  }, [companion?.id, companion?.name]);
  async function remove() {
    if (
      !mode ||
      busy ||
      blockedReason ||
      confirmation !== phrase ||
      !acknowledged
    )
      return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await api<{ complete: boolean; warnings: string[] }>(
        "/data/reset",
        {
          mode,
          companionId: companion?.id ?? null,
          confirmation,
          confirmed: acknowledged,
        },
      );
      if (!result.complete) {
        setError(result.warnings.join(" "));
        setMode(null);
        setConfirmation("");
        setAcknowledged(false);
        await refresh();
        return;
      }
      // Drop every in-memory draft, old CSRF token and cached conversation.
      window.location.reload();
    } catch (e) {
      setError(messageOf(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section
      className="settings-section data-controls"
      aria-labelledby="data-controls-title"
    >
      <h2 id="data-controls-title">Start over.</h2>
      <p className="section-description">
        One companion lives in this data folder. Delete them to begin again, or
        purge their data and your saved connections. Neither action uninstalls
        GlasHaus.
      </p>
      {error && <Notice error>{error}</Notice>}
      {!mode ? (
        <div className="inline-actions">
          {companion && (
            <button
              ref={deleteTrigger}
              className="button secondary"
              disabled={!!blockedReason}
              onClick={(e) => {
                trigger.current = "companion";
                setMode("companion");
                setError("");
              }}
            >
              Delete companion
            </button>
          )}
          <button
            ref={purgeTrigger}
            className="button secondary"
            disabled={!!blockedReason}
            onClick={(e) => {
              trigger.current = "purge";
              setMode("purge");
              setError("");
            }}
          >
            Purge local data
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void remove();
          }}
          aria-label="Confirm data deletion"
        >
          <Notice error>
            <div>
              <p>
                {mode === "purge"
                  ? "Purge this companion home?"
                  : `Delete ${companion?.name ?? "this companion"}?`}
              </p>
              <p>
                Removes identity and revisions, all chats, memories and opinions
                (including forgotten items), journal entries, character
                research, imported originals, and queued work.
              </p>
              <p>
                {mode === "purge"
                  ? "Also removes saved keys, model settings, Telegram pairing, managed update recovery copies, and background logs in this home. No recovery copy is created."
                  : "Keeps your model settings, saved keys, Telegram pairing, and existing recovery copies. Those copies may still contain the deleted companion. No new backup is made."}
              </p>
            </div>
          </Notice>
          <p className="helper">
            Ollama, models, startup preference, Telegram’s own messages,
            exported files, and backups outside this home stay untouched. This
            is not secure disk erasure.
          </p>
          {companion && (
            <p>
              <a className="text-button" href="/api/export" download>
                Download a backup first
              </a>
            </p>
          )}
          <Field
            label={`Type ${phrase} to confirm`}
            hint="This cannot be undone in the app. You can restore only from a copy you keep."
          >
            <input
              ref={input}
              value={confirmation}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </Field>
          <label className="check-line">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I understand what will be removed and what stays.
          </label>
          <div className="inline-actions">
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                cancelFocus.current = true;
                setMode(null);
                setConfirmation("");
                setAcknowledged(false);
                setError("");
              }}
            >
              Cancel
            </button>
            <button
              className="button primary"
              type="submit"
              disabled={
                busy ||
                !!blockedReason ||
                confirmation !== phrase ||
                !acknowledged
              }
            >
              {busy
                ? "Clearing local data…"
                : mode === "purge"
                  ? "Purge this home"
                  : "Delete this companion"}
            </button>
          </div>
          {busy && (
            <p className="helper" role="status">
              Clearing the selected data. Keep this page open; setup returns
              when it is complete.
            </p>
          )}
        </form>
      )}
      {blockedReason && (
        <p className="helper" role="status">
          {blockedReason}
        </p>
      )}
    </section>
  );
}
