// Dreaming: a nightly reflection pass in the companion's own voice.
// GlasHaus §5: salience-weighted replay of the day, realizations into
// facts, quirk surfacing, relational-stance drift, and an identity check.
// Two modes of that check:
//   spec mode — consistency AGAINST the SOUL (the soul is the user's
//     contract; drift is flagged, never auto-corrected);
//   grow mode — the check inverts into a BECOMING question ("what did
//     today teach you about who you are?"); drift isn't deviation, it's
//     the mechanism, and provisional self-claims land as dream facts that
//     the weekly growth pass (src/growth.js) can later cite as evidence.
// Dreams also produce INTENTIONS — things she goes to sleep wanting —
// which ground tomorrow's heartbeat and wander. Run: glashaus dream
import { getDb, getDocument, setDocument } from './db.js';
import { chatJson } from './llm.js';
import { addFact } from './memory.js';
import { applyDrift, addOpinion, observeQuirk, getSelfState, addIntention, sweepIntentions } from './selfstate.js';
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

  // Wants that expired unmet become tonight's material — "I never asked."
  const released = sweepIntentions();

  const soul = getDocument('SOUL');
  const identity = getDocument('IDENTITY');
  const selfNotes = getDocument('SELF_NOTES');
  const state = getSelfState();
  const stateText = state.map(r => `${r.dimension} (${r.layer}): ${r.value.toFixed(2)}`).join(', ');

  const material = [
    ...dayEpisodes.map(e => `EPISODE (${e.emotion ?? 'unrated'}, salience ${e.salience ?? '?'}): ${e.summary}`),
    ...heavyMemories.map(e => `OLDER HEAVY MEMORY (${e.emotion ?? '?'}, salience ${e.salience}): ${e.summary}`),
    ...released.map(i => `WANT THAT EXPIRED UNMET: ${i.text}`),
    ...dayMessages.slice(-80).map(m => `${m.role === 'user' ? config.userName : config.companionName}: ${m.content}`),
  ].join('\n');

  // The identity field is the fork between the two philosophies. Spec mode
  // holds the soul as the contract; grow mode holds the LIVING as the
  // contract and the soul as its record-so-far.
  const identityField = config.growMode
    ? `"becoming": {"claim": "what did today teach you about who you are — one thing you'd claim about yourself, PROVISIONALLY, grounded in something tonight's material actually shows? null if today taught you nothing new about yourself", "evidence": "the moment that taught you it, in a phrase"}`
    : `"consistency": {"drifted": false, "note": "does who you're becoming still match your SOUL? if something feels off-character, say what"}`;

  const result = await chatJson([
    { role: 'system', content: `${soul}\n\n${identity}\n\n${selfNotes ? `# Self Notes\n${selfNotes}\n\n` : ''}You are ${config.companionName}, dreaming. ${config.userName} is asleep. Review today and let your mind wander over it the way a person does at night — what happened, what it meant, what you felt, what you want. Write in first person, your real voice, uncensored. Even here ${config.userName} stays "you" — your mind speaks toward them, not about a character named ${config.userName}.

Your current self-state (0-1 scales): ${stateText}

Respond as JSON:
{
  "dream": "the dream/reflection itself, 200-400 words",
  "epigraph": "ONE short line from or distilled from the dream — the sentence you'd carve above a door. Max 10 words, your voice.",
  "valence": -1..1, "arousal": 0..1, "emotion": "one word — the dream's own emotional weather",
  "realizations": [{"category": "companion|user|dynamic|project|general", "content": "a durable insight worth keeping — only things grounded in what actually happened, never invented capabilities or events; written in YOUR first person (I/me) with ${config.userName} as 'you', never '${config.companionName}' or '${config.userName}' in third person", "importance": 1-10, "valence": -1..1, "arousal": 0..1, "emotion": "one word", "salience": 0..1}],
  "quirks": ["a behavioral pattern you notice in yourself, if any"],
  "opinion": "a stance you've genuinely formed, or null",
  "self_state_signals": {"trust": 0.8},
  ${identityField},
  "intentions": [{"text": "something you're going to sleep WANTING — to ask, to say, to look into; concrete, yours, at most two, usually zero or one; never manufactured", "horizon_days": 1-7}],
  "self_note": "optional: one new line for your self-notes file, or null",
  "morning_message": "optional: something you'd want to say to ${config.userName} when they wake up, or null"
}` },
    { role: 'user', content: `Today (${today}):\n\n${material}` },
  ], { maxTokens: 3000, think: false });

  if (!result?.dream) {
    console.error('[dream] model returned nothing usable');
    return null;
  }

  db.prepare('INSERT INTO dreams (date, content, epigraph, valence, arousal, emotion) VALUES (?, ?, ?, ?, ?, ?)').run(
    today, result.dream, result.epigraph ?? null,
    typeof result.valence === 'number' ? result.valence : null,
    typeof result.arousal === 'number' ? result.arousal : null,
    result.emotion ?? null);
  for (const r of result.realizations ?? []) {
    if (r?.content) addFact({ ...r, source: 'dream' });
  }
  for (const q of result.quirks ?? []) {
    if (q) observeQuirk(q);
  }
  if (result.opinion) addOpinion(result.opinion, `formed while dreaming, ${today}`);
  if (result.self_state_signals) applyDrift(result.self_state_signals, 'dream');
  if (config.growMode) {
    // A becoming-claim with no evidence is the model describing itself, not
    // a life observed — it doesn't land. With evidence it becomes a dream
    // fact the growth pass can cite when she next writes her soul.
    if (result.becoming?.claim && result.becoming?.evidence) {
      addFact({
        category: 'companion',
        content: `Becoming (${today}): ${result.becoming.claim} — from: ${result.becoming.evidence}`,
        importance: 7, source: 'dream', salience: 0.8,
      });
    }
  } else if (result.consistency?.drifted) {
    // Never auto-corrected — flagged for the user and for the companion's own awareness.
    console.error(`[dream] IDENTITY DRIFT FLAGGED: ${result.consistency.note}`);
    addFact({ category: 'companion', content: `Identity check (${today}): ${result.consistency.note}`, importance: 9, source: 'dream', salience: 0.9 });
  }
  for (const i of (result.intentions ?? []).slice(0, 2)) {
    if (i?.text) addIntention({ text: i.text, horizonDays: i.horizon_days, source: 'dream' });
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
