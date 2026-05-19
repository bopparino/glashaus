-- ============================================================================
-- 001_initial.sql — GlasHaus initial schema.
--
-- Implements §3.1 EpisodicMemory, §3.2 SemanticMemory, §4 SelfState from
-- GLASHAUS_PLAN.md. Forward-only — once shipped, never edited. Subsequent
-- changes are 002_*.sql, 003_*.sql, etc.
--
-- All timestamps are ISO-8601 UTC strings (TEXT) for portability and
-- human-readability. SQLite has no native timestamp type and using TEXT
-- + sqlite's datetime() functions is the recommended path.
--
-- Embedding dimension is 1536 to match OpenAI text-embedding-3-small,
-- which is Phase 1's embedding model. Changing the dim requires a new
-- migration that drops and recreates the *_vec virtual tables (vec0's
-- dim is fixed at CREATE time).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- schema_version: which migrations have been applied.
-- ---------------------------------------------------------------------------
CREATE TABLE schema_version (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- episodic: what happened (§3.1)
-- ---------------------------------------------------------------------------
CREATE TABLE episodic (
    id               TEXT PRIMARY KEY,
    ts               TEXT NOT NULL,
    content          TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    agent_id         TEXT NOT NULL,
    valence          REAL NOT NULL CHECK (valence BETWEEN -1 AND 1),
    arousal          REAL NOT NULL CHECK (arousal BETWEEN 0 AND 1),
    dominant_emotion TEXT NOT NULL,
    salience         REAL NOT NULL CHECK (salience BETWEEN 0 AND 1),
    channel          TEXT NOT NULL
);

CREATE INDEX idx_episodic_ts        ON episodic(ts);
CREATE INDEX idx_episodic_salience  ON episodic(salience);
CREATE INDEX idx_episodic_channel   ON episodic(channel);

-- Topics tagged on episodic records (many-to-many).
CREATE TABLE episodic_topics (
    episodic_id TEXT NOT NULL REFERENCES episodic(id) ON DELETE CASCADE,
    topic       TEXT NOT NULL,
    PRIMARY KEY (episodic_id, topic)
);

CREATE INDEX idx_episodic_topics_topic ON episodic_topics(topic);

-- Thread links between episodic records — directed, "src is a reply to dst".
CREATE TABLE episodic_references (
    src_id TEXT NOT NULL REFERENCES episodic(id) ON DELETE CASCADE,
    dst_id TEXT NOT NULL REFERENCES episodic(id) ON DELETE CASCADE,
    PRIMARY KEY (src_id, dst_id),
    CHECK (src_id != dst_id)
);

-- FTS5 index over episodic content (external-content mode tied to episodic).
CREATE VIRTUAL TABLE episodic_fts USING fts5(
    content,
    content='episodic',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

CREATE TRIGGER episodic_fts_insert AFTER INSERT ON episodic BEGIN
    INSERT INTO episodic_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER episodic_fts_delete AFTER DELETE ON episodic BEGIN
    INSERT INTO episodic_fts(episodic_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER episodic_fts_update AFTER UPDATE ON episodic BEGIN
    INSERT INTO episodic_fts(episodic_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO episodic_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Vector embeddings for episodic records (sqlite-vec). Nullable in the
-- sense that we may not have an embedding for every record yet (e.g.,
-- waiting on the batch embedder). vec0 itself requires a row per id, so
-- "no embedding" is represented by absence from this table, not NULL.
CREATE VIRTUAL TABLE episodic_vec USING vec0(
    episodic_id TEXT PRIMARY KEY,
    embedding   FLOAT[1536]
);

-- ---------------------------------------------------------------------------
-- semantic: what is, derived from many episodes (§3.2)
-- ---------------------------------------------------------------------------
CREATE TABLE semantic (
    id           TEXT PRIMARY KEY,
    claim        TEXT NOT NULL,
    confidence   REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    last_updated TEXT NOT NULL
);

CREATE INDEX idx_semantic_last_updated ON semantic(last_updated);

CREATE TABLE semantic_evidence (
    semantic_id TEXT NOT NULL REFERENCES semantic(id) ON DELETE CASCADE,
    episodic_id TEXT NOT NULL REFERENCES episodic(id) ON DELETE CASCADE,
    PRIMARY KEY (semantic_id, episodic_id)
);

CREATE TABLE semantic_contradictions (
    semantic_id       TEXT NOT NULL REFERENCES semantic(id) ON DELETE CASCADE,
    other_semantic_id TEXT NOT NULL REFERENCES semantic(id) ON DELETE CASCADE,
    PRIMARY KEY (semantic_id, other_semantic_id),
    CHECK (semantic_id != other_semantic_id)
);

CREATE VIRTUAL TABLE semantic_fts USING fts5(
    claim,
    content='semantic',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

CREATE TRIGGER semantic_fts_insert AFTER INSERT ON semantic BEGIN
    INSERT INTO semantic_fts(rowid, claim) VALUES (new.rowid, new.claim);
END;

CREATE TRIGGER semantic_fts_delete AFTER DELETE ON semantic BEGIN
    INSERT INTO semantic_fts(semantic_fts, rowid, claim) VALUES('delete', old.rowid, old.claim);
END;

CREATE TRIGGER semantic_fts_update AFTER UPDATE ON semantic BEGIN
    INSERT INTO semantic_fts(semantic_fts, rowid, claim) VALUES('delete', old.rowid, old.claim);
    INSERT INTO semantic_fts(rowid, claim) VALUES (new.rowid, new.claim);
END;

CREATE VIRTUAL TABLE semantic_vec USING vec0(
    semantic_id TEXT PRIMARY KEY,
    embedding   FLOAT[1536]
);

-- ---------------------------------------------------------------------------
-- self_state: the agent's evolving model of itself (§4)
--
-- Single-row table. Layered fields are inlined as columns where they have
-- fixed structure; variable-length pieces (base_values list, preoccupations
-- list, history_markers list) are JSON arrays. The drift speeds in §4.1
-- are enforced by storing per-layer `*_updated_at` timestamps and reading
-- them in self_state code paths.
--
-- The plan's `formed_opinions` and `quirks` fields are append-only so they
-- live in their own tables (below).
-- ---------------------------------------------------------------------------
CREATE TABLE self_state (
    singleton                INTEGER PRIMARY KEY CHECK (singleton = 1),

    -- identity_core (§4) — drift: almost never
    identity_name            TEXT NOT NULL,
    identity_voice           TEXT NOT NULL,
    identity_base_values_json TEXT NOT NULL,
    identity_updated_at      TEXT NOT NULL,

    -- disposition (§4) — drift: slow, bounded EWMA, floors/ceilings
    disp_curiosity           REAL NOT NULL CHECK (disp_curiosity   BETWEEN 0 AND 1),
    disp_playfulness         REAL NOT NULL CHECK (disp_playfulness BETWEEN 0 AND 1),
    disp_reserve             REAL NOT NULL CHECK (disp_reserve     BETWEEN 0 AND 1),
    disp_warmth              REAL NOT NULL CHECK (disp_warmth      BETWEEN 0 AND 1),
    disp_directness          REAL NOT NULL CHECK (disp_directness  BETWEEN 0 AND 1),
    disp_updated_at          TEXT NOT NULL,

    -- current_state (§4) — drift: per session
    cs_mood                  TEXT NOT NULL,
    cs_energy                REAL NOT NULL CHECK (cs_energy BETWEEN 0 AND 1),
    cs_preoccupations_json   TEXT NOT NULL,
    cs_updated_at            TEXT NOT NULL,

    -- relational_stance (§4) — drift: medium (days)
    rel_trust                REAL NOT NULL CHECK (rel_trust          BETWEEN 0 AND 1),
    rel_familiarity          REAL NOT NULL CHECK (rel_familiarity    BETWEEN 0 AND 1),
    rel_current_warmth       REAL NOT NULL CHECK (rel_current_warmth BETWEEN 0 AND 1),
    rel_history_markers_json TEXT NOT NULL,
    rel_updated_at           TEXT NOT NULL
);

-- Append-only opinions the agent has formed (§4).
CREATE TABLE formed_opinions (
    id                TEXT PRIMARY KEY,
    claim             TEXT NOT NULL,
    formed_at         TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL
);

CREATE INDEX idx_formed_opinions_formed_at ON formed_opinions(formed_at);

-- Emergent quirks the agent notices in itself (§4).
CREATE TABLE quirks (
    id             TEXT PRIMARY KEY,
    pattern        TEXT NOT NULL UNIQUE,
    observed_count INTEGER NOT NULL DEFAULT 1,
    first_seen     TEXT NOT NULL,
    last_seen      TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Record this migration.
-- ---------------------------------------------------------------------------
INSERT INTO schema_version (version, name) VALUES (1, '001_initial');
