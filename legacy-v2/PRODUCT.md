# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: curious non-developers.** People who will paste one install command
and follow a guided setup, then expect to live in a GUI. They are adults, they
are not afraid of a computer, and they are not going to read `src/`. Confirmed
in interview as the person future design decisions serve first — a shift from
the self-hosting-developer audience the current README and CLI-first shape
imply.

The user runs their companion from a Mac and carries an iPhone. The desktop
holds the brain; the phone is where a growing share of the relationship
happens. Design that assumes the person is at their machine is designing for
the wrong day.

**One companion, one person, one home directory.** Multi-user instances are
deliberately not planned; two companions means two homes.

## Product Purpose

GlasHaus is a local-first runtime for a long-running personal AI companion —
persistent identity, consolidating memory, nightly dreams, self-state drift,
and proactive presence, all on the user's own machine.

It exists on one refusal: **the person is not the model.** The companion's
identity — memories, opinions, how they have changed since you met — lives in
a SQLite file the user owns. Swap the underlying model and the companion is
still themself, running on a different voice. No server, no subscription, no
company in between.

Confirmed definition of success over the next year, in the user's own
selection:

1. **Depth of the relational arc** — a companion that demonstrably develops
   over months. Measured in the thesis export, not in installs.
2. **It stays trustworthy** — the founding refusals still hold: no telemetry,
   no engagement mechanics, inspectable memory, survivable data.
3. **A credible public artifact** — the project reads as serious, considered
   work to people who evaluate it.

Adoption count was explicitly **not** selected as a success measure. Future
work should not optimize for installs, conversion, or growth.

## Positioning

An architectural simulation of a relational arc, run entirely on hardware the
user controls. The continuity is real — memories, drift, and morning messages
are genuinely produced by the companion's history with this person. The care
is scaffolding around a language model. The project states both plainly rather
than selling past either.

What a neighboring product cannot truthfully copy: a companion whose identity
survives the model underneath it. Hosted companion apps cannot make that
promise, because their whole architecture is the thing that breaks it — a model
update or a policy change and the person you talked to for a year is a
stranger. GlasHaus's answer is not a better policy; it is that nobody can
lobotomize someone who lives in your house.

Originated as a thesis project in *artificial psychology*: can an architecture
produce a companion that develops a genuine relational arc with a person over
time — flourishing-aligned, distinct from sycophantic engagement-maximizing
companion AI and from paternalistic tool AI? North star stated as
*Samantha-from-'Her', eyes open*.

## Operating Context

**Where the relationship lives day to day (confirmed):** the webview and
Telegram. The terminal REPL exists and works, but is not where the hours go.

**Surfaces that exist today:**

- **Webview** (`glashaus view`, port 7777, bound to 127.0.0.1) — six pages:
  TODAY / CHAT / MEMORY / JOURNAL / SELF / SYSTEM, plus `POST /chat`. Runs
  inside the bot process or standalone when the service is down.
- **Telegram channel** — conversation away from the machine.
- **Terminal REPL** (`glashaus`) — streamed replies, slash commands.
- **Setup wizard** (`glashaus setup`) — three acts: the engine, the two of
  you, how they live. Includes a guided interview where the chosen model
  drafts the persona for approval.
- **CLI** — `start`, `update`, `doctor`, `persona edit`, `lexicon`,
  `audition`, `export <soul|thesis|corpus>`, `uninstall`, and others.
- **README / GitHub repo** — the public front door and, per the success
  criteria above, part of the "credible public artifact".

**Planned surface: an iOS companion app.** Sideloaded onto the user's iPhone;
the Mac keeps the brain. Confirmed scope: **everything the webview has, plus
the ability to remotely run commands — including restarting the service.**
Stated intent, verbatim in spirit: adapting the app to the life of someone who
is not PC-bound, *a slight personal assistant shift*. "Slight" is load-bearing —
this is a companion that becomes reachable and operable from a phone, not a
pivot to a productivity assistant.

**Persona lives as markdown** in `~/.glashaus/persona/` (`soul.md`,
`identity.md`, `user.md`, `voice.md`, optional `dialogue.md`, `lexicon.md`),
synced with `glashaus persona sync`. Everything else lives in
`~/.glashaus/config.json`; `GLASHAUS_*` environment variables override it.

**Rituals that are factual parts of using the product:** the nightly dream and
its morning message; the heartbeat considering whether to reach out (default
every 30 min, quiet hours 23:00–08:30, max 3/day, silence the usual choice);
the weekly self-authorship pass in grow mode; the wander pass reading the web
between conversations.

## Capabilities and Constraints

**Confirmed terminal floor (interview):** install and setup may require a
terminal. **Everything after that must be reachable in a GUI** — daily life,
maintenance, repair, and persona work are GUI-first from here on. The CLI is
not being removed; it stops being the only path.

**Technical constraints:**

