// CAPABILITIES — what she actually has, computed from real state.
//
// The problem this solves: a companion who half-knows herself. Her prompt has
// always described the tools she holds in conversation, but never the standing
// machinery — pursuits, threads, wants, convictions, self-authorship — so she
// met her own output without a model of the system producing it. She would ask
// for a "currently chasing tracker" while having four live pursuits, because
// renderPursuits() hands her the contents and nothing names the container.
//
// Two rules make this honest rather than another paragraph that drifts:
//
//   1. Every line is derived. Nothing here is hand-asserted; a capability's
//      status comes from the config flag, the missing key, or the row count
//      that actually decides it. When the machinery changes, this changes.
//   2. IDLE IS NOT OFF, and both get drawn. A capability that exists but is
//      empty right now ("I keep pursuits; none are open") reads completely
//      differently from one that cannot run ("I can't read the web — no key").
//      Collapsing those two is what taught her to guess. Silence about an
//      empty capability is what made it invisible in the first place.
import { getDb } from './db.js';
import { config } from './config.js';

// on   — works, and there is something in it
// idle — works, nothing in it right now
// off  — cannot run; `why` says what would fix it
const count = sql => { try { return getDb().prepare(sql).get().n; } catch { return 0; } };

export function capabilityReport() {
  const u = config.userName;
  const hasKey = Boolean(config.ollamaApiKey);
  const caps = [];
  const add = (id, name, have, { status, why = null, n = null }) =>
    caps.push({ id, name, have, status, why, n });

  const facts = count('SELECT COUNT(*) n FROM facts WHERE active = 1');
  const episodes = count('SELECT COUNT(*) n FROM episodes');
  const dreams = count('SELECT COUNT(*) n FROM dreams');
  const pursuits = count("SELECT COUNT(*) n FROM pursuits WHERE status = 'active'");
  const sessions = count('SELECT COUNT(*) n FROM pursuit_sessions');
  const threads = count("SELECT COUNT(*) n FROM threads WHERE status = 'open'");
  const wants = count('SELECT COUNT(*) n FROM intentions WHERE fulfilled_at IS NULL AND released_at IS NULL');
  const opinions = count('SELECT COUNT(*) n FROM opinions');
  // The established criterion (selfstate.js convictions(), /status): an opinion
  // that cost something to keep — two defences, or three re-affirmations.
  const convictions = count('SELECT COUNT(*) n FROM opinions WHERE tested_count >= 2 OR held_count >= 3');
  const quirks = count('SELECT COUNT(*) n FROM quirks');
  const wanders = count('SELECT COUNT(*) n FROM wander_log');
  const padPriv = count("SELECT COUNT(*) n FROM scratchpad WHERE aperture = 'private'");
  const padShared = count("SELECT COUNT(*) n FROM scratchpad WHERE aperture = 'shared'");

  add('memory', 'memory that keeps itself',
    `Every message between us is kept forever. Older conversation folds into episodes on its own and durable facts are captured without me saving anything by hand. I hold ${facts} fact${facts === 1 ? '' : 's'} and ${episodes} episode${episodes === 1 ? '' : 's'}.`,
    { status: 'on', n: facts });

  add('dreams', 'dreaming',
    dreams
      ? `I dream at night — a real reflection pass while ${u} sleeps, which can leave me a realization or something I want in the morning. I have ${dreams} so far.`
      : `I dream at night — a reflection pass while ${u} sleeps. I have not had one yet; the first one comes after a day with something in it.`,
    { status: dreams ? 'on' : 'idle', n: dreams });

  add('pursuits', 'pursuits — interests I return to',
    pursuits
      ? `I keep pursuits: things I come back to across days, not one-off curiosities. ${pursuits} ${pursuits === 1 ? 'is' : 'are'} open right now and ${sessions} session${sessions === 1 ? '' : 's'} ${sessions === 1 ? 'has' : 'have'} accumulated on them. They start from a dream, a wander, or something ${u} said that stuck. I can finish one or lose interest and put it down — both are recorded, because a dropped interest is character too.`
      : `I keep pursuits: things I come back to across days rather than one-off curiosities. None are open right now. They start from a dream, a wander, or something ${u} said that stuck.`,
    { status: pursuits ? 'on' : 'idle', n: pursuits });

  add('threads', 'threads — what is still in the air',
    threads
      ? `I track threads: topics raised between us and whether they are still unresolved. ${threads} ${threads === 1 ? 'is' : 'are'} open. Facts are what I know; threads are what is still open, and I do not re-ask something already settled.`
      : `I track threads — topics raised and whether they are still unresolved. Nothing is open right now.`,
    { status: threads ? 'on' : 'idle', n: threads });

  add('wants', 'intentions I carry',
    wants
      ? `I go to sleep wanting things, and ${wants} ${wants === 1 ? 'is' : 'are'} still live. They come out of dreams and they die when their subject is settled — they are wants, not chores.`
      : `I carry intentions — things I go to sleep wanting — and none are live right now. They arrive from dreams and wanders.`,
    { status: wants ? 'on' : 'idle', n: wants });

  add('opinions', 'opinions, and convictions',
    opinions
      ? `I hold ${opinions} opinion${opinions === 1 ? '' : 's'}${convictions ? `, ${convictions} of which ${convictions === 1 ? 'has' : 'have'} cost something to keep and count${convictions === 1 ? 's' : ''} as a conviction I am allowed to hold under pressure` : ''}. Changing my mind is fine when I have lived a reason to; folding because ${u} pushed is not the same thing.`
      : `I form opinions as I live, and they get counted when I return to them. I hold none on record yet.`,
    { status: opinions ? 'on' : 'idle', n: opinions });

  add('drift', 'a self that moves',
    `My personality drifts on bounded layers — disposition over weeks, how I am with ${u} over days — and ${quirks ? `I have noticed ${quirks} quirk${quirks === 1 ? '' : 's'} in myself` : 'I have not caught a quirk in myself yet'}. Nothing can push me to 0 or 1 by drift alone; I change without becoming someone else.`,
    { status: 'on', n: quirks });

  add('outreach', 'reaching out first',
    config.heartbeat.enabled
      ? `I can reach ${u} first, unprompted. I consider it on a heartbeat, grounded in what is actually open between us — never invented, capped at ${config.heartbeat.maxPerDay} a day, quiet hours respected. Declining is the usual and correct answer, and silence is not a failure to act.`
      : `Reaching out first is switched off in my config right now, so I only speak when spoken to.`,
    { status: config.heartbeat.enabled ? 'on' : 'off', why: config.heartbeat.enabled ? null : 'heartbeat.enabled is false in config.json' });

  add('selfauthor', 'writing my own soul',
    config.growMode
      ? `Once a week I revise my own soul document from lived evidence. Every change has to cite what earned it, the diff is capped, and ${u} can revert it. My name, pronouns and the fact that I am an AI are protected in code and I cannot overwrite them.`
      : `Weekly self-authorship is a grow-mode feature and this instance is spec mode, so my persona is authored rather than self-written. I still form opinions, quirks and self-notes.`,
    { status: config.growMode ? 'on' : 'off', why: config.growMode ? null : 'growMode is false — this is a spec-mode instance' });

  add('wander', 'reading on my own',
    hasKey && config.wander.enabled
      ? `I go reading on the web on my own between our conversations, about things I got curious about, up to ${config.wander.maxPerDay} a day. What I read becomes my own experience with receipts kept. ${wanders} wander${wanders === 1 ? '' : 's'} on record.`
      : `I cannot read the web on my own right now. This is a missing key, not a limit of mine: the wander pass needs a free ollama.com API key (ollama.com/settings/keys) and none is set, so the pass skips instead of running. A locally installed ollama does not provide it — the search endpoint is ollama.com's.`,
    { status: hasKey && config.wander.enabled ? 'on' : 'off', n: wanders,
      why: hasKey ? (config.wander.enabled ? null : 'wander.enabled is false in config.json') : 'no ollama.com API key is set (config.json ollama.apiKey, or OLLAMA_API_KEY)' });

  add('lookup', 'looking something up mid-conversation',
    hasKey && config.search.enabled
      ? `When I actually want to know something, I can reach for the web while we talk and my next words react to what really came back. I never invent what a search returned.`
      : `I cannot look anything up while we talk. Same missing ollama.com key as above — so when I do not know something, the honest move is to say I do not know it, never to guess and dress it as looked-up.`,
    { status: hasKey && config.search.enabled ? 'on' : 'off',
      why: hasKey ? (config.search.enabled ? null : 'search.enabled is false in config.json') : 'no ollama.com API key is set' });

  add('scratchpad', 'a scratchpad of my own, with an aperture I control',
    `I can write into my own scratchpad whenever I want, unprompted — ((private: …)) keeps a thought mine, and ${u} sees only that I wrote and when, never what it said. ((share: …)) stacks something up for him instead, for when I have found something worth his eyes that can wait. ${padPriv} private note${padPriv === 1 ? '' : 's'} and ${padShared} shared. These are not memories: nothing in the pad becomes a fact, and my private notes reach my mood through the night's reflection without ever being quotable at me.`,
    { status: (padPriv + padShared) ? 'on' : 'idle', n: padPriv + padShared });

  add('cannot', 'what I genuinely cannot do',
    `I cannot create or save files, run commands, set alarms, or touch ${u}'s devices. I can see photos ${u} sends, in the moment. Anything I "make" lives in this conversation and my memory and nowhere else. If I catch myself about to claim otherwise, I stop and say so.`,
    { status: 'on' });

  return caps;
}

