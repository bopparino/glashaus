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
