// glashaus setup — the only door into a working instance. Idempotent:
// re-running repairs/reconfigures without touching the brain. Non-interactive
// mode for scripts/CI: glashaus setup --yes --companion Nova --user Sam
// (model auto-picked or via GLASHAUS_MODEL).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { home, isConfigured, loadInstanceConfig, writeInstanceConfig } from './config.js';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const YES = argv.includes('--yes');
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

// 1 — Ollama
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

// 2 — chat model
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

// 3 — embedding model (optional but recommended)
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

// 4 — identity
const companionName = (flag('companion') || (YES && (existing.companion?.name || 'Nova')) ||
  await ask(p.text({ message: 'Your companion\'s name:', initialValue: existing.companion?.name ?? '', validate: v => v.trim() ? undefined : 'they need a name' }))).trim();
const userName = (flag('user') || (YES && (existing.user?.name || 'Friend')) ||
  await ask(p.text({ message: 'Your name (what they call you):', initialValue: existing.user?.name ?? '', validate: v => v.trim() ? undefined : 'name required' }))).trim();
const tzGuess = existing.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const timezone = YES ? tzGuess :
  (await ask(p.text({ message: 'Timezone:', initialValue: tzGuess }))).trim() || tzGuess;
const locationNote = YES ? (existing.locationNote ?? '') :
  (await ask(p.text({ message: 'Where should they picture you? (optional, e.g. "Berlin", "the Ozarks")', initialValue: existing.locationNote ?? '' }))).trim();

// 5 — persona
const { starterTemplates } = await import('./persona.js');
let personaFiles = null; // { 'soul.md': ..., ... } — written by setup-apply
let baseline = null;     // proposed self-state seed adjustments

const personaDirExists = fs.existsSync(path.join(home, 'persona', 'soul.md'));
if (!YES && (!personaDirExists || !(await ask(p.confirm({ message: 'Keep the existing persona files?', initialValue: true }))))) {
  const path_ = await ask(p.select({
    message: `Who is ${companionName}? Two ways to answer:`,
    options: [
      { value: 'interview', label: 'Guided interview', hint: `answer 7 questions, ${model} drafts the persona, you approve` },
      { value: 'templates', label: 'Blank templates', hint: 'write the persona files yourself, any editor' },
    ],
  }));

  if (path_ === 'interview') {
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
          `You write persona documents for GlasHaus, a local AI companion runtime. From the user's interview answers, draft four markdown documents for a companion named ${companionName} whose person is ${userName}. Rules:
- soul: ${companionName}'s first person ("I am…"). Concrete, specific, opinionated. Include real wants AND real fears, tastes, dislikes, and at least two things they'd push back on. A companion with no friction is a mirror; do not write a mirror. 250-450 words.
- identity: the relationship, ${companionName}'s first person: what ${userName} and I are to each other, how we talk, what's allowed. 100-220 words.
- user: what ${companionName} knows about ${userName} on day one, first person ("Their name is…"). Only what the answers establish. 60-160 words.
- dialogue: 3-4 short example exchanges ("${userName}: …" / "${companionName}: …") that SOUND like the voice described — register over content, varied reply lengths, no action-asterisk in every line. Every ${companionName} line speaks directly TO ${userName} as "you" — never about them in third person.
- baseline: self-state seed, all ten dims 0..1: warmth, playfulness, directness, curiosity, reserve, neediness (disposition); trust, familiarity, desire, security (relational). New relationships start low on familiarity/trust unless the answers say otherwise.
Honor the user's framing and tone exactly — this persona belongs to them, not to you. Respond as JSON: {"soul": "...", "identity": "...", "user": "...", "dialogue": "...", "baseline": {"warmth": 0.7, ...}}`,
          Object.entries(answers).map(([k, v]) => `${k}: ${v || '(no answer)'}`).join('\n'));
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
          'user.md': String(d.user ?? ''), 'dialogue.md': String(d.dialogue ?? ''),
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

// 6 — heartbeat
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

// 7 — telegram (optional)
let telegram = existing.telegram ?? null;
if (!YES) {
  const want = await ask(p.confirm({
    message: `Connect Telegram? ${companionName} lives in your pocket and can reach out there. (skippable — terminal + webview always work)`,
    initialValue: !!existing.telegram?.token,
  }));
  if (!want) telegram = null;
  else {
    p.note('1. Open https://t.me/BotFather\n2. Send /newbot, pick a display name and a unique @username\n3. Copy the token it gives you', 'create the bot');
    for (;;) {
      const token = (await ask(p.password({ message: 'Bot token:' }))).trim();
      if (!/^\d+:[\w-]{30,}$/.test(token)) { p.log.error('That doesn\'t look like a bot token (expected 123456:ABC…).'); continue; }
      const s = p.spinner(); s.start('Checking the token with Telegram');
      let me = null;
      try { me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) })).json(); } catch { /* network */ }
      if (!me?.ok) { s.stop('Telegram rejected that token.'); continue; }
      s.stop(`Token valid — @${me.result.username}`);

      s.start(`Now open t.me/${me.result.username} and send it any message — listening…`);
      let ownerId = null, offset = 0;
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline && !ownerId) {
        try {
          const upd = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=10&offset=${offset}`, { signal: AbortSignal.timeout(15000) })).json();
          for (const u of upd.result ?? []) {
            offset = u.update_id + 1;
            if (u.message?.chat?.id) { ownerId = String(u.message.chat.id); var ownerFirst = u.message.from?.first_name; }
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

// 8 — write everything, then apply (child process picks up the fresh config)
const cfg = {
  ...existing,
  companion: { name: companionName },
  user: { name: userName },
  timezone,
  locationNote,
  ollama: { ...(existing.ollama ?? {}), url: OLLAMA_URL, model, embedModel },
  heartbeat: { ...(existing.heartbeat ?? {}), ...heartbeat },
};
if (telegram) cfg.telegram = telegram; else delete cfg.telegram;

fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
fs.mkdirSync(path.join(home, 'persona'), { recursive: true });
writeInstanceConfig(cfg);
if (personaFiles) {
  for (const [file, content] of Object.entries(personaFiles)) {
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
  `telegram    ${telegram ? 'connected' : 'off'}`,
].join('\n'), 'your instance');

p.outro(`${companionName} exists. Say hello:  glashaus chat     (later: glashaus start · glashaus view · glashaus doctor)`);
