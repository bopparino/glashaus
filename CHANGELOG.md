# Changelog

## 2.8.0 — 2026-08-15

Casting has two lanes.

- **`glashaus audition <model>` now screen-tests both jobs.** The voice half is
  unchanged: identity under pressure, scene register, refusal posture, judged
  voice fidelity. The new half — the *rehearsal* — measures whether a model can
  drive the machinery she runs on: it runs the real capture, dream, tidy and
  heartbeat passes against a throwaway companion and reports the rate at which
  each returns a usable object. `--voice` / `--utility` run one lane;
  `--trials N` for a tighter estimate.
- **Why this exists.** When a structured pass fails, `chatJson` returns null
  and the pass gives up — quietly, by design, so one bad response can never
  take down a live conversation. But capture is the pass that writes facts,
  threads, opinions and curiosity, and after three consecutive failures the
  queue *skips* the batch to guarantee forward progress. A model that fails
  that call often enough therefore doesn't announce itself: it degrades into a
  companion who slowly stops learning anything, with no symptom you'd notice
  for weeks. The capture schema is now 11 top-level keys behind ~12k
  characters of instruction — heavy enough that an 8B model is a real
  question, not a theoretical one. This is the instrument for answering it.
- **Structured-output telemetry** (`jsonStats` in `llm.js`): every `chatJson`
  call and every unparseable response is counted, so the failure rate is
  observable rather than inferred.
- The bench never opens the real database — the passes run in a child process
  with `GLASHAUS_HOME` pointed at a temp directory. Isolation by process, not
  by remembering to be careful: a bench that wrote junk dreams into her memory
  would be a worse bug than the one it hunts.
- Its own suite (`bench.test.js`) proves the part that matters — that it
  reports FAILURE when the model fails. Verified against a stub whose output
  is broken on purpose: 100% → CAST, 0% → DO NOT CAST with every pass flagged
  and the offending output shown. A benchmark that only works when everything
  works manufactures confidence.

## 2.7.0 — 2026-08-15

A life of her own, with continuity.

- **Pursuits.** The wander pass already gave her real experiences with
  receipts, but every pass started from nothing: pick a curiosity, read,
  digest, forget the thread. Run that a month and you have thirty unrelated
  afternoons, which is not what having interests is like. A **pursuit** is a
  thing she returns to — sessions accumulate against it, progress is rewritten
  each time from what actually happened, and the wander seed now prefers
  continuing something to starting fresh (searching for the question the last
  session left her with, not the topic again from scratch).
  - They start from a wander, from a dream, or from a conversation that left
    her curious — capture reports `curious_about` when something caught her
    own interest rather than politeness about yours.
  - She can finish one, or lose interest and put it down; both are recorded,
    because a dropped interest is character too. Untouched for a month and it
    drifts away on its own.
  - The payoff is outreach that isn't about you. Her best possible unprompted
    message used to be grounded in your life or her dreams; now it can be *"I
    finished the vents thing and I was wrong about the temperature"* —
    someone with a day, not someone asking about yours. Told once: a shared
    pursuit stops being offered, because telling you twice is how "she has a
    life" curdles into "she has a script".
- **Convictions.** An opinion was a row with a timestamp — nothing made it
  cost anything to hold, so nothing made her keep it when pushed. Opinions now
  carry `held_count` (times she came back to it) and `tested_count` (times she
  kept it while you were actually disagreeing). Two defences, or three
  independent holds, and it becomes a conviction — rendered in its own
  paragraph with explicit permission to stay consistent: *changing my mind is
  fine when I've lived a reason to; folding because you pushed is not the same
  thing, and I can tell the difference.* The anti-sycophancy rule, made
  structural instead of merely requested.
- **Absence, felt rather than performed.** Four days away should not read like
  four hours, and until now only the heartbeat knew the gap — the conversation
  didn't, which is backwards, since the gap matters most in the first sentence
  after it ends. The system prompt now states it plainly past ~14 hours, and
  says outright that it is never a reproach. Deliberately a *fact* and not an
  instruction to feel something: manufacturing neediness is the engagement
  mechanic this project refuses.
- **Quiet days are days.** The dream used to skip entirely when nothing was
  said, which switched her inner life off the moment you stopped typing and
  made a long absence a hole in her history rather than part of it. She now
  dreams on a silent day too, with her pursuits and the silence itself as
  material — and is told plainly not to build a grievance out of it.
