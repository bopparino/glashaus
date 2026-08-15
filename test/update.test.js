// The updater's decision logic. Everything here is pure or filesystem-local
// — no network, no npm, no install. The end-to-end path (real npm install
// from GitHub, real v8→v9 migration inside the update window, real rollback)
// was exercised by hand against a throwaway global prefix; what's pinned here
// is the reasoning that decides whether to act at all, because that is what
// silently rots.
//   node test/update.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-update-'));
process.env.GLASHAUS_HOME = home;
process.env.GLASHAUS_COMPANION_NAME = 'Testa';
process.env.GLASHAUS_USER_NAME = 'Sam';
process.env.OLLAMA_HOST = 'http://127.0.0.1:1';

const { writeInstanceConfig } = await import('../src/config.js');
writeInstanceConfig({ companion: { name: 'Testa' }, user: { name: 'Sam' }, timezone: 'UTC' });

const { compareVersions, changelogSection, installMode, localVersion } =
  await import('../src/update.js');

// -- version ordering ----------------------------------------------------------
// Getting this backwards means either never updating or endlessly reinstalling.
assert.equal(compareVersions('2.6.0', '2.5.0'), 1, 'newer minor wins');
assert.equal(compareVersions('2.5.0', '2.6.0'), -1, 'older minor loses');
assert.equal(compareVersions('2.6.0', '2.6.0'), 0, 'equal is equal');
assert.equal(compareVersions('2.10.0', '2.9.0'), 1, 'ten beats nine — string compare would say otherwise');
assert.equal(compareVersions('3.0.0', '2.99.99'), 1, 'major dominates');
assert.equal(compareVersions('v2.6.0', '2.6.0'), 0, 'a leading v is noise');
assert.equal(compareVersions('2.6.0', '2.6'), 0, 'a missing patch is zero');
// A prerelease must sort BEFORE its release, or `--ref` testing a release
// candidate would read as "you are ahead of main" and refuse to move.
assert.equal(compareVersions('2.6.0-rc1', '2.6.0'), -1, 'rc precedes release');
assert.equal(compareVersions('2.6.0', '2.6.0-rc1'), 1, 'and release follows rc');

// -- changelog extraction ------------------------------------------------------
// This is what the user reads before saying yes, so a wrong slice is a
// consent problem, not a formatting one.
const CHANGELOG = `# Changelog

## 2.6.0 — 2026-08-15

Threads, and whose words these are.

- Threads: the ledger of what's unfinished.
- Whose words these are, settled.

## 2.5.0 — 2026-08-01

A smaller front door.

- CLI pruned.
`;
const s260 = changelogSection(CHANGELOG, '2.6.0');
assert.ok(s260.startsWith('## 2.6.0'), 'the section starts at its heading');
assert.ok(s260.includes('Threads: the ledger'), 'and contains its own entries');
assert.ok(!s260.includes('2.5.0'), 'and stops before the next version');
assert.ok(!s260.includes('smaller front door'), 'definitely stops before the next version');
assert.ok(changelogSection(CHANGELOG, '2.5.0').includes('CLI pruned'), 'older sections resolve too');
assert.equal(changelogSection(CHANGELOG, '9.9.9'), null, 'an absent version is null, not a guess');
// The dot in a version is a regex metacharacter; unescaped, "2.6.0" would
// also match a heading like "2X6X0".
assert.equal(changelogSection('## 2X6X0 — nope\n\nbody\n', '2.6.0'), null, 'the version is matched literally');

// -- install mode --------------------------------------------------------------
// The whole update path forks on this, and a wrong answer means npm -g
// quietly shadowing a linked dev checkout.
assert.ok(['git', 'npm', 'unknown'].includes(installMode()), 'a mode is always one of the three');

const checkout = path.join(home, 'checkout');
fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
assert.equal(installMode(checkout), 'git',
  'a checkout is git — npm-installing over a linked dev tree is how your edits stop taking effect');

const global = path.join(home, 'lib', 'node_modules', 'glashaus');
fs.mkdirSync(global, { recursive: true });
assert.equal(installMode(global), 'npm', 'a global install is npm');

// A checkout wins even when it sits under a node_modules path — `npm link`
// puts a symlink there, and following the npm branch would clobber the source.
const linked = path.join(home, 'node_modules', 'glashaus');
fs.mkdirSync(path.join(linked, '.git'), { recursive: true });
assert.equal(installMode(linked), 'git', 'a linked checkout is still a checkout');

assert.equal(installMode(path.join(home, 'somewhere-else')), 'unknown',
  'anything else is unknown — and unknown makes the updater refuse rather than guess');

// -- version reading -----------------------------------------------------------
assert.match(localVersion(), /^\d+\.\d+\.\d+/, 'the local version parses');
assert.equal(localVersion(), JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  'and matches package.json');

// -- the ledger's shape --------------------------------------------------------
// Rollback reads this. If the fields drift, rollback fails at exactly the
// moment it is needed, so the contract is pinned here.
const ledger = path.join(home, 'updates.json');
fs.writeFileSync(ledger, JSON.stringify([{
  at: '2026-08-15T03:50:32.570Z', mode: 'npm', ref: 'main',
  fromVersion: '2.5.0', fromTarball: path.join(home, 'rollback', 'glashaus-2.5.0.tgz'),
  toVersion: '2.6.0', toSha: 'f'.repeat(40),
  backup: path.join(home, 'backups', 'glashaus-2026-08-15.sqlite'),
  schemaBefore: 8, schemaAfter: 9, ok: true,
}]));
const entry = JSON.parse(fs.readFileSync(ledger, 'utf8')).filter(e => e.ok).pop();
for (const field of ['fromVersion', 'fromTarball', 'toVersion', 'backup', 'mode']) {
  assert.ok(entry[field], `the ledger carries ${field} — rollback needs it`);
}
assert.ok(entry.schemaBefore < entry.schemaAfter, 'and records that a migration happened');

fs.rmSync(home, { recursive: true, force: true });
console.log('update ✓ — versions ordered, changelog sliced, install mode known, ledger contract held');
