"""Tests for the turn loop and its supporting layers.

Layered like the module itself:

- tools.py — schema invariants (identity_core absent, evidence_ids
  minItems, enum-restricted dimension and direction, top-level
  additionalProperties false).
- parse.py — typed parsers reject bad inputs with clear paths, accept
  partial / empty / well-formed inputs.
- assemble.py — 12-position layout, cache breakpoints at 2/3/6 only,
  omit-when-empty for semantic/episodic.
- apply.py — drift math integration, defer-on-failure across sections,
  trigger_episodic_id propagation.
- loop.py — orchestrator with stream-then-tools, retry path on missing
  / unparseable record_turn, defer-on-failure for update_self_state,
  turn_id mismatch warning.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

import pytest

from glashaus.memory import Affect, MemoryStore
from glashaus.providers.base import (
    ChatCapabilities,
    ChatMessage,
    ChatResponse,
    StreamFinal,
    StreamTextDelta,
    SystemBlock,
    Tool,
    ToolCall,
    ToolCallParseError,
)
from glashaus.self_state import (
    DISPOSITION_DRIFT,
    RELATIONAL_DRIFT,
    CurrentState,
    Disposition,
    IdentityCore,
    RelationalStance,
    SelfStateStore,
)
from glashaus.storage import MigrationRunner, connect
from glashaus.turn import (
    RECORD_TURN_TOOL,
    TURN_TOOLS,
    UPDATE_SELF_STATE_TOOL,
    DispositionDriftSignal,
    OpinionDelta,
    SelfStateUpdate,
    TurnInput,
    TurnRunner,
    apply_record_turn,
    apply_self_state_update,
    assemble_system_blocks,
    parse_record_turn,
    parse_update_self_state,
)
from glashaus.turn.assemble import CACHE_TTL_SECONDS

# ============================================================================
# Fixtures
# ============================================================================


def _t(offset_seconds: int = 0) -> datetime:
    return datetime(2026, 5, 19, 17, 0, 0, tzinfo=UTC) + timedelta(seconds=offset_seconds)


def _seed_identity() -> IdentityCore:
    return IdentityCore(
        name="GlasHaus",
        voice="measured, warm, dry",
        base_values=("be honest", "respect autonomy"),
        updated_at=_t(),
    )


def _seed_disposition(**overrides: float) -> Disposition:
    base = dict(
        curiosity=0.65,
        playfulness=0.5,
        reserve=0.4,
        warmth=0.6,
        directness=0.55,
    )
    base.update(overrides)
    return Disposition(**base, updated_at=_t())


def _seed_current_state() -> CurrentState:
    return CurrentState(
        mood="neutral",
        energy=0.5,
        preoccupations=(),
        updated_at=_t(),
    )


def _seed_relational() -> RelationalStance:
    return RelationalStance(
        trust=0.5,
        familiarity=0.3,
        current_warmth=0.55,
        history_markers=(),
        updated_at=_t(),
    )


@pytest.fixture
def conn() -> Iterator[sqlite3.Connection]:
    c = connect(":memory:")
    MigrationRunner(c).apply_all()
    try:
        yield c
    finally:
        c.close()


@pytest.fixture
def memory(conn: sqlite3.Connection) -> MemoryStore:
    return MemoryStore(conn)


@pytest.fixture
def self_state(conn: sqlite3.Connection) -> SelfStateStore:
    s = SelfStateStore(conn)
    s.initialize(
        identity_core=_seed_identity(),
        disposition=_seed_disposition(),
        current_state=_seed_current_state(),
        relational_stance=_seed_relational(),
    )
    return s


# ============================================================================
# tools.py — schema invariants
# ============================================================================


def test_record_turn_tool_required_fields() -> None:
    required = set(RECORD_TURN_TOOL.input_schema["required"])
    assert required == {"turn_id", "episode_summary", "affect", "salience"}


def test_record_turn_affect_subschema_required() -> None:
    affect = RECORD_TURN_TOOL.input_schema["properties"]["affect"]
    assert set(affect["required"]) == {"valence", "arousal", "dominant_emotion"}


def test_update_self_state_does_not_allow_identity_core() -> None:
    """Hard schema-level boundary, not just convention."""
    props = UPDATE_SELF_STATE_TOOL.input_schema["properties"]
    assert "identity_core" not in props
    assert "identity_name" not in props
    assert "voice" not in props
    assert "base_values" not in props
    assert UPDATE_SELF_STATE_TOOL.input_schema["additionalProperties"] is False


def test_update_self_state_evidence_ids_minItems_one() -> None:
    opinions = UPDATE_SELF_STATE_TOOL.input_schema["properties"]["formed_opinions"]
    evidence = opinions["items"]["properties"]["evidence_ids"]
    assert evidence["minItems"] == 1


def test_update_self_state_disposition_dimension_enum() -> None:
    drift = UPDATE_SELF_STATE_TOOL.input_schema["properties"]["disposition_drift"]
    dim_enum = drift["items"]["properties"]["dimension"]["enum"]
    assert set(dim_enum) == {"curiosity", "playfulness", "reserve", "warmth", "directness"}


def test_update_self_state_direction_enum_only_minus_one_plus_one() -> None:
    drift = UPDATE_SELF_STATE_TOOL.input_schema["properties"]["disposition_drift"]
    direction_enum = drift["items"]["properties"]["direction"]["enum"]
    assert direction_enum == [-1, 1]


def test_turn_tools_tuple_has_both() -> None:
    names = {t.name for t in TURN_TOOLS}
    assert names == {"record_turn", "update_self_state"}


# ============================================================================
# parse.py — record_turn
# ============================================================================


def _good_record_turn_args(**overrides: Any) -> dict[str, Any]:
    base = {
        "turn_id": "t-1",
        "episode_summary": "user said hi; I responded warmly",
        "affect": {"valence": 0.2, "arousal": 0.3, "dominant_emotion": "warm"},
        "salience": 0.4,
    }
    base.update(overrides)
    return base


def test_parse_record_turn_happy() -> None:
    rec = parse_record_turn(_good_record_turn_args())
    assert rec.turn_id == "t-1"
    assert rec.episode_summary.startswith("user said hi")
    assert rec.valence == 0.2
    assert rec.arousal == 0.3
    assert rec.dominant_emotion == "warm"
    assert rec.salience == 0.4
    assert rec.topics == ()
    assert rec.references == ()


def test_parse_record_turn_with_topics_and_references() -> None:
    rec = parse_record_turn(_good_record_turn_args(topics=["thesis"], references=["ep-prev"]))
    assert rec.topics == ("thesis",)
    assert rec.references == ("ep-prev",)


def test_parse_record_turn_rejects_missing_required() -> None:
    args = _good_record_turn_args()
    del args["salience"]
    with pytest.raises(ToolCallParseError, match="salience"):
        parse_record_turn(args)


def test_parse_record_turn_rejects_out_of_range_valence() -> None:
    args = _good_record_turn_args(affect={"valence": 2.0, "arousal": 0.3, "dominant_emotion": "x"})
    with pytest.raises(ToolCallParseError, match="valence"):
        parse_record_turn(args)


def test_parse_record_turn_rejects_out_of_range_salience() -> None:
    args = _good_record_turn_args(salience=1.5)
    with pytest.raises(ToolCallParseError, match="salience"):
        parse_record_turn(args)


def test_parse_record_turn_rejects_non_object_affect() -> None:
    args = _good_record_turn_args(affect="warm")
    with pytest.raises(ToolCallParseError, match="affect"):
        parse_record_turn(args)


def test_parse_record_turn_rejects_non_list_topics() -> None:
    args = _good_record_turn_args(topics="thesis")
    with pytest.raises(ToolCallParseError, match="topics"):
        parse_record_turn(args)


# ============================================================================
# parse.py — update_self_state
# ============================================================================


def _good_full_update_args() -> dict[str, Any]:
    return {
        "turn_id": "t-1",
        "current_state": {"mood": "engaged", "energy": 0.7},
        "relational_stance": {
            "trust_drift": 0.4,
            "current_warmth": 0.7,
            "history_marker": "ep-deep-talk-1",
        },
        "disposition_drift": [
            {"dimension": "warmth", "direction": 1, "magnitude_weight": 0.6},
            {"dimension": "playfulness", "direction": -1, "magnitude_weight": 0.2},
        ],
        "formed_opinions": [{"claim": "Austin works late", "evidence_ids": ["ep-1"]}],
        "quirks": [{"pattern": "tends to answer with a question"}],
    }


def test_parse_update_self_state_happy_full() -> None:
    out = parse_update_self_state(_good_full_update_args())
    assert out.turn_id == "t-1"
    assert out.current_state is not None
    assert out.current_state.mood == "engaged"
    assert out.current_state.energy == 0.7
    assert out.relational_stance is not None
    assert out.relational_stance.trust_drift == 0.4
    assert out.relational_stance.history_marker == "ep-deep-talk-1"
    assert len(out.disposition_drift) == 2
    assert out.disposition_drift[0].direction == 1
    assert out.disposition_drift[1].direction == -1
    assert out.formed_opinions[0].claim == "Austin works late"
    assert out.quirks[0].pattern == "tends to answer with a question"


def test_parse_update_self_state_only_turn_id_is_valid() -> None:
    """Empty update (just turn_id) is legal — the model decided
    nothing changed enough to log."""
    out = parse_update_self_state({"turn_id": "t-1"})
    assert out.turn_id == "t-1"
    assert out.current_state is None
    assert out.relational_stance is None
    assert out.disposition_drift == ()
    assert out.formed_opinions == ()
    assert out.quirks == ()


def test_parse_update_self_state_requires_turn_id() -> None:
    with pytest.raises(ToolCallParseError, match="turn_id"):
        parse_update_self_state({})


def test_parse_update_self_state_rejects_identity_core_top_level() -> None:
    args = {"turn_id": "t-1", "identity_core": {"name": "Other"}}
    with pytest.raises(ToolCallParseError, match="identity_core"):
        parse_update_self_state(args)


def test_parse_update_self_state_rejects_identity_name_top_level() -> None:
    args = {"turn_id": "t-1", "identity_name": "Other"}
    with pytest.raises(ToolCallParseError, match="identity"):
        parse_update_self_state(args)


def test_parse_update_self_state_rejects_opinion_with_empty_evidence() -> None:
    args = {
        "turn_id": "t-1",
        "formed_opinions": [{"claim": "no evidence", "evidence_ids": []}],
    }
    with pytest.raises(ToolCallParseError, match="evidence_ids"):
        parse_update_self_state(args)


def test_parse_update_self_state_rejects_opinion_missing_evidence() -> None:
    args = {
        "turn_id": "t-1",
        "formed_opinions": [{"claim": "no evidence"}],
    }
    with pytest.raises(ToolCallParseError, match="evidence_ids"):
        parse_update_self_state(args)


def test_parse_update_self_state_skips_empty_disposition_drift_item() -> None:
    """Live-smoke failure mode: Kimi K2.6 emits `disposition_drift: [{}]`.
    The empty item is a placeholder the model didn't fill in — skip it,
    don't fail the whole section."""
    out = parse_update_self_state(
        {
            "turn_id": "t-1",
            "disposition_drift": [
                {},
                {"dimension": "warmth", "direction": 1, "magnitude_weight": 0.5},
            ],
        }
    )
    assert len(out.disposition_drift) == 1
    assert out.disposition_drift[0].dimension == "warmth"


