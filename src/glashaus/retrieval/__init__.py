"""Hybrid retrieval: episodic + semantic.

Plan §3.4 composition:

- Vector similarity — for topical match (via sqlite-vec)
- Temporal proximity — for recency (exponential decay)
- Affective weight — for emotional resonance with current moment
- Thread following — via `references`
- Salience boost — heavy episodes surface more easily
- FTS5 keyword match — non-plan but covered by the same hybrid

Plus a token-budget truncation step so the assembled prompt stays
under a turn's context budget.

The vec0 branch "falls back when null" — a `RetrievalContext` with
`query_embedding=None`, or a candidate episodic with no row in
`episodic_vec`, contributes 0 to the vector score. Other components
still produce a ranked, deduplicated set.

The retriever is pure-SQL + Python scoring; no LLM calls. The turn
loop generates the query embedding and passes it in; the retriever
doesn't know about embedding providers.
"""

from glashaus.retrieval.retriever import HybridRetriever
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

__all__ = [
    "HybridRetriever",
    "RetrievalConfig",
    "RetrievalContext",
    "ScoreBreakdown",
    "ScoredEpisodic",
    "ScoredSemantic",
    "affective_score",
    "composite_score",
    "fts_score",
    "salience_score",
    "sanitize_for_fts5",
    "temporal_score",
    "thread_score",
    "vector_score",
]
