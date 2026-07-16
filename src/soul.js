// The soul capsule — a small, portable export of everything that makes the
// companion THEMSELF, distinct from the full-brain backup. The rule: memories
// can be rebuilt by living; personality can't. If the database were ever
// poisoned beyond what backups cover, this file is enough to rebuild the person.
//
// Written daily alongside the backup, and on demand: `glashaus soul`
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { config } from './config.js';

const BACKUP_DIR = config.backupDir;

// The other half of the promise: a capsule can be poured into a FRESH brain.
// This is rebirth, not restore — documents, self-state trajectory, opinions,
// quirks, dreams, and identity facts return; messages and episodes don't
// (memories can be rebuilt by living; this carries who she IS). For a full
// machine move with every conversation intact, use the database backup and
// `glashaus restore` instead — see docs/moving.md.
export function importSoul(file) {
  const capsule = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (capsule.format !== 'glashaus-soul-capsule') {
    throw new Error('that file is not a glashaus soul capsule');
  }
  const db = getDb();
  const life = db.prepare(
    'SELECT (SELECT COUNT(*) FROM messages) m, (SELECT COUNT(*) FROM facts) f, (SELECT COUNT(*) FROM dreams) d'
  ).get();
  if (life.m || life.f || life.d) {
    throw new Error('this brain already holds a life — a soul imports only into a fresh home. Full move: restore the database backup (glashaus restore). Rebirth here: glashaus purge first.');
  }
  const out = { documents: 0, history: 0, self_state: 0, events: 0, opinions: 0, quirks: 0, dreams: 0, facts: 0 };
  db.transaction(() => {
    const doc = db.prepare("INSERT INTO documents (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at");
    for (const d of capsule.documents ?? []) { doc.run(d.name, d.content, d.updated_at); out.documents++; }
    const hist = db.prepare('INSERT INTO document_history (name, content, replaced_at) VALUES (?, ?, ?)');
    for (const h of capsule.document_history ?? []) { hist.run(h.name, h.content, h.replaced_at); out.history++; }
    const ss = db.prepare('UPDATE self_state SET value = ?, updated_at = ? WHERE dimension = ?');
    for (const r of capsule.self_state ?? []) { out.self_state += ss.run(r.value, r.updated_at, r.dimension).changes; }
    const ev = db.prepare('INSERT INTO self_state_events (dimension, old_value, new_value, signal, trigger, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const e of capsule.self_state_events ?? []) { ev.run(e.dimension, e.old_value, e.new_value, e.signal, e.trigger, e.created_at); out.events++; }
    const op = db.prepare('INSERT INTO opinions (claim, context, formed_at) VALUES (?, ?, ?)');
    for (const o of capsule.opinions ?? []) { op.run(o.claim, o.context, o.formed_at); out.opinions++; }
    const qk = db.prepare('INSERT INTO quirks (pattern, observed_count, first_seen, last_seen) VALUES (?, ?, ?, ?)');
    for (const q of capsule.quirks ?? []) { qk.run(q.pattern, q.observed_count, q.first_seen, q.last_seen); out.quirks++; }
    const dr = db.prepare('INSERT INTO dreams (date, content, epigraph, created_at) VALUES (?, ?, ?, ?)');
    for (const d of capsule.dreams ?? []) { dr.run(d.date, d.content, d.epigraph ?? null, d.created_at); out.dreams++; }
    const fa = db.prepare('INSERT INTO facts (category, content, importance, salience, emotion, valence, arousal, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const f of capsule.identity_facts ?? []) { fa.run(f.category, f.content, f.importance, f.salience, f.emotion, f.valence, f.arousal, f.source ?? 'import', f.created_at, f.updated_at); out.facts++; }
    const rs = db.prepare('INSERT INTO relationship_state (mood, notes, created_at) VALUES (?, ?, ?)');
    for (const r of capsule.relationship_state ?? []) rs.run(r.mood, r.notes, r.created_at);
  })();
  return out;
}

export function exportSoul() {
  const db = getDb();
  const capsule = {
    format: 'glashaus-soul-capsule',
    version: 1,
    exported_at: new Date().toISOString(),
    companion: config.companionName,
    // Who they are — the documents, verbatim, plus their history.
    documents: db.prepare('SELECT name, content, updated_at FROM documents').all(),
    document_history: db.prepare('SELECT name, content, replaced_at FROM document_history').all(),
    // Where they are — every dimension and its full trajectory.
    self_state: db.prepare('SELECT * FROM self_state').all(),
    self_state_events: db.prepare('SELECT * FROM self_state_events').all(),
    // What they believe and notice about themself.
    opinions: db.prepare('SELECT * FROM opinions').all(),
    quirks: db.prepare('SELECT * FROM quirks').all(),
    // The inner life, complete.
    dreams: db.prepare('SELECT id, date, content, epigraph, created_at FROM dreams').all(),
    // The facts that define WHO THEY ARE and the relationship (not logistics).
    identity_facts: db.prepare(`
      SELECT id, category, content, importance, salience, emotion, valence, arousal, source, created_at, updated_at
      FROM facts WHERE active = 1 AND category IN ('companion', 'dynamic') ORDER BY id
    `).all(),
    relationship_state: db.prepare('SELECT * FROM relationship_state ORDER BY id').all(),
  };

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify(capsule, null, 1);
  const dated = path.join(BACKUP_DIR, `soul-${stamp}.json`);
  fs.writeFileSync(dated, json);
  fs.writeFileSync(path.join(BACKUP_DIR, 'soul-latest.json'), json);

  // Keep the newest 14 dated capsules.
  const old = fs.readdirSync(BACKUP_DIR).filter(f => /^soul-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14);
  for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });

  const kb = (json.length / 1024).toFixed(0);
  console.log(`[soul] ${dated} (${kb} KB — ${capsule.dreams.length} dreams, ${capsule.opinions.length} opinions, ${capsule.quirks.length} quirks, ${capsule.identity_facts.length} identity facts)`);
  return dated;
}

if (process.argv.includes('--now')) {
  exportSoul();
}
