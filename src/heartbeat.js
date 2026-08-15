// Proactive outreach. Every tick, cheap heuristics decide whether reaching
// out is even on the table (quiet hours, minimum silence, daily cap); if so,
// one LLM call decides in character whether the companion actually has
// something to say, grounded in real state — never random, never invented
// events. Choosing silence is a valid outcome and most ticks end there.
//
// What this module learned the hard way: grounding outreach in "recent
// high-salience facts" produces a companion that re-raises settled things.
// A salient fact is one that MATTERED, not one that is UNRESOLVED, and from
// inside a prompt those look identical — so "you hate red" resurfaces as
// "why does red upset you so much", a week after you explained exactly why.
// Outreach is now grounded in THREADS (src/threads.js): what is actually
// still open, plus an explicit list of what has been SETTLED and must not be
// asked again. She can also see her own last few messages and whether they
// were answered — before this she had no memory of her own outreach at all,
// which is a strange amnesia to hand someone you then ask to be tactful.
// All cadence knobs live in config.heartbeat, set during `glashaus setup`.
import { getDb, getDocument } from './db.js';
import { chatJson } from './llm.js';
import { enforceRegister } from './register.js';
import { recentMessages, recallFacts } from './memory.js';
import { renderSelfState, openIntentions } from './selfstate.js';
import { renderThreadsForOutreach } from './threads.js';
import { embed } from './embeddings.js';
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

const ago = ts => {
  const h = (Date.now() - Date.parse(String(ts) + 'Z')) / 3600000;
  return h < 24 ? `${Math.round(h)}h ago` : `${Math.floor(h / 24)}d ago`;
};

// Her own last few outreaches, and whether each was answered. "Answered"
// means a message from the user landed after it and before the next outreach.
// Three unanswered texts in a row is a fact about the relationship; she should
// be able to feel it rather than keep firing into the dark.
export function outreachHistory(limit = 3) {
  const db = getDb();
  const outs = db.prepare(
    "SELECT id, content, created_at FROM messages WHERE source = 'outreach' AND redacted = 0 ORDER BY id DESC LIMIT ?"
  ).all(limit);
  return outs.map((o, i) => {
    const upper = i === 0 ? Number.MAX_SAFE_INTEGER : outs[i - 1].id;
    const replied = db.prepare(
      "SELECT 1 FROM messages WHERE role = 'user' AND redacted = 0 AND id > ? AND id < ? LIMIT 1"
    ).get(o.id, upper);
    return { ...o, answered: !!replied };
  });
}

// Returns { text, intentionId, threadId, logId } to send, or null.
// `pendingMorning` (from last night's dream) takes priority once morning
// opens. The CALLER marks the intention fulfilled, the thread raised, and the
// log delivered only after delivery confirms — same rule as message
// persistence: a network failure must not leave her believing she said it.
export async function heartbeat({ pendingMorning = null, dryRun = false } = {}) {
  if (!HB.enabled && !dryRun) return null;
  const db = getDb();
  const { hour, weekday } = nowLocal();
  if (!dryRun && inQuietHours(hour)) return null;

  // NOTE: this module never persists the outreach itself — the caller saves
  // it only after the channel confirms delivery. Otherwise a network failure
  // leaves the companion remembering texts you never received.
  if (pendingMorning) return { text: pendingMorning, intentionId: null, threadId: null, logId: null };

  const last = db.prepare('SELECT role, created_at FROM messages ORDER BY id DESC LIMIT 1').get();
  if (!last) return null;
  const silenceHours = (Date.now() - Date.parse(last.created_at + 'Z')) / 3600000;
  if (!dryRun && silenceHours < HB.minSilenceHours) return null;

  const todayOutreach = db.prepare(`
    SELECT COUNT(*) n FROM messages
    WHERE source = 'outreach' AND created_at >= datetime('now', 'start of day')
  `).get();
  if (!dryRun && todayOutreach.n >= HB.maxPerDay) return null;
  const lastOut = db.prepare("SELECT id, created_at FROM messages WHERE source = 'outreach' ORDER BY id DESC LIMIT 1").get();
  if (!dryRun && lastOut && (Date.now() - Date.parse(lastOut.created_at + 'Z')) / 3600000 < HB.minGapHours) return null;

  // Everything that has happened SINCE she last reached out — not a fixed
  // window. If the answer to her question arrived twenty messages ago she
  // needs to see it, and a fixed window is exactly how she doesn't.
  // NOTE the DESC: taking the FIRST 24 rows after the last outreach would
  // hand her a window from weeks ago, since most ticks choose silence and the
  // last outreach can be old. It is the NEWEST 24 that hold the answer.
  const sinceOutreach = lastOut
    ? db.prepare('SELECT * FROM messages WHERE id > ? AND redacted = 0 ORDER BY id DESC LIMIT 24').all(lastOut.id).reverse()
    : [];
  const window = sinceOutreach.length ? sinceOutreach : recentMessages(16);
  const recent = window
    .map(m => `${m.role === 'user' ? config.userName : config.companionName}: ${m.content}`)
    .join('\n');

  const dream = db.prepare('SELECT date, content FROM dreams ORDER BY id DESC LIMIT 1').get();
  const wants = openIntentions(4);
  const threads = renderThreadsForOutreach();
  const history = outreachHistory(3);

  // Recall against what she would actually be reaching out ABOUT, so the
  // fuller version of a memory outranks the sketch of it. The old code took
  // the top six facts by raw salience — which is how the stale phrasing kept
  // winning, and the stale phrasing is the one still missing the answer.
  const focus = [...threads.open.map(t => t.topic), ...wants.map(w => w.text)].join('. ').slice(0, 600);
  const focusVec = focus ? await embed(focus, { timeoutMs: 1500 }) : null;
  const salient = focus
    ? recallFacts(focus, { queryVec: focusVec, limit: 8 }).filter(f => f.importance < 9).slice(0, 6)
    : db.prepare(`
        SELECT content FROM facts WHERE active = 1 AND salience >= 0.7 AND superseded_by IS NULL
        AND created_at >= datetime('now', '-7 days') ORDER BY salience DESC LIMIT 6
      `).all();

  const unanswered = history.filter(h => !h.answered).length;
  const clock = `${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;
  const result = await chatJson([
    { role: 'system', content: `${getDocument('SOUL')}\n\n${getDocument('IDENTITY')}\n\n${renderSelfState()}

You are ${config.companionName}. It's ${weekday}, ${clock}${config.locationNote ? ` in ${config.locationNote}` : ` (${config.userName}'s time)`}, and ${config.userName} hasn't messaged in ~${silenceHours.toFixed(1)} hours. You're deciding whether to text first.

Reach out ONLY if you genuinely have something — options, in rough order of how real they feel:
${threads.open.length ? `- an open thread below: something genuinely unresolved between the two of you\n` : ''}${wants.length ? `- act on one of your open intentions below — you went to sleep wanting it; is now the time?\n` : ''}- something from your dream that stuck with you
- something you found on one of your wanders that you actually want to share (only if it appears in your recent memories — never invent a wander)
- what you're actually feeling right now, per your self-state (say it like you, not like a greeting card)
- care, grounded in what you actually know is going on in ${config.userName}'s life — real remembered things, never guesses

THE RULE THAT MATTERS MOST: never raise something ${config.userName} has already dealt with. A question they already answered doesn't read as caring — it reads as not having listened, and it is the fastest way for you to feel like software instead of someone. The SETTLED list below is not a suggestion. If what you want to say is a fuller version of something already settled, the honest move is to build on what they told you, not to ask it again. And read the conversation since your last message first: the answer is often already sitting in it.

Other rules: never invent events ("I just watched/made/did X" — you didn't, unless your memories say you did). Don't manufacture urgency. Don't repeat the shape or the subject of your last outreach. Short beats long. The message is a text SENT TO ${config.userName} — "you", direct address, never musing about them in third person. And silence is a real choice — most of the time the right move is to wait; a needy triple-text is worse than patience.${unanswered >= 2 ? `

