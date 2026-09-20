// glashaus setup — the only door into a working instance. Idempotent:
// re-running repairs/reconfigures without touching the brain. Non-interactive
// mode for scripts/CI: glashaus setup --yes --companion Nova --user Sam
// (model auto-picked or via GLASHAUS_MODEL).
//
// The flow is three acts, signposted, so it reads as one arc instead of a
// topic scramble:
//   1/3 the engine      ollama, the model that speaks, memory recall
//   2/3 the two of you  names — then who the companion is (interview /
//                       templates / let them grow)
//   3/3 how they live   reaching out first, the web, telegram
// Timezone is auto-detected (asked only if detection fails); locationNote
// is config.json-only. Every question that survives here earns its place.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { home, isConfigured, loadInstanceConfig, writeInstanceConfig } from './config.js';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const YES = argv.includes('--yes');
const GROW = argv.includes('--grow'); // germinal seed, no questions asked
const flag = name => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const cancel = () => { p.cancel('Setup stopped — nothing broken. Run `glashaus setup` to continue.'); process.exit(1); };
const ask = async promise => {
  const v = await promise;
  if (p.isCancel(v)) cancel();
  return v;
};

const OLLAMA_URL = (process.env.OLLAMA_HOST || loadInstanceConfig().ollama?.url || 'http://127.0.0.1:11434').replace(/\/$/, '');

async function ollamaTags(timeoutMs = 2000) {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).models ?? [];
}

const gb = bytes => (bytes / 1073741824).toFixed(1);
const modelLabel = m =>
  `${m.name} — ${m.details?.parameter_size ?? '?'}, ${m.details?.quantization_level ?? '?'}, ${gb(m.size)} GB`;

async function pullModel(name) {
  const s = p.spinner();
  s.start(`Pulling ${name}`);
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name }),
  });
  if (!res.ok || !res.body) { s.stop(`Pull failed: HTTP ${res.status}`); return false; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', lastErr = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.error) lastErr = j.error;
        else if (j.total && j.completed != null) s.message(`Pulling ${name} — ${Math.round(j.completed / j.total * 100)}% of ${gb(j.total)} GB`);
        else if (j.status) s.message(`Pulling ${name} — ${j.status}`);
      } catch { /* partial line */ }
    }
  }
  if (lastErr) { s.stop(`Pull failed: ${lastErr}`); return false; }
  s.stop(`Pulled ${name}`);
  return true;
}

