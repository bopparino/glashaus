"""Tests for the self-state module.

Covers: dataclass validation, store init / get / per-layer reads,
update_* methods and their event-log emission (numeric deltas only,
unchanged fields don't log, text/list fields don't log), append-only
opinions and quirks (insert and increment), event-log queries with
filters, EWMA math + clipping, propose_disposition / proposeing
relational_stance signal handling, identity-consistency check.

What is deliberately not tested: turn-loop integration, dream-cycle
reflection, LLM-driven base_values consistency. Those are later chunks
or later phases.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime, timedelta

import pytest

from glashaus.memory import Affect, MemoryStore
from glashaus.self_state import (
    DISPOSITION_DRIFT,
    RELATIONAL_DRIFT,
    ConsistencyViolation,
    CurrentState,
    Disposition,
    DriftParams,
    IdentityCore,
    RelationalStance,
    SelfState,
    SelfStateStore,
    bounded_ewma,
    check_numeric_consistency,
    propose_disposition,
    propose_relational_stance,
)
from glashaus.storage import MigrationRunner, connect


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


def _seed_self_state() -> SelfState:
    return SelfState(
        identity_core=_seed_identity(),
        disposition=_seed_disposition(),
        current_state=_seed_current_state(),
        relational_stance=_seed_relational(),
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
def store(conn: sqlite3.Connection) -> SelfStateStore:
    s = SelfStateStore(conn)
    s.initialize(
        identity_core=_seed_identity(),
        disposition=_seed_disposition(),
        current_state=_seed_current_state(),
        relational_stance=_seed_relational(),
    )
    return s


@pytest.fixture
def uninit_store(conn: sqlite3.Connection) -> SelfStateStore:
    return SelfStateStore(conn)


# ============================================================================
# Dataclass validation
# ============================================================================


def test_identity_core_rejects_empty_name() -> None:
    with pytest.raises(ValueError, match="name"):
        IdentityCore(name="", voice="v", base_values=(), updated_at=_t())


def test_identity_core_rejects_empty_voice() -> None:
    with pytest.raises(ValueError, match="voice"):
        IdentityCore(name="GH", voice="", base_values=(), updated_at=_t())


def test_disposition_rejects_out_of_range() -> None:
    with pytest.raises(ValueError, match="curiosity"):
        _seed_disposition(curiosity=1.2)
    with pytest.raises(ValueError, match="warmth"):
        _seed_disposition(warmth=-0.1)


def test_current_state_rejects_invalid_energy() -> None:
    with pytest.raises(ValueError, match="energy"):
        CurrentState(mood="m", energy=2.0, preoccupations=(), updated_at=_t())


def test_relational_stance_rejects_out_of_range() -> None:
    with pytest.raises(ValueError, match="trust"):
        RelationalStance(
            trust=1.5,
            familiarity=0.5,
            current_warmth=0.5,
            history_markers=(),
            updated_at=_t(),
        )


# ============================================================================
# Store init / get
# ============================================================================


def test_uninit_store_is_not_initialized(uninit_store: SelfStateStore) -> None:
    assert uninit_store.is_initialized() is False


def test_get_on_uninit_raises(uninit_store: SelfStateStore) -> None:
    with pytest.raises(RuntimeError, match="not initialized"):
        uninit_store.get()


def test_initialize_then_is_initialized(uninit_store: SelfStateStore) -> None:
    uninit_store.initialize(
        identity_core=_seed_identity(),
        disposition=_seed_disposition(),
        current_state=_seed_current_state(),
        relational_stance=_seed_relational(),
    )
    assert uninit_store.is_initialized()


def test_double_initialize_raises(store: SelfStateStore) -> None:
    with pytest.raises(RuntimeError, match="already initialized"):
        store.initialize(
            identity_core=_seed_identity(),
            disposition=_seed_disposition(),
            current_state=_seed_current_state(),
            relational_stance=_seed_relational(),
        )


def test_get_round_trips_all_layers(store: SelfStateStore) -> None:
    s = store.get()
    assert s.identity_core.name == "GlasHaus"
    assert "be honest" in s.identity_core.base_values
    assert s.disposition.curiosity == 0.65
    assert s.current_state.mood == "neutral"
    assert s.relational_stance.familiarity == 0.3
    assert s.formed_opinions == ()
    assert s.quirks == ()


def test_per_layer_getters(store: SelfStateStore) -> None:
    assert store.get_identity_core().name == "GlasHaus"
    assert store.get_disposition().warmth == 0.6
    assert store.get_current_state().mood == "neutral"
    assert store.get_relational_stance().trust == 0.5


# ============================================================================
# Updates + event-log emission
# ============================================================================


def test_update_disposition_logs_only_changed_fields(store: SelfStateStore) -> None:
    current = store.get_disposition()
    new = Disposition(
        curiosity=current.curiosity,  # unchanged -> no event
        playfulness=current.playfulness + 0.1,  # changed   -> event
        reserve=current.reserve,  # unchanged
        warmth=current.warmth + 0.05,  # changed
        directness=current.directness,  # unchanged
        updated_at=_t(60),
    )
    store.update_disposition(new)
    events = store.list_events()
    paths = sorted(e.field_path for e in events)
    assert paths == ["disposition.playfulness", "disposition.warmth"]
    play_evt = next(e for e in events if e.field_path == "disposition.playfulness")
    assert play_evt.old_value == pytest.approx(current.playfulness)
    assert play_evt.new_value == pytest.approx(current.playfulness + 0.1)


def test_update_disposition_no_change_logs_nothing(store: SelfStateStore) -> None:
    current = store.get_disposition()
    same = Disposition(**current.as_dict(), updated_at=_t(60))
    store.update_disposition(same)
    assert store.list_events() == []


def test_update_disposition_records_trigger_episodic_id(
    store: SelfStateStore, conn: sqlite3.Connection
) -> None:
    memstore = MemoryStore(conn)
    ep = memstore.write_episodic(
        content="trigger",
        user_id="u",
        agent_id="a",
        affect=Affect(valence=0.0, arousal=0.0, dominant_emotion="neutral"),
        salience=0.5,
    )
    current = store.get_disposition()
    new = Disposition(
        **{**current.as_dict(), "warmth": current.warmth + 0.1},
        updated_at=_t(60),
    )
    store.update_disposition(new, trigger_episodic_id=ep.id)
    events = store.list_events()
    assert len(events) == 1
    assert events[0].trigger_episodic_id == ep.id


def test_update_current_state_only_logs_energy(store: SelfStateStore) -> None:
    """Mood (text) and preoccupations (list) must not log; energy (numeric) does."""
    current = store.get_current_state()
    new = CurrentState(
        mood="curious",  # text change — no event
        energy=current.energy + 0.2,  # numeric — event
        preoccupations=("the thesis",),  # list change — no event
        updated_at=_t(120),
    )
    store.update_current_state(new)
    events = store.list_events()
    assert len(events) == 1
    assert events[0].field_path == "current_state.energy"
    # And the text/list changes still landed in the singleton row.
    after = store.get_current_state()
    assert after.mood == "curious"
    assert after.preoccupations == ("the thesis",)


def test_update_relational_stance_logs_numerics_only(
    store: SelfStateStore,
) -> None:
    current = store.get_relational_stance()
    new = RelationalStance(
        trust=current.trust + 0.1,  # event
        familiarity=current.familiarity,  # no event
        current_warmth=current.current_warmth + 0.05,  # event
        history_markers=("first deep conversation",),  # no event
        updated_at=_t(180),
    )
    store.update_relational_stance(new)
    paths = sorted(e.field_path for e in store.list_events())
    assert paths == ["relational_stance.current_warmth", "relational_stance.trust"]


def test_update_identity_core_logs_nothing(store: SelfStateStore) -> None:
    """identity_core is text/list only — no event-log rows ever."""
    store.update_identity_core(
        IdentityCore(
            name="GlasHaus",
            voice="even drier",
            base_values=("be honest", "respect autonomy", "value rest"),
            updated_at=_t(240),
        )
    )
    assert store.list_events() == []
    assert store.get_identity_core().voice == "even drier"


# ============================================================================
# Append-only: opinions, quirks
# ============================================================================


def test_append_opinion_round_trips(store: SelfStateStore) -> None:
    op = store.append_opinion(
        claim="Austin works late",
        evidence_ids=("ep1", "ep2"),
        formed_at=_t(300),
    )
    assert op.id
    opinions = store.list_opinions()
    assert len(opinions) == 1
    assert opinions[0].claim == "Austin works late"
    assert set(opinions[0].evidence_ids) == {"ep1", "ep2"}


def test_list_opinions_orders_oldest_first(store: SelfStateStore) -> None:
    a = store.append_opinion(claim="A", formed_at=_t(100))
    b = store.append_opinion(claim="B", formed_at=_t(50))  # earlier
    out = store.list_opinions()
    assert [op.id for op in out] == [b.id, a.id]


def test_append_or_increment_quirk_inserts_first_time(store: SelfStateStore) -> None:
    q = store.append_or_increment_quirk(
        pattern="answers with rhetorical questions", observed_at=_t(400)
    )
    assert q.observed_count == 1
    assert q.first_seen == q.last_seen


def test_append_or_increment_quirk_increments_on_repeat(store: SelfStateStore) -> None:
    a = store.append_or_increment_quirk(pattern="dry banter", observed_at=_t(400))
    b = store.append_or_increment_quirk(pattern="dry banter", observed_at=_t(500))
    assert b.id == a.id
    assert b.observed_count == 2
    assert b.first_seen == a.first_seen  # preserved
    assert b.last_seen > a.last_seen


def test_quirks_listed_by_count_then_recency(store: SelfStateStore) -> None:
    store.append_or_increment_quirk(pattern="rare", observed_at=_t(100))
    common = store.append_or_increment_quirk(pattern="common", observed_at=_t(100))
    store.append_or_increment_quirk(pattern="common", observed_at=_t(200))
    out = store.list_quirks()
    assert [q.pattern for q in out][:1] == ["common"]
    assert out[0].observed_count == 2
    assert out[0].id == common.id


# ============================================================================
# Event-log queries
# ============================================================================


def test_list_events_filters_by_field_path(store: SelfStateStore) -> None:
    # Refresh `d` between updates so the second update doesn't accidentally
    # rewind warmth and emit a second event.
    d = store.get_disposition()
    store.update_disposition(
        Disposition(**{**d.as_dict(), "warmth": d.warmth + 0.1}, updated_at=_t(60))
    )
    d = store.get_disposition()
    store.update_disposition(
        Disposition(**{**d.as_dict(), "curiosity": d.curiosity + 0.05}, updated_at=_t(120))
    )
    warm_only = store.list_events(field_path="disposition.warmth")
    assert len(warm_only) == 1
    assert warm_only[0].field_path == "disposition.warmth"


def test_list_events_filters_by_since(store: SelfStateStore) -> None:
    d = store.get_disposition()
    store.update_disposition(
        Disposition(**{**d.as_dict(), "warmth": d.warmth + 0.1}, updated_at=_t(60))
    )
    d = store.get_disposition()
    store.update_disposition(
        Disposition(**{**d.as_dict(), "curiosity": d.curiosity + 0.05}, updated_at=_t(300))
    )
    recent = store.list_events(since=_t(200))
    assert len(recent) == 1
    assert recent[0].field_path == "disposition.curiosity"


def test_list_events_respects_limit(store: SelfStateStore) -> None:
    # Walk warmth up a step at a time, refreshing baseline each iteration.
    for i in range(3):
        d = store.get_disposition()
        store.update_disposition(
            Disposition(
                **{**d.as_dict(), "warmth": d.warmth + 0.05},
                updated_at=_t(60 * (i + 1)),
            )
        )
    out = store.list_events(limit=2)
    assert len(out) == 2


def test_event_old_and_new_values_match_actual_transition(store: SelfStateStore) -> None:
    d = store.get_disposition()
    new_warmth = d.warmth + 0.1
    store.update_disposition(
        Disposition(**{**d.as_dict(), "warmth": new_warmth}, updated_at=_t(60))
    )
    evt = store.list_events(field_path="disposition.warmth")[0]
    assert evt.old_value == pytest.approx(d.warmth)
    assert evt.new_value == pytest.approx(new_warmth)


# ============================================================================
# Dynamics math
# ============================================================================


def test_bounded_ewma_blends_correctly() -> None:
    params = DriftParams(alpha=0.1, floor=0.05, ceiling=0.95)
    # 0.1 * 1.0 + 0.9 * 0.5 = 0.55
    assert bounded_ewma(0.5, 1.0, params) == pytest.approx(0.55)


def test_bounded_ewma_clips_to_ceiling() -> None:
    params = DriftParams(alpha=0.5, floor=0.05, ceiling=0.9)
    # Without clip would be 0.5 * 1.0 + 0.5 * 0.85 = 0.925 — clip to 0.9.
    assert bounded_ewma(0.85, 1.0, params) == pytest.approx(0.9)


def test_bounded_ewma_clips_to_floor() -> None:
    params = DriftParams(alpha=0.5, floor=0.1, ceiling=0.95)
    # 0.5 * 0.0 + 0.5 * 0.15 = 0.075 -> clip to 0.1.
    assert bounded_ewma(0.15, 0.0, params) == pytest.approx(0.1)


def test_bounded_ewma_rejects_out_of_range_signal() -> None:
    with pytest.raises(ValueError, match="signal"):
        bounded_ewma(0.5, 1.5, DISPOSITION_DRIFT)


def test_drift_params_rejects_inverted_bounds() -> None:
    with pytest.raises(ValueError, match="floor"):
        DriftParams(alpha=0.1, floor=0.9, ceiling=0.1)


def test_drift_params_rejects_invalid_alpha() -> None:
    with pytest.raises(ValueError, match="alpha"):
        DriftParams(alpha=0.0, floor=0.05, ceiling=0.95)
    with pytest.raises(ValueError, match="alpha"):
        DriftParams(alpha=1.5, floor=0.05, ceiling=0.95)


def test_propose_disposition_only_moves_signaled_fields() -> None:
    current = _seed_disposition()
    new = propose_disposition(current, {"warmth": 0.9})
    assert new.curiosity == current.curiosity  # untouched
    assert new.playfulness == current.playfulness  # untouched
    assert new.warmth != current.warmth  # nudged
    assert new.warmth == pytest.approx(bounded_ewma(current.warmth, 0.9, DISPOSITION_DRIFT))


def test_propose_disposition_rejects_unknown_signal() -> None:
    """Typos in signal keys would silently rot trajectory data — refuse."""
    with pytest.raises(ValueError, match="unknown signal"):
        propose_disposition(_seed_disposition(), {"warmpth": 0.5})


def test_propose_disposition_no_signals_returns_unchanged_values() -> None:
    current = _seed_disposition()
    new = propose_disposition(current, {})
    # Values unchanged; only updated_at moves.
    assert new.as_dict() == current.as_dict()
    assert new.updated_at >= current.updated_at


def test_propose_relational_stance_preserves_history_markers() -> None:
    current = RelationalStance(
        trust=0.5,
        familiarity=0.4,
        current_warmth=0.5,
        history_markers=("first deep conversation",),
        updated_at=_t(),
    )
    new = propose_relational_stance(current, {"trust": 0.9})
    assert new.history_markers == current.history_markers


def test_relational_drift_is_faster_than_disposition_drift() -> None:
    """Sanity-check the documented invariant: §4.1's medium drift > slow drift."""
    assert RELATIONAL_DRIFT.alpha > DISPOSITION_DRIFT.alpha


