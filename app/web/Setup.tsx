import { useEffect, useRef, useState } from "react";
import type { Character, Companion, State } from "../shared/types";
import { api, stream } from "./api";
import { Field, Notice, messageOf } from "./Forms";
import { Icon } from "./Icon";
import { StartupChoice, changeStartup } from "./Startup";
type Draft = Character & Pick<Companion, "userName" | "relationship">;
const empty: Draft = {
  name: "",
  pronouns: "",
  mode: "character",
  work: "",
  summary: "",
  personality: "",
  voice: "",
  backstory: "",
  values: "",
  uncertainties: [],
  claims: [],
  sources: [],
  userName: "",
  relationship: "",
};
export function Setup({
  state,
  complete,
  settings,
  editing = false,
}: {
  state: State;
  complete: () => Promise<void>;
  settings: () => void;
  editing?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(
    editing && state.companion ? state.companion : empty,
  );
  const [step, setStep] = useState(editing ? 1 : 0);
  const [restore, setRestore] = useState(false);
  const [scope, setScope] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState("");
  const [backgroundStartup, setBackgroundStartup] = useState(false);
  const [identitySaved, setIdentitySaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const researchId = useRef<string | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const patch = (value: Partial<Draft>) => {
    setDraft((old) => ({ ...old, ...value }));
    setPreview("");
  };
  async function run(label: string, task: () => Promise<void>) {
    setError("");
    setBusy(label);
    try {
      await task();
    } catch (e) {
      setError(
        controller.current?.signal.aborted
          ? "Stopped. Your research sources have been saved; you can resume below."
          : messageOf(e),
      );
    } finally {
      setBusy("");
      controller.current = null;
    }
  }
  async function research() {
    controller.current = new AbortController();
    await stream(
      "/research",
      { name: draft.name, work: draft.work, scope, id: researchId.current },
      controller.current.signal,
      (event) => {
        if (event.id) researchId.current = event.id;
        if (event.type === "status") setStatus(event.text!);
        if (event.sources) patch({ sources: event.sources });
        if (event.draft) patch(event.draft);
      },
    );
    setStatus("Ready for your review. Make it feel right before you continue.");
  }
  const savedResearch = state.research.find((r) => r.draft || r.sources.length);
  if (identitySaved && !editing)
    return (
      <section className="document setup-page">
        <header className="page-heading">
          <h1>Your companion is saved.</h1>
          <p>Finishing how GlasHaus runs on this computer.</p>
        </header>
        {busy && (
          <Notice>
            Starting in the background. This page will reconnect in a moment…
          </Notice>
        )}
        {error && <Notice error>{error}</Notice>}
        {!busy && (
          <div className="form-actions">
            {backgroundStartup && (
              <button
                className="button primary"
                onClick={() =>
                  void run("save", async () => {
                    await changeStartup(true);
                    await complete();
                  })
                }
              >
                Retry background startup
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => void run("continue", complete)}
            >
              Continue with manual start
            </button>
          </div>
        )}
      </section>
    );
  return (
    <section className="document setup-page">
      <header className="page-heading">
        <h1>
          {editing
            ? "Still becoming."
            : step === 0
              ? "A beginning,\nnot a template."
              : step === 1
                ? "Find their voice."
                : step === 2
                  ? "And who are\nyou to each other?"
                  : "A first hello."}
        </h1>
        <p>
          {editing
            ? "Keep what feels true. Change what doesn’t."
            : "Someone familiar. Someone new. Something that grows."}
        </p>
      </header>
      <ol className="steps" aria-label="Setup progress">
        {["Beginning", "Identity", "Relationship", "Hello"].map((name, i) => (
          <li key={name} aria-current={step === i ? "step" : undefined}>
            {i < step ? (
              <button
                onClick={() => {
                  setStep(i);
                  setError("");
                }}
                disabled={!!busy}
              >
                {name}
              </button>
            ) : (
              <span>{name}</span>
            )}
          </li>
        ))}
      </ol>
      {error && <Notice error>{error}</Notice>}
      {!state.settings.model && (
        <Notice>
          <span>
            Connect your Ollama model before researching or previewing.
          </span>
          <button onClick={settings}>Open settings</button>
        </Notice>
      )}
      {step === 0 && (
        <>
          <fieldset className="mode-options">
            <legend className="sr-only">Choose a beginning</legend>
            {(
              [
                [
                  "character",
                  "Someone you know",
                  "Bring a character’s personality and voice from public sources.",
                ],
                [
                  "authored",
                  "Someone you imagine",
                  "Write their personality, history, and point of view.",
                ],
                [
                  "grow",
                  "Someone yet to be",
                  "Start simply. Let preferences emerge through conversation.",
                ],
              ] as const
            ).map(([mode, title, description]) => (
              <label
                className={`mode-option ${draft.mode === mode && !restore ? "chosen" : ""}`}
                key={mode}
              >
                <input
                  type="radio"
                  name="beginning"
                  checked={draft.mode === mode && !restore}
                  onChange={() => {
                    patch({ ...empty, mode });
                    setRestore(false);
                  }}
                />
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <Icon name="arrow" />
              </label>
            ))}
            <label className={`mode-option ${restore ? "chosen" : ""}`}>
              <input
                type="radio"
                name="beginning"
                checked={restore}
                onChange={() => setRestore(true)}
              />
              <span>
                <strong>Someone you remember</strong>
                <small>
                  Restore a v3 backup or bring over a v2 soul capsule.
                </small>
              </span>
              <Icon name="download" />
            </label>
          </fieldset>
          {restore ? (
            <div className="restore">
              <StartupChoice
                checked={backgroundStartup}
                onChange={setBackgroundStartup}
                disabled={!!busy}
              />
              <Field
                label="Choose your backup"
                hint="v3 JSON restores conversation history. A v2 soul capsule carries identity, not full history. Existing v2 databases are never modified."
              >
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={!!busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void run("import", async () => {
                        if (file.size > 50_000_000)
                          throw new Error("Choose a JSON backup under 50 MB.");
                        if (!identitySaved) {
                          await api("/import", JSON.parse(await file.text()));
                          setIdentitySaved(true);
                        }
                        if (backgroundStartup) await changeStartup(true);
                        await complete();
                      });
                  }}
                />
              </Field>
              {busy === "import" && (
                <p role="status">Restoring your shared space…</p>
              )}
            </div>
          ) : (
            <button className="button primary" onClick={() => setStep(1)}>
              Let’s begin
              <Icon name="arrow" />
            </button>
          )}
          {!editing && savedResearch && (
            <button
              className="resume-research"
              onClick={() => {
                researchId.current = savedResearch.id;
                setScope(savedResearch.scope);
                patch(
                  savedResearch.draft || {
                    ...empty,
                    name: savedResearch.name,
                    work: savedResearch.work,
                    sources: savedResearch.sources,
                  },
                );
                setStep(1);
              }}
            >
              Continue saved research: {savedResearch.name}
              <Icon name="arrow" />
            </button>
          )}
        </>
      )}
      {step === 1 && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("research", research);
            }}
          >
            <div className="field-row">
              <Field label="Their name">
                <input
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder={
                    draft.mode === "character"
                      ? "Character name"
                      : "What would you call them?"
                  }
                />
              </Field>
              <Field label="Pronouns" hint="Optional">
                <input
                  maxLength={60}
                  value={draft.pronouns}
                  onChange={(e) => patch({ pronouns: e.target.value })}
                  placeholder="e.g. she / her"
                />
              </Field>
            </div>
            {draft.mode === "character" && (
              <>
                <Field label="Where are they from?">
                  <input
                    required
                    maxLength={200}
                    value={draft.work}
                    onChange={(e) => patch({ work: e.target.value })}
                    placeholder="Book, film, game, or series"
                  />
                </Field>
                <Field
                  label="Story scope"
                  hint="Optional. Name an adaptation, season, or spoiler limit."
                >
                  <input
                    maxLength={500}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder="e.g. original novel, through chapter 12"
                  />
                </Field>
                <div className="inline-actions">
                  <button
                    className="button secondary"
                    disabled={
                      !!busy ||
                      !state.settings.model ||
                      !state.settings.hasSearchKey
                    }
                    type="submit"
                  >
                    {busy === "research"
                      ? "Getting to know them…"
                      : researchId.current
                        ? "Resume / refresh research"
                        : "Absorb character"}
                    <Icon name="search" />
                  </button>
                  {busy === "research" && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => controller.current?.abort()}
                    >
                      Stop research
                    </button>
                  )}
                </div>
                {!state.settings.hasSearchKey && (
                  <p className="helper">
                    Add an Ollama API key in{" "}
                    <button
                      className="text-button"
                      type="button"
                      onClick={settings}
                    >
                      Settings
                    </button>{" "}
                    for public-source research. You can also write the
                    foundation yourself.
                  </p>
                )}
                {status && (
                  <p className="research-status" role="status">
                    {status}
                  </p>
                )}
              </>
            )}
          </form>
          {draft.sources.length > 0 && (
            <details className="source-list">
              <summary>
                {draft.sources.length} sources · inspect the evidence
              </summary>
              {draft.sources.map((s) => (
                <article key={s.id}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title || new URL(s.url).hostname}
                    <Icon name="arrow" size={16} />
                  </a>
                  <p>
                    {s.excerpt.slice(0, 350)}
                    {s.excerpt.length > 350 ? "…" : ""}
                  </p>
                </article>
              ))}
              {draft.claims.map((c, i) => (
                <p className="claim" key={i}>
                  <span>
                    {c.kind === "sourced" ? "SOURCE-BACKED" : "INTERPRETATION"}
                  </span>
                  {c.text}
                </p>
              ))}
            </details>
          )}
          {draft.uncertainties.length > 0 && (
            <Notice>
              <div>
                <strong>Worth checking</strong>
                <ul>
                  {draft.uncertainties.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            </Notice>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.name.trim())
                return setError("Give them a name before continuing.");
              setError("");
              setStep(2);
            }}
            className="identity-form"
          >
            <h2>
              {draft.mode === "grow"
                ? "A light foundation"
                : "Their foundation"}
            </h2>
            <p className="section-description">
              {draft.mode === "grow"
                ? "A name is enough to start. Leave room for their voice to grow."
                : "An editable starting point, not a script. Research can be wrong—review what you want to keep."}
            </p>
            {(
              [
                ["summary", "In a few words", 2000],
                ["personality", "Personality", 8000],
                ["voice", "How they speak", 5000],
                ["values", "What matters to them", 4000],
                ["backstory", "Their history", 8000],
              ] as const
            ).map(([key, label, max]) => (
              <Field label={label} key={key}>
                <textarea
                  rows={key === "summary" ? 2 : 3}
                  maxLength={max}
                  value={draft[key]}
                  onChange={(e) => patch({ [key]: e.target.value })}
                />
              </Field>
            ))}
            <div className="form-actions">
              <button className="button primary" disabled={!!busy}>
                Set the relationship
                <Icon name="arrow" />
              </button>
            </div>
          </form>
        </>
      )}
      {step === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStep(3);
            setError("");
          }}
        >
          <Field label="What should they call you?">
            <input
              required
              maxLength={100}
              value={draft.userName}
              onChange={(e) => patch({ userName: e.target.value })}
              placeholder="Your name or preferred pet name"
            />
          </Field>
          <Field
            label="Your relationship"
            hint="Set the tone, closeness, boundaries, and any fictional shared history. This is starting context, not a record of conversations you’ve actually had."
          >
            <textarea
              required
              rows={7}
              maxLength={6000}
              value={draft.relationship}
              onChange={(e) => patch({ relationship: e.target.value })}
              placeholder="How do you know each other? What should this connection feel like?"
            />
          </Field>
          <button className="button primary">
            Meet {draft.name}
            <Icon name="arrow" />
          </button>
        </form>
      )}
      {step === 3 && (
        <>
          <div className="identity-summary">
            <h2>{draft.name}</h2>
            <p>{draft.summary || "A new voice, with room to grow."}</p>
            <dl>
              <div>
                <dt>Calls you</dt>
                <dd>{draft.userName}</dd>
              </div>
              <div>
                <dt>Relationship</dt>
                <dd>{draft.relationship}</dd>
              </div>
            </dl>
          </div>
          <button
            className="button secondary"
            disabled={!!busy || !state.settings.model}
            onClick={() =>
              void run("preview", async () => {
                controller.current = new AbortController();
                const result = await api<{ text: string }>(
                  "/preview",
                  draft,
                  "POST",
                  controller.current.signal,
                );
                setPreview(result.text);
              })
            }
          >
            {busy === "preview"
              ? "Finding the words…"
              : preview
                ? "Try another hello"
                : "Preview their voice"}
          </button>
          {preview && (
            <div className="preview-reply">
              <span>{draft.name}</span>
              <p>{preview}</p>
              <small>
                A preview only. This is not added to your conversation.
              </small>
            </div>
          )}
          {!editing && (
            <StartupChoice
              checked={backgroundStartup}
              onChange={setBackgroundStartup}
              disabled={!!busy}
            />
          )}
          <div className="form-actions">
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() =>
                void run("save", async () => {
                  if (!identitySaved || editing) {
                    await api("/companion", draft, editing ? "PATCH" : "POST");
                    setIdentitySaved(true);
                  }
                  if (!editing && backgroundStartup) await changeStartup(true);
                  await complete();
                })
              }
            >
              {busy === "save"
                ? backgroundStartup
                  ? "Saving and starting in background…"
                  : "Saving…"
                : editing
                  ? "Save their foundation"
                  : "Make a home together"}
              <Icon name="arrow" />
            </button>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => setStep(1)}
            >
              Keep shaping
            </button>
          </div>
        </>
      )}
    </section>
  );
}
