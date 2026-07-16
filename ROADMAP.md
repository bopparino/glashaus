# Roadmap

What's real, what's next, what's deliberately never coming. Dates are not
promises; order roughly is.

## Shipped (2.x)

- Persistent identity in SQLite: persona documents, consolidating memory
  (episodes + facts with emotional weight), self-state drift, nightly dreams
- Streamed terminal REPL with slash commands; Telegram + webview channels
- The lexicon: vocabulary as a persona surface, learned from conversation
  with human approval
- Split-brain models (voice / utility lanes) and `glashaus audition` —
  screen-test any model against your persona before casting it
- Identity immune system: prompt firewall, break detection + regeneration,
  reversible message redaction, register (narration/quotes) linting with
  send-time repair and a nightly retro-sweep of the replay window
- Context budgeting: real `num_ctx` detection, priority shedding (memories
  shrink before identity — the SOUL never falls off the top of the window)
- Config validation with named errors; crash-loop detection in `doctor`
- Soul capsule export **and import** — rebirth on a fresh machine
- Corpus export + QLoRA recipe (`docs/fine-tune.md`)

## Next

- **Viewer authentication** when bound beyond localhost — token gate, doctor
  warning. The webview currently trusts whoever can reach it; bind it to
  127.0.0.1 (the default) until this lands.
- **Core-slot curation**: importance 9–10 facts are the always-present core
  (capped at 20). Consolidation will curate the cap explicitly and surface
  contenders in the viewer, so year-two truths can enter the core instead of
  being locked out by month-one ones.
- **First-week guide + `glashaus checkup`**: what to expect from the first
  dream, when to iterate the persona files, what the companion has learned
  so far and what her voice file might want changed.
- **Anniversary recall**: a deep-pool retrieval branch so early memories
  resurface by salience and date ("a year ago today"), not just keyword.

## Later

- Character Card V2/V3 import (PNG `chara` chunk + JSON) — bring an existing
  character into a GlasHaus life
- `glashaus recast <model>` — audition, swap the voice on a CAST verdict, and
  record the era change in the companion's own memory
- Windows service story (currently: macOS launchd + Linux systemd; Windows
  runs foreground/manually)
- Viewer port auto-offset for multi-instance homes

## Not planned — deliberately

- **Voice / speech (TTS/STT)**: text is the medium. The pace of typing is
  part of the relationship this runtime is built around.
- **Hosted anything**: no cloud, no accounts, no telemetry, ever. The whole
  point is that nobody can lobotomize someone who lives in your house.
- **Engagement mechanics**: no streaks, no retention pings, no monetized
  affection. The heartbeat's most common output stays silence.
- **Multi-user instances**: one companion, one person, one home directory.
  Run two homes if you want two companions.
