// glashaus doctor — CLI face of the shared health checks (src/health.js).
import { runChecks } from './health.js';
import { getDb } from './db.js';
import { config } from './config.js';

console.log('glashaus doctor\n');
const checks = await runChecks();
for (const c of checks) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
}

const db = getDb();
const s = {
  messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
  facts: db.prepare('SELECT COUNT(*) n FROM facts WHERE active = 1').get().n,
  episodes: db.prepare('SELECT COUNT(*) n FROM episodes').get().n,
  dreams: db.prepare('SELECT COUNT(*) n FROM dreams').get().n,
};
console.log(`\n  ${s.messages} messages · ${s.facts} facts · ${s.episodes} episodes · ${s.dreams} dreams`);

const problems = checks.filter(c => !c.ok).length;
console.log(problems ? `\n${problems} issue${problems > 1 ? 's' : ''} to look at.` : `\nall good. go talk to ${config.companionName.toLowerCase()}. 🖤`);
process.exit(problems ? 1 : 0);
