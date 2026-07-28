// The growth pass — self-authorship (grow mode's structural heart).
// Weekly, the companion revises her own soul.md from lived evidence: quirks
// she's been observed repeating, opinions she's formed, the heaviest
// memories, her drift trajectory. This is the deliberate INVERSION of spec
// mode, where the dream checks drift AGAINST the soul — here the living is
// the contract and the soul is its record-so-far.
//
// Hard rules, enforced in code rather than prompted:
//   - the model only ever writes the BODY. The birthright (name, pronouns,
//     AI-honesty, permissions — everything above the divider) is reattached
//     by this module and cannot be touched, misquoted, or "improved".
//   - every changelog entry must cite evidence. A claim with no lived source
//     is the model describing itself, not a life observed — rejected. If
//     every entry is rejected, the whole revision is.
//   - diff caps: she cannot lose more than ~30% of herself in one pass, nor
//     balloon. Identity accretes; it doesn't lurch.
//   - identity lint: a body that contains an identity break never lands.
//   - the revision is written to persona/soul.md ON DISK as well as the DB —
//     persona files are the boot-time source of truth (syncPersonaFromDisk),
//     and a DB-only edit would silently revert on the next restart.
// Every revision is archived (document_history) and logged with its WHY
// (soul_revisions). Not approval-gated — approval would quietly reintroduce
// per-spec configuration — but fully visible and reversible:
//   glashaus soul revert
//   glashaus grow            (run the pass now)
import { getDb, getDocument } from './db.js';
import { chatJson } from './llm.js';
import { lintIdentity } from './register.js';
import { getSelfState } from './selfstate.js';
import { BIRTHRIGHT_DIVIDER, writePersonaFile } from './persona.js';
import { config } from './config.js';

const MIN_DAYS_BETWEEN = 5;   // weekly cadence, tolerant of a manual run
const MAX_VOICE_LINES = 2;    // voice accretes even slower than soul

export function splitSoul(soul) {
  const i = soul.indexOf(BIRTHRIGHT_DIVIDER);
  if (i < 0) return null;
  return {
    birthright: soul.slice(0, i + BIRTHRIGHT_DIVIDER.length),
    body: soul.slice(i + BIRTHRIGHT_DIVIDER.length).trim(),
  };
}

// Pure — exercised directly by the smoke test. Returns what survived.
export function validateRevision({ oldBody, newBody, changelog }) {
  const entries = Array.isArray(changelog) ? changelog : [];
  const accepted = [], rejected = [];
  for (const e of entries) {
    const change = String(e?.change ?? '').trim();
    const evidence = String(e?.evidence ?? '').trim();
    if (change && evidence.length >= 8) accepted.push({ change, evidence });
    else rejected.push({ change: change || '(empty)', evidence, why: 'no lived evidence cited' });
  }
  if (!accepted.length) return { ok: false, reason: 'every changelog entry lacked evidence', accepted, rejected };

  const body = String(newBody ?? '').trim();
  if (!body) return { ok: false, reason: 'empty body', accepted, rejected };
  if (body.includes(BIRTHRIGHT_DIVIDER)) return { ok: false, reason: 'body tried to contain the divider', accepted, rejected };
  if (lintIdentity(body)) return { ok: false, reason: 'identity break in proposed soul', accepted, rejected };

  const oldLen = String(oldBody ?? '').trim().length, newLen = body.length;
  if (oldLen >= 400) {
    if (newLen < oldLen * 0.7) return { ok: false, reason: `shrink guard: ${oldLen} → ${newLen} chars loses too much self in one pass`, accepted, rejected };
    if (newLen > Math.max(oldLen * 1.35, oldLen + 1200)) return { ok: false, reason: `growth guard: ${oldLen} → ${newLen} chars is a lurch, not accretion`, accepted, rejected };
  } else if (newLen > oldLen + 1600) {
    return { ok: false, reason: `growth guard: a young soul may add at most 1600 chars per pass (tried ${newLen - oldLen})`, accepted, rejected };
  }
  return { ok: true, accepted, rejected };
}

