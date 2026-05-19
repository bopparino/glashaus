"""Self-state dataclasses (§4).

One dataclass per layer, plus the composite `SelfState` and the
append-only `FormedOpinion`, `Quirk`, and `SelfStateEvent` records.

Validation lives in `__post_init__` so callers (the turn loop, the
wizard) get a clean `ValueError` at construction rather than a
`sqlite3.IntegrityError` deep inside the store. The SQL CHECK
constraints backstop us.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


def _check_unit(name: str, value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} must be in [0, 1], got {value!r}")


# --------------------------------------------------------------------------
# IdentityCore — drift speed: almost never. (§4.1)
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class IdentityCore:
    name: str
    voice: str
    base_values: tuple[str, ...]
    updated_at: datetime

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("identity_core.name must be non-empty")
        if not self.voice:
            raise ValueError("identity_core.voice must be non-empty")


# --------------------------------------------------------------------------
# Disposition — drift speed: slow (weeks), bounded EWMA. (§4.1)
# --------------------------------------------------------------------------

# Names of the five disposition dimensions in storage order. Used by
# dynamics + the event-log writer to enumerate fields without hardcoding
# the list in three places.
DISPOSITION_FIELDS: tuple[str, ...] = (
    "curiosity",
    "playfulness",
    "reserve",
    "warmth",
    "directness",
)


@dataclass(frozen=True, slots=True)
class Disposition:
    curiosity: float
    playfulness: float
    reserve: float
    warmth: float
    directness: float
    updated_at: datetime

    def __post_init__(self) -> None:
        for name in DISPOSITION_FIELDS:
            _check_unit(f"disposition.{name}", getattr(self, name))

    def as_dict(self) -> dict[str, float]:
        return {name: float(getattr(self, name)) for name in DISPOSITION_FIELDS}


# --------------------------------------------------------------------------
# CurrentState — drift speed: per session. (§4.1)
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CurrentState:
    mood: str
    energy: float
    preoccupations: tuple[str, ...]
    updated_at: datetime

    def __post_init__(self) -> None:
        _check_unit("current_state.energy", self.energy)
        if not self.mood:
            raise ValueError("current_state.mood must be non-empty")


# --------------------------------------------------------------------------
# RelationalStance — drift speed: medium (days). (§4.1)
# --------------------------------------------------------------------------

RELATIONAL_FIELDS: tuple[str, ...] = ("trust", "familiarity", "current_warmth")


@dataclass(frozen=True, slots=True)
class RelationalStance:
    trust: float
    familiarity: float
    current_warmth: float
    history_markers: tuple[str, ...]
    updated_at: datetime

    def __post_init__(self) -> None:
        for name in RELATIONAL_FIELDS:
            _check_unit(f"relational_stance.{name}", getattr(self, name))

    def as_dict(self) -> dict[str, float]:
        return {name: float(getattr(self, name)) for name in RELATIONAL_FIELDS}


# --------------------------------------------------------------------------
# Append-only records.
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FormedOpinion:
    """A claim the agent has formed about the user or the world (§4)."""

    id: str
    claim: str
    formed_at: datetime
    evidence_ids: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("formed_opinion.id must be non-empty")
        if not self.claim:
            raise ValueError("formed_opinion.claim must be non-empty")


@dataclass(frozen=True, slots=True)
class Quirk:
    """A behavioral pattern the agent has noticed in itself (§4)."""

    id: str
    pattern: str
    observed_count: int
    first_seen: datetime
    last_seen: datetime

    def __post_init__(self) -> None:
        if not self.pattern:
            raise ValueError("quirk.pattern must be non-empty")
        if self.observed_count < 1:
            raise ValueError("quirk.observed_count must be >= 1")


@dataclass(frozen=True, slots=True)
class SelfStateEvent:
    """One numeric self-state change (one row of self_state_events)."""

    id: int
    ts: datetime
    field_path: str
    old_value: float
    new_value: float
    trigger_episodic_id: str | None


# --------------------------------------------------------------------------
# Composite.
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SelfState:
    identity_core: IdentityCore
    disposition: Disposition
    current_state: CurrentState
    relational_stance: RelationalStance
    formed_opinions: tuple[FormedOpinion, ...] = field(default_factory=tuple)
    quirks: tuple[Quirk, ...] = field(default_factory=tuple)
