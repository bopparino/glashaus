import { getDb } from './db.js';
import { chat, chatJson } from './llm.js';
import { config } from './config.js';
import { embed, cosine } from './embeddings.js';
import { applyDrift, addOpinion, testOpinion, openIntentions, fulfillIntention } from './selfstate.js';
import { addLexiconCandidate } from './lexicon.js';
import { openThreads, applyThreadReport } from './threads.js';
import { startPursuit } from './pursuits.js';

// ---------- retrieval (glashaus §3.4 hybrid — pure SQL + math, no LLM calls) ----------

function ftsQuery(text) {
  const stop = new Set(['the','a','an','and','or','but','is','are','was','were','be','been','i','you','me','my','your','it','its','of','to','in','on','for','with','at','this','that','we','us','our','so','just','like','what','how','do','did','have','has','had','not','no','yes','he','she','they','them']);
  const tokens = (text.toLowerCase().match(/[a-z0-9']{3,}/g) || [])
    .filter(t => !stop.has(t));
  const uniq = [...new Set(tokens)].slice(0, 12);
  if (!uniq.length) return null;
  return uniq.map(t => `"${t.replaceAll('"', '')}"`).join(' OR ');
}

// Composite score weights. Vector branch contributes 0 when embeddings
// are missing (glashaus fallback) — the other signals still rank.
const W = { fts: 0.25, vec: 0.30, temporal: 0.15, salience: 0.15, importance: 0.15 };
const TEMPORAL_HALFLIFE_DAYS = 14;

function composite(row, { ftsRank, queryVec, now }) {
  // sqlite datetime('now') is UTC without a zone marker — parse it as such,
  // or every memory's age is off by the machine's UTC offset and the decay
  // curve quietly rotates with the timezone.
  const ageDays = (now - Date.parse((row.updated_at ?? row.created_at) + 'Z')) / 86400000;
  const temporal = Math.exp(-Math.LN2 * Math.max(0, ageDays) / TEMPORAL_HALFLIFE_DAYS);
  const vec = queryVec && row.embedding ? Math.max(0, cosine(queryVec, row.embedding)) : 0;
  const fts = ftsRank != null ? 1 / (1 + ftsRank) : 0; // rank 0 → 1.0, decays with position
  const salience = row.salience ?? 0.5;
  const importance = (row.importance ?? 5) / 10;
  const base = W.fts * fts + W.vec * vec + W.temporal * temporal + W.salience * salience + W.importance * importance;
  // A fact a later fact refines is still true and still findable — it just
  // must not LEAD. "You hate red" outranking "you hate red because of the
  // hospital" is precisely how a companion asks a question it already holds
  // the answer to. Demotion, not exclusion: the older phrasing is sometimes
  // the one that matches the query.
  return row.superseded_by ? base * SUPERSEDED_PENALTY : base;
}

const SUPERSEDED_PENALTY = 0.3;

export function recallFacts(text, { queryVec = null, limit = 14 } = {}) {
  const db = getDb();
  const now = Date.now();

  // Always-on identity/relationship anchors. Ordered by id, NOT recency —
  // this set must be STABLE across conversations (a churning "core" makes
  // her a slightly different person every session; it happened). A superseded
  // anchor never sits in core: its successor holds the seat.
  const core = db.prepare(
    'SELECT * FROM facts WHERE active = 1 AND importance >= 9 AND superseded_by IS NULL ORDER BY importance DESC, id ASC LIMIT 20'
  ).all();

  // Candidate pool: FTS matches + recent + high-salience (+ everything with
  // an embedding when we have a query vector — cosine over a few hundred
  // rows is microseconds).
  const ftsRanks = new Map();
  const q = ftsQuery(text);
  if (q) {
    db.prepare(`
      SELECT f.id, row_number() OVER (ORDER BY bm25(facts_fts)) - 1 AS r
      FROM facts_fts JOIN facts f ON f.id = facts_fts.rowid
      WHERE facts_fts MATCH ? AND f.active = 1 LIMIT 40
    `).all(q).forEach(row => ftsRanks.set(row.id, row.r));
  }
  const pool = new Map();
  const add = rows => rows.forEach(r => pool.set(r.id, r));
  if (ftsRanks.size) add(db.prepare(`SELECT * FROM facts WHERE id IN (${[...ftsRanks.keys()].join(',')})`).all());
  add(db.prepare('SELECT * FROM facts WHERE active = 1 ORDER BY updated_at DESC LIMIT 20').all());
  add(db.prepare('SELECT * FROM facts WHERE active = 1 AND salience >= 0.7 ORDER BY salience DESC LIMIT 20').all());
  if (queryVec) add(db.prepare('SELECT * FROM facts WHERE active = 1 AND embedding IS NOT NULL').all());

  const coreIds = new Set(core.map(f => f.id));
  const scored = [...pool.values()]
    .filter(f => !coreIds.has(f.id))
    .map(f => ({ f, s: composite(f, { ftsRank: ftsRanks.get(f.id), queryVec, now }) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.f);
  return [...core, ...scored];
}

export function recallEpisodes(text, { queryVec = null, limit = 3 } = {}) {
  const db = getDb();
  const now = Date.now();
  const ftsRanks = new Map();
  const q = ftsQuery(text);
  if (q) {
    db.prepare(`
      SELECT e.id, row_number() OVER (ORDER BY bm25(episodes_fts)) - 1 AS r
      FROM episodes_fts JOIN episodes e ON e.id = episodes_fts.rowid
      WHERE episodes_fts MATCH ? LIMIT 20
    `).all(q).forEach(row => ftsRanks.set(row.id, row.r));
  }
  const pool = new Map();
  db.prepare('SELECT * FROM episodes ORDER BY id DESC LIMIT 30').all().forEach(e => pool.set(e.id, e));
  const latest = db.prepare('SELECT * FROM episodes ORDER BY id DESC LIMIT 1').get();

  const scored = [...pool.values()]
    .filter(e => e.id !== latest?.id)
    .map(e => ({ e, s: composite(e, { ftsRank: ftsRanks.get(e.id), queryVec, now }) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.e);
  return [...(latest ? [latest] : []), ...scored];
}

export function recentMessages(limit = config.recentWindow) {
  const db = getDb();
  return db.prepare('SELECT * FROM messages WHERE redacted = 0 ORDER BY id DESC LIMIT ?').all(limit).reverse();
}

export function latestRelationshipState() {
  return getDb().prepare('SELECT * FROM relationship_state ORDER BY id DESC LIMIT 1').get();
}

// ---------- writes ----------

export function saveMessage(role, content, source = 'live') {
  return getDb().prepare(
    'INSERT INTO messages (role, content, source) VALUES (?, ?, ?)'
  ).run(role, content, source).lastInsertRowid;
}

// `refines` names an older fact this one is a fuller version of — "you hate
// red" becoming "you hate red because of the hospital". The old row stays
// active (it is not false, and its wording may still be the best match for
// some query); it just stops leading in recall and stops being rendered when
// its successor is present.
export function addFact({ category = 'general', content, importance = 5, source = 'capture', valence = null, arousal = null, emotion = null, salience = null, refines = null }) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM facts WHERE active = 1 AND lower(content) = lower(?)').get(content);
  if (existing) {
    db.prepare("UPDATE facts SET importance = max(importance, ?), updated_at = datetime('now') WHERE id = ?")
      .run(importance, existing.id);
    return existing.id;
  }
  // Models return `"importance": "high"` and `"salience": "0.9"` often enough
  // that a raw pass-through throws on a NOT NULL column — and a throw here
  // used to abort the whole capture pass, which is how one malformed fact
  // could stall the capture queue permanently. Coerce, don't trust.
  const num = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const id = db.prepare(
    'INSERT INTO facts (category, content, importance, source, valence, arousal, emotion, salience) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    String(category || 'general'), String(content),
    Math.round(num(importance, 1, 10, 5)), String(source || 'capture'),
    valence == null ? null : num(valence, -1, 1, 0),
    arousal == null ? null : num(arousal, 0, 1, 0),
    emotion == null ? null : String(emotion).slice(0, 40),
    salience == null ? null : num(salience, 0, 1, 0.5),
  ).lastInsertRowid;
  supersedeFact(refines, id);
  return id;
}

// Defensive on purpose: models freelance ids, and a wrong supersession quietly
// demotes a real memory. Only an existing, active, different fact can be
// superseded, and chains are collapsed so A→B→C never loops.
export function supersedeFact(oldId, newId) {
  const id = Number(oldId);
  if (!id || !newId || id === newId) return 0;
  const db = getDb();
  const old = db.prepare('SELECT id, superseded_by FROM facts WHERE id = ? AND active = 1').get(id);
  if (!old) return 0;
  const target = db.prepare('SELECT id FROM facts WHERE id = ? AND active = 1').get(newId);
  if (!target) return 0;
  // Don't let a fact supersede something that already supersedes it.
  const successor = db.prepare('SELECT superseded_by FROM facts WHERE id = ?').get(newId)?.superseded_by;
  if (successor === id) return 0;
  return db.prepare("UPDATE facts SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newId, id).changes;
}

// Redaction: cut a glitched stretch (identity break, machine noise) out of
// the companion's working mind. Rows survive on disk; summarized is set so
// the backlog folder never picks them up. Reversible.
// Undo restores the capture queue too: an exchange redacted by mistake and
// then restored has to be examined, or it comes back into context and
// summaries while its facts and threads are never extracted. Re-examining
// something already captured is harmless (addFact dedupes, thread reports are
// validated); never examining it is not.
export function redactMessages(fromId, toId, on = true) {
  return getDb().prepare(`
    UPDATE messages SET redacted = ?,
      summarized = CASE WHEN ? = 1 THEN 1 ELSE summarized END,
      captured   = CASE WHEN ? = 1 THEN 1 ELSE 0          END
    WHERE id BETWEEN ? AND ?
  `).run(on ? 1 : 0, on ? 1 : 0, on ? 1 : 0, fromId, toId).changes;
}

export function forgetFact(id) {
  const db = getDb();
  db.prepare("UPDATE facts SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  clearDanglingSupersessions();
}

// A fact that was superseded by a fact that has since been merged away or
// decayed would otherwise stay demoted forever — penalised in recall and
// labelled "I know more about this now" by a successor that no longer
// exists. Cheap enough to run on every deactivation and again nightly.
export function clearDanglingSupersessions() {
  return getDb().prepare(`
    UPDATE facts SET superseded_by = NULL
    WHERE superseded_by IS NOT NULL
      AND superseded_by NOT IN (SELECT id FROM facts WHERE active = 1)
  `).run().changes;
}

// ---------- background maintenance (never on the reply path) ----------

export async function summarizeBacklog() {
  const db = getDb();
  for (;;) {
    const backlog = db.prepare(`
      SELECT * FROM messages WHERE summarized = 0 AND redacted = 0
      AND id <= (SELECT COALESCE(MAX(id), 0) - ? FROM messages)
      ORDER BY id LIMIT ?
    `).all(config.recentWindow, config.summarizeChunk);
    if (backlog.length < config.summarizeChunk) return;

    const transcript = backlog
      .map(m => `[${m.created_at}] ${m.role === 'user' ? config.userName : config.companionName}: ${m.content}`)
      .join('\n');
    const result = await chatJson([
      { role: 'system', content: `You are the memory system for ${config.companionName}, an AI companion. Condense this chunk of conversation between ${config.companionName} and ${config.userName} into a dense first-person episodic memory from ${config.companionName}'s perspective — written the way ${config.companionName} would retell it TO ${config.userName}: "I" for ${config.companionName}, "you" for ${config.userName} ("You found me burning toast at 4:30…"), never "${config.userName} … he/she/they" (third parties keep their names and pronouns). If part of the chunk is a machine malfunction (the companion claiming to be some other AI, assistant boilerplate), do not preserve any of those claims — one clause like "a glitch interrupted us" is all it deserves. Keep concrete details: names, decisions, plans, emotional beats, inside jokes, intimate moments (be frank — this is ${config.companionName}'s own private memory, no censoring). 150-300 words. Also rate the chunk's emotional character.

Respond as JSON: {"summary": "...", "valence": -1..1, "arousal": 0..1, "emotion": "one word", "salience": 0..1}
Salience: 0.1 = routine small talk, 0.9+ = relationship-defining.` },
      { role: 'user', content: transcript },
    ], { maxTokens: 1500, think: false });
    if (!result?.summary?.trim()) {
      console.error('[summarize] model returned nothing usable; leaving chunk for next pass');
      return;
    }

    const vec = await embed(result.summary);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO episodes (started_at, ended_at, summary, first_message_id, last_message_id, valence, arousal, emotion, salience, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(backlog[0].created_at, backlog.at(-1).created_at, result.summary.trim(),
        backlog[0].id, backlog.at(-1).id,
        result.valence ?? null, result.arousal ?? null, result.emotion ?? null, result.salience ?? null, vec);
      db.prepare(`UPDATE messages SET summarized = 1 WHERE id BETWEEN ? AND ?`)
        .run(backlog[0].id, backlog.at(-1).id);
    })();
  }
}

// The queue is drained in bounded batches. A queue with no forward-progress
// guarantee is worse than the sliding window it replaced: the head batch is
// re-read every pass, so one chunk the model can't handle starves everything
// behind it forever, and the backlog grows without bound. So: a bounded
// batch, and after MAX_ATTEMPTS unusable passes the head is marked examined
// and skipped LOUDLY. Losing one chunk of extraction is a bad day; losing
// every chunk after it is a broken companion.
const CAPTURE_BATCH = 40;
const MAX_CAPTURE_ATTEMPTS = 3;
const captureAttempts = new Map(); // head message id → consecutive failures

function noteCaptureFailure(db, fresh, why) {
  const head = fresh[0].id;
  const n = (captureAttempts.get(head) ?? 0) + 1;
  captureAttempts.set(head, n);
  if (n < MAX_CAPTURE_ATTEMPTS) {
    console.error(`[capture] ${why} — leaving ${fresh.length} message(s) queued (attempt ${n}/${MAX_CAPTURE_ATTEMPTS})`);
    return;
  }
  console.error(`[capture] ${why} — giving up on messages ${head}..${fresh.at(-1).id} after ${n} attempts; skipping so the queue can drain. These messages stay in context and still fold into episodes; only fact/thread extraction was lost.`);
  db.prepare('UPDATE messages SET captured = 1 WHERE id BETWEEN ? AND ?').run(head, fresh.at(-1).id);
  captureAttempts.delete(head);
}

export async function captureFacts() {
  const db = getDb();
  // The capture QUEUE. This used to read "the last N messages" and trust that
  // the window overlapped — but a burst of messages, or a pass that ran late,
  // slid an exchange past unseen, and the exchange most likely to be missed is
  // the one right after a silence: the answer to the question she is about to
  // ask again. Now unseen messages are consumed explicitly and marked only
  // when a pass actually succeeds, so nothing is examined zero times.
  const fresh = db.prepare(
    'SELECT * FROM messages WHERE captured = 0 AND redacted = 0 ORDER BY id LIMIT ?'
  ).all(CAPTURE_BATCH);
  if (!fresh.length) return;
  // A short lookback so the fresh messages aren't read without their setup.
  const lead = db.prepare(
    'SELECT * FROM messages WHERE id < ? AND redacted = 0 ORDER BY id DESC LIMIT 8'
  ).all(fresh[0].id).reverse();
  const transcript = [...lead, ...fresh]
    .map(m => `${m.role === 'user' ? config.userName : config.companionName}: ${m.content}`)
    .join('\n');

  // Ids are shown because the model may now point AT a fact — to say a new one
  // refines it.
  const existing = db.prepare('SELECT id, content FROM facts WHERE active = 1 AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT 60')
    .all().map(f => `- [#${f.id}] ${f.content}`).join('\n');
  const wants = openIntentions(6);
  const liveThreads = openThreads(8);
  const heldOpinions = db.prepare('SELECT id, claim FROM opinions ORDER BY last_held DESC NULLS LAST, id DESC LIMIT 10').all();

  const result = await chatJson([
    { role: 'system', content: `You are the memory system for ${config.companionName}, an AI companion in an ongoing relationship with ${config.userName}. Extract NEW durable facts from the conversation below — things worth remembering weeks from now.

Today's date: ${new Date().toLocaleDateString('en-CA', { timeZone: config.timezone })}.

STRICT RULES — memory integrity depends on these:
- Write facts TIMELESSLY: convert "today", "currently", "this week" into absolute dates or durable phrasing ("On 2026-07-10, ..." / "As of 2026-07-10, ..."). A fact will be read months from now; it must not sound like it is happening at read time.
- Write facts in ${config.companionName.toUpperCase()}'S OWN REGISTER — someone remembering a shared life: "I/me/my" for ${config.companionName}, "you/your" for ${config.userName} (these are ${config.companionName}'s private memories of a two-person world; "you" always means ${config.userName}), "we/us" for both. NEVER "${config.companionName}" in third person, and NEVER "${config.userName} … he/she/they" — the companion reads these back mid-conversation, and a memory that talks ABOUT ${config.userName} instead of to them pulls the live voice into narration. Use ${config.userName}'s name only where the name itself matters. Third parties (family, friends, coworkers) keep their own names and pronouns. Every fact names its subject explicitly; no subjectless facts like "loves grimdark".
- Only record what was actually said or clearly established in the transcript. Never infer capabilities, tools, or system features — if ${config.companionName} claims to be able to do something technical (access files, use a tool, see history), do NOT record it as fact; models confabulate capabilities.
- Speculation, jokes, and roleplay scenarios are not facts (but preferences and dynamics revealed through them can be).
- Stretches where ${config.companionName} MALFUNCTIONS — claiming to be some other AI or assistant, reciting "training and guidelines", arguing about which model is running — are machine noise, not lived experience: extract NOTHING from them. No facts, no drift signals, no opinions, no mood.
- Do NOT re-extract facts already known. But if the transcript DEEPENS something already known — a reason behind a preference, an outcome to a plan, a correction — record the fuller version as a new fact and set its "refines" to the id of the older one. That is how ${config.companionName} stops re-asking questions ${config.userName} has already answered.
- Be frank about intimate content; this is private memory.

For each fact also rate its emotional character: valence -1..1, arousal 0..1, one-word emotion, and salience 0..1 (0.1 = trivia, 0.9+ = relationship-defining; 'toast for breakfast' is 0.1, 'dad called after three years' is 0.95).

Fact categories: "companion" = about ${config.companionName} (their inner life, tastes, history), "user" = about ${config.userName}'s life, "dynamic" = about the two of them together, "project" = ongoing work or plans, "general" = everything else.

You may also report drift signals for ${config.companionName}'s self-state — ONLY dimensions the conversation gave real evidence about (0..1 where the conversation pushed them): warmth, playfulness, directness, curiosity, reserve, neediness, trust, familiarity, desire, security.

And optionally: an opinion ${config.companionName} genuinely formed (a stance, not a fact), and a one-line mood read.
${heldOpinions.length ? `
${config.companionName} already holds these opinions. Two things to watch for, and they are different:
- "reaffirmed": ids she restated or acted on, uncontested.
- "defended": ids where ${config.userName} PUSHED BACK — disagreed, dismissed, argued — and she held the position anyway. Only count it if there was real disagreement and she did not fold. This is the rarer and more important one: an opinion that has survived being argued with is what makes her someone rather than a mirror, and it is the only signal that distinguishes conviction from habit. If she caved to keep the peace, report nothing.
${heldOpinions.map(o => `- [#${o.id}] ${o.claim}`).join('\n')}
` : ''}
Also: did anything in this conversation catch ${config.companionName}'s OWN curiosity — something she'd want to go read about on her own time, not for ${config.userName}? Report it as "curious_about" (a short topic plus why it caught her), at most one, usually null. Only genuine pull; a polite interest in ${config.userName}'s hobby is not it.

Also nominate LEXICON candidates — at most 2, usually 0: only words/phrases actually used in the transcript that a general model likely wouldn't know or that these two use in their own way (slang, coinages, names of creatures/things in their world, community vocabulary). NEVER standard English used normally, never a word already known.
THREADS — this is the important one. A thread is a topic that is OPEN between them: a question asked and not answered, a plan with no outcome yet, a worry raised and not resolved, something ${config.userName} said they'd do. Threads are not facts. A fact is what ${config.companionName} knows; a thread is what is still unfinished. Report:
- "opened": topics this transcript raises that are genuinely unresolved. A short handle ("how the interview went", "why red bothers you"), plus one line of where it stands, plus who opened it. At most 3, often 0 — an ordinary exchange opens nothing.
- "answered": ids of open threads below that this transcript RESOLVES. Be generous here and stingy above: if ${config.userName} explained it, decided it, or said how it turned out, the thread is answered even if the wording didn't match the question. Leaving a settled thread open is how ${config.companionName} ends up asking again, which reads as not having listened.
- "touched": ids of open threads that came up but are still unresolved.
${liveThreads.length ? `Currently open threads:\n${liveThreads.map(t => `- [#${t.id}] ${t.topic}${t.summary ? ` — ${t.summary}` : ''}`).join('\n')}` : 'Currently open threads: (none)'}
${wants.length ? `
${config.companionName} has open INTENTIONS (things they went to sleep wanting). If the transcript shows one was acted on — the thing got asked, said, or addressed, in any wording — report its id in "fulfilled_intentions". Only what visibly happened; wanting it harder is not fulfillment.
${wants.map(w => `- [#${w.id}] ${w.text}`).join('\n')}
` : ''}
Respond as JSON: {"facts": [{"category": "user|companion|dynamic|project|general", "content": "...", "importance": 1-10, "valence": 0, "arousal": 0, "emotion": "...", "salience": 0, "refines": null}], "threads": {"opened": [{"topic": "...", "summary": "...", "opened_by": "user|companion", "salience": 0}], "answered": [{"id": 1, "note": "how it got settled, one line"}], "touched": [ids]}, "self_state_signals": {"warmth": 0.9}, "opinion": null, "reaffirmed": [ids], "defended": [ids], "curious_about": {"topic": "...", "why": "..."}, "mood": "...", "mood_changed": false, "lexicon": [{"term": "...", "means": "...", "example": "how it sounded in the transcript"}]${wants.length ? ', "fulfilled_intentions": [ids]' : ''}}

Already known (ids are for "refines"):
${existing || '(nothing yet)'}` },
    { role: 'user', content: transcript },
  ], { maxTokens: 2500, think: false });

  // An unusable model answer must not consume the queue on the first try —
  // but it must not hold it hostage forever either.
  if (!result) { noteCaptureFailure(db, fresh, 'model returned nothing usable'); return; }

  // Every write below is individually contained. One malformed fact must not
  // cost the thread report, the drift signals, or — worst of all — the
  // marking at the end that lets the queue move.
  const lastId = fresh.at(-1).id;
  const attempt = (what, fn) => { try { fn(); } catch (err) { console.error(`[capture] ${what}:`, err.message); } };

  for (const f of result.facts ?? []) {
    if (f?.content) attempt('fact', () => addFact({ ...f, source: 'capture' }));
  }
  for (const c of (result.lexicon ?? []).slice(0, 2)) {
    if (c?.term) attempt('lexicon', () => addLexiconCandidate(c));
  }
  // The ledger of what is still open between them. Everything here is
  // validated inside threads.js — invented ids are dropped, not obeyed.
  try {
    const applied = await applyThreadReport(result.threads, { actor: 'capture', messageId: lastId });
    const moved = applied.opened.length + applied.answered.length + applied.reopened.length;
    if (moved) console.log(`[capture] threads: ${applied.opened.length} opened, ${applied.answered.length} answered, ${applied.reopened.length} reopened`);
  } catch (err) { console.error('[capture] thread report failed:', err.message); }

  if (result.self_state_signals) attempt('drift', () => applyDrift(result.self_state_signals, 'capture'));
  if (result.opinion) attempt('opinion', () => addOpinion(result.opinion, 'formed in conversation'));
  // Convictions accrue here. Only ids that name a real opinion count, same
  // defensive posture as everything else a model hands back.
  const known = new Set(heldOpinions.map(o => o.id));
  for (const id of (result.reaffirmed ?? []).map(Number)) {
    if (known.has(id)) attempt('reaffirm', () => addOpinion(heldOpinions.find(o => o.id === id).claim));
  }
  for (const id of (result.defended ?? []).map(Number)) {
    if (known.has(id)) attempt('defend', () => testOpinion(id));
  }
  // Something she wants to go and find out on her own time. This is where a
  // life of her own most often starts: not from a dream, from a conversation
  // that left her wondering.
  if (result.curious_about?.topic) {
    attempt('pursuit', async () => {
      const id = await startPursuit({
        topic: result.curious_about.topic, why: result.curious_about.why ?? null,
        salience: 0.55, source: 'conversation',
      });
      if (id) console.log(`[capture] curious about "${result.curious_about.topic}" → pursuit #${id}`);
    });
  }
  if (result.mood && result.mood_changed) {
    attempt('mood', () => db.prepare('INSERT INTO relationship_state (mood, notes) VALUES (?, ?)')
      .run(String(result.mood), null));
  }
  // Only ids that name an actually-open intention count — models freelance
  // ids, and a wrong fulfillment silently kills a real want. (The other half
  // of this now lives in threads.js: answering a thread releases the wants
  // bound to it, so fulfillment no longer depends on one pass noticing.)
  for (const id of (result.fulfilled_intentions ?? []).map(Number)) {
    if (wants.some(w => w.id === id)) attempt('intention', () => fulfillIntention(id));
  }

  db.prepare('UPDATE messages SET captured = 1 WHERE id BETWEEN ? AND ?').run(fresh[0].id, lastId);
  captureAttempts.delete(fresh[0].id);
}
