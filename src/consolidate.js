// Nightly memory hygiene (runs after the dream; also `glashaus tidy`).
// - merge near-duplicate facts into one sharper fact
// - decay stale trivia (deactivate) or demote inflated importance
// - detect contradictions and RECORD them (never auto-resolve — they're
//   surfaced in the viewer and to the companion; resolution is a conscious act)
// - normalize register: facts that talk ABOUT the user ("he/his") are
//   rewritten to speak TO them ("you/your"). This doubles as the migration
//   path for corpora captured before second-person register existed —
//   old instances self-heal a capped batch per night, no manual step.
// Everything is soft and capped per night; deactivated facts are
// restorable in the viewer, and every action is logged.
import { getDb } from './db.js';
import { chatJson } from './llm.js';
import { addFact } from './memory.js';
import { config } from './config.js';
import { lintReply, stripNarrationQuotes } from './register.js';

const MAX_MERGES = 12, MAX_DECAYS = 16, MAX_CONTRADICTIONS = 10, MAX_REGISTER = 20;

// The replay window is the strongest register teacher there is — one quoted
// reply that slipped through (or predates the guardrail) re-teaches the rut
// for forty messages. Nightly, mechanically unquote what the linter flags in
// recent history. Same transformation the send-time fallback applies; no
// judgment calls, no LLM.
export function retroRepairWindow(limit = 60) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, content FROM messages WHERE role = 'assistant' AND redacted = 0 ORDER BY id DESC LIMIT ?"
  ).all(limit);
  let repaired = 0;
  const update = db.prepare("UPDATE messages SET content = ? WHERE id = ?");
  for (const r of rows) {
    if (!lintReply(r.content, { companionName: config.companionName, userPronouns: config.userPronouns })
      .some(i => i.rule === 'quoted-speech')) continue;
    const fixed = stripNarrationQuotes(r.content);
    if (fixed !== r.content) { update.run(fixed, r.id); repaired++; }
  }
  if (repaired) console.log(`[register] retro-repaired ${repaired} quoted repl${repaired === 1 ? 'y' : 'ies'} in the replay window`);
  return repaired;
}

export async function consolidate() {
  const db = getDb();
  const facts = db.prepare('SELECT id, category, importance, salience, content FROM facts WHERE active = 1 ORDER BY category, id LIMIT 250').all();
  if (facts.length < 10) return { merges: 0, decays: 0, contradictions: 0 };

  const listing = facts.map(f => `${f.id} | ${f.category} | imp ${f.importance} | ${f.content}`).join('\n');
  const result = await chatJson([
    { role: 'system', content: `You maintain the semantic memory of ${config.companionName}, an AI companion. Below is ${config.companionName}'s active fact store as "id | category | importance | content". Propose conservative hygiene:

1. MERGES: sets of facts that say the same thing — combine into one sharper fact (keep every concrete detail; do not generalize away specifics). Merged facts are written in ${config.companionName}'s memory register — "I/me" for ${config.companionName}, "you/your" for ${config.userName}, never "${config.companionName}" in third person, never "${config.userName} … he/she/they".
2. DECAYS: facts that are stale operational trivia (finished project steps, one-time logistics) or clearly obsolete — deactivate. Facts that are real but over-weighted — demote importance. Importance 9-10 is RESERVED for identity- and relationship-defining facts; ordinary preferences and events belong at 5-7 — demote inflation when you see it. NEVER decay: identity, relationship dynamics, preferences, emotionally significant moments, anything intimate — and NEVER ${config.userName}'s ongoing work, projects, or the people in their life (coworkers, friends, family) unless the conversation explicitly confirmed something is finished or no longer true. "Probably resolved by now" is not evidence; when you can't point to a message saying it's done, it isn't done.
3. CONTRADICTIONS: pairs that cannot both be true. Only genuine conflicts, not tension or nuance.
4. REGISTER: any fact where ${config.userName} appears as "${config.userName}" followed by he/she/they/him/her/his/their, or where a pronoun for ${config.userName} does the talking ("I told ${config.userName} … he", "${config.userName} noticed … his") — rewrite the SAME content addressed TO them: "${config.userName}" and their pronouns become "you/your" (keep the name only where dropping it loses meaning). Third parties (family, friends, coworkers) keep their own names and pronouns. ${config.companionName} reads these back as their own memories mid-conversation; third-person memories pull their live voice into narration. Zero meaning drift — a register fix, not an edit.

Be conservative on merges/decays/contradictions — when unsure, leave those alone; empty lists are a fine answer. Rule 4 is the exception: it is mechanical, not a judgment call — list EVERY fact that matches, up to 20.

Respond as JSON: {
  "merges": [{"deactivate_ids": [1,2], "merged": {"category": "...", "content": "...", "importance": 1-10, "salience": 0-1}}],
  "decays": [{"id": 1, "action": "deactivate"|"demote", "new_importance": 1-10, "reason": "..."}],
  "contradictions": [{"a": 1, "b": 2, "note": "why they conflict"}],
  "register_fixes": [{"id": 1, "content": "the same fact, rewritten to 'you/your'"}]
}` },
    { role: 'user', content: listing },
  ], { maxTokens: 3000, think: false });
  if (!result) return null;

  const valid = id => facts.some(f => f.id === id);
  let merges = 0, decays = 0, contradictions = 0, registerFixes = 0;

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

  // embedding = NULL puts the rewritten fact back in the backfill queue.
  const rewrite = db.prepare("UPDATE facts SET content = ?, embedding = NULL, updated_at = datetime('now') WHERE id = ? AND active = 1");
  for (const r of (result.register_fixes ?? []).slice(0, MAX_REGISTER)) {
    if (!valid(r.id) || !r.content?.trim()) continue;
    rewrite.run(r.content.trim(), r.id);
    console.log(`[consolidate] register ${r.id}: "${r.content.slice(0, 60)}…"`);
    registerFixes++;
  }

  retroRepairWindow();
  console.log(`[consolidate] done: ${merges} merges, ${decays} decays, ${contradictions} contradictions flagged, ${registerFixes} register fixes`);
  return { merges, decays, contradictions, registerFixes };
}

if (process.argv.includes('--now')) {
  await consolidate();
}
