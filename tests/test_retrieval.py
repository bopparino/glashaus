"""Tests for the retrieval layer.

Two test domains:

- Pure scoring functions: trivially unit-testable, no DB.
- HybridRetriever: against an in-memory DB with realistic populated
  data, covering vec/fts/temporal/affective/salience/thread paths and
  the "no query embedding -> vec score=0 across the board" fallback.
"""

from __future__ import annotations

import math
import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest

from glashaus.memory import Affect, MemoryStore
from glashaus.memory.types import EpisodicMemory
from glashaus.retrieval import (
    HybridRetriever,
    RetrievalConfig,
    RetrievalContext,
    ScoreBreakdown,
    affective_score,
    composite_score,
    fts_score,
    salience_score,
    sanitize_for_fts5,
    temporal_score,
    thread_score,
    vector_score,
)
from glashaus.storage import MigrationRunner, connect

# ============================================================================
# Fixtures
# ============================================================================


def _t(offset_days: int = 0) -> datetime:
    return datetime(2026, 5, 19, 17, 0, 0, tzinfo=UTC) + timedelta(days=offset_days)


@pytest.fixture
def conn() -> Iterator[sqlite3.Connection]:
    c = connect(":memory:")
    MigrationRunner(c).apply_all()
    try:
        yield c
    finally:
        c.close()


@pytest.fixture
def memory(conn: sqlite3.Connection) -> MemoryStore:
    return MemoryStore(conn)


@pytest.fixture
def retriever(conn: sqlite3.Connection) -> HybridRetriever:
    return HybridRetriever(conn)


def _make_ep(memory: MemoryStore, *, content: str, **kw: object) -> EpisodicMemory:
    """Convenience: write an episodic with sensible defaults."""
    return memory.write_episodic(
        content=content,
        user_id=kw.pop("user_id", "austin"),  # type: ignore[arg-type]
        agent_id=kw.pop("agent_id", "glashaus"),  # type: ignore[arg-type]
        affect=Affect(
            valence=float(kw.pop("valence", 0.0)),  # type: ignore[arg-type]
            arousal=float(kw.pop("arousal", 0.3)),  # type: ignore[arg-type]
            dominant_emotion=str(kw.pop("dominant_emotion", "neutral")),
        ),
        salience=float(kw.pop("salience", 0.5)),  # type: ignore[arg-type]
        topics=kw.pop("topics", ()),  # type: ignore[arg-type]
        references=kw.pop("references", ()),  # type: ignore[arg-type]
        ts=kw.pop("ts", None),  # type: ignore[arg-type]
        id=kw.pop("id", None),  # type: ignore[arg-type]
    )


# ============================================================================
# Pure scoring
# ============================================================================


def test_vector_score_zero_distance_is_one() -> None:
    assert vector_score(0.0) == 1.0


def test_vector_score_max_distance_is_zero() -> None:
    assert vector_score(2.0) == 0.0


def test_vector_score_negative_clamps_to_one() -> None:
    assert vector_score(-0.1) == 1.0


def test_vector_score_above_max_clamps_to_zero() -> None:
    assert vector_score(5.0) == 0.0


def test_fts_score_zero_or_positive_rank_is_zero() -> None:
    """BM25 ranks should always be negative; defensive 0 otherwise."""
    assert fts_score(0.0) == 0.0
    assert fts_score(3.5) == 0.0


def test_fts_score_negative_rank_normalizes() -> None:
    # rank -5 with scale 10 -> 0.5
    assert fts_score(-5.0, scale=10.0) == 0.5


def test_temporal_score_now_is_one() -> None:
    now = _t()
    assert temporal_score(now, now) == 1.0


def test_temporal_score_decays_by_half_at_one_half_life() -> None:
    ts = _t(-30)  # 30 days ago
    assert temporal_score(ts, _t(), half_life_days=30.0) == pytest.approx(0.5)


def test_temporal_score_two_half_lives_is_quarter() -> None:
    ts = _t(-60)
    assert temporal_score(ts, _t(), half_life_days=30.0) == pytest.approx(0.25)


def test_temporal_score_future_ts_clamps_to_one() -> None:
    ts = _t(+5)
    assert temporal_score(ts, _t(), half_life_days=30.0) == 1.0


def test_affective_score_perfect_match() -> None:
    assert affective_score(0.7, current_energy=0.7) == pytest.approx(1.0)


def test_affective_score_maximum_distance() -> None:
    assert affective_score(0.0, current_energy=1.0) == pytest.approx(0.0)


def test_affective_score_none_current_is_neutral() -> None:
    """Unknown current_state shouldn't bias either way."""
    assert affective_score(0.0, current_energy=None) == 0.5
    assert affective_score(1.0, current_energy=None) == 0.5


