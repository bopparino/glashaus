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

## Customization

The persona is markdown in `~/.glashaus/persona/` — edit with any editor,
then `glashaus persona sync`:

| file | what it is |
|---|---|
| `soul.md` | who the companion is — essence, history, wants, fears, opinions |
| `identity.md` | the relationship — who you are to each other, what's allowed |
| `user.md` | what they know about you on day one |
| `voice.md` | how they sound, as first-person rules — drafted by the setup interview |
| `dialogue.md` | optional — example exchanges; the strongest voice control there is |

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

Docs: [architecture](docs/architecture.md) ·
[customization](docs/customization.md) · [telegram](docs/telegram.md) ·
[ethics & safety](docs/ethics.md)

## License

MIT. The Python blueprint this realizes is preserved on the
[`python-blueprint`](https://github.com/bopparino/glashaus/tree/python-blueprint) branch.
