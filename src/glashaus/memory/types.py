"""Dataclasses for the memory layer — §3.1 EpisodicMemory, §3.2 SemanticMemory.

These are domain types, deliberately decoupled from the SQL row shape.
Conversion happens in `MemoryStore` (one place to keep that mapping
under control).

Validation lives here too: bounded scalars are checked in
`__post_init__` so callers get a clear `ValueError` at construction
time rather than a `sqlite3.IntegrityError` deep inside the write path.
The SQL CHECK constraints still backstop us — they catch any way a
row sneaks past the dataclass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


def _check_unit(name: str, value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} must be in [0, 1], got {value!r}")


def _check_signed_unit(name: str, value: float) -> None:
    if not -1.0 <= value <= 1.0:
        raise ValueError(f"{name} must be in [-1, 1], got {value!r}")


@dataclass(frozen=True, slots=True)
class Affect:
    """Nested affect block (§3.1)."""

    valence: float
    arousal: float
    dominant_emotion: str

    def __post_init__(self) -> None:
        _check_signed_unit("valence", self.valence)
        _check_unit("arousal", self.arousal)
        if not self.dominant_emotion:
            raise ValueError("dominant_emotion must be non-empty")


@dataclass(frozen=True, slots=True)
class EpisodicMemory:
    """One record of something that happened (§3.1).

    `topics` and `references` are tuples so the type is hashable / safely
    sharable. `has_embedding` is derived on read: True iff an entry
    exists in `episodic_vec` for this id. It is **not** part of write-
    side payloads — pass an `embedding` arg to `MemoryStore.write_episodic`
    instead.
    """

    id: str
    ts: datetime
    content: str
    user_id: str
    agent_id: str
    affect: Affect
    salience: float
    topics: tuple[str, ...] = field(default_factory=tuple)
    channel: str = "cli"
    references: tuple[str, ...] = field(default_factory=tuple)
    has_embedding: bool = False

    def __post_init__(self) -> None:
        _check_unit("salience", self.salience)
        if not self.id:
            raise ValueError("id must be non-empty")
        if not self.content:
            raise ValueError("content must be non-empty")
        if not self.channel:
            raise ValueError("channel must be non-empty")


@dataclass(frozen=True, slots=True)
class SemanticMemory:
    """One derived claim with confidence and evidence pointers (§3.2)."""

    id: str
    claim: str
    confidence: float
    evidence: tuple[str, ...] = field(default_factory=tuple)
    last_updated: datetime | None = None
    contradictions: tuple[str, ...] = field(default_factory=tuple)
    has_embedding: bool = False

    def __post_init__(self) -> None:
        _check_unit("confidence", self.confidence)
        if not self.id:
            raise ValueError("id must be non-empty")
        if not self.claim:
            raise ValueError("claim must be non-empty")
