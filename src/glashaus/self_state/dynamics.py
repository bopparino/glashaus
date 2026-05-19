"""Drift math for self-state updates.

Pure functions. No DB, no I/O. The turn loop (chunk 5) will:

    signal: Disposition = parse_from_tool_call(...)
    new = propose_disposition(current.disposition, signal_dict)
    store.update_disposition(new, trigger_episodic_id=ep.id)

`signal_dict` is a mapping `{"warmth": 0.8, ...}` — partial updates are
fine, only the named dimensions get nudged. Everything else stays put.

Plan §4.1 mandates separate drift speeds per layer. The presets below
are the documented Phase-1 defaults; both `DriftParams` instances are
configurable later via `~/.glashaus/config.toml`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final

from glashaus.self_state.types import (
    DISPOSITION_FIELDS,
    RELATIONAL_FIELDS,
    Disposition,
    RelationalStance,
)


@dataclass(frozen=True, slots=True)
class DriftParams:
    """Smoothing factor + hard floors and ceilings (§4.2).

    `alpha` in (0, 1]: the weight given to the *new* signal in
    `next = (1-a)*current + a*signal`. Smaller a = slower drift.

    `floor`, `ceiling`: hard clip after EWMA. The plan's invariant is
    "no parameter goes to 0 or 1 from drift alone" — `floor` and
    `ceiling` enforce that on every update.
    """

    alpha: float
    floor: float
    ceiling: float

    def __post_init__(self) -> None:
        if not 0.0 < self.alpha <= 1.0:
            raise ValueError(f"alpha must be in (0, 1], got {self.alpha}")
        if not 0.0 <= self.floor < self.ceiling <= 1.0:
            raise ValueError(
                f"need 0 <= floor < ceiling <= 1, got floor={self.floor}, ceiling={self.ceiling}"
            )


# Phase 1 defaults. Re-tune via config later.
#
# DISPOSITION: §4.1 says "slow (weeks)". alpha=0.05 means after ~14
# turns of a consistent signal, the value moves ~50% of the way toward
# the signal. With one turn per day that's two-week half-life.
#
# RELATIONAL: §4.1 says "medium (days)". alpha=0.15 -> ~4-turn
# half-life, i.e. days of meaningful interaction.
#
# Floors at 0.05 and ceilings at 0.95 keep the hard guard from §4.2:
# values can't reach exactly 0 or 1 through drift alone.
DISPOSITION_DRIFT: Final[DriftParams] = DriftParams(alpha=0.05, floor=0.05, ceiling=0.95)
RELATIONAL_DRIFT: Final[DriftParams] = DriftParams(alpha=0.15, floor=0.05, ceiling=0.95)


def bounded_ewma(current: float, signal: float, params: DriftParams) -> float:
    """One EWMA step, clipped to `[floor, ceiling]`.

    `next = clip(a*signal + (1-a)*current, [floor, ceiling])`
    """
    if not 0.0 <= signal <= 1.0:
        raise ValueError(f"signal must be in [0, 1], got {signal}")
    blended = params.alpha * signal + (1.0 - params.alpha) * current
    return max(params.floor, min(params.ceiling, blended))


def _apply_signals(
    current_values: dict[str, float],
    signals: dict[str, float],
    params: DriftParams,
) -> dict[str, float]:
    """Apply `bounded_ewma` to each named dimension. Fields not in
    `signals` are returned unchanged. Unknown keys in `signals` raise —
    silent typos here would be exactly the kind of bug that quietly rots
    the trajectory data."""
    unknown = set(signals) - set(current_values)
    if unknown:
        raise ValueError(f"unknown signal keys: {sorted(unknown)}")
    out: dict[str, float] = dict(current_values)
    for name, sig in signals.items():
        out[name] = bounded_ewma(current_values[name], sig, params)
    return out


def propose_disposition(
    current: Disposition,
    signals: dict[str, float],
    params: DriftParams = DISPOSITION_DRIFT,
) -> Disposition:
    """Compute next-step Disposition given partial per-dimension signals.

    Returns a new dataclass with `updated_at = now`. The store
    decides which numeric fields actually changed and logs accordingly.
    """
    next_vals = _apply_signals(current.as_dict(), signals, params)
    return Disposition(
        curiosity=next_vals["curiosity"],
        playfulness=next_vals["playfulness"],
        reserve=next_vals["reserve"],
        warmth=next_vals["warmth"],
        directness=next_vals["directness"],
        updated_at=datetime.now(UTC),
    )


def propose_relational_stance(
    current: RelationalStance,
    signals: dict[str, float],
    params: DriftParams = RELATIONAL_DRIFT,
) -> RelationalStance:
    """Same shape as propose_disposition. `history_markers` is not
    drift-driven; it's append-managed by the turn loop separately and
    passed through here unchanged.
    """
    next_vals = _apply_signals(current.as_dict(), signals, params)
    return RelationalStance(
        trust=next_vals["trust"],
        familiarity=next_vals["familiarity"],
        current_warmth=next_vals["current_warmth"],
        history_markers=current.history_markers,
        updated_at=datetime.now(UTC),
    )


# Keep field lists discoverable from this module too, so callers can
# iterate without reaching into `types`.
__all__ = [
    "DISPOSITION_DRIFT",
    "DISPOSITION_FIELDS",
    "RELATIONAL_DRIFT",
    "RELATIONAL_FIELDS",
    "DriftParams",
    "bounded_ewma",
    "propose_disposition",
    "propose_relational_stance",
]
