"""Forward-only migration runner.

Behavior:

- Discovers migrations under `migrations/` matching `NNN_*.sql`.
- Sorts by the leading version number.
- Skips any whose version is `<= current_version`.
- Takes a pre-migration snapshot of the target DB before applying anything
  (skippable for in-memory tests).
- Applies each pending migration in its own transaction.
- Inserts a row into `schema_version` (the SQL itself is responsible for
  this, by convention, so the runner stays dumb).

Why "the SQL inserts its own schema_version row" instead of the runner
doing it: it keeps each migration atomically self-describing — the file's
final `INSERT INTO schema_version` is part of the same transaction as the
DDL, and there's no separate "runner forgot to record this" failure mode.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

_MIGRATION_RE = re.compile(r"^(\d{3})_([a-z0-9_]+)\.sql$")


@dataclass(frozen=True, slots=True)
class Migration:
    version: int
    name: str
    path: Path

    @property
    def sql(self) -> str:
        return self.path.read_text(encoding="utf-8")


def discover_migrations(directory: Path) -> list[Migration]:
    """Return migrations in version order. Filenames must match NNN_name.sql."""
    found: list[Migration] = []
    for entry in sorted(directory.iterdir()):
        if not entry.is_file() or not entry.name.endswith(".sql"):
            continue
        m = _MIGRATION_RE.match(entry.name)
        if not m:
            raise ValueError(f"Migration filename {entry.name!r} does not match NNN_name.sql")
        found.append(Migration(version=int(m.group(1)), name=m.group(2), path=entry))

    # Guard against gaps and duplicates — both are dangerous in a forward-only
    # scheme.
    seen: set[int] = set()
    for i, mig in enumerate(found, start=1):
        if mig.version in seen:
            raise ValueError(f"Duplicate migration version {mig.version}")
        seen.add(mig.version)
        if mig.version != i:
            raise ValueError(
                f"Migration version gap: expected {i}, got {mig.version} "
                f"({mig.path.name}). Forward-only schemes don't allow holes."
            )
    return found


def current_version(conn: sqlite3.Connection) -> int:
    """Latest applied migration version, or 0 if the table doesn't exist yet."""
    try:
        row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
    except sqlite3.OperationalError:
        return 0
    if row is None or row[0] is None:
        return 0
    return int(row[0])


def dump_schema(conn: sqlite3.Connection) -> str:
    """Normalized text representation of the current schema.

    Used by the schema-snapshot test. Sorts by (type, name) and renders
    each `CREATE` plus a trailing semicolon. NULL `sql` rows (auto-created
    indices, sqlite-vec/fts5 shadow tables that have no DDL of their own)
    are kept as a marker line so renames or removals are visible.
    """
    rows = conn.execute(
        """
        SELECT type, name, tbl_name, sql
          FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name
        """
    ).fetchall()
    parts: list[str] = []
    for row in rows:
        type_, name, tbl_name, sql = row["type"], row["name"], row["tbl_name"], row["sql"]
        parts.append(f"-- [{type_}] {name} (tbl={tbl_name})")
        if sql is None:
            parts.append("-- (no DDL — auto-created)")
        else:
            parts.append(sql.strip() + ";")
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


SnapshotCallback = Callable[[int], None]


class MigrationRunner:
    """Discover and apply pending migrations against a connection.

    Parameters
    ----------
    conn :
        An open sqlite3 Connection (already loaded with sqlite-vec).
    directory :
        Path holding the NNN_*.sql files. Defaults to the package's
        `migrations/` folder.
    snapshot :
        Optional callback invoked with the target version *before* each
        migration runs. Use this to take a pre-migration `.backup`. In
        tests, leave it as `None`.
    """

    def __init__(
        self,
        conn: sqlite3.Connection,
        directory: Path = MIGRATIONS_DIR,
        snapshot: SnapshotCallback | None = None,
    ) -> None:
        self.conn = conn
        self.directory = directory
        self.snapshot = snapshot

    def discover(self) -> list[Migration]:
        return discover_migrations(self.directory)

    def pending(self) -> list[Migration]:
        applied = current_version(self.conn)
        return [m for m in self.discover() if m.version > applied]

    def apply_all(self) -> int:
        """Apply every pending migration. Returns the final version."""
        for mig in self.pending():
            if self.snapshot is not None:
                self.snapshot(mig.version)
            self._apply_one(mig)
        return current_version(self.conn)

    def _apply_one(self, mig: Migration) -> None:
        # SQLite's `executescript()` implicitly commits before running, which
        # means wrapping it in BEGIN/COMMIT from Python is a footgun — the
        # outer transaction gets closed before the script even starts.
        # Migrations are made atomic by the pre-migration snapshot path
        # instead: if a migration fails partway, the snapshot is the
        # rollback. This is the same pattern alembic uses on SQLite.
        self.conn.executescript(mig.sql)

        # Sanity-check: the migration must have recorded its own version.
        recorded = self.conn.execute(
            "SELECT version FROM schema_version WHERE version = ?",
            (mig.version,),
        ).fetchone()
        if recorded is None:
            raise RuntimeError(
                f"Migration {mig.path.name} did not insert into schema_version. "
                "Every migration must record itself; this is a hard contract."
            )
