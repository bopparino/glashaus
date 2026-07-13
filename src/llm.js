import { config } from './config.js';

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
      const text = await chatOnce(messages, { ...opts, think });
      if (text.trim()) return text;
      lastErr = new Error('model returned empty content');
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw lastErr;
}

async function chatOnce(messages, { json = false, maxTokens, think } = {}) {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      ...(think === false ? { think: false } : {}),
      ...(json ? { format: 'json' } : {}),
      options: {
        num_predict: maxTokens ?? config.maxTokens,
        // sampling applies to conversational replies only, never utility calls
        // (utility passes want determinism; min_p keeps small local models
        // out of the slop tail without flattening the voice)
        ...(config.temperature != null && think !== false ? { temperature: config.temperature } : {}),
        ...(config.minP != null && think !== false ? { min_p: config.minP } : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.message?.content ?? '';
}

// For extraction/summarization passes: ask for JSON, tolerate sloppy output.
export async function chatJson(messages, opts = {}) {
  const raw = await chat(messages, { ...opts, json: true });
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
