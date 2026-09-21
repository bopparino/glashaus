import { useCallback, useEffect, useRef, useState } from "react";
import type { State, Turn } from "../shared/types";
import { api, stream } from "./api";
import { Icon } from "./Icon";
import { Settings } from "./Settings";
import { Setup } from "./Setup";
import { Memory, Becoming } from "./Memory";
import { Notice, date, messageOf } from "./Forms";
import { modelLocation } from "./model-location";
type Page = "chat" | "memory" | "becoming" | "settings" | "identity";
export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const [page, setPage] = useState<Page>("chat");
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [live, setLive] = useState<Turn | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [home, setHome] = useState(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const shouldFollow = useRef(true);
  const refresh = useCallback(async () => {
    const next = await api<State>("/state");
    setState(next);
    setOnboarding((current) => current ?? !next.companion);
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(messageOf(e)));
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 10000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (shouldFollow.current && !home)
      end.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [live?.reply, home]);
  useEffect(() => {
    if (composer.current) {
      composer.current.style.height = "auto";
      composer.current.style.height = `${Math.min(150, composer.current.scrollHeight)}px`;
    }
  }, [text]);
  const navigate = (value: Page) => {
    setPage(value);
    setError("");
    if (value === "chat") setHome(true);
    window.scrollTo(0, 0);
  };
  async function send(value = text, retryId?: string) {
    if (!value.trim() || busy) return;
    setError("");
    setHome(false);
    setPage("chat");
    setText("");
    setBusy(true);
    shouldFollow.current = true;
    const id = retryId || crypto.randomUUID();
    controller.current = new AbortController();
    setLive({
      id,
      userText: value,
      reply: "",
      channel: "web",
      status: "running",
      delivered: 0,
      error: "",
      createdAt: new Date().toISOString(),
    });
    try {
      await stream(
        "/chat",
        { id, text: value },
        controller.current.signal,
        (event) => {
          if (event.type === "status") setStatus(event.text || "");
          if (event.type === "token")
            setLive((old) =>
              old ? { ...old, reply: old.reply + (event.text || "") } : old,
            );
          if (event.turn) setLive(event.turn);
        },
      );
      await refresh();
      setLive(null);
    } catch (e) {
      const stopped = controller.current.signal.aborted;
      const message = stopped
        ? "Reply stopped. You can retry below."
        : messageOf(e);
      setError(message);
      setLive((old) =>
        old
          ? {
              ...old,
              status: stopped ? "interrupted" : "failed",
              error: message,
            }
          : old,
      );
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
      setStatus("");
      controller.current = null;
      composer.current?.focus();
    }
  }
  const c = state?.companion;
  const setup = !!state && !!onboarding && page !== "settings";
  const reading = page !== "chat" || !home || setup;
  const turns = state
    ? [...state.turns.filter((t) => t.id !== live?.id), ...(live ? [live] : [])]
    : [];
  const finishSetup = async () => {
    await refresh();
    setOnboarding(false);
    setEditingIdentity(false);
    setPage("chat");
    setHome(true);
  };
  const goHome = () => {
    navigate("chat");
    setHome(true);
  };
  const start = (draft: string) => {
    setText(draft);
    composer.current?.focus();
  };
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "morning." : hour < 18 ? "afternoon." : "evening.";
  const chatting = page === "chat" && !home && !!c;
  return (
    <div
      className={`app ${chatting ? "in-conversation" : ""} ${reading ? "reading" : ""} ${busy ? "is-thinking" : ""}`}
    >
      <img className="scene" src="/art/prism-soft.png" alt="" />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <header className="masthead">
          <div className="brand-group">
            {chatting && (
              <button
                className="back-home"
                aria-label="Back to your space"
                onClick={goHome}
              >
                <Icon name="back" size={23} />
              </button>
            )}
            <button
              className="brand"
              onClick={goHome}
              aria-label="GlasHaus home"
            >
              {c?.name || "GlasHaus"}
            </button>
            <span className="brand-rule" aria-hidden="true" />
          </div>
          <p className="masthead-note">
            A
            <br />
            calmer
            <br />
            you.
          </p>
          <nav className="main-nav" aria-label="Main">
            {(
              [
                ["chat", "Home"],
                ["memory", "Memory"],
                ["becoming", "Journal"],
                ["settings", "Settings"],
              ] as [Page, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                className="nav-item"
                onClick={() => navigate(id)}
                disabled={!c && id !== "chat" && id !== "settings"}
                aria-current={page === id ? "page" : undefined}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>
        <main
          id="main"
          className={`main-stage ${page === "chat" && c ? "chat-stage" : "document-stage"} ${home ? "home-stage" : ""}`}
        >
          {error && (
            <Notice error>
              <span>{error}</span>
              {!state && (
                <button
                  onClick={() =>
                    void refresh()
                      .then(() => setError(""))
                      .catch((e) => setError(messageOf(e)))
                  }
                >
                  Try again
                </button>
              )}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <Icon name="close" size={18} />
              </button>
            </Notice>
          )}
          {!state && !error && (
            <div className="loading-state" role="status">
              Opening your shared space…
            </div>
          )}
          {state && (onboarding || !c || editingIdentity) && (
            <div hidden={!(setup || page === "identity")}>
              <Setup
                key={editingIdentity ? "edit" : "new"}
                state={state}
                complete={finishSetup}
                settings={() => navigate("settings")}
                editing={editingIdentity}
              />
            </div>
          )}
          {state && page === "settings" && (
            <Settings
              state={state}
              refresh={refresh}
              editIdentity={() => {
                setEditingIdentity(true);
                navigate("identity");
              }}
              back={() => {
                setPage(editingIdentity ? "identity" : "chat");
                setHome(true);
              }}
            />
          )}
          {state && c && !onboarding && page === "memory" && (
            <Memory state={state} refresh={refresh} />
          )}
          {state && c && !onboarding && page === "becoming" && (
            <Becoming state={state} refresh={refresh} />
          )}
          {state && c && !onboarding && page === "chat" && (
            <>
              {home ? (
                <section className="welcome">
                  <h1>
                    Good
                    <br />
                    {greeting}
                  </h1>
                  <p>
                    Same mind.
                    <br />
                    Brighter days.
                  </p>
                </section>
              ) : (
                <section
                  className="conversation"
                  aria-label="Conversation"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    shouldFollow.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                  }}
                >
                  <h1 className="sr-only">Conversation with {c.name}</h1>
                  {!turns.length && (
                    <div className="empty-state">
                      <h2>No perfect opening needed.</h2>
                      <p>Say what’s on your mind.</p>
                    </div>
                  )}
                  {turns.map((t) => (
                    <article key={t.id} className="exchange">
                      <div className="message user-message">
                        <p>{t.userText}</p>
                        <div className="message-meta">
                          <span className="sr-only">{c.userName}</span>
                          <time dateTime={t.createdAt}>
                            {date(t.createdAt)}
                            {t.channel === "telegram" ? " · Telegram" : ""}
                          </time>
                        </div>
                      </div>
                      <div className="message companion-message">
                        <p>
                          {t.reply ||
                            (t.status === "running"
                              ? status || "Thinking…"
                              : "No reply saved.")}
                        </p>
                        <div className="message-meta">
                          <span>{c.name}</span>
                          {t.status === "running" ? (
                            <span role="status">Thinking…</span>
                          ) : (
                            <time dateTime={t.createdAt}>
                              {date(t.createdAt)}
                            </time>
                          )}
                        </div>
                        {(t.status === "failed" ||
                          t.status === "interrupted") && (
                          <div className="retry">
                            <span>
                              {t.error || "This reply was interrupted."}
                            </span>
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() =>
                                void send(
                                  t.userText,
                                  t.channel === "web" ? t.id : undefined,
                                )
                              }
                            >
                              Retry reply
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                  <div ref={end} />
                </section>
              )}
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  ref={composer}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label="Message your companion"
                  placeholder={home ? "Talk to me…" : `Message ${c.name}…`}
                  rows={1}
                  maxLength={16000}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {busy ? (
                  <button
                    type="button"
                    className="send"
                    aria-label="Stop reply"
                    onClick={() => controller.current?.abort()}
                  >
                    <Icon name="stop" size={24} />
                  </button>
                ) : (
                  <button
                    className="send"
                    aria-label="Send message"
                    disabled={!text.trim() || !state.settings.model}
                  >
                    <Icon name="up" size={25} />
                  </button>
                )}
              </form>
              {home && (
                <div className="home-actions">
                  {[
                    [
                      "Catch up",
                      "Talk about your day",
                      "I want to tell you about my day.",
                    ],
                    [
                      "Plan",
                      "Goals, work, life",
                      "Help me think through a plan.",
                    ],
                    [
                      "Create",
                      "Ideas, projects, designs",
                      "I have an idea I want to work on with you.",
                    ],
                    [
                      "Unwind",
                      "Music, games, vibes",
                      "Let’s just talk for a bit. No agenda.",
                    ],
                  ].map(([label, detail, draft]) => (
                    <button key={label} onClick={() => start(draft)}>
                      <span>
                        {label}
                        <small>{detail}</small>
                      </span>
                      <Icon name="arrow" size={21} />
                    </button>
                  ))}
                  {!!turns.length && (
                    <button
                      className="continue-chat"
                      onClick={() => {
                        setHome(false);
                        shouldFollow.current = true;
                      }}
                    >
                      Continue conversation
                      <Icon name="arrow" size={18} />
                    </button>
                  )}
                </div>
              )}
              <div className="session-note">
                <span>
                  {busy
                    ? status || "Thinking…"
                    : modelLocation(
                        state.settings.model,
                        state.settings.ollamaUrl,
                      )}
                </span>
                <span>GlasHaus / v3</span>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
