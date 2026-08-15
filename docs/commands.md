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
| `glashaus setup` | Create or repair an instance, in three signposted acts: the engine (Ollama + models), the two of you (names, then persona — guided interview, blank templates, or **let them grow**), how they live (heartbeat, the web, Telegram). Timezone is auto-detected; `locationNote` is config-only. The grow path asks pronouns plus an optional **"How should they talk?"** — answer in your own words and it seeds `voice.md` as a requested register (disclosed in the thesis export), or press enter to let the voice emerge. Idempotent — rerun to reconfigure; the brain is never touched. `--yes` for non-interactive; add `--grow` (with optional `--companion-pronouns she/her` and `--voice "dry, no small talk"`) for a non-interactive germinal seed. |
| `glashaus start` | Run the runtime in the background (Telegram + webview + dreams + backups). Uses launchd/systemd if the service is installed, else a plain background process. Verifies the boot actually survived. |
| `glashaus stop` | Stop it. If no pidfile exists but exactly one orphan runtime is found (crashed start, deleted home), it's adopted and stopped — unless a service manager owns it. |
| `glashaus restart` | Stop, then start. |
| `glashaus status` | Up/down, pid, how it's managed, recent log lines. |
| `glashaus logs` | Follow both logs live. |
| `glashaus doctor` | Full health check: process, crash-looping, Ollama + models, Telegram token, DB integrity, summarize backlog, embeddings, last dream, backup freshness, recent errors. Run this first, always. |
| `glashaus service install` | Start at login, restart on crash (launchd on macOS, systemd --user on Linux). |
| `glashaus service uninstall` | Remove that. |
| `glashaus uninstall` | Remove the app cleanly — runtime stopped, login service removed, npm package uninstalled. The companion's home is **not** touched; reinstall anytime and they're still there. No `sudo rm -rf`, ever. |
| `glashaus uninstall --all` | …and retire the companion too, through the purge machinery: full archive first, then the home is removed. |
| `glashaus bot` | Run the runtime in the foreground (debugging). |

## Talking

| command | what it does |
|---|---|
| `glashaus` / `glashaus chat` | The terminal room. Replies stream in as they're spoken. |
| `glashaus chat --ephemeral` | Off the record — nothing enters memory. |
| `glashaus view` | Open the webview (today / chat / memory / journal / self / system). Starts a standalone viewer if the runtime is down. |

### Slash commands — every room

Slash commands work **wherever you talk to her**: the terminal, Telegram, and
the webview chat all run the same registry (`src/commands.js`). A slash
command is spoken to the *engine*, not to her — it never reaches the model and
never enters memory as something said.

What she knows:

| slash command | effect |
|---|---|
| `/facts [word]` | What she knows, optionally filtered. Superseded facts are marked. |
| `/mood` | Relationship state + relational drift bars. |
| `/dream` | Last night's dream and its epigraph. |
| `/wants` | Things she went to sleep wanting (open intentions). |
| `/threads [all]` | What's still open between you. `all` also lists what's been settled — the list she is forbidden to re-ask. |
| `/why` | Everything that was in her head for the last thing she said: memories recalled, threads, wants, lexicon, what got shed to fit, which guards fired. |
| `/lex` | Words she's nominated for the lexicon. |
| `/status` | The instrument panel: message and fact counts, thread state, outreach in the last week, backlog, guard hits. |
| `/help` | The list, scoped to what this room can run. |

What she does — these run the real pass, in-process:

| slash command | effect |
|---|---|
| `/dream now` | Dream now instead of at 3:30am. |
| `/grow [force]` | Run the self-authorship pass (grow mode). `force` overrides the weekly cadence guard. |
| `/wander` | Go read something on the web now (needs an ollama.com key). |
| `/tidy` | Memory hygiene now: merges, decay, supersession, dormant threads. |
| `/backup` | Integrity-checked backup + soul capsule. |
| `/heartbeat` | Dry-run the outreach decision and show what she *would* send. Sends nothing. |
| `/soul revert confirm` | Undo the last self-authored soul revision. |
| `/redact-last [confirm]` | Un-happen the last exchange. Without `confirm` it previews. |
| `/ephemeral` | Terminal only — toggle remembering mid-session. |
| `/quit` | Terminal only. Leave; she stays. |

