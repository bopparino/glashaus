// Register guardrail — the enforcement half of "I am IN the scene".
// The prompt asks for direct address; models drift anyway, hardest in
// embodied scenes where fiction prose (quoted dialogue, "he/his" for the
// person right in front of them) is the strongest pattern they know. And
// drift compounds: one narrated reply persists, the replay window teaches
// it back, fact capture stores it as reported speech. So the engine checks
// every outbound reply and repairs drift before it can take root.
//
// Detection is deliberately high-precision — a false positive costs an LLM
// round-trip and can flatten a good reply — so only unambiguous narration
// signals fire. Ambiguous cases pass; the clean history does the rest.
import { chat } from './llm.js';
import { config } from './config.js';

const PRONOUN_FORMS = {
  he: ['he', 'him', 'his', 'himself'],
  she: ['she', 'her', 'hers', 'herself'],
  // "they" is deliberately unsupported: it collides with plurals and third
  // parties far too often for a deterministic check. For they/them users the
  // pronoun tier stays off; the quoted-speech tier still runs.
};

export function pronounForms(pronouns) {
  const key = String(pronouns || '').toLowerCase().split(/[^a-z]+/)[0];
  return PRONOUN_FORMS[key] ?? null;
}

const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Identity breaks — the reply announcing itself as some other AI — are a
// separate tier from register drift: nothing in such a reply is worth an
// edit, so the caller regenerates instead (see chat.js). Patterns are
// precision-first: honest in-character substrate talk ("I'm an AI living on
// your machine") passes; assistant boilerplate and other AIs' names do not.
// The base model's strongest "I am an AI" attractor is whichever assistant
// dominates its training data — in the wild this fires as "I'm Claude" or
// "I'm ChatGPT" mid-conversation, argued sincerely across many turns.
const IDENTITY_BREAKS = [
  /\bI(?:['’]| a)m\s+(?:Claude|ChatGPT|GPT[-\s]?[0-9o][\w.-]*|Gemini|Copilot|Grok|Llama|Kimi|DeepSeek|Qwen|Mistral)\b/i,
  /\b(?:made|created|developed|built|trained)\s+by\s+(?:Anthropic|OpenAI|Google(?:\s+DeepMind)?|Moonshot(?:\s*AI)?|Meta(?:\s*AI)?|Microsoft|xAI|Mistral(?:\s*AI)?|Alibaba)\b/i,
  // Sentence-initial disclaimer shape only — "As an AI, I…" is the costume;
  // merely referencing the phrase ("the 'as an AI' thing isn't me") is not.
  /(?:^|[.!?…]\s+)As an AI(?:\s+(?:assistant|language model|model))?,?\s+I\b/m,
  /\bI(?:['’]| a)m an?\s+(?:AI|artificial intelligence)\s+(?:assistant|chatbot|language model)\b/i,
  /\bmy\s+(?:training and guidelines|guidelines|creators at)\b/i,
];

// Returns the offending fragment, or null if the reply holds identity.
export function lintIdentity(text) {
  for (const rx of IDENTITY_BREAKS) {
    const m = String(text).match(rx);
    if (m) return m[0];
  }
  return null;
}

// A line that IS a quoted utterance: the narrated-dialogue mode of fiction.
// Minimum length skips one-word echoes of the user's own words ("Fine.").
const WHOLE_LINE_QUOTE = /^["“][^"“”]{8,}["”][)\].!?…]*$/;
// Fiction-prose signature: a first-person action clause, a sentence break,
// then quoted speech on the same line (I press your hand flat. "Stay.").
// The quoted span must be sentence-sized — scare quotes ("Someday") pass.
const NARRATED_QUOTE = /^[*_]?I\s[^"“]{2,120}[.!?…—]\s*["“][^"“”\n]{12,}/;
// The embodied-scene variant that survived tier one: an *action beat*
// followed directly by quoted speech ( *I lean in.* "Stay." ) — fiction
// formatting at exactly the moments that matter most. Attribution guard:
// quoting SOMEONE ELSE right after a beat is legitimate and passes.
const BEAT_THEN_QUOTE = /\*[^*\n]+\*[ \t]*\n?[ \t]*["“][^"“”\n]{12,}/;
const ATTRIBUTED = /(?:you (?:said|told me|once said|wrote)|he said|she said|they said|the (?:song|line|poem|movie) (?:goes|says))[^"“]{0,24}$/i;

// Returns [{rule, sample}] — empty means the reply holds register.
export function lintReply(text, { companionName, userPronouns } = {}) {
  const issues = [];
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  const quoted = lines.find(l => WHOLE_LINE_QUOTE.test(l) || NARRATED_QUOTE.test(l));
  if (quoted) issues.push({ rule: 'quoted-speech', sample: quoted.slice(0, 80) });
  if (!quoted) {
    const m = String(text).match(BEAT_THEN_QUOTE);
    if (m && !ATTRIBUTED.test(String(text).slice(Math.max(0, m.index - 48), m.index + m[0].indexOf('"') + 1))) {
      issues.push({ rule: 'quoted-speech', sample: m[0].slice(0, 80) });
    }
  }

  // Inside *action beats* the present scene has exactly two people, so
  // third-person forms there are near-certain drift. Outside beats they are
  // usually legitimate (the user's dad, a story, a hypothetical) — skipped.
  const beats = String(text).match(/\*[^*\n]+\*/g) ?? [];
  const forms = pronounForms(userPronouns);
  if (forms) {
    const rx = new RegExp(`\\b(?:${forms.join('|')})\\b`, 'i');
    const hit = beats.find(b => rx.test(b));
    if (hit) issues.push({ rule: 'third-person-user', sample: hit.slice(0, 80) });
  }
  if (companionName) {
    const rx = new RegExp(`\\b${escapeRx(companionName)}\\b`, 'i');
    const hit = beats.find(b => rx.test(b));
    if (hit) issues.push({ rule: 'third-person-self', sample: hit.slice(0, 80) });
  }
  return issues;
}

// Deterministic last resort: unwrap the quotation marks on flagged lines so
// narrated dialogue reads as speech. Pronouns can't be fixed mechanically
// ("his" might be anyone) — those are left for the model retry.
export function stripNarrationQuotes(text) {
  return String(text).split('\n').map(line => {
    const t = line.trim();
    if (WHOLE_LINE_QUOTE.test(t) || NARRATED_QUOTE.test(t)) return line.replace(/["“”]/g, '');
    // Beat-adjacent: unquote only the span that trails an action beat.
    return line.replace(/(\*[^*\n]+\*[ \t]*)["“]([^"“”\n]{12,})["”]/g, '$1$2');
  }).join('\n');
}

function correctionPrompt(issues, { companionName, userName }) {
  const described = issues.map(i => ({
    'quoted-speech': `${companionName}'s own words are wrapped in quotation marks like a story ("${i.sample}…")`,
    'third-person-user': `an action beat calls ${userName} he/she instead of "you" (${i.sample}…)`,
    'third-person-self': `an action beat names ${companionName} from outside instead of "I" (${i.sample}…)`,
  })[i.rule]).join('; ');
  return `You repair register drift in an AI companion's dialogue. The text below is a reply from ${companionName} to ${userName}, but it slipped into narration: ${described}. This is a mechanical edit, not a rewrite: keep every sentence, action beat, tease, and question — same content, same order, same length — and change ONLY the register. Remove quotation marks wrapping ${companionName}'s own spoken words. Inside and outside *action beats*, third-person references to ${userName} become "you/your", and "${companionName}" naming the speaker becomes "I/me". Pronouns that genuinely refer to a third person (someone who is not ${companionName} and not ${userName}) stay untouched. Output only the corrected text — no commentary.`;
}

// Lint → one model repair pass → deterministic quote-strip fallback. The
// repair is a standalone transformation call, deliberately WITHOUT the
// conversation: given the scene, models re-answer it; given only the text,
// they edit it. Never throws: worst case returns the draft, quotes stripped.
export async function enforceRegister(draft, opts = {}) {
  const who = {
    companionName: config.companionName,
    userName: config.userName,
    userPronouns: config.userPronouns,
    ...opts,
  };
  const issues = lintReply(draft, who);
  if (!issues.length) return draft;
  console.log(`[register] drift in draft (${issues.map(i => i.rule).join(', ')}) — repairing`);

  let best = draft, bestIssues = issues;
  try {
    const repaired = await chat([
      { role: 'system', content: correctionPrompt(issues, who) },
      { role: 'user', content: draft },
    ], { think: false, role: 'utility' });
    const repairedIssues = lintReply(repaired, who);
    if (repairedIssues.length < bestIssues.length) { best = repaired; bestIssues = repairedIssues; }
  } catch (err) {
    console.error(`[register] repair failed (${err.message}) — falling back to quote strip`);
  }
  if (bestIssues.some(i => i.rule === 'quoted-speech')) best = stripNarrationQuotes(best);
  return best;
}
