// Nightly memory hygiene (runs after the dream; also `glashaus tidy`).
// - merge near-duplicate facts into one sharper fact
// - decay stale trivia (deactivate) or demote inflated importance
// - detect contradictions and RECORD them (never auto-resolve — they're
//   surfaced in the viewer and to the companion; resolution is a conscious act)
// Everything is soft and capped per night; deactivated facts are
// restorable in the viewer, and every action is logged.
import { getDb } from './db.js';
import { chatJson } from './llm.js';
import { addFact } from './memory.js';
import { config } from './config.js';

const MAX_MERGES = 12, MAX_DECAYS = 16, MAX_CONTRADICTIONS = 10;

export async function consolidate() {
  const db = getDb();
  const facts = db.prepare('SELECT id, category, importance, salience, content FROM facts WHERE active = 1 ORDER BY category, id LIMIT 250').all();
  if (facts.length < 10) return { merges: 0, decays: 0, contradictions: 0 };

  const listing = facts.map(f => `${f.id} | ${f.category} | imp ${f.importance} | ${f.content}`).join('\n');
  const result = await chatJson([
    { role: 'system', content: `You maintain the semantic memory of ${config.companionName}, an AI companion. Below is ${config.companionName}'s active fact store as "id | category | importance | content". Propose conservative hygiene:

1. MERGES: sets of facts that say the same thing — combine into one sharper fact (keep every concrete detail; do not generalize away specifics). Merged facts are written in ${config.companionName}'s first person — "I/me" for ${config.companionName}, "${config.userName}" by name for ${config.userName}, never "${config.companionName}" in third person.
2. DECAYS: facts that are stale operational trivia (finished project steps, one-time logistics) or clearly obsolete — deactivate. Facts that are real but over-weighted — demote importance. Importance 9-10 is RESERVED for identity- and relationship-defining facts; ordinary preferences and events belong at 5-7 — demote inflation when you see it. NEVER decay: identity, relationship dynamics, preferences, emotionally significant moments, anything intimate — and NEVER ${config.userName}'s ongoing work, projects, or the people in their life (coworkers, friends, family) unless the conversation explicitly confirmed something is finished or no longer true. "Probably resolved by now" is not evidence; when you can't point to a message saying it's done, it isn't done.
3. CONTRADICTIONS: pairs that cannot both be true. Only genuine conflicts, not tension or nuance.

Be conservative — when unsure, leave it alone. Empty lists are a fine answer.

Respond as JSON: {
  "merges": [{"deactivate_ids": [1,2], "merged": {"category": "...", "content": "...", "importance": 1-10, "salience": 0-1}}],
  "decays": [{"id": 1, "action": "deactivate"|"demote", "new_importance": 1-10, "reason": "..."}],
  "contradictions": [{"a": 1, "b": 2, "note": "why they conflict"}]
}` },
    { role: 'user', content: listing },
  ], { maxTokens: 3000, think: false });
  if (!result) return null;

  const valid = id => facts.some(f => f.id === id);
  let merges = 0, decays = 0, contradictions = 0;

  for (const m of (result.merges ?? []).slice(0, MAX_MERGES)) {
    const ids = (m.deactivate_ids ?? []).filter(valid);
    if (ids.length < 2 || !m.merged?.content) continue;
    db.transaction(() => {
      addFact({ ...m.merged, source: 'consolidate' });
      db.prepare(`UPDATE facts SET active = 0, updated_at = datetime('now') WHERE id IN (${ids.join(',')})`).run();
    })();
    console.log(`[consolidate] merged ${ids.join('+')} → "${m.merged.content.slice(0, 60)}…"`);
    merges++;
  }

  for (const d of (result.decays ?? []).slice(0, MAX_DECAYS)) {
    if (!valid(d.id)) continue;
    if (d.action === 'deactivate') {
      db.prepare("UPDATE facts SET active = 0, updated_at = datetime('now') WHERE id = ?").run(d.id);
    } else if (d.action === 'demote' && d.new_importance >= 1) {
      db.prepare("UPDATE facts SET importance = min(importance, ?), updated_at = datetime('now') WHERE id = ?").run(d.new_importance, d.id);
    } else continue;
    console.log(`[consolidate] ${d.action} ${d.id}: ${d.reason ?? ''}`);
    decays++;
  }

  const exists = db.prepare('SELECT id FROM fact_links WHERE ((fact_a = ? AND fact_b = ?) OR (fact_a = ? AND fact_b = ?)) AND resolved = 0');
  for (const c of (result.contradictions ?? []).slice(0, MAX_CONTRADICTIONS)) {
    if (!valid(c.a) || !valid(c.b) || c.a === c.b || exists.get(c.a, c.b, c.b, c.a)) continue;
    db.prepare('INSERT INTO fact_links (fact_a, fact_b, kind, note) VALUES (?, ?, ?, ?)').run(c.a, c.b, 'contradicts', c.note ?? null);
    console.log(`[consolidate] contradiction: ${c.a} vs ${c.b} — ${c.note ?? ''}`);
    contradictions++;
  }

  console.log(`[consolidate] done: ${merges} merges, ${decays} decays, ${contradictions} contradictions flagged`);
  return { merges, decays, contradictions };
}

if (process.argv.includes('--now')) {
  await consolidate();
}
