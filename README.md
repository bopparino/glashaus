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

**Pre-alpha — Phase 1 (memory + self-state backbone) complete.** The full
architecture, motivation, and thesis frame live in
[`GLASHAUS_PLAN.md`](GLASHAUS_PLAN.md).

What's wired right now:

- Python 3.12 project, `uv`-managed.
- Runtime deps: `structlog`, `sqlite-vec`, `ollama`, `openai`.
- Pre-commit hooks: ruff format, ruff lint, mypy strict, fast pytest on
  every commit; full pytest on every push. Local `uv run mypy` hook so
  test-only commits resolve `glashaus.*` imports.
- GitHub Actions CI runs the same checks plus a real schema-snapshot
  gate (any uncommitted schema drift fails CI).
- Structured logging via `structlog`. JSON sink + dev console.
- Daily `~/.glashaus/state.db` snapshots via launchd, with retention,
  integrity check, and a pre-migration snapshot hook.
- Dual remote: GitHub canonical + Codeberg mirror.

**Phase 1 architecture, by layer:**

- [`storage/`](src/glashaus/storage/) — SQLite + sqlite-vec, forward-only
  migration runner with snapshot-protected rollback. Two migrations:
  `001_initial.sql` (episodic + semantic + self_state schemas with FTS5
  + vec0[1536]); `002_self_state_events.sql` (append-only numeric
  trajectory log for thesis evaluation).
- [`memory/`](src/glashaus/memory/) — episodic + semantic stores. Pure
  CRUD; salience is input. LEFT JOIN convention on `*_vec` reads so
  records without embeddings still surface.
- [`self_state/`](src/glashaus/self_state/) — store + dynamics
  (bounded EWMA with floors/ceilings per §4.2) + consistency check
  (ready for Phase 2 dream cycle). Numeric updates log to
  `self_state_events`.
- [`providers/`](src/glashaus/providers/) — split `ChatProvider` and
  `EmbeddingProvider` protocols. Ollama chat (Kimi K2.6 via cloud-
  routed local daemon by default), OpenAI embeddings (text-embedding-
  3-small at 1536d to match vec0). `SystemBlock` with
  `cache_breakpoint_ttl_seconds` preserved for Phase 4 Anthropic
  caching. `structured_complete_with_retry` retries once on tool-call
  parse failure with a stricter nudge.
- [`retrieval/`](src/glashaus/retrieval/) — hybrid retriever:
  vec + FTS5 + temporal + affective + salience + thread, weighted sum
  composite, character-budget truncation. Vec branch falls back to 0
  when no query embedding.
- [`turn/`](src/glashaus/turn/) — orchestrator. Streams text via
  callback, processes `record_turn` + `update_self_state` tool calls
  post-stream. `record_turn` is terminal-failure on parse;
  `update_self_state` is defer-on-failure (turn completes, episodic
  stands). 12-position system-block assembly with cache breakpoints
  at positions 2 / 3 / 6 (ttl=3600).
- [`cli/`](src/glashaus/cli/) — `glashaus chat` (streaming + auto-
  wizard on first run), `glashaus self`, `glashaus memory search`,
  `glashaus memory inspect`.

**Test surface:** 270 tests covering every layer above (storage,
memory, self-state, providers, retrieval, turn loop, CLI).

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
uv run pytest                       # full test suite (~270 tests)
uv run ruff format . && uv run ruff check . --fix
uv run mypy
uv run glashaus --version           # confirms the entry point
uv run glashaus chat                # first run prompts the wizard
uv run glashaus self                # current self-state
uv run glashaus memory search "thesis"
```

Required environment for chat:

- `ollama` running locally and signed in (`ollama signin`), OR
  `OLLAMA_API_KEY` set for direct cloud API access.
- `OPENAI_API_KEY` is optional. When set, embeddings populate
  `episodic_vec` on write and the retriever's vector branch becomes
  active. When unset, retrieval falls back to FTS5 + temporal +
  affective + salience — still useful, just no semantic-distance.

## Roadmap (from plan §13)

| Phase | What | Status |
| --- | --- | --- |
| 0 | Code hygiene foundation: git, CI, backups, observability skeleton. | **Done.** |
| 1 | Backbone: episodic + semantic + self-state schemas, SQLite + sqlite-vec storage, salience-on-write, CLI chat, sync self-state updates. | **Done.** |
| 2 | Dream cycle: episodic→semantic consolidation, self-reflection, candidate-ping pool, identity-consistency check. | Not started. |
| 3 | Proactive engine: scheduler, ping selection, mood-conditioned timing, silence-as-behavior. | Not started. |
| 4 | Multi-provider: Anthropic + OpenAI + Gemini + Ollama, SystemBlock caching, auto compaction. | Not started. |
| 5 | Multi-channel: Telegram → Discord → Slack → WhatsApp. Unified persona. | Not started. |
| 6 | CLI polish: theming, banner variants, font config, setup wizard refinement. | Not started. |
| 7 | Thesis evaluation: diary study, quant pipeline, baselines, defense prep. | Not started. |

## License

UNLICENSED — thesis project. License will be chosen at or before public
release.
