"""GlasHaus CLI.

Entry point:

    pyproject.toml: glashaus = "glashaus.cli:main"

Subcommands wired in [`main.py`][glashaus.cli.main]:

- `glashaus chat`     — streaming chat session
- `glashaus self`     — print current self-state
- `glashaus memory`   — `search <query>` / `inspect <id>`
- `glashaus init`     — first-run wizard (auto-invoked by `chat` if
                        state DB is uninitialized)
- `glashaus version`  — version string

Phase 1 scope deliberately stays minimal:
- No theming / typography polish (Phase 6).
- No interactive API-key entry (env vars only).
- No multi-channel support (Phase 5).
"""

from glashaus.cli.main import main

__all__ = ["main"]
