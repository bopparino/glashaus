"""Storage layer for GlasHaus.

The whole state of the world lives in a single SQLite file at
`~/.glashaus/state.db` (configurable). The plan §11 documents the
rationale: portability, trivial backup, no daemon dependency, fast on
local hardware.

This module owns:

- The connection factory ([`connect`][glashaus.storage.db.connect]) that
  loads sqlite-vec and applies sane PRAGMAs.
- The migration runner ([`MigrationRunner`][glashaus.storage.runner.MigrationRunner]),
  which is forward-only, snapshot-protected, and idempotent.
- The migration SQL files themselves, under `migrations/`.

The schema is the contract; the schema-snapshot test guards it.
"""

from glashaus.storage.db import connect, open_state_db
from glashaus.storage.runner import MIGRATIONS_DIR, MigrationRunner, dump_schema

__all__ = [
    "MIGRATIONS_DIR",
    "MigrationRunner",
    "connect",
    "dump_schema",
    "open_state_db",
]
