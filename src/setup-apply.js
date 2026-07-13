// Second half of setup, run as a child process AFTER config.json exists so
// every module sees the finished config. Creates the database (idempotent
// migrations), syncs persona files into the documents table, and applies the
// personality baseline if the wizard produced one.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db.js';
import { syncPersonaFromDisk } from './persona.js';

const db = getDb(); // creates + migrates on first touch
syncPersonaFromDisk();

const baselinePath = path.join(config.home, 'baseline.json');
if (fs.existsSync(baselinePath)) {
  try {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const update = db.prepare("UPDATE self_state SET value = ?, updated_at = datetime('now') WHERE dimension = ?");
    let applied = 0;
    for (const [dim, v] of Object.entries(baseline)) {
      if (typeof v !== 'number' || v < 0 || v > 1) continue;
      // A seed, not drift: clamp inside the drift rails so day one isn't pinned.
      applied += update.run(Math.max(0.05, Math.min(0.95, v)), dim).changes;
    }
    console.log(`[setup] personality baseline applied (${applied} dimensions)`);
  } catch (err) {
    console.error(`[setup] baseline skipped: ${err.message}`);
  }
  fs.rmSync(baselinePath, { force: true });
}

const docs = db.prepare('SELECT COUNT(*) n FROM documents').get().n;
console.log(`[setup] brain ready at ${config.dbPath} (${docs} persona document${docs === 1 ? '' : 's'})`);
