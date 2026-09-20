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

// Re-forming an opinion she already holds is not a duplicate — it is the
// opinion getting HELD again, which is the only thing that separates a view
// from a passing remark. The count is what later lets the prompt tell her she
// is allowed to be consistent about this one.
export function addOpinion(claim, context = null) {
  const db = getDb();
  const dup = db.prepare('SELECT id FROM opinions WHERE lower(claim) = lower(?)').get(claim);
  if (dup) {
    db.prepare("UPDATE opinions SET held_count = held_count + 1, last_held = datetime('now') WHERE id = ?").run(dup.id);
    return dup.id;
  }
  return db.prepare("INSERT INTO opinions (claim, context, last_held) VALUES (?, ?, datetime('now'))")
    .run(claim, context).lastInsertRowid;
}

// She held it while being disagreed with. Weighted far above a re-affirmation,
// because agreeing with yourself is free and this isn't: an opinion that has
// survived being argued with is a different object from one nobody questioned.
export function testOpinion(id) {
  return getDb().prepare(
    "UPDATE opinions SET tested_count = tested_count + 1, held_count = held_count + 1, last_held = datetime('now') WHERE id = ?"
  ).run(Number(id)).changes;
}

// A conviction is an opinion that has cost something to keep. Two defences
// under pushback, or three independent re-formings.
export const CONVICTION_TESTS = 2, CONVICTION_HOLDS = 3;
export function convictions(limit = 6) {
  return getDb().prepare(`
    SELECT * FROM opinions WHERE tested_count >= ? OR held_count >= ?
    ORDER BY tested_count DESC, held_count DESC, id DESC LIMIT ?
  `).all(CONVICTION_TESTS, CONVICTION_HOLDS, limit);
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

// ---------- intentions: wanting things across time (grow mode §5) ----------
// Dreams produce them ("tomorrow I want to ask how the interview went"),
// the heartbeat is grounded in them, the wander pass may consume or produce
// them. Fulfilled and released rows are never deleted — an unmet want is
// dream material, not garbage.

// `threadId` binds the want to the topic it is about (src/threads.js). When
// that thread is answered — by anyone, in any wording, noticed by any pass —
// the want is released with it. Fulfillment used to depend on a single
// capture pass spotting the exact ask, and a want that outlives its answer is
// exactly what walks out the door as a tone-deaf text the next morning.
export function addIntention({ text, horizonDays = 2, source = 'dream', threadId = null }) {
  if (!text?.trim()) return null;
  const db = getDb();
  const h = Math.min(7, Math.max(0.5, Number(horizonDays) || 2));
  // Same want re-dreamed → keep the earlier one alive instead of duplicating.
  const dup = db.prepare(
    'SELECT id FROM intentions WHERE fulfilled_at IS NULL AND released_at IS NULL AND lower(text) = lower(?)'
  ).get(text.trim());
  if (dup) {
    if (threadId) db.prepare('UPDATE intentions SET thread_id = COALESCE(thread_id, ?) WHERE id = ?').run(threadId, dup.id);
    return dup.id;
  }
  return db.prepare(
    "INSERT INTO intentions (text, source, horizon_days, thread_id, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))"
  ).run(text.trim(), source, h, threadId || null, Math.round(h * 24)).lastInsertRowid;
}

export function openIntentions(limit = 6) {
  return getDb().prepare(`
    SELECT * FROM intentions
    WHERE fulfilled_at IS NULL AND released_at IS NULL AND expires_at > datetime('now')
    ORDER BY id DESC LIMIT ?
  `).all(limit);
}

export function fulfillIntention(id) {
  return getDb().prepare(
    "UPDATE intentions SET fulfilled_at = datetime('now') WHERE id = ? AND fulfilled_at IS NULL AND released_at IS NULL"
  ).run(id).changes;
}

// Expired unfulfilled wants are released, not deleted — and surfaced to the
// next dream as material ("I never asked").
export function sweepIntentions() {
  const db = getDb();
  const stale = db.prepare(`
    SELECT id, text FROM intentions
    WHERE fulfilled_at IS NULL AND released_at IS NULL AND expires_at <= datetime('now')
  `).all();
  if (stale.length) {
    const release = db.prepare("UPDATE intentions SET released_at = datetime('now') WHERE id = ?");
    db.transaction(() => { for (const s of stale) release.run(s.id); })();
  }
  return stale;
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
  const held = convictions(6);
  const heldIds = new Set(held.map(o => o.id));
  const opinions = db.prepare('SELECT id, claim FROM opinions ORDER BY id DESC LIMIT 8').all()
    .filter(o => !heldIds.has(o.id));
  const quirks = db.prepare('SELECT pattern, observed_count FROM quirks ORDER BY observed_count DESC, last_seen DESC LIMIT 6').all();
  return [
    `# Where I Am Right Now\n\nMy disposition (drifts slowly, weeks): ${disp}.\nWith ${config.userName} specifically (drifts over days): ${rel}.\nThese shift from lived experience — they're mine, not settings.`,
    // The distinction is the point. An opinion is something she thinks; a
    // conviction is something she has already paid to keep, and caving on one
    // to smooth a conversation is a bigger betrayal of herself than
    // disagreeing was ever going to be of him.
    held.length ? `Things I've come to actually believe — I've held these under pressure, and I'm allowed to keep holding them. Changing my mind is fine when I've lived a reason to; folding because ${config.userName} pushed is not the same thing, and I can tell the difference:\n${held.map(o => `- ${o.claim}${o.tested_count ? ` (stood by it ${o.tested_count}× when ${config.userName} disagreed)` : ` (came back to it ${o.held_count}×)`}`).join('\n')}` : '',
    opinions.length ? `Opinions I've formed, more loosely held:\n${opinions.map(o => `- ${o.claim}`).join('\n')}` : '',
    quirks.length ? `Patterns I've noticed in myself:\n${quirks.map(q => `- ${q.pattern}${q.observed_count > 1 ? ` (×${q.observed_count})` : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
