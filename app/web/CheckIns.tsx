import { useState } from "react";
import type { CheckIn, State } from "../shared/types";
import { api } from "./api";
import { Field, Notice, messageOf } from "./Forms";

export function CheckInMessage({
  item,
  name,
  refresh,
  continueChat,
}: {
  item: CheckIn;
  name: string;
  refresh: () => Promise<void>;
  continueChat?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await api("/check-ins/" + item.id, { action }, "PATCH");
      await refresh();
      if (action === "seen") continueChat?.();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="exchange check-in-message"
      aria-label={`Check-in from ${name}`}
    >
      <div className="message companion-message">
        <p>{item.content}</p>
        <div className="message-meta">
          <span>{name} checked in</span>
          <time dateTime={item.createdAt}>
            {new Date(item.createdAt).toLocaleString()}
          </time>
        </div>
        <details className="reply-sources">
          <summary>Why this appeared</summary>
          <p>{item.reason}</p>
          <p>You said: “{item.evidence}”</p>
        </details>
        {item.status === "available" && (
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void act("seen")}
            >
              Continue conversation
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void act("dismiss")}
            >
              Dismiss check-in
            </button>
          </div>
        )}
        {error && <Notice error>{error}</Notice>}
      </div>
    </article>
  );
}

export function CheckInPreferences({
  state,
  refresh,
}: {
  state: State;
  refresh: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(state.settings.outreachEnabled);
  const [start, setStart] = useState(state.settings.quietEnd),
    [end, setEnd] = useState(state.settings.quietStart);
  const [maximum, setMaximum] = useState(
    Math.max(1, state.settings.maxOutreachPerDay),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const hour = (h: number) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 0, 1, h)));
  return (
    <section className="settings-section">
      <h2>Personal check-ins</h2>
      <p className="section-description">
        Occasional messages grounded in your conversations. They appear inside
        Glashaus; phone notifications are not connected yet.
      </p>
      <form
        onChange={() => setSaved(false)}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(
              "/check-ins/preferences",
              { enabled, quietEnd: start, quietStart: end, maxPerDay: maximum },
              "PATCH",
            );
            await refresh();
            setSaved(true);
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="settings-fields">
          <label className="check-line">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Allow personal check-ins
          </label>
          <Field label="From">
            <select
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Until">
            <select
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Maximum per day">
            <select
              value={maximum}
              onChange={(e) => setMaximum(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <p className="helper">
            {state.settings.timeZone}. At least two hours after your last
            message and four hours between check-ins. Requested reminders follow
            their own schedule.
          </p>
          <button
            className="button secondary"
            disabled={enabled && start === end}
          >
            {busy ? "Saving…" : "Save check-in preferences"}
          </button>
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        {saved && <p role="status">Preferences saved.</p>}
      </form>
    </section>
  );
}
