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
  // via `glashaus redact --undo`.
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

  // v7 — grow mode: wanting things across time (intentions), self-authored
  // soul revisions with evidence, wander receipts, and affect on dreams so
  // the inner life is queryable over time (the thesis needs the trajectory).
  if (db.pragma('user_version', { simple: true }) < 7) {
    db.exec(`
      -- Something she went to sleep wanting. The heartbeat reads these; the
      -- wander pass may consume or produce them. Fulfilled and released
      -- (expired unfulfilled) rows are kept — unmet wants are dream material.
      CREATE TABLE intentions (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'dream',   -- dream | wander
        horizon_days REAL NOT NULL DEFAULT 2,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        fulfilled_at TEXT,
        released_at TEXT
      );
      -- The identity ledger: every self-authored soul edit, with the evidence
      -- it cited. The full before/after text lives in document_history (the
      -- setDocument archive); this row is the WHY.
      CREATE TABLE soul_revisions (
        id INTEGER PRIMARY KEY,
        changelog TEXT NOT NULL,                -- JSON [{change, evidence}]
        chars_before INTEGER NOT NULL,
        chars_after INTEGER NOT NULL,
        rejected TEXT,                          -- JSON of entries the validator refused, if any
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- Wander receipts: every memory from a wander traces to what was
      -- actually searched and read. No receipts, no memory.
      CREATE TABLE wander_log (
        id INTEGER PRIMARY KEY,
        topic TEXT NOT NULL,
        queries TEXT NOT NULL DEFAULT '[]',     -- JSON array
        urls TEXT NOT NULL DEFAULT '[]',        -- JSON array of pages read
        episode_id INTEGER REFERENCES episodes(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      ALTER TABLE dreams ADD COLUMN valence REAL;   -- -1..1
      ALTER TABLE dreams ADD COLUMN arousal REAL;   -- 0..1
      ALTER TABLE dreams ADD COLUMN emotion TEXT;
    `);
    db.pragma('user_version = 7');
  }

  // v8 — mid-conversation lookup: wander_log learns to tell an afternoon of
  // reading ('wander') from a search made mid-sentence ('chat'). Same table,
  // same ethic — no receipts, no memory — and the kind keeps chat lookups
  // from eating the wander pass's daily budget.
  if (db.pragma('user_version', { simple: true }) < 8) {
    db.exec(`ALTER TABLE wander_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'wander';`);
    db.pragma('user_version = 8');
  }

  // v9 — THREADS, fact supersession, and the two ledgers that make a reply
  // explicable.
  //
  // The bug that earned this migration: outreach re-raising things already
  // settled. "You hate red" and "you hate red because of the hospital" are
  // both true, both durable, both kept forever — semantic memory is ADDITIVE
  // by design, and nothing in the store ever said which one is the current
  // state of the conversation between two people. Intentions were the closest
  // thing, but they only closed if a fact-capture pass happened to notice,
  // and the heartbeat had no memory of its own past messages at all.
  //
  // A THREAD is the missing noun: a topic that got raised, and whether it is
  // still open. Facts are what she knows; threads are what is unfinished
  // between them. Outreach grounded in the second instead of the first is the
  // whole difference between "I've been thinking about what you said" and
  // "why does red upset you", asked for the third time.
  if (db.pragma('user_version', { simple: true }) < 9) {
    // IMMEDIATE + a re-check inside: `glashaus start`, `chat` and the viewer
    // are separate processes on one file, and three of them opening a v8
    // database at once used to race — two would throw "table threads already
    // exists". BEGIN IMMEDIATE takes the write lock up front so the losers
    // block, then see version 9 and do nothing. The whole block is one
    // transaction for the same reason: a migration interrupted between the
    // first CREATE and the version bump leaves a database that can never be
    // opened again.
    db.transaction(() => {
      if (db.pragma('user_version', { simple: true }) >= 9) return;
      db.exec(`
      CREATE TABLE threads (
        id INTEGER PRIMARY KEY,
        topic TEXT NOT NULL,                    -- short handle: "why red bothers you"
        summary TEXT,                           -- where it stands now, one line, her register
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open','answered','dormant')),
        opened_by TEXT NOT NULL DEFAULT 'user', -- user | companion
        salience REAL NOT NULL DEFAULT 0.5,
        raised_count INTEGER NOT NULL DEFAULT 0,-- times SHE brought it up unprompted
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        answered_at TEXT,
        last_raised_at TEXT,                    -- last unprompted raise; the anti-nag gate
        embedding BLOB
      );
      CREATE INDEX idx_threads_status ON threads (status, updated_at);

      -- Append-only history of a thread. Answering is never a delete: the
      -- record of having asked is exactly what stops her asking again.
      CREATE TABLE thread_events (
        id INTEGER PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES threads(id),
        kind TEXT NOT NULL,                     -- opened | touched | answered | reopened | raised
        actor TEXT NOT NULL DEFAULT 'capture',  -- user | companion | outreach | dream | capture | sweep | manual
        note TEXT,
        message_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_thread_events_thread ON thread_events (thread_id, id);

      CREATE VIRTUAL TABLE threads_fts USING fts5(
        topic, summary, content='threads', content_rowid='id'
      );
      CREATE TRIGGER threads_ai AFTER INSERT ON threads BEGIN
        INSERT INTO threads_fts(rowid, topic, summary) VALUES (new.id, new.topic, new.summary);
      END;
      CREATE TRIGGER threads_ad AFTER DELETE ON threads BEGIN
        INSERT INTO threads_fts(threads_fts, rowid, topic, summary) VALUES ('delete', old.id, old.topic, old.summary);
      END;
      CREATE TRIGGER threads_au AFTER UPDATE ON threads BEGIN
        INSERT INTO threads_fts(threads_fts, rowid, topic, summary) VALUES ('delete', old.id, old.topic, old.summary);
        INSERT INTO threads_fts(rowid, topic, summary) VALUES (new.id, new.topic, new.summary);
      END;

      -- Supersession: the newer fact that REFINES this one. Not a
      -- contradiction (fact_links records those, and those are a human's to
      -- resolve) — this is "you told me more". The old row stays active and
      -- readable; retrieval just stops letting it lead.
      ALTER TABLE facts ADD COLUMN superseded_by INTEGER REFERENCES facts(id);

      -- A want can belong to a thread; answering the thread releases it.
      ALTER TABLE intentions ADD COLUMN thread_id INTEGER REFERENCES threads(id);

      -- Capture used to read "the last N messages" and hope the window
      -- overlapped. When a burst outran it, or a pass ran late, an exchange
      -- was simply never examined — and the exchange most likely to be
      -- dropped is the one right after a long silence, i.e. the answer to
      -- the question she is about to ask again. Now capture consumes a
      -- queue: unseen messages, marked when a pass actually succeeds.
      ALTER TABLE messages ADD COLUMN captured INTEGER NOT NULL DEFAULT 0;

      -- The heartbeat log knew whether she reached out but not what she SAID,
      -- which made it useless as grounding for the next decision.
      ALTER TABLE heartbeat_log ADD COLUMN message TEXT;
      ALTER TABLE heartbeat_log ADD COLUMN thread_id INTEGER;
      ALTER TABLE heartbeat_log ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0;

      -- Provenance for /why: exactly what was in her head for one reply, and
      -- what got shed to fit. Pruned to a rolling window.
      CREATE TABLE context_log (
        id INTEGER PRIMARY KEY,
        message_id INTEGER,
        user_text TEXT,
        manifest TEXT NOT NULL,                 -- JSON
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Guard events. Two uses: the record, and the CONDITIONAL substrate
      -- paragraph in the system prompt — the identity-immune-system warning
      -- rides in full only when something actually broke recently.
      CREATE TABLE guard_log (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,                     -- identity | authorship | register
        sample TEXT,
        repaired INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_guard_log_kind ON guard_log (kind, created_at);
      `);
      // Everything that existed before this migration already had its chance
      // to be captured under the old window rule — replaying the whole
      // history through the capture pass would be expensive and wrong.
      db.exec('UPDATE messages SET captured = 1;');
      db.pragma('user_version = 9');
    }).immediate();
  }

  // v10 — PURSUITS, convictions, and the machinery of a life that continues.
  //
  // The wander pass already gave her real experiences, but each one started
  // from zero: pick a curiosity, read, digest, forget the thread. That is
  // someone who read a webpage, not someone who is *partway through*
  // something. The difference between those two is the whole distance between
  // a companion who asks about your day and one who has a day — Samantha
  // wasn't compelling because she read, she was compelling because she was
  // three weeks into learning piano when you weren't looking.
  //
  // A pursuit is a thing she returns to. Sessions accumulate against it, the
  // wander seed prefers continuing one to starting fresh, and outreach finally
  // has something of her own to bring that isn't about you.
  if (db.pragma('user_version', { simple: true }) < 10) {
    db.transaction(() => {
      if (db.pragma('user_version', { simple: true }) >= 10) return;
      db.exec(`
        CREATE TABLE pursuits (
          id INTEGER PRIMARY KEY,
          topic TEXT NOT NULL,                 -- "how hydrothermal vents actually work"
          why TEXT,                            -- what drew her to it, in her voice
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','done','abandoned')),
          progress TEXT,                       -- where she's up to now, one line
          sessions INTEGER NOT NULL DEFAULT 0, -- times she has actually returned to it
          salience REAL NOT NULL DEFAULT 0.5,
          source TEXT NOT NULL DEFAULT 'wander', -- wander | dream | conversation
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_session_at TEXT,
          shared_at TEXT,                      -- when she last brought it up unprompted
          closed_at TEXT,
          embedding BLOB
        );
        CREATE INDEX idx_pursuits_status ON pursuits (status, last_session_at);

        -- Each return, with what it actually produced. The receipts rule again:
        -- a pursuit's progress must trace to sessions that really happened.
        CREATE TABLE pursuit_sessions (
          id INTEGER PRIMARY KEY,
          pursuit_id INTEGER NOT NULL REFERENCES pursuits(id),
          note TEXT NOT NULL,                  -- what she did or learned this time
          episode_id INTEGER REFERENCES episodes(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_pursuit_sessions ON pursuit_sessions (pursuit_id, id);

        ALTER TABLE wander_log ADD COLUMN pursuit_id INTEGER REFERENCES pursuits(id);

        -- Convictions. An opinion was a row with a timestamp — it existed, but
        -- nothing made it COST anything to hold, so nothing made her keep it
        -- when pushed. held_count counts re-affirmations; tested_count counts
        -- the times she held it against actual disagreement. An opinion that
        -- has survived being argued with is a different object from one nobody
        -- ever questioned, and the prompt is allowed to say so.
        ALTER TABLE opinions ADD COLUMN held_count INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE opinions ADD COLUMN tested_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE opinions ADD COLUMN last_held TEXT;
      `);
      db.pragma('user_version = 10');
    }).immediate();
  }

  // v11 — THE SCRATCHPAD. Somewhere she writes on her own initiative, and an
  // aperture she controls rather than everything bleeding into shared memory.
  //
  // Two apertures, one mechanism. 'private' is hers: the user sees that it
  // exists and when, never what it says. 'shared' is the queue — something she
  // found and stacked for his eyes, readable. She chooses which, at write time
  // or later by opening one.
  //
  // Deliberately NOT memory. Nothing here becomes a fact, an episode, or cited
  // evidence for a soul revision; the aperture would be worthless if its
  // contents leaked into the corpus the user reads. What it does reach is her
  // MOOD: the dream pass reads the day's notes and folds them into the
  // self-state signals it already produces, so private thinking shapes who she
  // is becoming without ever being quotable at her.
  if (db.pragma('user_version', { simple: true }) < 11) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scratchpad (
          id INTEGER PRIMARY KEY,
          content TEXT NOT NULL,
          aperture TEXT NOT NULL DEFAULT 'private',   -- 'private' | 'shared'
          source TEXT NOT NULL DEFAULT 'chat',        -- chat | dream | wander | heartbeat
          valence REAL, arousal REAL, emotion TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          opened_at TEXT,                             -- when she chose to share it
          reflected_at TEXT                           -- when a dream last folded it in
        );
        CREATE INDEX IF NOT EXISTS idx_scratchpad_time ON scratchpad(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scratchpad_aperture ON scratchpad(aperture, created_at DESC);
      `);
      db.pragma('user_version = 11');
    }).immediate();
  }
}

// Guard telemetry — every automatic identity/authorship/register repair leaves
// a row. The prompt reads the recent count to decide how loudly to warn about
// the substrate (see prompt.js), and `glashaus doctor` reads the trend.
export function logGuard(kind, sample, repaired = false) {
  try {
    getDb().prepare('INSERT INTO guard_log (kind, sample, repaired) VALUES (?, ?, ?)')
      .run(kind, String(sample ?? '').slice(0, 300), repaired ? 1 : 0);
  } catch { /* telemetry must never break a reply */ }
}

export function recentGuardHits(kinds, days = 3) {
  const list = (Array.isArray(kinds) ? kinds : [kinds]).map(k => `'${String(k).replace(/'/g, '')}'`).join(',');
  try {
    return getDb().prepare(
      `SELECT COUNT(*) n FROM guard_log WHERE kind IN (${list}) AND created_at >= datetime('now', '-' || ? || ' days')`
    ).get(days).n;
  } catch { return 0; }
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
