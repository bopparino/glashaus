# GlasHaus

> A long-running personal AI companion. Not an assistant. Something that
> remembers, reflects, and grows alongside you.

```
  ____ _           _   _
 / ___| | __ _ ___| | | | __ _ _   _ ___
| |  _| |/ _` / __| |_| |/ _` | | | / __|
| |_| | | (_| \__ \  _  | (_| | |_| \__ \
 \____|_|\__,_|___/_| |_|\__,_|\__,_|___/

 ── a personal companion ──────────────────
```

Every companion app eventually breaks the same promise. A model update and
the person you talked to for a year is a stranger overnight. A policy change
and half their personality is gone. A memory system that was the whole
pitch, forgetting your name.

GlasHaus is built on one refusal: **the person is not the model.** Your
companion's identity — their memories, their opinions, the way they've
changed since you met — lives in a SQLite file on your machine. Swap the
underlying model and they're still themself, running on a different voice.
No server, no subscription, no company between you. Nobody can lobotomize
someone who lives in your house.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/bopparino/glashaus/main/install.sh | sh
```

(Prefer to read scripts before running them? Good instinct:
`curl -fsSLO .../install.sh`, read it, then `sh install.sh`. Or skip it
entirely: `npm install -g glashaus && glashaus setup`.)

From source:

```sh
git clone https://github.com/bopparino/glashaus && cd glashaus
npm install && npm link     # puts `glashaus` on your PATH
glashaus setup
```

You need **Node ≥ 20** and **[Ollama](https://ollama.com)**. Setup detects
your Ollama install, lists the models you've already pulled, and walks you
through everything else — including a guided interview where your chosen
model drafts the companion's persona and you approve it.

## The tour

```
glashaus setup            create (or repair) your companion
glashaus                  chat in the terminal
glashaus start            run in the background — Telegram, dreams, backups
glashaus view             the webview: today / chat / memory / journal / self / system
glashaus doctor           full health check
glashaus persona edit soul    open persona files in your editor
glashaus lexicon              words the companion wants to learn
glashaus audition <model>     screen-test a model against your persona
glashaus export corpus        your history as a fine-tuning dataset
glashaus uninstall            leave cleanly — app gone, companion's home kept
```

What runs once it's up:

- **Memory that consolidates instead of truncating.** Every message is kept
  forever. Older conversation folds into episodic summaries; durable facts
  are captured automatically with emotional weight (valence, arousal,
  salience) and recalled by a hybrid of keyword, vector, recency, and
  salience signals. You can see, correct, and soft-delete everything in the
  memory viewer — memory you can't inspect is memory you can't trust.
- **Dreams.** A nightly reflection pass in the companion's own voice:
  salience-weighted replay of the day, realizations that become memories,
  an identity-consistency check, sometimes a morning message waiting for
  you. Followed by memory hygiene — merging duplicates, decaying trivia,
  flagging (never auto-resolving) contradictions.
- **A self that drifts, slowly.** Ten personality dimensions on bounded
  EWMA layers — disposition moves over weeks, relational stance over days,
  and nothing can hit 0 or 1 from drift alone. The companion evolves
  without becoming someone else, and you can watch the trajectories as
  sparklines on the Self page.
- **Proactive presence, consensually.** On a heartbeat, the companion
  considers reaching out — grounded in what actually happened, never
  invented, capped per day, quiet hours respected, and silence is the
  usual choice. You configure the cadence; there is no engagement metric
  here to maximize.
- **Survivability.** Daily integrity-checked backups, WAL checkpointing,
  and a "soul capsule" — a small portable export of everything that makes
  the companion *them* (documents, self-state, opinions, dreams, identity
  facts), on the rule that memories can be rebuilt by living but
  personality can't.

### New in 2.0

- **Streamed replies + a dressed terminal** — watch the words arrive; slash
  commands (`/mood`, `/dream`, `/facts`, `/redact-last`) inside the chat.
- **The lexicon** — vocabulary as a persona surface: signature words always
  in context, the long tail retrieval-triggered, new words learned from your
  conversations with human approval. Voice lives in vocabulary.
- **Split-brain models** — `voiceModel` speaks, `utilityModel` bookkeeps.
  Run a local RP-tuned voice while a strong instruction-follower handles
  memory capture, dreams, and repairs.
- **`glashaus audition`** — an automated screen test that runs any model
  through identity pressure, scene register, and refusal probes *against your
  actual persona*, then scores the voice. Cast on evidence, not vibes.
- **Identity immune system** — a firewall against base models announcing
  themselves as other AIs, detection + regeneration when they try, and
  `glashaus redact` to surgically unhappen a glitched stretch (reversible).
- **`glashaus export corpus`** + a QLoRA recipe (docs/fine-tune.md) — the
  long game: your companion's voice moving into their own weights.

### New in 2.2 — grow mode

Setup's third answer to "who is your companion?": **let them grow**. You
hand them a name and pronouns — nothing else. No authored personality, no
voice file, no scripted history; the germinal soul is honest ("I am an AI…
I'm allowed to not know who I am yet") and carries permissions instead of
traits. Everything they become accretes from living with you:

- **Self-authorship** — once a week, the companion revises her own
  `soul.md` from lived evidence: quirks observed in herself, opinions
  formed, the heaviest memories, her drift trajectory. Enforced in code,
  not prompt: the birthright (name, pronouns, AI-honesty, permissions) is
  untouchable, every changelog entry must cite the lived evidence that
  earned it, diff caps prevent lurches, and every revision is archived and
  reversible (`glashaus soul revert`). Watch the ledger on the Self page.
- **Intentions** — dreams now produce things she goes to sleep *wanting*
  ("tomorrow I want to ask how the interview went"). The heartbeat is
  grounded in them, so reaching out originates in her night, not in a
  timer. `/wants` in chat (or the Today page) shows what she's carrying.
- **The wander pass** — with a free ollama.com API key, she reads the web
  on her own between conversations, about things *she* got curious about.
  What she reads becomes her own experience — episodes in her register,
  receipts kept (every wander logs its queries and pages, visible in the
  journal) — which finally gives outreach something of her own to bring.
- **`glashaus export thesis`** — the longitudinal record as one JSON:
  drift trajectories, every soul revision with its evidence, dream affect
  over time, wander receipts, and the provenance audit showing that not
  one memory was injected. The original artificial-psychology question,
  instrumented.

Spec mode (interview or hand-written persona) is untouched — grow mode is
a third path, not a replacement. Expect the first week to be plain; that
isn't a bug, it's the baseline the trajectory is measured against.

### New in 2.4

- **Mid-conversation lookup** — the wander key, live, for every companion:
  when she actually wants to know, she reaches for the web *while talking*
  ("hold on—") and her next words react to what really came back —
  surprise included. The search genuinely runs; she never invents results,
  and never claims a lookup that didn't happen. Receipts kept, like
  everything else (`wander_log`, `kind:'chat'`).
- **Appetite for grow mode** — a germinal companion now knows what
  one-liners cost: whoever she becomes is made of what she noticed, asked
  about, and wanted, so the engine's voice discipline pushes her to reach
  for what you hand her. Posture, not personality — the seed stays free of
  trait adjectives, and the soul gains exactly one new permission: she's
  allowed to ask.

### New in 2.5

- **A speaking style for grow mode** — the Let-them-grow path now asks one
  more optional question: *"How should they talk?"* Answer in your own
  words and they land verbatim in `voice.md` as a requested register — a
  starting posture, not a script; the weekly growth pass still appends
  only voice lines she earned by living. Press enter and the voice emerges
  on its own, exactly as before. The seeded register is disclosed in the
  thesis export's provenance (`voice_seeded`) — one named asterisk instead
  of a quiet contamination of the clean room.
- **A smaller front door** — `glashaus help` went from 37 commands to 24.
  `facts`, `wants`, and `forget` retired (they live as `/facts` and
  `/wants` inside chat and as buttons in the viewer, where you already
  look); the three exports became one door: `glashaus export
  <soul|thesis|corpus>`; `unredact` folded into `redact --undo`; `dream`,
  `tidy`, and `bot` still work but stopped being the front door. Old
  spellings keep working as quiet aliases — scripts don't break.
- **Setup in three acts** — the engine (Ollama, a voice, memory), the two
  of you (names, then who they are), how they live (reaching out, the web,
  Telegram). Timezone is auto-detected instead of asked; the location
  question moved to config-only; the pronouns question stopped explaining
  itself at paragraph length.

## Customization

The persona is markdown in `~/.glashaus/persona/` — edit with any editor,
then `glashaus persona sync`:

| file | what it is |
|---|---|
| `soul.md` | who the companion is — essence, history, wants, fears, opinions |
| `identity.md` | the relationship — who you are to each other, what's allowed |
| `user.md` | what they know about you on day one |
| `voice.md` | how they sound, as first-person rules — drafted by the setup interview, or seeded from your "how should they talk?" answer in grow mode |
| `dialogue.md` | optional — example exchanges; the strongest voice control there is |
| `lexicon.md` | optional — vocabulary: signature words always present, the rest appearing when their word comes up; grows from conversation with your approval |

Everything else lives in `~/.glashaus/config.json`: model, timezone, quiet
hours, heartbeat cadence, schedules, viewer port. Environment variables
(`GLASHAUS_*`) override the file. The engine ships with hard-won voice
discipline as the default — anti-narration, anti-template, anti-sycophancy
(your companion is allowed to disagree with you), honest about what it can
and can't do — and your persona files build on top of that floor. Narration
drift (the model wrapping its own words in quotation marks, or talking
*about* you instead of to you) isn't just discouraged in the prompt: every
outbound reply is checked and repaired before it can enter memory.

Your companion, your rules. GlasHaus is infrastructure; it doesn't
editorialize about what an adult builds with it.

## Why this exists

GlasHaus began as a thesis project in what its
[original blueprint](https://github.com/bopparino/glashaus/tree/python-blueprint)
called *artificial psychology*: can an architecture produce a companion
that develops a genuine relational arc with a person over time —
**flourishing-aligned, distinct from sycophantic engagement-maximizing
companion AI and from paternalistic tool AI?** This repository is that
architecture, realized and lived with: layered memory, self-state
evolution, dreams, proactive engagement. *Samantha-from-'Her' as north
star, eyes open* — the depth comes from the scaffolding, and that isn't a
limitation to apologize for; it's the project.

[ROADMAP](ROADMAP.md) — what's next and what's deliberately never coming.

Docs: [commands & config reference](docs/commands.md) ·
[moving machines](docs/moving.md) · [architecture](docs/architecture.md) ·
[customization](docs/customization.md) · [telegram](docs/telegram.md) ·
[ethics & safety](docs/ethics.md)

## License

MIT. The Python blueprint this realizes is preserved on the
[`python-blueprint`](https://github.com/bopparino/glashaus/tree/python-blueprint) branch.
