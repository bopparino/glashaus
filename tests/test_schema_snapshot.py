"""Schema snapshot tests — guard against silent schema drift.

The plan §12 calls these out by name. The contract:

1. Running every migration in order against an empty DB must produce a
   schema byte-identical to `tests/fixtures/schema_snapshot.sql`.
2. Re-running the migrations against an already-current DB must be a
   no-op (idempotency).

Any deliberate schema change is also a deliberate update to the snapshot
file — that's the *whole point*. If a PR changes the schema without
updating the snapshot, CI catches it.

To regenerate the snapshot after a *deliberate* schema change:

    uv run python -m glashaus.storage._gen_snapshot \
        > tests/fixtures/schema_snapshot.sql
"""

from __future__ import annotations

from pathlib import Path

import pytest

from glashaus.storage import MigrationRunner, connect, dump_schema

FIXTURES = Path(__file__).parent / "fixtures"
SNAPSHOT_PATH = FIXTURES / "schema_snapshot.sql"


@pytest.mark.schema_snapshot
def test_migrations_apply_from_empty_db() -> None:
    """Apply every migration in order against an empty DB and confirm the
    final version equals the count of discovered migrations."""
    conn = connect(":memory:")
    try:
        runner = MigrationRunner(conn)
        discovered = runner.discover()
        assert discovered, "no migrations found — package layout broken?"

        final = runner.apply_all()
        assert final == discovered[-1].version
    finally:
        conn.close()


@pytest.mark.schema_snapshot
def test_schema_matches_committed_snapshot() -> None:
    """Live schema must match `tests/fixtures/schema_snapshot.sql` exactly."""
    conn = connect(":memory:")
    try:
        MigrationRunner(conn).apply_all()
        actual = dump_schema(conn)
    finally:
        conn.close()

    expected = SNAPSHOT_PATH.read_text(encoding="utf-8")

    if actual != expected:
        # Write a side-by-side diff into the failure message so the
        # author can see exactly what drifted.
        import difflib

        diff = "".join(
            difflib.unified_diff(
                expected.splitlines(keepends=True),
                actual.splitlines(keepends=True),
                fromfile="committed snapshot",
                tofile="live schema",
            )
        )
        raise AssertionError(
            "Schema diverged from committed snapshot. If this change is "
            "intentional, regenerate the snapshot:\n\n"
            "  uv run python -m glashaus.storage._gen_snapshot \\\n"
            "      > tests/fixtures/schema_snapshot.sql\n\n"
            f"Diff:\n{diff}"
        )


@pytest.mark.schema_snapshot
def test_migrations_are_idempotent() -> None:
    """Running the runner twice must not re-apply already-applied migrations."""
    conn = connect(":memory:")
    try:
        runner = MigrationRunner(conn)
        first = runner.apply_all()
        # On the second pass, `pending()` must be empty and the version must
        # not have moved.
        assert runner.pending() == []
        second = runner.apply_all()
        assert first == second
    finally:
        conn.close()
