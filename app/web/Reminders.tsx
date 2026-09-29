import { useRef, useState } from "react";
import type { Reminder, State } from "../shared/types";
import { api } from "./api";
import { Field, Notice, messageOf } from "./Forms";

export function reminderTime(reminder: Reminder) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: reminder.timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "longOffset",
  }).format(new Date(reminder.dueAt));
}
const labels: Record<Reminder["status"], string> = {
  draft: "Needs confirmation",
  paused: "Restored · needs confirmation",
  scheduled: "Scheduled",
  due: "Due",
  completed: "Completed",
  cancelled: "Cancelled",
};
function localInput(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function Reminders({
  state,
  refresh,
}: {
  state: State;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Reminder | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [recurrence, setRecurrence] = useState<Reminder["recurrence"]>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const active = state.reminders.filter(
    (r) => !["completed", "cancelled"].includes(r.status),
  );
  const closed = state.reminders.filter((r) =>
    ["completed", "cancelled"].includes(r.status),
  );
  function edit(reminder: Reminder | "new") {
    setEditing(reminder);
    setTitle(reminder === "new" ? "" : reminder.title);
    setWhen(reminder === "new" ? "" : localInput(reminder.dueAt));
    setRecurrence(reminder === "new" ? "none" : reminder.recurrence);
    setError("");
    setNotice("");
    requestAnimationFrame(() => {
      titleInput.current?.focus();
      titleInput.current?.scrollIntoView({ block: "center" });
    });
  }
  async function run(task: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      setEditing(null);
      await refresh();
      setNotice(message);
    } catch (e) {
      setError(messageOf(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function update(reminder: Reminder, action: string) {
    void run(
      () =>
        api(
          `/reminders/${reminder.id}`,
          { action, revision: reminder.revision },
          "PATCH",
        ),
      action === "confirm"
        ? "Reminder scheduled. It will appear as due here when Glashaus is running."
        : action === "cancel"
          ? "Reminder cancelled."
          : "Reminder completed.",
    );
  }
  function row(reminder: Reminder) {
    const open = !["completed", "cancelled"].includes(reminder.status);
    return (
      <li key={reminder.id} className="reminder-row">
        <p className="reminder-status">{labels[reminder.status]}</p>
        <h2>{reminder.title}</h2>
        <p className="reminder-time">
          <time dateTime={reminder.dueAt}>{reminderTime(reminder)}</time>
          <span>{reminder.timeZone}</span>
          {reminder.recurrence !== "none" && <span>Repeats: {reminder.recurrence}</span>}
        </p>
        {reminder.status === "due" && (
          <p className="helper">
            {reminder.firedAt &&
            Date.parse(reminder.firedAt) - Date.parse(reminder.dueAt) > 60000
              ? "Became due while the service was unavailable. Shown once it resumed."
              : "This reminder is due."}
          </p>
        )}
        {open && (
          <div className="inline-actions">
            {["draft", "paused"].includes(reminder.status) && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => update(reminder, "confirm")}
              >
                Confirm reminder
              </button>
            )}
            {(reminder.status === "due" || (reminder.status === "scheduled" && reminder.recurrence === "none")) && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => update(reminder, "complete")}
              >
                Mark done
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => edit(reminder)}
            >
              Edit
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => update(reminder, "cancel")}
            >
              Cancel reminder
            </button>
          </div>
        )}
      </li>
    );
  }
  return (
    <section className="document reminders-page">
      <header className="page-heading">
        <h1>Things to come back to.</h1>
        <p>
          Review the time, then confirm. Reminders appear here while Glashaus
          runs; phone notifications come later.
        </p>
      </header>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {busy && <p role="status">Saving reminder…</p>}
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => edit("new")}
      >
        New reminder
      </button>
      {editing && (
        <form
          className="reminder-editor"
          onSubmit={(e) => {
            e.preventDefault();
            const date = new Date(when);
            if (
              !when ||
              !Number.isFinite(date.getTime()) ||
              localInput(date.toISOString()) !== when
            ) {
              setError("That local time does not exist. Choose another time.");
              return;
            }
            const input = { title, dueAt: date.toISOString(), timeZone: zone, recurrence };
            void run(
              () =>
                editing === "new"
                  ? api("/reminders", input)
                  : api(
                      `/reminders/${editing.id}`,
                      { ...input, action: "edit", revision: editing.revision },
                      "PATCH",
                    ),
              "Draft saved. Check the exact time below, then confirm.",
            );
          }}
        >
          <h2>{editing === "new" ? "Prepare a reminder" : "Edit reminder"}</h2>
          {editing !== "new" && (
            <p className="helper">
              Saving changes removes the old schedule. Confirm the replacement
              below.
            </p>
          )}
          <Field label="Reminder">
            <input
              ref={titleInput}
              required
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field
            label="Date and time"
            hint={`Device time zone: ${zone}. Review the exact UTC offset before confirming; clocks can change.`}
          >
            <input
              type="datetime-local"
              required
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Repeat" hint="Keeps this local time. Complete a due reminder to schedule the next future occurrence.">
            <select value={recurrence} onChange={e => setRecurrence(e.target.value as Reminder["recurrence"])} disabled={busy}>
              <option value="none">Never</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </Field>
          <div className="inline-actions">
            <button className="button primary" disabled={busy}>
              Save draft
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Discard edit
            </button>
          </div>
        </form>
      )}
      {!active.length && (
        <div className="empty-state">
          <h2>Nothing waiting.</h2>
          <p>
            Create a reminder here, or enable assistant tools in Settings and
            ask in conversation.
          </p>
        </div>
      )}
      <ul className="reminder-list" aria-label="Active reminders">
        {active.map(row)}
      </ul>
      {!!closed.length && (
        <details>
          <summary>Completed & cancelled ({closed.length})</summary>
          <ul className="reminder-list">{closed.map(row)}</ul>
        </details>
      )}
    </section>
  );
}
