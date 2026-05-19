"""Episodic + semantic write/read API.

What this layer is and isn't:

- **Is**: typed CRUD against the SQL tables defined in 001_initial.sql.
  Stable, predictable, transactional. Domain-validated on the way in.
- **Isn't**: salience scoring, affect inference, embedding generation,
  consolidation, or retrieval ranking. Those live higher up (turn loop,
  retriever, dream cycle).

Convention enforced here: every SELECT that touches an embedding goes
through a LEFT JOIN against `*_vec`. Records without embeddings still
surface; the `has_embedding` flag on the returned dataclass tells the
retriever which branch to use.
"""

from __future__ import annotations

import json
import sqlite3
import struct
import uuid
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from typing import Final

from glashaus.memory.types import Affect, EpisodicMemory, SemanticMemory
from glashaus.storage import transaction

# 001_initial.sql declares `FLOAT[1536]` for both vec0 tables. Anything
# else is a callsite bug, not a runtime decision.
EMBEDDING_DIM: Final[int] = 1536


# Timestamps are stored as ISO-8601 UTC with microsecond precision.
# `%f` is microseconds (6 digits) so the full second component is `%S.%f`.
_ISO_FMT = "%Y-%m-%dT%H:%M:%S.%fZ"


def _to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        # Treat naive as UTC. The CLI/turn loop will always pass aware
        # datetimes; this branch protects ad-hoc test callers.
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime(_ISO_FMT)


def _from_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _pack_embedding(emb: Sequence[float]) -> bytes:
    if len(emb) != EMBEDDING_DIM:
        raise ValueError(f"embedding must be {EMBEDDING_DIM}-d, got {len(emb)}")
    return struct.pack(f"<{EMBEDDING_DIM}f", *emb)


class MemoryStore:
    """Episodic + semantic store. Pass an open, vec-loaded connection."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    # ------------------------------------------------------------------
    # Episodic
    # ------------------------------------------------------------------

    def write_episodic(
        self,
        *,
        content: str,
        user_id: str,
        agent_id: str,
        affect: Affect,
        salience: float,
        channel: str = "cli",
        topics: Iterable[str] = (),
        references: Iterable[str] = (),
        embedding: Sequence[float] | None = None,
        ts: datetime | None = None,
        id: str | None = None,
    ) -> EpisodicMemory:
        """Persist an episodic record + its topics/references/embedding.

        All inserts run in one transaction; partial writes are impossible.
        Salience is required and provided by the caller (§3.3: agent
        self-scores on write — in the turn loop, not here).
        """
        topics_t = tuple(topics)
        refs_t = tuple(references)
        ep_id = id or str(uuid.uuid4())
        ep_ts = ts or datetime.now(UTC)

        # Build the dataclass first so __post_init__ validates everything
        # before we ever touch the DB. Cheaper failures = clearer stack
        # traces.
        ep = EpisodicMemory(
            id=ep_id,
            ts=ep_ts,
            content=content,
            user_id=user_id,
            agent_id=agent_id,
            affect=affect,
            salience=salience,
            topics=topics_t,
            channel=channel,
            references=refs_t,
            has_embedding=embedding is not None,
        )

        with transaction(self.conn):
            self.conn.execute(
                """INSERT INTO episodic
                   (id, ts, content, user_id, agent_id, valence, arousal,
                    dominant_emotion, salience, channel)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    ep.id,
                    _to_iso(ep.ts),
                    ep.content,
                    ep.user_id,
                    ep.agent_id,
                    ep.affect.valence,
                    ep.affect.arousal,
                    ep.affect.dominant_emotion,
                    ep.salience,
                    ep.channel,
                ),
            )
            if topics_t:
                self.conn.executemany(
                    "INSERT INTO episodic_topics (episodic_id, topic) VALUES (?, ?)",
                    [(ep.id, t) for t in topics_t],
                )
            if refs_t:
                self.conn.executemany(
                    "INSERT INTO episodic_references (src_id, dst_id) VALUES (?, ?)",
                    [(ep.id, r) for r in refs_t],
                )
            if embedding is not None:
                self.conn.execute(
                    "INSERT INTO episodic_vec (episodic_id, embedding) VALUES (?, ?)",
                    (ep.id, _pack_embedding(embedding)),
                )
        return ep

    def get_episodic(self, id: str) -> EpisodicMemory | None:
        row = self.conn.execute(
            _EPISODIC_SELECT + " WHERE ep.id = ?",
            (id,),
        ).fetchone()
        return _row_to_episodic(row) if row is not None else None

    def episodic_by_ids(self, ids: Iterable[str]) -> list[EpisodicMemory]:
        """Return records in the order requested. Missing ids are silently
        dropped — the caller decides whether that's an error."""
        ids_list = list(ids)
        if not ids_list:
            return []

        placeholders = ",".join("?" * len(ids_list))
        rows = self.conn.execute(
            _EPISODIC_SELECT + f" WHERE ep.id IN ({placeholders})",
            ids_list,
        ).fetchall()
        by_id = {row["id"]: _row_to_episodic(row) for row in rows}
        return [by_id[i] for i in ids_list if i in by_id]

    # ------------------------------------------------------------------
    # Semantic
    # ------------------------------------------------------------------

    def write_semantic(
        self,
        *,
        claim: str,
        confidence: float,
        evidence: Iterable[str] = (),
        contradictions: Iterable[str] = (),
        embedding: Sequence[float] | None = None,
        last_updated: datetime | None = None,
        id: str | None = None,
    ) -> SemanticMemory:
        evidence_t = tuple(evidence)
        contradictions_t = tuple(contradictions)
        sm_id = id or str(uuid.uuid4())
        ts = last_updated or datetime.now(UTC)

        sm = SemanticMemory(
            id=sm_id,
            claim=claim,
            confidence=confidence,
            evidence=evidence_t,
            last_updated=ts,
            contradictions=contradictions_t,
            has_embedding=embedding is not None,
        )

        with transaction(self.conn):
            self.conn.execute(
                "INSERT INTO semantic (id, claim, confidence, last_updated) VALUES (?, ?, ?, ?)",
                (sm.id, sm.claim, sm.confidence, _to_iso(ts)),
            )
            if evidence_t:
                self.conn.executemany(
                    "INSERT INTO semantic_evidence (semantic_id, episodic_id) VALUES (?, ?)",
                    [(sm.id, e) for e in evidence_t],
                )
            if contradictions_t:
                self.conn.executemany(
                    "INSERT INTO semantic_contradictions "
                    "(semantic_id, other_semantic_id) VALUES (?, ?)",
                    [(sm.id, c) for c in contradictions_t],
                )
            if embedding is not None:
                self.conn.execute(
                    "INSERT INTO semantic_vec (semantic_id, embedding) VALUES (?, ?)",
                    (sm.id, _pack_embedding(embedding)),
                )
        return sm

    def get_semantic(self, id: str) -> SemanticMemory | None:
        row = self.conn.execute(
            _SEMANTIC_SELECT + " WHERE sm.id = ?",
            (id,),
        ).fetchone()
        return _row_to_semantic(row) if row is not None else None

    def semantic_by_ids(self, ids: Iterable[str]) -> list[SemanticMemory]:
        ids_list = list(ids)
        if not ids_list:
            return []
        placeholders = ",".join("?" * len(ids_list))
        rows = self.conn.execute(
            _SEMANTIC_SELECT + f" WHERE sm.id IN ({placeholders})",
            ids_list,
        ).fetchall()
        by_id = {row["id"]: _row_to_semantic(row) for row in rows}
        return [by_id[i] for i in ids_list if i in by_id]


