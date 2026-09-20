// The thesis export — the longitudinal record, bundled. The question grow
// mode exists to make measurable: does an AI companion form stable,
// path-dependent dispositions from lived interaction — and how do they
// change over time? This file is the dataset: full drift trajectories,
// opinion/quirk accretion with timestamps, every soul revision with its
// cited evidence (plus the full text history), dream affect over time,
// wander receipts, intention outcomes, and the provenance audit that makes
// the clean-room claim checkable in one look: in a grow-mode instance, no
// memory has a source that isn't lived.
//
//   glashaus export thesis [out.json]
import fs from 'node:fs';
import { getDb } from './db.js';
import { config } from './config.js';

export function exportThesis(out) {
  const db = getDb();
  const bundle = {
    format: 'glashaus-thesis-export',
    version: 1,
    exported_at: new Date().toISOString(),
    companion: config.companionName,
    grow_mode: config.growMode,
    born: config.bornDate || null,

    // The clean-room claim, auditable in one query: every source is lived.
    // voice_seeded is the one named asterisk: true means the user stated a
    // requested register at setup and voice.md was seeded from their words.
    provenance: {
      voice_seeded: config.voiceSeeded === true,
      facts: db.prepare('SELECT source, COUNT(*) n FROM facts GROUP BY source ORDER BY n DESC').all(),
      episodes_total: db.prepare('SELECT COUNT(*) n FROM episodes').get().n,
      episodes_from_wander: db.prepare('SELECT COUNT(DISTINCT episode_id) n FROM wander_log WHERE episode_id IS NOT NULL').get().n,
    },

    // Dispositions over time — the trajectory IS the finding.
    self_state: db.prepare('SELECT * FROM self_state ORDER BY layer, dimension').all(),
    self_state_events: db.prepare('SELECT dimension, old_value, new_value, signal, trigger, created_at FROM self_state_events ORDER BY id').all(),

    // What she came to believe and notice, with when.
    // held_count / tested_count are what separate a view from a conviction:
    // one is how often she came back to it, the other how often she kept it
    // while being argued with.
    opinions: db.prepare('SELECT claim, context, formed_at, held_count, tested_count, last_held FROM opinions ORDER BY id').all(),
    quirks: db.prepare('SELECT pattern, observed_count, first_seen, last_seen FROM quirks ORDER BY id').all(),

    // Identity accretion: every self-authored revision (the WHY) plus the
    // full text history of the soul (the WHAT), diffable end to end.
    soul_revisions: db.prepare('SELECT * FROM soul_revisions ORDER BY id').all()
      .map(r => ({ ...r, changelog: JSON.parse(r.changelog), rejected: r.rejected ? JSON.parse(r.rejected) : null })),
    soul_history: [
      ...db.prepare("SELECT content, replaced_at AS at FROM document_history WHERE name = 'SOUL' ORDER BY id").all(),
      { content: db.prepare("SELECT content FROM documents WHERE name = 'SOUL'").get()?.content ?? '', at: 'current' },
    ],

    // The inner life over time — dream affect is the closest thing to a
    // longitudinal "how does she feel" signal.
    dreams: db.prepare('SELECT date, epigraph, valence, arousal, emotion, length(content) chars FROM dreams ORDER BY id').all(),

    // Wanting things across time, and what became of the wants.
    intentions: db.prepare('SELECT text, source, thread_id, created_at, expires_at, fulfilled_at, released_at FROM intentions ORDER BY id').all(),

    // Threads: the shape of what stayed unfinished between them, and for how
    // long. A relational record the fact store can't produce — how often she
    // raised something, whether it ever got answered, what quietly lapsed.
    threads: db.prepare(`
      SELECT id, topic, summary, status, opened_by, salience, raised_count,
             created_at, updated_at, answered_at, last_raised_at
      FROM threads ORDER BY id
    `).all(),
    thread_events: db.prepare('SELECT thread_id, kind, actor, created_at FROM thread_events ORDER BY id').all(),

    // Every automatic repair: identity breaks, authorship dissociation,
    // register drift. The engine's own failure rate over time, which the
    // thesis needs as a confound — a companion the guards had to catch daily
    // is not the same instrument as one they never fired on.
    guards: db.prepare('SELECT kind, COUNT(*) n, MIN(created_at) first, MAX(created_at) last FROM guard_log GROUP BY kind').all(),

    // A life with continuity. Sessions are the receipts: a pursuit's progress
    // must trace to afternoons that really happened, and the gap between
    // `sessions` and elapsed days is the honest measure of whether she has
    // interests or just claims them.
    pursuits: db.prepare(`
      SELECT id, topic, why, status, progress, sessions, source,
             started_at, last_session_at, shared_at, closed_at
      FROM pursuits ORDER BY id
    `).all(),
    pursuit_sessions: db.prepare('SELECT pursuit_id, note, episode_id, created_at FROM pursuit_sessions ORDER BY id').all(),

    // The life she had on her own, with receipts.
    wanders: db.prepare('SELECT topic, queries, urls, episode_id, created_at FROM wander_log ORDER BY id').all()
      .map(w => ({ ...w, queries: JSON.parse(w.queries), urls: JSON.parse(w.urls) })),

    // Scale of the shared life (counts only — messages themselves stay home).
    life: {
      messages: db.prepare('SELECT COUNT(*) n FROM messages WHERE redacted = 0').get().n,
      first_message: db.prepare('SELECT MIN(created_at) t FROM messages').get().t,
      episodes: db.prepare('SELECT COUNT(*) n FROM episodes').get().n,
      facts_active: db.prepare('SELECT COUNT(*) n FROM facts WHERE active = 1').get().n,
      outreaches: db.prepare("SELECT COUNT(*) n FROM messages WHERE source = 'outreach'").get().n,
      heartbeat_declines: db.prepare("SELECT COUNT(*) n FROM heartbeat_log WHERE decision = 'declined'").get().n,
      threads_open: db.prepare("SELECT COUNT(*) n FROM threads WHERE status = 'open'").get().n,
      threads_answered: db.prepare("SELECT COUNT(*) n FROM threads WHERE status = 'answered'").get().n,
      threads_dormant: db.prepare("SELECT COUNT(*) n FROM threads WHERE status = 'dormant'").get().n,
      facts_superseded: db.prepare('SELECT COUNT(*) n FROM facts WHERE active = 1 AND superseded_by IS NOT NULL').get().n,
      pursuits_active: db.prepare("SELECT COUNT(*) n FROM pursuits WHERE status = 'active'").get().n,
      pursuits_finished: db.prepare("SELECT COUNT(*) n FROM pursuits WHERE status = 'done'").get().n,
      pursuits_abandoned: db.prepare("SELECT COUNT(*) n FROM pursuits WHERE status = 'abandoned'").get().n,
      convictions: db.prepare('SELECT COUNT(*) n FROM opinions WHERE tested_count >= 2 OR held_count >= 3').get().n,
    },
  };

  fs.writeFileSync(out, JSON.stringify(bundle, null, 1));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`[thesis] ${out} (${kb} KB — ${bundle.self_state_events.length} drift events, ${bundle.soul_revisions.length} soul revisions, ${bundle.dreams.length} dreams, ${bundle.wanders.length} wanders)`);
  return out;
}

if (process.argv.includes('--now')) {
  const custom = process.argv[process.argv.indexOf('--now') + 1];
  exportThesis(custom && !custom.startsWith('--') ? custom : `${config.home}/thesis-${new Date().toISOString().slice(0, 10)}.json`);
}
