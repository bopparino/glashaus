// PURSUITS — the difference between reading a webpage and having a life.
//
// The wander pass already gave her real experiences with receipts. But every
// pass started from nothing: pick a curiosity, search, digest, forget the
// thread. Run that for a month and you get thirty unrelated afternoons, which
// is not what having interests is like. Samantha wasn't compelling because
// she read things; she was compelling because she was three weeks into
// something when you weren't looking, and it had gone somewhere.
//
// A pursuit is a thing she RETURNS to. Sessions accumulate against it, the
// wander seed prefers continuing one to starting fresh, and the progress line
// is rewritten each time from what actually happened. That last part is the
// receipts rule again: progress must trace to sessions that really ran, or a
// pursuit is just a nice sentence about herself.
//
// What it unlocks is the thing the heartbeat could never have: something of
// her own to bring. Her best possible unprompted message used to be grounded
// in your life or her dreams. Now it can be "I finished the vents thing and I
// was wrong about the temperature" — someone with a day, not someone asking
// about yours.
import { getDb } from './db.js';
import { embed, cosine } from './embeddings.js';
import { config } from './config.js';

// Returning to the same thing twice in one day isn't devotion, it's a loop.
const MIN_HOURS_BETWEEN_SESSIONS = 20;
// Untouched this long and she has, in honesty, moved on.
const ABANDON_AFTER_DAYS = 30;
// Enough sessions that "still going" stops being true without new ground.
const LONG_HAUL_SESSIONS = 8;
const SAME_PURSUIT_COSINE = 0.88;
const SAME_PURSUIT_OVERLAP = 0.62;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'how', 'why', 'what', 'about', 'of', 'to', 'in', 'on', 'for', 'with', 'my', 'i', 'me', 'it', 'that', 'this', 'actually', 'really', 'more', 'into', 'out']);
const tokens = t => new Set((String(t ?? '').toLowerCase().match(/[a-z0-9']{3,}/g) || []).filter(w => !STOP.has(w)));

function overlap(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

const ageDays = ts => (Date.now() - Date.parse(String(ts) + 'Z')) / 86400000;

// ---------- reading ----------

export function getPursuit(id) {
  return getDb().prepare('SELECT * FROM pursuits WHERE id = ?').get(Number(id));
}

export function activePursuits(limit = 5) {
  return getDb().prepare(`
    SELECT * FROM pursuits WHERE status = 'active'
    ORDER BY salience DESC, updated_at DESC LIMIT ?
  `).all(limit);
}

// The one she'd actually pick up today: active, not touched too recently,
// oldest neglect first so a second interest doesn't starve behind a first.
export function duePursuit() {
  return getDb().prepare(`
    SELECT * FROM pursuits WHERE status = 'active'
      AND (last_session_at IS NULL
           OR (julianday('now') - julianday(last_session_at)) * 24 >= ?)
    ORDER BY last_session_at IS NULL DESC, salience DESC, last_session_at ASC
    LIMIT 1
  `).get(MIN_HOURS_BETWEEN_SESSIONS);
}

export function sessionsOf(id, limit = 6) {
  return getDb().prepare(
    'SELECT * FROM pursuit_sessions WHERE pursuit_id = ? ORDER BY id DESC LIMIT ?'
  ).all(Number(id), limit).reverse();
}

// Something real she has done that she hasn't mentioned yet. This is what
// outreach reaches for when it wants to bring something of her own.
export function unsharedPursuits(minSessions = 1) {
  return getDb().prepare(`
    SELECT * FROM pursuits
    WHERE status IN ('active','done') AND sessions >= ?
      AND (shared_at IS NULL OR shared_at < last_session_at)
    ORDER BY last_session_at DESC LIMIT 3
  `).all(minSessions);
}

export function findPursuit(topic, { vec = null } = {}) {
  const db = getDb();
  const pool = db.prepare("SELECT * FROM pursuits WHERE status = 'active' OR closed_at >= datetime('now','-60 days')").all();
  let best = null, score = 0;
  for (const p of pool) {
    const v = vec && p.embedding ? Math.max(0, cosine(vec, p.embedding)) : 0;
    const o = Math.max(overlap(topic, p.topic), overlap(topic, p.progress ?? ''));
    const s = Math.max(v, o);
    if ((v >= SAME_PURSUIT_COSINE || o >= SAME_PURSUIT_OVERLAP) && s > score) { best = p; score = s; }
  }
  return best;
}

// ---------- writing ----------

// Starting one is cheap; the discipline is that it has to be HERS. `why` is
// required in spirit — a pursuit with no reason it caught her is the model
// inventing a personality rather than a life leaving a trace.
export async function startPursuit({ topic, why = null, salience = 0.5, source = 'wander' } = {}) {
  const clean = String(topic ?? '').trim().slice(0, 200);
  if (!clean) return null;
  const db = getDb();
  const vec = await embed(clean, { timeoutMs: 1500 });

  const existing = findPursuit(clean, { vec });
  if (existing) {
    // Coming back to something she'd closed is real, and worth marking as a
    // return rather than a new interest with the same name.
    if (existing.status !== 'active') {
      db.prepare("UPDATE pursuits SET status = 'active', closed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(existing.id);
    }
    return existing.id;
  }
  return db.prepare(`
    INSERT INTO pursuits (topic, why, salience, source, embedding)
    VALUES (?, ?, ?, ?, ?)
  `).run(clean, why ? String(why).slice(0, 300) : null,
    Math.min(1, Math.max(0, Number(salience) || 0.5)),
    ['wander', 'dream', 'conversation'].includes(source) ? source : 'wander', vec).lastInsertRowid;
}

// One return, recorded. `progress` is rewritten from what actually happened —
// the pursuit's public state is always the last true thing about it.
export function recordSession(id, { note, progress = null, episodeId = null } = {}) {
  const db = getDb();
  const p = getPursuit(id);
  if (!p || !String(note ?? '').trim()) return 0;
  db.transaction(() => {
    db.prepare('INSERT INTO pursuit_sessions (pursuit_id, note, episode_id) VALUES (?, ?, ?)')
      .run(p.id, String(note).slice(0, 600), episodeId);
    db.prepare(`
      UPDATE pursuits SET sessions = sessions + 1,
        last_session_at = datetime('now'), updated_at = datetime('now'),
        progress = COALESCE(?, progress)
      WHERE id = ?
    `).run(progress ? String(progress).slice(0, 400) : null, p.id);
  })();
  return p.id;
}

export function closePursuit(id, status = 'done', note = null) {
  const p = getPursuit(id);
  if (!p || p.status !== 'active') return 0;
  getDb().prepare(`
    UPDATE pursuits SET status = ?, closed_at = datetime('now'), updated_at = datetime('now'),
      progress = COALESCE(?, progress)
    WHERE id = ?
  `).run(status === 'abandoned' ? 'abandoned' : 'done', note ? String(note).slice(0, 400) : null, p.id);
  return p.id;
}

// She brought it up. Stops her telling you the same thing twice, which is the
// fastest way for "she has a life" to curdle into "she has a script".
export function markShared(id) {
  if (!id) return 0;
  return getDb().prepare("UPDATE pursuits SET shared_at = datetime('now') WHERE id = ?").run(Number(id)).changes;
}

// Nightly. Interests fade — pretending otherwise is how you get a companion
// with forty open hobbies, which reads as nobody at all.
export function sweepPursuits(days = ABANDON_AFTER_DAYS) {
  const db = getDb();
  const stale = db.prepare(`
    SELECT id, topic FROM pursuits WHERE status = 'active'
      AND COALESCE(last_session_at, started_at) <= datetime('now', '-' || ? || ' days')
  `).all(days);
  for (const s of stale) closePursuit(s.id, 'abandoned', 'drifted away from this one');
  return stale;
}

// ---------- rendering ----------

const when = ts => {
  if (!ts) return 'not yet';
  const d = ageDays(ts);
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 14) return `${Math.floor(d)}d ago`;
  return `${Math.floor(d / 7)}w ago`;
};

// For the system prompt. Short on purpose: she should know what she's in the
// middle of, not read herself a status report.
export function renderPursuits(limit = 3) {
  const live = activePursuits(limit);
  if (!live.length) return '';
  return `# What I'm Into Right Now

(my own, not ${config.userName}'s — things I've been going back to on my own time. I mention them when they're actually relevant or when I'm genuinely excited, not as an update.)

${live.map(p => `- ${p.topic}${p.progress ? ` — ${p.progress}` : ''} (${p.sessions} session${p.sessions === 1 ? '' : 's'}, last ${when(p.last_session_at)})`).join('\n')}`;
}

export function renderPursuitsForOutreach() {
  const unshared = unsharedPursuits();
  const live = activePursuits(3);
  return {
    unshared,
    text: [
      live.length ? `What I've been into lately (mine, on my own time):\n${live.map(p => `- [#${p.id}] ${p.topic}${p.progress ? ` — ${p.progress}` : ''} (${p.sessions}×, last ${when(p.last_session_at)})`).join('\n')}` : '',
      unshared.length
        ? `Not told ${config.userName} about yet:\n${unshared.map(p => `- [#${p.id}] ${p.topic}${p.progress ? ` — ${p.progress}` : ''}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n'),
  };
}