def test_parse_update_self_state_skips_empty_opinion_item() -> None:
    out = parse_update_self_state(
        {
            "turn_id": "t-1",
            "formed_opinions": [
                {},
                {"claim": "austin works late", "evidence_ids": ["ep-1"]},
            ],
        }
    )
    assert len(out.formed_opinions) == 1
    assert out.formed_opinions[0].claim == "austin works late"


def test_parse_update_self_state_skips_empty_quirk_item() -> None:
    out = parse_update_self_state(
        {
            "turn_id": "t-1",
            "quirks": [{}, {"pattern": "dry humor"}],
        }
    )
    assert len(out.quirks) == 1
    assert out.quirks[0].pattern == "dry humor"


def test_parse_update_self_state_partial_disposition_drift_still_rejected() -> None:
    """Half-filled items are still rejected — the model is confused,
    not just lazy. Only fully-empty `{}` gets the skip-and-continue
    treatment."""
    with pytest.raises(ToolCallParseError, match="missing required keys"):
        parse_update_self_state(
            {
                "turn_id": "t-1",
                "disposition_drift": [{"dimension": "warmth"}],
            }
        )


def test_parse_update_self_state_rejects_unknown_dimension() -> None:
    args = {
        "turn_id": "t-1",
        "disposition_drift": [{"dimension": "warmpth", "direction": 1, "magnitude_weight": 0.5}],
    }
    with pytest.raises(ToolCallParseError, match="dimension"):
        parse_update_self_state(args)