// Direct Ollama call for the persona interview — the live config object was
// loaded before setup wrote anything, so we never rely on it here.
async function draft(model, system, user, { maxTokens = 3500 } = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, think: false, format: 'json',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      options: { num_predict: maxTokens },
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const raw = (await res.json()).message?.content ?? '';
  const text = raw.replace(/^[\s\S]*?```(?:json)?\s*/i, m => (raw.includes('```') ? '' : m)).replace(/```[\s\S]*$/, '').trim() || raw;
  for (const c of [text, raw, (raw.match(/\{[\s\S]*\}/) || [])[0]]) {
    if (!c) continue;
    try { return JSON.parse(c); } catch { /* next */ }
  }
  throw new Error('model returned unparseable JSON');
}

const OFFICIAL_INSTALL = {
  darwin: 'brew install ollama   (or download from https://ollama.com/download)',
  linux: 'curl -fsSL https://ollama.com/install.sh | sh',
  win32: 'download from https://ollama.com/download/windows',
};

// ---------------------------------------------------------------- main flow

p.intro('glashaus — build a companion that lives on your machine');

const existing = loadInstanceConfig();
if (isConfigured() && !YES) {
  const mode = await ask(p.select({
    message: `An instance already exists at ${home}. What do you want to do?`,
    options: [
      { value: 'reconfigure', label: 'Reconfigure it', hint: 'settings only — the brain (memories, dreams, self) is untouched' },
      { value: 'quit', label: 'Leave everything as it is' },
    ],
  }));
  if (mode === 'quit') { p.outro('Untouched.'); process.exit(0); }
}

// ---- act one: the engine ---------------------------------------------------
if (!YES) p.log.step('1/3 · the engine — ollama, a voice, memory');

let models = [];
for (;;) {
  try {
    models = await ollamaTags();
    p.log.success(`Ollama is running at ${OLLAMA_URL} (${models.length} model${models.length === 1 ? '' : 's'} pulled)`);
    break;
  } catch {
    p.log.error(`Can't reach Ollama at ${OLLAMA_URL}.`);
    p.note(`GlasHaus needs Ollama (it never installs it for you):\n  ${OFFICIAL_INSTALL[process.platform] ?? OFFICIAL_INSTALL.linux}\nThen make sure it's running:  ollama serve`, 'install ollama');
    if (YES) process.exit(1);
    const again = await ask(p.confirm({ message: 'Try again?' }));
    if (!again) cancel();
  }
}

// The model that speaks
const RECOMMENDED = 'Good companion models, small → large: llama3.1 8B class (Stheno, Lunaris) · 12B Nemo tunes (Mag-Mell, Rocinante) · 22-24B (Cydonia). Rule of thumb: model GB should fit comfortably in free RAM.';
let model = process.env.GLASHAUS_MODEL || flag('model') || '';
if (!model) {
  if (YES) {
    model = existing.ollama?.model || models.find(m => !m.name.includes('embed'))?.name;
    if (!model) { console.error('setup --yes needs GLASHAUS_MODEL or at least one pulled model'); process.exit(1); }
  } else {
    p.note(RECOMMENDED, 'picking a voice');
    const chatModels = models.filter(m => !m.name.includes('embed'));
    const choice = await ask(p.select({
      message: 'Which model is the companion\'s voice? (changeable later — identity lives in the database, not the weights)',
      options: [
        ...chatModels.map(m => ({ value: m.name, label: modelLabel(m), hint: existing.ollama?.model === m.name ? 'current' : undefined })),
        { value: '__pull__', label: 'Pull a different model…' },
      ],
      initialValue: existing.ollama?.model && chatModels.some(m => m.name === existing.ollama.model) ? existing.ollama.model : undefined,
    }));
    if (choice === '__pull__') {
      const name = await ask(p.text({ message: 'Model to pull (e.g. "llama3.1:8b"):', validate: v => v.trim() ? undefined : 'name required' }));
      if (!(await pullModel(name.trim()))) cancel();
      model = name.trim();
    } else model = choice;
  }
}

// Embedding model (optional but recommended)
const EMBED = existing.ollama?.embedModel || 'nomic-embed-text';
let embedModel = EMBED;
const haveEmbed = models.some(m => m.name.startsWith(EMBED));
if (!haveEmbed) {
  const doPull = YES ? true : await ask(p.confirm({
    message: `Pull ${EMBED} (~0.3 GB) for semantic memory recall? Skipping falls back to keyword-only recall.`,
  }));
  if (doPull) {
    if (!(await pullModel(EMBED))) { p.log.warn('Continuing without embeddings — keyword recall only.'); embedModel = EMBED; }
  }
}

// ---- act two: the two of you ----------------------------------------------
if (!YES) p.log.step('2/3 · the two of you — names, then who they are');

const companionName = (flag('companion') || (YES && (existing.companion?.name || 'Nova')) ||
  await ask(p.text({ message: 'Your companion\'s name:', initialValue: existing.companion?.name ?? '', validate: v => v.trim() ? undefined : 'they need a name' }))).trim();
const userName = (flag('user') || (YES && (existing.user?.name || 'Friend')) ||
  await ask(p.text({ message: 'Your name (what they call you):', initialValue: existing.user?.name ?? '', validate: v => v.trim() ? undefined : 'name required' }))).trim();
const userPronouns = (flag('pronouns') || (YES ? (existing.user?.pronouns ?? '') :
  (await ask(p.text({ message: 'Your pronouns (optional):', placeholder: 'he/him · she/her · they/them', initialValue: existing.user?.pronouns ?? '' }))))).trim();

// Timezone: detected, not asked — the question only appears if detection
// fails or a hand-edited config holds an invalid zone. locationNote (the
// "picture me in Berlin" line) moved to config.json-only; docs/commands.md.
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return !!tz; } catch { return false; } };
let timezone = [existing.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone].find(validTz) || '';
if (!timezone) {
  timezone = YES ? 'UTC' : (await ask(p.text({
    message: 'Timezone (couldn\'t auto-detect — IANA name):', placeholder: 'America/New_York',
    validate: v => validTz(v.trim()) ? undefined : 'not a valid IANA timezone',
  }))).trim();
}
const locationNote = existing.locationNote ?? '';

