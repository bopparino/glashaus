// Purge lifecycle test — archive-then-wipe, no Ollama required.
// HOME is pointed at a temp dir so serviceInstalled() can never see (or
// touch) a real machine's LaunchAgents/systemd units.
//   node test/purge.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = path.join(appRoot, 'bin', 'glashaus.js');
const fakeUserHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-fakehome-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-purge-'));
process.env.GLASHAUS_HOME = home;

const purge = (...extra) => spawnSync(process.execPath, [bin, 'purge', ...extra], {
  env: { ...process.env, GLASHAUS_HOME: home, HOME: fakeUserHome },
  encoding: 'utf8',
});

// -- seed an instance with a lived brain ---------------------------------------
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
  companion: { name: 'Nova' }, user: { name: 'Sam' }, timezone: 'UTC',
  ollama: { url: 'http://127.0.0.1:1', model: 'none' },
}), { mode: 0o600 });

const { getDb } = await import('../src/db.js');
const db = getDb();
const { saveMessage, addFact } = await import('../src/memory.js');
saveMessage('user', 'hello there');
saveMessage('assistant', 'hey you');
addFact({ category: 'user', content: 'Sam keeps bees on the roof', importance: 6 });

fs.mkdirSync(path.join(home, 'persona'), { recursive: true });
fs.writeFileSync(path.join(home, 'persona', 'soul.md'), 'I am Nova.\n');
const { syncPersonaFromDisk } = await import('../src/persona.js');
syncPersonaFromDisk();

const virginTrust = db.prepare("SELECT value FROM self_state WHERE dimension = 'trust'").get().value;
db.prepare("UPDATE self_state SET value = 0.87 WHERE dimension = 'warmth'").run(); // disposition: should survive
db.prepare("UPDATE self_state SET value = 0.91 WHERE dimension = 'trust'").run();  // relational: should reset
db.close();

// -- refusals -------------------------------------------------------------------
assert.notEqual(purge('--force', 'WrongName').status, 0, 'wrong --force name refuses');
assert.ok(fs.existsSync(path.join(home, 'data', 'glashaus.sqlite')), 'refusal touches nothing');

// -- default scope: brain dies, body survives ------------------------------------
const r = purge('--force', 'Nova');
assert.equal(r.status, 0, `purge exits clean:\n${r.stdout}\n${r.stderr}`);

const archRoot = `${home}-archive`;
const arch = path.join(archRoot, fs.readdirSync(archRoot)[0]);
for (const f of ['glashaus.sqlite', 'config.json', 'soul.json']) {
  assert.ok(fs.existsSync(path.join(arch, f)), `archive has ${f}`);
}
assert.ok(fs.existsSync(path.join(arch, 'persona', 'soul.md')), 'archive has persona');

const { default: Database } = await import('better-sqlite3');
const fresh = new Database(path.join(home, 'data', 'glashaus.sqlite'), { readonly: true });
assert.equal(fresh.prepare('SELECT COUNT(*) n FROM messages').get().n, 0, 'messages wiped');
assert.equal(fresh.prepare('SELECT COUNT(*) n FROM facts').get().n, 0, 'facts wiped');
assert.equal(fresh.prepare("SELECT content FROM documents WHERE name = 'SOUL'").get().content, 'I am Nova.', 'persona re-synced into fresh brain');
assert.ok(Math.abs(fresh.prepare("SELECT value FROM self_state WHERE dimension = 'warmth'").get().value - 0.87) < 1e-6, 'disposition survived');
assert.ok(Math.abs(fresh.prepare("SELECT value FROM self_state WHERE dimension = 'trust'").get().value - virginTrust) < 1e-6, 'relationship reset to birth value');
fresh.close();
assert.ok(fs.existsSync(path.join(home, 'config.json')), 'config survives in place');
assert.ok(fs.existsSync(path.join(home, 'persona', 'soul.md')), 'persona survives in place');
assert.ok(!fs.existsSync(path.join(home, 'baseline.json')), 'baseline consumed by rebirth');

// -- --all: emptied home ----------------------------------------------------------
const r2 = purge('--all', '--force', 'Nova');
assert.equal(r2.status, 0, `purge --all exits clean:\n${r2.stdout}\n${r2.stderr}`);
assert.ok(!fs.existsSync(home), 'home emptied');
assert.equal(fs.readdirSync(archRoot).length, 2, 'second archive written');

fs.rmSync(archRoot, { recursive: true, force: true });
fs.rmSync(fakeUserHome, { recursive: true, force: true });
console.log('purge ✓ — archived, wiped, reborn with soul and disposition intact');
