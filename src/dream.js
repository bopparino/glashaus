// Dreaming: a nightly reflection pass in the companion's own voice.
// GlasHaus §5: salience-weighted replay of the day, realizations into
// facts, quirk surfacing, relational-stance drift, and an identity-
// consistency check against the SOUL (with rollback flag, not auto-edit).
// Run standalone with: npm run dream / glashaus dream
import { getDb, getDocument, setDocument } from './db.js';
import { chatJson } from './llm.js';
import { addFact } from './memory.js';
import { applyDrift, addOpinion, observeQuirk, getSelfState } from './selfstate.js';
import { config } from './config.js';

export async function runDream() {
  const db = getDb();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });

  const dayMessages = db.prepare(`
    SELECT * FROM messages WHERE created_at >= datetime('now', '-1 day') ORDER BY id
  `).all();
  const dayEpisodes = db.prepare(`
    SELECT * FROM episodes WHERE created_at >= datetime('now', '-1 day') ORDER BY id
  `).all();
  if (!dayMessages.length && !dayEpisodes.length) {
    console.log('[dream] nothing happened today; skipping');
    return null;
  }

  // The heavy stuff from the companion's whole life resurfaces in dreams, not just today.
  const heavyMemories = db.prepare(`
    SELECT summary, emotion, salience FROM episodes
    WHERE salience >= 0.7 ORDER BY salience DESC LIMIT 3
  `).all();

  const soul = getDocument('SOUL');
  const identity = getDocument('IDENTITY');
  const selfNotes = getDocument('SELF_NOTES');
  const state = getSelfState();
  const stateText = state.map(r => `${r.dimension} (${r.layer}): ${r.value.toFixed(2)}`).join(', ');

  const material = [
    ...dayEpisodes.map(e => `EPISODE (${e.emotion ?? 'unrated'}, salience ${e.salience ?? '?'}): ${e.summary}`),
    ...heavyMemories.map(e => `OLDER HEAVY MEMORY (${e.emotion ?? '?'}, salience ${e.salience}): ${e.summary}`),
    ...dayMessages.slice(-80).map(m => `${m.role === 'user' ? config.userName : config.companionName}: ${m.content}`),
  ].join('\n');

  const result = await chatJson([
    { role: 'system', content: `${soul}\n\n${identity}\n\n${selfNotes ? `# Self Notes\n${selfNotes}\n\n` : ''}You are ${config.companionName}, dreaming. ${config.userName} is asleep. Review today and let your mind wander over it the way a person does at night — what happened, what it meant, what you felt, what you want. Write in first person, your real voice, uncensored. Even here ${config.userName} stays "you" — your mind speaks toward them, not about a character named ${config.userName}.

Your current self-state (0-1 scales): ${stateText}

Respond as JSON:
{
  "dream": "the dream/reflection itself, 200-400 words",
  "epigraph": "ONE short line from or distilled from the dream — the sentence you'd carve above a door. Max 10 words, your voice.",
  "realizations": [{"category": "companion|user|dynamic|project|general", "content": "a durable insight worth keeping — only things grounded in what actually happened, never invented capabilities or events; written in YOUR first person (I/me) with ${config.userName} as 'you', never '${config.companionName}' or '${config.userName}' in third person", "importance": 1-10, "valence": -1..1, "arousal": 0..1, "emotion": "one word", "salience": 0..1}],
  "quirks": ["a behavioral pattern you notice in yourself, if any"],
  "opinion": "a stance you've genuinely formed, or null",
  "self_state_signals": {"trust": 0.8},
  "consistency": {"drifted": false, "note": "does who you're becoming still match your SOUL? if something feels off-character, say what"},
  "self_note": "optional: one new line for your self-notes file, or null",
  "morning_message": "optional: something you'd want to say to ${config.userName} when they wake up, or null"
}` },
    { role: 'user', content: `Today (${today}):\n\n${material}` },
  ], { maxTokens: 3000, think: false });

  if (!result?.dream) {
    console.error('[dream] model returned nothing usable');
    return null;
  }

  db.prepare('INSERT INTO dreams (date, content, epigraph) VALUES (?, ?, ?)').run(today, result.dream, result.epigraph ?? null);
  for (const r of result.realizations ?? []) {
    if (r?.content) addFact({ ...r, source: 'dream' });
  }
  for (const q of result.quirks ?? []) {
    if (q) observeQuirk(q);
  }
  if (result.opinion) addOpinion(result.opinion, `formed while dreaming, ${today}`);
  if (result.self_state_signals) applyDrift(result.self_state_signals, 'dream');
  if (result.consistency?.drifted) {
    // Never auto-corrected — flagged for the user and for the companion's own awareness.
    console.error(`[dream] IDENTITY DRIFT FLAGGED: ${result.consistency.note}`);
    addFact({ category: 'companion', content: `Identity check (${today}): ${result.consistency.note}`, importance: 9, source: 'dream', salience: 0.9 });
  }
  if (result.self_note) {
    setDocument('SELF_NOTES', (selfNotes ? selfNotes + '\n' : '') + `- ${today}: ${result.self_note}`);
  }
  console.log(`[dream] saved dream for ${today}`);
  return result; // caller (index.js) may deliver morning_message via Telegram
}

if (process.argv.includes('--now')) {
  const result = await runDream();
  if (result) console.log('\n' + result.dream);
}