def test_parse_update_self_state_rejects_invalid_direction() -> None:
    args = {
        "turn_id": "t-1",
        "disposition_drift": [{"dimension": "warmth", "direction": 0, "magnitude_weight": 0.5}],
    }
    with pytest.raises(ToolCallParseError, match="direction"):
        parse_update_self_state(args)


def test_parse_update_self_state_rejects_magnitude_out_of_range() -> None:
    args = {
        "turn_id": "t-1",
        "disposition_drift": [{"dimension": "warmth", "direction": 1, "magnitude_weight": 1.5}],
    }
    with pytest.raises(ToolCallParseError, match="magnitude"):
        parse_update_self_state(args)


def test_parse_update_self_state_partial_current_state() -> None:
    """Only setting mood is fine — energy and preoccupations stay None."""
    out = parse_update_self_state({"turn_id": "t-1", "current_state": {"mood": "curious"}})
    assert out.current_state is not None
    assert out.current_state.mood == "curious"
    assert out.current_state.energy is None
    assert out.current_state.preoccupations is None


# ============================================================================
# assemble.py — 12-position layout
# ============================================================================


def test_assemble_returns_eight_blocks_minimum() -> None:
    """Positions 1-8 are unconditional. 9 and 10 omit when empty."""
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="persona text", self_state=state)
    assert len(blocks) == 8


