"""Tests for the memory layer.

Covers dataclass validation, write/read round-trips, multi-table
transactional writes, LEFT JOIN behavior with `*_vec`, embeddings, and
the FK constraints that prevent dangling references.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest

from glashaus.memory import Affect, EpisodicMemory, MemoryStore, SemanticMemory
from glashaus.memory.store import EMBEDDING_DIM, _pack_embedding
from glashaus.storage import MigrationRunner, connect, transaction


@pytest.fixture
def conn() -> Iterator[sqlite3.Connection]:
    c = connect(":memory:")
    MigrationRunner(c).apply_all()
    try:
        yield c
    finally:
        c.close()


@pytest.fixture
def store(conn: sqlite3.Connection) -> MemoryStore:
    return MemoryStore(conn)


# ============================================================================
# Dataclass validation
# ============================================================================


def test_affect_rejects_out_of_range_valence() -> None:
    with pytest.raises(ValueError, match="valence"):
        Affect(valence=2.0, arousal=0.5, dominant_emotion="x")
    with pytest.raises(ValueError, match="valence"):
        Affect(valence=-1.5, arousal=0.5, dominant_emotion="x")


def test_affect_rejects_out_of_range_arousal() -> None:
    with pytest.raises(ValueError, match="arousal"):
        Affect(valence=0.0, arousal=1.5, dominant_emotion="x")


def test_affect_rejects_empty_dominant_emotion() -> None:
    with pytest.raises(ValueError, match="dominant_emotion"):
        Affect(valence=0.0, arousal=0.5, dominant_emotion="")


def test_episodic_dataclass_validates_salience() -> None:
    a = Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral")
    with pytest.raises(ValueError, match="salience"):
        EpisodicMemory(
            id="x",
            ts=datetime.now(UTC),
            content="c",
            user_id="u",
            agent_id="a",
            affect=a,
            salience=1.5,
        )


def test_semantic_dataclass_validates_confidence() -> None:
    with pytest.raises(ValueError, match="confidence"):
        SemanticMemory(id="x", claim="c", confidence=-0.1)


# ============================================================================
# Episodic write/read
# ============================================================================


def test_write_episodic_minimal(store: MemoryStore) -> None:
    ep = store.write_episodic(
        content="austin says hi",
        user_id="austin",
        agent_id="glashaus",
        affect=Affect(valence=0.2, arousal=0.4, dominant_emotion="warm"),
        salience=0.5,
    )
    assert ep.id
    assert ep.content == "austin says hi"
    assert ep.affect.valence == 0.2
    assert ep.salience == 0.5
    assert ep.topics == ()
    assert ep.references == ()
    assert ep.has_embedding is False
    assert ep.channel == "cli"


def test_write_episodic_then_read_round_trip(store: MemoryStore) -> None:
    written = store.write_episodic(
        content="thesis on artificial psychology",
        user_id="austin",
        agent_id="glashaus",
        affect=Affect(valence=0.3, arousal=0.6, dominant_emotion="engaged"),
        salience=0.85,
        topics=("thesis", "research"),
        channel="cli",
    )
    read = store.get_episodic(written.id)
    assert read is not None
    assert read.id == written.id
    assert read.content == written.content
    assert read.salience == 0.85
    assert read.affect == written.affect
    assert set(read.topics) == {"thesis", "research"}
    assert read.has_embedding is False


def test_get_episodic_returns_none_for_missing(store: MemoryStore) -> None:
    assert store.get_episodic("does-not-exist") is None


def test_write_episodic_with_references(store: MemoryStore) -> None:
    first = store.write_episodic(
        content="initial message",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.1, dominant_emotion="neutral"),
        salience=0.4,
    )
    second = store.write_episodic(
        content="reply to first",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.1, dominant_emotion="neutral"),
        salience=0.4,
        references=[first.id],
    )
    read = store.get_episodic(second.id)
    assert read is not None
    assert read.references == (first.id,)


def test_write_episodic_with_dangling_reference_rolls_back(
    store: MemoryStore, conn: sqlite3.Connection
) -> None:
    """A reference to a non-existent episodic_id must fail. Transaction
    semantics must roll back the partial INSERT into `episodic`."""
    with pytest.raises(sqlite3.IntegrityError):
        store.write_episodic(
            content="orphan reply",
            user_id="u",
            agent_id="a",
            affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
            salience=0.5,
            references=["non-existent-id"],
            id="orphan",
        )
    # The episodic row must not be present — transaction rolled back.
    row = conn.execute("SELECT id FROM episodic WHERE id = 'orphan'").fetchone()
    assert row is None


def test_write_episodic_with_embedding(store: MemoryStore, conn: sqlite3.Connection) -> None:
    emb = [0.01 * i for i in range(EMBEDDING_DIM)]
    ep = store.write_episodic(
        content="with embedding",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.5,
        embedding=emb,
    )
    assert ep.has_embedding is True

    # And on read, has_embedding=True propagates.
    read = store.get_episodic(ep.id)
    assert read is not None
    assert read.has_embedding is True

    # The bytes landed in vec0.
    row = conn.execute(
        "SELECT episodic_id FROM episodic_vec WHERE episodic_id = ?",
        (ep.id,),
    ).fetchone()
    assert row is not None


def test_get_episodic_left_join_records_without_embedding(store: MemoryStore) -> None:
    """LEFT JOIN convention: records without an embedding still surface,
    flagged via has_embedding=False."""
    ep = store.write_episodic(
        content="no embedding here",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.5,
    )
    read = store.get_episodic(ep.id)
    assert read is not None
    assert read.has_embedding is False


def test_episodic_by_ids_preserves_order_and_drops_missing(store: MemoryStore) -> None:
    a = store.write_episodic(
        content="a",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.3,
    )
    b = store.write_episodic(
        content="b",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.4,
    )
    out = store.episodic_by_ids([b.id, "does-not-exist", a.id])
    assert [ep.id for ep in out] == [b.id, a.id]


def test_episodic_by_ids_empty_input_returns_empty(store: MemoryStore) -> None:
    assert store.episodic_by_ids([]) == []


def test_write_episodic_id_and_ts_defaults(store: MemoryStore) -> None:
    before = datetime.now(UTC)
    ep = store.write_episodic(
        content="defaults",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.3,
    )
    after = datetime.now(UTC)
    assert ep.id  # uuid generated
    # The dataclass ts is what we stored; verify it falls in window.
    assert before <= ep.ts <= after


def test_pack_embedding_rejects_wrong_dim() -> None:
    with pytest.raises(ValueError, match="must be 1536"):
        _pack_embedding([0.0, 0.0])


def test_pack_embedding_produces_correct_byte_length() -> None:
    emb = [0.0] * EMBEDDING_DIM
    raw = _pack_embedding(emb)
    assert len(raw) == EMBEDDING_DIM * 4  # float32 = 4 bytes


def test_write_episodic_with_wrong_dim_embedding_rolls_back(
    store: MemoryStore, conn: sqlite3.Connection
) -> None:
    """Wrong-dim embedding must fail in pack and roll back the episodic row."""
    with pytest.raises(ValueError, match="must be 1536"):
        store.write_episodic(
            content="bad embedding",
            user_id="u",
            agent_id="a",
            affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
            salience=0.5,
            embedding=[0.0, 0.0],  # wrong dim
            id="wrongdim",
        )
    assert conn.execute("SELECT id FROM episodic WHERE id = 'wrongdim'").fetchone() is None


# ============================================================================
# Semantic write/read
# ============================================================================


def test_write_semantic_minimal(store: MemoryStore) -> None:
    sm = store.write_semantic(claim="Austin uses macOS", confidence=0.9)
    assert sm.id
    assert sm.claim == "Austin uses macOS"
    assert sm.confidence == 0.9
    assert sm.evidence == ()
    assert sm.contradictions == ()


def test_write_semantic_with_evidence(store: MemoryStore) -> None:
    ep1 = store.write_episodic(
        content="austin opened terminal",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.3,
    )
    ep2 = store.write_episodic(
        content="austin mentioned Activity Monitor",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.3,
    )
    sm = store.write_semantic(
        claim="Austin uses macOS",
        confidence=0.85,
        evidence=[ep1.id, ep2.id],
    )
    read = store.get_semantic(sm.id)
    assert read is not None
    assert set(read.evidence) == {ep1.id, ep2.id}


def test_write_semantic_evidence_requires_existing_episodic(
    store: MemoryStore, conn: sqlite3.Connection
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        store.write_semantic(
            claim="dangling",
            confidence=0.5,
            evidence=["does-not-exist"],
            id="dangling-sm",
        )
    assert conn.execute("SELECT id FROM semantic WHERE id = 'dangling-sm'").fetchone() is None


def test_semantic_contradictions_round_trip(store: MemoryStore) -> None:
    a = store.write_semantic(claim="claim A", confidence=0.7)
    b = store.write_semantic(
        claim="claim B (contradicts A)",
        confidence=0.6,
        contradictions=[a.id],
    )
    read = store.get_semantic(b.id)
    assert read is not None
    assert read.contradictions == (a.id,)


def test_semantic_with_embedding(store: MemoryStore, conn: sqlite3.Connection) -> None:
    sm = store.write_semantic(
        claim="something",
        confidence=0.8,
        embedding=[0.0] * EMBEDDING_DIM,
    )
    assert sm.has_embedding is True
    read = store.get_semantic(sm.id)
    assert read is not None
    assert read.has_embedding is True


def test_semantic_left_join_no_embedding(store: MemoryStore) -> None:
    sm = store.write_semantic(claim="no embedding", confidence=0.5)
    read = store.get_semantic(sm.id)
    assert read is not None
    assert read.has_embedding is False


def test_get_semantic_returns_none_for_missing(store: MemoryStore) -> None:
    assert store.get_semantic("does-not-exist") is None


def test_semantic_by_ids_preserves_order_and_drops_missing(store: MemoryStore) -> None:
    a = store.write_semantic(claim="A", confidence=0.5)
    b = store.write_semantic(claim="B", confidence=0.5)
    out = store.semantic_by_ids([b.id, "missing", a.id])
    assert [sm.id for sm in out] == [b.id, a.id]


# ============================================================================
# Transaction helper
# ============================================================================


def test_transaction_rolls_back_on_exception(conn: sqlite3.Connection) -> None:
    with pytest.raises(RuntimeError), transaction(conn):
        conn.execute(
            """INSERT INTO episodic
                   (id, ts, content, user_id, agent_id, valence, arousal,
                    dominant_emotion, salience, channel)
                   VALUES ('tx1', '2026-01-01T00:00:00Z', 'in flight', 'u',
                           'a', 0.0, 0.0, 'neutral', 0.5, 'cli')"""
        )
        raise RuntimeError("nope")
    assert conn.execute("SELECT id FROM episodic WHERE id = 'tx1'").fetchone() is None


def test_transaction_commits_on_success(conn: sqlite3.Connection) -> None:
    with transaction(conn):
        conn.execute(
            """INSERT INTO episodic
               (id, ts, content, user_id, agent_id, valence, arousal,
                dominant_emotion, salience, channel)
               VALUES ('tx2', '2026-01-01T00:00:00Z', 'committed', 'u',
                       'a', 0.0, 0.0, 'neutral', 0.5, 'cli')"""
        )
    assert conn.execute("SELECT id FROM episodic WHERE id = 'tx2'").fetchone() is not None


# ============================================================================
# FTS5 trigger participation — checks that writing through the store actually
# populates the FTS index that the retriever (chunk 6) will query.
# ============================================================================


def test_episodic_write_populates_fts(store: MemoryStore, conn: sqlite3.Connection) -> None:
    ep = store.write_episodic(
        content="austin mentioned his thesis",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.5,
    )
    hit = conn.execute(
        "SELECT episodic.id FROM episodic_fts JOIN episodic "
        "  ON episodic_fts.rowid = episodic.rowid "
        "WHERE episodic_fts MATCH 'thesis'"
    ).fetchone()
    assert hit is not None
    assert hit["id"] == ep.id


def test_semantic_write_populates_fts(store: MemoryStore, conn: sqlite3.Connection) -> None:
    sm = store.write_semantic(claim="austin keeps a thesis journal", confidence=0.7)
    hit = conn.execute(
        "SELECT semantic.id FROM semantic_fts JOIN semantic "
        "  ON semantic_fts.rowid = semantic.rowid "
        "WHERE semantic_fts MATCH 'journal'"
    ).fetchone()
    assert hit is not None
    assert hit["id"] == sm.id
