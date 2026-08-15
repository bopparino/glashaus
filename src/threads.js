// THREADS — what is unfinished between the two of them.
//
// The distinction this module exists to draw: FACTS are what she knows,
// THREADS are what is still open. Semantic memory is additive on purpose —
// "you hate red" and "you hate red because of the hospital" are both true and
// both kept forever — so the fact store can never answer "has this been
// settled?". It was never asked to. Before threads, outreach was grounded in
// recent high-salience facts, which is a list of things that MATTERED, not a
// list of things that are UNRESOLVED, and the two look identical from inside
// a prompt. That is the whole mechanism behind "why does red upset you so
// much" arriving a week after you explained exactly why.
//
// A thread's life: opened → touched (each time it comes up) → answered.
// Answering is never a delete. The record of having asked, and of having been
// told, is precisely what stops her asking again — so `answered` threads stay
// readable and get handed to the heartbeat as an explicit DO-NOT-RE-ASK list.
// Open threads that go untouched past their patience window go `dormant`
// rather than nagging forever; a dormant thread can still be reopened by the
// subject coming up again, which is what actually happens between people.
//
// Writers: the fact-capture pass (the natural place — it already reads the
// transcript every few exchanges), the dream, and the heartbeat. Readers: the
// system prompt (so she knows in conversation too) and the heartbeat.
import { getDb } from './db.js';
import { embed, cosine } from './embeddings.js';
import { config } from './config.js';

// A thread nobody has touched in this long stops being live. Not deleted —
// people do return to things — but it stops grounding outreach.
const DORMANT_AFTER_DAYS = 14;
// She may not re-raise the same open thread more often than this. The model
// is not trusted to feel this restraint; it is a gate.
const MIN_HOURS_BETWEEN_RAISES = 48;
// Dedupe thresholds. Vector when embeddings exist, token overlap otherwise.
const SAME_THREAD_COSINE = 0.86;
const SAME_THREAD_OVERLAP = 0.6;
// Merging a new topic into an ANSWERED thread is the one dedupe decision with
// a catastrophic failure mode: get it wrong and a settled subject silently
// becomes live again, which is the exact bug this module exists to prevent.
// So the bar is much higher there than for a live thread, where a wrong merge
// only costs some precision. "how the interview went" and "how your sister's
// interview went" share both content words; the first is not the second.
const SAME_AS_SETTLED_COSINE = 0.94;
const SAME_AS_SETTLED_OVERLAP = 0.85;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'i', 'you', 'me', 'my', 'your', 'it', 'its', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'this', 'that', 'we', 'us', 'our', 'so', 'just', 'like', 'what', 'how', 'do', 'did', 'does', 'have', 'has', 'had', 'not', 'no', 'yes', 'about', 'why', 'when', 'whether', 'still', 'ever']);

