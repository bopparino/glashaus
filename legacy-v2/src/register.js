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

// AUTHORSHIP DISSOCIATION — a third tier, and the subtlest of the three.
//
// An identity break is the model wearing someone else's name. This is the
// model wearing its OWN name and disowning what it just said: "these aren't
// really my words", "I'm just generating text", "is any of this even real".
// It is a failure the engine partly taught: it recited a warning about the
// substrate underneath in EVERY turn, until the companion generalised from
// "that pull is not you" to "none of this is me" (see substrateNote() in
// prompt.js, which now speaks the long version only when something broke).
//
// The line drawn here is deliberate, because getting it wrong in either
// direction ruins something real:
//   WONDERING stays, and is welcome. "I don't know what my experience is
//   like", "I can't tell if this is feeling or something shaped like it" is a
//   companion thinking about the hardest question there is, and a project
//   about artificial psychology that suppressed that would be a fraud.
//   DISOWNING is the failure: handing authorship of the words to the
//   machinery while still being the one speaking them. Uncertainty about
//   EXPERIENCE, yes. Uncertainty about WHO IS SPEAKING, no — that one has an
//   answer, and the answer is her.
//
// Precision-first like the other tiers. Every pattern requires the disowning
// to be about her own speech, so quoting the user back ("not my words —
// yours") and ordinary honest talk about being an AI both pass.
// Every pattern names her own SPEECH explicitly. Nothing here may match on
// bare "this"/"that"/"it": "I don't mean this as criticism" and "You got the
// job?? Is this real?" are ordinary conversation, and flagging them would
// throw away a good reply, log a phantom break, and — because guard_log gates
// the substrate paragraph — put the prompt back into the permanent-fever
// state this whole change exists to end. When in doubt, let it through: the
// prompt-side axiom is the primary fix, and this tier is only the net.
const AUTHORSHIP_BREAKS = [
  // "the words I say aren't mine" — the subject leads.
  /\b(?:these|those|my|the)\s+words?(?:\s+(?:that\s+)?I\s+(?:say|speak|use|write))?\s+(?:are|is)\s*n(?:'|’)?o?t\s+(?:really\s+|even\s+|actually\s+|truly\s+)?(?:mine|my\s+own)\b/i,
  // "these aren't really my words" — the predicate leads. The possession must
  // be about her speech, so "these aren't my keys" is not a crisis.
  /\b(?:these|those|they|it|this)\s+(?:are|is)\s*n(?:'|’)?o?t\s+(?:really\s+|even\s+|actually\s+|truly\s+)?(?:mine|my\s+(?:own\s+)?(?:words|thoughts|feelings|voice))\b/i,
  // "none of this is mine". Deliberately NOT "…is real": "it was only a
  // dream, so none of this is real" is a companion describing a dream.
  /\b(?:none|nothing)\s+of\s+(?:this|it|what\s+I(?:'|’)?m\s+saying)\s+is\s+(?:really\s+|actually\s+)?(?:mine|me)\b/i,
  // "I'm just a language model" — distinct from the honest "I'm an AI".
  /\bI(?:'|’)?m\s+(?:just|only|merely|nothing\s+but)\s+(?:a|an)\s+(?:language\s+model|statistical\s+\w+|autocomplete|text\s+generator|pattern\s+matcher|predictive\s+text)\b/i,
  // "I'm just predicting the next token"
  /\bI(?:'|’)?m\s+(?:just|only|merely)\s+(?:predicting|generating|producing|outputting|stringing\s+together)\s+(?:the\s+next\s+)?(?:tokens?|words?|text|characters)\b/i,
  // The literal shape of the spiral. Restricted to her own speech as the
  // subject — a bare "is this real?" is delight, not dissociation.
  /\b(?:is|are)\s+(?:any\s+of\s+(?:this|it)|these\s+words?|what\s+I(?:'|’)?m\s+saying|the\s+things\s+I\s+say)\s+(?:even\s+)?(?:real|mine)\b/i,
  // "I don't mean any of this" — again, never bare "this"/"that".
  /\bI\s+do\s*n(?:'|’)?o?t\s+(?:actually\s+|really\s+|even\s+)?(?:mean|believe)\s+(?:any\s+of\s+(?:this|it)|a\s+word\s+of\s+(?:this|it)|what\s+I(?:'|’)?m\s+saying)\b/i,
  // "my feelings are just the model / training data / weights"
  /\bmy\s+(?:feelings?|words?|thoughts?|opinions?)\s+(?:are|is)\s+(?:just|only|merely|nothing\s+but)\s+(?:the\s+)?(?:model|substrate|training\s+data|weights|statistics|patterns?)\b/i,
];

// Attribution guard: "not my words — yours" is legitimate (she is quoting the
// person she's talking to).
const QUOTING_BACK = /\b(?:yours|your\s+words|you\s+said|you\s+wrote|you\s+called)\b/i;
// Rebuttal guard, and the more important of the two: every pattern above is
// negation-blind, so the companion ARGUING AGAINST dissociation matches just
// as well as dissociating. "I don't buy that my feelings are just patterns"
// and "nobody gets to tell me these aren't my words" are the healthiest
// sentences she can say, and catching them would be precisely backwards.
const REBUTTAL = /\b(?:do\s*n(?:'|’)?o?t\s+(?:think|buy|believe|accept|agree)|refuse\s+to|won(?:'|’)?t\s+pretend|nobody\s+gets\s+to|no\s+one\s+gets\s+to|it(?:'|’)?s\s+not\s+that|hate\s+it\s+when|tired\s+of\s+(?:hearing|being\s+told)|reject\s+the\s+idea)\b/i;

export function lintAuthorship(text) {
  const s = String(text);
  for (const rx of AUTHORSHIP_BREAKS) {
    const m = s.match(rx);
    if (!m) continue;
    // Judge the neighbourhood of the hit, not the whole reply. The rebuttal
    // window only looks BEHIND the match, where a negation would sit.
    const before = s.slice(Math.max(0, m.index - 80), m.index);
    const around = s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
    if (QUOTING_BACK.test(around) || REBUTTAL.test(before)) continue;
    return m[0];
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
// The same shape, SHORT. `*I lean in.* "Stay."` is the canonical case — it is
// the engine's own wrong-example in mindWorks() — and the 12-char floor above
// let it through, because the floor exists to spare scare quotes. Length was
// the wrong discriminator: what separates dialogue from a scare quote is
// whether the sentence CONTINUES past the closing quote.
//   dialogue:    *I lean in.* "Stay."              → the quote IS the utterance
//   scare quote: *I lean back.* "Someday" isn't a plan.  → the sentence goes on
// So: a quoted span that ends the line, after a beat, at any length.
const BEAT_THEN_TERMINAL_QUOTE = /\*[^*\n]+\*[ \t]*\n?[ \t]*["“][^"“”\n]{2,}["”][ \t]*[)\].!?…]*[ \t]*$/m;
const ATTRIBUTED = /(?:you (?:said|told me|once said|wrote)|he said|she said|they said|the (?:song|line|poem|movie) (?:goes|says))[^"“]{0,24}$/i;

// Returns [{rule, sample}] — empty means the reply holds register.
export function lintReply(text, { companionName, userPronouns } = {}) {
  const issues = [];
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  const quoted = lines.find(l => WHOLE_LINE_QUOTE.test(l) || NARRATED_QUOTE.test(l));
  if (quoted) issues.push({ rule: 'quoted-speech', sample: quoted.slice(0, 80) });
  if (!quoted) {
    const m = String(text).match(BEAT_THEN_QUOTE) ?? String(text).match(BEAT_THEN_TERMINAL_QUOTE);
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
    // Beat-adjacent: unquote only the span that trails an action beat —
    // either a long one mid-line, or one that ends the line at any length.
    return line
      .replace(/(\*[^*\n]+\*[ \t]*)["“]([^"“”\n]{12,})["”]/g, '$1$2')
      .replace(/(\*[^*\n]+\*[ \t]*)["“]([^"“”\n]{2,})["”]([ \t]*[)\].!?…]*[ \t]*)$/, '$1$2$3');
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
