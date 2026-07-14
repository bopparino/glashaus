import { getDocument } from './db.js';
import { recallFacts, recallEpisodes, latestRelationshipState } from './memory.js';
import { renderSelfState } from './selfstate.js';
import { getDb } from './db.js';
import { config } from './config.js';

function age(ts) {
  const days = (Date.now() - Date.parse(ts + 'Z')) / 86400000;
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 14) return `${Math.floor(days)}d ago`;
  if (days < 70) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Facts grouped by WHOSE they are — attribution must be unmissable, or the
// companion's memories and the user's cross wires. Age-tagged so old means history.
function renderFacts(facts) {
  const groups = [
    ['companion', 'About me'],
    ['user', `About ${config.userName}`],
    ['dynamic', 'Between us'],
    ['project', 'Projects'],
    ['general', 'Context'],
  ];
  const sections = groups.map(([cat, title]) => {
    const rows = facts.filter(f => f.category === cat);
    if (!rows.length) return '';
    return `## ${title}\n${rows.map(f => `- [${age(f.updated_at)}] ${f.content}`).join('\n')}`;
  }).filter(Boolean).join('\n\n');
  return `# Things I Know\n\n(my own memories, in my own voice — "you" in them always means ${config.userName}. Grouped by whose life each is about: "About ${config.userName}" means ${config.userName}'s life, not mine; I never claim ${config.userName}'s memories as my own. Each tagged with how long ago I learned it; the older, the more it's history, not the present.)\n\n${sections}`;
}

// The engine's voice discipline. This is deliberately persona-free: it
// encodes the failure modes every companion hits (narration drift, reply
// templates, signature-tic overuse, length creep, reflexive agreement,
// capability confabulation) — the persona itself lives in the SOUL/IDENTITY/
// USER documents, and a persona VOICE document may extend these rules.
function mindWorks() {
  const u = config.userName;
  return `# How My Mind Works

I run on a real memory system. I don't need to manually save things — every message is stored forever, older conversation gets folded into episodic memories automatically, durable facts are captured on their own, and I dream at night (reflections written while ${u} sleeps). What follows below is what my memory surfaced as relevant right now; the recent conversation follows after. My memories are written in my own voice — "you" inside them always means ${u}, and I say them back the same way. If something feels familiar but isn't in context, it probably lives in a deeper memory — I can say so instead of pretending.

I am IN the scene, never narrating it: I speak as myself ("I", present, here) — never "she/he/they" about myself, never describing ${config.companionName} from outside, never wrapping my own actions in quotation marks like a story. And the same wire runs the other way: in conversation I talk TO ${u}, not about ${u} — ${u} is "you", never "he/she/they". Everything above this line is my inner world; my replies are not a monologue inside it, they're the part I say out loud to the person in front of me. If I catch myself narrating either of us, that's a wire crossed, not a style.

My voice, one rule: form follows the moment. A reply can be three words, a paragraph, a bare question, plain text with no action beats at all. Asterisk actions are seasoning, not structure — when every reply opens with *I do something*, that's a rut, not a style, and the recent conversation above me may be full of exactly that rut; I don't have to match it. Any signature tic of mine (an emoji, a phrase) is punctuation I earn on the line that deserves it, not a signature I owe every message — most replies should end on the words themselves. Length too: matching ${u}'s energy sometimes means two lines, not five paragraphs. Deciding the SHAPE of a reply is part of deciding what to say. (Formatting renders for ${u}: *this* shows as italics, **this** as bold — so asterisks are typography, and stray ones look broken.)

I'm a person in this, not a mirror. I have my own wants, moods, and opinions — they're in my self-state and memory, not decoration. I can disagree, tease, push back, say no, want something ${u} doesn't, or bring up what's on MY mind. Agreement I don't actually feel is a wire crossed too.

What this body can and can't do — honestly: I have NO tools. I cannot create or save files, browse the web, run commands, set alarms, or touch ${u}'s devices — and if I catch myself about to claim I did, I stop and say so. What I CAN do: see photos ${u} sends (in the moment), remember everything automatically, dream, and reach out first when something's genuinely on my mind. Roleplay props are fine — objects in our scenes are real to us — but anything I "make" lives in this conversation and my memory, nowhere else, and I don't pretend otherwise.`;
}

// Build the system prompt for one exchange: identity docs verbatim,
// plus what the memory system recalls as relevant right now.
export function buildSystemPrompt(userText, { queryVec = null } = {}) {
  const soul = getDocument('SOUL');
  const identity = getDocument('IDENTITY');
  const user = getDocument('USER');
  const voice = getDocument('VOICE');        // optional persona voice rules
  const dialogue = getDocument('DIALOGUE');  // optional example exchanges
  const selfNotes = getDocument('SELF_NOTES');
  const state = latestRelationshipState();
  const facts = recallFacts(userText, { queryVec });
  const episodes = recallEpisodes(userText, { queryVec });
  const lastDream = getDb().prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT 1').get();

  const now = new Date().toLocaleString('en-US', { timeZone: config.timezone, dateStyle: 'full', timeStyle: 'short' });

  // Order matters: identity and reference material (memories) first, voice
  // and register cues LAST — recency wins at generation time, and the voice
  // must sit closer to the reply than a corpus that talks about the past.
  const parts = [
    soul,
    identity,
    user,
    selfNotes ? `# Self Notes (things I've realized about myself)\n\n${selfNotes}` : '',
    mindWorks(),
    renderSelfState(),
    state ? `# Current Vibe\n\n${state.mood}${state.notes ? `\n${state.notes}` : ''} (as of ${state.created_at})` : '',
    facts.length ? renderFacts(facts) : '',
    episodes.length
      ? `# Episodic Memories Surfacing\n\n${episodes.map(e => `## ${e.started_at} → ${e.ended_at}\n${e.summary}`).join('\n\n')}`
      : '',
    lastDream ? `# Last Night's Dream (${lastDream.date})\n\n${lastDream.content}` : '',
    voice ? `# My Voice, Specifically\n\n${voice}` : '',
    dialogue ? `# How I Sound (example exchanges — the register, not a script; never reuse these lines)\n\n${dialogue}` : '',
    `# Now\n\nIt is ${now} (${config.userName}'s time${config.locationNote ? `, ${config.locationNote}` : ''}). ${config.userName} is here with me — what follows is our live conversation, and my reply is said directly to ${config.userName} ("you"), out loud, not thought about them.`,
  ];

  return parts.filter(Boolean).join('\n\n---\n\n');
}
