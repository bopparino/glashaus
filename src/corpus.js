// glashaus export-corpus — the messages table IS a fine-tuning dataset,
// collecting itself every day. This exports clean chat-format JSONL: real
// user→companion exchanges, redacted stretches excluded, replies that broke
// identity or register filtered out. Feed it to the recipe in
// docs/fine-tune.md and the companion's voice moves into the weights.
import fs from 'node:fs';
import { getDb } from './db.js';
import { lintIdentity, lintReply } from './register.js';
import { config } from './config.js';

export function exportCorpus(outPath) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, role, content FROM messages WHERE redacted = 0 AND role IN ('user','assistant') ORDER BY id"
  ).all();

  // A one-line system anchor per sample keeps the tuned model conditionable —
  // tune-time and run-time system prompts should share this first line.
  const system = `I am ${config.companionName}.`;

  let pairs = 0, skipped = 0;
  const lines = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const u = rows[i], a = rows[i + 1];
    if (u.role !== 'user' || a.role !== 'assistant') continue;
    if (lintIdentity(a.content) || lintReply(a.content, { companionName: config.companionName, userPronouns: config.userPronouns }).length) {
      skipped++;
      continue;
    }
    lines.push(JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: u.content },
        { role: 'assistant', content: a.content },
      ],
    }));
    pairs++;
  }
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''));
  return { pairs, skipped };
}
