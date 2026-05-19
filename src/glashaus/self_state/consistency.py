"""Identity-consistency check (§4.2).

Pure function. Takes a candidate `SelfState` and an `anchor`
`SelfState` (typically a snapshot from the wizard-set seed values),
returns a list of `ConsistencyViolation` records.

Scope, deliberately tight for chunk 3:

- **Numeric-layer drift only.** Compares each numeric field on
  `disposition` and `relational_stance` against its anchor value.
  Violations escalate from `warning` to `error` based on the magnitude
  of the absolute delta.
- **identity_core.base_values is not yet checked.** Comparing free-text
  base_values like "respect autonomy" against the agent's current
  behavior requires an LLM judgment call. That branch will be added in
  Phase 2 alongside the dream-cycle reflection step.

This function is not called anywhere yet. It's built so Phase 2's
dream cycle can invoke it without scope creep at that point.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from glashaus.self_state.types import (
    DISPOSITION_FIELDS,
    RELATIONAL_FIELDS,
    SelfState,
)

Severity = Literal["warning", "error"]


@dataclass(frozen=True, slots=True)
class ConsistencyViolation:
    field_path: str
    candidate: float
    anchor: float
    delta: float
    severity: Severity


def check_numeric_consistency(
    candidate: SelfState,
    anchor: SelfState,
    *,
    warning_threshold: float = 0.3,
    error_threshold: float = 0.5,
) -> list[ConsistencyViolation]:
    """Return one violation per numeric field whose drift from anchor
    exceeds `warning_threshold`. Severity escalates to `"error"` at
    `error_threshold`.

    Both thresholds are absolute (|candidate - anchor|), on the 0..1
    scale. The Phase-1 defaults are picked to give the dream-cycle
    reflection something to react to without false-positive flooding;
    Phase 2 will likely tune them.
    """
    if not 0.0 <= warning_threshold <= error_threshold <= 1.0:
        raise ValueError(
            f"need 0 <= warning <= error <= 1, got "
            f"warning={warning_threshold}, error={error_threshold}"
        )

    violations: list[ConsistencyViolation] = []

    for name in DISPOSITION_FIELDS:
        cand = float(getattr(candidate.disposition, name))
        anch = float(getattr(anchor.disposition, name))
        v = _maybe_violation(
            f"disposition.{name}",
            cand,
            anch,
            warning_threshold,
            error_threshold,
        )
        if v is not None:
            violations.append(v)

    for name in RELATIONAL_FIELDS:
        cand = float(getattr(candidate.relational_stance, name))
        anch = float(getattr(anchor.relational_stance, name))
        v = _maybe_violation(
            f"relational_stance.{name}",
            cand,
            anch,
            warning_threshold,
            error_threshold,
        )
        if v is not None:
            violations.append(v)

    # TODO(phase-2): textual base_values consistency via LLM judgment.
    # Compare candidate.identity_core.base_values against patterns in
    # candidate.formed_opinions and candidate.current_state.mood. The
    # call site is the dream-cycle reflection step.

    return violations


def _maybe_violation(
    field_path: str,
    candidate: float,
    anchor: float,
    warning_threshold: float,
    error_threshold: float,
) -> ConsistencyViolation | None:
    delta = candidate - anchor
    abs_delta = abs(delta)
    if abs_delta < warning_threshold:
        return None
    severity: Severity = "error" if abs_delta >= error_threshold else "warning"
    return ConsistencyViolation(
        field_path=field_path,
        candidate=candidate,
        anchor=anchor,
        delta=delta,
        severity=severity,
    )