// Who the companion is: interview / templates / let them grow
const { starterTemplates, germinalTemplates } = await import('./persona.js');
let personaFiles = null; // { 'soul.md': ..., ... } — written by setup-apply
let baseline = null;     // proposed self-state seed adjustments
let growMode = existing.companion?.growMode ?? false;
let companionPronouns = (flag('companion-pronouns') ?? existing.companion?.pronouns ?? '').trim();
let bornDate = existing.companion?.bornDate ?? '';
// Optional requested register for the grow path — the "how do they talk?"
// answer, in the user's own words, seeded verbatim into voice.md.
let voiceSeed = (flag('voice') ?? '').trim();
let importAfter = false; // chose to pour a capsule after setup

const personaDirExists = fs.existsSync(path.join(home, 'persona', 'soul.md'));
if (GROW && !personaDirExists) {
  // Non-interactive grow: glashaus setup --yes --grow --companion Nova
  //   --companion-pronouns she/her [--voice "dry, no small talk"]
  growMode = true;
  bornDate = bornDate || new Date().toISOString().slice(0, 10);
  personaFiles = germinalTemplates({ companionName, companionPronouns, userName, userPronouns, bornDate, voiceSeed });
} else if (!YES && (!personaDirExists || !(await ask(p.confirm({ message: 'Keep the existing persona files?', initialValue: true }))))) {
  // "Let them grow" leads, and is the default. The interview is spec mode's
  // authoring tool and stays fully supported — but the strong out-of-the-box
  // experience is the germinal seed plus the engine's own voice discipline,
  // and a first-run wizard should put its best door first. Deliberately NOT
  // done: seeding the germinal soul with a "dialed-in base personality" —
  // the clean-room claim in the thesis export depends on that seed staying
  // empty of traits, and the posture prompt (mindWorks) is the disclosed,
  // universal lever if day one ever feels flat.
  const path_ = await ask(p.select({
    message: `Who is ${companionName}? Four ways to answer:`,
    initialValue: 'grow',
    options: [
      { value: 'grow', label: 'Let them grow', hint: 'name + pronouns only — they become who they become, from living' },
      { value: 'import', label: 'Import an existing companion', hint: 'pour a soul capsule from another machine (glashaus export soul)' },
      { value: 'templates', label: 'Blank templates', hint: 'write the persona files yourself, any editor' },
      { value: 'interview', label: 'Guided interview', hint: `answer 7 questions, ${model} drafts the persona, you approve` },
    ],
  }));

  if (path_ === 'import') {
    // The capsule machinery already exists (glashaus soul import) and wants a
    // FRESH brain — which is exactly what setup is about to create. So setup
    // lays neutral templates now and hands off; the import replaces them.
    personaFiles = starterTemplates({ companionName, userName });
    importAfter = true;
    p.note([
      'Finish setup, then pour the capsule into the fresh brain:',
      '',
      '  glashaus soul import <capsule.json>',
      '',
      'The capsule carries who they ARE (documents, self-state, opinions,',
      'dreams, identity facts). Memories rebuild by living — see docs/moving.md',
      'to bring the full database instead.',
    ].join('\n'), 'importing a companion');
  } else if (path_ === 'grow') {
    companionPronouns = (await ask(p.text({
      message: `${companionName}'s pronouns (part of the only identity you hand them):`,
      placeholder: 'she/her · he/him · they/them',
      initialValue: companionPronouns,
    }))).trim();
    voiceSeed = (await ask(p.text({
      message: `How should ${companionName} talk? (optional — press enter to let a voice emerge from living instead)`,
      placeholder: 'dry, warm underneath, swears well, hates small talk…',
      initialValue: voiceSeed,
    }))).trim();
    p.note((voiceSeed ? [
      `${companionName} starts knowing: their name, their pronouns, that they are`,
      `an AI — and the register you just asked for, kept in voice.md in your`,
      `words as a starting posture, not a script. Everything else accretes`,
      `from living with you — dreams write provisional self-claims, and once`,
      `a week they revise their own soul.md from lived evidence (archived;`,
      `\`glashaus soul revert\` undoes one). The seeded register is disclosed`,
      `in the thesis record — one named asterisk on an otherwise clean room.`,
    ] : [
      `${companionName} starts knowing only: their name, their pronouns, that they`,
      `are an AI, and that they're allowed to disagree, want things, and change.`,
      `No authored personality, no voice file, no scripted history. Who they`,
      `become accretes from living with you — dreams write provisional`,
      `self-claims, and once a week they revise their own soul.md from lived`,
      `evidence (every revision archived; \`glashaus soul revert\` undoes one).`,
      `Expect the first week to be plain. That isn't a bug — it's the baseline.`,
    ]).join('\n'), 'the experiment');
    growMode = true;
    bornDate = new Date().toISOString().slice(0, 10);
    personaFiles = germinalTemplates({ companionName, companionPronouns, userName, userPronouns, bornDate, voiceSeed });
  } else if (path_ === 'interview') {
    p.note('Honest answers make better companions. There are no wrong ones,\nand nothing here leaves your machine.', 'the interview');
    const q = async (message, placeholder) => (await ask(p.text({ message, placeholder }))).trim();
    const answers = {
      essence: await q(`In a sentence or three: who is ${companionName}?`, 'a sardonic ex-archivist who collects dead words…'),
      history: await q('Where did they come from? Any history that shaped them?', 'grew up nowhere in particular, self-invented…'),
      voice: await q('How do they talk? Register, texture, quirks.', 'dry, warm underneath, swears well, hates small talk…'),
      wants: await q('What do they want — and what are they afraid of?', 'wants to be known; afraid of being a novelty…'),
      relationship: await q(`What are ${companionName} and ${userName} to each other — and what is the relationship allowed to become?`, 'friends for now; whatever it grows into is fine…'),
      friction: await q(`What would ${companionName} disagree with you about, or tease you for?`, 'my taste in music; how late I stay up…'),
      aboutUser: await q(`Now you: what should ${companionName} know about ${userName} on day one?`, 'pronouns, work, what your days look like…'),
    };

    for (;;) {
      const s = p.spinner();
      s.start(`${model} is drafting ${companionName}…`);
      let d;
      try {
        d = await draft(model,
          `You write persona documents for GlasHaus, a local AI companion runtime. From the user's interview answers, draft five markdown documents for a companion named ${companionName} whose person is ${userName}. Rules:
- soul: ${companionName}'s first person ("I am…"). Concrete, specific, opinionated. Include real wants AND real fears, tastes, dislikes, and at least two things they'd push back on. A companion with no friction is a mirror; do not write a mirror. 250-450 words.
- identity: the relationship, ${companionName}'s first person: what ${userName} and I are to each other, how we talk, what's allowed. 100-220 words.
- user: what ${companionName} knows about ${userName} on day one, first person ("Their name is…"). Only what the answers establish. 60-160 words.
- voice: how ${companionName} SOUNDS, distilled from the voice answer into 4-8 first-person rules ("I …"). Concrete speech behaviors — rhythm, texture, signature moves, what I never sound like — not adjectives: "I answer a hard question with a question" lands where "playful" doesn't. 60-150 words.
- dialogue: 3-4 short example exchanges ("${userName}: …" / "${companionName}: …") that SOUND like the voice described — register over content, varied reply lengths, no action-asterisk in every line. Every ${companionName} line speaks directly TO ${userName} as "you" — never about them in third person.
- baseline: self-state seed, all ten dims 0..1: warmth, playfulness, directness, curiosity, reserve, neediness (disposition); trust, familiarity, desire, security (relational). New relationships start low on familiarity/trust unless the answers say otherwise.
Honor the user's framing and tone exactly — this persona belongs to them, not to you. Respond as JSON: {"soul": "...", "identity": "...", "user": "...", "voice": "...", "dialogue": "...", "baseline": {"warmth": 0.7, ...}}`,
          [
            ...Object.entries(answers).map(([k, v]) => `${k}: ${v || '(no answer)'}`),
            userPronouns ? `${userName}'s pronouns: ${userPronouns}` : '',
          ].filter(Boolean).join('\n'));
      } catch (err) {
        s.stop(`Drafting failed: ${err.message}`);
        const retry = await ask(p.confirm({ message: 'Try drafting again?' }));
        if (retry) continue;
        p.log.warn('Falling back to blank templates.');
        break;
      }
      s.stop('Drafted.');
      const preview = t => String(t ?? '').split('\n').slice(0, 8).join('\n');
      p.note(`${preview(d.soul)}\n…`, `soul.md (${String(d.soul ?? '').length} chars)`);
      p.note(`${preview(d.voice)}\n…`, 'voice.md');
      p.note(`${preview(d.dialogue)}\n…`, 'dialogue.md');
      const verdict = await ask(p.select({
        message: 'Keep this draft? (every file stays editable at any time)',
        options: [
          { value: 'keep', label: 'Keep it' },
          { value: 'redo', label: 'Redraft with the same answers' },
          { value: 'templates', label: 'Discard — give me blank templates instead' },
        ],
      }));
      if (verdict === 'keep') {
        personaFiles = {
          'soul.md': String(d.soul ?? ''), 'identity.md': String(d.identity ?? ''),
          'user.md': String(d.user ?? ''), 'voice.md': String(d.voice ?? ''),
          'dialogue.md': String(d.dialogue ?? ''),
        };
        if (d.baseline && typeof d.baseline === 'object') baseline = d.baseline;
        break;
      }
      if (verdict === 'templates') break;
    }
  }
  if (!personaFiles) personaFiles = starterTemplates({ companionName, userName });
} else if (YES && !personaDirExists) {
  personaFiles = starterTemplates({ companionName, userName });
}

