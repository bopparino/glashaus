import { chat } from './llm.js';
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

  const reply = await chat([
    { role: 'system', content: system },
    ...history,
    userMsg,
  ]);

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
