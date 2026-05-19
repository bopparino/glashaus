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

---

## Status

**Pre-alpha — Phase 0 (code hygiene foundation).** No features yet, by
design. The full architecture, motivation, and thesis frame live in
[`GLASHAUS_PLAN.md`](GLASHAUS_PLAN.md). Phase 0 exists because the
predecessor project (OpenMantis) was lost to silent repository corruption,
and feature work doesn't start until the safety net is real.

What's wired right now:

- Python 3.12 project, `uv`-managed, zero runtime dependencies beyond
  `structlog`.
- Pre-commit hooks: ruff format, ruff lint, mypy strict, fast pytest on
  every commit; full pytest on every push.
- GitHub Actions CI runs the same checks plus a placeholder schema-
  snapshot job that becomes a real gate in Phase 1.
- Structured logging skeleton (`structlog`, JSON sink + dev console).
  Audit-trail wiring lands as features land.
- Daily `~/.glashaus/state.db` snapshots via launchd, with retention,
  integrity check, and a pre-migration snapshot hook for Phase 1.
- Dual remote: GitHub canonical + Codeberg mirror.

## Setup (for the maintainer)

In order. Each step has its own doc.

1. [`docs/SETUP_SIGNING.md`](docs/SETUP_SIGNING.md) — SSH (or GPG)
   signing on every commit.
2. [`docs/SETUP_MIRROR.md`](docs/SETUP_MIRROR.md) — dual-push remote so
   every push lands on Codeberg too.
3. [`docs/SETUP_HOOKS.md`](docs/SETUP_HOOKS.md) — install the pre-commit
   and pre-push git hooks.
4. [`docs/SETUP_BRANCH_PROTECTION.md`](docs/SETUP_BRANCH_PROTECTION.md) —
   GitHub-side enforcement: signed commits, required checks, no direct
   push to `main`.
5. [`docs/SETUP_BACKUPS.md`](docs/SETUP_BACKUPS.md) — launchd job for
   daily state DB snapshots.

After step 1, `git commit` will start signing. After step 3, hooks block
bad commits locally. After step 4, GitHub blocks bad merges to `main`.
After step 5, the local DB has a daily snapshot floor.

## Working in the repo

```bash
uv sync --dev                       # create / refresh the venv
uv run pytest                       # full test suite
uv run ruff format . && uv run ruff check . --fix
uv run mypy
uv run glashaus --version           # confirms the entry point
```

## Roadmap (from plan §13)

| Phase | What | Status |
| --- | --- | --- |
| 0 | Code hygiene foundation: git, CI, backups, observability skeleton. | **In progress.** |
| 1 | Backbone: episodic + semantic + self-state schemas, SQLite + sqlite-vec storage, salience-on-write, CLI chat, sync self-state updates. | Not started. |
| 2 | Dream cycle: episodic→semantic consolidation, self-reflection, candidate-ping pool, identity-consistency check. | Not started. |
| 3 | Proactive engine: scheduler, ping selection, mood-conditioned timing, silence-as-behavior. | Not started. |
| 4 | Multi-provider: Anthropic + OpenAI + Gemini + Ollama, SystemBlock caching, auto compaction. | Not started. |
| 5 | Multi-channel: Telegram → Discord → Slack → WhatsApp. Unified persona. | Not started. |
| 6 | CLI polish: theming, banner variants, font config, setup wizard refinement. | Not started. |
| 7 | Thesis evaluation: diary study, quant pipeline, baselines, defense prep. | Not started. |

## License

UNLICENSED — thesis project. License will be chosen at or before public
release.
