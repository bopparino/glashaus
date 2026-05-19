"""Retrieval dataclasses.

`RetrievalContext` is the *per-call* input — query text, optional
embedding, current affect, now-timestamp, optional thread seeds.

`RetrievalConfig` is the *per-instance* config — weights, limits,
token budgets. All defaults are documented; later phases tune via
config.toml.

`ScoredEpisodic` / `ScoredSemantic` are the outputs. `ScoreBreakdown`
on each makes the composition auditable for thesis-time evaluation —
"why did this surface" is answerable from the row alone.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

from glashaus.memory.types import EpisodicMemory, SemanticMemory


@dataclass(frozen=True, slots=True)
class RetrievalContext:
    """What the retriever needs to know to produce a ranked set."""

    user_query: str
    query_embedding: list[float] | None = None
    # current_energy is from self_state.current_state.energy; used only
    # for the affective-resonance score. None = neutral.
    current_energy: float | None = None
    now: datetime | None = None
    # Episodic IDs whose threads the caller wants boosted. Phase 1
    # leaves this empty by default; Phase 2's dream cycle will populate
    # from active unresolved-thread tracking.
    seed_episodic_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RetrievalConfig:
    """Weights, half-lives, and budgets. Defaults documented.

    Weights are raw coefficients (not normalized to sum=1). They form
    a weighted sum across the six score components. Higher = more
    influence on final ranking.
    """

    # --- result limits -------------------------------------------------
    episodic_limit: int = 10
    semantic_limit: int = 8

    # --- per-source candidate pool sizes -------------------------------
    # How many candidates to pull from each source before the composite
    # score merges them. Bigger pools = better recall, slower scoring.
    vec_pool: int = 50
    fts_pool: int = 50
    recent_pool: int = 50
    salient_pool: int = 50

    # --- composite weights (raw coefficients) --------------------------
    weight_vector: float = 0.35
    weight_fts: float = 0.20
    weight_temporal: float = 0.15
    weight_affective: float = 0.10
    weight_salience: float = 0.15
    weight_thread: float = 0.05

    # --- temporal decay -----------------------------------------------
    temporal_half_life_days: float = 30.0

    # --- token budget (rough char proxy) ------------------------------
    # ~4 chars per token is a coarse English approximation. The retriever
    # truncates after sort, so high-scoring records get priority for
    # the budget.
    max_episodic_chars: int = 4000
    max_semantic_chars: int = 2000

    def episodic_weights(self) -> Mapping[str, float]:
        return {
            "vector": self.weight_vector,
            "fts": self.weight_fts,
            "temporal": self.weight_temporal,
            "affective": self.weight_affective,
            "salience": self.weight_salience,
            "thread": self.weight_thread,
        }

    def semantic_weights(self) -> Mapping[str, float]:
        # Semantic memory is fact-shaped, not emotion-shaped. Drop the
        # affective + thread components; redistribute weight to keep
        # the magnitudes comparable across the two retrieval calls.
        return {
            "vector": 0.5,
            "fts": 0.3,
            "temporal": 0.2,
            "affective": 0.0,
            "salience": 0.0,
            "thread": 0.0,
        }


@dataclass(frozen=True, slots=True)
class ScoreBreakdown:
    """Per-component score in [0, 1]. Keeping this around on the
    returned record makes "why did this surface" answerable from a
    single row, which the thesis evaluation will lean on hard."""

    vector: float = 0.0
    fts: float = 0.0
    temporal: float = 0.0
    affective: float = 0.0
    salience: float = 0.0
    thread: float = 0.0


@dataclass(frozen=True, slots=True)
class ScoredEpisodic:
    memory: EpisodicMemory
    score: float
    components: ScoreBreakdown = field(default_factory=ScoreBreakdown)


@dataclass(frozen=True, slots=True)
class ScoredSemantic:
    memory: SemanticMemory
    score: float
    components: ScoreBreakdown = field(default_factory=ScoreBreakdown)
