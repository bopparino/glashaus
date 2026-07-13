import { config } from './config.js';
import { getDb } from './db.js';

// Local embeddings via Ollama (nomic-embed-text). Best-effort everywhere:
// if the model is missing or slow, every caller falls back gracefully and
// retrieval still works on its other signals (glashaus vec-branch fallback).

export async function embed(text, { timeoutMs = 3000 } = {}) {
  try {
    const res = await fetch(`${config.ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.embedModel, input: text.slice(0, 8000), keep_alive: '24h' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vec = data.embeddings?.[0];
    return vec ? Buffer.from(new Float32Array(vec).buffer) : null;
  } catch {
    return null;
  }
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const va = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const vb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    na += va[i] * va[i];
    nb += vb[i] * vb[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Fill in embeddings for facts/episodes that don't have one yet.
// Runs in the background maintenance loop; a few rows per pass.
export async function backfillEmbeddings(batch = 20) {
  const db = getDb();
  const rows = [
    ...db.prepare('SELECT id, content AS text, \'facts\' AS tbl FROM facts WHERE embedding IS NULL AND active = 1 LIMIT ?').all(batch),
    ...db.prepare('SELECT id, summary AS text, \'episodes\' AS tbl FROM episodes WHERE embedding IS NULL LIMIT ?').all(batch),
  ];
  let done = 0;
  for (const row of rows) {
    const vec = await embed(row.text, { timeoutMs: 15000 });
    if (!vec) break; // model not available; try again next pass
    db.prepare(`UPDATE ${row.tbl} SET embedding = ? WHERE id = ?`).run(vec, row.id);
    done++;
  }
  return done;
}