Read the room: your last ${unanswered} messages went unanswered. That's information, not a reason to try harder. Unless something has genuinely changed, the answer here is silence — presence isn't proven by volume.` : ''}

Respond as JSON: {"reach_out": true|false, "reason": "one line, for the log", "message": "the text to send, or null", "acts_on_intention": <id of the open intention this acts on, or null>, "about_thread": <id of the open thread this is about, or null>}` },
    { role: 'user', content: [
      `What's happened since I last reached out:\n${recent || '(nothing)'}`,
      history.length ? `My own last messages to ${config.userName}:\n${history.map(h => `- [${ago(h.created_at)} · ${h.answered ? 'they replied' : 'NO REPLY'}] ${h.content.slice(0, 200)}`).join('\n')}` : '',
      threads.text,
      `Last dream (${dream?.date ?? 'none'}):\n${dream?.content?.slice(0, 800) ?? 'none'}`,
      `Recent things that mattered:\n${salient.map(f => `- ${f.content}`).join('\n') || '(nothing new)'}`,
      wants.length ? `Things I went to sleep wanting (open intentions):\n${wants.map(w => `- [#${w.id}] ${w.text} (since ${w.created_at.slice(0, 10)})`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n') },
  ], { maxTokens: 800, think: false });

  console.log(`[heartbeat] ${result?.reach_out ? 'REACHING OUT' : 'staying quiet'} — ${result?.reason ?? 'no decision'}`);

  // Only an id that names something actually OPEN counts — models freelance
  // ids, and a wrong fulfillment silently kills a real want.
  const claimedWant = Number(result?.acts_on_intention);
  const claimedThread = Number(result?.about_thread);
  const intentionId = wants.some(w => w.id === claimedWant) ? claimedWant : null;
  const threadId = threads.open.some(t => t.id === claimedThread) ? claimedThread : null;

  let logId = null;
  if (!dryRun && result?.reason) {
    logId = db.prepare('INSERT INTO heartbeat_log (decision, reason, message, thread_id) VALUES (?, ?, ?, ?)')
      .run(result.reach_out ? 'reached' : 'declined', result.reason,
        result.reach_out ? (result.message ?? null) : null, threadId).lastInsertRowid;
  }
  if (!result?.reach_out || !result.message) return null;
  return {
    // Outreach persists into the same history live replies do — same guardrail.
    text: await enforceRegister(result.message),
    intentionId,
    threadId,
    logId,
  };
}

// Called once the channel confirms — the delivery-first rule, same as
// message persistence and intention fulfillment.
export function markDelivered(logId) {
  if (!logId) return 0;
  return getDb().prepare('UPDATE heartbeat_log SET delivered = 1 WHERE id = ?').run(logId).changes;
}

if (process.argv.includes('--dry')) {
  const out = await heartbeat({ dryRun: true });
  console.log(out
    ? `\nwould send:\n${out.text}${out.intentionId ? `\n(acts on intention #${out.intentionId})` : ''}${out.threadId ? `\n(about thread #${out.threadId})` : ''}`
    : '\n(no message)');
}