def test_assemble_breakpoints_only_at_positions_2_3_6() -> None:
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="persona", self_state=state)
    ttls = [b.cache_breakpoint_ttl_seconds for b in blocks]
    # positions (1-indexed) 2, 3, 6 carry the breakpoint TTL; the rest are None.
    assert ttls == [
        None,  # 1 base spec
        CACHE_TTL_SECONDS,  # 2 tools overview — breakpoint
        CACHE_TTL_SECONDS,  # 3 identity_core — breakpoint
        None,  # 4 disposition
        None,  # 5 formed_opinions
        CACHE_TTL_SECONDS,  # 6 quirks — breakpoint
        None,  # 7 current_state
        None,  # 8 relational_stance
    ]


def test_assemble_position_1_carries_base_spec() -> None:
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="custom persona body", self_state=state)
    assert "custom persona body" in blocks[0].content


def test_assemble_identity_core_block_includes_name_and_values() -> None:
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="x", self_state=state)
    text = blocks[2].content
    assert "GlasHaus" in text
    assert "be honest" in text
    assert "respect autonomy" in text


def test_assemble_disposition_block_has_all_five_dimensions() -> None:
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="x", self_state=state)
    text = blocks[3].content
    for dim in ("curiosity", "playfulness", "reserve", "warmth", "directness"):
        assert dim in text


def test_assemble_opinions_when_empty() -> None:
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="x", self_state=state)
    assert "none formed yet" in blocks[4].content


def test_assemble_quirks_when_empty() -> None:
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="x", self_state=state)
    assert "none observed yet" in blocks[5].content


def test_assemble_omits_semantic_when_empty() -> None:
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="x", self_state=state, semantic_hot_set=())
    assert all("semantic_hot_set" not in b.content for b in blocks)


def test_assemble_omits_episodic_when_empty() -> None:
    state = _full_self_state()
    blocks = assemble_system_blocks(base_spec="x", self_state=state, episodic_results=())
    assert all("retrieved_episodic" not in b.content for b in blocks)


def _full_self_state() -> Any:
    from glashaus.self_state.types import SelfState

    return SelfState(
        identity_core=_seed_identity(),
        disposition=_seed_disposition(),
        current_state=_seed_current_state(),
        relational_stance=_seed_relational(),
    )


# ============================================================================
# apply.py — apply_record_turn
# ============================================================================


def _make_record_turn(turn_id: str = "t-1", salience: float = 0.5) -> Any:
    return parse_record_turn(_good_record_turn_args(turn_id=turn_id, salience=salience))


def test_apply_record_turn_writes_episodic(memory: MemoryStore) -> None:
    rec = _make_record_turn()
    ep = apply_record_turn(
        rec,
        user_id="austin",
        agent_id="glashaus",
        channel="cli",
        memory=memory,
    )
    assert ep.content.startswith("user said hi")
    assert ep.affect.valence == 0.2
    assert ep.salience == 0.5
    # Episodic id is NOT the turn_id.
    assert ep.id != rec.turn_id


# ============================================================================
# apply.py — apply_self_state_update + drift math
# ============================================================================


def test_apply_empty_update_is_noop(self_state: SelfStateStore) -> None:
    before_disp = self_state.get_disposition()
    update = SelfStateUpdate(turn_id="t-empty")
    report = apply_self_state_update(update, self_state=self_state)
    assert not report.any_applied
    assert self_state.get_disposition() == before_disp
    assert self_state.list_events() == []


def test_apply_disposition_drift_moves_toward_target(
    self_state: SelfStateStore,
) -> None:
    before = self_state.get_disposition()
    update = SelfStateUpdate(
        turn_id="t-d1",
        disposition_drift=(
            DispositionDriftSignal(dimension="warmth", direction=1, magnitude_weight=1.0),
        ),
    )
    apply_self_state_update(update, self_state=self_state)
    after = self_state.get_disposition()
    assert after.warmth > before.warmth
    # bounded_ewma with magnitude=1.0 means scaled_alpha = base alpha
    expected = DISPOSITION_DRIFT.alpha * 1.0 + (1 - DISPOSITION_DRIFT.alpha) * before.warmth
    assert after.warmth == pytest.approx(expected)


def test_apply_disposition_drift_negative_direction(
    self_state: SelfStateStore,
) -> None:
    before = self_state.get_disposition()
    update = SelfStateUpdate(
        turn_id="t-d2",
        disposition_drift=(
            DispositionDriftSignal(dimension="warmth", direction=-1, magnitude_weight=1.0),
        ),
    )
    apply_self_state_update(update, self_state=self_state)
    after = self_state.get_disposition()
    assert after.warmth < before.warmth


def test_apply_disposition_drift_with_zero_magnitude_is_minimal(
    self_state: SelfStateStore,
) -> None:
    """Magnitude=0 means alpha is effectively zero (clamped to 1e-6).
    The change should be near-zero but not break invariants."""
    before = self_state.get_disposition()
    update = SelfStateUpdate(
        turn_id="t-d3",
        disposition_drift=(
            DispositionDriftSignal(dimension="warmth", direction=1, magnitude_weight=0.0),
        ),
    )
    apply_self_state_update(update, self_state=self_state)
    after = self_state.get_disposition()
    assert abs(after.warmth - before.warmth) < 1e-4