def test_salience_score_passthrough() -> None:
    assert salience_score(0.6) == 0.6


def test_salience_score_clamps() -> None:
    assert salience_score(-0.1) == 0.0
    assert salience_score(1.5) == 1.0


def _fake_ep(id: str, references: tuple[str, ...] = ()) -> EpisodicMemory:
    return EpisodicMemory(
        id=id,
        ts=_t(),
        content="x",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.3, dominant_emotion="neutral"),
        salience=0.5,
        references=references,
    )


def test_thread_score_self_match_is_one() -> None:
    ep = _fake_ep("ep-1")
    assert thread_score(ep, {"ep-1"}) == 1.0


def test_thread_score_referenced_seed_is_seven_tenths() -> None:
    ep = _fake_ep("ep-2", references=("ep-1",))
    assert thread_score(ep, {"ep-1"}) == 0.7


def test_thread_score_no_match_is_zero() -> None:
    ep = _fake_ep("ep-3")
    assert thread_score(ep, {"ep-1"}) == 0.0


def test_thread_score_empty_seeds_is_zero() -> None:
    ep = _fake_ep("ep-1")
    assert thread_score(ep, set()) == 0.0


def test_composite_score_uses_weights() -> None:
    breakdown = ScoreBreakdown(
        vector=1.0,
        fts=0.5,
        temporal=0.5,
        affective=0.0,
        salience=0.0,
        thread=0.0,
    )
    weights = {"vector": 0.6, "fts": 0.4, "temporal": 0.0}
    assert composite_score(breakdown, weights) == pytest.approx(0.6 * 1.0 + 0.4 * 0.5)


def test_composite_score_missing_weight_treated_as_zero() -> None:
    breakdown = ScoreBreakdown(vector=1.0, fts=1.0, salience=1.0)
    assert composite_score(breakdown, {"vector": 1.0}) == 1.0


def test_sanitize_for_fts5_strips_metacharacters() -> None:
    assert sanitize_for_fts5('AUSTIN "hates"-it!') == "AUSTIN hates it"


def test_sanitize_for_fts5_collapses_whitespace() -> None:
    assert sanitize_for_fts5("  hello   world  ") == "hello world"


def test_sanitize_for_fts5_empty_when_only_metachars() -> None:
    assert sanitize_for_fts5('"-*-"') == ""


def test_sanitize_for_fts5_caps_word_count() -> None:
    text = " ".join(f"w{i}" for i in range(150))
    out = sanitize_for_fts5(text, max_words=10)
    assert len(out.split()) == 10


# ============================================================================
# HybridRetriever — empty DB
# ============================================================================


def test_retriever_returns_empty_when_no_data(
    retriever: HybridRetriever,
) -> None:
    ctx = RetrievalContext(user_query="anything", now=_t())
    assert retriever.retrieve_episodic(ctx) == []
    assert retriever.retrieve_semantic(ctx) == []


# ============================================================================
# HybridRetriever — episodic
# ============================================================================


