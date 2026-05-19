-- [index] idx_episodic_channel (tbl=episodic)
CREATE INDEX idx_episodic_channel   ON episodic(channel);

-- [index] idx_episodic_salience (tbl=episodic)
CREATE INDEX idx_episodic_salience  ON episodic(salience);

-- [index] idx_episodic_topics_topic (tbl=episodic_topics)
CREATE INDEX idx_episodic_topics_topic ON episodic_topics(topic);

-- [index] idx_episodic_ts (tbl=episodic)
CREATE INDEX idx_episodic_ts        ON episodic(ts);

-- [index] idx_formed_opinions_formed_at (tbl=formed_opinions)
CREATE INDEX idx_formed_opinions_formed_at ON formed_opinions(formed_at);

-- [index] idx_semantic_last_updated (tbl=semantic)
CREATE INDEX idx_semantic_last_updated ON semantic(last_updated);

-- [table] episodic (tbl=episodic)
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

-- [table] episodic_fts (tbl=episodic_fts)
CREATE VIRTUAL TABLE episodic_fts USING fts5(
    content,
    content='episodic',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- [table] episodic_fts_config (tbl=episodic_fts_config)
CREATE TABLE 'episodic_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

-- [table] episodic_fts_data (tbl=episodic_fts_data)
CREATE TABLE 'episodic_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

-- [table] episodic_fts_docsize (tbl=episodic_fts_docsize)
CREATE TABLE 'episodic_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

-- [table] episodic_fts_idx (tbl=episodic_fts_idx)
CREATE TABLE 'episodic_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

-- [table] episodic_references (tbl=episodic_references)
CREATE TABLE episodic_references (
    src_id TEXT NOT NULL REFERENCES episodic(id) ON DELETE CASCADE,
    dst_id TEXT NOT NULL REFERENCES episodic(id) ON DELETE CASCADE,
    PRIMARY KEY (src_id, dst_id),
    CHECK (src_id != dst_id)
);

-- [table] episodic_topics (tbl=episodic_topics)
CREATE TABLE episodic_topics (
    episodic_id TEXT NOT NULL REFERENCES episodic(id) ON DELETE CASCADE,
    topic       TEXT NOT NULL,
    PRIMARY KEY (episodic_id, topic)
);

-- [table] episodic_vec (tbl=episodic_vec)
CREATE VIRTUAL TABLE episodic_vec USING vec0(
    episodic_id TEXT PRIMARY KEY,
    embedding   FLOAT[1536]
);

-- [table] episodic_vec_chunks (tbl=episodic_vec_chunks)
CREATE TABLE "episodic_vec_chunks"(chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,size INTEGER NOT NULL,validity BLOB NOT NULL,rowids BLOB NOT NULL);

-- [table] episodic_vec_info (tbl=episodic_vec_info)
CREATE TABLE "episodic_vec_info" (key text primary key, value any);

-- [table] episodic_vec_rowids (tbl=episodic_vec_rowids)
CREATE TABLE "episodic_vec_rowids"(rowid INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,chunk_id INTEGER,chunk_offset INTEGER);

-- [table] episodic_vec_vector_chunks00 (tbl=episodic_vec_vector_chunks00)
CREATE TABLE "episodic_vec_vector_chunks00"(rowid PRIMARY KEY,vectors BLOB NOT NULL);

-- [table] formed_opinions (tbl=formed_opinions)
CREATE TABLE formed_opinions (
    id                TEXT PRIMARY KEY,
    claim             TEXT NOT NULL,
    formed_at         TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL
);

-- [table] quirks (tbl=quirks)
CREATE TABLE quirks (
    id             TEXT PRIMARY KEY,
    pattern        TEXT NOT NULL UNIQUE,
    observed_count INTEGER NOT NULL DEFAULT 1,
    first_seen     TEXT NOT NULL,
    last_seen      TEXT NOT NULL
);

-- [table] schema_version (tbl=schema_version)
CREATE TABLE schema_version (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- [table] self_state (tbl=self_state)
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

-- [table] semantic (tbl=semantic)
CREATE TABLE semantic (
    id           TEXT PRIMARY KEY,
    claim        TEXT NOT NULL,
    confidence   REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    last_updated TEXT NOT NULL
);

-- [table] semantic_contradictions (tbl=semantic_contradictions)
CREATE TABLE semantic_contradictions (
    semantic_id       TEXT NOT NULL REFERENCES semantic(id) ON DELETE CASCADE,
    other_semantic_id TEXT NOT NULL REFERENCES semantic(id) ON DELETE CASCADE,
    PRIMARY KEY (semantic_id, other_semantic_id),
    CHECK (semantic_id != other_semantic_id)
);

-- [table] semantic_evidence (tbl=semantic_evidence)
CREATE TABLE semantic_evidence (
    semantic_id TEXT NOT NULL REFERENCES semantic(id) ON DELETE CASCADE,
    episodic_id TEXT NOT NULL REFERENCES episodic(id) ON DELETE CASCADE,
    PRIMARY KEY (semantic_id, episodic_id)
);

-- [table] semantic_fts (tbl=semantic_fts)
CREATE VIRTUAL TABLE semantic_fts USING fts5(
    claim,
    content='semantic',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- [table] semantic_fts_config (tbl=semantic_fts_config)
CREATE TABLE 'semantic_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

-- [table] semantic_fts_data (tbl=semantic_fts_data)
CREATE TABLE 'semantic_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

-- [table] semantic_fts_docsize (tbl=semantic_fts_docsize)
CREATE TABLE 'semantic_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

-- [table] semantic_fts_idx (tbl=semantic_fts_idx)
CREATE TABLE 'semantic_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

-- [table] semantic_vec (tbl=semantic_vec)
CREATE VIRTUAL TABLE semantic_vec USING vec0(
    semantic_id TEXT PRIMARY KEY,
    embedding   FLOAT[1536]
);

-- [table] semantic_vec_chunks (tbl=semantic_vec_chunks)
CREATE TABLE "semantic_vec_chunks"(chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,size INTEGER NOT NULL,validity BLOB NOT NULL,rowids BLOB NOT NULL);

-- [table] semantic_vec_info (tbl=semantic_vec_info)
CREATE TABLE "semantic_vec_info" (key text primary key, value any);

-- [table] semantic_vec_rowids (tbl=semantic_vec_rowids)
CREATE TABLE "semantic_vec_rowids"(rowid INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,chunk_id INTEGER,chunk_offset INTEGER);

-- [table] semantic_vec_vector_chunks00 (tbl=semantic_vec_vector_chunks00)
CREATE TABLE "semantic_vec_vector_chunks00"(rowid PRIMARY KEY,vectors BLOB NOT NULL);

-- [trigger] episodic_fts_delete (tbl=episodic)
CREATE TRIGGER episodic_fts_delete AFTER DELETE ON episodic BEGIN
    INSERT INTO episodic_fts(episodic_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

-- [trigger] episodic_fts_insert (tbl=episodic)
CREATE TRIGGER episodic_fts_insert AFTER INSERT ON episodic BEGIN
    INSERT INTO episodic_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- [trigger] episodic_fts_update (tbl=episodic)
CREATE TRIGGER episodic_fts_update AFTER UPDATE ON episodic BEGIN
    INSERT INTO episodic_fts(episodic_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO episodic_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- [trigger] semantic_fts_delete (tbl=semantic)
CREATE TRIGGER semantic_fts_delete AFTER DELETE ON semantic BEGIN
    INSERT INTO semantic_fts(semantic_fts, rowid, claim) VALUES('delete', old.rowid, old.claim);
END;

-- [trigger] semantic_fts_insert (tbl=semantic)
CREATE TRIGGER semantic_fts_insert AFTER INSERT ON semantic BEGIN
    INSERT INTO semantic_fts(rowid, claim) VALUES (new.rowid, new.claim);
END;

-- [trigger] semantic_fts_update (tbl=semantic)
CREATE TRIGGER semantic_fts_update AFTER UPDATE ON semantic BEGIN
    INSERT INTO semantic_fts(semantic_fts, rowid, claim) VALUES('delete', old.rowid, old.claim);
    INSERT INTO semantic_fts(rowid, claim) VALUES (new.rowid, new.claim);
END;
