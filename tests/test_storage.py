"""Tests for the storage module — connection, runner, dump_schema.

These are layer-1 tests. They don't touch any GlasHaus business logic;
they verify the foundation of every other test holds up.
"""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from glashaus.storage import MigrationRunner, connect, dump_schema, open_state_db
from glashaus.storage.db import default_state_db_path, default_state_dir
from glashaus.storage.runner import (
    MIGRATIONS_DIR,
    Migration,
    current_version,
    discover_migrations,
)


def test_connect_loads_sqlite_vec() -> None:
    conn = connect(":memory:")
    try:
        version = conn.execute("SELECT vec_version()").fetchone()[0]
        assert isinstance(version, str)
        assert version.startswith("v")
    finally:
        conn.close()


def test_connect_enables_fts5() -> None:
    conn = connect(":memory:")
    try:
        # If FTS5 weren't compiled in, this would raise OperationalError.
        conn.execute("CREATE VIRTUAL TABLE t USING fts5(content)")
        conn.execute("INSERT INTO t VALUES ('the quick brown fox')")
        row = conn.execute("SELECT content FROM t WHERE t MATCH 'quick'").fetchone()
        assert row["content"] == "the quick brown fox"
    finally:
        conn.close()


def test_connect_uses_row_factory() -> None:
    conn = connect(":memory:")
    try:
        conn.execute("CREATE TABLE x (a INT, b TEXT)")
        conn.execute("INSERT INTO x VALUES (1, 'hi')")
        row = conn.execute("SELECT * FROM x").fetchone()
        assert row["a"] == 1
        assert row["b"] == "hi"
    finally:
        conn.close()


def test_connect_foreign_keys_on() -> None:
    conn = connect(":memory:")
    try:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        conn.close()


def test_open_state_db_uses_env_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    target = tmp_path / "alt"
    monkeypatch.setenv("GLASHAUS_STATE_DIR", str(target))
    assert default_state_dir() == target
    assert default_state_db_path() == target / "state.db"

    conn = open_state_db()
    try:
        assert target.is_dir(), "state dir must be created"
        assert (target / "state.db").exists()
    finally:
        conn.close()


def test_current_version_on_empty_db() -> None:
    conn = connect(":memory:")
    try:
        assert current_version(conn) == 0
    finally:
        conn.close()


def test_discover_migrations_finds_initial() -> None:
    migs = discover_migrations(MigrationRunner(connect(":memory:")).directory)
    assert migs[0].version == 1
    # `name` is the post-prefix slug (`NNN_<name>.sql`), not the full filename.
    assert migs[0].name == "initial"


def test_discover_migrations_rejects_bad_filenames(tmp_path: Path) -> None:
    (tmp_path / "001_ok.sql").write_text("-- ok")
    (tmp_path / "garbage.sql").write_text("-- bad")
    with pytest.raises(ValueError, match="does not match"):
        discover_migrations(tmp_path)


def test_discover_migrations_rejects_version_gap(tmp_path: Path) -> None:
    (tmp_path / "001_a.sql").write_text("")
    (tmp_path / "003_c.sql").write_text("")  # gap at 002
    with pytest.raises(ValueError, match="gap"):
        discover_migrations(tmp_path)


def test_discover_migrations_rejects_duplicate_versions(tmp_path: Path) -> None:
    (tmp_path / "001_a.sql").write_text("")
    (tmp_path / "001_b.sql").write_text("")
    with pytest.raises(ValueError, match=r"[Dd]uplicate"):
        discover_migrations(tmp_path)


def test_runner_records_snapshot_callback() -> None:
    """Pre-migration snapshot callback must be invoked once per applied migration,
    with the target version, before the SQL runs."""
    conn = connect(":memory:")
    seen: list[int] = []

    def snap(version: int) -> None:
        seen.append(version)
        # At callback time the migration has NOT yet been applied — verify by
        # checking current_version is still 0.
        assert current_version(conn) == 0

    try:
        MigrationRunner(conn, snapshot=snap).apply_all()
    finally:
        conn.close()
    assert seen == [1]


