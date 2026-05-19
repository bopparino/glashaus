"""SQLite connection factory.

Every code path that opens the state DB goes through here so that the
sqlite-vec extension is loaded, PRAGMAs are consistent, and row access is
keyed (sqlite3.Row factory).
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import sqlite_vec


def default_state_dir() -> Path:
    """Where ~/.glashaus/ lives. `$GLASHAUS_STATE_DIR` overrides for tests."""
    override = os.environ.get("GLASHAUS_STATE_DIR")
    return Path(override) if override else Path.home() / ".glashaus"


def default_state_db_path() -> Path:
    return default_state_dir() / "state.db"


def connect(path: str | Path) -> sqlite3.Connection:
    """Open a connection with sqlite-vec loaded and the plan-required PRAGMAs.

    `:memory:` is supported for tests.
    """
    conn = sqlite3.connect(str(path), isolation_level=None)  # autocommit; we manage txns
    conn.row_factory = sqlite3.Row

    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)

    # WAL gives us readers-don't-block-writer semantics — important once the
    # daemon and CLI run side-by-side in Phase 3+. `synchronous=NORMAL` is the
    # recommended WAL pairing; safe across power loss given WAL, slightly
    # faster than FULL.
    if str(path) != ":memory:":
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")

    return conn


def open_state_db(path: str | Path | None = None) -> sqlite3.Connection:
    """Open the state DB at the configured path, creating the parent dir."""
    db_path = Path(path) if path is not None else default_state_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return connect(db_path)