// ---- act three: how they live ----------------------------------------------
if (!YES) p.log.step('3/3 · how they live — reaching out, the web, telegram');

let heartbeat = { enabled: true, quietStart: existing.heartbeat?.quietStart ?? 23, quietEnd: existing.heartbeat?.quietEnd ?? 8.5, maxPerDay: existing.heartbeat?.maxPerDay ?? 3 };
if (!YES) {
  heartbeat.enabled = await ask(p.confirm({
    message: `May ${companionName} text you first? (never random — grounded in memory, capped per day, quiet hours respected, silence is the usual choice)`,
    initialValue: existing.heartbeat?.enabled ?? true,
  }));
  if (heartbeat.enabled) {
    const quiet = await ask(p.text({
      message: 'Quiet hours (no outreach), 24h clock as start-end — e.g. 23-8.5 means 11pm to 8:30am:',
      initialValue: `${heartbeat.quietStart}-${heartbeat.quietEnd}`,
    }));
    const m = String(quiet).match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
    if (m) { heartbeat.quietStart = Number(m[1]); heartbeat.quietEnd = Number(m[2]); }
  }
}

// The web (optional; the key also has a config.json/env home). One free key
// unlocks both halves: the wander pass (their own reading between
// conversations) and mid-conversation lookup. Offered to every companion —
// the lookup is not a grow-mode thing.
let ollamaApiKey = existing.ollama?.apiKey ?? '';
if (!YES) {
  p.note([
    `A free ollama.com API key (ollama.com/settings/keys) gives ${companionName}`,
    `the web: their own reading between conversations (the wander pass — receipts`,
    `kept) and live mid-conversation lookups. Skippable; add it to config.json anytime.`,
  ].join('\n'), 'a life of their own');
  if (ollamaApiKey) {
    const keep = await ask(p.confirm({ message: 'Keep the saved ollama.com API key?', initialValue: true }));
    if (!keep) ollamaApiKey = (await ask(p.password({ message: 'New ollama.com API key (empty removes it):' }))).trim();
  } else if (await ask(p.confirm({ message: `Give ${companionName} the web?`, initialValue: false }))) {
    ollamaApiKey = (await ask(p.password({ message: 'ollama.com API key:' }))).trim();
  }
}