def test_runner_rejects_migration_that_does_not_record_itself(tmp_path: Path) -> None:
    """A migration that forgets to insert into schema_version is a contract
    violation — the runner must blow up loudly."""
    # First, a real bootstrap so schema_version exists.
    bootstrap = tmp_path / "001_bootstrap.sql"
    bootstrap.write_text(
        "CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT, "
        "applied_at TEXT);\n"
        "INSERT INTO schema_version (version, name, applied_at) "
        "VALUES (1, '001_bootstrap', '2026-01-01T00:00:00Z');\n"
    )
    # Then a migration that runs DDL but forgets the schema_version insert.
    bad = tmp_path / "002_bad.sql"
    bad.write_text("CREATE TABLE oops (x INTEGER);\n")  # no INSERT — bug

    conn = connect(":memory:")
    try:
        runner = MigrationRunner(conn, directory=tmp_path)
        with pytest.raises(RuntimeError, match="did not insert"):
            runner.apply_all()
    finally:
        conn.close()


def test_runner_persists_across_connections(tmp_path: Path) -> None:
    """Apply migrations once, reopen the DB, current_version must still be 1."""
    db = tmp_path / "state.db"
    conn1 = connect(db)
    try:
        MigrationRunner(conn1).apply_all()
    finally:
        conn1.close()

    conn2 = connect(db)
    try:
        assert current_version(conn2) == 1
        # Pending should be empty on the fresh connection.
        assert MigrationRunner(conn2).pending() == []
    finally:
        conn2.close()


def test_dump_schema_is_stable_within_a_session() -> None:
    """Two dumps of the same fully-migrated DB must be byte-identical."""
    conn = connect(":memory:")
    try:
        MigrationRunner(conn).apply_all()
        first = dump_schema(conn)
        second = dump_schema(conn)
        assert first == second
    finally:
        conn.close()


def test_dump_schema_excludes_sqlite_internal_tables() -> None:
    conn = connect(":memory:")
    try:
        MigrationRunner(conn).apply_all()
        out = dump_schema(conn)
    finally:
        conn.close()
    assert "sqlite_sequence" not in out
    assert "sqlite_master" not in out


def test_episodic_check_constraints_reject_invalid_values() -> None:
    """The plan's bounded scalars must be enforced at the SQL level."""
    conn = connect(":memory:")
    try:
        MigrationRunner(conn).apply_all()

        def insert(salience: float = 0.5, valence: float = 0.0, arousal: float = 0.0) -> None:
            conn.execute(
                """INSERT INTO episodic
                   (id, ts, content, user_id, agent_id, valence, arousal,
                    dominant_emotion, salience, channel)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "ep1",
                    "2026-01-01T00:00:00Z",
                    "hi",
                    "u",
                    "a",
                    valence,
                    arousal,
                    "neutral",
                    salience,
                    "cli",
                ),
            )

        # Valid insert is fine.
        insert()
        conn.execute("DELETE FROM episodic")

        # salience out of [0, 1] -> rejected
        with pytest.raises(sqlite3.IntegrityError):
            insert(salience=1.5)
        with pytest.raises(sqlite3.IntegrityError):
            insert(salience=-0.1)

        # valence out of [-1, 1] -> rejected
        with pytest.raises(sqlite3.IntegrityError):
            insert(valence=2.0)

        # arousal out of [0, 1] -> rejected
        with pytest.raises(sqlite3.IntegrityError):
            insert(arousal=2.0)
    finally:
        conn.close()


def test_self_state_singleton_constraint() -> None:
    """Plan §4 wants exactly one self_state row. CHECK (singleton = 1) enforces it."""
    conn = connect(":memory:")
    try:
        MigrationRunner(conn).apply_all()

        def insert(singleton: int) -> None:
            conn.execute(
                """INSERT INTO self_state (
                    singleton,
                    identity_name, identity_voice, identity_base_values_json, identity_updated_at,
                    disp_curiosity, disp_playfulness, disp_reserve, disp_warmth, disp_directness,
                    disp_updated_at,
                    cs_mood, cs_energy, cs_preoccupations_json, cs_updated_at,
                    rel_trust, rel_familiarity, rel_current_warmth, rel_history_markers_json,
                    rel_updated_at
                ) VALUES (
                    ?,
                    'GlasHaus', 'measured', '[]', '2026-01-01T00:00:00Z',
                    0.5, 0.5, 0.5, 0.5, 0.5,
                    '2026-01-01T00:00:00Z',
                    'neutral', 0.5, '[]', '2026-01-01T00:00:00Z',
                    0.5, 0.5, 0.5, '[]', '2026-01-01T00:00:00Z'
                )""",
                (singleton,),
            )

        insert(1)
        with pytest.raises(sqlite3.IntegrityError):
            insert(2)  # CHECK rejects
        with pytest.raises(sqlite3.IntegrityError):
            insert(1)  # PK rejects second row at singleton=1
    finally:
        conn.close()


def test_fts5_indexes_are_populated_by_trigger() -> None:
    """The CREATE TRIGGER episodic_fts_insert must keep the FTS table current."""
    conn = connect(":memory:")
    try:
        MigrationRunner(conn).apply_all()
        conn.execute(
            """INSERT INTO episodic
               (id, ts, content, user_id, agent_id, valence, arousal,
                dominant_emotion, salience, channel)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "ep1",
                "2026-01-01T00:00:00Z",
                "Austin mentioned his thesis on artificial psychology",
                "u",
                "a",
                0.3,
                0.4,
                "engaged",
                0.7,
                "cli",
            ),
        )
        row = conn.execute(
            "SELECT episodic.id FROM episodic_fts JOIN episodic "
            "  ON episodic_fts.rowid = episodic.rowid "
            "WHERE episodic_fts MATCH 'thesis'"
        ).fetchone()
        assert row is not None
        assert row["id"] == "ep1"
    finally:
        conn.close()