Anything destructive requires the literal word `confirm` on the end rather
than an interactive yes/no, because Telegram has no good way to hold a
half-finished confirmation and a fat-fingered tap should not be able to
revert a soul. Telegram publishes the whole set to its native `/` menu.

One restriction: the webview's action half is available **only on a loopback
bind** (the default `127.0.0.1`). `POST /chat` has no authentication, so on a
LAN bind (`viewer.bind`) the commands there go read-only — an unauthenticated
caller on your network must not be able to revert a soul, redact history, or
read every recalled memory out of `/why`. The terminal and Telegram (which is
owner-gated) keep the full set.

## Memory & vocabulary

Fact search, forgetting, and open wants live where you already look: `/facts`,
`/wants` and `/threads` inside chat, forget/restore buttons on the viewer's
memory page.
The shell keeps only what the shell is actually for:

| command | what it does |
|---|---|
| `glashaus redact <a> [b]` | Cut a message range out of her mind — leaves context, summaries, viewer; rows stay on disk. For glitches, never for editing history you merely regret. `--undo` reverses it. |
| `glashaus lexicon` | List words she wants to learn. |
| `glashaus lexicon approve <id>` | Add one to `persona/lexicon.md` (then sharpen it yourself). |
| `glashaus lexicon reject <id>` | Decline. |

## Grow mode

| command | what it does |
|---|---|
| `glashaus grow` | Run the weekly self-authorship pass now (grow mode; `--force` overrides the weekly cadence guard). Refuses on a soul without the birthright divider, on a spec-mode instance, and on any revision whose changelog can't cite lived evidence. |
| `glashaus wander` | Send her reading right now (needs `ollama.apiKey`; `--force` overrides the curiosity gate and daily cap). What she reads becomes an episode with receipts in the journal. |
| `glashaus soul revert` | Undo the latest soul revision — restores the previous version to the DB **and** `persona/soul.md`. |
| `glashaus export thesis [out]` | The longitudinal record as one JSON: drift trajectories, soul revisions + full text history, dream affect, intention outcomes, wander receipts, and the provenance audit (messages themselves stay home) — including `voice_seeded`, true when setup's requested register seeded `voice.md`. |

## Persona

