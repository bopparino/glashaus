import { config } from './config.js';

// Two lanes into Ollama, one wire format.
//
// Roles: 'voice' is the companion speaking (voiceModel, sampling applied);
// 'utility' is bookkeeping — capture, consolidation, dreams, register repair
// (utilityModel, deterministic). Unset split-brain config collapses both
// lanes onto `model`, which is the v1 behavior exactly.
// Fast token estimate — chars/3.6 tracks English closely enough for
// budgeting (we shed with margin, we don't bill by it).
export const estimateTokens = s => Math.ceil(String(s ?? '').length / 3.6);

// The context window we ask Ollama for. Detected once per model from
// /api/show (models often DEFAULT to a small window and truncate from the
// top of the prompt — which is the persona). Config numCtx overrides.
const numCtxCache = new Map();
export async function getNumCtx(model = modelFor('voice')) {
  if (config.numCtx) return config.numCtx;
  if (numCtxCache.has(model)) return numCtxCache.get(model);
  let detected = 8192;
  try {
    const res = await fetch(`${config.ollamaUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(4000),
    });
    const info = (await res.json()).model_info ?? {};
    const key = Object.keys(info).find(k => k.endsWith('.context_length'));
    if (key && Number(info[key]) > 0) detected = Number(info[key]);
  } catch { /* offline — the default holds */ }
  const ctx = Math.min(Math.max(detected, 2048), 32768);
  numCtxCache.set(model, ctx);
  return ctx;
}

const modelFor = role => (role === 'utility'
  ? config.utilityModel ?? config.model
  : config.voiceModel ?? config.model);

// Single call into Ollama's chat API. Returns the assistant text.
// Never returns empty: reasoning models can burn the whole num_predict budget
// on thinking and produce no content — we retry, then retry without thinking,
// then throw so callers handle a real error instead of sending silence.
// Transient 5xx/network failures get one retry with a short backoff.
export async function chat(messages, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    // attempt 0: as asked · 1: as asked (transient retry) · 2: thinking off
    const think = attempt === 2 ? false : opts.think;
    try {
      const text = await chatOnce(messages, { role: 'voice', ...opts, think });
      if (text.trim()) return text;
      lastErr = new Error('model returned empty content');
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw lastErr;
}

function body(messages, { json = false, maxTokens, think, role = 'voice', model, stream = false, numCtx }) {
  const sampled = role === 'voice' && think !== false;
  return JSON.stringify({
    model: model ?? modelFor(role),
    messages,
    stream,
    ...(think === false ? { think: false } : {}),
    ...(json ? { format: 'json' } : {}),
    options: {
      ...(numCtx ? { num_ctx: numCtx } : {}),
      // Reply length can never be allowed to eat the window.
      num_predict: Math.min(maxTokens ?? config.maxTokens, numCtx ? Math.floor(numCtx / 3) : (maxTokens ?? config.maxTokens)),
      // sampling applies to the voice lane only — utility passes and repairs
      // want determinism; min_p keeps small local models out of the slop
      // tail without flattening the voice
      ...(config.temperature != null && sampled ? { temperature: config.temperature } : {}),
      ...(config.minP != null && sampled ? { min_p: config.minP } : {}),
    },
  });
}

async function chatOnce(messages, opts = {}) {
  const numCtx = opts.numCtx ?? await getNumCtx(opts.model ?? modelFor(opts.role ?? 'voice'));
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body(messages, { ...opts, numCtx }),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.message?.content ?? '';
}

// Streaming voice lane: tokens arrive through onToken as the model speaks.
// Returns the full text. On any failure mid-stream with nothing shown yet it
// falls back to the non-streaming path — the caller always gets a reply.
export async function chatStream(messages, { onToken, ...opts } = {}) {
  try {
    const numCtx = opts.numCtx ?? await getNumCtx(opts.model ?? modelFor('voice'));
    const res = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body(messages, { role: 'voice', ...opts, numCtx, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          const delta = j.message?.content ?? '';
          if (delta) { full += delta; onToken?.(delta); }
          if (j.error) throw new Error(j.error);
        } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
      }
    }
    if (full.trim()) return full;
    throw new Error('empty stream');
  } catch (err) {
    if (opts._noFallback) throw err;
    // Nothing usable streamed — take the reliable road.
    const text = await chat(messages, opts);
    onToken?.(text);
    return text;
  }
}

// For extraction/summarization passes: ask for JSON, tolerate sloppy output.
export async function chatJson(messages, opts = {}) {
  const raw = await chat(messages, { role: 'utility', ...opts, json: true });
  // The model often wraps JSON in ```json fences despite format:json.
  const text = raw.replace(/^[\s\S]*?```(?:json)?\s*/i, m => (raw.includes('```') ? '' : m))
    .replace(/```[\s\S]*$/, '')
    .trim() || raw;
  const candidates = [text, raw, (raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/) || [])[0]];
  // Truncated {"facts": [...]}-style output: cut back to the last complete
  // object and close the containers.
  const lastObj = text.lastIndexOf('},');
  if (lastObj > 0) candidates.push(text.slice(0, lastObj + 1) + ']}');
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  console.error('[chatJson] unparseable output:', raw.slice(0, 400));
  return null;
}