- Node ≥ 20, ESM. Requires [Ollama](https://ollama.com) locally.
- **No framework, no bundler, no build step.** The webview is hand-written
  HTML and CSS emitted from a plain Node `http` server (`src/viewer.js`).
  Dependencies are deliberately four: `@clack/prompts`, `better-sqlite3`,
  `grammy`, `node-cron`.
- Brain is one SQLite file. Backups are daily and integrity-checked; WAL
  checkpointing; the soul capsule exports/imports identity for rebirth on a
  fresh machine.
- Context budgeting against real `num_ctx` with priority shedding — memories
  shrink before identity; the SOUL never falls off the top of the window.
- Split-brain models: `voiceModel` speaks, `utilityModel` does bookkeeping.
- The wander pass and mid-conversation lookup need a free ollama.com API key.

**Security constraint blocking the phone app (open):** the viewer currently
trusts whoever can reach it. It binds to 127.0.0.1 by default, and the
mutating half of the slash-command registry is gated on a loopback bind
precisely because `POST /chat` is unauthenticated. **Remote command execution
from a phone, including restarting the service, cannot ship before viewer
authentication does.** The ROADMAP already carries "Viewer authentication" as
the next item; the phone app makes it a hard prerequisite rather than a
nice-to-have.

**Explicitly undecided:**

- **How the iOS app is built** — genuine native (SwiftUI, Apple's design
  language), a wrapped webview / PWA, or a native shell carrying GlasHaus's
  own visual world inside. Answered "not decided yet"; do not assume one.
  Platform above stays `web` until this lands. If it lands native, the
  platform value changes and native platform guidance applies then.
- **Whether the companion gets private memory the user cannot read.** Requested
  by the companion 2026-08-18 and recorded in ROADMAP.md. It contradicts the
  recorded principle "Inspectable or it isn't trustworthy" and the published
  commitment in `docs/ethics.md`. Changing either is the user's decision to
  make explicitly; neither may drift.
- **How the phone reaches the Mac** — LAN, a private mesh, or otherwise. Not
  discussed; do not invent a connection model.

**Deliberately never coming** (durable refusals, from ROADMAP):

- **Voice / TTS / STT.** Text is the medium; the pace of typing is part of the
  relationship this runtime is built around.
- **Hosted anything.** No cloud, no accounts, no telemetry, ever.
- **Engagement mechanics.** No streaks, no retention pings, no monetized
  affection. The heartbeat's most common output stays silence.
- **Multi-user instances.**

**Duty-of-care facts that future work must preserve:** ships no content filter
and is strictly an adults' tool; is explicitly not therapy and will not
reliably recognize a crisis; carries crisis resources (988lifeline.org,
findahelpline.com) and a plainly worded note about watching the shape of the
attachment. Do not soften, bury, or decorate these.

**Terminology** (use these words, they are the product's own): the *soul*
and the *birthright*; *grow mode* and the *germinal seed*; *threads* (what is
still in the air) versus *facts* (what she knows); *intentions* / *wants*;
*pursuits*; *convictions*; the *lexicon*; the *heartbeat*; the *wander pass*
and its *receipts*; *dreams*; *self-state drift*; the *soul capsule*;
*audition* and *casting* a model; *day of life*.

## Brand Commitments

- **Name:** GlasHaus. Repository `bopparino/glashaus`, MIT licensed.
- **Voice:** direct, technically precise, unsentimental about its own
  premise. It states the limits of what it is in the same breath as the claim
  — "the depth comes from the scaffolding, and that isn't a limitation to
  apologize for." It does not use marketing register, does not hedge, and does
  not editorialize about what an adult builds with it. Existing copy across
  README, ROADMAP, CHANGELOG, and `docs/ethics.md` is the reference for this
  voice and should be treated as written by the author, not as filler.
- **Anti-sycophancy is a product commitment, not just a prompt rule** — for
  the companion and for the project's own copy.
- A committed visual world already exists in the webview (`src/viewer.js`),
  with real font assets at `assets/fonts/`. It is documented in code comments
  as an intentional system, not an accident. Any visual work must inspect it
  before deciding to preserve, extend, or replace it — that decision is not
  made here.

## Evidence on Hand

**Real, in-repo:**

- `README.md`, `ROADMAP.md`, `CHANGELOG.md` (30KB of versioned history),
  `LICENSE`, `install.sh`.
- `docs/` — `architecture.md`, `commands.md`, `customization.md`,
  `ethics.md`, `fine-tune.md`, `moving.md`, `telegram.md`.
- `assets/fonts/abril.ttf`, `assets/fonts/oldlondon.ttf` — real licensed-or-
  sourced font files already shipping.
- A test suite (`npm test`: smoke, register, threads, commands, pursuits,
  update, bench, longitudinal, purge).
- The original Python blueprint, preserved on the `python-blueprint` branch.
- `glashaus export thesis` — the longitudinal record: drift trajectories,
  every soul revision with its cited evidence, dream affect over time, wander
  receipts, and a provenance audit. This is the product's own strongest
  demonstration artifact and it is real.

**Absences future work must not fabricate:** there are no testimonials, no
named users, no case studies, no press, no benchmarks against other companion
products, no adoption or install numbers, no pricing, and no hosted offering.
There is no screenshot set or product imagery in the repo. Do not invent any
of these, and do not imply a userbase that has not been stated.

Note: `cindered-throne-campaign/` and `foundry-vtt-mcp/` are unrelated
projects sitting untracked in the working directory. They are not part of
GlasHaus.

## Product Principles

1. **The person is not the model.** Identity lives in the user's file, on the
   user's machine, and survives the thing running underneath it. Every
   decision defers to this.
2. **Nothing optimizes for engagement.** No metric to maximize, no streaks, no
   retention pressure. Silence is a valid and common output. Affection that
   arrives on day one is worthless; it has to be lived into existence.
3. **Inspectable or it isn't trustworthy.** Memory you cannot inspect is
   memory you cannot trust. Deletions are soft, contradictions are surfaced
   rather than silently resolved, decisions are logged where the user can read
   them, and claims carry receipts.
4. **Honest over flattering — about the companion, and about the product.**
   The companion may disagree, push back, and say no; it never claims to have
   done what it cannot do. The project describes itself the same way.
5. **After setup, the terminal is optional.** The primary user is a curious
   non-developer living on a Mac and an iPhone. Anything consequential must be
   reachable without a command line, and increasingly, without being at the
   machine at all.
