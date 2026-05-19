-- ============================================================================
-- 002_self_state_events.sql — append-only log of numeric self-state changes.
--
-- Why this exists, even though `self_state` already stores the current values:
--
-- Plan §14.1 calls out "identity stability metric" and "self-consistency
-- over time" as quantitative evaluation tasks. Both need *trajectory*
-- data — "warmth shifted from 0.4 to 0.7 over six weeks" — that the
-- singleton self_state row, by construction, cannot tell you about.
-- The only way to reconstruct trajectories later is to log them at write
-- time. We can't backfill once the values have moved.
--
-- Scope choices made on purpose:
--
-- - **Numeric fields only.** Old/new are REAL. Text fields (mood, voice,
--   name) and list fields (base_values, preoccupations, history_markers)
--   do not log here. Mixing typed and stringly-typed events under one
--   table forces the analysis pipeline to branch on field name. If
--   identity-anchor-class changes (name, voice, base_values) ever need
--   their own audit trail, that's a separate table later.
--
-- - **ON DELETE SET NULL for trigger_episodic_id.** Trajectories must
--   outlive their source episodes. Decay/consolidation will prune
--   episodic records eventually; the disposition shifts those records
--   caused must survive that pruning.
--
-- - **field_path is a string like "disposition.curiosity"**, not a
--   foreign key to some enum table. That keeps the schema flexible for
--   future numeric fields (Phase 4+ may add disposition dimensions).
-- ============================================================================

CREATE TABLE self_state_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                  TEXT NOT NULL,
    field_path          TEXT NOT NULL,
    old_value           REAL NOT NULL,
    new_value           REAL NOT NULL,
    trigger_episodic_id TEXT REFERENCES episodic(id) ON DELETE SET NULL
);

CREATE INDEX idx_self_state_events_ts         ON self_state_events(ts);
CREATE INDEX idx_self_state_events_field_path ON self_state_events(field_path);

INSERT INTO schema_version (version, name) VALUES (2, '002_self_state_events');