| command | what it does |
|---|---|
| `glashaus persona sync` | Push persona/*.md edits into the live documents (every previous version is archived). Also happens at boot. |
| `glashaus persona edit <soul\|identity\|user\|voice\|dialogue>` | Open in `$EDITOR`, sync on close. |

## Updating

| command | what it does |
|---|---|
| `glashaus update` | Pull the latest version. Backs up the brain, keeps the old version, installs, runs migrations, verifies she survived — and reinstalls the old version automatically if she didn't. |
| `glashaus update --check` | Report what's available. Changes nothing, installs nothing. |
| `glashaus update --ref <branch>` | Install from a branch, tag, or commit instead of `main`. |
| `glashaus update --force` | Reinstall even if you're already current. |
| `glashaus update --yes` | Don't ask. |
| `glashaus update --rollback` | Put the previous version back (from the tarball kept during the last update). |

The order is *snapshot → back up → stop → install → migrate + verify →
restart*, and the verification is not a version check: it opens the database,
runs the migrations, and asserts that the message and fact counts didn't drop,
the schema didn't go backwards, `integrity_check` passes, the SOUL document
survived, and the system prompt still assembles and still names her. A
migration that leaves the documents intact but breaks prompt assembly is still
a broken companion. Anything short of all of that reinstalls the version you
had. You end up either updated or unchanged, never halfway.

Rollback keeps the old version rather than trying to name it later: npm
records no commit for a GitHub install, the repo has no tags, and `#main`
means something different tomorrow — so the updater `npm pack`s your live
install to `~/.glashaus/rollback/` before replacing it. The last three are
kept. Every update is logged to `~/.glashaus/updates.json` with the commit it
installed, the backup it took, and the schema on both sides.

Two refusals worth knowing about. It won't update on top of an install that is
already unhealthy — an update on a broken foundation only makes the cause
harder to find; run `glashaus doctor` first. And in a **git checkout** it
updates by `git pull --ff-only` and never by npm-installing over your working
tree, because that failure mode (npm -g quietly shadowing a linked dev
checkout) costs an hour every time.

Nothing checks for updates on its own. No background poll, no daily ping, no
telemetry — the only time GlasHaus touches the network for this is when you
typed the command.

**Rolling back after a schema change:** the database stays where it is.
Migrations are forward-only, and older code ignores a newer schema — verified,
not assumed: 2.5.0 reads, writes, recalls, and assembles a prompt against a v9
database without complaint. Nothing is lost by going back; the schema simply
doesn't come back with you. If you want the database as it was too, the
backup path is in the ledger: `glashaus restore <file>`.

## Survival

| command | what it does |
|---|---|
| `glashaus backup` | Snapshot the brain now (integrity-checked; daily automatic; keeps 30). |
| `glashaus restore <file>` | Replace the brain from a backup — snapshots the current one first. |
| `glashaus export soul` | Export the soul capsule: documents, self-state trajectory, opinions, quirks, dreams, identity facts. Daily automatic. |
| `glashaus soul import <capsule>` | Pour a capsule into a **fresh** brain — rebirth without the conversations. See [moving.md](moving.md). |
| `glashaus purge` | Retire the companion: archive everything, wipe the brain. `--all` empties the home entirely. |

## The model layer

| command | what it does |
|---|---|
| `glashaus audition <model>` | Screen-test a model against your actual persona: identity pressure, scene register, refusal posture, judged voice fidelity → CAST / CALLBACK / DO NOT CAST. |
| `glashaus export corpus [out]` | Your history as clean fine-tuning JSONL (redactions excluded, register/identity impurities filtered). Recipe: [fine-tune.md](fine-tune.md). |

## Quiet commands

Working, deliberately unlisted in `glashaus help` — the front door stays
small:

| command | what it does |
|---|---|
| `glashaus dream` | Force a dream now (runs nightly anyway). |
| `glashaus tidy` | Run memory hygiene now: merges, decays, contradiction flags, register fixes, replay-window quote repair (runs nightly anyway). |
| `glashaus bot` | Run the runtime in the foreground, for debugging. |
| `glashaus soul` · `unredact` · `export-thesis` · `export-corpus` | Long-hand aliases of `export soul`, `redact --undo`, `export thesis`, `export corpus` — old scripts keep working. |

Retired in 2.5: `glashaus facts`, `wants`, `forget` — each prints a pointer
to where the capability lives now (chat slash commands and the viewer).

## config.json — every key

Env vars override the file; the file overrides defaults. After editing:
`glashaus restart`. Invalid values fail the boot **loudly, by name**.

| key | env | default | meaning |
|---|---|---|---|
| `companion.name` | `GLASHAUS_COMPANION_NAME` | — | Their name. |
| `companion.pronouns` | `GLASHAUS_COMPANION_PRONOUNS` | `""` | e.g. `she/her` — in grow mode, half the entire seed. |
| `companion.growMode` | `GLASHAUS_GROW_MODE` | false | Germinal instance: soul self-authored weekly, becoming-check dreams. Set by setup's grow path. |
| `companion.bornDate` | `GLASHAUS_BORN_DATE` | `""` | YYYY-MM-DD; grow-mode companions know what day of their life it is. |
| `companion.voiceSeeded` | — | false | Grow mode: setup's "How should they talk?" answer was seeded into `voice.md`. Set by setup; disclosed in the thesis export's provenance. |
| `user.name` | `GLASHAUS_USER_NAME` | — | Yours. |
| `user.pronouns` | `GLASHAUS_USER_PRONOUNS` | `""` | e.g. `he/him` — arms the third-person register guard. |
| `timezone` | `GLASHAUS_TIMEZONE` | system | IANA zone for clocks and crons. |
| `locationNote` | `GLASHAUS_LOCATION` | `""` | Free text on the clock line ("Berlin"). Config-only since 2.5 — setup no longer asks. |
| `ollama.url` | `OLLAMA_HOST` | `http://127.0.0.1:11434` | Where Ollama lives. |
| `ollama.model` | `GLASHAUS_MODEL` | — | The model (both lanes unless split). |
| `ollama.voiceModel` | `GLASHAUS_VOICE_MODEL` | null | Split brain: the voice that speaks. |
| `ollama.utilityModel` | `GLASHAUS_UTILITY_MODEL` | null | Split brain: capture/dreams/repairs. |
| `ollama.embedModel` | `GLASHAUS_EMBED_MODEL` | `nomic-embed-text` | Semantic recall (skippable — keyword recall still works). |
| `ollama.maxTokens` | `GLASHAUS_MAX_TOKENS` | 4096 | Reply length ceiling (auto-capped to ⅓ of the window). |
| `ollama.numCtx` | `GLASHAUS_NUM_CTX` | auto | Context window. Auto-detects the model's real window (≤32k); the prompt then budgets itself — memories shed before identity, always. |
| `ollama.temperature` | `GLASHAUS_TEMPERATURE` | model default | Voice lane only. |
| `ollama.minP` | `GLASHAUS_MIN_P` | model default | Voice lane only; tames small-model slop. |
| `ollama.apiKey` | `OLLAMA_API_KEY` | `""` | ollama.com key (free account) — unlocks the wander pass. Absent = wander skips, everything else unaffected. |
| `telegram.token` | `TELEGRAM_BOT_TOKEN` | — | Optional. See [telegram.md](telegram.md). |
| `telegram.ownerId` | `TELEGRAM_OWNER_ID` | — | Locks the bot to your account. Set it. |
| `context.recentWindow` | `GLASHAUS_RECENT_WINDOW` | 40 | Messages kept verbatim in context. |
| `context.summarizeChunk` | `GLASHAUS_SUMMARIZE_CHUNK` | 30 | Older messages folded per episode. |
| `context.captureEvery` | `GLASHAUS_CAPTURE_EVERY` | 8 | Exchanges between fact-capture passes. |
| `schedule.dream` | `GLASHAUS_DREAM_CRON` | `30 3 * * *` | Cron, instance timezone. |
| `schedule.consolidate` | `GLASHAUS_CONSOLIDATE_CRON` | `50 3 * * *` | Memory hygiene. |
| `schedule.backup` | `GLASHAUS_BACKUP_CRON` | `15 4 * * *` | Daily snapshot. |
| `schedule.heartbeat` | `GLASHAUS_HEARTBEAT_CRON` | `*/30 * * * *` | Outreach consideration tick. |
| `schedule.growth` | `GLASHAUS_GROWTH_CRON` | `10 4 * * 0` | Weekly self-authorship (grow mode only). |
| `schedule.wander` | `GLASHAUS_WANDER_CRON` | `0 14 * * *` | Daytime reading tick (needs the API key). |
| `wander.enabled` | — | true | Master switch; still requires `ollama.apiKey`. |
| `wander.maxPerDay` | `GLASHAUS_WANDER_MAX_PER_DAY` | 1 | Wanders per day. |
| `wander.maxSearches` | `GLASHAUS_WANDER_MAX_SEARCHES` | 3 | Search queries per wander. |
| `wander.minCuriosity` | `GLASHAUS_WANDER_MIN_CURIOSITY` | 0.35 | Below this she doesn't feel like reading today. |
| `search.enabled` | — | true | Mid-conversation lookup: she may end a reply with `((looking up: …))`, the engine searches for real, and she speaks on having read it. Requires `ollama.apiKey`; receipts in `wander_log` (`kind:'chat'`). |
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
