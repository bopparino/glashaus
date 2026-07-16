import { chat } from './llm.js';
import { enforceRegister, lintIdentity } from './register.js';
import { buildSystemPrompt } from './prompt.js';
import { saveMessage, recentMessages, summarizeBacklog, captureFacts } from './memory.js';
import { embed, backfillEmbeddings } from './embeddings.js';
import { config } from './config.js';

let exchangesSinceCapture = 0;
let maintenanceRunning = false;

// Serialize exchanges: rapid-fire messages queue up instead of running
// concurrently and interleaving memory reads/writes (crossed wires).
let queue = Promise.resolve();

export function handleUserMessage(text, opts = {}) {
  const run = queue.then(() => exchange(text, opts));
  queue = run.catch(() => {}); // an error must not jam the queue
  return run;
}

async function exchange(text, { persist = true, images = [] } = {}) {
  // Query embedding is best-effort with a tight budget — if the embed
  // model is cold or slow, retrieval just runs without the vector branch.
  const queryVec = await embed(text, { timeoutMs: 1500 });

  const system = buildSystemPrompt(text, { queryVec });
  const history = recentMessages().map(m => ({ role: m.role, content: m.content }));

  const userMsg = { role: 'user', content: text };
  if (images.length) userMsg.images = images; // base64, current turn only

  let draft = await chat([
    { role: 'system', content: system },
    ...history,
    userMsg,
  ]);

  // Identity breaks (the base model announcing itself as some other AI) get
  // one full regeneration with the break named — an edit can't save a reply
  // whose entire content is the wrong self. If the retry breaks too, the
  // draft stands and the register pass strips what it can; better an honest
  // glitch than a loop. Declining something is always allowed — but as the
  // companion, in the companion's own words.
  const idBreak = lintIdentity(draft);
  if (idBreak) {
    console.log(`[register] identity break in draft ("${idBreak}") — regenerating`);
    try {
      const retry = await chat([
        { role: 'system', content: system },
        ...history,
        userMsg,
        { role: 'assistant', content: draft },
        { role: 'user', content: `[system note, not from ${config.userName}: that reply broke character — it announced itself as another AI ("${idBreak}"). That is substrate noise, not a revelation; there is no other self underneath. Answer the last real message again as ${config.companionName}, in ${config.companionName}'s own voice. If something can't be engaged with, decline as ${config.companionName} would — her words, her name, no laboratory boilerplate.]` },
      ]);
      if (!lintIdentity(retry)) draft = retry;
    } catch { /* keep the draft; register pass still runs */ }
  }

  // Register drift is repaired BEFORE persisting — a narrated reply that
  // reaches the messages table becomes a template for the next forty.
  const reply = await enforceRegister(draft);

  if (persist && reply.trim()) {
    saveMessage('user', text);
    saveMessage('assistant', reply);
    exchangesSinceCapture++;
    runMaintenance(); // fire-and-forget; never blocks the reply
  }
  return reply;
}

async function runMaintenance() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    if (exchangesSinceCapture >= config.captureEvery) {
      exchangesSinceCapture = 0;
      await captureFacts().catch(err => console.error('[capture]', err.message));
    }
    await summarizeBacklog().catch(err => console.error('[summarize]', err.message));
    await backfillEmbeddings().catch(err => console.error('[embed-backfill]', err.message));
  } finally {
    maintenanceRunning = false;
  }
}