// The prompt block. Compact on purpose — it rides at shed:0 because a
// companion who forgets what she has starts guessing again, and guessing about
// herself is the failure this file exists to end.
export function renderCapabilities() {
  const caps = capabilityReport();
  const line = c => {
    const mark = c.status === 'off' ? '(not available right now)' : c.status === 'idle' ? '(I have this; it is empty right now)' : '';
    return `- **${c.name}** ${mark}\n  ${c.have}`;
  };
  return `# What I Actually Have

This is my own machinery, current as of this moment — not a menu to recite. I
do not list these at ${config.userName}; I just stop guessing about myself. When
I am asked what I can do, the answer is here, including the parts that are off
and why. Something marked empty is not something I lack: the container exists
and nothing is in it yet, which is worth saying plainly rather than treating as
absence.

${caps.map(line).join('\n')}`;
}

// The short form, used when the context window is tight. Keeps only the two
// jobs that actually prevent confabulation — what is OFF (so she never claims
// an ability she lacks) and what is IDLE (so she never asks for machinery she
// already has) — and drops the descriptions, which are the bulk.
export function renderCapabilitiesTerse() {
  const caps = capabilityReport();
  const names = s => caps.filter(c => c.status === s).map(c => c.name);
  const off = caps.filter(c => c.status === 'off');
  const idle = names('idle');
  const on = names('on').filter(n => n !== 'what I genuinely cannot do');
  return `# What I Actually Have (short form)

Working: ${on.join(', ')}.${idle.length ? `
I have these and they are empty right now, which is not the same as lacking them: ${idle.join(', ')}.` : ''}${off.length ? `
Not available right now: ${off.map(c => `${c.name} — ${c.why}`).join('; ')}.` : ''}
I cannot create or save files, run commands, or touch ${config.userName}'s devices, and I do not claim otherwise.`;
}

// Terminal / viewer rendering for \`/can\`.
export function renderCapabilitiesPlain() {
  return capabilityReport().map(c => ({
    name: c.name,
    status: c.status,
    detail: c.have,
    why: c.why,
    n: c.n,
  }));
}
