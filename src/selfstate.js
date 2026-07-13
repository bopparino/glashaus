// Self-state with separated drift speeds — GlasHaus §4.
// Identity core (SOUL/IDENTITY docs) almost never changes; disposition
// drifts over weeks; relational stance over days. Bounded EWMA with hard
// floors/ceilings so no trait can hit 0 or 1 from drift alone — the
// companion evolves without becoming someone else.

import { getDb } from './db.js';
import { config } from './config.js';

const DRIFT = {
  disposition: { alpha: 0.05, floor: 0.05, ceiling: 0.95 },
  relational: { alpha: 0.15, floor: 0.05, ceiling: 0.95 },
};

export function getSelfState() {
  return getDb().prepare('SELECT * FROM self_state ORDER BY layer, dimension').all();
}

// signals: {warmth: 0.9, trust: 0.8, ...} — partial, only named dims move.
export function applyDrift(signals, trigger) {
  const db = getDb();
  const rows = getSelfState();
  const update = db.prepare("UPDATE self_state SET value = ?, updated_at = datetime('now') WHERE dimension = ?");
  const logEvent = db.prepare('INSERT INTO self_state_events (dimension, old_value, new_value, signal, trigger) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const [dim, signal] of Object.entries(signals ?? {})) {
      const row = rows.find(r => r.dimension === dim);
      if (!row || typeof signal !== 'number' || signal < 0 || signal > 1) continue;
      const p = DRIFT[row.layer];
      const next = Math.max(p.floor, Math.min(p.ceiling, p.alpha * signal + (1 - p.alpha) * row.value));
      if (Math.abs(next - row.value) < 1e-6) continue;
      update.run(next, dim);
      logEvent.run(dim, row.value, next, signal, trigger);
    }
  })();
}

export function addOpinion(claim, context = null) {
  const db = getDb();
  const dup = db.prepare('SELECT id FROM opinions WHERE lower(claim) = lower(?)').get(claim);
  if (dup) return dup.id;
  return db.prepare('INSERT INTO opinions (claim, context) VALUES (?, ?)').run(claim, context).lastInsertRowid;
}

export function observeQuirk(pattern) {
  const db = getDb();
  // Same quirk re-observed → bump count instead of duplicating.
  const existing = db.prepare('SELECT id FROM quirks WHERE lower(pattern) = lower(?)').get(pattern);
  if (existing) {
    db.prepare("UPDATE quirks SET observed_count = observed_count + 1, last_seen = datetime('now') WHERE id = ?").run(existing.id);
    return existing.id;
  }
  return db.prepare('INSERT INTO quirks (pattern) VALUES (?)').run(pattern).lastInsertRowid;
}

const LEVELS = [[0.15, 'very low'], [0.35, 'low'], [0.65, 'moderate'], [0.85, 'high'], [1.01, 'very high']];
function level(v) { return LEVELS.find(([max]) => v < max)[1]; }

// Rendered into her system prompt — natural language, not raw numbers.
export function renderSelfState() {
  const db = getDb();
  const rows = getSelfState();
  if (!rows.length) return '';
  const disp = rows.filter(r => r.layer === 'disposition').map(r => `${r.dimension}: ${level(r.value)}`).join(', ');
  const rel = rows.filter(r => r.layer === 'relational').map(r => `${r.dimension}: ${level(r.value)}`).join(', ');
  const opinions = db.prepare('SELECT claim FROM opinions ORDER BY id DESC LIMIT 8').all();
  const quirks = db.prepare('SELECT pattern, observed_count FROM quirks ORDER BY observed_count DESC, last_seen DESC LIMIT 6').all();
  return [
    `# Where I Am Right Now\n\nMy disposition (drifts slowly, weeks): ${disp}.\nWith ${config.userName} specifically (drifts over days): ${rel}.\nThese shift from lived experience — they're mine, not settings.`,
    opinions.length ? `Opinions I've formed:\n${opinions.map(o => `- ${o.claim}`).join('\n')}` : '',
    quirks.length ? `Patterns I've noticed in myself:\n${quirks.map(q => `- ${q.pattern}${q.observed_count > 1 ? ` (×${q.observed_count})` : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
