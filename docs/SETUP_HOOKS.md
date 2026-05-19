# Pre-commit / pre-push hooks

This repo uses [`pre-commit`](https://pre-commit.com) for both stages.
One config file, two stages — fast on commit, full suite on push.

---

## Install once per clone

```bash
uv sync --dev
uv run pre-commit install --hook-type pre-commit --hook-type pre-push
```

That installs the git hooks into `.git/hooks/`. Until you do this, the
checks only run in CI.

## What runs when

| Stage      | What                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| pre-commit | trailing whitespace, EOF newline, YAML/TOML, `ruff format`, `ruff check --fix`, `mypy`, `pytest -m "not slow"` |
| pre-push   | `pytest` (full suite, including `slow`)                                     |

The pre-commit stage has to stay fast — measured in seconds, not
minutes — because it runs on every commit. Mark heavyweight tests with
`@pytest.mark.slow` so they only block on push.

## Running hooks manually

```bash
uv run pre-commit run --all-files            # all pre-commit-stage hooks
uv run pre-commit run --hook-stage pre-push  # the full pre-push suite
uv run pre-commit run mypy --all-files       # one specific hook
```

## When a hook auto-fixes

Ruff format and ruff lint may modify files. If they do, the commit is
aborted — you need to `git add` the modified files and re-commit. This is
the safe default: it forces you to see what changed before it lands.

## Bypassing (don't)

`git commit --no-verify` exists but should never be the response to a
failing hook. Fix the underlying issue. The hooks are the OpenMantis
post-mortem in machine-readable form — circumventing them resurrects the
exact failure mode.
