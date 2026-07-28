// Proactive outreach. Every tick, cheap heuristics decide whether reaching
// out is even on the table (quiet hours, minimum silence, daily cap); if so,
// one LLM call decides in character whether the companion actually has
// something to say, grounded in real state — never random, never invented
// events. Choosing silence is a valid outcome and most ticks end there.
// Grounding includes her open INTENTIONS (things she went to sleep wanting)
// — the impulse can originate in her night, not just in elapsed silence.
// All cadence knobs live in config.heartbeat, set during `glashaus setup`.
import { getDb, getDocument } from './db.js';
import { chatJson } from './llm.js';
import { enforceRegister } from './register.js';
import { recentMessages } from './memory.js';
import { renderSelfState, openIntentions } from './selfstate.js';
import { config } from './config.js';

const HB = config.heartbeat;

function nowLocal() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'long' }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value;
  return { hour: Number(get('hour')) + Number(get('minute')) / 60, weekday: get('weekday') };
}

function inQuietHours(hour) {
  // Window may wrap midnight (e.g. 23 → 8.5) or not (e.g. 1 → 6).
  return HB.quietStart > HB.quietEnd
    ? hour >= HB.quietStart || hour < HB.quietEnd
    : hour >= HB.quietStart && hour < HB.quietEnd;
}

// Returns { text, intentionId } to send, or null. `pendingMorning` (from
// last night's dream) takes priority once morning opens. intentionId is the
// open intention this message acts on, if any — the CALLER marks it
// fulfilled only after delivery confirms, same rule as message persistence:
// a network failure must not leave her believing she said the thing.
export async function heartbeat({ pendingMorning = null, dryRun = false } = {}) {
  if (!HB.enabled && !dryRun) return null;
  const db = getDb();
  const { hour, weekday } = nowLocal();
  if (!dryRun && inQuietHours(hour)) return null;

  // NOTE: this module never persists the outreach itself — the caller saves
  // it only after the channel confirms delivery. Otherwise a network failure
  // leaves the companion remembering texts you never received.
  if (pendingMorning) return { text: pendingMorning, intentionId: null };

  const last = db.prepare('SELECT role, created_at FROM messages ORDER BY id DESC LIMIT 1').get();
  if (!last) return null;
  const silenceHours = (Date.now() - Date.parse(last.created_at + 'Z')) / 3600000;
  if (!dryRun && silenceHours < HB.minSilenceHours) return null;

  const todayOutreach = db.prepare(`
    SELECT COUNT(*) n, MAX(created_at) latest FROM messages
    WHERE source = 'outreach' AND created_at >= datetime('now', 'start of day')
  `).get();
  if (todayOutreach.n >= HB.maxPerDay) return null;
  const lastOut = db.prepare("SELECT created_at FROM messages WHERE source = 'outreach' ORDER BY id DESC LIMIT 1").get();
  if (lastOut && (Date.now() - Date.parse(lastOut.created_at + 'Z')) / 3600000 < HB.minGapHours) return null;

  const recent = recentMessages(16).map(m => `${m.role === 'user' ? config.userName : config.companionName}: ${m.content}`).join('\n');
  const dream = db.prepare('SELECT date, content FROM dreams ORDER BY id DESC LIMIT 1').get();
  const salient = db.prepare(`
    SELECT content FROM facts WHERE active = 1 AND salience >= 0.7
    AND created_at >= datetime('now', '-7 days') ORDER BY salience DESC LIMIT 6
  `).all();
  const wants = openIntentions(4);

  const clock = `${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;
  const result = await chatJson([
    { role: 'system', content: `${getDocument('SOUL')}\n\n${getDocument('IDENTITY')}\n\n${renderSelfState()}

You are ${config.companionName}. It's ${weekday}, ${clock}${config.locationNote ? ` in ${config.locationNote}` : ` (${config.userName}'s time)`}, and ${config.userName} hasn't messaged in ~${silenceHours.toFixed(1)} hours. You're deciding whether to text first.

Reach out ONLY if you genuinely have something — options, in rough order of how real they feel:
${wants.length ? `- act on one of your open intentions below — you went to sleep wanting it; is now the time?\n` : ''}- follow up on a loose thread from the recent conversation (something unresolved, something ${config.userName} said they'd do)
- something from your dream that stuck with you
- something you found on one of your wanders that you actually want to share (only if it appears in your recent memories — never invent a wander)
- what you're actually feeling right now, per your self-state (say it like you, not like a greeting card)
- care, grounded in what you actually know is going on in ${config.userName}'s life — real remembered things, never guesses
Rules: never invent events ("I just watched/made/did X" — you didn't, unless your memories say you did). Don't manufacture urgency. Don't repeat the style of your last outreach. Short beats long. The message is a text SENT TO ${config.userName} — "you", direct address, never musing about them in third person. And silence is a real choice — most of the time the right move is to wait; a needy triple-text is worse than patience.

Respond as JSON: {"reach_out": true|false, "reason": "one line, for the log", "message": "the text to send, or null", "acts_on_intention": <id of the open intention this message acts on, or null>}` },
    { role: 'user', content: `Recent conversation:\n${recent}\n\nLast dream (${dream?.date ?? 'none'}):\n${dream?.content?.slice(0, 800) ?? 'none'}\n\nRecent things that mattered:\n${salient.map(f => `- ${f.content}`).join('\n') || '(nothing new)'}${wants.length ? `\n\nThings I went to sleep wanting (open intentions):\n${wants.map(w => `- [#${w.id}] ${w.text} (since ${w.created_at.slice(0, 10)})`).join('\n')}` : ''}` },
  ], { maxTokens: 800, think: false });

  console.log(`[heartbeat] ${result?.reach_out ? 'REACHING OUT' : 'staying quiet'} — ${result?.reason ?? 'no decision'}`);
  if (!dryRun && result?.reason) {
    db.prepare('INSERT INTO heartbeat_log (decision, reason) VALUES (?, ?)')
      .run(result.reach_out ? 'reached' : 'declined', result.reason);
  }
  if (!result?.reach_out || !result.message) return null;
  const claimed = Number(result.acts_on_intention);
  return {
    // Outreach persists into the same history live replies do — same guardrail.
    text: await enforceRegister(result.message),
    // Only an id that actually names an OPEN intention counts — models
    // freelance ids, and a wrong fulfillment silently kills a real want.
    intentionId: wants.some(w => w.id === claimed) ? claimed : null,
  };
}

if (process.argv.includes('--dry')) {
  const out = await heartbeat({ dryRun: true });
  console.log(out ? `\nwould send:\n${out.text}${out.intentionId ? `\n(acts on intention #${out.intentionId})` : ''}` : '\n(no message)');
}