def test_vec0_table_accepts_1536_dim_embeddings() -> None:
    """sqlite-vec's vec0 must accept the dimension we baked into the migration."""
    conn = connect(":memory:")
    try:
        MigrationRunner(conn).apply_all()
        # Build a 1536-dim zero vector and shove it in.
        zeros = b"\x00\x00\x00\x00" * 1536  # IEEE 754 float32 zero per dim
        conn.execute(
            "INSERT INTO episodic_vec (episodic_id, embedding) VALUES (?, ?)",
            ("ep1", zeros),
        )
        row = conn.execute("SELECT episodic_id FROM episodic_vec").fetchone()
        assert row["episodic_id"] == "ep1"
    finally:
        conn.close()


def test_episodic_references_self_loop_rejected() -> None:
    """references CHECK (src_id != dst_id) rejects circular self-references."""
    conn = connect(":memory:")
    try:
        MigrationRunner(conn).apply_all()
        conn.execute(
            """INSERT INTO episodic
               (id, ts, content, user_id, agent_id, valence, arousal,
                dominant_emotion, salience, channel)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "ep1",
                "2026-01-01T00:00:00Z",
                "hi",
                "u",
                "a",
                0.0,
                0.0,
                "neutral",
                0.5,
                "cli",
            ),
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO episodic_references (src_id, dst_id) VALUES (?, ?)",
                ("ep1", "ep1"),
            )
    finally:
        conn.close()


def test_migration_class_path_property() -> None:
    """Migration is frozen+slots; just confirm property reads file content."""
    mig = Migration(
        version=999,
        name="probe",
        path=MigrationRunner(connect(":memory:")).directory / "001_initial.sql",
    )
    assert "CREATE TABLE episodic" in mig.sql


def test_pre_migration_snapshot_enables_restore_after_failure(tmp_path: Path) -> None:
    """End-to-end exercise of the rollback path.

    The runner's comments and `docs/SETUP_BACKUPS.md` both lean on this
    invariant: when a migration fails partway through, restoring the
    pre-migration `.backup` returns the DB to a coherent prior version.
    Without a test that actually runs that loop, the invariant rots —
    `executescript()`'s partial-failure semantics are exactly the kind of
    thing that quietly changes between SQLite versions.

    Flow:
      1. Bring `state.db` to v1, write a row.
      2. Stage a deliberately-broken migration 002 in a temp dir
         (executes one DDL successfully, then hits a syntax error).
      3. Wire a snapshot callback that takes a real `.backup` of the
         live DB to `state.snapshot.db` before any migration runs.
      4. Run the runner; assert it raises and that the live DB is in
         the expected partial state (the broken migration's first DDL
         landed; schema_version unchanged).
      5. Restore by copying the snapshot file over `state.db` — the
         same operation `docs/SETUP_BACKUPS.md` documents.
      6. Reopen and confirm: version still 1, no leftover artifacts
         from 002, original row intact.
    """
    db_path = tmp_path / "state.db"
    snapshot_path = tmp_path / "state.snapshot.db"

    # ---- 1. Bring DB to v1 + a row of pre-existing data --------------
    conn = connect(db_path)
    try:
        MigrationRunner(conn).apply_all()
        conn.execute(
            """INSERT INTO episodic
               (id, ts, content, user_id, agent_id, valence, arousal,
                dominant_emotion, salience, channel)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "ep_pre",
                "2026-01-01T00:00:00Z",
                "row written before the broken migration",
                "u",
                "a",
                0.1,
                0.2,
                "neutral",
                0.6,
                "cli",
            ),
        )
    finally:
        conn.close()

    # ---- 2. Stage migrations 001 (copied) + 002 (deliberately broken) -
    bad_dir = tmp_path / "migrations"
    bad_dir.mkdir()
    shutil.copy(MIGRATIONS_DIR / "001_initial.sql", bad_dir / "001_initial.sql")
    (bad_dir / "002_broken.sql").write_text(
        # Statement A: legitimate DDL — lands successfully because DDL
        # auto-commits under executescript.
        "CREATE TABLE will_remain_partial (x INTEGER);\n"
        # Statement B: syntax error — aborts the script before reaching C.
        "INVALID SQL HERE;\n"
        # Statement C: would record the migration, but never runs.
        "INSERT INTO schema_version (version, name) "
        "VALUES (2, '002_broken');\n",
        encoding="utf-8",
    )

    # ---- 3. Snapshot callback uses SQLite's online .backup API,
    #         exactly like scripts/pre_migration_snapshot.sh does. ----
    def real_snapshot(version: int) -> None:
        # Open both connections with the stdlib (no extension needed for
        # backup — it's a byte-level copy). This matches how the shell
        # script invokes `sqlite3 .backup`.
        src = sqlite3.connect(str(db_path))
        dst = sqlite3.connect(str(snapshot_path))
        try:
            with dst:
                src.backup(dst)
        finally:
            src.close()
            dst.close()

    # ---- 4. Run the runner; it must raise, snapshot must exist --------
    conn = connect(db_path)
    try:
        runner = MigrationRunner(conn, directory=bad_dir, snapshot=real_snapshot)
        with pytest.raises(sqlite3.OperationalError):
            runner.apply_all()
    finally:
        conn.close()

    assert snapshot_path.exists(), "snapshot must have been taken before the failure"

    # The DB is now in a partial state — DDL from the broken migration
    # landed because executescript() doesn't roll back DDL on later
    # errors. This is the exact failure mode the snapshot exists to fix.
    conn = connect(db_path)
    try:
        assert current_version(conn) == 1, "schema_version must not have moved"
        partial = conn.execute(
            "SELECT name FROM sqlite_master WHERE name = 'will_remain_partial'"
        ).fetchone()
        assert partial is not None, (
            "expected the broken migration's DDL to have landed before the "
            "failure — otherwise this test isn't exercising the rollback path"
        )
    finally:
        conn.close()

    # ---- 5. Restore by file copy. Same operation as `cp` in the docs. -
    shutil.copyfile(snapshot_path, db_path)

    # ---- 6. Confirm pre-migration state is back ---------------------
    conn = connect(db_path)
    try:
        assert current_version(conn) == 1
        leftover = conn.execute(
            "SELECT name FROM sqlite_master WHERE name = 'will_remain_partial'"
        ).fetchone()
        assert leftover is None, "restore should have removed the partial DDL"
        row = conn.execute("SELECT id, content FROM episodic WHERE id = 'ep_pre'").fetchone()
        assert row is not None
        assert row["content"] == "row written before the broken migration"
    finally:
        conn.close()
