"""Schema snapshot test — placeholder, filled in Phase 1.

Plan §12 requires CI to run snapshot tests against the memory store schema
and the migration path. There is no schema yet (Phase 0 ships no storage),
so the test is skipped — but the file, the marker, and the CI wiring all
exist so the slot is real, not aspirational.
"""

from __future__ import annotations

import pytest


@pytest.mark.schema_snapshot
@pytest.mark.skip(reason="Phase 1: schema lands with the storage layer")
def test_episodic_schema_matches_snapshot() -> None:
    """Compare the live SQLite schema for the episodic store against a
    committed snapshot. Any drift is a deliberate migration or a bug."""
    raise NotImplementedError


@pytest.mark.schema_snapshot
@pytest.mark.skip(reason="Phase 1: migrations land with the storage layer")
def test_migrations_apply_from_empty_db() -> None:
    """Apply every migration in order against an empty DB and confirm the
    final schema matches the live snapshot."""
    raise NotImplementedError
