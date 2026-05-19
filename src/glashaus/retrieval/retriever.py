"""HybridRetriever — assemble candidate pools, score each, return a
ranked + budget-truncated set.

Sources merged into one candidate pool per call:

1. vec0 nearest-neighbor (if `query_embedding` is set)
2. FTS5 bm25 best matches (if the sanitized query is non-empty)
3. Most recent N records
4. Highest-salience N records (episodic only)
5. One-hop neighbors of `seed_episodic_ids` (episodic only)

Each candidate gets a `ScoreBreakdown` across the six components and a
composite score via the configured weights. The result is sorted desc,
then truncated to fit the per-call character budget so the assembled
system prompt stays within a turn's context.

Decisions kept simple on purpose:

- Token budgeting uses a character proxy (rough but deterministic).
  Phase 2 can plug in a real tokenizer if budgets get tight.
- Vec-branch fallback: if `query_embedding is None`, vec_score=0 for
  every candidate. Other branches still produce a meaningful ranking.
- Thread following is one-hop. Deep threads are a dream-cycle problem
  (Phase 2 surfaces unresolved threads explicitly).
- The retriever doesn't deduplicate against the conversation's recent
  messages — that's a turn-loop concern, not a retrieval concern.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime

from glashaus.memory.store import MemoryStore, _pack_embedding
from glashaus.retrieval.scoring import (
    affective_score,
    composite_score,
    fts_score,
    salience_score,
    sanitize_for_fts5,
    temporal_score,
    thread_score,
    vector_score,
)
from glashaus.retrieval.types import (
    RetrievalConfig,
    RetrievalContext,
    ScoreBreakdown,
    ScoredEpisodic,
    ScoredSemantic,
)


class HybridRetriever:
    def __init__(
        self,
        conn: sqlite3.Connection,
        *,
        config: RetrievalConfig | None = None,
    ) -> None:
        self.conn = conn
        self.config = config or RetrievalConfig()
        self._memory = MemoryStore(conn)

    # ------------------------------------------------------------------
    # Episodic
    # ------------------------------------------------------------------

    def retrieve_episodic(self, ctx: RetrievalContext) -> list[ScoredEpisodic]:
        now = ctx.now or datetime.now(UTC)
        seed_ids = set(ctx.seed_episodic_ids)

        vec_distances = self._vec_distances_episodic(ctx.query_embedding)
        fts_ranks = self._fts_ranks_episodic(ctx.user_query)

        candidates: set[str] = set()
        candidates.update(vec_distances.keys())
        candidates.update(fts_ranks.keys())
        candidates.update(self._recent_ids_episodic())
        candidates.update(self._salient_ids_episodic())
        candidates.update(self._one_hop_thread_ids(seed_ids))
        candidates.update(seed_ids)  # always include seeds themselves

        if not candidates:
            return []

        eps = self._memory.episodic_by_ids(candidates)
        weights = self.config.episodic_weights()

        scored: list[ScoredEpisodic] = []
        for ep in eps:
            breakdown = ScoreBreakdown(
                vector=vector_score(vec_distances[ep.id]) if ep.id in vec_distances else 0.0,
                fts=fts_score(fts_ranks[ep.id]) if ep.id in fts_ranks else 0.0,
                temporal=temporal_score(
                    ep.ts,
                    now,
                    half_life_days=self.config.temporal_half_life_days,
                ),
                affective=affective_score(ep.affect.arousal, ctx.current_energy),
                salience=salience_score(ep.salience),
                thread=thread_score(ep, seed_ids),
            )
            scored.append(
                ScoredEpisodic(
                    memory=ep,
                    score=composite_score(breakdown, weights),
                    components=breakdown,
                )
            )

        scored.sort(key=lambda s: s.score, reverse=True)
        scored = _truncate_episodic(scored, self.config.max_episodic_chars)
        return scored[: self.config.episodic_limit]

    # ------------------------------------------------------------------
    # Semantic
    # ------------------------------------------------------------------

    def retrieve_semantic(self, ctx: RetrievalContext) -> list[ScoredSemantic]:
        now = ctx.now or datetime.now(UTC)

        vec_distances = self._vec_distances_semantic(ctx.query_embedding)
        fts_ranks = self._fts_ranks_semantic(ctx.user_query)

        candidates: set[str] = set()
        candidates.update(vec_distances.keys())
        candidates.update(fts_ranks.keys())
        candidates.update(self._recent_ids_semantic())

        if not candidates:
            return []

        sms = self._memory.semantic_by_ids(candidates)
        weights = self.config.semantic_weights()

        scored: list[ScoredSemantic] = []
        for sm in sms:
            ts = sm.last_updated or now
            breakdown = ScoreBreakdown(
                vector=vector_score(vec_distances[sm.id]) if sm.id in vec_distances else 0.0,
                fts=fts_score(fts_ranks[sm.id]) if sm.id in fts_ranks else 0.0,
                temporal=temporal_score(
                    ts, now, half_life_days=self.config.temporal_half_life_days
                ),
                affective=0.0,
                salience=0.0,
                thread=0.0,
            )
            scored.append(
                ScoredSemantic(
                    memory=sm,
                    score=composite_score(breakdown, weights),
                    components=breakdown,
                )
            )

        scored.sort(key=lambda s: s.score, reverse=True)
        scored = _truncate_semantic(scored, self.config.max_semantic_chars)
        return scored[: self.config.semantic_limit]

    # ------------------------------------------------------------------
    # Candidate-source queries
    # ------------------------------------------------------------------

    def _vec_distances_episodic(self, query_embedding: list[float] | None) -> Mapping[str, float]:
        if query_embedding is None:
            return {}
        try:
            packed = _pack_embedding(query_embedding)
        except ValueError:
            # Wrong dimension — caller built the embedding with a
            # mismatched provider. Fall back rather than crash the
            # whole turn for a misconfigured retriever.
            return {}
        rows = self.conn.execute(
            """SELECT episodic_id, distance
                 FROM episodic_vec
                WHERE embedding MATCH ? AND k = ?
                ORDER BY distance""",
            (packed, self.config.vec_pool),
        ).fetchall()
        return {row["episodic_id"]: float(row["distance"]) for row in rows}

    def _vec_distances_semantic(self, query_embedding: list[float] | None) -> Mapping[str, float]:
        if query_embedding is None:
            return {}
        try:
            packed = _pack_embedding(query_embedding)
        except ValueError:
            return {}
        rows = self.conn.execute(
            """SELECT semantic_id, distance
                 FROM semantic_vec
                WHERE embedding MATCH ? AND k = ?
                ORDER BY distance""",
            (packed, self.config.vec_pool),
        ).fetchall()
        return {row["semantic_id"]: float(row["distance"]) for row in rows}

    def _fts_ranks_episodic(self, query: str) -> Mapping[str, float]:
        sanitized = sanitize_for_fts5(query)
        if not sanitized:
            return {}
        rows = self.conn.execute(
            """SELECT episodic.id AS id, bm25(episodic_fts) AS rank
                 FROM episodic_fts
                 JOIN episodic ON episodic_fts.rowid = episodic.rowid
                WHERE episodic_fts MATCH ?
                ORDER BY rank
                LIMIT ?""",
            (sanitized, self.config.fts_pool),
        ).fetchall()
        return {row["id"]: float(row["rank"]) for row in rows}

    def _fts_ranks_semantic(self, query: str) -> Mapping[str, float]:
        sanitized = sanitize_for_fts5(query)
        if not sanitized:
            return {}
        rows = self.conn.execute(
            """SELECT semantic.id AS id, bm25(semantic_fts) AS rank
                 FROM semantic_fts
                 JOIN semantic ON semantic_fts.rowid = semantic.rowid
                WHERE semantic_fts MATCH ?
                ORDER BY rank
                LIMIT ?""",
            (sanitized, self.config.fts_pool),
        ).fetchall()
        return {row["id"]: float(row["rank"]) for row in rows}

    def _recent_ids_episodic(self) -> Sequence[str]:
        rows = self.conn.execute(
            "SELECT id FROM episodic ORDER BY ts DESC LIMIT ?",
            (self.config.recent_pool,),
        ).fetchall()
        return [row["id"] for row in rows]

    def _salient_ids_episodic(self) -> Sequence[str]:
        rows = self.conn.execute(
            "SELECT id FROM episodic ORDER BY salience DESC, ts DESC LIMIT ?",
            (self.config.salient_pool,),
        ).fetchall()
        return [row["id"] for row in rows]

    def _recent_ids_semantic(self) -> Sequence[str]:
        rows = self.conn.execute(
            "SELECT id FROM semantic ORDER BY last_updated DESC LIMIT ?",
            (self.config.recent_pool,),
        ).fetchall()
        return [row["id"] for row in rows]

    def _one_hop_thread_ids(self, seed_ids: Iterable[str]) -> Sequence[str]:
        """Return episodic IDs reachable in one hop from `seed_ids` in
        either direction (seed -> referenced ancestor, or descendant ->
        seed). Empty when there are no seeds."""
        seeds = list(seed_ids)
        if not seeds:
            return []
        placeholders = ",".join("?" * len(seeds))
        rows = self.conn.execute(
            f"""SELECT DISTINCT dst_id AS id
                  FROM episodic_references
                 WHERE src_id IN ({placeholders})
                 UNION
                SELECT DISTINCT src_id AS id
                  FROM episodic_references
                 WHERE dst_id IN ({placeholders})""",
            (*seeds, *seeds),
        ).fetchall()
        return [row["id"] for row in rows]


# ---------------------------------------------------------------------------
# Budget truncation
# ---------------------------------------------------------------------------


def _truncate_episodic(scored: list[ScoredEpisodic], max_chars: int) -> list[ScoredEpisodic]:
    """Keep top-scored records until the cumulative content length
    exceeds `max_chars`. Records are already sorted desc by score, so
    the highest-impact ones get priority for the budget."""
    out: list[ScoredEpisodic] = []
    used = 0
    for s in scored:
        cost = len(s.memory.content)
        if out and used + cost > max_chars:
            break
        out.append(s)
        used += cost
    return out


def _truncate_semantic(scored: list[ScoredSemantic], max_chars: int) -> list[ScoredSemantic]:
    out: list[ScoredSemantic] = []
    used = 0
    for s in scored:
        cost = len(s.memory.claim)
        if out and used + cost > max_chars:
            break
        out.append(s)
        used += cost
    return out