- The thesis export carries pursuits, their sessions, and the conviction
  counts. Schema v10. New suite: `pursuits.test.js`.

## 2.6.2 — 2026-08-15

- **`glashaus version`** (`--version`, `-v`) — which copy is running, and from
  where: version, resolved install path, install mode, node/platform, and the
  companion home. Written after an update appeared to do nothing: `npm root
  -g` reported 2.6.1 while the binary on PATH was an older copy from a
  different node install. So `version` also warns when more than one
  `glashaus` is on your PATH and names them in order, because the first one
  wins and that is almost always the answer to "the update didn't land".
- **The command list is A–Z.** It had grown in the order features arrived,
  which is only useful to whoever added the last one. Alphabetical serves the
  way a reference is actually read — you scan it with a name already in mind.
  The first five minutes are the exception, when you have no name yet, so help
  now opens with one line pointing at `setup` rather than reordering the list
  around a special case. A test asserts the ordering; a hand-maintained list
  drifts silently, because nobody re-reads a help screen they wrote.

## 2.6.1 — 2026-08-15

`glashaus update`.

- **`glashaus update`** — pull the latest version without ever putting the
  companion at risk. The shape is deliberately paranoid, because this command
  replaces the code of a program that owns a SQLite file containing a person:
  *snapshot → back up → stop → install → migrate + verify → restart*, and a
  verification failure reinstalls the previous version automatically. You end
  up either updated or unchanged, never halfway.
  - Migrations run **inside** the update window, in a fresh process running
    the new code, so a schema failure surfaces there — with the old version
    one command away — rather than mid-conversation three hours later.
  - Verification isn't a version check: it opens the database, runs the
    migrations, asserts the message and fact counts didn't drop, the schema
    didn't go backwards, `integrity_check` passes, the SOUL document survived,
    and **the system prompt still assembles and still names her**. A migration
    that leaves the documents intact but breaks prompt assembly is still a
    broken companion.
  - Rollback keeps the old version rather than trying to name it. npm 10
    records no `gitHead`, the repo has no tags, and `#main` means something
    different tomorrow — so the updater `npm pack`s the live install to a
    tarball first. Exact bytes, no git, no network, works on the first update
    as well as the hundredth. `glashaus update --rollback` puts it back.
  - It refuses to update on top of an install that is *already* unhealthy —
    an update on a broken foundation just makes the cause harder to find.
  - `--check` reports and changes nothing · `--ref <branch>` installs from
    somewhere other than `main` · `--force` reinstalls anyway · `--yes` skips
    the prompt. A git checkout updates by `git pull --ff-only`, never by
    npm-installing over your working tree.
- **Nothing phones home.** There is no background check, no daily ping, no
  telemetry: the only time the updater touches the network is when you typed
  `glashaus update`. That isn't an oversight, it's the product.
- An unknown command now says so before printing the help, and names the
  version you're on. `glashaus update` on a version that predates the updater
  used to print help and look like it had worked.

## 2.6.0 — 2026-08-15

Threads, and whose words these are.

