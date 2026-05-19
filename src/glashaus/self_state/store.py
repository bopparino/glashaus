"""SelfStateStore — pure CRUD for the self_state singleton, the append-
only opinions/quirks tables, and the self_state_events trajectory log.

Design contracts (called out explicitly so chunks 4-7 don't drift):

- **Store is pure.** It accepts already-computed values and writes them.
  Drift math (EWMA, clipping) lives in
  [`glashaus.self_state.dynamics`][]. The store knows nothing about how
  the proposed values were derived.
- **Event log on numeric deltas only.** The four `update_*` methods
  compare old and new values and write one `self_state_events` row per
  *changed* numeric field. Unchanged fields don't log. Text and list
  fields don't log here — they're outside the trajectory scope of
  migration 002.
- **No memory coupling.** The store does not import `MemoryStore` and
  doesn't require one to function. Trajectories can cite an
  `episodic_id` (FK with ON DELETE SET NULL) but reading self-state
  never derives anything from episodic.
- **`initialize` is hard-once.** Re-initializing wipes the agent's
  identity; calling it twice raises. Migrations don't seed self-state
  — the first-run wizard (chunk 7) is responsible for that.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Final

from glashaus.self_state.types import (
    DISPOSITION_FIELDS,
    RELATIONAL_FIELDS,
    CurrentState,
    Disposition,
    FormedOpinion,
    IdentityCore,
    Quirk,
    RelationalStance,
    SelfState,
    SelfStateEvent,
)
from glashaus.storage import transaction

# Single canonical ISO format (matches glashaus.memory.store._ISO_FMT).
_ISO_FMT: Final[str] = "%Y-%m-%dT%H:%M:%S.%fZ"


def _to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime(_ISO_FMT)


def _from_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _now() -> datetime:
    return datetime.now(UTC)


class SelfStateStore:
    """Persistence for §4 self-state. Pass a vec-loaded connection."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    # ------------------------------------------------------------------
    # Init / inspection
    # ------------------------------------------------------------------

    def is_initialized(self) -> bool:
        row = self.conn.execute("SELECT singleton FROM self_state WHERE singleton = 1").fetchone()
        return row is not None

    def initialize(
        self,
        *,
        identity_core: IdentityCore,
        disposition: Disposition,
        current_state: CurrentState,
        relational_stance: RelationalStance,
    ) -> None:
        """Insert the singleton row. Raises if already initialized.

        First-run wizard responsibility (chunk 7). Migrations don't seed
        self-state — that would couple schema to wizard choices.
        """
        if self.is_initialized():
            raise RuntimeError("self_state is already initialized; refusing to clobber")
        with transaction(self.conn):
            self.conn.execute(
                """INSERT INTO self_state (
                    singleton,
                    identity_name, identity_voice, identity_base_values_json,
                    identity_updated_at,
                    disp_curiosity, disp_playfulness, disp_reserve, disp_warmth,
                    disp_directness, disp_updated_at,
                    cs_mood, cs_energy, cs_preoccupations_json, cs_updated_at,
                    rel_trust, rel_familiarity, rel_current_warmth,
                    rel_history_markers_json, rel_updated_at
                ) VALUES (
                    1,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?
                )""",
                (
                    identity_core.name,
                    identity_core.voice,
                    json.dumps(list(identity_core.base_values)),
                    _to_iso(identity_core.updated_at),
                    disposition.curiosity,
                    disposition.playfulness,
                    disposition.reserve,
                    disposition.warmth,
                    disposition.directness,
                    _to_iso(disposition.updated_at),
                    current_state.mood,
                    current_state.energy,
                    json.dumps(list(current_state.preoccupations)),
                    _to_iso(current_state.updated_at),
                    relational_stance.trust,
                    relational_stance.familiarity,
                    relational_stance.current_warmth,
                    json.dumps(list(relational_stance.history_markers)),
                    _to_iso(relational_stance.updated_at),
                ),
            )

    def get(self) -> SelfState:
        """Full composite read. Two queries: the singleton row, then
        opinions + quirks (each as one query)."""
        return SelfState(
            identity_core=self.get_identity_core(),
            disposition=self.get_disposition(),
            current_state=self.get_current_state(),
            relational_stance=self.get_relational_stance(),
            formed_opinions=tuple(self.list_opinions()),
            quirks=tuple(self.list_quirks()),
        )

    def get_identity_core(self) -> IdentityCore:
        row = self._require_singleton()
        return IdentityCore(
            name=row["identity_name"],
            voice=row["identity_voice"],
            base_values=tuple(json.loads(row["identity_base_values_json"])),
            updated_at=_from_iso(row["identity_updated_at"]),
        )

    def get_disposition(self) -> Disposition:
        row = self._require_singleton()
        return Disposition(
            curiosity=row["disp_curiosity"],
            playfulness=row["disp_playfulness"],
            reserve=row["disp_reserve"],
            warmth=row["disp_warmth"],
            directness=row["disp_directness"],
            updated_at=_from_iso(row["disp_updated_at"]),
        )

    def get_current_state(self) -> CurrentState:
        row = self._require_singleton()
        return CurrentState(
            mood=row["cs_mood"],
            energy=row["cs_energy"],
            preoccupations=tuple(json.loads(row["cs_preoccupations_json"])),
            updated_at=_from_iso(row["cs_updated_at"]),
        )

    def get_relational_stance(self) -> RelationalStance:
        row = self._require_singleton()
        return RelationalStance(
            trust=row["rel_trust"],
            familiarity=row["rel_familiarity"],
            current_warmth=row["rel_current_warmth"],
            history_markers=tuple(json.loads(row["rel_history_markers_json"])),
            updated_at=_from_iso(row["rel_updated_at"]),
        )

    # ------------------------------------------------------------------
    # Updates
    # ------------------------------------------------------------------

    def update_identity_core(self, new: IdentityCore) -> None:
        """Anchor update — §4.1: drift speed *almost never*. No event-log
        rows because identity_core fields are textual / list-typed."""
        self._require_singleton()
        with transaction(self.conn):
            self.conn.execute(
                """UPDATE self_state SET
                    identity_name = ?,
                    identity_voice = ?,
                    identity_base_values_json = ?,
                    identity_updated_at = ?
                   WHERE singleton = 1""",
                (
                    new.name,
                    new.voice,
                    json.dumps(list(new.base_values)),
                    _to_iso(new.updated_at),
                ),
            )

    def update_disposition(
        self,
        new: Disposition,
        *,
        trigger_episodic_id: str | None = None,
    ) -> None:
        """Write the full Disposition. Per-field event-log rows are
        emitted for every numeric field whose value actually changed."""
        old = self.get_disposition()
        with transaction(self.conn):
            self.conn.execute(
                """UPDATE self_state SET
                    disp_curiosity   = ?,
                    disp_playfulness = ?,
                    disp_reserve     = ?,
                    disp_warmth      = ?,
                    disp_directness  = ?,
                    disp_updated_at  = ?
                   WHERE singleton = 1""",
                (
                    new.curiosity,
                    new.playfulness,
                    new.reserve,
                    new.warmth,
                    new.directness,
                    _to_iso(new.updated_at),
                ),
            )
            self._log_numeric_deltas(
                prefix="disposition",
                field_names=DISPOSITION_FIELDS,
                old=old,
                new=new,
                ts=new.updated_at,
                trigger_episodic_id=trigger_episodic_id,
            )

    def update_current_state(
        self,
        new: CurrentState,
        *,
        trigger_episodic_id: str | None = None,
    ) -> None:
        """Write current_state. Only `energy` is numeric; mood and
        preoccupations don't log (per migration 002's scoping)."""
        old = self.get_current_state()
        with transaction(self.conn):
            self.conn.execute(
                """UPDATE self_state SET
                    cs_mood = ?,
                    cs_energy = ?,
                    cs_preoccupations_json = ?,
                    cs_updated_at = ?
                   WHERE singleton = 1""",
                (
                    new.mood,
                    new.energy,
                    json.dumps(list(new.preoccupations)),
                    _to_iso(new.updated_at),
                ),
            )
            self._log_numeric_deltas(
                prefix="current_state",
                field_names=("energy",),
                old=old,
                new=new,
                ts=new.updated_at,
                trigger_episodic_id=trigger_episodic_id,
            )

    def update_relational_stance(
        self,
        new: RelationalStance,
        *,
        trigger_episodic_id: str | None = None,
    ) -> None:
        """Write relational_stance. trust / familiarity / current_warmth
        log; history_markers is list-typed and stays out of the event
        log."""
        old = self.get_relational_stance()
        with transaction(self.conn):
            self.conn.execute(
                """UPDATE self_state SET
                    rel_trust = ?,
                    rel_familiarity = ?,
                    rel_current_warmth = ?,
                    rel_history_markers_json = ?,
                    rel_updated_at = ?
                   WHERE singleton = 1""",
                (
                    new.trust,
                    new.familiarity,
                    new.current_warmth,
                    json.dumps(list(new.history_markers)),
                    _to_iso(new.updated_at),
                ),
            )
            self._log_numeric_deltas(
                prefix="relational_stance",
                field_names=RELATIONAL_FIELDS,
                old=old,
                new=new,
                ts=new.updated_at,
                trigger_episodic_id=trigger_episodic_id,
            )

    # ------------------------------------------------------------------
    # Append-only: opinions, quirks
    # ------------------------------------------------------------------

    def append_opinion(
        self,
        *,
        claim: str,
        evidence_ids: Iterable[str] = (),
        formed_at: datetime | None = None,
        id: str | None = None,
    ) -> FormedOpinion:
        evidence_t = tuple(evidence_ids)
        op_id = id or str(uuid.uuid4())
        ts = formed_at or _now()
        opinion = FormedOpinion(id=op_id, claim=claim, formed_at=ts, evidence_ids=evidence_t)
        with transaction(self.conn):
            self.conn.execute(
                "INSERT INTO formed_opinions (id, claim, formed_at, evidence_ids_json) "
                "VALUES (?, ?, ?, ?)",
                (op_id, claim, _to_iso(ts), json.dumps(list(evidence_t))),
            )
        return opinion

    def list_opinions(self, *, limit: int | None = None) -> list[FormedOpinion]:
        sql = (
            "SELECT id, claim, formed_at, evidence_ids_json "
            "FROM formed_opinions ORDER BY formed_at ASC"
        )
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        rows = self.conn.execute(sql).fetchall()
        return [
            FormedOpinion(
                id=row["id"],
                claim=row["claim"],
                formed_at=_from_iso(row["formed_at"]),
                evidence_ids=tuple(json.loads(row["evidence_ids_json"])),
            )
            for row in rows
        ]

    def append_or_increment_quirk(
        self, *, pattern: str, observed_at: datetime | None = None
    ) -> Quirk:
        """Either insert a new quirk row or bump observed_count and
        last_seen for the existing row matching this pattern."""
        ts = observed_at or _now()
        with transaction(self.conn):
            row = self.conn.execute(
                "SELECT id, observed_count, first_seen FROM quirks WHERE pattern = ?",
                (pattern,),
            ).fetchone()
            if row is None:
                qid = str(uuid.uuid4())
                self.conn.execute(
                    "INSERT INTO quirks "
                    "(id, pattern, observed_count, first_seen, last_seen) "
                    "VALUES (?, ?, 1, ?, ?)",
                    (qid, pattern, _to_iso(ts), _to_iso(ts)),
                )
                return Quirk(
                    id=qid,
                    pattern=pattern,
                    observed_count=1,
                    first_seen=ts,
                    last_seen=ts,
                )
            qid = row["id"]
            new_count = int(row["observed_count"]) + 1
            self.conn.execute(
                "UPDATE quirks SET observed_count = ?, last_seen = ? WHERE id = ?",
                (new_count, _to_iso(ts), qid),
            )
            return Quirk(
                id=qid,
                pattern=pattern,
                observed_count=new_count,
                first_seen=_from_iso(row["first_seen"]),
                last_seen=ts,
            )

    def list_quirks(self) -> list[Quirk]:
        rows = self.conn.execute(
            "SELECT id, pattern, observed_count, first_seen, last_seen "
            "FROM quirks ORDER BY observed_count DESC, last_seen DESC"
        ).fetchall()
        return [
            Quirk(
                id=row["id"],
                pattern=row["pattern"],
                observed_count=int(row["observed_count"]),
                first_seen=_from_iso(row["first_seen"]),
                last_seen=_from_iso(row["last_seen"]),
            )
            for row in rows
        ]

    # ------------------------------------------------------------------
    # Event log (trajectories)
    # ------------------------------------------------------------------

    def list_events(
        self,
        *,
        field_path: str | None = None,
        since: datetime | None = None,
        limit: int = 1000,
    ) -> list[SelfStateEvent]:
        clauses: list[str] = []
        params: list[object] = []
        if field_path is not None:
            clauses.append("field_path = ?")
            params.append(field_path)
        if since is not None:
            clauses.append("ts >= ?")
            params.append(_to_iso(since))
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        sql = (
            "SELECT id, ts, field_path, old_value, new_value, trigger_episodic_id "
            f"FROM self_state_events {where} "
            "ORDER BY id ASC LIMIT ?"
        )
        params.append(int(limit))
        rows = self.conn.execute(sql, params).fetchall()
        return [
            SelfStateEvent(
                id=int(row["id"]),
                ts=_from_iso(row["ts"]),
                field_path=row["field_path"],
                old_value=float(row["old_value"]),
                new_value=float(row["new_value"]),
                trigger_episodic_id=row["trigger_episodic_id"],
            )
            for row in rows
        ]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _require_singleton(self) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM self_state WHERE singleton = 1").fetchone()
        if row is None:
            raise RuntimeError("self_state is not initialized — call initialize() first")
        # `fetchone()` is typed as Any in the stdlib stubs; the None check
        # above is the only narrowing mypy can use.
        assert isinstance(row, sqlite3.Row)
        return row

    def _log_numeric_deltas(
        self,
        *,
        prefix: str,
        field_names: Iterable[str],
        old: object,
        new: object,
        ts: datetime,
        trigger_episodic_id: str | None,
    ) -> None:
        """Emit one self_state_events row per field whose value changed.
        Called from inside an open transaction by each update_* method."""
        rows: list[tuple[str, str, float, float, str | None]] = []
        ts_iso = _to_iso(ts)
        for name in field_names:
            old_v = float(getattr(old, name))
            new_v = float(getattr(new, name))
            if old_v == new_v:
                continue
            rows.append((ts_iso, f"{prefix}.{name}", old_v, new_v, trigger_episodic_id))
        if rows:
            self.conn.executemany(
                "INSERT INTO self_state_events "
                "(ts, field_path, old_value, new_value, trigger_episodic_id) "
                "VALUES (?, ?, ?, ?, ?)",
                rows,
            )
