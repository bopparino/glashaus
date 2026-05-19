"""Transaction context manager.

The connection factory in `db.py` runs in autocommit mode
(`isolation_level=None`) so the migration runner can use `executescript`
without Python's implicit transactions getting in the way (see the
comment in `runner._apply_one`). The downside is that every other
write-path needs to wrap its statements explicitly — `with conn:` is a
no-op in autocommit mode.

`transaction(conn)` is that wrapper. It opens with `BEGIN IMMEDIATE`
(reserves the write lock up front, avoiding "SQLITE_BUSY on COMMIT"
surprises) and commits on success, rolls back on any exception.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[None]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
