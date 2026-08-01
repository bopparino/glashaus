# Changelog

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