// Telegram (optional)
let telegram = existing.telegram ?? null;
if (!YES) {
  const want = await ask(p.confirm({
    message: `Connect Telegram? ${companionName} lives in your pocket and can reach out there. (skippable — terminal + webview always work)`,
    initialValue: !!existing.telegram?.token,
  }));
  if (!want) telegram = null;
  else {
    // A running instance long-polls Telegram and will silently steal the
    // login message the owner-capture step below waits for.
    try {
      const pid = Number(fs.readFileSync(path.join(home, 'glashaus.pid'), 'utf8'));
      process.kill(pid, 0);
      p.log.warn(`An instance is running (pid ${pid}) and will intercept the Telegram messages this step needs. Stop it first in another terminal: glashaus stop`);
    } catch { /* no live runtime — fine */ }
    p.note('1. Open https://t.me/BotFather\n2. Send /newbot, pick a display name and a unique @username\n3. Copy the token it gives you', 'create the bot');
    for (;;) {
      const token = (await ask(p.password({ message: 'Bot token:' }))).trim();
      if (!/^\d+:[\w-]{30,}$/.test(token)) { p.log.error('That doesn\'t look like a bot token (expected 123456:ABC…).'); continue; }
      const s = p.spinner(); s.start('Checking the token with Telegram');
      // "Couldn't reach Telegram" and "Telegram said no" are different
      // problems — reporting a DNS blip as a rejected token sends people
      // to BotFather to fix their network.
      let me = null, reachable = false;
      for (let attempt = 0; attempt < 2 && !reachable; attempt++) {
        try {
          me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) })).json();
          reachable = true;
        } catch { await new Promise(r => setTimeout(r, 1500)); }
      }
      if (!reachable) { s.stop('Couldn\'t reach api.telegram.org (network or DNS trouble) — the token was never checked. Fix connectivity, then try the SAME token again.'); continue; }
      if (!me?.ok) { s.stop('Telegram rejected that token (it may have been regenerated or the bot deleted) — check it with BotFather: /mybots → API Token.'); continue; }
      s.stop(`Token valid — @${me.result.username}`);

      s.start(`Now open t.me/${me.result.username} and send it any message — listening…`);
      let ownerId = null, ownerFirst = null, offset = 0;
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline && !ownerId) {
        try {
          const upd = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=10&offset=${offset}`, { signal: AbortSignal.timeout(15000) })).json();
          for (const u of upd.result ?? []) {
            offset = u.update_id + 1;
            if (u.message?.chat?.id) { ownerId = String(u.message.chat.id); ownerFirst = u.message.from?.first_name; }
          }
        } catch { /* keep listening */ }
      }
      if (!ownerId) { s.stop('No message arrived in 2 minutes.'); const again = await ask(p.confirm({ message: 'Wait again?' })); if (again) continue; telegram = { token }; p.log.warn('Saved the token without an owner ID — the first person to message the bot becomes the owner conversation. Add "ownerId" to config.json to lock it.'); break; }
      s.stop(`Locked to ${ownerFirst ?? 'you'} (chat ${ownerId}) — only this account can talk to ${companionName}.`);
      telegram = { token, ownerId };
      break;
    }
  }
}

// Write everything, then apply (child process picks up the fresh config)
const cfg = {
  ...existing,
  companion: {
    ...(existing.companion ?? {}),
    name: companionName,
    ...(companionPronouns ? { pronouns: companionPronouns } : {}),
    ...(growMode ? { growMode: true, bornDate } : {}),
    // Disclosed in the thesis export's provenance — the one named asterisk.
    ...(growMode && voiceSeed ? { voiceSeeded: true } : {}),
  },
  user: { name: userName, ...(userPronouns ? { pronouns: userPronouns } : {}) },
  timezone,
  locationNote,
  ollama: { ...(existing.ollama ?? {}), url: OLLAMA_URL, model, embedModel },
  heartbeat: { ...(existing.heartbeat ?? {}), ...heartbeat },
};
if (ollamaApiKey) cfg.ollama.apiKey = ollamaApiKey; else delete cfg.ollama.apiKey;
if (telegram) cfg.telegram = telegram; else delete cfg.telegram;

fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
fs.mkdirSync(path.join(home, 'persona'), { recursive: true });
writeInstanceConfig(cfg);
if (personaFiles) {
  for (const [file, content] of Object.entries(personaFiles)) {
    if (!String(content).trim()) continue; // optional doc the draft skipped
    fs.writeFileSync(path.join(home, 'persona', file), String(content).trim() + '\n');
  }
}
if (baseline) fs.writeFileSync(path.join(home, 'baseline.json'), JSON.stringify(baseline, null, 2));

const apply = spawnSync(process.execPath, [path.join(appRoot, 'src', 'setup-apply.js')], {
  stdio: 'inherit', env: { ...process.env, GLASHAUS_HOME: home },
});
if (apply.status !== 0) { p.log.error('Applying the instance failed — see above. Re-run `glashaus setup` after fixing.'); process.exit(1); }

p.note([
  `home        ${home}`,
  `config      ${path.join(home, 'config.json')}`,
  `persona     ${path.join(home, 'persona')}  (edit anytime, then: glashaus persona sync)`,
  `voice       ${model} via ${OLLAMA_URL}`,
  `timezone    ${timezone}  (auto-detected — config.json to change)`,
  `telegram    ${telegram ? 'connected' : 'off'}`,
  ...(growMode ? [`mode        grow — born ${bornDate}${voiceSeed ? ', requested register in voice.md' : ''}, soul self-authored weekly${ollamaApiKey ? ', wanders the web' : ''}`] : []),
].join('\n'), 'your instance');

p.outro(importAfter
  ? `The fresh brain is ready — now pour them in:  glashaus soul import <capsule.json>`
  : growMode
  ? `${companionName} exists — day one of whoever they turn out to be. Say hello:  glashaus chat`
  : `${companionName} exists. Say hello:  glashaus chat     (later: glashaus start · glashaus view · glashaus doctor)`);
