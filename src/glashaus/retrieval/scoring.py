"""Pure scoring functions.

All return floats in [0, 1] (or close enough that the composite stays
sensible). No DB access; no LLM calls. Trivially unit-testable.

The composition is a weighted sum over the six components — flat,
explicit, easy to inspect.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime

from glashaus.memory.types import EpisodicMemory
from glashaus.retrieval.types import ScoreBreakdown

# Module-level: removes FTS5 metacharacters before passing user input to
# `MATCH`. FTS5's query syntax interprets quotes, asterisks, hyphens,
# colons, parentheses, etc. — raw user text containing any of those
# will either fail to parse or worse, surface unintended matches.
_FTS_STRIP_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)


def sanitize_for_fts5(query: str, *, max_words: int = 100) -> str:
    """Strip FTS5 metacharacters and collapse whitespace. Returns
    empty string if nothing useful remains — the caller should skip
    the FTS branch entirely in that case rather than send `MATCH ''`."""
    stripped = _FTS_STRIP_RE.sub(" ", query)
    words = stripped.split()
    return " ".join(words[:max_words])


# ---------------------------------------------------------------------------
# Per-component scores
# ---------------------------------------------------------------------------


def vector_score(distance: float, *, max_distance: float = 2.0) -> float:
    """Convert a vec0 distance to a similarity in [0, 1].

    vec0's default metric is L2; cosine-like distances also fit this
    shape with `max_distance` adjusted. Smaller distance -> higher
    similarity. Negative or out-of-range distances are clamped.
    """
    if distance < 0:
        return 1.0
    return max(0.0, 1.0 - distance / max_distance)


def fts_score(bm25_rank: float, *, scale: float = 10.0) -> float:
    """Convert FTS5 bm25 rank into a similarity in [0, 1].

    SQLite's `bm25()` returns negative floats, more-negative = better
    match. We take absolute value and normalize against `scale` (the
    "approximate worst rank we expect to see"). The exact scale doesn't
    matter for ranking — only for inter-component comparability.
    """
    if bm25_rank >= 0:
        return 0.0
    return min(1.0, abs(bm25_rank) / scale)


def temporal_score(ts: datetime, now: datetime, *, half_life_days: float = 30.0) -> float:
    """Exponential decay: score = 0.5 ** (days_since / half_life).

    Records timestamped *in the future* (clock skew, edge case) score
    1.0 — never punish a record for the wall clock being ahead.
    """
    if ts >= now:
        return 1.0
    if half_life_days <= 0:
        return 0.0
    delta_days = (now - ts).total_seconds() / 86400.0
    return float(0.5 ** (delta_days / half_life_days))


def affective_score(episodic_arousal: float, current_energy: float | None) -> float:
    """Phase-1 affective resonance: how close is this episode's arousal
    to the agent's current energy level?

    Returns 0.5 (neutral) when current_energy is None — i.e., we don't
    know the current state, so this component shouldn't bias either
    direction.

    Phase 2 may extend this with dominant_emotion ↔ current_state.mood
    matching (LLM- or embedding-based), but for Phase 1 a deterministic
    arousal-energy delta is testable and useful.
    """
    if current_energy is None:
        return 0.5
    return float(1.0 - abs(episodic_arousal - current_energy))


def salience_score(salience: float) -> float:
    """Identity for Phase 1. Some future tuning might use a curve like
    `salience ** 0.5` to compress the top end, but the §3.3 plan-described
    semantics — "heavy episodes surface more easily" — is satisfied by
    passing salience straight through to the composite."""
    return max(0.0, min(1.0, salience))


def thread_score(ep: EpisodicMemory, seed_ids: set[str]) -> float:
    """1.0 if this episodic is in the seed set; 0.7 if it references
    one of the seeds; 0.0 otherwise.

    Reverse direction (a seed referencing this episodic) isn't checked
    in Phase 1 — the candidate set already pulls referenced ancestors
    in via a separate one-hop query in the retriever, so the score
    only needs to discriminate among candidates already in the pool.
    """
    if ep.id in seed_ids:
        return 1.0
    if seed_ids and seed_ids.intersection(ep.references):
        return 0.7
    return 0.0


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------


def composite_score(breakdown: ScoreBreakdown, weights: Mapping[str, float]) -> float:
    """Weighted sum across the six components.

    `weights` keys must be a subset of:
        vector, fts, temporal, affective, salience, thread

    Missing keys default to 0. Negative weights are allowed (suppress a
    component) but unusual.
    """
    return (
        breakdown.vector * weights.get("vector", 0.0)
        + breakdown.fts * weights.get("fts", 0.0)
        + breakdown.temporal * weights.get("temporal", 0.0)
        + breakdown.affective * weights.get("affective", 0.0)
        + breakdown.salience * weights.get("salience", 0.0)
        + breakdown.thread * weights.get("thread", 0.0)
    )
