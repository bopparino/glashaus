"""Parse tool-call arguments into typed dataclasses.

The provider hands us `dict[str, Any]` from JSON. Parse converts that
into frozen-slots dataclasses with explicit fields. We also validate
beyond what the JSON schema can express:

- enum membership for disposition.dimension
- direction strictly in {-1, +1}
- numeric ranges
- formed_opinions evidence_ids non-empty (also schema-enforced, but
  this is the second layer)
- required fields present

Validation failures raise `ToolCallParseError` so the provider retry
helper from chunk 4 catches them and re-tries with the nudge block.

The parsers do NOT touch storage; they're pure value transformations.
The `apply` module is what writes to stores.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from glashaus.providers.base import ToolCallParseError
from glashaus.self_state.types import DISPOSITION_FIELDS

# ============================================================================
# Dataclasses
# ============================================================================


@dataclass(frozen=True, slots=True)
class TurnRecord:
    """Output of `parse_record_turn` — the episodic write payload."""

    turn_id: str
    episode_summary: str
    valence: float
    arousal: float
    dominant_emotion: str
    salience: float
    topics: tuple[str, ...] = ()
    references: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CurrentStateDelta:
    """Proposed partial update to current_state.

    Each field is optional — only set fields are applied. `None` means
    "leave that field alone."
    """

    mood: str | None = None
    energy: float | None = None
    preoccupations: tuple[str, ...] | None = None


@dataclass(frozen=True, slots=True)
class RelationalStanceDelta:
    """Proposed relational-stance changes.

    `trust_drift` / `familiarity_drift` are signal magnitudes in [0, 1].
    The apply layer translates them into bounded EWMA toward target=1.0
    with alpha scaled by the magnitude.

    `current_warmth` is an absolute new value (clipped). Faster moving
    than trust/familiarity by design.

    `history_marker`, if present, is appended to the existing
    history_markers tuple.
    """

    trust_drift: float | None = None
    familiarity_drift: float | None = None
    current_warmth: float | None = None
    history_marker: str | None = None


@dataclass(frozen=True, slots=True)
class DispositionDriftSignal:
    """One drift signal for one disposition dimension.

    `direction` is strictly +1 or -1; `magnitude_weight` is in [0, 1].
    The apply layer translates to EWMA: target = 1.0 if direction==+1
    else 0.0, alpha = base_alpha * magnitude_weight.
    """

    dimension: str
    direction: int  # -1 or +1
    magnitude_weight: float


@dataclass(frozen=True, slots=True)
class OpinionDelta:
    """One formed opinion to append. `evidence_ids` is non-empty."""

    claim: str
    evidence_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class QuirkDelta:
    """One quirk observation to either insert or increment."""

    pattern: str


@dataclass(frozen=True, slots=True)
class SelfStateUpdate:
    """Output of `parse_update_self_state` — the full set of proposed
    deltas. Every section is optional except `turn_id`."""

    turn_id: str
    current_state: CurrentStateDelta | None = None
    relational_stance: RelationalStanceDelta | None = None
    disposition_drift: tuple[DispositionDriftSignal, ...] = field(default_factory=tuple)
    formed_opinions: tuple[OpinionDelta, ...] = field(default_factory=tuple)
    quirks: tuple[QuirkDelta, ...] = field(default_factory=tuple)


# ============================================================================
# Parsers
# ============================================================================


def parse_record_turn(args: dict[str, Any]) -> TurnRecord:
    """Validate + project `record_turn` arguments into a `TurnRecord`.
    Raises `ToolCallParseError` on any validation failure."""
    _require_keys(args, {"turn_id", "episode_summary", "affect", "salience"}, "record_turn")
    turn_id = _str(args, "turn_id", "record_turn")
    episode_summary = _str(args, "episode_summary", "record_turn")
    salience = _unit(args, "salience", "record_turn")

    affect = args["affect"]
    if not isinstance(affect, dict):
        raise ToolCallParseError(
            "record_turn.affect must be an object",
            tool_name="record_turn",
            raw_arguments=repr(affect),
        )
    _require_keys(
        affect,
        {"valence", "arousal", "dominant_emotion"},
        "record_turn.affect",
    )
    valence = _signed_unit(affect, "valence", "record_turn.affect")
    arousal = _unit(affect, "arousal", "record_turn.affect")
    dominant_emotion = _str(affect, "dominant_emotion", "record_turn.affect")

    topics = tuple(_str_list(args.get("topics", []), "record_turn.topics"))
    references = tuple(_str_list(args.get("references", []), "record_turn.references"))

    return TurnRecord(
        turn_id=turn_id,
        episode_summary=episode_summary,
        valence=valence,
        arousal=arousal,
        dominant_emotion=dominant_emotion,
        salience=salience,
        topics=topics,
        references=references,
    )


def parse_update_self_state(args: dict[str, Any]) -> SelfStateUpdate:
    """Validate + project `update_self_state` arguments into a
    `SelfStateUpdate`. Raises `ToolCallParseError` on any validation
    failure."""
    if "turn_id" not in args:
        raise ToolCallParseError(
            "update_self_state.turn_id is required",
            tool_name="update_self_state",
            raw_arguments=repr(args),
        )
    turn_id = _str(args, "turn_id", "update_self_state")

    # The schema's additionalProperties:false already excludes
    # identity_core, but defense in depth: explicitly reject here too.
    forbidden = {"identity_core", "identity_name", "identity_voice", "base_values"}
    bad = forbidden & set(args.keys())
    if bad:
        raise ToolCallParseError(
            f"update_self_state may not modify identity_core fields: {sorted(bad)}",
            tool_name="update_self_state",
            raw_arguments=repr(args),
        )

    cs = _parse_current_state(args.get("current_state"))
    rel = _parse_relational_stance(args.get("relational_stance"))
    disp = _parse_disposition_drift(args.get("disposition_drift", []))
    opinions = _parse_opinions(args.get("formed_opinions", []))
    quirks = _parse_quirks(args.get("quirks", []))

    return SelfStateUpdate(
        turn_id=turn_id,
        current_state=cs,
        relational_stance=rel,
        disposition_drift=disp,
        formed_opinions=opinions,
        quirks=quirks,
    )


# ============================================================================
# Section parsers
# ============================================================================


def _parse_current_state(raw: Any) -> CurrentStateDelta | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ToolCallParseError(
            "current_state must be an object",
            tool_name="update_self_state",
            raw_arguments=repr(raw),
        )
    mood = raw.get("mood")
    if mood is not None and not isinstance(mood, str):
        raise ToolCallParseError(
            "current_state.mood must be a string",
            tool_name="update_self_state",
            raw_arguments=repr(raw),
        )
    energy = raw.get("energy")
    if energy is not None:
        energy = _unit({"energy": energy}, "energy", "current_state")
    preoccupations: tuple[str, ...] | None = None
    if "preoccupations" in raw:
        preoccupations = tuple(_str_list(raw["preoccupations"], "current_state.preoccupations"))
    return CurrentStateDelta(mood=mood, energy=energy, preoccupations=preoccupations)


def _parse_relational_stance(raw: Any) -> RelationalStanceDelta | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ToolCallParseError(
            "relational_stance must be an object",
            tool_name="update_self_state",
            raw_arguments=repr(raw),
        )
    trust_drift = (
        _unit({"trust_drift": raw["trust_drift"]}, "trust_drift", "relational_stance")
        if "trust_drift" in raw
        else None
    )
    fam_drift = (
        _unit(
            {"familiarity_drift": raw["familiarity_drift"]},
            "familiarity_drift",
            "relational_stance",
        )
        if "familiarity_drift" in raw
        else None
    )
    cw = (
        _unit(
            {"current_warmth": raw["current_warmth"]},
            "current_warmth",
            "relational_stance",
        )
        if "current_warmth" in raw
        else None
    )
    marker = raw.get("history_marker")
    if marker is not None and not isinstance(marker, str):
        raise ToolCallParseError(
            "relational_stance.history_marker must be a string",
            tool_name="update_self_state",
            raw_arguments=repr(raw),
        )
    return RelationalStanceDelta(
        trust_drift=trust_drift,
        familiarity_drift=fam_drift,
        current_warmth=cw,
        history_marker=marker,
    )


def _parse_disposition_drift(raw: Any) -> tuple[DispositionDriftSignal, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ToolCallParseError(
            "disposition_drift must be a list",
            tool_name="update_self_state",
            raw_arguments=repr(raw),
        )
    out: list[DispositionDriftSignal] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ToolCallParseError(
                f"disposition_drift[{i}] must be an object",
                tool_name="update_self_state",
                raw_arguments=repr(item),
            )
        _require_keys(
            item,
            {"dimension", "direction", "magnitude_weight"},
            f"disposition_drift[{i}]",
        )
        dimension = item["dimension"]
        if dimension not in DISPOSITION_FIELDS:
            raise ToolCallParseError(
                f"disposition_drift[{i}].dimension {dimension!r} not in "
                f"{sorted(DISPOSITION_FIELDS)}",
                tool_name="update_self_state",
                raw_arguments=repr(item),
            )
        direction = item["direction"]
        if direction not in (-1, 1):
            raise ToolCallParseError(
                f"disposition_drift[{i}].direction must be -1 or +1, got {direction!r}",
                tool_name="update_self_state",
                raw_arguments=repr(item),
            )
        magnitude = _unit(item, "magnitude_weight", f"disposition_drift[{i}]")
        out.append(
            DispositionDriftSignal(
                dimension=dimension,
                direction=int(direction),
                magnitude_weight=magnitude,
            )
        )
    return tuple(out)


def _parse_opinions(raw: Any) -> tuple[OpinionDelta, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ToolCallParseError(
            "formed_opinions must be a list",
            tool_name="update_self_state",
            raw_arguments=repr(raw),
        )
    out: list[OpinionDelta] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ToolCallParseError(
                f"formed_opinions[{i}] must be an object",
                tool_name="update_self_state",
                raw_arguments=repr(item),
            )
        _require_keys(item, {"claim", "evidence_ids"}, f"formed_opinions[{i}]")
        claim = _str(item, "claim", f"formed_opinions[{i}]")
        evidence = _str_list(item["evidence_ids"], f"formed_opinions[{i}].evidence_ids")
        if not evidence:
            raise ToolCallParseError(
                f"formed_opinions[{i}].evidence_ids must be non-empty",
                tool_name="update_self_state",
                raw_arguments=repr(item),
            )
        out.append(OpinionDelta(claim=claim, evidence_ids=tuple(evidence)))
    return tuple(out)


def _parse_quirks(raw: Any) -> tuple[QuirkDelta, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ToolCallParseError(
            "quirks must be a list",
            tool_name="update_self_state",
            raw_arguments=repr(raw),
        )
    out: list[QuirkDelta] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ToolCallParseError(
                f"quirks[{i}] must be an object",
                tool_name="update_self_state",
                raw_arguments=repr(item),
            )
        _require_keys(item, {"pattern"}, f"quirks[{i}]")
        pattern = _str(item, "pattern", f"quirks[{i}]")
        out.append(QuirkDelta(pattern=pattern))
    return tuple(out)


# ============================================================================
# Primitive validators (raise ToolCallParseError on failure)
# ============================================================================


def _require_keys(obj: dict[str, Any], required: set[str], path: str) -> None:
    missing = required - set(obj.keys())
    if missing:
        raise ToolCallParseError(
            f"{path} missing required keys: {sorted(missing)}",
            tool_name=path.split(".")[0],
            raw_arguments=repr(obj),
        )


def _str(obj: dict[str, Any], key: str, path: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value:
        raise ToolCallParseError(
            f"{path}.{key} must be a non-empty string",
            tool_name=path.split(".")[0],
            raw_arguments=repr(value),
        )
    return value


def _unit(obj: dict[str, Any], key: str, path: str) -> float:
    value = obj.get(key)
    if not isinstance(value, int | float):
        raise ToolCallParseError(
            f"{path}.{key} must be a number in [0, 1]",
            tool_name=path.split(".")[0],
            raw_arguments=repr(value),
        )
    fvalue = float(value)
    if not 0.0 <= fvalue <= 1.0:
        raise ToolCallParseError(
            f"{path}.{key} = {fvalue} out of range [0, 1]",
            tool_name=path.split(".")[0],
            raw_arguments=repr(value),
        )
    return fvalue


def _signed_unit(obj: dict[str, Any], key: str, path: str) -> float:
    value = obj.get(key)
    if not isinstance(value, int | float):
        raise ToolCallParseError(
            f"{path}.{key} must be a number in [-1, 1]",
            tool_name=path.split(".")[0],
            raw_arguments=repr(value),
        )
    fvalue = float(value)
    if not -1.0 <= fvalue <= 1.0:
        raise ToolCallParseError(
            f"{path}.{key} = {fvalue} out of range [-1, 1]",
            tool_name=path.split(".")[0],
            raw_arguments=repr(value),
        )
    return fvalue


def _str_list(value: Any, path: str) -> list[str]:
    if not isinstance(value, list):
        raise ToolCallParseError(
            f"{path} must be a list of strings",
            tool_name=path.split(".")[0],
            raw_arguments=repr(value),
        )
    out: list[str] = []
    for i, item in enumerate(value):
        if not isinstance(item, str):
            raise ToolCallParseError(
                f"{path}[{i}] must be a string",
                tool_name=path.split(".")[0],
                raw_arguments=repr(item),
            )
        out.append(item)
    return out