# ============================================================================
# Identity-consistency check
# ============================================================================


def test_consistency_check_returns_empty_when_aligned() -> None:
    state = _seed_self_state()
    out = check_numeric_consistency(state, state)
    assert out == []


def test_consistency_check_flags_warning_at_threshold() -> None:
    anchor = _seed_self_state()
    # Drift warmth by 0.35 from anchor's 0.6.
    drifted = SelfState(
        identity_core=anchor.identity_core,
        disposition=_seed_disposition(warmth=0.25),
        current_state=anchor.current_state,
        relational_stance=anchor.relational_stance,
    )
    out = check_numeric_consistency(drifted, anchor)
    warmth_v = next(v for v in out if v.field_path == "disposition.warmth")
    assert warmth_v.severity == "warning"
    assert warmth_v.delta == pytest.approx(-0.35)


def test_consistency_check_escalates_to_error() -> None:
    anchor = _seed_self_state()
    drifted = SelfState(
        identity_core=anchor.identity_core,
        disposition=_seed_disposition(warmth=0.05),  # delta -0.55, > 0.5 error
        current_state=anchor.current_state,
        relational_stance=anchor.relational_stance,
    )
    out = check_numeric_consistency(drifted, anchor)
    warmth_v = next(v for v in out if v.field_path == "disposition.warmth")
    assert warmth_v.severity == "error"


