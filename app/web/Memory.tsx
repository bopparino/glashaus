import { useState } from "react";
import type { Memory as MemoryRecord, State } from "../shared/types";
import { api } from "./api";
import { Field, Notice, date, messageOf } from "./Forms";
import { Icon } from "./Icon";
export function Memory({
  state,
  refresh,
}: {
  state: State;
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [subject, setSubject] = useState<MemoryRecord["subject"]>("user");
  const [newKind, setNewKind] = useState<MemoryRecord["kind"]>("fact");
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const memories = state.memories.filter(
    (m) =>
      (kind === "all" || m.kind === kind) &&
      m.text.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="document">
      <header className="page-heading">
        <h1>Carried forward.</h1>
        <p>
          What stays with {state.companion?.name}. Yours to inspect, correct, or
          let go.
        </p>
      </header>
      {error && <Notice error>{error}</Notice>}
      <div className="memory-toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search memories"
            placeholder="Find a memory…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="button secondary" onClick={() => setAdding(!adding)}>
          <Icon name={adding ? "close" : "plus"} />
          {adding ? "Close" : "Add memory"}
        </button>
      </div>
      {adding && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/memories", { text: newText, subject, kind: newKind });
              setNewText("");
              setAdding(false);
            });
          }}
        >
          <Field label="Something worth remembering">
            <textarea
              required
              maxLength={1500}
              rows={3}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
            />
          </Field>
          <div className="field-row">
            <Field label="About">
              <select
                value={subject}
                onChange={(e) =>
                  setSubject(e.target.value as MemoryRecord["subject"])
                }
              >
                <option value="user">You</option>
                <option value="companion">Your companion</option>
                <option value="relationship">Your relationship</option>
              </select>
            </Field>
            <Field label="Kind">
              <select
                value={newKind}
                onChange={(e) =>
                  setNewKind(e.target.value as MemoryRecord["kind"])
                }
              >
                <option value="fact">Memory</option>
                <option value="opinion">Point of view</option>
              </select>
            </Field>
          </div>
          <button className="button primary" disabled={busy}>
            Keep this
          </button>
        </form>
      )}
      <div className="tabs" role="group" aria-label="Filter memories">
        {[
          ["all", "Everything"],
          ["fact", "Memories"],
          ["opinion", "Points of view"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={kind === id}
            onClick={() => setKind(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {!memories.length && (
        <div className="empty-state">
          <Icon name="memory" size={30} />
          <h2>
            {query
              ? "Nothing with those words."
              : "A little room for what matters."}
          </h2>
          <p>
            {query
              ? "Try another search or a different filter."
              : "As you talk, supported details and stated opinions can be saved here. You can add something yourself, too."}
          </p>
        </div>
      )}
      <div className="memory-list">
        {memories.map((m) => (
          <article key={m.id} className="memory-item">
            <div className="item-meta">
              <span>
                {m.kind === "opinion"
                  ? "POINT OF VIEW"
                  : m.subject === "user"
                    ? "ABOUT YOU"
                    : m.subject === "relationship"
                      ? "ABOUT YOU TWO"
                      : "ABOUT THEM"}
              </span>
              <time dateTime={m.createdAt}>{date(m.createdAt)}</time>
            </div>
            {editing === m.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api(`/memories/${m.id}`, { text }, "PATCH");
                    setEditing(null);
                  });
                }}
              >
                <Field label="Edit memory">
                  <textarea
                    required
                    maxLength={1500}
                    rows={3}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </Field>
                <div className="inline-actions">
                  <button className="button primary" disabled={busy}>
                    Save correction
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <p>{m.text}</p>
            )}
            <details>
              <summary>
                {m.turnId ? "Why this was remembered" : "Added directly"}
              </summary>
              <blockquote>{m.evidence}</blockquote>
              <p className="helper">
                {m.turnId
                  ? "Based on a saved conversation. Model-written memories can be wrong."
                  : "This memory was added or corrected by you."}
              </p>
            </details>
            {forgetting === m.id ? (
              <div className="forget-confirm">
                <p>
                  Forget this memory? It will be excluded from recall. The
                  original chat stays in your backup, but this exchange will no
                  longer supply new memories or recent context.
                </p>
                <div className="inline-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/memories/${m.id}`, {}, "DELETE");
                        setForgetting(null);
                      })
                    }
                  >
                    Yes, forget it
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setForgetting(null)}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <div className="item-actions">
                <button
                  onClick={() => {
                    setText(m.text);
                    setEditing(m.id);
                    setForgetting(null);
                  }}
                >
                  Edit
                </button>
                <button onClick={() => setForgetting(m.id)}>Forget</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
export function Becoming({
  state,
  refresh,
}: {
  state: State;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="document">
      <header className="page-heading">
        <h1>
          A point of view,
          <br />
          taking shape.
        </h1>
        <p>
          {state.companion?.name}’s journal. Reflections on conversations you’ve
          actually had.
        </p>
      </header>
      {error && <Notice error>{error}</Notice>}
      <button
        className="button secondary"
        disabled={
          busy ||
          !state.turns.some((t) => t.status === "complete" && t.delivered)
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("/reflect", {});
            await refresh();
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Taking a moment…" : "Reflect on our conversations"}
        <Icon name="leaf" />
      </button>
      <p className="helper">
        {state.settings.reflectionEnabled
          ? "Daily reflection is enabled in Settings."
          : "Reflections happen when you ask. You can allow daily reflection in Settings."}
      </p>
      {!state.reflections.length ? (
        <div className="empty-state">
          <Icon name="leaf" size={36} />
          <h2>Nothing to rush.</h2>
          <p>
            Have a conversation first. There doesn’t need to be a ready-made
            opinion on everything.
          </p>
        </div>
      ) : (
        <div className="journal">
          {state.reflections.map((r) => (
            <article key={r.id}>
              <time dateTime={r.createdAt}>{date(r.createdAt)}</time>
              <p>{r.content}</p>
              <small>
                Drawn from {r.sourceTurnIds.length} shared{" "}
                {r.sourceTurnIds.length === 1 ? "exchange" : "exchanges"}
              </small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