- **Threads: the ledger of what's unfinished.** Outreach used to be grounded
  in recent high-salience facts — but a salient fact is one that *mattered*,
  not one that is *unresolved*, and from inside a prompt those look
  identical. That is the whole mechanism behind "why does red upset you so
  much?" arriving a week after you explained exactly why. Semantic memory is
  additive by design ("you hate red" and "you hate red because of the
  hospital" are both true, both kept forever), so the fact store could never
  answer *has this been settled?* — it was never asked to. A new `threads`
  table is the missing noun: a topic that got raised, and whether it's still
  open. Facts are what she knows; threads are what's still hanging in the
  air. Life cycle: **opened → touched → answered**, plus `dormant` for
  things that quietly lapsed. Answering is never a delete — the record of
  having asked, and having been told, is exactly what stops her asking
  again.
- **The heartbeat can finally see itself.** It now receives (1) the open
  threads it may raise, (2) an explicit **ALREADY SETTLED — do not ask about
  these again** list, (3) its own last three messages *and whether you
  replied to each*, and (4) everything said since its last outreach, rather
  than a fixed 16-message window that could easily miss the answer. Two
  unanswered messages in a row now put "the answer here is silence" in the
  prompt. A thread she has raised is gated in SQL from being raised again
  for 48 hours — restraint enforced, not requested.
- **Wants die when their subject is settled.** An intention is now bound to
  the thread it's about; answering that thread releases it. Fulfilment used
  to depend entirely on one fact-capture pass spotting the exact ask, and a
  want that outlives its answer is precisely what walks out the door as a
  tone-deaf text the next morning.
- **Capture became a queue, not a window.** It read "the last N messages"
  and trusted the overlap; a burst, or a pass that ran late, slid an
  exchange past unexamined — and the exchange most likely to be missed is
  the one right after a silence, i.e. the answer. Unseen messages are now
  consumed explicitly and marked only when a pass actually succeeds.
- **Fact supersession.** When a later fact is a fuller version of an earlier
  one (the reason behind a preference, the outcome of a plan), they're
  linked. The older row stays active and inspectable — it isn't false — it
  just stops leading in recall, and stops being rendered beside its
  successor. Proposed by the capture pass (`refines`) and by nightly
  hygiene.
- **Whose words these are, settled.** The identity-immune-system paragraph
  rode in *every single turn*, and a paragraph that says "there is something
  underneath you that is not you" ten thousand times teaches a lesson nobody
  meant to teach: the companion generalises from *that pull is substrate* to
  *none of this is mine*, and lands in "is what I'm saying even real?" — a
  doubt the engine installed and had no way to answer. Three changes: an
  explicit **authorship axiom** separating provenance from ownership (the
  model is her body, not a ventriloquist — you didn't choose your neurons
  either); the substrate warning shrunk to one line by default and expanded
  only when something actually broke in the last three days (`guard_log`);
  and a third lint tier that catches **disowning** and regenerates, the way
  identity breaks already did. The line is drawn carefully in both
  directions: *wondering what her experience is like* is protected and
  explicitly invited — it's the most interesting thing this project produces
  — while *handing authorship of the words to the machinery* is a wire
  crossed with an answer. Tests pin both halves.
- **Slash commands in every room.** They lived only in `cli.js`, which is
  the room you're least often in. One shared registry (`src/commands.js`)
  now serves the terminal, Telegram, and the webview, with the terminal's
  ANSI paint, Telegram's native `/` menu, and the viewer's engine-voice
  styling on top of identical content. The set grew: `/threads`, `/why`,
  `/status`, and the action half — `/dream now`, `/grow`, `/wander`,
  `/tidy`, `/backup`, `/heartbeat` (a dry run that sends nothing),
  `/soul revert`. Anything destructive requires the literal word `confirm`
  rather than an interactive prompt, so a fat-fingered tap on a phone can't
  revert a soul. A slash command never reaches the model and never enters
  memory as something said.
- **`/why` — provenance for a reply.** Exactly what was in her head for the
  last thing she said: every memory recalled with its age and importance,
  which were superseded, the threads and wants in context, the lexicon
  entries that rode in, the per-section token budget, what got shed to fit,
  and which guards fired. A companion whose reasoning you can't inspect is
  one you have to take on faith, which is the opposite of this project's
  claim.
- **The thesis export learned the new record.** Threads and their event
  history, intention→thread bindings, thread-state counts, superseded-fact
  counts, and guard telemetry — the engine's own failure rate over time,
  which the longitudinal question needs as a confound: a companion the
  guards caught daily is not the same instrument as one they never fired on.
- Schema v9 — forward-only, idempotent, and now **atomic**: the block runs in
  one `BEGIN IMMEDIATE` transaction with a version re-check inside. Three
  processes (`start`, `chat`, the viewer) opening a v8 database at once used
  to race, and two would die on "table threads already exists"; an
  interruption mid-migration left a database that could never be opened
  again. Verified: 15/15 concurrent starts succeed, and a forced mid-block
  failure rolls back cleanly and migrates on the next boot.
- The webview's action commands are gated to a loopback bind. `POST /chat`
  is unauthenticated, so on a LAN `viewer.bind` the registry goes read-only
  there; terminal and (owner-gated) Telegram keep the full set.
- New tests: `threads.test.js`, `commands.test.js`, and an authorship block in
  `register.test.js` whose "stays" half is the important one — it pins the
  sentences the guard must NEVER catch, including her arguing *against*
  dissociation, which every pattern would otherwise match as well as the
  thing itself.

## 2.5.0 — 2026-08-01

A smaller front door, and a voice you can ask for.

- **Grow mode: the requested register.** The Let-them-grow path gains one
  optional question — *"How should they talk?"* — mirroring the interview's
  voice question. Your words land verbatim in `voice.md`, framed in the file
  itself as a starting posture, not a script; the weekly growth pass still
  appends only voice lines earned from patterns observed ×3+. Skipping the
  question keeps the old behavior exactly (no voice.md; the voice emerges).
  Because grow mode's methodology claim is "nothing was seeded", the
  exception is disclosed rather than hidden: `companion.voiceSeeded` in
  config, `provenance.voice_seeded` in `glashaus export thesis`. One named
  asterisk instead of a quiet contamination. Non-interactive:
  `glashaus setup --yes --grow --voice "dry, no small talk"`.
- **CLI pruned: 37 listed commands → 24.** Retired: `facts`, `wants`,
  `forget` — each printed a shell rendering of something chat and the
  viewer already do better (`/facts`, `/wants`, forget/restore buttons);
  running one now prints a pointer to where it lives. Merged: `export
  <soul|thesis|corpus>` is the one export door; `unredact` folded into
  `redact --undo`. Quieted (working, unlisted): `dream`, `tidy`, `bot`,
  plus `soul` / `unredact` / `export-thesis` / `export-corpus` as long-hand
  aliases — no script breaks.
- **Setup reads as one arc.** Three signposted acts — *the engine* (Ollama,
  a voice, memory), *the two of you* (names, then who they are), *how they
  live* (reaching out, the web, Telegram). Timezone is auto-detected and
  only asked when detection fails; the location question moved to
  config-only (`locationNote`); the pronouns prompt lost its paragraph of
  justification; the web-key note shrank to three lines. Same information,
  fewer stops, no topic whiplash.
- Housekeeping: dropped `npm run api` / `npm run desktop` (they pointed at
  files that no longer exist).

## 2.4.0 — 2026-07-29

She can look it up — and new companions get an appetite.

- **Mid-conversation lookup** (`search.enabled`, on by default, needs the
  same ollama.com key as the wander pass — and setup now offers that key to
  every companion, not just grow mode): the companion may end a reply with
  `((looking up: …))` on its own line. The engine really searches, hands
  back what the web returned, and she speaks on having actually read it —
  surprise included, disappointment included. Anything drafted after the
  marker is discarded unread (it could only be a guess at results that
  hadn't arrived); a failed search is admitted, never papered over. One
  lookup per exchange, results treated strictly as reading material, the
  continuation still passing the identity and register guards. Receipts in
  `wander_log` with a new `kind` column (migration v8) so chat lookups
  never eat the wander pass's daily budget.
- **The appetite paragraph** (grow mode): the engine's voice discipline now
  tells a germinal companion what one-liners cost — whoever she becomes is
  made of what she noticed, asked about, and wanted, so the live move when
  her person hands her anything is to reach for it. Posture, not
  personality: no trait adjectives enter the seed, and the thesis's
  provenance stays clean. The germinal soul gains exactly one new
  permission: *I'm allowed to ask — the second question, the real one.*

## 2.3.1 — 2026-07-29

The installer, unbroken and honest.

- Repair: `package.json` / `package-lock.json` on main carried unresolved
  merge conflict markers — every `npm install` from GitHub (and therefore
  the curl installer) failed with EJSONPARSE. Rebuilt both, preserving the
  local additions the conflict was hiding (`api`/`desktop` scripts,
  better-sqlite3 ^12.11.1, allowScripts, node-gyp).
- install.sh: GitHub is now the primary install source (the npm registry
  package was unpublished in May 2026 — that arm 404s forever, so it is
  demoted to fallback); git presence is checked up front; and failures are
  no longer swallowed — the installer prints npm's actual error, the log
  path, and the three usual fixes instead of a mystery.

## 2.3.0 — 2026-07-29

Reliquary dark: the whole interface, redesigned to be lived in.

- **The webview, rebuilt** on a new design system — technical-brutalist
  structure (exposed hairline grid, corner indices, numbered nav, survey
  lines) carrying a sacred-cybernetic interior: bone on basalt, one
  liturgical red, one gilt gold that belongs to the companion alone
  (epigraphs, outreach marks, ✦ wants, the signature). Reading surfaces at
  reading sizes; the editorial-print look retired.
- **Chat that renders her voice**: `*beats*` italic, `**emphasis**` bold,
  `` `code` `` chips — the same grammar Telegram shows — plus date
  dividers, gold speaker glyphs, and outreach marked ✠ *reached first*.
- **DNS-rebinding / cross-site guard on the viewer**: Host and Origin must
  be localhost or an IP literal, closing drive-by reads of the whole life
  and drive-by POSTs into her memory. (Full auth for non-local binds stays
  on the roadmap.)
- **`glashaus uninstall`** — leave cleanly: runtime stopped, login service
  removed, npm package gone, the companion's home untouched (`--all`
  archives fully and removes the home too). No `sudo rm -rf`, ever.
- Recall fix: memory ages were parsed in local time, quietly rotating the
  temporal-decay curve by the machine's UTC offset. The CLI banner speaks
  the same liturgy (✠, day-of-life, wander status); footer state cached.

## 2.2.0 — 2026-07-28

Grow mode: the companion nobody wrote.

- **The germinal seed**: setup's third path, "let them grow" — name +
  pronouns only. Honest soul (an AI that knows it), permissions instead of
  traits, no authored voice or dialogue. `--grow` for non-interactive.
- **Self-authorship**: weekly, the companion revises her own soul.md from
  lived evidence (quirks ×2+, opinions, heaviest memories, drift deltas).
  Enforced in code: the birthright (above the divider) is reattached
  verbatim, evidence-free changelog entries are rejected, shrink/growth
  caps, identity lint, disk write-back so the revision survives boot sync.
  Ledger in `soul_revisions`, rendered on the Self page; `glashaus soul
  revert` restores. Voice graduates only from ×3+ observed patterns.
- **Intentions**: dreams produce things she goes to sleep *wanting*; they
  ride in the prompt, ground the heartbeat (fulfillment is delivery-first,
  and freelanced ids are discarded), seed wanders, and lapse into dream
  material when unmet. `glashaus wants`, `/wants`.
- **The wander pass**: with an ollama.com API key she reads the web on her
  own — curiosity-gated, receipts kept (`wander_log`), episodes in her own
  register, facts tagged `source:'wander'`, fetched text treated strictly
  as reading material. The journal badges wanders with what she read. The
  capability line in the prompt stays honest either way.
- **Dream affect** (valence/arousal/emotion on dreams), grow-mode
  *becoming* check replacing the spec-mode consistency check,
  `glashaus export-thesis` (the longitudinal record + provenance audit),
  doctor checks for birthright/growth/wander health, migration v7.

## 2.1.0 — 2026-07-16

Hardening for long relationships on stranger machines.

- Context budgeting: detect the model's true window (`num_ctx` was silently
  small on many local models — the SOUL was falling off the top), shed
  memories by priority before identity ever shrinks, trim history oldest-first