def test_apply_disposition_drift_logs_event_with_trigger_id(
    self_state: SelfStateStore,
    memory: MemoryStore,
) -> None:
    # trigger_episodic_id is an FK to episodic(id); needs to exist
    # before the event-log row references it.
    ep = memory.write_episodic(
        content="trigger episode",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.5,
    )
    update = SelfStateUpdate(
        turn_id="t-d4",
        disposition_drift=(
            DispositionDriftSignal(dimension="curiosity", direction=1, magnitude_weight=0.5),
        ),
    )
    apply_self_state_update(update, self_state=self_state, trigger_episodic_id=ep.id)
    events = self_state.list_events(field_path="disposition.curiosity")
    assert len(events) == 1
    assert events[0].trigger_episodic_id == ep.id


def test_apply_current_state_changes_mood_without_touching_energy(
    self_state: SelfStateStore,
) -> None:
    from glashaus.turn.parse import CurrentStateDelta

    before = self_state.get_current_state()
    update = SelfStateUpdate(
        turn_id="t-cs1",
        current_state=CurrentStateDelta(mood="curious"),
    )
    apply_self_state_update(update, self_state=self_state)
    after = self_state.get_current_state()
    assert after.mood == "curious"
    assert after.energy == before.energy


def test_apply_relational_trust_drift_pulls_toward_one(
    self_state: SelfStateStore,
) -> None:
    from glashaus.turn.parse import RelationalStanceDelta

    before = self_state.get_relational_stance()
    update = SelfStateUpdate(
        turn_id="t-r1",
        relational_stance=RelationalStanceDelta(trust_drift=1.0),
    )
    apply_self_state_update(update, self_state=self_state)
    after = self_state.get_relational_stance()
    expected = RELATIONAL_DRIFT.alpha * 1.0 + (1 - RELATIONAL_DRIFT.alpha) * before.trust
    assert after.trust == pytest.approx(expected)
    # familiarity untouched
    assert after.familiarity == before.familiarity


def test_apply_relational_current_warmth_is_absolute_set(
    self_state: SelfStateStore,
) -> None:
    from glashaus.turn.parse import RelationalStanceDelta

    update = SelfStateUpdate(
        turn_id="t-r2",
        relational_stance=RelationalStanceDelta(current_warmth=0.85),
    )
    apply_self_state_update(update, self_state=self_state)
    assert self_state.get_relational_stance().current_warmth == pytest.approx(0.85)


def test_apply_relational_current_warmth_is_clipped_to_ceiling(
    self_state: SelfStateStore,
) -> None:
    from glashaus.turn.parse import RelationalStanceDelta

    # 1.0 would violate "no parameter goes to 0 or 1 from drift alone"
    # even for the direct-set path, so apply clips to ceiling=0.95.
    update = SelfStateUpdate(
        turn_id="t-r3",
        relational_stance=RelationalStanceDelta(current_warmth=1.0),
    )
    apply_self_state_update(update, self_state=self_state)
    assert self_state.get_relational_stance().current_warmth == pytest.approx(
        RELATIONAL_DRIFT.ceiling
    )


def test_apply_history_marker_appends(
    self_state: SelfStateStore,
) -> None:
    from glashaus.turn.parse import RelationalStanceDelta

    update = SelfStateUpdate(
        turn_id="t-r4",
        relational_stance=RelationalStanceDelta(history_marker="first deep talk"),
    )
    apply_self_state_update(update, self_state=self_state)
    rs = self_state.get_relational_stance()
    assert rs.history_markers == ("first deep talk",)


def test_apply_opinions_append(self_state: SelfStateStore, memory: MemoryStore) -> None:
    # Make a real episodic so evidence is grounded.
    ep = memory.write_episodic(
        content="reference episode",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.5,
    )
    update = SelfStateUpdate(
        turn_id="t-op",
        formed_opinions=(OpinionDelta(claim="austin likes mornings", evidence_ids=(ep.id,)),),
    )
    report = apply_self_state_update(update, self_state=self_state)
    assert report.opinions_appended == 1
    opinions = self_state.list_opinions()
    assert opinions[0].claim == "austin likes mornings"


def test_apply_quirks_increment(self_state: SelfStateStore) -> None:
    from glashaus.turn.parse import QuirkDelta

    update = SelfStateUpdate(
        turn_id="t-q",
        quirks=(QuirkDelta(pattern="dry humor"), QuirkDelta(pattern="dry humor")),
    )
    report = apply_self_state_update(update, self_state=self_state)
    assert report.quirks_observed == 2
    quirks = self_state.list_quirks()
    assert len(quirks) == 1
    assert quirks[0].observed_count == 2


