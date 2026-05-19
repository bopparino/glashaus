"""Translate parsed tool-call deltas into store writes.

This is where the drift math lives at the *application* layer — drift
inputs from the model become target+alpha for `bounded_ewma`, then the
result lands in the singleton self_state row plus an event-log entry.

Design contracts:

- `apply_record_turn` writes one episodic record and returns it.
- `apply_self_state_update` is best-effort across the layers: any
  failure in one layer (e.g., relational_stance) should not block
  others (e.g., opinions append). The turn loop calls this *after*
  the episodic is durable.
- All store writes pass `trigger_episodic_id` so the event-log entries
  cite the episode that caused them.

The apply module has no awareness of the provider or the streaming
state — it operates on already-parsed dataclasses.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from glashaus.memory.store import MemoryStore
from glashaus.memory.types import Affect, EpisodicMemory
from glashaus.self_state.dynamics import (
    DISPOSITION_DRIFT,
    RELATIONAL_DRIFT,
    DriftParams,
    bounded_ewma,
)
from glashaus.self_state.store import SelfStateStore
from glashaus.self_state.types import (
    CurrentState,
    Disposition,
    RelationalStance,
)
from glashaus.turn.parse import (
    CurrentStateDelta,
    DispositionDriftSignal,
    RelationalStanceDelta,
    SelfStateUpdate,
    TurnRecord,
)

# ============================================================================
# Episodic write
# ============================================================================


def apply_record_turn(
    record: TurnRecord,
    *,
    user_id: str,
    agent_id: str,
    channel: str,
    memory: MemoryStore,
    embedding: Sequence[float] | None = None,
) -> EpisodicMemory:
    """Persist the episodic record from a parsed `record_turn` call.

    The `turn_id` from the tool call is **not** the episodic id — it's a
    transient identifier used to dedup `update_self_state` retries
    against `record_turn`. The episodic gets a fresh UUID.
    """
    return memory.write_episodic(
        content=record.episode_summary,
        user_id=user_id,
        agent_id=agent_id,
        affect=Affect(
            valence=record.valence,
            arousal=record.arousal,
            dominant_emotion=record.dominant_emotion,
        ),
        salience=record.salience,
        topics=record.topics,
        references=record.references,
        channel=channel,
        embedding=embedding,
        id=str(uuid.uuid4()),
    )


# ============================================================================
# Self-state update
# ============================================================================


@dataclass(frozen=True, slots=True)
class ApplyReport:
    """What apply_self_state_update actually did. Useful for logging
    and (eventually) the turn loop's deferral bookkeeping.

    Each `*_applied` flag indicates the section was *attempted and
    succeeded*. Failures append to `errors` with the section name and
    the exception message; the next section still runs.
    """

    disposition_applied: bool = False
    current_state_applied: bool = False
    relational_stance_applied: bool = False
    opinions_appended: int = 0
    quirks_observed: int = 0
    errors: tuple[str, ...] = field(default_factory=tuple)

    @property
    def any_applied(self) -> bool:
        return (
            self.disposition_applied
            or self.current_state_applied
            or self.relational_stance_applied
            or self.opinions_appended > 0
            or self.quirks_observed > 0
        )


def apply_self_state_update(
    update: SelfStateUpdate,
    *,
    self_state: SelfStateStore,
    trigger_episodic_id: str | None = None,
) -> ApplyReport:
    """Translate parsed deltas into store writes. Best-effort: a failure
    in one section does NOT prevent the others from running. Returns an
    `ApplyReport` summarizing what happened.

    Per the chunk 5 spec, the turn loop's policy for the overall call
    failing is "log + defer to next turn opening" — that policy lives in
    `loop.py`. This function just reports.
    """
    errors: list[str] = []

    disposition_applied = False
    if update.disposition_drift:
        try:
            new_disp = _apply_disposition_drifts(
                self_state.get_disposition(),
                update.disposition_drift,
            )
            self_state.update_disposition(new_disp, trigger_episodic_id=trigger_episodic_id)
            disposition_applied = True
        except Exception as e:
            errors.append(f"disposition_drift: {e}")

    current_state_applied = False
    if update.current_state is not None:
        try:
            new_cs = _apply_current_state(self_state.get_current_state(), update.current_state)
            self_state.update_current_state(new_cs, trigger_episodic_id=trigger_episodic_id)
            current_state_applied = True
        except Exception as e:
            errors.append(f"current_state: {e}")

    relational_applied = False
    if update.relational_stance is not None:
        try:
            new_rel = _apply_relational_stance(
                self_state.get_relational_stance(), update.relational_stance
            )
            self_state.update_relational_stance(new_rel, trigger_episodic_id=trigger_episodic_id)
            relational_applied = True
        except Exception as e:
            errors.append(f"relational_stance: {e}")

    opinions_appended = 0
    for i, op in enumerate(update.formed_opinions):
        try:
            self_state.append_opinion(
                claim=op.claim,
                evidence_ids=op.evidence_ids,
            )
            opinions_appended += 1
        except Exception as e:
            errors.append(f"formed_opinions[{i}]: {e}")

    quirks_observed = 0
    for i, q in enumerate(update.quirks):
        try:
            self_state.append_or_increment_quirk(pattern=q.pattern)
            quirks_observed += 1
        except Exception as e:
            errors.append(f"quirks[{i}]: {e}")

    return ApplyReport(
        disposition_applied=disposition_applied,
        current_state_applied=current_state_applied,
        relational_stance_applied=relational_applied,
        opinions_appended=opinions_appended,
        quirks_observed=quirks_observed,
        errors=tuple(errors),
    )


# ============================================================================
# Per-layer translators (drift signals → new full dataclass)
# ============================================================================


def _apply_disposition_drifts(
    current: Disposition,
    signals: Sequence[DispositionDriftSignal],
) -> Disposition:
    """Apply each drift signal as bounded_ewma with alpha scaled by
    magnitude_weight. Target is direction-determined: +1 → 1.0, -1 → 0.0.

    Multiple signals for the same dimension in one turn are applied
    in sequence — the model emitting the same dim twice is unusual but
    not invalid.
    """
    values = current.as_dict()
    for sig in signals:
        target = 1.0 if sig.direction == 1 else 0.0
        scaled = _scale_alpha(DISPOSITION_DRIFT, sig.magnitude_weight)
        values[sig.dimension] = bounded_ewma(values[sig.dimension], target, scaled)
    return Disposition(
        curiosity=values["curiosity"],
        playfulness=values["playfulness"],
        reserve=values["reserve"],
        warmth=values["warmth"],
        directness=values["directness"],
        updated_at=datetime.now(UTC),
    )


def _apply_current_state(current: CurrentState, delta: CurrentStateDelta) -> CurrentState:
    """current_state is per-session and direct-set; no EWMA. Energy is
    clipped to the dataclass invariants by the post_init."""
    return CurrentState(
        mood=delta.mood if delta.mood is not None else current.mood,
        energy=delta.energy if delta.energy is not None else current.energy,
        preoccupations=(
            delta.preoccupations if delta.preoccupations is not None else current.preoccupations
        ),
        updated_at=datetime.now(UTC),
    )


def _apply_relational_stance(
    current: RelationalStance, delta: RelationalStanceDelta
) -> RelationalStance:
    """trust_drift and familiarity_drift translate to EWMA toward 1.0
    with alpha scaled by the drift magnitude. current_warmth is an
    absolute set, clipped to RELATIONAL_DRIFT's floor/ceiling so the
    "no parameter goes to 0 or 1 from drift alone" invariant holds even
    for the direct-set path. history_marker appends to history_markers.
    """
    if delta.trust_drift is not None:
        trust = bounded_ewma(
            current.trust,
            1.0,
            _scale_alpha(RELATIONAL_DRIFT, delta.trust_drift),
        )
    else:
        trust = current.trust

    if delta.familiarity_drift is not None:
        familiarity = bounded_ewma(
            current.familiarity,
            1.0,
            _scale_alpha(RELATIONAL_DRIFT, delta.familiarity_drift),
        )
    else:
        familiarity = current.familiarity

    if delta.current_warmth is not None:
        # Absolute set, clipped to the same floor/ceiling so we honor
        # §4.2 even on a direct path.
        cw = max(
            RELATIONAL_DRIFT.floor,
            min(RELATIONAL_DRIFT.ceiling, delta.current_warmth),
        )
    else:
        cw = current.current_warmth

    history_markers = current.history_markers
    if delta.history_marker is not None:
        history_markers = (*current.history_markers, delta.history_marker)

    return RelationalStance(
        trust=trust,
        familiarity=familiarity,
        current_warmth=cw,
        history_markers=history_markers,
        updated_at=datetime.now(UTC),
    )


def _scale_alpha(base: DriftParams, magnitude: float) -> DriftParams:
    """Return DriftParams with alpha scaled by `magnitude` (clamped to
    a small positive floor so we never construct an invalid alpha=0)."""
    scaled = max(1e-6, min(1.0, base.alpha * magnitude))
    return DriftParams(alpha=scaled, floor=base.floor, ceiling=base.ceiling)


# Public re-exports for tests / type signatures.
__all__ = [
    "ApplyReport",
    "apply_record_turn",
    "apply_self_state_update",
]