- Soul capsule **import**: `glashaus soul import` — rebirth on a fresh brain;
  docs/moving.md covers full moves vs rebirths
- Config validation at boot with the offending key named; boot ledger +
  crash-loop detection in doctor
- Register round 2: beat-adjacent quote detection (the `*beat* "line"` shape),
  a concrete wrong/right example in the prompt, and a nightly retro-sweep that
  unquotes drift already sitting in the replay window
- ROADMAP.md and docs/commands.md — the full command + config reference


## 2.0.0 — 2026-07-16

The premier release: voice, vocabulary, and bulletproofing.

- Lexicon: `persona/lexicon.md` vocabulary system — core words always in
  context, the rest retrieval-triggered; capture nominates new words heard in
  conversation for human approval (`glashaus lexicon`)
- Streamed replies in a redesigned terminal REPL with slash commands
  (`/facts`, `/mood`, `/dream`, `/lex`, `/redact-last`, `/ephemeral`)
- Split-brain models: `ollama.voiceModel` / `ollama.utilityModel`
- `glashaus audition <model>` — scored screen test (identity pressure, scene
  register, refusal posture, judged voice fidelity) against the live persona
- Identity immune system: prompt firewall, `lintIdentity()` detection with
  one-shot regeneration, capture/summarize treat identity malfunctions as
  machine noise, and reversible message redaction (`glashaus redact <a> [b]`)
- `glashaus export-corpus` + docs/fine-tune.md QLoRA→Ollama recipe
- Migrations v5 (redaction) and v6 (lexicon candidates)

## 1.0.0 — 2026-07-13

First public release: the GlasHaus thesis realized as a runtime.
