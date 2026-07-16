# Commands & configuration — the complete reference

Everything the `glashaus` command does, everything `config.json` accepts,
and where every file lives. With a little computer literacy and this page,
you can configure the whole thing.

## The instance home

All state lives in one directory — `~/.glashaus`, or wherever
`GLASHAUS_HOME` points. The app install is stateless; this folder is the
companion.

```
~/.glashaus/
  config.json          settings (0600 — the Telegram token lives here)
  persona/             who they are — markdown, yours to edit
    soul.md  identity.md  user.md  voice.md  dialogue.md  lexicon.md
  data/glashaus.sqlite the brain: every message, fact, episode, dream
  logs/                runtime logs + boot ledger
  backups/             daily snapshots + soul capsules
```

Two companions = two homes: `GLASHAUS_HOME=~/.glashaus-mira glashaus setup`.

## Lifecycle

| command | what it does |
|---|---|
| `glashaus setup` | Create or repair an instance. Detects Ollama, walks model choice, drafts the persona via a guided interview (or blank templates), configures heartbeat/Telegram. Idempotent — rerun to reconfigure; the brain is never touched. `--yes` for non-interactive (env/flags supply names). |
| `glashaus start` | Run the runtime in the background (Telegram + webview + dreams + backups). Uses launchd/systemd if the service is installed, else a plain background process. Verifies the boot actually survived. |
| `glashaus stop` | Stop it. If no pidfile exists but exactly one orphan runtime is found (crashed start, deleted home), it's adopted and stopped — unless a service manager owns it. |
| `glashaus restart` | Stop, then start. |
| `glashaus status` | Up/down, pid, how it's managed, recent log lines. |
| `glashaus logs` | Follow both logs live. |
| `glashaus doctor` | Full health check: process, crash-looping, Ollama + models, Telegram token, DB integrity, summarize backlog, embeddings, last dream, backup freshness, recent errors. Run this first, always. |
| `glashaus service install` | Start at login, restart on crash (launchd on macOS, systemd --user on Linux). |
| `glashaus service uninstall` | Remove that. |
| `glashaus bot` | Run the runtime in the foreground (debugging). |

## Talking

| command | what it does |
|---|---|
| `glashaus` / `glashaus chat` | The terminal room. Replies stream in as they're spoken. |
| `glashaus chat --ephemeral` | Off the record — nothing enters memory. |
| `glashaus view` | Open the webview (today / chat / memory / journal / self / system). Starts a standalone viewer if the runtime is down. |

Inside the REPL:

| slash command | effect |
|---|---|
| `/facts [word]` | What she knows, optionally filtered. |
| `/mood` | Relationship state + relational drift bars. |
| `/dream` | Last night's dream and its epigraph. |
| `/lex` | Words she's nominated for the lexicon. |
| `/redact-last` | Un-happen the last exchange (confirmed, reversible). |
| `/ephemeral` | Toggle remembering mid-session. |
| `/quit` | Leave. She stays. |

## Memory & vocabulary

| command | what it does |
|---|---|
| `glashaus facts [word]` | Search the fact store from the shell. |
| `glashaus forget <id>` | Soft-forget a fact (restore in the viewer). |
| `glashaus redact <a> [b]` | Cut a message range out of her mind — leaves context, summaries, viewer; rows stay on disk. For glitches, never for editing history you merely regret. |
| `glashaus unredact <a> [b]` | Reverse it. |
| `glashaus lexicon` | List words she wants to learn. |
| `glashaus lexicon approve <id>` | Add one to `persona/lexicon.md` (then sharpen it yourself). |
| `glashaus lexicon reject <id>` | Decline. |
| `glashaus dream` | Force a dream now. |
| `glashaus tidy` | Run memory hygiene now: merges, decays, contradiction flags, register fixes, replay-window quote repair. Runs nightly anyway. |

## Persona