# --------------------------------------------------------------------------
# Read queries — LEFT JOIN against *_vec is non-negotiable. Records without
# embeddings must still appear.
# --------------------------------------------------------------------------

_EPISODIC_SELECT = """
SELECT
    ep.id, ep.ts, ep.content, ep.user_id, ep.agent_id,
    ep.valence, ep.arousal, ep.dominant_emotion,
    ep.salience, ep.channel,
    (ep_vec.episodic_id IS NOT NULL) AS has_embedding,
    (SELECT COALESCE(json_group_array(topic), '[]')
       FROM episodic_topics
      WHERE episodic_id = ep.id)            AS topics_json,
    (SELECT COALESCE(json_group_array(dst_id), '[]')
       FROM episodic_references
      WHERE src_id = ep.id)                 AS refs_json
FROM episodic ep
LEFT JOIN episodic_vec ep_vec ON ep_vec.episodic_id = ep.id
"""


_SEMANTIC_SELECT = """
SELECT
    sm.id, sm.claim, sm.confidence, sm.last_updated,
    (sm_vec.semantic_id IS NOT NULL) AS has_embedding,
    (SELECT COALESCE(json_group_array(episodic_id), '[]')
       FROM semantic_evidence
      WHERE semantic_id = sm.id)            AS evidence_json,
    (SELECT COALESCE(json_group_array(other_semantic_id), '[]')
       FROM semantic_contradictions
      WHERE semantic_id = sm.id)            AS contradictions_json
FROM semantic sm
LEFT JOIN semantic_vec sm_vec ON sm_vec.semantic_id = sm.id
"""


def _row_to_episodic(row: sqlite3.Row) -> EpisodicMemory:
    return EpisodicMemory(
        id=row["id"],
        ts=_from_iso(row["ts"]),
        content=row["content"],
        user_id=row["user_id"],
        agent_id=row["agent_id"],
        affect=Affect(
            valence=row["valence"],
            arousal=row["arousal"],
            dominant_emotion=row["dominant_emotion"],
        ),
        salience=row["salience"],
        topics=tuple(json.loads(row["topics_json"])),
        channel=row["channel"],
        references=tuple(json.loads(row["refs_json"])),
        has_embedding=bool(row["has_embedding"]),
    )


def _row_to_semantic(row: sqlite3.Row) -> SemanticMemory:
    return SemanticMemory(
        id=row["id"],
        claim=row["claim"],
        confidence=row["confidence"],
        evidence=tuple(json.loads(row["evidence_json"])),
        last_updated=_from_iso(row["last_updated"]),
        contradictions=tuple(json.loads(row["contradictions_json"])),
        has_embedding=bool(row["has_embedding"]),
    )
