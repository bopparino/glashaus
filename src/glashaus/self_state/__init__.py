"""Self-state: the agent's evolving model of itself (§4).

Module layout mirrors the chunk-2 memory separation:

- [`types`][glashaus.self_state.types] — dataclasses, one per drift-speed
  layer plus the append-only `FormedOpinion` / `Quirk` records.
- [`store`][glashaus.self_state.store] — pure SQL CRUD. Accepts fully-
  computed values; logs numeric-field deltas to `self_state_events`.
- [`dynamics`][glashaus.self_state.dynamics] — bounded EWMA and the
  drift-parameter presets per layer. Independently testable; doesn't
  touch the DB.
- [`consistency`][glashaus.self_state.consistency] — pure check that
  compares a candidate self-state against an anchor, flagging numeric
  drift violations. Ready for the dream cycle in Phase 2 to call but
  not wired anywhere yet.

The store deliberately has no reference to `MemoryStore`. Self-state
reads are full-state-or-by-layer; nothing about them derives from
episodic memory on read.
"""

from glashaus.self_state.consistency import (
    ConsistencyViolation,
    check_numeric_consistency,
)
from glashaus.self_state.dynamics import (
    DISPOSITION_DRIFT,
    RELATIONAL_DRIFT,
    DriftParams,
    bounded_ewma,
    propose_disposition,
    propose_relational_stance,
)
from glashaus.self_state.store import SelfStateStore
from glashaus.self_state.types import (
    CurrentState,
    Disposition,
    FormedOpinion,
    IdentityCore,
    Quirk,
    RelationalStance,
    SelfState,
    SelfStateEvent,
)

__all__ = [
    "DISPOSITION_DRIFT",
    "RELATIONAL_DRIFT",
    "ConsistencyViolation",
    "CurrentState",
    "Disposition",
    "DriftParams",
    "FormedOpinion",
    "IdentityCore",
    "Quirk",
    "RelationalStance",
    "SelfState",
    "SelfStateEvent",
    "SelfStateStore",
    "bounded_ewma",
    "check_numeric_consistency",
    "propose_disposition",
    "propose_relational_stance",
]
