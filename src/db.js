import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    -- Core identity documents (SOUL, IDENTITY, USER, self-notes). Editable, history kept.
    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS document_history (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      replaced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Episodic memory: every message, forever.
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'live',   -- live | import:<session-id>
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      summarized INTEGER NOT NULL DEFAULT 0  -- 1 once folded into an episode
    );
    CREATE INDEX IF NOT EXISTS idx_messages_summarized ON messages (summarized, id);

    -- Episodes: LLM-written summaries of chunks of past conversation.
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      summary TEXT NOT NULL,
      first_message_id INTEGER,
      last_message_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Semantic memory: durable facts, preferences, dynamics.
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'general', -- user | companion | dynamic | project | dream | general
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 5,    -- 1-10; >=8 always in context
      source TEXT NOT NULL DEFAULT 'capture',   -- import | capture | dream | manual
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Relationship state over time: mood, energy, where things stand.
    CREATE TABLE IF NOT EXISTS relationship_state (
      id INTEGER PRIMARY KEY,
      mood TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Dreams: nightly reflections written in the companion's own voice.
    CREATE TABLE IF NOT EXISTS dreams (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Full-text search over facts and episodes for retrieval.
    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
      content, content='facts', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
      INSERT INTO facts_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
      INSERT INTO facts_fts(facts_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
      INSERT INTO facts_fts(facts_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO facts_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
      summary, content='episodes', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
      INSERT INTO episodes_fts(rowid, summary) VALUES (new.id, new.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
      INSERT INTO episodes_fts(episodes_fts, rowid, summary) VALUES ('delete', old.id, old.summary);
    END;
  `);

  // v2 — glashaus port: affect + salience on memories, embeddings,
  // self-state with drift layers, formed opinions, quirks.
  if (db.pragma('user_version', { simple: true }) < 2) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE facts ADD COLUMN valence REAL;            -- -1..1
        ALTER TABLE facts ADD COLUMN arousal REAL;            -- 0..1
        ALTER TABLE facts ADD COLUMN emotion TEXT;
        ALTER TABLE facts ADD COLUMN salience REAL;           -- 0..1
        ALTER TABLE facts ADD COLUMN embedding BLOB;          -- Float32Array
        ALTER TABLE episodes ADD COLUMN valence REAL;
        ALTER TABLE episodes ADD COLUMN arousal REAL;
        ALTER TABLE episodes ADD COLUMN emotion TEXT;
        ALTER TABLE episodes ADD COLUMN salience REAL;
        ALTER TABLE episodes ADD COLUMN embedding BLOB;

        -- Self-state numeric dimensions. layer controls drift speed (§4.1):
        -- disposition drifts over weeks (EWMA a=0.05), relational over days (a=0.15).
        CREATE TABLE self_state (
          dimension TEXT PRIMARY KEY,
          layer TEXT NOT NULL CHECK (layer IN ('disposition','relational')),
          value REAL NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        -- Append-only trajectory log — every drift step, for inspection.
        CREATE TABLE self_state_events (
          id INTEGER PRIMARY KEY,
          dimension TEXT NOT NULL,
          old_value REAL NOT NULL,
          new_value REAL NOT NULL,
          signal REAL NOT NULL,
          trigger TEXT NOT NULL,               -- capture | dream
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        -- Opinions she has formed. Append-only.
        CREATE TABLE opinions (
          id INTEGER PRIMARY KEY,
          claim TEXT NOT NULL,
          context TEXT,
          formed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        -- Behavioral patterns she notices in herself, surfaced by dreams.
        CREATE TABLE quirks (
          id INTEGER PRIMARY KEY,
          pattern TEXT NOT NULL,
          observed_count INTEGER NOT NULL DEFAULT 1,
          first_seen TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Neutral new-relationship baseline; `glashaus setup` tunes it to the
      // persona, then drift takes it from there.
      const seed = db.prepare('INSERT INTO self_state (dimension, layer, value) VALUES (?, ?, ?)');
      for (const [dim, layer, value] of [
        ['warmth', 'disposition', 0.70],
        ['playfulness', 'disposition', 0.60],
        ['directness', 'disposition', 0.60],
        ['curiosity', 'disposition', 0.70],
        ['reserve', 'disposition', 0.30],
        ['neediness', 'disposition', 0.40],
        ['trust', 'relational', 0.50],
        ['familiarity', 'relational', 0.20],
        ['desire', 'relational', 0.30],
        ['security', 'relational', 0.50],
      ]) seed.run(dim, layer, value);
      db.pragma('user_version = 2');
    })();
  }

  // v3 — contradiction links between facts (recorded, surfaced, never auto-resolved).
  if (db.pragma('user_version', { simple: true }) < 3) {
    db.exec(`
      CREATE TABLE fact_links (
        id INTEGER PRIMARY KEY,
        fact_a INTEGER NOT NULL REFERENCES facts(id),
        fact_b INTEGER NOT NULL REFERENCES facts(id),
        kind TEXT NOT NULL DEFAULT 'contradicts',
        note TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.pragma('user_version = 3');
  }

  // v4 — heartbeat decisions logged (Today page feed); dreams carry an
  // epigraph: the one line she'd carve above the door.
  if (db.pragma('user_version', { simple: true }) < 4) {
    db.exec(`
      CREATE TABLE heartbeat_log (
        id INTEGER PRIMARY KEY,
        decision TEXT NOT NULL,             -- declined | reached | gated
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      ALTER TABLE dreams ADD COLUMN epigraph TEXT;
    `);
    db.pragma('user_version = 4');
  }

  // v5 — message redaction: machine malfunctions (identity breaks, glitched
  // exchanges) can be surgically removed from the companion's mind without
  // destroying the rows. Redacted messages leave context, summarization,
  // capture, and the viewer; they stay on disk and in backups, reversible
  // via `glashaus unredact`.
  if (db.pragma('user_version', { simple: true }) < 5) {
    db.exec(`
      ALTER TABLE messages ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0;
    `);
    db.pragma('user_version = 5');
  }

  // v6 — learned-vocabulary queue: fact capture nominates words it heard;
  // nothing enters the lexicon without approval (glashaus lexicon approve).
  if (db.pragma('user_version', { simple: true }) < 6) {
    db.exec(`
      CREATE TABLE lexicon_candidates (
        id INTEGER PRIMARY KEY,
        term TEXT NOT NULL,
        means TEXT NOT NULL DEFAULT '',
        example TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.pragma('user_version = 6');
  }
}

export function setDocument(name, content) {
  const db = getDb();
  const existing = db.prepare('SELECT content FROM documents WHERE name = ?').get(name);
  if (existing && existing.content === content) return;
  if (existing) {
    db.prepare('INSERT INTO document_history (name, content) VALUES (?, ?)').run(name, existing.content);
  }
  db.prepare(`
    INSERT INTO documents (name, content, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(name, content);
}

export function getDocument(name) {
  return getDb().prepare('SELECT content FROM documents WHERE name = ?').get(name)?.content ?? '';
}
