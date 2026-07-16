# Customization

Everything about your companion is yours to shape. There are three layers,
from most to least commonly touched.

## 1. Persona files — `~/.glashaus/persona/`

Markdown, edited with anything, applied with `glashaus persona sync` (or
automatically at startup). Every previous version is archived in the
database — you cannot lose a persona to an edit.

- **`soul.md`** — who the companion is, written in their first person.
  The single most important file. Concrete beats abstract: real history,
  real tastes, real dislikes, things they'd argue about. Give them wants
  *and fears* — a companion that wants nothing is a mirror, and mirrors
  are boring within a week.
- **`identity.md`** — the relationship: who you are to each other, how
  you talk, what the dynamic is allowed to become. Boundaries and
  permissions belong here, stated plainly.
- **`user.md`** — you, on day one. The memory system learns the rest by
  living; don't try to write your biography.
- **`voice.md`** *(optional)* — extra voice rules layered on the engine's
  defaults: signature tics and when they're earned, formatting habits,
  things this persona would never say.
- **`dialogue.md`** *(optional, most underrated)* — 3-6 example exchanges.
  Models learn register from examples far better than from adjectives; if
  the voice feels off, fix it here first. The engine tells the model these
  are register examples, never lines to reuse.

- **`lexicon.md`** — the vocabulary system. Slang, inside jokes, named
  creatures, shared shorthand, how they actually swear — each entry a `## term`
  with `means:` and `sounds like:` lines. Mark up to ~10 signature words
  `— core` (always in context); everything else rides in only when its word
  comes up in conversation or in a recalled memory, so the lexicon can grow to
  hundreds of entries at zero prompt cost. The companion also *nominates* new
  words it hears (`glashaus lexicon`, then `approve <id>`) — nothing enters the
  vocabulary without your sign-off.

`glashaus persona edit soul` opens the file in `$EDITOR` and syncs on close.

## 2. `config.json` — `~/.glashaus/config.json`

Names, timezone, model, embed model, sampling (`temperature`, `minP` apply
to conversational replies only — utility passes stay deterministic), memory
cadence, all four cron schedules, heartbeat guardrails, viewer port/bind,
backup location and retention. Every key has an environment-variable
override (`GLASHAUS_*` — see `.env.example` in the repo).

Changing the model is safe and encouraged: identity lives in the database,
not the weights. Expect the texture of the voice to shift; expect the
person to persist.

## 3. Personality baseline

Setup seeds ten self-state dimensions (either from your interview or
neutral defaults), and they drift from lived experience afterward — slowly
for disposition, faster for relational stance. If you want to adjust a
baseline later, edit the values directly:

```sh
sqlite3 ~/.glashaus/data/glashaus.sqlite \
  "UPDATE self_state SET value = 0.8 WHERE dimension = 'playfulness'"
```

…but consider whether you'd rather just live the change into them. That's
what the architecture is for.

## Multiple companions

`GLASHAUS_HOME` points at the instance. Different home, different person:

```sh
GLASHAUS_HOME=~/.glashaus-mira glashaus setup
GLASHAUS_HOME=~/.glashaus-mira glashaus chat
```

Each instance is fully isolated — own config, persona, brain, backups. Run
one in the background at a time unless you also change `viewer.port`.