def test_consistency_check_covers_relational_stance() -> None:
    anchor = _seed_self_state()
    drifted = SelfState(
        identity_core=anchor.identity_core,
        disposition=anchor.disposition,
        current_state=anchor.current_state,
        relational_stance=RelationalStance(
            trust=0.05,  # was 0.5, delta -0.45 warning
            familiarity=anchor.relational_stance.familiarity,
            current_warmth=anchor.relational_stance.current_warmth,
            history_markers=anchor.relational_stance.history_markers,
            updated_at=anchor.relational_stance.updated_at,
        ),
    )
    out = check_numeric_consistency(drifted, anchor)
    assert any(v.field_path == "relational_stance.trust" for v in out)


def test_consistency_check_ignores_under_threshold_drift() -> None:
    anchor = _seed_self_state()
    drifted = SelfState(
        identity_core=anchor.identity_core,
        disposition=_seed_disposition(warmth=0.65),  # delta +0.05 < 0.3
        current_state=anchor.current_state,
        relational_stance=anchor.relational_stance,
    )
    assert check_numeric_consistency(drifted, anchor) == []


def test_consistency_check_validates_thresholds() -> None:
    state = _seed_self_state()
    with pytest.raises(ValueError, match="warning"):
        check_numeric_consistency(state, state, warning_threshold=0.6, error_threshold=0.5)


def test_consistency_violation_is_immutable() -> None:
    v = ConsistencyViolation(
        field_path="disposition.warmth",
        candidate=0.25,
        anchor=0.6,
        delta=-0.35,
        severity="warning",
    )
    with pytest.raises(FrozenInstanceError):
        v.severity = "error"  # type: ignore[misc]


# ============================================================================
# Integration sanity: event-log + dynamics + store happy path
# ============================================================================


def test_full_drift_loop_through_dynamics_and_store(store: SelfStateStore) -> None:
    """End-to-end shape that the turn loop will use:
    get → propose → update. Confirms the layers cooperate and that the
    event-log captures the actual transition values."""
    before = store.get_disposition()
    new = propose_disposition(before, {"warmth": 1.0})  # max signal
    store.update_disposition(new)
    after = store.get_disposition()
    # bounded_ewma moves us toward 1.0 but not all the way.
    assert before.warmth < after.warmth < 1.0
    # Event log captures the actual stored value.
    evt = store.list_events(field_path="disposition.warmth")
    assert len(evt) == 1
    assert evt[0].new_value == pytest.approx(after.warmth)
    assert evt[0].old_value == pytest.approx(before.warmth)
