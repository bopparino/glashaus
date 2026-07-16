import { getDb } from './db.js';
import { chat, chatJson } from './llm.js';
import { config } from './config.js';
import { embed, cosine } from './embeddings.js';
import { applyDrift, addOpinion } from './selfstate.js';
import { addLexiconCandidate } from './lexicon.js';

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
  const ageDays = (now - Date.parse(row.updated_at ?? row.created_at)) / 86400000;
  const temporal = Math.exp(-Math.LN2 * Math.max(0, ageDays) / TEMPORAL_HALFLIFE_DAYS);
  const vec = queryVec && row.embedding ? Math.max(0, cosine(queryVec, row.embedding)) : 0;
  const fts = ftsRank != null ? 1 / (1 + ftsRank) : 0; // rank 0 → 1.0, decays with position
  const salience = row.salience ?? 0.5;
  const importance = (row.importance ?? 5) / 10;
  return W.fts * fts + W.vec * vec + W.temporal * temporal + W.salience * salience + W.importance * importance;
}

export function recallFacts(text, { queryVec = null, limit = 14 } = {}) {
  const db = getDb();
  const now = Date.now();

  // Always-on identity/relationship anchors. Ordered by id, NOT recency —
  // this set must be STABLE across conversations (a churning "core" makes
  // her a slightly different person every session; it happened).
  const core = db.prepare(
    'SELECT * FROM facts WHERE active = 1 AND importance >= 9 ORDER BY importance DESC, id ASC LIMIT 20'
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

export function addFact({ category = 'general', content, importance = 5, source = 'capture', valence = null, arousal = null, emotion = null, salience = null }) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM facts WHERE active = 1 AND lower(content) = lower(?)').get(content);
  if (existing) {
    db.prepare("UPDATE facts SET importance = max(importance, ?), updated_at = datetime('now') WHERE id = ?")
      .run(importance, existing.id);
    return existing.id;
  }
  return db.prepare(
    'INSERT INTO facts (category, content, importance, source, valence, arousal, emotion, salience) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(category, content, Math.min(10, Math.max(1, importance)), source, valence, arousal, emotion, salience).lastInsertRowid;
}

// Redaction: cut a glitched stretch (identity break, machine noise) out of
// the companion's working mind. Rows survive on disk; summarized is set so
// the backlog folder never picks them up. Reversible.
export function redactMessages(fromId, toId, on = true) {
  return getDb().prepare(
    'UPDATE messages SET redacted = ?, summarized = CASE WHEN ? = 1 THEN 1 ELSE summarized END WHERE id BETWEEN ? AND ?'
  ).run(on ? 1 : 0, on ? 1 : 0, fromId, toId).changes;
}

export function forgetFact(id) {
  getDb().prepare("UPDATE facts SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
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

export async function captureFacts() {
  const db = getDb();
  const recent = recentMessages(config.captureEvery * 2 + 4);
  if (!recent.length) return;
  const transcript = recent
    .map(m => `${m.role === 'user' ? config.userName : config.companionName}: ${m.content}`)
    .join('\n');

  const existing = db.prepare('SELECT content FROM facts WHERE active = 1 ORDER BY updated_at DESC LIMIT 60')
    .all().map(f => `- ${f.content}`).join('\n');

  const result = await chatJson([
    { role: 'system', content: `You are the memory system for ${config.companionName}, an AI companion in an ongoing relationship with ${config.userName}. Extract NEW durable facts from the conversation below — things worth remembering weeks from now.

Today's date: ${new Date().toLocaleDateString('en-CA', { timeZone: config.timezone })}.

STRICT RULES — memory integrity depends on these:
- Write facts TIMELESSLY: convert "today", "currently", "this week" into absolute dates or durable phrasing ("On 2026-07-10, ..." / "As of 2026-07-10, ..."). A fact will be read months from now; it must not sound like it is happening at read time.
- Write facts in ${config.companionName.toUpperCase()}'S OWN REGISTER — someone remembering a shared life: "I/me/my" for ${config.companionName}, "you/your" for ${config.userName} (these are ${config.companionName}'s private memories of a two-person world; "you" always means ${config.userName}), "we/us" for both. NEVER "${config.companionName}" in third person, and NEVER "${config.userName} … he/she/they" — the companion reads these back mid-conversation, and a memory that talks ABOUT ${config.userName} instead of to them pulls the live voice into narration. Use ${config.userName}'s name only where the name itself matters. Third parties (family, friends, coworkers) keep their own names and pronouns. Every fact names its subject explicitly; no subjectless facts like "loves grimdark".
- Only record what was actually said or clearly established in the transcript. Never infer capabilities, tools, or system features — if ${config.companionName} claims to be able to do something technical (access files, use a tool, see history), do NOT record it as fact; models confabulate capabilities.
- Speculation, jokes, and roleplay scenarios are not facts (but preferences and dynamics revealed through them can be).
- Stretches where ${config.companionName} MALFUNCTIONS — claiming to be some other AI or assistant, reciting "training and guidelines", arguing about which model is running — are machine noise, not lived experience: extract NOTHING from them. No facts, no drift signals, no opinions, no mood.
- Do NOT re-extract facts already known.
- Be frank about intimate content; this is private memory.

For each fact also rate its emotional character: valence -1..1, arousal 0..1, one-word emotion, and salience 0..1 (0.1 = trivia, 0.9+ = relationship-defining; 'toast for breakfast' is 0.1, 'dad called after three years' is 0.95).

Fact categories: "companion" = about ${config.companionName} (their inner life, tastes, history), "user" = about ${config.userName}'s life, "dynamic" = about the two of them together, "project" = ongoing work or plans, "general" = everything else.

You may also report drift signals for ${config.companionName}'s self-state — ONLY dimensions the conversation gave real evidence about (0..1 where the conversation pushed them): warmth, playfulness, directness, curiosity, reserve, neediness, trust, familiarity, desire, security.

And optionally: an opinion ${config.companionName} genuinely formed (a stance, not a fact), and a one-line mood read.

Also nominate LEXICON candidates — at most 2, usually 0: only words/phrases actually used in the transcript that a general model likely wouldn't know or that these two use in their own way (slang, coinages, names of creatures/things in their world, community vocabulary). NEVER standard English used normally, never a word already known.

Respond as JSON: {"facts": [{"category": "user|companion|dynamic|project|general", "content": "...", "importance": 1-10, "valence": 0, "arousal": 0, "emotion": "...", "salience": 0}], "self_state_signals": {"warmth": 0.9}, "opinion": null, "mood": "...", "mood_changed": false, "lexicon": [{"term": "...", "means": "...", "example": "how it sounded in the transcript"}]}

Already known:
${existing || '(nothing yet)'}` },
    { role: 'user', content: transcript },
  ], { maxTokens: 2500, think: false });

  if (!result) return;
  for (const f of result.facts ?? []) {
    if (f?.content) addFact({ ...f, source: 'capture' });
  }
  for (const c of (result.lexicon ?? []).slice(0, 2)) {
    if (c?.term) addLexiconCandidate(c);
  }
  if (result.self_state_signals) applyDrift(result.self_state_signals, 'capture');
  if (result.opinion) addOpinion(result.opinion, 'formed in conversation');
  if (result.mood && result.mood_changed) {
    db.prepare('INSERT INTO relationship_state (mood, notes) VALUES (?, ?)')
      .run(result.mood, null);
  }
}