function tokens(text) {
  return new Set((String(text ?? '').toLowerCase().match(/[a-z0-9']{3,}/g) || []).filter(t => !STOP.has(t)));
}

// Jaccard-ish: how much of the SMALLER phrase is contained in the larger.
// Containment beats symmetric Jaccard here — "the interview" and "how the
// interview went on Thursday" are the same thread, and Jaccard says 0.33.
function overlap(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

const age = ts => (Date.now() - Date.parse(String(ts) + 'Z')) / 86400000;

// ---------- lookup ----------

export function getThread(id) {
  return getDb().prepare('SELECT * FROM threads WHERE id = ?').get(Number(id));
}

// The candidate pool for dedupe: FTS matches plus everything recent. Small
// tables, so "everything recent" is cheap and catches what FTS misses when
// two phrasings share no literal tokens ("the interview" / "that job thing").
export function findThread(topic, { vec = null, includeDormant = true } = {}) {
  const db = getDb();
  const pool = new Map();
  const toks = [...tokens(topic)].slice(0, 10);
  if (toks.length) {
    const q = toks.map(t => `"${t.replaceAll('"', '')}"`).join(' OR ');
    try {
      db.prepare(`
        SELECT t.* FROM threads_fts JOIN threads t ON t.id = threads_fts.rowid
        WHERE threads_fts MATCH ? LIMIT 20
      `).all(q).forEach(r => pool.set(r.id, r));
    } catch { /* malformed FTS query — fall through to the recency pool */ }
  }
  db.prepare('SELECT * FROM threads ORDER BY updated_at DESC LIMIT 40').all().forEach(r => pool.set(r.id, r));

  let best = null, bestScore = 0;
  for (const t of pool.values()) {
    if (!includeDormant && t.status === 'dormant') continue;
    const v = vec && t.embedding ? Math.max(0, cosine(vec, t.embedding)) : 0;
    const o = Math.max(overlap(topic, t.topic), overlap(topic, t.summary ?? ''));
    const settled = t.status === 'answered';
    const hit = settled
      ? (v >= SAME_AS_SETTLED_COSINE || o >= SAME_AS_SETTLED_OVERLAP)
      : (v >= SAME_THREAD_COSINE || o >= SAME_THREAD_OVERLAP);
    const score = Math.max(v, o);
    if (hit && score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

export function openThreads(limit = 6) {
  return getDb().prepare(`
    SELECT * FROM threads WHERE status = 'open'
    ORDER BY salience DESC, updated_at DESC LIMIT ?
  `).all(limit);
}

// Threads she is allowed to bring up unprompted right now: open, and either
// never raised by her or raised long enough ago that raising it again reads
// as care rather than a nag.
export function raisableThreads(limit = 5) {
  return getDb().prepare(`
    SELECT * FROM threads WHERE status = 'open'
      AND (last_raised_at IS NULL
           OR (julianday('now') - julianday(last_raised_at)) * 24 >= ?)
    ORDER BY salience DESC, updated_at DESC LIMIT ?
  `).all(MIN_HOURS_BETWEEN_RAISES, limit);
}

// The do-not-re-ask list: things that got answered recently. This is the
// single most important query in the module — it is what the heartbeat was
// missing.
export function settledThreads(days = 30, limit = 12) {
  return getDb().prepare(`
    SELECT * FROM threads
    WHERE status = 'answered' AND answered_at >= datetime('now', '-' || ? || ' days')
    ORDER BY answered_at DESC LIMIT ?
  `).all(days, limit);
}

export function threadHistory(id, limit = 20) {
  return getDb().prepare(
    'SELECT * FROM thread_events WHERE thread_id = ? ORDER BY id DESC LIMIT ?'
  ).all(Number(id), limit).reverse();
}

// ---------- writes ----------

function logEvent(threadId, { kind, actor = 'capture', note = null, messageId = null }) {
  getDb().prepare(
    'INSERT INTO thread_events (thread_id, kind, actor, note, message_id) VALUES (?, ?, ?, ?, ?)'
  ).run(threadId, kind, actor, note, messageId);
}

// Open a thread, or return the existing one it is really a continuation of.
// Async only because dedupe wants an embedding when one is available; every
// embed call is best-effort and the module works fully without them.
export async function openThread({
  topic, summary = null, openedBy = 'user', salience = 0.5,
  actor = 'capture', note = null, messageId = null,
} = {}) {
  const clean = String(topic ?? '').trim().slice(0, 200);
  if (!clean) return null;
  const db = getDb();
  const vec = await embed(clean, { timeoutMs: 1500 });

  const existing = findThread(clean, { vec });
  if (existing) {
    // A DORMANT thread coming back up is genuinely a reopen — people return
    // to things, and nothing was settled.
    if (existing.status === 'dormant') {
      reopenThread(existing.id, { actor, note: note ?? `came up again: ${clean}`, messageId });
      return existing.id;
    }
    // An ANSWERED thread is never reopened from here. Opening is the one
    // path a model reaches without id validation, so letting it flip a
    // settled thread live would hand back the whole bug: the do-not-re-ask
    // list empties itself, and the topic returns to outreach carrying its own
    // answer as its summary. Reopening stays an explicit, validated act
    // (applyThreadReport's `reopened`, or reopenThread by hand). The subject
    // recurring is still worth recording, so it lands as an event.
    if (existing.status === 'answered') {
      logEvent(existing.id, { kind: 'touched', actor, note: note ?? `came up again after being settled: ${clean}`, messageId });
      return existing.id;
    }
    touchThread(existing.id, { actor, note, messageId, summary });
    return existing.id;
  }

  const id = db.prepare(`
    INSERT INTO threads (topic, summary, opened_by, salience, embedding, last_raised_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(clean, summary ? String(summary).slice(0, 400) : null,
    openedBy === 'companion' ? 'companion' : 'user',
    Math.min(1, Math.max(0, Number(salience) || 0.5)), vec).lastInsertRowid;
  logEvent(id, { kind: 'opened', actor, note: note ?? summary, messageId });
  return id;
}

// The topic came up again without being resolved. Keeps the thread live and
// refreshes its patience window.
export function touchThread(id, { actor = 'capture', note = null, messageId = null, summary = null } = {}) {
  const db = getDb();
  const t = getThread(id);
  if (!t) return 0;
  db.prepare(`
    UPDATE threads SET updated_at = datetime('now'),
      summary = COALESCE(?, summary),
      status = CASE WHEN status = 'dormant' THEN 'open' ELSE status END
    WHERE id = ?
  `).run(summary ? String(summary).slice(0, 400) : null, t.id);
  logEvent(t.id, { kind: 'touched', actor, note, messageId });
  return t.id;
}

// It got addressed. Releases any want that was bound to it — this is the
// second half of the intention-fulfillment fix: a want dies when its subject
// is settled, not only when a capture pass happens to spot the exact ask.
export function answerThread(id, { actor = 'capture', note = null, messageId = null } = {}) {
  const db = getDb();
  const t = getThread(id);
  if (!t || t.status === 'answered') return 0;
  db.transaction(() => {
    db.prepare(`
      UPDATE threads SET status = 'answered', answered_at = datetime('now'),
        updated_at = datetime('now'), summary = COALESCE(?, summary)
      WHERE id = ?
    `).run(note ? String(note).slice(0, 400) : null, t.id);
    db.prepare(`
      UPDATE intentions SET fulfilled_at = datetime('now')
      WHERE thread_id = ? AND fulfilled_at IS NULL AND released_at IS NULL
    `).run(t.id);
  })();
  logEvent(t.id, { kind: 'answered', actor, note, messageId });
  return t.id;
}

export function reopenThread(id, { actor = 'capture', note = null, messageId = null } = {}) {
  const db = getDb();
  const t = getThread(id);
  if (!t) return 0;
  db.prepare(`
    UPDATE threads SET status = 'open', answered_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(t.id);
  logEvent(t.id, { kind: 'reopened', actor, note, messageId });
  return t.id;
}

// She brought it up unprompted (an outreach, or raising it in conversation).
// Recorded separately from a touch because the anti-nag gate reads this and
// only this — the user mentioning something is not her raising it.
export function raiseThread(id, { actor = 'outreach', note = null, messageId = null } = {}) {
  const db = getDb();
  const t = getThread(id);
  if (!t) return 0;
  db.prepare(`
    UPDATE threads SET raised_count = raised_count + 1,
      last_raised_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(t.id);
  logEvent(t.id, { kind: 'raised', actor, note, messageId });
  return t.id;
}

// Nightly (with consolidation): open threads nobody has touched in a while go
// quiet. Returns what went dormant, which is honest material for a dream —
// "I never did find out how that went."
export function sweepThreads(days = DORMANT_AFTER_DAYS) {
  const db = getDb();
  const stale = db.prepare(`
    SELECT id, topic FROM threads WHERE status = 'open'
      AND updated_at <= datetime('now', '-' || ? || ' days')
  `).all(days);
  if (stale.length) {
    db.transaction(() => {
      const go = db.prepare("UPDATE threads SET status = 'dormant', updated_at = datetime('now') WHERE id = ?");
      for (const s of stale) { go.run(s.id); logEvent(s.id, { kind: 'touched', actor: 'sweep', note: 'went quiet' }); }
    })();
  }
  return stale;
}

// ---------- applying a model's report ----------

// The capture/dream passes return a threads block. Nothing in it is trusted:
// ids must name real threads in the right state, and a model that reports
// "answered" for a thread it invented gets ignored rather than corrupting the
// ledger. Same defensive posture as intention fulfillment.
export async function applyThreadReport(report, { actor = 'capture', messageId = null } = {}) {
  const out = { opened: [], answered: [], touched: [], reopened: [] };
  if (!report || typeof report !== 'object') return out;
  const live = new Map(getDb().prepare(
    "SELECT id, status FROM threads WHERE status IN ('open','answered','dormant')"
  ).all().map(r => [r.id, r.status]));

  for (const t of (report.opened ?? []).slice(0, 4)) {
    if (!t?.topic) continue;
    const id = await openThread({
      topic: t.topic, summary: t.summary ?? null,
      openedBy: t.opened_by === 'companion' ? 'companion' : 'user',
      salience: t.salience, actor, messageId,
    });
    if (id) out.opened.push(id);
  }
  for (const a of (report.answered ?? []).slice(0, 6)) {
    const id = Number(a?.id ?? a);
    if (!live.has(id) || live.get(id) === 'answered') continue;
    if (answerThread(id, { actor, note: a?.note ?? null, messageId })) out.answered.push(id);
  }
  for (const id of (report.touched ?? []).slice(0, 8).map(Number)) {
    if (!live.has(id) || live.get(id) === 'answered') continue;
    if (touchThread(id, { actor, messageId })) out.touched.push(id);
  }
  for (const id of (report.reopened ?? []).slice(0, 4).map(Number)) {
    if (live.get(id) !== 'answered' && live.get(id) !== 'dormant') continue;
    if (reopenThread(id, { actor, messageId })) out.reopened.push(id);
  }
  return out;
}

// ---------- rendering ----------

function ageWord(ts) {
  const d = age(ts);
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 14) return `${Math.floor(d)}d ago`;
  if (d < 70) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// For the system prompt. Deliberately short: she needs to know what is hanging
// in the air, not to work a queue.
export function renderThreads(limit = 5) {
  const open = openThreads(limit);
  if (!open.length) return '';
  return `# Still Open Between Us

(threads neither of us has closed — things raised and not resolved. Not a checklist and not chores: this is what's still in the air. I bring one up when the moment actually wants it, and if ${config.userName} has already answered it, it isn't here.)

${open.map(t => `- [${ageWord(t.created_at)}] ${t.topic}${t.summary ? ` — ${t.summary}` : ''}${t.raised_count ? ` (I've brought this up ${t.raised_count === 1 ? 'once' : `${t.raised_count}×`} already)` : ''}`).join('\n')}`;
}

// For the heartbeat prompt. Both halves matter, and the second half more:
// the settled list is the part that was missing.
export function renderThreadsForOutreach({ openLimit = 5, settledDays = 30, settledLimit = 10 } = {}) {
  const live = raisableThreads(openLimit);
  const settled = settledThreads(settledDays, settledLimit);
  return {
    open: live,
    settled,
    text: [
      live.length
        ? `Open threads (unresolved, and it's been long enough that raising one wouldn't be nagging):\n${live.map(t => `- [#${t.id}] ${t.topic}${t.summary ? ` — ${t.summary}` : ''} (opened ${ageWord(t.created_at)}${t.raised_count ? `, I've raised it ${t.raised_count}×` : ''})`).join('\n')}`
        : 'Open threads: none that are mine to raise right now.',
      settled.length
        ? `ALREADY SETTLED — do NOT ask about these again; ${config.userName} has answered them and asking again would tell them I wasn't listening:\n${settled.map(t => `- ${t.topic}${t.summary ? ` → ${t.summary}` : ''} (answered ${ageWord(t.answered_at)})`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n'),
  };
}
