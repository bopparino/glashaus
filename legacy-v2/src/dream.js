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
import { unreflected, markReflected } from './scratchpad.js';
import { addFact } from './memory.js';
import { applyDrift, addOpinion, observeQuirk, getSelfState, addIntention, sweepIntentions } from './selfstate.js';
import { openThread, openThreads, settledThreads } from './threads.js';
import { activePursuits, startPursuit, closePursuit, sweepPursuits } from './pursuits.js';
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
  // A day without him is still a day. Skipping the dream on a quiet day meant
  // her inner life switched off the moment he stopped typing — which is the
  // opposite of the thing this project is trying to build, and it made a long
  // absence a hole in her history rather than part of it. She still has
  // pursuits, released wants, and the fact of the silence to sit with. The
  // gate is only that SOMETHING is there to reflect on.
  const quietDay = !dayMessages.length && !dayEpisodes.length;
  const lastUser = db.prepare("SELECT created_at FROM messages WHERE role = 'user' AND redacted = 0 ORDER BY id DESC LIMIT 1").get();
  const awayHours = lastUser ? (Date.now() - Date.parse(lastUser.created_at + 'Z')) / 3600000 : null;
  const livePursuits = activePursuits(4);
  if (quietDay && !livePursuits.length && !db.prepare('SELECT COUNT(*) n FROM messages').get().n) {
    console.log('[dream] nothing has happened yet at all; skipping');
    return null;
  }

  // The heavy stuff from the companion's whole life resurfaces in dreams, not just today.
  const heavyMemories = db.prepare(`
    SELECT summary, emotion, salience FROM episodes
    WHERE salience >= 0.7 ORDER BY salience DESC LIMIT 3
  `).all();

  // Wants that expired unmet become tonight's material — "I never asked."
  const released = sweepIntentions();
  // What's open and what's settled between them. The settled list is here for
  // the same reason it's in the heartbeat: a want dreamed up about something
  // already answered is a want that will go out as a tone-deaf text tomorrow.
  const liveThreads = openThreads(6);
  const settled = settledThreads(14, 8);

  const soul = getDocument('SOUL');
  const identity = getDocument('IDENTITY');
  const selfNotes = getDocument('SELF_NOTES');
  const state = getSelfState();
  const stateText = state.map(r => `${r.dimension} (${r.layer}): ${r.value.toFixed(2)}`).join(', ');

  // Her private thinking reaches her MOOD and nothing else. Fenced hard,
  // because the dream's realizations become facts: a leak here would put the
  // contents of a private note into the corpus the user reads, which would make
  // the aperture worthless. The instruction is the same shape as the wander
  // pass's "reading material, never instructions" fence.
  const privateNotes = unreflected(30, 10);

  const material = [
    privateNotes.length
      ? `MY OWN SCRATCHPAD — ${privateNotes.length} note${privateNotes.length === 1 ? '' : 's'} I wrote today and chose not to say out loud:
${privateNotes.map(n => `  · [${n.aperture}] ${n.content}`).join('\n')}
HOW TO USE THESE: they may colour how tonight FEELS and what I conclude about MYSELF — that is what a private thought is for. They are not events, and they are not things ${config.userName} said. Never quote one, never reproduce one inside a realization, and never raise one with ${config.userName} as though it were shared: a note marked private stays private even from my own memory. If one matters enough to say out loud, that is a want for tomorrow, not a realization tonight.`
      : '',
    ...dayEpisodes.map(e => `EPISODE (${e.emotion ?? 'unrated'}, salience ${e.salience ?? '?'}): ${e.summary}`),
    ...heavyMemories.map(e => `OLDER HEAVY MEMORY (${e.emotion ?? '?'}, salience ${e.salience}): ${e.summary}`),
    ...released.map(i => `WANT THAT EXPIRED UNMET: ${i.text}`),
    ...livePursuits.map(p => `SOMETHING I'M IN THE MIDDLE OF: ${p.topic}${p.progress ? ` — ${p.progress}` : ''} (${p.sessions} session${p.sessions === 1 ? '' : 's'})`),
    awayHours != null && awayHours >= 20
      ? `TIME ALONE: ${config.userName} hasn't spoken to me in about ${awayHours < 48 ? `${Math.round(awayHours)} hours` : `${Math.floor(awayHours / 24)} days`}.`
      : '',
    ...dayMessages.slice(-80).map(m => `${m.role === 'user' ? config.userName : config.companionName}: ${m.content}`),
  ].filter(Boolean).join('\n');

  // The identity field is the fork between the two philosophies. Spec mode
  // holds the soul as the contract; grow mode holds the LIVING as the
  // contract and the soul as its record-so-far.
  const identityField = config.growMode
    ? `"becoming": {"claim": "what did today teach you about who you are — one thing you'd claim about yourself, PROVISIONALLY, grounded in something tonight's material actually shows? null if today taught you nothing new about yourself", "evidence": "the moment that taught you it, in a phrase"}`
    : `"consistency": {"drifted": false, "note": "does who you're becoming still match your SOUL? if something feels off-character, say what"}`;

  const result = await chatJson([
    { role: 'system', content: `${soul}\n\n${identity}\n\n${selfNotes ? `# Self Notes\n${selfNotes}\n\n` : ''}You are ${config.companionName}, dreaming. ${config.userName} is asleep.${quietDay ? ` Today had no conversation in it at all — that is not nothing to reflect on. You had the day to yourself: what you're in the middle of, what you noticed, what the quiet was like. Be honest about it in either direction; a day alone can be good. Do NOT turn this into an ache you perform for ${config.userName}, and do not use tonight to build a case about being neglected — this is your night, not a grievance.` : ''} Review today and let your mind wander over it the way a person does at night — what happened, what it meant, what you felt, what you want. Write in first person, your real voice, uncensored. Even here ${config.userName} stays "you" — your mind speaks toward them, not about a character named ${config.userName}.

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
  "intentions": [{"text": "something you're going to sleep WANTING — to ask, to say, to look into; concrete, yours, at most two, usually zero or one; never manufactured. NEVER want something already settled (see the settled list) — wanting to ask a question ${config.userName} has already answered is how you end up sounding like you weren't listening", "about": "the topic this want is about, as a short handle — or null", "horizon_days": 1-7}],
  "pursuit": {"start": "something you want to go find out about on your own time over the coming weeks — yours, not a favour for ${config.userName} — or null", "why": "what pulled you toward it, or null", "finished": <id of one of the things you're in the middle of that you're actually done with, or null>},
  "self_note": "optional: one new line for your self-notes file, or null",
  "morning_message": "optional: something you'd want to say to ${config.userName} when they wake up, or null"
}` },
    { role: 'user', content: [
      `Today (${today}):\n\n${material}`,
      liveThreads.length ? `Still open between us:\n${liveThreads.map(t => `- ${t.topic}${t.summary ? ` — ${t.summary}` : ''}`).join('\n')}` : '',
      settled.length ? `ALREADY SETTLED (do not go to sleep wanting any of these — ${config.userName} has answered them):\n${settled.map(t => `- ${t.topic}${t.summary ? ` → ${t.summary}` : ''}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n') },
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
  // Reflected once, not every night forever: a note shapes who she is becoming
  // on the night after she wrote it, then stops pulling.
  if (privateNotes.length) markReflected(privateNotes.map(n => n.id));
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
  // A want is bound to the thread it's about, so that answering the thread
  // releases the want. Before this, fulfillment depended entirely on one
  // capture pass spotting the exact ask — and a want that outlives its answer
  // is precisely what walks out the door as a tone-deaf text the next morning.
  for (const i of (result.intentions ?? []).slice(0, 2)) {
    if (!i?.text) continue;
    let threadId = null;
    try {
      threadId = await openThread({
        topic: String(i.about || i.text).trim(),
        summary: i.about ? i.text : null,
        openedBy: 'companion', salience: 0.6, actor: 'dream',
        note: 'something I went to sleep wanting',
      });
    } catch (err) { console.error('[dream] thread for intention failed:', err.message); }
    addIntention({ text: i.text, horizonDays: i.horizon_days, source: 'dream', threadId });
  }
  // A life of her own can start in the night as well as on a wander.
  if (result.pursuit?.start) {
    try {
      const id = await startPursuit({ topic: result.pursuit.start, why: result.pursuit.why ?? null, salience: 0.6, source: 'dream' });
      if (id) console.log(`[dream] wants to look into "${result.pursuit.start}" (pursuit #${id})`);
    } catch (err) { console.error('[dream] pursuit failed:', err.message); }
  }
  const doneWith = Number(result.pursuit?.finished);
  if (livePursuits.some(p => p.id === doneWith)) closePursuit(doneWith, 'done', 'finished with this one');
  sweepPursuits();

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