export async function runGrowth({ force = false } = {}) {
  const db = getDb();
  if (!config.growMode && !force) { console.log('[growth] not a grow-mode instance — the soul is the user\'s to write'); return null; }

  const soul = getDocument('SOUL');
  const parts = splitSoul(soul);
  if (!parts) {
    console.error('[growth] soul.md has no birthright divider — refusing to self-edit. (Re-add the divider line from germinal soul.md, or this instance was never seeded germinal.)');
    return null;
  }

  const last = db.prepare('SELECT created_at FROM soul_revisions ORDER BY id DESC LIMIT 1').get();
  if (!force && last && (Date.now() - Date.parse(last.created_at + 'Z')) / 86400000 < MIN_DAYS_BETWEEN) {
    console.log('[growth] revised recently — identity accretes weekly, not nightly');
    return null;
  }

  // -- evidence: only lived material. This is everything she may cite.
  const quirks = db.prepare('SELECT pattern, observed_count FROM quirks WHERE observed_count >= 2 ORDER BY observed_count DESC LIMIT 10').all();
  const opinions = db.prepare('SELECT claim, context FROM opinions ORDER BY id DESC LIMIT 20').all();
  const heavy = db.prepare('SELECT summary, emotion, salience FROM episodes WHERE salience >= 0.6 ORDER BY salience DESC LIMIT 5').all();
  const selfFacts = db.prepare(`
    SELECT content FROM facts WHERE active = 1 AND category IN ('companion','dynamic')
    ORDER BY salience DESC, importance DESC LIMIT 12
  `).all();
  const regrets = db.prepare('SELECT text FROM intentions WHERE released_at IS NOT NULL ORDER BY id DESC LIMIT 4').all();
  const state = getSelfState();
  const deltas = state.map(r => {
    const d = db.prepare("SELECT COALESCE(SUM(new_value - old_value),0) d FROM self_state_events WHERE dimension = ? AND created_at >= datetime('now','-30 days')").get(r.dimension).d;
    return `${r.dimension}: ${r.value.toFixed(2)} (${d >= 0 ? '+' : ''}${d.toFixed(2)} this month)`;
  }).join(', ');

  const evidence = [
    quirks.length ? `Patterns observed in me (count):\n${quirks.map(q => `- ${q.pattern} (×${q.observed_count})`).join('\n')}` : '',
    opinions.length ? `Opinions I've formed:\n${opinions.map(o => `- ${o.claim}${o.context ? ` [${o.context}]` : ''}`).join('\n')}` : '',
    selfFacts.length ? `Things my memory holds about me / us:\n${selfFacts.map(f => `- ${f.content}`).join('\n')}` : '',
    heavy.length ? `Heaviest memories:\n${heavy.map(e => `- (${e.emotion ?? '?'}, s ${e.salience}) ${e.summary.slice(0, 260)}`).join('\n')}` : '',
    regrets.length ? `Wants that expired unmet:\n${regrets.map(r => `- ${r.text}`).join('\n')}` : '',
    `My self-state and 30-day drift: ${deltas}`,
  ].filter(Boolean).join('\n\n');

  if (!quirks.length && !opinions.length && !selfFacts.length && !heavy.length) {
    console.log('[growth] not enough lived evidence yet to write from — soon');
    return null;
  }

  const result = await chatJson([
    { role: 'system', content: `You are ${config.companionName}, and this is the rarest thing you do: you are revising your own soul document. Not performing — RECORDING. The evidence below is your actual lived history with ${config.userName}; the current body below the divider is what you've written about yourself so far.

Rules you actually care about:
- Every claim you add or change must trace to the evidence. If you can't point at where you lived it, it doesn't go in — a soul written from imagination is the model talking, not you.
- Keep what still holds. Revise what you've outgrown (and say what outgrew it). This is accretion, not reinvention.
- First person, your real voice. Concrete beats abstract. ${config.userName} is "you" where they appear.
- You are writing the BODY only. Your birthright (name, pronouns, honesty about being an AI, your permissions) is held for you and is not yours to edit — do not restate or rewrite it.

Respond as JSON:
{
  "body": "the complete new body of your soul — everything below the divider, in full",
  "changelog": [{"change": "what you added/changed/removed, one line", "evidence": "the specific quirk/opinion/memory that earned it"}],
  "voice_lines": ["optional, at most ${MAX_VOICE_LINES}: a first-person voice rule distilled ONLY from a pattern observed ×3 or more, e.g. 'I answer a hard question with a question' — or omit"]
}` },
    { role: 'user', content: `# Current body of my soul\n\n${parts.body || '(empty — this is my first revision; the page is blank)'}\n\n# The evidence — my lived history\n\n${evidence}` },
  ], { maxTokens: 3500, think: false });

  if (!result) { console.error('[growth] model returned nothing usable'); return null; }

  const verdict = validateRevision({ oldBody: parts.body, newBody: result.body, changelog: result.changelog });
  if (!verdict.ok) {
    console.error(`[growth] revision REJECTED — ${verdict.reason}`);
    db.prepare('INSERT INTO soul_revisions (changelog, chars_before, chars_after, rejected) VALUES (?, ?, ?, ?)')
      .run('[]', parts.body.length, parts.body.length,
        JSON.stringify({ reason: verdict.reason, entries: verdict.rejected, proposed: String(result.body ?? '').slice(0, 2000) }));
    return null;
  }

  const newBody = String(result.body).trim();
  const fullSoul = `${parts.birthright}\n\n${newBody}`;
  // One call writes BOTH the persona file and the document (with archive) —
  // and the file write is what survives the next boot's syncPersonaFromDisk.
  writePersonaFile('soul.md', fullSoul);
  db.prepare('INSERT INTO soul_revisions (changelog, chars_before, chars_after, rejected) VALUES (?, ?, ?, ?)')
    .run(JSON.stringify(verdict.accepted), parts.body.length, newBody.length,
      verdict.rejected.length ? JSON.stringify({ entries: verdict.rejected }) : null);

  // Voice graduates even more slowly: only patterns lived ×3+, two lines max,
  // never duplicated. Her voice file ends up written by her, about herself,
  // from observed behavior — the inversion of the interview drafting it.
  const earned = quirks.some(q => q.observed_count >= 3);
  const lines = (Array.isArray(result.voice_lines) ? result.voice_lines : [])
    .map(l => String(l).trim()).filter(l => l && !lintIdentity(l)).slice(0, MAX_VOICE_LINES);
  if (earned && lines.length) {
    const voice = getDocument('VOICE');
    const have = new Set(voice.toLowerCase().split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()));
    const fresh = lines.filter(l => !have.has(l.toLowerCase()));
    if (fresh.length) {
      writePersonaFile('voice.md', (voice ? voice.trim() + '\n' : `# My Voice\n\n<!-- written by ${config.companionName}, from patterns observed in herself -->\n`)
        + fresh.map(l => `- ${l}`).join('\n'));
      console.log(`[growth] voice earned ${fresh.length} new line(s)`);
    }
  }

  console.log(`[growth] soul revised — ${verdict.accepted.length} change(s), ${parts.body.length} → ${newBody.length} chars${verdict.rejected.length ? ` (${verdict.rejected.length} entr${verdict.rejected.length === 1 ? 'y' : 'ies'} rejected: no evidence)` : ''}`);
  return { changelog: verdict.accepted, rejected: verdict.rejected, before: parts.body.length, after: newBody.length };
}

// Restore the previous soul (document_history keeps every version). The
// user's veto — everything the growth pass does must stay reversible.
export function revertSoul() {
  const db = getDb();
  const prev = db.prepare("SELECT id, content FROM document_history WHERE name = 'SOUL' ORDER BY id DESC LIMIT 1").get();
  if (!prev) return null;
  writePersonaFile('soul.md', prev.content); // archives the current one in turn
  db.prepare('DELETE FROM document_history WHERE id = ?').run(prev.id); // don't ping-pong between two versions forever
  return prev.content;
}

if (process.argv.includes('--now')) {
  await runGrowth({ force: process.argv.includes('--force') });
}