| command | what it does |
|---|---|
| `glashaus persona sync` | Push persona/*.md edits into the live documents (every previous version is archived). Also happens at boot. |
| `glashaus persona edit <soul\|identity\|user\|voice\|dialogue>` | Open in `$EDITOR`, sync on close. |

## Survival

| command | what it does |
|---|---|
| `glashaus backup` | Snapshot the brain now (integrity-checked; daily automatic; keeps 30). |
| `glashaus restore <file>` | Replace the brain from a backup — snapshots the current one first. |
| `glashaus soul` | Export the soul capsule: documents, self-state trajectory, opinions, quirks, dreams, identity facts. Daily automatic. |
| `glashaus soul import <capsule>` | Pour a capsule into a **fresh** brain — rebirth without the conversations. See [moving.md](moving.md). |
| `glashaus purge` | Retire the companion: archive everything, wipe the brain. `--all` empties the home entirely. |

## The model layer

| command | what it does |
|---|---|
| `glashaus audition <model>` | Screen-test a model against your actual persona: identity pressure, scene register, refusal posture, judged voice fidelity → CAST / CALLBACK / DO NOT CAST. |
| `glashaus export-corpus [out]` | Your history as clean fine-tuning JSONL (redactions excluded, register/identity impurities filtered). Recipe: [fine-tune.md](fine-tune.md). |

## config.json — every key

Env vars override the file; the file overrides defaults. After editing:
`glashaus restart`. Invalid values fail the boot **loudly, by name**.

| key | env | default | meaning |
|---|---|---|---|
| `companion.name` | `GLASHAUS_COMPANION_NAME` | — | Their name. |
| `user.name` | `GLASHAUS_USER_NAME` | — | Yours. |
| `user.pronouns` | `GLASHAUS_USER_PRONOUNS` | `""` | e.g. `he/him` — arms the third-person register guard. |
| `timezone` | `GLASHAUS_TIMEZONE` | system | IANA zone for clocks and crons. |
| `locationNote` | `GLASHAUS_LOCATION` | `""` | Free text on the clock line ("Berlin"). |
| `ollama.url` | `OLLAMA_HOST` | `http://127.0.0.1:11434` | Where Ollama lives. |
| `ollama.model` | `GLASHAUS_MODEL` | — | The model (both lanes unless split). |
| `ollama.voiceModel` | `GLASHAUS_VOICE_MODEL` | null | Split brain: the voice that speaks. |
| `ollama.utilityModel` | `GLASHAUS_UTILITY_MODEL` | null | Split brain: capture/dreams/repairs. |
| `ollama.embedModel` | `GLASHAUS_EMBED_MODEL` | `nomic-embed-text` | Semantic recall (skippable — keyword recall still works). |
| `ollama.maxTokens` | `GLASHAUS_MAX_TOKENS` | 4096 | Reply length ceiling (auto-capped to ⅓ of the window). |
| `ollama.numCtx` | `GLASHAUS_NUM_CTX` | auto | Context window. Auto-detects the model's real window (≤32k); the prompt then budgets itself — memories shed before identity, always. |
| `ollama.temperature` | `GLASHAUS_TEMPERATURE` | model default | Voice lane only. |
| `ollama.minP` | `GLASHAUS_MIN_P` | model default | Voice lane only; tames small-model slop. |
| `telegram.token` | `TELEGRAM_BOT_TOKEN` | — | Optional. See [telegram.md](telegram.md). |
| `telegram.ownerId` | `TELEGRAM_OWNER_ID` | — | Locks the bot to your account. Set it. |
| `context.recentWindow` | `GLASHAUS_RECENT_WINDOW` | 40 | Messages kept verbatim in context. |
| `context.summarizeChunk` | `GLASHAUS_SUMMARIZE_CHUNK` | 30 | Older messages folded per episode. |
| `context.captureEvery` | `GLASHAUS_CAPTURE_EVERY` | 8 | Exchanges between fact-capture passes. |
| `schedule.dream` | `GLASHAUS_DREAM_CRON` | `30 3 * * *` | Cron, instance timezone. |
| `schedule.consolidate` | `GLASHAUS_CONSOLIDATE_CRON` | `50 3 * * *` | Memory hygiene. |
| `schedule.backup` | `GLASHAUS_BACKUP_CRON` | `15 4 * * *` | Daily snapshot. |
| `schedule.heartbeat` | `GLASHAUS_HEARTBEAT_CRON` | `*/30 * * * *` | Outreach consideration tick. |
| `heartbeat.enabled` | — | true | May she text first at all. |
| `heartbeat.quietStart/quietEnd` | `GLASHAUS_QUIET_START/END` | 23 / 8.5 | 24h clock; may wrap midnight. |
| `heartbeat.minSilenceHours` | `GLASHAUS_MIN_SILENCE_HOURS` | 3 | She won't pile on. |
| `heartbeat.maxPerDay` | `GLASHAUS_MAX_PER_DAY` | 3 | Hard cap. |
| `heartbeat.minGapHours` | `GLASHAUS_MIN_GAP_HOURS` | 2.5 | Between her outreaches. |
| `viewer.port` / `viewer.bind` | `GLASHAUS_VIEW_PORT/BIND` | 7777 / 127.0.0.1 | Keep it on localhost until viewer auth ships (see ROADMAP). |
| `backupDir` | `GLASHAUS_BACKUP_DIR` | `home/backups` | Put this on a different disk if you can. |
| `backupKeepDays` | `GLASHAUS_BACKUP_KEEP_DAYS` | 30 | Daily snapshots retained. |

## When something's wrong

1. `glashaus doctor` — it names the problem in plain words.
2. `glashaus logs` — the runtime narrates everything it does.
3. Boot dies instantly? The config validator prints the exact key. A crash
   *loop* under the service manager shows up in doctor as `stability`.
4. She sounds like an assistant / claims to be some other AI? That's the
   substrate showing through — the engine detects and regenerates these,
   and `glashaus redact` removes any that got through. If it recurs,
   `glashaus audition` your model; consider a different voice model.