def test_retriever_returns_recent_records_when_no_embedding(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    """Vec branch absent -> FTS/temporal/salience still produce results."""
    a = _make_ep(memory, content="austin talked about his thesis", ts=_t(-1))
    b = _make_ep(memory, content="austin made breakfast", ts=_t(-2))
    ctx = RetrievalContext(user_query="thesis", now=_t())
    out = retriever.retrieve_episodic(ctx)
    ids = {s.memory.id for s in out}
    assert {a.id, b.id} <= ids


def test_retriever_orders_by_composite_score(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    """High-salience, recent, FTS-matching record should outrank a
    stale low-salience record without keyword overlap."""
    high = _make_ep(
        memory,
        content="austin thesis defense scheduled for spring",
        salience=0.9,
        ts=_t(-1),
    )
    low = _make_ep(
        memory,
        content="the toast was burnt",
        salience=0.1,
        ts=_t(-90),
    )
    ctx = RetrievalContext(user_query="thesis spring", now=_t())
    out = retriever.retrieve_episodic(ctx)
    assert out[0].memory.id == high.id
    high_idx = next(i for i, s in enumerate(out) if s.memory.id == high.id)
    low_idx = next(i for i, s in enumerate(out) if s.memory.id == low.id)
    assert high_idx < low_idx


def test_retriever_fts_score_zero_when_no_keyword_overlap(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    ep = _make_ep(memory, content="austin made breakfast")
    ctx = RetrievalContext(user_query="thesis", now=_t())
    out = retriever.retrieve_episodic(ctx)
    scored = next(s for s in out if s.memory.id == ep.id)
    assert scored.components.fts == 0.0


def test_retriever_temporal_decay_visible_in_breakdown(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    fresh = _make_ep(memory, content="recent", ts=_t(-1))
    stale = _make_ep(memory, content="ancient", ts=_t(-60))
    ctx = RetrievalContext(user_query="x", now=_t())
    out = retriever.retrieve_episodic(ctx)
    fresh_s = next(s for s in out if s.memory.id == fresh.id)
    stale_s = next(s for s in out if s.memory.id == stale.id)
    assert fresh_s.components.temporal > stale_s.components.temporal


def test_retriever_affective_resonance_with_current_energy(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    """When current_energy matches an episodic's arousal closely, that
    record's affective component is near 1."""
    high_arousal_ep = _make_ep(memory, content="exciting", arousal=0.9)
    low_arousal_ep = _make_ep(memory, content="quiet", arousal=0.1)

    ctx = RetrievalContext(user_query="x", current_energy=0.9, now=_t())
    out = retriever.retrieve_episodic(ctx)
    high = next(s for s in out if s.memory.id == high_arousal_ep.id)
    low = next(s for s in out if s.memory.id == low_arousal_ep.id)
    assert high.components.affective > low.components.affective
    assert high.components.affective == pytest.approx(1.0)


def test_retriever_affective_neutral_when_current_energy_none(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    _make_ep(memory, content="something", arousal=0.2)
    ctx = RetrievalContext(user_query="x", now=_t())  # no current_energy
    out = retriever.retrieve_episodic(ctx)
    assert all(s.components.affective == 0.5 for s in out)


def test_retriever_salience_visible_in_breakdown(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    big = _make_ep(memory, content="significant", salience=0.95)
    small = _make_ep(memory, content="trivial", salience=0.1)
    ctx = RetrievalContext(user_query="x", now=_t())
    out = retriever.retrieve_episodic(ctx)
    big_s = next(s for s in out if s.memory.id == big.id)
    small_s = next(s for s in out if s.memory.id == small.id)
    assert big_s.components.salience == 0.95
    assert small_s.components.salience == 0.1


def test_retriever_thread_score_self_seed(memory: MemoryStore, retriever: HybridRetriever) -> None:
    seed = _make_ep(memory, content="the seed")
    ctx = RetrievalContext(user_query="anything", seed_episodic_ids=(seed.id,), now=_t())
    out = retriever.retrieve_episodic(ctx)
    self_s = next(s for s in out if s.memory.id == seed.id)
    assert self_s.components.thread == 1.0


def test_retriever_thread_score_referenced_seed(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    parent = _make_ep(memory, content="parent")
    child = _make_ep(memory, content="child", references=[parent.id])
    ctx = RetrievalContext(user_query="x", seed_episodic_ids=(parent.id,), now=_t())
    out = retriever.retrieve_episodic(ctx)
    child_s = next(s for s in out if s.memory.id == child.id)
    assert child_s.components.thread == pytest.approx(0.7)


def test_retriever_one_hop_thread_query_includes_referenced_ancestors(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    """If the seed references something, that referenced record is
    pulled into the candidate set via the one-hop join."""
    parent = _make_ep(memory, content="parent record")
    child = _make_ep(memory, content="child", references=[parent.id])
    ctx = RetrievalContext(user_query="x", seed_episodic_ids=(child.id,), now=_t())
    out = retriever.retrieve_episodic(ctx)
    ids = {s.memory.id for s in out}
    assert parent.id in ids  # pulled in by the one-hop join


def test_retriever_budget_truncation(memory: MemoryStore, conn: sqlite3.Connection) -> None:
    """When the cumulative content exceeds max_episodic_chars, the
    retriever stops appending to keep the budget."""
    for i in range(20):
        _make_ep(
            memory,
            content="x" * 500,  # 500 chars each
            ts=_t(-(i + 1)),
        )
    config = RetrievalConfig(max_episodic_chars=1500, episodic_limit=20)
    retriever = HybridRetriever(conn, config=config)
    out = retriever.retrieve_episodic(RetrievalContext(user_query="x", now=_t()))
    # Each record costs 500 chars; budget 1500 -> 3 records max.
    assert len(out) <= 3


def test_retriever_respects_episodic_limit(memory: MemoryStore, conn: sqlite3.Connection) -> None:
    for i in range(15):
        _make_ep(memory, content=f"record {i}", ts=_t(-(i + 1)))
    config = RetrievalConfig(episodic_limit=5)
    retriever = HybridRetriever(conn, config=config)
    out = retriever.retrieve_episodic(RetrievalContext(user_query="x", now=_t()))
    assert len(out) <= 5


def test_retriever_vector_branch_falls_back_when_query_embedding_none(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    """With no query embedding, vec scores are 0 across the board; the
    rest of the pipeline still produces a meaningful ranking."""
    _make_ep(memory, content="something with thesis", salience=0.8)
    ctx = RetrievalContext(user_query="thesis", query_embedding=None, now=_t())
    out = retriever.retrieve_episodic(ctx)
    assert all(s.components.vector == 0.0 for s in out)
    # Non-vec branches still produced ranked results.
    assert len(out) >= 1


def test_retriever_vector_branch_with_wrong_dim_embedding_falls_back(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    """A wrong-dim embedding shouldn't crash the turn — log and return
    empty vec results."""
    _make_ep(memory, content="content here")
    ctx = RetrievalContext(user_query="x", query_embedding=[0.0, 0.0, 0.0], now=_t())
    out = retriever.retrieve_episodic(ctx)
    assert all(s.components.vector == 0.0 for s in out)


def test_retriever_vec_branch_runs_with_correct_dim_embedding(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    """When an embedding is supplied at write time AND a same-dim query
    embedding is provided, vec contributes a non-zero score for that
    record."""
    target_embedding = [0.0] * 1536
    target_embedding[0] = 1.0
    _make_ep(memory, content="with embedding", id="ep-target")
    # Write via update path: write an episodic with explicit embedding.
    memory.write_episodic(
        content="target with embedding",
        user_id="austin",
        agent_id="glashaus",
        affect=Affect(valence=0.0, arousal=0.3, dominant_emotion="neutral"),
        salience=0.5,
        embedding=target_embedding,
        id="ep-with-emb",
    )
    # Query embedding identical to the stored one — distance should
    # be very small.
    ctx = RetrievalContext(user_query="x", query_embedding=target_embedding, now=_t())
    out = retriever.retrieve_episodic(ctx)
    with_emb = next(s for s in out if s.memory.id == "ep-with-emb")
    assert with_emb.components.vector > 0.0


# ============================================================================
# HybridRetriever — semantic
# ============================================================================


def test_retriever_semantic_returns_recent(memory: MemoryStore, retriever: HybridRetriever) -> None:
    a = memory.write_semantic(claim="austin uses macos", confidence=0.9, last_updated=_t(-1))
    b = memory.write_semantic(claim="austin reads philosophy", confidence=0.7, last_updated=_t(-2))
    ctx = RetrievalContext(user_query="austin", now=_t())
    out = retriever.retrieve_semantic(ctx)
    ids = {s.memory.id for s in out}
    assert {a.id, b.id} <= ids


def test_retriever_semantic_no_affective_or_thread_components(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    memory.write_semantic(claim="something true", confidence=0.5)
    ctx = RetrievalContext(user_query="something", current_energy=0.5, now=_t())
    out = retriever.retrieve_semantic(ctx)
    assert all(s.components.affective == 0.0 for s in out)
    assert all(s.components.thread == 0.0 for s in out)


def test_retriever_semantic_respects_limit(memory: MemoryStore, conn: sqlite3.Connection) -> None:
    for i in range(20):
        memory.write_semantic(claim=f"claim {i}", confidence=0.5)
    config = RetrievalConfig(semantic_limit=4)
    retriever = HybridRetriever(conn, config=config)
    out = retriever.retrieve_semantic(RetrievalContext(user_query="claim", now=_t()))
    assert len(out) <= 4


# ============================================================================
# Sanity: deduplication
# ============================================================================


def test_retriever_dedups_across_candidate_sources(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    """A record that appears in multiple candidate pools (recent + FTS
    + salient) must still surface only once in the output."""
    ep = _make_ep(
        memory,
        content="austin thesis salience high recent",
        salience=0.95,
        ts=_t(-1),
    )
    ctx = RetrievalContext(user_query="austin thesis", now=_t())
    out = retriever.retrieve_episodic(ctx)
    matching = [s for s in out if s.memory.id == ep.id]
    assert len(matching) == 1


# ============================================================================
# Numeric sanity: composite score is in a reasonable range
# ============================================================================


def test_composite_score_within_sum_of_weights(
    memory: MemoryStore, retriever: HybridRetriever
) -> None:
    _make_ep(memory, content="anything")
    ctx = RetrievalContext(user_query="anything", now=_t())
    out = retriever.retrieve_episodic(ctx)
    config = retriever.config
    max_possible = sum(config.episodic_weights().values())
    for s in out:
        # Each component is in [0, 1]; with non-negative weights the
        # composite can't exceed the sum.
        assert -0.001 <= s.score <= max_possible + 0.001
        assert not math.isnan(s.score)