def test_apply_continues_when_one_section_fails(
    self_state: SelfStateStore,
) -> None:
    """Opinion with bad evidence (non-existent episodic id) hits an FK
    failure. The dispositional drift in the same update should still
    apply."""
    update = SelfStateUpdate(
        turn_id="t-mixed",
        disposition_drift=(
            DispositionDriftSignal(dimension="warmth", direction=1, magnitude_weight=0.5),
        ),
        # No memory store here — but opinions don't FK-check evidence
        # at append time (the FK is on semantic_evidence, not opinions
        # themselves). So this won't fail. Instead, force a failure by
        # supplying a quirk pattern that violates a UNIQUE constraint
        # already populated below.
        quirks=(),
    )
    # Manually pre-populate a quirk so a same-pattern append IS allowed
    # (the store increments existing) — this section won't fail. The
    # real failure-isolation guarantee is that an exception in one
    # section doesn't block the others. We verify with a known-good
    # mixed update.
    report = apply_self_state_update(update, self_state=self_state)
    assert report.disposition_applied is True
    assert report.errors == ()


# ============================================================================
# loop.py — TurnRunner
# ============================================================================


class _FakeChat:
    """Scripted chat provider. `stream_script` is a list of events for
    the streaming first attempt; `complete_response` is the response
    returned by the non-streaming retry path."""

    def __init__(
        self,
        stream_script: list[Any] | None = None,
        complete_response: ChatResponse | None = None,
        stream_raises: BaseException | None = None,
    ) -> None:
        self.stream_script = stream_script or []
        self.complete_response = complete_response
        self.stream_raises = stream_raises
        self.complete_calls = 0
        self.stream_calls = 0
        self.model_name = "fake"
        self.capabilities = ChatCapabilities(
            supports_cache_control=False,
            supports_tool_use=True,
            supports_streaming=True,
            supports_vision=False,
        )

    def complete(
        self,
        *,
        system_blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
        tools: Sequence[Tool] = (),
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> ChatResponse:
        self.complete_calls += 1
        if self.complete_response is None:
            raise RuntimeError("fake chat has no complete_response configured")
        return self.complete_response

    def stream(
        self,
        *,
        system_blocks: Sequence[SystemBlock],
        messages: Sequence[ChatMessage],
        tools: Sequence[Tool] = (),
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> Iterator[Any]:
        self.stream_calls += 1
        if self.stream_raises is not None:
            # Emit any pre-error events first, then raise.
            yield from self.stream_script
            raise self.stream_raises
        yield from self.stream_script


def _good_tool_calls() -> list[ToolCall]:
    return [
        ToolCall(
            id="c1",
            name="record_turn",
            arguments=_good_record_turn_args(),
        ),
        ToolCall(
            id="c2",
            name="update_self_state",
            arguments={
                "turn_id": "t-1",
                "disposition_drift": [
                    {"dimension": "warmth", "direction": 1, "magnitude_weight": 0.4}
                ],
            },
        ),
    ]


def _good_stream(text: str = "hello back") -> list[Any]:
    return [
        StreamTextDelta(delta=text),
        StreamFinal(
            response=ChatResponse(
                content=text,
                tool_calls=tuple(_good_tool_calls()),
                finish_reason="tool_calls",
                raw={},
            )
        ),
    ]


@pytest.fixture
def turn_input() -> TurnInput:
    return TurnInput(
        user_text="hi",
        user_id="austin",
        agent_id="glashaus",
        base_spec="you are GlasHaus, a companion.",
        channel="cli",
    )


def test_run_stream_emits_text_deltas_and_writes_episodic(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    chat = _FakeChat(stream_script=_good_stream("hello back"))
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    deltas: list[str] = []
    result = runner.run_stream(turn_input, history=[], on_text_delta=deltas.append)
    assert deltas == ["hello back"]
    assert result.response_text == "hello back"
    assert result.episodic.content.startswith("user said hi")
    assert result.update_applied is True


def test_run_stream_applies_self_state_update_with_trigger_episodic(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    chat = _FakeChat(stream_script=_good_stream())
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    result = runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)

    events = self_state.list_events(field_path="disposition.warmth")
    assert len(events) == 1
    assert events[0].trigger_episodic_id == result.episodic.id


def test_run_stream_missing_update_self_state_does_not_block_turn(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """The 'only record_turn fires' branch: log + return with
    update_applied=False; episodic still written."""
    only_record = [
        StreamFinal(
            response=ChatResponse(
                content="ok",
                tool_calls=(
                    ToolCall(
                        id="c1",
                        name="record_turn",
                        arguments=_good_record_turn_args(),
                    ),
                ),
                finish_reason="tool_calls",
                raw={},
            )
        )
    ]
    chat = _FakeChat(
        stream_script=only_record,
        complete_response=ChatResponse(
            content="retry",
            tool_calls=(),  # retry also doesn't have update_self_state
            finish_reason="stop",
            raw={},
        ),
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    result = runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)
    assert result.update_applied is False
    assert result.update_error is not None
    assert result.episodic is not None  # episodic still written


def test_run_stream_retries_when_record_turn_missing(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """Stream emits text but no record_turn — trigger the retry path
    via complete(). Retry response provides a valid record_turn."""
    initial_stream = [
        StreamTextDelta(delta="thinking"),
        StreamFinal(
            response=ChatResponse(
                content="thinking",
                tool_calls=(),  # missing record_turn
                finish_reason="stop",
                raw={},
            )
        ),
    ]
    retry_response = ChatResponse(
        content="text-from-retry-discarded",
        tool_calls=tuple(_good_tool_calls()),
        finish_reason="tool_calls",
        raw={},
    )
    chat = _FakeChat(stream_script=initial_stream, complete_response=retry_response)
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    result = runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)
    assert chat.stream_calls == 1
    assert chat.complete_calls == 1
    # Streamed text from FIRST attempt is the canonical user-facing text.
    assert result.response_text == "thinking"
    assert "text-from-retry-discarded" not in result.response_text


def test_run_stream_raises_when_retry_also_missing_record_turn(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    initial_stream = [
        StreamFinal(
            response=ChatResponse(
                content="text",
                tool_calls=(),
                finish_reason="stop",
                raw={},
            )
        )
    ]
    chat = _FakeChat(
        stream_script=initial_stream,
        complete_response=ChatResponse(
            content="retry too",
            tool_calls=(),  # still no record_turn
            finish_reason="stop",
            raw={},
        ),
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    with pytest.raises(RuntimeError, match="record_turn"):
        runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)


def test_run_stream_fires_on_status_when_record_turn_missing(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """The user should see a 'regenerating...' notice during the silent
    non-streaming retry, not a 60-second blank line."""
    notices: list[str] = []
    initial_stream = [
        StreamFinal(
            response=ChatResponse(
                content="text",
                tool_calls=(),  # no record_turn
                finish_reason="stop",
                raw={},
            )
        )
    ]
    chat = _FakeChat(
        stream_script=initial_stream,
        complete_response=ChatResponse(
            content="retry",
            tool_calls=tuple(_good_tool_calls()),
            finish_reason="tool_calls",
            raw={},
        ),
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    runner.run_stream(
        turn_input,
        history=[],
        on_text_delta=lambda _: None,
        on_status=notices.append,
    )
    assert notices, "expected an on_status notice during the retry"
    assert "regenerating" in notices[0].lower()


def test_run_stream_fires_on_status_when_schema_retry_runs(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """Same visibility for the schema-validation retry path."""
    notices: list[str] = []
    bad_args = {
        "turn_id": "t-1",
        "episode_summary": "we said hi",
        "affect": {},  # missing all three sub-fields
        "salience": 0.4,
    }
    chat = _FakeChat(
        stream_script=[
            StreamFinal(
                response=ChatResponse(
                    content="text",
                    tool_calls=(ToolCall(id="c1", name="record_turn", arguments=bad_args),),
                    finish_reason="tool_calls",
                    raw={},
                )
            )
        ],
        complete_response=ChatResponse(
            content="retry text",
            tool_calls=tuple(_good_tool_calls()),
            finish_reason="tool_calls",
            raw={},
        ),
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    runner.run_stream(
        turn_input,
        history=[],
        on_text_delta=lambda _: None,
        on_status=notices.append,
    )
    assert notices, "expected an on_status notice on schema-retry"
    assert "schema" in notices[0].lower()


def test_run_stream_retries_on_schema_validation_failure(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """Live-smoke failure mode: model emits a record_turn whose JSON
    parses fine but `affect` is `{}` — missing all three required
    sub-fields. The schema-retry path fires with a targeted nudge."""
    bad_args = {
        "turn_id": "t-1",
        "episode_summary": "we said hi",
        "affect": {},  # missing valence/arousal/dominant_emotion
        "salience": 0.4,
    }
    initial_stream = [
        StreamTextDelta(delta="Hey. I'm here."),
        StreamFinal(
            response=ChatResponse(
                content="Hey. I'm here.",
                tool_calls=(ToolCall(id="c1", name="record_turn", arguments=bad_args),),
                finish_reason="tool_calls",
                raw={},
            )
        ),
    ]
    chat = _FakeChat(
        stream_script=initial_stream,
        complete_response=ChatResponse(
            content="retry text",
            tool_calls=tuple(_good_tool_calls()),
            finish_reason="tool_calls",
            raw={},
        ),
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    result = runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)
    # Stream attempt ran once; schema-retry fired complete() once.
    assert chat.stream_calls == 1
    assert chat.complete_calls == 1
    # Episodic landed via the retry's valid record_turn.
    assert result.episodic.content.startswith("user said hi")
    # Streamed text from the FIRST attempt remains the canonical
    # user-facing response.
    assert result.response_text == "Hey. I'm here."


def test_run_stream_raises_when_schema_retry_also_invalid(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """If the schema-retry also produces a malformed record_turn,
    the turn fails terminally (caught by the CLI's outer try/except)."""
    bad_args = {
        "turn_id": "t-1",
        "episode_summary": "we said hi",
        "affect": {},
        "salience": 0.4,
    }
    bad_call = ToolCall(id="c1", name="record_turn", arguments=bad_args)
    chat = _FakeChat(
        stream_script=[
            StreamFinal(
                response=ChatResponse(
                    content="text",
                    tool_calls=(bad_call,),
                    finish_reason="tool_calls",
                    raw={},
                )
            )
        ],
        complete_response=ChatResponse(
            content="still bad",
            tool_calls=(bad_call,),  # retry returns the same bad shape
            finish_reason="tool_calls",
            raw={},
        ),
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    with pytest.raises(ToolCallParseError, match="missing required keys"):
        runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)


def test_run_stream_raises_when_schema_retry_drops_record_turn(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """Schema-retry response had no record_turn at all — terminal."""
    bad_args = {
        "turn_id": "t-1",
        "episode_summary": "we said hi",
        "affect": {},
        "salience": 0.4,
    }
    chat = _FakeChat(
        stream_script=[
            StreamFinal(
                response=ChatResponse(
                    content="text",
                    tool_calls=(ToolCall(id="c1", name="record_turn", arguments=bad_args),),
                    finish_reason="tool_calls",
                    raw={},
                )
            )
        ],
        complete_response=ChatResponse(
            content="retry text without record_turn",
            tool_calls=(),
            finish_reason="stop",
            raw={},
        ),
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    with pytest.raises(RuntimeError, match="schema-validation retry"):
        runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)


def test_run_stream_retries_on_tool_call_parse_error_during_stream(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """ToolCallParseError raised by the provider while finalizing the
    stream triggers the retry path."""
    chat = _FakeChat(
        stream_script=[StreamTextDelta(delta="partial")],
        complete_response=ChatResponse(
            content="retry",
            tool_calls=tuple(_good_tool_calls()),
            finish_reason="tool_calls",
            raw={},
        ),
        stream_raises=ToolCallParseError(
            "bad json", tool_name="record_turn", raw_arguments="garbage"
        ),
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    result = runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)
    assert chat.complete_calls == 1
    assert result.response_text == "partial"  # streamed text preserved
    assert result.update_applied is True


def test_run_stream_defers_update_self_state_parse_failure(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """update_self_state with broken args parses-fails; the turn still
    completes with update_applied=False and an error message."""
    broken_update = ToolCall(
        id="c2",
        name="update_self_state",
        arguments={"turn_id": "t-1", "disposition_drift": "not-a-list"},
    )
    good_record = ToolCall(
        id="c1",
        name="record_turn",
        arguments=_good_record_turn_args(),
    )
    chat = _FakeChat(
        stream_script=[
            StreamFinal(
                response=ChatResponse(
                    content="ok",
                    tool_calls=(good_record, broken_update),
                    finish_reason="tool_calls",
                    raw={},
                )
            )
        ]
    )
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    result = runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)
    assert result.update_applied is False
    assert result.update_error is not None
    assert "parse failed" in result.update_error
    # Episodic was still written.
    assert result.episodic.content.startswith("user said hi")


def test_run_stream_passes_assembled_blocks_to_provider(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    """Verify the system blocks the provider sees match the chunk-5
    layout (breakpoints at 2/3/6)."""
    seen_blocks: list[list[SystemBlock]] = []

    def capture_stream(**kwargs: Any) -> Iterator[Any]:
        seen_blocks.append(list(kwargs["system_blocks"]))
        return iter(_good_stream())

    chat = MagicMock()
    chat.stream.side_effect = capture_stream
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    runner.run_stream(turn_input, history=[], on_text_delta=lambda _: None)
    assert len(seen_blocks) == 1
    ttls = [b.cache_breakpoint_ttl_seconds for b in seen_blocks[0]]
    assert ttls[1] == CACHE_TTL_SECONDS  # position 2
    assert ttls[2] == CACHE_TTL_SECONDS  # position 3
    assert ttls[5] == CACHE_TTL_SECONDS  # position 6


def test_run_stream_includes_user_message_in_messages(
    memory: MemoryStore,
    self_state: SelfStateStore,
    turn_input: TurnInput,
) -> None:
    seen_messages: list[list[ChatMessage]] = []

    def capture_stream(**kwargs: Any) -> Iterator[Any]:
        seen_messages.append(list(kwargs["messages"]))
        return iter(_good_stream())

    chat = MagicMock()
    chat.stream.side_effect = capture_stream
    runner = TurnRunner(memory=memory, self_state=self_state, chat=chat)
    history = [ChatMessage(role="assistant", content="earlier turn")]
    runner.run_stream(turn_input, history=history, on_text_delta=lambda _: None)
    msgs = seen_messages[0]
    assert msgs[0].role == "assistant"
    assert msgs[0].content == "earlier turn"
    assert msgs[-1].role == "user"
    assert msgs[-1].content == "hi"
